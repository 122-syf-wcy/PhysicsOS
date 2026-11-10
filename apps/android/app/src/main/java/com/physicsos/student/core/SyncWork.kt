package com.physicsos.student.core

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Operation
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

internal interface SyncScheduler {
    suspend fun enqueue(owner: String)
    suspend fun periodic(owner: String)
    suspend fun cancel(owner: String)
}

/** getInstance is intentionally never called by a constructor or Configuration.Provider getter. */
internal class WorkManagerSyncScheduler(
    context: Context,
    private val settings: SettingsRepository,
) : SyncScheduler {
    private val context = context.applicationContext

    override suspend fun enqueue(owner: String) = withContext(Dispatchers.IO) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInputData(workDataOf(OWNER_KEY to owner))
            .setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(WORK_TAG)
            .build()
        manager().enqueueUniqueWork(workName(owner), ExistingWorkPolicy.APPEND_OR_REPLACE, request).awaitPersistence()
    }

    override suspend fun periodic(owner: String) = withContext(Dispatchers.IO) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setInputData(workDataOf(OWNER_KEY to owner))
            .setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(WORK_TAG)
            .build()
        manager().enqueueUniquePeriodicWork("${workName(owner)}-periodic", ExistingPeriodicWorkPolicy.UPDATE, request).awaitPersistence()
    }

    override suspend fun cancel(owner: String) = withContext(Dispatchers.IO) {
        manager().cancelUniqueWork(workName(owner)).awaitPersistence()
        manager().cancelUniqueWork("${workName(owner)}-periodic").awaitPersistence()
    }

    private suspend fun constraints(): Constraints = Constraints.Builder()
        .setRequiredNetworkType(if (settings.syncOnMeteredNetwork.first()) NetworkType.CONNECTED else NetworkType.UNMETERED)
        .setRequiresStorageNotLow(true)
        .build()

    private fun manager(): WorkManager = try {
        WorkManager.getInstance(context)
    } catch (_: IllegalStateException) {
        throw ApiException(0, "sync_not_initialized", "Background synchronization has not been configured by the application.")
    }

    private fun workName(owner: String) = "$WORK_TAG-${sha256Hex(owner.toByteArray(Charsets.UTF_8))}"

    companion object {
        const val OWNER_KEY = "owner"
        const val WORK_TAG = "physicsos-account-sync-v1"
    }
}

internal class CoreWorkerFactory(
    private val auth: () -> AuthRepository,
    private val sync: () -> DefaultSyncCoordinator,
) : WorkerFactory() {
    override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? =
        if (workerClassName == SyncWorker::class.java.name) SyncWorker(appContext, workerParameters, auth(), sync()) else null
}

/** Stable class name is stored by WorkManager; no foreground service or persistent socket is used. */
internal class SyncWorker(
    context: Context,
    parameters: WorkerParameters,
    private val auth: AuthRepository,
    private val coordinator: DefaultSyncCoordinator,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val owner = inputData.getString(WorkManagerSyncScheduler.OWNER_KEY)
            ?: return Result.failure(workDataOf("code" to "missing_owner"))
        try {
            auth.restore()
            val state = auth.state.value
            if (state !is AuthState.SignedIn || state.user.userKey != owner) return Result.success()
            val result = coordinator.run(owner)
            return if (result.retry) Result.retry() else Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            return if (error.retryable) Result.retry() else Result.failure(workDataOf("code" to error.code))
        }
    }
}

private suspend fun Operation.awaitPersistence(): Unit = suspendCancellableCoroutine { continuation ->
    val future = result
    future.addListener({
        if (continuation.isActive) {
            try {
                future.get()
                continuation.resume(Unit)
            } catch (_: Exception) {
                continuation.resumeWithException(ApiException(0, "sync_schedule_failed", "The operation is saved locally, but background scheduling failed. Retry synchronization in the app."))
            }
        }
    }, Executor { it.run() })
}
