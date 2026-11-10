package com.physicsos.student.feature.files

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.StatFs
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Owns account-scoped private bytes. No caller-provided URI or filename becomes a filesystem path. */
internal class FileIntake(context: Context, private val owner: String) {
    private val context = context.applicationContext
    private val root: File get() = File(context.filesDir, "chat-files/${AttachmentPolicy.ownerDirectoryName(owner)}")

    fun file(attachment: PreparedAttachment): File = AttachmentPolicy.privateFile(root, attachment.localName)
    fun sourceFile(attachment: PreparedAttachment): File = AttachmentPolicy.privateFile(root, attachment.originalName)

    suspend fun stage(uri: Uri, limits: IntakeLimits): PreparedAttachment = withContext(Dispatchers.IO) {
        if (uri.scheme != "content" || uri.authority.isNullOrBlank()) throw FileOperationException(FileProblem.UNSAFE_PATH)
        ensureDirectory()
        val id = UUID.randomUUID().toString()
        val source = AttachmentPolicy.privateFile(root, "$id.source")
        try {
            var displayName: String? = null
            var reportedSize: Long? = null
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { displayName = cursor.getString(it) }
                    cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !cursor.isNull(it) }?.let { reportedSize = cursor.getLong(it) }
                }
            }
            reportedSize?.takeIf { it > 0 }?.let { AttachmentPolicy.enforceSize(it) }
            checkSpace(reportedSize?.coerceAtLeast(0) ?: AttachmentPolicy.MAX_IMPORT_BYTES)
            val input = context.contentResolver.openInputStream(uri) ?: throw FileOperationException(FileProblem.UNREADABLE)
            input.use { stream ->
                FileOutputStream(source).use { out ->
                    val buffer = ByteArray(64 * 1024)
                    var count = 0L
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val read = stream.read(buffer)
                        if (read == -1) break
                        count += read
                        if (count > AttachmentPolicy.MAX_IMPORT_BYTES) throw FileOperationException(FileProblem.TOO_LARGE)
                        out.write(buffer, 0, read)
                    }
                    out.fd.sync()
                    AttachmentPolicy.enforceSize(count)
                }
            }
            val name = AttachmentPolicy.safeName(displayName)
            val type = AttachmentPolicy.inspect(readPrefix(source), context.contentResolver.getType(uri), name)
            when (type.kind) {
                AttachmentKind.IMAGE -> normalizeImage(
                    id, name, source, limits, CropArea(), 0, type.mime == "image/gif",
                )
                AttachmentKind.PDF -> PreparedAttachment(
                    id = id, name = name, kind = type.kind, mime = type.mime,
                    localName = source.name, originalName = source.name, bytes = source.length(),
                    sha256 = digest(source), pageCount = pdfPageCount(source),
                )
                AttachmentKind.FILE -> PreparedAttachment(
                    id = id, name = name, kind = type.kind, mime = type.mime,
                    localName = source.name, originalName = source.name, bytes = source.length(), sha256 = digest(source),
                )
            }
        } catch (error: CancellationException) {
            source.delete(); File(root, "$id.jpg").delete(); throw error
        } catch (error: FileOperationException) {
            source.delete(); File(root, "$id.jpg").delete(); throw error
        } catch (_: SecurityException) {
            source.delete(); throw FileOperationException(FileProblem.UNREADABLE)
        } catch (_: IOException) {
            source.delete(); throw FileOperationException(FileProblem.UNREADABLE)
        } catch (_: IllegalArgumentException) {
            source.delete(); throw FileOperationException(FileProblem.UNREADABLE)
        }
    }

    suspend fun crop(attachment: PreparedAttachment, area: CropArea, turns: Int, limits: IntakeLimits): PreparedAttachment =
        withContext(Dispatchers.IO) {
            if (attachment.kind != AttachmentKind.IMAGE || !area.valid()) throw FileOperationException(FileProblem.UNREADABLE)
            val source = sourceFile(attachment)
            if (!source.isFile) throw FileOperationException(FileProblem.MISSING)
            normalizeImage(attachment.id, attachment.name, source, limits, area, turns, attachment.flattenedAnimation)
        }

    suspend fun previewOriginal(attachment: PreparedAttachment): Bitmap = withContext(Dispatchers.IO) {
        decodeBounded(sourceFile(attachment), IntakeLimits(maxDimension = 1280, maxPixels = 2_000_000))
    }

    suspend fun renderPdf(attachment: PreparedAttachment, index: Int): Bitmap = withContext(Dispatchers.IO) {
        if (attachment.kind != AttachmentKind.PDF) throw FileOperationException(FileProblem.PDF_UNREADABLE)
        renderPdfFile(file(attachment), index)
    }

    suspend fun remove(attachment: PreparedAttachment) = withContext(Dispatchers.IO) {
        file(attachment).delete()
        sourceFile(attachment).takeIf { it.name != attachment.localName }?.delete()
    }

    suspend fun clearOwner() = withContext(Dispatchers.IO) {
        root.deleteRecursively()
        File(context.cacheDir, "shared/chat/${AttachmentPolicy.ownerDirectoryName(owner)}").deleteRecursively()
    }

    private suspend fun normalizeImage(
        id: String,
        displayName: String,
        source: File,
        limits: IntakeLimits,
        crop: CropArea,
        turns: Int,
        flattenedAnimation: Boolean,
    ): PreparedAttachment {
        currentCoroutineContext().ensureActive()
        var bitmap = decodeBounded(source, limits)
        val target = AttachmentPolicy.privateFile(root, "$id.jpg")
        val temp = AttachmentPolicy.privateFile(root, "$id.processing")
        try {
            val left = (crop.left * bitmap.width).roundToInt().coerceIn(0, bitmap.width - 1)
            val top = (crop.top * bitmap.height).roundToInt().coerceIn(0, bitmap.height - 1)
            val width = ((crop.right - crop.left) * bitmap.width).roundToInt().coerceIn(1, bitmap.width - left)
            val height = ((crop.bottom - crop.top) * bitmap.height).roundToInt().coerceIn(1, bitmap.height - top)
            val transform = Matrix().apply { postRotate(((turns % 4 + 4) % 4) * 90f) }
            val cropped = Bitmap.createBitmap(bitmap, left, top, width, height, transform, true)
            if (cropped !== bitmap) { bitmap.recycle(); bitmap = cropped }
            if (bitmap.hasAlpha()) {
                val opaque = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
                Canvas(opaque).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }
                bitmap.recycle(); bitmap = opaque
            }
            var fits = false
            while (!fits) {
                for (quality in listOf(92, 84, 74, 62)) {
                    currentCoroutineContext().ensureActive()
                    FileOutputStream(temp).use { out ->
                        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)) throw FileOperationException(FileProblem.UNREADABLE)
                        out.fd.sync()
                    }
                    if (temp.length() <= limits.maxImageBytes) { fits = true; break }
                }
                if (!fits) {
                    if (max(bitmap.width, bitmap.height) <= 640) throw FileOperationException(FileProblem.TOO_LARGE)
                    val resized = Bitmap.createScaledBitmap(bitmap, max(1, bitmap.width * 3 / 4), max(1, bitmap.height * 3 / 4), true)
                    bitmap.recycle(); bitmap = resized
                }
            }
            currentCoroutineContext().ensureActive()
            val bytes = temp.length()
            val digest = digest(temp)
            // Source remains available for non-destructive recropping. JPEG strips EXIF/GPS metadata.
            if (!temp.renameTo(target)) throw FileOperationException(FileProblem.UNREADABLE)
            return PreparedAttachment(
                id = id, name = AttachmentPolicy.safeName(displayName.substringBeforeLast('.', displayName) + ".jpg"),
                kind = AttachmentKind.IMAGE, mime = "image/jpeg", localName = target.name, originalName = source.name,
                bytes = bytes, sha256 = digest, width = bitmap.width, height = bitmap.height,
                crop = crop, quarterTurns = turns, flattenedAnimation = flattenedAnimation,
            )
        } finally {
            bitmap.recycle()
            temp.delete()
        }
    }

    private fun decodeBounded(file: File, limits: IntakeLimits): Bitmap {
        if (!file.isFile) throw FileOperationException(FileProblem.MISSING)
        try {
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
                val width = info.size.width
                val height = info.size.height
                if (width <= 0 || height <= 0) throw FileOperationException(FileProblem.UNREADABLE)
                val scale = min(1.0, min(
                    limits.maxDimension.toDouble() / max(width, height),
                    sqrt(limits.maxPixels.toDouble() / (width.toLong() * height)),
                ))
                decoder.setTargetSize(max(1, (width * scale).roundToInt()), max(1, (height * scale).roundToInt()))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.isMutableRequired = true
            }
        } catch (_: ImageDecoder.DecodeException) {
            throw FileOperationException(FileProblem.UNREADABLE)
        }
    }

    private fun ensureDirectory() {
        if (!root.isDirectory && !root.mkdirs()) throw FileOperationException(FileProblem.NO_SPACE)
    }

    private fun checkSpace(bytes: Long) {
        if (StatFs(context.filesDir.absolutePath).availableBytes < bytes + 16 * MEBIBYTE) {
            throw FileOperationException(FileProblem.NO_SPACE)
        }
    }
}

