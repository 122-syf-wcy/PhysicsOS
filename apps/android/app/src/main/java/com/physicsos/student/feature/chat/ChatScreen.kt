package com.physicsos.student.feature.chat

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import coil3.compose.AsyncImage
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.feature.files.AttachmentKind
import com.physicsos.student.feature.files.AttachmentPolicy
import com.physicsos.student.feature.files.FileEffects
import com.physicsos.student.feature.files.FileNotice
import com.physicsos.student.feature.files.FileNoticeBanner
import com.physicsos.student.feature.files.FilesContent
import com.physicsos.student.feature.files.ImageCropDialog
import com.physicsos.student.feature.files.NativeFileViewer
import com.physicsos.student.feature.files.PreparedAttachment
import com.physicsos.student.feature.files.TransferBar
import com.physicsos.student.feature.files.UploadStatus
import com.physicsos.student.feature.files.attachmentReferences
import com.physicsos.student.feature.files.sizeLabel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/** All complex mathematics opens one controlled document destination, never a WebView per list item. */
@Composable
fun ChatScreen(
    graph: AppGraph,
    sessionId: String? = null,
    initialText: String? = null,
    onOpenExperiment: (templateId: String?, scene: JsonObject?) -> Unit,
    onOpenDocument: (title: String, markdown: String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val auth by graph.auth.state.collectAsStateWithLifecycle()
    val user = (auth as? AuthState.SignedIn)?.user
    if (user == null) {
        Column(modifier.padding(24.dp)) {
            Text(stringResource(R.string.chat_sign_in_required))
            TextButton(onClick = onBack) { Text(stringResource(R.string.chat_back)) }
        }
        return
    }
    val context = LocalContext.current.applicationContext
    val factory = remember(graph, user.userId, sessionId, initialText) {
        viewModelFactory { initializer { ChatViewModel(context, graph, createSavedStateHandle(), user.userKey, sessionId, initialText) } }
    }
    val model: ChatViewModel = viewModel(key = "chat:${user.userId}:${sessionId.orEmpty()}:${initialText?.hashCode() ?: 0}", factory = factory)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(model, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) model.setForeground(true)
            if (event == Lifecycle.Event.ON_STOP) model.setForeground(false)
        }
        lifecycle.addObserver(observer)
        model.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
        onDispose { lifecycle.removeObserver(observer); model.setForeground(false) }
    }
    FileEffects(model.files)
    ChatContent(model, onOpenExperiment, onOpenDocument, onBack, modifier)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatContent(
    model: ChatViewModel,
    onOpenExperiment: (String?, JsonObject?) -> Unit,
    onOpenDocument: (String, String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier,
) {
    val state by model.state.collectAsStateWithLifecycle()
    val files by model.files.state.collectAsStateWithLifecycle()
    var directory by rememberSaveable { mutableStateOf(false) }
    var fileLibrary by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf<SessionListItem?>(null) }
    var archive by remember { mutableStateOf<SessionListItem?>(null) }
    var editingQueue by remember { mutableStateOf<QueueEntry?>(null) }
    var removingQueue by remember { mutableStateOf<QueueEntry?>(null) }
    var cropping by remember { mutableStateOf<PreparedAttachment?>(null) }
    var mode by rememberSaveable { mutableStateOf("queue") }
    val scope = rememberCoroutineScope()
    val inputActions = rememberAttachmentActions(model)
    val currentItem = state.sessions.firstOrNull { it.id == state.sessionId }
    Scaffold(
        modifier = modifier.testTag("chat"),
        topBar = {
            TopAppBar(title = {
                Column {
                    Text(state.title ?: stringResource(R.string.chat_title), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(stringResource(connectionString(state.connection)), style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
            }, navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.chat_back)) }
            }, actions = {
                IconButton(onClick = { directory = true }, modifier = Modifier.testTag("chat-sessions")) { Icon(Icons.Default.List, stringResource(R.string.chat_sessions)) }
                IconButton(onClick = { model.selectSession(null) }, enabled = !state.submitting, modifier = Modifier.testTag("chat-new")) { Icon(Icons.Default.Add, stringResource(R.string.chat_new)) }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, stringResource(R.string.chat_actions)) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.files_title)) }, onClick = { menu = false; fileLibrary = true })
                        if (currentItem != null) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.chat_rename)) }, onClick = { menu = false; rename = currentItem })
                            DropdownMenuItem(text = { Text(stringResource(if (currentItem.archived) R.string.chat_restore else R.string.chat_archive)) }, onClick = { menu = false; archive = currentItem })
                        }
                        DropdownMenuItem(text = { Text(stringResource(R.string.chat_refresh)) }, onClick = { menu = false; model.reconnect() })
                    }
                }
            })
        },
        bottomBar = {
            Column(Modifier.imePadding()) {
                HorizontalDivider()
                if (state.archived) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.chat_archived_readonly), modifier = Modifier.weight(1f))
                        TextButton(onClick = { state.sessionId?.let { model.archive(it, restore = true) } }) { Text(stringResource(R.string.chat_restore)) }
                    }
                } else {
                    DraftAttachments(state, model, onCrop = { cropping = it })
                    ChatComposer(
                        state, mode,
                        onText = model::updateText,
                        onMode = { mode = it },
                        onSend = { model.send(if (state.running) mode else "queue") },
                        onCancel = model::cancelGeneration,
                        onPhoto = inputActions.photo,
                        onCamera = inputActions.camera,
                        onFile = inputActions.document,
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            state.issue?.let { issue ->
                Surface(color = MaterialTheme.colorScheme.errorContainer) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(issueString(issue)), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                            IconButton(onClick = model::dismissIssue) { Icon(Icons.Default.Close, stringResource(R.string.chat_dismiss)) }
                        }
                        if (issue != ChatIssue.AUTH) TextButton(onClick = model::reconnect) { Text(stringResource(R.string.chat_reconnect)) }
                    }
                }
            }
            FileNoticeBanner(files, model.files::dismissNotice)
            if (state.connection == ChatConnection.OFFLINE) Text(stringResource(R.string.chat_offline_cache), Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
            if (state.unknownEvents) Text(stringResource(R.string.chat_unknown_events), Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
            if (state.queue.isNotEmpty()) QueueStrip(state, onEdit = { editingQueue = it }, onRemove = { removingQueue = it }, onSteer = { model.updateQueue(it, "steer") }, onOpenDocument = onOpenDocument)
            if (!state.initialized) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else ConversationList(state, model, onOpenExperiment, onOpenDocument, Modifier.weight(1f))
        }
    }
    if (directory) SessionDirectory(
        state = state, onDismiss = { directory = false }, onSearch = model::search,
        onSelect = { directory = false; model.selectSession(it) }, onRefresh = model::refreshSessions,
        onRename = { rename = it }, onArchive = { archive = it },
    )
    if (fileLibrary) Dialog(onDismissRequest = { fileLibrary = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) { FilesContent(model.files, onBack = { fileLibrary = false }) }
    }
    if (!fileLibrary) files.preview?.let { file ->
        val record = files.downloads.firstOrNull { it.id == file.recordId }
        NativeFileViewer(file, model.files::dismissPreview,
            onShare = record?.let { { model.files.share(it) } },
            onExport = record?.let { { model.files.requestExport(it) } },
        )
    }
    cropping?.let { attachment -> ImageCropDialog(attachment, model.files.intake, { cropping = null }) { crop, turns ->
        cropping = null; model.crop(attachment, crop, turns)
    } }
    rename?.let { item -> EditTextDialog(
        title = stringResource(R.string.chat_rename), initial = item.title.orEmpty(),
        label = stringResource(R.string.chat_session_name), onDismiss = { rename = null },
        onConfirm = { title -> rename = null; model.rename(item.id, title) },
    ) }
    archive?.let { item ->
        AlertDialog(
            onDismissRequest = { archive = null },
            title = { Text(stringResource(if (item.archived) R.string.chat_restore else R.string.chat_archive)) },
            text = { Text(stringResource(if (item.archived) R.string.chat_restore_body else if (item.running) R.string.chat_archive_running_body else R.string.chat_archive_body)) },
            confirmButton = { TextButton(onClick = { archive = null; model.archive(item.id, restore = item.archived, stopActivity = item.running) }) { Text(stringResource(if (item.archived) R.string.chat_restore else R.string.chat_archive_confirm)) } },
            dismissButton = { TextButton(onClick = { archive = null }) { Text(stringResource(R.string.chat_keep)) } },
        )
    }
    editingQueue?.let { item -> EditTextDialog(
        title = stringResource(R.string.chat_edit_queue), initial = item.text,
        label = stringResource(R.string.chat_message), onDismiss = { editingQueue = null },
        onConfirm = { text -> editingQueue = null; model.updateQueue(item, "edit", text) },
    ) }
    removingQueue?.let { item ->
        AlertDialog(
            onDismissRequest = { removingQueue = null },
            title = { Text(stringResource(R.string.chat_remove_queue)) }, text = { Text(stringResource(R.string.chat_remove_queue_body)) },
            confirmButton = { TextButton(onClick = { removingQueue = null; model.updateQueue(item, "remove") }) { Text(stringResource(R.string.chat_remove_queue)) } },
            dismissButton = { TextButton(onClick = { removingQueue = null }) { Text(stringResource(R.string.chat_keep)) } },
        )
    }
}

