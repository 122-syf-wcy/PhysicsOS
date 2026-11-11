package com.physicsos.student.feature.notifications

import android.Manifest
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.ui.components.SectionCard

@Composable
fun NotificationSettingsScreen(graph: AppGraph, onBack: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val factory = remember(graph) {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = NotificationPreferences(graph.settings) as T
        }
    }
    val model: NotificationPreferences = viewModel(key = "device-notification-preferences", factory = factory)
    val preference by model.state.collectAsStateWithLifecycle()
    var system by remember(context) { mutableStateOf(readNotificationSystem(context)) }
    var systemFailure by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        system = readNotificationSystem(context)
    }
    DisposableEffect(lifecycle, context) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) system = readNotificationSystem(context)
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    BackHandler { onBack() }
    NotificationSettingsContent(
        preference, system, systemFailure, model::setEnabled, model::reload,
        onRequestPermission = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                try { permission.launch(Manifest.permission.POST_NOTIFICATIONS) }
                catch (_: ActivityNotFoundException) { systemFailure = true }
                catch (_: SecurityException) { systemFailure = true }
            }
        },
        onOpenSystem = {
            try {
                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                })
                systemFailure = false
            } catch (_: ActivityNotFoundException) { systemFailure = true }
            catch (_: SecurityException) { systemFailure = true }
        },
        onBack = onBack,
    )
}

@Composable
internal fun NotificationSettingsContent(
    preference: NotificationPreferenceState,
    system: NotificationSystemState,
    systemFailure: Boolean,
    onPreference: (Boolean) -> Unit,
    onRetry: () -> Unit,
    onRequestPermission: () -> Unit,
    onOpenSystem: () -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize().testTag("notifications")) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text(stringResource(R.string.notifications_back)) }
            Text(stringResource(R.string.notifications_title), style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(start = 8.dp).semantics { heading() })
        }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SectionCard(stringResource(R.string.notifications_preference_title)) {
                Text(stringResource(R.string.notifications_device_scope))
                val enabled = preference.enabled
                if (enabled == null) {
                    Text(stringResource(if (preference.failed) R.string.notifications_read_failed else R.string.notifications_loading))
                } else Row(
                    Modifier.fillMaxWidth().toggleable(value = enabled, enabled = !preference.busy, role = Role.Switch,
                        onValueChange = onPreference).testTag("notifications-preference"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(stringResource(R.string.notifications_preference_label), Modifier.weight(1f))
                    Switch(checked = enabled, onCheckedChange = null, enabled = !preference.busy)
                }
                Text(stringResource(R.string.notifications_preference_explanation), style = MaterialTheme.typography.bodySmall)
                if (preference.failed) {
                    Text(stringResource(R.string.notifications_save_failed), color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("notifications-error"))
                    OutlinedButton(onClick = onRetry) { Text(stringResource(R.string.notifications_retry)) }
                }
            }
            SectionCard(stringResource(R.string.notifications_permission_title)) {
                Text(stringResource(when {
                    !system.permissionRequired -> R.string.notifications_permission_not_required
                    system.permissionGranted -> R.string.notifications_permission_granted
                    else -> R.string.notifications_permission_not_granted
                }), modifier = Modifier.testTag("notifications-permission-status"))
                Text(stringResource(if (system.notificationsAllowed) R.string.notifications_system_allowed else R.string.notifications_system_blocked))
                if (system.blockedChannels > 0) Text(stringResource(R.string.notifications_channels_blocked, system.blockedChannels))
                Text(stringResource(R.string.notifications_permission_explanation), style = MaterialTheme.typography.bodySmall)
                if (system.permissionRequired && !system.permissionGranted) {
                    Button(onClick = onRequestPermission, modifier = Modifier.fillMaxWidth().testTag("notifications-request-permission")) {
                        Text(stringResource(R.string.notifications_request_permission))
                    }
                }
                OutlinedButton(onClick = onOpenSystem, modifier = Modifier.fillMaxWidth().testTag("notifications-open-system")) {
                    Text(stringResource(R.string.notifications_open_system))
                }
                if (systemFailure) Text(stringResource(R.string.notifications_system_unavailable), color = MaterialTheme.colorScheme.error)
            }
            SectionCard(stringResource(R.string.notifications_push_title)) {
                Text(stringResource(R.string.notifications_push_disabled), modifier = Modifier.testTag("notifications-push-disabled"))
                Text(stringResource(R.string.notifications_push_dependency), style = MaterialTheme.typography.bodySmall)
                Text(stringResource(R.string.notifications_manual_notices), style = MaterialTheme.typography.bodyMedium)
            }
            Text(stringResource(R.string.notifications_no_delivery_promise), style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun readNotificationSystem(context: Context): NotificationSystemState {
    val required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val granted = !required || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val manager = context.getSystemService(NotificationManager::class.java)
    val groups = manager?.notificationChannelGroups.orEmpty().associateBy { it.id }
    val blocked = manager?.notificationChannels.orEmpty().count { channel ->
        channel.importance == NotificationManager.IMPORTANCE_NONE || channel.group?.let { groups[it]?.isBlocked } == true
    }
    return NotificationSystemState(required, granted, NotificationManagerCompat.from(context).areNotificationsEnabled(), blocked)
}
