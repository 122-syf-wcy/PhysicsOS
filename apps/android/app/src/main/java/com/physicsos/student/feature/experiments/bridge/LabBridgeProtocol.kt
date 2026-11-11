package com.physicsos.student.feature.experiments.bridge

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

internal data class LabSummary(
    val sceneId: String,
    val revision: Long,
    val title: String,
    val dirty: Boolean,
    val running: Boolean,
    val time: Double,
    val duration: Double,
    val canUndo: Boolean,
    val canRedo: Boolean,
)

/** The entire immutable value is persisted, including drafts, history and playback. */
internal data class LabCheckpoint(val value: JsonObject) {
    /** Native-only receive order; never serialized into the cross-platform checkpoint. */
    var receivedOrder: Long = 0
    val scene: JsonObject get() = value.getValue("scene") as JsonObject
    val originScene: JsonObject get() = value.getValue("originScene") as JsonObject
    val templateId: String? get() = (value["templateId"] as? JsonPrimitive)?.content
}

internal enum class LabExportFormat(val wire: String, val mime: String, val extension: String) {
    JSON("json", "application/json", "json"),
    CSV("csv", "text/csv", "csv"),
    OBSERVATIONS("observations", "text/csv", "csv"),
    MARKDOWN("markdown", "text/markdown", "md"),
    SVG("svg", "image/svg+xml", "svg"),
    PNG("png", "image/png", "png"),
    METRICS("metrics", "application/json", "json"),
}

internal sealed interface LabIncoming {
    val id: String
    val generation: String?

    data class Ready(override val id: String, val capabilities: Set<String>) : LabIncoming {
        override val generation: String? = null
    }
    data class State(
        override val id: String,
        override val generation: String,
        val summary: LabSummary,
    ) : LabIncoming
    data class Checkpoint(
        override val id: String,
        override val generation: String,
        val checkpoint: LabCheckpoint,
    ) : LabIncoming
    data class Error(
        override val id: String,
        override val generation: String,
        val code: String,
        val message: String,
    ) : LabIncoming
    data class Export(
        override val id: String,
        override val generation: String,
        val name: String,
        val mime: String,
        val encoding: String,
        val content: String,
    ) : LabIncoming
}

internal data class LabLoad(
    val templateId: String? = null,
    val scene: JsonObject? = null,
    val checkpoint: LabCheckpoint? = null,
    val originScene: JsonObject? = null,
) {
    init {
        require(templateId != null || scene != null || checkpoint != null)
    }

    fun payload(generation: String): JsonObject = buildJsonObject {
        put("generation", generation)
        when {
            checkpoint != null -> put("checkpoint", checkpoint.value)
            scene != null -> {
                put("scene", scene)
                originScene?.let { put("originScene", it) }
            }
            else -> put("templateId", requireNotNull(templateId))
        }
    }
}

internal object LabBridgeProtocol {
    const val VERSION = 1
    const val BRIDGE_NAME = "PhysicsNative"
    private val identifier = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
    private val generationId = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

