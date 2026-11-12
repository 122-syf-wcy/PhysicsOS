import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMagneticScene, createMechanicsScene } from '@physicsos/physics-scene'
import { canonicalStringify, copyJsonObject } from '@physicsos/physics-workbench/json'
import { parseGraph, validateGraph, verifyGraphDigests } from '@physicsos/physics-workbench/graph'
import { parseDatasetsCsv } from '@physicsos/physics-workbench/csv'
import type { CanvasGraph } from '@physicsos/physics-workbench/types'
import { loadCanvasFixture } from '../../../physicsos/learning-host/tests/canvas-fixture.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import type { CanvasAccount, CanvasController, CanvasControllerOptions } from '../src/client/canvas/types.ts'
import { draftToScene, starterDraft } from '../src/client/physics/circuit-builder.ts'
import { createWorkbenchInstanceRuntime, type CreateWorkbenchInstanceOptions, type WorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

const controllers: CanvasController[] = []
const databaseNames = new Set<string>()
const databaseName = (prefix: string): string => {
  const name = `${prefix}-${randomUUID()}`
  databaseNames.add(name)
  return name
}
const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')
const hashCanonical = async (value: string): Promise<string> => createHash('sha256').update(value, 'utf8').digest('hex')
let fixtureId = 0
const fixture = (overrides: Partial<CanvasControllerOptions> = {}) => {
  const fixture = ++fixtureId
  let identity = 0
  let instant = 0
  const runtimes: WorkbenchInstanceRuntime[] = []
  const runtimeFactory = vi.fn(async (options: CreateWorkbenchInstanceOptions) => {
    const runtime = createWorkbenchInstanceRuntime({ ...options, scheduler: null })
    runtimes.push(runtime)
    return runtime
  })
  const controller = createCanvasController({
    api: createCanvasApi(async () => { throw new Error('The offline data fixture must not issue an HTTP request.') }),
    persistence: createCanvasPersistence({ name: databaseName('physicsos-canvas-data'), hash }),
    getAccount: () => undefined, createRuntime: runtimeFactory,
    hash, id: prefix => `${prefix}-${fixture}-${++identity}`,
    now: () => new Date(Date.UTC(2026, 10, 8, 0, 0, 0, instant++)).toISOString(),
    online: () => false, schedule: () => 0, cancel: () => undefined, window: null, document: null, channel: null,
    ...overrides,
  })
  controllers.push(controller)
  return { controller, runtimeFactory, runtimes }
}
const currentInstance = (controller: CanvasController, canvas: string, instanceId: string) => {
  const manifest = controller.documentSource(canvas).getSnapshot().manifest
  const instance = manifest?.instances.find(value => value.instanceId === instanceId)
  if (instance === undefined) throw new Error('The real instance is missing from the working manifest.')
  return instance
}
const snapshot = (controller: CanvasController, canvas: string, aliasId: string) => {
  const document = controller.documentSource(canvas).getSnapshot()
  const alias = document.manifest?.snapshots.find(value => value.id === aliasId)
  const value = alias === undefined ? undefined : document.objects[alias.snapshot.digest]
  if (value?.kind !== 'snapshot') throw new Error('The immutable captured payload is missing.')
  return { alias: alias!, value }
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  await Promise.all([...databaseNames].map(name => deleteDB(name)))
  databaseNames.clear()
})

