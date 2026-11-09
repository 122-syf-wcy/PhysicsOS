import type {
  DerivedQuantity, Measurement, ObjectState, QuantityVector, SimulationResult, SimulationState,
} from '@physicsos/physics-core'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { canonicalValue, isPhysicalDimension, quantity, type Quantity } from '@physicsos/physics-units'

import {
  createSceneObject, parseAnalysisDataset, parseObject, readCaptureCursor, readConditionValue, readExperimentInstance,
  readEngineIdentity, readMetricSemantics, readObjectRef, readWorkbenchClock, sampledStateDiagnostic,
} from './codec.ts'
import {
  canonicalStringify, copyJsonObject, exactKeys, fail, freezeData, jsonObject, list, optional, pointer,
  record, unwrap,
} from './json.ts'
import { readQuantity, readQuantityVector, readSimulationRequest, readSimulationResult, readSimulationState } from './simulation-codec.ts'
import type {
  AnalysisDataset, AxisDescriptor, CapturedResult, CaptureCursor, ConditionValue,
  CreateSnapshotObjectInput, DatasetExtractionOptions, DatasetObject, DatasetOrigin, DatasetRow,
  DataValue, ExperimentInstance, JsonObject, JsonValue, MetricComponent, MetricDescriptor,
  MetricSemantics, ObjectRef, PublicCapturedResult, SnapshotObject,
} from './types.ts'

const sameScene = (scene: PhysicsScene, other: { readonly sceneId: string; readonly sceneRevision: number }, path: string): void => {
  if (other.sceneId !== String(scene.id) || other.sceneRevision !== scene.revision) {
    fail(path, 'capture-identity', 'Raw data does not belong to the captured scene identity and revision.')
  }
}
const semanticsMap = (input: unknown): Readonly<Record<string, MetricSemantics>> => {
  const value = record(input, '/metricSemantics')
  const output: Record<string, MetricSemantics> = {}
  for (const [key, entry] of Object.entries(value)) output[key] = readMetricSemantics(entry, pointer('/metricSemantics', key))
  return output
}

// Only this reader's fully schema-validated, detached, deeply frozen outputs
// qualify. A caller-frozen object or generic canonical JSON is still parsed.
const validatedAnalyses = new WeakSet<object>()
const readCapturedAnalysis = (input: unknown): AnalysisDataset => {
  if (input !== null && typeof input === 'object' && validatedAnalyses.has(input)) return input as AnalysisDataset
  const owned = copyJsonObject(unwrap(parseAnalysisDataset(input))) as unknown as AnalysisDataset
  validatedAnalyses.add(owned)
  return owned
}

