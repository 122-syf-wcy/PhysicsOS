package com.physicsos.student.feature.experiments.bridge

import android.annotation.SuppressLint
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.MutableContextWrapper
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.ClientCertRequest
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.physicsos.student.BuildConfig
import java.io.ByteArrayInputStream
import java.lang.ref.WeakReference
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal sealed interface LabContent {
    val page: LabPage
    fun payload(generation: String): JsonObject

    data class Experiment(val load: LabLoad) : LabContent {
        override val page = LabPage.EXPERIMENT
        override fun payload(generation: String): JsonObject = load.payload(generation)
    }

    data class Document(val title: String, val markdown: String, val fontScale: Float) : LabContent {
        override val page = LabPage.DOCUMENT
        override fun payload(generation: String): JsonObject = buildJsonObject {
            StrictBridgeJson.utf8Size(markdown, BridgeLimits.DOCUMENT_BYTES)
            require(title.length <= 300 && fontScale.isFinite() && fontScale in 0.5f..5f)
            put("generation", generation)
            put("title", title)
            put("markdown", markdown)
            put("fontScale", fontScale)
        }
    }
}

internal enum class LabRendererPhase { NOT_STARTED, LOADING, READY, SUSPENDED, FAILED, UNSUPPORTED, CLOSED }
internal data class LabRendererState(
    val phase: LabRendererPhase = LabRendererPhase.NOT_STARTED,
    val code: String? = null,
    val recovered: Boolean = false,
)

/**
 * Retained by the feature ViewModel, not by an Activity. Its only Activity context
 * lives in a MutableContextWrapper while attached; detach resets it immediately.
 * All public calls and WebView operations are made on the main thread.
 */
