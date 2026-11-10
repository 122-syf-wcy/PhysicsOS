package com.physicsos.student.feature.records

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.home.LearningEmpty
import com.physicsos.student.feature.home.LearningError
import com.physicsos.student.feature.home.LearningHeader
import com.physicsos.student.feature.home.LearningLoading
import com.physicsos.student.feature.home.LearningNotice
import com.physicsos.student.feature.home.LearningSyncStatus
import com.physicsos.student.feature.home.LearningViewModelFactory
import com.physicsos.student.feature.home.displayDate
import com.physicsos.student.feature.home.encoded
import com.physicsos.student.feature.home.syncStateLabel
import com.physicsos.student.feature.library.learningDomainLabel
import java.time.Instant
import kotlinx.serialization.json.JsonObject

@Composable
fun RecordsScreen(
    graph: AppGraph,
    onOpenChat: (sessionId: String?, prompt: String?) -> Unit,
    onOpenExperiment: (templateId: String?, scene: JsonObject?) -> Unit,
    onOpenSavedExperiment: (sceneId: String) -> Unit,
    onOpenDocument: (title: String, markdown: String) -> Unit,
    onBack: () -> Unit,
    initialTab: RecordTab = RecordTab.ATTEMPTS,
) {
    val factory = remember(graph, initialTab) { LearningViewModelFactory { RecordsViewModel(graph, initialTab) } }
    val model: RecordsViewModel = viewModel(key = "learning-records-${initialTab.name}", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<Pair<SavedLearningScene, Boolean>?>(null) }
    var discarding by remember { mutableStateOf<OutboxItem?>(null) }
    BackHandler(state.selectedAttempt != null) { model.selectAttempt(null) }
    RecordsContent(
        state, model::tab, model::refresh, model::more, model::sync, model::selectAttempt,
        onOpenChat, onOpenExperiment, onOpenSavedExperiment, onOpenDocument,
        onBack = { if (state.selectedAttempt != null) model.selectAttempt(null) else onBack() },
        onDelete = { scene, local -> deleting = scene to local },
        onRetry = model::retry, onConflict = model::inspectConflict, onDiscard = { discarding = it },
    )
    deleting?.let { (scene, local) ->
        AlertDialog(
            onDismissRequest = { deleting = null }, title = { Text(stringResource(if (local) R.string.learning_scene_remove_local_title else R.string.learning_scene_delete_title)) },
            text = { Text(stringResource(if (local) R.string.learning_scene_remove_local_description else R.string.learning_scene_delete_description)) },
            confirmButton = { TextButton(onClick = { deleting = null; if (local) model.removeLocalScene(scene) else model.deleteCloudScene(scene) }, modifier = Modifier.testTag("records-confirm-delete")) { Text(stringResource(R.string.learning_delete)) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.learning_cancel)) } },
        )
    }
    discarding?.let { operation ->
        AlertDialog(
            onDismissRequest = { discarding = null }, title = { Text(stringResource(R.string.learning_discard_operation_title)) },
            text = { Text(stringResource(R.string.learning_discard_operation_description)) },
            confirmButton = { TextButton(onClick = { discarding = null; model.discard(operation) }) { Text(stringResource(R.string.learning_discard_operation)) } },
            dismissButton = { TextButton(onClick = { discarding = null }) { Text(stringResource(R.string.learning_cancel)) } },
        )
    }
    state.conflict?.let { conflict ->
        AlertDialog(
            onDismissRequest = model::dismissConflict,
            title = { Text(stringResource(R.string.learning_sync_conflict)) },
            text = {
                Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.learning_sync_conflict_description))
                    Text(stringResource(R.string.learning_sync_base_revision, conflict.baseRevision?.toString() ?: stringResource(R.string.learning_unknown)))
                    Text(stringResource(R.string.learning_sync_current_revision, conflict.currentRevision?.toString() ?: stringResource(R.string.learning_unknown)))
                    conflict.localContent?.let { Text(stringResource(R.string.learning_local_version), style = MaterialTheme.typography.titleSmall); Text(it) }
                    conflict.serverContent?.let { Text(stringResource(R.string.learning_server_version), style = MaterialTheme.typography.titleSmall); Text(it) }
                    if (conflict.sceneId == null) Text(stringResource(R.string.learning_sync_assignment_conflict_hint))
                }
            },
            confirmButton = {
                if (conflict.sceneId != null) TextButton(onClick = { model.dismissConflict(); onOpenSavedExperiment(conflict.sceneId) }) { Text(stringResource(R.string.learning_open_experiment)) }
                else TextButton(onClick = model::dismissConflict) { Text(stringResource(R.string.learning_close)) }
            },
            dismissButton = { TextButton(onClick = { model.dismissConflict(); discarding = conflict.operation }) { Text(stringResource(R.string.learning_discard_operation)) } },
        )
    }
}

