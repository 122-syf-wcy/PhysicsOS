import { createHash } from 'node:crypto'
import type { SimulationResult, SimulationState } from '@physicsos/physics-core'
import {
  createCircuitScene, createMechanicsScene, createMechanicsSimulationRequest,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asPhysicsEventId } from '@physicsos/shared'

import { createManifest, createSceneObject, parseObject } from '../src/codec.ts'
import { canonicalStringify, copyJsonObject, unwrap } from '../src/json.ts'
import type {
  CanvasGraph, CanvasManifest, CloneGraphOptions, DatasetObject, Digest,
  ExperimentInstance, HistoryObject, JsonObject, ObjectRef, SceneObject,
  SnapshotObject, WorkbenchObject,
} from '../src/types.ts'

export const CAPTURED_AT = '2026-11-08T09:00:00.000Z'
export const COPIED_AT = '2026-11-08T10:00:00.000Z'
export const sha256 = (canonical: string): Digest => createHash('sha256').update(canonical, 'utf8').digest('hex')

const layout = { x: 20, y: 30, width: 640, height: 420, zIndex: 1 }

export interface Published<K extends WorkbenchObject['kind']> {
  readonly ref: ObjectRef<K>
  readonly object: Extract<WorkbenchObject, { readonly kind: K }>
}

type PublishedObject = Published<'scene'> | Published<'dataset'> | Published<'snapshot'> | Published<'history'>

export function publish(objects: Record<Digest, WorkbenchObject>, object: SceneObject): Published<'scene'>
export function publish(objects: Record<Digest, WorkbenchObject>, object: DatasetObject): Published<'dataset'>
export function publish(objects: Record<Digest, WorkbenchObject>, object: SnapshotObject): Published<'snapshot'>
export function publish(objects: Record<Digest, WorkbenchObject>, object: HistoryObject): Published<'history'>
export function publish(objects: Record<Digest, WorkbenchObject>, object: WorkbenchObject): PublishedObject {
  const validated = unwrap(parseObject(copyJsonObject(object)))
  if (validated.kind !== object.kind) throw new Error('Fixture object kind changed during parsing.')
  const identity = sha256(canonicalStringify(validated))
  objects[identity] = validated
  switch (validated.kind) {
    case 'scene': return { ref: { kind: 'scene', digest: identity }, object: validated }
    case 'dataset': return { ref: { kind: 'dataset', digest: identity }, object: validated }
    case 'snapshot': return { ref: { kind: 'snapshot', digest: identity }, object: validated }
    case 'history': return { ref: { kind: 'history', digest: identity }, object: validated }
  }
}

/** Typed recorded constant-velocity engine payload: 3 m/s for one second, with exact raw evidence. */
export const mechanicsResult = (scene: PhysicsScene): { readonly result: SimulationResult; readonly state: SimulationState } => {
  const request = createMechanicsSimulationRequest(scene, 'simulation-recorded-mechanics', 'trace-recorded-mechanics')
  const state: SimulationState = {
    time: quantity(1, 's', 'time'),
    objects: [{
      id: 'body-1',
      position: { vector: { x: 3, y: 0, z: 0 }, unit: 'm', dimension: 'length' },
      velocity: { vector: { x: 3, y: 0, z: 0 }, unit: 'm/s', dimension: 'velocity' },
      acceleration: { vector: { x: 0, y: 0, z: 0 }, unit: 'm/s^2', dimension: 'acceleration' },
      values: { kinetic_energy: quantity(4.5, 'J', 'energy') },
    }],
    derived: [{
      key: 'displacement', targetId: 'body-1', value: quantity(3, 'm', 'length'),
      formula: { id: 'uniform-motion', expression: 'x = v * t', latex: 'x=vt', variables: { v: '3 m/s', t: '1 s' }, conditions: ['constant velocity'] },
      assumptions: ['zero acceleration'], confidence: 1,
    }],
  }
  const result: SimulationResult = {
    schemaVersion: 'simulation-result/1.0', simulationId: request.simulationId,
    sceneId: scene.id, sceneRevision: scene.revision,
    states: [
      { ...state, time: quantity(0, 's', 'time'), objects: [{ ...state.objects[0]!, position: { vector: { x: 0, y: 0, z: 0 }, unit: 'm', dimension: 'length' } }], derived: [] },
      state,
    ],
    events: [{ eventId: asPhysicsEventId('event-recorded-finish'), sceneId: scene.id, revision: scene.revision, type: 'simulation.completed', time: 1 }],
    measurements: [{
      id: 'measurement-displacement', definitionId: 'displacement', targetId: 'body-1', time: quantity(1, 's', 'time'),
      value: quantity(3, 'm', 'length'), source: 'derived',
      metadata: { formula: 'x = v * t', raw: ['3', '1'], reference: 'laboratory-origin', nested: { kind: 'scene', digest: sha256('unreferenced-metadata') } },
    }],
    derivedQuantities: state.derived,
    verification: {
      status: 'passed', level: 'NUMERIC_VERIFIED',
      checks: [{ id: 'displacement-check', type: 'numerical', passed: true, targetId: 'body-1', details: { expected: 3, actual: 3, error: 0 } }],
      warnings: [], errors: [],
    },
    metadata: { engineId: 'mechanics', engineVersion: '1.0.0', solver: 'analytic-uniform-motion', startedAt: CAPTURED_AT, finishedAt: CAPTURED_AT, durationMs: 0, deterministic: true, randomSeed: 7 },
    trace: request.trace,
  }
  return { result, state }
}