@Composable
private fun ConversationList(
    state: ChatUiState,
    model: ChatViewModel,
    onOpenExperiment: (String?, JsonObject?) -> Unit,
    onOpenDocument: (String, String) -> Unit,
    modifier: Modifier,
) {
    val list = rememberLazyListState()
    var follow by rememberSaveable(state.sessionId) { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val copyLabel = stringResource(R.string.chat_copy_label)
    var copyFailed by remember { mutableStateOf(false) }
    val documentTitle = stringResource(R.string.chat_answer_document)
    val atEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 2 } }
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress to atEnd }.collect { (scrolling, end) -> if (scrolling) follow = end }
    }
    LaunchedEffect(state.rows.lastOrNull(), state.pending.size, state.sessionId) {
        if (follow && !list.isScrollInProgress && list.layoutInfo.totalItemsCount > 0) list.scrollToItem(list.layoutInfo.totalItemsCount - 1)
    }
    fun copy(text: String) {
        try { context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(copyLabel, text)) }
        catch (_: RuntimeException) { copyFailed = true }
    }
    Box(modifier.fillMaxWidth()) {
        LazyColumn(state = list, modifier = Modifier.fillMaxSize().testTag("chat-messages"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.hasMore) item(key = "older") {
                TextButton(onClick = model::loadOlder, enabled = !state.loadingHistory && state.online, modifier = Modifier.fillMaxWidth().testTag("chat-load-older")) {
                    Text(stringResource(if (state.loadingHistory) R.string.chat_loading_history else R.string.chat_load_older))
                }
            }
            if (state.rows.isEmpty() && state.pending.isEmpty()) item(key = "empty") {
                Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(if (state.connection == ChatConnection.RECOVERING) R.string.chat_restoring_title else R.string.chat_empty_title), style = MaterialTheme.typography.headlineSmall)
                    Text(stringResource(if (state.connection == ChatConnection.RECOVERING) R.string.chat_restoring_body else R.string.chat_empty_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            items(state.rows, key = { it.key }, contentType = { if (it is ChatRow.Scene) "scene" else (it as ChatRow.Message).role }) { row ->
                when (row) {
                    is ChatRow.Message -> ChatMessageCard(
                        row = row,
                        onCopy = { copy(row.markdown) }, onQuote = { model.quote(row.markdown) },
                        onOpenDocument = { onOpenDocument(documentTitle, row.markdown) },
                        onOpenReasoning = { onOpenDocument(documentTitle, row.reasoning) },
                        attachmentActions = {
                            state.sessionId?.let { id ->
                                val attachments = remember(id, row.content) { attachmentReferences(id, row.content) }
                                attachments.forEach { attachment ->
                                    AssistChip(onClick = { model.files.download(attachment) }, label = { Text(attachment.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }, modifier = Modifier.testTag("chat-attachment-${attachment.attachmentId}"))
                                }
                            }
                        },
                    )
                    is ChatRow.Scene -> SceneCard(row, onOpenExperiment, onOpenDocument)
                }
            }
            items(state.pending, key = { "pending:${it.requestId}" }, contentType = { "pending" }) { ticket ->
                PendingPromptCard(ticket, state.submitting || !state.online, { model.retry(ticket) }, { model.discardPending(ticket) }, { onOpenDocument(documentTitle, ticket.text) })
            }
            if (state.running) item(key = "running") {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(stringResource(if (state.cancelRequested) R.string.chat_cancel_pending else R.string.chat_generating), style = MaterialTheme.typography.bodySmall)
                }
            } else if (state.turnOutcome in setOf("error", "aborted", "interrupted", "max-tokens", "blocked")) item(key = "turn-outcome") {
                Text(stringResource(turnOutcomeString(state.turnOutcome)), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp))
            }
            item(key = "bottom-space") { Spacer(Modifier.height(12.dp)) }
        }
        if (!atEnd) Button(onClick = { follow = true; scope.launch { if (list.layoutInfo.totalItemsCount > 0) list.scrollToItem(list.layoutInfo.totalItemsCount - 1) } }, modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp).testTag("chat-latest")) {
            Text(stringResource(R.string.chat_latest))
        }
    }
    if (copyFailed) AlertDialog(
        onDismissRequest = { copyFailed = false }, title = { Text(stringResource(R.string.chat_copy_failed)) },
        text = { Text(stringResource(R.string.chat_copy_failed_body)) },
        confirmButton = { TextButton(onClick = { copyFailed = false }) { Text(stringResource(R.string.chat_close)) } },
    )
}

