/**
 * Session-cookie mechanics. The cookie value is a random opaque token — the
 * store keeps only its SHA-256, so the durable layer is worthless to theft.
 * `Secure` is emitted only over https; dev http still gets HttpOnly+Lax.
 */

import crypto from 'node:crypto'
import type http from 'node:http'
import { requestScheme } from './proxy.ts'

/** The session cookie name; only this cookie carries the bearer token. */
export const SESSION_COOKIE = 'physicsos_session'

/**
 * Mint a new opaque session token.
 * @returns a 256-bit token, base64url-encoded — the raw value is never persisted.
 */
export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Hash a session token for storage.
 * @param token - the raw token from the cookie.
 * @returns the sha256 hex digest used as the session row key.
 */
export function sessionTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function isHttps(req: http.IncomingMessage, trustedProxies: readonly string[]): boolean {
  // A TLS-terminating proxy is trusted only when its address is configured.
  return requestScheme(req, trustedProxies) === 'https'
}

/**
 * Emit the session cookie. `remember` picks the Max-Age variant; an unset
 * token (logout / failed request) emits an immediate-expiry clear. A
 * non-remembered session omits Max-Age entirely so the browser keeps it
 * for the browsing session instead of expiring it on receipt.
 * @param req - the request, read for TLS detection (`Secure` flag).
 * @param res - the response the `Set-Cookie` header is appended to.
 * @param token - the raw token to emit, or `null` to emit an immediate-expiry clear.
 * @param maxAgeSeconds - cookie `Max-Age`; `0` omits the attribute (browser-session cookie).
 * @param trustedProxies - exact proxy IPs whose forwarded protocol may set `Secure`.
 */
export function writeSessionCookie(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string | null,
  maxAgeSeconds: number,
  trustedProxies: readonly string[] = [],
): void {
  const parts = [
    `${SESSION_COOKIE}=${token === null ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (token === null) parts.push('Max-Age=0')
  else if (maxAgeSeconds > 0) parts.push(`Max-Age=${maxAgeSeconds}`)
  if (isHttps(req, trustedProxies)) parts.push('Secure')
  appendSetCookie(res, parts.join('; '))
}

function appendSetCookie(res: http.ServerResponse, value: string): void {
  const prior = res.getHeader('set-cookie')
  const next = prior === undefined ? [value]
    : Array.isArray(prior) ? [...prior, value]
      : [String(prior), value]
  res.setHeader('set-cookie', next)
}

/**
 * Read the session token from the Cookie header, or null when absent.
 * @param req - the incoming request.
 * @returns the raw token, or `null` when the cookie is absent or empty.
 */
export function readSessionCookie(req: http.IncomingMessage): string | null {
  return readSessionCookieHeader(req.headers.cookie)
}

/**
 * Read the session token directly from a Cookie header.
 * @param header - the raw request header, or undefined.
 * @returns the raw token, or null.
 */
export function readSessionCookieHeader(header: string | undefined): string | null {
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
