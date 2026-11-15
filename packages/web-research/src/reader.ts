import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { abortFailure, boundedInteger, createOperation, failure, isCancellation, type Operation } from './operation.ts'
import { assertPublicUrl, isBlockedAddress, resolvePublicAddresses, urlHostname, type AddressLookup } from './safety.ts'
import { ResearchError, type PageReader, type ReadDocument, type ReadOptions } from './types.ts'

const DEFAULT_MAX_BYTES = 1_048_576
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_REDIRECTS = 3
const USER_AGENT = 'PhysicsOS study reader'
const ALLOWED_TYPES = new Set(['text/html', 'text/plain', 'application/xhtml+xml'])

interface RawResponse {
  readonly status: number
  readonly headers: Record<string, string | undefined>
  readonly body: Buffer
}

export interface SafeReaderOptions {
  readonly lookup?: AddressLookup
  /** Test-only fixture admission. Production must leave this unset. */
  readonly addressPolicy?: (address: string) => boolean
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  readonly userAgent?: string
}

/** Internal export for a pure regression test of both Node lookup callback shapes. */
export function pinnedLookup(address: string): NonNullable<RequestOptions['lookup']> {
  const family = isIP(address)
  if (family !== 4 && family !== 6) throw failure('FETCH_BLOCKED')
  return (_hostname, options, callback) => {
    if (options.all) {
      const allCallback = callback as unknown as (error: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void
      allCallback(null, [{ address, family }])
    } else callback(null, address, family)
  }
}

/** Every connection has its own checked address; Host/SNI remain the original name. */
function requestOnce(url: URL, address: string, options: { readonly operation: Operation; readonly maxBytes: number; readonly userAgent: string; readonly attemptMs: number }): Promise<RawResponse> {
  const operation = createOperation({ signal: options.operation.signal, deadlineAt: options.operation.deadlineAt, timeoutMs: options.attemptMs }, options.attemptMs, 'FETCH_TIMEOUT')
  return new Promise((resolve, reject) => {
    let settled = false
    let request: ClientRequest | undefined
    let response: IncomingMessage | undefined
    let cleanupResponse = (): void => {}
    const absorbError = (): void => {}
    const onRequestError = (): void => fail(operation.signal.aborted ? abortFailure(operation.signal) : failure('FETCH_UNAVAILABLE'))
    const onRequestClose = (): void => request?.removeListener('error', absorbError)
    const finish = (error: unknown, value?: RawResponse): void => {
      if (settled) return
      settled = true
      operation.signal.removeEventListener('abort', onAbort)
      operation.dispose()
      cleanupResponse()
      request?.removeListener('error', onRequestError)
      // Keep a no-op error listener only until close to absorb delayed socket
      // errors after destroy; remove resource-capturing callbacks immediately.
      if (request !== undefined && !request.closed) {
        request.on('error', absorbError)
        request.once('close', onRequestClose)
      }
      // agent:false prevents an old keep-alive socket bypassing a new DNS check.
      response?.destroy()
      request?.destroy()
      if (error !== undefined) reject(error)
      else resolve(value!)
    }
    const fail = (error: unknown): void => finish(error)
    const onAbort = (): void => fail(abortFailure(operation.signal))
    try {
      operation.check()
      operation.signal.addEventListener('abort', onAbort, { once: true })
      const client = url.protocol === 'https:' ? httpsRequest : httpRequest
      request = client({
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port === '' ? undefined : Number(url.port),
        path: url.pathname + url.search,
        method: 'GET',
        headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'accept-encoding': 'gzip, deflate, br', 'user-agent': options.userAgent },
        lookup: pinnedLookup(address),
        family: isIP(address),
        autoSelectFamily: false,
        agent: false,
        maxHeaderSize: 16_384,
      }, incoming => {
        response = incoming
        if (settled) { incoming.destroy(); return }
        const headers: Record<string, string | undefined> = {}
        for (const [key, value] of Object.entries(incoming.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
        const status = incoming.statusCode ?? 0
        const chunks: Buffer[] = []
        let size = 0
        const onError = (): void => fail(operation.signal.aborted ? abortFailure(operation.signal) : failure('FETCH_UNAVAILABLE'))
        const onAborted = (): void => fail(failure('FETCH_UNAVAILABLE'))
        const onData = (chunk: Buffer): void => {
          if (settled) return
          size += chunk.byteLength
          if (size > options.maxBytes * 4) { fail(failure('FETCH_TOO_LARGE')); return }
          chunks.push(chunk)
        }
        const onEnd = (): void => {
          if (settled) return
          try { operation.check(); finish(undefined, { status, headers, body: Buffer.concat(chunks) }) } catch (error) { fail(error) }
        }
        const onClose = (): void => { if (!incoming.complete) fail(failure('FETCH_UNAVAILABLE')) }
        cleanupResponse = () => {
          incoming.removeListener('error', onError)
          incoming.removeListener('aborted', onAborted)
          incoming.removeListener('data', onData)
          incoming.removeListener('end', onEnd)
          incoming.removeListener('close', onClose)
          if (!incoming.closed) {
            incoming.on('error', absorbError)
            incoming.once('close', () => incoming.removeListener('error', absorbError))
          }
        }
        incoming.on('error', onError)
        incoming.on('aborted', onAborted)
        incoming.on('close', onClose)
        // Redirects/errors do not need a body. In particular, never retry a 429.
        if (status < 200 || status >= 300) { finish(undefined, { status, headers, body: Buffer.alloc(0) }); return }
        const contentType = (headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
        if (!ALLOWED_TYPES.has(contentType)) { fail(failure('FETCH_UNSUPPORTED_TYPE')); return }
        incoming.on('data', onData)
        incoming.on('end', onEnd)
      })
      request.on('error', onRequestError)
      request.end()
    } catch (error) {
      fail(error instanceof ResearchError ? error : failure('FETCH_UNAVAILABLE'))
    }
  })
}

/** Async decompression with both an output cap and the same absolute deadline. */
async function inflate(body: Buffer, encoding: string | undefined, maxBytes: number, operation: Operation): Promise<Buffer> {
  operation.check()
  const normalized = (encoding ?? '').trim().toLowerCase()
  if (normalized === '' || normalized === 'identity') return body
  const decoder = normalized === 'br' ? createBrotliDecompress()
    : normalized === 'deflate' ? createInflate()
      : normalized === 'gzip' || normalized === 'x-gzip' ? createGunzip()
        : undefined
  if (decoder === undefined) throw failure('FETCH_UNSUPPORTED_TYPE')
  const chunks: Buffer[] = []
  let size = 0
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength
      if (size > maxBytes) { callback(failure('FETCH_TOO_LARGE')); return }
      chunks.push(chunk)
      callback()
    },
  })
  try {
    await operation.wait(() => pipeline(Readable.from([body]), decoder, output, { signal: operation.signal }))
    operation.check()
    return Buffer.concat(chunks)
  } catch (error) {
    if (operation.signal.aborted) throw abortFailure(operation.signal)
    if (error instanceof ResearchError) throw error
    throw failure('FETCH_PARSE_FAILED')
  }
}