@Composable
internal fun ChatMessageCard(
    row: ChatRow.Message,
    onCopy: () -> Unit,
    onQuote: () -> Unit,
    onOpenDocument: () -> Unit,
    onOpenReasoning: () -> Unit,
    attachmentActions: @Composable () -> Unit = {},
) {
    val preview by produceState<MessagePreview?>(null, row.markdown) {
        value = withContext(Dispatchers.Default) { messagePreview(row.markdown) }
    }
    val isUser = row.role == MessageRole.USER
    val compact = row.role == MessageRole.TOOL || row.role == MessageRole.CONTEXT
    var expanded by rememberSaveable(row.key) { mutableStateOf(!compact) }
    Card(
        modifier = Modifier.fillMaxWidth().padding(start = if (isUser) 40.dp else 12.dp, end = if (isUser) 12.dp else 24.dp).testTag("chat-message-${row.key}"),
        colors = CardDefaults.cardColors(containerColor = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(roleString(row.role)), style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                if (compact) TextButton(onClick = { expanded = !expanded }) { Text(stringResource(if (expanded) R.string.chat_collapse else R.string.chat_expand)) }
                if (row.toolError) Text(stringResource(R.string.chat_tool_failed), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            if (expanded) {
                preview?.text?.takeIf { it.isNotBlank() }?.let { text ->
                    SelectionContainer { Text(text, style = MaterialTheme.typography.bodyLarge, maxLines = 24, overflow = TextOverflow.Ellipsis) }
                }
                if (preview?.hasMathematics == true) Text(stringResource(R.string.chat_mathematics_in_document), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (preview?.abbreviated == true) Text(stringResource(R.string.chat_preview_abbreviated), style = MaterialTheme.typography.labelSmall)
                if (row.live && row.markdown.isBlank()) Text(stringResource(R.string.chat_processing), style = MaterialTheme.typography.bodyMedium)
                attachmentActions()
                if (row.interrupted) Text(stringResource(R.string.chat_interrupted_prefix), style = MaterialTheme.typography.bodySmall)
                if (row.markdown.isNotBlank()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = onOpenDocument, modifier = Modifier.testTag("chat-document-${row.key}")) { Text(stringResource(R.string.chat_view_complete)) }
                        TextButton(onClick = onCopy, modifier = Modifier.testTag("chat-copy-${row.key}")) { Text(stringResource(R.string.chat_copy)) }
                        TextButton(onClick = onQuote, enabled = !row.live) { Text(stringResource(R.string.chat_quote)) }
                    }
                }
                if (row.reasoning.isNotBlank()) TextButton(onClick = onOpenReasoning) { Text(stringResource(R.string.chat_view_reasoning)) }
            }
        }
    }
}

