import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { excerptOf, researchQuestion, resolveCitation, ResearchError, type PageReader, type ReadDocument, type SearchHit, type SearchProvider } from '../src/index.ts'

const hits: SearchHit[] = [
  { title: '洛伦兹力', url: 'https://science.example.com/lorentz', snippet: 'F = qvB' },
  { title: '磁场', url: 'https://science.example.com/magnetic', snippet: '磁场方向' },
  { title: '圆周运动', url: 'https://science.example.com/circle', snippet: '半径 r' },
]
const provider: SearchProvider = { name: 'test', providesContent: false, async search() { return hits } }
const stamp = '2026-11-14T00:00:00Z'
const documentOf = (url: string): ReadDocument => ({ url, title: '页面 ' + url, text: '第一段无关内容。\n\n洛伦兹力使带电粒子做圆周运动，半径 r = mv/(qB)。\n\n第三段。', fetchedAt: stamp, contentType: 'text/html' })
const reader = (failOn?: string): PageReader => ({ async read(url) { if (failOn !== undefined && url.includes(failOn)) throw new Error('offline secret'); return documentOf(url) } })
const tick = async (): Promise<void> => { for (let index = 0; index < 8; index++) await Promise.resolve() }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('research evidence and depth', () => {
  it('reads only the top pages, preserves real fetch timestamps, and hashes both evidence depths', async () => {
    const result = await researchQuestion('洛伦兹力 半径', { providers: [provider], reader: reader() }, { limit: 3, readLimit: 2, now: () => new Date('2026-11-16T01:00:00Z') })
    expect(result.sources.map(source => source.depth)).toEqual(['full-text', 'full-text', 'snippet'])
    expect(result.readCount).toBe(2)
    expect(result.sources[0]?.excerpt).toContain('r = mv/(qB)')
    expect(result.sources[0]?.fetchedAt).toBe(stamp)
    expect(result.sources[0]?.contentSha256).toBe(hash(documentOf(hits[0]!.url).text))
    expect(result.sources[2]?.excerpt).toBeUndefined()
    expect(result.sources[2]?.fetchedAt).toBe('2026-11-16T01:00:00.000Z')
    expect(result.sources[2]?.contentSha256).toBe(hash(hits[2]!.snippet))
    expect(result.researchId).toMatch(/^r_/)
    expect(result.degraded).toBe(false)
  })

  it('bounds injected providers and keeps honest read failure diagnostics, not raw errors', async () => {
    const read = vi.fn(reader('lorentz').read)
    const result = await researchQuestion('洛伦兹力', { providers: [provider], reader: { read } }, { limit: 1, readLimit: 1 })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.depth).toBe('snippet')
    expect(result.readCount).toBe(0)
    expect(result.notes[0]).toContain('未读取全文')
    expect(result.diagnostics).toEqual([{ stage: 'read', provider: 'test', sourceId: 's1', code: 'FETCH_UNAVAILABLE', outcome: 'failed' }])
    expect(result.degraded).toBe(true)
    expect(JSON.stringify(result.notes)).not.toContain('secret')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('readLimit:0 never invokes the reader or claims full text', async () => {
    const read = vi.fn(async (_url: string) => { throw new Error('must not be called') })
    const result = await researchQuestion('洛伦兹力', { providers: [provider], reader: { read } }, { readLimit: 0 })
    expect(result.sources.every(source => source.depth === 'snippet')).toBe(true)
    expect(result.readCount).toBe(0)
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects malformed injected page evidence and retains the search snippet', async () => {
    const result = await researchQuestion('洛伦兹力', { providers: [provider], reader: { async read(url) { return { ...documentOf(url), fetchedAt: 'not a timestamp' } } } }, { limit: 1 })
    expect(result.sources[0]?.depth).toBe('snippet')
    expect(result.diagnostics[0]?.code).toBe('FETCH_PARSE_FAILED')
  })

  it('deduplicates hit fragments and shared final redirect URLs', async () => {
    const p: SearchProvider = { ...provider, async search() { return [hits[0]!, { ...hits[0]!, url: hits[0]!.url + '#other' }, hits[1]!] } }
    const result = await researchQuestion('力', { providers: [p], reader: { async read() { return documentOf('https://science.example.com/final') } } }, { readLimit: 3 })
    expect(result.sources).toHaveLength(1)
    expect(result.readCount).toBe(1)
    expect(result.sources[0]?.url).toBe('https://science.example.com/final')
  })
})

describe('research cancellation/deadline', () => {
  it('cancels before search for a pre-aborted caller', async () => {
    const caller = new AbortController()
    caller.abort()
    const search = vi.fn(async () => hits)
    await expect(researchQuestion('力', { providers: [{ ...provider, search }], reader: reader() }, { signal: caller.signal })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    expect(search).not.toHaveBeenCalled()
  })

  it('stops after the current page when caller aborts; ignores its late success', async () => {
    const caller = new AbortController()
    let complete!: (document: ReadDocument) => void
    let started!: () => void
    const startedReading = new Promise<void>(resolve => { started = resolve })
    const read = vi.fn((url: string) => new Promise<ReadDocument>(resolve => { complete = resolve; started(); void url }))
    const pending = researchQuestion('洛伦兹力', { providers: [provider], reader: { read } }, { signal: caller.signal, readLimit: 3 }).catch(error => error)
    await startedReading
    caller.abort()
    expect((await pending).code).toBe('RESEARCH_CANCELLED')
    complete(documentOf(hits[0]!.url))
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not swallow a reader AbortError and continue to another page', async () => {
    const read = vi.fn(async (_url: string) => { throw new DOMException('raw reason', 'AbortError') })
    await expect(researchQuestion('力', { providers: [provider], reader: { read } }, { readLimit: 3 })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('shares budget across search and all pages instead of renewing it for every page', async () => {
    vi.useFakeTimers()
    const deadlines: number[] = []
    const budgets: number[] = []
    const p: SearchProvider = { ...provider, async search(_query, options) { deadlines.push(options.deadlineAt!); await new Promise(resolve => setTimeout(resolve, 30)); return hits } }
    const read = vi.fn(async (url: string, options?: import('../src/index.ts').ReadOptions) => {
      deadlines.push(options!.deadlineAt!)
      budgets.push(options!.timeoutMs!)
      await new Promise(resolve => setTimeout(resolve, 45))
      return documentOf(url)
    })
    const pending = researchQuestion('力', { providers: [p], reader: { read } }, { timeoutMs: 100, readLimit: 3 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(101)
    expect((await pending).code).toBe('RESEARCH_TIMEOUT')
    expect(read).toHaveBeenCalledTimes(2)
    expect(new Set(deadlines).size).toBe(1)
    expect(budgets[0]).toBeLessThanOrEqual(70)
    expect(budgets[1]).toBeLessThanOrEqual(25)
    await vi.advanceTimersByTimeAsync(50)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('ordinary FETCH_TIMEOUT is a snippet downgrade, unlike round timeout/cancel', async () => {
    const result = await researchQuestion('力', { providers: [provider], reader: { async read() { throw new ResearchError('FETCH_TIMEOUT', 'timeout') } } }, { readLimit: 1, limit: 1 })
    expect(result.sources[0]?.depth).toBe('snippet')
    expect(result.diagnostics[0]?.code).toBe('FETCH_TIMEOUT')
  })
})

describe('scoped citations', () => {
  it('preserves display s1 while rejecting fabricated and cross-round opaque handles', async () => {
    const first = await researchQuestion('洛伦兹力', { providers: [provider], reader: reader() }, { limit: 1, readLimit: 0 })
    const second = await researchQuestion('洛伦兹力', { providers: [provider], reader: reader() }, { limit: 1, readLimit: 0 })
    const source = first.sources[0]!
    expect(resolveCitation(first, 's1')).toBe(source)
    expect(resolveCitation(first, source.citationId)).toBe(source)
    expect(resolveCitation(first, { researchId: first.researchId, sourceId: 's1' })).toBe(source)
    expect(resolveCitation(first, { researchId: first.researchId, citationId: source.citationId })).toBe(source)
    expect(first.researchId).not.toBe(second.researchId)
    expect(first.sources[0]?.sourceKey).toBe(second.sources[0]?.sourceKey)
    expect(() => resolveCitation(second, source.citationId)).toThrowError(expect.objectContaining({ code: 'INVALID_CITATION' }))
    expect(() => resolveCitation(second, { researchId: first.researchId, sourceId: 's1' })).toThrowError(expect.objectContaining({ code: 'INVALID_CITATION' }))
    expect(() => resolveCitation(second, 's1', first.researchId)).toThrowError(expect.objectContaining({ code: 'INVALID_CITATION' }))
    for (const invalid of ['s99', { url: 'https://evil.example' }, { researchId: first.researchId, sourceId: 's1', citationId: source.citationId }]) expect(() => resolveCitation(first, invalid)).toThrowError(expect.objectContaining({ code: 'INVALID_CITATION' }))
  })

  it('uses URL identity independent of rank and hashes the actual snippet content', async () => {
    const first = await researchQuestion('力', { providers: [provider], reader: reader() }, { readLimit: 0 })
    const reversed: SearchProvider = { ...provider, async search() { return [...hits].reverse() } }
    const second = await researchQuestion('力', { providers: [reversed], reader: reader() }, { readLimit: 0 })
    const a = first.sources.find(source => source.url === hits[0]!.url)!
    const b = second.sources.find(source => source.url === hits[0]!.url)!
    expect(a.sourceId).not.toBe(b.sourceId)
    expect(a.sourceKey).toBe(b.sourceKey)
    expect(a.contentSha256).toBe(hash(hits[0]!.snippet))
    expect(a.citationId).not.toBe(b.citationId)
  })
})

describe('excerptOf', () => {
  it('prefers query terms and bounds text without inventing evidence', () => {
    expect(excerptOf('无关段落。\n\n斜面倾角越大，滑块的加速度越大。', '斜面 加速度', 40)).toBe('斜面倾角越大，滑块的加速度越大。')
    expect(excerptOf('只有一段文字。', '不存在', 4)).toBe('只有一段')
  })
})
