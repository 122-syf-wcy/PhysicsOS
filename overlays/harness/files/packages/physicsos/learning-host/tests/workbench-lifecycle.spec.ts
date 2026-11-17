import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { createSceneObject } from '@physicsos/physics-workbench/codec'
import { canonicalBytes, canonicalStringify } from '@physicsos/physics-workbench/json'
import type { CanvasHead } from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest } from '@physicsos/physics-workbench/types'
import type { ActivitySuccessCapsule } from '../src/activity-contract.ts'
import { CanvasBlobStore, canvasHash, canvasScopeKey } from '../src/canvas-blob-store.ts'
import { resolveCanvasConfig } from '../src/canvas-config.ts'
import { canvasDomain, canvasRecordKey, openCanvasDomain } from '../src/canvas-domain.ts'
import { CanvasService } from '../src/canvas-service.ts'
import { openWhiteboardDomain, whiteboardDomain } from '../src/whiteboard-domain.ts'
import { WhiteboardService } from '../src/whiteboard-service.ts'
import type { WhiteboardModel, WhiteboardRecord } from '../src/whiteboard-types.ts'

const owner = { schoolId: 'school', userKey: 'school:teacher', username: 'teacher', role: 'TEACHER' as const }
const other = { ...owner, userKey: 'school:other', username: 'other' }
const foreignSchool = { ...owner, schoolId: 'other-school' }
const at = '2026-11-17T08:00:00.000Z'
const canvasFence = (head: CanvasHead, mutationId: string) => ({ expectedVersion: head.version, expectedGeneration: head.generation, mutationId })
const boardFence = (record: WhiteboardRecord, operationId: string) => ({ expectedRevision: record.revision, expectedGeneration: record.generation, operationId })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept }); return { promise, resolve } }

async function fixture(enabled = false, modelPatch: Partial<WhiteboardModel> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-lifecycle-'))
  let ctx!: Context; let backend!: JsonStorageBackend; let canvas!: CanvasService; let board!: WhiteboardService
  let canvasStore!: Awaited<ReturnType<typeof openCanvasDomain>>
  const deliveries: ActivitySuccessCapsule[] = []; const usage: { readonly id: string; readonly usage?: unknown }[] = []
  let rejectSink = false; let time = Date.parse(at)
  const model: WhiteboardModel = { provider: 'fixture', model: 'fixture-vision', prepareImage: async () => ({ width: 800, height: 400, attachment: { id: 'original' } }),
    draw: async (request, _signal, onStart) => { await onStart?.(); return { diagram: { schemaVersion: 1, sourceImageId: request.source.id, sourceImageSha256: request.source.sha256,
      viewBox: request.source.viewBox, primitives: [{ id: 'rail', type: 'line', points: [[10, 300], [790, 300]] }], uncertainties: [] }, usage: { inputTokens: 5, outputTokens: 3 } } }, ...modelPatch }
  const sink = { success: async (capsule: ActivitySuccessCapsule) => { deliveries.push(capsule); if (rejectSink) throw new Error('Injected sink outage'); return { status: 'recorded' as const } } }
  const open = async () => {
    ctx = new Context(); await ctx.plugin(Storage)
    backend = new JsonStorageBackend(join(root, 'domain')); ctx.storage.backend.register('json', backend)
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
    const config = resolveCanvasConfig({ canvasDshHome: root, teachingToolsMode: enabled ? 'enabled' : 'bridge' })
    canvasStore = await openCanvasDomain(ctx)
    canvas = new CanvasService(canvasStore, new CanvasBlobStore(config.root), config, { now: () => new Date(time), activitySink: sink })
    board = new WhiteboardService(await openWhiteboardDomain(ctx), new CanvasBlobStore(config.root), { lifecycleWritesEnabled: enabled, model, now: () => new Date(time), activitySink: sink,
      recordUsage: async receipt => { usage.push(receipt) } })
    await canvas.initialize(); await board.initialize()
  }
  // Canvas owns its domain privately; the facility closes it with the Context.
  const shutdown = async () => { await Promise.all([canvas.dispose(), board.dispose()]); await ctx.storageDomain.get(canvasDomain.name)?.close(); await board.domain.close(); await ctx.fiber.dispose(); await backend.close() }
  onTestFinished(async () => { vi.restoreAllMocks(); await shutdown(); await rm(root, { recursive: true, force: true }) })
  await open()
  return { root, deliveries, usage, get canvas() { return canvas }, get canvasDomain() { return canvasStore }, get board() { return board }, get ctx() { return ctx },
    rejectSink: (value: boolean) => { rejectSink = value }, advance: (milliseconds: number) => { time += milliseconds },
    restart: async (nextEnabled = enabled) => { await shutdown(); enabled = nextEnabled; await open() } }
}
async function upload(f: Awaited<ReturnType<typeof fixture>>, id: string, value: CanvasManifest | ReturnType<typeof createSceneObject>): Promise<string> {
  const bytes = canonicalBytes(value); const digest = canvasHash(bytes)
  await f.canvas.uploadObject(owner, id, digest, bytes); return digest
}
async function imageBoard(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await f.board.create(owner, { title: 'Original pressure and image', operationId: 'create-board' })
  const source = await f.board.upload(owner, created.document.id, { ...boardFence(created, 'upload-original'), mimeType: 'image/png', base64: Buffer.from('exact-original-image').toString('base64') })
  const document = { ...created.document, sourceImages: [source], scene: { elements: [{ id: 'pen', type: 'freedraw', points: [[0, 1], [0, 1], [9, 13]], pressures: [0.13, 0.57, 0.99], customData: { raw: [0, 0, 9] } }], appState: { scrollX: 12 } } }
  return { source, record: await f.board.save(owner, created.document.id, { ...boardFence(created, 'save-board'), document, editingSessionId: 'session-1' }) }
}

