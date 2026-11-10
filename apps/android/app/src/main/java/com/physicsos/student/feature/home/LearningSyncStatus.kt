package com.physicsos.student.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.physicsos.student.R
import com.physicsos.student.core.OutboxState

@Composable
internal fun syncStateLabel(state: OutboxState): String = stringResource(when (state) {
    OutboxState.PENDING -> R.string.learning_sync_pending
    OutboxState.RUNNING -> R.string.learning_sync_running
    OutboxState.RETRY -> R.string.learning_sync_retry
    OutboxState.ACKNOWLEDGED -> R.string.learning_sync_acknowledged
    OutboxState.CONFLICT -> R.string.learning_sync_conflict
    OutboxState.FAILED -> R.string.learning_sync_failed
    OutboxState.AUTH_REQUIRED -> R.string.learning_sync_auth_required
})

@Composable
internal fun LearningSyncStatus(state: OutboxState, retry: () -> Unit, compare: (() -> Unit)? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.testTag("learning-sync-${state.name.lowercase()}")) {
        LearningNotice(syncStateLabel(state))
        when (state) {
            OutboxState.RETRY, OutboxState.FAILED, OutboxState.PENDING -> TextButton(onClick = retry) { Text(stringResource(R.string.learning_retry_send)) }
            OutboxState.CONFLICT -> if (compare != null) TextButton(onClick = compare) { Text(stringResource(R.string.learning_compare_versions)) }
            else -> Unit
        }
    }
}
