import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoiseEngine } from '@physicsos/engine-acoustics'
import { PressureEngine } from '@physicsos/engine-fluid'
import { TransformerEngine } from '@physicsos/engine-induction'
import { CurrentFieldEngine } from '@physicsos/engine-magnetic'
import { LightEngine } from '@physicsos/engine-optics'
import { ThermometerEngine } from '@physicsos/engine-thermal'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import {
  createAtmosphericPressureScene,
  createCurrentBenchScene,
  createElectromagnetScene,
  createLiquidPressureScene,
  createMotorScene,
  createNoiseBarrierScene,
  createPinholeScene,
  createPressureBenchScene,
  createSolidPressureScene,
  createSolenoidFieldScene,
  createStraightWireFieldScene,
  createThermometerCalibrationScene,
  createTotalReflectionScene,
  createTransformerBenchScene,
  SceneRuntime,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import type { Quantity } from '@physicsos/physics-units'
import type {
  AnalysisDataset,
  CapturedResult,
  DatasetObject,
  JsonObject,
  ObjectRef,
  PreparedSeries,
} from '@physicsos/physics-workbench'
import { createSceneObject, parseObject } from '@physicsos/physics-workbench/codec'
import {
  axisCompatibility,
  compareConditions,
  differenceSeries,
  metricCompatibility,
} from '@physicsos/physics-workbench/comparison'
import {
  captureDatasets,
  createSnapshotObject,
  publicCapturedResult,
} from '@physicsos/physics-workbench/data'
import { canonicalStringify } from '@physicsos/physics-workbench/json'

import { CurrentWorkspaceRuntime } from '../src/client/physics/current-workspace-runtime.ts'
import { LightWorkspaceRuntime } from '../src/client/physics/light-workspace-runtime.ts'
import { NoiseWorkspaceRuntime } from '../src/client/physics/noise-workspace-runtime.ts'
import { PressureWorkspaceRuntime } from '../src/client/physics/pressure-workspace-runtime.ts'
import { ThermometerWorkspaceRuntime } from '../src/client/physics/thermometer-workspace-runtime.ts'
import { TransformerWorkspaceRuntime } from '../src/client/physics/transformer-workspace-runtime.ts'
import type { WorkspaceRuntime } from '../src/client/physics/workspace-runtime.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

type StaticRuntime = WorkspaceRuntime & {
  captureRaw(): CapturedResult
  getScene(): PhysicsScene
  restoreOrigin(): ReturnType<WorkspaceRuntime['getSnapshot']>
}
interface AnalysisExpectation {
  readonly id: string
  readonly axis: string
  readonly kind?: 'parameter' | 'static'
  readonly dimension: Quantity['dimension']
  readonly unit: string
  readonly coordinates: readonly number[]
}
interface Fixture {
  readonly id: string
  readonly engine: { readonly prototype: Pick<PressureEngine, 'simulate' | 'stateAt'> }
  readonly createScene: () => PhysicsScene
  readonly createRuntime: (scene: PhysicsScene) => StaticRuntime
  readonly numeric: (capture: CapturedResult) => void
  readonly analyses: readonly AnalysisExpectation[]
}

const close = (actual: number, expected: number): void => {
  expect(Number.isFinite(actual)).toBe(true)
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(Math.abs(expected) * 1e-12, 1e-14))
}
const resultOf = (capture: CapturedResult): SimulationResult => {
  if (capture.result === undefined) throw new Error('Runtime did not retain its simulation result')
  return capture.result
}
const scalarOf = (capture: CapturedResult, key: string): Quantity => {
  const value = resultOf(capture).derivedQuantities.find(derived => derived.key === key)?.value
  if (value === undefined || !isScalarQuantity(value)) throw new Error(`Missing raw scalar ${key}`)
  return value
}
const expectQuantity = (
  capture: CapturedResult,
  key: string,
  dimension: Quantity['dimension'],
  unit: string,
  expected: number,
): void => {
  const value = scalarOf(capture, key)
  expect(value.dimension).toBe(dimension)
  expect(value.unit).toBe(unit)
  close(value.value, expected)
}
const analysisOf = (capture: CapturedResult, id: string): AnalysisDataset => {
  const analysis = capture.analysis?.find(dataset => dataset.origin.analysisId === id)
  if (analysis === undefined) throw new Error(`Missing raw analysis ${id}`)
  return analysis
}
const numberOf = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite raw number')
  return value
}
const jsonObjectOf = (value: unknown): JsonObject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a raw JSON object')
  return value as JsonObject
}
const refOf = <K extends ObjectRef['kind']>(kind: K, value: unknown): ObjectRef<K> => ({
  kind,
  digest: createHash('sha256').update(canonicalStringify(value)).digest('hex'),
})

