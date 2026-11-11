package com.physicsos.student.feature.document

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.feature.experiments.ExperimentAccount
import com.physicsos.student.feature.experiments.experimentAccount
import com.physicsos.student.feature.experiments.bridge.BridgeLimits
import com.physicsos.student.feature.experiments.bridge.BridgeProtocolException
import com.physicsos.student.feature.experiments.bridge.LabContent
import com.physicsos.student.feature.experiments.bridge.LabWebViewController
import com.physicsos.student.feature.experiments.bridge.StrictBridgeJson
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

internal data class DocumentState(
    val loading: Boolean = true,
    val account: ExperimentAccount? = null,
    val accountChanged: Boolean = false,
    val title: String = "",
    val problem: String? = null,
    val textSize: Float = 1f,
)

/** System font scale and the user's per-document preference are applied once, in the local renderer. */
internal fun documentFontScale(system: Float, preference: Float): Float {
    val systemScale = system.takeIf { it.isFinite() && it > 0 } ?: 1f
    val textSize = preference.takeIf(Float::isFinite)?.coerceIn(0.75f, 2f) ?: 1f
    return (systemScale * textSize).coerceIn(0.5f, 5f)
}

internal fun documentTextSize(value: Float): Float =
    if (!value.isFinite()) 1f else ((value.coerceIn(0.75f, 2f) * 100).roundToInt() / 100f)

internal class DocumentViewModel(
    private val graph: AppGraph,
    context: Context,
    private val savedState: SavedStateHandle,
) : ViewModel() {
    private val appContext = context.applicationContext
    private val _state = MutableStateFlow(DocumentState(textSize = documentTextSize(savedState["textSize"] ?: 1f)))
    val state = _state.asStateFlow()
    private val _renderer = MutableStateFlow<LabWebViewController?>(null)
    val renderer = _renderer.asStateFlow()
    private var markdown = ""
    private var systemScale = 1f
    private var updateJob: Job? = null
    private var input: Pair<String, String>? = null
    private var boundAccount: ExperimentAccount? = null

    init {
        viewModelScope.launch {
            graph.auth.state.collect { auth ->
                val bound = boundAccount ?: return@collect
                if (auth.experimentAccount() != bound) {
                    updateJob?.cancel()
                    _renderer.value?.close()
                    _renderer.value = null
                    markdown = ""
                    input = null
                    _state.update { it.copy(accountChanged = true, loading = false, title = "") }
                }
            }
        }
    }

    fun document(title: String, value: String, systemFontScale: Float) {
        systemScale = systemFontScale
        if (_state.value.accountChanged) return
        if (input == (title to value) && _renderer.value != null) { updateFont(); return }
        input = title to value
        updateJob?.cancel()
        updateJob = viewModelScope.launch {
            _state.update { it.copy(loading = true, problem = null) }
            try {
                val account = graph.auth.state.first { it !is AuthState.Restoring }.experimentAccount()
                    ?: throw BridgeProtocolException("ACCOUNT_UNAVAILABLE")
                val previousOwner = savedState.get<String>("owner")
                if (previousOwner != null && (previousOwner != account.owner || savedState.get<String>("userId") != account.userId)) {
                    _state.update { it.copy(accountChanged = true, loading = false) }
                    return@launch
                }
                boundAccount = account
                savedState["owner"] = account.owner
                savedState["userId"] = account.userId
                withContext(Dispatchers.Default) {
                    if (title.length > 300 || '\u0000' in title || '\u0000' in value) throw BridgeProtocolException("LOCAL_DOCUMENT_INVALID")
                    StrictBridgeJson.utf8Size(value, BridgeLimits.DOCUMENT_BYTES)
                }
                if (graph.auth.state.value.experimentAccount() != account) return@launch
                markdown = value
                val content = LabContent.Document(title, markdown, documentFontScale(systemScale, _state.value.textSize))
                val current = _renderer.value
                if (current == null) _renderer.value = LabWebViewController(appContext, content, {}, { code ->
                    if (graph.auth.state.value.experimentAccount() == boundAccount) _state.update { it.copy(problem = code) }
                }) else current.updateDocument(content)
                _state.update { it.copy(account = account, title = title, loading = false, problem = null) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                _renderer.value?.close()
                _renderer.value = null
                markdown = ""
                _state.update { it.copy(loading = false, problem = (error as? BridgeProtocolException)?.code ?: "LOCAL_DOCUMENT_INVALID") }
            }
        }
    }

    fun textSize(value: Float) {
        if (_state.value.accountChanged) return
        val size = documentTextSize(value)
        savedState["textSize"] = size
        _state.update { it.copy(textSize = size) }
        updateFont()
    }

    private fun updateFont() {
        if (_state.value.accountChanged || graph.auth.state.value.experimentAccount() != boundAccount) return
        _renderer.value?.updateDocument(LabContent.Document(_state.value.title, markdown, documentFontScale(systemScale, _state.value.textSize)))
    }

    fun copyMarkdown(): String? = markdown.takeIf {
        !_state.value.loading && !_state.value.accountChanged && graph.auth.state.value.experimentAccount() == boundAccount
    }

    fun back() { _renderer.value?.close(); _renderer.value = null }

    override fun onCleared() {
        _renderer.value?.close()
        _renderer.value = null
        super.onCleared()
    }
}