/** Detaches a held capture without calling an engine, selecting another sample, or formatting readings. */
export const publicCapturedResult = (input: CapturedResult): PublicCapturedResult => {
  const raw = copyJsonObject(input)
  const value = record(raw, '')
  exactKeys(value, ['scene', 'request', 'result', 'state', 'rawState', 'clock', 'cursor', 'analysis', 'engineInfo', 'diagnostics', 'conditions', 'metricSemantics'], '')
  const scene = createSceneObject(value.scene).scene
  const request = optional(value.request, '/request', readSimulationRequest)
  const result = optional(value.result, '/result', readSimulationResult)
  const state = optional(value.state, '/state', readSimulationState)
  const rawState = optional(value.rawState, '/rawState', jsonObject)
  const clock = readWorkbenchClock(value.clock, '/clock')
  const cursor = readCaptureCursor(value.cursor, '/cursor')
  const engineInfo = readEngineIdentity(value.engineInfo, '/engineInfo')
  if (request !== undefined) sameScene(scene, request, '/request')
  if (result !== undefined) {
    sameScene(scene, result, '/result')
    if (result.metadata.engineId !== engineInfo.id || result.metadata.engineVersion !== engineInfo.version) {
      fail('/engineInfo', 'engine', 'Engine identity must match the held simulation result.')
    }
  }
  if (request !== undefined && result !== undefined && request.simulationId !== result.simulationId) fail('/result', 'capture-identity', 'Captured request and result simulation identities differ.')
  if (cursor.kind === 'time') {
    const time = canonicalValue(cursor.time)
    if (time !== clock.time) fail('/cursor', 'cursor', 'Captured cursor and playback clock times differ.')
  }
  const analysis = optional(value.analysis, '/analysis', (entries, at) => list(entries, at, readCapturedAnalysis))
  analysis?.forEach((dataset, index) => sameScene(scene, dataset.origin, `/analysis/${index}/origin`))
  const recordedDiagnostics = optional(value.diagnostics, '/diagnostics', (entries, at) => list(entries, at, jsonObject))
  const offset = sampledStateDiagnostic(cursor, state, result, request, '/state')
  const diagnostics = offset === undefined ? recordedDiagnostics : (recordedDiagnostics ?? []).some((entry) => canonicalStringify(entry) === canonicalStringify(offset))
    ? recordedDiagnostics
    : [...(recordedDiagnostics ?? []), offset]
  const conditions = optional(value.conditions, '/conditions', (entries, at) => list(entries, at, readConditionValue))
  const metricSemantics = value.metricSemantics === undefined ? undefined : semanticsMap(value.metricSemantics)
  return freezeData({ scene, clock, cursor, engineInfo,
    ...(request === undefined ? {} : { request }), ...(result === undefined ? {} : { result }),
    ...(state === undefined ? {} : { state }), ...(rawState === undefined ? {} : { rawState }),
    ...(analysis === undefined ? {} : { analysis }), ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(conditions === undefined ? {} : { conditions }), ...(metricSemantics === undefined ? {} : { metricSemantics }) })
}

/** Captures raw evidence only. A request or diagnostic without data cannot masquerade as a result. */
export const createSnapshotObject = (input: CreateSnapshotObjectInput): SnapshotObject => {
  const { sceneRef, instanceId, instanceEditRevision, capturedAt, source, datasets, metadata, ...captureInput } = input
  const capture = publicCapturedResult(captureInput)
  if (capture.result === undefined && capture.state === undefined && capture.rawState === undefined) {
    fail('', 'CAPTURE_UNAVAILABLE', 'The runtime has not retained a result or captured state.')
  }
  const object = unwrap(parseObject({ schemaVersion: 1, kind: 'snapshot',
    scene: readObjectRef(sceneRef, '/sceneRef', 'scene'), instanceId, capturedAt,
    sceneRevision: capture.scene.revision, instanceEditRevision, source,
    engine: capture.engineInfo, clock: capture.clock, cursor: capture.cursor, datasets,
    diagnostics: capture.diagnostics ?? [], ...(capture.request === undefined ? {} : { request: capture.request }),
    ...(capture.result === undefined ? {} : { result: capture.result }),
    ...(capture.state === undefined ? {} : { capturedState: capture.state }),
    ...(capture.rawState === undefined ? {} : { rawState: capture.rawState }),
    ...(metadata === undefined ? {} : { metadata }) }))
  if (object.kind !== 'snapshot') return fail('', 'kind', 'Expected a snapshot object.')
  return object
}

/** Binds a genuine pre-hash analysis to the captured scene, never to a placeholder digest. */
export const bindRuntimeDataset = (draft: AnalysisDataset, sourceScene: ObjectRef<'scene'>, scene: PhysicsScene): DatasetObject => {
  const analysis = unwrap(parseAnalysisDataset(copyJsonObject(draft)))
  sameScene(scene, analysis.origin, '/origin')
  const object = unwrap(parseObject({ ...analysis, sourceScene: readObjectRef(sourceScene, '/sourceScene', 'scene') }))
  if (object.kind !== 'dataset') return fail('', 'kind', 'Expected a dataset object.')
  return object
}

