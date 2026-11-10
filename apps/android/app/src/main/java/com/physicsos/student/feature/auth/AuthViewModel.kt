package com.physicsos.student.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.physicsos.student.R
import com.physicsos.student.core.ApiException
import com.physicsos.student.core.AppGraph
import com.physicsos.student.feature.home.LearningContractException
import com.physicsos.student.feature.home.LearningProblem
import com.physicsos.student.feature.home.asObject
import com.physicsos.student.feature.home.learningProblem
import com.physicsos.student.feature.home.encoded
import com.physicsos.student.feature.home.parseCollection
import com.physicsos.student.feature.home.requiredText
import com.physicsos.student.feature.home.text
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Route values are names, never credentials or a second-factor challenge. */
enum class AuthMode { LOGIN, REGISTER, FORGOT, RESET }
internal enum class AuthField { USERNAME, PASSWORD, CONFIRM_PASSWORD, DISPLAY_NAME, EMAIL, SCHOOL_NAME, INVITE, CODE, TOKEN, TERMS }
internal enum class AuthStep { FORM, CHALLENGE, PENDING, RESET_REQUESTED, RESET_FINISHED }

internal data class SchoolChoice(val id: String, val name: String, val location: String)

internal data class AuthFields(
    val username: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val displayName: String = "",
    val email: String = "",
    val schoolId: String? = null,
    val schoolLabel: String = "",
    val schoolName: String = "",
    val unlistedSchool: Boolean = false,
    val invite: String = "",
    val code: String = "",
    val token: String = "",
    val acceptedTerms: Boolean = false,
)

internal data class AuthUiState(
    val mode: AuthMode = AuthMode.LOGIN,
    val step: AuthStep = AuthStep.FORM,
    val fields: AuthFields = AuthFields(),
    val busy: Boolean = false,
    val schoolsLoading: Boolean = false,
    val schoolPickerOpen: Boolean = false,
    val schoolQuery: String = "",
    val schools: List<SchoolChoice> = emptyList(),
    val schoolProblem: LearningProblem? = null,
    val problem: LearningProblem? = null,
    val fieldErrors: Map<AuthField, Int> = emptyMap(),
    val challengeExpiresAt: String? = null,
    val pendingSchool: String = "",
    val pendingEmail: String = "",
)

internal object AuthValidation {
    private val username = Regex("^[a-zA-Z0-9_.-]{3,32}$")
    private val email = Regex("^[^@\\s]+@[^@\\s.]+(\\.[^@\\s.]+)+$")
    private val invite = Regex("^inv_[A-Za-z0-9_-]{20,128}$")

    fun errors(mode: AuthMode, fields: AuthFields, challenge: Boolean = false): Map<AuthField, Int> = buildMap {
        if (challenge) {
            if (fields.code.trim().length !in 6..64) put(AuthField.CODE, R.string.learning_auth_code_invalid)
            return@buildMap
        }
        if (mode != AuthMode.RESET && fields.username.trim().length !in 1..64) {
            put(AuthField.USERNAME, R.string.learning_auth_username_required)
        }
        if (mode == AuthMode.REGISTER && !username.matches(fields.username.trim())) {
            put(AuthField.USERNAME, R.string.learning_auth_username_invalid)
        }
        if (mode == AuthMode.LOGIN && fields.password.length !in 1..128) {
            put(AuthField.PASSWORD, R.string.learning_auth_password_required)
        }
        if (mode == AuthMode.REGISTER || mode == AuthMode.RESET) {
            if (fields.password.length !in 8..128) put(AuthField.PASSWORD, R.string.learning_auth_password_length)
            if (fields.confirmPassword != fields.password) put(AuthField.CONFIRM_PASSWORD, R.string.learning_auth_password_mismatch)
        }
        if (mode == AuthMode.REGISTER) {
            if (fields.displayName.trim().length !in 1..32) put(AuthField.DISPLAY_NAME, R.string.learning_auth_display_name_invalid)
            if (fields.email.trim().length > 254 || !email.matches(fields.email.trim())) put(AuthField.EMAIL, R.string.learning_auth_email_invalid)
            if (fields.unlistedSchool) {
                if (fields.schoolName.trim().length !in 2..64) put(AuthField.SCHOOL_NAME, R.string.learning_auth_school_required)
            } else if (fields.schoolId.isNullOrBlank()) put(AuthField.SCHOOL_NAME, R.string.learning_auth_school_required)
            if (fields.invite.isNotBlank() && !invite.matches(fields.invite.trim())) put(AuthField.INVITE, R.string.learning_auth_invite_invalid)
            if (!fields.acceptedTerms) put(AuthField.TERMS, R.string.learning_auth_terms_required)
        }
        if (mode == AuthMode.RESET && fields.token.trim().length !in 40..256) put(AuthField.TOKEN, R.string.learning_auth_token_invalid)
    }

