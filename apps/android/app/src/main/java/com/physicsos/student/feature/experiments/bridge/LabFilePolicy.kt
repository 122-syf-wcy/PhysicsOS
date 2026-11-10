package com.physicsos.student.feature.experiments.bridge

import java.io.File
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import java.util.Base64
import java.util.Locale

internal data class ValidatedLabFile(val name: String, val mime: String, val bytes: ByteArray)

internal object LabFilePolicy {
    private val safeName = Regex("[\\p{L}\\p{N}\\p{M} _().\\p{Pd}]+")
    private val pngSignature = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

    fun validate(message: LabIncoming.Export, requested: LabExportFormat): ValidatedLabFile {
        if (message.mime != requested.mime) invalid("UNEXPECTED_EXPORT_MIME")
        val name = fileName(message.name, requested.extension)
        val bytes = when (message.encoding) {
            "utf8" -> {
                if (requested == LabExportFormat.PNG) invalid("INVALID_FILE_ENCODING")
                StrictBridgeJson.utf8Size(message.content, BridgeLimits.FILE_BYTES)
                message.content.toByteArray(StandardCharsets.UTF_8)
            }
            "base64" -> {
                val maximumEncoded = ((BridgeLimits.FILE_BYTES + 2) / 3) * 4
                if (message.content.length > maximumEncoded) invalid("FILE_TOO_LARGE")
                validateBase64(message.content)
                val decoded = try { Base64.getDecoder().decode(message.content) } catch (_: IllegalArgumentException) {
                    invalid("INVALID_BASE64")
                }
                if (decoded.size > BridgeLimits.FILE_BYTES) invalid("FILE_TOO_LARGE")
                if (Base64.getEncoder().encodeToString(decoded) != message.content) invalid("INVALID_BASE64")
                decoded
            }
            else -> invalid("INVALID_FILE_ENCODING")
        }
        if (bytes.isEmpty()) invalid("EMPTY_EXPORT")
        if (requested == LabExportFormat.PNG) {
            validatePng(bytes)
        } else {
            // A decoder that replaces malformed bytes would disguise a MIME/encoding mismatch.
            val text = try { StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString() }
            catch (_: java.nio.charset.CharacterCodingException) { invalid("INVALID_UTF8") }
            if ('\u0000' in text) invalid("INVALID_TEXT_FILE")
            if (requested == LabExportFormat.JSON || requested == LabExportFormat.METRICS) StrictBridgeJson.parse(text, BridgeLimits.FILE_BYTES)
            if (requested == LabExportFormat.SVG) validateSvg(text)
        }
        return ValidatedLabFile(name, message.mime, bytes)
    }

    fun markdown(name: String, content: String): ValidatedLabFile {
        StrictBridgeJson.utf8Size(content, BridgeLimits.DOCUMENT_BYTES)
        return ValidatedLabFile(fileName(name, "md"), "text/markdown", content.toByteArray(StandardCharsets.UTF_8))
    }

    fun fileName(value: String, extension: String): String {
        val name = Normalizer.normalize(value, Normalizer.Form.NFC)
        if (name.isBlank() || name.length > 160 || name.startsWith('.') || name.endsWith(' ') ||
            name != name.trim() || !safeName.matches(name) || name.contains("..") ||
            !name.lowercase(Locale.ROOT).endsWith(".$extension")
        ) invalid("INVALID_EXPORT_NAME")
        StrictBridgeJson.utf8Size(name, 240)
        return name
    }

    fun child(root: File, relative: String): File {
        if (relative.isEmpty() || relative.startsWith('/') || '\\' in relative || ':' in relative || '%' in relative ||
            relative.split('/').any { it.isEmpty() || it == "." || it == ".." || it.any(Char::isISOControl) }
        ) invalid("INVALID_FILE_PATH")
        val canonicalRoot = root.canonicalFile
        val target = File(canonicalRoot, relative).canonicalFile
        if (target == canonicalRoot || !target.toPath().startsWith(canonicalRoot.toPath())) invalid("INVALID_FILE_PATH")
        return target
    }

    private fun validateBase64(value: String) {
        if (value.length % 4 != 0) invalid("INVALID_BASE64")
        val padding = value.takeLast(2).count { it == '=' }
        val end = value.length - padding
        for (index in value.indices) {
            val c = value[index]
            if (index >= end) {
                if (c != '=') invalid("INVALID_BASE64")
            } else if (c !in 'A'..'Z' && c !in 'a'..'z' && c !in '0'..'9' && c != '+' && c != '/') {
                invalid("INVALID_BASE64")
            }
        }
    }

