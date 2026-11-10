package com.physicsos.student.feature.classes

import com.physicsos.student.R
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.home.LearningCache
import com.physicsos.student.feature.home.LearningContractException
import com.physicsos.student.feature.home.LearningProblem
import com.physicsos.student.feature.home.OwnedLearningViewModel
import com.physicsos.student.feature.home.asObject
import com.physicsos.student.feature.home.encoded
import com.physicsos.student.feature.home.learningProblem
import com.physicsos.student.feature.home.requireOwner
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal data class SubmissionComparison(val server: SubmissionReceipt?, val localContent: String, val operationId: String?)
internal data class ClassesUiState(
    val classes: List<Classroom> = emptyList(),
    val assignments: List<ClassAssignment> = emptyList(),
    val target: AssignmentTarget? = null,
    val receipt: SubmissionReceipt? = null,
    val draft: AssignmentDraft = AssignmentDraft(),
    val draftSaved: Boolean = true,
    val loading: Boolean = false,
    val cached: Boolean = false,
    val nextCursor: String? = null,
    val problem: LearningProblem? = null,
    val actionProblem: LearningProblem? = null,
    val submitting: Boolean = false,
    val operation: OutboxItem? = null,
    val comparison: SubmissionComparison? = null,
    val changedElsewhere: Boolean = false,
) {
    val editsLocked: Boolean get() = submitting || draft.operationKey != null
}

