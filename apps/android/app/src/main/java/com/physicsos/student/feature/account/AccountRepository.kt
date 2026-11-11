package com.physicsos.student.feature.account

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AuthRepository
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.LocalStore
import com.physicsos.student.core.MobileClient
import com.physicsos.student.core.MobileUser
import com.physicsos.student.core.SyncCoordinator
import java.security.MessageDigest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** LocalStore's owner is userKey; record ids/payloads also bind the immutable account incarnation. */
internal class AccountRepository(
    private val api: MobileClient,
    private val auth: AuthRepository,
    private val store: LocalStore,
    private val sync: SyncCoordinator,
    val identity: MobileUser,
) {
    private val draftId = accountInstanceKey(identity.userId)

    fun isCurrent(): Boolean = (auth.state.value as? AuthState.SignedIn)?.user?.let {
        it.userId == identity.userId && it.userKey == identity.userKey
    } == true

    fun requireCurrent() {
        if (!isCurrent()) throw AccountFailure(AccountProblem.ACCOUNT_CHANGED)
    }

    private fun requireNoReplacement() {
        val state = auth.state.value
        if (state is AuthState.SignedIn && !isCurrent() || state is AuthState.Restoring) {
            throw AccountFailure(AccountProblem.ACCOUNT_CHANGED)
        }
    }

    suspend fun refreshProfile() {
        requireCurrent()
        auth.refreshUser()
        requireCurrent()
    }

    suspend fun updateProfile(displayName: String) {
        val name = validatedDisplayName(displayName)
        requireCurrent()
        val result = api.request("PATCH", "auth/profile", buildJsonObject { put("displayName", name) }).accountObject()
        requireCurrent()
        val user = parseAccountUser(result["user"] ?: invalidAccountResponse(), identity)
        if (user.displayName != name) invalidAccountResponse()
        // MobileClient applies the validated profile mutation to AuthRepository; do not invent local identity.
        val current = (auth.state.value as? AuthState.SignedIn)?.user ?: throw AccountFailure(AccountProblem.AUTH)
        if (current != user) {
            auth.refreshUser()
            requireCurrent()
            if ((auth.state.value as? AuthState.SignedIn)?.user != user) invalidAccountResponse()
        }
    }

    suspend fun devices(): List<AccountDevice> {
        requireCurrent()
        val result = api.request("GET", "auth/devices")
        requireCurrent()
        return parseAccountDevices(result)
    }

    suspend fun revokeDevice(device: AccountDevice) {
        if (device.revokedAt != null) throw AccountFailure(AccountProblem.INVALID_RESPONSE)
        requireCurrent()
        val result = api.request("DELETE", "auth/devices/${accountPathSegment(device.id)}").accountObject()
        validateAccountMutationAck(result)
        requireNoReplacement()
        if (device.current && isCurrent()) signOutAfterAcknowledgedMutation()
    }

    suspend fun changePassword(current: String, new: String, confirmation: String, code: String) {
        validatePasswordChange(current, new, confirmation, code)
        requireCurrent()
        val result = api.request("POST", "auth/password", buildJsonObject {
            put("currentPassword", current); put("newPassword", new)
            if (code.isNotEmpty()) put("code", code)
        }).accountObject()
        validateAccountMutationAck(result)
        requireNoReplacement()
        if (isCurrent()) signOutAfterAcknowledgedMutation()
    }

    suspend fun deleteAccount(password: String, confirmation: String, code: String): String {
        if (password.isEmpty() || password.length > 128) throw AccountFailure(AccountProblem.INVALID_PROOF)
        if (confirmation != "DELETE") throw AccountFailure(AccountProblem.DELETE_CONFIRMATION)
        validateAccountCode(code)
        requireCurrent()
        val result = auth.deleteAccount(buildJsonObject {
            put("password", password); put("confirmation", "DELETE")
            if (code.isNotEmpty()) put("code", code)
        })
        val status = result.accountString("status")
        if (status !in setOf("deleted", "deletion_pending")) invalidAccountResponse()
        result.accountString("requestId")
        requireNoReplacement()
        return status
    }

    private suspend fun signOutAfterAcknowledgedMutation() {
        try {
            auth.logout()
        } catch (error: ApiException) {
            if (error.code != "logout_revocation_unconfirmed") throw error
            // The mutation was acknowledged. Core separately retains the unconfirmed extra revocation.
        }
        requireNoReplacement()
    }

    suspend fun logout() {
        requireCurrent()
        // Core intentionally erases this device's credentials even while offline. Its lastError
        // retains logout_revocation_unconfirmed; this feature must not claim server revocation.
        auth.logout()
        requireNoReplacement()
    }

    suspend fun exportAccount(): JsonObject {
        requireCurrent()
        val result = auth.exportData()
        requireCurrent()
        validateAccountExport(result)
        return result
    }

    suspend fun loadFeedbackDraft(): String {
        requireCurrent()
        val payload = store.get(FEEDBACK_KIND, identity.userKey, draftId)?.payload ?: return ""
        requireCurrent()
        if (payload["userId"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } != identity.userId) return ""
        val text = (payload["text"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
            ?: invalidAccountResponse()
        if (text.length > 10_000) invalidAccountResponse()
        return text
    }

    suspend fun saveFeedbackDraft(text: String) {
        if (text.length > 10_000) throw AccountFailure(AccountProblem.INVALID_FEEDBACK)
        requireCurrent()
        store.put(FEEDBACK_KIND, identity.userKey, draftId, buildJsonObject {
            put("userId", identity.userId); put("text", text)
        })
        requireCurrent()
    }

    fun observeSync(): Flow<List<com.physicsos.student.core.OutboxItem>> = sync.observe(identity.userKey)

    suspend fun syncNow() { requireCurrent(); sync.syncNow(); requireCurrent() }
    suspend fun retrySync(id: String) { requireCurrent(); sync.retry(id); requireCurrent() }
    suspend fun discardSync(id: String) { requireCurrent(); sync.discard(id); requireCurrent() }

    companion object { private const val FEEDBACK_KIND = "account.feedback-draft" }
}

