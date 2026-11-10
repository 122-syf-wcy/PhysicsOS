package com.physicsos.student.feature.chat

import java.util.TreeMap
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal enum class MessageRole { USER, ASSISTANT, CONTEXT, TOOL }

internal sealed interface ChatRow {
    val key: String

    data class Message(
        override val key: String,
        val seq: Long,
        val role: MessageRole,
        val content: JsonArray,
        val markdown: String,
        val reasoning: String,
        val requestId: String?,
        val turn: Long?,
        val step: Long?,
        val interrupted: Boolean = false,
        val live: Boolean = false,
        val toolError: Boolean = false,
    ) : ChatRow

    data class Scene(
        override val key: String,
        val seq: Long,
        val turn: Long?,
        val title: String,
        val scene: JsonObject,
        val experimentId: String?,
        val solve: JsonObject?,
        val revision: Long,
    ) : ChatRow
}

internal data class QueueEntry(val id: String, val target: String, val message: JsonObject) {
    val requestId: String? get() = message.obj("source")?.string("rpcId")
    val text: String get() = plainText(message.array("content") ?: JsonArray(emptyList()))
    val textOnly: Boolean get() = message.array("content")?.all { (it as? JsonObject)?.string("type") == "text" } == true
}

/** A dense loaded suffix, with an independent ordered surface and assistant revision space. */
internal class ChatJournal {
    private val events = TreeMap<Long, JournalEvent>()
    private val waiting = TreeMap<Long, JournalEvent>()
    private val surface = ArrayList<Long>()
    private val messageCache = HashMap<Long, ChatRow.Message>()
    private val scenes = LinkedHashMap<String, ChatRow.Scene>()
    private val turns = HashMap<Long, Long?>()
    private var previous = TreeMap<Long, JournalEvent>()
    private val dirty = LinkedHashMap<Long, JournalEvent>()
    private var baselineValues = JsonObject(emptyMap())
    private var projectionCut = -1L
    private var missingSurface = false
    private var currentTurn: Long? = null
    private val mutableInbox = linkedMapOf("next-turn" to mutableListOf<JsonObject>(), "next-step" to mutableListOf<JsonObject>())
    private val observedRequests = HashSet<String>()
    private val opaqueTypes = linkedSetOf<String>()
    private var recoveryTarget: Long? = null
    val assistant = AssistantPresentation()

    var header: JsonObject = JsonObject(emptyMap())
        private set
    var cursor: Long = -1
        private set
    var throughSeq: Long = -1
        private set
    var hasMore: Boolean = false
        private set
    var title: String? = null
        private set
    var running: Boolean = false
        private set
    var turnOutcome: String? = null
        private set
    val firstSeq: Long get() = events.firstKeyOrNull() ?: 0
    val hasGap: Boolean get() = waiting.isNotEmpty() || assistant.hasGap
    val needsOlder: Boolean get() = hasMore && (missingSurface || recoveryTarget?.let { firstSeq > it } == true)
    val missingSurfacePrefix: Boolean get() = missingSurface
    val unknownEventTypes: Set<String> get() = opaqueTypes.toSet()
    val knownRequestIds: Set<String> get() = observedRequests + queue.mapNotNull { it.requestId }
    val queue: List<QueueEntry> get() = mutableInbox.flatMap { (target, entries) ->
        entries.map { QueueEntry(it.requiredString("id"), target, it) }
    }
    val projections: JsonObject get() = baselineValues

    fun replace(snapshot: SessionSnapshot, reconcileAfterSeq: Long? = null) {
        previous = TreeMap(events)
        if (header["createdAt"] != snapshot.header["createdAt"] && header.isNotEmpty()) previous.clear()
        recoveryTarget = listOfNotNull(previous.lastKeyOrNull(), reconcileAfterSeq?.coerceAtLeast(0)).minOrNull()
        header = snapshot.header
        cursor = snapshot.cursor
        throughSeq = snapshot.cursor
        hasMore = snapshot.hasMore
        projectionCut = snapshot.projections.requiredNumber("asOfSeq")
        baselineValues = snapshot.projections.requiredObject("values")
        events.clear()
        waiting.clear()
        dirty.clear()
        snapshot.records.forEach { events[it.seq] = it; dirty[it.seq] = it }
        assistant.restore(snapshot.assistant, cursor)
        mergeVerifiedPrevious()
        rebuild()
        assistant.settle(events::get)
    }

    /** Restore only the range named by a checkpoint written after its individual records. */
    fun restore(checkpoint: JsonObject, records: List<JournalEvent>) {
        val restoredCursor = checkpoint.requiredNumber("cursor")
        SessionProtocol.validateContiguous(records)
        if (records.lastOrNull()?.seq != restoredCursor && restoredCursor != -1L) fail("cache_cursor")
        header = checkpoint.requiredObject("header")
        cursor = restoredCursor
        throughSeq = checkpoint.requiredNumber("throughSeq")
        hasMore = checkpoint.requiredBoolean("hasMore")
        baselineValues = checkpoint.requiredObject("projections")
        projectionCut = checkpoint.requiredNumber("projectionCut")
        events.clear()
        records.forEach { events[it.seq] = it }
        waiting.clear()
        previous.clear()
        dirty.clear()
        assistant.restore(checkpoint.obj("assistantStream"), cursor)
        rebuild()
    }