    fun parse(text: String): LabIncoming {
        val envelope = StrictBridgeJson.parse(text).objectValue()
        envelope.keysExactly(setOf("version", "id", "type", "payload"))
        if (envelope.integer("version") != VERSION.toLong()) invalid("UNSUPPORTED_VERSION")
        val id = envelope.string("id", 128)
        if (!identifier.matches(id)) invalid("INVALID_MESSAGE_ID")
        val type = envelope.string("type", 32)
        val payload = envelope.getValue("payload").objectValue()
        if (type == "ready") {
            payload.keysExactly(setOf("capabilities"))
            val entries = payload.array("capabilities", 64).map { it.stringValue(80) }
            if (entries.any(String::isBlank) || entries.distinct().size != entries.size) invalid()
            return LabIncoming.Ready(id, entries.toSet())
        }
        val generation = payload.string("generation", 36)
        if (!generationId.matches(generation)) invalid("INVALID_GENERATION")
        return when (type) {
            "state" -> {
                payload.keysExactly(
                    setOf("generation", "sceneId", "revision", "title", "dirty", "running", "time", "duration", "canUndo", "canRedo"),
                )
                LabIncoming.State(
                    id, generation,
                    LabSummary(
                        sceneId = payload.string("sceneId", 128),
                        revision = payload.integer("revision", 0),
                        title = payload.string("title", 300),
                        dirty = payload.boolean("dirty"),
                        running = payload.boolean("running"),
                        time = payload.number("time", 0.0),
                        duration = payload.number("duration", 0.0),
                        canUndo = payload.boolean("canUndo"),
                        canRedo = payload.boolean("canRedo"),
                    ),
                )
            }
            "checkpoint" -> {
                payload.keysExactly(setOf("generation", "checkpoint"))
                LabIncoming.Checkpoint(id, generation, checkpoint(payload.getValue("checkpoint")))
            }
            "error" -> {
                payload.keysExactly(setOf("generation", "code", "message"))
                LabIncoming.Error(id, generation, payload.string("code", 80), payload.string("message", 2000))
            }
            "export" -> {
                payload.keysExactly(setOf("generation", "name", "mime", "encoding", "content"))
                val encoding = payload.string("encoding", 8)
                if (encoding != "utf8" && encoding != "base64") invalid("INVALID_FILE_ENCODING")
                LabIncoming.Export(
                    id, generation, payload.string("name", 160), payload.string("mime", 80),
                    encoding, payload.string("content", BridgeLimits.MESSAGE_BYTES),
                )
            }
            else -> invalid("UNKNOWN_MESSAGE_TYPE")
        }
    }

    fun checkpoint(element: JsonElement): LabCheckpoint {
        StrictBridgeJson.utf8Size(element.toString(), BridgeLimits.CHECKPOINT_BYTES)
        val checkpoint = element.objectValue()
        checkpoint.keysExactly(
            setOf("version", "scene", "originScene", "playback", "history", "editing"), setOf("templateId"),
        )
        if (checkpoint.integer("version") != 1L) invalid("UNSUPPORTED_CHECKPOINT_VERSION")
        scene(checkpoint.getValue("scene"))
        scene(checkpoint.getValue("originScene"))
        checkpoint["templateId"]?.stringValue(200)?.let { if (it.isBlank()) invalid() }
        checkpoint.getValue("playback").objectValue().apply {
            keysExactly(setOf("time", "duration", "rate", "running"))
            number("time", 0.0)
            number("duration", 0.0)
            if (number("rate", 0.0) == 0.0) invalid()
            boolean("running")
        }
        checkpoint.getValue("history").objectValue().apply {
            keysExactly(setOf("past", "future"))
            for (direction in listOf("past", "future")) {
                array(direction, 500).forEach { value ->
                    value.objectValue().apply {
                        keysExactly(setOf("id", "label", "before", "after"), setOf("beforeDraft", "afterDraft"))
                        string("id", 200)
                        string("label", 500)
                        scene(getValue("before"))
                        scene(getValue("after"))
                        this["beforeDraft"]?.objectValue()
                        this["afterDraft"]?.objectValue()
                    }
                }
            }
        }
        checkpoint.getValue("editing").objectValue().apply {
            keysExactly(
                setOf("instanceKey", "instanceEditRevision", "source", "buildMode", "selectedIds", "observables", "viewport", "activePanel"),
                setOf("draft"),
            )
            string("instanceKey", 256)
            integer("instanceEditRevision", 0)
            getValue("source").objectValue()
            if (string("buildMode", 16) !in setOf("inspect", "construct")) invalid()
            this["draft"]?.objectValue()
            array("selectedIds", 10_000).forEach { it.stringValue(256) }
            getValue("observables").objectValue().apply {
                if (size > 4096) invalid()
                values.forEach { if (it !is JsonPrimitive || it.isString || it.booleanOrNull == null) invalid() }
            }
            getValue("viewport").objectValue().apply {
                keysExactly(setOf("x", "y", "zoom"))
                number("x")
                number("y")
                if (number("zoom", 0.0) == 0.0) invalid()
            }
            if (string("activePanel", 16) !in setOf("parameters", "apparatus", "data", "guide", "report")) invalid()
        }
        finiteTree(checkpoint)
        return LabCheckpoint(checkpoint)
    }

