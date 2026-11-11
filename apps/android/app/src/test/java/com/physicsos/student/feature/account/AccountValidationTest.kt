package com.physicsos.student.feature.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountValidationTest {
    @Test fun displayNameUsesServerTrimAndBounds() {
        assertEquals("学生 A", validatedDisplayName("  学生 A  "))
        assertEquals("a".repeat(32), validatedDisplayName("a".repeat(32)))
        rejects(AccountProblem.INVALID_NAME) { validatedDisplayName(" ") }
        rejects(AccountProblem.INVALID_NAME) { validatedDisplayName("a".repeat(33)) }
        rejects(AccountProblem.INVALID_NAME) { validatedDisplayName("a\u0000b") }
    }

    @Test fun passwordProofIsValidatedBeforeAnyRequest() {
        validatePasswordChange("old password", "new password", "new password", "")
        validatePasswordChange("old password", "new password", "new password", "ABCDEF-2345")
        rejects(AccountProblem.INVALID_PASSWORD) { validatePasswordChange("", "12345678", "12345678", "") }
        rejects(AccountProblem.INVALID_PASSWORD) { validatePasswordChange("old", "short", "short", "") }
        rejects(AccountProblem.INVALID_PASSWORD) { validatePasswordChange("samepass", "samepass", "samepass", "") }
        rejects(AccountProblem.INVALID_PASSWORD) { validatePasswordChange("old", "x".repeat(129), "x".repeat(129), "") }
        rejects(AccountProblem.PASSWORD_MISMATCH) { validatePasswordChange("old", "12345678", "87654321", "") }
    }

    @Test fun secondFactorAllowsRecoveryCodeButRejectsWhitespace() {
        validateAccountCode("")
        validateAccountCode("012345")
        validateAccountCode("ABCD-2345-EFGH")
        rejects(AccountProblem.INVALID_CODE) { validateAccountCode("12345") }
        rejects(AccountProblem.INVALID_CODE) { validateAccountCode("12 345") }
        rejects(AccountProblem.INVALID_CODE) { validateAccountCode("12345\n") }
        rejects(AccountProblem.INVALID_CODE) { validateAccountCode("a".repeat(65)) }
    }

    @Test fun feedbackIsBoundedWithoutTruncating() {
        assertEquals("first\nsecond\tstep", validatedFeedback(" first\nsecond\tstep "))
        assertEquals(10_000, validatedFeedback("a".repeat(10_000)).length)
        rejects(AccountProblem.INVALID_FEEDBACK) { validatedFeedback("") }
        rejects(AccountProblem.INVALID_FEEDBACK) { validatedFeedback("a".repeat(10_001)) }
        rejects(AccountProblem.INVALID_FEEDBACK) { validatedFeedback("text\u0000end") }
    }

    @Test fun deviceIdIsExactlyOneEncodedSegment() {
        assertEquals("grant-1_2.3~x", accountPathSegment("grant-1_2.3~x"))
        assertEquals("a%2Fb%3Fc%23d%25e", accountPathSegment("a/b?c#d%e"))
        assertEquals("%E8%AE%BE%E5%A4%87", accountPathSegment("设备"))
        rejects(AccountProblem.INVALID_RESPONSE) { accountPathSegment("..") }
        rejects(AccountProblem.INVALID_RESPONSE) { accountPathSegment("a\nb") }
        rejects(AccountProblem.INVALID_RESPONSE) { accountPathSegment("a".repeat(513)) }
    }

    @Test fun incarnationKeyDoesNotReuseUsernameAndIsSafeForFiles() {
        val first = accountInstanceKey("school:student:instance-1")
        val second = accountInstanceKey("school:student:instance-2")
        assertTrue(first.matches(Regex("[a-f0-9]{64}")))
        assertNotEquals(first, second)
        assertEquals(first, accountInstanceKey("school:student:instance-1"))
        assertFalse(first.contains("student"))
    }

    @Test fun validationFailuresContainNoUserInput() {
        val secret = "private-secret".repeat(20)
        try { validatePasswordChange(secret, secret, secret, "") }
        catch (error: AccountFailure) {
            assertNull(error.message)
            assertFalse(error.toString().contains("private-secret"))
            return
        }
        throw AssertionError("Expected validation failure")
    }

    private fun rejects(problem: AccountProblem, block: () -> Unit) {
        try { block() } catch (error: AccountFailure) { assertEquals(problem, error.problem); return }
        throw AssertionError("Expected $problem")
    }
}
