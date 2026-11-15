import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tool from '../src/index.ts'
import { createResearchService, researchConfigFromEnv, researchFailureMessage, type ResearchService } from '../src/research-service.ts'
import { ResearchError, resolveCitation, type PageReader, type SearchHit, type SearchProvider } from '@physicsos/web-research'

const hit: SearchHit = { title: '洛伦兹力', url: 'https://science.example.com/lorentz', snippet: 'F=qvB' }
const p: SearchProvider = { name: 'fixture', providesContent: false, async search() { return [hit] } }
const fullReader: PageReader = { async read(url) { return { url, title: '洛伦兹力正文', text: '洛伦兹力使粒子做圆周运动，半径 r = mv/(qB)。', fetchedAt: '2026-11-14T00:00:00Z', contentType: 'text/plain' } } }
const services: ResearchService[] = []
const make = (config: Parameters<typeof createResearchService>[0] = {}, dependencies: Parameters<typeof createResearchService>[1] = { providers: [p], reader: fullReader }): ResearchService => {
  const service = createResearchService(config, dependencies)
  services.push(service)
  return service
}
const tick = async (): Promise<void> => { for (let index = 0; index < 30; index++) await Promise.resolve() }
afterEach(async () => { for (const service of services.splice(0)) service.dispose(); await tick(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('research service compatibility and presentation (offline)', () => {
  it('keeps the existing search tool', () => {
    expect(tool.TOOL_NAMES).toContain('physics_search_web')
  })

  it('reads only configured environment fields, ignores invalid optional numbers', () => {
    expect(researchConfigFromEnv({})).toEqual({})
    expect(researchConfigFromEnv({ PHYSICSOS_RESEARCH_SEARXNG_URL: 'http://searxng:8080/search' })).toEqual({ searxngUrl: 'http://searxng:8080/search' })
    expect(researchConfigFromEnv({ PHYSICSOS_RESEARCH_SEARXNG_URL: '  ' })).toEqual({})
    expect(researchConfigFromEnv({ PHYSICSOS_RESEARCH_MAX_CONCURRENT: '2', PHYSICSOS_RESEARCH_MAX_QUEUED: '8', PHYSICSOS_RESEARCH_CACHE_TTL_MS: '0', PHYSICSOS_RESEARCH_CACHE_MAX_BYTES: '1024', PHYSICSOS_RESEARCH_TIMEOUT_MS: 'invalid', PRIVATE_ENV: 'do not forward' })).toEqual({ maxConcurrent: 2, maxQueued: 8, cacheTtlMs: 0, cacheMaxBytes: 1024 })
  })

  it('maps new and existing stable errors to distinct safe Chinese messages', () => {
    const codes = ['INVALID_QUERY', 'NO_RESULTS', 'RESEARCH_CANCELLED', 'RESEARCH_TIMEOUT', 'RESEARCH_BUSY', 'SEARCH_TIMEOUT', 'SEARCH_RATE_LIMITED', 'SEARCH_UNAVAILABLE', 'SEARCH_PARSE_FAILED', 'INVALID_CITATION']
    const messages = codes.map(researchFailureMessage)
    expect(new Set(messages).size).toBe(codes.length)
    expect(messages.some(message => message.includes('没有检索到'))).toBe(true)
    expect(messages.some(message => message.includes('联网'))).toBe(true)
  })

  it('returns legacy sourceId and new scoped identity, hash/timestamp/depth with explicit model guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network forbidden in this test') }))
    const service = make()
    const value = await service.present('洛伦兹力 半径')
    const sources = value.sources as Record<string, unknown>[]
    expect(sources.map(source => source.sourceId)).toEqual(['s1'])
    expect(sources[0]).toMatchObject({ sourceKey: expect.stringMatching(/^src_/), citationId: expect.stringContaining(String(value.researchId)), depth: 'full-text', fetchedAt: '2026-11-14T00:00:00Z', contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/), url: hit.url })
    expect(value.readCount).toBe(1)
    expect(value.guidance).toContain('引用必须使用本轮 sources 的 citationId')
    expect(value.guidance).toContain('sourceId（如 s1）仅为本轮显示编号')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('deterministically downgrades a failed reader without fetching example.com', async () => {
    const read = vi.fn(async (_url: string) => { throw new Error('private transport error') })
    const service = make({}, { providers: [p], reader: { read } })
    const value = await service.present('洛伦兹力')
    expect((value.sources as Record<string, unknown>[])[0]?.depth).toBe('snippet')
    expect(value.readCount).toBe(0)
    expect(value.guidance).toContain('没有读取网页全文')
    expect(value.degraded).toBe(true)
    expect(value.diagnostics).toEqual([expect.objectContaining({ code: 'FETCH_UNAVAILABLE' })])
    expect(JSON.stringify(value.notes)).not.toContain('private')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('read:false bypasses the reader and has a separate cache identity from full text', async () => {
    const search = vi.fn(p.search)
    const read = vi.fn(fullReader.read)
    const service = make({}, { providers: [{ ...p, search }], reader: { read } })
    const summary = await service.present('洛伦兹力', undefined, { read: false })
    expect(summary.readCount).toBe(0)
    expect((summary.sources as Record<string, unknown>[])[0]?.depth).toBe('snippet')
    expect(summary.guidance).toContain('没有读取网页全文')
    expect(read).not.toHaveBeenCalled()
    const full = await service.present('洛伦兹力')
    expect(full.readCount).toBe(1)
    expect(read).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('emits lossless JSON with no undefined fields and does not refresh cached provenance', async () => {
    const service = make()
    const value = await service.present('洛伦兹力')
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    const again = await service.present('洛伦兹力')
    expect(again).toEqual(value)
    for (const source of value.sources as Record<string, unknown>[]) for (const field of Object.values(source)) expect(field).not.toBeUndefined()
  })

  it('keeps SearXNG first, Bing only as fallback, preserves failure diagnostics and secrets stay server-side', async () => {
    const run = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).includes('searxng')) return new Response('{}', { headers: { 'content-type': 'application/json' } })
      return new Response(`<rss><channel><item><title>${hit.title}</title><link>${hit.url}</link><description>${hit.snippet}</description></item></channel></rss>`)
    })
    const service = make({ searxngUrl: 'http://searxng:8080/search', searxngKey: 'test-only-secret' }, { fetch: run as typeof fetch, reader: fullReader })
    const value = await service.present('洛伦兹力', undefined, { read: false })
    expect(String(run.mock.calls[0]?.[0])).toContain('searxng')
    expect(String(run.mock.calls[1]?.[0])).toContain('bing.com')
    expect(run.mock.calls[0]?.[1]).toMatchObject({ headers: expect.objectContaining({ authorization: 'Bearer test-only-secret' }), redirect: 'error' })
    expect(run.mock.calls[1]?.[1]?.headers).not.toHaveProperty('authorization')
    expect(value.provider).toBe('bing-rss')
    expect(value.degraded).toBe(true)
    expect(value.diagnostics).toContainEqual(expect.objectContaining({ code: 'SEARCH_PARSE_FAILED' }))
    expect(JSON.stringify(value)).not.toContain('test-only-secret')
  })

  it('does not call Bing after a successful primary answer', async () => {
    const run = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ results: [{ title: hit.title, url: hit.url, content: hit.snippet }] })))
    const value = await make({ searxngUrl: 'http://searxng:8080/search' }, { fetch: run as typeof fetch, reader: fullReader }).present('洛伦兹力', undefined, { read: false })
    expect(value.provider).toBe('searxng')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('surfaces a real search failure and does not cache it', async () => {
    const search = vi.fn(async () => { throw new ResearchError('SEARCH_UNAVAILABLE', 'secret raw error') })
    const service = make({}, { providers: [{ ...p, search }], reader: fullReader })
    for (let index = 0; index < 2; index++) await expect(service.research('洛伦兹力')).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('scope-checks a previous-round citation rather than reusing s1 from another query', async () => {
    const service = make({ cacheTtlMs: 0 })
    const first = await service.research('洛伦兹力')
    const second = await service.research('磁场')
    expect(() => resolveCitation(second, first.sources[0]!.citationId)).toThrowError(expect.objectContaining({ code: 'INVALID_CITATION' }))
    expect(() => resolveCitation(second, { researchId: first.researchId, sourceId: 's1' })).toThrowError(expect.objectContaining({ code: 'INVALID_CITATION' }))
  })
})

