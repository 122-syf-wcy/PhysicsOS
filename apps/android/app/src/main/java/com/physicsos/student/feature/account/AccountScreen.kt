package com.physicsos.student.feature.account

import android.content.ActivityNotFoundException
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.MobileUser
import com.physicsos.student.feature.files.shareIntent
import com.physicsos.student.feature.notifications.NotificationSettingsScreen
import com.physicsos.student.ui.components.LoadingState
import com.physicsos.student.ui.components.SectionCard

@Composable
fun AccountScreen(
    graph: AppGraph,
    onSignedOut: () -> Unit,
    onOpenPolicy: (String) -> Unit,
    onBack: () -> Unit,
) {
    val auth by graph.auth.state.collectAsStateWithLifecycle()
    when (val current = auth) {
        AuthState.Restoring -> LoadingState()
        AuthState.SignedOut -> {
            LaunchedEffect(Unit) { onSignedOut() }
            Text(stringResource(R.string.account_auth_required), Modifier.padding(24.dp))
        }
        is AuthState.SignedIn -> key(current.user.userId) {
            SignedInAccount(graph, current.user, onOpenPolicy, onBack)
        }
    }
}

@Composable
private fun SignedInAccount(graph: AppGraph, identity: MobileUser, onOpenPolicy: (String) -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
    val factory = remember(graph, identity.userId) {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                AccountViewModel(context.applicationContext, graph, identity) as T
        }
    }
    val model: AccountViewModel = viewModel(key = "account-${identity.userId}", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    var pendingExport by rememberSaveable(identity.userId) { mutableStateOf<String?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val id = pendingExport
        pendingExport = null
        if (uri != null && id != null && model.isCurrent()) model.saveExport(id, uri)
    }
    val shareTitle = stringResource(R.string.account_share_chooser)
    LaunchedEffect(model, shareTitle) {
        model.effects.collect { effect ->
            if (!model.isCurrent()) return@collect
            when (effect) {
                is AccountEffect.CreateDocument -> {
                    pendingExport = effect.info.id
                    try { save.launch(effect.info.name) }
                    catch (_: ActivityNotFoundException) { pendingExport = null; model.shareUnavailable() }
                    catch (_: SecurityException) { pendingExport = null; model.shareUnavailable() }
                }
                is AccountEffect.Share -> try { context.startActivity(effect.file.shareIntent(shareTitle)) }
                    catch (_: ActivityNotFoundException) { model.shareUnavailable() }
                    catch (_: SecurityException) { model.shareUnavailable() }
            }
        }
    }
    BackHandler(state.page != AccountPage.OVERVIEW || state.busy) {
        if (!state.busy) model.open(AccountPage.OVERVIEW)
    }
    if (state.page == AccountPage.NOTIFICATIONS) {
        NotificationSettingsScreen(graph, onBack = { model.open(AccountPage.OVERVIEW) })
        return
    }
    Column(Modifier.fillMaxSize().testTag("account")) {
        AccountHeader(accountPageTitle(state.page), enabled = !state.busy) {
            if (state.page == AccountPage.OVERVIEW) onBack() else model.open(AccountPage.OVERVIEW)
        }
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("account-busy"))
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        ) {
            if (state.problem != null || state.notice != null) item {
                Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                    state.problem?.let { AccountProblemText(it) }
                    state.notice?.let { Text(stringResource(accountNoticeResource(it)), Modifier.testTag("account-notice")) }
                    TextButton(onClick = model::clearMessage) { Text(stringResource(R.string.account_dismiss)) }
                }
            }
            item {
                when (state.page) {
                    AccountPage.OVERVIEW -> AccountOverview(state, model, onOpenPolicy)
                    AccountPage.PROFILE -> ProfileForm(state, model)
                    AccountPage.PASSWORD -> PasswordForm(state.busy, model::changePassword)
                    AccountPage.DEVICES -> AccountDevices(state, model)
                    AccountPage.EXPORT -> AccountExport(state, model)
                    AccountPage.FEEDBACK -> AccountFeedback(state, model)
                    AccountPage.SYNC -> AccountSync(state, model)
                    AccountPage.SETTINGS -> AccountSettings(state, model)
                    AccountPage.DELETE -> DeleteAccountForm(state.busy, model::deleteAccount)
                    AccountPage.NOTIFICATIONS -> Unit
                }
            }
        }
    }
}

@Composable
internal fun AccountHeader(title: String, enabled: Boolean = true, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack, enabled = enabled, modifier = Modifier.testTag("account-back")) {
            Text(stringResource(R.string.account_back))
        }
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(8.dp).semantics { heading() })
    }
}

