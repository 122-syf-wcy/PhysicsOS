package com.physicsos.student.feature.classes

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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.feature.home.LearningEmpty
import com.physicsos.student.feature.home.LearningError
import com.physicsos.student.feature.home.LearningHeader
import com.physicsos.student.feature.home.LearningLoading
import com.physicsos.student.feature.home.LearningNotice
import com.physicsos.student.feature.home.LearningSyncStatus
import com.physicsos.student.feature.home.LearningViewModelFactory
import com.physicsos.student.feature.home.displayDate
import kotlinx.serialization.json.JsonObject

@Composable
fun ClassesScreen(
    graph: AppGraph,
    onOpenClass: (classId: String) -> Unit,
    onOpenAssignment: (classId: String, assignmentId: String) -> Unit,
    onOpenExperiment: (templateId: String?, scene: JsonObject?) -> Unit,
    onOpenDocument: (title: String, markdown: String) -> Unit,
    onBack: () -> Unit,
    classId: String? = null,
    assignmentId: String? = null,
) {
    val factory = remember(graph, classId, assignmentId) { LearningViewModelFactory { ClassesViewModel(graph, classId, assignmentId) } }
    val model: ClassesViewModel = viewModel(key = "learning-classes-$classId-$assignmentId", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    BackHandler(assignmentId != null) { model.saveDraft(onBack) }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { if (assignmentId != null) model.saveDraft() }
    ClassesContent(
        state, classId, assignmentId, onOpenClass, onOpenAssignment,
        onOpenExperiment = { template, scene -> model.saveDraft { onOpenExperiment(template, scene) } },
        onOpenDocument = { title, markdown -> model.saveDraft { onOpenDocument(title, markdown) } },
        onBack = { model.saveDraft(onBack) }, onRefresh = { model.refresh() }, onMore = { model.refresh(true) },
        onAnswer = model::answer, onNotes = model::notes, onFreeform = model::freeform,
        onSubmit = model::submit, onRetry = model::retry, onCompare = model::compare, onSaveDraft = { model.saveDraft() },
    )
    state.comparison?.let { comparison ->
        AlertDialog(
            onDismissRequest = model::dismissComparison,
            title = { Text(stringResource(R.string.learning_assignment_compare_title)) },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.learning_assignment_compare_description))
                    Text(stringResource(R.string.learning_server_version), style = MaterialTheme.typography.titleSmall)
                    Text(comparison.server?.content ?: stringResource(R.string.learning_assignment_no_submission))
                    Text(stringResource(R.string.learning_local_version), style = MaterialTheme.typography.titleSmall)
                    Text(comparison.localContent)
                }
            },
            confirmButton = { TextButton(onClick = model::resubmitComparedAnswer, enabled = !state.submitting && comparison.localContent.isNotBlank(), modifier = Modifier.testTag("assignment-conflict-resubmit")) { Text(stringResource(R.string.learning_assignment_replace_confirm)) } },
            dismissButton = {
                Column {
                    TextButton(onClick = model::useServerAnswer, enabled = !state.submitting) { Text(stringResource(R.string.learning_use_server_version)) }
                    TextButton(onClick = model::dismissComparison) { Text(stringResource(R.string.learning_cancel)) }
                }
            },
        )
    }
}

