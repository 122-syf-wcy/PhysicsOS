package com.physicsos.student.feature.library

import com.physicsos.student.core.ExperimentInfo
import com.physicsos.student.feature.home.LearningContractException
import com.physicsos.student.feature.home.array
import com.physicsos.student.feature.home.asObject
import com.physicsos.student.feature.home.flag
import com.physicsos.student.feature.home.integer
import com.physicsos.student.feature.home.obj
import com.physicsos.student.feature.home.requiredText
import com.physicsos.student.feature.home.safeHttpsUrl
import com.physicsos.student.feature.home.strings
import com.physicsos.student.feature.home.text
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Suitable for the library route's optional initialKind argument. */
enum class LibraryKind { ALL, QUESTIONS, RESOURCES, COURSES, KNOWLEDGE, EXPERIMENTS, SOURCES, SAVED }
internal enum class LibraryOrigin { BUNDLED, VERIFIED }
internal data class LibraryOption(val id: String, val text: String)
internal data class LibrarySolution(val result: String, val steps: List<String>, val explanation: String?)
internal data class LibraryChapter(val id: String, val title: String, val topics: List<String>, val relatedIds: Set<String>)

internal data class LibraryEntry(
    val key: String,
    val id: String,
    val kind: LibraryKind,
    val origin: LibraryOrigin,
    val title: String,
    val description: String,
    val markdown: String,
    val stage: String?,
    val domain: String?,
    val source: String?,
    val offline: Boolean,
    val url: String?,
    val templateId: String?,
    val options: List<LibraryOption>,
    val solution: LibrarySolution?,
    val chapters: List<LibraryChapter>,
    val relatedIds: Set<String>,
    val raw: JsonObject,
) {
    val searchable: String = listOfNotNull(title, description, domain, stage, source, raw.text("chapter"))
        .joinToString(" ") + " " + raw.strings("knowledge").joinToString(" ")

    val document: String = buildString {
        append(markdown.ifBlank { description })
        if (options.isNotEmpty()) {
            append("\n\n")
            append(options.joinToString("\n\n") { "${it.id}. ${it.text}" })
        }
        val subQuestions = raw.array("subQuestions")
        if (subQuestions.isNotEmpty()) {
            append("\n\n")
            append(subQuestions.map { it.asObject() }.joinToString("\n\n") { "${it.text("no").orEmpty()} ${it.text("text").orEmpty()}" })
        }
    }

    fun bookmark(): JsonObject = buildJsonObject {
        put("origin", origin.name)
        put("kind", kind.name)
        put("entry", raw)
    }
}

internal data class LibraryFilter(
    val query: String = "",
    val kind: LibraryKind = LibraryKind.ALL,
    val stage: String? = null,
    val domain: String? = null,
    val verifiedOnly: Boolean = false,
)

internal object LibraryDecoders {
    fun bundled(payload: JsonObject, experiments: List<ExperimentInfo>): List<LibraryEntry> {
        if (payload.integer("version") != 1) throw LearningContractException()
        val collections = linkedMapOf(
            "courses" to LibraryKind.COURSES,
            "knowledge" to LibraryKind.KNOWLEDGE,
            "questions" to LibraryKind.QUESTIONS,
            "resources" to LibraryKind.RESOURCES,
            "sources" to LibraryKind.SOURCES,
        )
        val entries = collections.flatMap { (name, kind) ->
            val rows = payload[name] as? JsonArray ?: throw LearningContractException()
            rows.map { local(it.asObject(), kind) }
        }
        return (entries + experiments.map { experiment ->
            local(buildJsonObject {
                put("id", experiment.id)
                put("title", experiment.title)
                put("description", experiment.subtitle)
                put("markdown", experiment.subtitle)
                put("domain", experiment.domain)
                put("stage", experiment.stage)
                put("templateId", experiment.id)
                put("sourceRef", "physicsos-shared")
                put("access", "local")
                put("offline", true)
            }, LibraryKind.EXPERIMENTS)
        }).distinctBy { it.key }
    }

