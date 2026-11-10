package com.physicsos.student.feature.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.feature.home.LearningEmpty
import com.physicsos.student.feature.home.LearningError
import com.physicsos.student.feature.home.LearningHeader
import com.physicsos.student.feature.home.LearningLoading
import com.physicsos.student.feature.home.LearningNotice
import com.physicsos.student.feature.home.LearningViewModelFactory
import com.physicsos.student.feature.home.displayDate

@Composable
fun AuthScreen(
    graph: AppGraph,
    onAuthenticated: () -> Unit,
    onOpenPolicy: (policy: String) -> Unit,
    initialMode: AuthMode = AuthMode.LOGIN,
    resetToken: String? = null,
) {
    val factory = remember(graph, initialMode, resetToken) { LearningViewModelFactory { AuthViewModel(graph, initialMode, resetToken) } }
    val model: AuthViewModel = viewModel(key = "learning-auth-${initialMode.name}", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    val auth by graph.auth.state.collectAsStateWithLifecycle()
    LaunchedEffect(auth) { if (auth is AuthState.SignedIn) onAuthenticated() }
    BackHandler(state.mode != AuthMode.LOGIN || state.step != AuthStep.FORM) { model.changeMode(AuthMode.LOGIN) }
    AuthContent(
        state, model::edit, model::changeMode, model::submit, model::cancel,
        model::acceptTerms, model::unlistedSchool, model::showSchools, onOpenPolicy,
    )
    if (state.schoolPickerOpen) SchoolPicker(
        state, model::searchSchools, model::selectSchool,
        onRetry = { model.loadSchools() }, onDismiss = { model.showSchools(false) },
    )
}

@Composable
internal fun AuthContent(
    state: AuthUiState,
    onEdit: (AuthField, String) -> Unit,
    onMode: (AuthMode) -> Unit,
    onSubmit: () -> Unit,
    onCancel: () -> Unit,
    onTerms: (Boolean) -> Unit,
    onUnlistedSchool: (Boolean) -> Unit,
    onSchools: (Boolean) -> Unit,
    onOpenPolicy: (String) -> Unit,
) {
    val title = stringResource(when {
        state.step == AuthStep.CHALLENGE -> R.string.learning_auth_challenge_title
        state.step == AuthStep.PENDING -> R.string.learning_auth_pending_title
        state.mode == AuthMode.REGISTER -> R.string.learning_auth_register_title
        state.mode == AuthMode.FORGOT || state.mode == AuthMode.RESET -> R.string.learning_auth_recovery_title
        else -> R.string.learning_auth_login_title
    })
    Column(Modifier.fillMaxSize().testTag("auth")) {
        LearningHeader(title, if (state.mode != AuthMode.LOGIN || state.step != AuthStep.FORM) ({ onMode(AuthMode.LOGIN) }) else null)
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.learning_auth_welcome), style = MaterialTheme.typography.headlineMedium)
            Text(stringResource(R.string.learning_auth_account_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            when (state.step) {
                AuthStep.PENDING -> {
                    LearningNotice(stringResource(R.string.learning_auth_pending_message, state.pendingSchool, state.pendingEmail))
                    Button(onClick = { onMode(AuthMode.LOGIN) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_auth_back_login)) }
                }
                AuthStep.RESET_REQUESTED -> {
                    LearningNotice(stringResource(R.string.learning_auth_reset_requested))
                    Button(onClick = { onMode(AuthMode.RESET) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_auth_have_reset_token)) }
                    TextButton(onClick = { onMode(AuthMode.LOGIN) }) { Text(stringResource(R.string.learning_auth_back_login)) }
                }
                AuthStep.RESET_FINISHED -> {
                    LearningNotice(stringResource(R.string.learning_auth_reset_finished))
                    Button(onClick = { onMode(AuthMode.LOGIN) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_auth_back_login)) }
                }
                AuthStep.CHALLENGE -> {
                    Text(stringResource(R.string.learning_auth_challenge_description))
                    state.challengeExpiresAt?.let { Text(stringResource(R.string.learning_auth_challenge_expiry, displayDate(it)), style = MaterialTheme.typography.bodySmall) }
                    AuthTextField(state, AuthField.CODE, state.fields.code, R.string.learning_auth_code, onEdit, keyboardType = KeyboardType.Ascii)
                    LearningError(state.problem, onSubmit)
                    Button(onClick = onSubmit, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("auth-verify")) { Text(stringResource(R.string.learning_auth_verify)) }
                    if (state.busy) {
                        LearningLoading()
                        TextButton(onClick = onCancel) { Text(stringResource(R.string.learning_cancel)) }
                    }
                    TextButton(onClick = { onMode(AuthMode.LOGIN) }) { Text(stringResource(R.string.learning_auth_restart_login)) }
                }
                AuthStep.FORM -> {
                    if (state.mode != AuthMode.RESET) {
                        AuthTextField(state, AuthField.USERNAME, state.fields.username, R.string.learning_auth_username, onEdit, keyboardType = KeyboardType.Ascii)
                    }
                    if (state.mode == AuthMode.REGISTER) {
                        AuthTextField(state, AuthField.DISPLAY_NAME, state.fields.displayName, R.string.learning_auth_display_name, onEdit)
                        AuthTextField(state, AuthField.EMAIL, state.fields.email, R.string.learning_auth_email, onEdit, keyboardType = KeyboardType.Email)
                    }
                    if (state.mode != AuthMode.RESET) {
                        if (!state.fields.unlistedSchool || state.mode != AuthMode.REGISTER) {
                            OutlinedButton(onClick = { onSchools(true) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("auth-school")) {
                                Text(state.fields.schoolLabel.ifBlank { stringResource(if (state.mode == AuthMode.REGISTER) R.string.learning_auth_school_select else R.string.learning_auth_school_optional) })
                            }
                        }
                        if (state.mode == AuthMode.REGISTER) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = state.fields.unlistedSchool, onCheckedChange = onUnlistedSchool, enabled = !state.busy, modifier = Modifier.testTag("auth-unlisted-school"))
                                Text(stringResource(R.string.learning_auth_school_unlisted))
                            }
                            if (state.fields.unlistedSchool) {
                                AuthTextField(state, AuthField.SCHOOL_NAME, state.fields.schoolName, R.string.learning_auth_school_name, onEdit)
                                Text(stringResource(R.string.learning_auth_school_review_hint), style = MaterialTheme.typography.bodySmall)
                            } else state.fieldErrors[AuthField.SCHOOL_NAME]?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
                        }
                    }
                    if (state.mode == AuthMode.RESET) {
                        AuthTextField(state, AuthField.TOKEN, state.fields.token, R.string.learning_auth_reset_token, onEdit, secret = true)
                    }
                    if (state.mode != AuthMode.FORGOT) {
                        AuthTextField(state, AuthField.PASSWORD, state.fields.password, if (state.mode == AuthMode.RESET) R.string.learning_auth_new_password else R.string.learning_auth_password, onEdit, secret = true)
                    }
                    if (state.mode == AuthMode.REGISTER || state.mode == AuthMode.RESET) {
                        AuthTextField(state, AuthField.CONFIRM_PASSWORD, state.fields.confirmPassword, R.string.learning_auth_confirm_password, onEdit, secret = true)
                    }
                    if (state.mode == AuthMode.REGISTER) {
                        AuthTextField(state, AuthField.INVITE, state.fields.invite, R.string.learning_auth_invite, onEdit, keyboardType = KeyboardType.Ascii)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = state.fields.acceptedTerms, onCheckedChange = onTerms, enabled = !state.busy, modifier = Modifier.testTag("auth-terms"))
                            Text(stringResource(R.string.learning_auth_terms_accept), Modifier.weight(1f))
                        }
                        state.fieldErrors[AuthField.TERMS]?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { onOpenPolicy("terms") }) { Text(stringResource(R.string.learning_terms)) }
                            TextButton(onClick = { onOpenPolicy("privacy") }) { Text(stringResource(R.string.learning_privacy_policy)) }
                        }
                    }
                    if (state.mode == AuthMode.FORGOT) Text(stringResource(R.string.learning_auth_recovery_private), style = MaterialTheme.typography.bodyMedium)
                    LearningError(state.problem, onSubmit)
                    Button(onClick = onSubmit, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("auth-submit")) {
                        Text(stringResource(when (state.mode) {
                            AuthMode.LOGIN -> R.string.learning_auth_login
                            AuthMode.REGISTER -> R.string.learning_auth_register
                            AuthMode.FORGOT -> R.string.learning_auth_request_reset
                            AuthMode.RESET -> R.string.learning_auth_reset_password
                        }))
                    }
                    if (state.busy) {
                        LearningLoading()
                        TextButton(onClick = onCancel, modifier = Modifier.testTag("auth-cancel")) { Text(stringResource(R.string.learning_cancel)) }
                    }
                    if (state.mode == AuthMode.LOGIN) {
                        TextButton(onClick = { onMode(AuthMode.REGISTER) }, enabled = !state.busy, modifier = Modifier.testTag("auth-register")) { Text(stringResource(R.string.learning_auth_create_account)) }
                        TextButton(onClick = { onMode(AuthMode.FORGOT) }, enabled = !state.busy, modifier = Modifier.testTag("auth-forgot")) { Text(stringResource(R.string.learning_auth_forgot)) }
                    } else {
                        TextButton(onClick = { onMode(AuthMode.LOGIN) }, enabled = !state.busy) { Text(stringResource(R.string.learning_auth_back_login)) }
                        if (state.mode == AuthMode.FORGOT) TextButton(onClick = { onMode(AuthMode.RESET) }, enabled = !state.busy) { Text(stringResource(R.string.learning_auth_have_reset_token)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun AuthTextField(
    state: AuthUiState,
    field: AuthField,
    value: String,
    label: Int,
    onEdit: (AuthField, String) -> Unit,
    secret: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    var visible by rememberSaveable(field) { mutableStateOf(false) }
    val error = state.fieldErrors[field]
    OutlinedTextField(
        value = value, onValueChange = { onEdit(field, it) }, enabled = !state.busy,
        label = { Text(stringResource(label)) }, singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("auth-${field.name.lowercase()}"),
        visualTransformation = if (secret && !visible) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = !secret && keyboardType == KeyboardType.Text, keyboardType = if (secret) KeyboardType.Password else keyboardType),
        isError = error != null,
        supportingText = if (error == null) null else ({ Text(stringResource(error)) }),
        trailingIcon = if (!secret) null else ({
            TextButton(onClick = { visible = !visible }) { Text(stringResource(if (visible) R.string.learning_hide else R.string.learning_show)) }
        }),
    )
}

@Composable
private fun SchoolPicker(
    state: AuthUiState,
    onQuery: (String) -> Unit,
    onSelect: (SchoolChoice?) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.learning_auth_school_select), style = MaterialTheme.typography.titleLarge)
                OutlinedTextField(value = state.schoolQuery, onValueChange = onQuery, label = { Text(stringResource(R.string.learning_auth_school_search)) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("auth-school-query"))
                if (state.mode != AuthMode.REGISTER) TextButton(onClick = { onSelect(null) }) { Text(stringResource(R.string.learning_auth_school_auto)) }
                LearningError(state.schoolProblem, onRetry)
                if (state.schoolsLoading) LearningLoading()
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 340.dp)) {
                    items(state.schools, key = { it.id }) { school ->
                        TextButton(onClick = { onSelect(school) }, modifier = Modifier.fillMaxWidth().testTag("auth-school-${school.id}")) {
                            Column(Modifier.fillMaxWidth()) {
                                Text(school.name, style = MaterialTheme.typography.titleSmall)
                                if (school.location.isNotBlank()) Text(school.location, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    if (!state.schoolsLoading && state.schools.isEmpty()) item {
                        LearningEmpty(stringResource(R.string.learning_auth_school_empty), stringResource(if (state.schoolQuery.isBlank()) R.string.learning_auth_school_search_hint else R.string.learning_auth_school_empty_hint))
                    }
                }
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text(stringResource(R.string.learning_close)) }
            }
        }
    }
}
