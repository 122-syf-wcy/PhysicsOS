import { describe, expect, it } from 'vitest'
import type { SimulationResult } from '@physicsos/physics-core'
import { createCollisionScene, createCollisionSimulationRequest, createMechanicsScene } from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { asSceneId, asSimulationId, asTraceId } from '@physicsos/shared'

import {
  bindRuntimeDataset, captureDatasets, conditionsFromScene, createSnapshotObject,
  datasetFromSimulationResult, publicCapturedResult,
} from '../src/data.ts'
import { canonicalStringify, copyJsonObject, WorkbenchDataError } from '../src/json.ts'
import type { AnalysisDataset, CapturedResult, DatasetObject } from '../src/types.ts'

const now = '2026-11-08T12:00:00.000Z'
const sourceScene = { kind: 'scene', digest: 'a'.repeat(64) } as const
const scene = () => createMechanicsScene({ sceneId: 'owned-scene', model: 'uniform_linear_motion', mass: 2, now })
const simulation = (): SimulationResult => ({
  schemaVersion: 'simulation-result/1.0', simulationId: asSimulationId('simulation-1'), sceneId: asSceneId('owned-scene'), sceneRevision: 0,
  states: [
    { time: quantity(0, 'ms', 'time'), objects: [{ id: 'body-1', velocity: { vector: { x: 0.1, y: 0, z: 0 }, unit: 'm/s', dimension: 'velocity' },
      values: { momentum: { vector: { x: 0.2, y: 0, z: 0 }, unit: 'kg*m/s', dimension: 'momentum' } } }],
      derived: [{ key: 'kinetic_energy', targetId: 'body-1', value: quantity(0.01, 'J', 'energy'),
        formula: { expression: 'm*v^2/2', variables: { m: 'mass', v: 'velocity' }, conditions: ['nonrelativistic'] }, assumptions: ['No work is added.'], confidence: 1 }] },
    { time: quantity(700, 'ms', 'time'), objects: [{ id: 'body-1' }], derived: [] },
    { time: quantity(1.3, 's', 'time'), objects: [{ id: 'body-1', velocity: { vector: { x: 0.12345678901234568, y: 0, z: 0 }, unit: 'm/s', dimension: 'velocity' } }],
      derived: [{ key: 'kinetic_energy', targetId: 'body-1', value: quantity(0.01524157875323884, 'J', 'energy') }] },
  ], events: [],
  measurements: [
    { id: 'instrument-reading', definitionId: 'voltage', value: quantity(1.2345678901234567, 'V', 'electric_potential'), source: 'instrument', metadata: { calibration: 'retained' } },
    { id: 'timed-reading', definitionId: 'voltage', time: quantity(700, 'ms', 'time'), value: quantity(0, 'V', 'electric_potential'), source: 'simulation' },
  ],
  derivedQuantities: [{ key: 'duration', value: quantity(1.3, 's', 'time'), formula: { expression: 't_end-t_start' }, assumptions: ['Declared window.'] }],
  verification: { status: 'passed', checks: [{ id: 'units', type: 'dimension', passed: true, details: { body: 'body-1' } }], warnings: [], errors: [] },
  metadata: { engineId: 'test-contract', engineVersion: '1.0.0', startedAt: now, finishedAt: now, durationMs: 1, deterministic: true },
  trace: { traceId: asTraceId('trace-1') },
})
const capture = (): CapturedResult => ({ scene: scene(), result: simulation(), state: simulation().states[2]!,
  clock: { time: 1.3, total: 1.3, running: false, rate: 1 }, cursor: { kind: 'time', time: quantity(1.3, 's', 'time') },
  rawState: copyJsonObject({ phase: 'held', comparison: undefined, ledger: { kinetic: 0.01524157875323884 } }),
  engineInfo: { id: 'test-contract', version: '1.0.0' }, diagnostics: [{ code: 'native-cache', message: 'Held source.' }] })
const dataset = (datasets: readonly DatasetObject[], collection: DatasetObject['origin']['collection']): DatasetObject => {
  const found = datasets.find((entry) => entry.origin.collection === collection)
  if (found === undefined) throw new Error(`Missing dataset collection ${collection}`)
  return found
}

