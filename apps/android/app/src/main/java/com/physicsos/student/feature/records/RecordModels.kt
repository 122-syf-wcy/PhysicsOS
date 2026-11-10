package com.physicsos.student.feature.records

import com.physicsos.student.core.StoredItem
import com.physicsos.student.feature.home.flag
import com.physicsos.student.feature.home.long
import com.physicsos.student.feature.home.requiredText
import com.physicsos.student.feature.home.strings
import com.physicsos.student.feature.home.text
import java.time.Instant
import kotlinx.serialization.json.JsonObject

/** The record route selects learning attempts, saved scenes, or the durable sync queue. */
enum class RecordTab { ATTEMPTS, SCENES, SYNC }

internal data class LearningAttempt(
    val id: String,
    val title: String,
    val questionId: String,
    val prompt: String,
    val answer: String,
    val reportedCorrect: Boolean?,
    val at: String,
    val knowledge: List<String>,
    val experimentId: String?,
    val sessionId: String?,
    val gradingSource: String,
) {
    val document: String = listOf(prompt, answer).filter(String::isNotBlank).joinToString("\n\n")
}

internal data class SavedLearningScene(
    val id: String,
    val title: String,
    val domain: String,
    val updatedAt: Long,
    val templateId: String?,
    val cloudRevision: Long,
    val hasLocal: Boolean,
    val saved: Boolean,
    val deleted: Boolean,
    val syncKey: String?,
)

internal object RecordDecoders {
    fun attempt(row: JsonObject): LearningAttempt = LearningAttempt(
        row.requiredText("id"), row.text("questionTitle").orEmpty(), row.requiredText("questionId"),
        row.text("prompt").orEmpty(), row.text("answerLabel").orEmpty(), row.flag("correct"),
        row.requiredText("at"), row.strings("knowledge"), row.text("experimentId"), row.text("sessionId"),
        row.text("gradingSource") ?: "self-reported",
    )

    fun remoteScene(row: JsonObject): SavedLearningScene = SavedLearningScene(
        id = row.requiredText("sceneId"), title = row.text("title").orEmpty(), domain = row.text("domain").orEmpty(),
        updatedAt = epoch(row.text("updatedAt") ?: row.text("savedAt") ?: row.text("deletedAt")),
        templateId = row.text("templateId"), cloudRevision = row.long("revision") ?: 0,
        hasLocal = false, saved = true, deleted = row.text("deletedAt") != null, syncKey = null,
    )

    fun localScene(stored: StoredItem): SavedLearningScene = stored.payload.let { row ->
        SavedLearningScene(
            id = row.text("sceneId") ?: stored.id, title = row.text("title").orEmpty(), domain = row.text("domain").orEmpty(),
            updatedAt = row.long("updatedAt") ?: stored.updatedAt, templateId = row.text("templateId"),
            cloudRevision = row.long("cloudRevision") ?: 0, hasLocal = row.flag("hasLocal") == true,
            saved = row.flag("saved") == true, deleted = row.flag("remoteDeleted") == true, syncKey = row.text("syncKey"),
        )
    }

    fun mergeScenes(remote: List<SavedLearningScene>, local: List<SavedLearningScene>): List<SavedLearningScene> {
        val merged = remote.associateBy { it.id }.toMutableMap()
        local.forEach { row ->
            val cloud = merged[row.id]
            merged[row.id] = row.copy(
                cloudRevision = if (row.hasLocal) row.cloudRevision else maxOf(row.cloudRevision, cloud?.cloudRevision ?: 0),
                deleted = row.deleted || cloud?.deleted == true,
                title = row.title.ifBlank { cloud?.title.orEmpty() },
                saved = row.saved || cloud?.saved == true,
            )
        }
        return merged.values.filter { !it.deleted || it.hasLocal }.sortedByDescending { it.updatedAt }
    }

    private fun epoch(value: String?): Long = value?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrDefault(0) } ?: 0
}
