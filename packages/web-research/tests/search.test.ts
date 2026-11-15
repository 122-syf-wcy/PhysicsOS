import { afterEach, describe, expect, it, vi } from 'vitest'
import { bingRssHits, bingRssProvider, ResearchError, searchWeb, searxngProvider, type SearchHit, type SearchProvider } from '../src/index.ts'

const hit: SearchHit = { title: '洛伦兹力', url: 'https://science.example.com/lorentz', snippet: 'F = qvB' }
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const provider = (name: string, hits: readonly SearchHit[] | Error): SearchProvider => ({ name, providesContent: false, async search() { if (hits instanceof Error) throw hits; return hits } })
const rss = '<rss><channel><item><title>洛伦兹力</title><link>https://science.example.com/lorentz</link><description>F=qvB</description></item></channel></rss>'
const tick = async (): Promise<void> => { for (let index = 0; index < 8; index++) await Promise.resolve() }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('searchWeb fallback classification', () => {
  it('returns the first non-empty provider and records an earlier authoritative empty answer', async () => {
    const result = await searchWeb('  洛伦兹力   半径 ', { providers: [provider('empty', []), provider('second', [hit])], limit: 5 })
    expect(result.provider).toBe('second')
    expect(result.query).toBe('洛伦兹力 半径')
    expect(result.hits).toEqual([hit])
    expect(result.degraded).toBe(false)
    expect(result.diagnostics).toEqual([{ stage: 'search', provider: 'empty', code: 'NO_RESULTS', outcome: 'empty' }])
  })

  it('retains partial failures on a successful fallback and never includes raw errors', async () => {
    const result = await searchWeb('query-private', { providers: [provider('main', new Error('authorization=secret; query-private; body-private')), provider('fallback', [hit])], limit: 5 })
    expect(result.degraded).toBe(true)
    expect(result.diagnostics).toEqual([{ stage: 'search', provider: 'main', code: 'SEARCH_UNAVAILABLE', outcome: 'failed' }])
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/secret|query-private|body-private/)
  })

  it('surfaces the first real failure when all fail', async () => {
    await expect(searchWeb('洛伦兹力', { providers: [provider('one', new ResearchError('SEARCH_TIMEOUT', 'raw timeout')), provider('two', new ResearchError('SEARCH_RATE_LIMITED', 'raw limit'))], limit: 5 }))
      .rejects.toMatchObject({ code: 'SEARCH_TIMEOUT', diagnostics: [expect.objectContaining({ code: 'SEARCH_TIMEOUT' }), expect.objectContaining({ code: 'SEARCH_RATE_LIMITED' })] })
  })

  it.each([false, true])('does not turn a mixed empty/failure into NO_RESULTS (failure first=%s)', async failureFirst => {
    const empty = provider('empty', [])
    const failed = provider('failed', new ResearchError('SEARCH_UNAVAILABLE', 'unavailable'))
    await expect(searchWeb('洛伦兹力', { providers: failureFirst ? [failed, empty] : [empty, failed], limit: 5 })).rejects.toMatchObject({
      code: 'SEARCH_UNAVAILABLE', diagnostics: expect.arrayContaining([expect.objectContaining({ outcome: 'empty' }), expect.objectContaining({ outcome: 'failed' })]),
    })
  })

  it('reports NO_RESULTS only for authoritative empty answers; no providers is unavailable', async () => {
    await expect(searchWeb('洛伦兹力', { providers: [provider('one', []), provider('two', [])], limit: 5 })).rejects.toMatchObject({ code: 'NO_RESULTS' })
    await expect(searchWeb('洛伦兹力', { providers: [], limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' })
  })

  it('rejects invalid queries before calling providers', async () => {
    const search = vi.fn(async () => [hit])
    const p: SearchProvider = { name: 'test', providesContent: false, search }
    await expect(searchWeb('  ', { providers: [p], limit: 5 })).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    await expect(searchWeb('x'.repeat(241), { providers: [p], limit: 5 })).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    expect(search).not.toHaveBeenCalled()
  })

  it('filters private, credentials, invalid protocols and duplicate URL fragments', async () => {
    const result = await searchWeb('力', { providers: [provider('p', [
      hit, { ...hit, url: hit.url + '#section' },
      { ...hit, url: 'javascript:alert(1)' }, { ...hit, url: 'http://[::ffff:7f00:1]/' },
      { ...hit, url: 'https://user:secret@example.com/' }, { ...hit, url: 'http://metadata.google.internal/' },
    ])], limit: 5 })
    expect(result.hits).toEqual([hit])
    expect(result.degraded).toBe(true)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SEARCH_PARSE_FAILED', count: 4 }))
  })

  it('honours limit even when an injected provider ignores it', async () => {
    const result = await searchWeb('力', { providers: [provider('p', [hit, { ...hit, url: hit.url + '/2' }])], limit: 1 })
    expect(result.hits).toHaveLength(1)
  })
})

describe('search cancellation and round deadline', () => {
  it('starts nothing for a pre-aborted caller', async () => {
    const caller = new AbortController()
    caller.abort(new Error('secret abort reason'))
    const search = vi.fn(async () => [hit])
    await expect(searchWeb('力', { providers: [{ name: 'p', providesContent: false, search }], signal: caller.signal, limit: 5 })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    expect(search).not.toHaveBeenCalled()
  })

  it('does not fallback after caller cancellation and discards a late provider success', async () => {
    const caller = new AbortController()
    let complete!: (hits: readonly SearchHit[]) => void
    const primary: SearchProvider = { name: 'primary', providesContent: false, search: vi.fn(() => new Promise(resolve => { complete = resolve })) }
    const fallbackSearch = vi.fn(async () => [hit])
    const fallback: SearchProvider = { name: 'fallback', providesContent: false, search: fallbackSearch }
    const pending = searchWeb('力', { providers: [primary, fallback], signal: caller.signal, limit: 5 }).catch(error => error)
    await tick()
    caller.abort()
    expect((await pending).code).toBe('RESEARCH_CANCELLED')
    complete([hit])
    await tick()
    expect(fallbackSearch).not.toHaveBeenCalled()
  })

  it('treats a provider AbortError as cancellation rather than an outage fallback', async () => {
    const fallback = vi.fn(async () => [hit])
    await expect(searchWeb('力', { providers: [provider('cancelled', new DOMException('raw private reason', 'AbortError')), { name: 'fallback', providesContent: false, search: fallback }], limit: 5 })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('shares an absolute deadline across providers, including an uncooperative promise', async () => {
    vi.useFakeTimers()
    const late = vi.fn(async () => new Promise<readonly SearchHit[]>(() => {}))
    const fallback = vi.fn(async () => [hit])
    const pending = searchWeb('力', { providers: [{ name: 'slow', providesContent: false, search: late }, { name: 'fallback', providesContent: false, search: fallback }], limit: 5, timeoutMs: 1_000, deadlineAt: Date.now() + 20 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(21)
    expect((await pending).code).toBe('SEARCH_TIMEOUT')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('removes parent abort listeners after success and failure', async () => {
    for (const hits of [[hit], new Error('offline')] as const) {
      const caller = new AbortController()
      const add = vi.spyOn(caller.signal, 'addEventListener')
      const remove = vi.spyOn(caller.signal, 'removeEventListener')
      await searchWeb('力', { providers: [provider('p', hits)], signal: caller.signal, limit: 5 }).catch(() => {})
      expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(add.mock.calls.filter(([event]) => event === 'abort').length)
    }
  })
})

describe('SearXNG schema, faults and diagnostics', () => {
  it('requests self-hosted JSON, normalizes hits and records invalid mixed items', async () => {
    const run = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({ results: [{ title: '<b>安培力</b>', url: 'https://science.example.com/a', content: 'F = BIL', engine: 'wikipedia' }, null, { title: '', url: 'https://science.example.com/b', content: '' }] }))
    const p = searxngProvider({ endpoint: 'http://searxng:8080/search', fetch: run as typeof fetch })
    const result = await searchWeb('安培力', { providers: [p], limit: 5 })
    expect(String(run.mock.calls[0]?.[0])).toContain('format=json')
    expect(String(run.mock.calls[0]?.[0])).toContain('language=zh-CN')
    expect(result.hits).toEqual([{ title: '安培力', url: 'https://science.example.com/a', snippet: 'F = BIL', siteName: 'wikipedia' }])
    expect(result.degraded).toBe(true)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SEARCH_PARSE_FAILED', count: 2 }))
  })

  it.each([{}, null, [], { results: null }, { results: {} }, { results: [null] }, { results: ['bad'] }, { results: [{ title: 'a', url: hit.url, content: { text: 'not string' } }] }, { results: [], unresponsive_engines: null }])('rejects malformed payload %j instead of no-results', async body => {
    const p = searxngProvider({ endpoint: 'http://searxng:8080/search', fetch: (async () => json(body)) as typeof fetch })
    await expect(searchWeb('力', { providers: [p], limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_PARSE_FAILED' })
  })

  it('returns NO_RESULTS for a valid empty results array', async () => {
    const p = searxngProvider({ endpoint: 'http://searxng:8080/search', fetch: (async () => json({ results: [] })) as typeof fetch })
    await expect(searchWeb('力', { providers: [p], limit: 5 })).rejects.toMatchObject({ code: 'NO_RESULTS' })
  })

  it('records partial upstream failure counts, never raw engine error bodies', async () => {
    const p = searxngProvider({ endpoint: 'http://searxng:8080/search', fetch: (async () => json({ results: [{ title: hit.title, url: hit.url, content: hit.snippet }], unresponsive_engines: [['engine-private', 'secret response body']] })) as typeof fetch })
    const result = await searchWeb('力', { providers: [p], limit: 5 })
    expect(result.degraded).toBe(true)
    expect(result.diagnostics).toEqual([{ stage: 'search', provider: 'searxng', code: 'SEARCH_UNAVAILABLE', outcome: 'partial', count: 1 }])
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/private|secret/)
    const empty = searxngProvider({ endpoint: 'http://searxng:8080/search', fetch: (async () => json({ results: [], unresponsive_engines: [['engine-private', 'timeout']] })) as typeof fetch })
    await expect(searchWeb('力', { providers: [empty], limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' })
  })

  it.each([[429, 'SEARCH_RATE_LIMITED'], [500, 'SEARCH_UNAVAILABLE']] as const)('maps HTTP %s and cancels its body', async (status, code) => {
    const cancel = vi.fn()
    const p = searxngProvider({ endpoint: 'http://searxng:8080/search', fetch: (async () => new Response(new ReadableStream({ cancel }), { status })) as typeof fetch })
    await expect(p.search('力', { limit: 5 })).rejects.toMatchObject({ code })
    expect(cancel).toHaveBeenCalled()
  })

  it('sanitizes fetch failure, malformed JSON and an oversized body', async () => {
    const options = { endpoint: 'http://searxng:8080/search' }
    const unavailable = searxngProvider({ ...options, fetch: (async () => { throw new TypeError('private query, Authorization secret') }) as typeof fetch })
    const error = await unavailable.search('力', { limit: 5 }).catch(value => value)
    expect(error.code).toBe('SEARCH_UNAVAILABLE')
    expect(error.message).not.toContain('secret')
    await expect(searxngProvider({ ...options, fetch: (async () => new Response('<html>captcha</html>')) as typeof fetch }).search('力', { limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_PARSE_FAILED' })
    await expect(searxngProvider({ ...options, fetch: (async () => new Response('x'.repeat(1_048_577))) as typeof fetch }).search('力', { limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_PARSE_FAILED' })
  })

  it('does not forward an endpoint token through redirects', async () => {
    const run = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({ results: [] }))
    await searxngProvider({ endpoint: 'http://searxng:8080/search', apiKey: 'test-only-token', fetch: run as typeof fetch }).search('力', { limit: 5 })
    expect(run.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: expect.objectContaining({ authorization: 'Bearer test-only-token' }) })
  })
})

describe('adapter abort, body timeout and late cleanup', () => {
  it.each(['searxng', 'bing'] as const)('propagates caller abort into %s and cancels a stalled body', async name => {
    const caller = new AbortController()
    const cancel = vi.fn()
    let signal: AbortSignal | undefined
    const run: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(name === 'bing' ? '<rss><channel>' : '{"results":[')) }, cancel }))
    }) as typeof fetch
    const p = name === 'bing' ? bingRssProvider({ fetch: run }) : searxngProvider({ endpoint: 'http://searxng:8080/search', fetch: run })
    const pending = p.search('力', { signal: caller.signal, limit: 5 }).catch(error => error)
    await tick()
    caller.abort()
    expect((await pending).code).toBe('RESEARCH_CANCELLED')
    expect(signal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalled()
  })

  it('times out a slow-dripping body even though it keeps producing chunks', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    let timer: ReturnType<typeof setInterval> | undefined
    const p = bingRssProvider({ timeoutMs: 30, fetch: (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { timer = setInterval(() => controller.enqueue(new TextEncoder().encode(' ')), 2) },
      cancel() { if (timer !== undefined) clearInterval(timer); cancel() },
    }))) as typeof fetch })
    const pending = p.search('力', { limit: 5 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(31)
    expect((await pending).code).toBe('SEARCH_TIMEOUT')
    expect(cancel).toHaveBeenCalled()
  })

  it('disposes a fetch Response arriving after cancellation without parsing it', async () => {
    const caller = new AbortController()
    let complete!: (response: Response) => void
    const cancel = vi.fn()
    const p = bingRssProvider({ fetch: (() => new Promise<Response>(resolve => { complete = resolve })) as typeof fetch })
    const pending = p.search('力', { limit: 5, signal: caller.signal }).catch(error => error)
    await tick()
    caller.abort()
    expect((await pending).code).toBe('RESEARCH_CANCELLED')
    complete(new Response(new ReadableStream({ cancel })))
    await tick()
    expect(cancel).toHaveBeenCalled()
  })
})

describe('Bing RSS fallback', () => {
  it('parses entities and CDATA in the pure parser', () => {
    expect(bingRssHits('<rss><channel><item><title>牛顿 &amp; 第二定律</title><link>https://example.com/n</link><description><![CDATA[<b>F=ma</b>]]></description></item></channel></rss>')).toEqual([{ title: '牛顿 & 第二定律', url: 'https://example.com/n', snippet: 'F=ma' }])
  })
  it('rejects HTML/CAPTCHA as parse failure, not no-results', async () => {
    const p = bingRssProvider({ fetch: (async () => new Response('<html>captcha</html>')) as typeof fetch })
    await expect(p.search('力', { limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_PARSE_FAILED' })
  })
  it('keeps a valid RSS successful array contract', async () => {
    expect(await bingRssProvider({ fetch: (async () => new Response(rss)) as typeof fetch }).search('力', { limit: 5 })).toHaveLength(1)
  })
})
