package com.physicsos.student.feature.account

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.MobileUser
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.files.ShareFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal data class AccountUiState(
    val user: MobileUser,
    val page: AccountPage = AccountPage.OVERVIEW,
    val busy: Boolean = false,
    val problem: AccountProblem? = null,
    val notice: AccountNotice? = null,
    val devices: List<AccountDevice> = emptyList(),
    val devicesLoaded: Boolean = false,
    val draft: String? = null,
    val draftDirty: Boolean = false,
    val operations: List<OutboxItem> = emptyList(),
    val syncLoaded: Boolean = false,
    val theme: String? = null,
    val metered: Boolean? = null,
    val exported: AccountExportInfo? = null,
)

internal sealed interface AccountEffect {
    data class Share(val file: ShareFile) : AccountEffect
    data class CreateDocument(val info: AccountExportInfo) : AccountEffect
}

internal class AccountViewModel(context: Context, private val graph: AppGraph, identity: MobileUser) : ViewModel() {
    private val repository = AccountRepository(graph.api, graph.auth, graph.store, graph.sync, identity)
    private val files = AccountExportFiles(context, identity.userKey, repository::requireCurrent)
    private val mutableState = MutableStateFlow(AccountUiState(identity))
    val state = mutableState.asStateFlow()
    private val channel = Channel<AccountEffect>(Channel.BUFFERED)
    val effects = channel.receiveAsFlow()
    private var settingsJob: Job? = null

    init {
        viewModelScope.launch {
            graph.auth.state.collect { auth ->
                if (repository.isCurrent() && auth is AuthState.SignedIn) {
                    mutableState.update { it.copy(user = auth.user) }
                } else {
                    files.close()
                    mutableState.update { it.copy(devices = emptyList(), draft = null, operations = emptyList(), exported = null) }
                }
            }
        }
        viewModelScope.launch {
            try {
                repository.observeSync().collect { rows ->
                    if (repository.isCurrent()) mutableState.update { it.copy(operations = rows, syncLoaded = true) }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { report(error) }
        }
        loadSettings()
        refreshProfile()
    }

    fun isCurrent() = repository.isCurrent()

    fun open(page: AccountPage) {
        if (mutableState.value.busy || !repository.isCurrent()) return
        mutableState.update { it.copy(page = page, problem = null, notice = null) }
        when (page) {
            AccountPage.DEVICES -> loadDevices()
            AccountPage.FEEDBACK -> if (mutableState.value.draft == null) loadDraft()
            else -> Unit
        }
    }

    fun clearMessage() { mutableState.update { it.copy(problem = null, notice = null) } }
    fun refreshProfile() = task { repository.refreshProfile() }
    fun updateProfile(name: String) = task(AccountNotice.PROFILE_SAVED) { repository.updateProfile(name) }
    fun loadDevices() = task {
        val devices = repository.devices()
        mutableState.update { it.copy(devices = devices, devicesLoaded = true) }
    }
    fun revokeDevice(device: AccountDevice) = task(AccountNotice.DEVICE_REVOKED) {
        repository.revokeDevice(device)
        if (repository.isCurrent()) {
            val devices = repository.devices()
            mutableState.update { it.copy(devices = devices, devicesLoaded = true) }
        }
    }
    fun changePassword(current: String, new: String, confirmation: String, code: String) = task(AccountNotice.PASSWORD_CHANGED) {
        repository.changePassword(current, new, confirmation, code)
    }
    fun deleteAccount(password: String, confirmation: String, code: String) = task {
        // The core publishes deleted vs deletion_pending for the integration's post-navigation notice.
        repository.deleteAccount(password, confirmation, code)
    }
    fun logout() = task { repository.logout() }

    fun loadDraft() = task {
        val draft = repository.loadFeedbackDraft()
        mutableState.update { it.copy(draft = draft, draftDirty = false) }
    }
    fun editDraft(text: String) {
        if (!mutableState.value.busy && text.length <= 10_000) mutableState.update { it.copy(draft = text, draftDirty = true, notice = null) }
    }
    fun saveDraft() = task(AccountNotice.DRAFT_SAVED) {
        repository.saveFeedbackDraft(mutableState.value.draft ?: "")
        mutableState.update { it.copy(draftDirty = false) }
    }
    fun exportFeedback(explanation: String) = task(AccountNotice.EXPORT_READY) {
        val info = files.feedback(mutableState.value.draft ?: "", explanation)
        mutableState.update { it.copy(exported = info) }
    }
    fun generateExport() = task(AccountNotice.EXPORT_READY) {
        val info = files.account(repository.exportAccount())
        mutableState.update { it.copy(exported = info) }
    }
    fun shareExport() = task {
        val info = mutableState.value.exported ?: throw AccountFailure(AccountProblem.FILE_UNAVAILABLE)
        val share = files.share(info.id)
        repository.requireCurrent()
        channel.send(AccountEffect.Share(share))
    }
    fun requestSaveExport() = task {
        val info = mutableState.value.exported ?: throw AccountFailure(AccountProblem.FILE_UNAVAILABLE)
        channel.send(AccountEffect.CreateDocument(info))
    }
    fun saveExport(id: String, destination: Uri) = task(AccountNotice.EXPORTED) { files.export(id, destination) }
    fun shareUnavailable() { mutableState.update { it.copy(problem = AccountProblem.SHARE_UNAVAILABLE) } }

    fun syncNow() = task(AccountNotice.SYNC_CHECKED) { repository.syncNow() }
    fun retrySync(item: OutboxItem) = task {
        if (!canRetryAccountSync(item.state)) throw AccountFailure(AccountProblem.CONFLICT)
        repository.retrySync(item.id)
    }
    fun discardSync(item: OutboxItem) = task(AccountNotice.RECEIPT_REMOVED) {
        if (item.state == OutboxState.RUNNING) throw AccountFailure(AccountProblem.CONFLICT)
        repository.discardSync(item.id)
    }

    fun loadSettings() {
        settingsJob?.cancel()
        settingsJob = viewModelScope.launch {
            try {
                combine(graph.settings.theme, graph.settings.syncOnMeteredNetwork) { theme, metered -> theme to metered }
                    .collect { (theme, metered) -> mutableState.update { it.copy(theme = theme, metered = metered) } }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { report(error) }
        }
    }
    fun setTheme(theme: String) = task { repository.requireCurrent(); graph.settings.setTheme(theme) }
    fun setMetered(value: Boolean) = task { repository.requireCurrent(); graph.settings.setSyncOnMeteredNetwork(value) }

    private fun task(notice: AccountNotice? = null, action: suspend () -> Unit) {
        if (mutableState.value.busy) return
        mutableState.update { it.copy(busy = true, problem = null, notice = null) }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                repository.requireCurrent()
                action()
                if (repository.isCurrent()) mutableState.update { it.copy(notice = notice) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { report(error) }
            finally { mutableState.update { it.copy(busy = false) } }
        }
    }

    private fun report(error: Exception) {
        val problem = accountProblem(error)
        if (repository.isCurrent()) mutableState.update { it.copy(problem = problem, notice = null) }
    }

    override fun onCleared() {
        channel.close()
        files.close()
    }
}