    fun body(mode: AuthMode, fields: AuthFields): JsonObject = buildJsonObject {
        when (mode) {
            AuthMode.LOGIN -> {
                put("username", fields.username.trim())
                put("password", fields.password)
                fields.schoolId?.let { put("schoolId", it) }
                put("rememberDevice", true)
            }
            AuthMode.REGISTER -> {
                put("username", fields.username.trim())
                put("password", fields.password)
                put("displayName", fields.displayName.trim())
                put("email", fields.email.trim())
                if (fields.unlistedSchool) put("schoolName", fields.schoolName.trim())
                else fields.schoolId?.let { put("schoolId", it) }
                if (fields.invite.isNotBlank()) put("inviteCode", fields.invite.trim())
            }
            AuthMode.FORGOT -> {
                put("username", fields.username.trim())
                fields.schoolId?.let { put("schoolId", it) }
            }
            AuthMode.RESET -> {
                put("token", fields.token.trim())
                put("newPassword", fields.password)
            }
        }
    }
}

internal class AuthViewModel(private val graph: AppGraph, initialMode: AuthMode, resetToken: String?) : ViewModel() {
    private val mutable = MutableStateFlow(AuthUiState(mode = initialMode, fields = AuthFields(token = resetToken.orEmpty())))
    val state = mutable.asStateFlow()
    private var operation: Job? = null
    private var schoolJob: Job? = null
    private var challengeToken: String? = null

    fun changeMode(mode: AuthMode) {
        operation?.cancel()
        challengeToken = null
        mutable.update {
            it.copy(
                mode = mode, step = AuthStep.FORM, busy = false, problem = null, fieldErrors = emptyMap(),
                fields = it.fields.copy(password = "", confirmPassword = "", code = "", token = ""),
            )
        }
    }

    fun edit(field: AuthField, value: String) {
        if (state.value.busy) return
        mutable.update {
            val fields = when (field) {
                AuthField.USERNAME -> it.fields.copy(username = value.take(64))
                AuthField.PASSWORD -> it.fields.copy(password = value.take(128))
                AuthField.CONFIRM_PASSWORD -> it.fields.copy(confirmPassword = value.take(128))
                AuthField.DISPLAY_NAME -> it.fields.copy(displayName = value.take(32))
                AuthField.EMAIL -> it.fields.copy(email = value.take(254))
                AuthField.SCHOOL_NAME -> it.fields.copy(schoolName = value.take(64))
                AuthField.INVITE -> it.fields.copy(invite = value.take(132))
                AuthField.CODE -> it.fields.copy(code = value.take(64))
                AuthField.TOKEN -> it.fields.copy(token = value.take(256))
                AuthField.TERMS -> it.fields
            }
            it.copy(fields = fields, fieldErrors = it.fieldErrors - field, problem = null)
        }
    }

    fun acceptTerms(value: Boolean) = mutable.update {
        it.copy(fields = it.fields.copy(acceptedTerms = value), fieldErrors = it.fieldErrors - AuthField.TERMS)
    }

    fun unlistedSchool(value: Boolean) = mutable.update {
        it.copy(fields = it.fields.copy(unlistedSchool = value), fieldErrors = it.fieldErrors - AuthField.SCHOOL_NAME)
    }

    fun showSchools(show: Boolean) {
        mutable.update { it.copy(schoolPickerOpen = show) }
        if (show && state.value.schoolQuery.isNotBlank()) loadSchools()
    }

    fun selectSchool(school: SchoolChoice?) = mutable.update {
        it.copy(
            schoolPickerOpen = false,
            fields = it.fields.copy(schoolId = school?.id, schoolLabel = school?.name.orEmpty()),
            fieldErrors = it.fieldErrors - AuthField.SCHOOL_NAME,
        )
    }

    fun searchSchools(query: String) {
        mutable.update { it.copy(schoolQuery = query.take(80)) }
        loadSchools(debounce = true)
    }

