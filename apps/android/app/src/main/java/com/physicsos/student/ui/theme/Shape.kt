package com.physicsos.student.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

val PhysicsShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(26.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

object PhysicsSpacing {
    val extraSmall = 4.dp
    val small = 8.dp
    val medium = 12.dp
    val large = 16.dp
    val extraLarge = 24.dp
    val section = 32.dp
    val minimumTouchTarget = 48.dp
    val compactContentPadding = 16.dp
    val mediumContentPadding = 24.dp
    val expandedContentPadding = 32.dp
    val readableContentWidth = 1080.dp
}
