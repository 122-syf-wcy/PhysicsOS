package com.physicsos.student.feature.library

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.feature.home.LearningEmpty
import com.physicsos.student.feature.home.LearningError
import com.physicsos.student.feature.home.LearningHeader
import com.physicsos.student.feature.home.LearningLoading
import com.physicsos.student.feature.home.LearningNotice
import com.physicsos.student.feature.home.LearningViewModelFactory

@Composable
fun LibraryScreen(
    graph: AppGraph,
    onOpenExperiment: (templateId: String) -> Unit,
    onOpenChat: (prompt: String) -> Unit,
    onOpenDocument: (title: String, markdown: String) -> Unit,
    onOpenExternal: (url: String) -> Unit,
    onBack: () -> Unit,
    initialKind: LibraryKind = LibraryKind.ALL,
) {
    val factory = remember(graph, initialKind) { LearningViewModelFactory { LibraryViewModel(graph, initialKind) } }
    val model: LibraryViewModel = viewModel(key = "learning-library-${initialKind.name}", factory = factory)
    val state by model.state.collectAsStateWithLifecycle()
    BackHandler(state.selected != null) { model.closeDetail() }
    LibraryContent(
        state, model::updateFilter, model::refresh, model::loadMore, { model.select(it) }, model::save,
        onBack = { if (state.selected != null) model.closeDetail() else onBack() },
        onMoreAnnotations = { model.loadAnnotations(true) }, onRetryAnnotations = { model.loadAnnotations(false) },
        onOpenExperiment, onOpenChat, onOpenDocument, onOpenExternal,
    )
}

@Composable
internal fun LibraryContent(
    state: LibraryUiState,
    onFilter: (LibraryFilter) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: (LibraryKind) -> Unit,
    onSelect: (LibraryEntry) -> Unit,
    onSave: (LibraryEntry) -> Unit,
    onBack: () -> Unit,
    onMoreAnnotations: () -> Unit,
    onRetryAnnotations: () -> Unit,
    onOpenExperiment: (String) -> Unit,
    onOpenChat: (String) -> Unit,
    onOpenDocument: (String, String) -> Unit,
    onOpenExternal: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize().testTag("library")) {
        LearningHeader(stringResource(R.string.learning_library_title), onBack, action = {
            TextButton(onClick = onRefresh, modifier = Modifier.testTag("library-refresh")) { Text(stringResource(R.string.learning_refresh)) }
        })
        val selected = state.selected
        if (selected != null) {
            LibraryDetail(state, selected, onSelect, onSave, onMoreAnnotations, onRetryAnnotations, onOpenExperiment, onOpenChat, onOpenDocument, onOpenExternal)
        } else {
            OutlinedTextField(
                value = state.filter.query, onValueChange = { onFilter(state.filter.copy(query = it)) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("library-search"),
                label = { Text(stringResource(R.string.learning_library_search)) }, singleLine = true,
                trailingIcon = if (state.filter.query.isBlank()) null else ({ TextButton(onClick = { onFilter(state.filter.copy(query = "")) }) { Text(stringResource(R.string.learning_clear)) } }),
            )
            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(LibraryKind.entries, key = { it.name }) { kind ->
                    FilterChip(selected = state.filter.kind == kind, onClick = { onFilter(state.filter.copy(kind = kind)) }, label = { Text(libraryKindLabel(kind)) }, modifier = Modifier.testTag("library-kind-${kind.name.lowercase()}"))
                }
            }
            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item("stage-all") { FilterChip(selected = state.filter.stage == null, onClick = { onFilter(state.filter.copy(stage = null)) }, label = { Text(stringResource(R.string.learning_all_stages)) }) }
                item("junior") { FilterChip(selected = state.filter.stage == "junior", onClick = { onFilter(state.filter.copy(stage = "junior")) }, label = { Text(stringResource(R.string.learning_junior)) }) }
                item("senior") { FilterChip(selected = state.filter.stage == "senior", onClick = { onFilter(state.filter.copy(stage = "senior")) }, label = { Text(stringResource(R.string.learning_senior)) }) }
                item("verified") { FilterChip(selected = state.filter.verifiedOnly, onClick = { onFilter(state.filter.copy(verifiedOnly = !state.filter.verifiedOnly)) }, label = { Text(stringResource(R.string.learning_library_verified)) }, modifier = Modifier.testTag("library-verified-only")) }
            }
            if (state.domains.isNotEmpty()) LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item("domain-all") { FilterChip(selected = state.filter.domain == null, onClick = { onFilter(state.filter.copy(domain = null)) }, label = { Text(stringResource(R.string.learning_all_domains)) }) }
                items(state.domains, key = { it }) { domain ->
                    FilterChip(selected = state.filter.domain == domain, onClick = { onFilter(state.filter.copy(domain = domain)) }, label = { Text(learningDomainLabel(domain)) })
                }
            }
            LazyColumn(
                Modifier.weight(1f).testTag("library-results"),
                contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.cached) item("offline") { LearningNotice(stringResource(R.string.learning_library_cached), onRefresh) }
                if (state.assetProblem != null) item("asset-error") { LearningError(state.assetProblem, onRefresh) }
                if (state.remoteProblem != null) item("remote-error") { LearningError(state.remoteProblem, onRefresh) }
                if (state.actionProblem != null) item("action-error") { LearningError(state.actionProblem, onRefresh) }
                if (state.entries.isEmpty() && (state.loadingAssets || state.loadingRemote.isNotEmpty())) item("loading") { LearningLoading() }
                if (state.entries.isEmpty() && !state.loadingAssets && state.loadingRemote.isEmpty()) item("empty") {
                    LearningEmpty(stringResource(R.string.learning_library_empty), stringResource(if (state.filter.kind == LibraryKind.SAVED) R.string.learning_library_saved_empty else R.string.learning_library_empty_description))
                }
                items(state.entries, key = { it.key }, contentType = { it.kind }) { entry ->
                    LibraryEntryCard(entry, entry.key in state.savedKeys, onSelect, onSave)
                }
                state.nextPages.keys.forEach { kind ->
                    item("more-${kind.name}") {
                        OutlinedButton(onClick = { onLoadMore(kind) }, enabled = kind !in state.loadingRemote, modifier = Modifier.fillMaxWidth().testTag("library-more-${kind.name.lowercase()}")) {
                            Text(stringResource(R.string.learning_library_more, libraryKindLabel(kind)))
                        }
                    }
                }
                if (state.entries.isNotEmpty() && state.loadingRemote.isNotEmpty()) item("more-loading") { LearningLoading() }
            }
        }
    }
}

