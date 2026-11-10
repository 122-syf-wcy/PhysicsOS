package com.physicsos.student.core

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URLDecoder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.WebSocket
import okhttp3.WebSocketListener

internal class DefaultMobileClient(
    private val transport: HttpTransport,
    private val auth: DefaultAuthRepository,
    private val privateFiles: PrivateFiles,
) : MobileClient {
    override suspend fun request(method: String, path: String, body: JsonElement?, authenticated: Boolean): JsonElement {
        val url = transport.policy.mobile(path)
        val route = url.encodedPath.removePrefix(transport.policy.mobileBase.encodedPath)
        if (route in REPOSITORY_AUTH_ROUTES) {
            throw ApiException(0, "auth_repository_required", "Use AuthRepository for device sign-in and grant operations.")
        }
        val normalized = method.uppercase(Locale.ROOT)
        if (!authenticated) return WireProtocol.mobile(transport.json(normalized, url, body))
        return withAuthentication { lease ->
            val result = WireProtocol.mobile(transport.json(normalized, url, body, lease))
            transport.fence.check(lease.stamp.epoch)
            auth.accountMutation(lease.stamp, normalized, route, result)
            result
        }
    }

    internal suspend fun requestOwned(
        method: String,
        path: String,
        body: JsonElement?,
        expected: AccountStamp,
        idempotencyKey: String? = null,
    ): JsonElement {
        val url = transport.policy.mobile(path)
        val normalized = method.uppercase(Locale.ROOT)
        return withAuthentication(expected) { lease ->
            val result = WireProtocol.mobile(transport.json(normalized, url, body, lease, idempotencyKey = idempotencyKey))
            transport.fence.check(lease.stamp.epoch)
            auth.accountMutation(lease.stamp, normalized, url.encodedPath.removePrefix(transport.policy.mobileBase.encodedPath), result)
            result
        }
    }

    override suspend fun rpc(method: String, request: JsonObject): JsonElement = withContext(Dispatchers.IO) {
        val url = transport.policy.rpc(method)
        val id = UUID.randomUUID().toString()
        val envelope = WireProtocol.rpcRequest(id, method, request)
        withAuthentication { lease ->
            WireProtocol.rpc(transport.json("POST", url, envelope, lease), id).also {
                transport.fence.check(lease.stamp.epoch)
            }
        }
    }

    override suspend fun upload(sessionId: String, file: File, name: String, onProgress: (Long, Long) -> Unit): JsonObject {
        require(sessionId.isNotBlank() && sessionId.length <= 512 && sessionId.none { it.isISOControl() }) { "Invalid session id." }
        require(name.isNotBlank() && name.length <= 255 && name.none { it.isISOControl() || it == '/' || it == '\\' }) { "Use a file name, not a file path." }
        val url = transport.policy.rpc("session/uploadFileBinary").newBuilder()
            .addQueryParameter("sessionId", sessionId).addQueryParameter("name", name).build()
        return withAuthentication { lease ->
            WireProtocol.upload(transport.upload(url, lease, file, onProgress)).also {
                transport.fence.check(lease.stamp.epoch)
            }
        }
    }

    override suspend fun download(
        path: String,
        destination: File,
        maxBytes: Long,
        onProgress: (Long, Long?) -> Unit,
    ): JsonObject = withContext(Dispatchers.IO) {
        require(maxBytes in 1..MAX_DOWNLOAD_BYTES) { "Download limit must be between 1 byte and 512 MiB." }
        val url = transport.policy.download(path)
        val target = privateFiles.destination(destination)
        withAuthentication { lease ->
            val request = transport.request(url, lease).header("Accept", "*/*").get().build()
            transport.execute(request, lease.stamp.epoch, timeoutMillis = 600_000) { response ->
                transport.checkStatus(response)
                val length = response.body.contentLength().takeIf { it >= 0 }
                if (length != null && length > maxBytes) {
                    throw ApiException(0, "download_too_large", "The resource is larger than the permitted download size.")
                }
                val temporary = try {
                    File.createTempFile(".physicsos-download-", ".part", target.parentFile)
                } catch (_: IOException) {
                    throw storageFailure()
                }
                try {
                    val digest = MessageDigest.getInstance("SHA-256")
                    val progress = TransferProgress(length, onProgress)
                    var bytes = 0L
                    response.body.byteStream().use { input ->
                        val output = try { FileOutputStream(temporary) } catch (_: IOException) { throw storageFailure() }
                        output.use {
                            val buffer = ByteArray(32_768)
                            progress.emit(0, force = true)
                            while (true) {
                                transport.fence.check(lease.stamp.epoch)
                                val count = input.read(buffer)
                                if (count == -1) break
                                bytes += count
                                if (bytes > maxBytes) throw ApiException(0, "download_too_large", "The resource exceeds the download limit.")
                                digest.update(buffer, 0, count)
                                try { output.write(buffer, 0, count) } catch (_: IOException) { throw storageFailure() }
                                progress.emit(bytes)
                            }
                            if (length != null && bytes != length) {
                                throw ApiException(0, "download_incomplete", "The download ended before all bytes arrived.")
                            }
                            try { output.fd.sync() } catch (_: IOException) { throw storageFailure() }
                        }
                    }
                    val hash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
                    transport.fence.commit(lease.stamp.epoch) {
                        try {
                            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                        } catch (_: IOException) {
                            throw storageFailure()
                        }
                    }
                    progress.emit(bytes, force = true)
                    buildJsonObject {
                        put("name", downloadName(response.header("Content-Disposition"), target.name))
                        put("mimeType", response.body.contentType()?.let { "${it.type}/${it.subtype}" } ?: "application/octet-stream")
                        put("bytes", bytes)
                        put("sha256", hash)
                        response.header("ETag")?.let { put("etag", it) }
                    }
                } finally {
                    if (temporary.exists()) temporary.delete()
                }
            }
        }
    }

    override suspend fun connectMux(listener: WebSocketListener): WebSocket = withAuthentication { lease ->
        openAuthenticatedSocket(transport, lease, listener)
    }

    private suspend fun <T> withAuthentication(
        expected: AccountStamp? = null,
        action: suspend (AccessLease) -> T,
    ): T {
        val first = auth.lease(expected)
        try {
            return action(first)
        } catch (error: ApiException) {
            if (!isAccessRejection(error)) throw error
            transport.fence.check(first.stamp.epoch)
            val renewed = auth.rejected(first)
            try {
                return action(renewed)
            } catch (second: ApiException) {
                if (isAccessRejection(second)) auth.invalidate(renewed.stamp, eraseLocal = false, error = second)
                throw second
            }
        }
    }

    private fun downloadName(disposition: String?, fallback: String): String {
        val utf8 = disposition?.let { Regex("(?i)filename\\*=UTF-8''([^;]+)").find(it)?.groupValues?.get(1) }
        val simple = disposition?.let { Regex("(?i)filename=\"([^\"]+)\"|filename=([^;]+)").find(it) }
        val candidate = if (utf8 != null) {
            try { URLDecoder.decode(utf8, "UTF-8") } catch (_: IllegalArgumentException) { null }
        } else simple?.groupValues?.drop(1)?.firstOrNull { it.isNotBlank() }
        return candidate?.trim()?.takeIf { it.isNotEmpty() && it.length <= 255 && it.none { ch -> ch.isISOControl() || ch == '/' || ch == '\\' } }
            ?: fallback
    }

    private fun storageFailure() = ApiException(0, "storage_unavailable", "The file could not be saved. Check free space and app storage.")

    private companion object {
        const val MAX_DOWNLOAD_BYTES = 512L * 1024 * 1024
        val REPOSITORY_AUTH_ROUTES = setOf("auth/login", "auth/register", "auth/login/2fa", "auth/refresh", "auth/logout")
    }
}

internal fun isAccessRejection(error: ApiException): Boolean = error.status == 401 &&
    error.code in setOf("UNAUTHENTICATED", "unauthorized", "INVALID_ACCESS_TOKEN", "TOKEN_EXPIRED")
