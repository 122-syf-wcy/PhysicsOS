package com.physicsos.student.feature.home

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.ui.res.painterResource
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.physicsos.student.R
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

internal data class LearningProblem(@StringRes val message: Int, val retryable: Boolean = true)

internal fun Throwable.learningProblem(): LearningProblem {
    if (this is CancellationException) throw this
    return when (this) {
        is ApiException -> when {
            status == 401 || code == "session_changed" -> LearningProblem(R.string.learning_session_expired, false)
            status == 403 -> LearningProblem(R.string.learning_access_denied, false)
            status == 404 -> LearningProblem(R.string.learning_not_available, false)
            status == 409 -> LearningProblem(R.string.learning_version_conflict, false)
            status == 429 -> LearningProblem(R.string.learning_rate_limited)
            status == 413 -> LearningProblem(R.string.learning_file_too_large, false)
            status == 400 || status == 422 -> LearningProblem(R.string.learning_invalid_request, false)
            status == 0 && code.contains("storage", true) -> LearningProblem(R.string.learning_storage_error)
            status == 0 -> LearningProblem(R.string.learning_network_error)
            else -> LearningProblem(R.string.learning_server_error, retryable)
        }
        is IOException -> LearningProblem(R.string.learning_network_error)
        is LearningContractException -> LearningProblem(R.string.learning_contract_error)
        else -> LearningProblem(R.string.learning_operation_failed)
    }
}

internal class LearningContractException : IllegalStateException()

