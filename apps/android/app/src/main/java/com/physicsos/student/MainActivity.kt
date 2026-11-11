package com.physicsos.student

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.physicsos.student.navigation.PhysicsApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // The manifest declares the white boot theme so the starting window matches the
        // web splash; the running activity uses the regular (light/night) theme.
        setTheme(R.style.Theme_PhysicsOS_Student)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val graph = (application as PhysicsApplication).graph
        setContent { PhysicsApp(graph) }
    }
}
