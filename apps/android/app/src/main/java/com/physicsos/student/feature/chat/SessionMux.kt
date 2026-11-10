package com.physicsos.student.feature.chat

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.MobileClient
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

internal enum class StreamSource { SESSION, WORKSPACE, CONTROL }
internal sealed interface StreamEvent {
    data object Connected : StreamEvent
    data class Frame(val source: StreamSource, val value: kotlinx.serialization.json.JsonObject) : StreamEvent
}

/** One socket generation owns three independently addressed logical subscriptions. */
internal class SessionMux(private val api: MobileClient) {
    fun follow(sessionId: String?): Flow<StreamEvent> {
        val sessionStream = UUID.randomUUID().toString()
        val workspaceStream = UUID.randomUUID().toString()
        val controlStream = UUID.randomUUID().toString()
        val sources = mapOf(sessionStream to StreamSource.SESSION, workspaceStream to StreamSource.WORKSPACE, controlStream to StreamSource.CONTROL)
        return callbackFlow<String?> {
            var socket: WebSocket? = null
            val listener = object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (sessionId != null && !webSocket.send(SessionProtocol.followOpen(sessionStream, sessionId))) {
                        close(IOException("mux_open_failed")); webSocket.cancel(); return
                    }
                    if (!webSocket.send(SessionProtocol.open(workspaceStream, "workspace/follow")) ||
                        !webSocket.send(SessionProtocol.open(controlStream, "session/control"))
                    ) { close(IOException("mux_open_failed")); webSocket.cancel(); return }
                    trySend(null)
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text.length > SessionProtocol.MAX_FRAME_CHARS || trySend(text).isFailure) {
                        // Dropping a durable frame would manufacture continuity; recover from a fresh snapshot instead.
                        close(SessionProtocolException("mux_backpressure"))
                        webSocket.cancel()
                    }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    close(if (response?.code == 401) ApiException(401, "authentication_required", "") else IOException("mux_disconnected", t))
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, null)
                    close(IOException("mux_closed"))
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { close(IOException("mux_closed")) }
            }
            try {
                socket = api.connectMux(listener)
            } catch (error: Exception) { close(error) }
            awaitClose {
                socket?.let { ws ->
                    if (sessionId != null) ws.send(SessionProtocol.cancelSubscription(sessionStream))
                    ws.send(SessionProtocol.cancelSubscription(workspaceStream))
                    ws.send(SessionProtocol.cancelSubscription(controlStream))
                    ws.close(1000, null)
                    ws.cancel()
                }
                // This only cancels subscriptions. Generation is stopped exclusively by session/cancel.
            }
        }.buffer(256).map { text ->
            if (text == null) StreamEvent.Connected
            else when (val message = SessionProtocol.parseMux(text)) {
                is MuxMessage.Item -> StreamEvent.Frame(sources[message.streamId] ?: fail("foreign_stream"), message.value)
                is MuxMessage.Error -> throw ApiException(
                    if (message.code.contains("unauthorized", ignoreCase = true) || message.code.contains("authentication", ignoreCase = true)) 401 else 0,
                    message.code, "",
                )
                is MuxMessage.End -> throw IOException("mux_stream_ended")
            }
        }.flowOn(Dispatchers.Default)
    }
}

internal fun networkAvailability(context: Context): Flow<Boolean> = callbackFlow {
    val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java)
    fun available(): Boolean {
        val network = manager.activeNetwork ?: return false
        return manager.getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { trySend(available()) }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) { trySend(available()) }
        override fun onLost(network: Network) { trySend(available()) }
    }
    manager.registerDefaultNetworkCallback(callback)
    trySend(available())
    awaitClose { manager.unregisterNetworkCallback(callback) }
}.distinctUntilChanged()

internal fun reconnectDelayMillis(attempt: Int, jitter: Long = 0): Long =
    (1_000L shl attempt.coerceIn(0, 5)).coerceAtMost(30_000) + jitter.coerceIn(0, 500)
