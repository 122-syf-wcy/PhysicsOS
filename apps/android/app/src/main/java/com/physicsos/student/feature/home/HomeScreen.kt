package com.physicsos.student.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal data class HomeAttempt(val id: String, val title: String, val prompt: String, val at: String?, val sessionId: String?)
internal data class HomeNotice(val id: String, val title: String, val markdown: String, val at: String?)
internal data class PlatformMessage(val title: String, val body: String, val version: Int)
internal data class HomeUiState(
    val displayName: String = "",
    val attempts: List<HomeAttempt> = emptyList(),
    val notices: List<HomeNotice> = emptyList(),
    val platform: PlatformMessage? = null,
    val loadingAttempts: Boolean = false,
    val loadingNotices: Boolean = false,
    val cached: Boolean = false,
    val attemptProblem: LearningProblem? = null,
    val noticeProblem: LearningProblem? = null,
    val acknowledging: Boolean = false,
)

internal class HomeViewModel(graph: AppGraph) : OwnedLearningViewModel(graph) {
    private val mutable = MutableStateFlow(HomeUiState())
    val state = mutable.asStateFlow()
    private val cache = LearningCache(graph)
    private var refreshJob: Job? = null

    init { watchAccount { refresh() } }

    override fun clearAccount() {
        mutable.value = HomeUiState(displayName = (graph.auth.state.value as? AuthState.SignedIn)?.user?.displayName.orEmpty())
    }

    fun refresh() {
        refreshJob?.cancel()
        refreshJob = launchOwned { current ->
            supervisorScope {
                launch {
                    mutable.update { it.copy(loadingAttempts = true, attemptProblem = null) }
                    try {
                        cache.cachedPage(current, "learning/attempts")?.let { page ->
                            val attempts = withContext(Dispatchers.Default) { page.items.take(3).map(::parseAttempt) }
                            mutable.update { it.copy(attempts = attempts, cached = true) }
                        }
                        val page = cache.page(current, "learning/attempts")
                        val attempts = withContext(Dispatchers.Default) { page.items.take(3).map(::parseAttempt) }
                        mutable.update { it.copy(attempts = attempts, cached = page.cached, loadingAttempts = false, attemptProblem = page.problem) }
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        mutable.update { it.copy(loadingAttempts = false, attemptProblem = error.learningProblem()) }
                    }
                }
                launch {
                    mutable.update { it.copy(loadingNotices = true, noticeProblem = null) }
                    try {
                        val page = cache.page(current, "notices/announcements")
                        val notices = withContext(Dispatchers.Default) { page.items.map(::parseNotice) }
                        mutable.update { it.copy(notices = notices, loadingNotices = false, noticeProblem = page.problem) }
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        mutable.update { it.copy(loadingNotices = false, noticeProblem = error.learningProblem()) }
                    }
                }
                launch {
                    try {
                        val (payload, _) = cache.value(current, "notices/platform")
                        val notice = payload.obj("notice")
                        val version = notice?.integer("version")
                        val acknowledged = payload.integer("acknowledgedVersion") ?: 0
                        val platform = if (notice != null && notice.flag("enabled") == true && version != null && version > acknowledged) {
                            PlatformMessage(notice.requiredText("title"), notice.requiredText("body"), version)
                        } else null
                        mutable.update { it.copy(platform = platform) }
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        mutable.update { it.copy(noticeProblem = error.learningProblem()) }
                    }
                }
            }
        }
    }

    fun acknowledge() {
        val notice = state.value.platform ?: return
        if (state.value.acknowledging) return
        launchOwned { current ->
            mutable.update { it.copy(acknowledging = true, noticeProblem = null) }
            try {
                withContext(Dispatchers.IO) {
                    graph.api.request("POST", "notices/platform/ack", buildJsonObject { put("version", notice.version) })
                    requireOwner(graph, current)
                    graph.store.delete("learning.value", current, "notices/platform")
                }
                mutable.update { it.copy(platform = null, acknowledging = false) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(acknowledging = false, noticeProblem = error.learningProblem()) }
            }
        }
    }

    private fun parseAttempt(row: JsonObject) = HomeAttempt(
        row.requiredText("id"), row.text("questionTitle").orEmpty(), row.text("prompt").orEmpty(), row.text("at"), row.text("sessionId"),
    )

    private fun parseNotice(row: JsonObject) = HomeNotice(
        row.requiredText("id"), row.requiredText("title"), row.requiredText("body"), row.text("publishedAt") ?: row.text("createdAt"),
    )
}

