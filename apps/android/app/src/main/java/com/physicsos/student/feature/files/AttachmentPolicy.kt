package com.physicsos.student.feature.files

import java.io.File
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Locale
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

internal const val MEBIBYTE = 1024L * 1024L

/** Explicit mobile resource budgets; the Host's verbatim file store does not impose this limit. */
internal object AttachmentPolicy {
    const val MAX_IMPORT_BYTES = 20 * MEBIBYTE
    const val MAX_DOWNLOAD_BYTES = 50 * MEBIBYTE
    const val MAX_IMAGE_BYTES = 4 * MEBIBYTE
    const val MAX_MESSAGE_IMAGE_BYTES = 12 * MEBIBYTE
    const val MAX_IMAGES = 6
    const val MAX_ATTACHMENTS = 10
    const val MAX_DECODE_DIMENSION = 2560
    const val MAX_DECODE_PIXELS = 8_000_000L
    const val MAX_NAME_BYTES = 180
    val pickerMimeTypes = arrayOf("application/pdf", "image/*", "text/*", "application/*")

    fun limits(projection: JsonObject?): IntakeLimits {
        fun capped(key: String, cap: Long): Long = (projection?.get(key) as? JsonPrimitive)?.longOrNull
            ?.takeIf { it > 0 }?.coerceAtMost(cap) ?: cap
        return IntakeLimits(
            maxImageBytes = capped("maxImageBytes", MAX_IMAGE_BYTES),
            maxMessageImageBytes = capped("maxMessageImageBytes", MAX_MESSAGE_IMAGE_BYTES),
            maxImages = capped("maxImagesPerMessage", MAX_IMAGES.toLong()).toInt(),
            maxDimension = capped("maxImageDimension", MAX_DECODE_DIMENSION.toLong()).toInt(),
            maxPixels = capped("maxImagePixels", MAX_DECODE_PIXELS),
        )
    }

    fun enforceSize(bytes: Long, maxBytes: Long = MAX_IMPORT_BYTES) {
        if (bytes <= 0) throw FileOperationException(FileProblem.EMPTY)
        if (bytes > maxBytes) throw FileOperationException(FileProblem.TOO_LARGE)
    }

    /** Never use a display name as a local path or as a FileProvider-relative path. */
    fun safeName(raw: String?, fallback: String = "attachment"): String {
        val leaf = (raw ?: fallback).replace('\\', '/').substringAfterLast('/')
        val clean = leaf.filterNot {
            it.code < 32 || it.code == 127 || it in ":*?\"<>|" || it in '‪'..'‮' || it in '⁦'..'⁩'
        }.trim().trim('.')
        if (clean.isBlank()) return fallback
        val result = StringBuilder()
        var bytes = 0
        for (codePoint in clean.codePoints().toArray()) {
            val part = String(Character.toChars(codePoint))
            val size = part.toByteArray(Charsets.UTF_8).size
            if (bytes + size > MAX_NAME_BYTES) break
            result.append(part)
            bytes += size
        }
        return result.toString().ifBlank { fallback }
    }

    fun inspect(prefix: ByteArray, declaredMime: String?, name: String): FileType {
        val declared = declaredMime?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
        val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        fun starts(vararg bytes: Int) = prefix.size >= bytes.size && bytes.indices.all { (prefix[it].toInt() and 255) == bytes[it] }
        val detected = when {
            starts(0xff, 0xd8, 0xff) -> FileType(AttachmentKind.IMAGE, "image/jpeg", "jpg")
            starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) -> FileType(AttachmentKind.IMAGE, "image/png", "png")
            prefix.size >= 12 && prefix.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
                prefix.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP" -> FileType(AttachmentKind.IMAGE, "image/webp", "webp")
            starts(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || starts(0x47, 0x49, 0x46, 0x38, 0x39, 0x61) ->
                FileType(AttachmentKind.IMAGE, "image/gif", "gif")
            starts(0x25, 0x50, 0x44, 0x46, 0x2d) -> FileType(AttachmentKind.PDF, "application/pdf", "pdf")
            else -> null
        }
        if (detected != null) {
            if (declared?.startsWith("image/") == true && detected.kind != AttachmentKind.IMAGE) {
                throw FileOperationException(FileProblem.MIME_MISMATCH)
            }
            if ((declared == "application/pdf" || extension == "pdf") && detected.kind != AttachmentKind.PDF) {
                throw FileOperationException(FileProblem.MIME_MISMATCH)
            }
            return detected
        }
        if (declared?.startsWith("image/") == true || declared == "application/pdf" ||
            extension in setOf("jpg", "jpeg", "png", "gif", "webp", "pdf")
        ) throw FileOperationException(FileProblem.UNSUPPORTED_IMAGE)
        // Arbitrary verbatim files are legal receipts, but active content is never previewed as HTML/SVG or executed.
        val textMime = when (extension) {
            "txt", "tex" -> "text/plain"
            "md", "markdown" -> "text/markdown"
            "csv" -> "text/csv"
            "json" -> "application/json"
            else -> null
        }
        if (textMime != null && isText(prefix)) return FileType(AttachmentKind.FILE, textMime, extension)
        return FileType(AttachmentKind.FILE, "application/octet-stream", extension.ifBlank { "bin" })
    }

