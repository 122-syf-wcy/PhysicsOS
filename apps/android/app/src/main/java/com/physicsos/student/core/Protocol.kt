package com.physicsos.student.core

import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

internal val wireJson = Json { ignoreUnknownKeys = true }

internal fun protocolError(message: String): Nothing =
    throw ApiException(0, "invalid_response", message)

internal fun JsonElement.requireObject(context: String): JsonObject =
    this as? JsonObject ?: protocolError("$context must be an object.")

internal fun JsonObject.requireString(name: String, context: String = "Response"): String {
    val field = this[name] as? JsonPrimitive
    if (field == null || !field.isString || field.content.isBlank()) {
        protocolError("$context is missing $name.")
    }
    return field.content
}

internal fun JsonObject.optionalString(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

internal object WireProtocol {
    fun parse(bytes: ByteArray): JsonElement = try {
        wireJson.parseToJsonElement(bytes.toString(Charsets.UTF_8))
    } catch (_: SerializationException) {
        protocolError("The server returned invalid JSON.")
    } catch (_: IllegalArgumentException) {
        protocolError("The server returned invalid JSON.")
    }

    fun mobile(element: JsonElement): JsonElement {
        val envelope = element.requireObject("Mobile response")
        if (envelope.containsKey("error")) throw failure(200, envelope["error"])
        return envelope["data"] ?: protocolError("The mobile response has no data envelope.")
    }

    fun rpcRequest(id: String, method: String, request: JsonObject): JsonObject = buildJsonObject {
        put("type", "client-request")
        put("rpcId", id)
        put("method", method)
        put("payload", buildJsonObject {
            put("args", buildJsonObject { put(if (method == "session/list") "_request" else "request", request) })
        })
    }

    fun rpc(element: JsonElement, rpcId: String): JsonElement {
        val envelope = element.requireObject("RPC response")
        if (envelope.optionalString("type") != "server-response" ||
            envelope.optionalString("rpcId") != rpcId
        ) protocolError("The RPC response does not match this request.")
        if (envelope.containsKey("attachments")) {
            throw ApiException(0, "unsupported_rpc_attachments", "Use the authenticated file download API for binary results.")
        }
        return result(envelope["result"] ?: protocolError("The RPC response has no result."))
    }

    fun upload(element: JsonElement): JsonObject {
        val value = result(element).requireObject("Upload receipt")
        value.requireString("receiptId", "Upload receipt")
        val file = value["file"]?.requireObject("Uploaded file")
            ?: protocolError("The upload receipt has no file.")
        file.requireString("attachmentId", "Uploaded file")
        file.requireString("name", "Uploaded file")
        val bytes = (file["bytes"] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull
        if (bytes == null || bytes < 0) protocolError("The upload receipt has an invalid file size.")
        return value
    }

    private fun result(element: JsonElement): JsonElement {
        val result = element.requireObject("Result")
        return when ((result["ok"] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull) {
            true -> result["value"] ?: JsonNull // A void Remote result omits value on the wire.
            false -> throw failure(200, result["error"])
            null -> protocolError("The result has no boolean ok field.")
        }
    }

    fun failure(status: Int, error: JsonElement?, retryAfter: Long? = null): ApiException {
        val value = error as? JsonObject
        val code = value?.optionalString("code")?.takeIf { ERROR_CODE.matches(it) }
            ?: if (status == 401) "unauthorized" else "http_$status"
        val message = value?.optionalString("message")?.let(::safeMessage)
            ?: when (status) {
                401 -> "Your session is no longer valid. Please sign in again."
                403 -> "This account cannot access this resource."
                404 -> "This server does not provide the requested resource."
                409 -> "The server version conflicts with the local change."
                429 -> "Too many requests. Please try again later."
                in 300..399 -> "The server redirected this request; authenticated redirects are not allowed."
                else -> "The server rejected the request (HTTP $status)."
            }
        return ApiException(status, code, message, value?.get("details") as? JsonObject, retryAfter)
    }

    fun instant(value: String, field: String): Long = try {
        Instant.parse(value).toEpochMilli()
    } catch (_: RuntimeException) {
        protocolError("The authentication response has an invalid $field.")
    }

    fun retryAfter(value: String?, now: Long): Long? {
        if (value == null) return null
        val seconds = value.toLongOrNull()
        if (seconds != null) return seconds.coerceIn(0, 86_400) * 1_000
        return try {
            (ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - now)
                .coerceIn(0, 86_400_000)
        } catch (_: RuntimeException) {
            null
        }
    }

    private fun safeMessage(value: String): String = value.take(1_024)
        .replace(Regex("(?i)bearer\\s+[^\\s,;]+"), "Bearer [redacted]")
        .replace(Regex("(?i)(accessToken|refreshToken|password|cookie|authorization)\\s*[:=]\\s*[^\\s,;]+"), "$1=[redacted]")

    private val ERROR_CODE = Regex("[A-Za-z0-9_./:-]{1,160}")
}

/** A single first-party origin; no redirects, URL credentials, or path escapes. */
internal class OriginPolicy(
    origin: String,
    mobileBase: String,
    requireHttps: Boolean = true,
) {
    val origin: HttpUrl = origin.toHttpUrl()
    val mobileBase: HttpUrl = mobileBase.toHttpUrl()

    init {
        require(!requireHttps || this.origin.isHttps) { "The server origin must use HTTPS." }
        require(this.origin.encodedPath == "/" && this.origin.query == null && this.origin.fragment == null)
        require(this.origin.username.isEmpty() && this.origin.password.isEmpty())
        require(sameOrigin(this.mobileBase) && this.mobileBase.query == null && this.mobileBase.fragment == null)
        require(this.mobileBase.username.isEmpty() && this.mobileBase.password.isEmpty())
        require(this.mobileBase.encodedPath == "/physicsos/mobile/v1/") { "Unexpected mobile API version or base path." }
    }

    fun mobile(path: String): HttpUrl {
        if (path.isEmpty() || path.startsWith('/') || path.startsWith('?')) invalidTarget()
        checkRelativePath(path)
        val target = mobileBase.resolve(path) ?: invalidTarget()
        if (!sameOrigin(target) || !target.encodedPath.startsWith(mobileBase.encodedPath)) invalidTarget()
        return checkTarget(target)
    }

    fun rpc(method: String): HttpUrl {
        if (!RPC_METHOD.matches(method)) invalidTarget()
        return origin.newBuilder().encodedPath("/api/$method").build()
    }

    fun mux(): HttpUrl = origin.newBuilder().encodedPath("/api/remote.mux").build()

    fun download(path: String): HttpUrl {
        val target = when {
            path.startsWith("https://") || path.startsWith("http://") -> {
                val url = runCatching { path.toHttpUrl() }.getOrNull() ?: invalidTarget()
                checkRelativePath(url.encodedPath.removePrefix("/") + (url.encodedQuery?.let { "?$it" } ?: ""))
                url
            }
            path.startsWith('/') && !path.startsWith("//") -> {
                checkRelativePath(path.removePrefix("/"))
                origin.resolve(path) ?: invalidTarget()
            }
            else -> mobile(path)
        }
        if (!sameOrigin(target)) invalidTarget()
        if (!target.encodedPath.startsWith("/api/") && !target.encodedPath.startsWith("/physicsos/")) invalidTarget()
        return checkTarget(target)
    }

    fun sameOrigin(url: HttpUrl): Boolean =
        url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port

    private fun checkTarget(url: HttpUrl): HttpUrl {
        if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null) invalidTarget()
        val forbiddenKeys = setOf("token", "accesstoken", "refreshtoken", "authorization", "cookie")
        if (url.queryParameterNames.any { it.lowercase() in forbiddenKeys }) invalidTarget()
        return url
    }

    private fun checkRelativePath(path: String) {
        if (path.any { it <= ' ' || it == '\\' || it == '#' } || path.startsWith("//")) invalidTarget()
        val rawPath = path.substringBefore('?')
        if (rawPath.contains(':')) invalidTarget()
        for (segment in rawPath.split('/')) {
            var decoded = segment
            repeat(3) {
                decoded = try {
                    URLDecoder.decode(decoded.replace("+", "%2B"), StandardCharsets.UTF_8.name())
                } catch (_: IllegalArgumentException) {
                    invalidTarget()
                }
                if (decoded == "." || decoded == ".." || decoded.any { it == '/' || it == '\\' || it <= ' ' }) invalidTarget()
            }
            if (decoded.contains('%')) invalidTarget()
        }
    }

    private fun invalidTarget(): Nothing = throw ApiException(0, "untrusted_url", "The request URL is outside the allowed first-party API.")

    private companion object {
        val RPC_METHOD = Regex("[A-Za-z][A-Za-z0-9_-]*/[A-Za-z][A-Za-z0-9_-]*")
    }
}