interface RawMetric {
  readonly key: string
  readonly targetId?: string
  readonly value: Quantity | QuantityVector
  readonly provenance: 'object' | 'derived' | 'measurement'
  readonly evidence?: JsonObject
}
interface RawRow {
  readonly rowId: string
  readonly time?: Quantity<'time'>
  readonly metrics: readonly RawMetric[]
  readonly evidence?: JsonObject
}

const components = (value: Quantity | QuantityVector): readonly MetricComponent[] =>
  'vector' in value ? ['x', 'y', 'z'] : ['scalar']
const numberFor = (value: Quantity | QuantityVector, component: MetricComponent): number => {
  if ('value' in value && component === 'scalar') return value.value
  if ('vector' in value && (component === 'x' || component === 'y' || component === 'z')) return value.vector[component]
  return fail('', 'component', 'The raw quantity does not contain that component.')
}
const rawMetricId = (entry: RawMetric, component: MetricComponent): string =>
  [entry.provenance, entry.key, entry.targetId ?? '', component, entry.value.dimension, entry.value.unit]
    .map((part) => encodeURIComponent(part)).join(':')

/** Ambiguous temperature, energy, logarithmic, and inverse-temperature readings need explicit semantics. */
const defaults = (entry: RawMetric): MetricSemantics => {
  const key = entry.provenance === 'measurement' ? `measurement:${entry.key}` : entry.key
  if (entry.value.dimension === 'temperature') {
    return { semanticKey: key, scale: { kind: 'unresolved', reason: 'Absolute temperature or temperature difference has not been declared.' } }
  }
  if (entry.key === 'energy' || entry.key === 'potential_energy' || entry.key === 'mechanical_energy') {
    return { semanticKey: key, scale: { kind: 'unresolved', reason: 'Energy kind or physical reference has not been declared.' } }
  }
  if (['sound_level', 'sound_power_level', 'geometric_loss', 'barrier_attenuation', 'expansion_coefficient', 'scale_factor'].includes(entry.key)) {
    return { semanticKey: key, scale: { kind: 'unresolved', reason: 'This raw domain reading requires a declared logarithmic or inverse-temperature scale.' } }
  }
  return { semanticKey: key, scale: { kind: 'linear' } }
}
const metricDescriptor = (entry: RawMetric, component: MetricComponent, options: DatasetExtractionOptions): MetricDescriptor => {
  const semantics = options.metricSemantics?.[entry.key] ?? defaults(entry)
  return { id: rawMetricId(entry, component), ...semantics, component,
    dimension: entry.value.dimension, unit: entry.value.unit,
    ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }) }
}
const zero = (value: Quantity): Quantity => quantity(0, value.unit, value.dimension)
const axisFor = (cursor: CaptureCursor | undefined, identity = 'scene-time'): AxisDescriptor => {
  if (cursor?.kind === 'static') {
    return { id: 'static', kind: 'static', identity: cursor.identity, dimension: 'dimensionless', unit: '',
      origin: { kind: 'absolute', value: quantity(0, '', 'dimensionless'), reference: cursor.identity } }
  }
  if (cursor?.kind === 'parameter' || cursor?.kind === 'space') {
    if (cursor.kind === 'space' && cursor.value.dimension !== 'length') fail('/cursor/value', 'dimension', 'A spatial cursor must have a length quantity.')
    return { id: cursor.axisId, kind: cursor.kind, identity: `${cursor.kind}:${cursor.axisId}`,
      dimension: cursor.value.dimension, unit: cursor.value.unit,
      origin: { kind: 'absolute', value: zero(cursor.value), reference: `${cursor.kind}:${cursor.axisId}:zero` } }
  }
  return { id: 'time', kind: 'time', identity, dimension: 'time', unit: 's',
    origin: { kind: 'absolute', value: quantity(0, 's', 'time'), reference: 'scene-time-zero' } }
}
const axisNumber = (axis: AxisDescriptor, row: RawRow, cursor: CaptureCursor | undefined): DataValue => {
  if (axis.kind === 'static') return 0
  if (cursor?.kind === 'parameter' || cursor?.kind === 'space') return cursor.value.value
  return row.time === undefined ? { missing: 'time-not-recorded' } : canonicalValue(row.time)
}
const makeDataset = (
  id: string, rows: readonly RawRow[], origin: DatasetOrigin, options: DatasetExtractionOptions,
  cursor: CaptureCursor | undefined = options.cursor,
): DatasetObject => {
  const unmappedScan = (cursor?.kind === 'parameter' || cursor?.kind === 'space') && origin.collection !== 'captured-state'
  const axis = unmappedScan ? undefined : axisFor(cursor)
  const inventory = new Map<string, MetricDescriptor>()
  for (const row of rows) for (const entry of row.metrics) for (const component of components(entry.value)) {
    const metric = metricDescriptor(entry, component, options)
    inventory.set(metric.id, metric)
  }
  const metrics = [...inventory.values()]
  const dataRows: DatasetRow[] = rows.map((row) => {
    const values: Record<string, DataValue> = {}
    for (const metric of metrics) values[metric.id] = { missing: 'not-recorded-in-this-row' }
    const metricEvidence: Record<string, JsonValue> = {}
    for (const entry of row.metrics) for (const component of components(entry.value)) {
      const metricId = rawMetricId(entry, component)
      if (typeof values[metricId] === 'number') fail(`/rows/${row.rowId}`, 'duplicate-metric', 'A sample contains multiple readings with the same semantic, target, unit and component.')
      values[metricId] = numberFor(entry.value, component)
      if (entry.evidence !== undefined) metricEvidence[metricId] = entry.evidence
    }
    const evidence = copyJsonObject({ ...(row.evidence ?? {}),
      ...(row.time === undefined ? {} : { rawTime: row.time }),
      ...(Object.keys(metricEvidence).length === 0 ? {} : { metrics: metricEvidence }) })
    return { rowId: row.rowId, axes: axis === undefined ? {} : { [axis.id]: axisNumber(axis, row, cursor) }, values, evidence }
  })
  const object = unwrap(parseObject({ schemaVersion: 1, kind: 'dataset', id,
    sourceScene: options.sourceScene, axes: axis === undefined ? [] : [axis], metrics, rows: dataRows,
    conditions: options.conditions ?? [], origin }))
  if (object.kind !== 'dataset') return fail('', 'kind', 'Expected a dataset object.')
  return object
}
const derivedMetric = (derived: DerivedQuantity): RawMetric => ({
  key: derived.key, value: derived.value, provenance: 'derived',
  ...(derived.targetId === undefined ? {} : { targetId: derived.targetId }),
  evidence: copyJsonObject({ formula: derived.formula, assumptions: derived.assumptions, confidence: derived.confidence }),
})
const objectMetrics = (object: ObjectState): readonly RawMetric[] => {
  const metrics: RawMetric[] = []
  for (const key of ['position', 'velocity', 'acceleration'] as const) {
    const value = object[key]
    if (value !== undefined) metrics.push({ key, targetId: object.id, value, provenance: 'object' })
  }
  for (const [key, value] of Object.entries(object.values ?? {})) metrics.push({ key, targetId: object.id, value, provenance: 'object' })
  return metrics
}
const stateRow = (state: SimulationState, index: number): RawRow => ({
  rowId: `sample:${index}`, time: state.time,
  metrics: [...state.objects.flatMap(objectMetrics), ...state.derived.map(derivedMetric)], evidence: { sampleIndex: index },
})
const measurementRow = (measurement: Measurement, index: number): RawRow => ({
  rowId: `measurement:${index}:${measurement.id}`,
  ...(measurement.time === undefined ? {} : { time: measurement.time }),
  metrics: [{ key: measurement.definitionId ?? measurement.id, provenance: 'measurement', value: measurement.value,
    ...(measurement.targetId === undefined ? {} : { targetId: measurement.targetId }),
    evidence: copyJsonObject({ id: measurement.id, definitionId: measurement.definitionId, source: measurement.source, metadata: measurement.metadata }) }],
})