@Composable
private fun SceneCard(row: ChatRow.Scene, onOpenExperiment: (String?, JsonObject?) -> Unit, onOpenDocument: (String, String) -> Unit) {
    val labels = SolveDocumentLabels(
        stringResource(R.string.chat_knowns), stringResource(R.string.chat_targets), stringResource(R.string.chat_answers),
        stringResource(R.string.chat_steps), stringResource(R.string.chat_verification), stringResource(R.string.chat_issues),
    )
    val document by produceState<String?>(null, row, labels) { value = withContext(Dispatchers.Default) { solveDocument(row, labels) } }
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp).testTag("chat-scene-${row.key}")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(row.title, style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.chat_scene_revision, row.revision), style = MaterialTheme.typography.labelSmall)
            row.solve?.obj("verification")?.string("status")?.let { Text(stringResource(R.string.chat_verification_status, it), style = MaterialTheme.typography.bodySmall) }
            Text(stringResource(R.string.chat_scene_full_state), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onOpenExperiment(row.experimentId, row.scene) }, modifier = Modifier.testTag("chat-open-experiment")) { Text(stringResource(R.string.chat_open_experiment)) }
                if (row.solve != null) TextButton(onClick = { document?.let { onOpenDocument(row.title, it) } }, enabled = document != null) { Text(stringResource(R.string.chat_view_complete)) }
            }
        }
    }
}

