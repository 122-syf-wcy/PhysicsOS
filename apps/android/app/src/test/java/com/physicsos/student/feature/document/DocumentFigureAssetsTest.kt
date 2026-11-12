package com.physicsos.student.feature.document

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.MobileClient
import com.physicsos.student.feature.classes.ClassDecoders
import com.physicsos.student.feature.experiments.ExperimentAccount
import com.physicsos.student.feature.experiments.TestApi
import com.physicsos.student.feature.experiments.bridge.LabUrlPolicy
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.nio.file.Files
import java.util.zip.CRC32
import java.util.zip.DeflaterOutputStream
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.Json
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentFigureAssetsTest {
    private val path = "/physicsos/mobile/v1/classes/c/assignments/a/target/figures/f1"

    @Test fun actualTargetFigureUrlIsRetainedInsteadOfTreatingItsRefAsAUrl() {
        val target = ClassDecoders.target(targetPayload(path))
        assertEquals(path, target.questions.single().figureUrl)
        assertTrue(target.paperMarkdown.contains("]($path)"))
        assertThrows(IllegalStateException::class.java) { ClassDecoders.target(targetPayload(path.replace("/classes/c/", "/classes/other/"))) }
        assertNull(assignmentFigurePath("https://evil.example/figure.png"))
        assertNull(assignmentFigurePath(path + "?token=not-allowed"))
        assertNull(assignmentFigurePath(path.replace("f1", "%2e%2e")))
    }

    @Test fun nativeDownloadBecomesAnImmutableAccountBoundLocalAssetAndCanBeReusedOffline() = runBlocking<Unit> {
        val root = Files.createTempDirectory("document-figure-test").toFile().canonicalFile
        try {
            val png = png()
            val account = ExperimentAccount("school:student", "instance-one")
            var current: ExperimentAccount? = account
            var offline = false
            var denied = false
            val requests = mutableListOf<String>()
            val api = object : MobileClient by TestApi() {
                override suspend fun download(path: String, destination: File, maxBytes: Long, onProgress: (Long, Long?) -> Unit): JsonObject {
                    requests += path
                    if (denied) throw ApiException(403, "FORBIDDEN", "Membership revoked")
                    if (offline) throw IOException("Offline fixture")
                    assertEquals(4L * 1024 * 1024, maxBytes)
                    destination.writeBytes(png)
                    return buildJsonObject { put("bytes", png.size); put("mimeType", "image/png") }
                }
            }
            // BitmapFactory belongs to Android; this JVM test validates the real PNG container and file/account path.
            val assets = DocumentFigureAssets(root, account, api, { current }, { it.contentEquals(png) })
            val markdown = ClassDecoders.target(targetPayload(path)).paperMarkdown
            val prepared = assets.prepare(markdown)
            assertEquals(listOf(path), requests)
            assertFalse(prepared.contains(path))
            val url = prepared.substringAfterLast("](").removeSuffix(")")
            assertTrue(LabUrlPolicy.documentImage(url))
            assertFalse(LabUrlPolicy.documentImage("https://physics.example/image.png"))
            val name = URI(url).path.removePrefix(assets.pathPrefix)
            assertArrayEquals(png, assets.readAsset(name))
            offline = true
            assertEquals(prepared, assets.prepare(markdown))
            denied = true
            val refusal = runCatching { assets.prepare(markdown) }.exceptionOrNull() as ApiException
            assertEquals(403, refusal.status)
            assertThrows(ApiException::class.java) { assets.readAsset("../$name") }
            current = account.copy(userId = "replacement")
            assertThrows(ApiException::class.java) { assets.readAsset(name) }
            val other = DocumentFigureAssets(File(root, "replacement"), requireNotNull(current), api, { current }, { true })
            assertNotEquals(assets.pathPrefix, other.pathPrefix)
            assertThrows(ApiException::class.java) { other.readAsset(name) }
        } finally { root.deleteRecursively() }
    }

    @Test fun corruptTruncatedOversizedOrExcessiveDimensionPngIsRejectedBeforeDecode() {
        val valid = png()
        validateFigurePng(valid)
        assertThrows(ApiException::class.java) { validateFigurePng(valid.copyOf(valid.size - 1)) }
        assertThrows(ApiException::class.java) { validateFigurePng(valid.copyOf().apply { this[45] = (this[45].toInt() xor 1).toByte() }) }
        assertThrows(ApiException::class.java) { validateFigurePng(ByteArray(4 * 1024 * 1024 + 1)) }
        assertThrows(ApiException::class.java) { validateFigurePng(png(width = 5000)) }
    }

    private fun targetPayload(url: String): JsonObject = Json.parseToJsonElement("""
        {"assignment":{"id":"a","classId":"c","title":"Assignment","dueAt":"2026-11-08T10:00:00Z","target":{"kind":"paper","id":"p"}},
         "kind":"paper","answerPolicy":{"mode":"never","released":false},
         "paper":{"id":"p","title":"Physics paper","sections":[{"title":"Questions","items":[
           {"number":1,"subject":"physics","kind":"choice-single","score":3,"stem":"Use the circuit figure.",
            "options":["A","B"],"figure":{"kind":"line-diagram","ref":"f1","caption":"Circuit [one]","url":"$url"}}
         ]}]}}
    """.trimIndent()) as JsonObject

    private fun png(width: Int = 1): ByteArray {
        val bytes = ByteArrayOutputStream()
        bytes.write(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10))
        fun chunk(kind: String, content: ByteArray) {
            val type = kind.toByteArray(Charsets.US_ASCII)
            val crc = CRC32().apply { update(type); update(content) }.value
            DataOutputStream(bytes).apply { writeInt(content.size); write(type); write(content); writeInt(crc.toInt()) }
        }
        chunk("IHDR", ByteBuffer.allocate(13).putInt(width).putInt(1).put(8).put(2).put(0).put(0).put(0).array())
        val image = ByteArrayOutputStream()
        DeflaterOutputStream(image).use { it.write(byteArrayOf(0, 127, 127, 127)) }
        chunk("IDAT", image.toByteArray())
        chunk("IEND", ByteArray(0))
        return bytes.toByteArray()
    }
}
