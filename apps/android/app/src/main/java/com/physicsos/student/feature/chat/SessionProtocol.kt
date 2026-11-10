package com.physicsos.student.feature.chat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

internal val sessionJson = Json { ignoreUnknownKeys = true }

/** These are Session v4 events, not a second chat/history API. */
internal data class JournalEvent(
    val seq: Long,
    val time: Long,
    val type: String,
    val data: JsonObject,
    val placement: SurfacePlacement?,
    val raw: JsonObject,
)

internal sealed interface SurfacePlacement {
    data object Append : SurfacePlacement
    data class Replace(val startSeq: Long, val endSeq: Long) : SurfacePlacement
}

internal data class SessionSnapshot(
    val header: JsonObject,
    val cursor: Long,
    val records: List<JournalEvent>,
    val hasMore: Boolean,
    val projections: JsonObject,
    val assistant: JsonObject?,
)

internal data class HistoryPage(val records: List<JournalEvent>, val hasMore: Boolean)

internal data class SessionListItem(
    val id: String,
    val title: String?,
    val updatedAt: Long,
    val running: Boolean,
    val blank: Boolean,
    val archived: Boolean = false,
    val raw: JsonObject,
)

internal sealed interface MuxMessage {
    val streamId: String
    data class Item(override val streamId: String, val value: JsonObject) : MuxMessage
    data class Error(override val streamId: String, val code: String) : MuxMessage
    data class End(override val streamId: String) : MuxMessage
}

internal class SessionProtocolException(val reason: String) : Exception(reason)

internal object SessionProtocol {
    const val PAGE_MESSAGES = 40
    const val FORMAT_VERSION = 4L
    const val MAX_FRAME_CHARS = 32 * 1024 * 1024
    private val surfaceTypes = setOf(
        "system/message", "developer/message", "user/message", "assistant/message", "tool/result",
    )

    fun address(id: String): JsonObject = buildJsonObject {
        requireId(id)
        put("kind", "session")
        put("sessionId", id)
    }

    fun followOpen(streamId: String, sessionId: String): String = open(
        streamId,
        "session/follow",
        buildJsonObject {
            put("request", buildJsonObject {
                put("address", address(sessionId))
                put("assistantStream", true)
                put("maxMessages", PAGE_MESSAGES)
            })
        },
    )

    fun open(streamId: String, endpoint: String, args: JsonObject = JsonObject(emptyMap())): String =
        buildJsonObject {
            requireId(streamId)
            put("type", "open")
            put("streamId", streamId)
            put("endpoint", endpoint)
            // Typert has named arguments, including the parameter named request.
            put("payload", buildJsonObject { put("args", args) })
        }.toString()

    fun cancelSubscription(streamId: String): String = buildJsonObject {
        put("type", "cancel")
        put("streamId", streamId)
    }.toString()

    fun pageRequest(sessionId: String, throughSeq: Long, beforeSeq: Long): JsonObject = buildJsonObject {
        requireCursor(throughSeq)
        if (beforeSeq < 0 || beforeSeq > throughSeq + 1) fail("page_cursor")
        put("address", address(sessionId))
        put("throughSeq", throughSeq)
        put("beforeSeq", beforeSeq)
        put("maxMessages", PAGE_MESSAGES)
    }

    fun parseMux(text: String): MuxMessage {
        if (text.length > MAX_FRAME_CHARS) fail("frame_too_large")
        val obj = parseObject(text)
        val id = obj.requiredString("streamId").also(::requireId)
        return when (obj.requiredString("type")) {
            "item" -> MuxMessage.Item(id, obj.requiredObject("value"))
            "error" -> MuxMessage.Error(id, obj.requiredObject("error").requiredString("code"))
            "end" -> MuxMessage.End(id)
            else -> fail("mux_type")
        }
    }

    fun snapshot(value: JsonObject, sessionId: String): SessionSnapshot {
        if (value.string("type") != "snapshot") fail("snapshot_required")
        val header = value.requiredObject("header")
        if (header.string("id") != sessionId) fail("wrong_session")
        if (header.number("version") != FORMAT_VERSION) fail("unsupported_session_version")
        val cursor = value.requiredNumber("cursor").also(::requireCursor)
        val records = records(value)
        validateContiguous(records)
        if (records.lastOrNull()?.seq != cursor && !(records.isEmpty() && cursor == -1L)) {
            fail("snapshot_cursor")
        }
        val hasMore = value.requiredBoolean("hasMore")
        if (hasMore != ((records.firstOrNull()?.seq ?: 0L) > 0)) fail("snapshot_prefix")
        val projections = value.requiredObject("projections")
        if (projections.requiredNumber("asOfSeq") != cursor) fail("projection_cursor")
        projections.requiredObject("values")
        return SessionSnapshot(header, cursor, records, hasMore, projections, value.obj("assistantStream"))
    }