/** Uses every stored state and measurement; no reconstructed grid, downsampling, interpolation, or rounding. */
export const datasetFromSimulationResult = (input: SimulationResult, options: DatasetExtractionOptions): readonly DatasetObject[] => {
  const result = readSimulationResult(copyJsonObject(input), '/result')
  const sourceScene = readObjectRef(options.sourceScene, '/sourceScene', 'scene')
  const safeOptions: DatasetExtractionOptions = { ...options, sourceScene }
  const originBase = { sceneId: String(result.sceneId), sceneRevision: result.sceneRevision, simulationId: String(result.simulationId) }
  const prefix = `simulation:${String(result.simulationId)}`
  const datasets: DatasetObject[] = []
  if (result.states.length > 0) datasets.push(makeDataset(`${prefix}:states`, result.states.map(stateRow), { ...originBase, collection: 'states' }, safeOptions))
  const timed: RawRow[] = []
  const untimed: RawRow[] = []
  result.measurements.forEach((measurement, index) => {
    const row = measurementRow(measurement, index)
    if (measurement.time === undefined) untimed.push(row)
    else timed.push(row)
  })
  if (timed.length > 0) datasets.push(makeDataset(`${prefix}:measurements:timed`, timed, { ...originBase, collection: 'measurements' }, safeOptions))
  if (untimed.length > 0) datasets.push(makeDataset(`${prefix}:measurements:untimed`, untimed, { ...originBase, collection: 'measurements' }, safeOptions,
    { kind: 'static', identity: 'untimed-measurement' }))
  if (result.derivedQuantities.length > 0) datasets.push(makeDataset(`${prefix}:derived`, [{ rowId: 'result-derived', metrics: result.derivedQuantities.map(derivedMetric),
    evidence: { scope: 'simulation-result', timeMeaning: 'not-inferred-from-states' } }], { ...originBase, collection: 'derived' }, safeOptions,
    { kind: 'static', identity: 'simulation-result-summary' }))
  return freezeData(datasets)
}

