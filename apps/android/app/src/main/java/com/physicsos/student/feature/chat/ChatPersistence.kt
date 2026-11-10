package com.physicsos.student.feature.chat

import com.physicsos.student.core.LocalStore
import com.physicsos.student.core.StoredCursor
import com.physicsos.student.feature.files.PreparedAttachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

@Serializable
internal data class ChatDraft(
    val id: String,
    val text: String = "",
    val attachments: List<PreparedAttachment> = emptyList(),
)

internal class ChatCache(private val store: LocalStore, private val owner: String) {
    suspend fun load(sessionId: String): ChatJournal? = withContext(Dispatchers.IO) {
        val meta = store.get(STATE_KIND, owner, sessionId)?.payload ?: return@withContext null
        val floor = meta.requiredNumber("firstSeq")
        val cursor = meta.requiredNumber("cursor")
        val records = ArrayList<JournalEvent>()
        var before: StoredCursor? = null
        while (cursor >= 0) {
            val page = store.page(recordKind(sessionId), owner, 100, before)
            for (record in page.items) {
                val event = SessionProtocol.rawEvent(record.payload)
                if (event.seq in floor..cursor) records.add(event)
            }
            if (page.nextCursor == null || page.items.any { it.updatedAt <= floor }) break
            before = page.nextCursor
        }
        records.sortBy { it.seq }
        if (cursor >= 0 && records.firstOrNull()?.seq != floor) fail("cache_prefix_missing")
        ChatJournal().also { it.restore(meta, records) }
    }

    suspend fun save(sessionId: String, journal: ChatJournal) = withContext(Dispatchers.IO) {
        if (journal.header.isEmpty()) return@withContext
        val records = journal.dirtyRecords()
        val checkpoint = journal.checkpoint()
        for (event in records) {
            store.put(recordKind(sessionId), owner, event.seq.toString().padStart(16, '0'), event.raw, event.seq)
        }
        // Never persist a cursor before every event it acknowledges is durable.
        store.put(STATE_KIND, owner, sessionId, checkpoint)
        journal.acknowledgePersisted(records)
    }

    suspend fun saveDraft(sessionId: String?, draft: ChatDraft) = withContext(Dispatchers.IO) {
        store.put(DRAFT_KIND, owner, sessionId ?: NEW_DRAFT, sessionJson.parseToJsonElement(sessionJson.encodeToString(draft)).jsonObject)
    }

    suspend fun draft(sessionId: String?): ChatDraft? = withContext(Dispatchers.IO) {
        store.get(DRAFT_KIND, owner, sessionId ?: NEW_DRAFT)?.payload?.let {
            sessionJson.decodeFromString<ChatDraft>(it.toString())
        }
    }

    suspend fun clearDraft(sessionId: String?) { store.delete(DRAFT_KIND, owner, sessionId ?: NEW_DRAFT) }

    suspend fun sessions(): List<SessionListItem> {
        val saved = store.get(DIRECTORY_KIND, owner, "list")?.payload ?: return emptyList()
        val archived = saved.array("archived")?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }?.toSet().orEmpty()
        return SessionProtocol.list(saved, archived)
    }

    suspend fun saveSessions(value: JsonObject) { store.put(DIRECTORY_KIND, owner, "list", value) }

    suspend fun creationState(): JsonObject? = store.get(STATE_KIND, owner, "pending-create")?.payload
    suspend fun saveCreation(value: JsonObject) { store.put(STATE_KIND, owner, "pending-create", value) }
    suspend fun clearCreation() { store.delete(STATE_KIND, owner, "pending-create") }

    companion object {
        private const val STATE_KIND = "chat.session-state"
        private const val DRAFT_KIND = "chat.draft"
        private const val DIRECTORY_KIND = "chat.directory"
        private const val NEW_DRAFT = "new"
        private fun recordKind(sessionId: String) = "chat.record.$sessionId"
    }
}

internal interface PromptStorage {
    suspend fun get(id: String): PromptTicket?
    suspend fun put(ticket: PromptTicket)
    suspend fun list(): List<PromptTicket>
}

internal class LocalPromptStorage(private val store: LocalStore, private val owner: String) : PromptStorage {
    override suspend fun get(id: String): PromptTicket? = withContext(Dispatchers.IO) {
        store.get(KIND, owner, id)?.payload?.let { sessionJson.decodeFromString<PromptTicket>(it.toString()) }
    }
    override suspend fun put(ticket: PromptTicket) = withContext(Dispatchers.IO) {
        store.put(KIND, owner, ticket.id, sessionJson.parseToJsonElement(sessionJson.encodeToString(ticket)).jsonObject)
    }
    override suspend fun list(): List<PromptTicket> = withContext(Dispatchers.IO) {
        store.observe(KIND, owner).first().map { sessionJson.decodeFromString<PromptTicket>(it.payload.toString()) }
    }
    companion object { private const val KIND = "chat.prompt" }
}
