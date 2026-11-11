package com.physicsos.student.feature.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.physicsos.student.R

@Composable
internal fun ProfileForm(state: AccountUiState, model: AccountViewModel) {
    var name by remember(state.user.userId, state.user.displayName) { mutableStateOf(state.user.displayName) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.account_profile_description))
        Text(stringResource(R.string.account_username_value, state.user.username))
        Text(stringResource(R.string.account_school_value, state.user.schoolId))
        OutlinedTextField(
            value = name, onValueChange = { if (it.length <= 32) name = it },
            label = { Text(stringResource(R.string.account_display_name)) },
            supportingText = { Text(stringResource(R.string.account_name_hint)) },
            enabled = !state.busy, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("account-display-name"),
        )
        Button(onClick = { model.updateProfile(name) }, enabled = !state.busy && name.trim() != state.user.displayName,
            modifier = Modifier.fillMaxWidth().testTag("account-save-profile")) { Text(stringResource(R.string.account_save)) }
    }
}

@Composable
internal fun PasswordForm(busy: Boolean, onChange: (String, String, String, String) -> Unit) {
    // Never rememberSaveable: passwords and second-factor proofs must not enter saved instance state.
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var repeat by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<AccountProblem?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.account_password_description))
        AccountSecretField(current, { current = it }, R.string.account_current_password, "account-current-password", !busy)
        AccountSecretField(new, { new = it }, R.string.account_new_password, "account-new-password", !busy)
        AccountSecretField(repeat, { repeat = it }, R.string.account_repeat_password, "account-repeat-password", !busy)
        AccountSecretField(code, { code = it }, R.string.account_optional_code, "account-password-code", !busy, maxLength = 64)
        Text(stringResource(R.string.account_code_hint), style = MaterialTheme.typography.bodySmall)
        problem?.let { AccountProblemText(it) }
        Button(onClick = {
            try { validatePasswordChange(current, new, repeat, code); problem = null; confirm = true }
            catch (error: AccountFailure) { problem = error.problem }
        }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("account-change-password")) {
            Text(stringResource(R.string.account_password))
        }
    }
    if (confirm) AccountConfirmDialog(
        stringResource(R.string.account_password), stringResource(R.string.account_password_confirmation),
        onDismiss = { confirm = false }, onConfirm = {
            confirm = false
            onChange(current, new, repeat, code)
            current = ""; new = ""; repeat = ""; code = ""
        },
    )
}

@Composable
internal fun DeleteAccountForm(busy: Boolean, onDelete: (String, String, String) -> Unit) {
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var understood by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.account_delete_description), color = MaterialTheme.colorScheme.error)
        Text(stringResource(R.string.account_delete_export_first))
        AccountSecretField(password, { password = it }, R.string.account_current_password, "account-delete-password", !busy)
        AccountSecretField(code, { code = it }, R.string.account_optional_code, "account-delete-code", !busy, maxLength = 64)
        OutlinedTextField(
            value = confirmation, onValueChange = { if (it.length <= 32) confirmation = it },
            label = { Text(stringResource(R.string.account_type_delete)) }, enabled = !busy, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
            modifier = Modifier.fillMaxWidth().testTag("account-delete-confirmation"),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = understood, onCheckedChange = { understood = it }, enabled = !busy, modifier = Modifier.testTag("account-delete-understood"))
            Text(stringResource(R.string.account_delete_understood), Modifier.weight(1f))
        }
        Button(onClick = { confirm = true }, enabled = !busy && understood && confirmation == "DELETE" && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().testTag("account-delete-submit")) { Text(stringResource(R.string.account_delete)) }
    }
    if (confirm) AccountConfirmDialog(
        stringResource(R.string.account_delete), stringResource(R.string.account_delete_confirmation),
        onDismiss = { confirm = false }, onConfirm = {
            confirm = false
            onDelete(password, confirmation, code)
            password = ""; code = ""; confirmation = ""; understood = false
        },
    )
}

@Composable
internal fun AccountSecretField(
    value: String, edit: (String) -> Unit, label: Int, tag: String, enabled: Boolean, maxLength: Int = 128,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value, onValueChange = { if (it.length <= maxLength) edit(it) },
        label = { Text(stringResource(label)) }, singleLine = true, enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            TextButton(onClick = { visible = !visible }) {
                Text(stringResource(if (visible) R.string.account_hide_secret else R.string.account_show_secret))
            }
        }, modifier = Modifier.fillMaxWidth().testTag(tag),
    )
}

@Composable
internal fun AccountConfirmDialog(title: String, message: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message, Modifier.verticalScroll(rememberScrollState())) },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag("account-confirm-action")) { Text(stringResource(R.string.account_confirm)) }
        },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("account-cancel-action")) { Text(stringResource(R.string.account_cancel)) } },
        modifier = Modifier.testTag("account-confirm-dialog"),
    )
}
