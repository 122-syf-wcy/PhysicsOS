package com.physicsos.student.core

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountIsolationTest {
    @Test
    fun accountTransitionCancelsRegisteredRequestsAndRejectsStaleCommits() {
        val fence = RequestFence()
        val old = fence.current()
        val cancellations = AtomicInteger()
        val released = fence.register(old) { cancellations.addAndGet(100) }
        released.close()
        fence.register(old) { cancellations.incrementAndGet() }
        fence.advance()
        assertEquals(1, cancellations.get())
        assertFalse(fence.isCurrent(old))
        val error = assertThrows(ApiException::class.java) { fence.commit(old) { error("Stale commit ran") } }
        assertEquals("account_changed", error.code)
        assertThrows(ApiException::class.java) { fence.register(old) { cancellations.incrementAndGet() } }
        assertEquals(2, cancellations.get())
    }

    @Test
    fun gateDoesNotExposeAnotherAccountsRecords() = runTest {
        val fence = RequestFence()
        val owners = OwnerGate(fence)
        owners.replace(AccountStamp("school:student-a", fence.current(), "instance-a"))
        val records = MutableStateFlow(listOf("private record"))
        assertEquals(listOf("private record"), owners.observe("school:student-a") { records }.first())
        assertTrue(owners.observe("school:student-b") { records }.first().isEmpty())
        fence.advance()
        owners.replace(AccountStamp("school:student-b", fence.current(), "instance-b"))
        assertTrue(owners.observe("school:student-a") { records }.first().isEmpty())
        val denied = async { runCatching { owners.withOwner("school:student-a") { "secret" } }.exceptionOrNull() }
        assertEquals("owner_unavailable", (denied.await() as ApiException).code)
    }

    @Test
    fun guestPartitionIsAvailableWithoutSigningInButPrivatePartitionsAreNot() = runTest {
        val owners = OwnerGate(RequestFence())
        assertEquals("offline scene", owners.withOwner("guest") { "offline scene" })
        assertEquals("guest", owners.observe("guest") { MutableStateFlow(listOf("guest")) }.first().single())
        val error = runCatching { owners.withOwner("school:student") { "private" } }.exceptionOrNull()
        assertEquals("sign_in_required", (error as ApiException).code)
    }
}