@Composable
internal fun ClassesContent(
    state: ClassesUiState,
    classId: String?,
    assignmentId: String?,
    onOpenClass: (String) -> Unit,
    onOpenAssignment: (String, String) -> Unit,
    onOpenExperiment: (String?, JsonObject?) -> Unit,
    onOpenDocument: (String, String) -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onMore: () -> Unit,
    onAnswer: (String, String) -> Unit,
    onNotes: (String) -> Unit,
    onFreeform: (Boolean) -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    onCompare: () -> Unit,
    onSaveDraft: () -> Unit,
) {
    Column(Modifier.fillMaxSize().testTag("classes")) {
        LearningHeader(stringResource(if (assignmentId != null) R.string.learning_assignment_title else if (classId != null) R.string.learning_class_assignments else R.string.learning_classes_title), onBack, action = {
            TextButton(onClick = onRefresh, enabled = !state.loading, modifier = Modifier.testTag("classes-refresh")) { Text(stringResource(R.string.learning_refresh)) }
        })
        if (assignmentId != null) {
            AssignmentContent(state, onRefresh, onAnswer, onNotes, onFreeform, onSubmit, onRetry, onCompare, onSaveDraft, onOpenExperiment, onOpenDocument)
        } else {
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (state.cached) item("offline") { LearningNotice(stringResource(R.string.learning_classes_cached), onRefresh) }
                if (state.problem != null) item("error") { LearningError(state.problem, onRefresh) }
                if (state.loading && state.classes.isEmpty() && state.assignments.isEmpty()) item("loading") { LearningLoading() }
                if (classId == null) {
                    if (!state.loading && state.classes.isEmpty() && state.problem == null) item("empty") {
                        LearningEmpty(stringResource(R.string.learning_classes_empty), stringResource(R.string.learning_classes_empty_description))
                    }
                    items(state.classes, key = { it.id }) { classroom ->
                        Card(onClick = { onOpenClass(classroom.id) }, modifier = Modifier.fillMaxWidth().testTag("class-${classroom.id}")) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(classroom.name, style = MaterialTheme.typography.titleLarge)
                                classroom.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                                Text(stringResource(R.string.learning_class_open_assignments), color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                } else {
                    if (!state.loading && state.assignments.isEmpty() && state.problem == null) item("empty") {
                        LearningEmpty(stringResource(R.string.learning_assignments_empty), stringResource(R.string.learning_assignments_empty_description))
                    }
                    items(state.assignments, key = { it.id }) { assignment ->
                        Card(onClick = { onOpenAssignment(assignment.classId, assignment.id) }, modifier = Modifier.fillMaxWidth().testTag("assignment-${assignment.id}")) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(assignment.title, style = MaterialTheme.typography.titleLarge)
                                Text(stringResource(if (assignment.targetKind == "paper") R.string.learning_assignment_paper else R.string.learning_assignment_experiment), style = MaterialTheme.typography.labelLarge)
                                Text(stringResource(R.string.learning_assignment_due, displayDate(assignment.dueAt)), style = MaterialTheme.typography.bodyMedium)
                                assignment.instructions?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                            }
                        }
                    }
                }
                if (state.nextCursor != null) item("more") { OutlinedButton(onClick = onMore, enabled = !state.loading, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_load_more)) } }
            }
        }
    }
}

