/**
 * Argon2id password hashing on node:crypto (Node ≥ 24.7) — zero new native
 * dependency. The stored form is a self-describing PHC-style string
 * `argon2id$v=19$m=<memory>,t=<passes>,p=<parallelism>$<salt>$<digest>` so a
 * parameter change later still verifies older rows.
 */

import crypto from 'node:crypto'

interface Argon2Parameters {
  message: string | Buffer
  nonce: Buffer
  parallelism: number
  memory: number
  passes: number
  tagLength: number
}

/* @types/node@22 predates node:crypto.argon2; apply() refuses to load on
   runtimes without it, so the single local declaration is honest. */
const argon2Sync = (crypto as unknown as {
  argon2Sync?: (algorithm: 'argon2id', parameters: Argon2Parameters) => Buffer
}).argon2Sync

/** True on Node ≥ 24.7; the plugin checks this before serving. */
export const ARGON2_AVAILABLE = typeof argon2Sync === 'function'

const MEMORY = 65_536 // 64 MiB — OWASP-recommended argon2id profile
const PASSES = 3
const PARALLELISM = 4
const TAG_LENGTH = 32

/**
 * Hash a password for durable storage.
 * @param password - the plaintext password (never persisted, never logged).
 * @returns the PHC-style argon2id record.
 */
export function hashPassword(password: string): string {
  const nonce = crypto.randomBytes(16)
  const digest = argon2Sync!('argon2id', {
    message: password,
    nonce,
    parallelism: PARALLELISM,
    memory: MEMORY,
    passes: PASSES,
    tagLength: TAG_LENGTH,
  })
  return `argon2id$v=19$m=${MEMORY},t=${PASSES},p=${PARALLELISM}$${nonce.toString('base64url')}$${digest.toString('base64url')}`
}

/**
 * Verify a password against a stored PHC-style record in constant time.
 * Malformed records return false rather than throwing.
 * @param password - the candidate plaintext.
 * @param stored - the durable `passwordHash` field.
 * @returns whether the candidate matches.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, version, params, saltB64, digestB64] = stored.split('$')
  if (alg !== 'argon2id' || version !== 'v=19' || params === undefined
    || saltB64 === undefined || digestB64 === undefined) return false
  const m = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(params)
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return false
  let nonce: Buffer
  let expected: Buffer
  try {
    nonce = Buffer.from(saltB64, 'base64url')
    expected = Buffer.from(digestB64, 'base64url')
  } catch {
    return false
  }
  if (expected.length === 0) return false
  try {
    const digest = argon2Sync!('argon2id', {
      message: password,
      nonce,
      parallelism: Number(m[3]),
      memory: Number(m[1]),
      passes: Number(m[2]),
      tagLength: expected.length,
    })
    return crypto.timingSafeEqual(digest, expected)
  } catch {
    return false
  }
}
