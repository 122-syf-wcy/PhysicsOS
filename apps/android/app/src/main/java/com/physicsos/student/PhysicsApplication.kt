package com.physicsos.student

import android.app.Application
import androidx.work.Configuration
import com.physicsos.student.core.AppGraph

/** Owns one account-aware data graph; WorkManager and activities share it. */
class PhysicsApplication : Application(), Configuration.Provider {
    val graph: AppGraph by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { AppGraph(this) }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(graph.workerFactory)
            .setMinimumLoggingLevel(android.util.Log.WARN)
            .build()

    override fun onCreate() {
        super.onCreate()
        graph.initialize()
    }
}
