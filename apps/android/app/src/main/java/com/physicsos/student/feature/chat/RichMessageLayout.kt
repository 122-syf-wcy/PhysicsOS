package com.physicsos.student.feature.chat

internal data class RichMessagePart(val index: Int, val markdown: String)
internal data class RichMessageLayout(val parts: List<RichMessagePart>, val abbreviated: Boolean)

/** Completed paragraphs retain stable identities as the final streamed paragraph grows. */
internal fun richMessageLayout(source: String, maximum: Int = 24_000): RichMessageLayout {
    val visible = source.take(maximum)
    val parts = mutableListOf<RichMessagePart>()
    val pending = StringBuilder()
    var fence: String? = null
    var displayMath = false
    for (line in visible.split('\n')) {
        val trimmed = line.trimStart()
        val marker = when {
            trimmed.startsWith("```") -> "```"
            trimmed.startsWith("~~~") -> "~~~"
            else -> null
        }
        if (marker != null) fence = if (fence == marker) null else fence ?: marker
        if (fence == null && (trimmed == "$$" || trimmed == "\\[" || trimmed == "\\]")) displayMath = !displayMath
        if (line.isBlank() && fence == null && !displayMath && parts.size < 63) {
            if (pending.isNotBlank()) { parts += RichMessagePart(parts.size, pending.toString().trimEnd()); pending.clear() }
        } else {
            if (pending.isNotEmpty()) pending.append('\n')
            pending.append(line)
        }
    }
    if (pending.isNotBlank()) parts += RichMessagePart(parts.size, pending.toString().trimEnd())
    return RichMessageLayout(parts, source.length > maximum)
}

/** Adapt common model delimiters to Markwon's native math syntax, without touching code fences. */
internal fun nativeMathMarkdown(source: String): String {
    // This local renderer accepts expressions, never file inclusion, macro programs, or external I/O.
    require(!Regex("\\\\(?:input|include|includegraphics|write|read|openin|openout|catcode|newcommand|renewcommand|def|loop|csname)\\b").containsMatchIn(source)) { "Unsupported native formula" }
    var depth = 0
    for (character in source) {
        if (character == '{') { depth++; require(depth <= 64) { "Native formula nesting limit" } }
        if (character == '}') depth = (depth - 1).coerceAtLeast(0)
    }
    val output = StringBuilder()
    var fence: String? = null
    for (line in source.split('\n')) {
        val trimmed = line.trimStart()
        val marker = when { trimmed.startsWith("```") -> "```"; trimmed.startsWith("~~~") -> "~~~"; else -> null }
        if (marker != null) {
            fence = if (fence == marker) null else fence ?: marker
            output.append(line).append('\n')
            continue
        }
        if (fence != null) { output.append(line).append('\n'); continue }
        val converted = line.replace("\\[", "$$").replace("\\]", "$$")
            .replace(Regex("\\\\\\(([\\s\\S]*?)\\\\\\)")) { "$$${it.groupValues[1]}$$" }
        var index = 0
        var inlineCode = false
        while (index < converted.length) {
            val char = converted[index]
            if (char == '`') inlineCode = !inlineCode
            if (char == '\\' && index + 1 < converted.length) {
                output.append(char).append(converted[index + 1]); index += 2; continue
            }
            if (!inlineCode && char == '$') {
                if (converted.getOrNull(index + 1) == '$') { output.append("$$"); index += 2; continue }
                val end = converted.indexOf('$', index + 1)
                if (end > index + 1) {
                    val expression = converted.substring(index + 1, end)
                    // Avoid interpreting ordinary currency prose as a mathematical expression.
                    if (expression == expression.trim() && !Regex("[A-Za-z]{3,}\\s+[A-Za-z]{3,}").containsMatchIn(expression)) {
                        output.append("$$").append(expression).append("$$"); index = end + 1; continue
                    }
                }
            }
            output.append(char); index++
        }
        output.append('\n')
    }
    val normalized = output.toString().trimEnd()
    for (formula in Regex("\\$\\$([\\s\\S]+?)\\$\\$").findAll(normalized)) {
        require(formula.groupValues[1].length <= 2_048) { "Native formula size limit" }
    }
    return normalized
}