describe('canvas object ownership and stable sources', () => {
  it('keeps two documents and two copies of the same template physically and temporally isolated', async () => {
    const { controller, runtimes } = fixture()
    const scene = createMagneticScene({ title: 'Shared template' })
    const originalScene = canonicalStringify(copyJsonObject(scene))
    const firstDocument = await controller.create('First document')
    const secondDocument = await controller.create('Second document')
    const first = await controller.addExperiment(firstDocument, { scene, source: { kind: 'template', id: 'magnetic' } })
    const second = await controller.addExperiment(firstDocument, { scene, source: { kind: 'template', id: 'magnetic' } })
    const third = await controller.addExperiment(secondDocument, { scene, source: { kind: 'template', id: 'magnetic' } })
    const keys = [controller.instanceKey(firstDocument, first), controller.instanceKey(firstDocument, second), controller.instanceKey(secondDocument, third)]
    const scenes = keys.map(key => runtimes.find(owner => owner.instanceKey === key && !owner.getSnapshot().disposed)!.getScene())
    expect(new Set(scenes.map(scene => scene.id)).size).toBe(3)
    const secondBefore = currentInstance(controller, firstDocument, second)
    const thirdBefore = currentInstance(controller, secondDocument, third)
    const summary = controller.instanceSource(keys[0]!).getSnapshot()!
    const field = summary.workspace.inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === 'magnetic-field')
      ?? summary.workspace.inspector.flatMap(section => section.parameters ?? [])[0]
    expect(field).toBeDefined()
    const next = field!.value * 1.1
    await controller.instanceAction(keys[0]!, 'editParameter', field!.id, next)
    await controller.instanceAction(keys[0]!, 'setRunning', true)
    const firstOwner = runtimes.find(owner => owner.instanceKey === keys[0] && !owner.getSnapshot().disposed)!
    firstOwner.advance(0.01)
    await controller.instanceAction(keys[0]!, 'setRunning', false)
    await controller.flush(firstDocument)
    expect(currentInstance(controller, firstDocument, first).instanceEditRevision).toBeGreaterThan(0)
    expect(currentInstance(controller, firstDocument, second)).toEqual(secondBefore)
    expect(currentInstance(controller, secondDocument, third)).toEqual(thirdBefore)
    expect(controller.frameSource(keys[1]!).getSnapshot()!.clock.time).toBe(0)
    expect(controller.frameSource(keys[2]!).getSnapshot()!.clock.time).toBe(0)
    expect(canonicalStringify(copyJsonObject(scene))).toBe(originalScene)
    expect(currentInstance(controller, firstDocument, first).source).toEqual({ kind: 'template', id: 'magnetic' })
  })

  it('creates keyed cells before asynchronous owner loading and never rebuilds an owner for a layout move', async () => {
    const { controller, runtimeFactory } = fixture()
    const canvas = await controller.create('Stable sources')
    const instance = await controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'template' } })
    const key = controller.instanceKey(canvas, instance)
    const summary = controller.instanceSource(key)
    const frames = controller.frameSource(key)
    expect(controller.instanceSource(key)).toBe(summary)
    expect(controller.frameSource(key)).toBe(frames)
    const before = summary.getSnapshot()
    expect(summary.getSnapshot()).toBe(before)
    const calls = runtimeFactory.mock.calls.length
    const node = controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.kind === 'experiment')!
    await controller.updateLayout(canvas, [{ id: node.id, layout: { x: 500, y: 300 } }])
    expect(runtimeFactory.mock.calls.length).toBe(calls)
    expect(summary.getSnapshot()).toBe(before)
    const unsubscribe = summary.subscribe(vi.fn())
    unsubscribe()
    await controller.removeNodes(canvas, [node.id])
    expect(summary.getSnapshot()).toBeUndefined()
    await controller.undo(canvas)
    await controller.instanceAction(key, 'setRunning', false)
    expect(controller.instanceSource(key)).toBe(summary)
    expect(summary.getSnapshot()).toBeDefined()
  })

  it('preserves a live focus display when the ordinary card becomes offscreen', async () => {
    const { controller, runtimes } = fixture()
    const canvas = await controller.create('Two displays')
    const instance = await controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'template' } })
    const key = controller.instanceKey(canvas, instance)
    const owner = runtimes.find(runtime => runtime.instanceKey === key && !runtime.getSnapshot().disposed)!
    const attach = vi.spyOn(owner, 'attachDisplay')
    const detach = vi.spyOn(owner, 'detachDisplay')
    const cardOff = controller.attachDisplay(key, 'card')
    const focusOff = controller.attachDisplay(key, 'focus')
    await controller.instanceAction(key, 'setRunning', true)
    controller.setDisplayVisible(key, 'card', false)
    expect(detach.mock.calls.some(([display]) => display === 'card')).toBe(true)
    expect(detach.mock.calls.some(([display]) => display === 'focus')).toBe(false)
    expect(owner.getSnapshot().clock.running).toBe(true)
    controller.setDisplayVisible(key, 'card', true)
    expect(attach.mock.calls.filter(([display]) => display === 'card')).toHaveLength(2)
    focusOff(); cardOff()
    expect(owner.getSnapshot().disposed).toBe(false)
    expect(owner.getSnapshot().clock.running).toBe(true)
  })
})

