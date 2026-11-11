package com.physicsos.student.feature.experiments

import android.content.Context
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.ExperimentInfo
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.experiments.bridge.BridgeProtocolException
import java.text.Normalizer
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class ExperimentProblem(val code: String, val detail: String? = null)
internal fun Throwable.experimentProblem(): ExperimentProblem = when (this) {
    is ApiException -> ExperimentProblem(code)
    is BridgeProtocolException -> ExperimentProblem(code)
    else -> ExperimentProblem("local_operation_failed")
}

internal enum class ExperimentTab { CATALOG, SAVED, GUEST }
internal data class ExperimentListState(
    val account: ExperimentAccount? = null,
    val loading: Boolean = true,
    val catalog: List<ExperimentInfo> = emptyList(),
    val visibleCatalog: List<ExperimentInfo> = emptyList(),
    val entries: List<ExperimentEntry> = emptyList(),
    val guests: List<ExperimentEntry> = emptyList(),
    val operations: List<OutboxItem> = emptyList(),
    val query: String = "",
    val domain: String? = null,
    val stage: String? = null,
    val tab: ExperimentTab = ExperimentTab.CATALOG,
    val catalogProblem: ExperimentProblem? = null,
    val localProblem: ExperimentProblem? = null,
    val cloudProblem: ExperimentProblem? = null,
    val refreshing: Boolean = false,
    val nextCursor: String? = null,
    val importing: Boolean = false,
) {
    val owner: String? get() = account?.owner
}

internal sealed interface ExperimentListEvent {
    data class Open(val account: ExperimentAccount, val sceneId: String) : ExperimentListEvent
    data class Problem(val problem: ExperimentProblem) : ExperimentListEvent
}

internal class ExperimentListViewModel(private val graph: AppGraph, private val savedState: SavedStateHandle) : ViewModel() {
    private val _state = MutableStateFlow(ExperimentListState(
        query = savedState["query"] ?: "", domain = savedState["domain"], stage = savedState["stage"],
        tab = savedState.get<String>("tab")?.let { runCatching { ExperimentTab.valueOf(it) }.getOrNull() } ?: ExperimentTab.CATALOG,
    ))
    val state = _state.asStateFlow()
    private val channel = Channel<ExperimentListEvent>(Channel.BUFFERED)
    val events = channel.receiveAsFlow()
    private var filterJob: Job? = null
    private var remoteJob: Job? = null
    private var actionJob: Job? = null
    private var catalogJob: Job? = null

    init {
        loadCatalog()
        viewModelScope.launch {
            graph.auth.state.map { it.experimentAccount() }.distinctUntilChanged().collectLatest { account ->
                remoteJob?.cancel()
                actionJob?.cancel()
                _state.update { it.copy(account = account, entries = emptyList(), operations = emptyList(), guests = emptyList(),
                    nextCursor = null, cloudProblem = null, localProblem = null, refreshing = false, importing = false,
                    tab = if (account?.owner == GUEST_EXPERIMENT_OWNER && it.tab == ExperimentTab.GUEST) ExperimentTab.SAVED else it.tab) }
                if (account == null) return@collectLatest
                val repository = ExperimentRepository(graph, account)
                coroutineScope {
                    launch {
                        combine(repository.observe(account.owner), graph.sync.observe(account.owner)) { entries, operations -> entries to operations }
                            .catch { error ->
                                if (error is CancellationException) throw error
                                if (isCurrent(account)) _state.update { it.copy(localProblem = error.experimentProblem()) }
                            }.collect { (entries, operations) ->
                                if (!isCurrent(account)) return@collect
                                _state.update { it.copy(entries = entries, operations = operations, localProblem = null) }
                                if (account.owner != GUEST_EXPERIMENT_OWNER) {
                                    try { repository.reconcile(account.owner, operations) }
                                    catch (error: CancellationException) { throw error }
                                    catch (error: Exception) { if (isCurrent(account)) _state.update { it.copy(cloudProblem = error.experimentProblem()) } }
                                }
                            }
                    }
                    if (account.owner != GUEST_EXPERIMENT_OWNER) {
                        launch {
                            repository.observe(GUEST_EXPERIMENT_OWNER).catch { error ->
                                if (error is CancellationException) throw error
                                if (isCurrent(account)) channel.send(ExperimentListEvent.Problem(error.experimentProblem()))
                            }.collect { guests -> if (isCurrent(account)) _state.update { it.copy(guests = guests.filter(ExperimentEntry::hasLocal)) } }
                        }
                        refresh()
                    }
                }
            }
        }
    }

    private fun isCurrent(account: ExperimentAccount) = graph.auth.state.value.experimentAccount() == account && _state.value.account == account

