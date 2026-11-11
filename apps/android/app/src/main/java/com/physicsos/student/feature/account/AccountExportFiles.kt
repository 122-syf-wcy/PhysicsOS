package com.physicsos.student.feature.account

import android.content.Context
import android.net.Uri
import com.physicsos.student.core.PrivateFiles
import com.physicsos.student.feature.files.AttachmentPolicy
import com.physicsos.student.feature.files.ShareFile
import com.physicsos.student.feature.files.exportDocument
import com.physicsos.student.feature.files.prepareShare
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/** Reuses the existing size-bounded SAF/FileProvider pipeline, not a public filesystem path. */
internal class AccountExportFiles(context: Context, private val owner: String, private val requireOwner: () -> Unit) : Closeable {
    private val context = context.applicationContext
    private val privateFiles = PrivateFiles(listOf(this.context.cacheDir))
    private val instance = UUID.randomUUID().toString()
    private val root = privateFiles.checked(File(this.context.cacheDir, "account-exports/${accountInstanceKey(owner)}/$instance"))
    private val shared = mutableListOf<Uri>()
    @Volatile private var closed = false
    private var prepared: Pair<AccountExportInfo, File>? = null

    suspend fun account(data: JsonObject): AccountExportInfo = withContext(Dispatchers.IO) {
        requireOwner()
        validateAccountExport(data)
        create(data.toString().toByteArray(Charsets.UTF_8), AccountExportKind.ACCOUNT)
    }

    suspend fun feedback(text: String, explanation: String): AccountExportInfo = withContext(Dispatchers.IO) {
        requireOwner()
        val content = validatedFeedback(text)
        create("$explanation\n\n$content\n".toByteArray(Charsets.UTF_8), AccountExportKind.FEEDBACK)
    }

    private suspend fun create(bytes: ByteArray, kind: AccountExportKind): AccountExportInfo {
        if (bytes.size.toLong() > AttachmentPolicy.MAX_DOWNLOAD_BYTES) throw AccountFailure(AccountProblem.EXPORT_TOO_LARGE)
        requireOwner()
        val id = UUID.randomUUID().toString()
        val extension = if (kind == AccountExportKind.ACCOUNT) "json" else "txt"
        val name = if (kind == AccountExportKind.ACCOUNT) "physicsos-account-$id.json" else "physicsos-feedback-$id.txt"
        val target = privateFiles.destination(File(root, "$id.$extension"))
        val temp = privateFiles.destination(File(root, "$id.part"))
        try {
            FileOutputStream(temp).use { output ->
                var offset = 0
                while (offset < bytes.size) {
                    currentCoroutineContext().ensureActive()
                    requireOwner()
                    val count = minOf(64 * 1024, bytes.size - offset)
                    output.write(bytes, offset, count)
                    offset += count
                }
                output.fd.sync()
            }
            currentCoroutineContext().ensureActive()
            requireOwner()
            return synchronized(this) {
                checkOpen()
                if (!temp.renameTo(target)) throw AccountFailure(AccountProblem.STORAGE)
                val info = AccountExportInfo(id, name, bytes.size.toLong(), kind)
                prepared?.second?.let { privateFiles.delete(it.path) }
                prepared = info to target
                info
            }
        } catch (error: Exception) {
            target.delete()
            throw error
        } finally {
            temp.delete()
        }
    }

    @Synchronized
    private fun file(id: String): Pair<AccountExportInfo, File> {
        requireOwner()
        checkOpen()
        return prepared?.takeIf { it.first.id == id && privateFiles.checked(it.second).isFile }
            ?: throw AccountFailure(AccountProblem.FILE_UNAVAILABLE)
    }

    suspend fun share(id: String): ShareFile = withContext(Dispatchers.IO) {
        val (info, file) = file(id)
        val share = prepareShare(context, owner, file, info.name, mime(info))
        try {
            requireOwner()
            synchronized(this@AccountExportFiles) { checkOpen(); shared.add(share.uri) }
            share
        } catch (error: Exception) {
            context.contentResolver.delete(share.uri, null, null)
            throw error
        }
    }

    suspend fun export(id: String, destination: Uri) {
        val (_, file) = file(id)
        exportDocument(context, destination, file)
        requireOwner()
    }

    private fun mime(info: AccountExportInfo) = if (info.kind == AccountExportKind.ACCOUNT) "application/json" else "text/plain"

    private fun checkOpen() {
        if (closed) throw AccountFailure(AccountProblem.FILE_UNAVAILABLE)
    }

    @Synchronized
    override fun close() {
        closed = true
        prepared = null
        // Delete only the URIs this instance prepared, never another feature's shared files.
        shared.forEach { uri ->
            try { context.contentResolver.delete(uri, null, null) } catch (_: SecurityException) { /* Core also purges the owner directory. */ }
        }
        shared.clear()
        if (root.exists()) root.walkBottomUp().forEach { file -> privateFiles.checked(file).delete() }
    }
}