@Composable
private fun AccountOverview(state: AccountUiState, model: AccountViewModel, onOpenPolicy: (String) -> Unit) {
    var confirmLogout by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionCard(stringResource(R.string.account_identity)) {
            Text(state.user.displayName, style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.account_username_value, state.user.username))
            Text(stringResource(R.string.account_school_value, state.user.schoolId))
            Text(stringResource(R.string.account_role_value, accountRole(state.user.role)))
            TextButton(onClick = model::refreshProfile, enabled = !state.busy, modifier = Modifier.testTag("account-refresh")) {
                Text(stringResource(R.string.account_refresh))
            }
        }
        SectionCard(stringResource(R.string.account_security)) {
            AccountLink(R.string.account_profile, "account-profile", !state.busy) { model.open(AccountPage.PROFILE) }
            AccountLink(R.string.account_password, "account-password", !state.busy) { model.open(AccountPage.PASSWORD) }
            AccountLink(R.string.account_devices, "account-devices", !state.busy) { model.open(AccountPage.DEVICES) }
        }
        SectionCard(stringResource(R.string.account_data)) {
            AccountLink(R.string.account_sync, "account-sync", !state.busy) { model.open(AccountPage.SYNC) }
            AccountLink(R.string.account_export, "account-export", !state.busy) { model.open(AccountPage.EXPORT) }
            AccountLink(R.string.account_feedback, "account-feedback", !state.busy) { model.open(AccountPage.FEEDBACK) }
        }
        SectionCard(stringResource(R.string.account_device_settings)) {
            Text(stringResource(R.string.account_device_scope), style = MaterialTheme.typography.bodySmall)
            AccountLink(R.string.account_notifications, "account-notifications", !state.busy) { model.open(AccountPage.NOTIFICATIONS) }
            AccountLink(R.string.account_appearance_sync, "account-settings", !state.busy) { model.open(AccountPage.SETTINGS) }
        }
        SectionCard(stringResource(R.string.account_legal)) {
            AccountLink(R.string.account_privacy, "account-privacy", !state.busy) { onOpenPolicy("privacy") }
            AccountLink(R.string.account_terms, "account-terms", !state.busy) { onOpenPolicy("terms") }
            AccountLink(R.string.account_sdks, "account-sdks", !state.busy) { onOpenPolicy("sdks") }
        }
        OutlinedButton(onClick = { confirmLogout = true }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("account-logout")) {
            Text(stringResource(R.string.account_logout))
        }
        TextButton(onClick = { model.open(AccountPage.DELETE) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("account-delete")) {
            Text(stringResource(R.string.account_delete), color = MaterialTheme.colorScheme.error)
        }
    }
    if (confirmLogout) AccountConfirmDialog(
        stringResource(R.string.account_logout), stringResource(R.string.account_logout_confirmation),
        onDismiss = { confirmLogout = false }, onConfirm = { confirmLogout = false; model.logout() },
    )
}

@Composable
internal fun AccountLink(label: Int, tag: String, enabled: Boolean = true, action: () -> Unit) {
    OutlinedButton(onClick = action, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag(tag)) { Text(stringResource(label)) }
}

@Composable
internal fun AccountProblemText(problem: AccountProblem) {
    Text(stringResource(when (problem) {
        AccountProblem.AUTH -> R.string.account_error_auth
        AccountProblem.ACCOUNT_CHANGED -> R.string.account_error_account_changed
        AccountProblem.NETWORK -> R.string.account_error_network
        AccountProblem.SERVICE_UNAVAILABLE -> R.string.account_error_service
        AccountProblem.FORBIDDEN -> R.string.account_error_forbidden
        AccountProblem.INVALID_PROOF -> R.string.account_error_proof
        AccountProblem.TWO_FACTOR -> R.string.account_error_two_factor
        AccountProblem.RATE_LIMIT -> R.string.account_error_rate_limit
        AccountProblem.INVALID_NAME -> R.string.account_error_name
        AccountProblem.INVALID_PASSWORD -> R.string.account_error_password
        AccountProblem.PASSWORD_MISMATCH -> R.string.account_error_password_match
        AccountProblem.INVALID_CODE -> R.string.account_error_code
        AccountProblem.DELETE_CONFIRMATION -> R.string.account_error_confirmation
        AccountProblem.INVALID_RESPONSE -> R.string.account_error_response
        AccountProblem.STORAGE -> R.string.account_error_storage
        AccountProblem.EXPORT_TOO_LARGE -> R.string.account_error_export_large
        AccountProblem.UNSAFE_EXPORT -> R.string.account_error_unsafe_export
        AccountProblem.FILE_UNAVAILABLE -> R.string.account_error_file
        AccountProblem.SHARE_UNAVAILABLE -> R.string.account_error_share
        AccountProblem.INVALID_FEEDBACK -> R.string.account_error_feedback
        AccountProblem.CONFLICT -> R.string.account_error_conflict
        AccountProblem.FAILED -> R.string.account_error_failed
    }), color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("account-error"))
}

@Composable
private fun accountPageTitle(page: AccountPage): String = stringResource(when (page) {
    AccountPage.OVERVIEW -> R.string.account_title
    AccountPage.PROFILE -> R.string.account_profile
    AccountPage.PASSWORD -> R.string.account_password
    AccountPage.DEVICES -> R.string.account_devices
    AccountPage.EXPORT -> R.string.account_export
    AccountPage.FEEDBACK -> R.string.account_feedback
    AccountPage.SYNC -> R.string.account_sync
    AccountPage.SETTINGS -> R.string.account_appearance_sync
    AccountPage.NOTIFICATIONS -> R.string.account_notifications
    AccountPage.DELETE -> R.string.account_delete
})

@Composable
private fun accountRole(role: String): String = stringResource(when (role) {
    "STUDENT" -> R.string.account_role_student
    "TEACHER" -> R.string.account_role_teacher
    "SCHOOL_ADMIN" -> R.string.account_role_school_admin
    "SUPER_ADMIN" -> R.string.account_role_admin
    else -> R.string.account_role_unknown
})

private fun accountNoticeResource(notice: AccountNotice): Int = when (notice) {
    AccountNotice.PROFILE_SAVED -> R.string.account_profile_saved
    AccountNotice.PASSWORD_CHANGED -> R.string.account_password_changed
    AccountNotice.DEVICE_REVOKED -> R.string.account_device_revoked
    AccountNotice.DRAFT_SAVED -> R.string.account_draft_saved
    AccountNotice.EXPORT_READY -> R.string.account_export_ready
    AccountNotice.EXPORTED -> R.string.account_export_saved
    AccountNotice.SYNC_CHECKED -> R.string.account_sync_checked
    AccountNotice.RECEIPT_REMOVED -> R.string.account_sync_removed
}