    fun privateFile(directory: File, leaf: String): File {
        if (leaf.isBlank() || leaf != File(leaf).name || leaf.contains('\\') || leaf in setOf(".", "..")) {
            throw FileOperationException(FileProblem.UNSAFE_PATH)
        }
        val root = directory.canonicalFile
        val result = File(root, leaf).canonicalFile
        if (result.parentFile != root) throw FileOperationException(FileProblem.UNSAFE_PATH)
        return result
    }

    /** Only the approved own-session attachment route is accepted by this module. */
    fun attachmentDownloadPath(sessionId: String, attachmentId: String): String {
        return "/physicsos/mobile/v1/sessions/${segment(sessionId)}/attachments/${segment(attachmentId)}"
    }

    fun validateDownloadPath(path: String, origin: String): String {
        val base = URI(origin)
        val uri = URI(path)
        if (uri.rawFragment != null || uri.rawQuery != null || uri.rawUserInfo != null || path.contains('\\')) {
            throw FileOperationException(FileProblem.UNSAFE_PATH)
        }
        if (uri.isAbsolute && (uri.scheme != "https" || uri.host != base.host || uri.port != base.port)) {
            throw FileOperationException(FileProblem.UNSAFE_PATH)
        }
        if (!uri.isAbsolute && uri.rawAuthority != null) throw FileOperationException(FileProblem.UNSAFE_PATH)
        val raw = uri.rawPath ?: throw FileOperationException(FileProblem.UNSAFE_PATH)
        val parts = raw.split('/')
        if (parts.size != 8 || parts.take(5) != listOf("", "physicsos", "mobile", "v1", "sessions") ||
            parts[6] != "attachments" || parts[5].isEmpty() || parts[7].isEmpty() ||
            parts[5].contains('%') || parts[7].contains('%')
        ) throw FileOperationException(FileProblem.UNSAFE_PATH)
        segment(parts[5]); segment(parts[7])
        return raw
    }

    fun ownerDirectoryName(owner: String): String = sha256(owner.toByteArray(Charsets.UTF_8))

    private fun segment(value: String): String {
        if (!value.matches(Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,511}")) || value == "." || value == "..") {
            throw FileOperationException(FileProblem.UNSAFE_PATH)
        }
        return value
    }

    private fun isText(bytes: ByteArray): Boolean {
        if (bytes.any { it == 0.toByte() }) return false
        return try {
            // A metadata probe can end in the middle of a UTF-8 code point; ignore only that final partial code point.
            val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            val input = ByteBuffer.wrap(bytes)
            val output = java.nio.CharBuffer.allocate(bytes.size)
            !decoder.decode(input, output, false).isError
        } catch (_: IllegalArgumentException) { false }
    }
}

internal data class IntakeLimits(
    val maxImageBytes: Long = AttachmentPolicy.MAX_IMAGE_BYTES,
    val maxMessageImageBytes: Long = AttachmentPolicy.MAX_MESSAGE_IMAGE_BYTES,
    val maxImages: Int = AttachmentPolicy.MAX_IMAGES,
    val maxDimension: Int = AttachmentPolicy.MAX_DECODE_DIMENSION,
    val maxPixels: Long = AttachmentPolicy.MAX_DECODE_PIXELS,
)
internal data class FileType(val kind: AttachmentKind, val mime: String, val extension: String)

@Serializable
internal enum class AttachmentKind { IMAGE, PDF, FILE }
@Serializable
internal enum class UploadStatus { LOCAL, UPLOADING, UPLOADED, PAUSED, FAILED }
@Serializable
internal data class CropArea(val left: Float = 0f, val top: Float = 0f, val right: Float = 1f, val bottom: Float = 1f) {
    fun valid(): Boolean = listOf(left, top, right, bottom).all { it.isFinite() } &&
        left >= 0f && top >= 0f && right <= 1f && bottom <= 1f && right - left >= 0.02f && bottom - top >= 0.02f
}

@Serializable
internal data class PreparedAttachment(
    val id: String,
    val name: String,
    val kind: AttachmentKind,
    val mime: String,
    val localName: String,
    val originalName: String,
    val bytes: Long,
    val sha256: String,
    val width: Int? = null,
    val height: Int? = null,
    val pageCount: Int? = null,
    val crop: CropArea = CropArea(),
    val quarterTurns: Int = 0,
    val flattenedAnimation: Boolean = false,
    val upload: UploadStatus = UploadStatus.LOCAL,
    val receiptId: String? = null,
    val receiptSessionId: String? = null,
    val remoteAttachmentId: String? = null,
)

internal enum class FileProblem {
    TOO_LARGE, EMPTY, MIME_MISMATCH, UNSUPPORTED_IMAGE, UNREADABLE, PDF_UNREADABLE,
    NO_SPACE, UNSAFE_PATH, MISSING, TOO_MANY, MESSAGE_TOO_LARGE, CANCELLED, RECEIPT_INVALID, INTEGRITY,
}
internal class FileOperationException(val problem: FileProblem) : Exception(problem.name)
internal fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
    .joinToString("") { "%02x".format(it) }
