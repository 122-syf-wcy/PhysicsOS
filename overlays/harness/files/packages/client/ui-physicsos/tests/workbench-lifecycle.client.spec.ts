import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManifest } from '@physicsos/physics-workbench/codec'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { GRAPH_LIMITS } from '@physicsos/physics-workbench/graph'
import type { CanvasHead, CanvasOpenResponse, WorkbenchLifecycleCapabilities } from '@physicsos/physics-workbench/protocol'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { readCanvasHead, readLocalCanvasRecord, readPendingMutation } from '../src/client/canvas/cache-codec.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { canvasReadOnly, createCanvasPersistence, type CanvasPersistence, type LocalCanvasRecord } from '../src/client/canvas/persistence.ts'
import { createCanvasSynchronizer, type CanvasSynchronizer } from '../src/client/canvas/sync.ts'
import { createWhiteboardController, type WhiteboardDraft } from '../src/client/whiteboard/controller.ts'
import { createIndexedDbWhiteboardCache } from '../src/client/whiteboard/persistence.ts'
import { WhiteboardRequestError, whiteboardSummaryOf, type PendingWhiteboardLifecycle, type WhiteboardApi, type WhiteboardGeneration, type WhiteboardRecord } from '../src/client/whiteboard/api.ts'

const now = '2026-11-17T08:00:00.000Z'
const digest = async (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept }); return { promise, resolve } }
const controllers: { dispose(): unknown }[] = []; const stores: CanvasPersistence[] = []; const synchronizers: CanvasSynchronizer[] = []; const names: string[] = []
const enabled: WorkbenchLifecycleCapabilities = { schemaVersion: 1, lifecycleBridge: true, lifecycleWritesEnabled: true, archive: true, delete: true, restore: true, generationRequired: true }
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

