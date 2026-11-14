import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { assertPublicUrl, isBlockedAddress, resolvePublicAddresses, type AddressLookup } from './safety.ts'
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
  /** Injected in tests; the default resolves every address and rejects any private answer. */
  readonly lookup?: AddressLookup
  /**
   * Address admission. Defaults to rejecting loopback/private/link-local
   * addresses. Only tests pass a different policy (to reach a local HTTP
   * fixture); production construction must leave this unset.
   */
  readonly addressPolicy?: (address: string) => boolean
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  readonly userAgent?: string
}

const isAbort = (error: unknown): boolean => error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR')

/**
 * One request with the connection bound to an already-validated address.
 *
 * `lookup` is the only DNS step the socket performs, and it returns the
 * checked address, so a hostname cannot re-resolve to a private address
 * between validation and connect. TLS keeps the original hostname as SNI.
 */
function requestOnce(url: URL, options: { readonly timeoutMs: number; readonly maxBytes: number; readonly lookup: AddressLookup; readonly userAgent: string; readonly addressPolicy?: (address: string) => boolean; readonly signal?: AbortSignal }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? httpsRequest : httpRequest
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    // Node may call a custom lookup with (hostname, callback) or
    // (hostname, options, callback); both forms receive the same checked IP.
    const lookup = (hostname: string, first: unknown, second?: unknown): void => {
      const callback = (typeof first === 'function' ? first : second) as (error: NodeJS.ErrnoException | null, address: string, family: number) => void
      void options.lookup(hostname).then(addresses => {
        const address = addresses[0]
        if (address === undefined) { callback(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }), '', 0); return }
        // Defense in depth for injected resolvers: unless a test policy opted
        // in, a resolver answer that is private is refused here too.
        if (options.addressPolicy === undefined && isBlockedAddress(address)) {
          callback(Object.assign(new Error('blocked address'), { code: 'ECONNREFUSED' }), '', 0)
          return
        }
        callback(null, address, address.includes(':') ? 6 : 4)
      }, error => callback(error instanceof Error ? error : new Error('dns'), '', 0))
    }
    const req = client({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port === '' ? undefined : Number(url.port),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'accept-encoding': 'gzip, deflate, br', 'user-agent': options.userAgent },
      // `servername` is set by https when `hostname` is a name; binding the
      // socket still uses the checked IP through `lookup`.
      lookup: lookup as never,
      signal: options.signal,
      timeout: options.timeoutMs,
    }, response => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > options.maxBytes * 4) {
          req.destroy()
          fail(new ResearchError('FETCH_TOO_LARGE', '网页内容过大，已停止读取。'))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', fail)
      response.on('end', () => {
        if (settled) return
        settled = true
        const headers: Record<string, string | undefined> = {}
        for (const [key, value] of Object.entries(response.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
        resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) })
      })
    })
    req.on('timeout', () => { req.destroy(); fail(new ResearchError('FETCH_TIMEOUT', '网页读取超时。')) })
    req.on('error', error => {
      if (isAbort(error)) fail(new ResearchError('FETCH_TIMEOUT', '网页读取超时。'))
      else fail(new ResearchError('FETCH_UNAVAILABLE', '网页当前无法访问。'))
    })
    options.signal?.addEventListener('abort', () => { req.destroy(); fail(new ResearchError('FETCH_TIMEOUT', '网页读取已取消。')) }, { once: true })
    req.end()
  })
}

/**
 * Decompress with a hard output cap. Node's zlib has no synchronous streaming
 * helper here, so the async pipeline is used with a byte budget enforced while
 * writing, then the result is awaited.
 */
async function inflate(body: Buffer, encoding: string | undefined, maxBytes: number): Promise<Buffer> {
  const normalized = (encoding ?? '').trim().toLowerCase()
  if (normalized === '' || normalized === 'identity') return body
  const stream = normalized === 'br' ? createBrotliDecompress({ maxOutputLength: maxBytes })
    : normalized === 'deflate' ? createInflate({ maxOutputLength: maxBytes })
      : normalized === 'gzip' || normalized === 'x-gzip' ? createGunzip({ maxOutputLength: maxBytes })
        : undefined
  if (stream === undefined) throw new ResearchError('FETCH_UNSUPPORTED_TYPE', '网页使用了不支持的压缩格式。')
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    stream.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maxBytes) { stream.destroy(); reject(new ResearchError('FETCH_TOO_LARGE', '网页正文过大，已停止读取。')); return }
      chunks.push(chunk)
    })
    stream.on('error', () => reject(new ResearchError('FETCH_PARSE_FAILED', '网页压缩格式无法解析。')))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.end(body)
  })
}