internal fun JsonElement.asObject(): JsonObject = this as? JsonObject ?: throw LearningContractException()
internal fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    ?.takeIf { it.isNotBlank() }
internal fun JsonObject.requiredText(key: String): String = text(key) ?: throw LearningContractException()
internal fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
internal fun JsonObject.array(key: String): List<JsonElement> = (this[key] as? JsonArray)?.toList().orEmpty()
internal fun JsonObject.strings(key: String): List<String> = array(key).mapNotNull {
    (it as? JsonPrimitive)?.contentOrNull
}
internal fun JsonObject.flag(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
internal fun JsonObject.integer(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull
internal fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
internal fun JsonObject.number(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
internal fun JsonObject.itemOrNull(key: String = "item"): JsonObject? = when (val value = this[key]) {
    null, JsonNull -> null
    is JsonObject -> value
    else -> throw LearningContractException()
}

internal fun encoded(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

internal fun safeHttpsUrl(value: String?): String? = value?.takeIf {
    runCatching {
        val uri = URI(it)
        uri.scheme.equals("https", true) && !uri.host.isNullOrBlank() && uri.rawUserInfo == null
    }.getOrDefault(false)
}

internal fun displayDate(value: String?): String = value?.let {
    runCatching {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withZone(ZoneId.systemDefault()).format(Instant.parse(it))
    }.getOrDefault(it)
}.orEmpty()

internal fun userKey(graph: AppGraph): String? = (graph.auth.state.value as? AuthState.SignedIn)?.user?.userKey

internal fun learningOwnerIdentity(state: AuthState, includeGuest: Boolean = false): Pair<String, String>? = when (state) {
    is AuthState.SignedIn -> state.user.userKey to state.user.userId
    AuthState.SignedOut -> if (includeGuest) "guest" to "guest" else null
    AuthState.Restoring -> null
}

internal fun learningOwnerAllowed(state: AuthState, owner: String): Boolean =
    if (owner == "guest") state is AuthState.SignedOut else (state as? AuthState.SignedIn)?.user?.userKey == owner

internal fun requireOwner(graph: AppGraph, owner: String) {
    if (!learningOwnerAllowed(graph.auth.state.value, owner)) throw CancellationException("Account changed")
}

/** Every request, image task and draft write is cancelled when its account leaves. */
internal abstract class OwnedLearningViewModel(protected val graph: AppGraph) : ViewModel() {
    private var accountScope: CoroutineScope? = null
    protected var owner: String? = null
        private set

    protected abstract fun clearAccount()

    protected fun watchAccount(includeGuest: Boolean = false, load: suspend CoroutineScope.(String) -> Unit) {
        viewModelScope.launch {
            graph.auth.state.map { learningOwnerIdentity(it, includeGuest) }
                .distinctUntilChanged().collectLatest { identity ->
                    val next = identity?.first
                    accountScope = null
                    owner = next
                    clearAccount()
                    if (next != null) coroutineScope {
                        accountScope = this
                        try {
                            load(next)
                            awaitCancellation()
                        } finally {
                            accountScope = null
                        }
                    }
                }
        }
    }

    protected fun launchOwned(block: suspend CoroutineScope.(String) -> Unit): Job? {
        val current = owner ?: return null
        return accountScope?.launch {
            requireOwner(graph, current)
            block(current)
        }
    }
}

internal class LearningViewModelFactory<T : ViewModel>(private val create: () -> T) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <V : ViewModel> create(modelClass: Class<V>): V {
        val instance = create()
        check(modelClass.isInstance(instance))
        return instance as V
    }
}

internal data class LearningPage(
    val items: List<JsonObject>,
    val nextCursor: String?,
    val cached: Boolean,
    val updatedAt: Long,
    val problem: LearningProblem? = null,
)

internal fun parseCollection(payload: JsonObject): List<JsonObject> {
    val items = payload["items"] as? JsonArray ?: throw LearningContractException()
    return items.map { it.asObject() }
}

/** Stores only successfully validated envelopes, separately for every account and query. */
internal class LearningCache(private val graph: AppGraph) {
    suspend fun page(owner: String, path: String, cursor: String? = null, limit: Int = 50): LearningPage =
        withContext(Dispatchers.IO) {
            requireOwner(graph, owner)
            val kind = "learning.http.$path"
            val query = buildString {
                append(path)
                append(if ('?' in path) '&' else '?')
                append("limit=$limit")
                if (cursor != null) append("&cursor=${encoded(cursor)}")
            }
            val cached = graph.store.cachedPage(kind, owner, cursor)
            try {
                val payload = graph.api.request("GET", query).asObject()
                requireOwner(graph, owner)
                val items = parseCollection(payload)
                val next = payload.text("nextCursor")
                if (next != null && next == cursor) throw LearningContractException()
                val now = System.currentTimeMillis()
                graph.store.cachePage(kind, owner, cursor, payload, next, now)
                LearningPage(items, next, cached = false, updatedAt = now)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                requireOwner(graph, owner)
                val canUseCache = error is IOException || error is ApiException && error.retryable
                if (!canUseCache || cached == null) throw error
                LearningPage(
                    parseCollection(cached.payload), cached.nextCursor, cached = true,
                    updatedAt = cached.updatedAt, problem = error.learningProblem(),
                )
            }
        }

    suspend fun cachedPage(owner: String, path: String, cursor: String? = null): LearningPage? =
        withContext(Dispatchers.IO) {
            requireOwner(graph, owner)
            graph.store.cachedPage("learning.http.$path", owner, cursor)?.let {
                LearningPage(parseCollection(it.payload), it.nextCursor, true, it.updatedAt)
            }
        }

    suspend fun value(owner: String, path: String): Pair<JsonObject, Boolean> = withContext(Dispatchers.IO) {
        requireOwner(graph, owner)
        val kind = "learning.value"
        try {
            val payload = graph.api.request("GET", path).asObject()
            requireOwner(graph, owner)
            graph.store.put(kind, owner, path, payload)
            payload to false
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            requireOwner(graph, owner)
            val canUseCache = error is IOException || error is ApiException && error.retryable
            val cached = if (canUseCache) graph.store.get(kind, owner, path) else null
            if (cached == null) throw error
            cached.payload to true
        }
    }

    suspend fun cachedValue(owner: String, path: String): JsonObject? = withContext(Dispatchers.IO) {
        requireOwner(graph, owner)
        graph.store.get("learning.value", owner, path)?.payload
    }
}

@Composable
internal fun LearningHeader(title: String, onBack: (() -> Unit)? = null, action: (@Composable () -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (onBack != null) TextButton(onClick = onBack, modifier = Modifier.testTag("learning-back")) {
            Text(stringResource(R.string.learning_back))
        }
        Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
        action?.invoke()
    }
}

@Composable
internal fun LearningNotice(message: String, modifier: Modifier = Modifier) {
    LearningNotice(message, onRetry = null, modifier = modifier)
}

@Composable
internal fun LearningNotice(
    message: String,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
    @StringRes actionLabel: Int = R.string.learning_retry,
) {
    Surface(
        modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(message, style = MaterialTheme.typography.bodyMedium)
            if (onRetry != null) TextButton(onClick = onRetry, modifier = Modifier.testTag("learning-retry")) {
                Text(stringResource(actionLabel))
            }
        }
    }
}

@Composable
internal fun LearningError(problem: LearningProblem?, retry: () -> Unit) {
    if (problem != null) LearningNotice(stringResource(problem.message), if (problem.retryable) retry else null)
}

@Composable
internal fun LearningLoading() {
    Row(
        Modifier.fillMaxWidth().padding(24.dp).testTag("learning-loading"),
        horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(Modifier.sizeIn(maxWidth = 24.dp, maxHeight = 24.dp), strokeWidth = 2.dp)
        Text(stringResource(R.string.learning_loading), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
internal fun LearningEmpty(title: String, description: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 12.dp).testTag("learning-empty"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
internal fun LearningActionCard(title: String, description: String, tag: String, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth().testTag(tag),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(painterResource(R.drawable.ic_nav_chat), null, Modifier.size(25.dp), tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
