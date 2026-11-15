import { abortFailure, boundedInteger, createOperation, failure, isCancellation, isResearchErrorCode, type Operation } from './operation.ts'
import { assertPublicUrl } from './safety.ts'
import { ResearchError, type ResearchDiagnostic, type SearchHit, type SearchOptions, type SearchProvider, type SearchProviderResult, type SearchResponse } from './types.ts'

const MAX_QUERY = 240
const DEFAULT_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 1_048_576

const entity = (name: string): string => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name] ?? ''
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

export function normalizeResearchQuery(query: string): string {
  if (typeof query !== 'string') throw failure('INVALID_QUERY')
  const normalized = query.trim().replace(/\s+/g, ' ')
  if (normalized === '' || normalized.length > MAX_QUERY) throw failure('INVALID_QUERY')
  return normalized
}

/** Cancel transport bodies without an unbounded background await of a faulty mock. */
function cancelBody(response: Response): void {
  try { void response.body?.cancel().catch(() => {}) } catch { /* Best-effort disposal of a late response. */ }
}

/** The deadline also applies after headers, including a slow-dripping response. */
async function boundedText(response: Response, maxBytes: number, operation: Operation): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  let complete = false
  const onAbort = (): void => { try { void reader.cancel().catch(() => {}) } catch { /* Already released. */ } }
  operation.signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      operation.check()
      const next = await operation.wait(() => reader.read())
      if (next.done) { complete = true; break }
      size += next.value.byteLength
      if (size > maxBytes) throw failure('SEARCH_PARSE_FAILED')
      chunks.push(next.value)
    }
    operation.check()
  } finally {
    operation.signal.removeEventListener('abort', onAbort)
    if (!complete) { try { void reader.cancel().catch(() => {}) } catch { /* Stream already closed. */ } }
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}

async function fetchText(run: typeof fetch, url: string | URL, init: RequestInit, operation: Operation): Promise<string> {
  let response: Response | undefined
  try {
    response = await operation.wait(() => run(url, { ...init, signal: operation.signal }), cancelBody)
    operation.check()
    if (!response.ok) throw failure(response.status === 429 ? 'SEARCH_RATE_LIMITED' : 'SEARCH_UNAVAILABLE')
    return await boundedText(response, MAX_RESPONSE_BYTES, operation)
  } catch (error) {
    if (operation.signal.aborted) throw abortFailure(operation.signal)
    if (isCancellation(error)) throw failure('RESEARCH_CANCELLED')
    if (error instanceof ResearchError) throw failure(error.code)
    if (error instanceof Error && error.name === 'TimeoutError') throw failure('SEARCH_TIMEOUT')
    throw failure('SEARCH_UNAVAILABLE')
  } finally { if (response !== undefined) cancelBody(response) }
}

export interface SearxOptions {
  readonly endpoint: string
  readonly apiKey?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

/** Optional metadata on a hit must also have the expected type; never coerce objects. */
function searxItem(value: unknown): SearchHit | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.title !== 'string' || typeof item.url !== 'string') return undefined
  if (item.content !== undefined && item.content !== null && typeof item.content !== 'string') return undefined
  if (item.engine !== undefined && item.engine !== null && typeof item.engine !== 'string') return undefined
  if (item.publishedDate !== undefined && item.publishedDate !== null && typeof item.publishedDate !== 'string') return undefined
  const title = plainText(item.title).slice(0, 240)
  if (title === '') return undefined
  try {
    const url = assertPublicUrl(item.url)
    url.hash = ''
    return {
      title, url: url.toString(), snippet: plainText(typeof item.content === 'string' ? item.content : '').slice(0, 1600),
      ...(typeof item.engine === 'string' ? { siteName: plainText(item.engine).slice(0, 80) } : {}),
      ...(typeof item.publishedDate === 'string' ? { publishedAt: item.publishedDate.slice(0, 80) } : {}),
    }
  } catch { return undefined }
}