    fun prepend(page: HistoryPage) {
        if (page.records.isEmpty()) {
            if (firstSeq != 0L) fail("empty_history_page")
            hasMore = false
            return
        }
        if (page.records.last().seq != firstSeq - 1) fail("history_page_gap")
        page.records.forEach { event -> events[event.seq] = event; dirty[event.seq] = event }
        hasMore = page.hasMore
        mergeVerifiedPrevious()
        rebuild()
    }

    fun accept(event: JournalEvent) {
        if (event.seq <= cursor) {
            events[event.seq]?.let { if (it.raw != event.raw) fail("conflicting_event_duplicate") }
            return
        }
        waiting[event.seq]?.let { if (it.raw != event.raw) fail("conflicting_event_duplicate") }
        waiting[event.seq] = event
        if (waiting.size > 128) fail("durable_gap")
        while (true) {
            val next = waiting.remove(cursor + 1) ?: break
            events[next.seq] = next
            dirty[next.seq] = next
            cursor = next.seq
            apply(next)
        }
        assistant.settle(events::get)
    }

    fun acceptAssistant(frame: JsonObject) {
        assistant.accept(frame)
        assistant.settle(events::get)
    }

    fun recoveryThrough(seq: Long) {
        recoveryTarget = minOf(recoveryTarget ?: seq.coerceAtLeast(0), seq.coerceAtLeast(0))
    }

    fun dirtyRecords(): List<JournalEvent> = dirty.values.toList()
    fun acknowledgePersisted(records: List<JournalEvent>) {
        records.forEach { if (dirty[it.seq]?.raw == it.raw) dirty.remove(it.seq) }
    }

    fun checkpoint(): JsonObject = buildJsonObject {
        put("header", header)
        put("cursor", cursor)
        put("firstSeq", firstSeq)
        put("throughSeq", throughSeq)
        put("hasMore", hasMore)
        put("projections", baselineValues)
        put("projectionCut", projectionCut)
        put("assistantStream", assistant.baseline())
    }

    fun rows(): List<ChatRow> {
        // An unresolved replacement must never resurrect the messages it may have shadowed.
        if (missingSurface) return emptyList()
        val messages = surface.mapNotNull { seq ->
            val event = events[seq] ?: return@mapNotNull null
            messageCache.getOrPut(seq) { message(event, turns[seq]) ?: return@mapNotNull null }
        }
        val latestAnswerByTurn = messages.filter { it.role == MessageRole.ASSISTANT && it.turn != null }
            .associateBy { it.turn }
        val remainingScenes = scenes.values.toMutableList()
        val rows = ArrayList<ChatRow>(messages.size + remainingScenes.size + 1)
        for (message in messages) {
            val attached = remainingScenes.filter { scene ->
                scene.turn != null && latestAnswerByTurn[scene.turn]?.key == message.key
            }
            rows.addAll(attached)
            remainingScenes.removeAll(attached.toSet())
            rows.add(message)
        }
        rows.addAll(remainingScenes)
        assistant.active?.let { attempt ->
            if (events.values.none(assistant::isSettlement)) {
                val content = attempt.assembler.content()
                rows.add(ChatRow.Message(
                    key = "live:${attempt.id}", seq = cursor + 1, role = MessageRole.ASSISTANT,
                    content = content, markdown = plainText(content), reasoning = reasoningText(content),
                    requestId = null, turn = attempt.turn, step = attempt.step, live = true,
                ))
            }
        }
        return rows
    }

    private fun mergeVerifiedPrevious() {
        if (previous.isEmpty() || events.isEmpty()) return
        val overlap = events.keys.firstOrNull { previous.containsKey(it) } ?: return
        val identical = events.entries.filter { previous.containsKey(it.key) }.all { (seq, event) ->
            previous[seq]?.raw == event.raw
        }
        if (!identical) {
            previous.clear()
            return
        }
        val oldest = firstSeq
        previous.headMap(oldest).values.forEach { events[it.seq] = it }
        if (overlap >= oldest) {
            hasMore = firstSeq > 0
            previous.clear()
        }
    }

    private fun rebuild() {
        surface.clear()
        messageCache.clear()
        scenes.clear()
        turns.clear()
        observedRequests.clear()
        opaqueTypes.clear()
        currentTurn = null
        missingSurface = false
        title = baselineValues.string("title")
        running = baselineValues.obj("turnBoundary")?.get("openTurnStartSeq")?.let { it != JsonNull } ?: false
        turnOutcome = null
        mutableInbox.forEach { (target, list) ->
            list.clear()
            baselineValues.obj("inbox")?.array(target)?.forEach { value ->
                list.add(value as? JsonObject ?: fail("inbox_message"))
            }
        }
        events.values.forEach(::apply)
        if (missingSurface && !hasMore) fail("invalid_surface_endpoints")
    }

