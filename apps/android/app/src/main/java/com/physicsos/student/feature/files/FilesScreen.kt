package com.physicsos.student.feature.files

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.Settings
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import coil3.compose.AsyncImage
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.core.DownloadRecord
import com.physicsos.student.core.DownloadState
import java.io.File
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Native offline file library. It never grants a remote document a JavaScript bridge. */
@Composable
fun FilesScreen(graph: AppGraph, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val auth by graph.auth.state.collectAsStateWithLifecycle()
    val user = (auth as? AuthState.SignedIn)?.user
    if (user == null) {
        Column(modifier.padding(24.dp)) { Text(stringResource(R.string.chat_sign_in_required)); TextButton(onClick = onBack) { Text(stringResource(R.string.chat_back)) } }
        return
    }
    val context = LocalContext.current.applicationContext
    val factory = remember(graph, user.userId) { viewModelFactory { initializer { FilesViewModel(context, graph, user.userKey) } } }
    val model: FilesViewModel = viewModel(key = "files:${user.userId}", factory = factory)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(model, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) model.controller.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); model.controller.pause() }
    }
    FileEffects(model.controller)
    FilesContent(model.controller, onBack, modifier)
}

private class FilesViewModel(context: Context, graph: AppGraph, owner: String) : ViewModel() {
    val controller = FileActionsController(context, graph, owner, viewModelScope)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FilesContent(controller: FileActionsController, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val state by controller.state.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<DownloadRecord?>(null) }
    Scaffold(
        modifier = modifier.testTag("files"),
        topBar = { TopAppBar(title = { Text(stringResource(R.string.files_title)) }, navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.chat_back)) }
        }) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Text(stringResource(R.string.files_offline_description), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp))
            FileNoticeBanner(state, controller::dismissNotice)
            if (state.downloads.isEmpty()) {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.files_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else LazyColumn(Modifier.fillMaxSize()) {
                items(state.downloads, key = { it.id }, contentType = { "download" }) { record ->
                    DownloadRow(
                        record, state.progress[record.id],
                        onOpen = { controller.open(record) }, onRetry = { controller.retry(record) },
                        onCancel = { controller.cancel(record.id) }, onShare = { controller.share(record) },
                        onExport = { controller.requestExport(record) }, onDelete = { deleting = record },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
    deleting?.let { record ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(stringResource(R.string.files_remove_local_title)) },
            text = { Text(stringResource(R.string.files_remove_local_body, record.name)) },
            confirmButton = { TextButton(onClick = { deleting = null; controller.remove(record) }) { Text(stringResource(R.string.files_remove_local)) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.chat_keep)) } },
        )
    }
    state.preview?.let { file ->
        NativeFileViewer(file, controller::dismissPreview,
            onShare = file.recordId?.let { id -> state.downloads.firstOrNull { it.id == id }?.let { record -> { controller.share(record) } } },
            onExport = file.recordId?.let { id -> state.downloads.firstOrNull { it.id == id }?.let { record -> { controller.requestExport(record) } } },
        )
    }
}

@Composable
private fun DownloadRow(
    record: DownloadRecord,
    progress: TransferProgress?,
    onOpen: () -> Unit,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
    onShare: () -> Unit,
    onExport: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).testTag("file-${record.id}")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(record.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    stringResource(downloadStatusString(record.state)),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, stringResource(R.string.files_actions)) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (record.state == DownloadState.COMPLETE) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.files_share)) }, onClick = { menu = false; onShare() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.files_save_as)) }, onClick = { menu = false; onExport() })
                    }
                    DropdownMenuItem(text = { Text(stringResource(R.string.files_remove_local)) }, onClick = { menu = false; onDelete() })
                }
            }
        }
        val bytes = progress?.done ?: record.bytesDownloaded
        val total = progress?.total ?: record.totalBytes
        Text(
            if (total != null) stringResource(R.string.files_transfer_bytes, sizeLabel(bytes), sizeLabel(total)) else sizeLabel(bytes),
            style = MaterialTheme.typography.bodySmall,
        )
        when (record.state) {
            DownloadState.COMPLETE -> TextButton(onClick = onOpen, modifier = Modifier.testTag("file-open-${record.id}")) { Text(stringResource(R.string.files_preview)) }
            DownloadState.DOWNLOADING, DownloadState.QUEUED -> {
                TransferBar(bytes, total)
                TextButton(onClick = onCancel, modifier = Modifier.testTag("file-cancel-${record.id}")) { Text(stringResource(R.string.files_cancel_download)) }
            }
            DownloadState.PAUSED, DownloadState.FAILED -> {
                Text(stringResource(R.string.files_retry_restarts), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onRetry, modifier = Modifier.testTag("file-retry-${record.id}")) { Text(stringResource(R.string.files_retry_download)) }
            }
        }
    }
}

