package com.physicsos.student.feature.files

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.DownloadRecord
import com.physicsos.student.core.DownloadState
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class TransferProgress(val done: Long, val total: Long?)
internal data class OpenedFile(val file: File, val name: String, val mime: String, val pageCount: Int? = null, val recordId: String? = null)
internal enum class FileNotice { AUTH, ACCESS, NETWORK, FAILED, EXPORTED, SHARE_UNAVAILABLE, CAMERA_DENIED, CAMERA_UNAVAILABLE, IMPORTED }
internal data class FilesUiState(
    val downloads: List<DownloadRecord> = emptyList(),
    val progress: Map<String, TransferProgress> = emptyMap(),
    val preview: OpenedFile? = null,
    val notice: FileNotice? = null,
    val problem: FileProblem? = null,
    val busy: Boolean = false,
)
internal sealed interface FileEffect {
    data class Share(val file: ShareFile) : FileEffect
    data class Export(val id: String, val name: String, val mime: String) : FileEffect
}
internal data class CameraCapture(val token: String, val uri: Uri)

/** Used by both the chat attachment sheet and the standalone native files destination. */
internal class FileActionsController(
    context: Context,
    private val graph: AppGraph,
    val owner: String,
    private val scope: CoroutineScope,
) {
    private val context = context.applicationContext
    private val accountInstance = (graph.auth.state.value as? AuthState.SignedIn)?.user?.userId
    val intake = FileIntake(this.context, owner)
    val transfers = FileTransfers(this.context, owner, graph.api, graph.store, ::requireOwner)
    private val mutableState = MutableStateFlow(FilesUiState())
    val state = mutableState.asStateFlow()
    private val effectsChannel = Channel<FileEffect>(Channel.BUFFERED)
    val effects = effectsChannel.receiveAsFlow()
    private val jobs = ConcurrentHashMap<String, Job>()

    init {
        scope.launch(Dispatchers.IO) {
            try { requireOwner(); transfers.recoverInterruptedDownloads() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
            graph.store.observeDownloads(owner).collect { records ->
                if (isOwner()) mutableState.update { it.copy(downloads = records.sortedByDescending { row -> row.updatedAt }) }
            }
        }
        scope.launch {
            graph.auth.state.collect { if (!isOwner()) { pause(); mutableState.value = FilesUiState(notice = FileNotice.AUTH) } }
        }
    }

    fun requireOwner() { if (!isOwner()) throw ApiException(401, "authentication_required", "") }
    fun isOwner(): Boolean = (graph.auth.state.value as? AuthState.SignedIn)?.user?.let {
        it.userKey == owner && it.userId == accountInstance
    } == true

    fun download(reference: AttachmentReference, openAfter: Boolean = true) = task(reference.localId) {
        val record = transfers.download(reference) { done, total -> progress(reference.localId, done, total) }
        notifyDownloadComplete(context, graph.settings, ::isOwner)
        if (openAfter) openRecord(record)
    }

    fun retry(record: DownloadRecord) = task(record.id) {
        val complete = transfers.retry(record.id) { done, total -> progress(record.id, done, total) }
        notifyDownloadComplete(context, graph.settings, ::isOwner)
        openRecord(complete)
    }

    fun open(record: DownloadRecord) = task("open:${record.id}") { openRecord(record) }

    fun share(record: DownloadRecord) = task("share:${record.id}") {
        val file = transfers.verifiedFile(record)
        val share = prepareShare(context, owner, file, record.name, record.mimeType)
        requireOwner()
        effectsChannel.send(FileEffect.Share(share))
    }

    fun requestExport(record: DownloadRecord) = task("export:${record.id}") {
        transfers.verifiedFile(record)
        effectsChannel.send(FileEffect.Export(record.id, record.name, record.mimeType))
    }

    fun export(id: String, uri: Uri) = task("write:$id") {
        val record = graph.store.getDownload(owner, id) ?: throw FileOperationException(FileProblem.MISSING)
        val file = transfers.verifiedFile(record)
        exportDocument(context, uri, file)
        requireOwner()
        notice(FileNotice.EXPORTED)
    }

    fun remove(record: DownloadRecord) = task("remove:${record.id}") {
        jobs[record.id]?.cancel()
        transfers.remove(record)
    }

    fun cancel(id: String) { jobs[id]?.cancel() }
    fun pause() { jobs.values.toList().forEach(Job::cancel) }
    fun dismissPreview() { mutableState.update { it.copy(preview = null) } }
    fun dismissNotice() { mutableState.update { it.copy(notice = null, problem = null) } }
    fun notice(notice: FileNotice) { mutableState.update { it.copy(notice = notice, problem = null) } }

    suspend fun preview(attachment: PreparedAttachment) = withContext(Dispatchers.IO) {
        requireOwner()
        val file = intake.file(attachment)
        verifyLocal(file, attachment.bytes, attachment.sha256)
        mutableState.update { it.copy(preview = OpenedFile(file, attachment.name, attachment.mime, attachment.pageCount)) }
    }

    suspend fun createCapture(): CameraCapture = withContext(Dispatchers.IO) {
        requireOwner()
        val directory = File(context.cacheDir, "captures/${AttachmentPolicy.ownerDirectoryName(owner)}")
        if (!directory.isDirectory && !directory.mkdirs()) throw FileOperationException(FileProblem.NO_SPACE)
        val token = UUID.randomUUID().toString()
        val file = AttachmentPolicy.privateFile(directory, "$token.jpg")
        if (!file.createNewFile()) throw FileOperationException(FileProblem.UNREADABLE)
        CameraCapture(token, FileProvider.getUriForFile(context, "${context.packageName}.files", file))
    }

    suspend fun removeCapture(token: String) = withContext(Dispatchers.IO) {
        if (!token.matches(Regex("[a-f0-9-]{36}"))) return@withContext
        val directory = File(context.cacheDir, "captures/${AttachmentPolicy.ownerDirectoryName(owner)}")
        AttachmentPolicy.privateFile(directory, "$token.jpg").delete()
    }

    fun report(error: Exception) {
        if (error is CancellationException) return
        if (!isOwner()) { notice(FileNotice.AUTH); return }
        if (error is FileOperationException) mutableState.update { it.copy(problem = error.problem, notice = null) }
        else notice(when (error) {
            is ApiException -> when (error.status) {
                401 -> FileNotice.AUTH
                403, 404 -> FileNotice.ACCESS
                0 -> FileNotice.NETWORK
                413 -> { mutableState.update { it.copy(problem = FileProblem.TOO_LARGE) }; return }
                else -> FileNotice.FAILED
            }
            else -> FileNotice.FAILED
        })
    }

    private suspend fun openRecord(record: DownloadRecord) {
        val file = transfers.verifiedFile(record)
        val pages = if (record.mimeType == "application/pdf") pdfPageCount(file) else null
        requireOwner()
        mutableState.update { it.copy(preview = OpenedFile(file, record.name, record.mimeType, pages, record.id)) }
    }

    private fun task(id: String, block: suspend () -> Unit) {
        val job = scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try { requireOwner(); block() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
            finally {
                jobs.remove(id)
                mutableState.update { it.copy(progress = it.progress - id, busy = jobs.isNotEmpty()) }
            }
        }
        if (jobs.putIfAbsent(id, job) != null) { job.cancel(); return }
        mutableState.update { it.copy(busy = true) }
        job.start()
    }

    private fun progress(id: String, done: Long, total: Long?) {
        mutableState.update { it.copy(progress = it.progress + (id to TransferProgress(done, total))) }
    }
}
