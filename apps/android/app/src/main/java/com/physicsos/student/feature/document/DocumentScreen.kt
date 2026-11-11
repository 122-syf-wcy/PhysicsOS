package com.physicsos.student.feature.document

import android.content.ClipData
import android.content.ClipboardManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.feature.experiments.bridge.LabRenderer
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun DocumentScreen(graph: AppGraph, title: String, markdown: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val factory = remember(graph) { viewModelFactory { initializer { DocumentViewModel(graph, appContext, createSavedStateHandle()) } } }
    val model: DocumentViewModel = viewModel(key = "local-document", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    val renderer by model.renderer.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val systemFontScale = LocalDensity.current.fontScale
    LaunchedEffect(model, title, markdown, systemFontScale) { model.document(title, markdown, systemFontScale) }
    fun leave() { model.back(); onBack() }
    BackHandler { leave() }
    Scaffold(Modifier.fillMaxSize().testTag("document"), snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = ::leave, modifier = Modifier.testTag("document_back")) { Text(stringResource(R.string.document_back)) }
                Text(state.title.ifBlank { if (state.accountChanged) stringResource(R.string.document_title) else title.take(300) }, Modifier.weight(1f).padding(vertical = 12.dp), style = MaterialTheme.typography.titleMedium)
            }
            LazyRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                item("smaller") { TextButton(onClick = { model.textSize(state.textSize - 0.1f) }, enabled = state.textSize > 0.75f && !state.accountChanged, modifier = Modifier.testTag("document_font_smaller")) { Text(stringResource(R.string.document_font_smaller)) } }
                item("size") { TextButton(onClick = { model.textSize(1f) }, enabled = !state.accountChanged, modifier = Modifier.testTag("document_font_reset")) { Text(stringResource(R.string.document_font_percent, (state.textSize * 100).roundToInt())) } }
                item("larger") { TextButton(onClick = { model.textSize(state.textSize + 0.1f) }, enabled = state.textSize < 2f && !state.accountChanged, modifier = Modifier.testTag("document_font_larger")) { Text(stringResource(R.string.document_font_larger)) } }
                item("copy") {
                    TextButton(onClick = {
                        val text = model.copyMarkdown()
                        val copied = text != null && runCatching {
                            val clipboard = requireNotNull(context.getSystemService(ClipboardManager::class.java))
                            clipboard.setPrimaryClip(ClipData.newPlainText(state.title, text))
                        }.isSuccess
                        scope.launch { snackbar.showSnackbar(context.getString(if (copied) R.string.document_copied else R.string.document_copy_failed)) }
                    }, enabled = !state.loading && !state.accountChanged && renderer != null, modifier = Modifier.testTag("document_copy")) { Text(stringResource(R.string.document_copy)) }
                }
            }
            Text(stringResource(R.string.document_local_notice), Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.bodySmall)
            when {
                state.accountChanged -> Text(stringResource(R.string.document_account_changed), Modifier.padding(24.dp).testTag("document_account_changed"))
                state.loading -> CircularProgressIndicator(Modifier.padding(24.dp).testTag("document_loading"))
                renderer == null -> Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(if (state.problem == "MESSAGE_TOO_LARGE") R.string.document_size_error else R.string.document_invalid))
                    Text(stringResource(R.string.document_error_code, state.problem.orEmpty().take(80)))
                    TextButton(onClick = { model.document(title, markdown, systemFontScale) }, modifier = Modifier.testTag("document_retry")) { Text(stringResource(R.string.document_retry)) }
                }
                else -> {
                    state.problem?.let { code ->
                        Text(stringResource(R.string.document_error_code, code.take(80)), Modifier.padding(12.dp).testTag("document_renderer_issue"), color = MaterialTheme.colorScheme.error)
                    }
                    renderer?.let { LabRenderer(it, MaterialTheme.colorScheme.background.luminance() < 0.5f, Modifier.weight(1f), tag = "document_webview") }
                }
            }
        }
    }
}
