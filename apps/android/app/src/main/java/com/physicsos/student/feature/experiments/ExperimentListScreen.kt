package com.physicsos.student.feature.experiments

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.CardDefaults
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import com.physicsos.student.ui.components.BundledArtwork
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.OutboxState
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch

@Composable
fun ExperimentListScreen(graph: AppGraph, onOpenExperiment: (String?, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val factory = remember(graph) { viewModelFactory { initializer { ExperimentListViewModel(graph, createSavedStateHandle()) } } }
    val model: ExperimentListViewModel = viewModel(key = "experiments-list", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    val auth by graph.auth.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val open by rememberUpdatedState(onOpenExperiment)
    var pickerOwner by rememberSaveable { mutableStateOf<String?>(null) }
    var pickerUserId by rememberSaveable { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val owner = pickerOwner
        if (uri != null && owner != null) model.importArchive(context, uri, ExperimentAccount(owner, pickerUserId))
        pickerOwner = null
        pickerUserId = null
    }
    LaunchedEffect(model, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            model.events.collect { event ->
                when (event) {
                    is ExperimentListEvent.Open -> if (graph.auth.state.value.experimentAccount() == event.account) open(null, event.sceneId)
                    is ExperimentListEvent.Problem -> snackbar.showSnackbar(experimentProblemText(context, event.problem))
                }
            }
        }
    }
    Scaffold(modifier = Modifier.fillMaxSize().testTag("experiments"), snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        if (state.account != auth.experimentAccount()) {
            CircularProgressIndicator(Modifier.padding(24.dp))
        } else ExperimentListContent(
            state = state, modifier = Modifier.padding(padding),
            onOpen = onOpenExperiment, onQuery = model::query, onDomain = model::domain, onStage = model::stage,
            onTab = model::tab, onClear = model::clearFilters, onRetryCatalog = model::loadCatalog,
            onRefresh = { model.refresh() }, onMore = { model.refresh(true) }, onImportGuest = model::importGuest,
            onRemove = model::removeLocal, onRetrySync = model::retrySync,
            onImport = {
                state.account?.let { account ->
                    pickerOwner = account.owner
                    pickerUserId = account.userId
                    try { picker.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }
                    catch (_: Exception) {
                        pickerOwner = null
                        pickerUserId = null
                        scope.launch { snackbar.showSnackbar(context.getString(R.string.experiments_picker_unavailable)) }
                    }
                }
            },
        )
    }
}

@Composable
internal fun ExperimentListContent(
    state: ExperimentListState,
    onOpen: (String?, String?) -> Unit,
    onQuery: (String) -> Unit,
    onDomain: (String?) -> Unit,
    onStage: (String?) -> Unit,
    onTab: (ExperimentTab) -> Unit,
    onClear: () -> Unit,
    onRetryCatalog: () -> Unit,
    onRefresh: () -> Unit,
    onMore: () -> Unit,
    onImportGuest: (ExperimentEntry) -> Unit,
    onRemove: (ExperimentEntry) -> Unit,
    onRetrySync: (ExperimentEntry) -> Unit,
    onImport: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var removing by remember(state.account) { mutableStateOf<ExperimentEntry?>(null) }
    val domains = remember(state.catalog, state.entries, state.guests, state.domain) {
        (state.catalog.map { it.domain } + state.entries.map { it.domain } + state.guests.map { it.domain } + listOfNotNull(state.domain))
            .filter(String::isNotBlank).distinct().sorted()
    }
    val stages = remember(state.catalog, state.entries, state.guests, state.stage) {
        (state.catalog.map { it.stage } + state.entries.map { it.stage } + state.guests.map { it.stage } + listOfNotNull(state.stage))
            .filter(String::isNotBlank).distinct().sorted()
    }
    val savedEntries = if (state.tab == ExperimentTab.GUEST) state.guests else state.entries
    val visibleEntries = remember(savedEntries, state.query, state.domain, state.stage) {
        savedEntries.filter { matchesEntry(it, state.query, state.domain, state.stage) }
    }
    LazyColumn(modifier.fillMaxSize().testTag("experiments_results"), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item("header") {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.experiments_title), Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                TextButton(onClick = onImport, enabled = state.account != null && !state.importing, modifier = Modifier.testTag("experiments_import")) {
                    Text(stringResource(R.string.experiments_import))
                }
            }
        }
        item("offline") { Text(stringResource(if (state.owner == GUEST_EXPERIMENT_OWNER) R.string.experiments_guest_notice else R.string.experiments_offline_notice), style = MaterialTheme.typography.bodyMedium) }
        item("search") {
            OutlinedTextField(state.query, onQuery, Modifier.fillMaxWidth().testTag("experiments_search"),
                label = { Text(stringResource(R.string.experiments_search)) }, singleLine = true)
        }
        item("tabs") {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ExperimentTab.entries.filter { it != ExperimentTab.GUEST || state.owner != GUEST_EXPERIMENT_OWNER }, key = { it.name }) { tab ->
                    FilterChip(state.tab == tab, { onTab(tab) }, label = { Text(stringResource(when (tab) {
                        ExperimentTab.CATALOG -> R.string.experiments_tab_catalog
                        ExperimentTab.SAVED -> R.string.experiments_tab_saved
                        ExperimentTab.GUEST -> R.string.experiments_tab_guest
                    })) }, modifier = Modifier.testTag("experiments_tab_${tab.name.lowercase()}"))
                }
            }
        }
        item("domains") {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item("all") { FilterChip(state.domain == null, { onDomain(null) }, label = { Text(stringResource(R.string.experiments_all_domains)) }) }
                items(domains, key = { it }) { value -> FilterChip(state.domain == value, { onDomain(value) }, label = { Text(experimentDomainLabel(value)) }, modifier = Modifier.testTag("experiments_domain_$value")) }
            }
        }
        item("stages") {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item("all") { FilterChip(state.stage == null, { onStage(null) }, label = { Text(stringResource(R.string.experiments_all_stages)) }) }
                items(stages, key = { it }) { value -> FilterChip(state.stage == value, { onStage(value) }, label = { Text(experimentStageLabel(value)) }, modifier = Modifier.testTag("experiments_stage_$value")) }
            }
        }
        if (state.query.isNotBlank() || state.domain != null || state.stage != null) item("clear") {
            TextButton(onClick = onClear, modifier = Modifier.testTag("experiments_clear_filters")) { Text(stringResource(R.string.experiments_clear_filters)) }
        }
        if (state.account == null || state.importing) item("account-loading") { CircularProgressIndicator(Modifier.testTag("experiments_importing")) }
        if (state.tab == ExperimentTab.CATALOG) {
            if (state.loading) item("loading") { CircularProgressIndicator() }
            state.catalogProblem?.let { problem -> item("catalog-error") {
                ExperimentNotice(experimentProblemText(context, problem), action = stringResource(R.string.experiments_retry), onAction = onRetryCatalog)
            } }
            item("count") { Text(stringResource(R.string.experiments_catalog_count, state.visibleCatalog.size, state.catalog.size), style = MaterialTheme.typography.labelLarge) }
            if (!state.loading && state.catalogProblem == null && state.visibleCatalog.isEmpty()) item("empty") {
                ExperimentEmpty(stringResource(R.string.experiments_no_results), stringResource(R.string.experiments_no_results_body))
            }
            items(state.visibleCatalog, key = { "template:${it.id}" }) { template ->
                Card(onClick = { onOpen(template.id, null) }, modifier = Modifier.fillMaxWidth().testTag("experiment_template_${template.id}"),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        BundledArtwork(template.id, Modifier.width(86.dp).height(96.dp).clip(MaterialTheme.shapes.small))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(listOf(experimentDomainLabel(template.domain), experimentStageLabel(template.stage)).filter(String::isNotBlank).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(template.title, style = MaterialTheme.typography.titleMedium)
                            if (template.subtitle.isNotBlank()) Text(template.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        Icon(Icons.AutoMirrored.Filled.ArrowForward, stringResource(R.string.experiments_open_template), Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        } else {
            state.localProblem?.let { problem -> item("local-error") { ExperimentNotice(experimentProblemText(context, problem)) } }
            if (state.tab == ExperimentTab.SAVED && state.owner != null && state.owner != GUEST_EXPERIMENT_OWNER) {
                item("refresh") { OutlinedButton(onClick = onRefresh, enabled = !state.refreshing, modifier = Modifier.testTag("experiments_refresh")) { Text(stringResource(R.string.experiments_refresh)) } }
                if (state.refreshing) item("refreshing") { CircularProgressIndicator() }
                state.cloudProblem?.let { problem -> item("cloud-error") {
                    ExperimentNotice(experimentProblemText(context, problem), action = stringResource(R.string.experiments_retry), onAction = onRefresh)
                } }
            }
            if (visibleEntries.isEmpty()) item("saved-empty") {
                ExperimentEmpty(stringResource(R.string.experiments_saved_empty), stringResource(if (state.tab == ExperimentTab.GUEST) R.string.experiments_guest_empty_body else R.string.experiments_saved_empty_body))
            }
            items(visibleEntries, key = { "scene:${it.sceneId}" }) { entry ->
                val guest = state.tab == ExperimentTab.GUEST
                val operation = if (guest) null else operationFor(entry, state.operations)
                Card(Modifier.fillMaxWidth().testTag("experiment_saved_${entry.sceneId}")) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(entry.title, style = MaterialTheme.typography.titleMedium)
                        Text(experimentDomainLabel(entry.domain), style = MaterialTheme.typography.labelLarge)
                        Text(stringResource(R.string.experiments_updated, DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(entry.updatedAt))), style = MaterialTheme.typography.bodySmall)
                        Text(sceneSyncText(sceneSyncLabel(entry, operation)), modifier = Modifier.testTag("scene_sync_${entry.sceneId}"))
                        Text(stringResource(if (entry.hasCheckpoint) R.string.experiments_full_checkpoint else R.string.experiments_legacy_checkpoint), style = MaterialTheme.typography.bodySmall)
                        if (entry.remoteDeleted) Text(stringResource(R.string.experiments_remote_deleted))
                        if (guest) {
                            Text(stringResource(R.string.experiments_guest_copy_notice), style = MaterialTheme.typography.bodySmall)
                            Button(onClick = { onImportGuest(entry) }, enabled = !state.importing, modifier = Modifier.testTag("experiments_copy_guest_${entry.sceneId}")) { Text(stringResource(R.string.experiments_copy_guest)) }
                        } else {
                            Button(onClick = { onOpen(null, entry.sceneId) }, enabled = entry.hasLocal || !entry.remoteDeleted, modifier = Modifier.testTag("experiments_restore_${entry.sceneId}")) {
                                Text(stringResource(if (operation?.state == OutboxState.CONFLICT) R.string.experiments_review_conflict else R.string.experiments_restore))
                            }
                            if (operation?.state in setOf(OutboxState.RETRY, OutboxState.FAILED, OutboxState.AUTH_REQUIRED) || entry.queueError != null) {
                                TextButton(onClick = { onRetrySync(entry) }, enabled = !state.importing) { Text(stringResource(R.string.experiments_retry_sync)) }
                            }
                            if (entry.hasLocal && (entry.cloudRevision == 0L || entry.remoteDeleted) && (operation == null || operation.state == OutboxState.ACKNOWLEDGED)) {
                                TextButton(onClick = { removing = entry }, enabled = !state.importing, modifier = Modifier.testTag("experiments_remove_${entry.sceneId}")) { Text(stringResource(R.string.experiments_remove_local)) }
                            }
                        }
                    }
                }
            }
            if (state.tab == ExperimentTab.SAVED && state.nextCursor != null) item("more") {
                OutlinedButton(onClick = onMore, enabled = !state.refreshing, modifier = Modifier.testTag("experiments_load_more")) { Text(stringResource(R.string.experiments_load_more)) }
            }
        }
    }
    removing?.let { entry ->
        AlertDialog(onDismissRequest = { removing = null }, title = { Text(stringResource(R.string.experiments_remove_title)) },
            text = { Text(stringResource(R.string.experiments_remove_body, entry.title)) },
            confirmButton = { TextButton(onClick = { removing = null; onRemove(entry) }) { Text(stringResource(R.string.experiments_remove_local)) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.experiments_cancel)) } })
    }
}