describe('captured immutable graphs and document editing', () => {
  it('retains genuine raw results, every dependency, source, aliases and CSV after deleting the live experiment', async () => {
    const { controller } = fixture()
    const canvas = await controller.create('Capture archive')
    const instance = await controller.addExperiment(canvas, {
      scene: createMechanicsScene({ model: 'uniformly_accelerated_motion', mass: 1,
        position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, acceleration: { x: 0.2, y: 0, z: 0 } }),
      source: { kind: 'question', questionId: 'source-question', title: 'Original problem', metadata: { curriculum: 'mechanics' } },
    })
    const key = controller.instanceKey(canvas, instance)
    const captured = await controller.capture(canvas, instance, 'First reading')
    const immutable = snapshot(controller, canvas, captured.alias.id)
    const originalBytes = canonicalStringify(immutable.value)
    expect(immutable.value.source).toBe('client-engine')
    expect(immutable.value.result ?? immutable.value.capturedState ?? immutable.value.rawState).toBeDefined()
    expect(immutable.value.datasets.length).toBeGreaterThan(0)
    expect(immutable.value.request?.sceneRevision).toBe(immutable.value.sceneRevision)
    const heldScene = controller.documentSource(canvas).getSnapshot().objects[immutable.value.scene.digest]
    expect(heldScene?.kind).toBe('scene')
    await controller.renameSnapshot(canvas, captured.alias.id, 'Renamed only')
    expect(snapshot(controller, canvas, captured.alias.id).alias.title).toBe('Renamed only')
    expect(canonicalStringify(snapshot(controller, canvas, captured.alias.id).value)).toBe(originalBytes)
    const parameter = controller.instanceSource(key).getSnapshot()!.workspace.inspector.flatMap(section => section.parameters ?? [])[0]!
    await controller.instanceAction(key, 'editParameter', parameter.id, parameter.value * 1.05)
    await controller.flush(canvas)
    expect(canonicalStringify(snapshot(controller, canvas, captured.alias.id).value)).toBe(originalBytes)
    const experimentNode = controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.kind === 'experiment')!
    await controller.removeNodes(canvas, [experimentNode.id])
    expect(controller.instanceSource(key).getSnapshot()).toBeUndefined()
    expect(snapshot(controller, canvas, captured.alias.id).alias.instanceId).toBeUndefined()
    const exported = await controller.exportGraph(canvas)
    const graph = parseGraph(exported)
    expect(graph.ok).toBe(true)
    expect((await verifyGraphDigests(exported, hashCanonical)).ok).toBe(true)
    expect(exported.manifest.history).toBeDefined()
    expect(exported.objects[immutable.value.scene.digest]).toBeDefined()
    const csv = await controller.exportDatasetCsv(canvas, immutable.value.datasets.map(ref => ref.digest))
    const parsedCsv = parseDatasetsCsv(csv)
    expect(parsedCsv.ok).toBe(true)
    if (parsedCsv.ok) expect(parsedCsv.value).toEqual(immutable.value.datasets.map(ref => exported.objects[ref.digest]))
    const recreated = await controller.recreateSnapshot(canvas, captured.alias.id)
    expect(recreated).not.toBe(instance)
    expect(currentInstance(controller, canvas, recreated).source.kind).toBe('question')
    expect(snapshot(controller, canvas, captured.alias.id).value).toEqual(immutable.value)
  })

  it('keeps physical edits to B while undoing a layout patch to A and restores deleted owners with their latest facts', async () => {
    const { controller } = fixture()
    const canvas = await controller.create('Independent history')
    const a = await controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'template' } })
    const b = await controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'template' } })
    const manifest = controller.documentSource(canvas).getSnapshot().manifest!
    const aNode = manifest.nodes.find(node => node.kind === 'experiment' && node.instanceId === a)!
    const bNode = manifest.nodes.find(node => node.kind === 'experiment' && node.instanceId === b)!
    const bKey = controller.instanceKey(canvas, b)
    await controller.updateLayout(canvas, [{ id: aNode.id, layout: { x: aNode.layout.x + 200 } }])
    const field = controller.instanceSource(bKey).getSnapshot()!.workspace.inspector.flatMap(section => section.parameters ?? [])[0]!
    await controller.instanceAction(bKey, 'editParameter', field.id, field.value * 1.2)
    await controller.flush(canvas)
    const editedB = currentInstance(controller, canvas, b)
    await controller.undo(canvas)
    expect(controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.id === aNode.id)!.layout).toEqual(aNode.layout)
    expect(currentInstance(controller, canvas, b)).toEqual(editedB)
    await controller.removeNodes(canvas, [bNode.id])
    await controller.undo(canvas)
    await controller.instanceAction(bKey, 'setRunning', false)
    expect(currentInstance(controller, canvas, b).currentScene).toEqual(editedB.currentScene)
    expect(controller.instanceSource(bKey).getSnapshot()!.history.canUndo).toBe(true)
    await controller.instanceAction(bKey, 'undo')
    await controller.flush(canvas)
    expect(currentInstance(controller, canvas, b).currentScene).not.toEqual(editedB.currentScene)
  })

  it('carries nested group children exactly once for absolute drag and resize patches, and aligns selected roots only', async () => {
    const { controller } = fixture()
    const canvas = await controller.create('Group world coordinates')
    const child = await controller.addNote(canvas, { body: 'Nested child', layout: { x: 200, y: 150, width: 100, height: 100 } })
    const sibling = await controller.addNote(canvas, { body: 'Sibling', layout: { x: 400, y: 150, width: 100, height: 100 } })
    const middle = await controller.group(canvas, [child], 'Nested group')
    const outer = await controller.group(canvas, [middle, child, sibling], 'Outer group')
    const layout = (nodeId: string) => controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.id === nodeId)!.layout
    expect(controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.id === child)!.groupId).toBe(middle)
    const childBefore = layout(child); const middleBefore = layout(middle); const siblingBefore = layout(sibling); const outerBefore = layout(outer)
    await controller.updateLayout(canvas, [
      { id: outer, layout: { x: outerBefore.x + 100, y: outerBefore.y + 80 } },
      { id: middle, layout: { x: middleBefore.x + 100, y: middleBefore.y + 80 } },
      { id: child, layout: { x: childBefore.x + 100, y: childBefore.y + 80 } },
      { id: sibling, layout: { x: siblingBefore.x + 100, y: siblingBefore.y + 80 } },
    ])
    expect(layout(child)).toMatchObject({ x: childBefore.x + 100, y: childBefore.y + 80 })
    const dragged = layout(child); const draggedOuter = layout(outer)
    await controller.updateLayout(canvas, [{ id: outer, layout: { x: draggedOuter.x - 20, y: draggedOuter.y - 30,
      width: draggedOuter.width + 20, height: draggedOuter.height + 30 } }])
    expect(layout(child)).toMatchObject({ x: dragged.x - 20, y: dragged.y - 30 })
    const beforeAlign = layout(child); const outerAlign = layout(outer)
    const reference = await controller.addNote(canvas, { body: 'Align reference', layout: { x: 0, y: 0, width: 100, height: 100 } })
    await controller.align(canvas, [outer, middle, child, sibling, reference], 'left')
    expect(layout(outer).x).toBe(0)
    expect(layout(child).x - layout(outer).x).toBe(beforeAlign.x - outerAlign.x)
    const held = layout(child); const groupPosition = layout(outer)
    await controller.updateLayout(canvas, [{ id: outer, layout: { x: groupPosition.x + 30, y: groupPosition.y + 40 } },
      { id: child, layout: { width: held.width + 10 } }])
    expect(layout(child)).toMatchObject({ x: held.x + 30, y: held.y + 40, width: held.width + 10 })
  })

  it('stores notes, grouping, locks, result view and exact comparison configuration without changing captured payloads', async () => {
    const { controller } = fixture()
    const canvas = await controller.create('Notebook and comparison')
    const first = await controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'template' } })
    const second = await controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'template' } })
    const firstResult = await controller.capture(canvas, first, 'Left')
    const secondResult = await controller.capture(canvas, second, 'Right')
    const document = controller.documentSource(canvas).getSnapshot()
    const snapshots = [snapshot(controller, canvas, firstResult.alias.id), snapshot(controller, canvas, secondResult.alias.id)]
    const member = (item: typeof snapshots[number], name: string) => {
      const reference = item.value.datasets.find(ref => {
        const data = document.objects[ref.digest]
        return data?.kind === 'dataset' && data.metrics.length > 0
      })!
      const data = document.objects[reference.digest]
      if (data?.kind !== 'dataset') throw new Error('The raw dataset is unavailable.')
      return { id: name, snapshotAliasId: item.alias.id, dataset: reference, metricId: data.metrics[0]!.id,
        ...(data.axes[0] === undefined ? {} : { axisId: data.axes[0].id }), label: name }
    }
    const comparison = await controller.addComparison(canvas, { title: 'Overlay', mode: 'overlay', alignment: 'native',
      members: [member(snapshots[0]!, 'left'), member(snapshots[1]!, 'right')] })
    await controller.updateComparison(canvas, comparison, { title: 'Conditions', mode: 'conditions', alignment: 'native' })
    await controller.setResultView(canvas, firstResult.node.id, 'table', [member(snapshots[0]!, 'selection').metricId])
    const note = await controller.addNote(canvas, { body: '## Raw evidence', title: 'Notebook' })
    await controller.updateNote(canvas, note, '## Revised\nNo resampling.', 'markdown')
    const group = await controller.group(canvas, [note, firstResult.node.id], 'Evidence')
    await controller.setGroupCollapsed(canvas, group, true)
    await controller.setLocked(canvas, [note], true)
    const beforeMove = controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.id === note)!.layout
    await controller.updateLayout(canvas, [{ id: note, layout: { x: 999 } }])
    expect(controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.id === note)!.layout).toEqual(beforeMove)
    const exported = await controller.exportGraph(canvas)
    expect(validateGraph(exported.manifest, exported.objects).ok).toBe(true)
    expect(exported.manifest.comparisons.find(value => value.id === comparison)?.mode).toBe('conditions')
    expect(exported.manifest.nodes.find(node => node.id === note)).toMatchObject({ body: '## Revised\nNo resampling.', locked: true, groupId: group })
    expect(canonicalStringify(snapshot(controller, canvas, firstResult.alias.id).value)).toBe(canonicalStringify(snapshots[0]!.value))
  })

  it('clones and imports the exact reachable closure with newly owned current scenes, without rewriting old captured identities', async () => {
    const { controller } = fixture()
    const canvas = await controller.create('Portable')
    const instance = await controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'community', id: 'release', metadata: { author: 'Contributor' } } })
    const result = await controller.capture(canvas, instance)
    const exported = await controller.exportGraph(canvas)
    const copied = await controller.duplicate(canvas, 'Portable copy')
    const imported = await controller.importGraph(exported, 'Portable import')
    const copyGraph = await controller.exportGraph(copied)
    const importGraph = await controller.exportGraph(imported)
    const sourceScene = exported.objects[exported.manifest.instances[0]!.currentScene.digest]
    const copiedScene = copyGraph.objects[copyGraph.manifest.instances[0]!.currentScene.digest]
    const importedScene = importGraph.objects[importGraph.manifest.instances[0]!.currentScene.digest]
    expect(copiedScene?.kind).toBe('scene')
    expect(importedScene?.kind).toBe('scene')
    if (sourceScene?.kind === 'scene' && copiedScene?.kind === 'scene' && importedScene?.kind === 'scene') {
      expect(copiedScene.scene.id).not.toBe(sourceScene.scene.id)
      expect(importedScene.scene.id).not.toBe(sourceScene.scene.id)
      expect(importedScene.scene.id).not.toBe(copiedScene.scene.id)
    }
    const sourcePayload = exported.objects[result.alias.snapshot.digest]
    const copiedPayload = copyGraph.objects[copyGraph.manifest.snapshots[0]!.snapshot.digest]
    const importedPayload = importGraph.objects[importGraph.manifest.snapshots[0]!.snapshot.digest]
    expect(copiedPayload).toEqual(sourcePayload)
    if (sourcePayload?.kind === 'snapshot' && importedPayload?.kind === 'snapshot') {
      expect(importedPayload.source).toBe('imported')
      expect(importedPayload.result).toEqual(sourcePayload.result)
      expect(importedPayload.rawState).toEqual(sourcePayload.rawState)
      expect(importedPayload.instanceId).toBe(sourcePayload.instanceId)
    }
    for (const graph of [exported, copyGraph, importGraph]) expect((await verifyGraphDigests(graph, hashCanonical)).ok).toBe(true)
    const withOrphan: CanvasGraph = { ...exported, objects: { ...exported.objects, ...copyGraph.objects } }
    expect(parseGraph(withOrphan).ok).toBe(false)
  })
})

