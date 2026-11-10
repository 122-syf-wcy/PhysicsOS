package com.physicsos.student.feature.records

import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.home.LearningCache
import com.physicsos.student.feature.home.LearningProblem
import com.physicsos.student.feature.home.OwnedLearningViewModel
import com.physicsos.student.feature.home.asObject
import com.physicsos.student.feature.home.encoded
import com.physicsos.student.feature.home.learningProblem
import com.physicsos.student.feature.home.long
import com.physicsos.student.feature.home.obj
import com.physicsos.student.feature.home.requireOwner
import com.physicsos.student.feature.home.text
import java.net.URLDecoder
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal data class RecordConflict(
    val operation: OutboxItem,
    val baseRevision: Long?,
    val currentRevision: Long?,
    val localContent: String?,
    val serverContent: String?,
    val sceneId: String?,
)

internal data class RecordsUiState(
    val tab: RecordTab = RecordTab.ATTEMPTS,
    val attempts: List<LearningAttempt> = emptyList(),
    val scenes: List<SavedLearningScene> = emptyList(),
    val operations: List<OutboxItem> = emptyList(),
    val nextAttempts: String? = null,
    val nextScenes: String? = null,
    val loadingAttempts: Boolean = false,
    val loadingScenes: Boolean = false,
    val cachedAttempts: Boolean = false,
    val cachedScenes: Boolean = false,
    val attemptsProblem: LearningProblem? = null,
    val scenesProblem: LearningProblem? = null,
    val actionProblem: LearningProblem? = null,
    val selectedAttempt: LearningAttempt? = null,
    val conflict: RecordConflict? = null,
    val syncing: Boolean = false,
)

internal class RecordsViewModel(graph: AppGraph, private val initialTab: RecordTab) : OwnedLearningViewModel(graph) {
    private val mutable = MutableStateFlow(RecordsUiState(tab = initialTab))
    val state = mutable.asStateFlow()
    private val cache = LearningCache(graph)
    private var remoteScenes: List<SavedLearningScene> = emptyList()
    private var localScenes: List<SavedLearningScene> = emptyList()
    private val acknowledgedDeletes = mutableMapOf<String, SavedLearningScene>()
    private var refreshJob: Job? = null

    init {
        watchAccount { current ->
            launch {
                try {
                    graph.store.observe(SCENE_INDEX, current).collectLatest { rows ->
                        localScenes = withContext(Dispatchers.Default) { rows.map(RecordDecoders::localScene) }
                        combineScenes()
                    }
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    mutable.update { it.copy(scenesProblem = error.learningProblem()) }
                }
            }
            launch {
                graph.sync.observe(current).collectLatest { rows ->
                    val ordered = rows.sortedByDescending { it.createdAt }
                    mutable.update { it.copy(operations = ordered) }
                    withContext(Dispatchers.Default) {
                        rows.filter { it.method == "DELETE" && it.path.startsWith("learning/scenes/") && it.state == OutboxState.ACKNOWLEDGED }.forEach { operation ->
                            val item = (operation.result as? kotlinx.serialization.json.JsonObject)?.obj("item")
                            if (item?.text("deletedAt") != null) {
                                val tombstone = RecordDecoders.remoteScene(item)
                                acknowledgedDeletes[tombstone.id] = tombstone
                            }
                        }
                    }
                    combineScenes()
                }
            }
            refresh()
        }
    }

    override fun clearAccount() {
        remoteScenes = emptyList()
        localScenes = emptyList()
        acknowledgedDeletes.clear()
        mutable.value = RecordsUiState(tab = initialTab)
    }

    fun tab(tab: RecordTab) = mutable.update { it.copy(tab = tab, selectedAttempt = null, conflict = null) }
    fun selectAttempt(attempt: LearningAttempt?) = mutable.update { it.copy(selectedAttempt = attempt) }
    fun dismissConflict() = mutable.update { it.copy(conflict = null) }

    fun refresh() {
        refreshJob?.cancel()
        refreshJob = launchOwned { current ->
            supervisorScope {
                launch { loadAttempts(current, append = false) }
                launch { loadScenes(current, append = false) }
            }
        }
    }

    fun more() {
        val snapshot = state.value
        launchOwned { current ->
            when (snapshot.tab) {
                RecordTab.ATTEMPTS -> if (!snapshot.loadingAttempts && snapshot.nextAttempts != null) loadAttempts(current, append = true)
                RecordTab.SCENES -> if (!snapshot.loadingScenes && snapshot.nextScenes != null) loadScenes(current, append = true)
                RecordTab.SYNC -> Unit
            }
        }
    }

