import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { abortFailure, boundedInteger, createOperation, failure } from './operation.ts'
import { ResearchError } from './types.ts'

const BLOCKED_EXACT = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data', 'kubernetes.default', 'home.arpa'])

function blockedIpv4(parts: readonly number[]): boolean {
  const [a, b, c] = parts as readonly [number, number, number, number]
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 100 && b >= 64 && b <= 127) return true // shared / CGNAT
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // protocol assignments + documentation
  if (a === 192 && b === 88 && c === 99) return true // deprecated 6to4 relay
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true
  if (a === 203 && b === 0 && c === 113) return true
  return false
}

/** Expand a valid IPv6 address to its address value, including dotted IPv4 tails. */
function ipv6Words(value: string): readonly number[] {
  let address = value.toLowerCase()
  if (address.includes('.')) {
    const colon = address.lastIndexOf(':')
    const parts = address.slice(colon + 1).split('.').map(Number)
    address = address.slice(0, colon + 1)
      + ((parts[0]! << 8) | parts[1]!).toString(16) + ':' + ((parts[2]! << 8) | parts[3]!).toString(16)
  }
  const halves = address.split('::')
  const left = halves[0] === '' ? [] : halves[0]!.split(':').map(part => Number.parseInt(part, 16))
  if (halves.length === 1) return left
  const right = halves[1] === '' ? [] : halves[1]!.split(':').map(part => Number.parseInt(part, 16))
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]
}

function blockedIpv6(address: string): boolean {
  const words = ipv6Words(address)
  const tail = [words[6]! >>> 8, words[6]! & 255, words[7]! >>> 8, words[7]! & 255]
  // ::ffff:127.0.0.1, ::ffff:7f00:1 and all expanded forms have the same verdict.
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) return blockedIpv4(tail)
  // The globally defined NAT64 prefix also inherits the embedded IPv4 verdict.
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every(word => word === 0)) return blockedIpv4(tail)
  // Only currently allocated global unicast space is admitted. This rejects
  // unspecified, compatible/translated IPv4, discard-only, ULA, site/link-local,
  // multicast and reserved IPv6 space, irrespective of textual compression.
  if ((words[0]! & 0xe000) !== 0x2000) return true
  // Special-purpose 2001::/23 (incl. Teredo, benchmarking and ORCHID), docs,
  // deprecated 6to4 and the newer 3fff::/20 documentation allocation.
  if (words[0] === 0x2001 && (words[1]! < 0x200 || words[1] === 0xdb8)) return true
  if (words[0] === 0x2002) return true
  if (words[0] === 0x3fff && (words[1]! & 0xf000) === 0) return true
  return false
}

/** True for non-public or malformed addresses. URL and DNS use this same policy. */
export function isBlockedAddress(value: string): boolean {
  if (typeof value !== 'string' || value.includes('%')) return true // no scoped/zone identifiers
  const bracketed = value.startsWith('[') && value.endsWith(']')
  const address = bracketed ? value.slice(1, -1) : value
  const version = isIP(address)
  if (bracketed && version !== 6) return true
  if (version === 4) return blockedIpv4(address.split('.').map(Number))
  if (version === 6) return blockedIpv6(address)
  return true
}

/** Host comparison ignores a DNS root dot, which must not bypass blocked names. */
export const urlHostname = (url: URL): string => url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')

/** Parse and screen a URL before DNS. Never includes the rejected URL in an error. */
export function assertPublicUrl(value: string | URL): URL {
  let url: URL
  try { url = new URL(value instanceof URL ? value.href : value) } catch { throw failure('FETCH_BLOCKED') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw failure('FETCH_BLOCKED')
  if (url.username !== '' || url.password !== '') throw failure('FETCH_BLOCKED')
  const host = urlHostname(url)
  if (host === '' || BLOCKED_EXACT.has(host) || ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa'].some(suffix => host.endsWith(suffix))) {
    throw failure('FETCH_BLOCKED')
  }
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw failure('FETCH_BLOCKED')
  } else if (!host.includes('.') || host.includes('%') || host.includes(':')) {
    throw failure('FETCH_BLOCKED')
  }
  return url
}

export interface AddressLookupOptions {
  readonly signal?: AbortSignal
  readonly deadlineAt?: number
  readonly timeoutMs?: number
}

/** The optional second argument preserves existing injected string[] resolvers. */
export type AddressLookup = (hostname: string, options?: AddressLookupOptions) => Promise<readonly string[]>

export interface PublicAddressResolverOptions {
  /** Raw DNS answers, injected only for deterministic tests. */
  readonly lookup?: AddressLookup
  readonly timeoutMs?: number
  readonly maxConcurrent?: number
}

/**
 * dns.lookup/getaddrinfo cannot be cancelled. Stop waiting at the deadline but
 * hold its capacity until the OS promise actually settles, so repeated slow DNS
 * cannot accumulate unlimited background lookups. No DNS answers are cached.
 */
export function createPublicAddressResolver(options: PublicAddressResolverOptions = {}): AddressLookup {
  const maximum = boundedInteger(options.maxConcurrent, 8, 1, 32)
  const timeoutMs = boundedInteger(options.timeoutMs, 5_000, 1, 30_000)
  const rawLookup: AddressLookup = options.lookup ?? (async hostname =>
    (await dnsLookup(hostname, { all: true, order: 'verbatim' })).map(record => record.address))
  let pendingCount = 0
  return async (hostname, lookupOptions = {}) => {
    const operation = createOperation({ ...lookupOptions, timeoutMs: Math.min(timeoutMs, boundedInteger(lookupOptions.timeoutMs, timeoutMs, 1, 120_000)) }, timeoutMs, 'FETCH_TIMEOUT')
    try {
      operation.check()
      let addresses: readonly string[]
      if (isIP(hostname) !== 0) addresses = [hostname]
      else {
        if (pendingCount >= maximum) throw failure('FETCH_UNAVAILABLE')
        pendingCount++
        const pending = Promise.resolve().then(() => {
          operation.check()
          return rawLookup(hostname, { signal: operation.signal, deadlineAt: operation.deadlineAt, timeoutMs: operation.remaining() })
        })
        // Observe both outcomes even after the caller has cancelled its wait.
        void pending.then(() => { pendingCount-- }, () => { pendingCount-- })
        addresses = await operation.wait(() => pending)
      }
      operation.check()
      if (!Array.isArray(addresses) || addresses.length === 0) throw failure('FETCH_UNAVAILABLE')
      // Reject the entire answer, not just the private record in a mixed answer.
      if (addresses.some(address => typeof address !== 'string' || isBlockedAddress(address))) throw failure('FETCH_BLOCKED')
      return [...new Set(addresses)]
    } catch (error) {
      if (operation.signal.aborted) throw abortFailure(operation.signal)
      if (error instanceof ResearchError) throw failure(error.code)
      throw failure('FETCH_UNAVAILABLE')
    } finally { operation.dispose() }
  }
}

export const resolvePublicAddresses: AddressLookup = createPublicAddressResolver()