describe('document cache recovery and local cross-tab conflicts', () => {
  it('persists a chapter project association independently from experiment history', async () => {
    const name = databaseName('physicsos-project-board')
    const first = fixture({ persistence: createCanvasPersistence({ name, hash }) })
    const canvas = await first.controller.create('动量实验笔记')
    const assign = Reflect.get(first.controller, 'assignProject') as ((id: string, project?: string) => Promise<void>) | undefined
    expect(typeof assign).toBe('function')
    await assign!(canvas, 'chapter-momentum')
    await first.controller.flush(canvas)
    expect(first.controller.documentSource(canvas).getSnapshot().manifest?.metadata?.studyProjectId).toBe('chapter-momentum')
    expect(first.controller.getSnapshot().documents.find(item => item.id === canvas)?.projectId).toBe('chapter-momentum')
    await first.controller.dispose()
    const second = fixture({ persistence: createCanvasPersistence({ name, hash }) })
    await second.controller.open(canvas)
    expect(second.controller.getSnapshot().documents.find(item => item.id === canvas)?.projectId).toBe('chapter-momentum')
    await second.controller.assignProject(canvas)
    expect(second.controller.documentSource(canvas).getSnapshot().manifest?.metadata?.studyProjectId).toBeUndefined()
  })
  it('opens cached circuit owners before a pending online startup upload finishes', async test => {
    const host = await loadCanvasFixture({ test })
    const authenticated = await host.register(`startup_${randomUUID().slice(0, 8)}`)
    const account: CanvasAccount = { id: authenticated.user.id, schoolId: authenticated.user.schoolId, username: authenticated.user.username }
    const name = databaseName('physicsos-canvas-online-recovery')
    let releaseUploads!: () => void
    let releaseCommits!: () => void
    const uploads = new Promise<void>(resolve => { releaseUploads = resolve })
    const commits = new Promise<void>(resolve => { releaseCommits = resolve })
    test.onTestFinished(() => { releaseUploads(); releaseCommits() })
    let uploading = false
    let committing = false
    const api = createCanvasApi(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(raw, host.base)
      const method = init?.method ?? 'GET'
      if (method === 'PUT' && url.pathname.includes('/objects/')) { uploading = true; await uploads }
      if (method === 'POST' && url.pathname.endsWith('/commit')) { committing = true; await commits }
      const headers = Object.fromEntries(new Headers(init?.headers).entries())
      return typeof init?.body === 'string'
        ? host.raw(method, `${url.pathname}${url.search}`, init.body, authenticated, headers)
        : host.call(method, `${url.pathname}${url.search}`, undefined, authenticated, headers)
    })
    const first = fixture({ api, getAccount: () => account, persistence: createCanvasPersistence({ name, hash }) })
    const canvas = await first.controller.create('Pending circuit before reload')
    const instance = await first.controller.addExperiment(canvas, { scene: draftToScene(starterDraft()), source: { kind: 'free-build' },
      buildMode: 'construct', layout: { x: 120, y: 80 } })
    const key = first.controller.instanceKey(canvas, instance)
    const node = first.controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(value => value.kind === 'experiment')!
    await first.controller.instanceAction(key, 'setComponentParams', 'r0', { resistance: 30 })
    await first.controller.instanceAction(key, 'addComponent', 'resistor', { x: 2, y: 4 }, { resistance: 100 })
    await first.controller.flush(canvas)
    await first.controller.updateLayout(canvas, [{ id: node.id, layout: { x: 620, y: 180 } }])
    await first.controller.dispose()

    const persistence = createCanvasPersistence({ name, hash })
    const second = fixture({ api, getAccount: () => account, persistence, online: () => true })
    let opened = false
    const opening = second.controller.open(canvas).then(() => { opened = true })
    void opening.catch(() => undefined)
    try {
      await vi.waitFor(() => expect(uploading).toBe(true), { timeout: 10_000 })
      // Network completion is deliberately unavailable; the authenticated local view must be usable first.
      await vi.waitFor(() => expect(opened).toBe(true), { timeout: 1_000 })
      const restoredKey = second.controller.instanceKey(canvas, instance)
      await vi.waitFor(() => expect(second.controller.instanceSource(restoredKey).getSnapshot()?.draft?.components).toHaveLength(4))
      const restored = second.runtimes.find(owner => owner.instanceKey === restoredKey && !owner.getSnapshot().disposed)!
      expect(second.controller.getSnapshot().loading).toBe(false)
      expect(second.controller.documentSource(canvas).getSnapshot()).toMatchObject({ status: 'syncing', localSaved: true, canUndo: true })
      expect(restored.getSnapshot()).toMatchObject({ buildMode: 'construct', history: { canUndo: true } })
      expect(restored.getSnapshot().draft!.components.find(component => component.id === 'r0')!.params.resistance).toBe(30)
      expect(restored.getSnapshot().draft!.components.find(component => component.id === 'r1')!.params.resistance).toBe(100)
      expect((await persistence.read(`${encodeURIComponent(account.id)}|${encodeURIComponent(account.schoolId)}`, canvas))?.pending?.kind).toBe('commit')
      await second.controller.undo(canvas)
      expect(second.controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(value => value.id === node.id)!.layout).toMatchObject({ x: 120, y: 80 })
      await second.controller.redo(canvas)
      await second.controller.instanceAction(restoredKey, 'undo')
      expect(restored.getSnapshot().draft!.components.map(component => component.id)).toEqual(['bat', 'sw', 'r0'])
      await second.controller.instanceAction(restoredKey, 'redo')
      await second.controller.flush(canvas)
      const retainedScene = restored.getScene()
      const retainedHistory = restored.serialize().history
      const retainedDraft = restored.serialize().draft
      releaseUploads()
      await vi.waitFor(() => expect(committing).toBe(true), { timeout: 10_000 })
      expect(second.controller.documentSource(canvas).getSnapshot().status).toBe('syncing')
      releaseCommits()
      await second.controller.sync(canvas)
      const acknowledged = second.controller.documentSource(canvas).getSnapshot()
      expect(acknowledged.status).toBe('saved')
      expect(acknowledged.acknowledgedSequence).toBe(acknowledged.editSequence)
      expect(acknowledged.manifest!.nodes.find(value => value.id === node.id)!.layout).toMatchObject({ x: 620, y: 180 })
      expect(restored.getSnapshot().disposed).toBe(false)
      expect(restored.getScene()).toEqual(retainedScene)
      expect(restored.serialize()).toMatchObject({ history: retainedHistory, draft: retainedDraft })
      const published = await api.forOwner(account).open(canvas)
      expect(published.manifest.instances[0]!.currentScene).toEqual(currentInstance(second.controller, canvas, instance).currentScene)
    } finally {
      releaseUploads(); releaseCommits()
      await opening.catch(() => undefined)
    }
  }, 120_000)

  it('keeps the initial object inventory when startup acknowledgment advances the cache during hydration', async test => {
    const host = await loadCanvasFixture({ test })
    const authenticated = await host.register(`hydrate_${randomUUID().slice(0, 8)}`)
    const account: CanvasAccount = { id: authenticated.user.id, schoolId: authenticated.user.schoolId, username: authenticated.user.username }
    const name = databaseName('physicsos-canvas-hydration-race')
    let releaseCreate!: () => void, releaseObjects!: () => void, releaseUploads!: () => void
    const creating = new Promise<void>(resolve => { releaseCreate = resolve })
    const reading = new Promise<void>(resolve => { releaseObjects = resolve })
    const uploading = new Promise<void>(resolve => { releaseUploads = resolve })
    test.onTestFinished(() => { releaseCreate(); releaseObjects(); releaseUploads() })
    let createStarted = false, uploadStarted = false, objectsRead = false, holdObjects = false
    const api = createCanvasApi(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(raw, host.base)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.pathname === '/physicsos/learning/canvases') { createStarted = true; await creating }
      if (method === 'PUT' && url.pathname.includes('/objects/')) { uploadStarted = true; await uploading }
      const headers = Object.fromEntries(new Headers(init?.headers).entries())
      return typeof init?.body === 'string' ? host.raw(method, `${url.pathname}${url.search}`, init.body, authenticated, headers)
        : host.call(method, `${url.pathname}${url.search}`, undefined, authenticated, headers)
    })
    const first = fixture({ api, getAccount: () => account, persistence: createCanvasPersistence({ name, hash }) })
    const canvas = await first.controller.create('Hydration across acknowledgment')
    const instance = await first.controller.addExperiment(canvas, { scene: draftToScene(starterDraft()), source: { kind: 'free-build' }, buildMode: 'construct' })
    await first.controller.instanceAction(first.controller.instanceKey(canvas, instance), 'addComponent', 'resistor', { x: 2, y: 4 }, { resistance: 100 })
    await first.controller.flush(canvas)
    await first.controller.dispose()
    const backing = createCanvasPersistence({ name, hash })
    const persistence = { ...backing, objects: async (...args: Parameters<typeof backing.objects>) => {
      const snapshot = await backing.objects(...args)
      if (holdObjects) { holdObjects = false; objectsRead = true; await reading }
      return snapshot
    } }
    const second = fixture({ api, getAccount: () => account, persistence, online: () => true })
    let opening: ReturnType<typeof second.controller.open> | undefined
    try {
      await vi.waitFor(() => expect(createStarted).toBe(true), { timeout: 10_000 })
      const namespace = `${encodeURIComponent(account.id)}|${encodeURIComponent(account.schoolId)}`
      const before = (await backing.read(namespace, canvas))!.cacheVersion
      holdObjects = true
      opening = second.controller.open(canvas)
      void opening.catch(() => undefined)
      await vi.waitFor(() => expect(objectsRead).toBe(true), { timeout: 10_000 })
      releaseCreate()
      await vi.waitFor(async () => expect((await backing.read(namespace, canvas))!.cacheVersion).toBeGreaterThan(before), { timeout: 10_000 })
      await vi.waitFor(() => expect(uploadStarted).toBe(true), { timeout: 10_000 })
      releaseObjects()
      await opening
      const key = second.controller.instanceKey(canvas, instance)
      await vi.waitFor(() => expect(second.controller.instanceSource(key).getSnapshot()?.draft?.components).toHaveLength(4))
      expect(second.controller.documentSource(canvas).getSnapshot().error).toBeUndefined()
      expect(second.controller.instanceSource(key).getSnapshot()!.draft!.components.find(part => part.id === 'r1')!.params.resistance).toBe(100)
    } finally {
      releaseCreate(); releaseObjects(); releaseUploads()
      await opening?.catch(() => undefined)
    }
  }, 120_000)

  it('restores field-patch undo and physical owner history on reload without replaying another instance state', async () => {
    const name = databaseName('physicsos-canvas-recovery')
    const first = fixture({ persistence: createCanvasPersistence({ name, hash }) })
    const canvas = await first.controller.create('Reload document')
    const instance = await first.controller.addExperiment(canvas, { scene: createMagneticScene(), source: { kind: 'template' } })
    const node = first.controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(node => node.kind === 'experiment')!
    const key = first.controller.instanceKey(canvas, instance)
    const field = first.controller.instanceSource(key).getSnapshot()!.workspace.inspector.flatMap(section => section.parameters ?? [])[0]!
    await first.controller.instanceAction(key, 'editParameter', field.id, field.value * 1.1)
    await first.controller.flush(canvas)
    const edited = currentInstance(first.controller, canvas, instance)
    await first.controller.updateLayout(canvas, [{ id: node.id, layout: { x: node.layout.x + 200 } }])
    await first.controller.dispose()
    const second = fixture({ persistence: createCanvasPersistence({ name, hash }) })
    await second.controller.open(canvas)
    const restoredKey = second.controller.instanceKey(canvas, instance)
    await second.controller.instanceAction(restoredKey, 'setRunning', false)
    expect(second.controller.documentSource(canvas).getSnapshot().canUndo).toBe(true)
    expect(second.controller.instanceSource(restoredKey).getSnapshot()!.history.canUndo).toBe(true)
    await second.controller.undo(canvas)
    expect(second.controller.documentSource(canvas).getSnapshot().manifest!.nodes.find(candidate => candidate.id === node.id)?.layout.x).toBe(node.layout.x)
    expect(currentInstance(second.controller, canvas, instance).currentScene).toEqual(edited.currentScene)
    await second.controller.instanceAction(restoredKey, 'undo')
    await second.controller.flush(canvas)
    expect(currentInstance(second.controller, canvas, instance).currentScene).not.toEqual(edited.currentScene)
  })

  it('persists base/local/remote copies for a same-field local CAS conflict and uses the remote draft without fake server heads', async () => {
    const name = databaseName('physicsos-canvas-local-cas')
    const first = fixture({ persistence: createCanvasPersistence({ name, hash }) }).controller
    const canvas = await first.create('Base title')
    const second = fixture({ persistence: createCanvasPersistence({ name, hash }) }).controller
    await second.open(canvas)
    await first.rename(canvas, 'First tab title')
    await second.rename(canvas, 'Second tab title')
    expect(second.documentSource(canvas).getSnapshot().status).toBe('conflict')
    expect(second.documentSource(canvas).getSnapshot().manifest!.title).toBe('Second tab title')
    const reader = createCanvasPersistence({ name, hash })
    const durable = (await reader.read('guest|local', canvas))!
    expect(durable.localConflict?.base.title).toBe('Base title')
    expect(durable.localConflict?.local.title).toBe('Second tab title')
    expect(durable.localConflict?.remote.title).toBe('First tab title')
    expect(durable.head).toBeUndefined()
    await reader.close()
    await second.useRemote(canvas)
    expect(second.documentSource(canvas).getSnapshot().manifest!.title).toBe('First tab title')
    expect(second.documentSource(canvas).getSnapshot().conflicts).toHaveLength(0)
  })
})