internal class ClassesViewModel(
    graph: AppGraph,
    val classId: String?,
    val assignmentId: String?,
) : OwnedLearningViewModel(graph) {
    private val mutable = MutableStateFlow(ClassesUiState())
    val state = mutable.asStateFlow()
    private val cache = LearningCache(graph)
    private val draftMutex = Mutex()
    private var refreshJob: Job? = null
    private var draftJob: Job? = null
    private var hadDraft = false
    private val submissionPath = if (classId != null && assignmentId != null) "classes/${encoded(classId)}/assignments/${encoded(assignmentId)}/submission" else null
    private val draftId = "$classId/$assignmentId"

    init {
        watchAccount { current ->
            if (assignmentId != null && classId == null) {
                mutable.update { it.copy(problem = LearningProblem(R.string.learning_invalid_route, false)) }
                return@watchAccount
            }
            if (submissionPath != null) {
                try {
                    val saved = withContext(Dispatchers.IO) { graph.store.get(DRAFT_KIND, current, draftId) }
                    hadDraft = saved != null
                    saved?.let { mutable.update { previous -> previous.copy(draft = AssignmentDraft.from(it.payload)) } }
                    launch {
                        graph.sync.observe(current).collectLatest { operations -> processOperations(current, operations) }
                    }
                    recoverPreparedSubmission(current)
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    mutable.update { it.copy(actionProblem = error.learningProblem()) }
                }
            }
            refresh()
        }
    }

    override fun clearAccount() {
        hadDraft = false
        mutable.value = ClassesUiState()
    }

    fun refresh(append: Boolean = false) {
        if (append && (state.value.loading || state.value.nextCursor == null)) return
        refreshJob?.cancel()
        refreshJob = launchOwned { current ->
            mutable.update { it.copy(loading = true, problem = null) }
            if (assignmentId != null && submissionPath != null) loadDetail(current) else {
                val path = if (classId == null) "classes" else "classes/${encoded(classId)}/assignments"
                try {
                    if (!append) cache.cachedPage(current, path)?.let { page ->
                        withContext(Dispatchers.Default) {
                            if (classId == null) mutable.update { it.copy(classes = page.items.map(ClassDecoders::classroom), cached = true) }
                            else mutable.update { it.copy(assignments = page.items.map(ClassDecoders::assignment), cached = true) }
                        }
                    }
                    val page = cache.page(current, path, if (append) state.value.nextCursor else null)
                    val classrooms = if (classId == null) withContext(Dispatchers.Default) { page.items.map(ClassDecoders::classroom) } else emptyList()
                    val assignments = if (classId != null) withContext(Dispatchers.Default) { page.items.map(ClassDecoders::assignment) } else emptyList()
                    mutable.update {
                        it.copy(
                            classes = ((if (append) it.classes else emptyList()) + classrooms).distinctBy { row -> row.id },
                            assignments = ((if (append) it.assignments else emptyList()) + assignments).distinctBy { row -> row.id },
                            cached = page.cached, loading = false, nextCursor = page.nextCursor, problem = page.problem,
                        )
                    }
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    val denied = error is ApiException && error.status in setOf(401, 403, 404)
                    mutable.update { it.copy(loading = false, problem = error.learningProblem(), classes = if (denied) emptyList() else it.classes, assignments = if (denied) emptyList() else it.assignments) }
                }
            }
        }
    }

    private suspend fun loadDetail(current: String) = supervisorScope {
        val targetPath = submissionPath!!.removeSuffix("submission") + "target"
        launch {
            try {
                cache.cachedValue(current, targetPath)?.let { payload ->
                    val target = withContext(Dispatchers.Default) { ClassDecoders.target(payload) }
                    mutable.update { it.copy(target = target, cached = true) }
                }
                val (payload, cached) = cache.value(current, targetPath)
                val target = withContext(Dispatchers.Default) { ClassDecoders.target(payload) }
                if (target.assignment.id != assignmentId || target.assignment.classId != classId) throw LearningContractException()
                mutable.update { it.copy(target = target, loading = false, cached = cached) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                val denied = error is ApiException && error.status in setOf(401, 403, 404)
                mutable.update { it.copy(loading = false, problem = error.learningProblem(), target = if (denied) null else it.target) }
            }
        }
        launch {
            try {
                val (receipt, cached) = loadReceipt(current, allowCache = true)
                mutable.update { it.copy(receipt = receipt, cached = it.cached || cached) }
                reconcileInitialDraft(receipt)
                persistDraft(current)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    private suspend fun loadReceipt(current: String, allowCache: Boolean): Pair<SubmissionReceipt?, Boolean> = withContext(Dispatchers.IO) {
        val path = submissionPath ?: throw LearningContractException()
        requireOwner(graph, current)
        try {
            val payload = graph.api.request("GET", path).asObject()
            requireOwner(graph, current)
            val receipt = ClassDecoders.receipt(payload)
            graph.store.put("learning.value", current, path, payload)
            receipt to false
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (error is ApiException && error.status == 404) {
                graph.store.put("learning.value", current, path, buildJsonObject { put("item", JsonNull); put("receipt", JsonNull) })
                null to false
            } else {
                val canUseCache = allowCache && (error is IOException || error is ApiException && error.retryable)
                val payload = if (canUseCache) graph.store.get("learning.value", current, path)?.payload else null
                if (payload == null) throw error
                ClassDecoders.receipt(payload) to true
            }
        }
    }

    private fun reconcileInitialDraft(receipt: SubmissionReceipt?) {
        val draft = state.value.draft
        if (draft.operationKey != null) return
        if (!hadDraft && receipt != null) {
            mutable.update { it.copy(draft = AssignmentDraft(notes = receipt.content, freeform = true, baseRevision = receipt.revision, lastSubmittedContent = receipt.content)) }
        } else if (receipt != null && draft.lastSubmittedContent == receipt.content) {
            mutable.update { it.copy(draft = it.draft.copy(baseRevision = receipt.revision), changedElsewhere = false) }
        } else if (receipt?.revision != null && receipt.revision != draft.baseRevision) {
            mutable.update { it.copy(changedElsewhere = true) }
        }
        hadDraft = true
    }

    fun answer(key: String, value: String) {
        if (state.value.editsLocked) return
        mutable.update { it.copy(draft = it.draft.copy(answers = it.draft.answers + (key to value.take(8_000))), draftSaved = false, actionProblem = null) }
        scheduleDraft()
    }

    fun notes(value: String) {
        if (state.value.editsLocked) return
        mutable.update { it.copy(draft = it.draft.copy(notes = value.take(16_000)), draftSaved = false, actionProblem = null) }
        scheduleDraft()
    }

    fun freeform(value: Boolean) {
        if (state.value.editsLocked) return
        mutable.update { it.copy(draft = it.draft.copy(freeform = value), draftSaved = false) }
        scheduleDraft()
    }

    private fun scheduleDraft() {
        draftJob?.cancel()
        draftJob = launchOwned { current ->
            delay(350)
            try { persistDraft(current) } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem(), draftSaved = false) }
            }
        }
    }

    fun saveDraft(after: (() -> Unit)? = null) {
        if (submissionPath == null) { after?.invoke(); return }
        draftJob?.cancel()
        launchOwned { current ->
            try {
                persistDraft(current)
                after?.invoke()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem(), draftSaved = false) }
            }
        }
    }

    private suspend fun persistDraft(current: String) = draftMutex.withLock {
        val draft = state.value.draft
        withContext(Dispatchers.IO) {
            requireOwner(graph, current)
            graph.store.put(DRAFT_KIND, current, draftId, draft.payload())
        }
        mutable.update { it.copy(draftSaved = it.draft == draft) }
    }

    fun submit() {
        val snapshot = state.value
        val target = snapshot.target ?: return
        if (snapshot.editsLocked) return
        if (snapshot.changedElsewhere) { compare(); return }
        val content = snapshot.draft.content(target.questions)
        if (content.isBlank() || content.length > 16_000) {
            mutable.update { it.copy(actionProblem = LearningProblem(R.string.learning_assignment_answer_required, false)) }
            return
        }
        if (snapshot.draft.answers.keys.any { key -> target.questions.none { it.key == key } } && !snapshot.draft.freeform) {
            mutable.update { it.copy(actionProblem = LearningProblem(R.string.learning_assignment_questions_changed, false)) }
            return
        }
        draftJob?.cancel()
        launchOwned { current ->
            mutable.update { it.copy(submitting = true, actionProblem = null) }
            try {
                val key = "android-submission-${UUID.randomUUID()}"
                mutable.update { it.copy(draft = it.draft.copy(operationKey = key, queuedContent = content)) }
                persistDraft(current)
                graph.sync.enqueue("PUT", submissionPath!!, ClassDecoders.submissionBody(content, snapshot.draft.baseRevision), key)
                mutable.update { it.copy(submitting = false) }
                graph.sync.syncNow()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(submitting = false, actionProblem = error.learningProblem()) }
            }
        }
    }

    private suspend fun recoverPreparedSubmission(current: String) {
        val draft = state.value.draft
        val key = draft.operationKey ?: return
        val content = draft.queuedContent ?: return
        val operations = graph.sync.observe(current).first()
        if (operations.none { it.idempotencyKey == key }) {
            graph.sync.enqueue("PUT", submissionPath!!, ClassDecoders.submissionBody(content, draft.baseRevision), key)
        }
    }

    private suspend fun processOperations(current: String, operations: List<OutboxItem>) {
        val matching = operations.filter { it.path == submissionPath }
        val operation = matching.firstOrNull { it.idempotencyKey == state.value.draft.operationKey }
            ?: matching.maxByOrNull { it.createdAt }
        mutable.update { it.copy(operation = operation) }
        if (operation?.state != OutboxState.ACKNOWLEDGED || operation.idempotencyKey != state.value.draft.operationKey) return
        try {
            val result = operation.result?.asObject() ?: throw LearningContractException()
            val receipt = ClassDecoders.receipt(result) ?: throw LearningContractException()
            mutable.update {
                it.copy(
                    receipt = receipt, changedElsewhere = false, actionProblem = null,
                    draft = it.draft.copy(baseRevision = receipt.revision, operationKey = null, queuedContent = null, lastSubmittedContent = receipt.content),
                )
            }
            withContext(Dispatchers.IO) { graph.store.put("learning.value", current, submissionPath!!, result) }
            persistDraft(current)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            mutable.update { it.copy(actionProblem = error.learningProblem()) }
        }
    }

    fun retry() {
        launchOwned { current ->
            try {
                mutable.update { it.copy(actionProblem = null) }
                val operation = state.value.operation
                if (operation == null && state.value.draft.operationKey != null) recoverPreparedSubmission(current)
                else if (operation != null && operation.state != OutboxState.CONFLICT) graph.sync.retry(operation.id)
                graph.sync.syncNow()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    fun compare() {
        if (state.value.submitting) return
        launchOwned { current ->
            mutable.update { it.copy(submitting = true, actionProblem = null) }
            try {
                val (receipt, _) = loadReceipt(current, allowCache = false)
                val snapshot = state.value
                val content = snapshot.draft.queuedContent ?: snapshot.draft.content(snapshot.target?.questions.orEmpty())
                mutable.update { it.copy(submitting = false, comparison = SubmissionComparison(receipt, content, snapshot.operation?.takeIf { op -> op.state == OutboxState.CONFLICT }?.id)) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(submitting = false, actionProblem = error.learningProblem()) }
            }
        }
    }

    fun dismissComparison() = mutable.update { it.copy(comparison = null) }

    fun useServerAnswer() {
        val comparison = state.value.comparison ?: return
        launchOwned { current ->
            try {
                comparison.operationId?.let { graph.sync.discard(it) }
                val receipt = comparison.server
                mutable.update {
                    it.copy(comparison = null, receipt = receipt, changedElsewhere = false, operation = null,
                        draft = AssignmentDraft(notes = receipt?.content.orEmpty(), freeform = true, baseRevision = receipt?.revision ?: 0, lastSubmittedContent = receipt?.content))
                }
                persistDraft(current)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    fun resubmitComparedAnswer() {
        val comparison = state.value.comparison ?: return
        if (comparison.localContent.isBlank()) return
        launchOwned { current ->
            mutable.update { it.copy(submitting = true, actionProblem = null) }
            try {
                val revision = comparison.server?.revision ?: 0
                val key = "android-submission-${UUID.randomUUID()}"
                val body = ClassDecoders.submissionBody(comparison.localContent, revision)
                mutable.update { it.copy(draft = it.draft.copy(operationKey = key, queuedContent = comparison.localContent, baseRevision = revision), comparison = null) }
                persistDraft(current)
                if (comparison.operationId != null) graph.sync.resolveConflict(comparison.operationId, body, key)
                else graph.sync.enqueue("PUT", submissionPath!!, body, key)
                mutable.update { it.copy(submitting = false, changedElsewhere = false) }
                graph.sync.syncNow()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(submitting = false, actionProblem = error.learningProblem()) }
            }
        }
    }

    companion object { const val DRAFT_KIND = "learning.assignment.draft" }
}