export const instanceFor = (
  instanceId: string,
  currentScene: ObjectRef<'scene'>,
  originScene: ObjectRef<'scene'> = currentScene,
  domain: ExperimentInstance['domain'] = 'mechanics',
): ExperimentInstance => ({
  instanceId, currentScene, originScene, domain, templateId: `template-${domain}`,
  source: { kind: 'template', id: `template-${domain}`, title: 'Recorded laboratory', metadata: { preserved: 'source', physicsosImport: { preexisting: true } } },
  buildMode: 'construct', clock: { time: 1, total: 1, running: false, rate: 1 }, instanceEditRevision: 8,
  templateRelease: { id: `template-${domain}`, version: '1.0.0', digest: sha256('template-release') },
  rendererRelease: { kind: 'official', id: 'official-renderer', experimentId: `template-${domain}`, version: '1.0.0' },
  metadata: { preserved: 'instance', instanceId, digest: sha256('metadata-only') },
})

export interface GraphFixture {
  readonly graph: CanvasGraph
  readonly scene: SceneObject
  readonly sceneRef: ObjectRef<'scene'>
  readonly dataset: DatasetObject
  readonly datasetRef: ObjectRef<'dataset'>
  readonly snapshot: SnapshotObject
  readonly snapshotRef: ObjectRef<'snapshot'>
  readonly parentHistory: HistoryObject
  readonly parentHistoryRef: ObjectRef<'history'>
  readonly history: HistoryObject
  readonly historyRef: ObjectRef<'history'>
}