describe('Canvas lifecycle bridge and durable races', () => {
  it('keeps v1 legacy heads free of new optional fields, round-trips archive/delete/restore through bridge, and keeps every original object', async () => {
    const f = await fixture()
    const created = await f.canvas.create(owner, { id: 'canvas', title: 'Original', mutationId: 'create' })
    const scene = createSceneObject(createMechanicsScene({ sceneId: 'original-scene', model: 'uniform_linear_motion', mass: 2, velocity: { x: 4, y: 0, z: 0 }, endTime: 2 }))
    const sceneDigest = await upload(f, 'canvas', scene)
    const manifest: CanvasManifest = { ...created.manifest, nodes: [{ id: 'note', kind: 'note', body: 'Original unrounded data', format: 'plain', layout: { x: 1, y: 2, width: 300, height: 200, zIndex: 0 } }],
      instances: [{ instanceId: 'experiment', currentScene: { kind: 'scene', digest: sceneDigest }, originScene: { kind: 'scene', digest: sceneDigest }, domain: 'mechanics', source: { kind: 'template' }, buildMode: 'inspect', clock: { time: 0, total: 2, rate: 1, running: false }, instanceEditRevision: 0 }] }
    const digest = await upload(f, 'canvas', manifest)
    const saved = await f.canvas.commit(owner, 'canvas', { ...canvasFence(created.head, 'save'), manifestDigest: digest, editingSessionId: 'bridge-session' })
    expect(saved.head).not.toHaveProperty('archivedAt')
    const metadata = await readFile(join(f.root, 'domain', 'physicsos_canvas.json'), 'utf8')
    expect(metadata).not.toContain('activitySuccess'); expect(metadata).not.toContain('archivedAt')
    await f.restart(true)
    const archived = await f.canvas.archive(owner, 'canvas', canvasFence(saved.head, 'archive'))
    expect(archived.head).toMatchObject({ version: 3, generation: 2, archivedAt: at, manifestDigest: digest })
    await f.restart(false)
    expect(canvasDomain.version).toBe(1)
    expect((await f.canvas.open(owner, 'canvas')).head).toEqual(archived.head)
    await expect(f.canvas.commit(owner, 'canvas', { ...canvasFence(archived.head, 'bad-save'), manifestDigest: digest })).rejects.toMatchObject({ code: 'ARCHIVED_READ_ONLY' })
    await expect(f.canvas.unarchive(owner, 'canvas', canvasFence(archived.head, 'disabled'))).rejects.toMatchObject({ code: 'LIFECYCLE_WRITES_DISABLED' })
    const deleted = await f.canvas.delete(owner, 'canvas', canvasFence(archived.head, 'delete'))
    expect(deleted.head.archivedAt).toBe(archived.head.archivedAt)
    const restored = await f.canvas.restore(owner, 'canvas', canvasFence(deleted.head, 'restore'))
    expect(restored.head).toMatchObject({ generation: 4, archivedAt: at }); expect(restored.head.deletedAt).toBeUndefined()
    await f.restart(true)
    const active = await f.canvas.unarchive(owner, 'canvas', canvasFence(restored.head, 'unarchive'))
    expect(active.head.archivedAt).toBeUndefined()
    const current = await f.canvas.commit(owner, 'canvas', { ...canvasFence(active.head, 'after-unarchive'), manifestDigest: digest })
    expect(current.head.generation).toBe(5)
    f.advance(3 * 86400000); await f.canvas.collect(owner, 'canvas')
    expect(Buffer.from((await f.canvas.downloadObject(owner, 'canvas', sceneDigest)).bytes).equals(Buffer.from(canonicalBytes(scene)))).toBe(true)
    expect(Buffer.from((await f.canvas.downloadObject(owner, 'canvas', digest)).bytes).equals(Buffer.from(canonicalBytes(manifest)))).toBe(true)
    const changes = await f.canvas.changes(owner)
    expect(changes.changes.at(-1)?.head).toEqual(current.head)
    const receipts = f.ctx.storageDomain.get(canvasDomain.name)!.table('receipts')
    expect([...receipts.entries()].some(([, row]) => (row as { operation?: string }).operation === 'archive')).toBe(true)
  })

  it('repairs an archive capsule after a lost receipt and disabled-feature restart without another generation', async () => {
    const f = await fixture(true)
    const created = await f.canvas.create(owner, { id: 'lost', title: 'Lost ACK', mutationId: 'create' })
    const domain = f.canvasDomain; const receipts = domain.table('receipts')
    const originalPut = receipts.put.bind(receipts)
    const spy = vi.spyOn(receipts, 'put').mockImplementationOnce(async () => { throw new Error('Lost receipt after head commit') })
    const request = canvasFence(created.head, 'archive-once')
    await expect(f.canvas.archive(owner, 'lost', request)).rejects.toThrow('Lost receipt')
    expect(domain.table('heads').get(canvasRecordKey(owner.schoolId, owner.userKey, 'lost'))?.lastCommit).toMatchObject({ operation: 'archive', head: { generation: 2, archivedAt: at } })
    spy.mockImplementation(originalPut)
    await f.restart(false)
    const replayed = await f.canvas.archive(owner, 'lost', request)
    expect(replayed).toMatchObject({ replayed: true, head: { version: 2, generation: 2, archivedAt: at } })
    expect((await f.canvas.open(owner, 'lost')).head).toEqual(replayed.head)
    const reopened = f.canvasDomain
    expect(reopened.table('reservations').get(canvasRecordKey(owner.schoolId, owner.userKey, 'lost', request.mutationId))).toBeUndefined()
    expect(reopened.table('receipts').get(canvasRecordKey(owner.schoolId, owner.userKey, 'lost', request.mutationId))?.head.archivedAt).toBe(at)
  })

  it.each(['lifecycle-first', 'save-first'] as const)('serializes save/archive races (%s) and never lets an old generation revive a tombstone', async order => {
    const f = await fixture(true)
    const created = await f.canvas.create(owner, { id: 'race', title: 'Race', mutationId: 'create' })
    const digest = await upload(f, 'race', { ...created.manifest, title: 'Saved content' })
    const save = () => f.canvas.commit(owner, 'race', { ...canvasFence(created.head, 'save'), manifestDigest: digest })
    const archive = () => f.canvas.archive(owner, 'race', canvasFence(created.head, 'archive'))
    const outcomes = await Promise.allSettled(order === 'lifecycle-first' ? [archive(), save()] : [save(), archive()])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    let head = (await f.canvas.open(owner, 'race')).head
    if (!head.archivedAt) head = (await f.canvas.archive(owner, 'race', canvasFence(head, 'archive-retry'))).head
    const deleted = await f.canvas.delete(owner, 'race', canvasFence(head, 'delete'))
    await expect(f.canvas.commit(owner, 'race', { expectedVersion: deleted.head.version, expectedGeneration: 1, mutationId: 'old-write', manifestDigest: digest })).rejects.toMatchObject({ status: 410 })
    const restored = await f.canvas.restore(owner, 'race', canvasFence(deleted.head, 'restore'))
    expect(restored.head.archivedAt).toBe(head.archivedAt)
    const active = await f.canvas.unarchive(owner, 'race', canvasFence(restored.head, 'active'))
    await expect(f.canvas.commit(owner, 'race', { expectedVersion: active.head.version, expectedGeneration: 1, mutationId: 'old-write-active', manifestDigest: digest })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await expect(f.canvas.commit(owner, 'race', { expectedVersion: active.head.version, mutationId: 'legacy', manifestDigest: digest })).rejects.toMatchObject({ code: 'CLIENT_UPGRADE_REQUIRED' })
    await expect(f.canvas.archive(other, 'race', canvasFence(active.head, 'foreign'))).rejects.toMatchObject({ status: 404 })
    await expect(f.canvas.delete(foreignSchool, 'race', canvasFence(active.head, 'foreign'))).rejects.toMatchObject({ status: 404 })
  })
})

describe('Whiteboard lifecycle and cancelled-generation durability', () => {
  it('preserves a strict v1 bridge row, pressure/history and original images across archive/delete/restore without a purge', async () => {
    const f = await fixture(false); const { record, source } = await imageBoard(f)
    const accountKey = canvasScopeKey(owner.schoolId, owner.userKey)
    expect(f.board.domain.table('accounts').get(accountKey)?.boards[record.document.id]).not.toHaveProperty('generation')
    expect(f.board.domain.table('accounts').get(accountKey)?.boards[record.document.id]).not.toHaveProperty('archivedAt')
    await f.restart(true)
    const archived = await f.board.archive(owner, record.document.id, boardFence(record, 'archive'))
    expect(archived).toMatchObject({ generation: 2, archivedAt: at })
    const snapshot = canonicalStringify(f.board.domain.table('accounts').get(accountKey))
    await f.restart(false)
    expect(whiteboardDomain.version).toBe(1)
    expect(canonicalStringify(f.board.domain.table('accounts').get(accountKey))).toBe(snapshot)
    await expect(f.board.save(owner, record.document.id, { ...boardFence(archived, 'denied'), document: record.document })).rejects.toMatchObject({ code: 'WHITEBOARD_ARCHIVED_READ_ONLY' })
    await expect(f.board.delete(owner, record.document.id, boardFence(archived, 'disabled-delete'))).rejects.toMatchObject({ code: 'LIFECYCLE_WRITES_DISABLED' })
    await f.restart(true)
    const deleted = await f.board.delete(owner, record.document.id, boardFence(archived, 'delete'))
    expect(deleted.archivedAt).toBe(archived.archivedAt)
    await expect(f.board.read(owner, record.document.id)).rejects.toMatchObject({ status: 410, currentHead: { generation: 3, archivedAt: at } })
    const restored = await f.board.restore(owner, record.document.id, boardFence(deleted, 'restore'))
    expect(restored).toMatchObject({ generation: 4, archivedAt: at }); expect(restored.deletedAt).toBeUndefined()
    const active = await f.board.unarchive(owner, record.document.id, boardFence(restored, 'active'))
    expect(active.document).toEqual(record.document)
    expect(Buffer.from((await f.board.readImage(owner, record.document.id, source.id)).base64, 'base64').toString()).toBe('exact-original-image')
    const copied = await f.board.copy(owner, record.document.id, { ...boardFence(active, 'copy'), document: active.document, title: 'New identity' })
    expect(copied.document.id).not.toBe(record.document.id)
    expect(copied.document.scene.elements[0]).toEqual(record.document.scene.elements[0])
    await expect(f.board.readRetained(other, record.document.id)).rejects.toMatchObject({ status: 404 })
    await expect(f.board.restore(foreignSchool, record.document.id, boardFence(active, 'foreign'))).rejects.toMatchObject({ status: 404 })
  })

  it('uses account-row atomic revisions and operation hashes for save/delete/restore races and lost response retries', async () => {
    const f = await fixture(true)
    const created = await f.board.create(owner, { title: 'Race', operationId: 'create-race' })
    const request = { ...boardFence(created, 'save'), document: { ...created.document, title: 'Changed' } }
    const results = await Promise.allSettled([f.board.delete(owner, created.document.id, boardFence(created, 'delete')), f.board.save(owner, created.document.id, request)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const deleted = await f.board.readRetained(owner, created.document.id)
    const restoreRequest = boardFence(deleted, 'restore')
    const restores = await Promise.allSettled([f.board.restore(owner, created.document.id, restoreRequest), f.board.restore(owner, created.document.id, boardFence(deleted, 'other-restore'))])
    expect(restores.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const restored = await f.board.read(owner, created.document.id)
    await f.restart(false)
    expect(await f.board.restore(owner, created.document.id, restoreRequest)).toEqual(restored)
    await expect(f.board.restore(owner, created.document.id, { ...restoreRequest, expectedGeneration: 999 })).rejects.toMatchObject({ status: 409 })
    await expect(f.board.save(owner, created.document.id, { ...request, expectedRevision: restored.revision, operationId: 'stale-lifetime' })).rejects.toMatchObject({ code: 'WHITEBOARD_CONFLICT' })
    const legacy = { document: restored.document, expectedRevision: restored.revision, operationId: 'legacy' }
    await expect(f.board.save(owner, created.document.id, legacy)).rejects.toMatchObject({ code: 'CLIENT_UPGRADE_REQUIRED' })
  })

  it.each(['archive', 'delete'] as const)('cancels tasks on %s, refuses late results but settles already-incurred numerical model usage after restart', async operation => {
    const started = deferred<void>(); const release = deferred<void>()
    const f = await fixture(true, { draw: async (request, _signal, onStart) => {
      await onStart?.(); started.resolve(); await release.promise
      return { diagram: { schemaVersion: 1, sourceImageId: request.source.id, sourceImageSha256: request.source.sha256, viewBox: request.source.viewBox,
        primitives: [{ id: 'late', type: 'line', points: [[1, 2], [30, 40]] }], uncertainties: [] }, usage: { inputTokens: 123, outputTokens: 45 } }
    } })
    onTestFinished(() => { release.resolve() })
    const { record } = await imageBoard(f)
    const job = await f.board.generate(owner, record.document.id, { ...boardFence(record, 'generate'), imageId: record.document.sourceImages[0]!.id })
    await started.promise
    const organized = await f.board[operation](owner, record.document.id, boardFence(record, 'organize'))
    release.resolve()
    for (let turn = 0; turn < 100 && !f.usage.length; turn++) await new Promise(resolve => setTimeout(resolve, 5))
    expect(f.usage).toHaveLength(1); expect(f.usage[0]?.usage).toEqual({ inputTokens: 123, outputTokens: 45 })
    expect(await f.board.readGeneration(owner, record.document.id, job.id)).toMatchObject({ status: 'cancelled', generation: record.generation })
    expect((await f.board.readGeneration(owner, record.document.id, job.id)).result).toBeUndefined()
    expect((await f.board.readRetained(owner, record.document.id)).document).toEqual(record.document)
    await f.restart(false)
    expect((await f.board.readRetained(owner, record.document.id)).generation).toBe(organized.generation)
    expect(f.usage).toHaveLength(1)
  })
})

describe('durable edit-session success capsules', () => {
  it('counts a real edit once per session, retains its first time through autosaves/restart and recovers a hook outage from bounded durable sources', async () => {
    const f = await fixture(true); f.rejectSink(true)
    const created = await f.canvas.create(owner, { id: 'activity', title: 'Before', mutationId: 'create' })
    let head = created.head
    for (let count = 0; count < 5; count++) {
      const manifest = { ...created.manifest, title: `Edit ${count}` }
      const digest = await upload(f, 'activity', manifest)
      head = (await f.canvas.commit(owner, 'activity', { ...canvasFence(head, `save-${count}`), manifestDigest: digest, editingSessionId: 'one-editor-session' })).head
      f.advance(1000)
    }
    let board = await f.board.create(owner, { title: 'Board before', operationId: 'create-activity' })
    for (let count = 0; count < 5; count++) {
      board = await f.board.save(owner, board.document.id, { ...boardFence(board, `save-board-${count}`), document: { ...board.document, title: `Board edit ${count}` }, editingSessionId: 'one-board-session' })
      f.advance(1000)
    }
    await f.restart(false); f.rejectSink(false)
    const query = { from: at, to: '2026-11-18T00:00:00.000Z', limit: 1, signal: new AbortController().signal }
    const canvases = await f.canvas.activityReplaySource.read(query); const boards = await f.board.activityReplaySource.read(query)
    expect(canvases.capsules).toHaveLength(1); expect(boards.capsules).toHaveLength(1)
    expect(canvases.capsules[0]?.occurredAt).toBe(at)
    expect(boards.capsules[0]?.occurredAt).toBe('2026-11-17T08:00:05.000Z')
    expect(canvases.nextCursor).toBeUndefined(); expect(boards.nextCursor).toBeUndefined()
    expect((await f.canvas.activityReplaySource.read({ ...query, from: '2026-11-18T00:00:00.000Z', to: '2026-11-19T00:00:00.000Z' })).capsules).toEqual([])
    await f.canvas.replayDurableOperations(); await f.board.replayDurableOperations()
    expect(new Set(f.deliveries.map(item => item.operationId)).size).toBe(2)
  })
})
