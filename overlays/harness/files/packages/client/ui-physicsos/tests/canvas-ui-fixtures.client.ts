import { createHash } from 'node:crypto'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { createSnapshotStore, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { GlobalStandardProps, KeyedSnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { createSceneObject, parseManifest, parseObject } from '@physicsos/physics-workbench/codec'
import { canonicalStringify, freezeData, unwrap } from '@physicsos/physics-workbench/json'
import type {
  CanvasManifest, CanvasNode, DatasetObject, ObjectRef, SceneObject, SnapshotObject,
} from '@physicsos/physics-workbench/types'

import type {
  CanvasCommands, CanvasFlowKind, CanvasIncomingSourceState, CanvasNodeProps,
} from '../src/client/canvas/contract.ts'
import { canvasComparisonAxisSignature, canvasNoteDraftKey, type CanvasDocumentState, type CanvasNoteDraftState, type CanvasObservable, type CanvasRosterState } from '../src/client/canvas/types.ts'
import { createCanvasViewStore } from '../src/client/canvas/view-store.ts'
import { en } from '../src/client/locales.ts'
import type { WorkbenchInstanceSummary } from '../src/client/physics/workbench-instance-runtime.ts'
import type { WorkspaceFrame } from '../src/client/physics/workspace-runtime.ts'
import type { PhysicsSurfaceState } from '../src/client/surface-store.ts'

const recordedAt = '2026-11-08T10:00:00.000Z'
const nodeIds = {
  experiment: 'experiment-uniform-motion',
  result: 'result-uniform-motion',
  note: 'note-hypothesis',
  comparison: 'comparison-uniform-motion',
  group: 'group-investigation',
} satisfies Record<CanvasFlowKind, string>

function objectRef<K extends 'scene' | 'snapshot' | 'dataset'>(value: { readonly kind: K }): ObjectRef<K> {
  return { kind: value.kind, digest: createHash('sha256').update(canonicalStringify(value)).digest('hex') }
}

/** A real uniform-motion scene and an explicitly imported analytic dataset, not an engine receipt. */
export function canvasTestDocument(): CanvasDocumentState {
  const scene = createMechanicsScene({
    sceneId: 'scene-uniform-motion', bodyId: 'body-uniform-motion',
    model: 'uniform_linear_motion', mass: 1,
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 2, y: 0, z: 0 },
    gravity: { x: 0, y: 0, z: 0 }, endTime: 2,
    title: 'Uniform motion', now: recordedAt,
  })
  const sceneObject: SceneObject = createSceneObject(scene)
  const sceneRef = objectRef(sceneObject)
  const sceneTitle = scene.metadata.title ?? 'Uniform motion'
  const dataset = {
    schemaVersion: 1, kind: 'dataset', id: 'uniform-motion-native-samples', sourceScene: sceneRef,
    axes: [{
      id: 'time', kind: 'time', identity: 'elapsed-time', dimension: 'time', unit: 's',
      origin: { kind: 'relative', value: quantity(0, 's', 'time'), reference: 'release' },
    }],
    metrics: [
      { id: 'position-x', semanticKey: 'position', targetId: 'body-uniform-motion', component: 'x',
        dimension: 'length', unit: 'm', scale: { kind: 'linear' } },
      { id: 'speed', semanticKey: 'velocity', targetId: 'body-uniform-motion', component: 'magnitude',
        dimension: 'velocity', unit: 'm/s', scale: { kind: 'linear' } },
    ],
    rows: [0, 1, 2].map(time => ({
      rowId: `uniform-sample-${String(time)}`, axes: { time }, values: { 'position-x': 2 * time, speed: 2 },
      evidence: { formula: 'x = v * t', velocitySI: 2 },
    })),
    conditions: [{ semanticKey: 'mass', targetId: 'body-uniform-motion', value: quantity(1, 'kg', 'mass') }],
    origin: { sceneId: String(scene.id), sceneRevision: scene.revision, collection: 'derived' },
    metadata: { provenance: 'Analytic uniform-motion fixture; no engine verification is claimed.' },
  } satisfies DatasetObject
  const datasetObject = unwrap(parseObject(dataset))
  if (datasetObject.kind !== 'dataset') throw new Error('Expected the real uniform-motion dataset.')
  const datasetRef = objectRef(datasetObject)
  const snapshot = {
    schemaVersion: 1, kind: 'snapshot', scene: sceneRef, instanceId: 'instance-uniform-motion',
    capturedAt: recordedAt, sceneRevision: scene.revision, instanceEditRevision: 0,
    source: 'imported', engine: { id: 'analytic-uniform-motion-fixture', version: '1' },
    rawState: { time: 1, position: { x: 2, y: 0, z: 0 }, velocity: { x: 2, y: 0, z: 0 },
      speed: 2, provenance: 'analytic-uniform-motion-fixture' },
    clock: { time: 1, total: 2, running: false, rate: 1 },
    cursor: { kind: 'time', time: quantity(1, 's', 'time') },
    datasets: [datasetRef], diagnostics: [],
  } satisfies SnapshotObject
  const snapshotObject = unwrap(parseObject(snapshot))
  if (snapshotObject.kind !== 'snapshot') throw new Error('Expected the actual captured uniform-motion state.')
  const snapshotRef = objectRef(snapshotObject)
  const layout = { x: 120, y: 80, width: 360, height: 280, zIndex: 2 }
  const nodes = [
    { id: nodeIds.experiment, kind: 'experiment', instanceId: 'instance-uniform-motion',
      title: sceneTitle, layout },
    { id: nodeIds.result, kind: 'result', snapshotAliasId: 'snapshot-uniform-motion',
      title: 'Uniform-motion capture', view: 'summary', layout: { ...layout, x: 520 } },
    { id: nodeIds.note, kind: 'note', title: 'Motion hypothesis', format: 'plain',
      body: 'Equal time intervals should produce equal horizontal displacements.',
      layout: { ...layout, y: 400 } },
    { id: nodeIds.comparison, kind: 'comparison', comparisonId: 'comparison-uniform-motion',
      title: 'Uniform-motion sample comparison', layout: { ...layout, x: 920 } },
    { id: nodeIds.group, kind: 'group', title: 'Motion investigation', collapsed: false,
      layout: { x: 100, y: 60, width: 800, height: 660, zIndex: 0 } },
  ] satisfies readonly CanvasNode[]
  const manifest = {
    schemaVersion: 1, id: 'canvas-uniform-motion', title: 'Uniform-motion investigation',
    createdAt: recordedAt, updatedAt: recordedAt, viewport: { x: 0, y: 0, zoom: 1 },
    nodes, edges: [],
    instances: [{
      instanceId: snapshot.instanceId, currentScene: sceneRef, originScene: sceneRef,
      domain: 'mechanics', source: { kind: 'import', id: String(scene.id), title: sceneTitle },
      buildMode: 'inspect', clock: snapshot.clock, instanceEditRevision: 0,
    }],
    snapshots: [{ id: 'snapshot-uniform-motion', title: 'Uniform-motion capture', snapshot: snapshotRef,
      instanceId: snapshot.instanceId }],
    comparisons: [{
      id: 'comparison-uniform-motion', title: 'Uniform-motion sample comparison', mode: 'overlay', alignment: 'native',
      members: [{ id: 'uniform-position-series', snapshotAliasId: 'snapshot-uniform-motion',
        dataset: datasetRef, metricId: 'position-x', axisId: 'time' }],
    }],
  } satisfies CanvasManifest
  return freezeData<CanvasDocumentState>({
    canvasId: manifest.id, namespace: 'canvas-node-tests', manifest: unwrap(parseManifest(manifest)),
    objects: { [sceneRef.digest]: sceneObject, [datasetRef.digest]: datasetObject, [snapshotRef.digest]: snapshotObject },
    loading: false, status: 'local-saved', localSaved: true,
    editSequence: 1, acknowledgedSequence: 0, canUndo: false, canRedo: false, conflicts: [],
  })
}

function unusedSeat(): never {
  throw new Error('This canvas component requested an unrelated framework seat.')
}
function unusedCommand(): never {
  throw new Error('This canvas test did not supply the command it invoked.')
}

const globalSeats = {
  useSessions: unusedSeat,
  useSessionStatus: unusedSeat,
  useSessionRetainInfo: unusedSeat,
  useWorkspaces: unusedSeat,
  usePanelInfo: unusedSeat,
  useResource: unusedSeat,
} satisfies GlobalStandardProps

function selectorHook<T>(source: CanvasObservable<T>): SnapshotSelectorHook<T> {
  return <Selected>(select: (state: T) => Selected): Selected =>
    select(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot))
}

