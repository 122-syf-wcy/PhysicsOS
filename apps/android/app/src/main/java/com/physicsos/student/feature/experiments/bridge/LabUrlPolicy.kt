package com.physicsos.student.feature.experiments.bridge

import java.net.URI
import java.util.Locale

internal enum class LabPage(val url: String) {
    EXPERIMENT("https://appassets.androidplatform.net/assets/lab/index.html"),
    DOCUMENT("https://appassets.androidplatform.net/assets/lab/document.html"),
}

internal enum class LabNavigation { ANCHOR, EXTERNAL_BROWSER, BLOCK }

/** The AssetLoader never falls through to a real network request. */
internal object LabUrlPolicy {
    const val HOST = "appassets.androidplatform.net"
    const val ORIGIN = "https://appassets.androidplatform.net"
    private val encodedSeparators = Regex("%(?:2e|2f|5c|00|25)", RegexOption.IGNORE_CASE)

    fun trustedSender(origin: String, isMainFrame: Boolean): Boolean {
        if (!isMainFrame) return false
        val uri = uri(origin) ?: return false
        return sameOrigin(uri) && uri.rawPath.orEmpty() in setOf("", "/") &&
            uri.rawQuery == null && uri.rawFragment == null
    }

    fun bundledAsset(url: String): Boolean {
        val uri = uri(url) ?: return false
        if (!sameOrigin(uri) || uri.rawQuery != null) return false
        val path = uri.rawPath ?: return false
        if (!path.startsWith("/assets/lab/") || '\\' in path || encodedSeparators.containsMatchIn(path)) return false
        if (uri.path.split('/').any { it == "." || it == ".." || it.any(Char::isISOControl) }) return false
        return !path.contains("//") && !path.endsWith('/')
    }

    fun navigation(url: String, page: LabPage, isMainFrame: Boolean, hasGesture: Boolean): LabNavigation {
        if (!isMainFrame) return LabNavigation.BLOCK
        val uri = uri(url) ?: return LabNavigation.BLOCK
        val current = URI(page.url)
        if (sameOrigin(uri)) {
            return if (uri.rawPath == current.rawPath && uri.rawQuery == null && uri.rawFragment != null) {
                LabNavigation.ANCHOR
            } else LabNavigation.BLOCK
        }
        return if (hasGesture && browserUrl(url)) LabNavigation.EXTERNAL_BROWSER else LabNavigation.BLOCK
    }

    fun browserUrl(url: String): Boolean {
        val uri = uri(url) ?: return false
        return uri.scheme == "https" && !uri.host.isNullOrBlank() &&
            uri.host.lowercase(Locale.ROOT) != HOST && uri.rawUserInfo == null &&
            uri.port in -1..65535 && !url.any(Char::isISOControl)
    }

    fun documentImage(url: String): Boolean {
        val absolute = try { URI(LabPage.DOCUMENT.url).resolve(url).toString() } catch (_: Exception) { return false }
        if (!bundledAsset(absolute)) return false
        val path = uri(absolute)?.path?.lowercase(Locale.ROOT) ?: return false
        return listOf(".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg").any(path::endsWith)
    }

    private fun sameOrigin(uri: URI): Boolean = uri.scheme == "https" &&
        uri.host?.lowercase(Locale.ROOT) == HOST && uri.port in setOf(-1, 443) && uri.rawUserInfo == null

    private fun uri(value: String): URI? = try {
        if (value.length > 8192 || value.any(Char::isISOControl)) null else URI(value)
    } catch (_: Exception) { null }
}
