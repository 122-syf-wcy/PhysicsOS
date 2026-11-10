package com.physicsos.student.feature.experiments

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.ExperimentInfo
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.feature.experiments.bridge.BridgeLimits
import com.physicsos.student.feature.experiments.bridge.LabBridgeProtocol
import com.physicsos.student.feature.experiments.bridge.LabCheckpoint
import com.physicsos.student.feature.experiments.bridge.LabLoad
import com.physicsos.student.feature.experiments.bridge.StrictBridgeJson
import com.physicsos.student.feature.experiments.bridge.integer
import com.physicsos.student.feature.experiments.bridge.objectValue
import com.physicsos.student.feature.experiments.bridge.string
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

internal const val GUEST_EXPERIMENT_OWNER = "guest"
private const val INDEX_KIND = "experiment-scenes"
private const val CHECKPOINT_KIND = "experiment-checkpoints"
private const val SAVED_KIND = "experiment-saved-snapshots"
private const val TOMBSTONE_KIND = "experiment-local-tombstones"
private const val SCENE_PAIR_BYTES = 2 * 1024 * 1024

internal fun AuthState.experimentOwner(): String? = when (this) {
    AuthState.Restoring -> null
    AuthState.SignedOut -> GUEST_EXPERIMENT_OWNER
    is AuthState.SignedIn -> user.userKey
}

internal fun AuthState.experimentIdentity(): String? = when (this) {
    AuthState.Restoring -> null
    AuthState.SignedOut -> GUEST_EXPERIMENT_OWNER
    is AuthState.SignedIn -> "${user.userKey}|${user.userId}"
}

internal data class ExperimentEntry(
    val sceneId: String,
    val title: String,
    val domain: String,
    val stage: String = "",
    val templateId: String? = null,
    val updatedAt: Long,
    val saved: Boolean = false,
    val hasLocal: Boolean = false,
    val hasCheckpoint: Boolean = false,
    val digest: String? = null,
    val savedDigest: String? = null,
    val cloudRevision: Long = 0,
    val syncKey: String? = null,
    val pendingDigest: String? = null,
    val saveRequested: Boolean = false,
    val queueError: String? = null,
    val remoteDeleted: Boolean = false,
) {
    val hasUnsyncedSavedVersion: Boolean get() = savedDigest != null && savedDigest != pendingDigest

    fun payload(): JsonObject = buildJsonObject {
        put("version", 1)
        put("sceneId", sceneId)
        put("title", title)
        put("domain", domain)
        put("stage", stage)
        templateId?.let { put("templateId", it) }
        put("updatedAt", updatedAt)
        put("saved", saved)
        put("hasLocal", hasLocal)
        put("hasCheckpoint", hasCheckpoint)
        digest?.let { put("digest", it) }
        savedDigest?.let { put("savedDigest", it) }
        put("cloudRevision", cloudRevision)
        syncKey?.let { put("syncKey", it) }
        pendingDigest?.let { put("pendingDigest", it) }
        put("saveRequested", saveRequested)
        queueError?.let { put("queueError", it) }
        put("remoteDeleted", remoteDeleted)
    }

    companion object {
        fun parse(id: String, value: JsonObject): ExperimentEntry {
            if (value.integer("version") != 1L || value.string("sceneId", 128) != id) {
                throw ApiException(0, "local_scene_corrupt", "The local scene index is invalid.")
            }
            return ExperimentEntry(
                sceneId = id,
                title = value.string("title", 300),
                domain = value.string("domain", 64),
                stage = value.text("stage").orEmpty(),
                templateId = value.text("templateId"),
                updatedAt = value.integer("updatedAt", 0),
                saved = value.flag("saved"),
                hasLocal = value.flag("hasLocal"),
                hasCheckpoint = value.flag("hasCheckpoint"),
                digest = value.text("digest"),
                savedDigest = value.text("savedDigest"),
                cloudRevision = value.long("cloudRevision") ?: 0,
                syncKey = value.text("syncKey"),
                pendingDigest = value.text("pendingDigest"),
                saveRequested = value.flag("saveRequested"),
                queueError = value.text("queueError"),
                remoteDeleted = value.flag("remoteDeleted"),
            )
        }
    }
}