export function keyedSelectorHook<T>(resolve: (key: string) => CanvasObservable<T> | undefined): KeyedSnapshotSelectorHook<T> {
  const absent: CanvasObservable<T | undefined> = { getSnapshot: () => undefined, subscribe: () => () => {} }
  function useKeyedSnapshot(key: string): T | undefined
  function useKeyedSnapshot<Selected>(
    key: string, select: (state: T | undefined) => Selected,
    equal?: (left: Selected, right: Selected) => boolean,
  ): Selected
  function useKeyedSnapshot<Selected>(
    key: string, select?: (state: T | undefined) => Selected,
    _equal?: (left: Selected, right: Selected) => boolean,
  ): T | undefined | Selected {
    const source = resolve(key) ?? absent
    const state = useSyncExternalStore<T | undefined>(source.subscribe, source.getSnapshot, source.getSnapshot)
    return select === undefined ? state : select(state)
  }
  return useKeyedSnapshot
}

function commandSpies() {
  return {
    appendAnnotations: vi.fn<CanvasCommands['appendAnnotations']>(async () => undefined),
    startAssistant: vi.fn<CanvasCommands['startAssistant']>(unusedCommand),
    assistantJob: vi.fn<CanvasCommands['assistantJob']>(unusedCommand),
    cancelAssistant: vi.fn<CanvasCommands['cancelAssistant']>(unusedCommand),
    replaceAnnotations: vi.fn<CanvasCommands['replaceAnnotations']>(async () => undefined),
    removeAnnotations: vi.fn<CanvasCommands['removeAnnotations']>(async () => undefined),
    create: vi.fn<CanvasCommands['create']>(unusedCommand),
    open: vi.fn<CanvasCommands['open']>(unusedCommand),
    list: vi.fn<CanvasCommands['list']>(unusedCommand),
    rename: vi.fn<CanvasCommands['rename']>(unusedCommand),
    duplicate: vi.fn<CanvasCommands['duplicate']>(unusedCommand),
    remove: vi.fn<CanvasCommands['remove']>(unusedCommand),
    restore: vi.fn<CanvasCommands['restore']>(unusedCommand),
    sync: vi.fn<CanvasCommands['sync']>(unusedCommand),
    retry: vi.fn<CanvasCommands['retry']>(unusedCommand),
    resolveConflict: vi.fn<CanvasCommands['resolveConflict']>(unusedCommand),
    useRemote: vi.fn<CanvasCommands['useRemote']>(unusedCommand),
    keepLocalCopy: vi.fn<CanvasCommands['keepLocalCopy']>(unusedCommand),
    exportGraph: vi.fn<CanvasCommands['exportGraph']>(unusedCommand),
    importGraph: vi.fn<CanvasCommands['importGraph']>(unusedCommand),
    exportDatasetCsv: vi.fn<CanvasCommands['exportDatasetCsv']>(unusedCommand),
    addExperiment: vi.fn<CanvasCommands['addExperiment']>(unusedCommand),
    duplicateInstance: vi.fn<CanvasCommands['duplicateInstance']>(unusedCommand),
    removeNodes: vi.fn<CanvasCommands['removeNodes']>(unusedCommand),
    updateLayout: vi.fn<CanvasCommands['updateLayout']>(unusedCommand),
    updateViewport: vi.fn<CanvasCommands['updateViewport']>(unusedCommand),
    renameNode: vi.fn<CanvasCommands['renameNode']>(unusedCommand),
    addNote: vi.fn<CanvasCommands['addNote']>(unusedCommand),
    updateNote: vi.fn<CanvasCommands['updateNote']>(unusedCommand),
    editNoteDraft: vi.fn<CanvasCommands['editNoteDraft']>(unusedCommand),
    flushNoteDraft: vi.fn<CanvasCommands['flushNoteDraft']>(unusedCommand),
    discardNoteDraft: vi.fn<CanvasCommands['discardNoteDraft']>(unusedCommand),
    group: vi.fn<CanvasCommands['group']>(unusedCommand),
    ungroup: vi.fn<CanvasCommands['ungroup']>(unusedCommand),
    setGroupCollapsed: vi.fn<CanvasCommands['setGroupCollapsed']>(unusedCommand),
    align: vi.fn<CanvasCommands['align']>(unusedCommand),
    distribute: vi.fn<CanvasCommands['distribute']>(unusedCommand),
    setLocked: vi.fn<CanvasCommands['setLocked']>(unusedCommand),
    layer: vi.fn<CanvasCommands['layer']>(unusedCommand),
    copyNodes: vi.fn<CanvasCommands['copyNodes']>(unusedCommand),
    pasteNodes: vi.fn<CanvasCommands['pasteNodes']>(unusedCommand),
    undo: vi.fn<CanvasCommands['undo']>(unusedCommand),
    redo: vi.fn<CanvasCommands['redo']>(unusedCommand),
    capture: vi.fn<CanvasCommands['capture']>(unusedCommand),
    renameSnapshot: vi.fn<CanvasCommands['renameSnapshot']>(unusedCommand),
    removeSnapshot: vi.fn<CanvasCommands['removeSnapshot']>(unusedCommand),
    recreateSnapshot: vi.fn<CanvasCommands['recreateSnapshot']>(unusedCommand),
    setResultView: vi.fn<CanvasCommands['setResultView']>(unusedCommand),
    addComparison: vi.fn<CanvasCommands['addComparison']>(unusedCommand),
    updateComparison: vi.fn<CanvasCommands['updateComparison']>(unusedCommand),
    setComparisonCursor: vi.fn<CanvasCommands['setComparisonCursor']>(async () => undefined),
    instanceAction: unusedCommand,
    attachDisplay: vi.fn<CanvasCommands['attachDisplay']>(unusedCommand),
    setDisplayVisible: vi.fn<CanvasCommands['setDisplayVisible']>(unusedCommand),
    flush: vi.fn<CanvasCommands['flush']>(unusedCommand),
    getSampleReadout: vi.fn<CanvasCommands['getSampleReadout']>(unusedCommand),
    verifySnapshot: vi.fn<CanvasCommands['verifySnapshot']>(unusedCommand),
    verificationHistory: vi.fn<CanvasCommands['verificationHistory']>(async () => []),
  } satisfies CanvasCommands
}