internal suspend fun digest(file: File): String = withContext(Dispatchers.IO) {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            currentCoroutineContext().ensureActive()
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
    }
    digest.digest().joinToString("") { "%02x".format(it) }
}

internal fun readPrefix(file: File): ByteArray = file.inputStream().use { input ->
    val buffer = ByteArray(4096)
    var offset = 0
    while (offset < buffer.size) {
        val count = input.read(buffer, offset, buffer.size - offset)
        if (count < 0) break
        offset += count
    }
    buffer.copyOf(offset)
}

internal fun pdfPageCount(file: File): Int = try {
    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
            renderer.pageCount.takeIf { it > 0 } ?: throw FileOperationException(FileProblem.EMPTY)
        }
    }
} catch (_: SecurityException) { throw FileOperationException(FileProblem.PDF_UNREADABLE) }
catch (_: IOException) { throw FileOperationException(FileProblem.PDF_UNREADABLE) }
catch (_: IllegalArgumentException) { throw FileOperationException(FileProblem.PDF_UNREADABLE) }

internal suspend fun renderPdfFile(file: File, index: Int): Bitmap = withContext(Dispatchers.IO) {
    try {
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
            PdfRenderer(descriptor).use { renderer ->
                if (index !in 0 until renderer.pageCount) throw FileOperationException(FileProblem.PDF_UNREADABLE)
                renderer.openPage(index).use { page ->
                    currentCoroutineContext().ensureActive()
                    val scale = min(2.0, 2048.0 / max(page.width, page.height).coerceAtLeast(1))
                    val bitmap = Bitmap.createBitmap(max(1, (page.width * scale).roundToInt()), max(1, (page.height * scale).roundToInt()), Bitmap.Config.ARGB_8888)
                    try {
                        bitmap.eraseColor(Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        currentCoroutineContext().ensureActive()
                        bitmap
                    } catch (error: Exception) { bitmap.recycle(); throw error }
                }
            }
        }
    } catch (_: SecurityException) { throw FileOperationException(FileProblem.PDF_UNREADABLE) }
    catch (_: IOException) { throw FileOperationException(FileProblem.PDF_UNREADABLE) }
    catch (_: IllegalArgumentException) { throw FileOperationException(FileProblem.PDF_UNREADABLE) }
}

