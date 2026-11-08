/** Password-reset token generation, hashing, and client handoff path. */

import crypto from 'node:crypto'

/** 256-bit opaque token; only its SHA-256 is ever persisted. */
export function newPasswordResetToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Hash a reset token for storage and lookup.
 * @param token - the raw token from the delivery channel.
 * @returns its lowercase SHA-256 hex digest.
 */
export function passwordResetTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Same-origin path the AuthGate opens when a reset link is followed. */
export function passwordResetPath(token: string): string {
  return `/?reset_token=${encodeURIComponent(token)}`
}
