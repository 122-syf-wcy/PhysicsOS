package com.physicsos.student.feature.classes

import com.physicsos.student.feature.home.LearningContractException
import com.physicsos.student.feature.home.array
import com.physicsos.student.feature.home.asObject
import com.physicsos.student.feature.home.flag
import com.physicsos.student.feature.home.integer
import com.physicsos.student.feature.home.itemOrNull
import com.physicsos.student.feature.home.long
import com.physicsos.student.feature.home.number
import com.physicsos.student.feature.home.obj
import com.physicsos.student.feature.home.requiredText
import com.physicsos.student.feature.home.safeHttpsUrl
import com.physicsos.student.feature.home.strings
import com.physicsos.student.feature.home.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal data class Classroom(val id: String, val name: String, val description: String?)
internal data class ClassAssignment(
    val id: String,
    val classId: String,
    val title: String,
    val instructions: String?,
    val dueAt: String,
    val targetKind: String,
    val targetId: String,
)
internal data class PaperQuestion(
    val key: String,
    val number: Int,
    val section: String,
    val kind: String,
    val score: Double?,
    val stem: String,
    val options: List<String>,
    val subQuestions: List<String>,
    val figureCaption: String?,
    val figureUrl: String?,
    val solution: String?,
) {
    val markdown: String = buildString {
        append(stem)
        if (options.isNotEmpty()) append("\n\n" + options.mapIndexed { index, text -> "${('A'.code + index).toChar()}. $text" }.joinToString("\n\n"))
        if (subQuestions.isNotEmpty()) append("\n\n" + subQuestions.joinToString("\n\n"))
        if (figureUrl != null) append("\n\n![${figureCaption.orEmpty()}]($figureUrl)")
        else if (figureCaption != null) append("\n\n$figureCaption")
    }
}

internal data class AssignmentTarget(
    val assignment: ClassAssignment,
    val paperTitle: String?,
    val questions: List<PaperQuestion>,
    val experimentId: String?,
    val experimentScene: JsonObject?,
    val answersReleased: Boolean,
    val answerPolicy: String?,
) {
    val paperMarkdown: String = questions.joinToString("\n\n") { "## ${it.number}\n\n${it.markdown}" }
}

internal data class SubmissionReceipt(
    val revision: Long,
    val content: String,
    val submittedAt: String,
    val dueAt: String?,
    val late: Boolean,
    val status: String,
    val reviewComment: String?,
    val score: Double?,
    val reviewedAt: String?,
)

internal data class AssignmentDraft(
    val answers: Map<String, String> = emptyMap(),
    val notes: String = "",
    val freeform: Boolean = false,
    val baseRevision: Long = 0,
    val operationKey: String? = null,
    val queuedContent: String? = null,
    val lastSubmittedContent: String? = null,
) {
    fun payload(): JsonObject = buildJsonObject {
        put("answers", buildJsonObject { answers.forEach { (key, value) -> put(key, value) } })
        put("notes", notes)
        put("freeform", freeform)
        put("baseRevision", baseRevision)
        operationKey?.let { put("operationKey", it) }
        queuedContent?.let { put("queuedContent", it) }
        lastSubmittedContent?.let { put("lastSubmittedContent", it) }
    }

    fun content(questions: List<PaperQuestion>): String = if (freeform) notes.trim() else buildList {
        questions.forEach { question ->
            answers[question.key]?.trim()?.takeIf(String::isNotEmpty)?.let { add("${question.number}. $it") }
        }
        notes.trim().takeIf(String::isNotEmpty)?.let(::add)
    }.joinToString("\n\n")

    companion object {
        fun from(payload: JsonObject): AssignmentDraft = AssignmentDraft(
            answers = payload.obj("answers")?.mapValues { (_, value) -> (value as? JsonPrimitive)?.content.orEmpty() }.orEmpty(),
            notes = payload.text("notes").orEmpty(), freeform = payload.flag("freeform") == true,
            baseRevision = payload.long("baseRevision") ?: 0,
            operationKey = payload.text("operationKey"), queuedContent = payload.text("queuedContent"),
            lastSubmittedContent = payload.text("lastSubmittedContent"),
        )
    }
}

