package com.physicsos.student.feature.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.ui.res.painterResource
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.physicsos.student.R
import com.physicsos.student.core.DownloadState
import com.physicsos.student.feature.files.AttachmentReference
import com.physicsos.student.feature.files.FileActionsController
import com.physicsos.student.feature.files.TransferBar
import com.physicsos.student.feature.files.sizeLabel
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun ChatAttachmentCard(reference: AttachmentReference, controller: FileActionsController) {
    val state by controller.state.collectAsStateWithLifecycle()
    val record = state.downloads.firstOrNull { it.id == reference.localId && it.state == DownloadState.COMPLETE }
    val verified by produceState<File?>(null, record) {
        value = if (record == null || !reference.image) null else try { withContext(Dispatchers.IO) { controller.transfers.verifiedFile(record) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
    }
    val progress = state.progress[reference.localId]
    Card(onClick = { if (record != null) controller.open(record) else controller.download(reference) },
        modifier = Modifier.widthIn(max = 360.dp).fillMaxWidth().testTag("chat-attachment-${reference.attachmentId}"),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            verified?.let { file -> AsyncImage(file, reference.name,
                Modifier.fillMaxWidth().heightIn(max = 220.dp).clip(MaterialTheme.shapes.small), contentScale = ContentScale.Fit) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(painterResource(R.drawable.ic_chat_attachment), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(reference.name, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(sizeLabel(reference.bytes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (progress != null) TransferBar(progress.done, progress.total)
            else Text(stringResource(if (record != null) R.string.files_preview else R.string.chat_attachment_download_preview),
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}
