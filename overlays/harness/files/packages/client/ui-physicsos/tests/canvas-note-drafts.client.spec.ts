import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import type { CanvasAccount, CanvasController, CanvasControllerOptions } from '../src/client/canvas/types.ts'
import * as canvasTypes from '../src/client/canvas/types.ts'

const controllers: CanvasController[] = []
const databases = new Set<string>()
const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')
let identity = 0
const fixture = (options: Partial<CanvasControllerOptions> = {}) => {
  const name = `canvas-note-drafts-${randomUUID()}`
  databases.add(name)
  const persistence = createCanvasPersistence({ name, hash })
  const controller = createCanvasController({ persistence,
    api: createCanvasApi(async () => { throw new Error('A local note draft must not issue a network request.') }),
    getAccount: () => undefined,
    createRuntime: async () => { throw new Error('A note draft must not instantiate a physics engine.') },
    hash, id: prefix => `${prefix}-${++identity}`, now: () => new Date().toISOString(), online: () => false,
    schedule: () => 0, cancel: () => undefined, window: null, document: null, channel: null, ...options })
  controllers.push(controller)
  return { controller, persistence }
}
const keyOf = (namespace: string, canvas: string, node: string): string => canvasTypes.canvasNoteDraftKey?.(namespace, canvas, node)
  ?? JSON.stringify([namespace, canvas, 'note', node])
const textOf = (controller: CanvasController, canvas: string, node: string): string | undefined => {
  const value = controller.documentSource(canvas).getSnapshot().manifest?.nodes.find(value => value.id === node)
  return value?.kind === 'note' ? value.body : undefined
}
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  await Promise.all([...databases].map(name => deleteDB(name)))
  databases.clear()
})

