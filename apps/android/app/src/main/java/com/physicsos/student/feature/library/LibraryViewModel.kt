package com.physicsos.student.feature.library

import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.R
import androidx.lifecycle.viewModelScope
import com.physicsos.student.feature.home.LearningCache
import com.physicsos.student.feature.home.LearningProblem
import com.physicsos.student.feature.home.OwnedLearningViewModel
import com.physicsos.student.feature.home.encoded
import com.physicsos.student.feature.home.learningProblem
import com.physicsos.student.feature.home.requireOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext

internal data class LibraryUiState(
    val filter: LibraryFilter = LibraryFilter(),
    val entries: List<LibraryEntry> = emptyList(),
    val domains: List<String> = emptyList(),
    val savedKeys: Set<String> = emptySet(),
    val loadingAssets: Boolean = false,
    val loadingRemote: Set<LibraryKind> = emptySet(),
    val assetProblem: LearningProblem? = null,
    val remoteProblem: LearningProblem? = null,
    val actionProblem: LearningProblem? = null,
    val cached: Boolean = false,
    val guest: Boolean = true,
    val nextPages: Map<LibraryKind, String> = emptyMap(),
    val selected: LibraryEntry? = null,
    val related: List<LibraryEntry> = emptyList(),
    val annotationsLoading: Boolean = false,
    val annotationCursor: String? = null,
    val annotationProblem: LearningProblem? = null,
)

internal fun libraryPath(kind: LibraryKind, filter: LibraryFilter): String {
    val base = when (kind) {
        LibraryKind.QUESTIONS -> "library/questions"
        LibraryKind.SOURCES -> "library/sources"
        else -> error("Only verified collections have remote pages")
    }
    val query = buildList {
        if (filter.query.isNotBlank()) add("q=${encoded(filter.query.trim())}")
        when (filter.stage) {
            "junior" -> add("level=zhongkao")
            "senior" -> add("level=gaokao")
        }
        if (filter.domain in setOf("physics", "chemistry")) add("subject=${filter.domain}")
    }
    return if (query.isEmpty()) base else "$base?${query.joinToString("&") }"
}

internal class LibraryViewModel(graph: AppGraph, private val initialKind: LibraryKind) : OwnedLearningViewModel(graph) {
    private val mutable = MutableStateFlow(LibraryUiState(filter = LibraryFilter(kind = initialKind)))
    val state = mutable.asStateFlow()
    private val cache = LearningCache(graph)
    private var localRows: List<LibraryEntry> = emptyList()
    private val remoteRows = mutableMapOf<LibraryKind, List<LibraryEntry>>()
    private var bookmarked: List<LibraryEntry> = emptyList()
    private var assetJob: Job? = null
    private var filterJob: Job? = null
    private var refreshJob: Job? = null
    private var annotationJob: Job? = null
    private val detailStack = mutableListOf<LibraryEntry>()

    init {
        loadAssets()
        watchAccount(includeGuest = true) { current ->
            mutable.update { it.copy(guest = current == "guest") }
            launch {
                try {
                    graph.store.observe(BOOKMARK_KIND, current).collectLatest { saved ->
                        bookmarked = withContext(Dispatchers.Default) { saved.map { LibraryDecoders.bookmark(it.payload) } }
                        mutable.update { it.copy(savedKeys = bookmarked.map { entry -> entry.key }.toSet()) }
                        computeVisible()
                    }
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    mutable.update { it.copy(actionProblem = error.learningProblem()) }
                }
            }
            if (current != "guest") {
                refreshJob?.cancel()
                refreshJob = launchOwned { active -> refreshRemote(active) }
            }
        }
    }

    override fun clearAccount() {
        refreshJob?.cancel()
        annotationJob?.cancel()
        remoteRows.clear()
        bookmarked = emptyList()
        detailStack.clear()
        mutable.value = LibraryUiState(filter = LibraryFilter(kind = initialKind), loadingAssets = assetJob?.isActive == true,
            guest = graph.auth.state.value !is AuthState.SignedIn)
        computeVisible()
    }