@Composable
internal fun RecordsContent(
    state: RecordsUiState,
    onTab: (RecordTab) -> Unit,
    onRefresh: () -> Unit,
    onMore: () -> Unit,
    onSync: () -> Unit,
    onSelectAttempt: (LearningAttempt?) -> Unit,
    onOpenChat: (String?, String?) -> Unit,
    onOpenExperiment: (String?, JsonObject?) -> Unit,
    onOpenSavedExperiment: (String) -> Unit,
    onOpenDocument: (String, String) -> Unit,
    onBack: () -> Unit,
    onDelete: (SavedLearningScene, Boolean) -> Unit,
    onRetry: (OutboxItem) -> Unit,
    onConflict: (OutboxItem) -> Unit,
    onDiscard: (OutboxItem) -> Unit,
) {
    Column(Modifier.fillMaxSize().testTag("records")) {
        LearningHeader(stringResource(R.string.learning_records_title), onBack, action = {
            TextButton(onClick = onRefresh, modifier = Modifier.testTag("records-refresh")) { Text(stringResource(R.string.learning_refresh)) }
        })
        val attempt = state.selectedAttempt
        if (attempt != null) {
            LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item("title") { Text(attempt.title.ifBlank { stringResource(R.string.learning_record_untitled) }, style = MaterialTheme.typography.headlineMedium) }
                item("date") { Text(displayDate(attempt.at)) }
                item("question") { Text(attempt.prompt, style = MaterialTheme.typography.bodyLarge) }
                item("answer") {
                    Text(stringResource(R.string.learning_record_your_answer), style = MaterialTheme.typography.titleMedium)
                    Text(attempt.answer)
                }
                item("grading") { LearningNotice(stringResource(R.string.learning_record_self_reported)) }
                if (attempt.knowledge.isNotEmpty()) item("knowledge") {
                    Text(stringResource(R.string.learning_record_knowledge, attempt.knowledge.joinToString(" · ")), style = MaterialTheme.typography.bodyMedium)
                }
                item("continue") { Button(onClick = { onOpenChat(attempt.sessionId, attempt.prompt.takeIf(String::isNotBlank)) }, modifier = Modifier.fillMaxWidth().testTag("records-continue-attempt")) { Text(stringResource(R.string.learning_continue)) } }
                if (attempt.document.isNotBlank()) item("document") { OutlinedButton(onClick = { onOpenDocument(attempt.title, attempt.document) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_open_document)) } }
                attempt.experimentId?.let { id -> item("experiment") { OutlinedButton(onClick = { onOpenExperiment(id, null) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_open_experiment)) } } }
            }
        } else {
            Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RecordTab.entries.forEach { tab ->
                    FilterChip(selected = state.tab == tab, onClick = { onTab(tab) }, label = { Text(recordTabLabel(tab)) }, modifier = Modifier.testTag("records-tab-${tab.name.lowercase()}"))
                }
            }
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (state.actionProblem != null) item("action-error") { LearningError(state.actionProblem, onSync) }
                when (state.tab) {
                    RecordTab.ATTEMPTS -> {
                        if (state.cachedAttempts) item("cached") { LearningNotice(stringResource(R.string.learning_cached_description), onRefresh) }
                        if (state.attemptsProblem != null) item("error") { LearningError(state.attemptsProblem, onRefresh) }
                        if (state.loadingAttempts && state.attempts.isEmpty()) item("loading") { LearningLoading() }
                        if (!state.loadingAttempts && state.attempts.isEmpty() && state.attemptsProblem == null) item("empty") { LearningEmpty(stringResource(R.string.learning_records_empty), stringResource(R.string.learning_records_empty_description)) }
                        items(state.attempts, key = { it.id }) { row ->
                            Card(onClick = { onSelectAttempt(row) }, modifier = Modifier.fillMaxWidth().testTag("records-attempt-${row.id}")) {
                                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(row.title.ifBlank { stringResource(R.string.learning_record_untitled) }, style = MaterialTheme.typography.titleMedium)
                                    Text(displayDate(row.at), style = MaterialTheme.typography.bodySmall)
                                    Text(stringResource(R.string.learning_record_self_reported_short), style = MaterialTheme.typography.labelMedium)
                                    Text(stringResource(R.string.learning_continue), color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                        if (state.nextAttempts != null) item("more") { OutlinedButton(onClick = onMore, enabled = !state.loadingAttempts, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_load_more)) } }
                    }
                    RecordTab.SCENES -> {
                        if (state.cachedScenes) item("cached") { LearningNotice(stringResource(R.string.learning_scenes_cached), onRefresh) }
                        if (state.scenesProblem != null) item("error") { LearningError(state.scenesProblem, onRefresh) }
                        if (state.loadingScenes && state.scenes.isEmpty()) item("loading") { LearningLoading() }
                        if (!state.loadingScenes && state.scenes.isEmpty() && state.scenesProblem == null) item("empty") { LearningEmpty(stringResource(R.string.learning_scenes_empty), stringResource(R.string.learning_scenes_empty_description)) }
                        items(state.scenes, key = { it.id }) { scene ->
                            Card(Modifier.fillMaxWidth().testTag("records-scene-${scene.id}")) {
                                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text(scene.title.ifBlank { stringResource(R.string.learning_scene_untitled) }, style = MaterialTheme.typography.titleMedium)
                                    if (scene.domain.isNotBlank()) Text(learningDomainLabel(scene.domain), style = MaterialTheme.typography.labelLarge)
                                    if (scene.updatedAt > 0) Text(displayDate(Instant.ofEpochMilli(scene.updatedAt).toString()), style = MaterialTheme.typography.bodySmall)
                                    Text(stringResource(if (scene.hasLocal) R.string.learning_scene_on_device else R.string.learning_scene_cloud_only), style = MaterialTheme.typography.bodyMedium)
                                    if (!scene.saved && scene.hasLocal) Text(stringResource(R.string.learning_scene_checkpoint), style = MaterialTheme.typography.bodySmall)
                                    if (scene.deleted) LearningNotice(stringResource(R.string.learning_scene_remote_deleted))
                                    val operation = state.operations.firstOrNull { it.idempotencyKey == scene.syncKey || it.path == "learning/scenes/${encoded(scene.id)}" }
                                    if (operation != null) Text(syncStateLabel(operation.state), style = MaterialTheme.typography.bodySmall)
                                    Button(onClick = { onOpenSavedExperiment(scene.id) }, modifier = Modifier.fillMaxWidth().testTag("records-continue-scene-${scene.id}")) { Text(stringResource(R.string.learning_continue_experiment)) }
                                    if (!scene.deleted && scene.cloudRevision > 0) TextButton(onClick = { onDelete(scene, false) }) { Text(stringResource(R.string.learning_scene_delete_cloud)) }
                                    if (scene.hasLocal && (scene.cloudRevision == 0L || scene.deleted)) TextButton(onClick = { onDelete(scene, true) }) { Text(stringResource(R.string.learning_scene_remove_local)) }
                                }
                            }
                        }
                        if (state.nextScenes != null) item("more") { OutlinedButton(onClick = onMore, enabled = !state.loadingScenes, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_load_more)) } }
                    }
                    RecordTab.SYNC -> {
                        item("sync") {
                            Text(stringResource(R.string.learning_sync_description), style = MaterialTheme.typography.bodyMedium)
                            Button(onClick = onSync, enabled = !state.syncing, modifier = Modifier.fillMaxWidth().testTag("records-sync-now")) { Text(stringResource(R.string.learning_sync_now)) }
                        }
                        if (state.syncing) item("syncing") { LearningLoading() }
                        if (state.operations.isEmpty()) item("empty") { LearningEmpty(stringResource(R.string.learning_sync_empty), stringResource(R.string.learning_sync_empty_description)) }
                        items(state.operations, key = { it.id }) { operation ->
                            Card(Modifier.fillMaxWidth().testTag("records-operation-${operation.id}")) {
                                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text(operationLabel(operation.path), style = MaterialTheme.typography.titleMedium)
                                    Text(displayDate(Instant.ofEpochMilli(operation.createdAt).toString()), style = MaterialTheme.typography.bodySmall)
                                    LearningSyncStatus(operation.state, { onRetry(operation) }, { onConflict(operation) })
                                    if (operation.state != OutboxState.ACKNOWLEDGED && operation.state != OutboxState.RUNNING) TextButton(onClick = { onDiscard(operation) }) { Text(stringResource(R.string.learning_discard_operation)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun recordTabLabel(tab: RecordTab): String = stringResource(when (tab) {
    RecordTab.ATTEMPTS -> R.string.learning_records_attempts
    RecordTab.SCENES -> R.string.learning_records_scenes
    RecordTab.SYNC -> R.string.learning_records_sync
})

@Composable
internal fun operationLabel(path: String): String = stringResource(when {
    path.startsWith("learning/scenes") -> R.string.learning_sync_scene
    path.startsWith("learning/attempts") -> R.string.learning_sync_attempt
    path.startsWith("classes/") -> R.string.learning_sync_assignment
    path.startsWith("feedback/") -> R.string.learning_sync_screenshot
    path.startsWith("feedback") -> R.string.learning_sync_feedback
    else -> R.string.learning_sync_operation
})
