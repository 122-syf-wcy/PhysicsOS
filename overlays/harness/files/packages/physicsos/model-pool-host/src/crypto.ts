/**
 * Key-material sealing for the model pool.
 *
 * The deployment supplies one secret (`PHYSICSOS_MODEL_POOL_SECRET`, itself
 * materialized from a file secret by the container entrypoint). Every stored
 * key is sealed with AES-256-GCM under a subkey derived from it by HKDF, so the
 * value never appears in a domain record, an audit row, a log line, or a list
 * response. A missing or replaced secret is fail-closed: {@link openSecret}
 * raises instead of handing an empty credential to an upstream.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { PoolError } from './errors.ts'
import type { SealedSecret } from './types.ts'

const SALT = 'physicsos.model-pool.v1'
const INFO = 'aes-256-gcm/key-material'
const IV_BYTES = 12
const MIN_SECRET_CHARS = 16

/** Derive the 32-byte AES key from the deployment secret. */
export const deriveCipherKey = (secret: string): Buffer => {
  const trimmed = secret.trim()
  if (trimmed.length < MIN_SECRET_CHARS) {
    throw new PoolError(
      503,
      'POOL_SECRET_TOO_WEAK',
      `模型池加密密钥至少需要 ${String(MIN_SECRET_CHARS)} 个字符`,
    )
  }
  return Buffer.from(hkdfSync('sha256', trimmed, SALT, INFO, 32))
}

/** The only representation of a key value that is ever persisted. */
export const sealSecret = (key: Buffer, plaintext: string): SealedSecret => {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    tail: tailOf(plaintext),
  }
}

/** Decrypt one stored key. Raises `KEY_DECRYPT_FAILED` rather than returning `''`. */
export const openSecret = (key: Buffer, sealed: SealedSecret): string => {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    if (plaintext.trim() === '') throw new Error('empty plaintext')
    return plaintext
  } catch {
    throw new PoolError(
      503,
      'KEY_DECRYPT_FAILED',
      '密钥解密失败：部署密钥已更换或数据损坏，请在后台重新录入该 key',
    )
  }
}

/** Last four characters, shown to admins so they can tell two keys apart. */
export const tailOf = (value: string): string =>
  value.length <= 4 ? value : value.slice(-4)

/**
 * Remove anything that looks like a credential from text that is about to be
 * logged or stored as a `lastError`. Upstreams echo authorization failures
 * verbatim often enough that this is not paranoia.
 */
export const redactSecrets = (text: string, max = 300): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const redacted = collapsed
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9._-]{6,}/g, 'sk-[redacted]')
  return redacted.length <= max ? redacted : `${redacted.slice(0, max)}…`
}