describe('service cancellation/dispose', () => {
  it('one waiters cancellation leaves another waiter running', async () => {
    let complete!: (hits: readonly SearchHit[]) => void
    let sharedSignal: AbortSignal | undefined
    const search = vi.fn((_query: string, options: import('@physicsos/web-research').SearchOptions) => {
      sharedSignal = options.signal
      return new Promise<readonly SearchHit[]>(resolve => { complete = resolve })
    })
    const service = make({}, { providers: [{ ...p, search }], reader: fullReader })
    const caller = new AbortController()
    const first = service.research('力', caller.signal, { read: false }).catch(error => error)
    const second = service.research('力', undefined, { read: false })
    await tick()
    caller.abort()
    expect((await first).code).toBe('RESEARCH_CANCELLED')
    expect(sharedSignal?.aborted).toBe(false)
    complete([hit])
    expect((await second).sources).toHaveLength(1)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('dispose cancels active/queued waiters, prevents future work, ignores late results', async () => {
    let complete!: (hits: readonly SearchHit[]) => void
    let sharedSignal: AbortSignal | undefined
    const search = vi.fn((_query: string, options: import('@physicsos/web-research').SearchOptions) => {
      sharedSignal = options.signal
      return new Promise<readonly SearchHit[]>(resolve => { complete = resolve })
    })
    const service = make({ maxConcurrent: 1 }, { providers: [{ ...p, search }], reader: fullReader })
    const active = service.research('first').catch(error => error)
    const queued = service.research('queued').catch(error => error)
    await tick()
    service.dispose()
    expect((await active).code).toBe('RESEARCH_CANCELLED')
    expect((await queued).code).toBe('RESEARCH_CANCELLED')
    expect(sharedSignal?.aborted).toBe(true)
    await expect(service.research('later')).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    complete([hit])
    await tick()
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('queue saturation returns a stable busy error without network retries', async () => {
    let complete!: (hits: readonly SearchHit[]) => void
    const service = make({ maxConcurrent: 1, maxQueued: 0 }, { providers: [{ ...p, search: () => new Promise(resolve => { complete = resolve }) }], reader: fullReader })
    const pending = service.research('first', undefined, { read: false })
    await tick()
    await expect(service.research('second')).rejects.toMatchObject({ code: 'RESEARCH_BUSY' })
    complete([hit])
    await pending
  })
})
