package com.physicsos.student.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    private val origin = OriginPolicy("https://candidate.example", "https://candidate.example/physicsos/mobile/v1/")

    @Test
    fun relativeMobilePathsCannotEscapeTheVersionedApiOrLeakCredentials() {
        assertEquals("/physicsos/mobile/v1/classes", origin.mobile("classes?limit=50").encodedPath)
        for (path in listOf("/auth/me", "https://evil.example/", "//evil.example/", "../auth/me", "%2e%2e/auth/me", "%252e%252e/auth/me", "classes%2Fadmin", "classes\\admin", "classes?token=private", "auth/me#fragment")) {
            assertThrows("Accepted $path", ApiException::class.java) { origin.mobile(path) }
        }
        assertThrows(ApiException::class.java) { origin.download("https://other.example/api/file") }
        assertThrows(ApiException::class.java) { origin.download("/private/record") }
    }

    @Test
    fun emptyOrMismatchedEnvelopesAreNotSuccessReceipts() {
        assertThrows(ApiException::class.java) { WireProtocol.mobile(JsonObject(emptyMap())) }
        assertThrows(ApiException::class.java) { WireProtocol.rpc(buildJsonObject { put("type", "server-response"); put("rpcId", "other") }, "expected") }
        val void = buildJsonObject {
            put("type", "server-response"); put("rpcId", "same")
            put("result", buildJsonObject { put("ok", true) })
        }
        assertEquals(JsonNull, WireProtocol.rpc(void, "same"))
        val payload = WireProtocol.rpcRequest("id", "session/list", JsonObject(emptyMap()))
        assertTrue(payload.toString().contains("_request"))
    }

    @Test
    fun errorsRedactSecretsAndPreserveRetrySemantics() {
        val error = WireProtocol.failure(429, buildJsonObject {
            put("code", "rate_limited")
            put("message", "Bearer secret-access password=secret-password")
        }, 5000)
        assertTrue(error.retryable)
        assertFalse(error.message.orEmpty().contains("secret-access"))
        assertFalse(error.message.orEmpty().contains("secret-password"))
        assertEquals(5000L, error.retryAfterMillis)
        assertEquals(60_000L, WireProtocol.retryAfter("60", 0))
        assertEquals(30_000L, retryDelay(1, null))
        assertEquals(120_000L, retryDelay(1, 120_000))
        assertEquals(21_600_000L, retryDelay(100, null))
        assertFalse(ApiException(409, "version_conflict", "Conflict").retryable)
    }

    @Test
    fun uploadReceiptRequiresRealFileIdentityAndSize() {
        val incomplete = buildJsonObject {
            put("ok", true)
            put("value", buildJsonObject { put("receiptId", "receipt"); put("file", JsonObject(emptyMap())) })
        }
        assertThrows(ApiException::class.java) { WireProtocol.upload(incomplete) }
        val complete = buildJsonObject {
            put("ok", true)
            put("value", buildJsonObject {
                put("receiptId", "receipt")
                put("file", buildJsonObject { put("attachmentId", "attachment"); put("name", "paper.pdf"); put("bytes", 100) })
            })
        }
        assertEquals(JsonPrimitive("receipt"), WireProtocol.upload(complete)["receiptId"])
    }
}
