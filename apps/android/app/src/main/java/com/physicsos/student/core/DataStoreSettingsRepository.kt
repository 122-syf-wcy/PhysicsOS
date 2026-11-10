package com.physicsos.student.core

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import java.io.IOException
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

internal class DataStoreSettingsRepository(private val dataStore: DataStore<Preferences>) : SettingsRepository {
    private val preferences = dataStore.data.catch { error ->
        if (error is IOException) throw unavailable() else throw error
    }
    override val theme = preferences.map {
        val value = it[THEME] ?: "system"
        if (value !in THEMES) throw ApiException(0, "settings_invalid", "The stored theme preference is invalid.")
        value
    }.distinctUntilChanged()
    override val notificationsEnabled = preferences.map { it[NOTIFICATIONS] ?: false }.distinctUntilChanged()
    override val syncOnMeteredNetwork = preferences.map { it[METERED_SYNC] ?: false }.distinctUntilChanged()

    override suspend fun setTheme(value: String) {
        require(value in THEMES) { "Theme must be system, light or dark." }
        change { it[THEME] = value }
    }
    override suspend fun setNotificationsEnabled(value: Boolean) { change { it[NOTIFICATIONS] = value } }
    override suspend fun setSyncOnMeteredNetwork(value: Boolean) { change { it[METERED_SYNC] = value } }
    override suspend fun clear() { change { it.clear() } }

    private suspend fun change(action: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        try {
            dataStore.edit { action(it) }
        } catch (_: IOException) {
            throw unavailable()
        }
    }

    private fun unavailable() = ApiException(0, "settings_unavailable", "Preferences could not be read or saved. Check device storage.")

    private companion object {
        val THEMES = setOf("system", "light", "dark")
        val THEME = stringPreferencesKey("appearance.theme")
        val NOTIFICATIONS = booleanPreferencesKey("notifications.enabled")
        val METERED_SYNC = booleanPreferencesKey("sync.allow_metered")
    }
}