@Composable
private fun PendingPromptCard(ticket: PromptTicket, disabled: Boolean, onRetry: () -> Unit, onDiscard: () -> Unit, onOpen: () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp).testTag("chat-pending-${ticket.requestId}")) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(promptStatusString(ticket.status)), style = MaterialTheme.typography.titleSmall)
            Text(ticket.text, maxLines = 4, overflow = TextOverflow.Ellipsis)
            if (ticket.status == PromptStatus.UNCERTAIN) Text(stringResource(R.string.chat_unknown_admission), style = MaterialTheme.typography.bodySmall)
            if (ticket.attachments.isNotEmpty()) Text(stringResource(R.string.chat_attachment_count, ticket.attachments.size), style = MaterialTheme.typography.bodySmall)
            Row {
                if (ticket.status in setOf(PromptStatus.UNCERTAIN, PromptStatus.REJECTED, PromptStatus.PREPARED)) TextButton(onClick = onRetry, enabled = !disabled, modifier = Modifier.testTag("chat-retry-${ticket.requestId}")) { Text(stringResource(R.string.chat_retry_same_request)) }
                TextButton(onClick = onOpen) { Text(stringResource(R.string.chat_view_complete)) }
            }
            if (ticket.status != PromptStatus.SENDING) TextButton(onClick = onDiscard, enabled = !disabled) { Text(stringResource(R.string.chat_dismiss_pending_only)) }
        }
    }
}

