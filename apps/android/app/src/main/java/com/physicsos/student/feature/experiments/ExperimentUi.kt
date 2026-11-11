package com.physicsos.student.feature.experiments

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.physicsos.student.R

internal fun experimentProblemText(context: Context, problem: ExperimentProblem): String {
    val resource = when (problem.code) {
        "account_changed", "owner_unavailable" -> R.string.experiments_account_changed
        "network_unavailable", "request_timeout" -> R.string.experiments_offline_error
        "sign_in_required", "reauthentication_required", "session_expired" -> R.string.experiments_auth_required
        "experiment_template_missing", "catalog_unavailable", "invalid_catalog" -> R.string.experiments_catalog_error
        "local_scene_missing", "local_scene_removed" -> R.string.experiments_checkpoint_missing
        "local_store_unavailable", "local_operation_failed" -> R.string.experiments_storage_error
        "CHECKPOINT_TIMEOUT", "RENDERER_NOT_READY", "EXPORT_NOT_READY" -> R.string.experiments_checkpoint_timeout
        "MESSAGE_TOO_LARGE", "FILE_TOO_LARGE", "DATA_LIMIT", "EXPORT_LIMIT", "local_record_too_large" -> R.string.experiments_size_error
        "OBSERVATIONS_EMPTY" -> R.string.experiments_observations_empty
        "scene_removal_requires_resolution" -> R.string.experiments_remove_blocked
        "INVALID_IMPORT_URI", "INVALID_EXPERIMENT_ARCHIVE", "INVALID_JSON", "INVALID_UTF8", "DUPLICATE_JSON_KEY",
        "INVALID_MESSAGE_SCHEMA", "UNSUPPORTED_CHECKPOINT_VERSION", "UNSUPPORTED_SCENE_VERSION" -> R.string.experiments_import_invalid
        "RENDERER_EXITED" -> R.string.experiments_renderer_recovery
        "BROWSER_UNAVAILABLE" -> R.string.experiments_browser_unavailable
        else -> R.string.experiments_operation_failed
    }
    return context.getString(resource) + context.getString(R.string.experiments_error_code, problem.code.take(80))
}

@Composable
internal fun ExperimentNotice(message: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Card(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message, style = MaterialTheme.typography.bodyMedium)
            if (action != null && onAction != null) TextButton(onClick = onAction) { Text(action) }
        }
    }
}

@Composable
internal fun ExperimentEmpty(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(24.dp).testTag("experiments_empty"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(body, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
internal fun experimentDomainLabel(value: String): String = when (value) {
    "mechanics" -> stringResource(R.string.experiments_domain_mechanics)
    "electricity", "circuit", "circuits" -> stringResource(R.string.experiments_domain_electricity)
    "electric" -> stringResource(R.string.experiments_domain_electric)
    "magnetic", "magnetism", "electromagnetism" -> stringResource(R.string.experiments_domain_magnetism)
    "composite" -> stringResource(R.string.experiments_domain_composite)
    "induction" -> stringResource(R.string.experiments_domain_induction)
    "acoustics" -> stringResource(R.string.experiments_domain_acoustics)
    "fluid", "fluids" -> stringResource(R.string.experiments_domain_fluids)
    "optics" -> stringResource(R.string.experiments_domain_optics)
    "waves", "wave" -> stringResource(R.string.experiments_domain_waves)
    "thermal", "thermodynamics" -> stringResource(R.string.experiments_domain_thermal)
    "modern", "modern-physics" -> stringResource(R.string.experiments_domain_modern)
    "custom" -> stringResource(R.string.experiments_domain_custom)
    else -> value
}

@Composable
internal fun experimentStageLabel(value: String): String = when (value) {
    "junior" -> stringResource(R.string.experiments_stage_junior)
    "senior" -> stringResource(R.string.experiments_stage_senior)
    "university", "college" -> stringResource(R.string.experiments_stage_university)
    "general", "all" -> stringResource(R.string.experiments_stage_general)
    else -> value
}

@Composable
internal fun sceneSyncText(label: SceneSyncLabel): String = stringResource(when (label) {
    SceneSyncLabel.LOCAL -> R.string.experiments_sync_local
    SceneSyncLabel.QUEUED -> R.string.experiments_sync_queued
    SceneSyncLabel.RUNNING -> R.string.experiments_sync_running
    SceneSyncLabel.RETRY -> R.string.experiments_sync_retry
    SceneSyncLabel.CONFIRMED -> R.string.experiments_sync_confirmed
    SceneSyncLabel.CONFLICT -> R.string.experiments_sync_conflict
    SceneSyncLabel.FAILED -> R.string.experiments_sync_failed
    SceneSyncLabel.SIGN_IN -> R.string.experiments_sync_sign_in
    SceneSyncLabel.SAVED_WAITING -> R.string.experiments_sync_waiting
})
