package com.physicsos.student.core

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import androidx.room.immediateTransaction
import androidx.room.useWriterConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "stored_items", primaryKeys = ["owner", "kind", "id"], indices = [Index(value = ["owner", "kind", "updatedAt", "id"])])
internal data class StoredEntity(val owner: String, val kind: String, val id: String, val payload: String, val updatedAt: Long)
internal data class StoredHeader(val id: String, val updatedAt: Long, val payloadBytes: Long)

@Entity(tableName = "page_cache", primaryKeys = ["owner", "kind", "cursorKey"], indices = [Index(value = ["owner", "kind", "updatedAt"])])
internal data class PageEntity(
    val owner: String,
    val kind: String,
    val cursorKey: String,
    val payload: String,
    val nextCursor: String?,
    val updatedAt: Long,
)

@Entity(
    tableName = "outbox",
    indices = [Index(value = ["owner", "idempotencyKey"], unique = true), Index(value = ["owner", "state", "nextAttemptAt", "createdAt"])],
)
internal data class OutboxEntity(
    @PrimaryKey val id: String,
    val owner: String,
    val method: String,
    val path: String,
    val body: String?,
    val idempotencyKey: String,
    val state: String,
    val attempts: Int,
    val createdAt: Long,
    val updatedAt: Long,
    val nextAttemptAt: Long,
    val errorStatus: Int? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val errorDetails: String? = null,
    val result: String? = null,
)

/** Deliberately excludes the potentially 12 MiB request body from observable lists. */
internal data class OutboxProjection(
    val id: String,
    val owner: String,
    val method: String,
    val path: String,
    val idempotencyKey: String,
    val state: String,
    val attempts: Int,
    val createdAt: Long,
    val updatedAt: Long,
    val nextAttemptAt: Long,
    val errorStatus: Int?,
    val errorCode: String?,
    val errorMessage: String?,
    val errorDetails: String?,
    val result: String?,
)

@Entity(tableName = "downloads", primaryKeys = ["owner", "id"], indices = [Index(value = ["owner", "state", "updatedAt"])])
internal data class DownloadEntity(
    val id: String,
    val owner: String,
    val url: String,
    val name: String,
    val mimeType: String,
    val state: String,
    val bytesDownloaded: Long,
    val totalBytes: Long?,
    val localPath: String?,
    val sha256: String?,
    val etag: String?,
    val errorCode: String?,
    val updatedAt: Long,
)

@Dao
internal interface CoreDao {
    @Query("SELECT * FROM stored_items WHERE owner = :owner AND kind = :kind ORDER BY updatedAt DESC, id ASC")
    fun observeItems(kind: String, owner: String): Flow<List<StoredEntity>>

    @Query("SELECT * FROM stored_items WHERE owner = :owner AND kind = :kind AND id = :id")
    suspend fun item(kind: String, owner: String, id: String): StoredEntity?

    @Upsert suspend fun putItem(item: StoredEntity)

    @Query("DELETE FROM stored_items WHERE owner = :owner AND kind = :kind AND id = :id")
    suspend fun deleteItem(kind: String, owner: String, id: String)

    @Query("SELECT id, updatedAt, LENGTH(CAST(payload AS BLOB)) AS payloadBytes FROM stored_items WHERE owner = :owner AND kind = :kind AND (:beforeAt IS NULL OR updatedAt < :beforeAt OR (updatedAt = :beforeAt AND id > :beforeId)) ORDER BY updatedAt DESC, id ASC LIMIT :limit")
    suspend fun pageHeaders(kind: String, owner: String, beforeAt: Long?, beforeId: String?, limit: Int): List<StoredHeader>

    @Query("SELECT * FROM stored_items WHERE owner = :owner AND (:afterKind IS NULL OR kind > :afterKind OR (kind = :afterKind AND id > :afterId)) ORDER BY kind ASC, id ASC LIMIT :limit")
    suspend fun exportItems(owner: String, afterKind: String?, afterId: String?, limit: Int): List<StoredEntity>

    @Query("DELETE FROM stored_items WHERE owner = :owner") suspend fun deleteOwnerItems(owner: String)
    @Upsert suspend fun putPage(page: PageEntity)

    @Query("SELECT * FROM page_cache WHERE owner = :owner AND kind = :kind AND cursorKey = :cursorKey")
    suspend fun page(kind: String, owner: String, cursorKey: String): PageEntity?

    @Query("DELETE FROM page_cache WHERE owner = :owner") suspend fun deletePages(owner: String)