internal object ClassDecoders {
    fun classroom(row: JsonObject) = Classroom(row.requiredText("id"), row.requiredText("name"), row.text("description"))

    fun assignment(row: JsonObject): ClassAssignment {
        val target = row.obj("target") ?: throw LearningContractException()
        val kind = target.requiredText("kind")
        if (kind !in setOf("paper", "experiment")) throw LearningContractException()
        return ClassAssignment(row.requiredText("id"), row.requiredText("classId"), row.requiredText("title"), row.text("instructions"), row.requiredText("dueAt"), kind, target.requiredText("id"))
    }

    fun target(payload: JsonObject): AssignmentTarget {
        val assignment = assignment(payload.obj("assignment") ?: throw LearningContractException())
        val policy = payload.obj("answerPolicy")
        val released = policy?.flag("released") == true
        return when (payload.requiredText("kind")) {
            "paper" -> {
                val paper = payload.obj("paper") ?: throw LearningContractException()
                val questions = paper.array("sections").flatMapIndexed { sectionIndex, sectionElement ->
                    val section = sectionElement.asObject()
                    section.array("items").map { element ->
                        val question = element.asObject()
                        val number = question.integer("number") ?: throw LearningContractException()
                        val answer = if (released) question.obj("answer") else null
                        val solution = answer?.let { listOfNotNull(it.text("result"), it.strings("steps").joinToString("\n\n").takeIf(String::isNotBlank)).joinToString("\n\n") }
                        val figure = question.obj("figure")
                        PaperQuestion(
                            key = "$sectionIndex:$number", number = number, section = section.text("title").orEmpty(),
                            kind = question.requiredText("kind"), score = question.number("score"), stem = question.requiredText("stem"),
                            options = question.strings("options"),
                            subQuestions = question.array("subQuestions").map { sub -> sub.asObject().let { "${it.text("no").orEmpty()} ${it.requiredText("text")}" } },
                            figureCaption = figure?.text("caption"), figureUrl = safeHttpsUrl(figure?.text("ref")), solution = solution,
                        )
                    }
                }
                if (questions.map { it.key }.distinct().size != questions.size) throw LearningContractException()
                AssignmentTarget(assignment, paper.requiredText("title"), questions, null, null, released, policy?.text("mode"))
            }
            "experiment" -> {
                val experiment = payload.obj("experiment") ?: throw LearningContractException()
                AssignmentTarget(assignment, null, emptyList(), experiment.requiredText("id"), experiment.obj("scene") ?: throw LearningContractException(), false, null)
            }
            else -> throw LearningContractException()
        }
    }

    fun receipt(payload: JsonObject): SubmissionReceipt? {
        val receipt = payload.itemOrNull("receipt") ?: return null
        val item = payload.itemOrNull() ?: throw LearningContractException()
        val review = receipt.obj("review") ?: item.obj("review")
        return SubmissionReceipt(
            revision = receipt.long("revision") ?: item.long("revision") ?: throw LearningContractException(),
            content = item.requiredText("content"), submittedAt = receipt.requiredText("submittedAt"),
            dueAt = receipt.text("dueAt"), late = receipt.flag("late") == true, status = receipt.requiredText("status"),
            reviewComment = review?.text("comment"), score = review?.number("score"), reviewedAt = review?.text("reviewedAt"),
        )
    }

    fun submissionBody(content: String, baseRevision: Long): JsonObject {
        require(content.isNotBlank() && content.length <= 16_000)
        require(baseRevision >= 0)
        return buildJsonObject { put("content", content); put("baseRevision", baseRevision) }
    }
}
