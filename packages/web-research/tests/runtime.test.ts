import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResearchRuntime, ResearchError, type PageReader, type ResearchRuntime, type SearchHit, type SearchProvider } from '../src/index.ts'

const hit: SearchHit = { title: '公开物理资料', url: 'https://science.example.com/physics', snippet: 'F = ma' }
const tick = async (): Promise<void> => { for (let index = 0; index < 30; index++) await Promise.resolve() }
const neverRead: PageReader = { async read() { throw new Error('unexpected read') } }
const runtimes: ResearchRuntime[] = []
const make = (providers: readonly SearchProvider[], config: Parameters<typeof createResearchRuntime>[1] = {}, dependencies: Partial<Parameters<typeof createResearchRuntime>[0]> = {}): ResearchRuntime => {
  const runtime = createResearchRuntime({ providers, reader: neverRead, ...dependencies }, { ...config, readLimit: config?.readLimit ?? 0 })
  runtimes.push(runtime)
  return runtime
}
const gateProvider = (): { provider: SearchProvider; complete: Map<string, (hits: readonly SearchHit[]) => void>; signals: Map<string, AbortSignal>; calls: string[] } => {
  const complete = new Map<string, (hits: readonly SearchHit[]) => void>()
  const signals = new Map<string, AbortSignal>()
  const calls: string[] = []
  const provider: SearchProvider = {
    name: 'gate', providesContent: false,
    search(query, options) {
      calls.push(query)
      signals.set(query, options.signal!)
      return new Promise(resolve => { complete.set(query, resolve) })
    },
  }
  return { provider, complete, signals, calls }
}
afterEach(async () => { for (const runtime of runtimes.splice(0)) runtime.dispose(); await tick(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('bounded TTL/LRU research cache', () => {
  it('reuses evidence without refreshing research identity/timestamps, returns isolated values', async () => {
    let clock = 1_000
    const search = vi.fn(async () => [hit])
    const runtime = make([{ name: 'test', providesContent: false, search }], { cacheTtlMs: 100 }, { clock: () => clock, now: () => new Date('2026-11-16T00:00:00Z') })
    const first = await runtime.research('  力   加速度 ')
    ;(first.sources[0] as unknown as { title: string }).title = 'caller mutation'
    clock = 1_050
    const cached = await runtime.research('力 加速度')
    expect(search).toHaveBeenCalledTimes(1)
    expect(cached.sources[0]?.title).toBe(hit.title)
    expect(cached.researchId).toBe(first.researchId)
    expect(cached.searchedAt).toBe(first.searchedAt)
    expect(cached.sources[0]?.fetchedAt).toBe(first.sources[0]?.fetchedAt)
    expect(cached.sources[0]?.contentSha256).toBe(first.sources[0]?.contentSha256)
    clock = 1_101
    const refreshed = await runtime.research('力 加速度')
    expect(search).toHaveBeenCalledTimes(2)
    expect(refreshed.researchId).not.toBe(first.researchId)
    expect(runtime.stats().cacheEntries).toBe(1)
  })

  it('evicts least-recently-used entries, with no sliding expiry', async () => {
    let clock = 1_000
    const search = vi.fn(async () => [hit])
    const runtime = make([{ name: 'test', providesContent: false, search }], { cacheMaxEntries: 2, cacheTtlMs: 100 }, { clock: () => clock })
    await runtime.research('a')
    await runtime.research('b')
    clock = 1_050
    await runtime.research('a')
    await runtime.research('c')
    expect(runtime.stats().cacheEntries).toBe(2)
    await runtime.research('b')
    expect(search).toHaveBeenCalledTimes(4)
    clock = 1_101
    await runtime.research('a')
    expect(search).toHaveBeenCalledTimes(5)
  })

  it('bounds bytes and permits explicit disabling', async () => {
    const search = vi.fn(async () => [hit])
    const provider: SearchProvider = { name: 'test', providesContent: false, search }
    const runtime = make([provider], { cacheMaxBytes: 1 })
    await runtime.research('力')
    await runtime.research('力')
    expect(search).toHaveBeenCalledTimes(2)
    expect(runtime.stats().cacheBytes).toBe(0)
    const disabled = make([provider], { cacheTtlMs: 0 })
    await disabled.research('力')
    await disabled.research('力')
    expect(disabled.stats().cacheEntries).toBe(0)
    expect(search).toHaveBeenCalledTimes(4)
  })

  it('keeps read:false separate from full-text cache, and does not rewrite document fetchedAt', async () => {
    const search = vi.fn(async () => [hit])
    const read = vi.fn(async (url: string) => ({ url, title: '正文', text: 'Actual page evidence.', fetchedAt: '2026-11-10T00:00:00Z', contentType: 'text/plain' }))
    const runtime = make([{ name: 'test', providesContent: false, search }], { readLimit: 1 }, { reader: { read } })
    const snippet = await runtime.research('力', undefined, { read: false })
    const full = await runtime.research('力')
    const cached = await runtime.research('力', undefined, { read: true })
    expect(search).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(1)
    expect(snippet.sources[0]?.depth).toBe('snippet')
    expect(full.sources[0]?.depth).toBe('full-text')
    expect(cached.researchId).toBe(full.researchId)
    expect(cached.sources[0]?.fetchedAt).toBe('2026-11-10T00:00:00Z')
  })

  it('never caches failure, authoritative empty results, or a degraded fallback/read', async () => {
    const failed = vi.fn(async () => { throw new ResearchError('SEARCH_RATE_LIMITED', 'raw') })
    const errors = make([{ name: 'error', providesContent: false, search: failed }])
    for (let index = 0; index < 2; index++) await expect(errors.research('力')).rejects.toMatchObject({ code: 'SEARCH_RATE_LIMITED' })
    expect(failed).toHaveBeenCalledTimes(2)
    const empty = vi.fn(async () => [])
    const noResults = make([{ name: 'empty', providesContent: false, search: empty }])
    for (let index = 0; index < 2; index++) await expect(noResults.research('力')).rejects.toMatchObject({ code: 'NO_RESULTS' })
    expect(empty).toHaveBeenCalledTimes(2)
    const fallback = vi.fn(async () => [hit])
    const degraded = make([{ name: 'error', providesContent: false, search: failed }, { name: 'fallback', providesContent: false, search: fallback }])
    expect((await degraded.research('力')).degraded).toBe(true)
    expect((await degraded.research('力')).degraded).toBe(true)
    expect(fallback).toHaveBeenCalledTimes(2)
    const read = vi.fn(async (_url: string) => { throw new ResearchError('FETCH_UNAVAILABLE', 'raw') })
    const readFailure = make([{ name: 'test', providesContent: false, search: fallback }], { readLimit: 1 }, { reader: { read } })
    await readFailure.research('力')
    await readFailure.research('力')
    expect(read).toHaveBeenCalledTimes(2)
    expect(readFailure.stats().cacheEntries).toBe(0)
  })
})

describe('singleflight cancellation isolation', () => {
  it('coalesces identical requests and first-waiter cancellation does not abort others', async () => {
    const gate = gateProvider()
    const runtime = make([gate.provider])
    const caller = new AbortController()
    const first = runtime.research('力', caller.signal).catch(error => error)
    const second = runtime.research('力')
    await tick()
    expect(gate.calls).toEqual(['力'])
    expect(runtime.stats().waiters).toBe(2)
    caller.abort(new Error('private abort reason'))
    expect((await first).code).toBe('RESEARCH_CANCELLED')
    expect(gate.signals.get('力')?.aborted).toBe(false)
    gate.complete.get('力')!([hit])
    expect((await second).sources).toHaveLength(1)
    await tick()
    expect(runtime.stats().waiters).toBe(0)
    expect(runtime.stats().cacheEntries).toBe(1)
  })

  it('later waiter cancellation also leaves the original request untouched', async () => {
    const gate = gateProvider()
    const runtime = make([gate.provider])
    const caller = new AbortController()
    const first = runtime.research('力')
    const second = runtime.research('力', caller.signal).catch(error => error)
    await tick()
    caller.abort()
    expect((await second).code).toBe('RESEARCH_CANCELLED')
    expect(gate.signals.get('力')?.aborted).toBe(false)
    gate.complete.get('力')!([hit])
    expect((await first).sources).toHaveLength(1)
  })

  it('all cancelled waiters abort shared work, discard late success and hold capacity for uncooperative work', async () => {
    const gate = gateProvider()
    const runtime = make([gate.provider], { maxConcurrent: 1, maxQueued: 1 })
    const a = new AbortController()
    const b = new AbortController()
    const first = runtime.research('abandoned', a.signal).catch(error => error)
    const second = runtime.research('abandoned', b.signal).catch(error => error)
    await tick()
    a.abort()
    b.abort()
    expect((await first).code).toBe('RESEARCH_CANCELLED')
    expect((await second).code).toBe('RESEARCH_CANCELLED')
    expect(gate.signals.get('abandoned')?.aborted).toBe(true)
    const next = runtime.research('next')
    await tick()
    expect(gate.calls).toEqual(['abandoned'])
    expect(runtime.stats().active).toBe(1)
    gate.complete.get('abandoned')!([hit])
    await tick()
    expect(runtime.stats().cacheEntries).toBe(0)
    expect(gate.calls).toEqual(['abandoned', 'next'])
    gate.complete.get('next')!([hit])
    await next
  })

  it('bounds the number of waiters on one flight and removes caller listeners', async () => {
    const gate = gateProvider()
    const runtime = make([gate.provider], { maxWaitersPerFlight: 2 })
    const caller = new AbortController()
    const add = vi.spyOn(caller.signal, 'addEventListener')
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    const first = runtime.research('力', caller.signal)
    const second = runtime.research('力')
    await expect(runtime.research('力')).rejects.toMatchObject({ code: 'RESEARCH_BUSY' })
    await tick()
    gate.complete.get('力')!([hit])
    await Promise.all([first, second])
    expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(add.mock.calls.filter(([event]) => event === 'abort').length)
  })
})

describe('FIFO admission, deadlines and service disposal', () => {
  it('bounds concurrency/queue, preserves FIFO and does not launch a cancelled queued request', async () => {
    const gate = gateProvider()
    const runtime = make([gate.provider], { maxConcurrent: 1, maxQueued: 2 })
    const first = runtime.research('first')
    const cancelled = new AbortController()
    const second = runtime.research('second', cancelled.signal).catch(error => error)
    const third = runtime.research('third')
    await tick()
    expect(gate.calls).toEqual(['first'])
    expect(runtime.stats().queued).toBe(2)
    await expect(runtime.research('overflow')).rejects.toMatchObject({ code: 'RESEARCH_BUSY' })
    cancelled.abort()
    expect((await second).code).toBe('RESEARCH_CANCELLED')
    gate.complete.get('first')!([hit])
    await first
    await tick()
    expect(gate.calls).toEqual(['first', 'third'])
    gate.complete.get('third')!([hit])
    await third
    await tick()
    expect(runtime.stats().active).toBe(0)
  })

  it('includes queued time in the deadline and discards all work after timeout', async () => {
    vi.useFakeTimers()
    const gate = gateProvider()
    const runtime = make([gate.provider], { maxConcurrent: 1, timeoutMs: 30 })
    const first = runtime.research('first').catch(error => error)
    const second = runtime.research('second').catch(error => error)
    await vi.advanceTimersByTimeAsync(31)
    expect((await first).code).toBe('RESEARCH_TIMEOUT')
    expect((await second).code).toBe('RESEARCH_TIMEOUT')
    expect(gate.calls).toEqual(['first'])
    expect(gate.signals.get('first')?.aborted).toBe(true)
    gate.complete.get('first')!([hit])
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.stats().cacheEntries).toBe(0)
    expect(runtime.stats().queued).toBe(0)
  })

  it('dispose aborts every waiter/work and clears cache/queue; late results never repopulate', async () => {
    const gate = gateProvider()
    const runtime = make([gate.provider], { maxConcurrent: 1 })
    const first = runtime.research('first').catch(error => error)
    const same = runtime.research('first').catch(error => error)
    const queued = runtime.research('queued').catch(error => error)
    await tick()
    runtime.dispose()
    runtime.dispose()
    expect((await first).code).toBe('RESEARCH_CANCELLED')
    expect((await same).code).toBe('RESEARCH_CANCELLED')
    expect((await queued).code).toBe('RESEARCH_CANCELLED')
    expect(gate.signals.get('first')?.aborted).toBe(true)
    expect(runtime.stats()).toMatchObject({ queued: 0, inFlight: 0, waiters: 0, cacheEntries: 0, cacheBytes: 0 })
    await expect(runtime.research('later')).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    gate.complete.get('first')!([hit])
    await tick()
    expect(runtime.stats().active).toBe(0)
    expect(gate.calls).toEqual(['first'])
    const cached = make([{ name: 'test', providesContent: false, async search() { return [hit] } }])
    await cached.research('cached')
    expect(cached.stats().cacheEntries).toBe(1)
    cached.dispose()
    expect(cached.stats().cacheEntries).toBe(0)
  })

  it('a pre-aborted caller cannot consume a cache hit or launch new work; stats contain only counts', async () => {
    const search = vi.fn(async () => [hit])
    const runtime = make([{ name: 'test', providesContent: false, search }])
    await runtime.research('private-query')
    const caller = new AbortController()
    caller.abort()
    await expect(runtime.research('private-query', caller.signal)).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    expect(search).toHaveBeenCalledTimes(1)
    expect(Object.values(runtime.stats()).every(value => typeof value === 'number')).toBe(true)
    expect(JSON.stringify(runtime.stats())).not.toContain('private-query')
  })
})
