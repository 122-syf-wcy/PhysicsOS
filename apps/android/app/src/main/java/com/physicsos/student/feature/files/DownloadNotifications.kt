package com.physicsos.student.feature.files

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.physicsos.student.MainActivity
import com.physicsos.student.R
import com.physicsos.student.core.SettingsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/** Local completion only, after a verified download. This is not vendor push integration. */
internal suspend fun notifyDownloadComplete(context: Context, settings: SettingsRepository, stillOwner: () -> Boolean) {
    try {
        if (!stillOwner() || !settings.notificationsEnabled.first()) return
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val notifications = NotificationManagerCompat.from(context)
        if (!notifications.areNotificationsEnabled()) return
        val channelId = "verified-downloads"
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(channelId, context.getString(R.string.download_notification_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_physicsos)
            .setContentTitle(context.getString(R.string.download_notification_complete))
            .setContentText(context.getString(R.string.download_notification_description))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .build()
        if (stillOwner()) notifications.notify("physicsos-download", 1, notification)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        // Notification denial or a device service failure does not undo a verified download.
    }
}
