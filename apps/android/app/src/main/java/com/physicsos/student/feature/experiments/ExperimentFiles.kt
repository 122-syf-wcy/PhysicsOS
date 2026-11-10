package com.physicsos.student.feature.experiments

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.physicsos.student.feature.experiments.bridge.LabFilePolicy
import com.physicsos.student.feature.experiments.bridge.ValidatedLabFile
import com.physicsos.student.feature.experiments.bridge.labActivity
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

internal data class SharedLabFile(val file: File, val mime: String, val name: String)

/** Only explicit, validated exports enter the FileProvider's narrow files/shared root. */
internal class ExperimentFiles(context: Context) {
    private val appContext = context.applicationContext
    private val root = File(appContext.filesDir, "shared/experiments")

    suspend fun write(owner: String, export: ValidatedLabFile): SharedLabFile = withContext(Dispatchers.IO) {
        ensureActive()
        val ownerKey = MessageDigest.getInstance("SHA-256").digest(owner.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        val folder = LabFilePolicy.child(root, "$ownerKey/${UUID.randomUUID()}")
        if (!folder.mkdirs()) throw IOException("Unable to create the private export directory")
        val target = LabFilePolicy.child(folder, export.name)
        val temporary = LabFilePolicy.child(folder, "export.partial")
        try {
            FileOutputStream(temporary).use { output -> output.write(export.bytes); output.fd.sync() }
            ensureActive()
            if (!temporary.renameTo(target)) throw IOException("Unable to finish the private export")
            prune(File(root, ownerKey), folder)
            SharedLabFile(target, export.mime, export.name)
        } catch (error: Exception) {
            temporary.delete()
            target.delete()
            folder.delete()
            throw error
        }
    }

    private fun prune(ownerRoot: File, current: File) {
        val cutoff = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000
        val folders = ownerRoot.listFiles()?.filter {
            it.isDirectory && it.canonicalFile.parentFile == ownerRoot.canonicalFile && it.name.matches(Regex("[0-9a-f-]{36}"))
        }?.sortedByDescending { it.lastModified() }.orEmpty()
        folders.forEachIndexed { index, directory ->
            if (directory != current && (index >= 16 || directory.lastModified() < cutoff)) {
                directory.listFiles()?.forEach { file ->
                    if (file.canonicalFile.parentFile == directory.canonicalFile && file.isFile) file.delete()
                }
                directory.delete()
            }
        }
    }
}

internal fun shareLabFile(context: Context, file: SharedLabFile, chooserTitle: String) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file.file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = file.mime
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, file.name)
        clipData = ClipData.newUri(context.contentResolver, file.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val chooser = Intent.createChooser(intent, chooserTitle).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (context.labActivity() == null) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(chooser)
}