async function canvasFixture() {
  const namespace = 'account|school'; let sequence = 1; let nextId = 0
  const manifest = createManifest({ id: 'canvas', title: 'Retained notes', now })
  let remote: CanvasOpenResponse = { manifest, head: { id: manifest.id, title: manifest.title, version: 1, generation: 1, changeSeq: 1,
    manifestDigest: await digest(manifest), createdAt: now, updatedAt: now } }
  const objects = new Map<string, unknown>([[remote.head.manifestDigest, remote.manifest]])
  const receipts = new Map<string, CanvasOpenResponse & { readonly replayed: boolean }>()
  const requests: { readonly method: string; readonly action: string; readonly body: Record<string, unknown> }[] = []
  let enabledWrites = true; let loseArchive = false; let waitArchive: Promise<void> | undefined
  const enteredArchive = deferred<void>()
  const api = createCanvasApi(async (url, init) => {
    const pathname = new URL(String(url), 'https://canvas.invalid').pathname
    const parts = pathname.slice('/physicsos/learning/canvases'.length).split('/').filter(Boolean)
    const action = parts[1] ?? parts[0] ?? 'list'; const method = init?.method ?? 'GET'
    const body: Record<string, unknown> = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    requests.push({ method, action, body })
    if (action === 'policy') return respond({ schemaVersion: 1, limits: GRAPH_LIMITS })
    if (action === 'capabilities') return respond({ ...enabled, lifecycleWritesEnabled: enabledWrites, archive: enabledWrites })
    if (action === 'changes') return respond({ changes: [], cursor: sequence, hasMore: false })
    if (parts.length === 0) return respond({ items: [remote.head] })
    if (parts.length === 1 && method === 'GET') return remote.head.deletedAt ? respond({ error: { code: 'DELETED', message: 'Deleted', currentHead: remote.head } }, 410) : respond(remote)
    if (action === 'objects') {
      const objectDigest = parts[2]!
      if (method === 'GET') return objects.has(objectDigest) ? respond(objects.get(objectDigest)) : respond({ error: { code: 'OBJECT_NOT_FOUND', message: 'Missing' } }, 404)
      if (remote.head.archivedAt || remote.head.deletedAt) return respond({ error: { code: 'LIFECYCLE_CONFLICT', message: 'Read only', currentHead: remote.head } }, 409)
      objects.set(objectDigest, body)
      return respond({ digest: objectDigest, kind: 'manifest', byteLength: canonicalStringify(body).length, bytes: canonicalStringify(body).length, existed: false })
    }
    const mutationId = String(body.mutationId); const replay = receipts.get(mutationId)
    if (replay) return respond({ ...replay, replayed: true })
    if (body.expectedGeneration === undefined) return respond({ error: { code: 'CLIENT_UPGRADE_REQUIRED', message: 'Refresh the old client' } }, 409)
    if (body.expectedGeneration !== remote.head.generation || body.expectedVersion !== remote.head.version) return respond({ error: { code: 'VERSION_CONFLICT', message: 'Changed', currentHead: remote.head } }, 409)
    if (action === 'commit') {
      if (remote.head.archivedAt || remote.head.deletedAt) return respond({ error: { code: 'LIFECYCLE_CONFLICT', message: 'Read only', currentHead: remote.head } }, 409)
      const manifest = objects.get(String(body.manifestDigest)) as typeof remote.manifest
      remote = { manifest, head: { ...remote.head, title: manifest.title, manifestDigest: String(body.manifestDigest), version: remote.head.version + 1, changeSeq: ++sequence } }
    } else {
      if (['archive', 'unarchive'].includes(action) && !enabledWrites) return respond({ error: { code: 'LIFECYCLE_WRITES_DISABLED', message: 'Disabled' } }, 409)
      const { archivedAt, deletedAt, ...retained } = remote.head
      const head: CanvasHead = { ...retained, version: remote.head.version + 1, generation: remote.head.generation + 1, changeSeq: ++sequence,
        ...(action === 'archive' ? { archivedAt: now } : action === 'unarchive' || archivedAt === undefined ? {} : { archivedAt }),
        ...(method === 'DELETE' ? { deletedAt: now } : action === 'restore' || deletedAt === undefined ? {} : { deletedAt }) }
      remote = { ...remote, head }
    }
    const committed = { ...remote, replayed: false }; receipts.set(mutationId, committed)
    if (action === 'archive') { enteredArchive.resolve(); if (waitArchive) await waitArchive; if (loseArchive) { loseArchive = false; throw new TypeError('Archive ACK was lost') } }
    return respond(committed)
  }).forOwner({ schoolId: 'school', username: 'teacher' })
  const name = `workbench-lifecycle-${randomUUID()}`; names.push(name)
  const persistence = createCanvasPersistence({ name, hash: digest }); stores.push(persistence)
  const initial: LocalCanvasRecord = { namespace, id: manifest.id, cacheVersion: 0, editSequence: 0, acknowledgedSequence: 0,
    working: manifest, base: manifest, head: remote.head, deleted: false, savedAt: now }
  await persistence.save(initial)
  const makeSync = () => {
    const sync = createCanvasSynchronizer({ namespace, api, persistence, hash: digest, id: prefix => `${prefix}-${++nextId}`, now: () => now, online: () => true, isCurrent: () => true, onRecord: () => undefined })
    synchronizers.push(sync); return sync
  }
  const change = async (fn: (value: LocalCanvasRecord) => LocalCanvasRecord) => { const current = (await persistence.read(namespace, 'canvas'))!; return persistence.save(fn(current), {}, current.cacheVersion) }
  return { namespace, api, persistence, initial, requests, makeSync, change, enteredArchive,
    remote: () => remote, setRemote: (value: CanvasOpenResponse) => { remote = value; sequence = value.head.changeSeq },
    bridge: () => { enabledWrites = false }, loseArchive: () => { loseArchive = true }, delayArchive: (wait: Promise<void>) => { waitArchive = wait } }
}

