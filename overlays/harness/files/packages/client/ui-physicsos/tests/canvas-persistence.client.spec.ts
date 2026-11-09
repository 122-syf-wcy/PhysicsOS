import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createMagneticScene } from '@physicsos/physics-scene'
import { createManifest, createSceneObject } from '@physicsos/physics-workbench/codec'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import type { CanvasHead } from '@physicsos/physics-workbench/protocol'
import { readLocalCanvasRecord, readPendingMutation } from '../src/client/canvas/cache-codec.ts'
import { CanvasCacheConflict, createCanvasPersistence, type CanvasPersistence, type LocalCanvasRecord } from '../src/client/canvas/persistence.ts'

const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')
const now = '2026-11-08T10:00:00.000Z'
const stores: CanvasPersistence[] = []
const connections: IDBPDatabase[] = []
const names = new Set<string>()
const localRecord = (namespace = 'A|school', id = 'document'): LocalCanvasRecord => ({
  namespace, id, cacheVersion: 0, editSequence: 1, acknowledgedSequence: 0,
  working: createManifest({ id, title: 'Draft', now }), deleted: false, savedAt: now,
})
const database = () => {
  const name = `physicsos-canvas-persistence-${randomUUID()}`
  names.add(name)
  const store = createCanvasPersistence({ name, hash })
  stores.push(store)
  return { name, store }
}
const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close()
  await Promise.all(stores.splice(0).map(store => store.close()))
  await Promise.all([...names].map(name => deleteDB(name)))
  names.clear()
})

describe('canvas durable cache schema', () => {
  it('rejects unknown persisted fields and validates head, conflict, sequences and exact sealed bodies', async () => {
    const record = localRecord()
    expect(() => readLocalCanvasRecord({ ...record, runtime: () => undefined }, record.namespace)).toThrow()
    expect(() => readLocalCanvasRecord({ ...record, acknowledgedSequence: 2 }, record.namespace)).toThrow()
    expect(() => readLocalCanvasRecord({ ...record, namespace: 'B|school' }, record.namespace)).toThrow()
    const request = { id: record.id, title: record.working.title, mutationId: 'mutation-create' }
    const pending = readPendingMutation({ kind: 'create', request, body: canonicalStringify(request),
      bodyDigest: await hash(request), createdAt: now, editSequence: 1 }, record.id)
    expect(readLocalCanvasRecord({ ...record, pending }, record.namespace).pending).toEqual(pending)
    expect(() => readLocalCanvasRecord({ ...record, pending: { ...pending, body: '{}' } }, record.namespace)).toThrow()
    expect(() => readLocalCanvasRecord({ ...record, pending: { ...pending, request: { ...request, ownerId: 'B' } } }, record.namespace)).toThrow()
    const head: CanvasHead = { id: record.id, title: record.working.title, version: 1, generation: 1, changeSeq: 1,
      manifestDigest: await hash(record.working), createdAt: now, updatedAt: now }
    expect(() => readLocalCanvasRecord({ ...record, head }, record.namespace)).toThrow()
    expect(() => readLocalCanvasRecord({ ...record, head: { ...head, version: '1' }, base: record.working }, record.namespace)).toThrow()
    expect(() => readLocalCanvasRecord({ ...record, head, base: record.working, conflict: {
      base: record.working, local: record.working, remote: { head: { ...head, id: 'other' }, manifest: record.working }, conflicts: [],
    } }, record.namespace)).toThrow()
    expect(() => readLocalCanvasRecord({ ...record, head, base: record.working, conflict: {
      base: record.working, local: record.working, remote: { head, manifest: record.working },
      conflicts: [{ path: '/title', kind: 'made-up', message: 'bad' }],
    } }, record.namespace)).toThrow()
  })

  it('rejects altered sealed hashes and mismatched base content before starting a write transaction', async () => {
    const { store } = database()
    const record = localRecord()
    const request = { id: record.id, title: record.working.title, mutationId: 'mutation-create' }
    const pending = readPendingMutation({ kind: 'create', request, body: canonicalStringify(request),
      bodyDigest: await hash({ different: true }), createdAt: now, editSequence: 1 }, record.id)
    await expect(store.save({ ...record, pending })).rejects.toThrow('SHA256')
    expect(await store.read(record.namespace, record.id)).toBeUndefined()
    const head: CanvasHead = { id: record.id, title: record.working.title, version: 1, generation: 1, changeSeq: 1,
      manifestDigest: await hash({ unrelated: true }), createdAt: now, updatedAt: now }
    await expect(store.save({ ...record, head, base: record.working })).rejects.toThrow('base')
    expect(await store.list(record.namespace)).toHaveLength(0)
  })

  it('reads IndexedDB records through validation rather than trusting stored TypeScript shapes', async () => {
    const { store, name } = database()
    const record = localRecord()
    await store.save(record)
    const raw = await openDB(name, 1)
    connections.push(raw)
    await raw.put('documents', { ...record, cacheVersion: 1, poisonedField: true }, `${record.namespace}\u0000${record.id}`)
    await expect(store.read(record.namespace, record.id)).rejects.toThrow('Unexpected field')
    await expect(store.list(record.namespace)).rejects.toThrow('Unexpected field')
  })
})