@Composable
internal fun TransferBar(done: Long, total: Long?, modifier: Modifier = Modifier) {
    if (total != null && total > 0) LinearProgressIndicator(progress = { (done.toDouble() / total).toFloat().coerceIn(0f, 1f) }, modifier = modifier.fillMaxWidth())
    else LinearProgressIndicator(modifier = modifier.fillMaxWidth())
}

@Composable
internal fun sizeLabel(bytes: Long): String = Formatter.formatShortFileSize(LocalContext.current, bytes)

@Composable
internal fun FileNoticeBanner(state: FilesUiState, dismiss: () -> Unit) {
    val resource = state.problem?.let(::fileProblemString) ?: state.notice?.let(::fileNoticeString) ?: return
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(resource), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            IconButton(onClick = dismiss) { Icon(Icons.Default.Close, stringResource(R.string.chat_dismiss)) }
        }
    }
}

@Composable
internal fun FileEffects(controller: FileActionsController) {
    val context = LocalContext.current
    var pendingExportId by rememberSaveable(controller.owner) { mutableStateOf<String?>(null) }
    val export = rememberLauncherForActivityResult(ExportDocumentContract()) { uri ->
        val id = pendingExportId
        pendingExportId = null
        if (id != null && uri != null) controller.export(id, uri)
    }
    val chooserTitle = stringResource(R.string.files_share)
    LaunchedEffect(controller) {
        controller.effects.collect { effect ->
            if (!controller.isOwner()) return@collect
            when (effect) {
                is FileEffect.Share -> try { context.startActivity(effect.file.shareIntent(chooserTitle)) }
                catch (_: ActivityNotFoundException) { controller.notice(FileNotice.SHARE_UNAVAILABLE) }
                catch (_: SecurityException) { controller.notice(FileNotice.SHARE_UNAVAILABLE) }
                is FileEffect.Export -> {
                    pendingExportId = effect.id
                    try { export.launch(ExportDocumentInput(effect.name, effect.mime)) }
                    catch (_: ActivityNotFoundException) { pendingExportId = null; controller.notice(FileNotice.SHARE_UNAVAILABLE) }
                }
            }
        }
    }
}

