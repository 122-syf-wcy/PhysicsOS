package com.physicsos.student.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil3.compose.AsyncImage
import coil3.request.ImageRequest

/** Decorative covers are the checked-in experiment artwork, bundled offline with the lab. */
@Composable
fun BundledArtwork(id: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val safeId = id.takeIf { it.matches(Regex("[a-z0-9-]{1,100}")) } ?: "lab"
    var fallback by remember(safeId) { mutableStateOf(false) }
    val image = remember(context, safeId, fallback) {
        ImageRequest.Builder(context)
            .data("file:///android_asset/lab/covers/${if (fallback) "lab" else safeId}.jpg")
            .build()
    }
    AsyncImage(model = image, contentDescription = null, modifier = modifier, contentScale = ContentScale.Crop,
        onError = { if (!fallback) fallback = true })
}
