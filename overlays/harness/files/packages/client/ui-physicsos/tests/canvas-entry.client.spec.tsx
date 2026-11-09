// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ClientContext } from '../src/client/runtime-compat.ts'
import { RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { ClientRoster, TestClient, remoteDefaultResponses, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { createMagneticScene } from '@physicsos/physics-scene'
import { canonicalStringify, copyJsonObject } from '@physicsos/physics-workbench/json'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { createCanvasEntryController } from '../src/client/canvas/callbacks.ts'
import { canvasExperimentOf, registerCanvasViews } from '../src/client/canvas/register.ts'
import { canvasHref, startCanvasNavigation } from '../src/client/canvas/navigation.ts'
import { createCanvasViewStore } from '../src/client/canvas/view-store.ts'
import type { CanvasController } from '../src/client/canvas/types.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import { createExperimentSceneRef, findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { createPhysicsSurfaceController, PHYSICS_PANEL_IDS, sceneRefOf } from '../src/client/surface-store.ts'
import { createLearningRecordController } from '../src/client/learning-record-store.ts'
import { createAuthController } from '../src/client/auth-store.ts'
import { createAuthApi } from '../src/client/auth-api.ts'
import { GOLDEN_QUESTIONS } from '@physicsos/question-core'
import { HomeActions } from '../src/client/HomeActions.tsx'
import { SceneCardBody } from '../src/client/SceneChatCard.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { solvedCardData } from './solved-card-fixture.client.ts'
import { en } from '../src/client/locales.ts'

const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')
const controllers: CanvasController[] = []
const assembledClients: TestClient[] = []
const databaseNames = new Set<string>()
const t = (key: keyof typeof en): string => en[key]
const productName = '@deepseek-ai/dsh-client-ui-physicsos-canvas-entry-test'
const entryOwners: ReturnType<typeof createCanvasEntryController>[] = []
const offline = () => {
  const name = `physicsos-canvas-entry-${randomUUID()}`
  databaseNames.add(name)
  let id = 0
  const controller = createCanvasController({
    api: createCanvasApi(async () => { throw new Error('This isolated offline entry must not send HTTP.') }),
    persistence: createCanvasPersistence({ name, hash }), getAccount: () => undefined,
    createRuntime: async options => createWorkbenchInstanceRuntime({ ...options, scheduler: null }),
    hash, id: prefix => `${prefix}-${name}-${++id}`, online: () => false,
    window: null, document: null, channel: null, schedule: () => 0, cancel: () => undefined,
  })
  controllers.push(controller)
  return controller
}

/** Exercise the product's real registration through the normal root layout and Loader. */
const assembledCanvas = async (controller: CanvasController) => {
  let rootContext: ClientContext | undefined
  let entry: ReturnType<typeof registerCanvasViews> | undefined
  const surface = createPhysicsSurfaceController(undefined, undefined, { selectSurface(next) {
    rootContext?.layout.selectPanel(next === 'home' ? null : PHYSICS_PANEL_IDS[next])
  } })
  const learning = createLearningRecordController()
  const auth = createAuthController(createAuthApi(), localStorage)
  const rows = [...webApp.without(['@deepseek-ai/dsh-client-ui-physicsos']).rows, {
    name: productName,
    inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-conversation'],
    immediately: false,
  }]
  const mock = RemoteMock.create().load(remoteDefaultResponses)
  const client = await TestClient.start({ roster: ClientRoster.of(rows), provide: { [productName]: {
    inject: ['slots', 'locale', 'layout'], apply(ctx: ClientContext) {
      rootContext = ctx
      ctx.effect(() => ctx.locale.register('physicsos', { en, zh: en }), 'canvas test dictionaries')
      entry = registerCanvasViews(ctx, controller, surface, auth, learning)
    },
  } } }, mock, { mount: true })
  assembledClients.push(client)
  if (entry === undefined) throw new Error('The real canvas registration did not apply.')
  return { client, surface, entry }
}

async function disposeEntryFixtures(): Promise<void> {
  cleanup()
  for (const owner of entryOwners.splice(0)) owner.dispose()
  await Promise.all(assembledClients.splice(0).map(client => client.dispose()))
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  await Promise.all([...databaseNames].map(name => deleteDB(name)))
  databaseNames.clear()
  window.history.replaceState(null, '', '/')
}
afterEach(disposeEntryFixtures)

describe('canvas entry object owner', () => {
  it('retains the chosen source outside the view store and adds the exact scene to an existing workbench', async () => {
    const controller = offline()
    const canvasId = await controller.create('Existing workbench')
    const view = createCanvasViewStore().create()
    const opens: string[] = []
    const entry = createCanvasEntryController({ controller, openCanvas: id => { if (id !== undefined) opens.push(id) }, sceneInput: canvasExperimentOf })
    entryOwners.push(entry)
    const stop = entry.bindViewActions(view.actions)
    const scene = createMagneticScene({ title: 'Real source' })
    entry.callbacks.requestSceneInCanvas(sceneRefOf({ sceneId: String(scene.id), scene, canvasTemplateId: 'magnetic-uniform',
      canvasSource: { kind: 'template', id: 'magnetic-uniform', title: 'Real source' },
      canvasTemplateRelease: { id: 'magnetic-uniform', version: '1' } }))
    const key = view.getSnapshot().pendingSourceKey!
    const source = entry.incomingSource(key)
    expect(entry.incomingSource(key)).toBe(source)
    expect(source.getSnapshot()).toMatchObject({ key, title: 'Real source', status: 'ready' })
    expect(view.getSnapshot()).not.toHaveProperty('scene')
    const result = await entry.callbacks.addPendingCanvasSource(key, canvasId)
    expect(result.canvasId).toBe(canvasId)
    expect(opens).toEqual([canvasId])
    const document = controller.documentSource(canvasId).getSnapshot()
    const instance = document.manifest!.instances.find(item => item.instanceId === result.instanceId)!
    expect(instance.source.metadata).toMatchObject({ sourceSceneId: String(scene.id) })
    expect(instance.templateId).toBe('magnetic-uniform')
    expect(instance.templateRelease).toEqual({ id: 'magnetic-uniform', version: '1' })
    expect(instance.source.kind).toBe('template')
    const origin = document.objects[instance.originScene.digest]
    expect(origin?.kind).toBe('scene')
    if (origin?.kind === 'scene') expect(origin.scene).toEqual(scene)
    expect(view.getSnapshot().pendingSourceKey).toBeUndefined()
    expect(source.getSnapshot()).toBeUndefined()
    stop(); entry.dispose()
  })

  it('cancels an in-flight source selection without navigating or notifying after its owner scope is cleared', async () => {
    const controller = offline()
    const canvasId = await controller.create('Existing destination')
    const view = createCanvasViewStore().create()
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const originalAdd = controller.addExperiment
    const add = vi.spyOn(controller, 'addExperiment').mockImplementation(async (...args) => {
      await blocked
      return originalAdd(...args)
    })
    onTestFinished(() => { release(); add.mockRestore() })
    const openCanvas = vi.fn()
    const entry = createCanvasEntryController({ controller, openCanvas, sceneInput: canvasExperimentOf })
    entryOwners.push(entry)
    entry.bindViewActions(view.actions)
    entry.callbacks.requestSceneInCanvas({ sceneId: 'retained-source', scene: createMagneticScene() })
    const key = view.getSnapshot().pendingSourceKey!
    const source = entry.incomingSource(key)
    const inserting = entry.callbacks.addPendingCanvasSource(key, canvasId)
    expect(add).toHaveBeenCalledTimes(1)
    expect(source.getSnapshot()?.status).toBe('adding')
    entry.clearAccount()
    release()
    await inserting
    expect(openCanvas).not.toHaveBeenCalled()
    expect(view.getSnapshot().pendingSourceKey).toBeUndefined()
    expect(view.getSnapshot().toast).toBeUndefined()
    expect(source.getSnapshot()).toBeUndefined()
  })

  it('moves a newly created empty target out of the live roster when its pending source selection was canceled mid-create', async () => {
    const controller = offline()
    await controller.create('Existing document')
    const originalCreate = controller.create
    let finish!: (canvasId: string) => void
    let started!: (canvasId: string) => void
    const begun = new Promise<string>(resolve => { started = resolve })
    const create = vi.spyOn(controller, 'create').mockImplementation(async title => {
      const canvasId = await originalCreate(title)
      started(canvasId)
      return new Promise<string>(resolve => { finish = resolve })
    })
    onTestFinished(() => { create.mockRestore() })
    const view = createCanvasViewStore().create()
    const entry = createCanvasEntryController({ controller, openCanvas: vi.fn(), sceneInput: canvasExperimentOf })
    entryOwners.push(entry)
    entry.bindViewActions(view.actions)
    entry.callbacks.requestSceneInCanvas({ sceneId: 'source', scene: createMagneticScene() })
    const key = view.getSnapshot().pendingSourceKey!
    const insertion = entry.callbacks.addPendingToNewCanvas(key, 'Canceled target')
    const rejected = expect(insertion).rejects.toThrow('CANVAS_SOURCE_MISSING')
    const canvasId = await begun
    entry.callbacks.cancelPendingCanvasSource(key)
    finish(canvasId)
    await rejected
    expect(controller.getSnapshot().documents.find(item => item.id === canvasId)?.deleted).toBe(true)
    expect(controller.getSnapshot().documents.filter(item => !item.deleted && item.title === 'Canceled target')).toHaveLength(0)
  })

  it('never lets a delayed legacy template lookup replace a newer source or reopen a canceled chooser', async () => {
    const controller = offline()
    const view = createCanvasViewStore().create()
    let resolved!: (input: ReturnType<typeof canvasExperimentOf>) => void
    const waiting = new Promise<ReturnType<typeof canvasExperimentOf>>(resolve => { resolved = resolve })
    const entry = createCanvasEntryController({ controller, openCanvas: vi.fn(), sceneInput: ref =>
      ref.sceneId === 'legacy' ? waiting : canvasExperimentOf(ref) })
    entryOwners.push(entry)
    entry.bindViewActions(view.actions)
    const older = { sceneId: 'legacy', scene: createMagneticScene({ title: 'Older source' }) }
    entry.callbacks.requestSceneInCanvas(older)
    entry.callbacks.requestCanvasSource({ scene: createMagneticScene({ title: 'Newer source' }), source: { kind: 'template' } })
    const key = view.getSnapshot().pendingSourceKey!
    expect(entry.incomingSource(key).getSnapshot()?.title).toBe('Newer source')
    entry.callbacks.cancelPendingCanvasSource(key)
    resolved(canvasExperimentOf(older))
    await waiting
    await Promise.resolve()
    expect(view.getSnapshot().pendingSourceKey).toBeUndefined()
    expect(entry.incomingSource(key).getSnapshot()).toBeUndefined()
  })

  it('ordinary Home creation is single-flight without hiding a failed create or duplicating a workbench', async () => {
    const controller = offline()
    const view = createCanvasViewStore().create()
    const openCanvas = vi.fn()
    const entry = createCanvasEntryController({ controller, openCanvas, sceneInput: canvasExperimentOf })
    entryOwners.push(entry)
    entry.bindViewActions(view.actions)
    const first = entry.callbacks.newCanvas('One new workbench')
    const second = entry.callbacks.newCanvas('One new workbench')
    expect(second).toBe(first)
    expect(await first).toBe(await second)
    expect(controller.getSnapshot().documents.filter(item => item.title === 'One new workbench')).toHaveLength(1)
    expect(openCanvas).toHaveBeenCalledTimes(1)
    expect(view.getSnapshot().toast?.key).toBe('canvas.created')
  })

  it('does not reuse an old account new-workbench promise for a later account intent', async () => {
    const controller = offline()
    const original = controller.create
    let release!: (id: string) => void
    let started!: (id: string) => void
    const begun = new Promise<string>(resolve => { started = resolve })
    let first = true
    const create = vi.spyOn(controller, 'create').mockImplementation(async title => {
      const id = await original(title)
      if (!first) return id
      first = false
      started(id)
      return new Promise<string>(resolve => { release = resolve })
    })
    onTestFinished(() => { create.mockRestore() })
    const entry = createCanvasEntryController({ controller, openCanvas: vi.fn(), sceneInput: canvasExperimentOf })
    entryOwners.push(entry)
    const pending = entry.callbacks.newCanvas('Before account change')
    const oldId = await begun
    entry.clearAccount()
    const next = entry.callbacks.newCanvas('After account change')
    release(oldId)
    expect(await next).not.toBe(await pending)
    expect(controller.getSnapshot().documents.filter(item => !item.deleted)).toHaveLength(2)
  })

  it('does not duplicate a newly created workbench on double click, and retains failed sources for retry', async () => {
    const controller = offline()
    await controller.create('Unused real initial document')
    const view = createCanvasViewStore().create()
    const entry = createCanvasEntryController({ controller, openCanvas: () => undefined, sceneInput: canvasExperimentOf })
    entryOwners.push(entry)
    entry.bindViewActions(view.actions)
    entry.callbacks.requestSceneInCanvas({ sceneId: 'source', scene: createMagneticScene() })
    const key = view.getSnapshot().pendingSourceKey!
    const results = await Promise.all([entry.callbacks.addPendingToNewCanvas(key, 'New target'), entry.callbacks.addPendingToNewCanvas(key, 'New target')])
    expect(results[0]).toEqual(results[1])
    expect(controller.getSnapshot().documents.filter(item => item.title === 'New target')).toHaveLength(1)
    entry.callbacks.requestSceneInCanvas({ sceneId: 'source-2', scene: createMagneticScene() })
    const failedKey = view.getSnapshot().pendingSourceKey!
    await expect(entry.callbacks.addPendingCanvasSource(failedKey, 'missing-canvas')).rejects.toThrow()
    expect(entry.incomingSource(failedKey).getSnapshot()?.status).toBe('error')
    expect(view.getSnapshot().pendingSourceKey).toBe(failedKey)
    entry.clearAccount()
    expect(view.getSnapshot().pendingSourceKey).toBeUndefined()
    expect(entry.incomingSource(failedKey).getSnapshot()).toBeUndefined()
    entry.dispose()
  })
})

describe('canvas normal-user entry controls', () => {
  it('opens real workbench commands from Home and keeps recent source provenance', () => {
    const scene = createMagneticScene({ title: 'Recent real scene' })
    const recent = createSnapshotStore({ items: [{ sceneId: String(scene.id), scene, title: 'Recent real scene', domain: 'magnetic',
      kind: 'experiment' as const, updatedAt: new Date().toISOString(), originScene: scene, buildMode: true as const }] })
    const newCanvas = vi.fn(async () => 'canvas')
    const openCanvasView = vi.fn()
    const requestSceneInCanvas = vi.fn()
    render(<HomeActions t={t} openSurface={vi.fn()} openCanvasView={openCanvasView} newCanvas={newCanvas}
      requestSceneInCanvas={requestSceneInCanvas} useRecentExperiments={selector => selector(recent.getSnapshot())} />)
    fireEvent.click(screen.getByRole('button', { name: t('canvas.new') }))
    expect(newCanvas).toHaveBeenCalledWith(t('canvas.untitled'))
    fireEvent.click(screen.getByRole('button', { name: t('canvas.open') }))
    expect(openCanvasView).toHaveBeenCalledWith()
    fireEvent.click(screen.getByRole('button', { name: `${t('canvas.addToCanvas')} · Recent real scene` }))
    expect(requestSceneInCanvas).toHaveBeenCalledWith(expect.objectContaining({ scene, originScene: scene, buildMode: true }))
  })

  it('allows the real solved chat scene to be added without pretending its code renderer is ready', () => {
    const question = GOLDEN_QUESTIONS[0]
    if (question === undefined) throw new Error('The actual question corpus is empty.')
    const data = solvedCardData(question.id)
    const requestSceneInCanvas = vi.fn()
    render(<SceneCardBody data={data} t={t} openSceneInLab={vi.fn()} requestSceneInCanvas={requestSceneInCanvas} />)
    fireEvent.click(screen.getByRole('button', { name: t('canvas.addToCanvas') }))
    expect(requestSceneInCanvas).toHaveBeenCalledTimes(1)
    const ref = requestSceneInCanvas.mock.calls[0]![0]
    expect(ref.sceneId).toBe(data.sceneId)
    expect(canonicalStringify(copyJsonObject(ref.scene))).toBe(canonicalStringify(data.scene))
  })
})

describe('canvas independent URL ownership', () => {
  it('restores encoded workbench IDs and never creates a fallback document for malformed history', () => {
    const surface = createPhysicsSurfaceController()
    const original = createMagneticScene()
    surface.open('lab', { sceneId: String(original.id), scene: original })
    window.history.replaceState(null, '', canvasHref('canvas/a 中文'))
    const stop = startCanvasNavigation(surface, window)
    expect(surface.store.getSnapshot()).toMatchObject({ surface: 'canvas', canvasId: 'canvas/a 中文', sceneRef: { scene: original } })
    surface.openCanvas('second')
    expect(window.location.hash).toBe(canvasHref('second'))
    window.history.replaceState(null, '', '#/canvases/%E0%A4%A')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(surface.store.getSnapshot().surface).toBe('canvas')
    expect(surface.store.getSnapshot().canvasId).toBeUndefined()
    expect(surface.store.getSnapshot().sceneRef?.scene).toBe(original)
    stop()
  })
})

describe('canvas production slot assembly', () => {
  // Full web-roster transforms belong to fixture setup, as in TestClient's own cold-boot integration test.
  beforeAll(async () => {
    const controller = offline()
    try {
      const { client, surface } = await assembledCanvas(controller)
      const template = findExperimentTemplate('magnetic-circular')
      if (template === undefined) throw new Error('The shipped magnetic template is missing.')
      await act(async () => {
        const canvasId = await controller.create('Loader cold-boot fixture')
        await controller.addExperiment(canvasId, canvasExperimentOf(createExperimentSceneRef(template, 'Loader cold-boot fixture')))
        surface.openCanvas(canvasId)
        await client.flush()
      })
      await waitFor(() => {
        expect(client.container?.querySelector('[data-physicsos-canvas-workspace]')).toBeTruthy()
        expect(client.container?.querySelector('[data-canvas-instance-stage]')).toBeTruthy()
      }, { timeout: 10_000 })
    } finally {
      await disposeEntryFixtures()
    }
  }, 60_000)

  it.each(['catalog', 'home'] as const)('opens the registered %s source chooser with no selected document owner', async destination => {
    const controller = offline()
    const { client, surface, entry } = await assembledCanvas(controller)
    const errors = vi.spyOn(console, 'error')
    onTestFinished(() => errors.mockRestore())
    const template = findExperimentTemplate('magnetic-circular')
    if (template === undefined) throw new Error('The shipped magnetic template is missing.')
    const ref = createExperimentSceneRef(template, 'Source before choosing a workbench')
    const scene = ref.scene

    await act(async () => {
      if (destination === 'catalog') surface.openCanvas()
      entry.requestSceneInCanvas({ ...ref, canvasTemplateId: template.id,
        canvasSource: { kind: 'template', id: template.id, title: 'Source before choosing a workbench' } })
      await client.flush()
    })
    expect(surface.store.getSnapshot().canvasId).toBeUndefined()
    expect(controller.getSnapshot().documents).toEqual([])
    await waitFor(() => {
      const details = errors.mock.calls.map(args => args.map(String).join(' ')).join('\n')
      expect(screen.queryByRole('dialog', { name: t('canvas.chooseCanvas') }), details).not.toBeNull()
    }, { timeout: 10_000 })
    const chooser = screen.getByRole('dialog', { name: t('canvas.chooseCanvas') })
    fireEvent.change(within(chooser).getByRole('textbox', { name: t('canvas.name') }), {
      target: { value: `Workbench from ${destination}` },
    })
    fireEvent.click(within(chooser).getByRole('button', { name: t('canvas.addNewCanvas') }))

    await waitFor(() => expect(controller.getSnapshot().documents).toHaveLength(1))
    await waitFor(() => expect(surface.store.getSnapshot().canvasId).toBeTruthy())
    const selected = surface.store.getSnapshot().canvasId
    const saved = controller.documentSource(selected!).getSnapshot()
    expect(saved.manifest?.title).toBe(`Workbench from ${destination}`)
    expect(saved.manifest?.instances).toHaveLength(1)
    const instance = saved.manifest!.instances[0]!
    const source = saved.objects[instance.originScene.digest]
    expect(source?.kind).toBe('scene')
    if (source?.kind === 'scene') expect(source.scene).toEqual(scene)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('canvas.chooseCanvas') })).toBeNull())
    expect(errors.mock.calls.filter(args => String(args[0]).includes("slot entry crashed in 'shell.overlay'"))).toEqual([])
    expect(() => controller.documentSource('')).toThrow('/canvasId')
  })

  it('mounts the registered root, shared overlay and node factories through TestClient Loader, with one owner source', async () => {
    const controller = offline()
    const { client, surface } = await assembledCanvas(controller)
    const slots = client.ctx.slots
    expect(slots.entries('main').filter(entry => entry.options.key === 'physicsos-canvas')).toHaveLength(1)
    expect(slots.snapshot('factory:physicsos.canvas.workbench')).toEqual([expect.objectContaining({ type: 'factory', name: 'physicsos.canvas.workbench', scope: 'root' })])
    const instanceFactory = slots.snapshot('factory:physicsos.canvas.instance')
    expect(instanceFactory).toEqual([expect.objectContaining({ type: 'factory', name: 'physicsos.canvas.instance', scope: 'root',
      children: [expect.objectContaining({ type: 'slot', name: 'physicsos.canvas.frame', kind: 'single', scope: 'root' })] })])
    const main = slots.entries('main').find(entry => entry.options.key === 'physicsos-canvas')!
    const frame = slots.entries('physicsos.canvas.frame')[0]!
    const overlay = slots.entries('shell.overlay').find(entry => entry.options.id === 'physicsos-canvas-overlay')!
    expect(main.store).toBe(frame.store)
    expect(main.store).toBe(overlay.store)
    await act(async () => { surface.openCanvas(); await client.flush() })
    const host = within(client.container!)
    expect(surface.store.getSnapshot().surface).toBe('canvas')
    expect(client.ctx.layout.panelInfo.getSnapshot().activePanelId).toBe(PHYSICS_PANEL_IDS.canvas)
    await waitFor(() => expect(host.queryByRole('heading', { name: t('canvas.title') }), client.container?.textContent ?? '').not.toBeNull(), { timeout: 10_000 })
    fireEvent.click(host.getAllByRole('button', { name: t('canvas.new') })[0]!)
    const modal = await screen.findByRole('dialog', { name: t('canvas.new') })
    fireEvent.change(within(modal).getByRole('textbox', { name: t('canvas.name') }), { target: { value: 'Real assembled workbench' } })
    fireEvent.click(within(modal).getByRole('button', { name: t('canvas.confirm') }))
    await waitFor(() => expect(controller.getSnapshot().documents.some(item => item.title === 'Real assembled workbench')).toBe(true))
    await waitFor(() => expect(client.container!.querySelector('[data-physicsos-canvas-workspace]')).toBeTruthy())
    await client.dispose()
    expect(slots.snapshot('factory:physicsos.canvas.workbench')).toEqual([])
    expect(slots.entries('shell.overlay').some(entry => entry.options.id === 'physicsos-canvas-overlay')).toBe(false)
  })
})
