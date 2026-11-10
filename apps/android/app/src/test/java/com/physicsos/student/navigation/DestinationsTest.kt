package com.physicsos.student.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class DestinationsTest {
    @Test
    fun absentArgumentsDoNotCreateStringNullValues() {
        assertEquals("chat", Destinations.chat())
        assertEquals("experiment", Destinations.experiment())
        assertEquals("classes", Destinations.classes())
        assertFalse(Destinations.chat(null, " ").contains("null"))
    }

    @Test
    fun routeValuesCannotInjectAnotherQueryParameter() {
        assertEquals("chat?sessionId=a%26draftId%3Db", Destinations.chat("a&draftId=b"))
        assertEquals("experiment?templateId=space%20name", Destinations.experiment("space name"))
        assertEquals("document/a%2Fb", Destinations.document("a/b"))
    }

    @Test
    fun classAndAssignmentIdentifiersAreEncodedIndependently() {
        assertEquals("classes?classId=class%3A1&assignmentId=work%2F2", Destinations.classes("class:1", "work/2"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun policyCannotSelectArbitraryBundledFiles() {
        Destinations.policy("../private")
    }
}
