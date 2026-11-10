package com.physicsos.student.core

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.work.WorkerFactory
import com.physicsos.student.BuildConfig
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

/** One graph per Application; feature modules receive this instance through their constructors. */
class AppGraph(context: Context) : Closeable {
    private val context = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val initialized = AtomicBoolean(false)
    private val fence = RequestFence()
    private val owners = OwnerGate(fence)
    private val urls = OriginPolicy(BuildConfig.SERVER_ORIGIN, BuildConfig.MOBILE_API_BASE_URL)
    private val files = PrivateFiles(listOf(this.context.filesDir, this.context.cacheDir))
    private val transport by lazy { HttpTransport(urls, fence) }
    private val databaseDelegate = lazy { CoreDatabase.open(this.context) }
    private val database by databaseDelegate
    private val preferences by lazy {
        PreferenceDataStoreFactory.create(scope = scope) { this.context.preferencesDataStoreFile("core-settings") }
    }
    private val storeImplementation by lazy { RoomLocalStore({ database }, owners, files, urls) }
    private val settingsImplementation by lazy { DataStoreSettingsRepository(preferences) }
    private val authImplementation: DefaultAuthRepository by lazy {
        DefaultAuthRepository(
            transport = transport,
            grants = EncryptedGrantStore(this.context, BuildConfig.SERVER_ORIGIN),
            owners = owners,
            scope = scope,
            isOnline = ::isOnline,
            client = { apiImplementation },
            purgeOwner = { storeImplementation.purgeOwner(it) },
            activateOwner = { storeImplementation.activateOwner(it) },
            exportOwner = { storeImplementation.exportOwner(it) },
            onAuthenticated = { syncImplementation.onAuthenticated(it) },
            onSignedOut = { syncImplementation.onSignedOut(it) },
            appVersion = BuildConfig.VERSION_NAME,
        )
    }
    private val apiImplementation by lazy { DefaultMobileClient(transport, authImplementation, files) }
    private val syncImplementation by lazy {
        DefaultSyncCoordinator({ database }, owners, authImplementation, apiImplementation, urls, fence,
            WorkManagerSyncScheduler(this.context, settingsImplementation))
    }

    val api: MobileClient get() = apiImplementation
    val auth: AuthRepository get() = authImplementation
    val store: LocalStore get() = storeImplementation
    val catalog: CatalogRepository by lazy { AssetCatalogRepository(this.context.assets) }
    val settings: SettingsRepository get() = settingsImplementation
    val sync: SyncCoordinator get() = syncImplementation

    /** Safe to read in Application.workManagerConfiguration, before onCreate or initialize. */
    val workerFactory: WorkerFactory = CoreWorkerFactory({ authImplementation }, { syncImplementation })

    /** Call once from Application.onCreate. Disk, restoration and scheduling run off the main thread. */
    fun initialize() {
        if (!initialized.compareAndSet(false, true)) return
        scope.launch {
            backgroundStep { storeImplementation.recoverInterruptedDownloads() }
            backgroundStep { authImplementation.restore() }
            backgroundStep { syncImplementation.recover() }
        }
        scope.launch {
            settingsImplementation.syncOnMeteredNetwork.drop(1)
                .catch { error ->
                    if (error is CancellationException) throw error
                    authImplementation.reportBackgroundError(error as? ApiException
                        ?: ApiException(0, "settings_unavailable", "Background sync preferences could not be read."))
                }
                .collect { backgroundStep { syncImplementation.rescheduleForPreferences() } }
        }
    }

    private suspend fun backgroundStep(action: suspend () -> Unit) {
        try {
            action()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            authImplementation.reportBackgroundError(error as? ApiException
                ?: ApiException(0, "local_initialization_failed", "Local storage or background synchronization could not be initialized."))
        }
    }

    private fun isOnline(): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /** For process-owned teardown/tests, not individual feature lifecycles. */
    override fun close() {
        fence.advance()
        scope.cancel()
        if (databaseDelegate.isInitialized()) database.close()
    }
}