private data class ExportDocumentInput(val name: String, val mime: String)
private class ExportDocumentContract : ActivityResultContract<ExportDocumentInput, Uri?>() {
    override fun createIntent(context: Context, input: ExportDocumentInput): Intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = input.mime
        putExtra(Intent.EXTRA_TITLE, AttachmentPolicy.safeName(input.name))
    }
    override fun parseResult(resultCode: Int, intent: Intent?): Uri? = if (resultCode == Activity.RESULT_OK) intent?.data else null
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeFileViewer(file: OpenedFile, onDismiss: () -> Unit, onShare: (() -> Unit)? = null, onExport: (() -> Unit)? = null) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Scaffold(topBar = { TopAppBar(
                title = { Text(file.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, stringResource(R.string.chat_close)) } },
            ) }) { padding ->
                Column(Modifier.fillMaxSize().padding(padding)) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.End) {
                        onExport?.let { TextButton(onClick = it) { Text(stringResource(R.string.files_save_as)) } }
                        onShare?.let { TextButton(onClick = it) { Text(stringResource(R.string.files_share)) } }
                    }
                    when {
                        file.mime == "application/pdf" -> PdfPreview(file, Modifier.weight(1f))
                        file.mime.startsWith("image/") -> ZoomImage(file.file, file.name, Modifier.weight(1f))
                        file.mime in setOf("text/plain", "text/markdown", "text/csv", "application/json") -> TextFilePreview(file, Modifier.weight(1f))
                        else -> Text(stringResource(R.string.files_verbatim_no_preview), modifier = Modifier.padding(24.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun PdfPreview(file: OpenedFile, modifier: Modifier) {
    var page by rememberSaveable(file.file.name) { mutableIntStateOf(0) }
    var requested by rememberSaveable(file.file.name) { mutableStateOf("1") }
    val count = file.pageCount ?: 0
    val rendered by produceState<Result<Bitmap>?>(null, file.file, page) {
        value = null
        value = try { Result.success(renderPdfFile(file.file, page)) }
        catch (error: CancellationException) { throw error }
        catch (error: Exception) { Result.failure(error) }
    }
    Column(modifier.fillMaxWidth()) {
        Text(stringResource(R.string.files_pdf_full_document, count), modifier = Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
        Box(Modifier.weight(1f).fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
            when {
                rendered == null -> CircularProgressIndicator()
                rendered?.isFailure == true -> Text(stringResource(R.string.files_pdf_unreadable), modifier = Modifier.padding(16.dp))
                else -> ZoomBitmap(rendered!!.getOrThrow(), stringResource(R.string.files_pdf_page, page + 1, count))
            }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { page--; requested = (page + 1).toString() }, enabled = page > 0) { Text(stringResource(R.string.files_previous_page)) }
            OutlinedTextField(
                value = requested, onValueChange = { requested = it }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                label = { Text(stringResource(R.string.files_page_number)) }, modifier = Modifier.width(88.dp),
            )
            TextButton(onClick = { requested.toIntOrNull()?.takeIf { it in 1..count }?.let { page = it - 1 } }, enabled = requested.toIntOrNull()?.let { it in 1..count } == true) { Text(stringResource(R.string.files_go_page)) }
            TextButton(onClick = { page++; requested = (page + 1).toString() }, enabled = page + 1 < count) { Text(stringResource(R.string.files_next_page)) }
        }
    }
}

@Composable
private fun ZoomImage(file: File, description: String, modifier: Modifier) {
    var zoom by remember(file) { mutableFloatStateOf(1f) }
    var pan by remember(file) { mutableStateOf(Offset.Zero) }
    val transform = rememberTransformableState { scale, offset, _ -> zoom = (zoom * scale).coerceIn(1f, 6f); pan += offset }
    Box(modifier.fillMaxWidth().clipToBounds().transformable(transform), contentAlignment = Alignment.Center) {
        AsyncImage(file, description, modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y })
    }
}

@Composable
private fun ZoomBitmap(bitmap: Bitmap, description: String) {
    var zoom by remember(bitmap) { mutableFloatStateOf(1f) }
    var pan by remember(bitmap) { mutableStateOf(Offset.Zero) }
    val transform = rememberTransformableState { scale, offset, _ -> zoom = (zoom * scale).coerceIn(1f, 6f); pan += offset }
    Box(Modifier.fillMaxSize().clipToBounds().transformable(transform), contentAlignment = Alignment.Center) {
        Image(bitmap.asImageBitmap(), description, modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y })
    }
}

@Composable
private fun TextFilePreview(file: OpenedFile, modifier: Modifier) {
    val text by produceState<String?>(null, file.file) {
        value = withContext(Dispatchers.IO) {
            file.file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                var offset = 0
                while (offset < buffer.size) {
                    val read = input.read(buffer, offset, buffer.size - offset)
                    if (read < 0) break
                    offset += read
                }
                String(buffer, 0, offset, Charsets.UTF_8)
            }
        }
    }
    LazyColumn(modifier.fillMaxWidth().padding(16.dp)) {
        if (file.file.length() > 64 * 1024) item { Text(stringResource(R.string.files_text_preview_limited), style = MaterialTheme.typography.labelMedium) }
        item { SelectionContainer { Text(text ?: stringResource(R.string.files_loading)) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ImageCropDialog(
    attachment: PreparedAttachment,
    intake: FileIntake,
    onDismiss: () -> Unit,
    onApply: (CropArea, Int) -> Unit,
) {
    val original by produceState<Bitmap?>(null, attachment.id) {
        value = try { intake.previewOriginal(attachment) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { null }
    }
    var left by rememberSaveable(attachment.id) { mutableFloatStateOf(attachment.crop.left) }
    var top by rememberSaveable(attachment.id) { mutableFloatStateOf(attachment.crop.top) }
    var right by rememberSaveable(attachment.id) { mutableFloatStateOf(attachment.crop.right) }
    var bottom by rememberSaveable(attachment.id) { mutableFloatStateOf(attachment.crop.bottom) }
    var turns by rememberSaveable(attachment.id) { mutableIntStateOf(attachment.quarterTurns) }
    val accent = MaterialTheme.colorScheme.primary
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Scaffold(topBar = { TopAppBar(
                title = { Text(stringResource(R.string.files_crop_title)) },
                navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, stringResource(R.string.chat_close)) } },
            ) }) { padding ->
                Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.files_crop_instructions), style = MaterialTheme.typography.bodySmall)
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        original?.let { bitmap ->
                            Box(Modifier.fillMaxWidth().aspectRatio(bitmap.width.toFloat() / bitmap.height).clipToBounds()) {
                                Image(bitmap.asImageBitmap(), stringResource(R.string.files_original_image), Modifier.fillMaxSize())
                                androidx.compose.foundation.Canvas(Modifier.fillMaxSize().pointerInput(bitmap) {
                                    var handle = 0
                                    detectDragGestures(onDragStart = { point ->
                                        val x = point.x / size.width
                                        val y = point.y / size.height
                                        handle = when {
                                            abs(x - left) < .08f && abs(y - top) < .08f -> 1
                                            abs(x - right) < .08f && abs(y - bottom) < .08f -> 2
                                            abs(x - right) < .08f && abs(y - top) < .08f -> 3
                                            abs(x - left) < .08f && abs(y - bottom) < .08f -> 4
                                            else -> 0
                                        }
                                    }) { change, delta ->
                                        change.consume()
                                        val dx = delta.x / size.width
                                        val dy = delta.y / size.height
                                        when (handle) {
                                            1 -> { left = (left + dx).coerceIn(0f, right - .02f); top = (top + dy).coerceIn(0f, bottom - .02f) }
                                            2 -> { right = (right + dx).coerceIn(left + .02f, 1f); bottom = (bottom + dy).coerceIn(top + .02f, 1f) }
                                            3 -> { right = (right + dx).coerceIn(left + .02f, 1f); top = (top + dy).coerceIn(0f, bottom - .02f) }
                                            4 -> { left = (left + dx).coerceIn(0f, right - .02f); bottom = (bottom + dy).coerceIn(top + .02f, 1f) }
                                            else -> {
                                                val mx = dx.coerceIn(-left, 1f - right)
                                                val my = dy.coerceIn(-top, 1f - bottom)
                                                left += mx; right += mx; top += my; bottom += my
                                            }
                                        }
                                    }
                                }) {
                                    drawRect(accent, topLeft = Offset(left * size.width, top * size.height), size = androidx.compose.ui.geometry.Size((right - left) * size.width, (bottom - top) * size.height), style = Stroke(3.dp.toPx()))
                                    for (point in listOf(Offset(left, top), Offset(right, top), Offset(left, bottom), Offset(right, bottom))) {
                                        drawCircle(accent, 6.dp.toPx(), Offset(point.x * size.width, point.y * size.height))
                                    }
                                }
                            }
                        } ?: CircularProgressIndicator()
                    }
                    Text(stringResource(R.string.files_crop_horizontal))
                    RangeSlider(value = left..right, onValueChange = { if (it.endInclusive - it.start >= .02f) { left = it.start; right = it.endInclusive } }, modifier = Modifier.testTag("crop-horizontal"))
                    Text(stringResource(R.string.files_crop_vertical))
                    RangeSlider(value = top..bottom, onValueChange = { if (it.endInclusive - it.start >= .02f) { top = it.start; bottom = it.endInclusive } }, modifier = Modifier.testTag("crop-vertical"))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { left = 0f; top = 0f; right = 1f; bottom = 1f; turns = 0 }) { Text(stringResource(R.string.files_crop_reset)) }
                        TextButton(onClick = { turns = (turns + 1) % 4 }) { Text(stringResource(R.string.files_rotate_on_save, turns * 90)) }
                        Button(onClick = { onApply(CropArea(left, top, right, bottom), turns) }, enabled = original != null, modifier = Modifier.testTag("crop-apply")) { Text(stringResource(R.string.files_crop_apply)) }
                    }
                }
            }
        }
    }
}

