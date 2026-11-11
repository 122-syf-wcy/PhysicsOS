package com.physicsos.student.feature.chat

import android.content.ActivityNotFoundException
import android.content.Intent
import android.text.Spanned
import android.util.TypedValue
import android.widget.TextView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.drawable.toDrawable
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.physicsos.student.R
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.ext.latex.JLatexMathPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.inlineparser.MarkwonInlineParserPlugin
import java.net.URI
import java.util.concurrent.Executors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext

private val nativeMathExecutor by lazy {
    Executors.newFixedThreadPool(2) { work -> Thread(work, "physicsos-formula").apply { isDaemon = true } }
}
private data class NativeParagraph(val text: Spanned?, val expressions: Set<String> = emptySet(), val failed: Boolean = false)

/** Native Markdown/LaTeX, not a WebView per message. Completed paragraphs do not re-layout per token. */
@Composable
internal fun NativeMessageBody(markdown: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val size = with(density) { 16.sp.toPx() }
    val ink = MaterialTheme.colorScheme.onSurface.toArgb()
    val link = MaterialTheme.colorScheme.primary.toArgb()
    val lineSpacing = with(density) { 5.dp.toPx() }
    val failedFormulas = remember { MutableStateFlow(FormulaFailures()) }
    val formulaFailures by failedFormulas.collectAsStateWithLifecycle()
    val renderer = remember(context, size, ink, link, failedFormulas) {
        Markwon.builder(context.applicationContext)
            .usePlugin(MarkwonInlineParserPlugin.create())
            .usePlugin(TablePlugin.create(context.applicationContext))
            .usePlugin(JLatexMathPlugin.create(size) { options ->
                options.inlinesEnabled(true).executorService(nativeMathExecutor)
                options.theme().textColor(ink).blockFitCanvas(true)
                options.errorHandler { formula, _ ->
                    failedFormulas.update { it.record(formula) }
                    // Do not let a library write students' formula content into logs.
                    ink.toDrawable().apply { setBounds(0, 0, size.toInt(), size.toInt()) }
                }
            })
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                    builder.linkResolver { _, target ->
                        val uri = runCatching { URI(target) }.getOrNull()
                        if (uri?.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null) {
                            try { context.startActivity(Intent(Intent.ACTION_VIEW, target.toUri()).addCategory(Intent.CATEGORY_BROWSABLE)) }
                            catch (_: ActivityNotFoundException) { }
                            catch (_: SecurityException) { }
                        }
                    }
                }
            }).build()
    }
    val layout by produceState<RichMessageLayout?>(null, markdown) {
        value = withContext(Dispatchers.Default) { richMessageLayout(markdown) }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        layout?.parts?.forEach { part -> key(part.index) {
            val paragraph by produceState<NativeParagraph?>(null, part.markdown, renderer) {
                value = try { withContext(Dispatchers.Default) {
                    val normalized = nativeMathMarkdown(part.markdown)
                    val delimiters = Regex("\\$\\$").findAll(normalized).count()
                    // A streaming formula is not a failed formula. Show its original
                    // text until both delimiters arrive, then typeset the complete expression.
                    if (delimiters % 2 != 0) NativeParagraph(null)
                    else NativeParagraph(renderer.toMarkdown(normalized),
                        Regex("\\$\\$([\\s\\S]+?)\\$\\$").findAll(normalized)
                            .map { it.groupValues[1].replace('\n', ' ').trim() }.toSet())
                } }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { NativeParagraph(null, failed = true) }
            }
            val failed = paragraph?.failed == true || paragraph?.expressions?.let(formulaFailures::affects) == true
            val text = paragraph?.text
            AndroidView(
                modifier = Modifier.fillMaxWidth(),
                factory = { viewContext -> TextView(viewContext).apply {
                    setTextSize(TypedValue.COMPLEX_UNIT_PX, size)
                    setTextColor(ink); setLinkTextColor(link)
                    // Formula bitmaps can be wider than a phone; keep the paragraph reflowable
                    // instead of using horizontalScroll, which hides the right edge of prose.
                    setHorizontallyScrolling(false)
                    includeFontPadding = false
                    setLineSpacing(lineSpacing, 1f)
                    setTextIsSelectable(true)
                } },
                onRelease = { view -> renderer.setMarkdown(view, ""); view.tag = null },
                update = { view ->
                    view.setTextColor(ink); view.setLinkTextColor(link)
                    view.setTextSize(TypedValue.COMPLEX_UNIT_PX, size)
                    view.setLineSpacing(lineSpacing, 1f)
                    if (failed || text == null) {
                        if (view.tag != null) renderer.setMarkdown(view, "")
                        if (view.text.toString() != part.markdown) view.text = part.markdown
                        view.tag = null
                    } else if (view.tag !== text) {
                        renderer.setParsedMarkdown(view, text); view.tag = text
                    }
                },
            )
            if (failed) Text(stringResource(R.string.chat_rich_formula_fallback), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        } }
        if (layout?.abbreviated == true) Text(stringResource(R.string.chat_preview_abbreviated), style = MaterialTheme.typography.labelSmall)
    }
}