function whiteboardFixture() {
  let namespace = `teacher-${randomUUID()}`; let counter = 0; let loseArchive = false
  const cache = createIndexedDbWhiteboardCache()
  const original: WhiteboardRecord = { generation: 1, revision: 1, updatedAt: now,
    document: { schemaVersion: 1, id: 'board', title: 'Lesson', scene: { elements: [], appState: {} }, sourceImages: [], appliedGenerationIds: [] } }
  const remote = new Map([['board', structuredClone(original)]])
  const replay = new Map<string, { readonly body: string; readonly response: WhiteboardRecord }>()
  const saves = vi.fn<WhiteboardApi['save']>(async input => {
    const { signal: _signal, ...body } = input
    const previous = replay.get(input.operationId)
    if (previous) { if (previous.body !== JSON.stringify(body)) throw new WhiteboardRequestError(409, 'OPERATION_CONFLICT', 'Request hash changed'); return previous.response }
    const head = remote.get(input.id)!
    if (head.archivedAt || head.deletedAt || head.revision !== input.expectedRevision || head.generation !== input.expectedGeneration) throw new WhiteboardRequestError(409, 'WHITEBOARD_CONFLICT', 'Changed', whiteboardSummaryOf(head))
    const saved = { ...head, document: input.document, revision: head.revision + 1 }; remote.set(input.id, saved); replay.set(input.operationId, { body: JSON.stringify(body), response: saved }); return saved
  })
  const lifecycleCalls: { readonly operation: string; readonly operationId: string }[] = []
  const lifecycle = (operation: 'archive' | 'unarchive' | 'delete' | 'restore'): NonNullable<WhiteboardApi['archive']> => async input => {
    lifecycleCalls.push({ operation, operationId: input.operationId })
    const { signal: _signal, ...body } = input
    const signature = JSON.stringify({ operation, ...body }); const previous = replay.get(input.operationId)
    if (previous) { if (previous.body !== signature) throw new WhiteboardRequestError(409, 'OPERATION_CONFLICT', 'Request hash changed'); return previous.response }
    const head = remote.get(input.id)!
    if (head.revision !== input.expectedRevision || head.generation !== input.expectedGeneration) throw new WhiteboardRequestError(409, 'WHITEBOARD_CONFLICT', 'Changed', whiteboardSummaryOf(head))
    const { archivedAt, deletedAt, ...retained } = head
    const saved: WhiteboardRecord = { ...retained, revision: head.revision + 1, generation: head.generation! + 1,
      ...(operation === 'archive' ? { archivedAt: now } : operation === 'unarchive' || archivedAt === undefined ? {} : { archivedAt }),
      ...(operation === 'delete' ? { deletedAt: now } : operation === 'restore' || deletedAt === undefined ? {} : { deletedAt }) }
    remote.set(input.id, saved); replay.set(input.operationId, { body: signature, response: saved })
    if (operation === 'archive' && loseArchive) { loseArchive = false; throw new TypeError('Archive ACK was lost') }
    return saved
  }
  const api: WhiteboardApi = {
    capabilities: async () => enabled, list: async () => [...remote.values()].map(whiteboardSummaryOf),
    create: async input => { const created = { ...original, document: { ...original.document, id: `new-${++counter}`, title: input.title } }; remote.set(created.document.id, created); return created },
    read: async input => { const stored = remote.get(input.id); if (!stored) throw new WhiteboardRequestError(404, 'WHITEBOARD_NOT_FOUND', 'Missing'); if (stored.deletedAt) throw new WhiteboardRequestError(410, 'WHITEBOARD_DELETED', 'Deleted', whiteboardSummaryOf(stored)); return stored },
    readRetained: async input => remote.get(input.id)!, save: saves,
    archive: lifecycle('archive'), unarchive: lifecycle('unarchive'), remove: lifecycle('delete'), restore: lifecycle('restore'),
    copy: async input => { const source = remote.get(input.id)!; expect(source.generation).toBe(input.expectedGeneration); const copied = { ...original, document: { ...input.document!, id: `copy-${++counter}`, title: input.title } }; remote.set(copied.document.id, copied); return copied },
    uploadImage: async () => { throw new Error('Unused') }, readImage: async () => { throw new Error('Unused') }, startGeneration: async () => { throw new Error('Unused') },
    readGeneration: async () => { throw new Error('Unused') }, cancelGeneration: async () => { throw new Error('Unused') },
  }
  const make = () => { const controller = createWhiteboardController({ api, cache, getNamespace: () => namespace, id: () => `operation-${++counter}`, schedule: () => undefined, cancelSchedule: () => undefined }); controllers.push(controller); return controller }
  return { api, cache, make, original, saves, lifecycleCalls, remote: () => remote.get('board')!, setRemote: (record: WhiteboardRecord) => { remote.set('board', record) },
    namespace: () => namespace, switchOwner: () => { namespace = `other-${randomUUID()}` }, loseArchive: () => { loseArchive = true } }
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose()
  await Promise.all(synchronizers.splice(0).map(sync => sync.dispose()))
  await Promise.all(stores.splice(0).map(store => store.close()))
  await Promise.all(names.splice(0).map(name => deleteDB(name)))
})

