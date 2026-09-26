/**
 * RFC 6238 TOTP primitives using only node:crypto.
 *
 * Production codes are six digits over 30-second steps with SHA-1, matching
 * the parameters accepted by mainstream authenticator applications. The
 * verifier accepts the previous and next step so modest clock drift does not
 * lock an administrator out.
 */

import crypto from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DEFAULT_DIGITS = 6
const DEFAULT_STEP_SECONDS = 30

/** Encode bytes as unpadded RFC 4648 base32. */
export const base32Encode = (value: Buffer): string => {
  let bits = 0
  let accumulator = 0
  let output = ''
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31] ?? ''
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31] ?? ''
  return output
}

/** Decode unpadded base32; malformed input throws rather than yielding a key. */
export const base32Decode = (value: string): Buffer => {
  const normalized = value.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/g, '')
  if (normalized === '' || /[^A-Z2-7]/.test(normalized)) {
    throw new Error('invalid base32 value')
  }
  let bits = 0
  let accumulator = 0
  const output: number[] = []
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index < 0) throw new Error('invalid base32 value')
    accumulator = (accumulator << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      output.push((accumulator >>> bits) & 0xff)
    }
  }
  return Buffer.from(output)
}

/** Generate a 160-bit base32 secret for a new authenticator enrollment. */
export const generateTotpSecret = (): string => base32Encode(crypto.randomBytes(20))

/**
 * Generate one TOTP value.
 * @param secret - base32 shared secret.
 * @param atMs - Unix milliseconds.
 * @param digits - output length; production uses 6, RFC vector tests use 8.
 * @returns zero-padded decimal TOTP.
 */
export const totpCode = (
  secret: string,
  atMs = Date.now(),
  digits = DEFAULT_DIGITS,
): string => {
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error('TOTP digits must be between 6 and 8')
  }
  const counter = Math.floor(atMs / 1_000 / DEFAULT_STEP_SECONDS)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24)
    | ((digest[offset + 1] ?? 0) << 16)
    | ((digest[offset + 2] ?? 0) << 8)
    | (digest[offset + 3] ?? 0)
  return String(binary % (10 ** digits)).padStart(digits, '0')
}

/** Constant-time six-digit verification with one adjacent-step allowance. */
export const verifyTotpCode = (
  secret: string,
  code: string,
  atMs = Date.now(),
  stepDrift = 1,
): boolean => {
  if (!/^\d{6}$/.test(code)) return false
  for (let offset = -stepDrift; offset <= stepDrift; offset += 1) {
    const expected = totpCode(secret, atMs + offset * DEFAULT_STEP_SECONDS * 1_000)
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) return true
  }
  return false
}

/** Normalize recovery-code display punctuation before hashing or comparison. */
export const normalizeRecoveryCode = (value: string): string =>
  value.toUpperCase().replace(/[\s-]/g, '')

/** Generate a high-entropy recovery code displayed once. */
export const generateRecoveryCode = (): string => {
  const encoded = base32Encode(crypto.randomBytes(10))
  return encoded.match(/.{1,5}/g)?.join('-') ?? encoded
}

/** Hash a normalized recovery code for durable storage. */
export const recoveryCodeHash = (value: string): string =>
  crypto.createHash('sha256').update(normalizeRecoveryCode(value)).digest('hex')