    private suspend fun loadAttempts(current: String, append: Boolean) {
        mutable.update { it.copy(loadingAttempts = true, attemptsProblem = null) }
        try {
            if (!append) cache.cachedPage(current, "learning/attempts")?.let { page ->
                val rows = withContext(Dispatchers.Default) { page.items.map(RecordDecoders::attempt) }
                mutable.update { it.copy(attempts = rows, cachedAttempts = true) }
            }
            val page = cache.page(current, "learning/attempts", if (append) state.value.nextAttempts else null)
            val rows = withContext(Dispatchers.Default) { page.items.map(RecordDecoders::attempt) }
            mutable.update { it.copy(attempts = ((if (append) it.attempts else emptyList()) + rows).distinctBy { row -> row.id }, nextAttempts = page.nextCursor, loadingAttempts = false, cachedAttempts = page.cached, attemptsProblem = page.problem) }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            mutable.update { it.copy(loadingAttempts = false, attemptsProblem = error.learningProblem()) }
        }
    }

    private suspend fun loadScenes(current: String, append: Boolean) {
        mutable.update { it.copy(loadingScenes = true, scenesProblem = null) }
        try {
            if (!append) cache.cachedPage(current, "learning/scenes")?.let { page ->
                remoteScenes = withContext(Dispatchers.Default) { page.items.map(RecordDecoders::remoteScene) }
                mutable.update { it.copy(cachedScenes = true) }
                combineScenes()
            }
            val page = cache.page(current, "learning/scenes", if (append) state.value.nextScenes else null)
            val rows = withContext(Dispatchers.Default) { page.items.map(RecordDecoders::remoteScene) }
            remoteScenes = ((if (append) remoteScenes else emptyList()) + rows).associateBy { it.id }.values.toList()
            mutable.update { it.copy(nextScenes = page.nextCursor, loadingScenes = false, cachedScenes = page.cached, scenesProblem = page.problem) }
            combineScenes()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            mutable.update { it.copy(loadingScenes = false, scenesProblem = error.learningProblem()) }
        }
    }

    private suspend fun combineScenes() {
        val rows = withContext(Dispatchers.Default) {
            val remote = (remoteScenes + acknowledgedDeletes.values).associateBy { it.id }.values.toList()
            RecordDecoders.mergeScenes(remote, localScenes)
        }
        mutable.update { it.copy(scenes = rows) }
    }

    fun sync() {
        if (state.value.syncing) return
        launchOwned {
            mutable.update { it.copy(syncing = true, actionProblem = null) }
            try {
                graph.sync.syncNow()
                mutable.update { it.copy(syncing = false) }
                refresh()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(syncing = false, actionProblem = error.learningProblem()) }
            }
        }
    }

    fun retry(operation: OutboxItem) {
        if (operation.state == OutboxState.CONFLICT) { inspectConflict(operation); return }
        launchOwned {
            try {
                graph.sync.retry(operation.id)
                graph.sync.syncNow()
                mutable.update { it.copy(actionProblem = null) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    fun discard(operation: OutboxItem) {
        launchOwned {
            try {
                graph.sync.discard(operation.id)
                mutable.update { it.copy(conflict = null, actionProblem = null) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    fun inspectConflict(operation: OutboxItem) {
        launchOwned {
            try {
                val body = withContext(Dispatchers.IO) { graph.sync.operationBody(operation.id) }
                val current = operation.errorDetails?.obj("current")
                val sceneId = operation.path.takeIf { path -> path.startsWith("learning/scenes/") }?.substringAfterLast('/')
                    ?.let { URLDecoder.decode(it, Charsets.UTF_8.name()) }
                mutable.update {
                    it.copy(conflict = RecordConflict(operation, body?.long("baseRevision"), operation.errorDetails?.long("currentRevision"), body?.text("content"), current?.text("content"), sceneId))
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    fun deleteCloudScene(scene: SavedLearningScene) {
        if (scene.deleted || scene.cloudRevision <= 0) return
        launchOwned { current ->
            try {
                val path = "learning/scenes/${encoded(scene.id)}"
                val pending = graph.sync.observe(current).first().any { it.path == path && it.state != OutboxState.ACKNOWLEDGED }
                if (pending) {
                    mutable.update { it.copy(actionProblem = LearningProblem(R.string.learning_scene_pending_before_delete, false)) }
                    return@launchOwned
                }
                graph.sync.enqueue("DELETE", path, buildJsonObject { put("baseRevision", scene.cloudRevision) }, "android-scene-delete-${UUID.randomUUID()}")
                graph.sync.syncNow()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    fun removeLocalScene(scene: SavedLearningScene) {
        if (!scene.hasLocal || scene.cloudRevision > 0 && !scene.deleted) return
        launchOwned { current ->
            try {
                val path = "learning/scenes/${encoded(scene.id)}"
                if (graph.sync.observe(current).first().any { it.path == path && it.state != OutboxState.ACKNOWLEDGED }) {
                    mutable.update { it.copy(actionProblem = LearningProblem(R.string.learning_scene_pending_before_delete, false)) }
                    return@launchOwned
                }
                withContext(Dispatchers.IO) {
                    requireOwner(graph, current)
                    com.physicsos.student.feature.experiments.removeLocalExperiment(graph, scene.id)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    companion object { const val SCENE_INDEX = "experiment-scenes" }
}
