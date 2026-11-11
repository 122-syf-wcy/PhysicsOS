package com.physicsos.student.core

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PrivateFilesTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun ownerCleanupRemovesOnlyThatAccountsHashedFeatureDirectories() {
        val root = temporary.newFolder("private")
        val files = PrivateFiles(listOf(root))
        val owner = "school:student"
        val paths = listOf("chat-files", "chat-downloads", "captures", "account-exports", "shared/chat", "shared/experiments")
        val removed = paths.map { File(root, "$it/${hash(owner)}/nested/result.json").apply { requireNotNull(parentFile).mkdirs(); writeText("sensitive") } }
        val other = File(root, "chat-files/${hash("school:other")}/record.json").apply { requireNotNull(parentFile).mkdirs(); writeText("other") }
        val guest = File(root, "shared/experiments/${hash("guest")}/scene.json").apply { requireNotNull(parentFile).mkdirs(); writeText("guest") }
        val unrelated = File(root, "settings.json").apply { writeText("device settings") }
        files.deleteOwner(owner)
        removed.forEach { assertFalse(it.exists()) }
        assertEquals("other", other.readText())
        assertEquals("guest", guest.readText())
        assertTrue(unrelated.exists())
    }

    @Test
    fun privateDestinationsRejectRootAndTraversalOutsideTheApp() {
        val root = temporary.newFolder("private")
        val outside = temporary.newFile("outside")
        val files = PrivateFiles(listOf(root))
        assertThrows(ApiException::class.java) { files.destination(root) }
        assertThrows(ApiException::class.java) { files.checked(File(root, "../outside")) }
        assertThrows(ApiException::class.java) { files.delete(outside.path) }
        assertTrue(outside.exists())
    }

    @Test
    fun interruptedDownloadCleanupPreservesRecentAndUnrelatedFiles() {
        val root = temporary.newFolder("private")
        val old = File(root, ".physicsos-download-old.part").apply { writeText("partial"); setLastModified(1) }
        val now = System.currentTimeMillis()
        val recent = File(root, ".physicsos-download-recent.part").apply { writeText("active"); setLastModified(now) }
        val keep = File(root, "notes.part").apply { writeText("keep"); setLastModified(1) }
        PrivateFiles(listOf(root)).cleanInterruptedParts(now)
        assertFalse(Files.exists(old.toPath()))
        assertTrue(recent.exists())
        assertTrue(keep.exists())
    }

    private fun hash(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
