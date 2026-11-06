/**
 * Minimal in-memory domain stand-in.
 *
 * The real domain is exercised by the vendor composition suite; these specs
 * care about the pool's own decisions, so the fake implements exactly the
 * table surface the store and routes touch.
 */
import { DomainError, type Domain } from '@deepseek-ai/dsh-storage-domain'
import type { modelPoolDomain } from '../src/domain.ts'

const makeTable = <T>(enqueue: <R>(job: () => R) => Promise<R>) => {
  const map = new Map<string, T>()
  return {
    get: (id: string): T | undefined => map.get(id),
    put: (id: string, record: T): Promise<void> => enqueue(() => { map.set(id, record) }),
    update: (id: string, fn: (current: T) => T): Promise<T> => enqueue(() => {
      const current = map.get(id)
      if (current === undefined) throw new DomainError('missing-key', `missing key: ${id}`)
      const next = fn(current)
      map.set(id, next)
      return next
    }),
    delete: (id: string): Promise<boolean> => enqueue(() => map.delete(id)),
    entries: (): IterableIterator<[string, T]> => map.entries(),
    keys: (): IterableIterator<string> => map.keys(),
    get size(): number { return map.size },
  }
}

/** A domain over the pool spec, backed by maps. */
export const makeDomain = (): Domain<typeof modelPoolDomain> => {
  const tables = new Map<string, ReturnType<typeof makeTable<unknown>>>()
  // Match production: reads see the last durable snapshot; writes and update
  // callbacks run in one domain queue, after the initiating call returns.
  let tail = Promise.resolve()
  const enqueue = <R>(job: () => R): Promise<R> => {
    const result = tail.then(job)
    tail = result.then(() => {}, () => {})
    return result
  }
  return {
    name: 'physicsos_model_pool',
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = makeTable<unknown>(enqueue)
      tables.set(name, created)
      return created as never
    },
  } as unknown as Domain<typeof modelPoolDomain>
}
