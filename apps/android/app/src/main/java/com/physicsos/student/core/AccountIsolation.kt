package com.physicsos.student.core

import java.io.Closeable
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal data class AccountStamp(val owner: String, val epoch: Long, val userId: String)

internal class AccessLease(val stamp: AccountStamp, val token: String) {
    override fun toString(): String = "AccessLease([redacted])"
}

/** Cancels HTTP calls, pending upgrades and established sockets at an account transition. */
internal class RequestFence {
    private val lock = Any()
    private var epoch = 0L
    private val cancellations = mutableMapOf<Any, () -> Unit>()

    fun current(): Long = synchronized(lock) { epoch }
    fun isCurrent(expected: Long): Boolean = synchronized(lock) { epoch == expected }

    fun check(expected: Long) {
        if (!isCurrent(expected)) throw accountChanged()
    }

    fun <T> commit(expected: Long, action: () -> T): T = synchronized(lock) {
        if (epoch != expected) throw accountChanged()
        action()
    }

    fun register(expected: Long, cancel: () -> Unit): Closeable {
        val key = Any()
        synchronized(lock) {
            if (epoch != expected) {
                cancel()
                throw accountChanged()
            }
            cancellations[key] = cancel
        }
        return Closeable { synchronized(lock) { cancellations.remove(key) } }
    }

    fun advance(): Long {
        val (next, old) = synchronized(lock) {
            epoch += 1
            val callbacks = cancellations.values.toList()
            cancellations.clear()
            epoch to callbacks
        }
        old.forEach { it() }
        return next
    }
}

internal fun accountChanged(): ApiException =
    ApiException(0, "account_changed", "The account changed while this operation was running.")

/** Serializes account cleanup against local writes and suppresses old-account Flow emissions. */
internal class OwnerGate(private val fence: RequestFence) {
    private val mutex = Mutex()
    private val mutableActive = MutableStateFlow<AccountStamp?>(null)
    val active = mutableActive.asStateFlow()

    fun current(): AccountStamp = mutableActive.value?.takeIf { fence.isCurrent(it.epoch) }
        ?: throw ApiException(401, "sign_in_required", "Sign in to access account data.")

    suspend fun replace(stamp: AccountStamp?, cleanup: suspend () -> Unit = {}) {
        mutex.withLock {
            mutableActive.value = null
            cleanup()
            if (stamp != null) fence.check(stamp.epoch)
            mutableActive.value = stamp
        }
    }

    suspend fun <T> withOwner(owner: String, block: suspend () -> T): T = mutex.withLock {
        validateOwner(owner)
        val stamp = if (owner == GUEST_OWNER) null else current().also {
            if (it.owner != owner) throw ownerUnavailable()
        }
        val result = block()
        if (stamp != null) fence.check(stamp.epoch)
        result
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T> observe(owner: String, source: () -> Flow<List<T>>): Flow<List<T>> {
        validateOwner(owner)
        return active.flatMapLatest { stamp ->
            if (owner == GUEST_OWNER || (stamp?.owner == owner && fence.isCurrent(stamp.epoch))) {
                source().map { items ->
                    if (owner == GUEST_OWNER || (stamp != null && fence.isCurrent(stamp.epoch))) items else emptyList()
                }
            } else flowOf(emptyList())
        }
    }

    private fun ownerUnavailable() = ApiException(0, "owner_unavailable", "Data belongs to a different signed-in account.")

    companion object {
        const val GUEST_OWNER = "guest"
        fun validateOwner(owner: String) {
            require(owner.isNotBlank() && owner.length <= 512 && owner.none { it.isISOControl() }) { "Invalid local data owner." }
        }
    }
}
