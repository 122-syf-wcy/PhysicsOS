package com.physicsos.student.feature.account

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.MobileUser
import com.physicsos.student.core.OutboxState
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountProtocolTest {
    private val user = MobileUser("school:student", "school", "student", "Student", "STUDENT", "immutable-1")

    @Test fun profileRejectsSameUsernameDifferentIncarnation() {
        val response = userJson("immutable-2")
        rejects(AccountProblem.INVALID_RESPONSE) { parseAccountUser(response, user) }
        assertEquals(user, parseAccountUser(userJson(user.userId), user))
    }

    @Test fun profileDoesNotPermitRoleOrSchoolChange() {
        rejects(AccountProblem.INVALID_RESPONSE) {
            parseAccountUser(JsonObject(userJson(user.userId) + ("role" to JsonPrimitive("SUPER_ADMIN"))), user)
        }
        rejects(AccountProblem.INVALID_RESPONSE) {
            parseAccountUser(JsonObject(userJson(user.userId) + ("schoolId" to JsonPrimitive("other"))), user)
        }
    }

    @Test fun devicesAreActualStrictPublicDtos() {
        val result = parseAccountDevices(Json.parseToJsonElement("""{"items":[{
            "id":"grant-1","platform":"android","deviceName":"Test device","appVersion":"1.0",
            "createdAt":"2026-11-01T00:00:00Z","lastSeenAt":"2026-11-10T00:00:00Z",
            "refreshExpiresAt":"2026-12-01T00:00:00Z","current":true,
            "accessToken":"must-not-be-projected"}]}"""))
        assertEquals("grant-1", result.single().id)
        assertTrue(result.single().current)
        assertFalse(result.toString().contains("must-not-be-projected"))
    }

    @Test fun malformedDevicesDoNotBecomeEmptySuccessfulList() {
        rejects(AccountProblem.INVALID_RESPONSE) { parseAccountDevices(JsonObject(emptyMap())) }
        rejects(AccountProblem.INVALID_RESPONSE) { parseAccountDevices(Json.parseToJsonElement("""{"items":[{}]}""")) }
        rejects(AccountProblem.INVALID_RESPONSE) { Json.parseToJsonElement("""{"reauthenticate":"true"}""").accountObject().accountBoolean("reauthenticate") }
    }

    @Test fun credentialBearingExportIsRejectedRatherThanLeaked() {
        rejects(AccountProblem.UNSAFE_EXPORT) { validateAccountExport(buildJsonObject { put("accessToken", "private") }) }
        rejects(AccountProblem.UNSAFE_EXPORT) { validateAccountExport(buildJsonObject { put("Authorization", "private") }) }
        rejects(AccountProblem.UNSAFE_EXPORT) { validateAccountExport(buildJsonObject { put("localPath", "/private/file") }) }
        rejects(AccountProblem.UNSAFE_EXPORT) {
            validateAccountExport(buildJsonObject { put("text", "never share pmr_${"A".repeat(43)}") })
        }
        validateAccountExport(buildJsonObject { put("sections", JsonArray(listOf(buildJsonObject { put("title", "Learning") }))) })
    }

    @Test fun conflictIsNeverAutomaticallyRetryable() {
        assertFalse(canRetryAccountSync(OutboxState.CONFLICT))
        assertFalse(canRetryAccountSync(OutboxState.RUNNING))
        assertFalse(canRetryAccountSync(OutboxState.ACKNOWLEDGED))
        assertTrue(canRetryAccountSync(OutboxState.RETRY))
    }

    @Test fun errorsPreserveCancellationAndDoNotExposeServerMessages() {
        val cancellation = CancellationException("cancel")
        try { accountProblem(cancellation) } catch (error: CancellationException) { assertTrue(error === cancellation) }
        assertEquals(AccountProblem.SERVICE_UNAVAILABLE, accountProblem(ApiException(404, "NOT_FOUND", "private credential")))
        assertEquals(AccountProblem.TWO_FACTOR, accountProblem(ApiException(403, "TWO_FACTOR_REQUIRED", "private credential")))
        assertEquals(AccountProblem.ACCOUNT_CHANGED, accountProblem(ApiException(0, "account_changed", "private credential")))
    }

    private fun userJson(id: String) = buildJsonObject {
        put("userId", id); put("userKey", user.userKey); put("username", user.username)
        put("schoolId", user.schoolId); put("displayName", user.displayName); put("role", user.role)
    }
    private fun rejects(problem: AccountProblem, block: () -> Unit) {
        try { block() } catch (error: AccountFailure) { assertEquals(problem, error.problem); return }
        throw AssertionError("Expected $problem")
    }
}
