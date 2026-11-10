package com.physicsos.student.core

import java.io.File
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.WebSocket
import okhttp3.WebSocketListener

interface MobileClient {
    suspend fun request(
        method: String,
        path: String,
        body: JsonElement? = null,
        authenticated: Boolean = true,
    ): JsonElement

    /** request is the single business argument, not a Connection or Typert envelope. */
    suspend fun rpc(method: String, request: JsonObject): JsonElement

    suspend fun upload(
        sessionId: String,
        file: File,
        name: String,
        onProgress: (Long, Long) -> Unit,
    ): JsonObject

    /** Same-origin only. Commits the destination atomically and returns name/mimeType/bytes/sha256. */
    suspend fun download(
        path: String,
        destination: File,
        maxBytes: Long,
        onProgress: (Long, Long?) -> Unit,
    ): JsonObject

    /** The caller owns reconnection and close; account transitions cancel the socket. */
    suspend fun connectMux(listener: WebSocketListener): WebSocket
}

interface AuthRepository {
    val state: StateFlow<AuthState>
    val lastError: StateFlow<ApiException?>
    suspend fun login(body: JsonObject): JsonObject
    suspend fun register(body: JsonObject): JsonObject
    suspend fun verifyTwoFactor(body: JsonObject): JsonObject
    suspend fun restore()
    suspend fun logout()
    suspend fun refreshUser()
    suspend fun exportData(): JsonObject
    suspend fun deleteAccount(body: JsonObject): JsonObject
}

interface LocalStore {
    fun observe(kind: String, owner: String): Flow<List<StoredItem>>
    suspend fun get(kind: String, owner: String, id: String): StoredItem?
    suspend fun put(
        kind: String,
        owner: String,
        id: String,
        payload: JsonObject,
        updatedAt: Long = System.currentTimeMillis(),
    )
    suspend fun delete(kind: String, owner: String, id: String)

    suspend fun page(
        kind: String,
        owner: String,
        limit: Int = 50,
        before: StoredCursor? = null,
    ): StoredPage
    suspend fun cachePage(
        kind: String,
        owner: String,
        cursor: String?,
        payload: JsonObject,
        nextCursor: String?,
        updatedAt: Long = System.currentTimeMillis(),
    )
    suspend fun cachedPage(kind: String, owner: String, cursor: String?): CachedPage?
    suspend fun clearCache(owner: String)
    suspend fun clearOwner(owner: String)
    suspend fun exportOwner(owner: String): JsonObject

    fun observeDownloads(owner: String): Flow<List<DownloadRecord>>
    suspend fun getDownload(owner: String, id: String): DownloadRecord?
    suspend fun putDownload(record: DownloadRecord)
    suspend fun deleteDownload(owner: String, id: String)
}

interface SyncCoordinator {
    suspend fun enqueue(
        method: String,
        path: String,
        body: JsonObject?,
        idempotencyKey: String,
    )
    suspend fun syncNow()
    /** Summary projection; request bodies are read individually through operationBody. */
    fun observe(owner: String): Flow<List<OutboxItem>>
    suspend fun operationBody(id: String): JsonObject?
    suspend fun retry(id: String)
    suspend fun discard(id: String)
    /** The caller must reconcile the server version and use a new operation key. */
    suspend fun resolveConflict(id: String, body: JsonObject?, idempotencyKey: String)
}

interface CatalogRepository {
    suspend fun experiments(): List<ExperimentInfo>
    suspend fun library(): JsonObject
}

interface SettingsRepository {
    val theme: Flow<String>
    val notificationsEnabled: Flow<Boolean>
    val syncOnMeteredNetwork: Flow<Boolean>
    suspend fun setTheme(value: String)
    suspend fun setNotificationsEnabled(value: Boolean)
    suspend fun setSyncOnMeteredNetwork(value: Boolean)
    suspend fun clear()
}