    fun page(value: JsonElement, beforeSeq: Long, throughSeq: Long): HistoryPage {
        val obj = value as? JsonObject ?: fail("page_object")
        val events = records(obj)
        validateContiguous(events)
        if (events.any { it.seq >= beforeSeq || it.seq > throughSeq }) fail("page_cut")
        if (beforeSeq > 0 && events.lastOrNull()?.seq != beforeSeq - 1) fail("page_gap")
        val hasMore = obj.requiredBoolean("hasMore")
        if (hasMore != ((events.firstOrNull()?.seq ?: 0L) > 0)) fail("page_prefix")
        return HistoryPage(events, hasMore)
    }

    fun event(entry: JsonObject): JournalEvent {
        if (entry.string("type") != "event") fail("event_entry")
        return rawEvent(entry.requiredObject("event"))
    }

    fun rawEvent(raw: JsonObject): JournalEvent {
        val seq = raw.requiredNumber("seq")
        if (seq < 0) fail("event_seq")
        val time = raw.requiredNumber("time")
        val type = raw.requiredString("type")
        val data = raw.obj("data") ?: if (raw["ignorable"] == JsonPrimitive(true)) {
            buildJsonObject { put("opaque", raw["data"] ?: JsonNull) }
        } else fail("event_data")
        val placement = when (val op = raw["surfaceOp"]) {
            null -> {
                if (type in surfaceTypes) fail("missing_surface_op")
                null
            }
            is JsonPrimitive -> if (op.contentOrNull == "append") SurfacePlacement.Append else fail("surface_op")
            is JsonObject -> {
                if (op.string("op") != "replace") fail("surface_op")
                val start = op.requiredNumber("startSeq")
                val end = op.requiredNumber("endSeq")
                // Surface order is not numerical order after a previous replacement.
                if (start < 0 || end < 0 || start >= seq || end >= seq) fail("surface_range")
                SurfacePlacement.Replace(start, end)
            }
            else -> fail("surface_op")
        }
        return JournalEvent(seq, time, type, data, placement, raw)
    }

    fun list(value: JsonElement, archived: Set<String>): List<SessionListItem> {
        val obj = value as? JsonObject ?: fail("list_object")
        val seen = HashSet<String>()
        return obj.requiredArray("items").mapNotNull { item ->
            val row = item as? JsonObject ?: fail("list_item")
            val id = row.requiredString("sessionId").also(::requireId)
            if (!seen.add(id)) fail("duplicate_session")
            // Ordinary student conversations must not adopt a subagent as a root session.
            if (row.string("origin") == "subagent") return@mapNotNull null
            SessionListItem(
                id = id,
                title = row.obj("projections")?.obj("values")?.string("title"),
                updatedAt = row.requiredNumber("updatedAt"),
                running = row.requiredBoolean("running"),
                blank = row.requiredBoolean("blank"),
                archived = id in archived,
                raw = row,
            )
        }.sortedByDescending { it.updatedAt }
        // session/list returns every visible row. Its reserved request.cursor is NOT pagination.
    }

    fun records(value: JsonObject): List<JournalEvent> = value.requiredArray("records").map {
        event(it as? JsonObject ?: fail("record_object"))
    }

    fun validateContiguous(records: List<JournalEvent>) {
        records.zipWithNext().forEach { (left, right) ->
            if (right.seq != left.seq + 1) fail("records_not_contiguous")
        }
    }

    fun parseObject(text: String): JsonObject = try {
        sessionJson.parseToJsonElement(text) as? JsonObject ?: fail("json_object")
    } catch (error: SessionProtocolException) {
        throw error
    } catch (_: IllegalArgumentException) {
        fail("invalid_json")
    }

    private fun requireId(id: String) {
        if (id.isBlank() || id.length > 512 || id.any { it.code < 32 }) fail("invalid_id")
    }

    private fun requireCursor(cursor: Long) {
        if (cursor < -1 || cursor > 9_007_199_254_740_991L) fail("invalid_cursor")
    }
}

internal fun JsonObject.string(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
internal fun JsonObject.number(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
internal fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
internal fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
internal fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray
internal fun JsonObject.requiredString(key: String): String = string(key) ?: fail("missing_$key")
internal fun JsonObject.requiredNumber(key: String): Long = number(key) ?: fail("missing_$key")
internal fun JsonObject.requiredBoolean(key: String): Boolean = bool(key) ?: fail("missing_$key")
internal fun JsonObject.requiredObject(key: String): JsonObject = obj(key) ?: fail("missing_$key")
internal fun JsonObject.requiredArray(key: String): JsonArray = array(key) ?: fail("missing_$key")
internal fun fail(reason: String): Nothing = throw SessionProtocolException(reason)
