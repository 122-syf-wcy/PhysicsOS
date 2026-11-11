package com.physicsos.student.feature.chat

import android.content.Context
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.feature.files.AttachmentKind
import com.physicsos.student.feature.files.AttachmentPolicy
import com.physicsos.student.feature.files.CropArea
import com.physicsos.student.feature.files.FileActionsController
import com.physicsos.student.feature.files.FileOperationException
import com.physicsos.student.feature.files.FileProblem
import com.physicsos.student.feature.files.IntakeLimits
import com.physicsos.student.feature.files.PreparedAttachment
import com.physicsos.student.feature.files.TransferProgress
import com.physicsos.student.feature.files.UploadStatus
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal enum class ChatConnection { OFFLINE, BACKGROUND, CONNECTING, RECOVERING, LIVE, AUTH_REQUIRED, UNAVAILABLE }
internal enum class ChatIssue { NETWORK, AUTH, FORBIDDEN, NOT_FOUND, RATE_LIMIT, SERVER, PROTOCOL, CACHE, CREATE_UNCERTAIN, INPUT_TOO_LONG, RETRY_AFTER_SYNC, QUEUE_CHANGED, ARCHIVE_ACTIVE }
internal data class ChatUiState(
    val sessionId: String? = null,
    val title: String? = null,
    val sessions: List<SessionListItem> = emptyList(),
    val draft: ChatDraft = ChatDraft(UUID.randomUUID().toString()),
    val rows: List<ChatRow> = emptyList(),
    val queue: List<QueueEntry> = emptyList(),
    val pending: List<PromptTicket> = emptyList(),
    val connection: ChatConnection = ChatConnection.BACKGROUND,
    val online: Boolean = false,
    val initialized: Boolean = false,
    val loadingDirectory: Boolean = true,
    val loadingHistory: Boolean = false,
    val hasMore: Boolean = false,
    val running: Boolean = false,
    val turnOutcome: String? = null,
    val submitting: Boolean = false,
    val creating: Boolean = false,
    val importing: Boolean = false,
    val cancelRequested: Boolean = false,
    val issue: ChatIssue? = null,
    val unknownEvents: Boolean = false,
    val limits: IntakeLimits = IntakeLimits(),
    val uploads: Map<String, TransferProgress> = emptyMap(),
    val queueBusy: Set<String> = emptySet(),
    val searchQuery: String = "",
    val searchHits: Map<String, String>? = null,
    val searchHasMore: Boolean = false,
    val searching: Boolean = false,
) {
    val archived: Boolean get() = sessions.firstOrNull { it.id == sessionId }?.archived == true
}

