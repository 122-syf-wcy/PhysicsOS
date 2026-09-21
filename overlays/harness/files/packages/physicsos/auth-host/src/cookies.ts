/**
 * Session-cookie mechanics. The cookie value is a random opaque token — the
 * store keeps only its SHA-256, so the durable layer is worthless to theft.
 * `Secure` is emitted only over https; dev http still gets HttpOnly+Lax.
 */

import crypto from 'node:crypto'
import type http from 'node:http'

export const SESSION_COOKIE = 'physicsos_session'

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function sessionTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function isHttps(req: http.IncomingMessage): boolean {
  // Behind a TLS-terminating proxy the socket is plain; honour the standard
  // forward signal so Secure is still emitted for real deployments.
  const proto = req.headers['x-forwarded-proto']
  return (req.socket as { encrypted?: boolean }).encrypted === true
    || (typeof proto === 'string' && proto.split(',')[0]?.trim() === 'https')
}

/**
 * Emit the session cookie. `remember` picks the Max-Age variant; an unset
 * token (logout / failed request) emits an immediate-expiry clear. A
 * non-remembered session omits Max-Age entirely so the browser keeps it
 * for the browsing session instead of expiring it on receipt.
 */
export function writeSessionCookie(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string | null,
  maxAgeSeconds: number,
): void {
  const parts = [
    `${SESSION_COOKIE}=${token === null ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (token === null) parts.push('Max-Age=0')
  else if (maxAgeSeconds > 0) parts.push(`Max-Age=${maxAgeSeconds}`)
  if (isHttps(req)) parts.push('Secure')
  appendSetCookie(res, parts.join('; '))
}

function appendSetCookie(res: http.ServerResponse, value: string): void {
  const prior = res.getHeader('set-cookie')
  const next = prior === undefined ? [value]
    : Array.isArray(prior) ? [...prior, value]
    : [String(prior), value]
  res.setHeader('set-cookie', next)
}

/** Read the session token from the Cookie header, or null when absent. */
export function readSessionCookie(req: http.IncomingMessage): string | null {
  const header = req.headers.cookie
  if (header === undefined) return null
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = pair.slice(eq + 1).trim()
      return value === '' ? null : value
    }
  }
  return null
}