    fun local(row: JsonObject, kind: LibraryKind): LibraryEntry {
        val id = row.requiredText("id")
        val chapters = row.array("chapters").mapIndexedNotNull { index, element ->
            val chapter = element.asObject()
            val title = chapter.text("title") ?: chapter.text("chapter") ?: return@mapIndexedNotNull null
            LibraryChapter(
                chapter.text("id") ?: "$id-chapter-$index", title, chapter.strings("topics"),
                (chapter.strings("questionIds") + chapter.strings("resourceIds")).toSet(),
            )
        }
        return LibraryEntry(
            key = "bundled:${kind.name}:$id", id = id, kind = kind, origin = LibraryOrigin.BUNDLED,
            title = row.requiredText("title"), description = row.text("description").orEmpty(),
            markdown = row.text("markdown") ?: row.text("text").orEmpty(),
            stage = row.text("stage"), domain = row.text("domain"), source = row.text("sourceRef"),
            offline = row.flag("offline") == true && row.text("access") == "local",
            url = safeHttpsUrl(row.text("url")), templateId = row.text("templateId"),
            options = options(row), solution = solution(row), chapters = chapters,
            relatedIds = (row.strings("questionIds") + row.strings("knowledgeIds")).toSet(), raw = row,
        )
    }

    fun verified(row: JsonObject, kind: LibraryKind): LibraryEntry {
        if (row.text("status") != "verified") throw LearningContractException()
        val id = row.requiredText("id")
        val source = kind == LibraryKind.SOURCES
        val stem = row.text("stem").orEmpty()
        val title = if (source) row.requiredText("examName") else row.text("title") ?: stem.take(96).ifBlank { id }
        return LibraryEntry(
            key = "verified:${kind.name}:$id", id = id, kind = kind, origin = LibraryOrigin.VERIFIED,
            title = title,
            description = if (source) listOfNotNull(row.text("year"), row.text("region"), row.text("school")).joinToString(" · ") else stem,
            markdown = stem, stage = when (row.text("level")) { "zhongkao" -> "junior"; "gaokao" -> "senior"; else -> null },
            domain = row.text("subject"), source = row.text("sourceRef") ?: row.text("answerTier") ?: row.text("answerSource"),
            offline = !source && stem.isNotBlank(), url = safeHttpsUrl(row.text("sourceRef")), templateId = null,
            options = options(row), solution = solution(row), chapters = emptyList(), relatedIds = emptySet(), raw = row,
        )
    }

    fun annotation(row: JsonObject): LibraryEntry {
        if (row.text("status") != "verified") throw LearningContractException()
        val id = row.requiredText("id")
        return LibraryEntry(
            key = "annotation:$id", id = id, kind = LibraryKind.QUESTIONS, origin = LibraryOrigin.VERIFIED,
            title = row.text("questionNo") ?: id, description = row.text("stem").orEmpty(), markdown = row.text("stem").orEmpty(),
            stage = null, domain = row.text("subject"), source = row.text("sourcePaperId"), offline = row.text("stem") != null,
            url = null, templateId = null, options = emptyList(), solution = null, chapters = emptyList(), relatedIds = emptySet(), raw = row,
        )
    }

    fun bookmark(payload: JsonObject): LibraryEntry {
        val kind = runCatching { LibraryKind.valueOf(payload.requiredText("kind")) }.getOrElse { throw LearningContractException() }
        val row = payload.obj("entry") ?: throw LearningContractException()
        return when (payload.text("origin")) {
            LibraryOrigin.BUNDLED.name -> local(row, kind)
            LibraryOrigin.VERIFIED.name -> if (row.text("sourcePaperId") != null) annotation(row) else verified(row, kind)
            else -> throw LearningContractException()
        }
    }

    fun filter(rows: List<LibraryEntry>, filter: LibraryFilter, saved: Set<String>): List<LibraryEntry> {
        val query = filter.query.trim()
        return rows.filter {
            (filter.kind == LibraryKind.ALL || it.kind == filter.kind || filter.kind == LibraryKind.SAVED && it.key in saved) &&
                (filter.stage == null || it.stage == filter.stage) &&
                (filter.domain == null || it.domain == filter.domain) &&
                (!filter.verifiedOnly || it.origin == LibraryOrigin.VERIFIED) &&
                (query.isEmpty() || it.searchable.contains(query, ignoreCase = true))
        }
    }

    private fun options(row: JsonObject): List<LibraryOption> = row.array("options").mapIndexed { index, value ->
        when (value) {
            is JsonPrimitive -> LibraryOption(('A'.code + index).toChar().toString(), value.content)
            is JsonObject -> LibraryOption(value.text("id") ?: ('A'.code + index).toChar().toString(), value.requiredText("text"))
            else -> throw LearningContractException()
        }
    }

    private fun solution(row: JsonObject): LibrarySolution? = when (val answer = row["answer"]) {
        is JsonPrimitive -> answer.content.takeIf { it.isNotBlank() && it != "null" }?.let { LibrarySolution(it, emptyList(), row.text("explanation")) }
        is JsonObject -> LibrarySolution(answer.text("result").orEmpty(), answer.strings("steps"), row.text("explanation"))
        else -> null
    }
}