    private fun validatePng(bytes: ByteArray) {
        if (bytes.size < 33 || !bytes.copyOfRange(0, 8).contentEquals(pngSignature) ||
            bytes.copyOfRange(12, 16).toString(StandardCharsets.US_ASCII) != "IHDR"
        ) invalid("INVALID_PNG")
        val dimensions = java.nio.ByteBuffer.wrap(bytes, 16, 8)
        val width = dimensions.int.toLong()
        val height = dimensions.int.toLong()
        if (width !in 1..32_768L || height !in 1..32_768L || width * height > 100_000_000) invalid("IMAGE_TOO_LARGE")
    }

    private fun validateSvg(text: String) {
        // No DTD reaches an XML parser. This also covers parsers on older Android
        // releases that do not implement the optional JAXP hardening features.
        if (Regex("<!\\s*(?:DOCTYPE|ENTITY)", RegexOption.IGNORE_CASE).containsMatchIn(text)) invalid("ACTIVE_SVG_NOT_ALLOWED")
        val document = try {
            val factory = javax.xml.parsers.DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = true
                isValidating = false
                isExpandEntityReferences = false
            }
            factory.newDocumentBuilder().apply {
                setEntityResolver { _, _ -> throw org.xml.sax.SAXException("External entities are disabled") }
                setErrorHandler(object : org.xml.sax.helpers.DefaultHandler() {
                    override fun error(e: org.xml.sax.SAXParseException) { throw e }
                    override fun fatalError(e: org.xml.sax.SAXParseException) { throw e }
                })
            }.parse(org.xml.sax.InputSource(java.io.StringReader(text)))
        } catch (_: Exception) { invalid("INVALID_SVG") }
        val allowed = setOf(
            "svg", "g", "defs", "symbol", "use", "path", "line", "polyline", "polygon", "circle", "ellipse", "rect",
            "text", "tspan", "title", "desc", "image", "linearGradient", "radialGradient", "stop", "clipPath", "mask",
            "pattern", "filter", "feGaussianBlur", "feOffset", "feFlood", "feColorMatrix", "feBlend", "feComposite", "feDropShadow",
        )
        if (document.documentElement.localName != "svg") invalid("INVALID_SVG")
        var embeddedBytes = 0L
        var nodes = 0
        val pending = ArrayDeque<Pair<org.w3c.dom.Node, Int>>()
        pending.add(document to 0)
        while (pending.isNotEmpty()) {
            val (node, depth) = pending.removeLast()
            if (++nodes > 100_000 || depth > 64) invalid("SVG_TOO_COMPLEX")
            if (node.nodeType == org.w3c.dom.Node.PROCESSING_INSTRUCTION_NODE ||
                node.nodeType == org.w3c.dom.Node.DOCUMENT_TYPE_NODE ||
                node.nodeType == org.w3c.dom.Node.ENTITY_REFERENCE_NODE
            ) invalid("ACTIVE_SVG_NOT_ALLOWED")
            if (node is org.w3c.dom.Element) {
                if (node.localName !in allowed || node.namespaceURI != "http://www.w3.org/2000/svg") invalid("ACTIVE_SVG_NOT_ALLOWED")
                for (i in 0 until node.attributes.length) {
                    val attribute = node.attributes.item(i)
                    val name = (attribute.localName ?: attribute.nodeName).lowercase(Locale.ROOT)
                    val value = attribute.nodeValue
                    if (name.startsWith("on") || name == "src" || attribute.nodeName == "xml:base" ||
                        value.contains("javascript:", true) || value.contains("@import", true)
                    ) invalid("ACTIVE_SVG_NOT_ALLOWED")
                    if (name == "href" && !value.startsWith('#')) {
                        val prefix = "data:image/png;base64,"
                        if (node.localName != "image" || !value.startsWith(prefix)) invalid("ACTIVE_SVG_NOT_ALLOWED")
                        val encoded = value.substring(prefix.length)
                        validateBase64(encoded)
                        val image = try { Base64.getDecoder().decode(encoded) } catch (_: IllegalArgumentException) { invalid("INVALID_BASE64") }
                        if (Base64.getEncoder().encodeToString(image) != encoded) invalid("INVALID_BASE64")
                        embeddedBytes += image.size
                        if (embeddedBytes > BridgeLimits.FILE_BYTES) invalid("FILE_TOO_LARGE")
                        validatePng(image)
                    }
                    Regex("url\\(([^)]*)\\)", RegexOption.IGNORE_CASE).findAll(value).forEach { reference ->
                        if (!reference.groupValues[1].trim().trim('\'', '"').startsWith('#')) invalid("ACTIVE_SVG_NOT_ALLOWED")
                    }
                }
            }
            val children = node.childNodes
            for (i in 0 until children.length) pending.add(children.item(i) to depth + 1)
        }
    }
}
