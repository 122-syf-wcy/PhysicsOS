package com.physicsos.student.feature.chat

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

internal data class SolveDocumentLabels(val knowns: String, val targets: String, val answers: String, val steps: String, val verification: String, val issues: String)

internal fun solveDocument(row: ChatRow.Scene, labels: SolveDocumentLabels): String = buildString {
    append("# ").append(row.title).append("\n\n")
    val solve = row.solve ?: return@buildString
    fun section(label: String, name: String, line: (JsonObject) -> String) {
        val entries = solve.array(name) ?: JsonArray(emptyList())
        if (entries.isEmpty()) return
        append("## ").append(label).append("\n\n")
        entries.forEach { item -> (item as? JsonObject)?.let { append("- ").append(line(it)).append('\n') } }
        append('\n')
    }
    section(labels.knowns, "knowns") { known ->
        listOfNotNull(known.string("label"), known.string("symbol"), known["value"]?.toString(), known.string("unit")).joinToString(" ")
    }
    solve.array("targets")?.takeIf { it.isNotEmpty() }?.let { targets ->
        append("## ").append(labels.targets).append("\n\n")
        targets.forEach { append("- ").append((it as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()).append('\n') }
        append('\n')
    }
    section(labels.answers, "answers") { answer -> listOfNotNull(answer.string("label"), answer.string("symbol"), answer.string("value"), answer.string("unit")).joinToString(" ") }
    val steps = solve.array("steps").orEmpty()
    if (steps.isNotEmpty()) {
        append("## ").append(labels.steps).append("\n\n")
        for (item in steps) {
            val step = item as? JsonObject ?: continue
            append("### ").append(step.string("title").orEmpty()).append("\n\n")
            listOf("description", "substitution", "result").forEach { field -> step.string(field)?.let { append(it).append("\n\n") } }
        }
    }
    solve.obj("verification")?.let { verification ->
        append("## ").append(labels.verification).append("\n\n")
        append(verification.string("status").orEmpty()).append("\n\n")
        verification.array("checks")?.forEach { item ->
            val check = item as? JsonObject ?: return@forEach
            append("- ").append(check.string("id").orEmpty()).append(": ")
            append(check.bool("passed").toString()).append(" ").append(check.string("message").orEmpty()).append('\n')
        }
    }
    section(labels.issues, "issues") { issue -> listOfNotNull(issue.string("code"), issue.string("message")).joinToString(": ") }
}
