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

/**
 * Whether this runtime can actually compute argon2id.
 *
 * `typeof argon2Sync === 'function'` is deliberately NOT the test: a build can
 * expose the entry point while its OpenSSL provider lacks argon2id, and the call
 * then throws `ERR_CRYPTO_ARGON2_NOT_SUPPORTED`. That combination is real
 * (observed on a vendored Node 24.18.1 build) and it turns the boot gate into a
 * false positive — the plugin activates, then dies with a cryptic stack from
 * deep inside bootstrap seeding instead of the intended one-line diagnosis.
 *
 * Probing once with the cheapest legal parameters (RFC 9106 floor: 8 KiB, one
 * pass, single lane) costs microseconds and keeps the gate honest.
 */
const ARGON2_PROBE: { readonly ok: boolean; readonly reason: string | undefined } = (() => {
  if (typeof argon2Sync !== 'function') {
    return { ok: false, reason: 'node:crypto.argon2 is absent (requires Node >= 24.7)' }
  }
  try {
    const digest = argon2Sync('argon2id', {
      message: 'probe',
      nonce: Buffer.alloc(16),
      parallelism: 1,
      memory: 8,
      passes: 1,
      tagLength: 16,
    })
    return digest.length === 16
      ? { ok: true, reason: undefined }
      : { ok: false, reason: `argon2id returned a ${digest.length}-byte digest, expected 16` }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    return { ok: false, reason: `argon2id is exposed but unusable in this runtime (${String(code ?? error)})` }
  }
})()

/** True when this runtime computes argon2id for real, not merely exposes it. */
export const ARGON2_AVAILABLE = ARGON2_PROBE.ok

/** Why argon2id is unusable — undefined exactly when {@link ARGON2_AVAILABLE}. */
export const ARGON2_UNAVAILABLE_REASON = ARGON2_PROBE.reason

/**
 * The argon2id entry point, or a throw naming the runtime deficiency.
 *
 * Callers run only after {@link ARGON2_AVAILABLE} gated plugin activation, so
 * this is unreachable in practice — but it keeps the call sites free of a
 * non-null assertion, which would otherwise suppress the very check the probe
 * exists to make.
 */
const requireArgon2 = (): NonNullable<typeof argon2Sync> => {
  if (argon2Sync === undefined) throw new Error('argon2id unavailable in this runtime')
  return argon2Sync
}

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
  const digest = requireArgon2()('argon2id', {
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
    const digest = requireArgon2()('argon2id', {
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
