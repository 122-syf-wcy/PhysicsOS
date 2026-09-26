/**
 * Minimal in-memory domain stand-in.
 *
 * The real domain is exercised by the vendor composition suite; these specs
 * care about the pool's own decisions, so the fake implements exactly the
 * table surface the store and routes touch.
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { modelPoolDomain } from '../src/domain.ts'

const makeTable = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string): T | undefined => map.get(id),
    put: async (id: string, record: T): Promise<void> => { map.set(id, record) },
    update: async (id: string, fn: (current: T) => T): Promise<T> => {
      const current = map.get(id)
      if (current === undefined) throw new Error(`missing key: ${id}`)
      const next = fn(current)
      map.set(id, next)
      return next
    },
    delete: async (id: string): Promise<boolean> => map.delete(id),
    entries: (): IterableIterator<[string, T]> => map.entries(),
    keys: (): IterableIterator<string> => map.keys(),
    get size(): number { return map.size },
  }
}

/** A domain over the pool spec, backed by maps. */
export const makeDomain = (): Domain<typeof modelPoolDomain> => {
  const tables = new Map<string, ReturnType<typeof makeTable<unknown>>>()
  return {
    name: 'physicsos_model_pool',
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = makeTable<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as Domain<typeof modelPoolDomain>
}
