package com.physicsos.student.feature.document

import android.content.Context
import android.graphics.BitmapFactory
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.MobileClient
import com.physicsos.student.core.wireJson
import com.physicsos.student.feature.experiments.ExperimentAccount
import com.physicsos.student.feature.experiments.experimentAccount
import com.physicsos.student.feature.experiments.bridge.LabUrlPolicy
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.CRC32
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

private const val FIGURE_BYTES = 4 * 1024 * 1024
private const val FIGURE_CACHE_BYTES = 64L * 1024 * 1024
private val digestPattern = Regex("[a-f0-9]{64}")
private val figurePath = Regex("/physicsos/mobile/v1/classes/[A-Za-z0-9._-]{1,128}/assignments/[A-Za-z0-9._-]{1,128}/target/figures/(?:[A-Za-z0-9._-]|%3[Aa]){1,128}")
private val imageMarkdown = Regex("""!\[(?:\\.|[^\]\\\r\n])*\]\((/physicsos/mobile/v1/classes/[^\s)]+)\)""")

/** Only the actual first-party assignment figure endpoint, never a general authenticated URL. */
internal fun assignmentFigurePath(value: String?): String? = value?.takeIf(figurePath::matches)
private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
private fun figureFailure() = ApiException(0, "invalid_document_figure", "The assignment figure is not a valid bounded PNG.")

/** Bound dimensions and validate PNG chunk lengths/CRCs before any Android bitmap allocation. */
internal fun validateFigurePng(bytes: ByteArray) {
    val signature = byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10)
    if (bytes.size !in 45..FIGURE_BYTES || !bytes.copyOfRange(0, 8).contentEquals(signature)) throw figureFailure()
    var offset = 8
    var chunks = 0
    var data = false
    while (offset < bytes.size) {
        if (++chunks > 4096 || bytes.size - offset < 12) throw figureFailure()
        val length = ByteBuffer.wrap(bytes, offset, 4).int
        if (length < 0 || length > bytes.size - offset - 12) throw figureFailure()
        val kind = bytes.copyOfRange(offset + 4, offset + 8).toString(Charsets.US_ASCII)
        val crc = CRC32().apply { update(bytes, offset + 4, length + 4) }.value
        val expected = ByteBuffer.wrap(bytes, offset + 8 + length, 4).int.toLong() and 0xffffffffL
        if (crc != expected) throw figureFailure()
        if (chunks == 1) {
            if (kind != "IHDR" || length != 13) throw figureFailure()
            val width = ByteBuffer.wrap(bytes, offset + 8, 4).int
            val height = ByteBuffer.wrap(bytes, offset + 12, 4).int
            if (width !in 1..4096 || height !in 1..4096 || width.toLong() * height > 16_000_000) throw figureFailure()
        } else if (kind == "IHDR") throw figureFailure()
        if (kind == "IDAT") data = true
        offset += length + 12
        if (kind == "IEND") {
            if (length != 0 || !data || offset != bytes.size) throw figureFailure()
            return
        }
    }
    throw figureFailure()
}

private fun decodablePng(bytes: ByteArray): Boolean {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    if (options.outMimeType != "image/png" || options.outWidth <= 0 || options.outHeight <= 0) return false
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return false
    bitmap.recycle()
    return true
}

