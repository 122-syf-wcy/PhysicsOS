package com.physicsos.student.core

import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

internal suspend fun openAuthenticatedSocket(
    transport: HttpTransport,
    lease: AccessLease,
    listener: WebSocketListener,
): WebSocket = suspendCancellableCoroutine { continuation ->
    val request = transport.request(transport.policy.mux(), lease).build()
    val socket = AccountWebSocket(request, lease.stamp.epoch, transport.fence)
    val opened = AtomicBoolean(false)
    val registration = try {
        transport.fence.register(lease.stamp.epoch, socket::cancel)
    } catch (error: ApiException) {
        continuation.resumeWithException(error)
        return@suspendCancellableCoroutine
    }
    socket.onRelease = registration
    continuation.invokeOnCancellation { socket.cancel() }
    val forward = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            socket.attach(webSocket)
            if (!continuation.isActive || !transport.fence.isCurrent(lease.stamp.epoch)) {
                socket.cancel()
                if (continuation.isActive) continuation.resumeWithException(accountChanged())
                return
            }
            opened.set(true)
            try {
                listener.onOpen(socket, redactedResponse(response))
                continuation.resume(socket) { _, value, _ -> value.cancel() }
            } catch (_: Exception) {
                socket.cancel()
                if (continuation.isActive) continuation.resumeWithException(ApiException(0, "socket_listener_failed", "The realtime listener could not start."))
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            deliver { listener.onMessage(socket, text) }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            deliver { listener.onMessage(socket, bytes) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            deliver { listener.onClosing(socket, code, reason) }
            socket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            registration.close()
            deliver { listener.onClosed(socket, code, reason) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            registration.close()
            val error = when {
                !transport.fence.isCurrent(lease.stamp.epoch) -> accountChanged()
                response != null -> WireProtocol.failure(response.code, null)
                else -> ApiException(0, "network_unavailable", "The realtime connection was interrupted.")
            }
            if (!opened.get()) {
                if (continuation.isActive) continuation.resumeWithException(error)
            } else {
                // Never pass OkHttp's original exception/request, which can contain credential headers.
                try { listener.onFailure(socket, error, response?.let(::redactedResponse)) } catch (_: Exception) { socket.cancel() }
            }
        }

        private fun deliver(action: () -> Unit) {
            if (!transport.fence.isCurrent(lease.stamp.epoch)) {
                socket.cancel()
                return
            }
            try { action() } catch (_: Exception) { socket.cancel() }
        }
    }
    try {
        socket.attach(transport.client.newWebSocket(request, forward))
    } catch (_: Exception) {
        socket.cancel()
        if (continuation.isActive) continuation.resumeWithException(ApiException(0, "socket_unavailable", "The realtime connection could not be opened."))
    }
}

/** The public handle never exposes the Authorization-bearing handshake request. */
private class AccountWebSocket(
    request: Request,
    private val epoch: Long,
    private val fence: RequestFence,
) : WebSocket {
    private val visibleRequest = request.newBuilder().removeHeader("Authorization").removeHeader("Cookie").build()
    private val delegate = AtomicReference<WebSocket?>(null)
    private val cancelled = AtomicBoolean(false)
    @Volatile var onRelease: Closeable? = null

    fun attach(value: WebSocket) {
        delegate.compareAndSet(null, value)
        if (cancelled.get()) value.cancel()
    }

    override fun request(): Request = visibleRequest
    override fun queueSize(): Long = delegate.get()?.queueSize() ?: 0
    override fun send(text: String): Boolean = active() && delegate.get()?.send(text) == true
    override fun send(bytes: ByteString): Boolean = active() && delegate.get()?.send(bytes) == true
    override fun close(code: Int, reason: String?): Boolean = delegate.get()?.close(code, reason) ?: false
    override fun cancel() {
        cancelled.set(true)
        onRelease?.close()
        delegate.get()?.cancel()
    }

    private fun active(): Boolean = !cancelled.get() && fence.isCurrent(epoch)
    override fun toString(): String = "AccountWebSocket([redacted])"
}

private fun redactedResponse(response: Response): Response = response.newBuilder()
    .request(response.request.newBuilder().removeHeader("Authorization").removeHeader("Cookie").build())
    .removeHeader("Set-Cookie")
    .build()
