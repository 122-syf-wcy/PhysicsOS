package com.physicsos.student.feature.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.physicsos.student.ui.theme.PhysicsTheme
import kotlinx.serialization.json.JsonArray
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Isolated visual/interaction tests only. No sign-in substitute or model call enters the application. */
@RunWith(AndroidJUnit4::class)
class ChatUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun promptSuggestionFillsADraftWithoutSubmittingAndOfflineSendStaysDisabled() {
        var sent = 0
        ui.setContent { PhysicsTheme {
            var state by remember { mutableStateOf(ChatUiState(initialized = true, online = false, connection = ChatConnection.OFFLINE)) }
            Column(Modifier.fillMaxSize()) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    ChatWelcome(false, onPrompt = { prompt -> state = state.copy(draft = state.draft.copy(text = prompt)) })
                }
                ChatComposer(state, "queue", { state = state.copy(draft = state.draft.copy(text = it)) }, {}, { sent++ }, {}, {}, {}, {})
            }
        } }
        ui.onNodeWithTag("chat-suggestion-0").performClick()
        ui.onNodeWithTag("chat-send").assertIsNotEnabled()
        assertEquals(0, sent)
    }

    @Test fun readyComposerSendsOnlyWhenExplicitlyPressed() {
        var sent = 0
        ui.setContent { PhysicsTheme {
            var state by remember { mutableStateOf(ChatUiState(initialized = true, online = true, connection = ChatConnection.LIVE)) }
            ChatComposer(state, "queue", { state = state.copy(draft = state.draft.copy(text = it)) }, {}, { sent++ }, {}, {}, {}, {})
        } }
        ui.onNodeWithTag("chat-send").assertIsNotEnabled()
        ui.onNodeWithTag("chat-input").performTextInput("Explain the force diagram.")
        ui.onNodeWithTag("chat-send").assertIsEnabled().performClick()
        assertEquals(1, sent)
    }

    @Test fun userBubbleKeepsCopyAndQuoteOnTheMessageInsteadOfServerOnlyActions() {
        var copied = 0
        val row = ChatRow.Message("user-one", 0, MessageRole.USER, JsonArray(emptyList()), "A question", "", null, null, null)
        ui.setContent { PhysicsTheme { ChatMessageCard(row, { copied++ }, {}, {}, {}) } }
        ui.onNodeWithTag("chat-copy-user-one").assertIsDisplayed().performClick()
        assertEquals(1, copied)
        ui.onNodeWithTag("chat-document-user-one").assertDoesNotExist()
    }

    @Test fun assistantMessageHasNativeFormulaAndFullDocumentActionsWithoutAWebView() {
        var copied = 0
        val markdown = "## Force and acceleration\n\nThe net force is $" + "F=ma$" + ".\n\nFor a 2 kg body, $" + "a=3\\,\\mathrm{m/s^2}$" + "."
        val row = ChatRow.Message("formula", 1, MessageRole.ASSISTANT, JsonArray(emptyList()), markdown, "", null, null, null)
        ui.setContent { PhysicsTheme {
            ChatMessageCard(row, { copied++ }, {}, {}, {})
        } }
        ui.onNodeWithTag("chat-message-formula").assertIsDisplayed()
        ui.onNodeWithTag("chat-document-formula").assertIsDisplayed()
        ui.onNodeWithTag("chat-copy-formula").performClick()
        assertEquals(1, copied)
    }
}
