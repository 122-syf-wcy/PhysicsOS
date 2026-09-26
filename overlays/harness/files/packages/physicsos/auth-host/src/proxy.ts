import { isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'

const normalizeAddress = (value: string): string | undefined => {
  const address = value.trim().toLowerCase()
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
  return isIP(normalized) === 0 ? undefined : normalized
}

/**
 * Reject proxy config values that are not exact IP literals.
 * @param addresses - configured proxy IP literals.
 */
export function validateTrustedProxies(addresses: readonly string[]): void {
  for (const address of addresses) {
    if (normalizeAddress(address) === undefined) {
      throw new Error(`trusted proxy '${address}' must be an IP literal`)
    }
  }
}

const peerIsTrusted = (req: IncomingMessage, trustedProxies: readonly string[]): boolean => {
  const peer = normalizeAddress(req.socket.remoteAddress ?? '')
  return peer !== undefined && trustedProxies.some(address => normalizeAddress(address) === peer)
}

/**
 * Resolve the client address only through a configured proxy chain.
 * @param req - incoming HTTP request.
 * @param trustedProxies - exact peer IP literals allowed to supply forwarded metadata.
 * @returns the nearest untrusted client address, or the peer address.
 */
export function clientAddress(req: IncomingMessage, trustedProxies: readonly string[]): string {
  const peer = normalizeAddress(req.socket.remoteAddress ?? '')
  if (peer === undefined) return 'unknown'
  if (!peerIsTrusted(req, trustedProxies)) return peer

  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded !== 'string') return peer
  const trusted = new Set(trustedProxies.map(normalizeAddress).filter((value): value is string => value !== undefined))
  const hops = forwarded.split(',')
  let address = peer
  for (let index = hops.length - 1; index >= 0 && trusted.has(address); index--) {
    const hop = normalizeAddress(hops[index] ?? '')
    if (hop === undefined) break
    address = hop
  }
  return address
}

/**
 * Resolve the request scheme without trusting forwarded headers from clients.
 * @param req - incoming HTTP request.
 * @param trustedProxies - exact peer IP literals allowed to supply forwarded metadata.
 * @returns the original request scheme.
 */
export function requestScheme(req: IncomingMessage, trustedProxies: readonly string[]): 'http' | 'https' {
  if ((req.socket as { encrypted?: boolean }).encrypted === true) return 'https'
  if (!peerIsTrusted(req, trustedProxies)) return 'http'
  const forwarded = req.headers['x-forwarded-proto']
  if (typeof forwarded !== 'string') return 'http'
  const last = forwarded.split(',').at(-1)?.trim().toLowerCase()
  return last === 'https' ? 'https' : 'http'
}