/** Native-owned immutable PNG cache. Neither the renderer nor markdown receives a bearer credential. */
internal class DocumentFigureAssets(
    private val root: File,
    private val account: ExperimentAccount,
    private val api: MobileClient,
    private val currentAccount: () -> ExperimentAccount?,
    private val decode: (ByteArray) -> Boolean = ::decodablePng,
) : WebViewAssetLoader.PathHandler {
    val pathPrefix = "/assets/lab/private-figures/${sha256("${account.owner}\u0000${account.userId}".toByteArray())}/"

    suspend fun prepare(markdown: String): String = withContext(Dispatchers.IO) {
        requireAccount()
        val matches = imageMarkdown.findAll(markdown).toList()
        val paths = matches.map { it.groupValues[1] }.distinct()
        if (paths.size > 128) throw ApiException(0, "document_figure_limit", "Open this paper in smaller sections.")
        val local = linkedMapOf<String, String>()
        for (path in paths) {
            if (assignmentFigurePath(path) == null) throw ApiException(0, "untrusted_document_figure", "The document figure URL is not an assignment resource.")
            local[path] = fetch(path)
        }
        requireAccount()
        imageMarkdown.replace(markdown) { match ->
            val source = match.groupValues[1]
            match.value.removeSuffix("$source)") + local.getValue(source) + ")"
        }
    }

    private suspend fun fetch(path: String): String {
        requireAccount()
        directory()
        val index = file("${sha256(path.toByteArray())}.json")
        val staged = file(".physicsos-download-${UUID.randomUUID()}.part")
        try {
            try {
                api.download(path, staged, FIGURE_BYTES.toLong()) { _, _ -> }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                requireAccount()
                if (error !is IOException && (error !is ApiException || !error.retryable)) throw error
                val cached = cachedDigest(index) ?: throw error
                val bytes = readAsset("$cached.png")
                if (!decode(bytes)) throw figureFailure()
                return "${LabUrlPolicy.ORIGIN}$pathPrefix$cached.png"
            }
            requireAccount()
            if (staged.length() !in 1..FIGURE_BYTES.toLong()) throw figureFailure()
            val bytes = staged.readBytes()
            validateFigurePng(bytes)
            if (!decode(bytes)) throw figureFailure()
            val digest = sha256(bytes)
            val destination = file("$digest.png")
            val retained = root.listFiles().orEmpty().filter { it.name.endsWith(".png") }.sumOf { it.length() }
            if (!destination.exists() && (retained + bytes.size > FIGURE_CACHE_BYTES || root.listFiles().orEmpty().size >= 2048)) {
                throw ApiException(0, "document_figure_cache_full", "The private figure cache is full; no document data was discarded.")
            }
            requireAccount()
            if (!destination.exists()) Files.move(staged.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE)
            else readAsset("$digest.png")
            val metadata = buildJsonObject { put("sha256", digest) }.toString().toByteArray()
            val temporary = file(".${UUID.randomUUID()}.tmp")
            try {
                FileOutputStream(temporary).use { it.write(metadata); it.fd.sync() }
                requireAccount()
                Files.move(temporary.toPath(), index.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } finally { temporary.delete() }
            return "${LabUrlPolicy.ORIGIN}$pathPrefix$digest.png"
        } finally { staged.delete() }
    }

    private fun cachedDigest(index: File): String? = runCatching {
        if (!index.isFile || index.length() > 256) return@runCatching null
        val value = wireJson.parseToJsonElement(index.readText()) as? JsonObject
        (value?.get("sha256") as? JsonPrimitive)?.contentOrNull?.takeIf(digestPattern::matches)
    }.getOrNull()

    internal fun readAsset(path: String): ByteArray {
        requireAccount()
        if (!path.endsWith(".png") || !digestPattern.matches(path.removeSuffix(".png"))) throw figureFailure()
        val image = file(path)
        if (!image.isFile || image.length() !in 1..FIGURE_BYTES.toLong()) throw figureFailure()
        val bytes = image.readBytes()
        if (sha256(bytes) != path.removeSuffix(".png")) throw figureFailure()
        validateFigurePng(bytes)
        requireAccount()
        return bytes
    }

    override fun handle(path: String): WebResourceResponse = try {
        WebResourceResponse("image/png", null, 200, "OK", mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"), ByteArrayInputStream(readAsset(path)))
    } catch (_: Exception) {
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))
    }

    private fun requireAccount() {
        if (account.userId == null || currentAccount() != account) throw ApiException(0, "account_changed", "Account changed.")
    }
    private fun directory() {
        if (!root.isDirectory && !root.mkdirs()) throw ApiException(0, "storage_unavailable", "The private figure directory could not be created.")
        if (root.canonicalFile != root.absoluteFile.normalize()) throw figureFailure()
    }
    private fun file(name: String): File {
        if (name.any { it == '/' || it == '\\' } || name in setOf(".", "..")) throw figureFailure()
        val file = File(root, name)
        if (file.canonicalFile.parentFile != root.absoluteFile.normalize() || Files.isSymbolicLink(file.toPath())) throw figureFailure()
        return file
    }

    companion object {
        fun forAccount(context: Context, graph: AppGraph, account: ExperimentAccount): DocumentFigureAssets = DocumentFigureAssets(
            // Existing PrivateFiles.deleteOwner purges this owner directory on account erasure/replacement.
            File(context.filesDir.canonicalFile, "chat-downloads/${sha256(account.owner.toByteArray())}/class-figures/${sha256(requireNotNull(account.userId).toByteArray())}"),
            account, graph.api, { graph.auth.state.value.experimentAccount() },
        )
    }
}
