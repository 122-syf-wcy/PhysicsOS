/**
 * Opaque credential formats shared by invite codes, personal API tokens, and
 * short-lived login challenges. Raw values are returned exactly once; durable
 * rows keep only a SHA-256 digest.
 */

import crypto from 'node:crypto'

const API_TOKEN_PREFIX = 'pso_'
const INVITE_CODE_PREFIX = 'inv_'

const randomOpaque = (): string => crypto.randomBytes(24).toString('base64url')

/** Generate one personal API token and its storage digest. */
export const newApiToken = (): { raw: string; hash: string } => {
  const raw = `${API_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  return { raw, hash: hashOpaqueCredential(raw) }
}

/** Generate one invite code and its storage digest. */
export const newInviteCode = (): { raw: string; hash: string } => {
  const raw = `${INVITE_CODE_PREFIX}${randomOpaque()}`
  return { raw, hash: hashOpaqueCredential(raw) }
}

/** Generate a short-lived TOTP login challenge token. */
export const newLoginChallengeToken = (): string => crypto.randomBytes(32).toString('base64url')

/** SHA-256 digest for any opaque credential. */
export const hashOpaqueCredential = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex')

/**
 * Read a strict single Bearer credential. Ambiguous or malformed headers fail
 * closed instead of being reinterpreted as a cookie fallback.
 */
export const readBearerToken = (header: string | undefined): string | null => {
  if (header === undefined) return null
  const match = /^\s*Bearer\s+([A-Za-z0-9_-]{32,160})\s*$/.exec(header)
  return match?.[1] ?? null
}