/** Protocol/shape checks only; test fixtures still go through the address policy. */
const relaxedUrl = (value: string | URL): URL => {
  let url: URL
  try { url = value instanceof URL ? value : new URL(value) } catch { throw new ResearchError('FETCH_BLOCKED', '网页地址无效。') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ResearchError('FETCH_BLOCKED', '只允许读取 HTTP(S) 公开网页。')
  if (url.username !== '' || url.password !== '') throw new ResearchError('FETCH_BLOCKED', '网页地址不能携带账号信息。')
  return url
}

const ENTITY = (name: string): string => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' })[name] ?? ''

/** Decode the entities that matter for readable prose; unknown numeric entities are kept as-is. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_all, digits: string) => {
      const point = digits[0]?.toLowerCase() === 'x' ? Number.parseInt(digits.slice(1), 16) : Number(digits)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    })
    .replace(/&([a-z]+);/gi, (_all, name: string) => ENTITY(name.toLowerCase()))
}

/** Extract visible text from HTML without executing anything. */
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
  /** Exposed for tests and callers that need to resolve a redirect hop manually. */
  readonly resolve: AddressLookup
}

/**
 * The only component allowed to fetch arbitrary public pages.
 *
 * Every hop (initial URL and each redirect) is parsed, screened, resolved and
 * connected to a checked address. No cookies, no scripts, no credential
 * headers, no POST bodies. The extracted text is untrusted data for the model.
 */
export function createSafeReader(options: SafeReaderOptions = {}): SafeReader {
  const lookup = options.lookup ?? resolvePublicAddresses
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const userAgent = options.userAgent ?? USER_AGENT

  const admit = (url: URL): void => {
    if (options.addressPolicy === undefined) return
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (!options.addressPolicy(host)) throw new ResearchError('FETCH_BLOCKED', '不读取本机或内网地址。')
  }
  const read = async (value: string, readOptions: ReadOptions = {}): Promise<ReadDocument> => {
    // With a test-only address policy the literal checks above are relaxed,
    // but every hop still goes through the resolver/connection check below.
    let url = options.addressPolicy === undefined ? assertPublicUrl(value) : relaxedUrl(value)
    admit(url)
    const deadline = Date.now() + (readOptions.timeoutMs ?? timeoutMs)
    const redirects = readOptions.maxRedirects ?? maxRedirects
    const bytesLimit = readOptions.maxBytes ?? maxBytes
    const combined = readOptions.signal === undefined
      ? undefined
      : AbortSignal.any([readOptions.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))])
    for (let hop = 0; ; hop++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new ResearchError('FETCH_TIMEOUT', '网页读取超时。')
      await lookup(url.hostname.replace(/^\[|\]$/g, ''))
      const response = await requestOnce(url, {
        timeoutMs: remaining,
        maxBytes: bytesLimit,
        lookup,
        userAgent,
        ...(options.addressPolicy === undefined ? {} : { addressPolicy: options.addressPolicy }),
        ...(combined === undefined ? {} : { signal: combined }),
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop >= redirects) throw new ResearchError('FETCH_BLOCKED', '网页重定向次数过多。')
        const location = response.headers.location
        if (location === undefined) throw new ResearchError('FETCH_UNAVAILABLE', '网页重定向缺少目标地址。')
        url = options.addressPolicy === undefined ? assertPublicUrl(new URL(location, url)) : relaxedUrl(new URL(location, url))
        admit(url)
        continue
      }
      if (response.status === 429) throw new ResearchError('FETCH_UNAVAILABLE', '网页当前限流，请稍后重试。')
      if (response.status < 200 || response.status >= 300) throw new ResearchError('FETCH_UNAVAILABLE', '网页当前无法访问。')
      const contentType = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
      if (!ALLOWED_TYPES.has(contentType)) throw new ResearchError('FETCH_UNSUPPORTED_TYPE', '该网页不是可阅读的文本页面。')
      const decoded = await inflate(response.body, response.headers['content-encoding'], bytesLimit)
      if (decoded.byteLength > bytesLimit) throw new ResearchError('FETCH_TOO_LARGE', '网页正文过大，已停止读取。')
      const raw = decoded.toString('utf8')
      const parsed = contentType === 'text/plain' ? { title: '', text: raw.trim() } : htmlToText(raw)
      if (parsed.text === '') throw new ResearchError('FETCH_PARSE_FAILED', '没有从网页中提取到可读正文。')
      return {
        url: url.toString(),
        title: parsed.title === '' ? url.hostname : parsed.title,
        text: parsed.text.slice(0, 200_000),
        fetchedAt: new Date().toISOString(),
        contentType,
      }
    }
  }
  return { read, resolve: lookup }
}