describe('canvas cache transactions and account partitioning', () => {
  it('isolates documents, objects, outbox and preferences by user and school', async () => {
    const { store } = database()
    const scene = createSceneObject(createMagneticScene())
    const digest = await hash(scene)
    const a = await store.save(localRecord('A|school', 'same'), { [digest]: scene })
    const b = await store.save({ ...localRecord('B|school', 'same'), working: createManifest({ id: 'same', title: 'B draft', now }) })
    await store.setPreference('A|school', 'changes-cursor', '8')
    expect((await store.list('A|school')).map(record => record.working.title)).toEqual(['Draft'])
    expect((await store.list('B|school')).map(record => record.working.title)).toEqual(['B draft'])
    expect(await store.objects('A|school', 'same')).toEqual({ [digest]: scene })
    expect(await store.objects('B|school', 'same')).toEqual({})
    expect(await store.getPreference('B|school', 'changes-cursor')).toBeUndefined()
    await store.remove('A|school', 'same', a.cacheVersion)
    expect(await store.read('A|school', 'same')).toBeUndefined()
    expect(await store.objects('A|school', 'same')).toEqual({})
    expect(await store.read('B|school', 'same')).toEqual(b)
    expect(await store.list('A|another-school')).toHaveLength(0)
  })

  it('uses cache CAS independently from edit and acknowledgement counters across connections', async () => {
    const { store: first, name } = database()
    const second = createCanvasPersistence({ name, hash }); stores.push(second)
    const start = await first.save(localRecord())
    const result = await Promise.allSettled([
      first.save({ ...start, working: { ...start.working, title: 'First' }, editSequence: 2 }, {}, start.cacheVersion),
      second.save({ ...start, working: { ...start.working, title: 'Second' }, editSequence: 2 }, {}, start.cacheVersion),
    ])
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = result.find(item => item.status === 'rejected')
    if (rejected?.status !== 'rejected') throw new Error('The stale local writer must be rejected.')
    expect(rejected.reason).toBeInstanceOf(CanvasCacheConflict)
    const stored = (await first.read(start.namespace, start.id))!
    expect(stored.cacheVersion).toBe(start.cacheVersion + 1)
    expect(stored.editSequence).toBe(2)
    expect(stored.acknowledgedSequence).toBe(0)
    await expect(second.remove(start.namespace, start.id, start.cacheVersion)).rejects.toBeInstanceOf(CanvasCacheConflict)
  })

  it('publishes local Saved only after tx.done and rolls document and object writes back together on abort', async () => {
    const { store, name } = database()
    const start = await store.save(localRecord())
    const raw = await openDB(name, 1); connections.push(raw)
    const tx = raw.transaction(['documents', 'objects'], 'readwrite')
    const aborted = expect(tx.done).rejects.toThrow()
    const documentKey = `${start.namespace}\u0000${start.id}`
    await tx.objectStore('documents').put({ ...start, cacheVersion: 2, working: { ...start.working, title: 'Never committed' } }, documentKey)
    await tx.objectStore('objects').put({ key: 'orphan', document: documentKey, namespace: start.namespace,
      hash: 'invalid', value: { invalid: true } }, 'orphan')
    tx.abort()
    await aborted
    expect((await store.read(start.namespace, start.id))!.working.title).toBe('Draft')
    expect(await store.objects(start.namespace, start.id)).toEqual({})
    const scene = createSceneObject(createMagneticScene())
    await expect(store.save({ ...start, working: { ...start.working, title: 'Invalid object write' } },
      { [await hash({ invalid: true })]: scene })).rejects.toThrow('digest')
    expect((await store.read(start.namespace, start.id))!.working.title).toBe('Draft')
    const completed = await store.save({ ...start, working: { ...start.working, title: 'Committed' }, editSequence: 2 })
    const verification = await raw.get('documents', documentKey)
    expect(verification).toEqual(completed)
  })
})

describe('canvas database connection lifetime', () => {
  it('rejects a blocked open without hanging and closes its delayed connection once the blocker leaves', async () => {
    const name = `physicsos-canvas-blocked-${randomUUID()}`; names.add(name)
    const blocker = await openDB(name, 1, { upgrade: db => { db.createObjectStore('documents') } })
    connections.push(blocker)
    const blocked = deferred<unknown>()
    const store = createCanvasPersistence({ name, version: 2, hash, onUnavailable: error => blocked.resolve(error) }); stores.push(store)
    const loading = store.list('A|school')
    const rejection = expect(loading).rejects.toThrow('LOCAL_STORE_BLOCKED')
    const error = await blocked.promise
    expect(error).toBeInstanceOf(Error)
    await rejection
    blocker.close()
    await store.close()
    // A pending open that later succeeds must close itself, otherwise this upgrade stays blocked.
    const upgraded = await openDB(name, 3)
    connections.push(upgraded)
    upgraded.close()
  })

  it('closes on versionchange and refuses further operations after dispose', async () => {
    const name = `physicsos-canvas-version-${randomUUID()}`; names.add(name)
    const unavailable = deferred<unknown>()
    const store = createCanvasPersistence({ name, hash, onUnavailable: error => unavailable.resolve(error) }); stores.push(store)
    await store.save(localRecord())
    const upgrade = openDB(name, 2)
    const error = await unavailable.promise
    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : '').toBe('LOCAL_STORE_VERSION_CHANGED')
    const changed = await upgrade
    connections.push(changed)
    changed.close()
    await store.close()
    await expect(store.read('A|school', 'document')).rejects.toThrow('LOCAL_STORE_CLOSED')
    await expect(store.save(localRecord())).rejects.toThrow('LOCAL_STORE_CLOSED')
    await store.close()
  })
})
