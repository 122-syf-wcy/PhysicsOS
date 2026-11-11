package com.physicsos.student.feature.account

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.MobileUser
import com.physicsos.student.core.OutboxState
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

internal enum class AccountPage { OVERVIEW, PROFILE, PASSWORD, DEVICES, EXPORT, FEEDBACK, SYNC, SETTINGS, NOTIFICATIONS, DELETE }
internal enum class AccountNotice { PROFILE_SAVED, PASSWORD_CHANGED, DEVICE_REVOKED, DRAFT_SAVED, EXPORT_READY, EXPORTED, SYNC_CHECKED, RECEIPT_REMOVED }
/** Only the explicitly public mobile DTO is projected into the account UI. */
internal data class AccountDevice(
    val id: String,
    val name: String,
    val appVersion: String?,
    val createdAt: Instant,
    val lastSeenAt: Instant,
    val expiresAt: Instant,
    val current: Boolean,
    val revokedAt: Instant?,
)

internal enum class AccountConfirmation { PASSWORD, LOGOUT, DELETE, GENERATE_EXPORT, SHARE_EXPORT, DISCARD_SYNC }
internal enum class AccountExportKind { ACCOUNT, FEEDBACK }
internal data class AccountExportInfo(val id: String, val name: String, val bytes: Long, val kind: AccountExportKind)

internal fun JsonElement.accountObject(): JsonObject = this as? JsonObject ?: invalidAccountResponse()
internal fun JsonObject.accountString(key: String, max: Int = 512): String =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        ?.takeIf { it.isNotBlank() && it.length <= max && it.none(Char::isISOControl) }
        ?: invalidAccountResponse()
internal fun JsonObject.accountBoolean(key: String): Boolean =
    (this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: invalidAccountResponse()
internal fun invalidAccountResponse(): Nothing = throw AccountFailure(AccountProblem.INVALID_RESPONSE)

/** HTTP/envelope validation belongs to MobileClient; optional flags must still have their declared type. */
internal fun validateAccountMutationAck(value: JsonObject) {
    if (value.containsKey("reauthenticate")) value.accountBoolean("reauthenticate")
}

internal fun parseAccountUser(value: JsonElement, expected: MobileUser): MobileUser {
    val user = value.accountObject()
    val parsed = MobileUser(
        userKey = user.accountString("userKey"), schoolId = user.accountString("schoolId"),
        username = user.accountString("username", 64), displayName = user.accountString("displayName", 32),
        role = user.accountString("role", 32), userId = user.accountString("userId"),
    )
    if (parsed.userId != expected.userId || parsed.userKey != expected.userKey ||
        parsed.username != expected.username || parsed.schoolId != expected.schoolId || parsed.role != expected.role
    ) invalidAccountResponse()
    return parsed
}

internal fun parseAccountDevices(value: JsonElement): List<AccountDevice> {
    val rows = value.accountObject()["items"] as? JsonArray ?: invalidAccountResponse()
    if (rows.size > 100) invalidAccountResponse()
    val ids = mutableSetOf<String>()
    return rows.map { row ->
        val item = row.accountObject()
        val id = item.accountString("id")
        if (!ids.add(id) || item.accountString("platform") != "android") invalidAccountResponse()
        fun instant(key: String): Instant = try { Instant.parse(item.accountString(key, 80)) }
            catch (_: java.time.format.DateTimeParseException) { invalidAccountResponse() }
        AccountDevice(
            id, item.accountString("deviceName", 80),
            if (item["appVersion"] == null) null else item.accountString("appVersion", 32),
            instant("createdAt"), instant("lastSeenAt"), instant("refreshExpiresAt"), item.accountBoolean("current"),
            if (item["revokedAt"] == null) null else instant("revokedAt"),
        )
    }.also { if (it.count(AccountDevice::current) > 1) invalidAccountResponse() }
}

/** Never surface arbitrary server/transport text: it can contain private fields or credentials. */
internal fun accountProblem(error: Exception): AccountProblem {
    if (error is CancellationException) throw error
    if (error is AccountFailure) return error.problem
    if (error is ApiException) {
        return when (error.code) {
            "account_changed", "owner_unavailable", "identity_changed" -> AccountProblem.ACCOUNT_CHANGED
            "INVALID_CREDENTIALS", "INVALID_TWO_FACTOR_CODE" -> AccountProblem.INVALID_PROOF
            "TWO_FACTOR_REQUIRED" -> AccountProblem.TWO_FACTOR
            "network_unavailable", "request_timeout" -> AccountProblem.NETWORK
            "export_too_large" -> AccountProblem.EXPORT_TOO_LARGE
            "settings_unavailable", "settings_invalid", "local_store_unavailable", "storage_unavailable", "storage_cleanup_failed" -> AccountProblem.STORAGE
            "invalid_response", "protocol_error" -> AccountProblem.INVALID_RESPONSE
            else -> when (error.status) {
                401 -> AccountProblem.AUTH
                403 -> AccountProblem.FORBIDDEN
                404, 405, 501, 503 -> AccountProblem.SERVICE_UNAVAILABLE
                409 -> AccountProblem.CONFLICT
                429 -> AccountProblem.RATE_LIMIT
                0 -> AccountProblem.NETWORK
                else -> AccountProblem.FAILED
            }
        }
    }
    return when (error) {
        is java.io.IOException, is SecurityException -> AccountProblem.STORAGE
        else -> AccountProblem.FAILED
    }
}

internal fun canRetryAccountSync(state: OutboxState): Boolean =
    state in setOf(OutboxState.PENDING, OutboxState.RETRY, OutboxState.FAILED, OutboxState.AUTH_REQUIRED)

/** Export must not accidentally serialize a credential-bearing response or a private file path. */
internal fun validateAccountExport(value: JsonElement) {
    val forbidden = setOf("accesstoken", "refreshtoken", "passwordhash", "totpsecret", "authorization", "localpath")
    fun inspect(item: JsonElement) {
        when (item) {
            is JsonObject -> item.forEach { (key, child) ->
                if (key.lowercase(java.util.Locale.ROOT) in forbidden) throw AccountFailure(AccountProblem.UNSAFE_EXPORT)
                inspect(child)
            }
            is JsonArray -> item.forEach(::inspect)
            is JsonPrimitive -> if (item.isString && Regex("(?:pma_|pmr_)[A-Za-z0-9_-]{43}").containsMatchIn(item.content)) {
                throw AccountFailure(AccountProblem.UNSAFE_EXPORT)
            }
        }
    }
    inspect(value)
}
