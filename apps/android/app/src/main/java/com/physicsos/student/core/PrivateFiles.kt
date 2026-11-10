package com.physicsos.student.core

import java.io.File
import java.io.IOException

internal class PrivateFiles(private val roots: List<File>) {
    fun destination(file: File): File {
        val canonical = checked(file)
        if (canonical.isDirectory) throw invalidPath()
        val parent = canonical.parentFile ?: throw invalidPath()
        if (!parent.isDirectory && !parent.mkdirs()) {
            throw ApiException(0, "storage_unavailable", "The download directory could not be created.")
        }
        return canonical
    }

    fun checked(file: File): File {
        val target = try { file.canonicalFile } catch (_: IOException) { throw invalidPath() }
        if (roots.none { root ->
                val canonicalRoot = root.canonicalFile
                target != canonicalRoot && target.toPath().startsWith(canonicalRoot.toPath())
            }
        ) throw invalidPath()
        return target
    }

    fun delete(path: String?) {
        if (path == null) return
        val file = checked(File(path))
        if (file.isDirectory) throw invalidPath()
        if (file.exists() && !file.delete()) {
            throw ApiException(0, "storage_cleanup_failed", "An app-private downloaded file could not be removed.")
        }
    }

    fun cleanInterruptedParts(now: Long) {
        for (root in roots) {
            if (!root.isDirectory) continue
            root.walkTopDown().onEnter { directory ->
                runCatching { directory.canonicalFile.toPath().startsWith(root.canonicalFile.toPath()) }.getOrDefault(false)
            }.filter { file ->
                file.isFile && file.name.startsWith(".physicsos-download-") && file.name.endsWith(".part") &&
                    file.lastModified() < now - 86_400_000
            }.forEach { file -> delete(file.path) }
        }
    }

    private fun invalidPath() = ApiException(0, "untrusted_file_path", "Downloads must use an app-private file location.")
}
