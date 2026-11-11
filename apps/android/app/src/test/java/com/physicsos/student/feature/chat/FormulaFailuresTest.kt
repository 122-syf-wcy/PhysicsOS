package com.physicsos.student.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class FormulaFailuresTest {
    @Test fun repeatedFormulaFailureDoesNotTriggerANewStateOrRetryLoop() {
        val first = FormulaFailures().record("x +\ny")
        assertSame(first, first.record("x + y"))
        assertTrue(first.affects(setOf("x + y")))
        assertFalse(first.affects(setOf("F=ma")))
    }

    @Test fun failureBudgetPreservesOldErrorsAndFallsBackRatherThanEvictingThem() {
        var state = FormulaFailures()
        repeat(64) { state = state.record("bad-$it") }
        assertEquals(64, state.expressions.size)
        assertFalse(state.overflow)
        state = state.record("one-more")
        assertTrue(state.overflow)
        assertEquals(64, state.expressions.size)
        assertTrue(state.affects(setOf("bad-0")))
        assertTrue(state.affects(setOf("new-formula")))
        assertSame(state, state.record("still-more"))
    }
}
