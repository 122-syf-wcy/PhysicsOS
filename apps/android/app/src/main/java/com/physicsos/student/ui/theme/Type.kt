package com.physicsos.student.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// System fonts provide Chinese glyphs and respect the user's font scale. Do not
// override LocalDensity or turn sp into dp to squeeze large text into a layout.
val PhysicsTypography = Typography(
    displayLarge = physicsTextStyle(40, 48, FontWeight.Medium),
    displayMedium = physicsTextStyle(36, 44, FontWeight.Medium),
    displaySmall = physicsTextStyle(32, 40, FontWeight.Medium),
    headlineLarge = physicsTextStyle(30, 38, FontWeight.SemiBold),
    headlineMedium = physicsTextStyle(28, 36, FontWeight.SemiBold),
    headlineSmall = physicsTextStyle(24, 32, FontWeight.SemiBold),
    titleLarge = physicsTextStyle(22, 30, FontWeight.SemiBold),
    titleMedium = physicsTextStyle(16, 24, FontWeight.SemiBold),
    titleSmall = physicsTextStyle(14, 22, FontWeight.SemiBold),
    bodyLarge = physicsTextStyle(16, 26, FontWeight.Normal),
    bodyMedium = physicsTextStyle(14, 22, FontWeight.Normal),
    bodySmall = physicsTextStyle(12, 18, FontWeight.Normal),
    labelLarge = physicsTextStyle(14, 20, FontWeight.SemiBold),
    labelMedium = physicsTextStyle(12, 18, FontWeight.Medium),
    labelSmall = physicsTextStyle(12, 18, FontWeight.Medium),
)

private fun physicsTextStyle(size: Int, lineHeight: Int, weight: FontWeight) = TextStyle(
    fontFamily = FontFamily.Default,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    letterSpacing = 0.sp,
)
