import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { describe, expect, it, vi, type TestContext } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { loadCanvasFixture } from '../../../physicsos/learning-host/tests/canvas-fixture.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { canvasNoteDraftKey, type CanvasController } from '../src/client/canvas/types.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const held = () => {
  let resolve!: () => void
  const promise = new Promise<void>(accept => { resolve = accept })
  return { promise, resolve }
}
async function fixture(test: TestContext) {
  const host = await loadCanvasFixture({ test })
  const account = await host.register(`recovery_${randomUUID().slice(0, 8)}`)
  const controllers: CanvasController[] = []
  const stores = new WeakMap<CanvasController, ReturnType<typeof createCanvasPersistence>>()
  const names: string[] = []
  test.onTestFinished(async () => {
    await Promise.all(controllers.map(controller => controller.dispose()))
    await Promise.all(names.map(name => deleteDB(name)))
  })
  const api = (before?: (method: string, path: string) => Promise<void>) => createCanvasApi(async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, host.base)
    const method = init?.method ?? 'GET'
    await before?.(method, url.pathname)
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    return typeof init?.body === 'string'
      ? host.raw(method, `${url.pathname}${url.search}`, init.body, account, headers)
      : host.call(method, `${url.pathname}${url.search}`, undefined, account, headers)
  })
  const browser = (transport = api()) => {
    const name = `canvas-recovery-contract-${randomUUID()}`
    names.push(name)
    let identity = 0
    const persistence = createCanvasPersistence({ name, hash })
    const controller = createCanvasController({ api: transport, persistence,
      getAccount: () => ({ id: account.user.id, schoolId: account.user.schoolId, username: account.user.username }),
      createRuntime: async options => createWorkbenchInstanceRuntime({ ...options, scheduler: null }),
      hash, id: prefix => `${prefix}-${name}-${++identity}`, now: () => new Date().toISOString(), online: () => true,
      schedule: () => 0, cancel: () => undefined, window: null, document: null, channel: null })
    controllers.push(controller)
    stores.set(controller, persistence)
    return controller
  }
  return { host, account, api, browser, stores }
}