    fun loadSchools(debounce: Boolean = false) {
        schoolJob?.cancel()
        val query = state.value.schoolQuery.trim()
        if (query.isEmpty()) {
            mutable.update { it.copy(schools = emptyList(), schoolsLoading = false, schoolProblem = null) }
            return
        }
        schoolJob = viewModelScope.launch {
            mutable.update { it.copy(schoolsLoading = true, schoolProblem = null) }
            try {
                if (debounce) delay(250)
                val schools = withContext(Dispatchers.IO) {
                    parseCollection(graph.api.request("GET", "auth/schools?q=${encoded(query)}&limit=20", authenticated = false).asObject())
                        .filter { it.text("status") != "disabled" }
                        .map { SchoolChoice(it.requiredText("id"), it.requiredText("name"), listOfNotNull(it.text("city"), it.text("county")).joinToString(" · ")) }
                        .distinctBy { it.id }
                }
                mutable.update { it.copy(schools = schools, schoolsLoading = false) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(schoolsLoading = false, schoolProblem = error.learningProblem()) }
            }
        }
    }

    fun cancel() {
        operation?.cancel()
        mutable.update { it.copy(busy = false) }
    }

    fun submit() {
        val current = state.value
        if (current.busy) return
        val errors = AuthValidation.errors(current.mode, current.fields, current.step == AuthStep.CHALLENGE)
        if (errors.isNotEmpty()) {
            mutable.update { it.copy(fieldErrors = errors, problem = null) }
            return
        }
        operation = viewModelScope.launch {
            mutable.update { it.copy(busy = true, problem = null, fieldErrors = emptyMap()) }
            try {
                val result = withContext(Dispatchers.IO) {
                    if (current.step == AuthStep.CHALLENGE) {
                        val challenge = challengeToken ?: throw LearningContractException()
                        graph.auth.verifyTwoFactor(buildJsonObject {
                            put("challengeToken", challenge)
                            put("code", current.fields.code.trim())
                        })
                    } else {
                        val body = AuthValidation.body(current.mode, current.fields)
                        when (current.mode) {
                            AuthMode.LOGIN -> graph.auth.login(body)
                            AuthMode.REGISTER -> graph.auth.register(body)
                            AuthMode.FORGOT -> graph.api.request("POST", "auth/password-reset/request", body, authenticated = false).asObject()
                            AuthMode.RESET -> graph.api.request("POST", "auth/password-reset/submit", body, authenticated = false).asObject()
                        }
                    }
                }
                when {
                    current.mode == AuthMode.FORGOT -> mutable.update { it.copy(step = AuthStep.RESET_REQUESTED, busy = false) }
                    current.mode == AuthMode.RESET -> mutable.update {
                        it.copy(step = AuthStep.RESET_FINISHED, busy = false, fields = it.fields.copy(password = "", confirmPassword = "", token = ""))
                    }
                    result.text("status") == "challenge" -> {
                        challengeToken = result.requiredText("challengeToken")
                        mutable.update {
                            it.copy(step = AuthStep.CHALLENGE, busy = false, challengeExpiresAt = result.text("expiresAt"), fields = it.fields.copy(password = "", confirmPassword = "", code = ""))
                        }
                    }
                    result.text("status") == "pending" -> mutable.update {
                        it.copy(step = AuthStep.PENDING, busy = false, pendingSchool = result.text("schoolName").orEmpty(), pendingEmail = result.text("email").orEmpty(), fields = it.fields.copy(password = "", confirmPassword = ""))
                    }
                    result.text("status") == "authenticated" -> {
                        challengeToken = null
                        mutable.update { it.copy(busy = false, fields = it.fields.copy(password = "", confirmPassword = "", code = "", token = "")) }
                    }
                    else -> throw LearningContractException()
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                val problem = when {
                    error is ApiException && error.code.uppercase() in setOf("BAD_CREDENTIALS", "INVALID_CREDENTIALS", "INVALID_LOGIN", "UNAUTHORIZED") -> LearningProblem(R.string.learning_auth_credentials_invalid, false)
                    error is ApiException && error.code.uppercase().contains("CHALLENGE") -> LearningProblem(R.string.learning_auth_challenge_invalid, false)
                    error is ApiException && error.code.uppercase() == "SCHOOL_AMBIGUOUS" -> LearningProblem(R.string.learning_auth_select_school, false)
                    else -> error.learningProblem()
                }
                mutable.update { it.copy(busy = false, problem = problem) }
            }
        }
    }
}