    @Query("DELETE FROM page_cache WHERE owner = :owner AND kind = :kind AND cursorKey NOT IN (SELECT cursorKey FROM page_cache WHERE owner = :owner AND kind = :kind ORDER BY updatedAt DESC, cursorKey ASC LIMIT 100)")
    suspend fun trimPages(owner: String, kind: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertOutbox(item: OutboxEntity): Long
    @Upsert suspend fun putOutbox(item: OutboxEntity)

    @Query("SELECT * FROM outbox WHERE owner = :owner AND id = :id")
    suspend fun outbox(owner: String, id: String): OutboxEntity?

    @Query("SELECT * FROM outbox WHERE owner = :owner AND idempotencyKey = :key")
    suspend fun outboxByKey(owner: String, key: String): OutboxEntity?

    @Query("SELECT id, owner, method, path, idempotencyKey, state, attempts, createdAt, updatedAt, nextAttemptAt, errorStatus, errorCode, errorMessage, errorDetails, result FROM outbox WHERE owner = :owner ORDER BY createdAt DESC, id DESC")
    fun observeOutbox(owner: String): Flow<List<OutboxProjection>>

    @Query("SELECT * FROM outbox WHERE owner = :owner AND (:afterId IS NULL OR id > :afterId) ORDER BY id ASC LIMIT :limit")
    suspend fun exportOutbox(owner: String, afterId: String?, limit: Int): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE owner = :owner AND state IN ('PENDING', 'RETRY') AND nextAttemptAt <= :now ORDER BY createdAt ASC, id ASC LIMIT 1")
    suspend fun nextOutbox(owner: String, now: Long): OutboxEntity?

    @Query("SELECT COUNT(*) FROM outbox WHERE owner = :owner AND state IN ('PENDING', 'RETRY', 'RUNNING')")
    suspend fun pendingCount(owner: String): Int

    @Query("UPDATE outbox SET state = 'RUNNING', attempts = attempts + 1, updatedAt = :now WHERE owner = :owner AND id = :id AND state IN ('PENDING', 'RETRY')")
    suspend fun claimOutbox(owner: String, id: String, now: Long): Int

    @Query("UPDATE outbox SET state = :state, updatedAt = :now, nextAttemptAt = :nextAttemptAt, errorStatus = :errorStatus, errorCode = :errorCode, errorMessage = :errorMessage, errorDetails = :errorDetails, result = :result WHERE owner = :owner AND id = :id AND state = 'RUNNING'")
    suspend fun finishOutbox(
        owner: String, id: String, state: String, now: Long, nextAttemptAt: Long,
        errorStatus: Int?, errorCode: String?, errorMessage: String?, errorDetails: String?, result: String?,
    ): Int

    @Query("UPDATE outbox SET state = 'RETRY', updatedAt = :now, nextAttemptAt = :now, errorCode = 'sync_interrupted', errorMessage = 'Sync was interrupted; the same idempotency key will be reused.' WHERE owner = :owner AND state = 'RUNNING'")
    suspend fun recoverOutbox(owner: String, now: Long)

    @Query("UPDATE outbox SET state = 'PENDING', updatedAt = :now, nextAttemptAt = :now, errorStatus = NULL, errorCode = NULL, errorMessage = NULL, errorDetails = NULL WHERE owner = :owner AND state = 'AUTH_REQUIRED'")
    suspend fun resumeAuthenticated(owner: String, now: Long)

    @Query("UPDATE outbox SET state = 'AUTH_REQUIRED', updatedAt = :now, errorStatus = 401, errorCode = 'sign_in_required', errorMessage = 'Sign in to this account to synchronize.' WHERE owner = :owner AND state IN ('PENDING', 'RETRY', 'RUNNING')")
    suspend fun pauseOutbox(owner: String, now: Long)

    @Query("DELETE FROM outbox WHERE owner = :owner AND id = :id") suspend fun deleteOutbox(owner: String, id: String)
    @Query("DELETE FROM outbox WHERE owner = :owner") suspend fun deleteOwnerOutbox(owner: String)

    @Query("SELECT * FROM downloads WHERE owner = :owner ORDER BY updatedAt DESC, id ASC")
    fun observeDownloads(owner: String): Flow<List<DownloadEntity>>

    @Query("SELECT * FROM downloads WHERE owner = :owner AND id = :id") suspend fun download(owner: String, id: String): DownloadEntity?
    @Query("SELECT * FROM downloads WHERE owner = :owner ORDER BY id ASC") suspend fun downloads(owner: String): List<DownloadEntity>
    @Upsert suspend fun putDownload(download: DownloadEntity)
    @Query("DELETE FROM downloads WHERE owner = :owner AND id = :id") suspend fun deleteDownload(owner: String, id: String)
    @Query("DELETE FROM downloads WHERE owner = :owner") suspend fun deleteOwnerDownloads(owner: String)

    @Query("UPDATE downloads SET state = 'PAUSED', errorCode = 'download_interrupted', updatedAt = :now WHERE state = 'DOWNLOADING'")
    suspend fun recoverDownloads(now: Long)
}

@Database(entities = [StoredEntity::class, PageEntity::class, OutboxEntity::class, DownloadEntity::class], version = 1, exportSchema = true)
internal abstract class CoreDatabase : RoomDatabase() {
    abstract fun records(): CoreDao

    suspend fun <T> transaction(block: suspend () -> T): T {
        val result = useWriterConnection { connection -> connection.immediateTransaction { block() } }
        invalidationTracker.refreshAsync()
        return result
    }

    companion object {
        fun open(context: Context): CoreDatabase = Room.databaseBuilder(context, CoreDatabase::class.java, "physicsos-student.db")
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(Dispatchers.IO)
            .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
            .build()
    }
}