describe('real Host recovery and immutable result synchronization', () => {
  it('saves a local workbench copy of dirty B after a real remote note conflict blocks ordinary flush', async test => {
    const f = await fixture(test)
    const remote = f.browser()
    const canvas = await remote.create('Conflicted local note backup')
    const node = await remote.addNote(canvas, { body: 'Original', format: 'plain' })
    await remote.sync(canvas)
    const refresh = held()
    test.onTestFinished(refresh.resolve)
    let reads = 0
    const local = f.browser(f.api(async (method, path) => {
      if (method === 'GET' && path === `/physicsos/learning/canvases/${canvas}` && ++reads === 2) await refresh.promise
    }))
    await local.open(canvas)
    const namespace = local.documentSource(canvas).getSnapshot().namespace!
    const checkpoint = held()
    test.onTestFinished(checkpoint.resolve)
    const store = f.stores.get(local)!
    const save = store.save.bind(store)
    let staged = false
    vi.spyOn(store, 'save').mockImplementationOnce(async (...args) => {
      staged = true
      await checkpoint.promise
      return save(...args)
    })
    local.editNoteDraft(canvasNoteDraftKey(namespace, canvas, node), { body: 'Keep my unsent B conclusion', format: 'markdown' })
    await vi.waitFor(() => expect(staged).toBe(true))
    await remote.updateNote(canvas, node, 'Accepted remote C conclusion', 'plain')
    await remote.sync(canvas)
    refresh.resolve()
    await vi.waitFor(async () => expect((await store.read(namespace, canvas))?.working.nodes.find(value => value.id === node))
      .toMatchObject({ body: 'Accepted remote C conclusion' }), { timeout: 10_000 })
    // A C refresh is intentionally not adopted while B's local write is in flight;
    // releasing B now makes its real cache CAS observe C and retain the conflict.
    checkpoint.resolve()
    await vi.waitFor(() => expect(local.noteDraftSource(canvasNoteDraftKey(namespace, canvas, node)).getSnapshot()?.conflict).toBe(true), { timeout: 10_000 })
    expect(local.noteDraftSource(canvasNoteDraftKey(namespace, canvas, node)).getSnapshot()).toMatchObject({ dirty: true, conflict: true })
    await expect(local.flush(canvas)).rejects.toThrow('CANVAS_NOTE_DRAFT_CONFLICT')
    const copy = await local.keepLocalCopy(canvas, 'Recovered B workbench')
    expect(copy).not.toBe(canvas)
    const recovered = await local.open(copy)
    expect(recovered.manifest?.nodes.some(value => value.kind === 'note' && value.body === 'Keep my unsent B conclusion')).toBe(true)
    expect(local.documentSource(canvas).getSnapshot().manifest?.nodes.find(value => value.id === node)).toMatchObject({ body: 'Accepted remote C conclusion' })
  }, 120_000)

  it('retains durable pending B as a real conflict when remote C arrives before note history flush', async test => {
    const f = await fixture(test)
    const remote = f.browser()
    const canvas = await remote.create('Durable draft remains an uncommitted local edit')
    const node = await remote.addNote(canvas, { body: 'Original', format: 'plain' })
    await remote.sync(canvas)
    const refresh = held()
    test.onTestFinished(refresh.resolve)
    let reads = 0
    const local = f.browser(f.api(async (method, path) => {
      if (method === 'GET' && path === `/physicsos/learning/canvases/${canvas}` && ++reads === 2) await refresh.promise
    }))
    await local.open(canvas)
    const namespace = local.documentSource(canvas).getSnapshot().namespace!
    const key = canvasNoteDraftKey(namespace, canvas, node)
    local.editNoteDraft(key, { body: 'Durable pending B', format: 'plain' })
    await vi.waitFor(async () => expect((await f.stores.get(local)!.read(namespace, canvas))?.pendingNoteDrafts)
      .toEqual(expect.arrayContaining([expect.objectContaining({ body: 'Durable pending B' })])))
    await remote.updateNote(canvas, node, 'Accepted remote C', 'plain')
    await remote.sync(canvas)
    refresh.resolve()
    await vi.waitFor(() => expect(local.noteDraftSource(key).getSnapshot()).toMatchObject({ body: 'Durable pending B', dirty: true, conflict: true }), { timeout: 10_000 })
    await expect(local.sync(canvas)).rejects.toThrow('CANVAS_NOTE_DRAFT_CONFLICT')
    const accepted = await f.api().forOwner({ schoolId: f.account.user.schoolId, username: f.account.user.username }).open(canvas)
    expect(accepted.manifest.nodes.find(value => value.id === node)).toMatchObject({ body: 'Accepted remote C' })
  }, 120_000)

  it('syncs a genuine server result without resubmitting server authority and synchronizes its downgraded independent copy', async test => {
    const f = await fixture(test)
    const controller = f.browser()
    const canvas = await controller.create('Account-saved server evidence')
    const instance = await controller.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 2, y: 0, z: 0 }, endTime: 1 }), source: { kind: 'template', id: 'uniform-linear' } })
    const capture = await controller.capture(canvas, instance)
    const verified = await controller.verifySnapshot(canvas, capture.alias.id)
    expect(verified.receipt.status).toBe('verified')
    expect(verified.resultDigest).toMatch(/^[0-9a-f]{64}$/)
    await controller.sync(canvas)
    expect(controller.getSnapshot().authScope).toBe('authenticated')
    expect(controller.documentSource(canvas).getSnapshot().status).toBe('saved')
    const fresh = f.browser()
    const reopened = await fresh.open(canvas)
    expect(reopened.manifest?.snapshots.some(alias => alias.snapshot.digest === verified.resultDigest)).toBe(true)
    const copied = await controller.duplicate(canvas, 'Independent evidence copy')
    const graph = await controller.exportGraph(copied)
    expect(Object.values(graph.objects).filter(object => object.kind === 'snapshot').every(object => object.source !== 'server-engine')).toBe(true)
    await controller.sync(copied)
    expect(controller.getSnapshot().authScope).toBe('authenticated')
    expect(controller.documentSource(copied).getSnapshot().status).toBe('saved')
    const copyView = await fresh.open(copied)
    expect(copyView.manifest?.snapshots.length).toBe(reopened.manifest?.snapshots.length)
  }, 120_000)

  it('finds an owned tombstone in a fresh browser trash list and restores its original note', async test => {
    const f = await fixture(test)
    const first = f.browser()
    const canvas = await first.create('Recover from account trash')
    const node = await first.addNote(canvas, { body: 'Keep this note through delete and restore', format: 'plain' })
    await first.sync(canvas)
    await first.remove(canvas)
    await first.sync(canvas)
    const fresh = f.browser()
    const trash = await fresh.list({ deleted: 'deleted' })
    expect(trash.map(item => item.id)).toContain(canvas)
    expect(trash.find(item => item.id === canvas)).toMatchObject({ deleted: true })
    await fresh.restore(canvas)
    await fresh.sync(canvas)
    const restored = await fresh.open(canvas)
    expect(restored.status).toBe('saved')
    expect(restored.manifest?.nodes.find(value => value.id === node)).toMatchObject({ body: 'Keep this note through delete and restore' })
  }, 120_000)

  it('downgrades copied server snapshot envelopes while retaining their full numerical evidence', async test => {
    const f = await fixture(test)
    const controller = f.browser()
    const canvas = await controller.create('Independent client evidence copy')
    const instance = await controller.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 2, y: 0, z: 0 }, endTime: 1 }), source: { kind: 'template', id: 'uniform-linear' } })
    const capture = await controller.capture(canvas, instance)
    const verified = await controller.verifySnapshot(canvas, capture.alias.id)
    const original = controller.documentSource(canvas).getSnapshot().objects[verified.resultDigest!]
    if (original?.kind !== 'snapshot') throw new Error('The real Host verification did not return a server snapshot.')
    const copy = await controller.duplicate(canvas, 'Offline-capable independent copy')
    const graph = await controller.exportGraph(copy)
    const results = Object.values(graph.objects).filter(object => object.kind === 'snapshot')
    expect(results.every(snapshot => snapshot.source !== 'server-engine')).toBe(true)
    const retained = results.find(snapshot => canonicalStringify(snapshot.result) === canonicalStringify(original.result))
    expect(retained?.result).toEqual(original.result)
    expect(retained?.capturedState).toEqual(original.capturedState)
    expect(retained?.engine).toEqual(original.engine)
  }, 120_000)
})
