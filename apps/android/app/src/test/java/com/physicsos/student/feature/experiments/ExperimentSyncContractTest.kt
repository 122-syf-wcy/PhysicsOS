package com.physicsos.student.feature.experiments

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.experiments.bridge.LabBridgeProtocol
import com.physicsos.student.feature.experiments.bridge.LabCheckpoint
import com.physicsos.student.feature.experiments.bridge.objectValue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExperimentSyncContractTest {
    private class Fixture {
        val auth = TestAuth()
        val store = TestStore()
        val api = TestApi()
        val sync = TestSync(auth)
        val account = requireNotNull(auth.state.value.experimentAccount())
        val repository = ExperimentRepository(auth, store, api, sync, account)
    }

    private fun completeCheckpoint(): LabCheckpoint {
        val checkpoint = testCheckpoint()
        val history = checkpoint.value.getValue("history").objectValue()
        val past = history.getValue("past") as JsonArray
        val future = JsonObject(past.first().objectValue() + ("id" to JsonPrimitive("future-edit")))
        return LabBridgeProtocol.checkpoint(JsonObject(checkpoint.value + ("history" to JsonObject(history + ("future" to JsonArray(listOf(future)))))))
    }

    private fun assertAllSceneIdentities(body: JsonObject, expectedId: String, original: LabCheckpoint) {
        assertEquals(expectedId, body.text("sceneId"))
        val cloud = body.getValue("checkpoint").objectValue()
        for (key in listOf("scene", "originScene")) {
            assertEquals(expectedId, body.getValue(key).objectValue().text("id"))
            assertEquals(body[key], cloud[key])
            assertEquals(original.value.getValue(key).objectValue().filterKeys { it != "id" }, cloud.getValue(key).objectValue().filterKeys { it != "id" })
        }
        assertEquals(original.value["playback"], cloud["playback"])
        assertEquals(original.value["editing"], cloud["editing"])
        val oldHistory = original.value.getValue("history").objectValue()
        val newHistory = cloud.getValue("history").objectValue()
        for (direction in listOf("past", "future")) {
            val oldEntries = oldHistory.getValue(direction) as JsonArray
            val newEntries = newHistory.getValue(direction) as JsonArray
            assertEquals(oldEntries.size, newEntries.size)
            oldEntries.zip(newEntries).forEach { (old, new) ->
                val before = old.objectValue()
                val after = new.objectValue()
                assertEquals(before.filterKeys { it !in setOf("before", "after") }, after.filterKeys { it !in setOf("before", "after") })
                for (snapshot in listOf("before", "after")) {
                    assertEquals(expectedId, after.getValue(snapshot).objectValue().text("id"))
                    assertEquals(before.getValue(snapshot).objectValue().filterKeys { it != "id" }, after.getValue(snapshot).objectValue().filterKeys { it != "id" })
                }
            }
        }
        assertEquals("fixture-scene", original.scene.text("id"))
    }

    @Test fun newRendererImportAndCopyUploadOneIdentityWithoutDiscardingHistoryOrMutatingLocalData() = runBlocking {
        val f = Fixture()
        val checkpoint = completeCheckpoint()
        f.repository.persistCheckpoint(f.account.owner, "native-new", checkpoint, "New experiment", null)
        f.repository.save(f.account.owner, "native-new", checkpoint)
        assertAllSceneIdentities(requireNotNull(f.sync.queue.last().body), "native-new", checkpoint)
        assertEquals(checkpoint.value, f.repository.load(f.account.owner, "native-new").load.checkpoint?.value)

        val imported = f.repository.importArchive(parseExperimentArchive(checkpoint.value.toString()), f.account.owner)
        val importedCheckpoint = requireNotNull(f.repository.load(f.account.owner, imported).load.checkpoint)
        f.repository.save(f.account.owner, imported, importedCheckpoint)
        assertAllSceneIdentities(requireNotNull(f.sync.queue.last().body), imported, checkpoint)

        val copied = f.repository.copyLocal(f.account.owner, imported, f.account.owner, "Copy")
        assertNotEquals(imported, copied)
        val copiedCheckpoint = requireNotNull(f.repository.load(f.account.owner, copied).load.checkpoint)
        f.repository.save(f.account.owner, copied, copiedCheckpoint)
        assertAllSceneIdentities(requireNotNull(f.sync.queue.last().body), copied, checkpoint)
    }

    @Test fun replayAcknowledgesOnlyAppliedRevisionSoFollowUpConflictsWithUnseenHead() = runBlocking {
        val f = Fixture()
        val first = testCheckpoint(1, 100)
        f.repository.persistCheckpoint(f.account.owner, "native-one", first, "First", null)
        f.repository.save(f.account.owner, "native-one", first)
        val later = testCheckpoint(2, 200)
        f.repository.persistCheckpoint(f.account.owner, "native-one", later, "Later explicit save", null)
        f.repository.save(f.account.owner, "native-one", later)
        assertEquals(1, f.sync.queue.size)
        val key = f.sync.queue.first().key
        val replay = testOperation(f.account.owner, "native-one", key, OutboxState.ACKNOWLEDGED).copy(result = buildJsonObject {
            put("replayed", true); put("appliedRevision", 1)
            put("item", buildJsonObject { put("sceneId", "native-one"); put("revision", 2) })
        })
        f.sync.operations.value = listOf(replay)
        f.repository.reconcile(f.account.owner, listOf(replay))
        assertEquals(2, f.sync.queue.size)
        assertEquals(1L, f.sync.queue.last().body?.long("baseRevision"))
        assertEquals(1L, f.repository.entry(f.account.owner, "native-one")?.cloudRevision)
        assertEquals(later.value, f.repository.load(f.account.owner, "native-one").load.checkpoint?.value)
    }

    @Test fun mixedTombstonePageKeepsLocalMetadataAndReviewedBaseWhileAdvancingCursor() = runBlocking {
        val f = Fixture()
        f.repository.persistCheckpoint(f.account.owner, "local-one", testCheckpoint(), "Retain this title", null)
        f.repository.save(f.account.owner, "local-one", testCheckpoint())
        val ack = testOperation(f.account.owner, "local-one", f.sync.queue.last().key, OutboxState.ACKNOWLEDGED)
        f.sync.operations.value = listOf(ack)
        f.repository.reconcile(f.account.owner, listOf(ack))
        f.api.response = { _, _ -> buildJsonObject {
            put("nextCursor", "next-page")
            put("items", JsonArray(listOf(
                buildJsonObject { put("sceneId", "live"); put("title", "Cloud scene"); put("domain", "mechanics"); put("updatedAt", "2026-11-08T10:00:00Z"); put("revision", 1) },
                tombstone("local-one", 2), tombstone("never-local", 1),
            )))
        } }
        val page = f.repository.refreshRemote(f.account.owner)
        assertEquals("next-page", page.nextCursor)
        val local = requireNotNull(f.repository.entry(f.account.owner, "local-one"))
        assertEquals("Retain this title", local.title)
        assertEquals(1L, local.cloudRevision)
        assertTrue(local.remoteDeleted)
        assertFalse(requireNotNull(f.repository.entry(f.account.owner, "live")).remoteDeleted)
        assertNull(f.repository.entry(f.account.owner, "never-local"))
        f.repository.removeLocal(f.account.owner, "local-one")
        assertNull(f.repository.entry(f.account.owner, "local-one"))
    }

    @Test fun realDeletionReceiptAllowsRecordsLocalRemovalWithoutAnUnrelatedListRefresh() = runBlocking {
        val f = Fixture()
        f.repository.persistCheckpoint(f.account.owner, "local-one", testCheckpoint(), "Saved", null)
        f.repository.save(f.account.owner, "local-one", testCheckpoint())
        val ack = testOperation(f.account.owner, "local-one", f.sync.queue.last().key, OutboxState.ACKNOWLEDGED)
        f.sync.operations.value = listOf(ack)
        f.repository.reconcile(f.account.owner, listOf(ack))
        val deleted = testOperation(f.account.owner, "local-one", "delete-key", OutboxState.ACKNOWLEDGED).copy(method = "DELETE", result = buildJsonObject {
            put("item", tombstone("local-one", 2)); put("appliedRevision", 2); put("replayed", false)
        })
        f.sync.operations.value = listOf(ack, deleted)
        f.repository.removeLocal(f.account.owner, "local-one")
        assertNull(f.repository.entry(f.account.owner, "local-one"))
    }

    @Test fun incompleteAcknowledgementNeverAdvancesCloudBase() = runBlocking {
        val f = Fixture()
        f.repository.persistCheckpoint(f.account.owner, "local-one", testCheckpoint(), "Saved", null)
        f.repository.save(f.account.owner, "local-one", testCheckpoint())
        val bad = testOperation(f.account.owner, "local-one", f.sync.queue.last().key, OutboxState.ACKNOWLEDGED).copy(result = buildJsonObject {
            put("item", buildJsonObject { put("sceneId", "local-one"); put("revision", 99) })
        })
        val error = runCatching { f.repository.reconcile(f.account.owner, listOf(bad)) }.exceptionOrNull()
        assertEquals("invalid_sync_receipt", (error as ApiException).code)
        assertEquals(0L, f.repository.entry(f.account.owner, "local-one")?.cloudRevision)
    }

    private fun tombstone(id: String, revision: Int): JsonObject = buildJsonObject {
        put("sceneId", id); put("revision", revision)
        put("savedAt", "2026-11-08T11:00:00Z"); put("deletedAt", "2026-11-08T11:00:00Z")
    }
}