    /** Domain-specific scene validation is repeated by the shared Web runtime. */
    fun scene(element: JsonElement): JsonObject = element.objectValue().apply {
        if (string("schemaVersion", 32) != "physics-scene/1.0") invalid("UNSUPPORTED_SCENE_VERSION")
        val id = string("id", 128)
        if (!identifier.matches(id)) invalid("INVALID_SCENE_ID")
        integer("revision", 0)
        if (string("dimension", 2) !in setOf("2d", "3d")) invalid()
    }

    fun encode(id: String, type: String, payload: JsonObject): String {
        if (!identifier.matches(id)) invalid("INVALID_MESSAGE_ID")
        if (type !in setOf("load", "lifecycle", "theme", "checkpoint", "export", "document")) invalid("UNKNOWN_MESSAGE_TYPE")
        if (!generationId.matches(payload.string("generation", 36))) invalid("INVALID_GENERATION")
        return buildJsonObject {
            put("version", VERSION)
            put("id", id)
            put("type", type)
            put("payload", payload)
        }.toString().also { StrictBridgeJson.utf8Size(it, BridgeLimits.MESSAGE_BYTES) }
    }

    private fun finiteTree(element: JsonElement, depth: Int = 0) {
        if (depth > BridgeLimits.JSON_DEPTH) invalid("JSON_TOO_DEEP")
        when (element) {
            is JsonObject -> element.values.forEach { finiteTree(it, depth + 1) }
            is JsonArray -> element.forEach { finiteTree(it, depth + 1) }
            is JsonPrimitive -> if (!element.isString && element !== JsonNull && element.booleanOrNull == null) {
                if (element.doubleOrNull?.isFinite() != true) invalid("INVALID_NUMBER")
            }
        }
    }
}

internal fun JsonElement.objectValue(): JsonObject = this as? JsonObject ?: invalid()
internal fun JsonElement.stringValue(maximum: Int): String {
    val primitive = this as? JsonPrimitive ?: invalid()
    if (!primitive.isString || primitive.content.length > maximum) invalid()
    return primitive.content
}
internal fun JsonObject.keysExactly(required: Set<String>, optional: Set<String> = emptySet()) {
    if (!keys.containsAll(required) || keys.any { it !in required && it !in optional }) invalid()
}
internal fun JsonObject.string(name: String, maximum: Int): String = (this[name] ?: invalid()).stringValue(maximum)
internal fun JsonObject.integer(name: String, minimum: Long = Long.MIN_VALUE): Long {
    val value = this[name] as? JsonPrimitive ?: invalid()
    val integer = if (value.isString) null else value.longOrNull
    if (integer == null || integer < minimum || integer > 9_007_199_254_740_991L) invalid()
    return integer
}
internal fun JsonObject.number(name: String, minimum: Double = -Double.MAX_VALUE): Double {
    val value = this[name] as? JsonPrimitive ?: invalid()
    val number = if (value.isString) null else value.doubleOrNull
    if (number == null || !number.isFinite() || number < minimum) invalid()
    return number
}
internal fun JsonObject.boolean(name: String): Boolean {
    val value = this[name] as? JsonPrimitive ?: invalid()
    if (value.isString) invalid()
    return value.booleanOrNull ?: invalid()
}
internal fun JsonObject.array(name: String, maximum: Int): JsonArray = (this[name] as? JsonArray ?: invalid()).also {
    if (it.size > maximum) invalid()
}
internal fun invalid(code: String = "INVALID_MESSAGE_SCHEMA"): Nothing = throw BridgeProtocolException(code)
