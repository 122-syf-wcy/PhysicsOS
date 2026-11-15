import { createHash } from 'node:crypto'
import { abortFailure, boundedInteger, createOperation, DEFAULT_RESEARCH_TIMEOUT_MS, failure, type Operation } from './operation.ts'
import { researchQuestion, type ResearchDependencies } from './research.ts'
import { normalizeResearchQuery } from './search.ts'
import type { ReadOptions, ResearchResult, SearchOptions } from './types.ts'

export interface ResearchRuntimeConfig {
  readonly limit?: number
  readonly readLimit?: number
  readonly timeoutMs?: number
  readonly maxConcurrent?: number
  readonly maxQueued?: number
  readonly maxWaitersPerFlight?: number
  readonly cacheTtlMs?: number
  readonly cacheMaxEntries?: number
  readonly cacheMaxBytes?: number
}

export interface ResearchRuntimeDependencies extends ResearchDependencies {
  readonly now?: () => Date
  /** TTL clock only; useful for pure cache tests without sleeping. */
  readonly clock?: () => number
}

export interface ResearchRuntime {
  research(query: string, signal?: AbortSignal, options?: { readonly read?: boolean }): Promise<ResearchResult>
  /** Abort all waiters/work, clear cache/queue, and refuse subsequent requests. */
  dispose(): void
  /** Counts only. Never exposes keys, queries, credentials or transport errors. */
  stats(): { readonly active: number; readonly queued: number; readonly inFlight: number; readonly waiters: number; readonly cacheEntries: number; readonly cacheBytes: number }
}

interface CacheEntry { readonly json: string; readonly expiresAt: number; readonly bytes: number }
interface Waiter {
  readonly operation: Operation
  readonly resolve: (result: ResearchResult) => void
  readonly reject: (error: unknown) => void
  readonly onAbort: () => void
}
interface Flight {
  readonly key: string
  readonly operation: Operation
  readonly waiters: Set<Waiter>
  readonly pendingWork: Set<Promise<unknown>>
  readonly work: () => Promise<ResearchResult>
  readonly onAbort: () => void
  state: 'queued' | 'running' | 'cancelled' | 'done'
}

const cloneResult = (result: ResearchResult): ResearchResult => JSON.parse(JSON.stringify(result)) as ResearchResult

/**
 * A per-service, bounded TTL/LRU cache + singleflight + FIFO admission queue.
 * No services, retries, background refreshes or query/credential logs. Cache
 * keys are opaque hashes and cached values omit the caller's query. All callers
 * get isolated values; cached evidence retains its original identity/timestamps.
 */