@Composable
internal fun AssignmentContent(
    state: ClassesUiState,
    onRefresh: () -> Unit,
    onAnswer: (String, String) -> Unit,
    onNotes: (String) -> Unit,
    onFreeform: (Boolean) -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    onCompare: () -> Unit,
    onSaveDraft: () -> Unit,
    onOpenExperiment: (String?, JsonObject?) -> Unit,
    onOpenDocument: (String, String) -> Unit,
) {
    var confirmSubmit by rememberSaveable { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize().testTag("assignment-detail"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (state.cached) item("offline") { LearningNotice(stringResource(R.string.learning_assignment_offline), onRefresh) }
        if (state.problem != null) item("error") { LearningError(state.problem, onRefresh) }
        if (state.loading && state.target == null) item("loading") { LearningLoading() }
        val target = state.target
        if (target != null) {
            item("header") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(target.assignment.title, style = MaterialTheme.typography.headlineMedium)
                    Text(stringResource(R.string.learning_assignment_due, displayDate(target.assignment.dueAt)), style = MaterialTheme.typography.bodyMedium)
                    target.assignment.instructions?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
                }
            }
            if (target.experimentId != null) item("experiment") {
                Button(onClick = { onOpenExperiment(target.experimentId, target.experimentScene) }, modifier = Modifier.fillMaxWidth().testTag("assignment-open-experiment")) { Text(stringResource(R.string.learning_assignment_start_experiment)) }
            }
            if (target.paperTitle != null) {
                item("paper") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(target.paperTitle, style = MaterialTheme.typography.titleLarge)
                        OutlinedButton(onClick = { onOpenDocument(target.paperTitle, target.paperMarkdown) }, modifier = Modifier.fillMaxWidth().testTag("assignment-open-paper")) { Text(stringResource(R.string.learning_assignment_read_paper)) }
                        Text(stringResource(if (target.answersReleased) R.string.learning_assignment_answers_released else R.string.learning_assignment_answers_private), style = MaterialTheme.typography.bodySmall)
                    }
                }
                item("answer-mode") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !state.draft.freeform, onClick = { onFreeform(false) }, enabled = !state.editsLocked, label = { Text(stringResource(R.string.learning_assignment_question_mode)) })
                        FilterChip(selected = state.draft.freeform, onClick = { onFreeform(true) }, enabled = !state.editsLocked, label = { Text(stringResource(R.string.learning_assignment_freeform_mode)) })
                    }
                }
                if (!state.draft.freeform) items(target.questions, key = { it.key }, contentType = { it.kind }) { question ->
                    AssignmentQuestion(question, state.draft.answers[question.key].orEmpty(), !state.editsLocked, { onAnswer(question.key, it) }, { onOpenDocument(target.paperTitle, question.markdown) })
                }
                if (target.questions.isEmpty()) item("paper-empty") { LearningEmpty(stringResource(R.string.learning_assignment_paper_empty), stringResource(R.string.learning_assignment_paper_empty_description)) }
            }
            item("notes") {
                OutlinedTextField(
                    value = state.draft.notes, onValueChange = onNotes, enabled = !state.editsLocked,
                    label = { Text(stringResource(if (target.experimentId != null) R.string.learning_assignment_report else if (state.draft.freeform) R.string.learning_assignment_complete_answer else R.string.learning_assignment_notes)) },
                    modifier = Modifier.fillMaxWidth().testTag("assignment-notes"), minLines = 5, maxLines = 12,
                )
            }
            item("draft") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(if (state.draftSaved) R.string.learning_draft_saved else R.string.learning_draft_saving), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = onSaveDraft, modifier = Modifier.testTag("assignment-save-draft")) { Text(stringResource(R.string.learning_save_draft)) }
                }
            }
            if (state.actionProblem != null) item("action-error") { LearningError(state.actionProblem, if (state.draft.operationKey != null) onRetry else onSaveDraft) }
            if (state.changedElsewhere) item("changed") {
                LearningNotice(stringResource(R.string.learning_assignment_changed_elsewhere), onCompare,
                    actionLabel = R.string.learning_compare_versions)
            }
            state.operation?.let { operation -> item("sync") { LearningSyncStatus(operation.state, onRetry, onCompare) } }
            if (state.draft.operationKey != null && state.operation == null) item("prepared") { LearningNotice(stringResource(R.string.learning_sync_prepared), onRetry) }
            item("submit") {
                Button(onClick = { confirmSubmit = true }, enabled = !state.editsLocked, modifier = Modifier.fillMaxWidth().testTag("assignment-submit")) {
                    Text(stringResource(if (state.receipt == null) R.string.learning_assignment_submit else R.string.learning_assignment_resubmit))
                }
                Text(stringResource(R.string.learning_assignment_submission_hint), Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
        state.receipt?.let { receipt ->
            item("receipt") {
                Card(Modifier.fillMaxWidth().testTag("assignment-receipt")) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(stringResource(R.string.learning_assignment_receipt), style = MaterialTheme.typography.titleLarge)
                        Text(receiptStatusLabel(receipt.status), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.learning_assignment_submitted_at, displayDate(receipt.submittedAt)))
                        if (receipt.late) Text(stringResource(R.string.learning_assignment_late))
                        receipt.score?.let { Text(stringResource(R.string.learning_assignment_score, it.toString()), style = MaterialTheme.typography.titleMedium) }
                        receipt.reviewComment?.let { Text(it) }
                        receipt.reviewedAt?.let { Text(stringResource(R.string.learning_assignment_reviewed_at, displayDate(it)), style = MaterialTheme.typography.bodySmall) }
                        if (receipt.status == "submitted") Text(stringResource(R.string.learning_assignment_awaiting_review))
                        OutlinedButton(onClick = { onOpenDocument(state.target?.assignment?.title.orEmpty(), receipt.content) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_assignment_view_submitted)) }
                    }
                }
            }
        }
        if (!state.loading && state.target == null && state.problem == null) item("no-target") {
            LearningEmpty(stringResource(R.string.learning_assignment_target_unavailable), stringResource(R.string.learning_assignment_target_unavailable_description))
        }
    }
    if (confirmSubmit) AlertDialog(
        onDismissRequest = { confirmSubmit = false },
        title = { Text(stringResource(R.string.learning_assignment_confirm_title)) },
        text = { Text(stringResource(R.string.learning_assignment_confirm_description)) },
        confirmButton = { TextButton(onClick = { confirmSubmit = false; onSubmit() }, modifier = Modifier.testTag("assignment-confirm-submit")) { Text(stringResource(R.string.learning_assignment_submit)) } },
        dismissButton = { TextButton(onClick = { confirmSubmit = false }) { Text(stringResource(R.string.learning_cancel)) } },
    )
}