internal data class LoadedExperiment(val entry: ExperimentEntry?, val load: LabLoad, val legacySceneOnly: Boolean)
internal data class RemoteExperimentPage(val entries: List<ExperimentEntry>, val nextCursor: String?)

/** Full snapshots are fetched one at a time; observable lists contain only small indexes. */
internal class ExperimentRepository(
    private val graph: AppGraph,
    private val boundIdentity: (() -> String?)? = null,
) {
    fun observe(owner: String): Flow<List<ExperimentEntry>> = graph.store.observe(INDEX_KIND, owner).map { items ->
        items.map { ExperimentEntry.parse(it.id, it.payload) }.sortedByDescending { it.updatedAt }
    }

    suspend fun entry(owner: String, sceneId: String): ExperimentEntry? =
        graph.store.get(INDEX_KIND, owner, checkedId(sceneId))?.let { ExperimentEntry.parse(it.id, it.payload) }

    suspend fun load(owner: String, sceneId: String): LoadedExperiment {
        checkedId(sceneId)
        requireOwner(owner)
        requireNotDeleted(owner, sceneId)
        val local = graph.store.get(CHECKPOINT_KIND, owner, sceneId)
        if (local != null) {
            val index = entry(owner, sceneId)
            val checkpoint = local.payload["checkpoint"]
            val load = withContext(Dispatchers.Default) {
                if (checkpoint != null) LabLoad(templateId = index?.templateId, checkpoint = LabBridgeProtocol.checkpoint(checkpoint))
                else LabLoad(
                    scene = LabBridgeProtocol.scene(local.payload.getValue("scene")),
                    originScene = local.payload["originScene"]?.let(LabBridgeProtocol::scene),
                )
            }
            return LoadedExperiment(index, load, checkpoint == null)
        }
        if (owner == GUEST_EXPERIMENT_OWNER) throw ApiException(0, "local_scene_missing", "No local checkpoint is available.")
        return fetchRemote(owner, sceneId, replaceLocal = false)
    }

    suspend fun persistCheckpoint(
        owner: String,
        sceneId: String,
        checkpoint: LabCheckpoint,
        title: String,
        template: ExperimentInfo?,
    ): ExperimentEntry = withContext(Dispatchers.IO) {
        requireOwner(owner)
        val bytes = checkpoint.value.toString().toByteArray(Charsets.UTF_8)
        val digest = digest(bytes)
        mutation.withLock {
            requireOwner(owner)
            requireNotDeleted(owner, sceneId)
            val previous = entry(owner, sceneId)
            val now = checkpoint.receivedOrder.takeIf { it > 0 } ?: System.currentTimeMillis()
            if (previous?.hasLocal == true && now < previous.updatedAt) return@withLock previous
            val index = (previous ?: ExperimentEntry(
                sceneId = checkedId(sceneId), title = title.take(300).ifBlank { checkpoint.scene.string("id", 128) },
                domain = template?.domain ?: sceneDomain(checkpoint.scene), stage = template?.stage.orEmpty(),
                templateId = template?.id ?: checkpoint.templateId, updatedAt = now,
            )).copy(
                title = title.take(300).ifBlank { previous?.title ?: checkpoint.scene.string("id", 128) },
                updatedAt = now, hasLocal = true, hasCheckpoint = true, digest = digest,
            )
            if (previous?.digest != digest || previous?.hasCheckpoint != true) {
                graph.store.put(CHECKPOINT_KIND, owner, sceneId, buildJsonObject {
                    put("version", 1); put("checkpoint", checkpoint.value)
                }, now)
            }
            // Advance receive order even for an identical snapshot, so a delayed
            // older writer cannot replace a more recently acknowledged checkpoint.
            putIndex(owner, index)
            index
        }
    }

    /** Save the exact user-requested snapshot separately from later automatic checkpoints. */
    suspend fun save(owner: String, sceneId: String, checkpoint: LabCheckpoint): ExperimentEntry = withContext(Dispatchers.IO) {
        mutation.withLock {
            requireOwner(owner)
            val current = entry(owner, sceneId) ?: throw ApiException(0, "local_scene_missing", "Save a checkpoint before syncing.")
            val digest = digest(checkpoint.value.toString().toByteArray(Charsets.UTF_8))
            graph.store.put(SAVED_KIND, owner, sceneId, buildJsonObject {
                put("version", 1); put("checkpoint", checkpoint.value); put("digest", digest)
            })
            var saved = current.copy(saved = true, savedDigest = digest, saveRequested = owner != GUEST_EXPERIMENT_OWNER, queueError = null)
            putIndex(owner, saved)
            if (owner != GUEST_EXPERIMENT_OWNER) {
                val operations = graph.sync.observe(owner).first()
                val existing = operations.firstOrNull { it.idempotencyKey == saved.syncKey }
                if (existing == null || existing.state == OutboxState.ACKNOWLEDGED) {
                    if (existing != null) saved = acknowledge(owner, saved, existing)
                    saved = enqueueSaved(owner, saved)
                }
            }
            saved
        }
    }

    /** ACK is real server state; a later explicitly saved revision is queued using its CAS revision. */
    suspend fun reconcile(owner: String, operations: List<OutboxItem>) = withContext(Dispatchers.IO) {
        mutation.withLock {
            requireOwner(owner)
            val byKey = operations.associateBy { it.idempotencyKey }
            val indexes = graph.store.observe(INDEX_KIND, owner).first()
            for (stored in indexes) {
                var index = ExperimentEntry.parse(stored.id, stored.payload)
                val operation = byKey[index.syncKey] ?: continue
                if (operation.state != OutboxState.ACKNOWLEDGED) continue
                val revision = receiptRevision(operation, index.sceneId)
                if (revision > index.cloudRevision || index.saveRequested) {
                    index = acknowledge(owner, index, operation)
                    if (index.saveRequested && index.hasUnsyncedSavedVersion) enqueueSaved(owner, index)
                }
            }
        }
    }

    suspend fun refreshRemote(owner: String, cursor: String? = null): RemoteExperimentPage {
        requireOwner(owner)
        if (owner == GUEST_EXPERIMENT_OWNER) return RemoteExperimentPage(emptyList(), null)
        val query = cursor?.let { "?cursor=${java.net.URLEncoder.encode(it, Charsets.UTF_8.name())}" }.orEmpty()
        val response = graph.api.request("GET", "learning/scenes$query").objectValue()
        val items = response["items"] as? JsonArray ?: throw ApiException(0, "invalid_scene_response", "The scene list response is invalid.")
        val remote = items.map { remoteIndex(it.objectValue()) }
        withContext(Dispatchers.IO) {
            mutation.withLock {
                requireOwner(owner)
                for (item in remote) {
                    val local = entry(owner, item.sceneId)
                    // Discover remote entries, but do not silently replace a local edit
                    // or move its optimistic base revision to an unreviewed cloud head.
                    if (local == null) putIndex(owner, item)
                    else if (!local.hasLocal && local.syncKey == null) putIndex(owner, item)
                    else if (item.remoteDeleted && !local.remoteDeleted) putIndex(owner, local.copy(remoteDeleted = true))
                }
            }
        }
        return RemoteExperimentPage(remote, response.text("nextCursor"))
    }

    suspend fun import(scene: JsonObject, owner: String): String = withContext(Dispatchers.IO) {
        requireOwner(owner)
        val valid = withContext(Dispatchers.Default) {
            LabBridgeProtocol.scene(StrictBridgeJson.parse(scene.toString(), SCENE_PAIR_BYTES))
        }
        val id = UUID.randomUUID().toString()
        val metadata = valid["metadata"] as? JsonObject
        val title = metadata?.text("title") ?: valid.string("id", 128)
        mutation.withLock {
            requireOwner(owner)
            graph.store.put(CHECKPOINT_KIND, owner, id, buildJsonObject { put("version", 1); put("scene", valid) })
            putIndex(owner, ExperimentEntry(
                sceneId = id, title = title.take(300), domain = sceneDomain(valid),
                updatedAt = System.currentTimeMillis(), hasLocal = true,
            ))
        }
        id
    }

    /** Copies preserve the original account/guest partition; copying never silently uploads. */
    suspend fun copyLocal(fromOwner: String, sceneId: String, targetOwner: String, title: String): String = withContext(Dispatchers.IO) {
        requireOwner(targetOwner)
        if (fromOwner != targetOwner && fromOwner != GUEST_EXPERIMENT_OWNER) throw ApiException(0, "account_changed", "Account changed.")
        mutation.withLock {
            requireOwner(targetOwner)
            val source = graph.store.get(CHECKPOINT_KIND, fromOwner, checkedId(sceneId))
                ?: throw ApiException(0, "local_scene_missing", "No local checkpoint is available.")
            val index = entry(fromOwner, sceneId) ?: throw ApiException(0, "local_scene_missing", "No local scene is available.")
            val id = UUID.randomUUID().toString()
            graph.store.put(CHECKPOINT_KIND, targetOwner, id, source.payload)
            putIndex(targetOwner, index.copy(
                sceneId = id, title = title.take(300), updatedAt = System.currentTimeMillis(), saved = false,
                savedDigest = null, cloudRevision = 0, syncKey = null, pendingDigest = null,
                saveRequested = false, queueError = null, remoteDeleted = false,
            ))
            id
        }
    }

    suspend fun useCloud(owner: String, sceneId: String, operation: OutboxItem, backupTitle: String): LoadedExperiment {
        requireOwner(owner)
        // Fetch first. A failed download must leave both local content and the outbox untouched.
        val remote = fetchRemotePayload(owner, sceneId)
        copyLocal(owner, sceneId, owner, backupTitle)
        val loaded = installRemote(owner, remote, replaceLocal = true)
        graph.sync.discard(operation.id)
        return loaded
    }

    suspend fun retry(owner: String, sceneId: String, operation: OutboxItem?) {
        requireOwner(owner)
        if (operation != null && operation.state != OutboxState.ACKNOWLEDGED) graph.sync.retry(operation.id)
        else withContext(Dispatchers.IO) {
            mutation.withLock {
                val index = entry(owner, sceneId) ?: return@withLock
                enqueueSaved(owner, index.copy(saveRequested = true))
            }
        }
        graph.sync.syncNow()
    }

    suspend fun removeLocal(owner: String, sceneId: String) = withContext(Dispatchers.IO) {
        mutation.withLock {
            requireOwner(owner)
            val id = checkedId(sceneId)
            val index = entry(owner, id)
            val unresolved = graph.sync.observe(owner).first().any {
                it.path == "learning/scenes/$id" && it.state != OutboxState.ACKNOWLEDGED
            }
            if (unresolved || (index != null && index.cloudRevision > 0 && !index.remoteDeleted)) {
                throw ApiException(0, "scene_removal_requires_resolution", "Resolve cloud synchronization before removing this local scene.")
            }
            graph.store.put(TOMBSTONE_KIND, owner, id, buildJsonObject { put("deletedAt", System.currentTimeMillis()) })
            graph.store.delete(CHECKPOINT_KIND, owner, id)
            graph.store.delete(SAVED_KIND, owner, id)
            graph.store.delete(INDEX_KIND, owner, id)
        }
    }

    private suspend fun requireNotDeleted(owner: String, sceneId: String) {
        if (graph.store.get(TOMBSTONE_KIND, owner, sceneId) != null) {
            throw ApiException(0, "local_scene_removed", "This local scene was explicitly removed.")
        }
    }

    private suspend fun fetchRemote(owner: String, sceneId: String, replaceLocal: Boolean): LoadedExperiment =
        installRemote(owner, fetchRemotePayload(owner, sceneId), replaceLocal)

    private suspend fun fetchRemotePayload(owner: String, sceneId: String): JsonObject {
        requireOwner(owner)
        val response = graph.api.request("GET", "learning/scenes/${checkedId(sceneId)}").objectValue()
        requireOwner(owner)
        val item = response["item"]?.objectValue() ?: throw ApiException(0, "invalid_scene_response", "The scene response is invalid.")
        if (item.string("sceneId", 128) != sceneId) throw ApiException(0, "invalid_scene_response", "The scene identifier does not match.")
        return item
    }

    private suspend fun installRemote(owner: String, item: JsonObject, replaceLocal: Boolean): LoadedExperiment = withContext(Dispatchers.IO) {
        val remote = remoteIndex(item)
        val checkpoint = item["checkpoint"]?.let { LabBridgeProtocol.checkpoint(it) }
        val scene = LabBridgeProtocol.scene(item.getValue("scene"))
        val originScene = item["originScene"]?.let(LabBridgeProtocol::scene)
        val raw = buildJsonObject {
            put("version", 1)
            if (checkpoint != null) put("checkpoint", checkpoint.value) else {
                put("scene", scene)
                originScene?.let { put("originScene", it) }
            }
        }
        val index = remote.copy(
            hasLocal = true, hasCheckpoint = checkpoint != null,
            templateId = checkpoint?.templateId,
            digest = checkpoint?.value?.toString()?.toByteArray(Charsets.UTF_8)?.let(::digest),
        )
        mutation.withLock {
            requireOwner(owner)
            if (!replaceLocal && graph.store.get(CHECKPOINT_KIND, owner, remote.sceneId) != null) {
                throw ApiException(0, "local_scene_changed", "A local checkpoint arrived while the cloud scene was loading.")
            }
            graph.store.put(CHECKPOINT_KIND, owner, remote.sceneId, raw)
            putIndex(owner, index)
            if (replaceLocal) graph.store.delete(SAVED_KIND, owner, remote.sceneId)
        }
        LoadedExperiment(index, LabLoad(
            templateId = checkpoint?.templateId, scene = if (checkpoint == null) scene else null,
            checkpoint = checkpoint, originScene = if (checkpoint == null) originScene else null,
        ), checkpoint == null)
    }

    private suspend fun acknowledge(owner: String, index: ExperimentEntry, operation: OutboxItem): ExperimentEntry {
        val revision = receiptRevision(operation, index.sceneId)
        val changed = index.copy(
            cloudRevision = maxOf(index.cloudRevision, revision),
            saveRequested = index.savedDigest != index.pendingDigest,
            queueError = null,
        )
        if (changed != index) putIndex(owner, changed)
        return changed
    }

    private suspend fun enqueueSaved(owner: String, index: ExperimentEntry): ExperimentEntry {
        requireOwner(owner)
        if (owner == GUEST_EXPERIMENT_OWNER || !index.saveRequested) return index
        val saved = graph.store.get(SAVED_KIND, owner, index.sceneId)
            ?: throw ApiException(0, "saved_snapshot_missing", "The saved snapshot is unavailable.")
        val checkpoint = LabBridgeProtocol.checkpoint(saved.payload.getValue("checkpoint"))
        val key = UUID.randomUUID().toString()
        var pending = index.copy(syncKey = key, pendingDigest = saved.payload.string("digest", 64), queueError = null)
        try {
            val body = sceneBody(pending, checkpoint)
            // Persist intent before enqueue; an interrupted enqueue remains visibly local,
            // and can be retried without pretending a server receipt exists.
            putIndex(owner, pending)
            graph.sync.enqueue("PUT", "learning/scenes/${checkedId(index.sceneId)}", body, key)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            pending = pending.copy(queueError = (error as? ApiException)?.code ?: (error as? com.physicsos.student.feature.experiments.bridge.BridgeProtocolException)?.code ?: "sync_enqueue_failed")
            putIndex(owner, pending)
        }
        return pending
    }

    private suspend fun putIndex(owner: String, entry: ExperimentEntry) {
        graph.store.put(INDEX_KIND, owner, checkedId(entry.sceneId), entry.payload(), entry.updatedAt)
    }

    private fun requireOwner(owner: String) {
        val current = graph.auth.state.value
        if (current.experimentOwner() != owner || (boundIdentity != null && current.experimentIdentity() != boundIdentity.invoke())) {
            throw ApiException(0, "account_changed", "Account changed.")
        }
    }

    companion object {
        // Serializes index read/modify/write across list, detail and navigation imports.
        private val mutation = Mutex()

        fun sceneBody(index: ExperimentEntry, checkpoint: LabCheckpoint): JsonObject {
            StrictBridgeJson.utf8Size(JsonArray(listOf(checkpoint.scene, checkpoint.originScene)).toString(), SCENE_PAIR_BYTES)
            StrictBridgeJson.utf8Size(checkpoint.value.toString(), BridgeLimits.CHECKPOINT_BYTES)
            return buildJsonObject {
                put("sceneId", index.sceneId)
                put("title", index.title)
                put("domain", index.domain)
                put("kind", "experiment")
                put("updatedAt", Instant.ofEpochMilli(index.updatedAt).toString())
                put("scene", checkpoint.scene)
                put("originScene", checkpoint.originScene)
                put("checkpoint", checkpoint.value)
                if ((checkpoint.value["editing"] as? JsonObject)?.text("buildMode") == "construct") put("buildMode", true)
                put("baseRevision", index.cloudRevision)
            }.also { StrictBridgeJson.utf8Size(it.toString(), BridgeLimits.MESSAGE_BYTES) }
        }

        private fun receiptRevision(operation: OutboxItem, sceneId: String): Long {
            val item = (operation.result as? JsonObject)?.get("item") as? JsonObject
                ?: throw ApiException(0, "invalid_sync_receipt", "The server did not return a scene receipt.")
            if (item.text("sceneId") != sceneId) throw ApiException(0, "invalid_sync_receipt", "The scene receipt does not match.")
            return item.integer("revision", 1)
        }

        private fun remoteIndex(item: JsonObject): ExperimentEntry = ExperimentEntry(
            sceneId = checkedId(item.string("sceneId", 128)),
            title = item.string("title", 300), domain = item.string("domain", 64),
            updatedAt = runCatching { Instant.parse(item.string("updatedAt", 64)).toEpochMilli() }
                .getOrElse { throw ApiException(0, "invalid_scene_response", "The scene timestamp is invalid.") },
            saved = true, cloudRevision = item.integer("revision", 1),
            hasCheckpoint = item.flag("hasCheckpoint"),
            remoteDeleted = item.text("deletedAt") != null,
        )

        private fun checkedId(value: String): String {
            if (!Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}").matches(value)) throw ApiException(0, "invalid_scene_id", "Invalid scene identifier.")
            return value
        }

        private fun sceneDomain(scene: JsonObject): String =
            (scene["metadata"] as? JsonObject)?.text("domain")?.takeIf { it.isNotBlank() && it.length <= 64 } ?: "custom"

        private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}

/** Native navigation imports real scene data without knowing storage keys or credentials. */
suspend fun importScene(graph: AppGraph, scene: JsonObject): String {
    val owner = graph.auth.state.first { it !is AuthState.Restoring }.experimentOwner()
        ?: throw ApiException(0, "account_restoring", "Account restoration has not completed.")
    return ExperimentRepository(graph).import(scene, owner)
}

internal fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
internal fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull
internal fun JsonObject.flag(key: String): Boolean = (this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull == true
