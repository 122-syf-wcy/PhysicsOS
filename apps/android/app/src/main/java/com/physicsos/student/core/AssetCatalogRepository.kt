package com.physicsos.student.core

import android.content.res.AssetManager
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

internal fun interface AssetSource {
    fun open(path: String): InputStream
}

internal class AssetCatalogRepository(private val source: AssetSource) : CatalogRepository {
    constructor(assets: AssetManager) : this(AssetSource { assets.open(it) })

    private val mutex = Mutex()
    private var catalogCache: List<ExperimentInfo>? = null
    private var libraryCache: JsonObject? = null

    override suspend fun experiments(): List<ExperimentInfo> = withContext(Dispatchers.IO) {
        mutex.withLock {
            catalogCache?.let { return@withLock it }
            val root = read("lab/catalog.json")
            requireVersion(root, "catalog")
            val rows = root["experiments"] as? JsonArray ?: invalid("catalog", "experiments must be an array")
            if (rows.isEmpty()) invalid("catalog", "the generated experiment catalog is empty")
            val identifiers = mutableSetOf<String>()
            val experiments = rows.map { row ->
                val item = try {
                    wireJson.decodeFromJsonElement(ExperimentInfo.serializer(), row)
                } catch (_: SerializationException) {
                    invalid("catalog", "an experiment is missing its required fields")
                }
                if (item.id.isBlank() || item.title.isBlank() || item.domain.isBlank() || item.stage.isBlank() ||
                    item.tags.any { it.isBlank() } || !identifiers.add(item.id)
                ) invalid("catalog", "an experiment has an invalid or duplicate identity")
                item
            }
            catalogCache = experiments
            experiments
        }
    }

    override suspend fun library(): JsonObject = withContext(Dispatchers.IO) {
        mutex.withLock {
            libraryCache?.let { return@withLock it }
            val root = read("lab/library.json")
            requireVersion(root, "library")
            var count = 0
            for (name in LIBRARY_SECTIONS) {
                val rows = root[name] as? JsonArray ?: invalid("library", "$name must be a generated array")
                val ids = mutableSetOf<String>()
                for (row in rows) {
                    val objectRow = row as? JsonObject ?: invalid("library", "$name contains a non-object row")
                    val id = objectRow.optionalString("id") ?: invalid("library", "$name contains a row without an id")
                    if (id.isBlank() || !ids.add(id)) invalid("library", "$name contains an invalid or duplicate id")
                }
                count += rows.size
            }
            if (count == 0) invalid("library", "the generated library is empty")
            libraryCache = root
            root
        }
    }

    private fun read(path: String): JsonObject {
        val bytes = try {
            source.open(path).use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(32_768)
                var count = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    count += read
                    if (count > MAX_ASSET_BYTES) throw ApiException(0, "catalog_asset_too_large", "The packaged $path exceeds the supported size.")
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            }
        } catch (_: IOException) {
            throw ApiException(0, "catalog_asset_missing", "The APK is missing or cannot read $path. Rebuild the generated lab assets.")
        }
        return try {
            WireProtocol.parse(bytes) as? JsonObject ?: invalid(path, "the root must be an object")
        } catch (_: ApiException) {
            invalid(path, "the packaged JSON cannot be decoded")
        }
    }

    private fun requireVersion(root: JsonObject, asset: String) {
        if ((root["version"] as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull != 1) {
            invalid(asset, "unsupported generated resource version")
        }
    }

    private fun invalid(asset: String, reason: String): Nothing =
        throw ApiException(0, "catalog_asset_invalid", "Invalid packaged $asset: $reason. Rebuild the lab assets.")

    private companion object {
        const val MAX_ASSET_BYTES = 64L * 1024 * 1024
        val LIBRARY_SECTIONS = listOf("courses", "knowledge", "questions", "resources", "sources")
    }
}