internal data class ShareFile(val uri: Uri, val mime: String)

/** FileProvider only receives prepared copies under the existing shared/ allowlist. */
internal suspend fun prepareShare(context: Context, owner: String, file: File, displayName: String, mime: String): ShareFile =
    withContext(Dispatchers.IO) {
        if (!file.isFile) throw FileOperationException(FileProblem.MISSING)
        AttachmentPolicy.enforceSize(file.length(), AttachmentPolicy.MAX_DOWNLOAD_BYTES)
        val directory = File(context.cacheDir, "shared/chat/${AttachmentPolicy.ownerDirectoryName(owner)}/${UUID.randomUUID()}")
        if (!directory.mkdirs()) throw FileOperationException(FileProblem.NO_SPACE)
        val copy = AttachmentPolicy.privateFile(directory, AttachmentPolicy.safeName(displayName))
        try {
            file.inputStream().use { input -> FileOutputStream(copy).use { out ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val count = input.read(buffer)
                    if (count < 0) break
                    out.write(buffer, 0, count)
                }
            } }
            ShareFile(FileProvider.getUriForFile(context, "${context.packageName}.files", copy), mime)
        } catch (error: Exception) { directory.deleteRecursively(); throw error }
    }

internal fun ShareFile.shareIntent(chooserTitle: String): Intent = Intent.createChooser(
    Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri("", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }, chooserTitle,
)
