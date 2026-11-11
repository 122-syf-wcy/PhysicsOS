package com.physicsos.student.feature.chat

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistantPresentationTest {
    @Test fun streamKeepsOrderWhenFramesArriveOutOfOrderAndDeduplicatesDelivery() {
        val presentation = AssistantPresentation()
        presentation.accept(start(1))
        val second = chunk(3, 1, "world")
        presentation.accept(second)
        assertTrue(presentation.hasGap)
        presentation.accept(chunk(2, 0, "Hello "))
        assertFalse(presentation.hasGap)
        assertEquals("Hello world", presentation.active?.assembler?.content()?.single()?.let { (it as JsonObject).string("text") })
        presentation.accept(second)
        assertEquals(3L,presentation.revision)
    }

    @Test fun durableBaselineRestoresTheExactPendingAssistantAndCursor() {
        val first = AssistantPresentation()
        first.accept(start(1))
        first.accept(chunk(2, 0, "Force = "))
        val restored = AssistantPresentation()
        restored.restore(first.baseline(), cursor = -1)
        restored.accept(chunk(3, 1, "mass × acceleration"))
        assertEquals("Force = mass × acceleration", (restored.active?.assembler?.content()?.single() as JsonObject).string("text"))
        assertEquals(3L,restored.revision)
    }

    @Test fun conflictingDuplicatesAndWrongAttemptChunksAreNotDisplayedAsSuccess() {
        val presentation = AssistantPresentation()
        presentation.accept(start(1))
        presentation.accept(chunk(2, 0, "a"))
        assertThrows(SessionProtocolException::class.java) { presentation.accept(chunk(2, 0, "different")) }
        assertThrows(SessionProtocolException::class.java) { presentation.accept(chunk(3, 1, "foreign", attempt = "other")) }
    }

    private fun start(revision: Long) = buildJsonObject {
        put("revision", revision); put("type", "start"); put("attemptId", "attempt-one")
        put("startedAfterSeq", -1); put("turn", 0); put("step", 0)
    }
    private fun chunk(revision: Long, index: Long, text: String, attempt: String = "attempt-one") = buildJsonObject {
        put("revision", revision); put("type", "chunk"); put("attemptId", attempt); put("index", index); put("time", revision)
        put("chunk", buildJsonObject { put("type", "text-delta"); put("index", 0); put("text", text) })
    }
}