internal fun fileProblemString(problem: FileProblem): Int = when (problem) {
    FileProblem.TOO_LARGE -> R.string.files_too_large
    FileProblem.EMPTY -> R.string.files_empty_file
    FileProblem.MIME_MISMATCH -> R.string.files_mime_mismatch
    FileProblem.UNSUPPORTED_IMAGE -> R.string.files_unsupported_image
    FileProblem.UNREADABLE -> R.string.files_unreadable
    FileProblem.PDF_UNREADABLE -> R.string.files_pdf_unreadable
    FileProblem.NO_SPACE -> R.string.files_no_space
    FileProblem.UNSAFE_PATH -> R.string.files_unsafe_path
    FileProblem.MISSING -> R.string.files_missing
    FileProblem.TOO_MANY -> R.string.files_too_many
    FileProblem.MESSAGE_TOO_LARGE -> R.string.files_message_too_large
    FileProblem.CANCELLED -> R.string.files_cancelled
    FileProblem.RECEIPT_INVALID -> R.string.files_receipt_invalid
    FileProblem.INTEGRITY -> R.string.files_integrity
}
internal fun fileNoticeString(notice: FileNotice): Int = when (notice) {
    FileNotice.AUTH -> R.string.chat_sign_in_required
    FileNotice.ACCESS -> R.string.files_access_denied
    FileNotice.NETWORK -> R.string.files_network_error
    FileNotice.FAILED -> R.string.files_transfer_failed
    FileNotice.EXPORTED -> R.string.files_exported
    FileNotice.SHARE_UNAVAILABLE -> R.string.files_share_unavailable
    FileNotice.CAMERA_DENIED -> R.string.files_camera_denied
    FileNotice.CAMERA_UNAVAILABLE -> R.string.files_camera_unavailable
    FileNotice.IMPORTED -> R.string.files_imported
}
private fun downloadStatusString(state: DownloadState): Int = when (state) {
    DownloadState.QUEUED -> R.string.files_download_queued
    DownloadState.DOWNLOADING -> R.string.files_downloading
    DownloadState.PAUSED -> R.string.files_download_paused
    DownloadState.COMPLETE -> R.string.files_download_complete
    DownloadState.FAILED -> R.string.files_download_failed
}
