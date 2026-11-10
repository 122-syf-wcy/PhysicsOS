package com.physicsos.student.navigation

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

internal object Destinations {
    const val HOME = "home"
    const val EXPERIMENTS = "experiments"
    const val EXPERIMENT = "experiment?templateId={templateId}&sceneId={sceneId}"
    const val CHAT = "chat?sessionId={sessionId}&draftId={draftId}"
    const val RECORDS = "records"
    const val ACCOUNT = "account"
    const val AUTH = "auth"
    const val LIBRARY = "library"
    const val CLASSES = "classes?classId={classId}&assignmentId={assignmentId}"
    const val DOCUMENT = "document/{documentId}"
    const val POLICY = "policy/{policy}"

    fun experiment(templateId: String? = null, sceneId: String? = null): String =
        query("experiment", "templateId" to templateId, "sceneId" to sceneId)

    fun chat(sessionId: String? = null, draftId: String? = null): String =
        query("chat", "sessionId" to sessionId, "draftId" to draftId)

    fun classes(classId: String? = null, assignmentId: String? = null): String =
        query("classes", "classId" to classId, "assignmentId" to assignmentId)

    fun document(id: String): String = "document/${encode(id)}"
    fun policy(kind: String): String {
        require(kind == "privacy" || kind == "terms" || kind == "sdks")
        return "policy/$kind"
    }

    private fun query(base: String, vararg values: Pair<String, String?>): String {
        val parameters = values.mapNotNull { (key, value) ->
            value?.takeIf { it.isNotBlank() }?.let { "$key=${encode(it)}" }
        }
        return if (parameters.isEmpty()) base else "$base?${parameters.joinToString("&")}"
    }

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
}
