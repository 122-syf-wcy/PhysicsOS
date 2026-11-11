package com.physicsos.student.feature.experiments

import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AuthRepository
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.CachedPage
import com.physicsos.student.core.DownloadRecord
import com.physicsos.student.core.LocalStore
import com.physicsos.student.core.MobileClient
import com.physicsos.student.core.MobileUser
import com.physicsos.student.core.OutboxItem
import com.physicsos.student.core.OutboxState
import com.physicsos.student.core.StoredCursor
import com.physicsos.student.core.StoredItem
import com.physicsos.student.core.StoredPage
import com.physicsos.student.core.SyncCoordinator
import com.physicsos.student.feature.experiments.bridge.LabBridgeProtocol
import com.physicsos.student.feature.experiments.bridge.LabCheckpoint
import com.physicsos.student.feature.experiments.bridge.StrictBridgeJson
import com.physicsos.student.feature.experiments.bridge.objectValue
import java.io.File
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.WebSocket
import okhttp3.WebSocketListener

internal fun testUser(id: String = "account-instance-1", key: String = "school:student") = MobileUser(
    userKey = key, schoolId = "school", username = "student", displayName = "Student", role = "student", userId = id,
)

/** Structural empty-scene fixture mirrors physics-workbench/tests/scene-fixtures.ts; no engine is mocked. */
internal fun testScene(revision: Long = 0): JsonObject = StrictBridgeJson.parse("""
    {"schemaVersion":"physics-scene/1.0","id":"fixture-scene","revision":$revision,"dimension":"2d",
     "coordinateSystem":{"type":"cartesian","origin":{"x":0,"y":0,"z":0},
       "axes":{"x":{"x":1,"y":0,"z":0},"y":{"x":0,"y":1,"z":0},"z":{"x":0,"y":0,"z":1}},"lengthUnit":"m"},
     "timeline":{"currentTime":{"value":0,"unit":"s","dimension":"time"},"startTime":{"value":0,"unit":"s","dimension":"time"},
       "endTime":{"value":0,"unit":"s","dimension":"time"},"state":"idle","playbackRate":1},
     "bodies":[],"particles":[],"fields":[],"forces":[],"regions":[],"boundaries":[],"constraints":[],"circuits":[],
     "opticalBenches":[],"acousticBenches":[],"fluidTanks":[],"thermalBenches":[],"leverBenches":[],
     "measurementDefinitions":[],"observableDefinitions":[],"annotations":[],
     "metadata":{"createdAt":"2026-11-08T10:00:00.000Z","updatedAt":"2026-11-08T10:00:00.000Z","title":"实验 Fixture"}}
""".trimIndent()).objectValue()

internal fun testCheckpoint(revision: Long = 1, order: Long = 100): LabCheckpoint {
    val scene = testScene(revision)
    val before = testScene(0)
    return LabBridgeProtocol.checkpoint(buildJsonObject {
        put("version", 1)
        put("scene", scene)
        put("originScene", before)
        put("templateId", "fixture-template")
        put("playback", StrictBridgeJson.parse("""{"time":2,"duration":10,"rate":1,"running":false}"""))
        put("history", buildJsonObject {
            put("past", kotlinx.serialization.json.JsonArray(listOf(buildJsonObject {
                put("id", "edit-1"); put("label", "Edit"); put("before", before); put("after", scene)
                put("beforeDraft", buildJsonObject { put("note", "retained-before") })
                put("afterDraft", buildJsonObject { put("note", "retained-after") })
            })))
            put("future", kotlinx.serialization.json.JsonArray(emptyList()))
        })
        put("editing", StrictBridgeJson.parse("""{"instanceKey":"fixture-instance","instanceEditRevision":1,
          "source":{"kind":"blank"},"buildMode":"construct","selectedIds":[],"observables":{},
          "viewport":{"x":12,"y":-4,"zoom":1.5},"activePanel":"data","draft":{"note":"retained-draft"}}"""))
    }).also { it.receivedOrder = order }
}

internal class TestAuth(initial: AuthState = AuthState.SignedIn(testUser())) : AuthRepository {
    override val state = MutableStateFlow(initial)
    override val lastError = MutableStateFlow<ApiException?>(null)
    override suspend fun login(body: JsonObject): JsonObject = error("No real authentication in isolated tests")
    override suspend fun register(body: JsonObject): JsonObject = error("No real authentication in isolated tests")
    override suspend fun verifyTwoFactor(body: JsonObject): JsonObject = error("No real authentication in isolated tests")
    override suspend fun restore() = Unit
    override suspend fun logout() { state.value = AuthState.SignedOut }
    override suspend fun refreshUser() = Unit
    override suspend fun exportData(): JsonObject = error("Not used")
    override suspend fun deleteAccount(body: JsonObject): JsonObject = error("Not used")
}