/** Self-hosted SearXNG remains the primary adapter; no new index or paid SDK. */
export function searxngProvider(options: SearxOptions): SearchProvider {
  const run = options.fetch ?? globalThis.fetch
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 120_000)
  const searchDetailed = async (query: string, searchOptions: SearchOptions): Promise<SearchProviderResult> => {
    const operation = createOperation({ ...searchOptions, timeoutMs }, timeoutMs, 'SEARCH_TIMEOUT')
    try {
      operation.check()
      let url: URL
      try { url = new URL(options.endpoint) } catch { throw failure('SEARCH_UNAVAILABLE') }
      if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') throw failure('SEARCH_UNAVAILABLE')
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      url.searchParams.set('language', 'zh-CN')
      url.searchParams.set('safesearch', '1')
      // A configured private endpoint is trusted server configuration, not a
      // user-provided page URL. Do not forward its token across redirects.
      const text = await fetchText(run, url, {
        redirect: 'error',
        headers: { accept: 'application/json', 'user-agent': 'PhysicsOS study search', ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }) },
      }, operation)
      let body: unknown
      try { body = JSON.parse(text) } catch { throw failure('SEARCH_PARSE_FAILED') }
      operation.check()
      if (typeof body !== 'object' || body === null || Array.isArray(body) || !Array.isArray((body as Record<string, unknown>).results)) throw failure('SEARCH_PARSE_FAILED')
      const payload = body as Record<string, unknown> & { results: unknown[] }
      if (payload.unresponsive_engines !== undefined && (!Array.isArray(payload.unresponsive_engines) || payload.unresponsive_engines.some(item => !Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string'))) throw failure('SEARCH_PARSE_FAILED')
      const hits: SearchHit[] = []
      let invalid = 0
      for (const item of payload.results) {
        const hit = searxItem(item)
        if (hit === undefined) invalid++
        else if (!hits.some(existing => existing.url === hit.url)) hits.push(hit)
      }
      const diagnostics: ResearchDiagnostic[] = []
      if (invalid > 0) diagnostics.push({ stage: 'search', provider: 'searxng', code: 'SEARCH_PARSE_FAILED', outcome: 'partial', count: invalid })
      const unavailable = (payload.unresponsive_engines as unknown[] | undefined)?.length ?? 0
      if (unavailable > 0) diagnostics.push({ stage: 'search', provider: 'searxng', code: 'SEARCH_UNAVAILABLE', outcome: 'partial', count: unavailable })
      // A non-empty but entirely invalid answer is not an authoritative empty answer.
      if (hits.length === 0 && invalid > 0) throw new ResearchError('SEARCH_PARSE_FAILED', failure('SEARCH_PARSE_FAILED').message, diagnostics)
      if (hits.length === 0 && unavailable > 0) throw new ResearchError('SEARCH_UNAVAILABLE', failure('SEARCH_UNAVAILABLE').message, diagnostics)
      operation.check()
      return { hits: hits.slice(0, boundedInteger(searchOptions.limit, 5, 1, 10)), diagnostics }
    } finally { operation.dispose() }
  }
  return {
    name: 'searxng', providesContent: false,
    searchDetailed,
    async search(query, searchOptions) { return (await searchDetailed(query, searchOptions)).hits },
  }
}

export interface BingRssOptions {
  readonly endpoint?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

export function bingRssHits(text: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const part = match[1] ?? ''
    const read = (tag: string): string => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(part)?.[1] ?? ''
    const title = plainText(read('title'))
    const url = plainText(read('link'))
    if (title !== '' && url !== '' && !hits.some(hit => hit.url === url)) hits.push({ title: title.slice(0, 240), url, snippet: plainText(read('description')).slice(0, 1600) })
  }
  return hits
}

/** Public RSS is still the explicitly configured last-resort fallback. */
export function bingRssProvider(options: BingRssOptions = {}): SearchProvider {
  const run = options.fetch ?? globalThis.fetch
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 120_000)
  const endpoint = options.endpoint ?? 'https://www.bing.com/search?format=rss&q='
  return {
    name: 'bing-rss', providesContent: false,
    async search(query, searchOptions) {
      const operation = createOperation({ ...searchOptions, timeoutMs }, timeoutMs, 'SEARCH_TIMEOUT')
      try {
        operation.check()
        const text = await fetchText(run, endpoint + encodeURIComponent(query), { headers: { 'user-agent': 'PhysicsOS study search' }, redirect: 'error' }, operation)
        if (!/<rss\b[^>]*>[\s\S]*<channel\b[^>]*>[\s\S]*<\/channel>\s*<\/rss>/i.test(text)) throw failure('SEARCH_PARSE_FAILED')
        const hits = bingRssHits(text)
        if (/<item\b/i.test(text) && hits.length === 0) throw failure('SEARCH_PARSE_FAILED')
        operation.check()
        return hits.slice(0, boundedInteger(searchOptions.limit, 5, 1, 10))
      } finally { operation.dispose() }
    },
  }
}

export interface SearchWithFallbackOptions {
  readonly providers: readonly SearchProvider[]
  readonly limit: number
  readonly signal?: AbortSignal
  readonly deadlineAt?: number
  readonly timeoutMs?: number
}

/** Safe adapter labels only, not endpoint URLs or configuration values. */
const providerLabel = (value: string): string => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value) ? value : 'provider'

