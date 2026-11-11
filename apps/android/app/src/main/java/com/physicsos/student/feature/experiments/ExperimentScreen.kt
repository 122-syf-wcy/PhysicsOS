package com.physicsos.student.feature.experiments

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import com.physicsos.student.ui.components.BrandMark
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
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
import com.physicsos.student.feature.experiments.bridge.LabExportFormat
import com.physicsos.student.feature.experiments.bridge.LabRenderer
import com.physicsos.student.feature.experiments.bridge.LabRendererPhase

@Composable
fun ExperimentScreen(
    graph: AppGraph,
    templateId: String?,
    sceneId: String?,
    onBack: () -> Unit,
    onOpenDocument: (String, String) -> Unit,
) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val factory = remember(graph, templateId, sceneId) {
        viewModelFactory { initializer { ExperimentViewModel(graph, appContext, createSavedStateHandle(), templateId, sceneId) } }
    }
    val model: ExperimentViewModel = viewModel(key = "experiment:$templateId:$sceneId", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    val renderer by model.renderer.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val back by rememberUpdatedState(onBack)
    val document by rememberUpdatedState(onOpenDocument)
    BackHandler { model.back() }
    LaunchedEffect(model, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            model.events.collect { event ->
                when (event) {
                    ExperimentEvent.Back -> back()
                    is ExperimentEvent.SavedLocally -> if (graph.auth.state.value.experimentAccount() == event.account) {
                        snackbar.showSnackbar(context.getString(if (event.account.owner == GUEST_EXPERIMENT_OWNER) R.string.experiments_saved_guest else R.string.experiments_saved_local_queued))
                    }
                    is ExperimentEvent.Share -> if (graph.auth.state.value.experimentAccount() == event.account) {
                        try { shareLabFile(context, event.file, context.getString(R.string.experiments_share)) }
                        catch (_: Exception) { snackbar.showSnackbar(context.getString(R.string.experiments_share_failed)) }
                    }
                    is ExperimentEvent.Document -> if (graph.auth.state.value.experimentAccount() == event.account) document(event.title, event.markdown)
                    is ExperimentEvent.Problem -> snackbar.showSnackbar(experimentProblemText(context, event.problem))
                }
            }
        }
    }
    var moreMenu by rememberSaveable { mutableStateOf(false) }
    var archiveInfo by rememberSaveable { mutableStateOf(false) }
    var exportMenu by rememberSaveable { mutableStateOf(false) }
    var conflict by rememberSaveable { mutableStateOf(false) }
    var help by rememberSaveable { mutableStateOf(false) }
    val busy = state.loading || state.saving || state.exporting || state.resolving || state.leaving || state.accountChanged
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val ready = renderer?.state?.collectAsStateWithLifecycle()?.value?.phase == LabRendererPhase.READY
    Scaffold(Modifier.fillMaxSize().testTag("experiment"), snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = 4.dp, end = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = model::back, enabled = !state.leaving && !state.saving && !state.resolving, modifier = Modifier.testTag("experiment_back")) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.experiments_back), Modifier.size(21.dp))
                }
                BrandMark(wordmark = false)
                Column(Modifier.weight(1f).padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(state.title.ifBlank { stringResource(R.string.experiments_workspace_title) }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (state.exporting) stringResource(R.string.experiments_exporting) else sceneSyncText(sceneSyncLabel(state.entry, state.operation)),
                        Modifier.testTag(if (state.summary != null) "experiment_run_status" else "experiment_sync_status"),
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = model::save, enabled = ready && !busy, modifier = Modifier.testTag("experiment_save")) {
                    Text(stringResource(if (state.saving) R.string.experiments_saving else R.string.experiments_save))
                }
                Box {
                    IconButton(onClick = { moreMenu = true }, modifier = Modifier.testTag("experiment_more")) {
                        Icon(Icons.Default.MoreVert, stringResource(R.string.experiments_more))
                    }
                    DropdownMenu(moreMenu, { moreMenu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.experiments_export)) }, onClick = { moreMenu = false; exportMenu = true }, enabled = ready && !busy, modifier = Modifier.testTag("experiment_export"))
                        DropdownMenuItem(text = { Text(stringResource(R.string.experiments_read_report)) }, onClick = { moreMenu = false; model.export(LabExportFormat.MARKDOWN, readReport = true) }, enabled = ready && !busy, modifier = Modifier.testTag("experiment_report"))
                        DropdownMenuItem(text = { Text(stringResource(R.string.experiments_archive_info)) }, onClick = { moreMenu = false; archiveInfo = true })
                        DropdownMenuItem(text = { Text(stringResource(R.string.experiments_controls)) }, onClick = { moreMenu = false; help = true }, modifier = Modifier.testTag("experiment_help"))
                    }
                    DropdownMenu(exportMenu, { exportMenu = false }) {
                        listOf(LabExportFormat.JSON, LabExportFormat.CSV, LabExportFormat.OBSERVATIONS, LabExportFormat.MARKDOWN, LabExportFormat.SVG, LabExportFormat.PNG).forEach { format ->
                            DropdownMenuItem(text = { Text(stringResource(when (format) {
                                LabExportFormat.JSON -> R.string.experiments_export_json
                                LabExportFormat.CSV -> R.string.experiments_export_csv
                                LabExportFormat.OBSERVATIONS -> R.string.experiments_export_observations
                                LabExportFormat.MARKDOWN -> R.string.experiments_export_markdown
                                LabExportFormat.SVG -> R.string.experiments_export_svg
                                LabExportFormat.PNG -> R.string.experiments_export_png
                                LabExportFormat.METRICS -> R.string.experiments_export_metrics
                            })) }, onClick = { exportMenu = false; model.export(format) }, modifier = Modifier.testTag("experiment_export_${format.wire}"))
                        }
                    }
                }
            }
            when {
                state.accountChanged -> ExperimentNotice(stringResource(R.string.experiments_account_changed), Modifier.padding(12.dp), stringResource(R.string.experiments_back), model::back)
                state.loading -> CircularProgressIndicator(Modifier.padding(24.dp))
                state.problem != null -> ExperimentNotice(experimentProblemText(context, requireNotNull(state.problem)), Modifier.padding(12.dp), stringResource(R.string.experiments_retry), model::initialize)
                else -> {
                    val sync = sceneSyncLabel(state.entry, state.operation)
                    if (sync in setOf(SceneSyncLabel.CONFLICT, SceneSyncLabel.RETRY, SceneSyncLabel.FAILED, SceneSyncLabel.SIGN_IN)) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(sceneSyncText(sync), Modifier.weight(1f).testTag("experiment_sync_status"), style = MaterialTheme.typography.bodySmall)
                            if (sync == SceneSyncLabel.CONFLICT) {
                                TextButton(onClick = { conflict = true }, enabled = !busy, modifier = Modifier.testTag("experiment_resolve_conflict")) { Text(stringResource(R.string.experiments_review_conflict)) }
                            } else TextButton(onClick = model::retrySync, enabled = !busy, modifier = Modifier.testTag("experiment_retry_sync")) { Text(stringResource(R.string.experiments_retry_sync)) }
                        }
                    }
                    if (state.legacySceneOnly) Text(stringResource(R.string.experiments_legacy_notice), Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
                    if (state.entry?.remoteDeleted == true) Text(stringResource(R.string.experiments_remote_deleted), Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
                    state.checkpointProblem?.let { problem -> Text(experimentProblemText(context, problem), Modifier.padding(horizontal = 16.dp).testTag("experiment_checkpoint_error"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    renderer?.let { LabRenderer(it, dark, Modifier.weight(1f)) }
                }
            }
        }
    }
    if (archiveInfo) AlertDialog(
        onDismissRequest = { archiveInfo = false },
        title = { Text(stringResource(R.string.experiments_archive_info)) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(sceneSyncText(sceneSyncLabel(state.entry, state.operation)))
            if (state.owner == GUEST_EXPERIMENT_OWNER) Text(stringResource(R.string.experiments_guest_workspace))
            if (state.persistedAt != null && state.checkpointProblem == null) Text(stringResource(R.string.experiments_autosaved))
            state.summary?.let { summary -> Text(stringResource(when {
                summary.running -> R.string.experiments_running
                summary.dirty -> R.string.experiments_edited
                else -> R.string.experiments_paused
            })) }
        } },
        confirmButton = { TextButton(onClick = { archiveInfo = false }) { Text(stringResource(R.string.experiments_close)) } },
    )
    if (help) AlertDialog(onDismissRequest = { help = false }, title = { Text(stringResource(R.string.experiments_controls)) },
        text = { Text(stringResource(R.string.experiments_controls_body)) }, confirmButton = { TextButton(onClick = { help = false }) { Text(stringResource(R.string.experiments_close)) } })
    if (conflict && state.operation?.state == OutboxState.CONFLICT) {
        val backup = stringResource(R.string.experiments_backup_title, state.title.take(240))
        val copy = stringResource(R.string.experiments_copy_title, state.title.take(240))
        AlertDialog(onDismissRequest = { conflict = false }, title = { Text(stringResource(R.string.experiments_conflict_title)) },
            text = { Text(stringResource(R.string.experiments_conflict_body)) },
            confirmButton = { TextButton(onClick = { conflict = false; model.copyConflict(copy) }, enabled = !busy && ready, modifier = Modifier.testTag("experiment_conflict_copy")) { Text(stringResource(R.string.experiments_conflict_copy)) } },
            dismissButton = {
                Column {
                    TextButton(onClick = { conflict = false; model.useCloud(backup) }, enabled = !busy && ready, modifier = Modifier.testTag("experiment_conflict_cloud")) { Text(stringResource(R.string.experiments_conflict_cloud)) }
                    TextButton(onClick = { conflict = false }) { Text(stringResource(R.string.experiments_cancel)) }
                }
            })
    }
    if (state.exitNeedsConfirmation) AlertDialog(onDismissRequest = model::cancelExit, title = { Text(stringResource(R.string.experiments_exit_title)) },
        text = { Text(stringResource(if (state.persistedAt == null) R.string.experiments_exit_no_checkpoint else R.string.experiments_exit_body)) },
        confirmButton = { TextButton(onClick = model::back, modifier = Modifier.testTag("experiment_exit_retry")) { Text(stringResource(R.string.experiments_retry)) } },
        dismissButton = { Column {
            TextButton(onClick = model::cancelExit) { Text(stringResource(R.string.experiments_stay)) }
            TextButton(onClick = model::leaveWithLastCheckpoint, modifier = Modifier.testTag("experiment_exit_without_checkpoint")) { Text(stringResource(R.string.experiments_leave_anyway)) }
        } })
}