internal class TestStore : LocalStore {
    private val rows = MutableStateFlow<Map<Triple<String, String, String>, StoredItem>>(emptyMap())
    val writes = mutableListOf<Triple<String, String, String>>()
    var afterRead: suspend (String, String, String) -> Unit = { _, _, _ -> }
    override fun observe(kind: String, owner: String): Flow<List<StoredItem>> = rows.map { all ->
        all.filterKeys { it.first == kind && it.second == owner }.values.toList()
    }
    override suspend fun get(kind: String, owner: String, id: String): StoredItem? {
        val item = rows.value[Triple(kind, owner, id)]
        afterRead(kind, owner, id)
        return item
    }
    override suspend fun put(kind: String, owner: String, id: String, payload: JsonObject, updatedAt: Long) {
        val key = Triple(kind, owner, id)
        writes += key
        rows.value = rows.value + (key to StoredItem(id, payload, updatedAt))
    }
    override suspend fun delete(kind: String, owner: String, id: String) { rows.value = rows.value - Triple(kind, owner, id) }
    override suspend fun page(kind: String, owner: String, limit: Int, before: StoredCursor?): StoredPage = error("Not used")
    override suspend fun cachePage(kind: String, owner: String, cursor: String?, payload: JsonObject, nextCursor: String?, updatedAt: Long) = error("Not used")
    override suspend fun cachedPage(kind: String, owner: String, cursor: String?): CachedPage? = error("Not used")
    override suspend fun clearCache(owner: String) = Unit
    override suspend fun clearOwner(owner: String) { rows.value = rows.value.filterKeys { it.second != owner } }
    override suspend fun exportOwner(owner: String): JsonObject = error("Not used")
    override fun observeDownloads(owner: String): Flow<List<DownloadRecord>> = MutableStateFlow(emptyList())
    override suspend fun getDownload(owner: String, id: String): DownloadRecord? = null
    override suspend fun putDownload(record: DownloadRecord) = error("Not used")
    override suspend fun deleteDownload(owner: String, id: String) = error("Not used")
}

internal class TestApi : MobileClient {
    var calls = 0
    var response: suspend (String, String) -> JsonElement = { _, _ -> throw ApiException(0, "network_unavailable", "Isolated offline test") }
    override suspend fun request(method: String, path: String, body: JsonElement?, authenticated: Boolean): JsonElement { calls++; return response(method, path) }
    override suspend fun rpc(method: String, request: JsonObject): JsonElement = error("No RPC in isolated tests")
    override suspend fun upload(sessionId: String, file: File, name: String, onProgress: (Long, Long) -> Unit): JsonObject = error("No uploads in isolated tests")
    override suspend fun download(path: String, destination: File, maxBytes: Long, onProgress: (Long, Long?) -> Unit): JsonObject = error("No downloads in isolated tests")
    override suspend fun connectMux(listener: WebSocketListener): WebSocket = error("No sockets in isolated tests")
}

internal class TestSync(private val auth: TestAuth) : SyncCoordinator {
    data class Queued(val method: String, val path: String, val body: JsonObject?, val key: String)
    val queue = mutableListOf<Queued>()
    val operations = MutableStateFlow<List<OutboxItem>>(emptyList())
    val discarded = mutableListOf<String>()
    var syncCalls = 0
    var enqueueError: ApiException? = null
    override suspend fun enqueue(method: String, path: String, body: JsonObject?, idempotencyKey: String) {
        enqueueError?.let { throw it }
        queue += Queued(method, path, body, idempotencyKey)
        operations.value += testOperation(requireNotNull(auth.state.value.experimentOwner()), path.substringAfterLast('/'), idempotencyKey)
    }
    override suspend fun syncNow() { syncCalls++ }
    override fun observe(owner: String): Flow<List<OutboxItem>> = operations.map { all -> all.filter { it.owner == owner } }
    override suspend fun operationBody(id: String): JsonObject? = queue.firstOrNull { it.key == id }?.body
    override suspend fun retry(id: String) {
        operations.value = operations.value.map { if (it.id == id) it.copy(state = OutboxState.PENDING) else it }
    }
    override suspend fun discard(id: String) { discarded += id; operations.value = operations.value.filterNot { it.id == id } }
    override suspend fun resolveConflict(id: String, body: JsonObject?, idempotencyKey: String) = error("No automatic conflict overwrite")
}

internal fun testOperation(owner: String, sceneId: String, key: String, state: OutboxState = OutboxState.PENDING, revision: Long = 1): OutboxItem = OutboxItem(
    id = key, owner = owner, method = "PUT", path = "learning/scenes/$sceneId", idempotencyKey = key, state = state,
    attempts = 0, createdAt = 100, updatedAt = 100, nextAttemptAt = 0, errorStatus = null, errorCode = null,
    errorMessage = null, errorDetails = null, result = if (state == OutboxState.ACKNOWLEDGED) buildJsonObject {
        put("item", buildJsonObject { put("sceneId", sceneId); put("revision", revision) })
    } else null,
)
