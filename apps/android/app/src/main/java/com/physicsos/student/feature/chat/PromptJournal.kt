package com.physicsos.student.feature.chat

import com.physicsos.student.feature.files.AttachmentKind
import com.physicsos.student.feature.files.AttachmentPolicy
import com.physicsos.student.feature.files.FileIntake
import com.physicsos.student.feature.files.FileOperationException
import com.physicsos.student.feature.files.FileProblem
import com.physicsos.student.feature.files.IntakeLimits
import com.physicsos.student.feature.files.PreparedAttachment
import com.physicsos.student.feature.files.sha256
import com.physicsos.student.feature.files.verifyLocal
import java.time.ZoneId
import java.util.Base64
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
internal enum class PromptStatus { PREPARED, SENDING, UNCERTAIN, ACCEPTED, CONFIRMED, REJECTED, DISCARDED }

@Serializable
internal data class PromptTicket(
    val id: String,
    /** Persisted business identity; MobileClient independently mints each transport rpcId. */
    val requestId: String,
    val sessionId: String,
    val draftId: String,
    val text: String,
    val attachments: List<PreparedAttachment>,
    val mode: String,
    val baseSeq: Long,
    val createdAt: Long,
    val status: PromptStatus = PromptStatus.PREPARED,
    val attempts: Int = 0,
    val errorCode: String? = null,
)

/** No replay loop: only an explicit user send/retry may transition a ticket to SENDING. */
internal class PromptJournal(
    private val storage: PromptStorage,
    private val nextId: () -> String = { UUID.randomUUID().toString() },
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()

    suspend fun prepare(sessionId: String, draft: ChatDraft, mode: String, baseSeq: Long): PromptTicket = mutex.withLock {
        require(mode == "queue" || mode == "steer")
        require(draft.text.isNotBlank() || draft.attachments.isNotEmpty())
        val identity = sha256(buildString {
            append(sessionId).append('\u0000').append(draft.id).append('\u0000').append(mode).append('\u0000').append(draft.text)
            for (attachment in draft.attachments) append('\u0000').append(attachment.id).append(':').append(attachment.sha256)
        }.toByteArray(Charsets.UTF_8))
        storage.get(identity)?.let { return@withLock it }
        val ticket = PromptTicket(identity, nextId(), sessionId, draft.id, draft.text, draft.attachments, mode, baseSeq, now())
        storage.put(ticket)
        ticket
    }

    suspend fun list(sessionId: String): List<PromptTicket> = storage.list().filter { it.sessionId == sessionId }.sortedBy { it.createdAt }

    suspend fun recoverInterrupted(): Unit = mutex.withLock {
        for (ticket in storage.list()) {
            if (ticket.status == PromptStatus.SENDING) storage.put(ticket.copy(status = PromptStatus.UNCERTAIN))
        }
    }

    suspend fun begin(ticket: PromptTicket, explicitRetry: Boolean = false): PromptTicket? = mutex.withLock {
        val current = storage.get(ticket.id) ?: return@withLock null
        val allowed = current.status == PromptStatus.PREPARED ||
            (explicitRetry && current.status in setOf(PromptStatus.UNCERTAIN, PromptStatus.REJECTED))
        if (!allowed) return@withLock null
        current.copy(status = PromptStatus.SENDING, attempts = current.attempts + 1, errorCode = null).also { storage.put(it) }
    }

    suspend fun attachments(ticket: PromptTicket, attachments: List<PreparedAttachment>): PromptTicket = mutex.withLock {
        val current = storage.get(ticket.id) ?: fail("prompt_missing")
        // Receipt renewal may change wire authority, never the user's immutable bytes or prompt identity.
        if (current.attachments.map { it.id to it.sha256 } != attachments.map { it.id to it.sha256 }) fail("prompt_content_changed")
        current.copy(attachments = attachments).also { storage.put(it) }
    }

    suspend fun accepted(ticket: PromptTicket) = update(ticket) { current ->
        if (current.status == PromptStatus.CONFIRMED) current else current.copy(status = PromptStatus.ACCEPTED, errorCode = null)
    }

    suspend fun failed(ticket: PromptTicket, code: String, uncertain: Boolean) = update(ticket) { current ->
        if (current.status in setOf(PromptStatus.ACCEPTED, PromptStatus.CONFIRMED)) current
        else current.copy(status = if (uncertain) PromptStatus.UNCERTAIN else PromptStatus.REJECTED, errorCode = code)
    }

    suspend fun reconcile(sessionId: String, requestIds: Set<String>) = mutex.withLock {
        for (ticket in storage.list()) {
            if (ticket.sessionId == sessionId && ticket.requestId in requestIds && ticket.status != PromptStatus.CONFIRMED) {
                storage.put(ticket.copy(status = PromptStatus.CONFIRMED, errorCode = null))
            }
        }
    }

    suspend fun discard(ticket: PromptTicket) = update(ticket) { current ->
        // Forgetting an unconfirmed local ticket does not cancel generation on the Host.
        current.copy(status = PromptStatus.DISCARDED)
    }

    private suspend fun update(ticket: PromptTicket, block: (PromptTicket) -> PromptTicket) = mutex.withLock {
        storage.get(ticket.id)?.let { storage.put(block(it)) }
    }
}

internal suspend fun promptRequest(ticket: PromptTicket, intake: FileIntake, limits: IntakeLimits): JsonObject = withContext(Dispatchers.IO) {
    val images = ticket.attachments.filter { it.kind == AttachmentKind.IMAGE }
    if (images.size > limits.maxImages || ticket.attachments.size > AttachmentPolicy.MAX_ATTACHMENTS) {
        throw FileOperationException(FileProblem.TOO_MANY)
    }
    if (images.sumOf { it.bytes } > limits.maxMessageImageBytes) throw FileOperationException(FileProblem.MESSAGE_TOO_LARGE)
    val parts = ArrayList<JsonObject>()
    if (ticket.text.isNotBlank()) parts.add(buildJsonObject { put("type", "text"); put("text", ticket.text) })
    for (attachment in ticket.attachments) {
        parts.add(buildJsonObject {
            if (attachment.kind == AttachmentKind.IMAGE) {
                if (attachment.bytes > limits.maxImageBytes) throw FileOperationException(FileProblem.TOO_LARGE)
                val file = intake.file(attachment)
                verifyLocal(file, attachment.bytes, attachment.sha256)
                put("type", "image")
                put("mediaType", attachment.mime)
                put("data", Base64.getEncoder().encodeToString(file.readBytes()))
                put("name", attachment.name)
            } else {
                if (attachment.receiptSessionId != ticket.sessionId || attachment.receiptId.isNullOrBlank()) {
                    throw FileOperationException(FileProblem.RECEIPT_INVALID)
                }
                put("type", "file")
                put("receiptId", attachment.receiptId)
            }
        })
    }
    buildJsonObject {
        put("requestId", ticket.requestId)
        put("sessionId", ticket.sessionId)
        put("mode", ticket.mode)
        put("content", JsonArray(parts))
        val zone = ZoneId.systemDefault().id
        if (zone == "UTC" || zone.contains('/')) put("clientTimeZone", zone)
    }
}
