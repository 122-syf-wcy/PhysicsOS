package com.physicsos.student.core

import java.io.File
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest

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

    /** Only the account's hashed feature directories are removed; other accounts and guest files remain. */
    fun deleteOwner(owner: String) {
        OwnerGate.validateOwner(owner)
        val key = MessageDigest.getInstance("SHA-256").digest(owner.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        for (root in roots) for (relative in OWNER_DIRECTORIES) {
            val directory = File(root.canonicalFile, "$relative/$key")
            if (!directory.exists()) continue
            val target = checked(directory)
            if (target.toPath() != directory.toPath().toAbsolutePath().normalize()) throw invalidPath()
            try {
                // walkFileTree does not follow links, so a linked child cannot erase another partition.
                Files.walkFileTree(target.toPath(), object : SimpleFileVisitor<Path>() {
                    override fun visitFile(file: Path, attributes: BasicFileAttributes): FileVisitResult {
                        Files.delete(file)
                        return FileVisitResult.CONTINUE
                    }
                    override fun postVisitDirectory(directory: Path, error: IOException?): FileVisitResult {
                        if (error != null) throw error
                        Files.delete(directory)
                        return FileVisitResult.CONTINUE
                    }
                })
            } catch (_: IOException) {
                throw ApiException(0, "storage_cleanup_failed", "App-private account files could not be removed.")
            }
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

    private companion object {
        val OWNER_DIRECTORIES = listOf("chat-files", "chat-downloads", "captures", "account-exports", "shared/chat", "shared/experiments")
    }
}