export const graphFixture = (): GraphFixture => {
  const objects: Record<Digest, WorkbenchObject> = {}
  const base = createMechanicsScene({
    model: 'uniform_linear_motion', sceneId: 'scene-recorded-mechanics', revision: 4,
    velocity: { x: 3, y: 0, z: 0 }, acceleration: { x: 0, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: 0 },
    endTime: 1, now: CAPTURED_AT, sourceQuestionId: 'question-uniform-motion',
  })
  const scene = createSceneObject({
    ...base,
    metadata: {
      ...base.metadata,
      experimentRelease: { kind: 'official', id: 'official-renderer', experimentId: 'uniform-motion', version: '1.0.0' },
      experimentNotebook: {
        version: 1,
        entries: [{ id: 'notebook-before-clone', recordedAt: CAPTURED_AT, sceneId: base.id, sceneRevision: 4, columns: ['time', 'displacement'], values: ['1 s', '3 m'], parameters: [{ id: 'speed', value: 3, unit: 'm/s' }] }],
      },
    },
    bodies: base.bodies.map((body) => ({ ...body, metadata: { ...(body.metadata ?? {}), untouched: ['body', 1], sceneId: base.id, reference: { kind: 'scene', digest: sha256('metadata-reference-only') } } })),
  })
  const sceneRef = publish(objects, scene).ref
  const datasetInput: DatasetObject = {
    schemaVersion: 1, kind: 'dataset', id: 'dataset-displacement', sourceScene: sceneRef,
    axes: [{ id: 'time', kind: 'time', identity: 'scene-time', dimension: 'time', unit: 's', origin: { kind: 'absolute', value: quantity(0, 's', 'time'), reference: 'scene-time-origin' } }],
    metrics: [{ id: 'displacement', semanticKey: 'position.displacement', targetId: 'body-1', component: 'x', dimension: 'length', unit: 'm', scale: { kind: 'linear' }, reference: { identity: 'laboratory-origin', value: quantity(0, 'm', 'length') } }],
    rows: [
      { rowId: 'row-0', axes: { time: 0 }, values: { displacement: 0 }, evidence: { formula: 'x = v * t', assumptions: ['constant velocity'], phase: 'start' } },
      { rowId: 'row-1', axes: { time: 1 }, values: { displacement: 3 }, evidence: { formula: { expression: 'x = v * t', variables: { v: 3, t: 1 } }, confidence: 1, source: 'engine' } },
    ],
    conditions: [{ semanticKey: 'speed', targetId: 'body-1', value: quantity(3, 'm/s', 'velocity'), scale: { kind: 'linear' } }],
    origin: { sceneId: scene.scene.id, sceneRevision: scene.scene.revision, simulationId: 'simulation-recorded-mechanics', collection: 'states' },
    metadata: { raw: { stringValue: '3.000', units: ['m', 's'] }, reference: { kind: 'snapshot', digest: sha256('not-a-dependency') } },
  }
  const publishedDataset = publish(objects, datasetInput)
  const reading = mechanicsResult(scene.scene)
  const rawState: JsonObject = {
    phase: { name: 'constant-motion', localTime: 1 }, rotation: 0, immersion: { depth: 0 },
    comparison: { originalTargetId: 'body-1' }, source: 'server-engine',
    nested: { kind: 'scene', digest: sha256('snapshot-raw-lookalike') },
  }
  const snapshotInput: SnapshotObject = {
    schemaVersion: 1, kind: 'snapshot', scene: sceneRef, instanceId: 'instance-recorded-mechanics',
    capturedAt: CAPTURED_AT, sceneRevision: scene.scene.revision, instanceEditRevision: 6, source: 'server-engine',
    engine: { id: reading.result.metadata.engineId, version: reading.result.metadata.engineVersion, model: 'uniform_linear_motion', release: { kind: 'official', id: 'official-renderer', experimentId: 'uniform-motion', version: '1.0.0' } },
    request: createMechanicsSimulationRequest(scene.scene, 'simulation-recorded-mechanics', 'trace-recorded-mechanics'),
    result: reading.result, capturedState: reading.state, rawState,
    clock: { time: 1, total: 1, running: false, rate: 1 }, cursor: { kind: 'time', time: quantity(1, 's', 'time') },
    datasets: [publishedDataset.ref], diagnostics: [{ code: 'recorded-diagnostic', details: { raw: [1, 3, 0], assumption: 'constant velocity' } }],
    metadata: { recorded: 'engine-evidence', sourceSceneId: scene.scene.id },
  }
  const publishedSnapshot = publish(objects, snapshotInput)
  const parentInput: HistoryObject = {
    schemaVersion: 1, kind: 'history', parents: [],
    entries: [{ id: 'history-capture', instanceId: 'instance-recorded-mechanics', scene: sceneRef, snapshot: publishedSnapshot.ref, at: CAPTURED_AT, operation: 'capture', details: { originalNotebookEntry: 'notebook-before-clone' } }],
  }
  const parent = publish(objects, parentInput)
  const historyInput: HistoryObject = {
    schemaVersion: 1, kind: 'history', parents: [parent.ref],
    entries: [{ id: 'history-edit', instanceId: 'instance-recorded-mechanics', scene: sceneRef, at: CAPTURED_AT, operation: 'edit', details: { changes: ['presentation'], instanceId: 'instance-recorded-mechanics', digest: publishedSnapshot.ref.digest } }],
  }
  const history = publish(objects, historyInput)
  const instance = instanceFor('instance-recorded-mechanics', sceneRef)
  const baseManifest = createManifest({ id: 'canvas-recorded', title: 'Recorded mechanics experiment', now: CAPTURED_AT })
  const manifest: CanvasManifest = {
    ...baseManifest, instances: [instance], history: history.ref,
    nodes: [
      { kind: 'group', id: 'group-outer', title: 'Experimental group', layout: { ...layout, width: 1600, height: 1200, zIndex: 0 }, collapsed: false },
      { kind: 'group', id: 'group-inner', groupId: 'group-outer', layout: { ...layout, width: 1300, height: 900 }, collapsed: true },
      { kind: 'experiment', id: 'node-experiment', instanceId: instance.instanceId, groupId: 'group-inner', title: 'Uniform motion', layout, metadata: { instanceId: instance.instanceId, snapshotAliasId: 'alias-recorded' } },
      { kind: 'result', id: 'node-result', snapshotAliasId: 'alias-recorded', groupId: 'group-inner', layout: { ...layout, x: 700 }, metricIds: ['displacement'], view: 'table' },
      { kind: 'note', id: 'node-note', groupId: 'group-outer', layout: { ...layout, y: 500 }, format: 'markdown', body: 'Recorded ID instance-recorded-mechanics stays in this note.', metadata: { reference: { kind: 'scene', digest: sha256('node-note-metadata') } } },
      { kind: 'comparison', id: 'node-comparison', comparisonId: 'comparison-recorded', layout: { ...layout, x: 1400 } },
    ],
    edges: [
      { id: 'edge-recorded', kind: 'sequence', from: 'node-experiment', to: 'node-result', metadata: { from: 'node-experiment', to: 'node-result' } },
      { id: 'edge-comparison', kind: 'comparison', from: 'node-result', to: 'node-comparison', label: 'Recorded observations' },
    ],
    snapshots: [{ id: 'alias-recorded', title: 'One second observation', snapshot: publishedSnapshot.ref, instanceId: instance.instanceId, metadata: { snapshotAliasId: 'alias-recorded', history: publishedSnapshot.ref.digest } }],
    comparisons: [{
      id: 'comparison-recorded', title: 'Recorded displacement', mode: 'overlay', alignment: 'native', targetUnit: 'm', axisUnit: 's',
      members: [{ id: 'member-recorded', snapshotAliasId: 'alias-recorded', dataset: publishedDataset.ref, metricId: 'displacement', axisId: 'time', label: 'Recorded baseline' }],
      targetBindings: { 'body-1': 'moving-body' }, metadata: { memberId: 'member-recorded' },
    }],
    metadata: { preserved: 'canvas', reference: { kind: 'history', digest: sha256('manifest-metadata-only') } },
  }
  return {
    graph: { schemaVersion: 1, manifest, objects }, scene, sceneRef,
    dataset: publishedDataset.object, datasetRef: publishedDataset.ref,
    snapshot: publishedSnapshot.object, snapshotRef: publishedSnapshot.ref,
    parentHistory: parent.object, parentHistoryRef: parent.ref,
    history: history.object, historyRef: history.ref,
  }
}