export function createResearchRuntime(dependencies: ResearchRuntimeDependencies, config: ResearchRuntimeConfig = {}): ResearchRuntime {
  const limit = boundedInteger(config.limit, 5, 1, 10)
  const readLimit = boundedInteger(config.readLimit, 3, 0, limit)
  const timeoutMs = boundedInteger(config.timeoutMs, DEFAULT_RESEARCH_TIMEOUT_MS, 1, 120_000)
  const maxConcurrent = boundedInteger(config.maxConcurrent, 2, 1, 8)
  const maxQueued = boundedInteger(config.maxQueued, 16, 0, 64)
  const maxWaiters = boundedInteger(config.maxWaitersPerFlight, 32, 1, 128)
  const ttl = boundedInteger(config.cacheTtlMs, 60_000, 0, 300_000)
  const cacheMaxEntries = boundedInteger(config.cacheMaxEntries, 32, 0, 256)
  const cacheMaxBytes = boundedInteger(config.cacheMaxBytes, 2_097_152, 0, 8_388_608)
  const clock = dependencies.clock ?? Date.now
  const cache = new Map<string, CacheEntry>()
  const flights = new Map<string, Flight>()
  const running = new Set<Flight>()
  const queue: Flight[] = []
  let cacheBytes = 0
  let active = 0
  let disposed = false

  // Even if an injected provider/reader ignores abort, keep its flight's slot
  // occupied until that underlying promise settles. No unbounded orphan work.
  const track = <T>(flight: Flight, work: () => Promise<T>): Promise<T> => {
    flight.operation.check()
    let pending: Promise<T>
    try { pending = Promise.resolve(work()) } catch (error) { return Promise.reject(error) }
    flight.pendingWork.add(pending)
    void pending.then(() => { flight.pendingWork.delete(pending) }, () => { flight.pendingWork.delete(pending) })
    return pending
  }
  const waitForPending = async (flight: Flight): Promise<void> => {
    while (flight.pendingWork.size > 0) await Promise.allSettled([...flight.pendingWork])
  }

  const removeCache = (key: string): void => {
    const entry = cache.get(key)
    if (entry === undefined) return
    cacheBytes -= entry.bytes
    cache.delete(key)
  }
  const pruneCache = (): void => {
    const now = clock()
    for (const [key, entry] of cache) if (entry.expiresAt <= now) removeCache(key)
  }
  const getCache = (key: string, query: string): ResearchResult | undefined => {
    pruneCache()
    const entry = cache.get(key)
    if (entry === undefined) return undefined
    cache.delete(key)
    cache.set(key, entry) // LRU touch, not a TTL/timestamp refresh
    return { ...JSON.parse(entry.json) as Omit<ResearchResult, 'query'>, query }
  }
  const putCache = (key: string, result: ResearchResult): void => {
    if (ttl === 0 || cacheMaxEntries === 0 || cacheMaxBytes === 0 || result.degraded || result.sources.length === 0) return
    const { query: _query, ...evidence } = result
    const json = JSON.stringify(evidence)
    const bytes = Buffer.byteLength(json) + key.length
    if (bytes > cacheMaxBytes) return
    pruneCache()
    removeCache(key)
    while (cache.size >= cacheMaxEntries || cacheBytes + bytes > cacheMaxBytes) {
      const oldest = cache.keys().next().value as string | undefined
      if (oldest === undefined) break
      removeCache(oldest)
    }
    cache.set(key, { json, bytes, expiresAt: clock() + ttl })
    cacheBytes += bytes
  }
  const detach = (flight: Flight, waiter: Waiter): void => {
    flight.waiters.delete(waiter)
    waiter.operation.signal.removeEventListener('abort', waiter.onAbort)
    waiter.operation.dispose()
  }
  const removeFlight = (flight: Flight): void => { if (flights.get(flight.key) === flight) flights.delete(flight.key) }
  const cancelFlight = (flight: Flight): void => {
    if (flight.state === 'done' || flight.state === 'cancelled') return
    const queued = flight.state === 'queued'
    flight.state = 'cancelled'
    removeFlight(flight)
    if (queued) {
      const index = queue.indexOf(flight)
      if (index >= 0) queue.splice(index, 1)
    }
    flight.operation.signal.removeEventListener('abort', flight.onAbort)
    flight.operation.cancel()
    flight.operation.dispose()
    // Running capacity is held until work actually settles, including faulty
    // injected promises, rather than launching unlimited replacement work.
  }
  const deliver = (flight: Flight, result: ResearchResult | undefined, error: unknown): void => {
    for (const waiter of [...flight.waiters]) {
      let outcome = error
      if (waiter.operation.signal.aborted) outcome = abortFailure(waiter.operation.signal)
      else {
        try { waiter.operation.check() } catch (deadlineError) { outcome = deadlineError }
      }
      detach(flight, waiter)
      if (outcome !== undefined) waiter.reject(outcome)
      else waiter.resolve(cloneResult(result!))
    }
  }
  const pump = (): void => {
    if (disposed) return
    while (active < maxConcurrent && queue.length > 0) {
      const flight = queue.shift()!
      if (flight.state !== 'queued' || flight.waiters.size === 0) continue
      flight.state = 'running'
      running.add(flight)
      active++
      // Attach rejection handling immediately; abandoned/late tasks are observed.
      void Promise.resolve().then(() => {
        flight.operation.check()
        return flight.work()
      }).then(result => {
        if (disposed || flight.state === 'cancelled') return
        removeFlight(flight) // A completed flight must never admit a new waiter.
        try {
          flight.operation.check()
          // Expired waiters are removed before cache admission. A flight that
          // has lost every waiter must not cache a late success.
          for (const waiter of [...flight.waiters]) {
            try { waiter.operation.check() } catch { /* onAbort detaches it. */ }
          }
          if (flight.waiters.size === 0 || flight.operation.signal.aborted) return
          putCache(flight.key, result)
          deliver(flight, result, undefined)
        } catch (error) { deliver(flight, undefined, error) }
      }, error => {
        removeFlight(flight)
        if (flight.state !== 'cancelled') deliver(flight, undefined, error)
      }).finally(async () => {
        flight.operation.signal.removeEventListener('abort', flight.onAbort)
        flight.operation.dispose()
        await waitForPending(flight)
        flight.state = 'done'
        flight.operation.signal.removeEventListener('abort', flight.onAbort)
        flight.operation.dispose()
        removeFlight(flight)
        running.delete(flight)
        active--
        pump()
      })
    }
  }

  const research = async (query: string, signal?: AbortSignal, options?: { readonly read?: boolean }): Promise<ResearchResult> => {
    const normalized = normalizeResearchQuery(query)
    const operation = createOperation({ timeoutMs, ...(signal === undefined ? {} : { signal }) }, timeoutMs, 'RESEARCH_TIMEOUT')
    let ownedByWaiter = false
    try {
      operation.check()
      if (disposed) throw failure('RESEARCH_CANCELLED')
      const reads = options?.read === false ? 0 : readLimit
      const key = createHash('sha256').update(JSON.stringify([normalized, limit, reads])).digest('hex')
      const cached = getCache(key, normalized)
      operation.check()
      if (cached !== undefined) return cached
      let flight = flights.get(key)
      if (flight === undefined) {
        if (active >= maxConcurrent && queue.length >= maxQueued) throw failure('RESEARCH_BUSY')
        // Shared work owns its signal. It is never linked to the first waiter's
        // abort signal, and time spent queued counts towards the round deadline.
        const shared = createOperation({ timeoutMs }, timeoutMs, 'RESEARCH_TIMEOUT')
        const created: Flight = {
          key, operation: shared, waiters: new Set(), pendingWork: new Set(), state: 'queued',
          work: () => researchQuestion(normalized, {
            providers: dependencies.providers.map(provider => ({
              name: provider.name, providesContent: provider.providesContent,
              search: (value: string, options: SearchOptions) => track(created, () => provider.search(value, options)),
              ...(provider.searchDetailed === undefined ? {} : { searchDetailed: (value: string, options: SearchOptions) => track(created, () => provider.searchDetailed!(value, options)) }),
            })),
            reader: { read: (url: string, options?: ReadOptions) => track(created, () => dependencies.reader.read(url, options)) },
          }, {
            limit, readLimit: reads, timeoutMs: shared.remaining(), deadlineAt: shared.deadlineAt, signal: shared.signal,
            ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
          }),
          onAbort: () => {
            if (created.state === 'done' || created.state === 'cancelled') return
            const error = abortFailure(shared.signal)
            cancelFlight(created)
            deliver(created, undefined, error)
            pump()
          },
        }
        shared.signal.addEventListener('abort', created.onAbort, { once: true })
        flight = created
        flights.set(key, flight)
        queue.push(flight)
      }
      if (flight.waiters.size >= maxWaiters) throw failure('RESEARCH_BUSY')
      const current = flight
      ownedByWaiter = true
      return await new Promise<ResearchResult>((resolve, reject) => {
        const waiter: Waiter = {
          operation, resolve, reject,
          onAbort: () => {
            if (!current.waiters.has(waiter)) return
            const error = abortFailure(operation.signal)
            detach(current, waiter)
            reject(error)
            if (current.waiters.size === 0) { cancelFlight(current); pump() }
          },
        }
        current.waiters.add(waiter)
        operation.signal.addEventListener('abort', waiter.onAbort, { once: true })
        if (operation.signal.aborted) waiter.onAbort()
        pump()
      })
    } finally { if (!ownedByWaiter) operation.dispose() }
  }

  return {
    research,
    dispose() {
      if (disposed) return
      disposed = true
      cache.clear()
      cacheBytes = 0
      for (const flight of new Set([...flights.values(), ...running])) {
        cancelFlight(flight)
        for (const waiter of [...flight.waiters]) { detach(flight, waiter); waiter.reject(failure('RESEARCH_CANCELLED')) }
      }
      queue.length = 0
      flights.clear()
    },
    stats() {
      pruneCache()
      return { active, queued: queue.length, inFlight: flights.size, waiters: [...flights.values()].reduce((sum, flight) => sum + flight.waiters.size, 0), cacheEntries: cache.size, cacheBytes }
    },
  }
}
