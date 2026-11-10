package com.physicsos.student.core

import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

internal class DefaultSyncCoordinator(
    private val database: () -> CoreDatabase,
    private val owners: OwnerGate,
    private val auth: DefaultAuthRepository,
    private val api: DefaultMobileClient,
    private val urls: OriginPolicy,
    private val fence: RequestFence,
    private val scheduler: SyncScheduler,
    private val now: () -> Long = System::currentTimeMillis,
) : SyncCoordinator {
    private val running = Mutex()
    private val dao get() = database().records()

    override suspend fun enqueue(method: String, path: String, body: JsonObject?, idempotencyKey: String) = withContext(Dispatchers.IO) {
        val stamp = owners.current()
        val normalized = method.uppercase(Locale.ROOT)
        require(normalized in setOf("POST", "PUT", "PATCH", "DELETE")) { "Only mutations belong in the outbox." }
        val url = urls.mobile(path)
        val route = url.encodedPath.removePrefix(urls.mobileBase.encodedPath)
        if (route.startsWith("auth/") || route.startsWith("account/")) {
            throw ApiException(0, "unsupported_queued_operation", "Account credentials and deletion require an interactive request.")
        }
        HttpTransport.validateIdempotencyKey(idempotencyKey)
        val encoded = body?.let(::encodeLocal)
        val schedule = owners.withOwner(stamp.owner) {
            fence.check(stamp.epoch)
            database().transaction {
                val old = dao.outboxByKey(stamp.owner, idempotencyKey)
                if (old != null) {
                    if (old.method != normalized || old.path != path || old.body?.let(::decodeLocalObject) != body) {
                        throw ApiException(409, "idempotency_key_reused", "This idempotency key already belongs to a different operation.")
                    }
                    old.state != OutboxState.ACKNOWLEDGED.name
                } else {
                    val time = now()
                    val row = OutboxEntity(UUID.randomUUID().toString(), stamp.owner, normalized, path, encoded,
                        idempotencyKey, OutboxState.PENDING.name, 0, time, time, time)
                    if (dao.insertOutbox(row) == -1L) throw ApiException(409, "idempotency_key_reused", "An operation with this key already exists.")
                    true
                }
            }
        }
        if (schedule) scheduler.enqueue(stamp.owner)
    }

    override fun observe(owner: String): Flow<List<OutboxItem>> = owners.observe(owner) {
        dao.observeOutbox(owner).map { rows -> rows.map(::outboxItem) }
    }.flowOn(Dispatchers.IO)

    override suspend fun operationBody(id: String): JsonObject? = withContext(Dispatchers.IO) {
        val stamp = owners.current()
        owners.withOwner(stamp.owner) { operation(stamp.owner, id).body?.let(::decodeLocalObject) }
    }

    override suspend fun retry(id: String) = change(id) { row ->
        val state = outboxState(row.state)
        if (state in setOf(OutboxState.CONFLICT, OutboxState.RUNNING, OutboxState.ACKNOWLEDGED)) {
            throw ApiException(409, "operation_not_retryable", "Resolve conflicts explicitly; running or confirmed operations cannot be replayed.")
        }
        row.copy(state = OutboxState.PENDING.name, updatedAt = now(), nextAttemptAt = now(),
            errorStatus = null, errorCode = null, errorMessage = null, errorDetails = null)
    }

    override suspend fun discard(id: String) = withContext(Dispatchers.IO) {
        val stamp = owners.current()
        owners.withOwner(stamp.owner) {
            database().transaction {
                val row = operation(stamp.owner, id)
                if (row.state == OutboxState.RUNNING.name) throw ApiException(409, "operation_running", "Wait for the in-flight result before discarding it.")
                dao.deleteOutbox(stamp.owner, id)
            }
        }
    }

    override suspend fun resolveConflict(id: String, body: JsonObject?, idempotencyKey: String) {
        HttpTransport.validateIdempotencyKey(idempotencyKey)
        withContext(Dispatchers.IO) {
            val encoded = body?.let(::encodeLocal)
            change(id) { row ->
                if (row.state != OutboxState.CONFLICT.name) throw ApiException(409, "not_a_conflict", "This operation is not awaiting conflict resolution.")
                if (row.idempotencyKey == idempotencyKey || dao.outboxByKey(row.owner, idempotencyKey) != null) {
                    throw ApiException(409, "idempotency_key_reused", "A reconciled operation requires a new idempotency key.")
                }
                row.copy(body = encoded, idempotencyKey = idempotencyKey, state = OutboxState.PENDING.name,
                    attempts = 0, updatedAt = now(), nextAttemptAt = now(), errorStatus = null,
                    errorCode = null, errorMessage = null, errorDetails = null, result = null)
            }
        }
    }

    private suspend fun change(id: String, transform: suspend (OutboxEntity) -> OutboxEntity) = withContext(Dispatchers.IO) {
        val stamp = owners.current()
        owners.withOwner(stamp.owner) {
            database().transaction { dao.putOutbox(transform(operation(stamp.owner, id))) }
        }
        scheduler.enqueue(stamp.owner)
    }

    override suspend fun syncNow() {
        auth.restore()
        val owner = owners.current().owner
        val result = run(owner)
        result.error?.let { throw it }
    }

    internal suspend fun run(owner: String): SyncRunResult = withContext(Dispatchers.IO) {
        running.withLock {
            val stamp = try { owners.current() } catch (_: ApiException) { return@withLock SyncRunResult(false) }
            if (stamp.owner != owner) return@withLock SyncRunResult(false)
            dao.recoverOutbox(owner, now())
            val deadline = now() + 300_000
            var processed = 0
            var firstError: ApiException? = null
            while (processed++ < 50 && now() < deadline) {
                if (!fence.isCurrent(stamp.epoch)) return@withLock SyncRunResult(false, accountChanged())
                val item = owners.withOwner(owner) {
                    database().transaction {
                        val candidate = dao.nextOutbox(owner, now()) ?: return@transaction null
                        if (dao.claimOutbox(owner, candidate.id, now()) == 1) candidate.copy(attempts = candidate.attempts + 1) else null
                    }
                } ?: break
                try {
                    val result = api.requestOwned(item.method, item.path, item.body?.let(::decodeLocalObject), stamp, item.idempotencyKey)
                    fence.check(stamp.epoch)
                    dao.finishOutbox(owner, item.id, OutboxState.ACKNOWLEDGED.name, now(), 0, null, null, null, null, encodeLocal(result))
                } catch (cancelled: CancellationException) {
                    withContext(NonCancellable) {
                        dao.finishOutbox(owner, item.id, OutboxState.RETRY.name, now(), now(), 0,
                            "sync_interrupted", "Sync was interrupted; the original operation key is retained.", null, null)
                    }
                    throw cancelled
                } catch (error: ApiException) {
                    if (firstError == null) firstError = error
                    val state = when {
                        error.status == 409 -> OutboxState.CONFLICT
                        error.status == 401 || error.code == "account_changed" -> OutboxState.AUTH_REQUIRED
                        error.retryable -> OutboxState.RETRY
                        else -> OutboxState.FAILED
                    }
                    val nextAttempt = if (state == OutboxState.RETRY) now() + retryDelay(item.attempts, error.retryAfterMillis) else 0
                    withContext(NonCancellable) {
                        dao.finishOutbox(owner, item.id, state.name, now(), nextAttempt, error.status,
                            error.code, error.message, error.details?.let(::encodeLocal), null)
                        if (state == OutboxState.AUTH_REQUIRED) dao.pauseOutbox(owner, now())
                    }
                    if (state == OutboxState.RETRY) return@withLock SyncRunResult(true, firstError)
                    if (state == OutboxState.AUTH_REQUIRED) return@withLock SyncRunResult(false, firstError)
                }
            }
            SyncRunResult(dao.pendingCount(owner) > 0, firstError)
        }
    }

    internal suspend fun onAuthenticated(owner: String) = withContext(Dispatchers.IO) {
        owners.withOwner(owner) { dao.resumeAuthenticated(owner, now()) }
        scheduler.periodic(owner)
        scheduler.enqueue(owner)
    }

    internal suspend fun onSignedOut(owner: String) = withContext(Dispatchers.IO) {
        dao.pauseOutbox(owner, now())
        scheduler.cancel(owner)
    }

    internal suspend fun recover() = withContext(Dispatchers.IO) {
        val current = owners.active.value ?: return@withContext
        running.withLock {
            if (!fence.isCurrent(current.epoch)) return@withLock
            dao.recoverOutbox(current.owner, now())
        }
        scheduler.periodic(current.owner)
        scheduler.enqueue(current.owner)
    }

    internal suspend fun rescheduleForPreferences() {
        val current = owners.active.value ?: return
        scheduler.periodic(current.owner)
        scheduler.enqueue(current.owner)
    }

    private suspend fun operation(owner: String, id: String): OutboxEntity {
        validateKey(id)
        return dao.outbox(owner, id) ?: throw ApiException(404, "operation_not_found", "This account has no such queued operation.")
    }

    private fun outboxItem(row: OutboxProjection) = OutboxItem(
        row.id, row.owner, row.method, row.path, row.idempotencyKey, outboxState(row.state), row.attempts,
        row.createdAt, row.updatedAt, row.nextAttemptAt, row.errorStatus, row.errorCode, row.errorMessage,
        row.errorDetails?.let(::decodeLocalObject), row.result?.let(::decodeLocal),
    )

    private fun outboxState(value: String): OutboxState = try { OutboxState.valueOf(value) } catch (_: IllegalArgumentException) { throw corruptLocalData() }
}

internal data class SyncRunResult(val retry: Boolean, val error: ApiException? = null)

internal fun retryDelay(attempts: Int, retryAfter: Long?): Long {
    val backoff = (30_000L shl (attempts - 1).coerceIn(0, 10)).coerceAtMost(21_600_000)
    return maxOf(backoff, retryAfter?.coerceIn(0, 86_400_000) ?: 0)
}
