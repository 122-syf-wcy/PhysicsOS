package com.physicsos.student.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.core.view.WindowCompat

/** Native Material theme. System font scale is preserved; device colors are opt-in. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun PhysicsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    /** Forces dark system-bar icons while an always-light surface (the boot splash) is up. */
    lightSystemBars: Boolean? = null,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val view = LocalView.current
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> PhysicsDarkColorScheme
        else -> PhysicsLightColorScheme
    }
    if (!view.isInEditMode) {
        SideEffect {
            context.activityOrNull()?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = lightSystemBars ?: !darkTheme
                    isAppearanceLightNavigationBars = lightSystemBars ?: !darkTheme
                }
            }
        }
    }
    MaterialTheme(colorScheme = colorScheme, typography = PhysicsTypography, shapes = PhysicsShapes) {
        Surface(
            modifier = Modifier.fillMaxSize().semantics { testTagsAsResourceId = true },
            color = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onBackground,
        ) {
            content()
        }
    }
}

private tailrec fun Context.activityOrNull(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> if (baseContext === this) null else baseContext.activityOrNull()
    else -> null
}
