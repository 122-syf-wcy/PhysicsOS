package com.physicsos.student.feature.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.physicsos.student.R
import com.physicsos.student.ui.components.BrandMark

@Composable
internal fun ChatWelcome(recovering: Boolean, onPrompt: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp).testTag("chat-welcome"), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        BrandMark(wordmark = false)
        Text(stringResource(if (recovering) R.string.chat_restoring_title else R.string.chat_welcome_heading), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(if (recovering) R.string.chat_restoring_body else R.string.chat_empty_body),
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (recovering) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
        else {
            val suggestions = listOf(
                R.string.chat_prompt_explain to R.string.chat_prompt_explain_body,
                R.string.chat_prompt_plan to R.string.chat_prompt_plan_body,
                R.string.chat_prompt_check to R.string.chat_prompt_check_body,
            )
            suggestions.forEachIndexed { index, (title, promptId) ->
                val prompt = stringResource(promptId)
                Card(onClick = { onPrompt(prompt) }, modifier = Modifier.fillMaxWidth().testTag("chat-suggestion-$index"),
                    shape = RoundedCornerShape(18.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(title), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Icon(Icons.AutoMirrored.Filled.ArrowForward, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            Text(stringResource(R.string.chat_prompt_draft_only), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
