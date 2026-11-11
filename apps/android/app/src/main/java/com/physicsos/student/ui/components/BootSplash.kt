package com.physicsos.student.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.physicsos.student.R
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/** The web boot screen: white hold, portrait splash photo, brand line and progress sweep. */
private const val BOOT_HOLD_MILLIS = 2_400
private const val BOOT_MAX_WAIT_MILLIS = 8_000L
private const val BOOT_READY_HOLD_MILLIS = 380L
private const val BOOT_EXIT_MILLIS = 520
private const val BOOT_PROGRESS_MILLIS = 420

private val BootInk = Color(0xFF16202E)
private val BootInkSoft = Color(0xFF55606F)
private val BootInkFaint = Color(0xFF8B95A3)
private val BootAccentFrom = Color(0xFF22D3EE)
private val BootAccentTo = Color(0xFF2F7BFF)
private val BootTrack = Color(0x1416202E)

/** CSS cubic-bezier(.2, .8, .2, 1), shared by the cover, the rising copy and the bar. */
private val BootEase = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/** CSS 0.96 * (1 - (1 - t)^3): the time-based term the web bar follows. */
private val BootTimeEase = Easing { fraction ->
    val left = 1f - fraction
    1f - left * left * left
}

/**
 * Full-screen launch animation kept in step with the web boot module: the photo fades
 * and settles over 0.9 s, the wordmark, tagline, bar and hint rise in at 80/180/260/320 ms,
 * the bar approaches 96 % over 2.4 s, then [ready] releases it to 100 %, it rests for
 * 380 ms and fades out over 520 ms. The web splash is always light, so dark theme keeps it.
 *
 * @param ready true once first-run restoration (the app's "plugins" equivalent) finished.
 * @param onFinished invoked after the fade so the caller can retire the splash for this process.
 */