    fun loadCatalog() {
        if (catalogJob?.isActive == true) return
        catalogJob = viewModelScope.launch {
            _state.update { it.copy(loading = true, catalogProblem = null) }
            try {
                val catalog = graph.catalog.experiments()
                _state.update { it.copy(catalog = catalog, loading = false) }
                filter()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { _state.update { it.copy(loading = false, catalogProblem = error.experimentProblem()) } }
        }
    }

    fun query(value: String) {
        val bounded = value.take(300)
        savedState["query"] = bounded
        _state.update { it.copy(query = bounded) }
        filter()
    }
    fun domain(value: String?) {
        savedState["domain"] = value
        _state.update { it.copy(domain = value) }
        filter()
    }
    fun stage(value: String?) {
        savedState["stage"] = value
        _state.update { it.copy(stage = value) }
        filter()
    }
    fun tab(value: ExperimentTab) {
        savedState["tab"] = value.name
        _state.update { it.copy(tab = value) }
    }
    fun clearFilters() { query(""); domain(null); stage(null) }

    fun refresh(more: Boolean = false) {
        val account = _state.value.account ?: return
        if (account.owner == GUEST_EXPERIMENT_OWNER || remoteJob?.isActive == true) return
        val cursor = if (more) _state.value.nextCursor ?: return else null
        remoteJob = viewModelScope.launch {
            _state.update { it.copy(refreshing = true, cloudProblem = null) }
            try {
                val page = ExperimentRepository(graph, account).refreshRemote(account.owner, cursor)
                if (!isCurrent(account)) return@launch
                _state.update { it.copy(nextCursor = page.nextCursor) }
                graph.sync.syncNow()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { if (isCurrent(account)) _state.update { it.copy(cloudProblem = error.experimentProblem()) } }
            finally { if (isCurrent(account)) _state.update { it.copy(refreshing = false) } }
        }
    }

    fun importGuest(entry: ExperimentEntry) = action { account, repository ->
        if (account.owner == GUEST_EXPERIMENT_OWNER) return@action
        val id = repository.copyLocal(GUEST_EXPERIMENT_OWNER, entry.sceneId, account.owner, entry.title)
        if (isCurrent(account)) channel.send(ExperimentListEvent.Open(account, id))
    }

    fun importArchive(context: Context, uri: Uri, expectedAccount: ExperimentAccount) {
        // The file picker may return after a sign-out or a same-name account replacement.
        if (!isCurrent(expectedAccount)) return
        val files = ExperimentFiles(context.applicationContext)
        action { account, repository ->
            val archive = files.readArchive(uri)
            val id = repository.importArchive(archive, account.owner)
            if (isCurrent(account)) channel.send(ExperimentListEvent.Open(account, id))
        }
    }

    fun removeLocal(entry: ExperimentEntry) = action { account, repository -> repository.removeLocal(account.owner, entry.sceneId) }

    fun retrySync(entry: ExperimentEntry) = action { account, repository ->
        val operation = operationFor(entry, _state.value.operations)
        if (operation?.state != OutboxState.CONFLICT) repository.retry(account.owner, entry.sceneId, operation)
    }

    private fun action(block: suspend (ExperimentAccount, ExperimentRepository) -> Unit) {
        val account = _state.value.account ?: return
        if (actionJob?.isActive == true || !isCurrent(account)) return
        actionJob = viewModelScope.launch {
            _state.update { it.copy(importing = true) }
            try { block(account, ExperimentRepository(graph, account)) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { if (isCurrent(account)) channel.send(ExperimentListEvent.Problem(error.experimentProblem())) }
            finally { if (isCurrent(account)) _state.update { it.copy(importing = false) } }
        }
    }

    private fun filter() {
        filterJob?.cancel()
        val current = _state.value
        filterJob = viewModelScope.launch {
            val filtered = withContext(Dispatchers.Default) { filterExperiments(current.catalog, current.query, current.domain, current.stage) }
            _state.update { it.copy(visibleCatalog = filtered) }
        }
    }
}

internal fun filterExperiments(catalog: List<ExperimentInfo>, query: String, domain: String?, stage: String?): List<ExperimentInfo> {
    val words = normalizedSearch(query).split(Regex("\\s+")).filter(String::isNotEmpty)
    return catalog.filter { item ->
        (domain == null || item.domain == domain) && (stage == null || item.stage == stage) &&
            (words.isEmpty() || normalizedSearch(listOf(item.id, item.title, item.subtitle, item.domain, item.stage, item.tags.joinToString(" ")).joinToString(" ")).let { haystack -> words.all(haystack::contains) })
    }
}

internal fun matchesEntry(entry: ExperimentEntry, query: String, domain: String?, stage: String?): Boolean =
    (domain == null || entry.domain == domain) && (stage == null || entry.stage == stage) &&
        normalizedSearch(query).split(Regex("\\s+")).filter(String::isNotEmpty).all {
            normalizedSearch("${entry.title} ${entry.domain} ${entry.stage} ${entry.templateId.orEmpty()}").contains(it)
        }

private fun normalizedSearch(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC).lowercase(Locale.ROOT).trim()

internal fun operationFor(entry: ExperimentEntry?, operations: List<OutboxItem>): OutboxItem? =
    entry?.syncKey?.let { key -> operations.firstOrNull { it.idempotencyKey == key && it.path == "learning/scenes/${entry.sceneId}" } }

internal enum class SceneSyncLabel { LOCAL, QUEUED, RUNNING, RETRY, CONFIRMED, CONFLICT, FAILED, SIGN_IN, SAVED_WAITING }
internal fun sceneSyncLabel(entry: ExperimentEntry?, operation: OutboxItem?): SceneSyncLabel {
    if (entry?.queueError != null) return SceneSyncLabel.FAILED
    if (entry?.saveRequested == true && entry.hasUnsyncedSavedVersion && operation != null && operation.state != OutboxState.CONFLICT) return SceneSyncLabel.SAVED_WAITING
    return when (operation?.state) {
        OutboxState.PENDING -> SceneSyncLabel.QUEUED
        OutboxState.RUNNING -> SceneSyncLabel.RUNNING
        OutboxState.RETRY -> SceneSyncLabel.RETRY
        OutboxState.ACKNOWLEDGED -> if (entry?.saveRequested == true) SceneSyncLabel.SAVED_WAITING else SceneSyncLabel.CONFIRMED
        OutboxState.CONFLICT -> SceneSyncLabel.CONFLICT
        OutboxState.FAILED -> SceneSyncLabel.FAILED
        OutboxState.AUTH_REQUIRED -> SceneSyncLabel.SIGN_IN
        null -> if (entry != null && entry.cloudRevision > 0 && !entry.hasLocal) SceneSyncLabel.CONFIRMED else SceneSyncLabel.LOCAL
    }
}