const fixtures: readonly Fixture[] = [
  {
    id: 'solid-pressure', engine: PressureEngine, createScene: createSolidPressureScene,
    createRuntime: scene => new PressureWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'contact_force', 'force', 'N', 20)
      expectQuantity(capture, 'contact_area', 'area', 'm^2', 0.02)
      expectQuantity(capture, 'contact_pressure', 'pressure', 'Pa', 1000)
      expectQuantity(capture, 'comparison_area', 'area', 'm^2', 0.005)
      expectQuantity(capture, 'comparison_pressure', 'pressure', 'Pa', 4000)
    },
    analyses: [{ id: 'pressure-solid-area', axis: 'contact_area', dimension: 'area', unit: 'm^2', coordinates: [0.02, 0.005] }],
  },
  {
    id: 'liquid-pressure', engine: PressureEngine, createScene: createLiquidPressureScene,
    createRuntime: scene => new PressureWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'liquid_density', 'density', 'kg/m^3', 1000)
      expectQuantity(capture, 'probe_depth', 'length', 'm', 0.2)
      expectQuantity(capture, 'liquid_pressure', 'pressure', 'Pa', 1960)
      expectQuantity(capture, 'comparison_depth_pressure', 'pressure', 'Pa', 3920)
      expectQuantity(capture, 'comparison_liquid_pressure', 'pressure', 'Pa', 2156)
    },
    analyses: [
      { id: 'pressure-liquid-depth', axis: 'probe_depth', dimension: 'length', unit: 'm', coordinates: [0.2, 0.4] },
      { id: 'pressure-liquid-density', axis: 'liquid_density', dimension: 'density', unit: 'kg/m^3', coordinates: [1000, 1100] },
    ],
  },
  {
    id: 'atmospheric-pressure', engine: PressureEngine, createScene: createAtmosphericPressureScene,
    createRuntime: scene => new PressureWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'atmospheric_pressure', 'pressure', 'Pa', 101300)
      expectQuantity(capture, 'barometer_column', 'length', 'm', 101300 / (13600 * 9.8))
      expectQuantity(capture, 'hemisphere_force', 'force', 'N', 101300 * Math.PI * 0.05 ** 2)
    },
    analyses: [{ id: 'pressure-atmospheric-instruments', axis: 'instrument', kind: 'static', dimension: 'dimensionless', unit: '', coordinates: [0, 1] }],
  },
  {
    id: 'straight-wire-field', engine: CurrentFieldEngine, createScene: createStraightWireFieldScene,
    createRuntime: scene => new CurrentWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'wire_current', 'electric_current', 'A', 10)
      expectQuantity(capture, 'probe_distance', 'length', 'm', 0.05)
      expectQuantity(capture, 'magnetic_flux_density', 'magnetic_flux_density', 'T', 4e-5)
      expectQuantity(capture, 'comparison_field', 'magnetic_flux_density', 'T', 2e-5)
      expectQuantity(capture, 'field_circulation', 'dimensionless', '', 1)
    },
    analyses: [
      { id: 'current-wire-distance', axis: 'probe_distance', dimension: 'length', unit: 'm', coordinates: [0.05, 0.1] },
      { id: 'current-straight_wire-current', axis: 'electric_current', dimension: 'electric_current', unit: 'A', coordinates: [5, 10, -10] },
    ],
  },
  {
    id: 'solenoid-field', engine: CurrentFieldEngine, createScene: createSolenoidFieldScene,
    createRuntime: scene => new CurrentWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'coil_turns', 'dimensionless', '', 400)
      expectQuantity(capture, 'coil_length', 'length', 'm', 0.2)
      expectQuantity(capture, 'magnetic_flux_density', 'magnetic_flux_density', 'T', 4 * Math.PI * 1e-3)
      expectQuantity(capture, 'end_field', 'magnetic_flux_density', 'T', 2 * Math.PI * 1e-3)
      expectQuantity(capture, 'comparison_field', 'magnetic_flux_density', 'T', 8 * Math.PI * 1e-3)
    },
    analyses: [
      { id: 'current-solenoid-turns', axis: 'coil_turns', dimension: 'dimensionless', unit: '', coordinates: [400, 800] },
      { id: 'current-solenoid-current', axis: 'electric_current', dimension: 'electric_current', unit: 'A', coordinates: [2.5, 5, -5] },
    ],
  },
  {
    id: 'electromagnet', engine: CurrentFieldEngine, createScene: createElectromagnetScene,
    createRuntime: scene => new CurrentWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'magnetic_flux_density', 'magnetic_flux_density', 'T', 0.08 * Math.PI)
      expectQuantity(capture, 'air_cored_field', 'magnetic_flux_density', 'T', 4 * Math.PI * 1e-4)
      expectQuantity(capture, 'pole_face_pull', 'force', 'N', 3.2 * Math.PI)
      expectQuantity(capture, 'held_mass', 'mass', 'kg', 3.2 * Math.PI / 9.8)
      expectQuantity(capture, 'comparison_pull', 'force', 'N', 51.2 * Math.PI)
    },
    analyses: [
      { id: 'current-electromagnet-core', axis: 'core_permeability', dimension: 'dimensionless', unit: '', coordinates: [200, 800, 1] },
      { id: 'current-electromagnet-current', axis: 'electric_current', dimension: 'electric_current', unit: 'A', coordinates: [0.5, 1, -1] },
    ],
  },
  {
    id: 'motor', engine: CurrentFieldEngine, createScene: createMotorScene,
    createRuntime: scene => new CurrentWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'coil_area', 'area', 'm^2', 0.0024)
      expectQuantity(capture, 'coil_angle', 'angle', 'rad', 0)
      expectQuantity(capture, 'side_force', 'force', 'N', 0.06)
      expectQuantity(capture, 'motor_torque', 'torque', 'N*m', 0.24)
      expectQuantity(capture, 'peak_torque', 'torque', 'N*m', 0.24)
    },
    analyses: [
      { id: 'current-motor-angle', axis: 'coil_angle', dimension: 'angle', unit: 'rad', coordinates: [0, Math.PI / 2] },
      { id: 'current-motor-current', axis: 'electric_current', dimension: 'electric_current', unit: 'A', coordinates: [1, 2, -2] },
    ],
  },
  {
    id: 'pinhole', engine: LightEngine, createScene: createPinholeScene,
    createRuntime: scene => new LightWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'object_height', 'length', 'm', 0.06)
      expectQuantity(capture, 'object_distance', 'length', 'm', 0.3)
      expectQuantity(capture, 'screen_distance', 'length', 'm', 0.15)
      expectQuantity(capture, 'image_height', 'length', 'm', 0.03)
      expectQuantity(capture, 'magnification', 'dimensionless', '', 0.5)
      expectQuantity(capture, 'inverted', 'dimensionless', '', -1)
    },
    analyses: [{ id: 'light-pinhole-screen', axis: 'screen_distance', dimension: 'length', unit: 'm', coordinates: [0.15, 0.3, 0.45] }],
  },
  {
    id: 'total-reflection', engine: LightEngine, createScene: createTotalReflectionScene,
    createRuntime: scene => new LightWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'incident_angle', 'angle', 'rad', Math.PI / 4)
      expectQuantity(capture, 'critical_angle', 'angle', 'rad', Math.asin(2 / 3))
      expectQuantity(capture, 'total_internal_reflection', 'dimensionless', '', -1)
      expect(resultOf(capture).derivedQuantities.some(derived => derived.key === 'refracted_angle')).toBe(false)
    },
    analyses: [{ id: 'light-refraction-angle', axis: 'incident_angle', dimension: 'angle', unit: 'rad',
      coordinates: [Math.PI / 4, Math.asin(2 / 3) / 2, Math.asin(2 / 3), (Math.asin(2 / 3) + Math.PI / 2) / 2] }],
  },
  {
    id: 'transformer', engine: TransformerEngine, createScene: createTransformerBenchScene,
    createRuntime: scene => new TransformerWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'primary_voltage', 'electric_potential', 'V', 220)
      expectQuantity(capture, 'secondary_voltage', 'electric_potential', 'V', 44)
      expectQuantity(capture, 'secondary_current', 'electric_current', 'A', 0.5)
      expectQuantity(capture, 'primary_power', 'power', 'W', 22)
      expectQuantity(capture, 'secondary_power', 'power', 'W', 22)
      expectQuantity(capture, 'flux_rate', 'magnetic_flux_rate', 'Wb/s', 0.22)
    },
    analyses: [
      { id: 'transformer-windings', axis: 'winding', kind: 'static', dimension: 'dimensionless', unit: '', coordinates: [0, 1] },
      { id: 'transformer-secondary-turns', axis: 'secondary_turns', dimension: 'dimensionless', unit: '', coordinates: [200, 1000, 5000] },
    ],
  },
  {
    id: 'thermometer', engine: ThermometerEngine, createScene: createThermometerCalibrationScene,
    createRuntime: scene => new ThermometerWorkspaceRuntime(scene),
    numeric: capture => {
      expectQuantity(capture, 'bulb_volume', 'volume', 'm^3', 1e-7)
      expectQuantity(capture, 'bore_area', 'area', 'm^2', Math.PI * (1.6e-4 / 2) ** 2)
      expectQuantity(capture, 'reading_temperature', 'temperature', 'K', 298.15)
      expectQuantity(capture, 'column_length', 'length', 'm', 0.02 + 25 / (320 * Math.PI))
      expectQuantity(capture, 'scale_factor', 'length', 'm', 1 / (320 * Math.PI))
      expectQuantity(capture, 'expansion_coefficient', 'dimensionless', '', 2e-4)
    },
    analyses: [{ id: 'thermometer-calibration', axis: 'temperature', dimension: 'temperature', unit: 'K', coordinates: [273.15, 298.15, 323.15, 373.15] }],
  },
  {
    id: 'noise', engine: NoiseEngine, createScene: createNoiseBarrierScene,
    createRuntime: scene => new NoiseWorkspaceRuntime(scene),
    numeric: capture => {
      const level = 100 - 10 * Math.log10(4 * Math.PI) - 15
      expectQuantity(capture, 'sound_power_level', 'dimensionless', '', 100)
      expectQuantity(capture, 'listener_distance', 'length', 'm', 1)
      expectQuantity(capture, 'barrier_attenuation', 'dimensionless', '', 15)
      expectQuantity(capture, 'sound_level', 'dimensionless', '', level)
      expectQuantity(capture, 'spreading_loss', 'dimensionless', '', -10 * Math.log10(4 * Math.PI))
      expectQuantity(capture, 'level_without_barrier', 'dimensionless', '', level + 15)
      expectQuantity(capture, 'sound_intensity', 'intensity', 'W/m^2', 1e-12 * 10 ** (level / 10))
    },
    analyses: [{ id: 'noise-distance', axis: 'listener_distance', dimension: 'length', unit: 'm', coordinates: [1, 2, 4, 8] }],
  },
]

afterEach(() => {
  vi.restoreAllMocks()
})

const assertAnalysis = (capture: CapturedResult, expected: AnalysisExpectation): void => {
  const dataset = analysisOf(capture, expected.id)
  expect(dataset).not.toHaveProperty('sourceScene')
  expect(dataset.origin).toMatchObject({ sceneId: String(capture.scene.id), sceneRevision: capture.scene.revision,
    simulationId: String(resultOf(capture).simulationId), collection: 'analysis', analysisId: expected.id })
  expect(dataset.axes).toHaveLength(1)
  expect(dataset.axes[0]).toMatchObject({ id: expected.axis, identity: expected.axis, dimension: expected.dimension, unit: expected.unit })
  expect(dataset.axes[0]?.kind).toBe(expected.kind ?? 'parameter')
  expect(dataset.conditions.some(condition => condition.semanticKey === expected.axis)).toBe(false)
  expect(dataset.rows).toHaveLength(expected.coordinates.length)
  dataset.rows.forEach((row, index) => {
    close(numberOf(row.axes[expected.axis]), expected.coordinates[index]!)
    expect(Object.keys(row.values).sort()).toEqual(dataset.metrics.map(metric => metric.id).sort())
    for (const value of Object.values(row.values)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
      else expect(value.missing.length).toBeGreaterThan(0)
    }
  })
}

