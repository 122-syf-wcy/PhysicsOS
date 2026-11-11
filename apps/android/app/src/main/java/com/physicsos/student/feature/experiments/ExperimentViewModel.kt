package com.physicsos.student.feature.experiments

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.ExperimentInfo
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.experiments.bridge.BridgeProtocolException
import com.physicsos.student.feature.experiments.bridge.BridgeLimits
import com.physicsos.student.feature.experiments.bridge.StrictBridgeJson
import com.physicsos.student.feature.experiments.bridge.LabCheckpoint
import com.physicsos.student.feature.experiments.bridge.LabContent
import com.physicsos.student.feature.experiments.bridge.LabExportFormat
import com.physicsos.student.feature.experiments.bridge.LabIncoming
import com.physicsos.student.feature.experiments.bridge.LabLoad
import com.physicsos.student.feature.experiments.bridge.LabSummary
import com.physicsos.student.feature.experiments.bridge.LabWebViewController
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal data class ExperimentState(
    val sceneId: String,
    val owner: String? = null,
    val title: String = "",
    val loading: Boolean = true,
    val entry: ExperimentEntry? = null,
    val summary: LabSummary? = null,
    val operation: OutboxItem? = null,
    val problem: ExperimentProblem? = null,
    val checkpointProblem: ExperimentProblem? = null,
    val persistedAt: Long? = null,
    val hasCheckpoint: Boolean = false,
    val saving: Boolean = false,
    val exporting: Boolean = false,
    val resolving: Boolean = false,
    val leaving: Boolean = false,
    val exitNeedsConfirmation: Boolean = false,
    val accountChanged: Boolean = false,
    val legacySceneOnly: Boolean = false,
)

internal sealed interface ExperimentEvent {
    data object Back : ExperimentEvent
    data class SavedLocally(val account: ExperimentAccount) : ExperimentEvent
    data class Share(val account: ExperimentAccount, val file: SharedLabFile) : ExperimentEvent
    data class Document(val account: ExperimentAccount, val title: String, val markdown: String) : ExperimentEvent
    data class Problem(val problem: ExperimentProblem) : ExperimentEvent
}