@Composable
private fun LibraryEntryCard(entry: LibraryEntry, saved: Boolean, onSelect: (LibraryEntry) -> Unit, onSave: (LibraryEntry) -> Unit) {
    Card(onClick = { onSelect(entry) }, modifier = Modifier.fillMaxWidth().testTag("library-entry-${entry.key}")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(entry.title, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (entry.description.isNotBlank()) Text(entry.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Text(
                listOf(libraryKindLabel(entry.kind), stringResource(if (entry.origin == LibraryOrigin.VERIFIED) R.string.learning_library_verified else R.string.learning_library_bundled)).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(if (entry.offline) R.string.learning_library_text_offline else R.string.learning_library_external), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { onSave(entry) }, modifier = Modifier.testTag("library-save-${entry.key}")) { Text(stringResource(if (saved) R.string.learning_unsave else R.string.learning_save)) }
            }
        }
    }
}

@Composable
private fun LibraryDetail(
    state: LibraryUiState,
    entry: LibraryEntry,
    onSelect: (LibraryEntry) -> Unit,
    onSave: (LibraryEntry) -> Unit,
    onMoreAnnotations: () -> Unit,
    onRetryAnnotations: () -> Unit,
    onOpenExperiment: (String) -> Unit,
    onOpenChat: (String) -> Unit,
    onOpenDocument: (String, String) -> Unit,
    onOpenExternal: (String) -> Unit,
) {
    var revealSolution by rememberSaveable(entry.key) { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize().testTag("library-detail"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item("title") {
            Text(entry.title, style = MaterialTheme.typography.headlineMedium)
        }
        item("source") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(stringResource(if (entry.origin == LibraryOrigin.VERIFIED) R.string.learning_library_verified else R.string.learning_library_bundled), style = MaterialTheme.typography.labelLarge)
                entry.source?.let { Text(stringResource(R.string.learning_library_source, it), style = MaterialTheme.typography.bodySmall) }
                Text(stringResource(if (entry.offline) R.string.learning_library_text_offline_description else R.string.learning_library_external_description), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (state.actionProblem != null) item("action-error") { LearningError(state.actionProblem) { onSave(entry) } }
        if (entry.document.isNotBlank()) item("content") {
            Text(entry.document, style = MaterialTheme.typography.bodyLarge)
        }
        if (entry.document.isNotBlank()) item("document") {
            OutlinedButton(onClick = { onOpenDocument(entry.title, entry.document) }, modifier = Modifier.fillMaxWidth().testTag("library-document")) { Text(stringResource(R.string.learning_open_document)) }
        }
        if (entry.kind == LibraryKind.QUESTIONS && entry.document.isNotBlank()) item("learn") {
            Button(onClick = { onOpenChat(entry.document) }, modifier = Modifier.fillMaxWidth().testTag("library-learn")) { Text(stringResource(R.string.learning_start_question)) }
        }
        entry.templateId?.let { template ->
            item("experiment") { Button(onClick = { onOpenExperiment(template) }, modifier = Modifier.fillMaxWidth().testTag("library-experiment")) { Text(stringResource(R.string.learning_open_experiment)) } }
        }
        entry.url?.let { url ->
            item("external") { OutlinedButton(onClick = { onOpenExternal(url) }, modifier = Modifier.fillMaxWidth().testTag("library-external")) { Text(stringResource(R.string.learning_open_source)) } }
        }
        item("bookmark") {
            OutlinedButton(onClick = { onSave(entry) }, modifier = Modifier.fillMaxWidth().testTag("library-detail-save")) { Text(stringResource(if (entry.key in state.savedKeys) R.string.learning_unsave else R.string.learning_save)) }
        }
        entry.solution?.let { solution ->
            item("reveal-solution") { TextButton(onClick = { revealSolution = !revealSolution }, modifier = Modifier.testTag("library-reveal-solution")) { Text(stringResource(if (revealSolution) R.string.learning_hide_solution else R.string.learning_show_solution)) } }
            if (revealSolution) {
                item("solution") {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(stringResource(R.string.learning_reference_solution), style = MaterialTheme.typography.titleMedium)
                        if (solution.result.isNotBlank()) Text(solution.result)
                        solution.steps.forEach { Text(it) }
                        solution.explanation?.let { Text(it) }
                    }
                }
            }
        }
        if (entry.kind == LibraryKind.QUESTIONS && entry.solution == null) item("no-solution") {
            Text(stringResource(R.string.learning_library_no_solution), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(entry.chapters, key = { "chapter:${it.id}" }) { chapter ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(chapter.title, style = MaterialTheme.typography.titleMedium)
                chapter.topics.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                if (chapter.relatedIds.isEmpty()) Text(stringResource(R.string.learning_library_chapter_empty), style = MaterialTheme.typography.bodySmall)
            }
        }
        if (entry.kind == LibraryKind.SOURCES || state.related.isNotEmpty()) item("related-title") {
            Text(stringResource(if (entry.kind == LibraryKind.SOURCES) R.string.learning_library_annotations else R.string.learning_library_related), style = MaterialTheme.typography.titleLarge)
        }
        if (state.annotationsLoading) item("annotations-loading") { LearningLoading() }
        if (state.annotationProblem != null) item("annotations-error") { LearningError(state.annotationProblem, onRetryAnnotations) }
        if (entry.kind == LibraryKind.SOURCES && entry.origin == LibraryOrigin.VERIFIED && !state.annotationsLoading && state.related.isEmpty() && state.annotationProblem == null) item("annotations-empty") {
            LearningEmpty(stringResource(R.string.learning_library_annotations_empty), stringResource(R.string.learning_library_annotations_empty_description))
        }
        items(state.related, key = { "related:${it.key}" }) { related ->
            LibraryEntryCard(related, related.key in state.savedKeys, onSelect, onSave)
        }
        if (state.annotationCursor != null) item("more-annotations") {
            OutlinedButton(onClick = onMoreAnnotations, enabled = !state.annotationsLoading, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.learning_load_more)) }
        }
    }
}