describe('Canvas archive cache, sealed outbox and lifetime fences', () => {
  it('preserves optional fields in strict head/cache/outbox codecs without synthesizing legacy head fields', async () => {
    const f = await canvasFixture(); const archived = { ...f.initial.head!, archivedAt: now }
    expect(readCanvasHead(archived)).toEqual(archived)
    expect(readCanvasHead(f.initial.head)).not.toHaveProperty('archivedAt')
    const request = { expectedVersion: 1, expectedGeneration: 1, mutationId: 'archive' }
    const pending = { kind: 'archive', request, body: canonicalStringify(request), bodyDigest: await digest(request), editSequence: 1, createdAt: now }
    expect(readPendingMutation(pending, 'canvas')).toEqual(pending)
    const cached = readLocalCanvasRecord({ ...f.initial, archived: true, pending, editSequence: 1 }, f.namespace)
    expect(cached.archived).toBe(true)
    await f.persistence.save(cached, {}, 1)
    expect((await f.persistence.read(f.namespace, 'canvas'))?.pending).toEqual(pending)
  })

  it('replays a lost archive ACK with the original operation after a synchronizer restart and restores the archived state after deletion', async () => {
    const f = await canvasFixture(); const first = f.makeSync()
    await f.change(value => ({ ...value, archived: true, editSequence: value.editSequence + 1 }))
    f.loseArchive(); await first.sync('canvas')
    const pending = (await f.persistence.read(f.namespace, 'canvas'))?.pending
    expect(pending?.kind).toBe('archive'); expect(f.remote().head.archivedAt).toBe(now)
    await first.dispose(); const restarted = f.makeSync(); await restarted.sync('canvas', true)
    const archived = (await f.persistence.read(f.namespace, 'canvas'))!
    expect(archived.pending).toBeUndefined(); expect(archived.head?.generation).toBe(2)
    const calls = f.requests.filter(item => item.action === 'archive')
    expect(calls).toHaveLength(2); expect(calls[0]?.body).toEqual(calls[1]?.body)
    await f.change(value => ({ ...value, deleted: true, editSequence: value.editSequence + 1 })); await restarted.sync('canvas')
    await f.change(value => ({ ...value, deleted: false, editSequence: value.editSequence + 1 })); await restarted.sync('canvas')
    const restored = (await f.persistence.read(f.namespace, 'canvas'))!
    expect(restored.head).toMatchObject({ generation: 4, archivedAt: now }); expect(canvasReadOnly(restored)).toBe(true)
  })

  it('stops a sealed legacy envelope with an upgrade message instead of attaching the new generation', async () => {
    const f = await canvasFixture()
    const working = { ...f.initial.working, title: 'Old offline edit' }; const request = { expectedVersion: 1, mutationId: 'legacy-commit', manifestDigest: await digest(working) }
    const pending = readPendingMutation({ kind: 'commit', request, manifest: working, body: canonicalStringify(request), bodyDigest: await digest(request), editSequence: 1, createdAt: now }, 'canvas')
    await f.change(value => ({ ...value, working, editSequence: 1, pending }))
    await f.makeSync().sync('canvas')
    const saved = (await f.persistence.read(f.namespace, 'canvas'))!
    expect(saved.error?.code).toBe('CLIENT_UPGRADE_REQUIRED'); expect(saved.pending?.request).not.toHaveProperty('expectedGeneration')
    expect(f.requests.filter(item => item.action === 'commit')).toHaveLength(1)
  })

  it('retains an old dirty draft through delete/restore and never rebases it into a fresh lifetime', async () => {
    const f = await canvasFixture()
    await f.change(value => ({ ...value, working: { ...value.working, title: 'Old offline edit' }, editSequence: 1 }))
    f.setRemote({ ...f.remote(), head: { ...f.remote().head, version: 3, generation: 3, changeSeq: 3 } })
    await f.makeSync().sync('canvas')
    const saved = (await f.persistence.read(f.namespace, 'canvas'))!
    expect(saved.conflict?.conflicts[0]?.path).toBe('/lifecycle'); expect(saved.working.title).toBe('Old offline edit'); expect(canvasReadOnly(saved)).toBe(true)
    expect(f.remote().manifest.title).toBe('Retained notes')
    expect(f.requests.filter(item => item.action === 'commit')).toHaveLength(1)
  })

  it('does not let a delayed archive receipt replace a later observed lifetime', async () => {
    const f = await canvasFixture(); const release = deferred<void>(); f.delayArchive(release.promise)
    await f.change(value => ({ ...value, archived: true, editSequence: 1 }))
    const syncing = f.makeSync().sync('canvas'); await f.enteredArchive.promise
    const later = { ...f.remote(), head: { ...f.remote().head, generation: 5, version: 5, changeSeq: 5 } }
    const { archivedAt: _archived, ...active } = later.head
    f.setRemote({ ...later, head: active })
    await f.change(value => ({ ...value, head: active, archived: false }))
    release.resolve(); await syncing
    const retained = (await f.persistence.read(f.namespace, 'canvas'))!
    expect(retained.head?.generation).toBe(5); expect(retained.conflict?.conflicts[0]?.path).toBe('/lifecycle')
    expect(retained.pending).toBeUndefined(); expect(canvasReadOnly(retained)).toBe(true)
  })

  it('enforces bridge read-only in the controller even with new lifecycle writes disabled', async () => {
    const f = await canvasFixture(); f.bridge()
    const archived = { ...f.remote(), head: { ...f.remote().head, archivedAt: now, generation: 2, version: 2, changeSeq: 2 } }
    f.setRemote(archived)
    await f.change(value => ({ ...value, head: archived.head, archived: true }))
    const controller = createCanvasController({ api: f.api, persistence: f.persistence, getAccount: () => ({ id: 'account', schoolId: 'school', username: 'teacher' }),
      createRuntime: async () => { throw new Error('No experiments') }, hash: digest, online: () => true, now: () => now, window: null, document: null, channel: null, schedule: () => 0, cancel: () => undefined })
    controllers.push(controller); await controller.refreshAccount(); await controller.open('canvas')
    expect(controller.getSnapshot().capabilities?.archive).toBe(false)
    await expect(controller.rename('canvas', 'Must not write')).rejects.toThrow('CANVAS_ARCHIVED_READ_ONLY')
    await expect(controller.removeNodes('canvas', ['node'])).rejects.toThrow('CANVAS_ARCHIVED_READ_ONLY')
    expect((await controller.exportGraph('canvas')).manifest).toEqual(f.initial.working)
    expect(controller.documentSource('canvas').getSnapshot().readOnly).toBe(true)
  })
})