@Composable
fun HomeScreen(
    graph: AppGraph,
    onOpenChat: (sessionId: String?, prompt: String?) -> Unit,
    onOpenExperiments: () -> Unit,
    onOpenLibrary: () -> Unit,
    onOpenClasses: () -> Unit,
    onOpenRecords: () -> Unit,
    onOpenAccount: () -> Unit,
    onOpenDocument: (title: String, markdown: String) -> Unit,
    onContentReady: () -> Unit = {},
) {
    val factory = remember(graph) { LearningViewModelFactory { HomeViewModel(graph) } }
    val model: HomeViewModel = viewModel(factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    HomeContent(state, model::refresh, model::acknowledge, onOpenChat, onOpenExperiments, onOpenLibrary, onOpenClasses, onOpenRecords, onOpenAccount, onOpenDocument, onContentReady)
}

@Composable
internal fun HomeContent(
    state: HomeUiState,
    onRefresh: () -> Unit,
    onAcknowledge: () -> Unit,
    onOpenChat: (String?, String?) -> Unit,
    onOpenExperiments: () -> Unit,
    onOpenLibrary: () -> Unit,
    onOpenClasses: () -> Unit,
    onOpenRecords: () -> Unit,
    onOpenAccount: () -> Unit,
    onOpenDocument: (String, String) -> Unit,
    onContentReady: () -> Unit = {},
) {
    var actionsLaidOut by remember { mutableStateOf(false) }
    LaunchedEffect(actionsLaidOut) { if (actionsLaidOut) onContentReady() }
    Column(Modifier.fillMaxSize().testTag("home")) {
        LearningHeader(stringResource(R.string.learning_home_title), action = {
            TextButton(onClick = onOpenAccount, modifier = Modifier.testTag("home-account")) { Text(stringResource(R.string.learning_account_title)) }
        })
        LazyColumn(
            Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item("welcome") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (state.displayName.isBlank()) stringResource(R.string.learning_home_welcome) else stringResource(R.string.learning_home_welcome_name, state.displayName), style = MaterialTheme.typography.headlineMedium)
                    Text(stringResource(R.string.learning_home_description), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item("primary-actions") {
                Column(
                    Modifier.fillMaxWidth().testTag("home_primary_actions").onGloballyPositioned { coordinates ->
                        if (coordinates.size.width > 0 && coordinates.size.height > 0) actionsLaidOut = true
                    },
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    LearningActionCard(stringResource(R.string.learning_home_chat), stringResource(R.string.learning_home_chat_description), "home-chat") { onOpenChat(null, null) }
                    LearningActionCard(stringResource(R.string.learning_home_experiments), stringResource(R.string.learning_home_experiments_description), "home-experiments", onOpenExperiments)
                    LearningActionCard(stringResource(R.string.learning_library_title), stringResource(R.string.learning_home_library_description), "home-library", onOpenLibrary)
                    LearningActionCard(stringResource(R.string.learning_classes_title), stringResource(R.string.learning_home_classes_description), "home-classes", onOpenClasses)
                }
            }
            item("recent-title") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stringResource(R.string.learning_home_recent), style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onOpenRecords, modifier = Modifier.testTag("home-records")) { Text(stringResource(R.string.learning_view_all)) }
                }
            }
            if (state.cached) item("offline") { LearningNotice(stringResource(R.string.learning_cached_description), onRefresh) }
            if (state.attemptProblem != null) item("attempt-error") { LearningError(state.attemptProblem, onRefresh) }
            if (state.loadingAttempts && state.attempts.isEmpty()) item("attempt-loading") { LearningLoading() }
            if (!state.loadingAttempts && state.attempts.isEmpty() && state.attemptProblem == null) item("attempt-empty") {
                LearningEmpty(stringResource(R.string.learning_records_empty), stringResource(R.string.learning_records_empty_description))
            }
            items(state.attempts, key = { "attempt:${it.id}" }) { attempt ->
                Card(onClick = { onOpenChat(attempt.sessionId, attempt.prompt.takeIf(String::isNotBlank)) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(attempt.title.ifBlank { stringResource(R.string.learning_record_untitled) }, style = MaterialTheme.typography.titleMedium)
                        if (attempt.at != null) Text(displayDate(attempt.at), style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(R.string.learning_continue), color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            item("notice-title") { Text(stringResource(R.string.learning_notices_title), style = MaterialTheme.typography.titleLarge) }
            if (state.noticeProblem != null) item("notice-error") { LearningError(state.noticeProblem, onRefresh) }
            state.platform?.let { platform ->
                item("platform:${platform.version}") {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(platform.title, style = MaterialTheme.typography.titleMedium)
                            Text(platform.body)
                            TextButton(onClick = onAcknowledge, enabled = !state.acknowledging, modifier = Modifier.testTag("home-ack-notice")) { Text(stringResource(R.string.learning_notice_ack)) }
                        }
                    }
                }
            }
            if (state.loadingNotices && state.notices.isEmpty()) item("notice-loading") { LearningLoading() }
            if (!state.loadingNotices && state.notices.isEmpty() && state.platform == null && state.noticeProblem == null) item("notice-empty") {
                LearningEmpty(stringResource(R.string.learning_notices_empty), stringResource(R.string.learning_notices_empty_description))
            }
            items(state.notices, key = { "notice:${it.id}" }) { notice ->
                Card(onClick = { onOpenDocument(notice.title, notice.markdown) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(notice.title, style = MaterialTheme.typography.titleMedium)
                        notice.at?.let { Text(displayDate(it), style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
            item("refresh") { TextButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth().testTag("home-refresh")) { Text(stringResource(R.string.learning_refresh)) } }
        }
    }
}