const assertPublishedDatasets = (capture: CapturedResult): readonly DatasetObject[] => {
  const scene = createSceneObject(capture.scene)
  const sourceScene = refOf('scene', scene)
  const datasets = captureDatasets(capture, { sourceScene })
  expect(datasets.some(dataset => dataset.origin.collection === 'states')).toBe(true)
  const states = datasets.find(dataset => dataset.origin.collection === 'states')
  expect(states?.rows).toHaveLength(resultOf(capture).states.length)
  expect(states?.metrics).toHaveLength(resultOf(capture).states[0]!.derived.length + Object.keys(resultOf(capture).states[0]!.objects[0]!.values ?? {}).length)
  expect(datasets.find(dataset => dataset.origin.collection === 'derived')?.metrics).toHaveLength(resultOf(capture).derivedQuantities.length)
  for (const dataset of datasets) {
    expect(dataset.sourceScene).toEqual(sourceScene)
    expect(dataset.origin.sceneId).toBe(String(capture.scene.id))
    expect(dataset.origin.sceneRevision).toBe(capture.scene.revision)
    expect(dataset.axes.every(axis => axis.kind !== 'time')).toBe(true)
    const parsed = parseObject(JSON.parse(canonicalStringify(dataset)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value).toEqual(dataset)
  }
  for (const held of capture.analysis ?? []) {
    const published = datasets.find(dataset => dataset.id === held.id)
    expect(published?.rows).toEqual(held.rows)
    expect(published?.axes).toEqual(held.axes)
    expect(published?.metrics).toEqual(held.metrics)
    expect(published?.conditions).toEqual(held.conditions)
  }
  return datasets
}

describe('subbench raw capture', () => {
  for (const fixture of fixtures) {
    it(`${fixture.id} retains the exact solve, numeric units, full samples and serialization without solving again`, () => {
      const simulate = vi.spyOn(fixture.engine.prototype, 'simulate')
      const stateAt = vi.spyOn(fixture.engine.prototype, 'stateAt')
      const scene = fixture.createScene()
      const sourceBefore = JSON.stringify(scene)
      const runtime = fixture.createRuntime(scene)
      expect(simulate).toHaveBeenCalledTimes(1)
      const getSnapshot = vi.spyOn(runtime, 'getSnapshot')
      const capture = runtime.captureRaw()
      const result = resultOf(capture)
      expect(capture.request).toBe(simulate.mock.calls[0]?.[1])
      expect(capture.result).toBe(simulate.mock.results[0]?.value)
      expect(capture.scene.id).toBe(simulate.mock.calls[0]?.[0].id)
      expect(capture.scene.revision).toBe(simulate.mock.calls[0]?.[0].revision)
      expect(capture.state).toBe(result.states[0])
      expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
      expect(capture.cursor.kind).toBe('static')
      expect(capture.engineInfo).toMatchObject({ id: result.metadata.engineId, version: result.metadata.engineVersion, model: result.metadata.solver })
      expect(capture.request).toMatchObject({ sceneId: capture.scene.id, sceneRevision: capture.scene.revision, simulationId: result.simulationId })
      expect(result.sceneId).toBe(capture.scene.id)
      expect(result.sceneRevision).toBe(capture.scene.revision)
      expect(result.states).toHaveLength(1)
      expect(result.events).toHaveLength(1)
      expect(result.measurements).toEqual([])
      expect(result.derivedQuantities.length).toBeGreaterThan(0)
      fixture.numeric(capture)
      expect(capture.analysis).toHaveLength(fixture.analyses.length)
      fixture.analyses.forEach(expected => assertAnalysis(capture, expected))
      expect(Object.isFrozen(capture.rawState)).toBe(true)
      expect(Object.isFrozen(capture.analysis)).toBe(true)
      const heldBytes = JSON.stringify(capture)
      for (let index = 0; index < 20; index += 1) {
        const another = runtime.captureRaw()
        expect(another.result).toBe(result)
        expect(another.request).toBe(capture.request)
        expect(another.state).toBe(capture.state)
        expect(another.analysis).toBe(capture.analysis)
        expect(another.rawState).toBe(capture.rawState)
        expect(JSON.stringify(another)).toBe(heldBytes)
      }
      expect(getSnapshot).not.toHaveBeenCalled()
      expect(runtime.getScene()).toEqual(capture.scene)
      expect(simulate).toHaveBeenCalledTimes(1)
      expect(stateAt).not.toHaveBeenCalled()
      expect(JSON.stringify(scene)).toBe(sourceBefore)
      expect(JSON.stringify(capture)).toBe(heldBytes)

      const detached = publicCapturedResult(capture)
      expect(detached.scene).not.toBe(capture.scene)
      expect(detached.result).not.toBe(capture.result)
      expect(Object.isFrozen(detached.result?.states[0]?.derived)).toBe(true)
      expect(canonicalStringify(detached)).toBe(canonicalStringify(publicCapturedResult(JSON.parse(heldBytes) as CapturedResult)))
      const datasets = assertPublishedDatasets(detached)
      const snapshot = createSnapshotObject({ ...detached,
        sceneRef: refOf('scene', createSceneObject(detached.scene)), instanceId: `capture-instance-${fixture.id}`,
        instanceEditRevision: detached.scene.revision, capturedAt: '2026-11-08T00:00:00.000Z', source: 'client-engine',
        datasets: datasets.map(dataset => refOf('dataset', dataset)),
      })
      expect(snapshot.source).toBe('client-engine')
      expect(snapshot.result).toEqual(detached.result)
      expect(snapshot.capturedState).toEqual(detached.state)
      expect(snapshot.rawState).toEqual(detached.rawState)
      expect(snapshot.result?.events).toEqual(result.events)
      const parsedSnapshot = parseObject(JSON.parse(canonicalStringify(snapshot)))
      expect(parsedSnapshot.ok).toBe(true)
      if (parsedSnapshot.ok) expect(parsedSnapshot.value).toEqual(snapshot)
      expect(simulate).toHaveBeenCalledTimes(1)
    })
  }

  it('leaves every static clock stopped when playback is requested', () => {
    for (const fixture of fixtures) {
      const runtime = fixture.createRuntime(fixture.createScene())
      const held = runtime.captureRaw()
      runtime.setRunning(true)
      runtime.setRate(3)
      runtime.seek(5)
      runtime.step(1)
      runtime.advance(5)
      const capture = runtime.captureRaw()
      expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
      expect(capture.cursor).toEqual(held.cursor)
      expect(capture.result).toBe(held.result)
      expect(capture.analysis).toBe(held.analysis)
    }
  })

  it('does not manufacture authored comparisons that a bench omitted', () => {
    const solid = new PressureWorkspaceRuntime(createPressureBenchScene({ bench: { type: 'solid', force: 12, area: 300 } })).captureRaw()
    expectQuantity(solid, 'contact_pressure', 'pressure', 'Pa', 400)
    expect(analysisOf(solid, 'pressure-solid-area').rows).toHaveLength(1)
    expect(resultOf(solid).derivedQuantities.some(derived => derived.key === 'comparison_pressure')).toBe(false)
    const wire = new CurrentWorkspaceRuntime(createCurrentBenchScene({ bench: { type: 'straight_wire', current: -8, probeDistance: 4 } })).captureRaw()
    expectQuantity(wire, 'magnetic_flux_density', 'magnetic_flux_density', 'T', 4e-5)
    expectQuantity(wire, 'field_circulation', 'dimensionless', '', -1)
    expect(analysisOf(wire, 'current-wire-distance').rows).toHaveLength(1)
    expect(resultOf(wire).derivedQuantities.some(derived => derived.key === 'comparison_field')).toBe(false)
    expect(jsonObjectOf(wire.rawState?.reading)).not.toHaveProperty('comparisonDistance')
    assertPublishedDatasets(wire)
  })
})

const preparedSeriesOf = (dataset: DatasetObject, metricId: string): PreparedSeries => {
  const metric = dataset.metrics.find(candidate => candidate.id === metricId)
  const axis = dataset.axes[0]
  if (metric === undefined || axis === undefined) throw new Error('Dataset selection is unavailable')
  return {
    memberId: `member:${dataset.id}:${metricId}`,
    datasetId: dataset.id,
    metric,
    axis,
    points: dataset.rows.map(row => ({ rowId: row.rowId, coordinate: row.axes[axis.id]!, value: row.values[metric.id]! })),
  }
}
const selfDifferenceOf = (capture: CapturedResult, analysisId: string, metricId: string) => {
  const sourceScene = refOf('scene', createSceneObject(capture.scene))
  const dataset = captureDatasets(capture, { sourceScene }).find(candidate => candidate.origin.analysisId === analysisId)
  if (dataset === undefined) throw new Error(`Analysis ${analysisId} is unavailable`)
  const series = preparedSeriesOf(dataset, metricId)
  return differenceSeries(series, series)
}

describe('capture comparison identity and synthetic controls', () => {
  it('keeps synthetic motor, transformer and refraction coordinates unique for exact differences', () => {
    for (const coilAngle of [0, 90, 120]) {
      const capture = new CurrentWorkspaceRuntime(createMotorScene({ coilAngle })).captureRaw()
      const analysis = analysisOf(capture, 'current-motor-angle')
      expect(new Set(analysis.rows.map(row => row.axes.coil_angle)).size).toBe(analysis.rows.length)
      const difference = selfDifferenceOf(capture, 'current-motor-angle', 'motor_torque')
      expect(difference.compatible).toBe(true)
      expect(difference.points).toHaveLength(analysis.rows.length)
      expect(difference.points.every(point => point.value === 0)).toBe(true)
    }
    const transformer = new TransformerWorkspaceRuntime(createTransformerBenchScene())
    for (const turns of [200, 1000, 5000]) {
      transformer.editParameter('secondary-turns', turns)
      const capture = transformer.captureRaw()
      const analysis = analysisOf(capture, 'transformer-secondary-turns')
      expect(new Set(analysis.rows.map(row => row.axes.secondary_turns)).size).toBe(analysis.rows.length)
      expect(selfDifferenceOf(capture, 'transformer-secondary-turns', 'secondary_voltage').points.every(point => point.value === 0)).toBe(true)
    }
    const electromagnet = new CurrentWorkspaceRuntime(createElectromagnetScene())
    electromagnet.setChoice('core-material', 'air')
    const air = electromagnet.captureRaw()
    const airAnalysis = analysisOf(air, 'current-electromagnet-core')
    expect(airAnalysis.rows.map(row => row.axes.core_permeability)).toEqual([1, 800])
    expect(airAnalysis.rows[0]?.evidence).toMatchObject({ sample: 'primary-core', airCoreControl: true })
    expect(selfDifferenceOf(air, 'current-electromagnet-core', 'pole_face_pull').points.every(point => point.value === 0)).toBe(true)
    const dense = new LightWorkspaceRuntime(createTotalReflectionScene({ incidentIndex: 1, refractedIndex: 1.5, incidentAngle: 30 })).captureRaw()
    const denseAnalysis = analysisOf(dense, 'light-refraction-angle')
    expect(denseAnalysis.rows).toHaveLength(2)
    expect(new Set(denseAnalysis.rows.map(row => row.axes.incident_angle)).size).toBe(2)
    expect(selfDifferenceOf(dense, 'light-refraction-angle', 'refracted_angle').points.every(point => point.value === 0)).toBe(true)
  })

  it('preserves genuinely distinct authored observations at the same coordinate', () => {
    const capture = new CurrentWorkspaceRuntime(createStraightWireFieldScene({ comparisonDistance: 5 })).captureRaw()
    const analysis = analysisOf(capture, 'current-wire-distance')
    expect(analysis.rows).toHaveLength(2)
    expect(analysis.rows.map(row => row.axes.probe_distance)).toEqual([0.05, 0.05])
    expect(analysis.rows.map(row => row.evidence?.sample)).toEqual(['primary-probe', 'authored-comparison-probe'])
  })

  it('gives equal settled readings compatible static axes across separately owned scenes', () => {
    for (const fixture of fixtures) {
      const base = fixture.createScene()
      const leftScene = { ...base, id: `${String(base.id)}-left` as PhysicsScene['id'] }
      const rightScene = { ...base, id: `${String(base.id)}-right` as PhysicsScene['id'] }
      const left = fixture.createRuntime(leftScene).captureRaw()
      const right = fixture.createRuntime(rightScene).captureRaw()
      expect(left.scene.id).not.toBe(right.scene.id)
      expect(left.cursor).toEqual(right.cursor)
      const leftDataset = captureDatasets(left, { sourceScene: refOf('scene', createSceneObject(left.scene)) })
        .find(dataset => dataset.origin.collection === 'states')!
      const rightDataset = captureDatasets(right, { sourceScene: refOf('scene', createSceneObject(right.scene)) })
        .find(dataset => dataset.origin.collection === 'states')!
      expect(axisCompatibility(leftDataset.axes[0]!, rightDataset.axes[0]!).compatible).toBe(true)
      const leftMetric = leftDataset.metrics.find(metric => metric.scale.kind !== 'unresolved')!
      const rightMetric = rightDataset.metrics.find(metric => metric.id === leftMetric.id)!
      expect(metricCompatibility(leftMetric, rightMetric).compatible).toBe(true)
      const difference = differenceSeries(preparedSeriesOf(leftDataset, leftMetric.id), preparedSeriesOf(rightDataset, rightMetric.id))
      expect(difference.compatible).toBe(true)
      expect(difference.points).toHaveLength(1)
      close(numberOf(difference.points[0]?.value), 0)
    }
  })

  it('retains relative noise normalization distance separately from the swept listener distance', () => {
    const near = new NoiseWorkspaceRuntime(createNoiseBarrierScene({ distance: 1 })).captureRaw()
    const far = new NoiseWorkspaceRuntime(createNoiseBarrierScene({ distance: 2 })).captureRaw()
    const nearAnalysis = analysisOf(near, 'noise-distance')
    const farAnalysis = analysisOf(far, 'noise-distance')
    expect(nearAnalysis.conditions.some(condition => condition.semanticKey === 'listener_distance')).toBe(false)
    expect(nearAnalysis.conditions.find(condition => condition.semanticKey === 'relative_level_baseline_distance')?.value)
      .toEqual({ value: 1, unit: 'm', dimension: 'length' })
    expect(farAnalysis.conditions.find(condition => condition.semanticKey === 'relative_level_baseline_distance')?.value)
      .toEqual({ value: 2, unit: 'm', dimension: 'length' })
    expect(compareConditions(nearAnalysis.conditions, farAnalysis.conditions)
      .find(condition => condition.semanticKey === 'relative_level_baseline_distance')?.status).toBe('different')
    const nearLoss = nearAnalysis.metrics.find(metric => metric.id === 'relative_level_loss')!
    const farLoss = farAnalysis.metrics.find(metric => metric.id === 'relative_level_loss')!
    expect(nearLoss.scale.kind).toBe('logarithmic')
    expect(nearLoss.reference).toEqual({ identity: 'relative-level-baseline-distance-over-one-metre', value: { value: 1, unit: '', dimension: 'dimensionless' } })
    expect(metricCompatibility(nearLoss, farLoss).reasons).toContain('metric-reference-value-mismatch')
    expect(nearAnalysis.rows[0]?.evidence?.baselineDistance).toEqual({ value: 1, unit: 'm', dimension: 'length' })
    expect(farAnalysis.rows[0]?.evidence?.baselineDistance).toEqual({ value: 2, unit: 'm', dimension: 'length' })
    assertPublishedDatasets(near)
    assertPublishedDatasets(far)
  })
})

describe('numeric parameter scans and physical scales', () => {
  it('keeps full wire-distance, winding-turn and core-permeability samples with the correct laws', () => {
    const wire = new CurrentWorkspaceRuntime(createStraightWireFieldScene()).captureRaw()
    for (const row of analysisOf(wire, 'current-wire-distance').rows) {
      close(numberOf(row.values.magnetic_flux_density) * numberOf(row.axes.probe_distance), 2e-6)
    }
    const solenoid = new CurrentWorkspaceRuntime(createSolenoidFieldScene()).captureRaw()
    const windingRows = analysisOf(solenoid, 'current-solenoid-turns').rows
    close(numberOf(windingRows[1]?.values.magnetic_flux_density) / numberOf(windingRows[0]?.values.magnetic_flux_density), 2)
    const electromagnet = new CurrentWorkspaceRuntime(createElectromagnetScene()).captureRaw()
    const coreRows = analysisOf(electromagnet, 'current-electromagnet-core').rows
    close(numberOf(coreRows[1]?.values.pole_face_pull) / numberOf(coreRows[0]?.values.pole_face_pull), 16)
    close(numberOf(coreRows[0]?.values.pole_face_pull) / numberOf(coreRows[2]?.values.pole_face_pull), 200 ** 2)
    const currentRows = analysisOf(electromagnet, 'current-electromagnet-current').rows
    close(numberOf(currentRows[1]?.values.pole_face_pull) / numberOf(currentRows[0]?.values.pole_face_pull), 4)
    close(numberOf(currentRows[2]?.values.pole_face_pull), numberOf(currentRows[1]?.values.pole_face_pull))
  })

  it('captures signed motor torque at real radian coordinates without a timeline', () => {
    const runtime = new CurrentWorkspaceRuntime(createMotorScene({ coilAngle: 120 }))
    const capture = runtime.captureRaw()
    expectQuantity(capture, 'coil_angle', 'angle', 'rad', 2 * Math.PI / 3)
    expectQuantity(capture, 'motor_torque', 'torque', 'N*m', -0.12)
    const angles = analysisOf(capture, 'current-motor-angle')
    close(numberOf(angles.rows[0]?.axes.coil_angle), 2 * Math.PI / 3)
    close(numberOf(angles.rows[0]?.values.motor_torque), -0.12)
    close(numberOf(angles.rows[1]?.values.motor_torque), 0)
    close(numberOf(angles.rows[2]?.values.motor_torque), 0.24)
    expect(angles.metrics.find(metric => metric.id === 'motor_torque')).toMatchObject({ dimension: 'torque', unit: 'N*m' })
    runtime.setChoice('current-direction', 'in')
    expectQuantity(runtime.captureRaw(), 'motor_torque', 'torque', 'N*m', 0.12)
  })

  it('retains absent refraction as missing evidence and restores a real angle below critical', () => {
    const runtime = new LightWorkspaceRuntime(createTotalReflectionScene())
    const original = runtime.captureRaw()
    expect(resultOf(original).derivedQuantities.some(derived => derived.key === 'refracted_angle')).toBe(false)
    const scan = analysisOf(original, 'light-refraction-angle')
    expect(scan.rows).toHaveLength(4)
    expect(scan.rows[0]?.values.refracted_angle).toEqual({ missing: 'total-internal-reflection' })
    expect(scan.rows[3]?.values.refracted_angle).toEqual({ missing: 'total-internal-reflection' })
    runtime.editParameter('incident-angle', 30)
    const refracted = runtime.captureRaw()
    expectQuantity(refracted, 'incident_angle', 'angle', 'rad', Math.PI / 6)
    expectQuantity(refracted, 'refracted_angle', 'angle', 'rad', Math.asin(0.75))
    expectQuantity(refracted, 'total_internal_reflection', 'dimensionless', '', 1)
    expect(refracted.scene.revision).toBe(original.scene.revision + 1)
    expect(refracted.request?.sceneRevision).toBe(refracted.scene.revision)
    assertPublishedDatasets(refracted)
  })

  it('captures a denser refracting medium with no invented critical angle', () => {
    const capture = new LightWorkspaceRuntime(createTotalReflectionScene({ incidentIndex: 1, refractedIndex: 1.5, incidentAngle: 30 })).captureRaw()
    expectQuantity(capture, 'refracted_angle', 'angle', 'rad', Math.asin(1 / 3))
    expect(resultOf(capture).derivedQuantities.some(derived => derived.key === 'critical_angle')).toBe(false)
    const scan = analysisOf(capture, 'light-refraction-angle')
    expect(scan.rows).toHaveLength(2)
    expect(scan.rows.every(row => typeof row.values.critical_angle === 'object' && row.values.critical_angle.missing === 'no-critical-angle-for-media')).toBe(true)
    assertPublishedDatasets(capture)
  })

  it('uses absolute Kelvin for calibration, differences for rises and unresolved inverse-temperature encodings', () => {
    const runtime = new ThermometerWorkspaceRuntime(createThermometerCalibrationScene())
    runtime.setChoice('filling-liquid', 'alcohol')
    runtime.editParameter('bulb-volume', 0.2)
    runtime.editParameter('bore-diameter', 0.32)
    runtime.editParameter('thermometer-temperature', -5)
    const capture = runtime.captureRaw()
    const sensitivity = (0.2e-6 * 1.1e-3) / (Math.PI * (0.32e-3 / 2) ** 2)
    expectQuantity(capture, 'reading_temperature', 'temperature', 'K', 268.15)
    expectQuantity(capture, 'column_length', 'length', 'm', 0.02 - 5 * sensitivity)
    expectQuantity(capture, 'expansion_coefficient', 'dimensionless', '', 1.1e-3)
    expectQuantity(capture, 'scale_factor', 'length', 'm', sensitivity)
    const calibration = analysisOf(capture, 'thermometer-calibration')
    expect(calibration.rows).toHaveLength(4)
    expect(calibration.axes[0]).toMatchObject({ identity: 'temperature', unit: 'K', origin: { reference: 'absolute-zero', value: { value: 0, unit: 'K', dimension: 'temperature' } } })
    expect(calibration.metrics.find(metric => metric.id === 'reading_temperature')?.scale.kind).toBe('temperature-absolute')
    expect(calibration.metrics.find(metric => metric.id === 'temperature_rise')).toMatchObject({
      scale: { kind: 'temperature-difference' }, reference: { identity: 'celsius-ice-point', value: { value: 273.15, unit: 'K', dimension: 'temperature' } },
    })
    expect(calibration.metrics.find(metric => metric.id === 'column_rise')?.reference).toMatchObject({
      identity: 'ice-point-column-length', value: { value: 0.02, unit: 'm', dimension: 'length' },
    })
    calibration.rows.forEach((row, index) => {
      const rise = [0, 25, 50, 100][index]!
      close(numberOf(row.axes.temperature), rise + 273.15)
      close(numberOf(row.values.temperature_rise), rise)
      close(numberOf(row.values.column_length), 0.02 + sensitivity * rise)
      close(numberOf(row.values.column_rise), sensitivity * rise)
    })
    const datasets = assertPublishedDatasets(capture)
    const rawMetrics = datasets.flatMap(dataset => dataset.metrics)
    expect(rawMetrics.filter(metric => metric.semanticKey === 'temperature').every(metric => metric.scale.kind === 'temperature-absolute')).toBe(true)
    expect(rawMetrics.filter(metric => metric.semanticKey === 'column_sensitivity_per_temperature').every(metric => metric.scale.kind === 'unresolved')).toBe(true)
    expect(rawMetrics.filter(metric => metric.semanticKey === 'volumetric_expansion_coefficient_per_temperature').every(metric => metric.scale.kind === 'unresolved')).toBe(true)
    expect(calibration.metadata).toMatchObject({ unsupportedEngineUnits: {
      expansion_coefficient: { actualUnit: '1/K', rawDimension: 'dimensionless', rawUnit: '' },
      scale_factor: { actualUnit: 'm/K', rawDimension: 'length', rawUnit: 'm' },
    } })
    runtime.setChoice('dip-into', 'steam')
    expectQuantity(runtime.captureRaw(), 'reading_temperature', 'temperature', 'K', 373.15)
    runtime.setChoice('dip-into', 'ice')
    expectQuantity(runtime.captureRaw(), 'reading_temperature', 'temperature', 'K', 273.15)
  })

  it('retains decibels as logarithmic values with intensity, power and unity-ratio references', () => {
    const runtime = new NoiseWorkspaceRuntime(createNoiseBarrierScene())
    runtime.setChoice('listener-step', 'far')
    runtime.setChoice('barrier', 'wall')
    const capture = runtime.captureRaw()
    const baseLevel = 100 - 20 * Math.log10(8) - 10 * Math.log10(4 * Math.PI) - 30
    expectQuantity(capture, 'sound_level', 'dimensionless', '', baseLevel)
    const scan = analysisOf(capture, 'noise-distance')
    expect(scan.rows).toHaveLength(4)
    expect(scan.rows.map(row => row.axes.listener_distance)).toEqual([8, 16, 32, 64])
    scan.rows.forEach((row, index) => {
      const expectedLevel = baseLevel - 20 * Math.log10(2 ** index)
      close(numberOf(row.values.sound_level), expectedLevel)
      close(numberOf(row.values.sound_intensity), 1e-12 * 10 ** (expectedLevel / 10))
      close(numberOf(row.values.relative_level_loss), 20 * Math.log10(2 ** index))
    })
    close(numberOf(scan.rows[1]?.values.sound_intensity) / numberOf(scan.rows[0]?.values.sound_intensity), 0.25)
    expect(capture.metricSemantics?.sound_level?.scale).toEqual({ kind: 'logarithmic', base: 10, factor: 10,
      reference: { identity: 'sound-intensity-reference', value: { value: 1e-12, unit: 'W/m^2', dimension: 'intensity' } } })
    expect(capture.metricSemantics?.sound_power_level?.scale).toEqual({ kind: 'logarithmic', base: 10, factor: 10,
      reference: { identity: 'sound-power-reference', value: { value: 1e-12, unit: 'W', dimension: 'power' } } })
    expect(capture.metricSemantics?.barrier_attenuation?.scale).toEqual({ kind: 'logarithmic', base: 10, factor: 10,
      reference: { identity: 'intensity-ratio-unity', value: { value: 1, unit: '', dimension: 'dimensionless' } } })
    const datasets = assertPublishedDatasets(capture)
    const levels = datasets.flatMap(dataset => dataset.metrics).filter(metric => metric.semanticKey === 'sound_intensity_level')
    expect(levels.length).toBeGreaterThan(0)
    expect(levels.every(metric => metric.scale.kind === 'logarithmic' && metric.unit === '' && metric.dimension === 'dimensionless')).toBe(true)
    expect(resultOf(capture).derivedQuantities.find(derived => derived.key === 'sound_level')?.value.unit).toBe('')
  })

  it('retains negative decibel levels and positive sub-reference intensity without clipping', () => {
    const runtime = new NoiseWorkspaceRuntime(createNoiseBarrierScene())
    runtime.editParameter('noise-source-level', 40)
    runtime.editParameter('listener-distance', 32)
    runtime.editParameter('barrier-attenuation', 60)
    const capture = runtime.captureRaw()
    const level = 40 - 20 * Math.log10(32) - 10 * Math.log10(4 * Math.PI) - 60
    expect(level).toBeLessThan(0)
    expectQuantity(capture, 'sound_level', 'dimensionless', '', level)
    const intensity = scalarOf(capture, 'sound_intensity').value
    expect(intensity).toBeGreaterThan(0)
    expect(intensity).toBeLessThan(1e-12)
    expect(analysisOf(capture, 'noise-distance').rows.every(row => numberOf(row.values.sound_level) < 0)).toBe(true)
    assertPublishedDatasets(capture)
  })

  it('retains winding currents missing from result summaries and the complete turns-ratio scan', () => {
    const runtime = new TransformerWorkspaceRuntime(createTransformerBenchScene())
    runtime.setChoice('transformer-kind', 'step-up')
    const capture = runtime.captureRaw()
    expectQuantity(capture, 'secondary_voltage', 'electric_potential', 'V', 1100)
    expectQuantity(capture, 'secondary_current', 'electric_current', 'A', 0.02)
    const windings = analysisOf(capture, 'transformer-windings')
    expect(windings.rows).toHaveLength(2)
    close(numberOf(windings.rows[0]?.values.winding_current), 0.1)
    close(numberOf(windings.rows[1]?.values.winding_current), 0.02)
    const turns = analysisOf(capture, 'transformer-secondary-turns')
    expect(turns.rows).toHaveLength(3)
    for (const row of turns.rows) {
      close(numberOf(row.values.secondary_voltage) * numberOf(row.values.secondary_current), 22)
      close(numberOf(row.values.secondary_power), 22)
    }
    const rawModel = jsonObjectOf(capture.rawState?.model)
    close(numberOf(rawModel.primaryCurrent), 0.1)
    close(numberOf(rawModel.primaryTurns), 1000)
    close(numberOf(rawModel.secondaryTurns), 5000)
  })
})

const questionScene = (scene: PhysicsScene, experimentId: string): PhysicsScene => ({
  ...scene,
  revision: 3,
  metadata: {
    ...scene.metadata,
    sourceQuestionId: 'capture-question-source' as NonNullable<PhysicsScene['metadata']['sourceQuestionId']>,
    experimentRelease: { kind: 'official', id: `physicsos-${experimentId}-v1`, experimentId, version: '1.0.0' },
  },
})

const choiceValueOf = (runtime: WorkspaceRuntime, id: string): string | undefined => runtime.getSnapshot().inspector
  .flatMap(section => section.choices ?? [])
  .find(choice => choice.id === id)?.value

const expectHeldIdentity = (capture: CapturedResult): void => {
  expect(capture.request?.sceneId).toBe(capture.scene.id)
  expect(capture.result?.sceneId).toBe(capture.scene.id)
  expect(capture.request?.sceneRevision).toBe(capture.scene.revision)
  expect(capture.result?.sceneRevision).toBe(capture.scene.revision)
  expect(capture.state).toBe(capture.result?.states[0])
}

describe('subbench choices commit real physics', () => {
  it('normalizes custom numeric facts through the real instance owner with one history entry', () => {
    const cases = [
      { id: 'pinhole-smaller', scene: createPinholeScene(), edits: [['screen-distance', 12]] as const,
        choice: ['pinhole-layout', 'smaller'] as const, numeric: (capture: CapturedResult) => expectQuantity(capture, 'screen_distance', 'length', 'm', 0.15) },
      { id: 'refraction-under', scene: createTotalReflectionScene({ incidentAngle: 30 }), edits: [] as const,
        choice: ['refraction-angle', 'under'] as const, numeric: (capture: CapturedResult) => expectQuantity(capture, 'incident_angle', 'angle', 'rad', Math.asin(2 / 3) / 2) },
      { id: 'transformer-up', scene: createTransformerBenchScene(), edits: [['secondary-turns', 2000]] as const,
        choice: ['transformer-kind', 'step-up'] as const, numeric: (capture: CapturedResult) => expectQuantity(capture, 'secondary_voltage', 'electric_potential', 'V', 1100) },
      { id: 'transformer-down', scene: createTransformerBenchScene(), edits: [['secondary-turns', 500]] as const,
        choice: ['transformer-kind', 'step-down'] as const, numeric: (capture: CapturedResult) => expectQuantity(capture, 'secondary_voltage', 'electric_potential', 'V', 44) },
      { id: 'thermometer-room', scene: createThermometerCalibrationScene(), edits: [['thermometer-temperature', 50]] as const,
        choice: ['dip-into', 'room'] as const, numeric: (capture: CapturedResult) => expectQuantity(capture, 'reading_temperature', 'temperature', 'K', 298.15) },
    ]
    for (const fixture of cases) {
      const owner = createWorkbenchInstanceRuntime({ scene: fixture.scene, source: { kind: 'template', id: fixture.id }, scheduler: null })
      try {
        for (const [id, value] of fixture.edits) owner.editParameter(id, value)
        const before = owner.captureRaw()
        const historyCount = owner.getSnapshot().history.past.length
        const choice = owner.getSnapshot().workspace.inspector.flatMap(section => section.choices ?? []).find(entry => entry.id === fixture.choice[0])
        expect(choice?.value).toBe('custom')
        const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
        owner.setChoice(...fixture.choice)
        const after = owner.captureRaw()
        fixture.numeric(after)
        expect(execute).toHaveBeenCalledTimes(1)
        expect(after.scene.id).toBe(before.scene.id)
        expect(after.scene.revision).toBe(before.scene.revision + 1)
        expect(owner.getSnapshot().history.past).toHaveLength(historyCount + 1)
        expect(owner.getSnapshot().workspace.inspector.flatMap(section => section.choices ?? []).find(entry => entry.id === fixture.choice[0])?.value).toBe(fixture.choice[1])
        expect(after.request?.sceneId).toBe(after.scene.id)
        expect(after.result?.sceneId).toBe(after.scene.id)
        expect(after.request?.sceneRevision).toBe(after.scene.revision)
        expect(after.result?.sceneRevision).toBe(after.scene.revision)
        owner.setChoice(...fixture.choice)
        expect(execute).toHaveBeenCalledTimes(1)
        expect(owner.getSnapshot().history.past).toHaveLength(historyCount + 1)
        expect(owner.captureRaw().result).toEqual(after.result)
        execute.mockRestore()
      } finally {
        owner.dispose()
      }
    }
  })

  it('moves pinhole presets relative to edited object distance with one command per choice', () => {
    const runtime = new LightWorkspaceRuntime(createPinholeScene())
    runtime.editParameter('object-distance', 60)
    const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
    const simulate = vi.spyOn(LightEngine.prototype, 'simulate')
    for (const [value, ratio] of [['same', 1], ['smaller', 0.5], ['larger', 1.5]] as const) {
      const before = runtime.captureRaw()
      runtime.setChoice('pinhole-layout', value)
      const capture = runtime.captureRaw()
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0]?.[0].type).toBe('SetScreenDistance')
      expect(simulate).toHaveBeenCalledTimes(1)
      expect(capture.scene.revision).toBe(before.scene.revision + 1)
      expectQuantity(capture, 'screen_distance', 'length', 'm', 0.6 * ratio)
      expectQuantity(capture, 'magnification', 'dimensionless', '', ratio)
      expectQuantity(capture, 'image_height', 'length', 'm', 0.06 * ratio)
      expect(choiceValueOf(runtime, 'pinhole-layout')).toBe(value)
      expectHeldIdentity(capture)
      const samples = analysisOf(capture, 'light-pinhole-screen')
      expect(samples.rows).toHaveLength(3)
      expect(new Set(samples.rows.map(row => numberOf(row.axes.screen_distance)))).toEqual(new Set([0.6 * 0.5, 0.6, 0.6 * 1.5]))
      const repeatedBefore = runtime.captureRaw()
      runtime.setChoice('pinhole-layout', value)
      const repeatedAfter = runtime.captureRaw()
      expect(repeatedAfter.scene.revision).toBe(repeatedBefore.scene.revision)
      expect(repeatedAfter.result).toBe(repeatedBefore.result)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(simulate).toHaveBeenCalledTimes(1)
      execute.mockClear()
      simulate.mockClear()
    }
  })

  it('commits under, critical and past refraction presets with actual Snell-law readings and a single fork', () => {
    const source = questionScene(createTotalReflectionScene(), 'total-reflection')
    const sourceBytes = JSON.stringify(source)
    const runtime = new LightWorkspaceRuntime(source)
    const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
    const simulate = vi.spyOn(LightEngine.prototype, 'simulate')
    const critical = Math.asin(2 / 3)
    let branchId: PhysicsScene['id'] | undefined
    for (const [value, angle] of [['under', critical / 2], ['critical', critical], ['past', (critical + Math.PI / 2) / 2]] as const) {
      const before = runtime.captureRaw()
      runtime.setChoice('refraction-angle', value)
      const capture = runtime.captureRaw()
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0]?.[0].type).toBe('SetIncidentAngle')
      expect(simulate).toHaveBeenCalledTimes(1)
      expect(capture.scene.id).not.toBe(source.id)
      if (branchId === undefined) branchId = capture.scene.id
      else expect(capture.scene.id).toBe(branchId)
      expect(capture.engineInfo.release).toEqual(source.metadata.experimentRelease)
      expect(choiceValueOf(runtime, 'refraction-angle')).toBe(value)
      expectQuantity(capture, 'incident_angle', 'angle', 'rad', angle)
      if (value === 'past') {
        expectQuantity(capture, 'total_internal_reflection', 'dimensionless', '', -1)
        expect(resultOf(capture).derivedQuantities.some(derived => derived.key === 'refracted_angle')).toBe(false)
      } else {
        expectQuantity(capture, 'total_internal_reflection', 'dimensionless', '', 1)
        expectQuantity(capture, 'refracted_angle', 'angle', 'rad', value === 'critical' ? Math.PI / 2 : Math.asin(1.5 * Math.sin(angle)))
      }
      if (before.scene.id === capture.scene.id) expect(capture.scene.revision).toBe(before.scene.revision + 1)
      expectHeldIdentity(capture)
      expect(JSON.stringify(source)).toBe(sourceBytes)
      const repeated = runtime.captureRaw()
      runtime.setChoice('refraction-angle', value)
      expect(runtime.captureRaw().result).toBe(repeated.result)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(simulate).toHaveBeenCalledTimes(1)
      execute.mockClear()
      simulate.mockClear()
    }
    runtime.restoreOrigin()
    expect(runtime.getScene().id).toBe(source.id)
    expect(runtime.getScene().revision).toBe(3)
    expect(JSON.stringify(source)).toBe(sourceBytes)
  })

  it('offers no impossible critical or past choice when edited indices have no critical angle', () => {
    const runtime = new LightWorkspaceRuntime(createTotalReflectionScene())
    runtime.editParameter('incident-index', 1)
    runtime.editParameter('refracted-index', 1.5)
    const choice = runtime.getSnapshot().inspector.flatMap(section => section.choices ?? []).find(entry => entry.id === 'refraction-angle')
    expect(choice?.options.map(option => option.value)).toEqual(['under', 'custom'])
    const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
    const before = runtime.captureRaw()
    runtime.setChoice('refraction-angle', 'critical')
    runtime.setChoice('refraction-angle', 'past')
    expect(runtime.captureRaw().result).toBe(before.result)
    expect(execute).not.toHaveBeenCalled()
    runtime.setChoice('refraction-angle', 'under')
    expect(execute).toHaveBeenCalledTimes(1)
    expectQuantity(runtime.captureRaw(), 'incident_angle', 'angle', 'rad', Math.PI / 6)
    expectQuantity(runtime.captureRaw(), 'refracted_angle', 'angle', 'rad', Math.asin(1 / 3))
    expect(choiceValueOf(runtime, 'refraction-angle')).toBe('under')
  })

  it('uses real transformer down, same and up turns after primary edits and does not recommit a preset', () => {
    const runtime = new TransformerWorkspaceRuntime(createTransformerBenchScene())
    runtime.editParameter('primary-turns', 1500)
    const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
    const simulate = vi.spyOn(TransformerEngine.prototype, 'simulate')
    for (const [value, ratio] of [['step-up', 5], ['step-down', 0.2], ['same', 1]] as const) {
      const before = runtime.captureRaw()
      runtime.setChoice('transformer-kind', value)
      const capture = runtime.captureRaw()
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0]?.[0].type).toBe('SetSecondaryTurns')
      expect(simulate).toHaveBeenCalledTimes(1)
      expect(capture.scene.revision).toBe(before.scene.revision + 1)
      expectQuantity(capture, 'secondary_voltage', 'electric_potential', 'V', 220 * ratio)
      expectQuantity(capture, 'secondary_current', 'electric_current', 'A', 0.1 / ratio)
      expectQuantity(capture, 'secondary_power', 'power', 'W', 22)
      expect(numberOf(jsonObjectOf(capture.rawState?.model).secondaryTurns)).toBe(1500 * ratio)
      expect(choiceValueOf(runtime, 'transformer-kind')).toBe(value)
      expectHeldIdentity(capture)
      const repeated = runtime.captureRaw()
      runtime.setChoice('transformer-kind', value)
      runtime.setChoice('transformer-kind', 'not-a-mode')
      expect(runtime.captureRaw().result).toBe(repeated.result)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(simulate).toHaveBeenCalledTimes(1)
      execute.mockClear()
      simulate.mockClear()
    }
  })

  it('commits thermometer bath choices once and ignores invalid or repeated values', () => {
    const runtime = new ThermometerWorkspaceRuntime(createThermometerCalibrationScene())
    const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
    for (const [value, kelvin] of [['ice', 273.15], ['steam', 373.15], ['room', 298.15]] as const) {
      const before = runtime.captureRaw()
      runtime.setChoice('dip-into', value)
      const capture = runtime.captureRaw()
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0]?.[0].type).toBe('SetThermometerTemperature')
      expect(capture.scene.revision).toBe(before.scene.revision + 1)
      expectQuantity(capture, 'reading_temperature', 'temperature', 'K', kelvin)
      expect(choiceValueOf(runtime, 'dip-into')).toBe(value)
      expectHeldIdentity(capture)
      runtime.setChoice('dip-into', value)
      runtime.setChoice('dip-into', 'not-a-bath')
      expect(execute).toHaveBeenCalledTimes(1)
      expect(runtime.captureRaw().result).toBe(capture.result)
      execute.mockClear()
    }
  })

  it('does not reverse a current for an invalid direction choice', () => {
    const runtime = new CurrentWorkspaceRuntime(createStraightWireFieldScene())
    runtime.setChoice('current-direction', 'in')
    const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
    const before = runtime.captureRaw()
    runtime.setChoice('current-direction', 'not-a-direction')
    runtime.setChoice('current-direction', 'in')
    expect(runtime.captureRaw().result).toBe(before.result)
    expect(execute).not.toHaveBeenCalled()
    runtime.setChoice('current-direction', 'out')
    expect(execute).toHaveBeenCalledTimes(1)
    expectQuantity(runtime.captureRaw(), 'wire_current', 'electric_current', 'A', 10)
    expect(choiceValueOf(runtime, 'current-direction')).toBe('out')
  })

  it('recovers editable pressure parameters after failed zero-force and zero-depth verification', () => {
    const solid = new PressureWorkspaceRuntime(createSolidPressureScene())
    solid.editParameter('pressure-force', 0)
    const failed = publicCapturedResult(solid.captureRaw())
    const failedBytes = canonicalStringify(failed)
    expect(solid.getSnapshot().status).toBe('failed')
    expect(solid.getSnapshot().inspector.flatMap(section => section.parameters ?? []).some(parameter => parameter.id === 'pressure-force')).toBe(true)
    const execute = vi.spyOn(SceneRuntime.prototype, 'execute')
    solid.editParameter('pressure-force', 10)
    expect(execute).toHaveBeenCalledTimes(1)
    const recovered = solid.captureRaw()
    expect(solid.getSnapshot().status).toBe('verified')
    expect(recovered.scene.revision).toBe(failed.scene.revision + 1)
    expectQuantity(recovered, 'contact_force', 'force', 'N', 10)
    expectQuantity(recovered, 'contact_pressure', 'pressure', 'Pa', 500)
    expectHeldIdentity(recovered)
    expect(canonicalStringify(failed)).toBe(failedBytes)
    expect(resultOf(failed).verification.status).toBe('failed')
    execute.mockClear()
    const liquid = new PressureWorkspaceRuntime(createLiquidPressureScene())
    liquid.editParameter('probe-depth', 0)
    const surface = liquid.captureRaw()
    expect(liquid.getSnapshot().status).toBe('failed')
    expect(liquid.getSnapshot().inspector.flatMap(section => section.parameters ?? []).some(parameter => parameter.id === 'probe-depth')).toBe(true)
    execute.mockClear()
    liquid.setChoice('liquid-density', 'brine')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(choiceValueOf(liquid, 'liquid-density')).toBe('brine')
    expectQuantity(liquid.captureRaw(), 'liquid_density', 'density', 'kg/m^3', 1100)
    execute.mockClear()
    liquid.editParameter('probe-depth', 20)
    expect(execute).toHaveBeenCalledTimes(1)
    const submerged = liquid.captureRaw()
    expect(liquid.getSnapshot().status).toBe('verified')
    expect(submerged.scene.revision).toBe(surface.scene.revision + 2)
    expectQuantity(submerged, 'liquid_pressure', 'pressure', 'Pa', 2156)
    expectHeldIdentity(submerged)
    execute.mockRestore()
    const owner = createWorkbenchInstanceRuntime({ scene: createSolidPressureScene(), source: { kind: 'template', id: 'pressure-recovery' }, scheduler: null })
    try {
      owner.editParameter('pressure-force', 0)
      const failedSummary = owner.getSnapshot()
      expect(failedSummary.workspace.status).toBe('failed')
      const historyCount = failedSummary.history.past.length
      owner.editParameter('pressure-force', 10)
      expect(owner.getSnapshot().workspace.status).toBe('verified')
      expect(owner.getSnapshot().history.past).toHaveLength(historyCount + 1)
      expectQuantity(owner.captureRaw(), 'contact_pressure', 'pressure', 'Pa', 500)
    } finally {
      owner.dispose()
    }
  })
})