@Composable
fun BootSplash(ready: Boolean, onFinished: () -> Unit, modifier: Modifier = Modifier) {
    val progress = remember { Animatable(0f) }
    val exit = remember { Animatable(1f) }
    var finished by remember { mutableStateOf(false) }
    val readyState = rememberUpdatedState(ready)
    val finish = rememberUpdatedState(onFinished)

    LaunchedEffect(Unit) {
        progress.animateTo(0.96f, tween(BOOT_HOLD_MILLIS, easing = BootTimeEase))
        // A slow restore must not trap the launch screen; the app below shows its own state.
        withTimeoutOrNull(BOOT_MAX_WAIT_MILLIS) { snapshotFlow { readyState.value }.first { it } }
        progress.animateTo(1f, tween(BOOT_PROGRESS_MILLIS, easing = BootEase))
        finished = true
        delay(BOOT_READY_HOLD_MILLIS)
        exit.animateTo(0f, tween(BOOT_EXIT_MILLIS, easing = LinearEasing))
        finish.value()
    }

    BoxWithConstraints(
        modifier.fillMaxSize()
            .graphicsLayer { alpha = exit.value }
            .background(Color.White)
            .testTag("boot-splash")
            .pointerInput(Unit) {
                // The animation owns the screen; taps must not reach the hidden app below.
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        event.changes.forEach { it.consume() }
                    }
                }
            },
    ) {
        val topPadding = maxOf(maxHeight * 0.12f, 72.dp)
        val bottomInset = maxHeight * 0.07f
        val veilHeight = maxHeight * 0.22f
        val taglineMax = with(LocalDensity.current) { (22 * 13.5f).sp.toDp() }

        val cover = remember { Animatable(0f) }
        LaunchedEffect(Unit) { cover.animateTo(1f, tween(900, easing = BootEase)) }
        Image(
            painter = painterResource(R.drawable.splash_portrait),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            alignment = Alignment.Center,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                alpha = cover.value
                val settle = 1.015f - 0.015f * cover.value
                scaleX = settle
                scaleY = settle
            },
        )

        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(veilHeight).background(
                Brush.verticalGradient(
                    0f to Color.White.copy(alpha = 0f),
                    0.58f to Color.White.copy(alpha = 0.92f),
                    1f to Color.White,
                ),
            ),
        )

        Column(
            Modifier.fillMaxSize().padding(top = topPadding, start = 24.dp, end = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            RiseIn(80) { rise ->
                Column(rise, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = stringResource(R.string.boot_brand),
                        color = BootInk,
                        fontSize = 30.sp,
                        lineHeight = 33.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.63).sp,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(18.dp))
                    Box(
                        Modifier.width(44.dp).height(2.dp).clip(RoundedCornerShape(2.dp))
                            .background(Brush.horizontalGradient(listOf(BootAccentFrom, BootAccentTo))),
                    )
                }
            }
            RiseIn(180) { rise ->
                Text(
                    text = stringResource(R.string.boot_tagline),
                    modifier = rise.padding(top = 22.dp).widthIn(max = taglineMax),
                    color = BootInkSoft,
                    fontSize = 13.5.sp,
                    lineHeight = 24.3.sp,
                    letterSpacing = 0.135.sp,
                    textAlign = TextAlign.Center,
                    // The web copy is balanced; balanced wrapping avoids a lone trailing glyph.
                    style = LocalTextStyle.current.copy(lineBreak = LineBreak.Heading),
                )
            }
        }

        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = bottomInset + 30.dp),
            contentAlignment = Alignment.Center,
        ) {
            RiseIn(260) { rise -> BootProgress({ progress.value }, finished, rise) }
        }
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = bottomInset),
            contentAlignment = Alignment.Center,
        ) {
            // Recompute only when the displayed whole percent changes, not every frame.
            val percent by remember { derivedStateOf { (progress.value * 100).roundToInt() } }
            RiseIn(320) { rise ->
                Text(
                    text = if (finished) {
                        stringResource(R.string.boot_ready)
                    } else {
                        stringResource(R.string.boot_preparing, percent)
                    },
                    modifier = rise,
                    color = BootInkFaint,
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                    letterSpacing = 1.5.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** Staggered 10 dp rise with a fade, mirroring the web `rise` keyframes. */
@Composable
private fun RiseIn(delayMillis: Int, content: @Composable (Modifier) -> Unit) {
    val rise = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(delayMillis.toLong())
        rise.animateTo(1f, tween(620, easing = BootEase))
    }
    val offset = with(LocalDensity.current) { 10.dp.toPx() }
    content(
        Modifier.graphicsLayer {
            alpha = rise.value
            translationY = (1f - rise.value) * offset
        },
    )
}

/**
 * 132 x 3 dp track with a gradient fill and the travelling highlight from the web spinner.
 * The animated fraction is read only in the draw phase, so the bar redraws without recomposing.
 */
@Composable
private fun BootProgress(progress: () -> Float, finished: Boolean, modifier: Modifier = Modifier) {
    val shine = if (!finished) {
        rememberInfiniteTransition(label = "boot-shine").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(1_400, easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)),
                repeatMode = RepeatMode.Restart,
            ),
            label = "boot-shine",
        )
    } else {
        null
    }
    Box(
        modifier.width(132.dp).height(3.dp).clip(RoundedCornerShape(999.dp)).drawWithContent {
            drawRect(BootTrack)
            val fill = size.width * progress().coerceIn(0f, 1f)
            if (fill > 0f) {
                drawRect(
                    brush = Brush.horizontalGradient(listOf(BootAccentFrom, BootAccentTo), endX = fill),
                    size = Size(fill, size.height),
                )
            }
            if (shine != null) {
                val band = size.width * 0.5f
                val start = -band + (size.width + band) * shine.value
                drawRect(
                    brush = Brush.horizontalGradient(
                        listOf(Color.Transparent, Color.White.copy(alpha = 0.55f), Color.Transparent),
                        startX = start,
                        endX = start + band,
                    ),
                    topLeft = Offset(start, 0f),
                    size = Size(band, size.height),
                )
            }
        },
    )
}
