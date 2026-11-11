package com.physicsos.student.feature.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.physicsos.student.R
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.ui.components.SectionCard
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Composable
internal fun AccountDevices(state: AccountUiState, model: AccountViewModel) {
    var revoke by remember { mutableStateOf<AccountDevice?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.account_devices_description))
        OutlinedButton(onClick = model::loadDevices, enabled = !state.busy, modifier = Modifier.testTag("account-refresh-devices")) {
            Text(stringResource(R.string.account_refresh))
        }
        if (state.devicesLoaded && state.devices.isEmpty()) Text(stringResource(R.string.account_devices_empty))
        state.devices.forEach { device ->
            SectionCard(device.name, modifier = Modifier.testTag("account-device-${accountInstanceKey(device.id)}")) {
                if (device.current) Text(stringResource(R.string.account_device_current))
                device.appVersion?.let { Text(stringResource(R.string.account_device_version, it)) }
                Text(stringResource(R.string.account_device_created, accountDate(device.createdAt)))
                Text(stringResource(R.string.account_device_seen, accountDate(device.lastSeenAt)))
                Text(stringResource(R.string.account_device_expires, accountDate(device.expiresAt)))
                if (device.revokedAt != null) Text(stringResource(R.string.account_device_revoked_at, accountDate(device.revokedAt)))
                else OutlinedButton(onClick = { revoke = device }, enabled = !state.busy) { Text(stringResource(R.string.account_revoke_device)) }
            }
        }
    }
    revoke?.let { device -> AccountConfirmDialog(
        stringResource(R.string.account_revoke_device),
        stringResource(if (device.current) R.string.account_revoke_current_confirmation else R.string.account_revoke_confirmation, device.name),
        onDismiss = { revoke = null }, onConfirm = { revoke = null; model.revokeDevice(device) },
    ) }
}

@Composable
internal fun AccountExport(state: AccountUiState, model: AccountViewModel) {
    var generate by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.account_export_description))
        Text(stringResource(R.string.account_export_limit), style = MaterialTheme.typography.bodySmall)
        Button(onClick = { generate = true }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("account-generate-export")) {
            Text(stringResource(R.string.account_generate_export))
        }
        state.exported?.takeIf { it.kind == AccountExportKind.ACCOUNT }?.let { ExportActions(it, state.busy, model) }
    }
    if (generate) AccountConfirmDialog(
        stringResource(R.string.account_export), stringResource(R.string.account_export_confirmation),
        onDismiss = { generate = false }, onConfirm = { generate = false; model.generateExport() },
    )
}

@Composable
internal fun AccountFeedback(state: AccountUiState, model: AccountViewModel) {
    val exportExplanation = stringResource(R.string.account_feedback_export_header)
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionCard(stringResource(R.string.account_feedback_dependency)) {
            Text(stringResource(R.string.account_feedback_unavailable), modifier = Modifier.testTag("account-feedback-unavailable"))
            Text(stringResource(R.string.account_feedback_screenshots), style = MaterialTheme.typography.bodySmall)
        }
        if (state.draft == null) {
            OutlinedButton(onClick = model::loadDraft, enabled = !state.busy) { Text(stringResource(R.string.account_load_draft)) }
        } else {
            OutlinedTextField(
                value = state.draft, onValueChange = model::editDraft, enabled = !state.busy,
                label = { Text(stringResource(R.string.account_feedback_text)) },
                supportingText = { Text(stringResource(R.string.account_feedback_hint, state.draft.length)) },
                minLines = 6, maxLines = 14, modifier = Modifier.fillMaxWidth().testTag("account-feedback-text"),
            )
            Text(stringResource(if (state.draftDirty) R.string.account_draft_unsaved else R.string.account_draft_local))
            Button(onClick = model::saveDraft, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("account-save-feedback")) {
                Text(stringResource(R.string.account_save_draft))
            }
            OutlinedButton(onClick = { model.exportFeedback(exportExplanation) }, enabled = !state.busy && state.draft.isNotBlank(),
                modifier = Modifier.fillMaxWidth().testTag("account-export-feedback")) { Text(stringResource(R.string.account_export_draft)) }
        }
        state.exported?.takeIf { it.kind == AccountExportKind.FEEDBACK }?.let { ExportActions(it, state.busy, model) }
    }
}

@Composable
private fun ExportActions(info: AccountExportInfo, busy: Boolean, model: AccountViewModel) {
    var share by remember(info.id) { mutableStateOf(false) }
    SectionCard(stringResource(R.string.account_export_file)) {
        Text(info.name)
        Text(stringResource(R.string.account_export_bytes, info.bytes))
        Text(stringResource(R.string.account_export_private), style = MaterialTheme.typography.bodySmall)
        Button(onClick = model::requestSaveExport, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("account-save-export")) {
            Text(stringResource(R.string.account_save_file))
        }
        OutlinedButton(onClick = { share = true }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("account-share-export")) {
            Text(stringResource(R.string.account_share_file))
        }
    }
    if (share) AccountConfirmDialog(
        stringResource(R.string.account_share_file), stringResource(R.string.account_share_confirmation),
        onDismiss = { share = false }, onConfirm = { share = false; model.shareExport() },
    )
}

