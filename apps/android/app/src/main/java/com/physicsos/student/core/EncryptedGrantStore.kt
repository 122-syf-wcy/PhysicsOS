package com.physicsos.student.core

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.ByteBuffer
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException

@Serializable
internal data class PersistedGrant(
    val owner: String,
    val user: MobileUser,
    val refreshToken: String,
    val refreshExpiresAt: Long,
    val rotationPending: Boolean = false,
) {
    override fun toString(): String = "PersistedGrant([redacted])"
}

internal interface GrantStore {
    suspend fun read(): PersistedGrant?
    suspend fun write(grant: PersistedGrant)
    suspend fun clear()
    suspend fun installationId(): String
}

/** Only the rotating grant is persisted; the access token never enters this store. */
internal class EncryptedGrantStore(context: Context, origin: String) : GrantStore {
    private val root = File(context.noBackupFilesDir, "mobile-auth")
    private val alias = "${context.packageName}.mobile-refresh.v1"
    private val aad = "physicsos-mobile-grant:1:$origin".toByteArray(Charsets.UTF_8)
    private val mutex = Mutex()

    override suspend fun read(): PersistedGrant? = io {
        val bytes = try {
            AtomicFile(File(root, "grant.bin")).readFully()
        } catch (_: FileNotFoundException) {
            return@io null
        }
        if (bytes.size !in 34..MAX_GRANT_BYTES || bytes[0] != FORMAT_VERSION) invalidStore()
        val nonce = bytes.copyOfRange(1, 13)
        val ciphertext = bytes.copyOfRange(13, bytes.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val key = keyStore().getKey(alias, null) as? SecretKey ?: invalidStore()
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad)
        val clear = cipher.doFinal(ciphertext)
        try {
            wireJson.decodeFromString<PersistedGrant>(clear.toString(Charsets.UTF_8)).also {
                if (it.owner.isBlank() || it.owner == OwnerGate.GUEST_OWNER ||
                    it.refreshToken.isBlank() || it.refreshToken.length > 16_384 || it.refreshExpiresAt <= 0
                ) invalidStore()
            }
        } finally {
            clear.fill(0)
            bytes.fill(0)
        }
    }

    override suspend fun write(grant: PersistedGrant): Unit = io {
        require(grant.owner.isNotBlank() && grant.owner != OwnerGate.GUEST_OWNER)
        require(grant.refreshToken.isNotBlank() && grant.refreshToken.length <= 16_384)
        ensureDirectory()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        cipher.updateAAD(aad)
        val clear = wireJson.encodeToString(PersistedGrant.serializer(), grant).toByteArray(Charsets.UTF_8)
        try {
            val encrypted = cipher.doFinal(clear)
            check(cipher.iv.size == 12) { "Unexpected GCM nonce length." }
            val bytes = ByteBuffer.allocate(1 + cipher.iv.size + encrypted.size)
                .put(FORMAT_VERSION).put(cipher.iv).put(encrypted).array()
            writeAtomic(AtomicFile(File(root, "grant.bin")), bytes)
        } finally {
            clear.fill(0)
        }
    }

    override suspend fun clear(): Unit = io {
        // Deleting the key makes any undeletable/old backup ciphertext unusable.
        keyStore().deleteEntry(alias)
        val target = File(root, "grant.bin")
        AtomicFile(target).delete()
        if (target.exists() || File(root, "grant.bin.bak").exists() || File(root, "grant.bin.new").exists()) {
            throw IOException("Credential file could not be removed")
        }
    }

    override suspend fun installationId(): String = io {
        ensureDirectory()
        val file = AtomicFile(File(root, "installation-id"))
        val existing = try {
            file.readFully().toString(Charsets.US_ASCII)
        } catch (_: FileNotFoundException) {
            null
        }
        if (existing != null) {
            if (!INSTALLATION_ID.matches(existing)) invalidStore()
            return@io existing
        }
        val random = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val id = sha256Hex(random)
        random.fill(0)
        writeAtomic(file, id.toByteArray(Charsets.US_ASCII))
        id
    }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                block()
            } catch (error: ApiException) {
                throw error
            } catch (_: GeneralSecurityException) {
                invalidStore()
            } catch (_: SerializationException) {
                invalidStore()
            } catch (_: IOException) {
                throw ApiException(0, "secure_storage_unavailable", "Encrypted sign-in storage is unavailable. Check device storage and sign in again.")
            }
        }
    }

    private fun encryptionKey(): SecretKey {
        val keyStore = keyStore()
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun ensureDirectory() {
        if (!root.isDirectory && !root.mkdirs()) throw IOException("Credential directory is unavailable")
    }

    private fun invalidStore(): Nothing = throw ApiException(
        0, "secure_storage_invalid", "The encrypted sign-in grant cannot be restored. Please sign in again.",
    )

    private companion object {
        const val FORMAT_VERSION: Byte = 1
        const val MAX_GRANT_BYTES = 32_768
        val INSTALLATION_ID = Regex("[a-f0-9]{64}")
    }
}

internal fun writeAtomic(file: AtomicFile, bytes: ByteArray) {
    val output = file.startWrite()
    try {
        output.write(bytes)
        file.finishWrite(output)
    } catch (error: Exception) {
        file.failWrite(output)
        throw error
    }
}

internal fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }
