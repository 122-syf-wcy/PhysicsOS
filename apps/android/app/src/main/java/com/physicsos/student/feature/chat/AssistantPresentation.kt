package com.physicsos.student.feature.chat

import java.util.TreeMap
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Process-local revisions are deliberately independent of durable event seqs. */
internal class AssistantPresentation {
    var revision: Long = 0
        private set
    var active: Attempt? = null
        private set
    private val waiting = TreeMap<Long, JsonObject>()
    private val recent = LinkedHashMap<Long, JsonObject>()
    val hasGap: Boolean get() = waiting.isNotEmpty()

    internal class Attempt(
        val id: String,
        val startedAfterSeq: Long,
        val turn: Long,
        val step: Long,
        var nextIndex: Long = 0,
        val assembler: AssistantBlocks = AssistantBlocks(),
        val records: MutableList<JsonObject> = ArrayList(),
        var committedSeq: Long? = null,
        var committedType: String? = null,
    )

    fun restore(baseline: JsonObject?, cursor: Long) {
        waiting.clear()
        recent.clear()
        revision = baseline?.requiredNumber("revision") ?: 0
        if (revision < 0) fail("assistant_revision")
        active = baseline?.obj("activeAttempt")?.let { value ->
            val start = value.requiredNumber("startedAfterSeq")
            if (start < -1 || start > cursor) fail("assistant_start_cursor")
            val attempt = Attempt(
                id = value.requiredString("attemptId"),
                startedAfterSeq = start,
                turn = value.requiredNumber("turn"),
                step = value.requiredNumber("step"),
                committedSeq = value.number("committedSeq"),
                committedType = value.string("committedType"),
            )
            for (recordValue in value.requiredArray("stream")) {
                val record = recordValue as? JsonObject ?: fail("assistant_record")
                attempt.nextIndex += attempt.assembler.applyCompact(record)
                attempt.records.add(record)
            }
            if (attempt.nextIndex != value.requiredNumber("nextIndex")) fail("assistant_baseline_index")
            attempt
        }
    }

    fun accept(frame: JsonObject) {
        val nextRevision = frame.requiredNumber("revision")
        if (nextRevision <= 0) fail("assistant_revision")
        // A Host Agent restart resets its revision space. Only a new snapshot can establish it.
        if (nextRevision == 1L && revision > 1 && frame.string("type") == "start" &&
            frame.string("attemptId") != active?.id
        ) fail("assistant_revision_reset")
        if (nextRevision <= revision) {
            recent[nextRevision]?.let { if (it != frame) fail("assistant_conflicting_duplicate") }
            return
        }
        waiting[nextRevision]?.let { if (it != frame) fail("assistant_conflicting_duplicate") }
        waiting[nextRevision] = frame
        if (waiting.size > MAX_OUT_OF_ORDER) fail("assistant_gap")
        while (true) {
            val next = waiting.remove(revision + 1) ?: break
            applyFrame(next)
            revision += 1
            recent[revision] = next
            if (recent.size > MAX_OUT_OF_ORDER) recent.remove(recent.keys.first())
        }
    }

    private fun applyFrame(frame: JsonObject) {
        val id = frame.requiredString("attemptId")
        when (frame.requiredString("type")) {
            "start" -> {
                if (active != null) fail("assistant_overlap")
                active = Attempt(
                    id = id,
                    startedAfterSeq = frame.requiredNumber("startedAfterSeq"),
                    turn = frame.requiredNumber("turn"),
                    step = frame.requiredNumber("step"),
                )
            }
            "chunk" -> {
                val attempt = active ?: fail("assistant_missing_start")
                if (attempt.id != id || attempt.committedSeq != null) fail("assistant_attempt")
                if (frame.requiredNumber("index") != attempt.nextIndex) fail("assistant_chunk_index")
                val chunk = frame.requiredObject("chunk")
                attempt.assembler.push(chunk)
                appendCompact(attempt.records, frame.requiredNumber("time"), chunk)
                attempt.nextIndex += 1
            }
            "end" -> {
                val attempt = active ?: fail("assistant_missing_start")
                if (attempt.id != id || frame.requiredNumber("index") != attempt.nextIndex) {
                    fail("assistant_end_index")
                }
                val outcome = frame.requiredObject("outcome")
                when (outcome.requiredString("kind")) {
                    "abandoned" -> active = null
                    "committed" -> {
                        val seq = outcome.requiredNumber("seq")
                        val type = outcome.requiredString("eventType")
                        if (seq <= attempt.startedAfterSeq || type !in setOf("assistant/message", "assistant/attempt")) {
                            fail("assistant_settlement")
                        }
                        attempt.committedSeq = seq
                        attempt.committedType = type
                    }
                    else -> fail("assistant_outcome")
                }
            }
            else -> fail("assistant_frame_type")
        }
    }

    fun settle(eventAt: (Long) -> JournalEvent?) {
        val attempt = active ?: return
        val seq = attempt.committedSeq ?: return
        val event = eventAt(seq) ?: return
        if (event.type != attempt.committedType || event.data.number("turn") != attempt.turn ||
            event.data.number("step") != attempt.step
        ) fail("assistant_settlement_mismatch")
        active = null
    }

    fun isSettlement(event: JournalEvent): Boolean {
        val attempt = active ?: return false
        return event.seq > attempt.startedAfterSeq && event.type in setOf("assistant/message", "assistant/attempt") &&
            event.data.number("turn") == attempt.turn && event.data.number("step") == attempt.step
    }

