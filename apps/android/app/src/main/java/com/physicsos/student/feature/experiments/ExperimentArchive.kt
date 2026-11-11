package com.physicsos.student.feature.experiments

import com.physicsos.student.feature.experiments.bridge.BridgeLimits
import com.physicsos.student.feature.experiments.bridge.LabBridgeProtocol
import com.physicsos.student.feature.experiments.bridge.LabLoad
import com.physicsos.student.feature.experiments.bridge.StrictBridgeJson
import com.physicsos.student.feature.experiments.bridge.invalid
import com.physicsos.student.feature.experiments.bridge.keysExactly
import com.physicsos.student.feature.experiments.bridge.objectValue
import com.physicsos.student.feature.experiments.bridge.string
import kotlinx.serialization.json.JsonObject

/** Imports exactly the JSON exported by the Worker; old scenes stay explicitly history-free. */
internal data class ExperimentArchive(val load: LabLoad) {
    val scene: JsonObject get() = load.checkpoint?.scene ?: requireNotNull(load.scene)
    val title: String get() = (scene["metadata"] as? JsonObject)?.text("title")?.take(300)
        ?.takeIf(String::isNotBlank) ?: scene.string("id", 128)
    val domain: String get() = (scene["metadata"] as? JsonObject)?.text("domain")
        ?.takeIf { it.isNotBlank() && it.length <= 64 } ?: "custom"
}

internal fun parseExperimentArchive(text: String): ExperimentArchive {
    val value = StrictBridgeJson.parse(text, BridgeLimits.FILE_BYTES).objectValue()
    val load = when {
        "schemaVersion" in value -> LabLoad(scene = LabBridgeProtocol.scene(value))
        "history" in value || "editing" in value || "playback" in value ->
            LabLoad(checkpoint = LabBridgeProtocol.checkpoint(value))
        "checkpoint" in value -> {
            value.keysExactly(setOf("version", "checkpoint"))
            if (value.long("version") != 1L) invalid("UNSUPPORTED_CHECKPOINT_VERSION")
            LabLoad(checkpoint = LabBridgeProtocol.checkpoint(value.getValue("checkpoint")))
        }
        "scene" in value -> {
            value.keysExactly(setOf("version", "scene"), setOf("originScene"))
            if (value.long("version") != 1L) invalid("UNSUPPORTED_CHECKPOINT_VERSION")
            LabLoad(scene = LabBridgeProtocol.scene(value.getValue("scene")),
                originScene = value["originScene"]?.let(LabBridgeProtocol::scene))
        }
        else -> invalid("INVALID_EXPERIMENT_ARCHIVE")
    }
    return ExperimentArchive(load)
}
