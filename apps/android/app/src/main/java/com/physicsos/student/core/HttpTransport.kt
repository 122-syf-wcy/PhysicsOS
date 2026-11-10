package com.physicsos.student.core

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink

internal class HttpTransport(
    val policy: OriginPolicy,
    val fence: RequestFence,
    val client: OkHttpClient = newHttpClient(),
) {
    suspend fun json(
        method: String,
        url: HttpUrl,
        body: JsonElement? = null,
        lease: AccessLease? = null,
        epoch: Long? = lease?.stamp?.epoch,
        idempotencyKey: String? = null,
    ): JsonElement = withContext(Dispatchers.IO) {
        val normalized = method.uppercase(java.util.Locale.ROOT)
        require(normalized in METHODS) { "Unsupported HTTP method." }
        require(normalized !in setOf("GET", "HEAD") || body == null) { "GET/HEAD cannot carry a JSON body." }
        val bytes = body?.toString()?.toByteArray(Charsets.UTF_8)
        if (bytes != null && bytes.size > MAX_JSON_BYTES) {
            throw ApiException(0, "request_too_large", "The JSON request exceeds the native transfer limit.")
        }
        val requestBody = when {
            bytes != null -> bytes.toRequestBody(JSON_MEDIA_TYPE)
            normalized in setOf("POST", "PUT", "PATCH") -> ByteArray(0).toRequestBody(JSON_MEDIA_TYPE)
            else -> null
        }
        val request = request(url, lease, idempotencyKey).method(normalized, requestBody).build()
        execute(request, epoch) { response -> decodeJson(response) }
    }

    suspend fun upload(
        url: HttpUrl,
        lease: AccessLease,
        file: File,
        onProgress: (Long, Long) -> Unit,
    ): JsonElement = withContext(Dispatchers.IO) {
        if (!file.isFile || !file.canRead()) throw ApiException(0, "file_unavailable", "The upload file is no longer available.")
        val length = file.length()
        if (length <= 0 || length > MAX_UPLOAD_BYTES) {
            throw ApiException(0, "file_size_invalid", "Select a non-empty file no larger than 200 MiB.")
        }
        val modified = file.lastModified()
        val body = object : RequestBody() {
            override fun contentType() = OCTET_STREAM
            override fun contentLength() = length
            override fun isOneShot() = true
            override fun writeTo(sink: BufferedSink) {
                if (file.length() != length || file.lastModified() != modified) {
                    throw IOException("Upload file changed before transfer")
                }
                val progress = TransferProgress(length) { sent, total -> onProgress(sent, total ?: length) }
                FileInputStream(file).use { input ->
                    val buffer = ByteArray(32_768)
                    var sent = 0L
                    progress.emit(0, force = true)
                    while (true) {
                        fence.check(lease.stamp.epoch)
                        val count = input.read(buffer)
                        if (count == -1) break
                        sent += count
                        if (sent > length) throw IOException("Upload file changed during transfer")
                        sink.write(buffer, 0, count)
                        progress.emit(sent)
                    }
                    if (sent != length) throw IOException("Upload file changed during transfer")
                    progress.emit(sent, force = true)
                }
            }
        }
        val request = request(url, lease).post(body).build()
        execute(request, lease.stamp.epoch, timeoutMillis = 300_000) { response -> decodeJson(response) }
    }

    fun request(url: HttpUrl, lease: AccessLease? = null, idempotencyKey: String? = null): Request.Builder {
        if (!policy.sameOrigin(url) || url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null) {
            throw ApiException(0, "untrusted_url", "Credentials cannot be sent to this URL.")
        }
        if (lease != null) fence.check(lease.stamp.epoch)
        val builder = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("X-PhysicsOS-Mobile-Version", "1")
            .cacheControl(CacheControl.Builder().noStore().build())
        if (lease != null) builder.header("Authorization", "Bearer ${lease.token}")
        if (idempotencyKey != null) {
            validateIdempotencyKey(idempotencyKey)
            builder.header("Idempotency-Key", idempotencyKey)
        }
        return builder
    }

    suspend fun <T> execute(
        request: Request,
        epoch: Long?,
        timeoutMillis: Long = 90_000,
        consume: (Response) -> T,
    ): T = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request)
        call.timeout().timeout(timeoutMillis, TimeUnit.MILLISECONDS)
        val registration: Closeable? = try {
            epoch?.let { fence.register(it, call::cancel) }
        } catch (error: ApiException) {
            continuation.resumeWithException(error)
            return@suspendCancellableCoroutine
        }
        continuation.invokeOnCancellation {
            call.cancel()
            registration?.close()
        }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                registration?.close()
                if (continuation.isActive) {
                    val error = if (epoch != null && !fence.isCurrent(epoch)) accountChanged() else transportFailure(e)
                    continuation.resumeWithException(error)
                }
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!continuation.isActive) return
                        if (epoch != null) fence.check(epoch)
                        val value = consume(it)
                        if (epoch != null) fence.check(epoch)
                        if (continuation.isActive) continuation.resume(value)
                    }
                } catch (error: Exception) {
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            when {
                                epoch != null && !fence.isCurrent(epoch) -> accountChanged()
                                error is ApiException -> error
                                error is IOException -> transportFailure(error)
                                else -> ApiException(0, "transfer_failed", "The transfer could not be completed.")
                            },
                        )
                    }
                } finally {
                    registration?.close()
                }
            }
        })
    }

    fun checkStatus(response: Response) {
        if (!response.isSuccessful) {
            val error = try {
                val root = WireProtocol.parse(readBytes(response, MAX_ERROR_BYTES)) as? JsonObject
                root?.get("error")
            } catch (_: ApiException) {
                null
            }
            throw WireProtocol.failure(
                response.code,
                error,
                WireProtocol.retryAfter(response.header("Retry-After"), System.currentTimeMillis()),
            )
        }
    }

    private fun decodeJson(response: Response): JsonElement {
        checkStatus(response)
        val mediaType = response.body.contentType()
        if (mediaType?.type == "multipart") {
            throw ApiException(0, "unsupported_rpc_attachments", "This response requires the authenticated binary download API.")
        }
        val bytes = readBytes(response, MAX_JSON_BYTES.toLong())
        if (bytes.isEmpty()) protocolError("The server returned an empty success response.")
        return WireProtocol.parse(bytes)
    }

    private fun readBytes(response: Response, limit: Long): ByteArray {
        val length = response.body.contentLength()
        if (length > limit) throw ApiException(0, "response_too_large", "The response exceeds the native transfer limit.")
        val output = ByteArrayOutputStream(if (length in 1..65_536) length.toInt() else 8_192)
        response.body.byteStream().use { input ->
            val buffer = ByteArray(32_768)
            var total = 0L
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                total += count
                if (total > limit) throw ApiException(0, "response_too_large", "The response exceeds the native transfer limit.")
                output.write(buffer, 0, count)
            }
        }
        return output.toByteArray()
    }

    companion object {
        const val MAX_JSON_BYTES = 32 * 1024 * 1024
        const val MAX_UPLOAD_BYTES = 200L * 1024 * 1024
        private const val MAX_ERROR_BYTES = 64L * 1024
        private val METHODS = setOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val OCTET_STREAM = "application/octet-stream".toMediaType()
        private val IDEMPOTENCY_KEY = Regex("[A-Za-z0-9._:-]{8,128}")

        fun validateIdempotencyKey(value: String) {
            require(IDEMPOTENCY_KEY.matches(value)) { "Use an 8–128 character unique idempotency key." }
        }

        fun newHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .cookieJar(CookieJar.NO_COOKIES)
            .cache(null)
            .build()

        fun transportFailure(error: IOException): ApiException = if (error is InterruptedIOException) {
            ApiException(0, "request_timeout", "The request timed out. Check the connection before trying again.")
        } else {
            ApiException(0, "network_unavailable", "The server could not be reached. Check your network connection.")
        }
    }
}

internal class TransferProgress(
    private val total: Long?,
    private val callback: (Long, Long?) -> Unit,
) {
    private var lastReportedAt = 0L
    fun emit(bytes: Long, force: Boolean = false) {
        val now = System.nanoTime()
        if (force || now - lastReportedAt >= 100_000_000) {
            callback(bytes, total)
            lastReportedAt = now
        }
    }
}