describe('owned namespace-qualified note drafts', () => {
  it('stages the latest text synchronously and marks it unsaved before a debounce can run', async () => {
    const { controller } = fixture()
    const canvas = await controller.create('Immediate draft ownership')
    const note = await controller.addNote(canvas, { body: 'Original', format: 'plain' })
    const key = keyOf('guest|local', canvas, note)
    controller.editNoteDraft?.(key, { body: 'Newest body held before leaving', format: 'markdown' })
    expect(controller.noteDraftSource?.(key).getSnapshot()).toMatchObject({
      body: 'Newest body held before leaving', format: 'markdown', dirty: true, conflict: false,
    })
    expect(controller.documentSource(canvas).getSnapshot().localSaved).toBe(false)
    await controller.flush(canvas)
    expect(textOf(controller, canvas, note)).toBe('Newest body held before leaving')
    expect(controller.noteDraftSource?.(key).getSnapshot()?.dirty).toBe(false)
  })

  it('includes uncommitted note text in export, node copy and whole-workbench duplication', async () => {
    const { controller } = fixture()
    const canvas = await controller.create('Draft transfer barriers')
    const note = await controller.addNote(canvas, { body: 'Original', format: 'plain' })
    const key = keyOf('guest|local', canvas, note)
    controller.editNoteDraft?.(key, { body: 'Export must contain this draft', format: 'plain' })
    const exported = await controller.exportGraph(canvas)
    expect(exported.manifest.nodes.find(value => value.id === note)).toMatchObject({ body: 'Export must contain this draft' })
    controller.editNoteDraft?.(key, { body: 'Node copy must contain this draft', format: 'markdown' })
    await controller.copyNodes(canvas, [note])
    const copiedIds = await controller.pasteNodes(canvas)
    expect(controller.documentSource(canvas).getSnapshot().manifest?.nodes.find(value => value.id === copiedIds[0])).toMatchObject({ body: 'Node copy must contain this draft' })
    controller.editNoteDraft?.(key, { body: 'Workbench copy must contain this draft', format: 'plain' })
    const copiedCanvas = await controller.duplicate(canvas)
    expect(controller.documentSource(copiedCanvas).getSnapshot().manifest?.nodes.some(value => value.kind === 'note' && value.body === 'Workbench copy must contain this draft')).toBe(true)
  })

  it('rejects a stale qualified key after an account switch even when both accounts use identical document and node IDs', async () => {
    let account: CanvasAccount = { id: 'A', username: 'A', schoolId: 'school' }
    const counts = new Map<string, number>()
    const { controller, persistence } = fixture({ getAccount: () => account, id: prefix => {
      const next = (counts.get(account.id) ?? 0) + 1
      counts.set(account.id, next)
      return `${prefix}-same-${next}`
    } })
    const canvasA = await controller.create('A')
    const noteA = await controller.addNote(canvasA, { body: 'A original', format: 'plain' })
    const key = keyOf('A|school', canvasA, noteA)
    controller.editNoteDraft?.(key, { body: 'A private pending draft', format: 'plain' })
    account = { id: 'B', username: 'B', schoolId: 'school' }
    await controller.refreshAccount()
    const canvasB = await controller.create('B')
    const noteB = await controller.addNote(canvasB, { body: 'B original', format: 'plain' })
    expect([canvasB, noteB]).toEqual([canvasA, noteA])
    expect(controller.noteDraftSource?.(key).getSnapshot()).toBeUndefined()
    let refused: unknown
    try { controller.editNoteDraft?.(key, { body: 'Late A callback', format: 'plain' }) } catch (error) { refused = error }
    expect(refused).toMatchObject({ code: 'CANVAS_ACCOUNT_CHANGED', status: 401 })
    await expect(controller.flushNoteDraft?.(key) ?? Promise.resolve()).rejects.toMatchObject({ code: 'CANVAS_ACCOUNT_CHANGED', status: 401 })
    expect(textOf(controller, canvasB, noteB)).toBe('B original')
    expect((await persistence.read('B|school', canvasB))?.working.nodes.find(value => value.id === noteB)).toMatchObject({ body: 'B original' })
    account = { id: 'A', username: 'A', schoolId: 'school' }
    await controller.refreshAccount()
    await controller.open(canvasA)
    await controller.flush(canvasA)
    expect(textOf(controller, canvasA, noteA)).toBe('A private pending draft')
  })

  it('retains newer B after a failed A write and commits one note history edit when saving is retried', async test => {
    const { controller, persistence } = fixture()
    const canvas = await controller.create('Failed A, retained B')
    const note = await controller.addNote(canvas, { body: 'Original', format: 'plain' })
    const key = keyOf('guest|local', canvas, note)
    const before = (await persistence.read('guest|local', canvas))!
    const save = persistence.save.bind(persistence)
    let reachedA = false
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    test.onTestFinished(release)
    vi.spyOn(persistence, 'save').mockImplementation(async (...args) => {
      const value = args[0].working.nodes.find(value => value.id === note)
      if (!reachedA && value?.kind === 'note' && value.body === 'A') {
        reachedA = true
        await wait
        throw new Error('Storage failed while committing A')
      }
      return save(...args)
    })
    controller.editNoteDraft?.(key, { body: 'A', format: 'plain' })
    const writingA = controller.flushNoteDraft?.(key) ?? Promise.resolve()
    void writingA.catch(() => undefined)
    await vi.waitFor(() => expect(reachedA).toBe(true))
    controller.editNoteDraft?.(key, { body: 'B typed while A was in flight', format: 'markdown' })
    release()
    await expect(writingA).rejects.toThrow('Storage failed while committing A')
    expect(controller.noteDraftSource?.(key).getSnapshot()).toMatchObject({
      body: 'B typed while A was in flight', dirty: true, conflict: false,
    })
    await controller.flushNoteDraft?.(key)
    const saved = (await persistence.read('guest|local', canvas))!
    expect(saved.working.nodes.find(value => value.id === note)).toMatchObject({ body: 'B typed while A was in flight', format: 'markdown' })
    expect(saved.documentHistory?.past.length).toBe((before.documentHistory?.past.length ?? 0) + 1)
    expect(controller.noteDraftSource?.(key).getSnapshot()).toMatchObject({ body: 'B typed while A was in flight', dirty: false, conflict: false })
  })

  it('round-trips optional pending note JSON without upgrading IndexedDB or losing legacy records', async () => {
    const { controller, persistence } = fixture()
    const canvas = await controller.create('Compatible note checkpoint')
    const nodeId = await controller.addNote(canvas, { body: 'Original', format: 'plain' })
    const legacy = (await persistence.read('guest|local', canvas))!
    const next = { ...legacy, pendingNoteDrafts: [{ nodeId, writerId: 'writer-fixture', revision: 1,
      body: 'Pending body after reload', format: 'markdown' as const, baseBody: 'Original', baseFormat: 'plain' as const }] }
    await expect(persistence.save(next, {}, legacy.cacheVersion)).resolves.toMatchObject({ pendingNoteDrafts: next.pendingNoteDrafts })
    expect((await persistence.read('guest|local', canvas))?.pendingNoteDrafts).toEqual(next.pendingNoteDrafts)
    const roundTrip = (await persistence.read('guest|local', canvas))!
    const { pendingNoteDrafts: _drafts, ...withoutDrafts } = roundTrip
    await expect(persistence.save(withoutDrafts, {}, roundTrip.cacheVersion)).resolves.toMatchObject({ working: legacy.working })
  })
})