internal class LabWebViewController(
    context: Context,
    initialContent: LabContent,
    private val onIncoming: (LabIncoming) -> Unit,
    private val onIssue: (String) -> Unit,
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(LabRendererState())
    val state = _state.asStateFlow()
    private var content = initialContent
    private var webView: WebView? = null
    private var contextWrapper: MutableContextWrapper? = null
    private var host: WeakReference<FrameLayout>? = null
    private var gate: LabSessionGate? = null
    private var resumed = false
    private var dark = false
    private var experimentFontScale = 1f
    private var closed = false
    private var canCreate = true
    private var releaseJob: Job? = null
    private var readyTimeout: Job? = null
    private var periodicCheckpoint: Job? = null
    private var editCheckpoint: Job? = null
    private var documentUpdate: Job? = null
    private var callbacksRegistered = false
    private var currentCheckpoint: Pair<String, CompletableDeferred<LabCheckpoint>>? = null
    private val exports = mutableMapOf<String, CompletableDeferred<LabIncoming.Export>>()
    private val incoming = Channel<Pair<LabSessionGate, String>>(capacity = 4)
    private var messageWindow = 0L
    private var messageCount = 0
    private var lastIssueAt = 0L
    private var previousRevision: Long? = null
    private val crashTimes = ArrayDeque<Long>()

    private val memoryCallbacks = object : ComponentCallbacks2 {
        override fun onConfigurationChanged(newConfig: Configuration) = Unit
        override fun onLowMemory() { scope.launch { releaseAfterCheckpoint("MEMORY_PRESSURE", false) } }
        @Suppress("DEPRECATION")
        override fun onTrimMemory(level: Int) {
            if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
                level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
                level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND
            ) scope.launch { releaseAfterCheckpoint("MEMORY_PRESSURE", false) }
        }
    }

    init {
        scope.launch {
            for ((session, raw) in incoming) {
                if (gate !== session || session.destroyed) continue
                val parsed = try {
                    withContext(Dispatchers.Default) { LabBridgeProtocol.parse(raw) }
                } catch (error: BridgeProtocolException) {
                    protocolIssue(error.code)
                    continue
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    protocolIssue("INVALID_MESSAGE_SCHEMA")
                    continue
                }
                if (gate === session && !session.destroyed) receive(session, parsed)
            }
        }
    }

    fun attach(container: FrameLayout, context: Context) {
        if (closed) return
        releaseJob?.cancel()
        host?.get()?.takeIf { it !== container }?.let { old -> webView?.let(old::removeView) }
        host = WeakReference(container)
        gate?.attach()
        contextWrapper?.baseContext = context
        if (webView == null && canCreate) create(container, context)
        webView?.let { view ->
            if (view.parent !== container) {
                (view.parent as? ViewGroup)?.removeView(view)
                container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            }
        }
        sendLifecycle()
    }

    fun detach(container: FrameLayout, changingConfigurations: Boolean) {
        if (host?.get() !== container) return
        gate?.detach()
        sendLifecycle()
        webView?.let { container.removeView(it) }
        host = null
        contextWrapper?.baseContext = appContext
        if (changingConfigurations) {
            releaseJob?.cancel()
            scope.launch { checkpoint() }
        } else scheduleRelease("PAGE_LEFT", false)
    }

    fun resume() {
        if (closed) return
        val wasResumed = resumed
        resumed = true
        releaseJob?.cancel()
        if (!wasResumed && _state.value.phase != LabRendererPhase.UNSUPPORTED) canCreate = true
        host?.get()?.let { if (webView == null && canCreate) create(it, it.context) }
        gate?.resume()
        webView?.onResume()
        sendLifecycle()
    }

    fun pause() {
        resumed = false
        gate?.pause()
        sendLifecycle()
        scope.launch { checkpoint() }
        webView?.onPause()
    }

    fun stopped(changingConfigurations: Boolean) {
        if (!changingConfigurations) scheduleRelease("BACKGROUND", true)
    }

    fun setDark(value: Boolean) {
        if (dark == value) return
        dark = value
        val session = gate ?: return
        if (session.loaded) sendSmall("theme", buildJsonObject { put("generation", session.generation); put("dark", dark) })
    }

    fun setExperimentFontScale(value: Float) {
        experimentFontScale = value.coerceIn(0.5f, 5f)
        if (content.page == LabPage.EXPERIMENT) webView?.settings?.textZoom = (experimentFontScale * 100).toInt()
    }

    /** An explicit conflict choice is a new load/generation, unlike recomposition. */
    fun replaceExperiment(load: LabLoad) {
        require(content.page == LabPage.EXPERIMENT)
        content = LabContent.Experiment(load)
        retry()
    }

    /** The restored content can advance without ever reloading a healthy WebView. */
    fun rememberCheckpoint(checkpoint: LabCheckpoint) {
        val experiment = content as? LabContent.Experiment ?: return
        content = LabContent.Experiment(experiment.load.copy(checkpoint = checkpoint))
    }

    fun updateDocument(value: LabContent.Document) {
        require(content.page == LabPage.DOCUMENT)
        if (content == value) return
        content = value
        documentUpdate?.cancel()
        documentUpdate = scope.launch {
            delay(80)
            val session = gate ?: return@launch
            if (session.loaded) sendContent(session)
        }
    }

    fun retry() {
        if (closed) return
        disposeView("RESTARTING", false)
        canCreate = true
        host?.get()?.let { create(it, it.context) }
    }

    suspend fun checkpoint(): LabCheckpoint? {
        if (content.page != LabPage.EXPERIMENT) return null
        val session = gate ?: return null
        if (!session.loaded || session.destroyed || webView == null) return null
        currentCheckpoint?.let { return awaitCheckpoint(it.second) }
        val id = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<LabCheckpoint>()
        currentCheckpoint = id to deferred
        return try {
            sendSmall("checkpoint", buildJsonObject { put("generation", session.generation) }, id)
            awaitCheckpoint(deferred)
        } finally {
            if (currentCheckpoint?.first == id) currentCheckpoint = null
            deferred.cancel()
        }
    }

    private suspend fun awaitCheckpoint(deferred: CompletableDeferred<LabCheckpoint>): LabCheckpoint? = try {
        withTimeoutOrNull(1500) { deferred.await() }
    } catch (error: CancellationException) {
        currentCoroutineContext().ensureActive()
        null // The renderer went away, rather than the caller being cancelled.
    } catch (error: BridgeProtocolException) {
        onIssue(error.code)
        null
    }

    suspend fun export(format: LabExportFormat): ValidatedLabFile {
        val session = gate ?: throw BridgeProtocolException("RENDERER_NOT_READY")
        if (!session.loaded || exports.isNotEmpty()) throw BridgeProtocolException("EXPORT_NOT_READY")
        val id = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<LabIncoming.Export>()
        exports[id] = deferred
        return try {
            sendSmall("export", buildJsonObject { put("generation", session.generation); put("format", format.wire) }, id)
            val message = withTimeoutOrNull(20_000) { deferred.await() } ?: throw BridgeProtocolException("EXPORT_TIMEOUT")
            withContext(Dispatchers.Default) { LabFilePolicy.validate(message, format) }
        } finally {
            exports.remove(id)
            deferred.cancel()
        }
    }

    suspend fun releaseAfterCheckpoint(reason: String = "PAGE_LEFT", restoreOnResume: Boolean = false): Boolean {
        val session = gate
        session?.pause()
        sendLifecycle()
        val saved = checkpoint() != null
        if (gate === session) disposeView(reason, restoreOnResume)
        return saved
    }

    fun close() {
        if (closed) return
        closed = true
        disposeView("CLOSED", false)
        host = null
        incoming.close()
        scope.cancel()
        _state.value = LabRendererState(LabRendererPhase.CLOSED)
    }

    private fun scheduleRelease(reason: String, restoreOnResume: Boolean) {
        releaseJob?.cancel()
        releaseJob = scope.launch {
            // Allows the same ViewModel to reattach during an Activity rotation.
            delay(350)
            releaseAfterCheckpoint(reason, restoreOnResume)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun create(container: FrameLayout, context: Context) {
        if (closed || webView != null || !canCreate) return
        val supported = try {
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
                WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)
        } catch (_: Exception) { false }
        if (!supported) {
            canCreate = false
            _state.value = LabRendererState(LabRendererPhase.UNSUPPORTED, "WEBVIEW_UPDATE_REQUIRED")
            return
        }
        HeavyLabRenderer.acquire(this)
        _state.value = LabRendererState(LabRendererPhase.LOADING, recovered = _state.value.recovered)
        val session = LabSessionGate(UUID.randomUUID().toString()).also {
            it.attach()
            if (resumed) it.resume()
        }
        gate = session
        previousRevision = null
        val wrapper = MutableContextWrapper(appContext).also { it.baseContext = context }
        contextWrapper = wrapper
        val view = try { WebView(wrapper) } catch (_: Exception) {
            canCreate = false
            wrapper.baseContext = appContext
            contextWrapper = null
            HeavyLabRenderer.release(this)
            _state.value = LabRendererState(LabRendererPhase.UNSUPPORTED, "WEBVIEW_UPDATE_REQUIRED")
            return
        }
        webView = view
        try {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            view.settings.apply {
                javaScriptEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                safeBrowsingEnabled = true
                domStorageEnabled = false
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                setGeolocationEnabled(false)
                mediaPlaybackRequiresUserGesture = true
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = if (content.page == LabPage.EXPERIMENT) (experimentFontScale * 100).toInt() else 100
                cacheMode = WebSettings.LOAD_NO_CACHE
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
            view.isSaveEnabled = false
            view.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            view.setBackgroundColor(android.graphics.Color.TRANSPARENT)
            val assetLoader = WebViewAssetLoader.Builder()
                .setDomain(LabUrlPolicy.HOST)
                .setHttpAllowed(false)
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(appContext))
                .build()
            view.webViewClient = client(assetLoader, session)
            view.webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
                override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                    callback.invoke(origin, false, false)
                }
                override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean = false
            }
            view.setDownloadListener { _, _, _, _, _ -> protocolIssue("USE_NATIVE_EXPORT") }
            blockServiceWorkers()
            WebViewCompat.addWebMessageListener(view, LabBridgeProtocol.BRIDGE_NAME, setOf(LabUrlPolicy.ORIGIN)) { source, message, origin, isMainFrame, _ ->
                if (source !== webView || gate !== session || session.destroyed ||
                    !LabUrlPolicy.trustedSender(origin.toString(), isMainFrame)
                ) return@addWebMessageListener
                if (message.type != WebMessageCompat.TYPE_STRING || !message.ports.isNullOrEmpty()) {
                    protocolIssue("UNSUPPORTED_MESSAGE_DATA")
                    return@addWebMessageListener
                }
                val raw = message.data ?: return@addWebMessageListener
                if (raw.length > BridgeLimits.MESSAGE_BYTES || !withinRateLimit()) {
                    protocolIssue("MESSAGE_LIMIT_EXCEEDED")
                    return@addWebMessageListener
                }
                if (!incoming.trySend(session to raw).isSuccess) protocolIssue("MESSAGE_RATE_EXCEEDED")
            }
            appContext.registerComponentCallbacks(memoryCallbacks)
            callbacksRegistered = true
            container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            view.loadUrl(content.page.url)
            readyTimeout?.cancel()
            readyTimeout = scope.launch {
                delay(15_000)
                if (gate === session && _state.value.phase == LabRendererPhase.LOADING) {
                    _state.value = LabRendererState(LabRendererPhase.FAILED, "LOCAL_RENDERER_TIMEOUT")
                }
            }
        } catch (_: Exception) {
            disposeView("LOCAL_RENDERER_UNAVAILABLE", false)
            _state.value = LabRendererState(LabRendererPhase.FAILED, "LOCAL_RENDERER_UNAVAILABLE")
        }
    }

    private fun client(loader: WebViewAssetLoader, session: LabSessionGate) = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
            if (request.method != "GET" || !LabUrlPolicy.bundledAsset(request.url.toString())) return blocked()
            val response = loader.shouldInterceptRequest(request.url) ?: return blocked(404, "Not Found")
            response.responseHeaders = response.responseHeaders.orEmpty() + mapOf(
                "Content-Security-Policy" to csp(content.page),
                "X-Content-Type-Options" to "nosniff",
                "Cross-Origin-Resource-Policy" to "same-origin",
                "Referrer-Policy" to "no-referrer",
                "Cache-Control" to "no-store",
            )
            return response
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            return when (LabUrlPolicy.navigation(request.url.toString(), content.page, request.isForMainFrame, request.hasGesture())) {
                LabNavigation.ANCHOR -> false
                LabNavigation.EXTERNAL_BROWSER -> {
                    host?.get()?.context?.let { openBrowser(it, request.url.toString()) }
                    true
                }
                LabNavigation.BLOCK -> true
            }
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            // Only native loadUrl enters a document. A reload/navigation cannot reuse
            // an already granted session, even if it came from the same local origin.
            if (url.substringBefore('#') != content.page.url || session.loaded) {
                view.stopLoading()
                scope.launch { disposeView("UNEXPECTED_NAVIGATION", false) }
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && gate === session) {
                _state.value = LabRendererState(LabRendererPhase.FAILED, "LOCAL_ASSET_MISSING")
            }
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (request.isForMainFrame && gate === session) _state.value = LabRendererState(LabRendererPhase.FAILED, "LOCAL_ASSET_MISSING")
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) { handler.cancel() }
        override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) { request.cancel() }
        override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) { handler.cancel() }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (webView !== view) {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                return true
            }
            disposeView("RENDERER_EXITED", false)
            _state.value = LabRendererState(LabRendererPhase.SUSPENDED, "RENDERER_EXITED", recovered = true)
            onIssue("RENDERER_EXITED")
            val now = SystemClock.uptimeMillis()
            while (crashTimes.isNotEmpty() && now - crashTimes.first() > 60_000) crashTimes.removeFirst()
            crashTimes.addLast(now)
            if (crashTimes.size <= 2) scope.launch {
                delay(500)
                if (!closed && resumed) {
                    canCreate = true
                    host?.get()?.let { create(it, it.context) }
                }
            }
            return true
        }
    }

    private suspend fun receive(session: LabSessionGate, message: LabIncoming) {
        if (message is LabIncoming.Ready) {
            if (!session.ready()) return
            sendContent(session)
            return
        }
        if (!session.accepts(message.generation)) return
        when (message) {
            is LabIncoming.State -> {
                _state.value = _state.value.copy(phase = LabRendererPhase.READY, code = null)
                readyTimeout?.cancel()
                if (previousRevision != message.summary.revision) {
                    previousRevision = message.summary.revision
                    editCheckpoint?.cancel()
                    editCheckpoint = scope.launch { delay(400); checkpoint() }
                }
            }
            is LabIncoming.Checkpoint -> {
                rememberCheckpoint(message.checkpoint)
                _state.value = _state.value.copy(phase = LabRendererPhase.READY, code = null)
                readyTimeout?.cancel()
            }
            is LabIncoming.Export -> {
                val pending = exports[message.id] ?: return
                pending.complete(message)
            }
            is LabIncoming.Error -> {
                exports[message.id]?.completeExceptionally(BridgeProtocolException(message.code))
                currentCheckpoint?.takeIf { it.first == message.id }?.second?.completeExceptionally(BridgeProtocolException(message.code))
                onIssue(message.code)
                if (_state.value.phase == LabRendererPhase.LOADING) _state.value = LabRendererState(LabRendererPhase.FAILED, message.code)
            }
            is LabIncoming.Ready -> Unit
        }
        onIncoming(message)
        if (message is LabIncoming.Checkpoint && currentCheckpoint?.first == message.id) {
            currentCheckpoint?.second?.complete(message.checkpoint)
        }
    }

    private suspend fun sendContent(session: LabSessionGate) {
        if (gate !== session || session.destroyed || !session.ready) return
        val sendingContent = content
        val isExperiment = sendingContent is LabContent.Experiment
        if (isExperiment && session.loaded) return
        val command = if (isExperiment) "load" else "document"
        try {
            val encoded = withContext(Dispatchers.Default) {
                LabBridgeProtocol.encode(UUID.randomUUID().toString(), command, sendingContent.payload(session.generation))
            }
            if (gate !== session || session.destroyed || (!isExperiment && content !== sendingContent)) return
            if (!session.loaded && !session.load()) return
            post(encoded)
            sendSmall("theme", buildJsonObject { put("generation", session.generation); put("dark", dark) })
            sendLifecycle()
            if (isExperiment) {
                periodicCheckpoint?.cancel()
                periodicCheckpoint = scope.launch {
                    checkpoint()
                    while (gate === session && !session.destroyed) {
                        delay(5_000)
                        if (session.active) checkpoint()
                    }
                }
            } else {
                readyTimeout?.cancel()
                _state.value = _state.value.copy(phase = LabRendererPhase.READY, code = null)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val code = (error as? BridgeProtocolException)?.code ?: "LOCAL_DOCUMENT_INVALID"
            _state.value = LabRendererState(LabRendererPhase.FAILED, code)
            onIssue(code)
        }
    }

    private fun sendLifecycle() {
        val session = gate ?: return
        val active = session.lifecycleChange() ?: return
        sendSmall("lifecycle", buildJsonObject { put("generation", session.generation); put("active", active) })
    }

    private fun sendSmall(type: String, payload: JsonObject, id: String = UUID.randomUUID().toString()) {
        if (webView == null || gate?.destroyed != false) return
        try { post(LabBridgeProtocol.encode(id, type, payload)) }
        catch (_: Exception) { protocolIssue("BRIDGE_SEND_FAILED") }
    }

    private fun post(value: String) {
        val view = webView ?: return
        WebViewCompat.postWebMessage(view, WebMessageCompat(value), Uri.parse(LabUrlPolicy.ORIGIN))
    }

    private fun disposeView(reason: String, restoreOnResume: Boolean) {
        releaseJob?.cancel()
        releaseJob = null
        readyTimeout?.cancel()
        periodicCheckpoint?.cancel()
        editCheckpoint?.cancel()
        documentUpdate?.cancel()
        currentCheckpoint?.second?.cancel()
        currentCheckpoint = null
        exports.values.forEach { it.cancel() }
        exports.clear()
        gate?.destroy()
        gate = null
        val old = webView
        webView = null
        if (old != null) {
            (old.parent as? ViewGroup)?.removeView(old)
            runCatching { WebViewCompat.removeWebMessageListener(old, LabBridgeProtocol.BRIDGE_NAME) }
            old.setDownloadListener(null)
            old.webChromeClient = null
            old.webViewClient = WebViewClient()
            runCatching { old.stopLoading() }
            old.removeAllViews()
            old.destroy()
        }
        contextWrapper?.baseContext = appContext
        contextWrapper = null
        if (callbacksRegistered) {
            appContext.unregisterComponentCallbacks(memoryCallbacks)
            callbacksRegistered = false
        }
        HeavyLabRenderer.release(this)
        canCreate = restoreOnResume
        if (!closed) _state.value = _state.value.copy(phase = LabRendererPhase.SUSPENDED, code = reason)
    }

    private fun yieldLease() {
        gate?.pause()
        sendLifecycle()
        // Recent edit and periodic checkpoints are already durable. Do not leave
        // two Workers running while waiting for a renderer that is going away.
        disposeView("ANOTHER_RENDERER_ACTIVE", false)
    }

    private fun protocolIssue(code: String) {
        val now = SystemClock.uptimeMillis()
        if (now - lastIssueAt > 1500) { lastIssueAt = now; onIssue(code) }
    }

    private fun withinRateLimit(): Boolean {
        val now = SystemClock.uptimeMillis()
        if (now - messageWindow >= 1000) { messageWindow = now; messageCount = 0 }
        return ++messageCount <= 16
    }

    private fun openBrowser(context: Context, url: String) {
        if (!LabUrlPolicy.browserUrl(url)) return
        try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
        catch (_: Exception) { onIssue("BROWSER_UNAVAILABLE") }
    }

    private object HeavyLabRenderer {
        private var owner: LabWebViewController? = null
        fun acquire(next: LabWebViewController) {
            if (owner !== next) owner?.yieldLease()
            owner = next
        }
        fun release(current: LabWebViewController) { if (owner === current) owner = null }
    }

    companion object {
        const val CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "font-src 'self'; img-src 'self'; worker-src 'self' blob:; connect-src 'none'; " +
            "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

        fun csp(page: LabPage): String = if (page == LabPage.EXPERIMENT) {
            CSP.replace("img-src 'self';", "img-src 'self' blob:;")
        } else CSP

        private fun blocked(status: Int = 403, reason: String = "Forbidden") = WebResourceResponse(
            "text/plain", "UTF-8", status, reason,
            mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"),
            ByteArrayInputStream(ByteArray(0)),
        )

        private fun blockServiceWorkers() {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) return
            val controller = ServiceWorkerControllerCompat.getInstance()
            val settings = controller.serviceWorkerWebSettings
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CONTENT_ACCESS)) settings.allowContentAccess = false
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_FILE_ACCESS)) settings.allowFileAccess = false
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BLOCK_NETWORK_LOADS)) settings.blockNetworkLoads = true
            controller.setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse = blocked()
            })
        }
    }
}