/** Extracts declared scene quantities and explicit primitive constraint parameters, excluding presentation metadata. */
export const conditionsFromScene = (sceneInput: PhysicsScene): readonly ConditionValue[] => {
  const scene = createSceneObject(copyJsonObject(sceneInput)).scene
  const root = copyJsonObject(scene)
  const result: ConditionValue[] = []
  const parameters = (value: JsonValue, path: string, targetId?: string): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
      result.push({ semanticKey: `scene${path}`, value, ...(targetId === undefined ? {} : { targetId }) })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => parameters(entry, pointer(path, index), targetId))
      return
    }
    const object = value as JsonObject
    if (typeof object.unit === 'string' && isPhysicalDimension(object.dimension)) {
      walk(object, path, targetId)
      return
    }
    for (const [key, child] of Object.entries(object)) parameters(child, pointer(path, key), targetId)
  }
  const walk = (value: JsonValue, path: string, targetId?: string): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        const object = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as JsonObject : undefined
        const identity = object?.id
        walk(entry, pointer(path, typeof identity === 'string' ? identity : index), typeof identity === 'string' ? identity : targetId)
      })
      return
    }
    const object = value as JsonObject
    if (typeof object.unit === 'string' && isPhysicalDimension(object.dimension)) {
      const physical = object.vector === undefined ? readQuantity(object, path) : readQuantityVector(object, path)
      const key = path.slice(path.lastIndexOf('/') + 1)
      const unresolved = ['soundPowerLevel', 'barrierAttenuation', 'expansionCoefficient'].includes(key)
        ? { kind: 'unresolved' as const, reason: 'The scene contract stores a domain scale that needs an explicit semantic declaration.' }
        : undefined
      result.push({ semanticKey: `scene${path}`, value: physical, ...(targetId === undefined ? {} : { targetId }),
        ...(physical.dimension === 'temperature' ? { scale: { kind: 'temperature-absolute' as const } }
          : unresolved === undefined ? {} : { scale: unresolved }) })
      return
    }
    const objectId = typeof object.id === 'string' ? object.id : targetId
    for (const [key, child] of Object.entries(object)) {
      if (key === 'metadata' || key === 'annotations' || key === 'measurementDefinitions') continue
      if (key === 'observableDefinitions' && Array.isArray(child)) {
        for (const entry of child) {
          if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
          const observable = entry as JsonObject
          if (typeof observable.id !== 'string' || observable.parameters === undefined) continue
          // Some existing models declare GM, ground, incline, and force ramps in observable parameters.
          parameters(observable.parameters, pointer(pointer(pointer(path, key), observable.id), 'parameters'),
            typeof observable.targetId === 'string' ? observable.targetId : undefined)
        }
        continue
      }
      if (path === '/timeline' && !['startTime', 'endTime', 'simulationTimeStep'].includes(key)) continue
      if (key === 'parameters' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
        parameters(child, pointer(path, key), objectId)
      } else if (child === null || typeof child === 'string' || typeof child === 'boolean' || typeof child === 'number') {
        const facts = ['enabled', 'fixed', 'species', 'frictionCoefficient', 'staticFrictionCoefficient', 'restitution',
          'sliderPosition', 'state', 'harmonic', 'diffractionOrder', 'sourceDirection', 'observerDirection',
          'magneticOrientation', 'quantumEfficiency']
        if (facts.includes(key) && objectId !== undefined && path !== '/timeline') {
          result.push({ semanticKey: `scene${pointer(path, key)}`, value: child, targetId: objectId })
        }
      } else walk(child, pointer(path, key), objectId)
    }
  }
  walk(root, '')
  return freezeData(result)
}