export const circuitGraphFixture = (): { readonly graph: CanvasGraph; readonly scene: SceneObject; readonly sceneRef: ObjectRef<'scene'> } => {
  const scene = createSceneObject(createCircuitScene({
    sceneId: 'scene-recorded-circuit', revision: 3, now: CAPTURED_AT,
    components: [
      { id: 'battery', type: 'voltage_source', voltage: 6, terminals: { positive: 'positive-net', negative: 'negative-net' }, layout: { x: 0, y: 0 } },
      { id: 'resistor', type: 'resistor', resistance: 3, terminals: { a: 'positive-net', b: 'negative-net' }, layout: { x: 4, y: 0 } },
    ],
  }))
  const objects: Record<Digest, WorkbenchObject> = {}
  const sceneRef = publish(objects, scene).ref
  const instance = { ...instanceFor('instance-recorded-circuit', sceneRef, sceneRef, 'circuit'), clock: { time: 0, total: 0, running: false, rate: 1 } }
  const manifest: CanvasManifest = {
    ...createManifest({ id: 'canvas-circuit', title: 'Circuit ownership', now: CAPTURED_AT }),
    instances: [instance], nodes: [{ kind: 'experiment', id: 'node-circuit', instanceId: instance.instanceId, layout }],
  }
  return { graph: { schemaVersion: 1, manifest, objects }, scene, sceneRef }
}

export const cloneOptions = (overrides: Partial<CloneGraphOptions> = {}): CloneGraphOptions => {
  let next = 0
  return { id: (kind, oldId) => `copy-${kind}-${++next}-${oldId}`, hash: sha256, now: COPIED_AT, ...overrides }
}

export const sceneFrom = (graph: CanvasGraph, ref: ObjectRef<'scene'>): SceneObject => {
  const object = graph.objects[ref.digest]
  if (object?.kind !== 'scene') throw new Error('Expected a scene fixture.')
  return object
}

export const snapshotFrom = (graph: CanvasGraph, ref: ObjectRef<'snapshot'>): SnapshotObject => {
  const object = graph.objects[ref.digest]
  if (object?.kind !== 'snapshot') throw new Error('Expected a snapshot fixture.')
  return object
}

export const historyFrom = (graph: CanvasGraph, ref: ObjectRef<'history'>): HistoryObject => {
  const object = graph.objects[ref.digest]
  if (object?.kind !== 'history') throw new Error('Expected a history fixture.')
  return object
}
