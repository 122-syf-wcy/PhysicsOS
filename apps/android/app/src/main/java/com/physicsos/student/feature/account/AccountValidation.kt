package com.physicsos.student.feature.account

import java.security.MessageDigest

internal enum class AccountProblem {
    AUTH, ACCOUNT_CHANGED, NETWORK, SERVICE_UNAVAILABLE, FORBIDDEN, INVALID_PROOF, TWO_FACTOR,
    RATE_LIMIT, INVALID_NAME, INVALID_PASSWORD, PASSWORD_MISMATCH, INVALID_CODE, DELETE_CONFIRMATION,
    INVALID_RESPONSE, STORAGE, EXPORT_TOO_LARGE, UNSAFE_EXPORT, FILE_UNAVAILABLE, SHARE_UNAVAILABLE,
    INVALID_FEEDBACK, CONFLICT, FAILED,
}
internal class AccountFailure(val problem: AccountProblem) : Exception() {
    override fun toString(): String = "AccountFailure($problem)"
}

internal fun validatedDisplayName(value: String): String = value.trim().also {
    if (it.isEmpty() || it.length > 32 || it.any(Char::isISOControl)) throw AccountFailure(AccountProblem.INVALID_NAME)
}

internal fun validatePasswordChange(current: String, new: String, confirmation: String, code: String) {
    if (current.isEmpty() || current.length > 128 || new.length !in 8..128 || current == new) {
        throw AccountFailure(AccountProblem.INVALID_PASSWORD)
    }
    if (new != confirmation) throw AccountFailure(AccountProblem.PASSWORD_MISMATCH)
    validateAccountCode(code)
}

internal fun validateAccountCode(code: String) {
    if (code.isNotEmpty() && (code.length !in 6..64 || code.any { it.isWhitespace() || it.isISOControl() })) {
        throw AccountFailure(AccountProblem.INVALID_CODE)
    }
}

internal fun validatedFeedback(value: String): String = value.trim().also {
    if (it.isEmpty() || it.length > 10_000 || it.any { char -> char.isISOControl() && char !in "\n\r\t" }) {
        throw AccountFailure(AccountProblem.INVALID_FEEDBACK)
    }
}

internal fun accountInstanceKey(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }

/** Encode exactly one path segment, not a URL, query or fragment. */
internal fun accountPathSegment(value: String): String {
    if (value.isBlank() || value.length > 512 || value.any(Char::isISOControl) || value in setOf(".", "..")) {
        throw AccountFailure(AccountProblem.INVALID_RESPONSE)
    }
    return value.toByteArray(Charsets.UTF_8).joinToString("") { byte ->
        val unsigned = byte.toInt() and 255
        if (unsigned in 65..90 || unsigned in 97..122 || unsigned in 48..57 || unsigned in listOf(45, 46, 95, 126)) {
            unsigned.toChar().toString()
        } else "%%%02X".format(unsigned)
    }
}
