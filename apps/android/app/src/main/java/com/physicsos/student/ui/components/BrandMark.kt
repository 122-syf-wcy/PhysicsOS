package com.physicsos.student.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.physicsos.student.R

/** Byte-identical official website mark; launcher artwork is a separate asset. */
@Composable
fun BrandMark(modifier: Modifier = Modifier, wordmark: Boolean = true) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Image(painterResource(R.drawable.ic_physicsos_brand), contentDescription = if (wordmark) null else "PhysicsOS", modifier = Modifier.size(30.dp))
        if (wordmark) Text("PhysicsOS", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}