@Composable
internal fun AccountSync(state: AccountUiState, model: AccountViewModel) {
    var discard by remember { mutableStateOf<OutboxItem?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.account_sync_description))
        Text(stringResource(R.string.account_sync_conflict_hint), style = MaterialTheme.typography.bodySmall)
        Button(onClick = model::syncNow, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("account-sync-now")) {
            Text(stringResource(R.string.account_sync_now))
        }
        if (!state.syncLoaded) Text(stringResource(R.string.account_sync_loading))
        else if (state.operations.isEmpty()) Text(stringResource(R.string.account_sync_empty))
        val shown = state.operations.sortedByDescending { it.updatedAt }.take(50)
        if (state.operations.size > shown.size) Text(stringResource(R.string.account_sync_showing, shown.size, state.operations.size))
        shown.forEach { item ->
            SectionCard(stringResource(accountOperationLabel(item.path)), Modifier.testTag("account-sync-${item.id}")) {
                Text(stringResource(accountSyncState(item.state)), modifier = Modifier.testTag("account-sync-state-${item.state.name.lowercase(Locale.ROOT)}"))
                Text(stringResource(R.string.account_sync_attempts, item.attempts))
                Text(stringResource(R.string.account_sync_updated, accountDate(Instant.ofEpochMilli(item.updatedAt))))
                if (item.errorStatus != null || item.errorCode != null) {
                    AccountProblemText(accountProblem(item.error ?: com.physicsos.student.core.ApiException(item.errorStatus ?: 0, "sync_failed", "")))
                }
                if (item.state == OutboxState.CONFLICT) Text(stringResource(R.string.account_sync_conflict_hint))
                if (canRetryAccountSync(item.state)) OutlinedButton(onClick = { model.retrySync(item) }, enabled = !state.busy) {
                    Text(stringResource(R.string.account_retry_sync))
                }
                if (item.state != OutboxState.RUNNING) TextButton(onClick = { discard = item }, enabled = !state.busy) {
                    Text(stringResource(if (item.state == OutboxState.ACKNOWLEDGED) R.string.account_remove_receipt else R.string.account_discard_sync))
                }
            }
        }
    }
    discard?.let { item -> AccountConfirmDialog(
        stringResource(if (item.state == OutboxState.ACKNOWLEDGED) R.string.account_remove_receipt else R.string.account_discard_sync),
        stringResource(if (item.state == OutboxState.ACKNOWLEDGED) R.string.account_remove_receipt_confirmation else R.string.account_discard_sync_confirmation),
        onDismiss = { discard = null }, onConfirm = { discard = null; model.discardSync(item) },
    ) }
}

@Composable
internal fun AccountSettings(state: AccountUiState, model: AccountViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.account_device_scope))
        if (state.theme == null || state.metered == null) {
            OutlinedButton(onClick = model::loadSettings, enabled = !state.busy) { Text(stringResource(R.string.account_reload_settings)) }
        } else {
            SectionCard(stringResource(R.string.account_theme)) {
                listOf("system" to R.string.account_theme_system, "light" to R.string.account_theme_light, "dark" to R.string.account_theme_dark).forEach { (value, label) ->
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = state.theme == value, enabled = !state.busy, role = Role.RadioButton,
                            onClick = { model.setTheme(value) }).padding(vertical = 8.dp).testTag("account-theme-$value"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = state.theme == value, onClick = null, enabled = !state.busy)
                        Text(stringResource(label), Modifier.padding(start = 12.dp))
                    }
                }
                Text(stringResource(R.string.account_system_font), style = MaterialTheme.typography.bodySmall)
            }
            SectionCard(stringResource(R.string.account_network)) {
                Row(
                    Modifier.fillMaxWidth().toggleable(value = state.metered, enabled = !state.busy, role = Role.Switch,
                        onValueChange = model::setMetered).testTag("account-metered"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(stringResource(R.string.account_metered_sync), Modifier.weight(1f))
                    Switch(checked = state.metered, onCheckedChange = null, enabled = !state.busy)
                }
                Text(stringResource(R.string.account_metered_hint), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

internal fun accountDate(instant: Instant): String = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
    .withLocale(Locale.getDefault()).withZone(ZoneId.systemDefault()).format(instant)

private fun accountOperationLabel(path: String): Int = when {
    path.startsWith("learning/scenes") -> R.string.account_operation_scene
    path.startsWith("learning/attempts") -> R.string.account_operation_attempt
    path.startsWith("classes/") -> R.string.account_operation_assignment
    path.startsWith("notices/") -> R.string.account_operation_notice
    else -> R.string.account_operation_other
}
private fun accountSyncState(state: OutboxState): Int = when (state) {
    OutboxState.PENDING -> R.string.account_sync_pending
    OutboxState.RUNNING -> R.string.account_sync_running
    OutboxState.RETRY -> R.string.account_sync_retry
    OutboxState.ACKNOWLEDGED -> R.string.account_sync_acknowledged
    OutboxState.CONFLICT -> R.string.account_sync_conflict
    OutboxState.FAILED -> R.string.account_sync_failed
    OutboxState.AUTH_REQUIRED -> R.string.account_sync_auth_required
}