describe('account and local durability boundaries', () => {
  it('never adopts anonymous work as a new account upload, and hides sources from the previous account', async () => {
    let account: CanvasAccount | undefined
    const { controller } = fixture({ getAccount: () => account })
    const guest = await controller.create('Anonymous draft')
    await controller.addNote(guest, { body: 'Do not upload to another identity.' })
    const guestSource = controller.documentSource(guest)
    account = { id: 'user-A', schoolId: 'school', username: 'A' }
    await controller.refreshAccount()
    expect(guestSource.getSnapshot().manifest).toBeUndefined()
    expect(controller.getSnapshot().documents).toHaveLength(0)
    const own = await controller.create('A draft')
    await controller.addNote(own, { body: 'A private note' })
    const sourceA = controller.documentSource(own)
    account = { id: 'user-B', schoolId: 'school', username: 'B' }
    await controller.refreshAccount()
    expect(sourceA.getSnapshot().manifest).toBeUndefined()
    expect(controller.getSnapshot().documents.some(document => document.id === own)).toBe(false)
    account = { id: 'user-A', schoolId: 'school', username: 'A' }
    await controller.refreshAccount()
    await controller.open(own)
    expect(controller.documentSource(own).getSnapshot().manifest!.nodes[0]).toMatchObject({ body: 'A private note' })
    account = undefined
    await controller.refreshAccount()
    await controller.open(guest)
    expect(controller.documentSource(guest).getSnapshot().manifest!.nodes[0]).toMatchObject({ body: 'Do not upload to another identity.' })
  })

  it('does not claim locally Saved when a transaction fails, retains the draft and can retry its exact content', async () => {
    const persistence = createCanvasPersistence({ name: databaseName('physicsos-canvas-local-failure'), hash })
    const originalSave = persistence.save.bind(persistence)
    let fail = false
    vi.spyOn(persistence, 'save').mockImplementation((...args) => fail ? Promise.reject(new Error('QuotaExceededError')) : originalSave(...args))
    const { controller } = fixture({ persistence })
    const canvas = await controller.create('Durable only after commit')
    fail = true
    await expect(controller.addNote(canvas, { body: 'Retain this draft after disk failure.' })).rejects.toThrow('QuotaExceededError')
    const document = controller.documentSource(canvas).getSnapshot()
    expect(document.localSaved).toBe(false)
    expect(document.status).toBe('error')
    expect(document.manifest!.nodes[0]).toMatchObject({ body: 'Retain this draft after disk failure.' })
    await expect(controller.flush(canvas)).rejects.toThrow('QuotaExceededError')
    const recovery = await controller.exportGraph(canvas)
    expect(recovery.manifest.nodes[0]).toMatchObject({ body: 'Retain this draft after disk failure.' })
    expect(controller.documentSource(canvas).getSnapshot().localSaved).toBe(false)
    fail = false
    await controller.retry(canvas)
    expect(controller.documentSource(canvas).getSnapshot().localSaved).toBe(true)
    expect(controller.documentSource(canvas).getSnapshot().status).toBe('local-saved')
    expect((await persistence.read('guest|local', canvas))!.working.nodes[0]).toMatchObject({ body: 'Retain this draft after disk failure.' })
  })
})
