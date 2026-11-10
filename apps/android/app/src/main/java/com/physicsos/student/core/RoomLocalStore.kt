package com.physicsos.student.core

import androidx.sqlite.SQLiteException
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal class RoomLocalStore(
    private val database: () -> CoreDatabase,
    private val owners: OwnerGate,
    private val files: PrivateFiles,
    private val urls: OriginPolicy,
) : LocalStore {
    private val dao get() = database().records()

    override fun observe(kind: String, owner: String): Flow<List<StoredItem>> {
        validateKey(kind)
        return owners.observe(owner) { dao.observeItems(kind, owner).map { rows -> rows.map(::storedItem) } }.flowOn(Dispatchers.IO)
    }

    override suspend fun get(kind: String, owner: String, id: String): StoredItem? = access(owner) {
        validateKey(kind); validateKey(id)
        dao.item(kind, owner, id)?.let(::storedItem)
    }

    override suspend fun put(kind: String, owner: String, id: String, payload: JsonObject, updatedAt: Long) = access(owner) {
        validateKey(kind); validateKey(id)
        require(updatedAt >= 0)
        dao.putItem(StoredEntity(owner, kind, id, encodeLocal(payload), updatedAt))
    }

    override suspend fun delete(kind: String, owner: String, id: String) = access(owner) {
        validateKey(kind); validateKey(id)
        dao.deleteItem(kind, owner, id)
    }

    override suspend fun page(kind: String, owner: String, limit: Int, before: StoredCursor?): StoredPage = access(owner) {
        validateKey(kind)
        require(limit in 1..200)
        before?.let { require(it.updatedAt >= 0); validateKey(it.id) }
        database().transaction {
            val headers = dao.pageHeaders(kind, owner, before?.updatedAt, before?.id, limit + 1)
            var bytes = 0L
            val result = mutableListOf<StoredItem>()
            for (header in headers.take(limit)) {
                if (result.isNotEmpty() && bytes + header.payloadBytes > PAGE_BYTE_BUDGET) break
                val row = dao.item(kind, owner, header.id) ?: throw corruptLocalData()
                result += storedItem(row)
                bytes += header.payloadBytes
            }
            val more = headers.size > result.size
            StoredPage(result, if (more) result.lastOrNull()?.let { StoredCursor(it.updatedAt, it.id) } else null)
        }
    }

    override suspend fun cachePage(kind: String, owner: String, cursor: String?, payload: JsonObject, nextCursor: String?, updatedAt: Long) = access(owner) {
        validateKey(kind)
        require(updatedAt >= 0)
        val key = cursorKey(cursor)
        nextCursor?.let { require(it.length <= 16_384) }
        database().transaction {
            dao.putPage(PageEntity(owner, kind, key, encodeLocal(payload), nextCursor, updatedAt))
            dao.trimPages(owner, kind)
        }
    }

    override suspend fun cachedPage(kind: String, owner: String, cursor: String?): CachedPage? = access(owner) {
        validateKey(kind)
        dao.page(kind, owner, cursorKey(cursor))?.let { CachedPage(decodeLocalObject(it.payload), it.nextCursor, it.updatedAt) }
    }

    override suspend fun clearCache(owner: String) = access(owner) { dao.deletePages(owner) }
    override suspend fun clearOwner(owner: String) = access(owner) { purgeOwner(owner) }

    /** Called with the owner gate closed during logout; guest data is never migrated. */
    internal suspend fun purgeOwner(owner: String) = withContext(Dispatchers.IO) {
        OwnerGate.validateOwner(owner)
        dao.downloads(owner).forEach { files.delete(it.localPath) }
        database().transaction {
            dao.deleteOwnerItems(owner)
            dao.deletePages(owner)
            dao.deleteOwnerOutbox(owner)
            dao.deleteOwnerDownloads(owner)
        }
    }

    override suspend fun exportOwner(owner: String): JsonObject = access(owner) {
        database().transaction {
            var bytes = 0L
            val records = mutableListOf<JsonElement>()
            var kind: String? = null
            var id: String? = null
            while (true) {
                val row = dao.exportItems(owner, kind, id, 1).singleOrNull() ?: break
                bytes += row.payload.toByteArray(Charsets.UTF_8).size
                checkExportSize(bytes)
                records += buildJsonObject {
                    put("kind", row.kind); put("id", row.id); put("updatedAt", row.updatedAt)
                    put("payload", decodeLocalObject(row.payload))
                }
                kind = row.kind; id = row.id
            }
            val operations = mutableListOf<JsonElement>()
            var operationId: String? = null
            while (true) {
                val row = dao.exportOutbox(owner, operationId, 1).singleOrNull() ?: break
                bytes += (row.body?.toByteArray(Charsets.UTF_8)?.size ?: 0) + (row.result?.toByteArray(Charsets.UTF_8)?.size ?: 0)
                checkExportSize(bytes)
                operations += buildJsonObject {
                    put("id", row.id); put("method", row.method); put("path", row.path)
                    put("idempotencyKey", row.idempotencyKey); put("state", row.state)
                    put("attempts", row.attempts); put("createdAt", row.createdAt); put("updatedAt", row.updatedAt)
                    row.body?.let { put("body", decodeLocalObject(it)) }
                    row.result?.let { put("result", decodeLocal(it)) }
                    row.errorCode?.let { put("errorCode", it) }
                    row.errorDetails?.let { put("errorDetails", decodeLocalObject(it)) }
                }
                operationId = row.id
            }
            val downloads = dao.downloads(owner).map { row ->
                buildJsonObject {
                    put("id", row.id); put("url", row.url); put("name", row.name); put("mimeType", row.mimeType)
                    put("state", row.state); put("bytesDownloaded", row.bytesDownloaded); put("updatedAt", row.updatedAt)
                    row.totalBytes?.let { put("totalBytes", it) }; row.sha256?.let { put("sha256", it) }
                    row.errorCode?.let { put("errorCode", it) }
                }
            }
            buildJsonObject {
                put("version", 1); put("owner", owner)
                put("items", JsonArray(records)); put("outbox", JsonArray(operations)); put("downloads", JsonArray(downloads))
            }
        }
    }

    override fun observeDownloads(owner: String): Flow<List<DownloadRecord>> =
        owners.observe(owner) { dao.observeDownloads(owner).map { rows -> rows.map(::downloadRecord) } }.flowOn(Dispatchers.IO)

    override suspend fun getDownload(owner: String, id: String): DownloadRecord? = access(owner) {
        validateKey(id)
        val row = dao.download(owner, id) ?: return@access null
        val record = downloadRecord(row)
        if (record.state != DownloadState.COMPLETE) return@access record
        val file = record.localPath?.let { files.checked(File(it)) }
        val valid = file != null && file.isFile && file.length() == record.bytesDownloaded &&
            record.sha256 != null && fileDigest(file) == record.sha256
        if (valid) record else {
            val failed = row.copy(state = DownloadState.FAILED.name, errorCode = "download_integrity_failed", updatedAt = System.currentTimeMillis())
            dao.putDownload(failed)
            downloadRecord(failed)
        }
    }

    override suspend fun putDownload(record: DownloadRecord) = access(record.owner) {
        validateKey(record.id)
        urls.download(record.url)
        require(record.name.isNotBlank() && record.name.length <= 255 && record.name.none { it.isISOControl() })
        require(record.mimeType.isNotBlank() && record.mimeType.length <= 255)
        require(record.bytesDownloaded >= 0 && (record.totalBytes == null || record.totalBytes >= record.bytesDownloaded))
        require(record.updatedAt >= 0)
        record.localPath?.let { files.checked(File(it)) }
        record.sha256?.let { require(SHA256.matches(it)) }
        if (record.state == DownloadState.COMPLETE) {
            val path = record.localPath ?: throw ApiException(0, "download_incomplete", "A completed download requires a saved file.")
            val file = files.checked(File(path))
            if (!file.isFile || file.length() != record.bytesDownloaded || record.sha256 == null || fileDigest(file) != record.sha256) {
                throw ApiException(0, "download_integrity_failed", "The downloaded file failed its size or SHA-256 integrity check.")
            }
        }
        dao.putDownload(DownloadEntity(
            record.id, record.owner, record.url, record.name, record.mimeType, record.state.name,
            record.bytesDownloaded, record.totalBytes, record.localPath, record.sha256, record.etag,
            record.errorCode, record.updatedAt,
        ))
    }

    override suspend fun deleteDownload(owner: String, id: String) = access(owner) {
        validateKey(id)
        val row = dao.download(owner, id) ?: return@access
        files.delete(row.localPath)
        dao.deleteDownload(owner, id)
    }

    internal suspend fun recoverInterruptedDownloads() = withContext(Dispatchers.IO) {
        dao.recoverDownloads(System.currentTimeMillis())
        files.cleanInterruptedParts(System.currentTimeMillis())
    }

    private suspend fun <T> access(owner: String, action: suspend () -> T): T = withContext(Dispatchers.IO) {
        try {
            owners.withOwner(owner, action)
        } catch (_: SQLiteException) {
            throw ApiException(0, "local_store_unavailable", "Local data storage is unavailable. Check free space and retry.")
        }
    }

    private fun storedItem(entity: StoredEntity) = StoredItem(entity.id, decodeLocalObject(entity.payload), entity.updatedAt)

    private fun downloadRecord(entity: DownloadEntity) = DownloadRecord(
        entity.id, entity.owner, entity.url, entity.name, entity.mimeType,
        try { DownloadState.valueOf(entity.state) } catch (_: IllegalArgumentException) { throw corruptLocalData() },
        entity.bytesDownloaded, entity.totalBytes, entity.localPath, entity.sha256, entity.etag, entity.errorCode, entity.updatedAt,
    )

    private fun cursorKey(cursor: String?): String {
        require(cursor == null || cursor.length <= 16_384)
        return if (cursor == null) "first" else "cursor:$cursor"
    }

    private fun checkExportSize(bytes: Long) {
        if (bytes > 128L * 1024 * 1024) throw ApiException(0, "export_too_large", "The local export exceeds the memory-safe export size; no partial data was returned.")
    }

    private fun fileDigest(file: File): String = try {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(32_768)
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                digest.update(buffer, 0, count)
            }
        }
        digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    } catch (_: IOException) {
        throw ApiException(0, "download_file_unavailable", "The downloaded file can no longer be read.")
    }

    private companion object {
        const val PAGE_BYTE_BUDGET = 32L * 1024 * 1024
        val SHA256 = Regex("[a-f0-9]{64}")
    }
}

internal fun validateKey(value: String) {
    require(value.isNotBlank() && value.length <= 512 && value.none { it.isISOControl() }) { "Invalid local record key." }
}

internal fun encodeLocal(value: JsonElement): String {
    val result = value.toString()
    if (result.toByteArray(Charsets.UTF_8).size > HttpTransport.MAX_JSON_BYTES) {
        throw ApiException(0, "local_record_too_large", "This record exceeds the supported local payload size.")
    }
    return result
}

internal fun decodeLocal(value: String): JsonElement = try {
    wireJson.parseToJsonElement(value)
} catch (_: IllegalArgumentException) {
    throw corruptLocalData()
}

internal fun decodeLocalObject(value: String): JsonObject = decodeLocal(value) as? JsonObject ?: throw corruptLocalData()
internal fun corruptLocalData() = ApiException(0, "local_data_corrupt", "A stored record cannot be decoded. Export or remove the affected record before retrying.")