@Composable
internal fun libraryKindLabel(kind: LibraryKind): String = stringResource(when (kind) {
    LibraryKind.ALL -> R.string.learning_all
    LibraryKind.QUESTIONS -> R.string.learning_library_questions
    LibraryKind.RESOURCES -> R.string.learning_library_resources
    LibraryKind.COURSES -> R.string.learning_library_courses
    LibraryKind.KNOWLEDGE -> R.string.learning_library_knowledge
    LibraryKind.EXPERIMENTS -> R.string.learning_home_experiments
    LibraryKind.SOURCES -> R.string.learning_library_sources
    LibraryKind.SAVED -> R.string.learning_library_saved
})

@Composable
internal fun learningDomainLabel(domain: String): String = when (domain) {
    "mechanics" -> stringResource(R.string.learning_domain_mechanics)
    "electromagnetism", "electric", "electricity" -> stringResource(R.string.learning_domain_electric)
    "magnetic", "magnetism" -> stringResource(R.string.learning_domain_magnetic)
    "circuit", "circuits" -> stringResource(R.string.learning_domain_circuit)
    "optics" -> stringResource(R.string.learning_domain_optics)
    "thermal", "thermodynamics" -> stringResource(R.string.learning_domain_thermal)
    "wave", "waves", "acoustics" -> stringResource(R.string.learning_domain_waves)
    "fluid", "fluids" -> stringResource(R.string.learning_domain_fluids)
    "modern" -> stringResource(R.string.learning_domain_modern)
    "physics" -> stringResource(R.string.learning_subject_physics)
    "chemistry" -> stringResource(R.string.learning_subject_chemistry)
    else -> domain
}
