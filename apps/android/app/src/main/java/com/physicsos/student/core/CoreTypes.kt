package com.physicsos.student.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** No access or refresh credentials are exposed through UI-observable state. */
sealed interface AuthState {
    data object Restoring : AuthState
    data object SignedOut : AuthState
    data class SignedIn(val user: MobileUser) : AuthState
}

@Serializable
data class MobileUser(
    val userKey: String,
    val schoolId: String,
    val username: String,
    val displayName: String,
    val role: String,
    val userId: String,
)

/** status is 0 for a local/transport failure; server details are not included in toString(). */
class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val details: JsonObject? = null,
    val retryAfterMillis: Long? = null,
) : Exception(message) {
    val retryable: Boolean
        get() = code in setOf("network_unavailable", "request_timeout") ||
            status == 408 || status == 425 || status == 429 || status in 500..599

    override fun toString(): String = "ApiException(status=$status, code=$code)"
}

@Serializable
data class ExperimentInfo(
    val id: String,
    val title: String,
    val subtitle: String,
    val domain: String,
    val stage: String,
    val tags: List<String>,
)

data class StoredItem(val id: String, val payload: JsonObject, val updatedAt: Long)
data class StoredCursor(val updatedAt: Long, val id: String)
data class StoredPage(val items: List<StoredItem>, val nextCursor: StoredCursor?)

data class CachedPage(
    val payload: JsonObject,
    val nextCursor: String?,
    val updatedAt: Long,
)

enum class OutboxState { PENDING, RUNNING, RETRY, ACKNOWLEDGED, CONFLICT, FAILED, AUTH_REQUIRED }

data class OutboxItem(
    val id: String,
    val owner: String,
    val method: String,
    val path: String,
    val idempotencyKey: String,
    val state: OutboxState,
    val attempts: Int,
    val createdAt: Long,
    val updatedAt: Long,
    val nextAttemptAt: Long,
    val errorStatus: Int?,
    val errorCode: String?,
    val errorMessage: String?,
    val errorDetails: JsonObject?,
    val result: JsonElement?,
) {
    val error: ApiException?
        get() = errorCode?.let { ApiException(errorStatus ?: 0, it, errorMessage ?: it, errorDetails) }
}

enum class DownloadState { QUEUED, DOWNLOADING, PAUSED, COMPLETE, FAILED }

/** localPath must be an app-private file; a COMPLETE record also carries its SHA-256 digest. */
data class DownloadRecord(
    val id: String,
    val owner: String,
    val url: String,
    val name: String,
    val mimeType: String,
    val state: DownloadState,
    val bytesDownloaded: Long = 0,
    val totalBytes: Long? = null,
    val localPath: String? = null,
    val sha256: String? = null,
    val etag: String? = null,
    val errorCode: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
)