@Composable
private fun AssignmentQuestion(question: PaperQuestion, answer: String, enabled: Boolean, onAnswer: (String) -> Unit, onOpenDocument: () -> Unit) {
    var reveal by rememberSaveable(question.key) { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth().testTag("assignment-question-${question.key}")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (question.section.isNotBlank()) Text(question.section, style = MaterialTheme.typography.labelLarge)
            Text(stringResource(R.string.learning_assignment_question_number, question.number), style = MaterialTheme.typography.titleMedium)
            question.score?.let { Text(stringResource(R.string.learning_assignment_question_score, it.toString()), style = MaterialTheme.typography.labelMedium) }
            Text(question.stem, style = MaterialTheme.typography.bodyLarge)
            question.subQuestions.forEach { Text(it) }
            question.figureCaption?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            TextButton(onClick = onOpenDocument) { Text(stringResource(R.string.learning_open_document)) }
            if (question.kind == "choice-single" && question.options.isNotEmpty()) {
                question.options.forEachIndexed { index, option ->
                    val optionId = ('A'.code + index).toChar().toString()
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = answer == optionId, enabled = enabled, role = Role.RadioButton, onClick = { onAnswer(optionId) }).padding(vertical = 4.dp).testTag("assignment-option-${question.key}-$optionId"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = answer == optionId, onClick = null, enabled = enabled)
                        Text("$optionId. $option", Modifier.padding(start = 8.dp))
                    }
                }
            } else if (question.kind == "choice-multi" && question.options.isNotEmpty()) {
                val selected = answer.split(',').map(String::trim).filter(String::isNotEmpty).toSet()
                question.options.forEachIndexed { index, option ->
                    val optionId = ('A'.code + index).toChar().toString()
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Checkbox(checked = optionId in selected, onCheckedChange = { checked -> onAnswer((if (checked) selected + optionId else selected - optionId).sorted().joinToString(", ")) }, enabled = enabled, modifier = Modifier.testTag("assignment-option-${question.key}-$optionId"))
                        Text("$optionId. $option")
                    }
                }
            } else {
                OutlinedTextField(value = answer, onValueChange = onAnswer, enabled = enabled, label = { Text(stringResource(R.string.learning_assignment_answer)) }, minLines = 3, maxLines = 8, modifier = Modifier.fillMaxWidth().testTag("assignment-answer-${question.key}"))
            }
            question.solution?.let { solution ->
                TextButton(onClick = { reveal = !reveal }) { Text(stringResource(if (reveal) R.string.learning_hide_solution else R.string.learning_show_solution)) }
                if (reveal) Text(solution)
            }
        }
    }
}

@Composable
internal fun receiptStatusLabel(status: String): String = stringResource(when (status) {
    "accepted" -> R.string.learning_assignment_accepted
    "returned" -> R.string.learning_assignment_returned
    else -> R.string.learning_assignment_received
})