    /** Public APK resources do not wait for login or an online refresh grant. */
    private fun loadAssets() {
        assetJob?.cancel()
        assetJob = viewModelScope.launch {
            mutable.update { it.copy(loadingAssets = true, assetProblem = null) }
            try {
                localRows = withContext(Dispatchers.IO) {
                    LibraryDecoders.bundled(graph.catalog.library(), graph.catalog.experiments())
                }
                mutable.update { it.copy(loadingAssets = false) }
                computeVisible()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(loadingAssets = false, assetProblem = error.learningProblem()) }
            }
        }
    }

    fun refresh() {
        loadAssets()
        refreshJob?.cancel()
        refreshJob = launchOwned { current -> if (current != "guest") refreshRemote(current) }
    }

    fun updateFilter(filter: LibraryFilter) {
        val old = state.value.filter
        val next = filter.copy(query = filter.query.take(160))
        mutable.update { it.copy(filter = next) }
        computeVisible()
        if (old.query != next.query || old.stage != next.stage || old.domain != next.domain) {
            refreshJob?.cancel()
            remoteRows.clear()
            mutable.update { it.copy(nextPages = emptyMap(), remoteProblem = null, cached = false, loadingRemote = emptySet()) }
            refreshJob = launchOwned { current ->
                if (current == "guest") return@launchOwned
                delay(250)
                refreshRemote(current)
            }
        }
    }

    private suspend fun refreshRemote(current: String) = supervisorScope {
        mutable.update { it.copy(remoteProblem = null, cached = false) }
        listOf(LibraryKind.QUESTIONS, LibraryKind.SOURCES).forEach { kind ->
            launch { fetchPage(current, kind, append = false) }
        }
    }

    fun loadMore(kind: LibraryKind) {
        if (kind in state.value.loadingRemote || state.value.nextPages[kind] == null) return
        launchOwned { current -> fetchPage(current, kind, append = true) }
    }

    private suspend fun fetchPage(current: String, kind: LibraryKind, append: Boolean) {
        val filter = state.value.filter
        val path = libraryPath(kind, filter)
        val cursor = if (append) state.value.nextPages[kind] else null
        mutable.update { it.copy(loadingRemote = it.loadingRemote + kind) }
        try {
            if (!append) cache.cachedPage(current, path)?.let { page ->
                remoteRows[kind] = withContext(Dispatchers.Default) { page.items.map { LibraryDecoders.verified(it, kind) } }
                mutable.update { it.copy(cached = true) }
                computeVisible()
            }
            val page = cache.page(current, path, cursor)
            val entries = withContext(Dispatchers.Default) { page.items.map { LibraryDecoders.verified(it, kind) } }
            remoteRows[kind] = ((if (append) remoteRows[kind].orEmpty() else emptyList()) + entries).distinctBy { it.key }
            mutable.update {
                val cursors = it.nextPages - kind
                it.copy(
                    loadingRemote = it.loadingRemote - kind,
                    cached = page.cached || it.cached && append,
                    remoteProblem = page.problem ?: it.remoteProblem,
                    nextPages = if (page.nextCursor == null) cursors else cursors + (kind to page.nextCursor),
                )
            }
            computeVisible()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (error is com.physicsos.student.core.ApiException && error.status in setOf(401, 403, 404)) remoteRows.remove(kind)
            mutable.update { it.copy(loadingRemote = it.loadingRemote - kind, remoteProblem = error.learningProblem()) }
            computeVisible()
        }
    }

    private fun computeVisible() {
        filterJob?.cancel()
        val rows = (localRows + remoteRows.values.flatten() + bookmarked).distinctBy { it.key }
        val filter = state.value.filter
        val saved = state.value.savedKeys
        filterJob = viewModelScope.launch {
            val visible = withContext(Dispatchers.Default) {
                LibraryDecoders.filter(rows, filter, saved).sortedWith(compareBy(
                    // Offline questions/knowledge first; online textbooks after.
                    { !it.offline },
                    { when (it.kind) { LibraryKind.QUESTIONS -> 0; LibraryKind.KNOWLEDGE -> 1; LibraryKind.EXPERIMENTS -> 2; else -> 3 } },
                    { it.title },
                ))
            }
            val domains = withContext(Dispatchers.Default) { rows.mapNotNull { it.domain }.distinct().sorted() }
            mutable.update { it.copy(entries = visible, domains = domains) }
        }
    }

    fun save(entry: LibraryEntry) {
        if (owner == null) {
            mutable.update { it.copy(actionProblem = LearningProblem(R.string.learning_session_expired, false)) }
            return
        }
        launchOwned { current ->
            try {
                withContext(Dispatchers.IO) {
                    requireOwner(graph, current)
                    if (entry.key in state.value.savedKeys) graph.store.delete(BOOKMARK_KIND, current, entry.key)
                    else graph.store.put(BOOKMARK_KIND, current, entry.key, entry.bookmark())
                }
                mutable.update { it.copy(actionProblem = null) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(actionProblem = error.learningProblem()) }
            }
        }
    }

    fun select(entry: LibraryEntry, stack: Boolean = true) {
        if (stack) state.value.selected?.let { detailStack.add(it) }
        annotationJob?.cancel()
        val rows = (localRows + remoteRows.values.flatten() + bookmarked).distinctBy { it.key }
        val relatedIds = entry.relatedIds + entry.chapters.flatMap { it.relatedIds }
        mutable.update {
            it.copy(selected = entry, related = rows.filter { row -> row.id in relatedIds }, annotationCursor = null, annotationProblem = null, annotationsLoading = false)
        }
        if (entry.kind == LibraryKind.SOURCES && entry.origin == LibraryOrigin.VERIFIED) loadAnnotations(append = false)
    }

    fun closeDetail() {
        annotationJob?.cancel()
        val previous = detailStack.removeLastOrNull()
        if (previous == null) mutable.update { it.copy(selected = null, related = emptyList(), annotationCursor = null, annotationProblem = null) }
        else select(previous, stack = false)
    }

    fun loadAnnotations(append: Boolean) {
        val source = state.value.selected?.takeIf { it.kind == LibraryKind.SOURCES && it.origin == LibraryOrigin.VERIFIED } ?: return
        if (state.value.annotationsLoading) return
        annotationJob = launchOwned { current ->
            mutable.update { it.copy(annotationsLoading = true, annotationProblem = null) }
            try {
                val path = "library/annotations?source=${encoded(source.id)}"
                val page = cache.page(current, path, if (append) state.value.annotationCursor else null)
                val entries = withContext(Dispatchers.Default) { page.items.map(LibraryDecoders::annotation) }
                mutable.update {
                    it.copy(related = ((if (append) it.related else emptyList()) + entries).distinctBy { row -> row.key }, annotationCursor = page.nextCursor, annotationsLoading = false, annotationProblem = page.problem, cached = it.cached || page.cached)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(annotationsLoading = false, annotationProblem = error.learningProblem()) }
            }
        }
    }

    companion object { const val BOOKMARK_KIND = "learning.library.bookmarks" }
}