/** Fixture-only shape checks; URL host and every resolved address are still admitted. */
const relaxedUrl = (value: string | URL): URL => {
  let url: URL
  try { url = new URL(value instanceof URL ? value.href : value) } catch { throw failure('FETCH_BLOCKED') }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '' || url.hostname === '') throw failure('FETCH_BLOCKED')
  return url
}

const ENTITY = (name: string): string => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' })[name] ?? ''

function decodeEntities(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_all, digits: string) => {
      const point = digits[0]?.toLowerCase() === 'x' ? Number.parseInt(digits.slice(1), 16) : Number(digits)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    })
    .replace(/&([a-z]+);/gi, (_all, name: string) => ENTITY(name.toLowerCase()))
}

/** Extract visible text without executing HTML, scripts, tools or page instructions. */
export function htmlToText(html: string): { title: string; text: string } {
  const withoutHead = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|template|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  const title = decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(withoutHead)?.[1]
    ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(withoutHead)?.[1]
    ?? withoutHead
  const text = decodeEntities(
    main
      .replace(/<(br|p|div|li|tr|h[1-6]|section|article|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<\/[^>]+>/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .split('\n').map(line => line.trim()).filter(Boolean).join('\n')
    .trim()
  return { title, text }
}

export interface SafeReader extends PageReader {
  readonly resolve: AddressLookup
}

export function createSafeReader(options: SafeReaderOptions = {}): SafeReader {
  const lookup = options.lookup ?? resolvePublicAddresses
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1, 4_194_304)
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 120_000)
  const maxRedirects = boundedInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 5)
  const userAgent = options.userAgent ?? USER_AGENT
  const admitUrl = (value: string | URL): URL => {
    const url = options.addressPolicy === undefined ? assertPublicUrl(value) : relaxedUrl(value)
    if (options.addressPolicy !== undefined && !options.addressPolicy(urlHostname(url))) throw failure('FETCH_BLOCKED')
    return url
  }
  const read = async (value: string, readOptions: ReadOptions = {}): Promise<ReadDocument> => {
    const operation = createOperation({ ...readOptions, timeoutMs: Math.min(timeoutMs, boundedInteger(readOptions.timeoutMs, timeoutMs, 1, 120_000)) }, timeoutMs, 'FETCH_TIMEOUT')
    try {
      operation.check()
      let url = admitUrl(value)
      const redirects = Math.min(maxRedirects, boundedInteger(readOptions.maxRedirects, maxRedirects, 0, 5))
      const bytesLimit = Math.min(maxBytes, boundedInteger(readOptions.maxBytes, maxBytes, 1, 4_194_304))
      for (let hop = 0; ; hop++) {
        operation.check()
        const addresses = await operation.wait(() => lookup(urlHostname(url), {
          signal: operation.signal, deadlineAt: operation.deadlineAt, timeoutMs: operation.remaining(),
        }))
        operation.check()
        if (!Array.isArray(addresses) || addresses.length === 0) throw failure('FETCH_UNAVAILABLE')
        // A mixed public/private answer is rejected as a whole, including injected DNS.
        if (addresses.some(address => typeof address !== 'string' || isIP(address) === 0 || (options.addressPolicy === undefined ? isBlockedAddress(address) : !options.addressPolicy(address)))) {
          throw failure('FETCH_BLOCKED')
        }
        const uniqueAddresses = [...new Set(addresses)]
        let response: RawResponse | undefined
        let lastError: unknown
        for (const [index, address] of uniqueAddresses.entries()) {
          operation.check()
          try {
            // Share the remaining budget fairly; a black-holed first edge must
            // not consume every later address's chance to connect.
            response = await requestOnce(url, address, {
              operation, maxBytes: bytesLimit, userAgent,
              attemptMs: Math.max(1, Math.floor(operation.remaining() / (uniqueAddresses.length - index))),
            })
            break
          } catch (error) {
            operation.check()
            if (isCancellation(error)) throw error
            // Size/type/security failures must not cause another download.
            if (error instanceof ResearchError && error.code !== 'FETCH_UNAVAILABLE' && error.code !== 'FETCH_TIMEOUT') throw error
            lastError = error
          }
        }
        operation.check()
        if (response === undefined) throw lastError instanceof ResearchError ? lastError : failure('FETCH_UNAVAILABLE')
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (hop >= redirects) throw failure('FETCH_BLOCKED')
          const location = response.headers.location
          if (location === undefined) throw failure('FETCH_UNAVAILABLE')
          let redirected: URL
          try { redirected = new URL(location, url) } catch { throw failure('FETCH_BLOCKED') }
          url = admitUrl(redirected)
          continue
        }
        if (response.status === 429) throw failure('FETCH_RATE_LIMITED')
        if (response.status < 200 || response.status >= 300) throw failure('FETCH_UNAVAILABLE')
        const contentType = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
        const decoded = await inflate(response.body, response.headers['content-encoding'], bytesLimit, operation)
        if (decoded.byteLength > bytesLimit) throw failure('FETCH_TOO_LARGE')
        operation.check()
        const raw = decoded.toString('utf8')
        const parsed = contentType === 'text/plain' ? { title: '', text: raw.trim() } : htmlToText(raw)
        operation.check()
        if (parsed.text === '') throw failure('FETCH_PARSE_FAILED')
        return {
          url: url.toString(), title: parsed.title === '' ? url.hostname : parsed.title,
          text: parsed.text.slice(0, 200_000), fetchedAt: new Date().toISOString(), contentType,
        }
      }
    } catch (error) {
      if (operation.signal.aborted) throw abortFailure(operation.signal)
      if (error instanceof ResearchError) throw error
      throw failure('FETCH_UNAVAILABLE')
    } finally { operation.dispose() }
  }
  return { read, resolve: lookup }
}
