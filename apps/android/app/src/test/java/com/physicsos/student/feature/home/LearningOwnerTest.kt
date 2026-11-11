package com.physicsos.student.feature.home

import com.physicsos.student.core.AuthState
import com.physicsos.student.core.MobileUser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningOwnerTest {
    private fun signedIn(id: String = "instance-a", key: String = "school:student") =
        AuthState.SignedIn(MobileUser(key, "school", "student", "Student", "student", id))

    @Test fun guestStorageIsAnExplicitOptInAndNeverAliasesASignedInOrRestoringAccount() {
        assertNull(learningOwnerIdentity(AuthState.SignedOut))
        assertNull(learningOwnerIdentity(AuthState.Restoring, includeGuest = true))
        assertEquals("guest" to "guest", learningOwnerIdentity(AuthState.SignedOut, includeGuest = true))
        assertTrue(learningOwnerAllowed(AuthState.SignedOut, "guest"))
        assertFalse(learningOwnerAllowed(AuthState.Restoring, "guest"))
        assertFalse(learningOwnerAllowed(signedIn(), "guest"))
        assertFalse(learningOwnerAllowed(AuthState.SignedOut, "school:student"))
    }

    @Test fun sameUsernameDifferentIncarnationTriggersAChangedObserverIdentity() {
        assertTrue(learningOwnerAllowed(signedIn(), "school:student"))
        assertFalse(learningOwnerAllowed(signedIn(key = "school:other"), "school:student"))
        assertNotEquals(learningOwnerIdentity(signedIn("first")), learningOwnerIdentity(signedIn("second")))
    }
}
