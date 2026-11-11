package com.physicsos.student.feature.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.physicsos.student.core.SettingsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal data class NotificationPreferenceState(val enabled: Boolean? = null, val busy: Boolean = false, val failed: Boolean = false)

/** The device-wide preference is not Android permission and is not a vendor push registration. */
internal class NotificationPreferences(private val settings: SettingsRepository) : ViewModel() {
    private val mutableState = MutableStateFlow(NotificationPreferenceState())
    val state = mutableState.asStateFlow()
    private var observation: Job? = null

    init { reload() }

    fun reload() {
        observation?.cancel()
        mutableState.update { it.copy(failed = false) }
        observation = viewModelScope.launch {
            try {
                settings.notificationsEnabled.collect { enabled -> mutableState.update { it.copy(enabled = enabled) } }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mutableState.update { it.copy(enabled = null, failed = true) } }
        }
    }

    fun setEnabled(value: Boolean) {
        if (mutableState.value.busy || mutableState.value.enabled == null) return
        mutableState.update { it.copy(busy = true, failed = false) }
        viewModelScope.launch {
            try { settings.setNotificationsEnabled(value) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mutableState.update { it.copy(failed = true) } }
            finally { mutableState.update { it.copy(busy = false) } }
        }
    }
}

internal data class NotificationSystemState(
    val permissionRequired: Boolean,
    val permissionGranted: Boolean,
    val notificationsAllowed: Boolean,
    val blockedChannels: Int,
) {
    val canDisplay: Boolean get() = (!permissionRequired || permissionGranted) && notificationsAllowed
}
