import { ResearchError, type SearchHit, type SearchProvider, type SearchResponse } from './types.ts'

const MAX_QUERY = 240
const DEFAULT_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 1_048_576

const entity = (name: string): string => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name] ?? ''
/** Strip tags and decode the handful of entities that appear in search metadata. */
export function plainText(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_all, digits: string) => {
      const point = digits[0]?.toLowerCase() === 'x' ? Number.parseInt(digits.slice(1), 16) : Number(digits)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_all, name: string) => entity(name))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Read a bounded UTF-8 body; never trusts content-length. */
async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new ResearchError('SEARCH_PARSE_FAILED', '搜索结果过大。') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}

const isAbort = (error: unknown): boolean => error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')

const searchFailure = (status: number): ResearchError => {
  if (status === 429) return new ResearchError('SEARCH_RATE_LIMITED', '搜索服务当前限流，请稍后重试。')
  return new ResearchError('SEARCH_UNAVAILABLE', '搜索服务当前不可用，请稍后重试。')
}

export interface SearxOptions {
  readonly endpoint: string
  /** Sent only server-side; never reaches the browser or the model. */
  readonly apiKey?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

interface SearxResult {
  readonly title?: unknown
  readonly url?: unknown
  readonly content?: unknown
  readonly engine?: unknown
  readonly publishedDate?: unknown
}

/**
 * Self-hosted SearXNG JSON adapter.
 *
 * It aggregates upstream engines; it does not own a web index. The endpoint
 * is ours, the upstream availability is not, so a generic failure is reported
 * as `SEARCH_UNAVAILABLE` instead of being disguised as "no results".
 */
export function searxngProvider(options: SearxOptions): SearchProvider {
  const run = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    name: 'searxng',
    providesContent: false,
    async search(query, searchOptions) {
      const url = new URL(options.endpoint)
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      url.searchParams.set('language', 'zh-CN')
      url.searchParams.set('safesearch', '1')
      const signal = searchOptions.signal === undefined
        ? AbortSignal.timeout(timeoutMs)
        : AbortSignal.any([searchOptions.signal, AbortSignal.timeout(timeoutMs)])
      let response: Response
      try {
        response = await run(url, {
          signal,
          headers: { accept: 'application/json', 'user-agent': 'PhysicsOS study search', ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }) },
        })
      } catch (error) {
        if (isAbort(error)) throw new ResearchError('SEARCH_TIMEOUT', '搜索超时，请稍后重试。')
        throw new ResearchError('SEARCH_UNAVAILABLE', '搜索服务当前不可用，请稍后重试。')
      }
      if (!response.ok) throw searchFailure(response.status)
      let body: unknown
      try { body = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)) } catch (error) {
        if (error instanceof ResearchError) throw error
        throw new ResearchError('SEARCH_PARSE_FAILED', '搜索服务返回了无法解析的结果。')
      }
      const results = typeof body === 'object' && body !== null && Array.isArray((body as { results?: unknown }).results)
        ? (body as { results: SearxResult[] }).results
        : []
      return results.flatMap((item): SearchHit[] => {
        if (typeof item.title !== 'string' || typeof item.url !== 'string') return []
        const title = plainText(item.title)
        if (title === '') return []
        return [{
          title: title.slice(0, 240),
          url: item.url,
          snippet: plainText(typeof item.content === 'string' ? item.content : '').slice(0, 1600),
          ...(typeof item.engine === 'string' ? { siteName: item.engine } : {}),
          ...(typeof item.publishedDate === 'string' ? { publishedAt: item.publishedDate } : {}),
        }]
      }).slice(0, searchOptions.limit)
    },
  }
}

interface BingRssOptions {
  readonly endpoint?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

/** Parse Bing RSS items. Exported so the adapter has a pure, testable parser. */
export function bingRssHits(text: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const part = match[1] ?? ''
    const read = (tag: string): string => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(part)?.[1] ?? ''
    const title = plainText(read('title'))
    const url = plainText(read('link'))
    if (title !== '' && url !== '' && !hits.some(hit => hit.url === url)) {
      hits.push({ title: title.slice(0, 240), url, snippet: plainText(read('description')).slice(0, 1600) })
    }
  }
  return hits
}

/**
 * Last-resort fallback source: Bing's public RSS endpoint. It needs no key but
 * is not an owned index; it is selected explicitly, never silently after a
 * paid/provider failure.
 */
export function bingRssProvider(options: BingRssOptions = {}): SearchProvider {
  const run = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const endpoint = options.endpoint ?? 'https://www.bing.com/search?format=rss&q='
  return {
    name: 'bing-rss',
    providesContent: false,
    async search(query, searchOptions) {
      let response: Response
      try { response = await run(endpoint + encodeURIComponent(query), { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'PhysicsOS study search' }, redirect: 'error' }) } catch (error) {
        if (isAbort(error)) throw new ResearchError('SEARCH_TIMEOUT', '搜索超时，请稍后重试。')
        throw new ResearchError('SEARCH_UNAVAILABLE', '搜索服务当前不可用，请稍后重试。')
      }
      if (!response.ok) throw searchFailure(response.status)
      return bingRssHits(await boundedText(response, MAX_RESPONSE_BYTES)).slice(0, searchOptions.limit)
    },
  }
}

export interface SearchWithFallbackOptions {
  readonly providers: readonly SearchProvider[]
  readonly limit: number
  readonly signal?: AbortSignal
}

/**
 * Query the configured sources in order and return the first non-empty
 * answer. A source that answers with zero results lets the next source try;
 * a source that fails (timeout, rate limit, outage) also lets the next one
 * try, but if every source failed the first real failure is surfaced instead
 * of pretending the query had no matches. Nothing silently switches to a
 * paid service.
 */
export async function searchWeb(query: string, options: SearchWithFallbackOptions): Promise<SearchResponse> {
  const normalized = query.trim()
  if (normalized === '' || normalized.length > MAX_QUERY) throw new ResearchError('INVALID_QUERY', '请用简短的物理概念关键词检索。')
  const errors: ResearchError[] = []
  for (const provider of options.providers) {
    try {
      const hits = (await provider.search(normalized, { limit: options.limit, ...(options.signal === undefined ? {} : { signal: options.signal }) }))
        .filter(hit => isHttpUrl(hit.url))
      if (hits.length > 0) return { query: normalized, provider: provider.name, hits }
    } catch (error) {
      errors.push(error instanceof ResearchError ? error : new ResearchError('SEARCH_UNAVAILABLE', '搜索服务当前不可用，请稍后重试。'))
    }
  }
  if (errors.length === options.providers.length && errors[0] !== undefined) throw errors[0]
  throw new ResearchError('NO_RESULTS', '暂时没有检索到可以核对的公开网页，请换一个更短的关键词。')
}

const isHttpUrl = (value: string): boolean => {
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' } catch { return false }
}