function normalizeHits(value: unknown, limit: number): { hits: SearchHit[]; invalid: number } {
  if (!Array.isArray(value)) throw failure('SEARCH_PARSE_FAILED')
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  let invalid = 0
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) { invalid++; continue }
    const hit = item as Record<string, unknown>
    if (typeof hit.title !== 'string' || typeof hit.url !== 'string' || typeof hit.snippet !== 'string') { invalid++; continue }
    let url: URL
    try { url = assertPublicUrl(hit.url); url.hash = '' } catch { invalid++; continue }
    const title = plainText(hit.title).slice(0, 240)
    if (title === '') { invalid++; continue }
    const key = url.toString()
    if (seen.has(key)) continue
    seen.add(key)
    if (hits.length < limit) hits.push({ title, url: key, snippet: plainText(hit.snippet).slice(0, 1600), ...(typeof hit.siteName === 'string' ? { siteName: plainText(hit.siteName).slice(0, 80) } : {}), ...(typeof hit.publishedAt === 'string' ? { publishedAt: hit.publishedAt.slice(0, 80) } : {}) })
  }
  return { hits, invalid }
}

/** Sanitize optional adapter diagnostics rather than forwarding its raw objects. */
function adapterDiagnostics(value: unknown, provider: string): ResearchDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 16).flatMap((item: unknown): ResearchDiagnostic[] => {
    if (typeof item !== 'object' || item === null) return []
    const entry = item as Record<string, unknown>
    if (!isResearchErrorCode(entry.code) || !['SEARCH_TIMEOUT', 'SEARCH_RATE_LIMITED', 'SEARCH_UNAVAILABLE', 'SEARCH_PARSE_FAILED'].includes(entry.code)) return []
    return [{ stage: 'search', provider, code: entry.code, outcome: 'partial', ...(typeof entry.count === 'number' && Number.isFinite(entry.count) ? { count: boundedInteger(entry.count, 0, 0, 1_000_000) } : {}) }]
  })
}

/** Cancel stops the round, not merely one provider. Failure + empty remains a failure. */
export async function searchWeb(query: string, options: SearchWithFallbackOptions): Promise<SearchResponse> {
  const normalized = normalizeResearchQuery(query)
  // When nested in research, adapters keep their per-provider timeout while
  // this layer shares the whole remaining round budget across fallbacks.
  const fallbackBudget = options.deadlineAt === undefined ? DEFAULT_TIMEOUT_MS : Math.max(1, options.deadlineAt - Date.now())
  const operation = createOperation(options, fallbackBudget, 'SEARCH_TIMEOUT')
  const diagnostics: ResearchDiagnostic[] = []
  const errors: ResearchError[] = []
  const limit = boundedInteger(options.limit, 5, 1, 10)
  try {
    operation.check()
    if (options.providers.length === 0) throw failure('SEARCH_UNAVAILABLE')
    for (const provider of options.providers) {
      operation.check()
      const label = providerLabel(provider.name)
      try {
        const searchOptions: SearchOptions = { limit, signal: operation.signal, deadlineAt: operation.deadlineAt }
        const detailed = await operation.wait(() => provider.searchDetailed === undefined
          ? provider.search(normalized, searchOptions).then(hits => ({ hits }))
          : provider.searchDetailed(normalized, searchOptions))
        if (typeof detailed !== 'object' || detailed === null) throw failure('SEARCH_PARSE_FAILED')
        const normalizedHits = normalizeHits(detailed.hits, limit)
        diagnostics.push(...adapterDiagnostics('diagnostics' in detailed ? detailed.diagnostics : undefined, label))
        if (normalizedHits.invalid > 0) diagnostics.push({ stage: 'search', provider: label, code: 'SEARCH_PARSE_FAILED', outcome: 'partial', count: normalizedHits.invalid })
        if (normalizedHits.hits.length > 0) return { query: normalized, provider: label, hits: normalizedHits.hits, degraded: diagnostics.some(item => item.outcome !== 'empty'), diagnostics }
        if (normalizedHits.invalid > 0) throw failure('SEARCH_PARSE_FAILED')
        const partial = diagnostics.find(item => item.provider === label && item.outcome === 'partial')
        if (partial !== undefined) throw failure(partial.code)
        diagnostics.push({ stage: 'search', provider: label, code: 'NO_RESULTS', outcome: 'empty' })
      } catch (error) {
        operation.check()
        if (isCancellation(error)) throw failure('RESEARCH_CANCELLED')
        const code = error instanceof ResearchError && ['SEARCH_TIMEOUT', 'SEARCH_RATE_LIMITED', 'SEARCH_UNAVAILABLE', 'SEARCH_PARSE_FAILED'].includes(error.code) ? error.code : 'SEARCH_UNAVAILABLE'
        if (error instanceof ResearchError) diagnostics.push(...adapterDiagnostics(error.diagnostics, label))
        diagnostics.push({ stage: 'search', provider: label, code, outcome: 'failed' })
        errors.push(failure(code))
      }
    }
    operation.check()
    const code = errors[0]?.code ?? 'NO_RESULTS'
    throw new ResearchError(code, failure(code).message, diagnostics)
  } catch (error) {
    if (operation.signal.aborted) throw abortFailure(operation.signal)
    if (error instanceof ResearchError) throw error
    throw new ResearchError('SEARCH_UNAVAILABLE', failure('SEARCH_UNAVAILABLE').message, diagnostics)
  } finally { operation.dispose() }
}
