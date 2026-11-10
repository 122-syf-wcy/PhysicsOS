package com.physicsos.student.feature.files

import android.content.Context
import android.net.Uri
import com.physicsos.student.BuildConfig
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.DownloadRecord
import com.physicsos.student.core.DownloadState
import com.physicsos.student.core.LocalStore
import com.physicsos.student.core.MobileClient
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

@Serializable
internal data class AttachmentReference(
    val sessionId: String,
    val attachmentId: String,
    val name: String,
    val bytes: Long,
    val image: Boolean,
    val mime: String,
) {
    val localId: String get() = sha256("$sessionId\u0000$attachmentId".toByteArray())
    val path: String get() = AttachmentPolicy.attachmentDownloadPath(sessionId, attachmentId)

    companion object {
        fun fromBlock(sessionId: String, block: JsonObject): AttachmentReference? {
            val type = block.stringValue("type")
            if (type != "image" && type != "file") return null
            val ref = block["attachment"] as? JsonObject ?: return null
            val id = ref.stringValue("attachmentId") ?: return null
            val bytes = (ref["bytes"] as? JsonPrimitive)?.longOrNull ?: return null
            if (bytes <= 0) return null
            val mime = if (type == "image") ref.stringValue("mediaType") ?: return null else "application/octet-stream"
            return AttachmentReference(
                sessionId, id, AttachmentPolicy.safeName(ref.stringValue("name")), bytes, type == "image", mime,
            ).also { it.path }
        }
    }
}

