package com.physicsos.student.feature.experiments

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AuthState
import com.physicsos.student.feature.experiments.bridge.LabLoad
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class ExperimentRecoveryTest {
    @Test
    fun checkpointLoadSendsOnlyTheCompleteCheckpointNotASecondTemplateOrScene() {
        val checkpoint = testCheckpoint()
        val payload = LabLoad(templateId = "fixture-template", scene = testScene(), checkpoint = checkpoint)
            .payload("9ddf7d86-e123-4e28-a12a-e999109a6a87")
        assertEquals(setOf("generation", "checkpoint"), payload.keys)
        assertEquals(checkpoint.value, payload["checkpoint"])
    }

    @Test
    fun observationExportIsAValidatedCsvFileNotAJsonOrRawDatasetAlias() {
        val incoming = com.physicsos.student.feature.experiments.bridge.LabIncoming.Export(
            "export-one", "9ddf7d86-e123-4e28-a12a-e999109a6a87", "Lens-observations.csv", "text/csv", "utf8", "condition,reading\r\nfirst,real image\r\n",
        )
        val file = com.physicsos.student.feature.experiments.bridge.LabFilePolicy.validate(incoming,
            com.physicsos.student.feature.experiments.bridge.LabExportFormat.OBSERVATIONS)
        assertEquals("Lens-observations.csv", file.name)
        assertEquals("text/csv", file.mime)
        assertEquals(incoming.content, file.bytes.toString(Charsets.UTF_8))
        assertThrows(IllegalArgumentException::class.java) {
            com.physicsos.student.feature.experiments.bridge.LabFilePolicy.validate(incoming.copy(name = "../outside.csv"),
                com.physicsos.student.feature.experiments.bridge.LabExportFormat.OBSERVATIONS)
        }
    }

    @Test
    fun archiveRetainsHistoryPlaybackAndViewportAndRejectsUnsupportedShapes() {
        val checkpoint = testCheckpoint()
        val archive = parseExperimentArchive(checkpoint.value.toString())
        assertEquals(checkpoint.value, archive.load.checkpoint?.value)
        val legacy = parseExperimentArchive(testScene().toString())
        assertNull(legacy.load.checkpoint)
        assertNotNull(legacy.load.scene)
        assertThrows(IllegalArgumentException::class.java) { parseExperimentArchive("{}") }
    }

    @Test
    fun newerCheckpointWinsAndCompleteHistoryIsAvailableAfterReopening() = runBlocking {
        val auth = TestAuth()
        val store = TestStore()
        val sync = TestSync(auth)
        val account = requireNotNull(auth.state.value.experimentAccount())
        val repository = ExperimentRepository(auth, store, TestApi(), sync, account)
        val newer = testCheckpoint(2, 200)
        repository.persistCheckpoint(account.owner, "scene-1", newer, "Saved experiment", null)
        repository.persistCheckpoint(account.owner, "scene-1", testCheckpoint(1, 100), "Stale writer", null)
        val loaded = repository.load(account.owner, "scene-1")
        assertEquals(newer.value, loaded.load.checkpoint?.value)
        assertEquals("Saved experiment", loaded.entry?.title)
        assertFalse(loaded.legacySceneOnly)
    }

    @Test
    fun oldAccountInstanceCannotWriteAfterTheSameUsernameIsReregistered() = runBlocking {
        val auth = TestAuth()
        val store = TestStore()
        val account = requireNotNull(auth.state.value.experimentAccount())
        val repository = ExperimentRepository(auth, store, TestApi(), TestSync(auth), account)
        auth.state.value = AuthState.SignedIn(testUser(id = "replacement-instance"))
        val error = runCatching { repository.persistCheckpoint(account.owner, "scene-1", testCheckpoint(), "Old account", null) }.exceptionOrNull()
        assertEquals("account_changed", (error as ApiException).code)
        assertEquals(0, store.writes.size)
    }
}