    private fun apply(event: JournalEvent) {
        val data = event.data
        if (event.type == "turn/start") currentTurn = data.requiredNumber("turn")
        turns[event.seq] = data.number("turn") ?: currentTurn
        when (val op = event.placement) {
            SurfacePlacement.Append -> surface.add(event.seq)
            is SurfacePlacement.Replace -> {
                val first = surface.indexOf(op.startSeq)
                val last = surface.indexOf(op.endSeq)
                if (first < 0 || last < first) {
                    if (op.startSeq >= firstSeq && op.endSeq >= firstSeq && !missingSurface) fail("invalid_surface_order")
                    missingSurface = true
                } else {
                    surface.subList(first, last + 1).clear()
                    surface.add(first, event.seq)
                }
            }
            null -> Unit
        }
        when (event.type) {
            "user/message" -> recordRequest(data)
            "agent/inbox/spliced" -> {
                data.requiredArray("inserted").forEach { (it as? JsonObject)?.let(::recordRequest) }
                if (event.seq > projectionCut) {
                    val target = data.requiredString("target")
                    val inbox = mutableInbox[target] ?: fail("inbox_target")
                    val start = data.requiredNumber("start").toInt()
                    val removed = (data.number("removedCount") ?: 0).toInt()
                    if (start < 0 || removed < 0 || start > inbox.size || removed > inbox.size - start) fail("inbox_splice")
                    inbox.subList(start, start + removed).clear()
                    inbox.addAll(start, data.requiredArray("inserted").map { it as? JsonObject ?: fail("inbox_message") })
                }
            }
            "session/title" -> if (event.seq > projectionCut || title == null) title = data.requiredString("title")
            "turn/start" -> if (event.seq > projectionCut) { running = true; turnOutcome = null }
            "turn/end" -> {
                if (event.seq > projectionCut) running = false
                turnOutcome = data.obj("reason")?.string("kind")
                currentTurn = null
            }
            "physics/scene" -> {
                val scene = data.requiredObject("scene")
                val id = data.requiredString("sceneId")
                val turn = data.number("turn")
                val group = turn?.let { "turn:$it" } ?: "scene:$id"
                val prior = scenes[group]
                val solve = data.obj("solve") ?: prior?.takeIf { it.scene.string("id") == scene.string("id") }?.solve
                scenes[group] = ChatRow.Scene(
                    key = "physics:$group", seq = event.seq, turn = turn,
                    title = data.requiredString("title"), scene = scene,
                    experimentId = data.string("experimentId"), solve = solve,
                    revision = data.requiredNumber("revision"),
                )
            }
            else -> if (event.placement == null && event.type !in understoodLogEvents && event.raw.bool("ignorable") != true) {
                // Preserve extension records verbatim and disclose unsupported presentation, rather than dropping bytes.
                opaqueTypes.add(event.type)
            }
        }
    }

    private fun recordRequest(message: JsonObject) {
        val source = message.obj("source") ?: return
        if (source.string("kind") == "user") source.string("rpcId")?.let(observedRequests::add)
    }

    private fun message(event: JournalEvent, turn: Long?): ChatRow.Message? {
        val data = event.data
        val body: JsonObject
        val role: MessageRole
        when (event.type) {
            "user/message" -> {
                body = data
                role = if (body.obj("source")?.string("kind") == "user") MessageRole.USER else MessageRole.CONTEXT
            }
            "assistant/message" -> { body = data.requiredObject("message"); role = MessageRole.ASSISTANT }
            "tool/result" -> { body = data.requiredObject("message"); role = MessageRole.TOOL }
            else -> return null
        }
        val content = body.requiredArray("content")
        return ChatRow.Message(
            key = "event:${event.seq}", seq = event.seq, role = role, content = content,
            markdown = plainText(content), reasoning = reasoningText(content),
            requestId = body.obj("source")?.string("rpcId"), turn = turn, step = data.number("step"),
            interrupted = data.bool("interrupted") == true, toolError = body.bool("isError") == true,
        )
    }

    companion object {
        private val understoodLogEvents = setOf(
            "step/start", "step/end", "request/header", "request/context", "session/end-seed", "assistant/attempt",
            "tool/call", "model/selection", "physics/solve-trace", "image/offload", "compaction/start", "compaction/end",
        )
    }
}

internal fun plainText(content: JsonArray): String = content.mapNotNull { block ->
    val obj = block as? JsonObject ?: return@mapNotNull null
    obj.string("text")?.takeIf { obj.string("type") == "text" }
}.joinToString("\n\n")

internal fun reasoningText(content: JsonArray): String = content.mapNotNull { block ->
    val obj = block as? JsonObject ?: return@mapNotNull null
    obj.string("text")?.takeIf { obj.string("type") == "reasoning" }
}.joinToString("\n\n")

private fun <V> TreeMap<Long, V>.firstKeyOrNull(): Long? = if (isEmpty()) null else firstKey()
private fun <V> TreeMap<Long, V>.lastKeyOrNull(): Long? = if (isEmpty()) null else lastKey()