export interface CanvasNodeTestOptions<K extends CanvasFlowKind> {
  readonly document?: CanvasDocumentState
  readonly nodeId?: string
  readonly selected?: boolean
  readonly commands?: Partial<CanvasCommands>
  readonly overrides?: Partial<CanvasNodeProps<K>>
}

/** Test-only framework bindings subscribe to the real document and declared viewing store. */
export function createCanvasNodeTestProps<K extends CanvasFlowKind>(kind: K, options: CanvasNodeTestOptions<K> = {}) {
  const document = createSnapshotStore<CanvasDocumentState>(options.document ?? canvasTestDocument())
  const view = createCanvasViewStore().create()
  const commands = commandSpies()
  // Component-only chart fixtures acknowledge the DTO; raw-axis validation is exercised by real controllers.
  commands.setComparisonCursor.mockImplementation(async (_canvas, id, cursor) => {
    const current = document.getSnapshot()
    const comparison = current.manifest?.comparisons.find(config => config.id === id)
    const member = comparison?.members[0]
    const object = member === undefined ? undefined : current.objects[member.dataset.digest]
    const axis = object?.kind === 'dataset' ? object.axes.find(axis => axis.id === cursor.axisId && axis.identity === cursor.axisIdentity) : undefined
    if (current.manifest === undefined || axis === undefined) throw new Error('The chart fixture cannot acknowledge an unrelated axis.')
    document.set({ ...current, manifest: { ...current.manifest, comparisons: current.manifest.comparisons.map(config => config.id !== id ? config : {
      ...config, metadata: { ...config.metadata, cursor: { ...cursor, axisSignature: canvasComparisonAxisSignature(axis) } },
    }) } })
  })
  const snapshot = document.getSnapshot()
  const nodeId = options.nodeId ?? snapshot.manifest?.nodes.find(node => node.kind === kind)?.id ?? nodeIds[kind]
  const node = snapshot.manifest?.nodes.find(entry => entry.id === nodeId)
  let noteDocument: CanvasDocumentState | undefined
  let noteState: CanvasNoteDraftState | undefined
  // Read-only identity/chrome fixtures have no draft algorithm; interactive notes use a real controller.
  const noteSource: CanvasObservable<CanvasNoteDraftState | undefined> = {
    subscribe: document.subscribe,
    getSnapshot: () => {
      const current = document.getSnapshot()
      if (current === noteDocument) return noteState
      noteDocument = current
      const note = current.manifest?.nodes.find(entry => entry.id === nodeId && entry.kind === 'note')
      noteState = note?.kind === 'note' ? { body: note.body, format: note.format, revision: 0, dirty: false, saving: false, conflict: false } : undefined
      return noteState
    },
  }
  const roster = createSnapshotStore<CanvasRosterState>({
    items: [], documents: [], loading: false, authScope: 'anonymous', namespace: 'canvas-node-tests',
  })
  const physicsSurface = createSnapshotStore<PhysicsSurfaceState>({ surface: 'canvas', canvasId: snapshot.canvasId })
  const props = {
    ...globalSeats,
    id: nodeId, type: kind, data: { canvasId: snapshot.canvasId, nodeId },
    width: node?.layout.width ?? 360, height: node?.layout.height ?? 280,
    positionAbsoluteX: node?.layout.x ?? 0, positionAbsoluteY: node?.layout.y ?? 0,
    zIndex: node?.layout.zIndex ?? 0,
    selected: options.selected ?? true, dragging: false,
    draggable: node?.locked !== true, selectable: true, deletable: true, isConnectable: false,
    dragHandle: '.physicsos-canvas-node-header',
    ...(node?.groupId === undefined ? {} : { parentId: node.groupId }),
    useStore: selectorHook(view), actions: view.actions,
    useCanvasDocument: keyedSelectorHook<CanvasDocumentState>(key => key === document.getSnapshot().canvasId ? document : undefined),
    useCanvasNoteDraft: keyedSelectorHook<CanvasNoteDraftState | undefined>(key => {
      const current = document.getSnapshot()
      return current.namespace !== undefined && key === canvasNoteDraftKey(current.namespace, current.canvasId, nodeId) ? noteSource : undefined
    }),
    useCanvasInstance: keyedSelectorHook<WorkbenchInstanceSummary | undefined>(() => undefined),
    useCanvasFrame: keyedSelectorHook<WorkspaceFrame | undefined>(() => undefined),
    useCanvasIncomingSource: keyedSelectorHook<CanvasIncomingSourceState | undefined>(() => undefined),
    useCanvasRenderer: unusedSeat,
    attachCanvasRenderer: unusedSeat, retryCanvasRenderer: unusedSeat,
    applyCanvasRendererIntent: unusedSeat, cancelCanvasRendererPreview: unusedSeat,
    applyCanvasNativeAction: unusedSeat, ownsCanvasNativePreview: unusedSeat,
    useCanvasRoster: selectorHook(roster), usePhysicsSurface: selectorHook(physicsSurface),
    useCanvasRecent: unusedSeat, useCanvasLearning: unusedSeat,
    canvasCommands: { ...commands, ...options.commands },
    canvasInstanceKey: (canvasId: string, instanceId: string) => JSON.stringify([canvasId, instanceId]),
    openCanvasView: unusedSeat, returnToExperiments: unusedSeat, getCanvasReadout: unusedSeat,
    requestCanvasSource: unusedSeat, requestSceneInCanvas: unusedSeat,
    addPendingCanvasSource: unusedSeat, addPendingToNewCanvas: unusedSeat,
    cancelPendingCanvasSource: unusedSeat, openCanvasInstanceInLab: unusedSeat,
    /* These node fixtures render one local Component directly and mount no child Factory. */
    renderFactorySlot: vi.fn(((name: string) => { void name; return null }) as CanvasNodeProps<K>['renderFactorySlot']),
    t: (key: Parameters<CanvasNodeProps<K>['t']>[0], params?: Record<string, unknown>): string => {
      if (!(key in en)) throw new Error(`This canvas test requested an unrelated locale key: ${key}`)
      const text = Object.entries(en).find(([entry]) => entry === key)?.[1]
      if (text === undefined) throw new Error(`Missing canvas locale key: ${key}`)
      return text.replace(/\{([^}]+)\}/g, (token: string, name: string) =>
        params !== undefined && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token)
    },
    ...options.overrides,
  } satisfies CanvasNodeProps
  /* The seat shape is kind-independent apart from the local Component's own `type`
     literal; the caller's K only selects which local Component is being rendered. */
  return { props: props as unknown as CanvasNodeProps<K>, document, view, commands }
}