describe('Whiteboard server authority, dirty IDB and late task guards', () => {
  it('archives read-only, unarchives on ACK, and restores the original archived state without deleting selected elements', async () => {
    const f = whiteboardFixture(); const controller = f.make(); await controller.list(); await controller.open('board')
    const scene = { elements: [{ id: 'pen', type: 'freedraw', points: [[0, 1], [0, 1], [8, 13]], pressures: [.13, .57, .99] }], appState: {} }
    controller.edit(scene); await controller.archive('board')
    expect(controller.getSnapshot()).toMatchObject({ readOnly: true, status: 'archived', dirty: false })
    controller.edit({ elements: [], appState: {} }); expect(controller.getSnapshot().record?.document.scene).toEqual(scene)
    await controller.remove('board'); await controller.restore('board')
    expect(controller.getSnapshot()).toMatchObject({ status: 'archived', record: { generation: 4, archivedAt: now } })
    expect(f.remote().document.scene).toEqual(scene)
    await controller.unarchive('board'); expect(controller.getSnapshot()).toMatchObject({ readOnly: false, status: 'saved', record: { generation: 5 } })
  })

  it('retains the lifecycle envelope until a lost ACK is recovered with the same operation after restart', async () => {
    const f = whiteboardFixture(); let controller = f.make(); await controller.list(); await controller.open('board'); f.loseArchive()
    await expect(controller.archive('board')).rejects.toThrow('Archive ACK was lost')
    expect(controller.getSnapshot().status).toBe('lifecycle-pending')
    const pending = await f.cache.readLifecycle!(f.namespace(), 'board'); expect(pending?.operation).toBe('archive')
    controller.close(); controller.dispose(); controller = f.make(); await controller.list(); await controller.open('board')
    expect(controller.getSnapshot()).toMatchObject({ readOnly: true, status: 'archived' })
    expect(await f.cache.readLifecycle!(f.namespace(), 'board')).toBeUndefined()
    expect(f.lifecycleCalls.map(call => call.operationId)).toEqual([pending!.operationId, pending!.operationId])
  })

  it.each([401, 403, 404, 410])('treats HTTP %s as authoritative, not as a writable network fallback', async status => {
    const f = whiteboardFixture(); const namespace = f.namespace()
    const draft: WhiteboardDraft = { record: { ...f.original, document: { ...f.original.document, title: 'Retain this old draft' } }, dirty: true }
    await f.cache.write(namespace, 'board', draft)
    f.api.read = async () => { throw new WhiteboardRequestError(status, 'DENIED', 'Authoritative refusal', status === 410 ? { ...whiteboardSummaryOf(f.original), generation: 2, revision: 2, deletedAt: now } : undefined, false) }
    delete f.api.readRetained
    const controller = f.make(); await expect(controller.open('board')).rejects.toThrow('Authoritative refusal')
    expect(controller.getSnapshot().readOnly).toBe(true)
    controller.rename('Must not revive'); expect(controller.getSnapshot().record?.document.title).toBe('Retain this old draft')
    await expect(controller.save()).rejects.toThrow('只读')
    expect(f.saves).not.toHaveBeenCalled()
    expect((await f.cache.read(namespace, 'board'))?.record.document.title).toBe('Retain this old draft')
  })

  it('copies an old draft to a new ID instead of rebasing it through delete/restore', async () => {
    const f = whiteboardFixture(); const draft = { ...f.original, document: { ...f.original.document, title: 'Recovered pressure draft' } }
    await f.cache.write(f.namespace(), 'board', { record: draft, dirty: true })
    f.setRemote({ ...f.original, generation: 3, revision: 3 })
    const controller = f.make(); await controller.open('board')
    expect(controller.getSnapshot()).toMatchObject({ readOnly: true, status: 'conflict' })
    await expect(controller.save()).rejects.toThrow('只读')
    const copied = await controller.copy('Recovered copy')
    expect(copied).not.toBe('board'); expect(controller.getSnapshot().record?.document.title).toBe('Recovered copy')
    expect(f.remote()).toMatchObject({ generation: 3, revision: 3, document: { title: 'Lesson' } })
  })

  it('rejects legacy sealed save/generation drafts instead of inventing generation fences', async () => {
    const f = whiteboardFixture()
    await f.cache.write(f.namespace(), 'board', { record: f.original, dirty: true, pendingSave: { document: f.original.document, expectedRevision: 1, operationId: 'old-save' } })
    const controller = f.make(); await expect(controller.open('board')).rejects.toThrow('旧版未提交请求')
    expect(controller.getSnapshot()).toMatchObject({ readOnly: true, blocked: 'upgrade-required' })
    expect(f.saves).not.toHaveBeenCalled()
  })

  it('ignores a late ready generation after archive and a late lifecycle response after account switching', async () => {
    const f = whiteboardFixture(); const polling = deferred<WhiteboardGeneration>()
    const source = { id: 'image', sha256: 'a'.repeat(64), mimeType: 'image/png' as const, width: 800, height: 400, byteLength: 1, viewBox: { x: 0, y: 0, width: 800, height: 400 } }
    f.setRemote({ ...f.original, document: { ...f.original.document, sourceImages: [source] } })
    const job: WhiteboardGeneration = { id: 'job', whiteboardId: 'board', imageId: 'image', generation: 1, status: 'queued' }
    f.api.startGeneration = async () => job; f.api.readGeneration = async () => polling.promise
    const controller = f.make(); await controller.list(); await controller.open('board'); await controller.generate('image')
    const poll = controller.poll(); await controller.archive('board')
    polling.resolve({ ...job, status: 'ready', result: { schemaVersion: 1, sourceImageId: source.id, sourceImageSha256: source.sha256, viewBox: source.viewBox,
      primitives: [{ id: 'late', type: 'line', points: [[0, 1], [2, 3]] }], uncertainties: [] } })
    await poll
    expect(controller.getSnapshot().record?.document.scene.elements).toEqual([])
    expect(controller.getSnapshot()).toMatchObject({ readOnly: true, status: 'archived' })
    const late = deferred<WhiteboardRecord>(); const original = f.api.unarchive!
    const entered = deferred<void>()
    f.api.unarchive = async input => { const response = await original(input); entered.resolve(); await late.promise; return response }
    const unarchive = controller.unarchive('board'); await entered.promise
    const oldNamespace = f.namespace(); f.switchOwner(); controller.resetNamespace(); late.resolve(f.original); await unarchive
    expect(controller.getSnapshot().namespace).not.toBe(oldNamespace); expect(controller.getSnapshot().record).toBeUndefined()
  })

  it('keeps a higher lifetime cache fence when an old tab checkpoints dirty pressure strokes', async () => {
    const f = whiteboardFixture(); const namespace = f.namespace()
    const archived = { ...f.original, generation: 2, revision: 2, archivedAt: now }
    await f.cache.write(namespace, 'board', { record: archived, serverHead: whiteboardSummaryOf(archived), dirty: false })
    const old = { ...f.original, document: { ...f.original.document, scene: { elements: [{ id: 'raw', type: 'freedraw', points: [[1, 2], [1, 2]], pressures: [.13, .71] }], appState: {} } } }
    await f.cache.write(namespace, 'board', { record: old, dirty: true })
    const saved = await createIndexedDbWhiteboardCache().read(namespace, 'board')
    expect(saved).toMatchObject({ blocked: 'archived', serverHead: { generation: 2 } })
    expect(saved?.record.document.scene).toEqual(old.document.scene)
    expect(await f.cache.read(`${namespace}-foreign`, 'board')).toBeUndefined()
  })

  it('finishes a delayed catalog lifecycle without aborting or replacing another board save', async () => {
    const f = whiteboardFixture()
    const other = await f.api.create({ title: 'Other lesson', operationId: 'create-other' })
    const writingOutbox = deferred<void>(); const releaseOutbox = deferred<void>()
    const writeLifecycle = f.cache.writeLifecycle!
    f.cache.writeLifecycle = async (namespace, id, pending, expectedOperationId) => {
      if (pending) { writingOutbox.resolve(); await releaseOutbox.promise }
      await writeLifecycle(namespace, id, pending, expectedOperationId)
    }
    const saveEntered = deferred<void>(); const releaseSave = deferred<void>()
    let saveSignal: AbortSignal | undefined
    const save = f.api.save
    f.api.save = async input => {
      saveSignal = input.signal; saveEntered.resolve(); await releaseSave.promise
      return save(input)
    }
    const controller = f.make(); await controller.list(); await controller.open('board')
    const archiving = controller.archive('board'); await writingOutbox.promise
    await controller.open(other.document.id)
    controller.rename('Keep this exact pending save')
    const saving = controller.save(); await saveEntered.promise
    const pendingSave = (await f.cache.read(f.namespace(), other.document.id))!.pendingSave
    expect(pendingSave).toBeDefined()
    releaseOutbox.resolve(); await archiving
    expect(saveSignal?.aborted).toBe(false)
    expect(controller.getSnapshot()).toMatchObject({ readOnly: false, dirty: true, status: 'saving', record: { document: { id: other.document.id, title: 'Keep this exact pending save' } } })
    expect((await f.cache.read(f.namespace(), other.document.id))?.pendingSave).toEqual(pendingSave)
    expect(await f.cache.readLifecycle!(f.namespace(), 'board')).toBeUndefined()
    expect(controller.getSnapshot().documents.find(item => item.id === 'board')?.archivedAt).toBe(now)
    releaseSave.resolve(); await saving
    expect(controller.getSnapshot()).toMatchObject({ readOnly: false, dirty: false, status: 'saved', record: { document: { id: other.document.id, title: 'Keep this exact pending save' } } })
  })

  it('does not freeze the current editor when organizing another board is rejected', async () => {
    const f = whiteboardFixture()
    const other = await f.api.create({ title: 'Other lesson', operationId: 'create-other' })
    f.api.archive = async () => { throw new WhiteboardRequestError(409, 'WHITEBOARD_CONFLICT', 'Other board changed', { ...whiteboardSummaryOf(f.original), revision: 2 }) }
    const controller = f.make(); await controller.list(); await controller.open(other.document.id)
    controller.rename('Still editable')
    await expect(controller.archive('board')).rejects.toThrow('Other board changed')
    expect(controller.getSnapshot()).toMatchObject({ readOnly: false, dirty: true, status: 'unsaved', record: { document: { id: other.document.id, title: 'Still editable' } } })
    controller.rename('Saved after unrelated rejection'); await controller.save()
    expect(controller.getSnapshot()).toMatchObject({ dirty: false, status: 'saved', record: { document: { title: 'Saved after unrelated rejection' } } })
  })

  it('CAS-protects the per-document lifecycle outbox so another tab cannot replace or clear its operation', async () => {
    const f = whiteboardFixture(); const namespace = f.namespace()
    const pending: PendingWhiteboardLifecycle = { id: 'board', operation: 'archive', expectedRevision: 1, expectedGeneration: 1, operationId: 'first-tab' }
    await f.cache.writeLifecycle!(namespace, 'board', pending)
    await expect(f.cache.writeLifecycle!(namespace, 'board', { ...pending, operationId: 'second-tab' })).rejects.toThrow('另一个页面')
    await expect(f.cache.writeLifecycle!(namespace, 'board', undefined, 'second-tab')).rejects.toThrow('另一个页面')
    expect(await f.cache.readLifecycle!(namespace, 'board')).toEqual(pending)
    await f.cache.writeLifecycle!(namespace, 'board', undefined, 'first-tab')
    expect(await f.cache.readLifecycle!(namespace, 'board')).toBeUndefined()
  })
})