describe('real simulation and held-state capture', () => {
  it('preserves every native sample, time, vector component, raw value and missing reason', () => {
    const datasets = datasetFromSimulationResult(simulation(), { sourceScene })
    const states = dataset(datasets, 'states')
    expect(states.rows).toHaveLength(3)
    expect(states.rows.map((row) => row.axes.time)).toEqual(simulation().states.map((sample) => canonicalValue(sample.time)))
    const velocity = states.metrics.find((metric) => metric.semanticKey === 'velocity' && metric.component === 'x' && metric.targetId === 'body-1')!
    expect(velocity.unit).toBe('m/s')
    expect(states.rows.map((row) => row.values[velocity.id])).toEqual([0.1, { missing: 'not-recorded-in-this-row' }, 0.12345678901234568])
    expect(states.rows[0]!.evidence?.rawTime).toEqual(quantity(0, 'ms', 'time'))
    const energy = states.metrics.find((metric) => metric.semanticKey === 'kinetic_energy')!
    const firstEvidence = states.rows[0]!.evidence
    expect(canonicalStringify(firstEvidence)).toContain('m*v^2/2')
    expect(states.rows[0]!.values[energy.id]).toBe(0.01)
    expect(states.metrics.filter((metric) => metric.semanticKey === 'momentum').map((metric) => metric.component)).toEqual(['x', 'y', 'z'])
  })

  it('keeps untimed measurements and result-derived scope separate from cursor states', () => {
    const datasets = datasetFromSimulationResult(simulation(), { sourceScene })
    const untimed = datasets.find((entry) => entry.id.endsWith('measurements:untimed'))!
    expect(untimed.axes[0]!.kind).toBe('static')
    expect(untimed.rows[0]!.evidence).not.toHaveProperty('rawTime')
    expect(untimed.rows[0]!.values[untimed.metrics[0]!.id]).toBe(1.2345678901234567)
    const derived = dataset(datasets, 'derived')
    expect(derived.axes[0]!.identity).toBe('simulation-result-summary')
    expect(derived.rows[0]!.evidence?.timeMeaning).toBe('not-inferred-from-states')
  })

  it('uses an explicit static cursor without inventing a physical time axis or removing duplicate samples', () => {
    const raw = simulation()
    raw.states = [raw.states[0]!, raw.states[0]!]
    const datasets = datasetFromSimulationResult(raw, { sourceScene, cursor: { kind: 'static', identity: 'balanced-rig' } })
    const states = dataset(datasets, 'states')
    expect(states.axes[0]).toEqual({ id: 'static', kind: 'static', identity: 'balanced-rig', dimension: 'dimensionless', unit: '',
      origin: { kind: 'absolute', value: quantity(0, '', 'dimensionless'), reference: 'balanced-rig' } })
    expect(states.rows).toHaveLength(2)
    expect(states.rows.map((row) => row.axes.static)).toEqual([0, 0])
    expect(states.rows[0]!.evidence?.rawTime).toEqual(quantity(0, 'ms', 'time'))
  })

  it('preserves raw evidence and creates a frozen immutable snapshot, not an engine rerun', () => {
    const raw = capture()
    const publicData = publicCapturedResult(raw)
    const before = canonicalStringify(publicData)
    const snapshot = createSnapshotObject({ ...raw, sceneRef: sourceScene, instanceId: 'instance-1', instanceEditRevision: 3,
      capturedAt: now, source: 'client-engine', datasets: [] })
    expect(snapshot.result).toEqual(raw.result)
    expect(snapshot.capturedState).toEqual(raw.state)
    expect(snapshot.rawState).toEqual({ phase: 'held', ledger: { kinetic: 0.01524157875323884 } })
    expect(snapshot.cursor).toEqual(raw.cursor)
    expect(snapshot.result?.verification.checks[0]!.details).toEqual({ body: 'body-1' })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.result?.states[0])).toBe(true)
    raw.scene.metadata.title = 'Changed source'
    raw.result!.states[0]!.time.value = 99
    expect(canonicalStringify(publicData)).toBe(before)
    expect(snapshot.result?.states[0]!.time.value).toBe(0)
  })

  it('binds pre-hash native analyses to the real source reference and checks origin', () => {
    const analysis: AnalysisDataset = { schemaVersion: 1, kind: 'dataset', id: 'native-scan',
      axes: [{ id: 'distance', kind: 'parameter', identity: 'probe-distance', dimension: 'length', unit: 'cm',
        origin: { kind: 'absolute', value: quantity(0, 'cm', 'length'), reference: 'probe-origin' } }],
      metrics: [{ id: 'pressure', semanticKey: 'hydrostatic_pressure', component: 'scalar', dimension: 'pressure', unit: 'Pa', scale: { kind: 'linear' } }],
      rows: [{ rowId: 'first', axes: { distance: 17.25 }, values: { pressure: 1690.5 } }], conditions: [],
      origin: { sceneId: 'owned-scene', sceneRevision: 0, collection: 'analysis', analysisId: 'pressure-depth' } }
    expect('sourceScene' in analysis).toBe(false)
    const bound = bindRuntimeDataset(analysis, sourceScene, scene())
    expect(bound.sourceScene).toEqual(sourceScene)
    expect(bound.rows).toEqual(analysis.rows)
    expect(() => bindRuntimeDataset({ ...analysis, origin: { ...analysis.origin, sceneRevision: 1 } }, sourceScene, scene())).toThrow(WorkbenchDataError)
    const all = captureDatasets({ ...capture(), analysis: [analysis] }, { sourceScene })
    expect(all.find((entry) => entry.id === 'native-scan')?.axes).toEqual(analysis.axes)
  })

  it('does not relabel stored times as an unrecorded parameter sweep', () => {
    const datasets = datasetFromSimulationResult(simulation(), { sourceScene,
      cursor: { kind: 'parameter', axisId: 'frequency', value: quantity(50, 'Hz', 'frequency') } })
    const states = dataset(datasets, 'states')
    expect(states.axes).toEqual([])
    expect(states.rows.map((row) => row.axes)).toEqual([{}, {}, {}])
    expect(states.rows[1]!.evidence?.rawTime).toEqual(quantity(700, 'ms', 'time'))
  })

  it('uses semantic declarations rather than dimensions to claim comparable readings', () => {
    const raw = simulation()
    raw.states[0]!.derived.push({ key: 'temperature_rise', value: quantity(15, 'K', 'temperature') })
    const ambiguous = dataset(datasetFromSimulationResult(raw, { sourceScene }), 'states')
    expect(ambiguous.metrics.find((metric) => metric.semanticKey === 'temperature_rise')?.scale.kind).toBe('unresolved')
    const declared = dataset(datasetFromSimulationResult(raw, { sourceScene,
      metricSemantics: { temperature_rise: { semanticKey: 'temperature_rise', scale: { kind: 'temperature-difference' } } } }), 'states')
    expect(declared.metrics.find((metric) => metric.semanticKey === 'temperature_rise')?.scale.kind).toBe('temperature-difference')
  })

  it('extracts actual declared conditions while excluding title/notebook/renderer presentation state', () => {
    const model = scene()
    model.metadata.description = 'Mass might be described as 999 kg here, but text is not a condition.'
    const conditions = conditionsFromScene(model)
    expect(conditions.find((entry) => entry.semanticKey === 'scene/bodies/body-1/mass')?.value).toEqual(quantity(2, 'kg', 'mass'))
    expect(conditions.some((entry) => entry.semanticKey.includes('metadata'))).toBe(false)
    expect(conditions.some((entry) => entry.semanticKey.endsWith('currentTime'))).toBe(false)
    const spring = createMechanicsScene({ sceneId: 'spring-owned', model: 'spring_oscillator', now, springAnchor: { x: -3, y: 2, z: 0 } })
    const springConditions = conditionsFromScene(spring)
    expect(springConditions.find((entry) => entry.semanticKey === 'scene/constraints/spring-1/parameters/anchor/x')?.value).toBe(-3)
    expect(springConditions.find((entry) => entry.semanticKey === 'scene/constraints/spring-1/parameters/anchor/y')?.value).toBe(2)
    const orbit = createMechanicsScene({ sceneId: 'orbit-owned', model: 'circular_orbit', now, gravitationalParameter: 3.986004418e14, orbitRadius: 6.8e6 })
    expect(conditionsFromScene(orbit).find((entry) => entry.semanticKey === 'scene/observableDefinitions/obs-orbit/parameters/gravitationalParameter')?.value).toBe(3.986004418e14)
  })

  it('preserves a real collision nearest sample at a different requested cursor time', () => {
    const collision = createCollisionScene({ sceneId: 'collision-owned', now,
      bodies: [{ id: 'cart', mass: 2, position: [0, 0], velocity: [1, 0] }] })
    const request = createCollisionSimulationRequest(collision, 'collision-run', 'collision-trace')
    request.options = { startTime: quantity(0, 's', 'time'), endTime: quantity(1, 's', 'time'), outputSampleRate: 1024 }
    const evaluated = 240 / 1023
    const result: SimulationResult = { ...simulation(), simulationId: request.simulationId, sceneId: collision.id,
      sceneRevision: collision.revision, trace: request.trace,
      states: [
        { time: quantity(0, 's', 'time'), objects: [{ id: 'cart', position: { vector: { x: 0, y: 0, z: 0 }, unit: 'm', dimension: 'length' } }], derived: [] },
        { time: quantity(evaluated, 's', 'time'), objects: [{ id: 'cart', position: { vector: { x: evaluated, y: 0, z: 0 }, unit: 'm', dimension: 'length' } }], derived: [] },
        { time: quantity(1, 's', 'time'), objects: [{ id: 'cart', position: { vector: { x: 1, y: 0, z: 0 }, unit: 'm', dimension: 'length' } }], derived: [] },
      ], measurements: [], derivedQuantities: [] }
    const raw: CapturedResult = { scene: collision, request, result, state: result.states[1]!,
      clock: { time: 0.237, total: 1, running: false, rate: 1 }, cursor: { kind: 'time', time: quantity(0.237, 's', 'time') },
      engineInfo: { id: result.metadata.engineId, version: result.metadata.engineVersion } }
    const published = publicCapturedResult(raw)
    expect(published.state?.time.value).toBe(evaluated)
    expect(published.cursor).toEqual({ kind: 'time', time: quantity(0.237, 's', 'time') })
    expect(published.diagnostics).toContainEqual({ code: 'SAMPLED_STATE_CURSOR_OFFSET', requestedTimeSI: 0.237,
      evaluatedTimeSI: evaluated, offsetSI: evaluated - 0.237, selection: 'held-result-sample' })
    const snapshot = createSnapshotObject({ ...raw, sceneRef: sourceScene, instanceId: 'collision-instance',
      instanceEditRevision: 0, capturedAt: now, source: 'client-engine', datasets: [] })
    expect(snapshot.capturedState).toEqual(result.states[1])
    expect(snapshot.cursor).toEqual(raw.cursor)
    expect(snapshot.diagnostics).toEqual(published.diagnostics)
    const extended = { code: 'SAMPLED_STATE_CURSOR_OFFSET', details: { instrument: 'held sampler' }, recordedAt: now }
    const withRawDiagnostic = publicCapturedResult({ ...raw, diagnostics: [extended] })
    expect(withRawDiagnostic.diagnostics).toContainEqual(extended)
    expect(withRawDiagnostic.diagnostics).toHaveLength(2)
    const unrelated = { ...result.states[1]!, objects: [] }
    expect(() => publicCapturedResult({ ...raw, state: unrelated })).toThrow(WorkbenchDataError)
    expect(() => publicCapturedResult({ ...raw, result: undefined })).toThrow(WorkbenchDataError)
  })

  it('keeps collision-safe condition identities and omits typed absent optionals', () => {
    const input = scene()
    input.metadata.description = undefined
    expect(conditionsFromScene(input).find((entry) => entry.semanticKey === 'scene/bodies/body-1/mass')?.value).toEqual(quantity(2, 'kg', 'mass'))
    const conditions = [
      { semanticKey: 'a\u0000b', targetId: 'c', value: 1 },
      { semanticKey: 'a', targetId: 'b\u0000c', value: 2 },
    ] as const
    const states = dataset(captureDatasets({ ...capture(), conditions }, { sourceScene }), 'states')
    expect(states.conditions).toContainEqual(conditions[0])
    expect(states.conditions).toContainEqual(conditions[1])
  })

  it('rejects ordinary and subnormal negative scene-time cursors while keeping spatial coordinates signed', () => {
    for (const value of [-1, -Number.MIN_VALUE]) {
      expect(() => publicCapturedResult({ ...capture(), state: undefined,
        clock: { time: 0, total: 1.3, running: false, rate: 1 },
        cursor: { kind: 'time', time: quantity(value, 'us', 'time') } })).toThrow(WorkbenchDataError)
    }
    expect(publicCapturedResult({ ...capture(), state: undefined,
      cursor: { kind: 'space', axisId: 'position', value: quantity(-1, 'm', 'length') } }).cursor).toEqual({
      kind: 'space', axisId: 'position', value: quantity(-1, 'm', 'length'),
    })
  })

  it('honestly reports unavailable raw captures and refuses snapshots or mismatched identities', () => {
    const unavailable: CapturedResult = { scene: scene(), clock: { time: 0, total: 0, running: false, rate: 1 },
      cursor: { kind: 'static', identity: 'not-solved' }, engineInfo: { id: 'test-contract', version: '1.0.0' },
      diagnostics: [{ code: 'UNSOLVABLE_DRAFT', message: 'No retained data.' }] }
    expect(publicCapturedResult(unavailable).diagnostics).toEqual(unavailable.diagnostics)
    expect(() => createSnapshotObject({ ...unavailable, sceneRef: sourceScene, instanceId: 'instance-1', instanceEditRevision: 0, capturedAt: now,
      source: 'client-engine', datasets: [] })).toThrow(WorkbenchDataError)
    expect(() => publicCapturedResult({ ...capture(), result: { ...simulation(), sceneRevision: 1 } })).toThrow(WorkbenchDataError)
    expect(() => publicCapturedResult({ ...capture(), clock: { time: 1, total: 1.3, running: false, rate: 1 } })).toThrow(WorkbenchDataError)
  })
})