internal class ChatViewModel(
    context: Context,
    private val graph: AppGraph,
    private val savedState: SavedStateHandle,
    val owner: String,
    initialSessionId: String?,
    private val initialText: String?,
) : ViewModel() {
    val files = FileActionsController(context, graph, owner, viewModelScope)
    private val cache = ChatCache(graph.store, owner)
    private val prompts = PromptJournal(LocalPromptStorage(graph.store, owner))
    private var journal = ChatJournal()
    private val journalMutex = Mutex()
    private val selectionMutex = Mutex()
    private val createMutex = Mutex()
    private val submitMutex = Mutex()
    private val mutableState = MutableStateFlow(ChatUiState(sessionId = savedState.get<String>(ACTIVE_SESSION)?.takeUnless { it == NEW_SESSION } ?: initialSessionId))
    val state = mutableState.asStateFlow()
    private var foreground = false
    private var ready = false
    private var generation = 0L
    private var connectionJob: Job? = null
    private var recoveryJob: Job? = null
    private var gapJob: Job? = null
    private var refreshJob: Job? = null
    private var draftJob: Job? = null
    private var searchJob: Job? = null
    private var importJob: Job? = null
    private val uploadJobs = ConcurrentHashMap<String, Job>()
    private var freshSnapshot = CompletableDeferred<Unit>()
    private var openingReceived = false
    private var archivedIds = emptySet<String>()
    private var directoryRaw = JsonObject(mapOf("items" to JsonArray(emptyList())))
    private val directoryWatermarks = HashMap<String, Long>()
    private val publish = Channel<Unit>(Channel.CONFLATED)
    private val persist = Channel<Unit>(Channel.CONFLATED)

    init {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                requireOwner()
                prompts.recoverInterrupted()
                mutableState.update { it.copy(sessions = cache.sessions(), loadingDirectory = false) }
                var id = state.value.sessionId
                val creation = cache.creationState()
                if (id == null && creation?.string("status") == "created") id = creation.string("sessionId")
                loadLocal(id, useInitialText = true)
                if (creation != null && creation.string("status") != "created") mutableState.update { it.copy(issue = ChatIssue.CREATE_UNCERTAIN) }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error, local = true) }
            finally {
                ready = true
                mutableState.update { it.copy(initialized = true, loadingDirectory = false) }
                startConnection()
            }
        }
        viewModelScope.launch {
            networkAvailability(context).collect { available ->
                mutableState.update { it.copy(online = available) }
                if (available) { startConnection(); if (foreground) refreshSessions() }
                else { stopConnection(); mutableState.update { it.copy(connection = ChatConnection.OFFLINE) } }
            }
        }
        viewModelScope.launch {
            graph.auth.state.collect { auth ->
                if (auth !is AuthState.SignedIn || !files.isOwner()) {
                    stopConnection()
                    uploadJobs.values.forEach { it.cancel() }
                    importJob?.cancel()
                    mutableState.value = ChatUiState(initialized = true, loadingDirectory = false, connection = ChatConnection.AUTH_REQUIRED)
                } else startConnection()
            }
        }
        viewModelScope.launch(Dispatchers.Default) {
            for (ignored in publish) {
                delay(48)
                journalMutex.withLock { publishJournal() }
            }
        }
        viewModelScope.launch(Dispatchers.IO) {
            for (ignored in persist) {
                delay(500)
                try { saveHistory() }
                catch (error: CancellationException) { throw error }
                catch (error: Exception) { report(error, local = true) }
            }
        }
    }

    fun setForeground(active: Boolean) {
        if (foreground == active) return
        foreground = active
        if (active) { startConnection(); refreshSessions() }
        else {
            stopConnection()
            files.pause()
            uploadJobs.values.forEach { it.cancel() }
            mutableState.update { it.copy(connection = ChatConnection.BACKGROUND) }
            viewModelScope.launch(Dispatchers.IO) {
                try { requireOwner(); saveDraft(); saveHistory() }
                catch (error: CancellationException) { throw error }
                catch (error: Exception) { report(error, local = true) }
            }
        }
    }

    fun reconnect() { startConnection(force = true); refreshSessions() }
    fun dismissIssue() { mutableState.update { it.copy(issue = null) } }

    fun selectSession(id: String?) {
        if (state.value.submitting) return
        viewModelScope.launch(Dispatchers.IO) {
            selectionMutex.withLock {
                stopConnection()
                importJob?.cancelAndJoin()
                uploadJobs.values.toList().forEach { it.cancelAndJoin() }
                try {
                    requireOwner()
                    saveDraft()
                    saveHistory()
                    loadLocal(id, useInitialText = false)
                    cache.clearCreation()
                    startConnection(force = true)
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) { report(error) }
            }
        }
    }

    fun updateText(text: String) {
        mutableState.update { current ->
            current.copy(draft = current.draft.copy(text = text), issue = if (text.length > MAX_TEXT_CHARS) ChatIssue.INPUT_TOO_LONG else current.issue?.takeUnless { it == ChatIssue.INPUT_TOO_LONG })
        }
        scheduleDraft()
    }

    fun quote(markdown: String) {
        val quotation = markdown.lineSequence().joinToString("\n") { "> $it" }
        updateText(listOf(state.value.draft.text, quotation).filter { it.isNotBlank() }.joinToString("\n\n") + "\n\n")
    }

    fun importUri(uri: Uri, captureToken: String? = null) {
        if (state.value.importing || state.value.submitting) return
        val draftId = state.value.draft.id
        mutableState.update { it.copy(importing = true) }
        importJob = viewModelScope.launch(Dispatchers.IO) {
            try {
                requireOwner()
                if (state.value.draft.attachments.size >= AttachmentPolicy.MAX_ATTACHMENTS) throw FileOperationException(FileProblem.TOO_MANY)
                val attachment = files.intake.stage(uri, state.value.limits)
                requireOwner()
                if (state.value.draft.id != draftId) { files.intake.remove(attachment); return@launch }
                val images = state.value.draft.attachments.count { it.kind == AttachmentKind.IMAGE }
                if (attachment.kind == AttachmentKind.IMAGE && images >= state.value.limits.maxImages) {
                    files.intake.remove(attachment); throw FileOperationException(FileProblem.TOO_MANY)
                }
                mutableState.update { it.copy(draft = it.draft.copy(attachments = it.draft.attachments + attachment)) }
                saveDraft()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { files.report(error) }
            finally {
                captureToken?.let { withContext(NonCancellable) { files.removeCapture(it) } }
                mutableState.update { it.copy(importing = false) }
            }
        }
    }

    fun cancelImport() { importJob?.cancel() }

    fun removeAttachment(attachment: PreparedAttachment) {
        if (state.value.submitting) return
        uploadJobs[attachment.id]?.cancel()
        mutableState.update { it.copy(draft = it.draft.copy(attachments = it.draft.attachments.filterNot { item -> item.id == attachment.id })) }
        viewModelScope.launch(Dispatchers.IO) {
            try { saveDraft(); files.intake.remove(attachment) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { files.report(error) }
        }
    }

    fun crop(attachment: PreparedAttachment, crop: CropArea, turns: Int) {
        if (state.value.submitting) return
        mutableState.update { it.copy(importing = true) }
        importJob = viewModelScope.launch(Dispatchers.IO) {
            try {
                val updated = files.intake.crop(attachment, crop, turns, state.value.limits)
                requireOwner()
                updateAttachment(updated)
                saveDraft()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { files.report(error) }
            finally { mutableState.update { it.copy(importing = false) } }
        }
    }

    fun uploadAttachment(attachment: PreparedAttachment) {
        if (state.value.submitting || uploadJobs.containsKey(attachment.id)) return
        val job = viewModelScope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try {
                val id = ensureSession()
                uploadOne(id, attachment)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { files.report(error) }
            finally { uploadJobs.remove(attachment.id) }
        }
        if (uploadJobs.putIfAbsent(attachment.id, job) != null) { job.cancel(); return }
        job.start()
    }

    fun cancelUpload(id: String) { uploadJobs[id]?.cancel() }

    fun send(mode: String = "queue") {
        if (state.value.submitting || state.value.importing || state.value.archived) return
        if (state.value.draft.text.length > MAX_TEXT_CHARS) { mutableState.update { it.copy(issue = ChatIssue.INPUT_TOO_LONG) }; return }
        if (state.value.draft.text.isBlank() && state.value.draft.attachments.isEmpty()) return
        mutableState.update { it.copy(submitting = true, issue = null) }
        viewModelScope.launch(Dispatchers.IO) {
            submitMutex.withLock {
                try {
                    requireOwner()
                    if (!state.value.online) throw IOException("offline")
                    val id = ensureSession()
                    for (attachment in state.value.draft.attachments) {
                        uploadJobs[attachment.id]?.join()
                        val latest = state.value.draft.attachments.firstOrNull { it.id == attachment.id } ?: continue
                        if (latest.kind != AttachmentKind.IMAGE && (latest.receiptSessionId != id || latest.upload != UploadStatus.UPLOADED)) {
                            val job = currentCoroutineContext()[Job]!!
                            uploadJobs[latest.id] = job
                            try { uploadOne(id, latest) } finally { uploadJobs.remove(latest.id, job) }
                        }
                    }
                    val draft = state.value.draft
                    val base = journalMutex.withLock { journal.cursor }
                    val ticket = prompts.prepare(id, draft, mode, base)
                    deliver(ticket, explicitRetry = false)
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) { report(error) }
                finally { mutableState.update { it.copy(submitting = false) }; refreshPending() }
            }
        }
    }

    fun retry(ticket: PromptTicket) {
        if (state.value.submitting) return
        mutableState.update { it.copy(submitting = true, issue = null) }
        viewModelScope.launch(Dispatchers.IO) {
            submitMutex.withLock {
                try {
                    requireOwner()
                    if (!state.value.online || !foreground) throw IOException("offline")
                    startConnection(force = true)
                    val baseline = freshSnapshot
                    withTimeout(30_000) { baseline.await() }
                    val known = journalMutex.withLock { journal.knownRequestIds }
                    prompts.reconcile(ticket.sessionId, known)
                    if (ticket.requestId !in known) {
                        var retryTicket = ticket
                        if (ticket.errorCode == "FILE_NOT_STAGED") {
                            val refreshed = ticket.attachments.map { attachment ->
                                if (attachment.kind == AttachmentKind.IMAGE) attachment
                                else files.transfers.upload(ticket.sessionId, attachment, files.intake) { done, total -> uploadProgress(attachment.id, done, total) }
                            }
                            retryTicket = prompts.attachments(ticket, refreshed)
                        }
                        deliver(retryTicket, explicitRetry = true)
                    }
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) { report(error) }
                finally { mutableState.update { it.copy(submitting = false, uploads = emptyMap()) }; refreshPending() }
            }
        }
    }

    fun discardPending(ticket: PromptTicket) {
        viewModelScope.launch(Dispatchers.IO) { prompts.discard(ticket); refreshPending() }
    }

    fun cancelGeneration() {
        val id = state.value.sessionId ?: return
        if (!state.value.running || state.value.cancelRequested) return
        mutableState.update { it.copy(cancelRequested = true) }
        viewModelScope.launch(Dispatchers.IO) {
            try { requireOwner(); requireAccepted(graph.api.rpc("session/cancel", sessionRequest(id))) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { mutableState.update { it.copy(cancelRequested = false) }; report(error) }
        }
    }

    fun updateQueue(entry: QueueEntry, kind: String, replacement: String? = null) {
        val id = state.value.sessionId ?: return
        if (entry.id in state.value.queueBusy) return
        mutableState.update { it.copy(queueBusy = it.queueBusy + entry.id) }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                requireOwner()
                val action = buildJsonObject {
                    put("kind", kind)
                    if (kind == "edit") {
                        require(!replacement.isNullOrBlank())
                        put("content", JsonArray(listOf(buildJsonObject { put("type", "text"); put("text", replacement) })))
                    }
                }
                requireAccepted(graph.api.rpc("session/updateQueue", buildJsonObject {
                    put("sessionId", id); put("itemId", entry.id); put("action", action)
                }))
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
            finally { mutableState.update { it.copy(queueBusy = it.queueBusy - entry.id) } }
        }
    }

    fun rename(id: String, title: String) {
        if (title.isBlank()) return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                requireOwner()
                val accepted = graph.api.rpc("session/rename", buildJsonObject { put("sessionId", id); put("title", title) }) as? JsonObject ?: fail("rename_response")
                val normalized = accepted.requiredString("title")
                mutableState.update { it.copy(sessions = it.sessions.map { row -> if (row.id == id) row.copy(title = normalized) else row }, title = if (it.sessionId == id) normalized else it.title) }
                refreshSessions()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
        }
    }

    fun archive(id: String, restore: Boolean = false, stopActivity: Boolean = false) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                requireOwner()
                val result = graph.api.rpc(if (restore) "workspace/unarchiveSession" else "workspace/archiveSession", buildJsonObject {
                    put("sessionId", id)
                    if (!restore) put("stopActivity", stopActivity)
                }) as? JsonObject ?: fail("archive_response")
                applyArchived(result.requiredArray("archivedSessionIds"))
                refreshSessions()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
        }
    }

    fun search(query: String) {
        searchJob?.cancel()
        mutableState.update { it.copy(searchQuery = query, searchHits = null, searchHasMore = false, searching = query.isNotBlank() && it.online) }
        if (query.isBlank() || !state.value.online) return
        searchJob = viewModelScope.launch(Dispatchers.IO) {
            delay(300)
            try {
                requireOwner()
                val result = graph.api.rpc("session/search", buildJsonObject { put("query", query) }) as? JsonObject ?: fail("search_response")
                val hits = result.requiredArray("items").associate { item ->
                    val row = item as? JsonObject ?: fail("search_item")
                    row.requiredString("sessionId") to row.requiredString("snippet")
                }
                mutableState.update { if (it.searchQuery == query) it.copy(searchHits = hits, searchHasMore = result.bool("hasMore") == true, searching = false) else it }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error); mutableState.update { it.copy(searching = false) } }
        }
    }

    fun refreshSessions() {
        if (!ready || !foreground || !state.value.online || refreshJob?.isActive == true || !files.isOwner()) return
        refreshJob = viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { it.copy(loadingDirectory = true) }
            try {
                val response = graph.api.rpc("session/list", JsonObject(emptyMap())) as? JsonObject ?: fail("list_response")
                requireOwner()
                directoryRaw = response
                val list = SessionProtocol.list(response, archivedIds)
                mutableState.update { it.copy(sessions = list, loadingDirectory = false) }
                persistDirectory()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
            finally { mutableState.update { it.copy(loadingDirectory = false) } }
        }
    }

    fun loadOlder() { recoverHistory(manual = true) }

    private suspend fun deliver(ticket: PromptTicket, explicitRetry: Boolean) {
        val request = promptRequest(ticket, files.intake, state.value.limits)
        val sending = prompts.begin(ticket, explicitRetry) ?: run { refreshPending(); return }
        try {
            requireOwner()
            requireAccepted(graph.api.rpc("session/prompt", request))
            requireOwner()
            prompts.accepted(sending)
            if (state.value.sessionId == ticket.sessionId && state.value.draft.id == ticket.draftId) {
                val empty = ChatDraft(UUID.randomUUID().toString())
                cache.saveDraft(ticket.sessionId, empty)
                mutableState.update { it.copy(draft = empty) }
            }
        } catch (error: CancellationException) {
            withContext(NonCancellable) { if (files.isOwner()) prompts.failed(sending, "request_cancelled", uncertain = true) }
            throw error
        } catch (error: Exception) {
            if (files.isOwner()) {
                val code = (error as? ApiException)?.details?.string("reason") ?: (error as? ApiException)?.code ?: "network_unavailable"
                val definitelyRejected = error is ApiException && (error.status in setOf(400, 401, 403, 404, 413, 415, 422, 429) ||
                    error.code in setOf("session/attachment-invalid", "session/invalid-time-zone", "gateway/bad-request"))
                prompts.failed(sending, code, uncertain = !definitelyRejected)
            }
            throw error
        } finally { refreshPending() }
    }

    private suspend fun uploadOne(sessionId: String, attachment: PreparedAttachment): PreparedAttachment {
        updateAttachment(attachment.copy(upload = UploadStatus.UPLOADING))
        saveDraft()
        try {
            val uploaded = files.transfers.upload(sessionId, attachment, files.intake) { done, total -> uploadProgress(attachment.id, done, total) }
            updateAttachment(uploaded)
            saveDraft()
            return uploaded
        } catch (error: CancellationException) {
            withContext(NonCancellable) {
                if (files.isOwner()) { updateAttachment(attachment.copy(upload = UploadStatus.PAUSED)); saveDraft() }
            }
            throw error
        } catch (error: Exception) {
            if (files.isOwner()) { updateAttachment(attachment.copy(upload = UploadStatus.FAILED)); saveDraft() }
            throw error
        } finally { mutableState.update { it.copy(uploads = it.uploads - attachment.id) } }
    }

    private suspend fun ensureSession(): String = createMutex.withLock {
        state.value.sessionId?.let { return@withLock it }
        requireOwner()
        val pending = cache.creationState()
        if (pending != null) {
            pending.string("sessionId")?.takeIf { pending.string("status") == "created" }?.let { return@withLock it }
            throw SessionProtocolException("create_uncertain")
        }
        mutableState.update { it.copy(creating = true) }
        cache.saveCreation(buildJsonObject { put("status", "sending"); put("draftId", state.value.draft.id) })
        try {
            val result = graph.api.rpc("session/create", JsonObject(emptyMap())) as? JsonObject ?: fail("create_response")
            requireOwner()
            val id = result.requiredString("sessionId")
            cache.saveCreation(buildJsonObject { put("status", "created"); put("sessionId", id) })
            cache.saveDraft(id, state.value.draft)
            withContext(Dispatchers.Main.immediate) { savedState[ACTIVE_SESSION] = id }
            mutableState.update { it.copy(sessionId = id) }
            cache.clearDraft(null)
            cache.clearCreation()
            startConnection(force = true)
            refreshSessions()
            id
        } catch (error: Exception) {
            // Student policy strips client-supplied sessionId, so create is NOT safely auto-retryable.
            if (files.isOwner()) mutableState.update { it.copy(issue = ChatIssue.CREATE_UNCERTAIN) }
            throw error
        } finally { mutableState.update { it.copy(creating = false) } }
    }

    private suspend fun loadLocal(id: String?, useInitialText: Boolean) {
        val savedDraft = cache.draft(id)
        val draft = (savedDraft ?: ChatDraft(UUID.randomUUID().toString(), if (useInitialText) initialText.orEmpty() else "")).let {
            it.copy(attachments = it.attachments.map { attachment ->
                if (attachment.upload == UploadStatus.UPLOADING) attachment.copy(upload = UploadStatus.PAUSED) else attachment
            })
        }
        val restored = try { if (id != null) cache.load(id) else null }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { mutableState.update { it.copy(issue = ChatIssue.CACHE) }; null }
        requireOwner()
        journalMutex.withLock { journal = restored ?: ChatJournal() }
        withContext(Dispatchers.Main.immediate) { savedState[ACTIVE_SESSION] = id ?: NEW_SESSION }
        mutableState.update { it.copy(sessionId = id, draft = draft, rows = emptyList(), queue = emptyList(), pending = emptyList(), uploads = emptyMap(), title = null, running = false, cancelRequested = false, hasMore = false, loadingHistory = false) }
        cache.saveDraft(id, draft)
        journalMutex.withLock { publishJournal() }
        refreshPending()
    }

    @Synchronized
    private fun startConnection(force: Boolean = false) {
        if (!ready || !foreground || !state.value.online || !files.isOwner()) return
        if (!force && connectionJob?.isActive == true) return
        stopConnection()
        val token = generation
        val id = state.value.sessionId
        val readySignal = CompletableDeferred<Unit>()
        freshSnapshot = readySignal
        openingReceived = false
        directoryWatermarks.clear()
        connectionJob = viewModelScope.launch(Dispatchers.Default) {
            var attempt = 0
            var refreshedAuth = false
            while (isActive && token == generation && foreground && state.value.online && files.isOwner()) {
                mutableState.update { it.copy(connection = if (attempt == 0) ChatConnection.CONNECTING else ChatConnection.RECOVERING) }
                val watchdog = launch {
                    delay(20_000)
                    if (!openingReceived && id != null) connectionJob?.cancel(CancellationException("snapshot_timeout"))
                }
                try {
                    SessionMux(graph.api).follow(id).collect { event ->
                        if (token != generation || !files.isOwner()) return@collect
                        when (event) {
                            StreamEvent.Connected -> if (id == null) { mutableState.update { it.copy(connection = ChatConnection.LIVE) }; readySignal.complete(Unit) }
                            is StreamEvent.Frame -> when (event.source) {
                                StreamSource.SESSION -> {
                                    if (id == null) fail("unexpected_session")
                                    when (event.value.string("type")) {
                                        "snapshot" -> {
                                            val pending = prompts.list(id).filter { it.status in setOf(PromptStatus.SENDING, PromptStatus.UNCERTAIN, PromptStatus.ACCEPTED) }
                                            val floor = pending.minOfOrNull { it.baseSeq }
                                            journalMutex.withLock { journal.replace(SessionProtocol.snapshot(event.value, id), floor) }
                                            openingReceived = true
                                            attempt = 0
                                            watchdog.cancel()
                                            recoverHistory()
                                        }
                                        "event" -> journalMutex.withLock { if (!openingReceived) fail("event_before_snapshot"); journal.accept(SessionProtocol.event(event.value)) }
                                        "assistant-stream" -> journalMutex.withLock { if (!openingReceived) fail("assistant_before_snapshot"); journal.acceptAssistant(event.value.requiredObject("frame")) }
                                        else -> fail("follow_frame_type")
                                    }
                                    afterJournalUpdate()
                                }
                                StreamSource.WORKSPACE -> handleWorkspace(event.value)
                                StreamSource.CONTROL -> handleControl(event.value)
                            }
                        }
                    }
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) {
                    recoveryJob?.cancel()
                    if (error is ApiException && error.status == 401) {
                        if (refreshedAuth) {
                            mutableState.update { it.copy(connection = ChatConnection.AUTH_REQUIRED, issue = ChatIssue.AUTH) }
                            readySignal.completeExceptionally(error)
                            break
                        }
                        refreshedAuth = true
                        try { graph.auth.refreshUser() }
                        catch (failure: CancellationException) { throw failure }
                        catch (failure: Exception) { report(failure); readySignal.completeExceptionally(failure); break }
                    } else if (error is SessionProtocolException && error.reason == "unsupported_session_version") {
                        report(error); readySignal.completeExceptionally(error); break
                    }
                    mutableState.update { it.copy(connection = ChatConnection.RECOVERING) }
                } finally { watchdog.cancel() }
                delay(reconnectDelayMillis(attempt++, Random.nextLong(0, 501)))
                openingReceived = false
            }
        }
    }

    @Synchronized
    private fun stopConnection() {
        generation += 1
        connectionJob?.cancel()
        connectionJob = null
        recoveryJob?.cancel(); recoveryJob = null
        gapJob?.cancel(); gapJob = null
        freshSnapshot.cancel()
        openingReceived = false
    }

    private suspend fun afterJournalUpdate() {
        val facts = journalMutex.withLock { Triple(journal.knownRequestIds, journal.needsOlder, journal.hasGap) }
        state.value.sessionId?.let { prompts.reconcile(it, facts.first) }
        if (facts.second) recoverHistory()
        if (facts.third && gapJob?.isActive != true) gapJob = viewModelScope.launch {
            delay(750)
            if (journalMutex.withLock { journal.hasGap }) startConnection(force = true)
        }
        if (!facts.second && !facts.third && openingReceived) {
            mutableState.update { it.copy(connection = ChatConnection.LIVE) }
            freshSnapshot.complete(Unit)
        } else mutableState.update { it.copy(connection = ChatConnection.RECOVERING) }
        publish.trySend(Unit)
        persist.trySend(Unit)
        refreshPending()
    }

    private fun recoverHistory(manual: Boolean = false) {
        if (recoveryJob?.isActive == true || !openingReceived) return
        val id = state.value.sessionId ?: return
        val token = generation
        recoveryJob = viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { it.copy(loadingHistory = true) }
            try {
                var forcePage = manual
                while (token == generation && files.isOwner()) {
                    val request = journalMutex.withLock {
                        if (!journal.hasMore || (!forcePage && !journal.needsOlder)) null
                        else SessionProtocol.pageRequest(id, journal.throughSeq, journal.firstSeq)
                    } ?: break
                    forcePage = false
                    val result = graph.api.rpc("session/page", request)
                    val page = SessionProtocol.page(result, request.requiredNumber("beforeSeq"), request.requiredNumber("throughSeq"))
                    if (token != generation) return@launch
                    journalMutex.withLock { journal.prepend(page) }
                    afterJournalUpdate()
                }
                afterJournalUpdate()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error); freshSnapshot.completeExceptionally(error) }
            finally { mutableState.update { it.copy(loadingHistory = false) } }
        }
    }

    private suspend fun handleWorkspace(frame: JsonObject) {
        when (frame.string("type")) {
            "baseline" -> applyArchived(frame.requiredObject("value").requiredArray("archivedSessionIds"))
            "archived" -> applyArchived(frame.requiredArray("archivedSessionIds"))
            "upsert", "remove" -> refreshSessions()
        }
    }

    private suspend fun applyArchived(ids: JsonArray) {
        archivedIds = ids.map { (it as? JsonPrimitive)?.content ?: fail("archive_id") }.toSet()
        mutableState.update { it.copy(sessions = it.sessions.map { row -> row.copy(archived = row.id in archivedIds) }) }
        persistDirectory()
    }

    private fun handleControl(frame: JsonObject) {
        when (frame.string("type")) {
            "baseline" -> frame.requiredObject("value").requiredObject("projections").forEach { (id, value) ->
                val baseline = value as? JsonObject ?: fail("control_baseline")
                baseline.requiredObject("values").forEach { (key, item) -> directoryProjection(id, key, baseline.requiredNumber("asOfSeq"), item) }
            }
            "projection" -> directoryProjection(frame.requiredString("sessionId"), frame.requiredString("key"), frame.requiredNumber("seq"), frame["value"] ?: JsonNull)
        }
    }

    private fun directoryProjection(id: String, key: String, seq: Long, value: kotlinx.serialization.json.JsonElement) {
        val watermark = "$id\u0000$key"
        if (seq < (directoryWatermarks[watermark] ?: -1)) return
        directoryWatermarks[watermark] = seq
        if (state.value.sessions.none { it.id == id }) { refreshSessions(); return }
        mutableState.update { current -> current.copy(sessions = current.sessions.map { row ->
            if (row.id != id) row else when (key) {
                "title" -> row.copy(title = (value as? JsonPrimitive)?.takeIf { it.isString }?.content)
                "turnBoundary" -> row.copy(running = (value as? JsonObject)?.get("openTurnStartSeq")?.let { it != JsonNull } == true)
                "sessionListMetadata" -> row.copy(updatedAt = (value as? JsonObject)?.number("lastPromptAt") ?: row.updatedAt, blank = (value as? JsonObject)?.bool("blank") ?: row.blank)
                else -> row
            }
        }.sortedByDescending { it.updatedAt }) }
    }

    private suspend fun persistDirectory() {
        requireOwner()
        cache.saveSessions(JsonObject(directoryRaw + ("archived" to JsonArray(archivedIds.map(::JsonPrimitive)))))
    }

    private fun publishJournal() {
        if (!files.isOwner()) return
        mutableState.update { it.copy(
            rows = journal.rows(), queue = journal.queue, hasMore = journal.hasMore,
            title = journal.title ?: it.sessions.firstOrNull { row -> row.id == it.sessionId }?.title,
            running = journal.running, turnOutcome = journal.turnOutcome,
            cancelRequested = if (journal.running) it.cancelRequested else false,
            limits = AttachmentPolicy.limits(journal.projections.obj("imageLimits")),
            unknownEvents = journal.unknownEventTypes.isNotEmpty(),
        ) }
    }

    private suspend fun refreshPending() {
        if (!files.isOwner()) return
        val id = state.value.sessionId ?: return
        val pending = prompts.list(id).filter { it.status !in setOf(PromptStatus.CONFIRMED, PromptStatus.DISCARDED) }
        mutableState.update { if (it.sessionId == id) it.copy(pending = pending) else it }
    }

    private fun updateAttachment(attachment: PreparedAttachment) {
        mutableState.update { it.copy(draft = it.draft.copy(attachments = it.draft.attachments.map { old -> if (old.id == attachment.id) attachment else old })) }
    }
    private fun uploadProgress(id: String, done: Long, total: Long) {
        mutableState.update { it.copy(uploads = it.uploads + (id to TransferProgress(done, total))) }
    }
    private fun scheduleDraft() {
        draftJob?.cancel()
        draftJob = viewModelScope.launch(Dispatchers.IO) {
            delay(180)
            try { saveDraft() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error, local = true) }
        }
    }
    private suspend fun saveDraft() { requireOwner(); val state = state.value; cache.saveDraft(state.sessionId, state.draft) }
    private suspend fun saveHistory() {
        requireOwner()
        journalMutex.withLock { state.value.sessionId?.let { cache.save(it, journal) } }
    }
    private fun requireOwner() = files.requireOwner()

    private fun report(error: Exception, local: Boolean = false) {
        if (error is FileOperationException) { files.report(error); return }
        val issue = when {
            local -> ChatIssue.CACHE
            error is ApiException -> when {
                error.status == 401 -> ChatIssue.AUTH
                error.status == 403 -> ChatIssue.FORBIDDEN
                error.status == 404 || error.code == "session/not-found" -> ChatIssue.NOT_FOUND
                error.status == 429 -> ChatIssue.RATE_LIMIT
                error.code in setOf("session/queue-item-not-found", "session/steer-unavailable") -> ChatIssue.QUEUE_CHANGED
                error.code == "workspace/session-active" -> ChatIssue.ARCHIVE_ACTIVE
                error.status == 0 -> ChatIssue.NETWORK
                else -> ChatIssue.SERVER
            }
            error is SessionProtocolException -> if (error.reason == "create_uncertain") ChatIssue.CREATE_UNCERTAIN else ChatIssue.PROTOCOL
            error is IOException -> ChatIssue.NETWORK
            else -> ChatIssue.SERVER
        }
        mutableState.update { it.copy(issue = issue, connection = if (issue == ChatIssue.AUTH) ChatConnection.AUTH_REQUIRED else it.connection) }
    }

    companion object {
        const val MAX_TEXT_CHARS = 200_000
        private const val ACTIVE_SESSION = "chat.active-session"
        private const val NEW_SESSION = "__new__"
    }
}

private fun sessionRequest(id: String) = buildJsonObject { put("sessionId", id) }
private fun requireAccepted(value: kotlinx.serialization.json.JsonElement) {
    if ((value as? JsonObject)?.bool("accepted") != true) fail("missing_admission_receipt")
}
