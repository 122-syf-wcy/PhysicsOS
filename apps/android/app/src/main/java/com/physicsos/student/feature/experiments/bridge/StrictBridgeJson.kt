package com.physicsos.student.feature.experiments.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

internal object BridgeLimits {
    const val MESSAGE_BYTES = 12 * 1024 * 1024
    const val CHECKPOINT_BYTES = 8 * 1024 * 1024
    const val FILE_BYTES = 8 * 1024 * 1024
    const val DOCUMENT_BYTES = 2 * 1024 * 1024
    const val JSON_DEPTH = 64
    const val JSON_VALUES = 400_000
}

/** Codes are safe to display/log; rejected message bodies never leave the parser. */
internal class BridgeProtocolException(val code: String) : IllegalArgumentException(code)

/**
 * Bounds work before allocating the JSON tree. The scanner also rejects duplicate
 * keys (including escaped spellings), which a JsonObject would otherwise overwrite.
 */
internal object StrictBridgeJson {
    val json = Json {
        isLenient = false
        ignoreUnknownKeys = false
        coerceInputValues = false
        allowSpecialFloatingPointValues = false
    }

    fun parse(text: String, maxBytes: Int = BridgeLimits.MESSAGE_BYTES): JsonElement {
        utf8Size(text, maxBytes)
        Scanner(text).scan()
        return try {
            json.parseToJsonElement(text)
        } catch (_: IllegalArgumentException) {
            throw BridgeProtocolException("INVALID_JSON")
        }
    }

    fun utf8Size(text: String, maximum: Int): Int {
        if (text.length > maximum) fail("MESSAGE_TOO_LARGE")
        var bytes = 0
        var i = 0
        while (i < text.length) {
            val c = text[i++]
            bytes += when {
                c.code < 0x80 -> 1
                c.code < 0x800 -> 2
                c.isHighSurrogate() -> {
                    if (i >= text.length || !text[i++].isLowSurrogate()) fail("INVALID_UNICODE")
                    4
                }
                c.isLowSurrogate() -> fail("INVALID_UNICODE")
                else -> 3
            }
            if (bytes > maximum) fail("MESSAGE_TOO_LARGE")
        }
        return bytes
    }

    private class Scanner(private val text: String) {
        private var cursor = 0
        private var values = 0

        fun scan() {
            value(0)
            whitespace()
            if (cursor != text.length) fail("INVALID_JSON")
        }

        private fun value(depth: Int) {
            if (depth > BridgeLimits.JSON_DEPTH) fail("JSON_TOO_DEEP")
            if (++values > BridgeLimits.JSON_VALUES) fail("JSON_TOO_COMPLEX")
            whitespace()
            when (peek()) {
                '{' -> objectValue(depth)
                '[' -> arrayValue(depth)
                '"' -> string(false)
                't' -> literal("true")
                'f' -> literal("false")
                'n' -> literal("null")
                '-', in '0'..'9' -> number()
                else -> fail("INVALID_JSON")
            }
        }

        private fun objectValue(depth: Int) {
            cursor++
            whitespace()
            if (take('}')) return
            val keys = HashSet<String>()
            do {
                whitespace()
                if (peek() != '"') fail("INVALID_JSON")
                val key = string(true)
                if (!keys.add(key)) fail("DUPLICATE_JSON_KEY")
                whitespace()
                expect(':')
                value(depth + 1)
                whitespace()
                if (take('}')) return
                expect(',')
            } while (cursor < text.length)
            fail("INVALID_JSON")
        }

        private fun arrayValue(depth: Int) {
            cursor++
            whitespace()
            if (take(']')) return
            do {
                value(depth + 1)
                whitespace()
                if (take(']')) return
                expect(',')
            } while (cursor < text.length)
            fail("INVALID_JSON")
        }

        private fun string(keep: Boolean): String {
            expect('"')
            val result = if (keep) StringBuilder() else null
            while (cursor < text.length) {
                val c = text[cursor++]
                when {
                    c == '"' -> return result?.toString().orEmpty()
                    c == '\\' -> {
                        if (cursor == text.length) fail("INVALID_JSON")
                        when (val escaped = text[cursor++]) {
                            '"', '\\', '/' -> result?.append(escaped)
                            'b' -> result?.append('\b')
                            'f' -> result?.append('\u000C')
                            'n' -> result?.append('\n')
                            'r' -> result?.append('\r')
                            't' -> result?.append('\t')
                            'u' -> {
                                val first = unicodeEscape()
                                if (first.isLowSurrogate()) fail("INVALID_UNICODE")
                                result?.append(first)
                                if (first.isHighSurrogate()) {
                                    expect('\\')
                                    expect('u')
                                    val second = unicodeEscape()
                                    if (!second.isLowSurrogate()) fail("INVALID_UNICODE")
                                    result?.append(second)
                                }
                            }
                            else -> fail("INVALID_JSON")
                        }
                    }
                    c.code < 0x20 -> fail("INVALID_JSON")
                    else -> result?.append(c)
                }
            }
            fail("INVALID_JSON")
        }

        private fun unicodeEscape(): Char {
            if (cursor + 4 > text.length) fail("INVALID_JSON")
            var value = 0
            repeat(4) {
                val digit = text[cursor++].digitToIntOrNull(16) ?: fail("INVALID_JSON")
                value = (value shl 4) or digit
            }
            return value.toChar()
        }

        private fun number() {
            take('-')
            if (!take('0')) {
                if (peek() !in '1'..'9') fail("INVALID_JSON")
                while (peek() in '0'..'9') cursor++
            }
            if (take('.')) digits()
            if (take('e') || take('E')) {
                if (!take('+')) take('-')
                digits()
            }
        }

        private fun digits() {
            if (peek() !in '0'..'9') fail("INVALID_JSON")
            while (peek() in '0'..'9') cursor++
        }

        private fun literal(value: String) {
            if (!text.startsWith(value, cursor)) fail("INVALID_JSON")
            cursor += value.length
        }

        private fun whitespace() {
            while (peek() == ' ' || peek() == '\n' || peek() == '\r' || peek() == '\t') cursor++
        }

        private fun peek(): Char = text.getOrNull(cursor) ?: '\u0000'
        private fun take(c: Char): Boolean = if (peek() == c) { cursor++; true } else false
        private fun expect(c: Char) {
            if (!take(c)) fail("INVALID_JSON")
        }
    }

    private fun fail(code: String): Nothing = throw BridgeProtocolException(code)
}
