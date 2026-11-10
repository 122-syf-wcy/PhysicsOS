package com.physicsos.student.feature.experiments.bridge

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.webkit.WebViewCompat
import com.physicsos.student.R

@Composable
internal fun LabRenderer(
    controller: LabWebViewController,
    dark: Boolean,
    modifier: Modifier = Modifier,
    tag: String = "experiment_webview",
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val fontScale = LocalDensity.current.fontScale
    val state by controller.state.collectAsStateWithLifecycle()
    SideEffect {
        controller.setDark(dark)
        controller.setExperimentFontScale(fontScale)
    }
    DisposableEffect(controller, owner, context) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> controller.resume()
                Lifecycle.Event.ON_PAUSE -> controller.pause()
                Lifecycle.Event.ON_STOP -> controller.stopped(context.labActivity()?.isChangingConfigurations == true)
                else -> Unit
            }
        }
        owner.lifecycle.addObserver(observer)
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) controller.resume()
        onDispose {
            owner.lifecycle.removeObserver(observer)
            controller.pause()
        }
    }
    Box(modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize().testTag(tag),
            factory = { hostContext -> FrameLayout(hostContext).also { controller.attach(it, hostContext) } },
            onRelease = { container -> controller.detach(container, container.context.labActivity()?.isChangingConfigurations == true) },
            update = {},
        )
        when (state.phase) {
            LabRendererPhase.NOT_STARTED, LabRendererPhase.LOADING -> Surface(Modifier.fillMaxSize()) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp).testTag("lab_loading"),
                    verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator()
                    Text(stringResource(R.string.experiments_renderer_loading))
                }
            }
            LabRendererPhase.UNSUPPORTED -> RendererMessage(
                title = stringResource(R.string.experiments_webview_update_title),
                message = stringResource(R.string.experiments_webview_update_body),
                action = stringResource(R.string.experiments_webview_update_action),
                tag = "lab_webview_upgrade",
                onAction = {
                    val provider = runCatching { WebViewCompat.getCurrentWebViewPackage(context)?.packageName }.getOrNull()
                    val intent = if (provider != null) Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$provider"))
                    else Intent(Settings.ACTION_SETTINGS)
                    runCatching { context.startActivity(intent) }
                },
            )
            LabRendererPhase.FAILED -> RendererMessage(
                title = stringResource(R.string.experiments_renderer_failed),
                message = stringResource(R.string.experiments_renderer_error_detail, state.code.orEmpty()),
                action = stringResource(R.string.experiments_retry),
                tag = "lab_renderer_error", onAction = controller::retry,
            )
            LabRendererPhase.SUSPENDED -> RendererMessage(
                title = stringResource(R.string.experiments_renderer_suspended),
                message = stringResource(
                    if (state.code == "MEMORY_PRESSURE") R.string.experiments_memory_recovery
                    else R.string.experiments_renderer_recovery,
                ),
                action = stringResource(R.string.experiments_resume),
                tag = "lab_renderer_resume", onAction = controller::retry,
            )
            LabRendererPhase.READY, LabRendererPhase.CLOSED -> Unit
        }
    }
}

@Composable
private fun RendererMessage(title: String, message: String, action: String, tag: String, onAction: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize().testTag(tag)) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            Text(message, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            Button(onClick = onAction) { Text(action) }
        }
    }
}

internal tailrec fun Context.labActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> if (baseContext === this) null else baseContext.labActivity()
    else -> null
}