    fun baseline(): JsonObject = buildJsonObject {
        put("revision", revision)
        active?.let { attempt ->
            put("activeAttempt", buildJsonObject {
                put("attemptId", attempt.id)
                put("startedAfterSeq", attempt.startedAfterSeq)
                put("turn", attempt.turn)
                put("step", attempt.step)
                put("nextIndex", attempt.nextIndex)
                put("stream", JsonArray(attempt.records.toList()))
                attempt.committedSeq?.let { put("committedSeq", it) }
                attempt.committedType?.let { put("committedType", it) }
            })
        }
    }

    companion object { private const val MAX_OUT_OF_ORDER = 128 }
}

/** First-seen block order and first block-end win, matching the server's BlockAssembler. */
internal class AssistantBlocks {
    private class Partial(val type: String) {
        val text = StringBuilder()
        val arguments = StringBuilder()
        var callId: String? = null
        var name: String? = null
        var closed: JsonObject? = null
    }
    private val blocks = LinkedHashMap<Long, Partial>()
    var finish: String? = null
        private set

    fun push(chunk: JsonObject) {
        val type = chunk.requiredString("type")
        if (type == "usage") return
        if (type == "finish") {
            finish = chunk.requiredObject("reason").requiredString("kind")
            return
        }
        val index = chunk.requiredNumber("index")
        if (index < 0) fail("block_index")
        when (type) {
            "block-start" -> blocks.getOrPut(index) { Partial(chunk.requiredString("blockType")) }
            "text-delta", "reasoning-delta" -> {
                val part = blocks.getOrPut(index) { Partial(if (type == "text-delta") "text" else "reasoning") }
                if (part.closed == null) part.text.append(chunk.requiredString("text"))
            }
            "tool-call-delta" -> {
                val part = blocks.getOrPut(index) { Partial("tool-call") }
                if (part.closed == null) {
                    part.callId = chunk.requiredString("id")
                    chunk.string("name")?.let { part.name = it }
                    part.arguments.append(chunk.requiredString("argumentsDelta"))
                }
            }
            "block-end" -> {
                val block = chunk.requiredObject("block")
                val part = blocks.getOrPut(index) { Partial(block.requiredString("type")) }
                if (part.closed == null) part.closed = block
            }
            else -> fail("unsupported_assistant_chunk")
        }
    }

    fun content(): JsonArray = JsonArray(blocks.values.map { part ->
        part.closed ?: buildJsonObject {
            put("type", part.type)
            when (part.type) {
                "text", "reasoning" -> put("text", part.text.toString())
                "tool-call" -> {
                    part.callId?.let { put("id", it) }
                    part.name?.let { put("name", it) }
                    put("arguments", part.arguments.toString())
                }
            }
        }
    })

    /** Fold packed runs without allocating one object for every text token in a snapshot. */
    fun applyCompact(record: JsonObject): Long {
        val type = record.requiredString("type")
        if (type == "chunk") {
            record.requiredNumber("time")
            push(record.requiredObject("chunk"))
            return 1
        }
        val index = record.requiredNumber("index")
        if (index < 0) fail("compact_index")
        record.requiredNumber("time0")
        val values = when (type) {
            "text-chunks", "reasoning-chunks" -> record.requiredArray("texts")
            "tool-call-chunks" -> record.requiredArray("args")
            else -> fail("compact_type")
        }
        if (values.isEmpty() || record.requiredArray("dt").size != values.size - 1) fail("compact_lengths")
        record.requiredArray("dt").forEach {
            val delta = (it as? JsonPrimitive)?.content?.toLongOrNull() ?: fail("compact_time")
            if (delta < 0) fail("compact_time")
        }
        val text = buildString {
            values.forEach { value ->
                val primitive = value as? JsonPrimitive ?: fail("compact_text")
                if (!primitive.isString) fail("compact_text")
                append(primitive.content)
            }
        }
        val chunk = buildJsonObject {
            put("index", index)
            when (type) {
                "text-chunks", "reasoning-chunks" -> {
                    put("type", if (type == "text-chunks") "text-delta" else "reasoning-delta")
                    put("text", text)
                }
                else -> {
                    put("type", "tool-call-delta")
                    put("id", record.requiredString("id"))
                    record.string("name")?.let { put("name", it) }
                    put("argumentsDelta", text)
                }
            }
        }
        push(chunk)
        return values.size.toLong()
    }
}

private fun appendCompact(records: MutableList<JsonObject>, time: Long, chunk: JsonObject) {
    val kind = when (chunk.string("type")) {
        "text-delta" -> "text-chunks"
        "reasoning-delta" -> "reasoning-chunks"
        else -> null
    }
    val previous = records.lastOrNull()
    if (kind != null && previous?.string("type") == kind && previous.number("index") == chunk.number("index") &&
        previous.requiredArray("texts").size < 64
    ) {
        // Runs are bounded so appending a delta never recopies an entire long answer.
        val times = previous.requiredArray("dt")
        val elapsed = times.sumOf { (it as? JsonPrimitive)?.content?.toLongOrNull() ?: fail("compact_time") }
        records[records.lastIndex] = JsonObject(previous + mapOf(
            "texts" to JsonArray(previous.requiredArray("texts") + JsonPrimitive(chunk.requiredString("text"))),
            "dt" to JsonArray(times + JsonPrimitive(time - previous.requiredNumber("time0") - elapsed)),
        ))
        return
    }
    records.add(buildJsonObject {
        if (kind == null) {
            put("type", "chunk")
            put("time", time)
            put("chunk", chunk)
        } else {
            put("type", kind)
            put("time0", time)
            put("index", chunk.requiredNumber("index"))
            put("dt", JsonArray(emptyList()))
            put("texts", JsonArray(listOf(JsonPrimitive(chunk.requiredString("text")))))
        }
    })
}