@Composable
internal fun ChatComposer(
    state: ChatUiState,
    mode: String,
    onText: (String) -> Unit,
    onMode: (String) -> Unit,
    onSend: () -> Unit,
    onCancel: () -> Unit,
    onPhoto: () -> Unit,
    onCamera: () -> Unit,
    onFile: () -> Unit,
) {
    var attachments by remember { mutableStateOf(false) }
    var modeMenu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = state.draft.text, onValueChange = onText,
            placeholder = { Text(stringResource(R.string.chat_input_hint)) },
            minLines = 1, maxLines = 6, enabled = !state.submitting,
            isError = state.draft.text.length > ChatViewModel.MAX_TEXT_CHARS,
            modifier = Modifier.fillMaxWidth().testTag("chat-input"),
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box {
                TextButton(onClick = { attachments = true }, enabled = !state.submitting && !state.importing, modifier = Modifier.testTag("chat-attach")) { Text(stringResource(R.string.chat_attach)) }
                DropdownMenu(expanded = attachments, onDismissRequest = { attachments = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.files_choose_image)) }, onClick = { attachments = false; onPhoto() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.files_take_photo)) }, onClick = { attachments = false; onCamera() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.files_choose_document)) }, onClick = { attachments = false; onFile() })
                }
            }
            if (state.running) {
                Box {
                    TextButton(onClick = { modeMenu = true }, enabled = !state.submitting) { Text(stringResource(if (mode == "steer") R.string.chat_mode_steer else R.string.chat_mode_queue)) }
                    DropdownMenu(expanded = modeMenu, onDismissRequest = { modeMenu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.chat_mode_queue)) }, onClick = { modeMenu = false; onMode("queue") })
                        DropdownMenuItem(text = { Text(stringResource(R.string.chat_mode_steer)) }, onClick = { modeMenu = false; onMode("steer") })
                    }
                }
                TextButton(onClick = onCancel, enabled = !state.cancelRequested && state.online, modifier = Modifier.testTag("chat-stop")) { Text(stringResource(R.string.chat_stop)) }
            }
            Spacer(Modifier.weight(1f))
            IconButton(
                onClick = onSend,
                enabled = state.online && !state.submitting && !state.importing && state.draft.text.length <= ChatViewModel.MAX_TEXT_CHARS &&
                    (state.draft.text.isNotBlank() || state.draft.attachments.isNotEmpty()) && state.connection != ChatConnection.AUTH_REQUIRED,
                modifier = Modifier.testTag("chat-send"),
            ) {
                if (state.submitting) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.chat_send))
            }
        }
        Text(stringResource(R.string.chat_intake_limits, AttachmentPolicy.MAX_IMPORT_BYTES / (1024 * 1024), state.limits.maxImages, state.limits.maxMessageImageBytes / (1024 * 1024)), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DraftAttachments(state: ChatUiState, model: ChatViewModel, onCrop: (PreparedAttachment) -> Unit) {
    val scope = rememberCoroutineScope()
    if (state.importing) Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Text(stringResource(R.string.files_preparing), modifier = Modifier.weight(1f).padding(8.dp))
        TextButton(onClick = model::cancelImport) { Text(stringResource(R.string.files_cancel_prepare)) }
    }
    if (state.draft.attachments.isEmpty()) return
    LazyRow(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(state.draft.attachments, key = { it.id }) { attachment ->
            Card(Modifier.width(220.dp).padding(start = 8.dp).testTag("draft-attachment-${attachment.id}")) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (attachment.kind == AttachmentKind.IMAGE) AsyncImage(model.files.intake.file(attachment), attachment.name, modifier = Modifier.size(44.dp).clickable { scope.launch { try { model.files.preview(attachment) } catch (error: Exception) { model.files.report(error) } } })
                        Text(attachment.name, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 6.dp), style = MaterialTheme.typography.labelMedium)
                        IconButton(onClick = { model.removeAttachment(attachment) }, enabled = !state.submitting, modifier = Modifier.size(40.dp)) { Icon(Icons.Default.Close, stringResource(R.string.files_remove_attachment)) }
                    }
                    Text(sizeLabel(attachment.bytes), style = MaterialTheme.typography.bodySmall)
                    if (attachment.kind == AttachmentKind.IMAGE) Text(stringResource(R.string.files_image_prepared), style = MaterialTheme.typography.labelSmall)
                    if (attachment.flattenedAnimation) Text(stringResource(R.string.files_animation_flattened), style = MaterialTheme.typography.labelSmall)
                    attachment.pageCount?.let { Text(stringResource(R.string.files_pdf_full_document, it), style = MaterialTheme.typography.labelSmall) }
                    state.uploads[attachment.id]?.let { progress -> TransferBar(progress.done, progress.total) }
                    Row {
                        TextButton(onClick = { scope.launch { try { model.files.preview(attachment) } catch (error: Exception) { model.files.report(error) } } }) { Text(stringResource(R.string.files_preview)) }
                        if (attachment.kind == AttachmentKind.IMAGE) TextButton(onClick = { onCrop(attachment) }, enabled = !state.submitting) { Text(stringResource(R.string.files_crop)) }
                        else when (attachment.upload) {
                            UploadStatus.UPLOADING -> TextButton(onClick = { model.cancelUpload(attachment.id) }) { Text(stringResource(R.string.files_cancel_upload)) }
                            UploadStatus.UPLOADED -> Text(stringResource(R.string.files_uploaded), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(vertical = 12.dp))
                            else -> TextButton(onClick = { model.uploadAttachment(attachment) }, enabled = state.online && !state.submitting) { Text(stringResource(if (attachment.upload == UploadStatus.LOCAL) R.string.files_upload else R.string.files_retry_upload)) }
                        }
                    }
                }
            }
        }
    }
}

private data class AttachmentActions(val photo: () -> Unit, val camera: () -> Unit, val document: () -> Unit)

