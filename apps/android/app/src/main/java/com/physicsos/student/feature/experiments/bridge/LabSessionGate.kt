package com.physicsos.student.feature.experiments.bridge

/** Pure session/lifecycle rules, independent of WebView and Activity recreation. */
internal class LabSessionGate(val generation: String) {
    var ready: Boolean = false
        private set
    var loaded: Boolean = false
        private set
    var destroyed: Boolean = false
        private set
    private var attached = false
    private var resumed = false
    private var lastActive: Boolean? = null

    val active: Boolean get() = attached && resumed && loaded && !destroyed

    /** A repeated ready must not reset an edited scene. */
    fun ready(): Boolean {
        if (destroyed || ready) return false
        ready = true
        return true
    }

    fun load(): Boolean {
        if (destroyed || !ready || loaded) return false
        loaded = true
        return true
    }

    fun attach() { if (!destroyed) attached = true }
    fun detach() { attached = false }
    fun resume() { if (!destroyed) resumed = true }
    fun pause() { resumed = false }

    /** No lifecycle command is sent before ready/load. */
    fun lifecycleChange(): Boolean? {
        if (!loaded || destroyed || lastActive == active) return null
        return active.also { lastActive = it }
    }

    fun accepts(messageGeneration: String?): Boolean =
        !destroyed && loaded && messageGeneration == generation

    fun destroy() {
        destroyed = true
        attached = false
        resumed = false
        lastActive = false
    }
}