/** Combines held raw scope datasets and explicit native analyses, binding each to the real captured scene. */
export const captureDatasets = (captureInput: CapturedResult, options: DatasetExtractionOptions): readonly DatasetObject[] => {
  const capture = publicCapturedResult(captureInput)
  const conditions = [...conditionsFromScene(capture.scene), ...(capture.conditions ?? [])]
  const byCondition = new Map<string, ConditionValue>()
  for (const condition of [...conditions, ...(options.conditions ?? [])]) byCondition.set(canonicalStringify([condition.semanticKey, condition.targetId ?? null]), condition)
  const extraction: DatasetExtractionOptions = { sourceScene: options.sourceScene, cursor: options.cursor ?? capture.cursor,
    conditions: [...byCondition.values()], metricSemantics: { ...(capture.metricSemantics ?? {}), ...(options.metricSemantics ?? {}) } }
  const result: DatasetObject[] = capture.result === undefined ? [] : [...datasetFromSimulationResult(capture.result, extraction)]
  if (capture.state !== undefined) {
    const cursorDataset = makeDataset(`capture:${String(capture.scene.id)}:${capture.scene.revision}:cursor`, [stateRow(capture.state, 0)],
      { sceneId: String(capture.scene.id), sceneRevision: capture.scene.revision, collection: 'captured-state',
        ...(capture.result === undefined ? {} : { simulationId: String(capture.result.simulationId) }) }, extraction)
    result.push(cursorDataset)
  }
  for (const analysis of capture.analysis ?? []) {
    // A scan owns its fixed conditions; reattaching the current scene's swept value would make a false control condition.
    result.push(bindRuntimeDataset(analysis, options.sourceScene, capture.scene))
  }
  const ids = new Set<string>()
  for (const dataset of result) {
    if (ids.has(dataset.id)) fail('/analysis', 'duplicate-id', `Duplicate dataset identity '${dataset.id}'.`)
    ids.add(dataset.id)
  }
  return freezeData(result)
}

/** Validates a persisted instance without coupling its ownership to an engine or UI controller. */
export const createExperimentInstance = (input: ExperimentInstance): ExperimentInstance =>
  freezeData(readExperimentInstance(copyJsonObject(input)))