describe('capture identity and failure retention', () => {
  const rejectedEdits: readonly { readonly fixture: string; readonly parameter: string; readonly value: number }[] = [
    { fixture: 'solid-pressure', parameter: 'contact-area', value: 0 },
    { fixture: 'straight-wire-field', parameter: 'probe-distance', value: 0 },
    { fixture: 'pinhole', parameter: 'object-distance', value: 0 },
    { fixture: 'transformer', parameter: 'primary-turns', value: 0 },
    { fixture: 'thermometer', parameter: 'bulb-volume', value: 0 },
    { fixture: 'noise', parameter: 'listener-distance', value: 0 },
  ]
  for (const edit of rejectedEdits) {
    it(`keeps the owned scene, revision and held result when ${edit.fixture} rejects its first question edit`, () => {
      const fixture = fixtures.find(entry => entry.id === edit.fixture)!
      const simulate = vi.spyOn(fixture.engine.prototype, 'simulate')
      const source = questionScene(fixture.createScene(), fixture.id)
      const sourceBytes = JSON.stringify(source)
      const runtime = fixture.createRuntime(source)
      const before = runtime.captureRaw()
      runtime.editParameter(edit.parameter, edit.value)
      const after = runtime.captureRaw()
      expect(after.scene).toEqual(before.scene)
      expect(after.scene.id).toBe(source.id)
      expect(after.scene.revision).toBe(3)
      expect(after.request).toBe(before.request)
      expect(after.result).toBe(before.result)
      expect(after.state).toBe(before.state)
      expect(after.analysis).toBe(before.analysis)
      expect(after.engineInfo.release).toEqual(source.metadata.experimentRelease)
      expect(after.diagnostics?.length).toBeGreaterThan(0)
      expect(simulate).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(source)).toBe(sourceBytes)
      expect(publicCapturedResult(after).result?.sceneId).toBe(source.id)
    })
  }

  it('aligns successful experimental forks and restoration without changing a historical capture', () => {
    const source = questionScene(createSolenoidFieldScene(), 'solenoid-field')
    const sourceBytes = JSON.stringify(source)
    const runtime = new CurrentWorkspaceRuntime(source)
    const history = publicCapturedResult(runtime.captureRaw())
    const historyBytes = canonicalStringify(history)
    runtime.editParameter('solenoid-turns', 600)
    const forked = runtime.captureRaw()
    expect(forked.scene.id).not.toBe(source.id)
    expect(forked.request?.sceneId).toBe(forked.scene.id)
    expect(forked.result?.sceneId).toBe(forked.scene.id)
    expect(forked.request?.sceneRevision).toBe(forked.scene.revision)
    expect(forked.result?.sceneRevision).toBe(forked.scene.revision)
    expect(forked.engineInfo.release).toEqual(source.metadata.experimentRelease)
    expectQuantity(forked, 'magnetic_flux_density', 'magnetic_flux_density', 'T', 6 * Math.PI * 1e-3)
    runtime.restoreOrigin()
    const restored = runtime.captureRaw()
    expect(restored.scene.id).toBe(source.id)
    expect(restored.scene.revision).toBe(3)
    expect(restored.result?.sceneId).toBe(source.id)
    expect(restored.result?.sceneRevision).toBe(3)
    expect(restored.engineInfo.release).toEqual(source.metadata.experimentRelease)
    expect(canonicalStringify(history)).toBe(historyBytes)
    expect(JSON.stringify(source)).toBe(sourceBytes)
  })

  it('retains real zero-force results and states when verification fails', () => {
    const runtime = new PressureWorkspaceRuntime(createSolidPressureScene())
    runtime.editParameter('pressure-force', 0)
    const capture = runtime.captureRaw()
    expect(runtime.getSnapshot().status).toBe('failed')
    expect(resultOf(capture).verification.status).toBe('failed')
    expect(capture.request?.sceneRevision).toBe(capture.scene.revision)
    expect(capture.state).toBe(resultOf(capture).states[0])
    expectQuantity(capture, 'contact_force', 'force', 'N', 0)
    expectQuantity(capture, 'contact_pressure', 'pressure', 'Pa', 0)
    expectQuantity(capture, 'comparison_pressure', 'pressure', 'Pa', 0)
    expect(capture.diagnostics?.length).toBeGreaterThan(0)
    const rows = analysisOf(capture, 'pressure-solid-area').rows
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.values.contact_pressure)).toEqual([0, 0])
    assertPublishedDatasets(capture)
  })

  it('retains real surface-depth data even when ratio verification has no nonzero denominator', () => {
    const runtime = new PressureWorkspaceRuntime(createLiquidPressureScene())
    runtime.editParameter('probe-depth', 0)
    const capture = runtime.captureRaw()
    expect(resultOf(capture).verification.status).toBe('failed')
    expectQuantity(capture, 'liquid_pressure', 'pressure', 'Pa', 0)
    expectQuantity(capture, 'comparison_depth_pressure', 'pressure', 'Pa', 3920)
    expect(analysisOf(capture, 'pressure-liquid-depth').rows.map(row => row.axes.probe_depth)).toEqual([0, 0.4])
    assertPublishedDatasets(capture)
  })

  it('does not relabel a prior-revision result after an engine throws on a new solve', () => {
    const runtime = new PressureWorkspaceRuntime(createSolidPressureScene())
    const prior = runtime.captureRaw()
    const simulate = vi.spyOn(PressureEngine.prototype, 'simulate').mockImplementationOnce(() => { throw new Error('test solve failure') })
    runtime.editParameter('pressure-force', 30)
    const capture = runtime.captureRaw()
    expect(simulate).toHaveBeenCalledTimes(1)
    expect(capture.scene.revision).toBe(prior.scene.revision + 1)
    expect(capture.request?.sceneRevision).toBe(capture.scene.revision)
    expect(capture.result).toBeUndefined()
    expect(capture.state).toBeUndefined()
    expect(capture.rawState).toBeUndefined()
    expect(capture.analysis).toBeUndefined()
    expect(capture.diagnostics).toEqual([{ code: 'PRESSURE_RUNTIME_FAILED', message: 'test solve failure' }])
    expect(resultOf(prior).sceneRevision).toBe(0)
    expect(publicCapturedResult(capture).request?.sceneRevision).toBe(1)
  })

  it('preserves custom release provenance in raw and serialized snapshots', () => {
    const base = createNoiseBarrierScene()
    const release: NonNullable<PhysicsScene['metadata']['experimentRelease']> = {
      kind: 'community', id: 'community-noise-capture-v2', experimentId: 'noise', version: '2.0.0',
      sha256: createHash('sha256').update('community-noise-capture-test-release').digest('hex'),
    }
    const source: PhysicsScene = { ...base, metadata: { ...base.metadata, experimentRelease: release } }
    const runtime = new NoiseWorkspaceRuntime(source)
    runtime.setChoice('barrier', 'wall')
    const capture = publicCapturedResult(runtime.captureRaw())
    expect(capture.engineInfo.release).toEqual(release)
    expect(capture.scene.metadata.experimentRelease).toEqual(release)
    const datasets = assertPublishedDatasets(capture)
    const snapshot = createSnapshotObject({ ...capture,
      sceneRef: refOf('scene', createSceneObject(capture.scene)), instanceId: 'community-noise', instanceEditRevision: capture.scene.revision,
      capturedAt: '2026-11-08T00:00:00.000Z', source: 'client-engine', datasets: datasets.map(dataset => refOf('dataset', dataset)),
    })
    expect(snapshot.engine.release).toEqual(release)
    expect(snapshot.source).toBe('client-engine')
  })

  it('reports unsupported scenes without inventing requests, states, samples or a running clock', () => {
    const unsupported: readonly StaticRuntime[] = [
      new PressureWorkspaceRuntime(createPinholeScene()),
      new CurrentWorkspaceRuntime(createSolidPressureScene()),
      new LightWorkspaceRuntime(createSolidPressureScene()),
      new TransformerWorkspaceRuntime(createSolidPressureScene()),
      new ThermometerWorkspaceRuntime(createSolidPressureScene()),
      new NoiseWorkspaceRuntime(createSolidPressureScene()),
    ]
    for (const runtime of unsupported) {
      const capture = runtime.captureRaw()
      expect(capture.request).toBeUndefined()
      expect(capture.result).toBeUndefined()
      expect(capture.state).toBeUndefined()
      expect(capture.rawState).toBeUndefined()
      expect(capture.analysis).toBeUndefined()
      expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
      expect(capture.cursor.kind).toBe('static')
      expect(capture.engineInfo.id.length).toBeGreaterThan(0)
      expect(capture.engineInfo.version).toBe('1.0.0')
      expect(capture.diagnostics?.length).toBeGreaterThan(0)
      const publicCapture = publicCapturedResult(capture)
      expect(captureDatasets(publicCapture, { sourceScene: refOf('scene', createSceneObject(capture.scene)) })).toEqual([])
      expect(() => createSnapshotObject({ ...publicCapture,
        sceneRef: refOf('scene', createSceneObject(capture.scene)), instanceId: 'unsupported', instanceEditRevision: 0,
        capturedAt: '2026-11-08T00:00:00.000Z', source: 'client-engine', datasets: [],
      })).toThrow()
    }
  })
})
