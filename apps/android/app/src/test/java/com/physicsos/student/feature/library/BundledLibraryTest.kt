package com.physicsos.student.feature.library

import com.physicsos.student.core.AssetCatalogRepository
import com.physicsos.student.core.AssetSource
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reads the same real generated catalogs that Gradle stages into the APK. */
class BundledLibraryTest {
    private val assets = File("../../mobile-lab/dist/lab")
    private fun catalog() = AssetCatalogRepository(AssetSource { relative -> File(assets, relative.removePrefix("lab/")).inputStream() })

    @Test fun actualApkCatalogProducesQuestionsAndExperimentsForOfflineBrowsing() = runBlocking {
        val catalog = catalog()
        val library = catalog.library()
        val experiments = catalog.experiments()
        val entries = LibraryDecoders.bundled(library, experiments)
        assertEquals((library["questions"] as JsonArray).size, entries.count { it.kind == LibraryKind.QUESTIONS })
        assertEquals(experiments.size, entries.count { it.kind == LibraryKind.EXPERIMENTS })
        assertTrue(entries.count { it.kind == LibraryKind.QUESTIONS && it.offline } >= 100)
        assertEquals(entries.size, entries.map { it.key }.toSet().size)
        assertTrue(LibraryDecoders.filter(entries, LibraryFilter(), emptySet()).isNotEmpty())
    }

    @Test fun externalDirectorySnapshotsAreNotFalselyAdvertisedAsOfflineResources() = runBlocking {
        val catalog = catalog()
        val entries = LibraryDecoders.bundled(catalog.library(), catalog.experiments())
        val resources = entries.filter { it.kind == LibraryKind.RESOURCES || it.kind == LibraryKind.COURSES }
        assertTrue(resources.isNotEmpty())
        assertTrue(resources.all { !it.offline && it.url?.startsWith("https://") == true })
    }

    @Test fun localBookmarkRoundTripsAndVerifiedOnlyDoesNotInventServerVerification() = runBlocking {
        val catalog = catalog()
        val entries = LibraryDecoders.bundled(catalog.library(), catalog.experiments())
        val question = entries.first { it.kind == LibraryKind.QUESTIONS }
        assertEquals(question, LibraryDecoders.bookmark(question.bookmark()))
        val saved = LibraryDecoders.filter(entries, LibraryFilter(kind = LibraryKind.SAVED), setOf(question.key))
        assertEquals(listOf(question), saved)
        assertFalse(question.origin == LibraryOrigin.VERIFIED)
        assertTrue(LibraryDecoders.filter(entries, LibraryFilter(verifiedOnly = true), emptySet()).isEmpty())
    }
}
