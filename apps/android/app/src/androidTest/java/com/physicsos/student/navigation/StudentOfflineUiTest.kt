package com.physicsos.student.navigation

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.physicsos.student.BuildConfig
import com.physicsos.student.MainActivity
import com.physicsos.student.R
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real local screens and bundled assets; never logs in or sends production student data. */
@RunWith(AndroidJUnit4::class)
class StudentOfflineUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Before
    fun requireIsolatedServerOrigin() {
        assertTrue("Build device tests with an isolated candidate origin", BuildConfig.SERVER_ORIGIN.endsWith(".invalid"))
        enableWebViewAccessibility()
        waitFor("home")
        // The launch animation owns the screen briefly; interactions start once it retires.
        ui.waitUntil(timeoutMillis = 30_000) {
            ui.onAllNodesWithTag("boot-splash").fetchSemanticsNodes().isEmpty()
        }
    }

    @Test
    fun homeOpensFullOfflineCatalogAndSearchHasARecoverableEmptyState() {
        ui.onNodeWithTag("home-experiments").performScrollTo().performClick()
        waitFor("experiment_template_uniform-linear")
        ui.onNodeWithTag("experiments_search").performTextInput("no-such-physics-template-97831")
        ui.onNodeWithText(ui.activity.getString(R.string.experiments_no_results)).assertIsDisplayed()
        ui.onNodeWithTag("experiments_search").performTextClearance()
        waitFor("experiment_template_uniform-linear")
        ui.onNodeWithTag("experiment_template_uniform-linear").assertIsDisplayed()
    }

    @Test
    fun bundledExperimentComputesInTheRealWebViewAndSavesItsCheckpoint() {
        ui.onNodeWithTag("home-experiments").performScrollTo().performClick()
        waitFor("experiment_template_uniform-linear")
        ui.onNodeWithTag("experiment_template_uniform-linear").performClick()
        waitFor("experiment_run_status")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        // The lab lives in a WebView: its DOM only reaches UiAutomator while the device-wide
        // accessibility switch is on, and the bridge maps aria-label to text, not content-desc.
        enableWebViewAccessibility()
        val step = By.text("单步 1/60 s")
        assertTrue("The bundled Worker and renderer must become interactive", device.wait(Until.hasObject(step), 30_000))
        device.findObject(step).click()
        assertTrue("A real physics step must advance the displayed time", device.wait(Until.hasObject(By.textContains("0.017")), 10_000))
        ui.onNodeWithTag("experiment_save").performClick()
        val savedMessage = ui.activity.getString(R.string.experiments_saved_guest)
        ui.waitUntil(timeoutMillis = 15_000) { ui.onAllNodesWithText(savedMessage).fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("experiment_back").performClick()
        waitFor("experiments")
        ui.onNodeWithTag("experiments_tab_saved").performClick()
        ui.onNodeWithText(ui.activity.getString(R.string.experiments_saved_empty)).assertDoesNotExist()
    }

    @Test
    fun guestCanOpenTheBundledLibraryWithoutAnOnlineSession() {
        ui.onNodeWithTag("home-library").performScrollTo().performClick()
        waitFor("library")
        val realEntry = SemanticsMatcher("bundled library content") { node ->
            node.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("library-entry-") == true
        }
        ui.waitUntil(timeoutMillis = 30_000) { ui.onAllNodes(realEntry).fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("library-search").assertIsDisplayed()
        ui.onNodeWithTag("library-search").performTextInput("no-such-library-entry-97831")
        // The soft keyboard covers the results area, so the empty state is read with it closed.
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        ui.onNodeWithText(ui.activity.getString(R.string.learning_library_empty)).assertIsDisplayed()
        ui.onNodeWithTag("library-search").performTextClearance()
        ui.onNodeWithTag("library-results").assertIsDisplayed()
    }

    @Test
    fun registrationCanOpenBundledPrivacyWithAccessibleDocumentControls() {
        ui.onNodeWithTag("nav_account").performClick()
        waitFor("auth")
        ui.onNodeWithTag("auth-register").performScrollTo().performClick()
        ui.onNodeWithText(ui.activity.getString(R.string.learning_privacy_policy)).performScrollTo().performClick()
        waitFor("document_webview")
        ui.onNodeWithTag("document_font_larger").assertIsDisplayed().performClick()
        ui.onNodeWithTag("document_font_reset").assertIsDisplayed().performClick()
        ui.onNodeWithTag("document_back").performClick()
        waitFor("auth")
    }

    private fun waitFor(tag: String) {
        ui.waitUntil(timeoutMillis = 30_000) { ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    }

    /** UiAutomation does not flip the accessibility switch that gates WebView's DOM tree. */
    private fun enableWebViewAccessibility() {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        repeat(5) {
            val enabled = device.executeShellCommand("settings get secure accessibility_enabled")
                .trim().toIntOrNull() == 1
            if (enabled) return
            device.executeShellCommand("settings put secure accessibility_enabled 1")
            Thread.sleep(300)
        }
    }
}
