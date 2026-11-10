package com.physicsos.student.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal class DefaultAuthRepository(
    private val transport: HttpTransport,
    private val grants: GrantStore,
    private val owners: OwnerGate,
    private val scope: CoroutineScope,
    private val isOnline: () -> Boolean,
    private val client: () -> DefaultMobileClient,
    private val purgeOwner: suspend (String) -> Unit,
    private val activateOwner: suspend (MobileUser) -> Unit,
    private val exportOwner: suspend (String) -> JsonObject,
    private val onAuthenticated: suspend (String) -> Unit,
    private val onSignedOut: suspend (String) -> Unit,
    private val appVersion: String,
    private val now: () -> Long = System::currentTimeMillis,
) : AuthRepository {
    private val mutex = Mutex()
    private val mutableState = MutableStateFlow<AuthState>(AuthState.Restoring)
    private val mutableError = MutableStateFlow<ApiException?>(null)
    override val state = mutableState.asStateFlow()
    override val lastError = mutableError.asStateFlow()

    internal fun reportBackgroundError(error: ApiException) {
        if (mutableError.value == null) mutableError.value = error
    }

    private var restored = false
    private var restoration: Deferred<Unit>? = null
    private var refresh: Deferred<AccessLease>? = null
    private var refreshEpoch = -1L
    private var session: Session? = null
    private var expiry: Job? = null

    override suspend fun restore() {
        val task = mutex.withLock {
            if (restored) return
            restoration ?: scope.async(start = CoroutineStart.LAZY) { restoreInternal() }.also { restoration = it }
        }
        task.start()
        task.await()
    }

    private suspend fun restoreInternal() {
        val restoreEpoch = transport.fence.current()
        val stamp = try {
            mutex.withLock {
                if (restored) return
                val saved = grants.read()
                restored = true
                if (saved == null) {
                    mutableState.value = AuthState.SignedOut
                    return
                }
                if (saved.owner != saved.user.userKey || saved.owner == OwnerGate.GUEST_OWNER) {
                    throw ApiException(0, "secure_storage_invalid", "The saved identity is invalid. Sign in again.")
                }
                if (saved.refreshExpiresAt <= now()) {
                    grants.clear()
                    mutableState.value = AuthState.SignedOut
                    mutableError.value = expired()
                    return
                }
                val identity = AccountStamp(saved.owner, transport.fence.current(), saved.user.userId)
                session = Session(identity, saved.user, saved, null, 0)
                scheduleExpiry(identity, saved.refreshExpiresAt)
                if (!isOnline() || saved.rotationPending) {
                    owners.replace(identity) { activateOwner(saved.user) }
                    mutableState.value = AuthState.SignedIn(saved.user)
                    mutableError.value = if (saved.rotationPending) uncertainRefresh() else offline()
                    return
                }
                identity
            }
        } catch (error: ApiException) {
            mutex.withLock {
                if (transport.fence.isCurrent(restoreEpoch)) {
                    restored = true
                    session = null
                    owners.replace(null)
                    mutableState.value = AuthState.SignedOut
                    mutableError.value = error
                }
            }
            throw error
        }
        // No stored access token is accepted as an authenticated restoration.
        obtainLease(stamp, forceRefresh = true)
    }

    override suspend fun login(body: JsonObject): JsonObject = authenticate("auth/login", body, device = true)
    override suspend fun register(body: JsonObject): JsonObject = authenticate("auth/register", body, device = true)
    override suspend fun verifyTwoFactor(body: JsonObject): JsonObject = authenticate("auth/login/2fa", body, device = false)

    private suspend fun authenticate(path: String, body: JsonObject, device: Boolean): JsonObject {
        val transition = endSession(eraseLocal = true, error = null)
        transition.grant?.let { previous -> scope.launch { revokeQuietly(previous) } }
        val epoch = transition.epoch
        val deviceId = if (device) grants.installationId() else null
        transport.fence.check(epoch)
        val payload = if (deviceId != null) buildJsonObject {
            body.forEach { (key, value) -> if (key !in setOf("deviceId", "platform", "appVersion")) put(key, value) }
            put("deviceId", deviceId)
            put("appVersion", appVersion)
        } else body
        val response = try {
            WireProtocol.mobile(transport.json("POST", transport.policy.mobile(path), payload, epoch = epoch))
                .requireObject("Authentication response")
        } catch (error: ApiException) {
            mutex.withLock { if (transport.fence.isCurrent(epoch)) mutableError.value = error }
            throw error
        }
        transport.fence.check(epoch)
        when (response.requireString("status", "Authentication response")) {
            "authenticated" -> {
                val value = authenticated(response)
                val stamp = AccountStamp(value.user.userKey, epoch, value.user.userId)
                try {
                    commit(stamp, value)
                } catch (error: Exception) {
                    scope.launch { revokeQuietly(value.grant) }
                    throw error
                }
                notifyAuthenticated(stamp)
                // UI code receives status/user, never a reusable credential.
                return JsonObject(response.filterKeys { it != "tokens" })
            }
            "challenge" -> {
                response.requireString("challengeToken", "Login challenge")
                WireProtocol.instant(response.requireString("expiresAt", "Login challenge"), "expiresAt")
            }
            "pending" -> Unit
            else -> protocolError("Unknown authentication status.")
        }
        return response
    }

    internal suspend fun lease(expected: AccountStamp? = null): AccessLease {
        restore()
        return obtainLease(expected, forceRefresh = false)
    }

    internal suspend fun rejected(lease: AccessLease): AccessLease =
        obtainLease(lease.stamp, forceRefresh = true, rejectedToken = lease.token)

    private suspend fun obtainLease(
        expected: AccountStamp?,
        forceRefresh: Boolean,
        rejectedToken: String? = null,
    ): AccessLease {
        val expiredStamp = mutex.withLock {
            session?.takeIf { (expected == null || it.stamp == expected) && it.grant.refreshExpiresAt <= now() }?.stamp
        }
        if (expiredStamp != null) {
            invalidate(expiredStamp, eraseLocal = false, error = expired())
            throw expired()
        }
        val task = mutex.withLock {
            val current = session ?: throw ApiException(401, "sign_in_required", "Sign in to continue.")
            transport.fence.check(current.stamp.epoch)
            if (expected != null && expected != current.stamp) throw accountChanged()
            if (current.grant.refreshExpiresAt <= now()) throw expired()
            if (current.token != null && current.accessExpiresAt > now() + 30_000 &&
                (!forceRefresh || (rejectedToken != null && rejectedToken != current.token))
            ) return AccessLease(current.stamp, current.token)
            refresh?.takeIf { refreshEpoch == current.stamp.epoch && !it.isCompleted }?.let { return@withLock it }
            if (current.grant.rotationPending) throw uncertainRefresh()
            if (!isOnline()) {
                if (owners.active.value != current.stamp) owners.replace(current.stamp) { activateOwner(current.user) }
                mutableState.value = AuthState.SignedIn(current.user)
                mutableError.value = offline()
                throw offline()
            }
            scope.async(start = CoroutineStart.LAZY) { rotate(current.stamp) }.also {
                refresh = it
                refreshEpoch = current.stamp.epoch
            }
        }
        task.start()
        return task.await()
    }

    private suspend fun rotate(stamp: AccountStamp): AccessLease {
        var rotationWasPersisted = false
        try {
            val saved = mutex.withLock {
                val current = requireSession(stamp)
                if (current.grant.rotationPending) throw uncertainRefresh()
                val rotating = current.grant.copy(rotationPending = true)
                // A killed process must never replay a grant whose request may have reached the server.
                withContext(NonCancellable) { grants.write(rotating) }
                session = current.copy(grant = rotating)
                rotationWasPersisted = true
                rotating
            }
            val response = WireProtocol.mobile(
                transport.json(
                    "POST", transport.policy.mobile("auth/refresh"),
                    buildJsonObject { put("refreshToken", saved.refreshToken) }, epoch = stamp.epoch,
                ),
            ).requireObject("Refresh response")
            val value = authenticated(response)
            if (value.user.userKey != stamp.owner || value.user.userId != stamp.userId) {
                scope.launch { revokeQuietly(value.grant) }
                invalidate(stamp, eraseLocal = false, error = ApiException(401, "identity_changed", "The server changed this grant's account identity. Sign in again."))
                protocolError("Refreshing a grant changed its account identity.")
            }
            try {
                commit(stamp, value)
            } catch (error: Exception) {
                scope.launch { revokeQuietly(value.grant) }
                throw error
            }
            notifyAuthenticated(stamp)
            return AccessLease(stamp, value.accessToken)
        } catch (error: CancellationException) {
            if (rotationWasPersisted) withContext(NonCancellable) { keepOfflineAfterUncertainRefresh(stamp) }
            throw error
        } catch (error: ApiException) {
            if (!transport.fence.isCurrent(stamp.epoch)) throw accountChanged()
            if (error.status == 401 && error.code in setOf("INVALID_REFRESH_TOKEN", "UNAUTHENTICATED", "unauthorized")) {
                invalidate(stamp, eraseLocal = false, error = expired())
            } else if (rotationWasPersisted) {
                keepOfflineAfterUncertainRefresh(stamp)
            } else {
                mutex.withLock {
                    val current = requireSession(stamp)
                    owners.replace(stamp) { activateOwner(current.user) }
                    mutableState.value = AuthState.SignedIn(current.user)
                    mutableError.value = error
                }
            }
            throw if (rotationWasPersisted && error.status != 401) uncertainRefresh() else error
        }
    }

    private suspend fun keepOfflineAfterUncertainRefresh(stamp: AccountStamp) {
        mutex.withLock {
            if (!transport.fence.isCurrent(stamp.epoch)) return
            val current = session?.takeIf { it.stamp == stamp } ?: return
            session = current.copy(token = null, accessExpiresAt = 0)
            if (current.grant.refreshExpiresAt > now()) {
                owners.replace(stamp) { activateOwner(current.user) }
                mutableState.value = AuthState.SignedIn(current.user)
                mutableError.value = uncertainRefresh()
            }
        }
    }

    private suspend fun commit(stamp: AccountStamp, value: Authentication) = withContext(NonCancellable) {
        mutex.withLock {
            transport.fence.check(stamp.epoch)
            try {
                grants.write(value.grant)
                transport.fence.check(stamp.epoch)
                owners.replace(stamp) { activateOwner(value.user) }
            } catch (error: Exception) {
                session = null
                mutableState.value = AuthState.SignedOut
                owners.replace(null)
                grants.clear()
                throw error
            }
            session = Session(stamp, value.user, value.grant, value.accessToken, value.expiresAt)
            mutableState.value = AuthState.SignedIn(value.user)
            mutableError.value = null
            restored = true
            scheduleExpiry(stamp, value.grant.refreshExpiresAt)
        }
    }

    override suspend fun logout() {
        val transition = endSession(eraseLocal = true, error = null)
        val previous = transition.grant ?: return
        try {
            revoke(previous)
        } catch (error: ApiException) {
            // Local logout is complete even if an offline server cannot acknowledge revocation.
            val failure = ApiException(error.status, "logout_revocation_unconfirmed", "Signed out on this device; server revocation could not be confirmed.")
            if (transport.fence.isCurrent(transition.epoch)) mutableError.value = failure
            throw failure
        }
    }

    private suspend fun endSession(eraseLocal: Boolean, error: ApiException?): SessionEnd = withContext(NonCancellable) {
        val transition = mutex.withLock {
            val saved = session?.grant ?: if (!restored) {
                try { grants.read() } catch (_: ApiException) { null }
            } else null
            val epoch = transport.fence.advance()
            restored = true
            session = null
            expiry?.cancel()
            expiry = null
            mutableState.value = AuthState.SignedOut
            mutableError.value = error
            try {
                grants.clear()
            } finally {
                owners.replace(null) {
                    if (eraseLocal && saved != null) purgeOwner(saved.owner)
                }
            }
            SessionEnd(saved, epoch)
        }
        transition.grant?.let {
            if (owners.active.value?.owner != it.owner) notifySignedOut(it.owner)
        }
        transition
    }

    internal suspend fun invalidate(stamp: AccountStamp, eraseLocal: Boolean, error: ApiException?) {
        withContext(NonCancellable) {
            val changed = mutex.withLock {
                if (!transport.fence.isCurrent(stamp.epoch) || session?.stamp != stamp) return@withLock false
                transport.fence.advance()
                session = null
                restored = true
                expiry?.cancel()
                expiry = null
                mutableState.value = AuthState.SignedOut
                mutableError.value = error
                try {
                    grants.clear()
                } finally {
                    owners.replace(null) { if (eraseLocal) purgeOwner(stamp.owner) }
                }
                true
            }
            if (changed) onSignedOut(stamp.owner)
        }
    }

    internal suspend fun accountMutation(stamp: AccountStamp, method: String, path: String, result: JsonElement) {
        val value = result as? JsonObject ?: return
        when {
            method == "POST" && path == "auth/password" &&
                (value["reauthenticate"] as? JsonPrimitive)?.booleanOrNull == true ->
                invalidate(stamp, eraseLocal = false, error = ApiException(401, "reauthentication_required", "Your password changed. Sign in again."))
            method == "DELETE" && path == "auth/account" && value.optionalString("status") in setOf("deleted", "deletion_pending") ->
                invalidate(stamp, eraseLocal = true, error = null)
            method == "PATCH" && path == "auth/profile" -> updateUser(stamp, value)
            method == "DELETE" && path.startsWith("auth/devices/") &&
                (value["reauthenticate"] as? JsonPrimitive)?.booleanOrNull == true -> invalidate(stamp, false, expired())
        }
    }

    override suspend fun refreshUser() {
        val current = lease()
        val result = client().requestOwned("GET", "auth/me", null, current.stamp).requireObject("Account response")
        updateUser(current.stamp, result)
    }

    private suspend fun updateUser(stamp: AccountStamp, response: JsonObject) {
        val user = parseUser(response["user"] ?: protocolError("The account response has no user."))
        if (user.userKey != stamp.owner) protocolError("The account response changed identity.")
        mutex.withLock {
            val current = requireSession(stamp)
            val grant = current.grant.copy(user = user)
            grants.write(grant)
            session = current.copy(user = user, grant = grant)
            mutableState.value = AuthState.SignedIn(user)
        }
    }

    override suspend fun deleteAccount(body: JsonObject): JsonObject {
        val current = lease()
        val result = client().requestOwned("DELETE", "auth/account", body, current.stamp).requireObject("Deletion response")
        if (result.optionalString("status") !in setOf("deleted", "deletion_pending")) protocolError("The server did not acknowledge account deletion.")
        return result
    }

    override suspend fun exportData(): JsonObject {
        val stamp = lease().stamp
        val manifest = client().requestOwned("GET", "account/export", null, stamp).requireObject("Export manifest")
        val sections = manifest["sections"] as? JsonArray ?: protocolError("The export manifest has no sections.")
        val exported = linkedMapOf<String, JsonElement>()
        var bytes = 0L
        for (section in sections) {
            val descriptor = section.requireObject("Export section")
            val id = descriptor.requireString("id", "Export section")
            if (exported.containsKey(id)) protocolError("The export manifest repeats a section.")
            val path = descriptor.requireString("path", "Export section")
            val initial = transport.policy.mobile(path)
            if (initial.encodedPath != transport.policy.mobile("account/export").encodedPath || initial.queryParameter("section") != id) {
                protocolError("The export section path does not match its identity.")
            }
            val rows = mutableListOf<JsonElement>()
            val cursors = mutableSetOf<String>()
            var cursor: String? = null
            var pages = 0
            do {
                val url = initial.newBuilder().setQueryParameter("limit", "100").apply {
                    if (cursor != null) setQueryParameter("cursor", cursor)
                }.build()
                val relative = "account/export?${url.encodedQuery.orEmpty()}"
                val page = client().requestOwned("GET", relative, null, stamp).requireObject("Export page")
                if (page.optionalString("section") != id) protocolError("The export page belongs to a different section.")
                val items = page["items"] as? JsonArray ?: protocolError("The export page has no items.")
                bytes += page.toString().toByteArray(Charsets.UTF_8).size
                if (bytes > MAX_EXPORT_BYTES || ++pages > 10_000) {
                    throw ApiException(0, "export_too_large", "This account requires a section-by-section export; no partial export was returned.")
                }
                rows.addAll(items)
                cursor = page.optionalString("nextCursor")?.takeIf { it.isNotEmpty() }
                if (cursor != null && !cursors.add(cursor!!)) protocolError("The export server repeated a pagination cursor.")
            } while (cursor != null)
            exported[id] = JsonArray(rows)
        }
        transport.fence.check(stamp.epoch)
        val local = exportOwner(stamp.owner)
        transport.fence.check(stamp.epoch)
        return buildJsonObject {
            put("version", 1)
            put("manifest", manifest)
            put("server", JsonObject(exported))
            put("local", local)
        }
    }

    private fun authenticated(response: JsonObject): Authentication {
        if (response.optionalString("status") != "authenticated") protocolError("The server did not authenticate this grant.")
        val user = parseUser(response["user"] ?: protocolError("The authentication response has no user."))
        val tokens = response["tokens"]?.requireObject("Authentication tokens") ?: protocolError("Authentication tokens are missing.")
        val access = tokens.requireString("accessToken", "Authentication tokens")
        val refresh = tokens.requireString("refreshToken", "Authentication tokens")
        if (access.length > 16_384 || refresh.length > 16_384 || access.any { it.isWhitespace() } || refresh.any { it.isWhitespace() }) {
            protocolError("The authentication response contains an invalid credential.")
        }
        val expiresAt = WireProtocol.instant(tokens.requireString("expiresAt"), "expiresAt")
        val refreshExpiresAt = WireProtocol.instant(tokens.requireString("refreshExpiresAt"), "refreshExpiresAt")
        if (expiresAt <= now() || refreshExpiresAt <= now() || expiresAt > refreshExpiresAt) protocolError("The authentication grant is already expired.")
        return Authentication(user, access, expiresAt, PersistedGrant(user.userKey, user, refresh, refreshExpiresAt))
    }

    private fun parseUser(value: JsonElement): MobileUser = try {
        wireJson.decodeFromJsonElement(MobileUser.serializer(), value).also {
            if (it.userKey.isBlank() || it.userKey == OwnerGate.GUEST_OWNER || it.schoolId.isBlank() || it.username.isBlank() || it.role.isBlank()) {
                protocolError("The server returned an invalid account identity.")
            }
        }
    } catch (_: SerializationException) {
        protocolError("The server returned an invalid account identity.")
    }

    private fun requireSession(stamp: AccountStamp): Session {
        transport.fence.check(stamp.epoch)
        return session?.takeIf { it.stamp == stamp } ?: throw accountChanged()
    }

    private fun scheduleExpiry(stamp: AccountStamp, expiresAt: Long) {
        expiry?.cancel()
        expiry = scope.launch {
            delay((expiresAt - now()).coerceAtLeast(0))
            invalidate(stamp, eraseLocal = false, error = expired())
        }
    }

    private suspend fun notifyAuthenticated(stamp: AccountStamp) {
        try {
            onAuthenticated(stamp.owner)
        } catch (error: ApiException) {
            mutex.withLock { if (transport.fence.isCurrent(stamp.epoch)) mutableError.value = error }
        }
    }

    private suspend fun revoke(grant: PersistedGrant) {
        WireProtocol.mobile(transport.json(
            "POST", transport.policy.mobile("auth/logout"), buildJsonObject { put("refreshToken", grant.refreshToken) },
        ))
    }

    private suspend fun revokeQuietly(grant: PersistedGrant) {
        try {
            revoke(grant)
        } catch (_: ApiException) {
            // The local key has already been erased; never replay this grant as a refresh.
        }
    }

    private fun expired() = ApiException(401, "session_expired", "Your sign-in grant expired or was revoked. Sign in again.")
    private fun offline() = ApiException(0, "network_unavailable", "Offline: your local data is available; server operations need a connection.")
    private fun uncertainRefresh() = ApiException(401, "reauthentication_required", "The refresh result could not be confirmed. Local data is available; sign in again before syncing.")

    private data class Session(
        val stamp: AccountStamp,
        val user: MobileUser,
        val grant: PersistedGrant,
        val token: String?,
        val accessExpiresAt: Long,
    ) {
        override fun toString(): String = "Session([redacted])"
    }
    private class Authentication(val user: MobileUser, val accessToken: String, val expiresAt: Long, val grant: PersistedGrant)

    private companion object {
        const val MAX_EXPORT_BYTES = 128L * 1024 * 1024
    }
}