/** Auth remains inside MobileClient; downloads can address only a referenced session attachment. */
internal class FileTransfers(
    context: Context,
    private val owner: String,
    private val api: MobileClient,
    private val store: LocalStore,
    private val requireOwner: () -> Unit,
) {
    private val context = context.applicationContext
    private val root: File get() = File(context.filesDir, "chat-downloads/${AttachmentPolicy.ownerDirectoryName(owner)}")
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun upload(
        sessionId: String,
        attachment: PreparedAttachment,
        intake: FileIntake,
        onProgress: (Long, Long) -> Unit,
    ): PreparedAttachment = withContext(Dispatchers.IO) {
        requireOwner()
        if (attachment.kind == AttachmentKind.IMAGE) return@withContext attachment
        val file = intake.file(attachment)
        verifyLocal(file, attachment.bytes, attachment.sha256)
        val receipt = api.upload(sessionId, file, attachment.name, onProgress)
        requireOwner()
        val receiptId = receipt.stringValue("receiptId")?.takeIf { it.isNotBlank() }
            ?: throw FileOperationException(FileProblem.RECEIPT_INVALID)
        val remote = receipt["file"] as? JsonObject ?: throw FileOperationException(FileProblem.RECEIPT_INVALID)
        val id = remote.stringValue("attachmentId") ?: throw FileOperationException(FileProblem.RECEIPT_INVALID)
        if ((remote["bytes"] as? JsonPrimitive)?.longOrNull != attachment.bytes) throw FileOperationException(FileProblem.RECEIPT_INVALID)
        val reference = AttachmentReference(sessionId, id, AttachmentPolicy.safeName(remote.stringValue("name")), attachment.bytes, false, attachment.mime)
        rememberLocal(reference, file, attachment.sha256)
        attachment.copy(
            upload = UploadStatus.UPLOADED, receiptId = receiptId,
            receiptSessionId = sessionId, remoteAttachmentId = id,
        )
    }

    suspend fun download(reference: AttachmentReference, onProgress: (Long, Long?) -> Unit): DownloadRecord = withContext(Dispatchers.IO) {
        requireOwner()
        AttachmentPolicy.enforceSize(reference.bytes, AttachmentPolicy.MAX_DOWNLOAD_BYTES)
        val path = AttachmentPolicy.validateDownloadPath(reference.path, BuildConfig.SERVER_ORIGIN)
        ensureDirectory()
        val destination = AttachmentPolicy.privateFile(root, "${reference.localId}.bin")
        store.getDownload(owner, reference.localId)?.takeIf { it.state == DownloadState.COMPLETE }?.let { cached ->
            try {
                verifiedFile(cached)
                return@withContext cached
            } catch (_: FileOperationException) {
                // A missing or corrupt cached file must be downloaded and verified again.
            }
        }
        val referenceJson = json.parseToJsonElement(json.encodeToString(reference)).jsonObject
        store.put(REFERENCE_KIND, owner, reference.localId, referenceJson)
        var done = 0L
        var total: Long? = reference.bytes
        var record = DownloadRecord(
            id = reference.localId, owner = owner, url = path, name = reference.name,
            mimeType = reference.mime, state = DownloadState.DOWNLOADING, totalBytes = reference.bytes,
        )
        store.putDownload(record)
        try {
            val result = api.download(path, destination, AttachmentPolicy.MAX_DOWNLOAD_BYTES) { bytes, length ->
                done = bytes
                total = length ?: reference.bytes
                onProgress(bytes, total)
            }
            requireOwner()
            currentCoroutineContext().ensureActive()
            val actualBytes = destination.length()
            if (actualBytes != reference.bytes) throw FileOperationException(FileProblem.INTEGRITY)
            val checksum = digest(destination)
            val reportedDigest = result.stringValue("sha256") ?: throw FileOperationException(FileProblem.INTEGRITY)
            if (checksum != reportedDigest) throw FileOperationException(FileProblem.INTEGRITY)
            if (!reference.image && reference.attachmentId.matches(Regex("[0-9a-f]{64}")) && checksum != reference.attachmentId) {
                throw FileOperationException(FileProblem.INTEGRITY)
            }
            val detected = AttachmentPolicy.inspect(readPrefix(destination), if (reference.image) reference.mime else null, reference.name)
            if (reference.image && detected.kind != AttachmentKind.IMAGE) throw FileOperationException(FileProblem.MIME_MISMATCH)
            record = record.copy(
                state = DownloadState.COMPLETE, bytesDownloaded = actualBytes, totalBytes = actualBytes,
                localPath = destination.absolutePath, sha256 = checksum, mimeType = detected.mime,
                updatedAt = System.currentTimeMillis(),
            )
            store.putDownload(record)
            record
        } catch (error: CancellationException) {
            withContext(NonCancellable) {
                store.putDownload(record.copy(state = DownloadState.PAUSED, bytesDownloaded = done, totalBytes = total, updatedAt = System.currentTimeMillis()))
            }
            throw error
        } catch (error: Exception) {
            destination.delete()
            val code = when (error) {
                is ApiException -> error.code
                is FileOperationException -> error.problem.name
                else -> "download_failed"
            }
            store.putDownload(record.copy(state = DownloadState.FAILED, bytesDownloaded = done, totalBytes = total, errorCode = code, updatedAt = System.currentTimeMillis()))
            throw error
        }
    }

    suspend fun retry(id: String, onProgress: (Long, Long?) -> Unit): DownloadRecord {
        val saved = store.get(REFERENCE_KIND, owner, id)?.payload ?: throw FileOperationException(FileProblem.MISSING)
        val reference = json.decodeFromString<AttachmentReference>(saved.toString())
        if (reference.localId != id) throw FileOperationException(FileProblem.UNSAFE_PATH)
        return download(reference, onProgress)
    }

    suspend fun verifiedFile(record: DownloadRecord): File = withContext(Dispatchers.IO) {
        requireOwner()
        if (record.owner != owner || record.state != DownloadState.COMPLETE || record.localPath == null || record.sha256 == null) {
            throw FileOperationException(FileProblem.MISSING)
        }
        val expected = AttachmentPolicy.privateFile(root, "${record.id}.bin")
        if (expected.absolutePath != record.localPath) throw FileOperationException(FileProblem.UNSAFE_PATH)
        verifyLocal(expected, record.bytesDownloaded, record.sha256)
        expected
    }

    suspend fun recoverInterruptedDownloads() {
        store.observeDownloads(owner).let { flow ->
            flow.first().filter { it.state == DownloadState.DOWNLOADING || it.state == DownloadState.QUEUED }.forEach {
                store.putDownload(it.copy(state = DownloadState.PAUSED, updatedAt = System.currentTimeMillis()))
            }
        }
    }

    suspend fun remove(record: DownloadRecord) = withContext(Dispatchers.IO) {
        requireOwner()
        if (record.owner != owner) throw FileOperationException(FileProblem.UNSAFE_PATH)
        AttachmentPolicy.privateFile(root, "${record.id}.bin").delete()
        store.deleteDownload(owner, record.id)
        store.delete(REFERENCE_KIND, owner, record.id)
    }

    suspend fun clearOwner() = withContext(Dispatchers.IO) { root.deleteRecursively() }

    private suspend fun rememberLocal(reference: AttachmentReference, source: File, checksum: String) {
        requireOwner()
        ensureDirectory()
        val destination = AttachmentPolicy.privateFile(root, "${reference.localId}.bin")
        val temporary = AttachmentPolicy.privateFile(root, "${reference.localId}.copying")
        try {
            source.inputStream().use { input -> FileOutputStream(temporary).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.fd.sync()
            } }
            requireOwner()
            if (!temporary.renameTo(destination)) throw FileOperationException(FileProblem.UNREADABLE)
            store.put(REFERENCE_KIND, owner, reference.localId, json.parseToJsonElement(json.encodeToString(reference)).jsonObject)
            store.putDownload(DownloadRecord(
                id = reference.localId, owner = owner, url = reference.path, name = reference.name,
                mimeType = reference.mime, state = DownloadState.COMPLETE, bytesDownloaded = reference.bytes,
                totalBytes = reference.bytes, localPath = destination.absolutePath, sha256 = checksum,
            ))
        } finally { temporary.delete() }
    }

    private fun ensureDirectory() {
        if (!root.isDirectory && !root.mkdirs()) throw FileOperationException(FileProblem.NO_SPACE)
    }

    companion object { private const val REFERENCE_KIND = "chat.file-reference" }
}

internal suspend fun verifyLocal(file: File, bytes: Long, checksum: String) {
    if (!file.isFile) throw FileOperationException(FileProblem.MISSING)
    if (file.length() != bytes || digest(file) != checksum) throw FileOperationException(FileProblem.INTEGRITY)
}

internal suspend fun exportDocument(context: Context, destination: Uri, file: File) = withContext(Dispatchers.IO) {
    if (destination.scheme != "content") throw FileOperationException(FileProblem.UNSAFE_PATH)
    AttachmentPolicy.enforceSize(file.length(), AttachmentPolicy.MAX_DOWNLOAD_BYTES)
    try {
        context.contentResolver.openOutputStream(destination, "wt")?.use { output ->
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.flush()
            }
        } ?: throw FileOperationException(FileProblem.UNREADABLE)
    } catch (_: IOException) { throw FileOperationException(FileProblem.UNREADABLE) }
    catch (_: SecurityException) { throw FileOperationException(FileProblem.UNREADABLE) }
}

internal fun attachmentReferences(sessionId: String, content: JsonArray): List<AttachmentReference> = content.mapNotNull {
    (it as? JsonObject)?.let { block -> AttachmentReference.fromBlock(sessionId, block) }
}
private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