internal class ExperimentViewModel(
    private val graph: AppGraph,
    context: Context,
    private val savedState: SavedStateHandle,
    private val templateId: String?,
    private val requestedSceneId: String?,
) : ViewModel() {
    private val appContext = context.applicationContext
    private lateinit var repository: ExperimentRepository
    private var account: ExperimentAccount? = null
    private fun requireAccount(): ExperimentAccount = account?.takeIf {
        !_state.value.accountChanged && graph.auth.state.value.experimentAccount() == it
    } ?: throw ApiException(0, "account_changed", "Account changed.")
    private val files = ExperimentFiles(appContext)
    private val _state = MutableStateFlow(ExperimentState(sceneId = savedState["sceneId"] ?: requestedSceneId ?: UUID.randomUUID().toString()))
    val state = _state.asStateFlow()
    private val _renderer = MutableStateFlow<LabWebViewController?>(null)
    val renderer = _renderer.asStateFlow()
    private val eventChannel = Channel<ExperimentEvent>(Channel.BUFFERED)
    val events = eventChannel.receiveAsFlow()
    private var template: ExperimentInfo? = null
    private var latestCheckpoint: LabCheckpoint? = null
    private var checkpointOrder = System.currentTimeMillis()
    private var observeJob: Job? = null
    private var initialization: Job? = null
    private var exportJob: Job? = null
    private var exitJob: Job? = null
    private var initialized = false
    private var cleared = false
    private data class PendingCheckpoint(
        val owner: String, val sceneId: String, val checkpoint: LabCheckpoint,
        val title: String, val template: ExperimentInfo?,
    )
    private val autoSaves = Channel<PendingCheckpoint>(capacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val persistence = Mutex()

    init {
        savedState["sceneId"] = _state.value.sceneId
        viewModelScope.launch {
            for (snapshot in autoSaves) {
                persist(snapshot, nonCancellable = true)
            }
        }
        initialize()
        viewModelScope.launch {
            graph.auth.state.collect { auth ->
                val bound = account ?: return@collect
                if (bound != auth.experimentAccount()) {
                    initialization?.cancel()
                    observeJob?.cancel()
                    exportJob?.cancel()
                    _renderer.value?.close()
                    _renderer.value = null
                    latestCheckpoint = null
                    _state.update { it.copy(accountChanged = true, summary = null, entry = null, hasCheckpoint = false, loading = false) }
                }
            }
        }
    }

    fun initialize() {
        if (initialization?.isActive == true || initialized || cleared) return
        initialization = viewModelScope.launch {
            _state.update { it.copy(loading = true, problem = null) }
            try {
                val auth = graph.auth.state.first { it !is AuthState.Restoring }
                val bound = auth.experimentAccount() ?: throw ApiException(0, "account_restoring", "Account restoration is in progress.")
                val owner = bound.owner
                val previousOwner = savedState.get<String>("owner")
                val previousUserId = savedState.get<String>("userId")
                if (previousOwner != null && (previousOwner != owner || previousUserId != bound.userId)) {
                    _state.update { it.copy(owner = previousOwner, accountChanged = true, loading = false) }
                    return@launch
                }
                account = bound
                repository = ExperimentRepository(graph, bound)
                savedState["owner"] = owner
                savedState["userId"] = bound.userId
                _state.update { it.copy(owner = owner) }
                val id = _state.value.sceneId
                val existing = repository.entry(owner, id)
                val load = if (existing != null || requestedSceneId != null || savedState.get<Boolean>("checkpointWritten") == true) {
                    repository.load(owner, id)
                } else {
                    val catalog = graph.catalog.experiments()
                    template = catalog.firstOrNull { it.id == templateId }
                        ?: throw ApiException(0, "experiment_template_missing", "This experiment is not in the installed catalog.")
                    LoadedExperiment(null, LabLoad(templateId = template!!.id), false)
                }
                if (template == null) {
                    val catalog = graph.catalog.experiments()
                    template = catalog.firstOrNull { it.id == load.entry?.templateId || it.id == templateId }
                }
                requireAccount()
                latestCheckpoint = load.load.checkpoint
                checkpointOrder = maxOf(checkpointOrder, load.entry?.updatedAt ?: 0)
                _state.update { it.copy(
                    entry = load.entry, title = load.entry?.title ?: template?.title.orEmpty(),
                    loading = false, hasCheckpoint = latestCheckpoint != null,
                    persistedAt = load.entry?.takeIf(ExperimentEntry::hasLocal)?.updatedAt,
                    legacySceneOnly = load.legacySceneOnly,
                ) }
                _renderer.value = LabWebViewController(appContext, LabContent.Experiment(load.load), ::incoming) { code -> issue(ExperimentProblem(code)) }
                initialized = true
                observe(owner, id)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { _state.update { it.copy(loading = false, problem = error.experimentProblem()) } }
        }
    }

    fun save() {
        val current = _state.value
        if (current.loading || current.saving || current.exporting || current.resolving || current.leaving || current.accountChanged) return
        val owner = current.owner ?: return
        viewModelScope.launch {
            _state.update { it.copy(saving = true) }
            try {
                val checkpoint = _renderer.value?.checkpoint() ?: throw BridgeProtocolException("CHECKPOINT_TIMEOUT")
                persistRequired(owner, current.sceneId, checkpoint)
                val saved = repository.save(owner, current.sceneId, checkpoint)
                requireAccount()
                _state.update { it.copy(entry = saved) }
                eventChannel.send(ExperimentEvent.SavedLocally(requireAccount()))
                if (owner != GUEST_EXPERIMENT_OWNER) {
                    try { graph.sync.syncNow() }
                    catch (error: CancellationException) { throw error }
                    catch (error: Exception) { issue(error.experimentProblem()) }
                }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { issue(error.experimentProblem()) }
            finally { _state.update { it.copy(saving = false) } }
        }
    }

    fun export(format: LabExportFormat, readReport: Boolean = false) {
        val current = _state.value
        if (current.loading || current.exporting || current.saving || current.resolving || current.leaving || current.accountChanged) return
        val owner = current.owner ?: return
        exportJob = viewModelScope.launch {
            _state.update { it.copy(exporting = true) }
            try {
                val renderer = _renderer.value ?: throw BridgeProtocolException("RENDERER_NOT_READY")
                val file = renderer.export(format)
                if (readReport) {
                    val markdown = withContext(Dispatchers.Default) {
                        file.bytes.toString(Charsets.UTF_8).also {
                            StrictBridgeJson.utf8Size(it, BridgeLimits.DOCUMENT_BYTES)
                            if (it.length > 1_000_000) throw BridgeProtocolException("MESSAGE_TOO_LARGE")
                        }
                    }
                    val checkpoint = renderer.checkpoint() ?: throw BridgeProtocolException("CHECKPOINT_TIMEOUT")
                    persistRequired(owner, current.sceneId, checkpoint)
                    renderer.releaseAfterCheckpoint()
                    eventChannel.send(ExperimentEvent.Document(requireAccount(), _state.value.title.take(300), markdown))
                } else {
                    val identity = requireAccount()
                    val shared = files.write(identity.toString(), file)
                    requireAccount()
                    eventChannel.send(ExperimentEvent.Share(identity, shared))
                }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { issue(error.experimentProblem()) }
            finally { _state.update { it.copy(exporting = false) } }
        }
    }

    fun retrySync() {
        val current = _state.value
        val owner = current.owner ?: return
        if (current.operation?.state == OutboxState.CONFLICT || current.accountChanged) return
        viewModelScope.launch {
            try { repository.retry(owner, current.sceneId, current.operation) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { issue(error.experimentProblem()) }
        }
    }

    fun useCloud(backupTitle: String) {
        val current = _state.value
        val owner = current.owner ?: return
        val operation = current.operation?.takeIf { it.state == OutboxState.CONFLICT } ?: return
        if (current.resolving || current.saving || current.exporting || current.leaving || current.accountChanged) return
        viewModelScope.launch {
            _state.update { it.copy(resolving = true) }
            try {
                val renderer = _renderer.value ?: throw BridgeProtocolException("RENDERER_NOT_READY")
                val fresh = renderer.checkpoint() ?: throw BridgeProtocolException("CHECKPOINT_TIMEOUT")
                persistRequired(owner, current.sceneId, fresh)
                renderer.pause()
                val loaded = persistence.withLock { repository.useCloud(owner, current.sceneId, operation, backupTitle) }
                requireAccount()
                latestCheckpoint = loaded.load.checkpoint
                _state.update { it.copy(entry = loaded.entry, title = loaded.entry?.title.orEmpty(), operation = null, legacySceneOnly = loaded.legacySceneOnly) }
                renderer.replaceExperiment(loaded.load)
                renderer.resume()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { _renderer.value?.resume(); issue(error.experimentProblem()) }
            finally { _state.update { it.copy(resolving = false) } }
        }
    }

    fun copyConflict(copyTitle: String) {
        val current = _state.value
        val owner = current.owner ?: return
        if (current.resolving || current.saving || current.exporting || current.leaving || current.accountChanged) return
        viewModelScope.launch {
            _state.update { it.copy(resolving = true) }
            try {
                val renderer = _renderer.value ?: throw BridgeProtocolException("RENDERER_NOT_READY")
                val checkpoint = renderer.checkpoint() ?: throw BridgeProtocolException("CHECKPOINT_TIMEOUT")
                persistRequired(owner, current.sceneId, checkpoint)
                val copyId = repository.copyLocal(owner, current.sceneId, owner, copyTitle)
                val loaded = repository.load(owner, copyId)
                val copyCheckpoint = loaded.load.checkpoint ?: throw BridgeProtocolException("CHECKPOINT_TIMEOUT")
                val saved = repository.save(owner, copyId, copyCheckpoint)
                requireAccount()
                savedState["sceneId"] = copyId
                savedState["checkpointWritten"] = true
                _state.update { it.copy(sceneId = copyId, title = saved.title, entry = saved, operation = null) }
                latestCheckpoint = copyCheckpoint
                observe(owner, copyId)
                renderer.replaceExperiment(loaded.load)
                eventChannel.send(ExperimentEvent.SavedLocally(requireAccount()))
                graph.sync.syncNow()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { issue(error.experimentProblem()) }
            finally { _state.update { it.copy(resolving = false) } }
        }
    }

    fun back() {
        if (exitJob?.isActive == true || _state.value.saving || _state.value.resolving) return
        exportJob?.cancel()
        val current = _state.value
        exitJob = viewModelScope.launch {
            _state.update { it.copy(leaving = true, exitNeedsConfirmation = false) }
            try {
                val renderer = _renderer.value
                if (current.accountChanged || renderer == null || (!current.hasCheckpoint && current.summary == null)) {
                    finishExit()
                    return@launch
                }
                val checkpoint = renderer.checkpoint() ?: throw BridgeProtocolException("CHECKPOINT_TIMEOUT")
                persistRequired(current.owner ?: throw BridgeProtocolException("ACCOUNT_UNAVAILABLE"), current.sceneId, checkpoint)
                finishExit()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                _state.update { it.copy(exitNeedsConfirmation = true, checkpointProblem = error.experimentProblem()) }
            } finally { _state.update { it.copy(leaving = false) } }
        }
    }

    fun cancelExit() { _state.update { it.copy(exitNeedsConfirmation = false) } }
    fun leaveWithLastCheckpoint() {
        viewModelScope.launch {
            _state.update { it.copy(exitNeedsConfirmation = false) }
            finishExit()
        }
    }

    private suspend fun finishExit() {
        _renderer.value?.close()
        eventChannel.send(ExperimentEvent.Back)
    }

    private fun incoming(message: LabIncoming) {
        val current = _state.value
        if (current.accountChanged || graph.auth.state.value.experimentAccount() != account) return
        when (message) {
            is LabIncoming.State -> _state.update { it.copy(
                summary = message.summary,
                title = it.entry?.title ?: message.summary.title,
            ) }
            is LabIncoming.Checkpoint -> {
                checkpointOrder = maxOf(checkpointOrder + 1, System.currentTimeMillis())
                message.checkpoint.receivedOrder = checkpointOrder
                latestCheckpoint = message.checkpoint
                _state.update { it.copy(hasCheckpoint = true) }
                val owner = current.owner ?: return
                if (!current.resolving) autoSaves.trySend(PendingCheckpoint(owner, current.sceneId, message.checkpoint, current.title, template))
            }
            is LabIncoming.Error -> issue(ExperimentProblem(message.code, message.message))
            is LabIncoming.Export, is LabIncoming.Ready -> Unit
        }
    }

    private suspend fun persist(snapshot: PendingCheckpoint, nonCancellable: Boolean) {
        try {
            val result = persistence.withLock {
                if (_state.value.resolving || _state.value.sceneId != snapshot.sceneId || cleared) return
                requireAccount()
                if (nonCancellable) withContext(NonCancellable + Dispatchers.IO) {
                    repository.persistCheckpoint(snapshot.owner, snapshot.sceneId, snapshot.checkpoint, snapshot.title, snapshot.template)
                } else repository.persistCheckpoint(snapshot.owner, snapshot.sceneId, snapshot.checkpoint, snapshot.title, snapshot.template)
            }
            requireAccount()
            if (_state.value.sceneId == snapshot.sceneId && !_state.value.accountChanged && !cleared) {
                savedState["checkpointWritten"] = true
                _state.update { it.copy(persistedAt = result.updatedAt, checkpointProblem = null) }
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            if (_state.value.sceneId == snapshot.sceneId && !_state.value.accountChanged && !cleared) {
                _state.update { it.copy(checkpointProblem = error.experimentProblem()) }
            }
        }
    }

    private suspend fun persistRequired(owner: String, sceneId: String, checkpoint: LabCheckpoint) {
        val result = persistence.withLock {
            requireAccount()
            repository.persistCheckpoint(owner, sceneId, checkpoint, _state.value.title, template)
        }
        requireAccount()
        if (!_state.value.accountChanged) {
            savedState["checkpointWritten"] = true
            _state.update { it.copy(persistedAt = result.updatedAt, checkpointProblem = null, hasCheckpoint = true) }
        }
    }

    private fun observe(owner: String, sceneId: String) {
        observeJob?.cancel()
        observeJob = viewModelScope.launch {
            try {
                combine(repository.observe(owner), graph.sync.observe(owner)) { entries, operations -> entries to operations }
                    .collect { (entries, operations) ->
                        requireAccount()
                        val entry = entries.firstOrNull { it.sceneId == sceneId }
                        _state.update { it.copy(entry = entry, operation = operationFor(entry, operations)) }
                        if (owner != GUEST_EXPERIMENT_OWNER) repository.reconcile(owner, operations)
                    }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { issue(error.experimentProblem()) }
        }
    }

    private fun issue(problem: ExperimentProblem) {
        if (!cleared && !_state.value.accountChanged) eventChannel.trySend(ExperimentEvent.Problem(problem))
    }

    override fun onCleared() {
        cleared = true
        autoSaves.close()
        _renderer.value?.close()
        _renderer.value = null
        eventChannel.close()
        super.onCleared()
    }
}