@Composable
private fun rememberAttachmentActions(model: ChatViewModel): AttachmentActions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var cameraUri by rememberSaveable(model.owner) { mutableStateOf<String?>(null) }
    var captureToken by rememberSaveable(model.owner) { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val uri = cameraUri
        val token = captureToken
        cameraUri = null; captureToken = null
        if (success && uri != null) model.importUri(Uri.parse(uri), token)
        else if (token != null) scope.launch { model.files.removeCapture(token) }
    }
    val launchCamera: () -> Unit = {
        scope.launch {
            try {
                val capture = model.files.createCapture()
                cameraUri = capture.uri.toString(); captureToken = capture.token
                camera.launch(capture.uri)
            } catch (_: ActivityNotFoundException) { model.files.notice(FileNotice.CAMERA_UNAVAILABLE) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { model.files.report(error) }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else model.files.notice(FileNotice.CAMERA_DENIED)
    }
    val photo = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { model.importUri(it) } }
    val document = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { model.importUri(it) } }
    return AttachmentActions(
        photo = { try { photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) } catch (_: ActivityNotFoundException) { model.files.notice(FileNotice.SHARE_UNAVAILABLE) } },
        camera = {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera()
            else permission.launch(Manifest.permission.CAMERA)
        },
        document = { try { document.launch(arrayOf("*/*")) } catch (_: ActivityNotFoundException) { model.files.notice(FileNotice.SHARE_UNAVAILABLE) } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionDirectory(
    state: ChatUiState,
    onDismiss: () -> Unit,
    onSearch: (String) -> Unit,
    onSelect: (String) -> Unit,
    onRefresh: () -> Unit,
    onRename: (SessionListItem) -> Unit,
    onArchive: (SessionListItem) -> Unit,
) {
    var archived by rememberSaveable { mutableStateOf(false) }
    val rows = state.sessions.filter { it.archived == archived }.filter { row ->
        if (state.searchQuery.isBlank()) true
        else state.searchHits?.containsKey(row.id) ?: row.title.orEmpty().contains(state.searchQuery, ignoreCase = true)
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.chat_sessions)) }, navigationIcon = {
                IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, stringResource(R.string.chat_close)) }
            }, actions = { TextButton(onClick = onRefresh, enabled = !state.loadingDirectory && state.online) { Text(stringResource(R.string.chat_refresh)) } }) }) { padding ->
                Column(Modifier.fillMaxSize().padding(padding)) {
                    OutlinedTextField(value = state.searchQuery, onValueChange = onSearch, label = { Text(stringResource(R.string.chat_search_sessions)) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(12.dp).testTag("chat-session-search"))
                    Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !archived, onClick = { archived = false }, label = { Text(stringResource(R.string.chat_active_sessions)) })
                        FilterChip(selected = archived, onClick = { archived = true }, label = { Text(stringResource(R.string.chat_archived_sessions)) })
                    }
                    Text(stringResource(if (!state.online && state.searchQuery.isNotBlank()) R.string.chat_search_cached_only else R.string.chat_archive_only_notice), modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
                    if (state.loadingDirectory || state.searching) CircularProgressIndicator(Modifier.padding(12.dp).size(24.dp))
                    if (rows.isEmpty() && !state.loadingDirectory && !state.searching) Text(stringResource(R.string.chat_sessions_empty), modifier = Modifier.padding(24.dp))
                    LazyColumn(Modifier.weight(1f)) {
                        items(rows, key = { it.id }) { item ->
                            var menu by remember { mutableStateOf(false) }
                            Row(Modifier.fillMaxWidth().clickable(enabled = !state.submitting) { onSelect(item.id) }.padding(horizontal = 16.dp, vertical = 10.dp).testTag("chat-session-${item.id}"), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(item.title ?: stringResource(R.string.chat_untitled), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    state.searchHits?.get(item.id)?.let { Text(it, maxLines = 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }
                                    if (item.running) Text(stringResource(R.string.chat_generating), style = MaterialTheme.typography.labelSmall)
                                }
                                Box {
                                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, stringResource(R.string.chat_actions)) }
                                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                        DropdownMenuItem(text = { Text(stringResource(R.string.chat_rename)) }, onClick = { menu = false; onRename(item) })
                                        DropdownMenuItem(text = { Text(stringResource(if (item.archived) R.string.chat_restore else R.string.chat_archive)) }, onClick = { menu = false; onArchive(item) })
                                    }
                                }
                            }
                            HorizontalDivider()
                        }
                        if (state.searchHasMore) item { Text(stringResource(R.string.chat_search_refine), modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}

@Composable
private fun QueueStrip(state: ChatUiState, onEdit: (QueueEntry) -> Unit, onRemove: (QueueEntry) -> Unit, onSteer: (QueueEntry) -> Unit, onOpenDocument: (String, String) -> Unit) {
    val title = stringResource(R.string.chat_queue_title)
    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.chat_queue_count, state.queue.size), modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelLarge)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.queue, key = { it.id }) { entry ->
                Card(Modifier.width(300.dp).padding(start = 12.dp, bottom = 8.dp).testTag("chat-queue-${entry.id}")) {
                    Column(Modifier.padding(10.dp)) {
                        Text(entry.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Row {
                            TextButton(onClick = { onOpenDocument(title, entry.text) }) { Text(stringResource(R.string.chat_view_complete)) }
                            if (entry.textOnly) TextButton(onClick = { onEdit(entry) }, enabled = entry.id !in state.queueBusy) { Text(stringResource(R.string.chat_edit)) }
                            TextButton(onClick = { onRemove(entry) }, enabled = entry.id !in state.queueBusy) { Text(stringResource(R.string.chat_remove_queue)) }
                        }
                        if (entry.target == "next-turn" && state.running) TextButton(onClick = { onSteer(entry) }, enabled = entry.id !in state.queueBusy, modifier = Modifier.testTag("chat-steer-${entry.id}")) { Text(stringResource(R.string.chat_steer_now)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EditTextDialog(title: String, initial: String, label: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by rememberSaveable(initial) { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text(title) },
        text = { OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text(label) }, maxLines = 8) },
        confirmButton = { TextButton(onClick = { onConfirm(text) }, enabled = text.isNotBlank()) { Text(stringResource(R.string.chat_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.chat_keep)) } },
    )
}

private fun connectionString(value: ChatConnection): Int = when (value) {
    ChatConnection.OFFLINE -> R.string.chat_connection_offline
    ChatConnection.BACKGROUND -> R.string.chat_connection_background
    ChatConnection.CONNECTING -> R.string.chat_connection_connecting
    ChatConnection.RECOVERING -> R.string.chat_connection_recovering
    ChatConnection.LIVE -> R.string.chat_connection_live
    ChatConnection.AUTH_REQUIRED -> R.string.chat_sign_in_required
    ChatConnection.UNAVAILABLE -> R.string.chat_connection_unavailable
}
private fun roleString(value: MessageRole): Int = when (value) {
    MessageRole.USER -> R.string.chat_role_user
    MessageRole.ASSISTANT -> R.string.chat_role_assistant
    MessageRole.CONTEXT -> R.string.chat_role_context
    MessageRole.TOOL -> R.string.chat_role_tool
}
private fun issueString(value: ChatIssue): Int = when (value) {
    ChatIssue.NETWORK -> R.string.chat_error_network
    ChatIssue.AUTH -> R.string.chat_sign_in_required
    ChatIssue.FORBIDDEN -> R.string.chat_error_forbidden
    ChatIssue.NOT_FOUND -> R.string.chat_error_not_found
    ChatIssue.RATE_LIMIT -> R.string.chat_error_rate_limit
    ChatIssue.SERVER -> R.string.chat_error_server
    ChatIssue.PROTOCOL -> R.string.chat_error_protocol
    ChatIssue.CACHE -> R.string.chat_error_cache
    ChatIssue.CREATE_UNCERTAIN -> R.string.chat_create_uncertain
    ChatIssue.INPUT_TOO_LONG -> R.string.chat_input_too_long
    ChatIssue.RETRY_AFTER_SYNC -> R.string.chat_retry_after_sync
    ChatIssue.QUEUE_CHANGED -> R.string.chat_queue_changed
    ChatIssue.ARCHIVE_ACTIVE -> R.string.chat_archive_active
}
private fun promptStatusString(value: PromptStatus): Int = when (value) {
    PromptStatus.PREPARED -> R.string.chat_prompt_prepared
    PromptStatus.SENDING -> R.string.chat_prompt_sending
    PromptStatus.UNCERTAIN -> R.string.chat_prompt_uncertain
    PromptStatus.ACCEPTED -> R.string.chat_prompt_accepted
    PromptStatus.CONFIRMED -> R.string.chat_prompt_confirmed
    PromptStatus.REJECTED -> R.string.chat_prompt_rejected
    PromptStatus.DISCARDED -> R.string.chat_prompt_discarded
}
private fun turnOutcomeString(value: String?): Int = when (value) {
    "aborted" -> R.string.chat_turn_cancelled
    "interrupted" -> R.string.chat_turn_interrupted
    "max-tokens" -> R.string.chat_turn_limit
    "blocked" -> R.string.chat_turn_blocked
    else -> R.string.chat_turn_error
}
