import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AcousticsEngine,
  pulseStateAt,
  resolveEchoRanging,
} from '@physicsos/engine-acoustics'
import { OpticsEngine, resolveOpticalImaging } from '@physicsos/engine-optics'
import {
  FluidEngine,
  immersionStateAt,
  resolveBuoyancy,
} from '@physicsos/engine-fluid'
import {
  ThermalEngine,
  resolveHeatingCurve,
  sampleStateAt,
  thermalStateAt,
} from '@physicsos/engine-thermal'
import * as leverPhysics from '@physicsos/engine-lever'
import {
  isScalarQuantity,
  type PhysicsEngine,
  type SimulationResult,
} from '@physicsos/physics-core'
import {
  createArchimedesScene,
  createBoilingWaterScene,
  createConvexLensScene,
  createCrystalMeltingScene,
  createEchoRangingScene,
  createHeatCapacityComparisonScene,
  createLeverBalanceScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { asQuestionId, PhysicsOSError } from '@physicsos/shared'
import { createSceneObject, parseObject } from '@physicsos/physics-workbench/codec'
import { axisCompatibility } from '@physicsos/physics-workbench/comparison'
import {
  captureDatasets,
  createSnapshotObject,
  publicCapturedResult,
} from '@physicsos/physics-workbench/data'
import { canonicalStringify, copyJsonObject } from '@physicsos/physics-workbench/json'
import type {
  CapturedResult,
  DatasetObject,
  JsonObject,
  ObjectRef,
} from '@physicsos/physics-workbench/types'

import { createAcousticsWorkspaceRuntime } from '../src/client/physics/acoustics-workspace-runtime.ts'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createFluidWorkspaceRuntime } from '../src/client/physics/fluid-workspace-runtime.ts'
import { createThermalWorkspaceRuntime } from '../src/client/physics/thermal-workspace-runtime.ts'
import { createLeverWorkspaceRuntime } from '../src/client/physics/lever-workspace-runtime.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import type { WorkspaceRuntime } from '../src/client/physics/workspace-runtime.ts'

type CapturingRuntime = WorkspaceRuntime & {
  getScene(): PhysicsScene
  captureRaw(): CapturedResult
}

interface BenchFixture {
  readonly templateId: string
  readonly create: (scene: PhysicsScene) => CapturingRuntime
  readonly enginePrototype: PhysicsEngine<PhysicsScene>
  readonly samples: number
  readonly axis: 'time' | 'static'
  readonly edit: { readonly id: string; readonly value: number }
}

const BENCHES: readonly BenchFixture[] = [
  {
    templateId: 'echo-ranging', create: createAcousticsWorkspaceRuntime,
    enginePrototype: AcousticsEngine.prototype, samples: 65, axis: 'time',
    edit: { id: 'wall-distance', value: 510 },
  },
  {
    templateId: 'convex-lens', create: createOpticsWorkspaceRuntime,
    enginePrototype: OpticsEngine.prototype, samples: 1, axis: 'static',
    edit: { id: 'object-distance', value: 20 },
  },
  {
    templateId: 'buoyancy', create: createFluidWorkspaceRuntime,
    enginePrototype: FluidEngine.prototype, samples: 65, axis: 'time',
    edit: { id: 'block-mass', value: 300 },
  },
  {
    templateId: 'crystal-melting', create: createThermalWorkspaceRuntime,
    enginePrototype: ThermalEngine.prototype, samples: 97, axis: 'time',
    edit: { id: 'heater-power', value: 100 },
  },
  {
    templateId: 'lever-balance', create: createLeverWorkspaceRuntime,
    enginePrototype: leverPhysics.LeverEngine.prototype, samples: 25, axis: 'static',
    edit: { id: 'left-mass', value: 400 },
  },
]

const PICKER_BENCHES: readonly BenchFixture[] = [
  ...BENCHES,
  ...['plane-mirror', 'concave-mirror', 'convex-mirror'].map(templateId => ({
    ...BENCHES[1]!, templateId,
  })),
  ...['boiling-water', 'heat-capacity-comparison'].map(templateId => ({
    ...BENCHES[3]!, templateId,
  })),
]

afterEach(() => vi.restoreAllMocks())

const pickerScene = (templateId: string): PhysicsScene => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`Missing real bench template ${templateId}`)
  return createExperimentSceneRef(template, templateId).scene
}

const resultOf = (capture: CapturedResult): SimulationResult => {
  if (capture.result === undefined) throw new Error('Capture lost the real engine result')
  return capture.result
}

const nativeObject = (capture: CapturedResult, key = 'currentState'): JsonObject => {
  const value = capture.rawState?.[key]
  if (value === undefined) throw new Error(`Capture lost native ${key}`)
  return copyJsonObject(value)
}

const nativeNumber = (object: JsonObject, key: string): number => {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Native ${key} is not a finite numerical reading`)
  }
  return value
}

const objectQuantity = (result: SimulationResult, index: number, targetId: string, key: string) => {
  const value = result.states[index]?.objects.find(object => object.id === targetId)?.values?.[key]
  if (value === undefined || !isScalarQuantity(value)) throw new Error(`Missing raw ${targetId}/${key}`)
  return value
}

const derivedQuantity = (capture: CapturedResult, key: string) => {
  const value = resultOf(capture).derivedQuantities.find(entry => entry.key === key)?.value
  if (value === undefined || !isScalarQuantity(value)) throw new Error(`Missing raw derived ${key}`)
  return value
}

const failedResult = (actual: SimulationResult): SimulationResult => ({
  ...actual,
  verification: {
    ...actual.verification,
    status: 'failed',
    checks: [...actual.verification.checks, { id: 'capture-test-failure', type: 'numerical', passed: false }],
    errors: [...actual.verification.errors, {
      code: 'CAPTURE_TEST_FAILURE', severity: 'error', message: 'Retain this actual failed engine evidence.',
    }],
  },
})

const hash = (value: unknown): string =>
  createHash('sha256').update(canonicalStringify(value)).digest('hex')

const sceneRefOf = (capture: CapturedResult): ObjectRef<'scene'> => ({
  kind: 'scene', digest: hash(createSceneObject(capture.scene)),
})

const datasetsOf = (capture: CapturedResult): readonly DatasetObject[] =>
  captureDatasets(capture, { sourceScene: sceneRefOf(capture) })

const datasetOf = (datasets: readonly DatasetObject[], collection: DatasetObject['origin']['collection']) => {
  const dataset = datasets.find(entry => entry.origin.collection === collection)
  if (dataset === undefined) throw new Error(`Missing ${collection} dataset`)
  return dataset
}

const metricOf = (
  dataset: DatasetObject,
  key: string,
  targetId?: string,
  provenance: 'object' | 'derived' = 'object',
) => {
  const matches = dataset.metrics.filter(metric =>
    metric.semanticKey === key && metric.targetId === targetId && metric.component === 'scalar'
      && metric.id.startsWith(`${provenance}:`),
  )
  if (matches.length !== 1) throw new Error(`Expected one raw metric ${targetId ?? ''}/${key}`)
  return matches[0]!
}

const snapshotOf = (capture: CapturedResult, datasets = datasetsOf(capture)) =>
  createSnapshotObject({
    ...capture,
    sceneRef: sceneRefOf(capture),
    instanceId: `capture-test-${String(capture.scene.id)}`,
    instanceEditRevision: capture.scene.revision,
    capturedAt: '2026-11-08T00:00:00.000Z',
    source: 'client-engine',
    datasets: datasets.map(dataset => ({ kind: 'dataset', digest: hash(dataset) })),
  })

/** Compares every native scalar sample, including values omitted by the panel table. */
const expectAllStateValues = (capture: CapturedResult, dataset: DatasetObject) => {
  const result = resultOf(capture)
  expect(dataset.rows).toHaveLength(result.states.length)
  for (const [index, state] of result.states.entries()) {
    const row = dataset.rows[index]!
    expect(row.evidence?.['rawTime']).toEqual(state.time)
    for (const object of state.objects) {
      for (const [key, value] of Object.entries(object.values ?? {})) {
        if (!isScalarQuantity(value)) throw new Error('Bench fixture unexpectedly contains a vector')
        const metric = metricOf(dataset, key, object.id)
        expect(metric.unit).toBe(value.unit)
        expect(metric.dimension).toBe(value.dimension)
        expect(row.values[metric.id]).toBe(value.value)
      }
    }
    for (const derived of state.derived) {
      if (!isScalarQuantity(derived.value)) throw new Error('Bench derived fixture unexpectedly contains a vector')
      const metric = metricOf(dataset, derived.key, derived.targetId, 'derived')
      expect(row.values[metric.id]).toBe(derived.value.value)
      expect(metric.unit).toBe(derived.value.unit)
    }
  }
}

describe('bench raw capture · real picker templates', () => {
  for (const fixture of PICKER_BENCHES) {
    it(`${fixture.templateId} retains the actual request, full samples, units and portable raw state`, () => {
      const source = pickerScene(fixture.templateId)
      const sourceBefore = canonicalStringify(copyJsonObject(source))
      const simulate = vi.spyOn(fixture.enginePrototype, 'simulate')
      const runtime = fixture.create(source)
      const initial = runtime.captureRaw()
      expect(resultOf(initial).states).toHaveLength(fixture.samples)
      expect(initial.request).toBe(simulate.mock.calls[0]?.[1])
      expect(initial.result).toBe(simulate.mock.results[0]?.value)

      runtime.seek(fixture.axis === 'time' ? initial.clock.total * 0.37 : 0)
      runtime.setRate(1.75)
      runtime.setRunning(true)
      const frame = runtime.getSnapshot()
      const callsBeforeCapture = simulate.mock.calls.length
      simulate.mockImplementation(() => { throw new Error('Capture must not simulate') })
      vi.spyOn(fixture.enginePrototype, 'stateAt').mockImplementation(() => {
        throw new Error('Capture must not recompute a cursor state')
      })
      vi.spyOn(runtime, 'getSnapshot').mockImplementation(() => {
        throw new Error('Capture must not read a renderer frame')
      })

      const capture = runtime.captureRaw()
      const again = runtime.captureRaw()
      expect(simulate).toHaveBeenCalledTimes(callsBeforeCapture)
      expect(capture.request).toBe(initial.request)
      expect(capture.result).toBe(initial.result)
      expect(again.rawState).toBe(capture.rawState)
      expect(capture.clock).toEqual(frame.clock)
      expect(capture.cursor.kind).toBe(fixture.axis)
      expect(capture.engineInfo.id).toBe(resultOf(capture).metadata.engineId)
      expect(capture.engineInfo.version).toBe(resultOf(capture).metadata.engineVersion)
      expect(capture.engineInfo.model).toBeTruthy()
      expect(capture.diagnostics?.some(entry => entry['stage'] === 'verification')).toBe(true)
      expect(canonicalStringify(copyJsonObject(source))).toBe(sourceBefore)
      expect(capture.analysis).toBeUndefined()

      const published = publicCapturedResult(capture)
      expect(published.result).toEqual(capture.result)
      expect(published.result).not.toBe(capture.result)
      expect(published.rawState).toEqual(capture.rawState)
      expect(Object.isFrozen(published.rawState)).toBe(true)
      const datasets = datasetsOf(published)
      const states = datasetOf(datasets, 'states')
      expectAllStateValues(capture, states)
      expect(states.axes[0]?.kind).toBe(fixture.axis)
      expect(states.axes[0]?.unit).toBe(fixture.axis === 'time' ? 's' : '')
      expect(states.axes[0]?.dimension).toBe(fixture.axis === 'time' ? 'time' : 'dimensionless')
      expect(states.conditions.length).toBeGreaterThan(0)
      expect(states.origin.sceneId).toBe(String(capture.scene.id))
      expect(states.origin.sceneRevision).toBe(capture.scene.revision)
      expect(states.origin.simulationId).toBe(String(resultOf(capture).simulationId))
      expect(states.sourceScene).toEqual(sceneRefOf(capture))
      if (fixture.samples > 1) expect(states.rows.length).toBeGreaterThan(frame.table.rows.length)
      if (fixture.axis === 'time') {
        expect(states.rows.map(row => row.axes['time'])).toEqual(
          resultOf(capture).states.map(state => canonicalValue(state.time)),
        )
        expect(capture.cursor).toEqual({ kind: 'time', time: quantity(frame.clock.time, 's', 'time') })
      } else {
        expect(capture.clock.time).toBe(0)
        expect(capture.clock.total).toBe(0)
        expect(capture.clock.running).toBe(false)
        expect(states.rows.every(row => row.axes['static'] === 0)).toBe(true)
      }

      const snapshot = snapshotOf(published, datasets)
      expect(snapshot.request).toEqual(capture.request)
      expect(snapshot.result).toEqual(capture.result)
      expect(snapshot.rawState).toEqual(capture.rawState)
      const decoded: unknown = JSON.parse(canonicalStringify(snapshot))
      expect(decoded).toEqual(snapshot)
      const parsed = parseObject(decoded)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
      expect(parsed.value).toEqual(snapshot)
      expect(canonicalStringify(publicCapturedResult(capture))).toBe(canonicalStringify(published))
    })
  }
})

describe('bench raw capture · numerical current states and native axes', () => {
  it('keeps real scene seconds, playback rates, completion and restart separate from source facts', () => {
    const clocks: readonly { readonly scene: PhysicsScene; readonly create: BenchFixture['create'] }[] = [
      { scene: createEchoRangingScene(), create: createAcousticsWorkspaceRuntime },
      { scene: createArchimedesScene(), create: createFluidWorkspaceRuntime },
      { scene: createCrystalMeltingScene(), create: createThermalWorkspaceRuntime },
      { scene: createLeverBalanceScene({ leftMass: 400 }), create: createLeverWorkspaceRuntime },
    ]
    for (const fixture of clocks) {
      const sourceBefore = canonicalStringify(copyJsonObject(fixture.scene))
      const runtime = fixture.create(fixture.scene)
      const initial = runtime.captureRaw()
      expect(initial.clock.total).toBeGreaterThan(0)
      const wallSeconds = Math.min(0.2, initial.clock.total / 10)
      runtime.setRate(2.5)
      runtime.setRunning(true)
      runtime.advance(wallSeconds)
      const playing = runtime.captureRaw()
      expect(playing.clock.time).toBeCloseTo(wallSeconds * 2.5, 12)
      expect(playing.clock.running).toBe(true)
      expect(playing.clock.rate).toBe(2.5)
      expect(playing.result).toBe(initial.result)
      expect(playing.rawState).not.toEqual(initial.rawState)
      runtime.advance(initial.clock.total)
      const completed = runtime.captureRaw()
      expect(completed.clock.time).toBe(initial.clock.total)
      expect(completed.clock.running).toBe(false)
      runtime.setRunning(true)
      const replay = runtime.captureRaw()
      expect(replay.clock.time).toBe(0)
      expect(replay.clock.running).toBe(true)
      expect(replay.rawState).toEqual(initial.rawState)
      expect(canonicalStringify(copyJsonObject(fixture.scene))).toBe(sourceBefore)
    }
  })

  it('captures the return-leg pulse without rounding or selecting a neighbouring stored sample', () => {
    const source = createEchoRangingScene({ wallDistance: 341.23456789, soundSpeed: 343.21 })
    const model = resolveEchoRanging(source)
    const runtime = createAcousticsWorkspaceRuntime(source)
    const time = (model.wallDistance / model.soundSpeed) * 1.4137
    runtime.seek(time)
    const capture = runtime.captureRaw()
    const current = nativeObject(capture)
    expect(current).toEqual(copyJsonObject(pulseStateAt(model, time)))
    expect(current['phase']).toBe('return')
    expect(nativeNumber(current, 'travelled')).toBe(model.soundSpeed * time)
    expect(nativeObject(capture, 'model')).toEqual(copyJsonObject(model))
    expect(resultOf(capture).states.some(state => canonicalValue(state.time) === time)).toBe(false)
    const states = datasetOf(datasetsOf(capture), 'states')
    expect(metricOf(states, 'pulse_position_x', model.benchId).unit).toBe('m')
    const last = resultOf(capture).states.length - 1
    expect(objectQuantity(resultOf(capture), last, model.benchId, 'pulse_position_x').value).toBe(0)
    expect(objectQuantity(resultOf(capture), last, model.benchId, 'pulse_travelled').value).toBe(2 * model.wallDistance)
  })

  it('retains immersion volume and force for both the sinking tail and a floating equilibrium', () => {
    const source = createArchimedesScene()
    const model = resolveBuoyancy(source)
    const runtime = createFluidWorkspaceRuntime(source)
    runtime.seek(1.25)
    const partial = runtime.captureRaw()
    expect(nativeObject(partial)).toEqual(copyJsonObject(immersionStateAt(model, 1.25)))
    expect(nativeNumber(nativeObject(partial), 'displacedVolume')).toBeCloseTo(5e-5, 14)
    expect(nativeNumber(nativeObject(partial), 'buoyantForce')).toBeCloseTo(0.49, 12)
    expect(nativeNumber(nativeObject(partial), 'scaleReading')).toBeCloseTo(2.156, 12)
    runtime.seek(5)
    const sunk = runtime.captureRaw()
    expect(nativeNumber(nativeObject(sunk), 'depth')).toBeCloseTo(0.1, 12)
    expect(nativeNumber(nativeObject(sunk), 'buoyantForce')).toBeCloseTo(0.98, 12)
    expect(nativeNumber(nativeObject(sunk), 'scaleReading')).toBeCloseTo(1.666, 12)
    const states = datasetOf(datasetsOf(sunk), 'states')
    expect(metricOf(states, 'displaced_volume', model.tankId).unit).toBe('m^3')
    expect(metricOf(states, 'scale_reading', model.tankId).unit).toBe('N')
    expectAllStateValues(sunk, states)

    const floatingRuntime = createFluidWorkspaceRuntime(createArchimedesScene({ blockMass: 50 }))
    floatingRuntime.seek(10)
    const floating = floatingRuntime.captureRaw()
    expect(floating.clock.total).toBeCloseTo(1.25, 12)
    expect(nativeObject(floating)['phase']).toBe('floating')
    expect(nativeNumber(nativeObject(floating), 'submergedHeight')).toBeCloseTo(0.025, 12)
    expect(nativeNumber(nativeObject(floating), 'buoyantForce')).toBeCloseTo(0.49, 12)
    expect(nativeNumber(nativeObject(floating), 'scaleReading')).toBeCloseTo(0, 12)
  })

  it('keeps kelvin absolute temperatures, true melting fraction and unthinned heat samples', () => {
    const source = createCrystalMeltingScene()
    const model = resolveHeatingCurve(source)
    const runtime = createThermalWorkspaceRuntime(source)
    runtime.seek(418)
    const capture = runtime.captureRaw()
    expect(capture.clock.total).toBe(836)
    expect(capture.clock.rate).toBe(20)
    expect(nativeObject(capture)).toEqual(copyJsonObject(thermalStateAt(model, 418)))
    expect(nativeNumber(nativeObject(capture), 'temperature')).toBeCloseTo(273.15, 12)
    expect(nativeNumber(nativeObject(capture), 'heatAbsorbed')).toBe(20_900)
    expect(nativeNumber(nativeObject(capture), 'meltedFraction')).toBeCloseTo(0.5, 12)
    expect(nativeObject(capture)['phase']).toBe('melting')
    const states = datasetOf(datasetsOf(capture), 'states')
    const temperature = metricOf(states, 'temperature', model.benchId)
    expect(temperature.unit).toBe('K')
    expect(temperature.scale.kind).toBe('temperature-absolute')
    expect(metricOf(states, 'heat_absorbed', model.benchId).unit).toBe('J')
    expectAllStateValues(capture, states)
    const last = resultOf(capture).states.length - 1
    expect(objectQuantity(resultOf(capture), last, model.benchId, 'temperature').value).toBeCloseTo(283.15, 12)
    expect(objectQuantity(resultOf(capture), last, model.benchId, 'heat_absorbed').value).toBe(41_800)
    expect(nativeObject(capture, 'model')).not.toHaveProperty('boilingPoint')
    expect(nativeObject(capture, 'model')).not.toHaveProperty('vaporizationHeat')
    expect(snapshotOf(capture).rawState).toEqual(capture.rawState)
  })

  it('preserves the comparison sample heat/state and declares temperature rises as differences', () => {
    const source = createHeatCapacityComparisonScene()
    const model = resolveHeatingCurve(source)
    if (model.comparisonSample === undefined) throw new Error('Real comparison template lost its second sample')
    const runtime = createThermalWorkspaceRuntime(source)
    runtime.seek(420)
    const capture = runtime.captureRaw()
    expect(nativeObject(capture)).toEqual(copyJsonObject(thermalStateAt(model, 420)))
    expect(nativeObject(capture, 'comparisonState')).toEqual(copyJsonObject(
      sampleStateAt(model.comparisonSample, model.heaterPower, 420, model.runDuration),
    ))
    expect(nativeNumber(nativeObject(capture), 'temperature')).toBeCloseTo(343.15, 12)
    expect(nativeNumber(nativeObject(capture, 'comparisonState'), 'temperature')).toBeCloseTo(393.15, 12)
    expect(nativeNumber(nativeObject(capture, 'comparisonState'), 'heatAbsorbed')).toBe(21_000)
    const datasets = datasetsOf(capture)
    const states = datasetOf(datasets, 'states')
    expect(metricOf(states, 'temperature', model.sampleId).scale.kind).toBe('temperature-absolute')
    expect(metricOf(states, 'temperature', model.comparisonSample.sampleId).scale.kind).toBe('temperature-absolute')
    const derived = datasetOf(datasets, 'derived')
    const waterRise = derivedQuantity(capture, 'temperature_rise')
    const oilRise = derivedQuantity(capture, 'comparison_temperature_rise')
    expect(waterRise.value).toBeCloseTo(50, 12)
    expect(oilRise.value).toBeCloseTo(100, 12)
    const primaryMetric = derived.metrics.find(metric => metric.semanticKey === 'temperature_rise')
    const otherMetric = derived.metrics.find(metric => metric.semanticKey === 'comparison_temperature_rise')
    expect(primaryMetric?.unit).toBe('K')
    expect(primaryMetric?.scale.kind).toBe('temperature-difference')
    expect(otherMetric?.scale.kind).toBe('temperature-difference')
    expectAllStateValues(capture, states)
  })

  it('retains the boiling plateau as energy input rather than inventing a continuing temperature rise', () => {
    const runtime = createThermalWorkspaceRuntime(createBoilingWaterScene())
    runtime.seek(1_000)
    const capture = runtime.captureRaw()
    expect(capture.clock.total).toBe(2_596)
    expect(nativeObject(capture)['phase']).toBe('boiling')
    expect(nativeNumber(nativeObject(capture), 'temperature')).toBeCloseTo(373.15, 12)
    expect(nativeNumber(nativeObject(capture), 'heatAbsorbed')).toBe(500_000)
    const model = nativeObject(capture, 'model')
    expect(nativeNumber(model, 'boilingPoint')).toBeCloseTo(373.15, 12)
    expect(nativeNumber(model, 'vaporizationHeat')).toBe(2_260_000)
    const states = datasetOf(datasetsOf(capture), 'states')
    const temperature = metricOf(states, 'temperature', 'thermal-bench-1')
    const lateRows = states.rows.filter(row => typeof row.axes['time'] === 'number' && row.axes['time'] >= 336)
    expect(lateRows.length).toBeGreaterThan(1)
    for (const row of lateRows) expect(row.values[temperature.id]).toBeCloseTo(373.15, 12)
  })

  it('captures geometric imaging as static, retaining metres in its model and centimetres in stored results', () => {
    const source = createConvexLensScene()
    const expected = resolveOpticalImaging(source)
    const runtime = createOpticsWorkspaceRuntime(source)
    runtime.setRate(4)
    const capture = runtime.captureRaw()
    expect(nativeObject(capture)).toEqual(copyJsonObject(expected))
    expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 4 })
    expect(capture.cursor.kind).toBe('static')
    if (expected.outcome.kind !== 'image') throw new Error('Real lens template must form an image')
    expect(expected.model.objectDistance).toBeCloseTo(0.3, 12)
    expect(expected.outcome.image.distance).toBeCloseTo(0.15, 12)
    expect(expected.outcome.image.height).toBeCloseTo(0.03, 12)
    const imageDistance = derivedQuantity(capture, 'image_distance')
    expect(imageDistance.value).toBeCloseTo(15, 12)
    expect(imageDistance.unit).toBe('cm')
    expect(imageDistance.dimension).toBe('length')
    const states = datasetOf(datasetsOf(capture), 'states')
    expect(metricOf(states, 'image_position_x', expected.model.benchId).unit).toBe('cm')
    expect(states.axes[0]?.kind).toBe('static')
    expectAllStateValues(capture, states)

    const original = canonicalStringify(publicCapturedResult(capture))
    runtime.previewParameter('object-distance', 20)
    expect(canonicalStringify(publicCapturedResult(runtime.captureRaw()))).toBe(original)
    runtime.cancelParameterPreview()
    for (const distance of [5, 10, 15, 20, 30]) {
      runtime.editParameter('object-distance', distance)
      const configuration = runtime.captureRaw()
      expect(nativeObject(configuration)).toEqual(copyJsonObject(resolveOpticalImaging(runtime.getScene())))
      expect(configuration.cursor.kind).toBe('static')
      expect(configuration.analysis).toBeUndefined()
      expect(datasetOf(datasetsOf(configuration), 'states').axes[0]?.kind).toBe('static')
      if (distance === 10) {
        expect(nativeObject(configuration)['outcome']).toEqual({ kind: 'no_image' })
        expect(resultOf(configuration).verification.status).toBe('passed')
        expect(resultOf(configuration).derivedQuantities.some(entry => entry.key === 'image_distance')).toBe(false)
        expect(resultOf(configuration).states[0]?.objects.find(object => object.id === expected.model.benchId))
          .toBeUndefined()
      }
    }
  })

  it('keeps a physical static-axis identity across independent scenes rather than using scene revision as an axis', () => {
    const staticBenches = [
      [
        createOpticsWorkspaceRuntime(createConvexLensScene({ sceneId: 'static-optics-a', objectDistance: 30 })),
        createOpticsWorkspaceRuntime(createConvexLensScene({ sceneId: 'static-optics-b', objectDistance: 20 })),
      ],
      [
        createLeverWorkspaceRuntime(createLeverBalanceScene({ sceneId: 'static-lever-a' })),
        createLeverWorkspaceRuntime(createLeverBalanceScene({ sceneId: 'static-lever-b' })),
      ],
    ]
    for (const [left, right] of staticBenches) {
      if (left === undefined || right === undefined) throw new Error('Missing real static runtime')
      const first = left.captureRaw()
      const second = right.captureRaw()
      expect(first.scene.id).not.toBe(second.scene.id)
      expect(first.cursor).toEqual(second.cursor)
      const firstAxis = datasetOf(datasetsOf(first), 'states').axes[0]!
      const secondAxis = datasetOf(datasetsOf(second), 'states').axes[0]!
      expect(axisCompatibility(firstAxis, secondAxis).compatible).toBe(true)
    }
  })

  it('captures a balanced beam as static, retaining all 25 real zero-time samples', () => {
    const runtime = createLeverWorkspaceRuntime(createLeverBalanceScene())
    runtime.setRunning(true)
    const capture = runtime.captureRaw()
    expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(capture.cursor.kind).toBe('static')
    const current = nativeObject(capture)
    expect(current['phase']).toBe('balanced')
    expect(nativeNumber(current, 'tilt')).toBe(0)
    expect(nativeNumber(current, 'angularVelocity')).toBe(0)
    expect(derivedQuantity(capture, 'left_moment').value).toBeCloseTo(0.294, 12)
    expect(derivedQuantity(capture, 'right_moment').value).toBeCloseTo(0.294, 12)
    const states = datasetOf(datasetsOf(capture), 'states')
    expect(states.rows).toHaveLength(25)
    expect(states.axes[0]?.kind).toBe('static')
    expect(states.rows.every(row => row.axes['static'] === 0)).toBe(true)
    expectAllStateValues(capture, states)
  })

  it('captures the actual dynamic lever state without reintegrating or resolving its run horizon', () => {
    const source = createLeverBalanceScene({ leftMass: 400 })
    const model = leverPhysics.resolveMomentBalance(source)
    const expected = leverPhysics.leverStateAt(model, 0.123456789)
    const runtime = createLeverWorkspaceRuntime(source)
    runtime.seek(0.123456789)
    const before = runtime.captureRaw()
    vi.spyOn(leverPhysics, 'leverStateAt').mockImplementation(() => {
      throw new Error('Capture must not reintegrate the lever')
    })
    vi.spyOn(leverPhysics, 'leverRunDuration').mockImplementation(() => {
      throw new Error('Capture must not resolve the lever horizon')
    })
    vi.spyOn(runtime, 'getSnapshot').mockImplementation(() => {
      throw new Error('Capture must not derive another frame')
    })
    const capture = runtime.captureRaw()
    expect(capture.rawState).toBe(before.rawState)
    expect(nativeObject(capture)).toEqual(copyJsonObject(expected))
    expect(capture.clock.time).toBe(0.123456789)
    expect(capture.clock.total).toBeGreaterThan(0)
    expect(capture.cursor.kind).toBe('time')
    expect(nativeNumber(nativeObject(capture), 'momentOfInertia')).toBeCloseTo(0.012, 12)
    expect(nativeNumber(nativeObject(capture), 'tilt')).toBeGreaterThan(0)
    expect(nativeObject(capture)['modelKind']).toBe('class_one_rotational_dynamics')
    expect(capture.engineInfo.model).toBe('class_one_moment_balance')
    const states = datasetOf(datasetsOf(capture), 'states')
    expect(metricOf(states, 'tilt', model.leverId).unit).toBe('rad')
    expect(metricOf(states, 'angular_velocity', model.leverId).unit).toBe('rad/s')
    expect(metricOf(states, 'net_torque', model.leverId).unit).toBe('N*m')
    expectAllStateValues(capture, states)
  })
})

describe('bench raw capture · source identity, release metadata and failed evidence', () => {
  for (const fixture of BENCHES) {
    it(`${fixture.templateId} keeps a source scene unchanged and rejected edits do not orphan its raw result`, () => {
      const template = pickerScene(fixture.templateId)
      const source: PhysicsScene = {
        ...template,
        metadata: {
          ...template.metadata,
          sourceQuestionId: asQuestionId(`question-${fixture.templateId}`),
          experimentRelease: {
            id: `legacy-release-${fixture.templateId}`,
            experimentId: fixture.templateId,
            version: '2.3.4',
            sha256: '1'.repeat(64),
          },
        },
      }
      const sourceBefore = canonicalStringify(copyJsonObject(source))
      const runtime = fixture.create(source)
      const original = publicCapturedResult(runtime.captureRaw())
      runtime.editParameter(fixture.edit.id, -1)
      const rejected = runtime.captureRaw()
      expect(rejected.scene.id).toBe(source.id)
      expect(rejected.scene.revision).toBe(source.revision)
      expect(rejected.result?.sceneId).toBe(rejected.scene.id)
      expect(rejected.request?.sceneId).toBe(rejected.scene.id)
      expect(rejected.diagnostics?.some(entry => entry['stage'] === 'command')).toBe(true)
      expect(() => publicCapturedResult(rejected)).not.toThrow()

      runtime.editParameter(fixture.edit.id, fixture.edit.value)
      const edited = runtime.captureRaw()
      expect(edited.scene.id).not.toBe(source.id)
      expect(edited.scene.metadata.lineage?.originSceneId).toBe(source.id)
      expect(edited.scene.metadata.lineage?.originQuestionId).toBe(source.metadata.sourceQuestionId)
      expect(edited.request?.sceneRevision).toBe(edited.scene.revision)
      expect(edited.result?.sceneRevision).toBe(edited.scene.revision)
      expect(edited.engineInfo.release).toEqual(source.metadata.experimentRelease)
      expect(snapshotOf(edited).engine.release).toEqual(source.metadata.experimentRelease)
      expect(canonicalStringify(copyJsonObject(source))).toBe(sourceBefore)
      expect(canonicalStringify(original)).toBe(canonicalStringify(publicCapturedResult(original)))

      runtime.restoreOrigin?.()
      const restored = runtime.captureRaw()
      expect(restored.scene).toEqual(source)
      expect(restored.result?.sceneId).toBe(source.id)
      expect(restored.rawState).toEqual(original.rawState)
      expect(restored.engineInfo.release).toEqual(source.metadata.experimentRelease)
      expect(canonicalStringify(copyJsonObject(source))).toBe(sourceBefore)
    })

    it(`${fixture.templateId} retains a real verification-failed result even when its display computation is unavailable`, () => {
      const realSimulate = fixture.enginePrototype.simulate
      let failed: SimulationResult | undefined
      vi.spyOn(fixture.enginePrototype, 'simulate').mockImplementation(function (
        this: PhysicsEngine<PhysicsScene>, scene, request,
      ) {
        const actual = realSimulate.call(this, scene, request)
        failed = failedResult(actual)
        return failed
      })
      const source = pickerScene(fixture.templateId)
      const runtime = fixture.create(source)
      expect(runtime.getSnapshot().status).toBe('failed')
      const capture = runtime.captureRaw()
      expect(capture.result).toBe(failed)
      expect(resultOf(capture).states).toHaveLength(fixture.samples)
      expect(capture.rawState).toBeUndefined()
      const last = resultOf(capture).states[resultOf(capture).states.length - 1]!
      expect(capture.clock.total).toBe(fixture.axis === 'static' ? 0 : canonicalValue(last.time))
      expect(capture.clock.running).toBe(false)
      expect(capture.cursor.kind).toBe(fixture.axis)
      expect(runtime.getSnapshot().clock).toEqual(capture.clock)
      expect(capture.diagnostics?.some(entry => entry['stage'] === 'verification' && entry['status'] === 'failed')).toBe(true)
      expect(snapshotOf(capture).result?.verification.status).toBe('failed')
      expectAllStateValues(capture, datasetOf(datasetsOf(capture), 'states'))
    })

    it(`${fixture.templateId} reports a thrown engine request honestly and cannot publish an empty solved snapshot`, () => {
      vi.spyOn(fixture.enginePrototype, 'simulate').mockImplementation(() => {
        throw new PhysicsOSError('CAPTURE_TEST_SOURCE_FAILURE', 'The engine failed before producing a result.', {
          retryable: true,
          details: { requestStage: 'simulate', retryAfterSeconds: 2 },
        })
      })
      const runtime = fixture.create(pickerScene(fixture.templateId))
      const capture = runtime.captureRaw()
      expect(capture.request).toBeDefined()
      expect(capture.result).toBeUndefined()
      expect(capture.state).toBeUndefined()
      expect(capture.rawState).toBeUndefined()
      expect(capture.clock.total).toBe(0)
      expect(capture.clock.running).toBe(false)
      expect(capture.diagnostics).toContainEqual({
        stage: 'runtime',
        code: 'CAPTURE_TEST_SOURCE_FAILURE',
        message: 'The engine failed before producing a result.',
        retryable: true,
        details: { requestStage: 'simulate', retryAfterSeconds: 2 },
      })
      expect(datasetsOf(capture)).toEqual([])
      expect(() => snapshotOf(capture)).toThrow('has not retained a result or captured state')
    })
  }

  for (const fixture of BENCHES.filter(bench => bench.axis === 'time')) {
    it(`${fixture.templateId} keeps the bounded current cursor and real result window after verification failure`, () => {
      const realSimulate = fixture.enginePrototype.simulate
      const runtime = fixture.create(pickerScene(fixture.templateId))
      const initial = runtime.captureRaw()
      const time = initial.clock.total * 0.37
      runtime.seek(time)
      runtime.setRunning(true)
      const simulate = vi.spyOn(fixture.enginePrototype, 'simulate').mockImplementation(function (
        this: PhysicsEngine<PhysicsScene>, scene, request,
      ) {
        return failedResult(realSimulate.call(this, scene, request))
      })
      runtime.setObservable(fixture.templateId === 'echo-ranging' ? 'path'
        : fixture.templateId === 'buoyancy' ? 'forces' : 'thermometer', false)
      const failureFrame = runtime.getSnapshot()
      const callCount = simulate.mock.calls.length
      simulate.mockImplementation(() => { throw new Error('Capture must not retry the failed simulation') })
      vi.spyOn(runtime, 'getSnapshot').mockImplementation(() => {
        throw new Error('Capture must not derive the failure frame')
      })
      const capture = runtime.captureRaw()
      expect(capture.clock.time).toBe(time)
      expect(capture.clock.total).toBe(initial.clock.total)
      expect(capture.clock.running).toBe(false)
      expect(capture.clock).toEqual(failureFrame.clock)
      expect(capture.cursor).toEqual({ kind: 'time', time: quantity(time, 's', 'time') })
      expect(capture.rawState).toBeUndefined()
      expect(resultOf(capture).verification.status).toBe('failed')
      expect(simulate).toHaveBeenCalledTimes(callCount)
      const states = datasetOf(datasetsOf(capture), 'states')
      expect(states.axes[0]?.kind).toBe('time')
      expectAllStateValues(capture, states)
    })
  }

  it('keeps passed native current states aligned with their explicit request windows on seek, advance and replay', () => {
    const dynamics: readonly { readonly create: BenchFixture['create']; readonly prototype: PhysicsEngine<PhysicsScene>; readonly scene: PhysicsScene }[] = [
      { create: createAcousticsWorkspaceRuntime, prototype: AcousticsEngine.prototype, scene: createEchoRangingScene() },
      { create: createFluidWorkspaceRuntime, prototype: FluidEngine.prototype, scene: createArchimedesScene() },
      { create: createThermalWorkspaceRuntime, prototype: ThermalEngine.prototype, scene: createCrystalMeltingScene() },
      { create: createLeverWorkspaceRuntime, prototype: leverPhysics.LeverEngine.prototype, scene: createLeverBalanceScene({ leftMass: 400 }) },
    ]
    for (const fixture of dynamics) {
      const realSimulate = fixture.prototype.simulate
      const simulate = vi.spyOn(fixture.prototype, 'simulate').mockImplementation(function (
        this: PhysicsEngine<PhysicsScene>, scene, request,
      ) {
        request.options.startTime = quantity(0.4, 's', 'time')
        request.options.endTime = quantity(1.6, 's', 'time')
        return realSimulate.call(this, scene, request)
      })
      const runtime = fixture.create(fixture.scene)
      const initial = runtime.captureRaw()
      expect(resultOf(initial).verification.status).toBe('passed')
      expect(initial.clock.time).toBe(0.4)
      expect(initial.clock.total).toBe(1.6)
      const expectedAtStart = initial.rawState
      runtime.seek(0)
      const start = runtime.captureRaw()
      expect(start.cursor).toEqual({ kind: 'time', time: quantity(0.4, 's', 'time') })
      expect(start.rawState).toEqual(expectedAtStart)
      runtime.seek(99)
      expect(runtime.captureRaw().clock.time).toBe(1.6)
      runtime.setRunning(true)
      const replay = runtime.captureRaw()
      expect(replay.clock.time).toBe(0.4)
      expect(replay.rawState).toEqual(expectedAtStart)
      runtime.advance(-99)
      const rewind = runtime.captureRaw()
      expect(rewind.clock.time).toBe(0.4)
      expect(rewind.rawState).toEqual(expectedAtStart)
      const states = datasetOf(datasetsOf(rewind), 'states')
      expect(states.rows[0]?.axes['time']).toBe(0.4)
      expect(states.rows[states.rows.length - 1]?.axes['time']).toBe(1.6)
      expectAllStateValues(rewind, states)
      simulate.mockRestore()
    }
  })

  it('keeps an explicit failed request range in absolute seconds without restarting its cursor at zero', () => {
    const realSimulate = AcousticsEngine.prototype.simulate
    vi.spyOn(AcousticsEngine.prototype, 'simulate').mockImplementation(function (this: PhysicsEngine<PhysicsScene>, scene, request) {
      request.options.startTime = quantity(0.4, 's', 'time')
      request.options.endTime = quantity(1.6, 's', 'time')
      return failedResult(realSimulate.call(this, scene, request))
    })
    const runtime = createAcousticsWorkspaceRuntime(createEchoRangingScene())
    const capture = runtime.captureRaw()
    expect(capture.request?.options.startTime).toEqual(quantity(0.4, 's', 'time'))
    expect(capture.request?.options.endTime).toEqual(quantity(1.6, 's', 'time'))
    expect(capture.clock).toEqual({ time: 0.4, total: 1.6, running: false, rate: 1 })
    expect(capture.cursor).toEqual({ kind: 'time', time: quantity(0.4, 's', 'time') })
    expect(capture.rawState).toBeUndefined()
    expect(runtime.getSnapshot().clock).toEqual(capture.clock)
    const states = datasetOf(datasetsOf(capture), 'states')
    expect(states.axes[0]?.kind).toBe('time')
    expect(states.rows[0]?.axes['time']).toBe(0.4)
    expect(states.rows[states.rows.length - 1]?.axes['time']).toBe(1.6)
    expectAllStateValues(capture, states)
  })

  it('retains the requested time window when an engine throws before returning any state', () => {
    vi.spyOn(AcousticsEngine.prototype, 'simulate').mockImplementation((_scene, request) => {
      request.options.startTime = quantity(0.4, 's', 'time')
      request.options.endTime = quantity(1.6, 's', 'time')
      throw new PhysicsOSError('SOURCE_REQUEST_FAILED', 'No state was produced for the requested window.')
    })
    const runtime = createAcousticsWorkspaceRuntime(createEchoRangingScene())
    const capture = runtime.captureRaw()
    expect(capture.result).toBeUndefined()
    expect(capture.rawState).toBeUndefined()
    expect(capture.cursor.kind).toBe('time')
    expect(capture.clock).toEqual({ time: 0.4, total: 1.6, running: false, rate: 1 })
    expect(datasetsOf(capture)).toEqual([])
    expect(() => snapshotOf(capture)).toThrow('has not retained a result or captured state')
  })

  it('uses lever model semantics for failed zero-length dynamics and nonzero-time static samples', () => {
    const realSimulate = leverPhysics.LeverEngine.prototype.simulate
    vi.spyOn(leverPhysics.LeverEngine.prototype, 'simulate').mockImplementation(function (this: PhysicsEngine<PhysicsScene>, scene, request): ReturnType<typeof realSimulate> {
      const model = leverPhysics.resolveMomentBalance(scene)
      if (model.left.mass > 0.3) request.options.endTime = quantity(0, 's', 'time')
      else {
        request.options.startTime = quantity(4, 's', 'time')
        request.options.endTime = quantity(4, 's', 'time')
      }
      return failedResult(realSimulate.call(this, scene, request)) as ReturnType<typeof realSimulate>
    })
    const dynamic = createLeverWorkspaceRuntime(createLeverBalanceScene({ leftMass: 400 })).captureRaw()
    expect(dynamic.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(dynamic.cursor.kind).toBe('time')
    expect(resultOf(dynamic).states.every(state => canonicalValue(state.time) === 0)).toBe(true)
    expect(datasetOf(datasetsOf(dynamic), 'states').axes[0]?.kind).toBe('time')
    const balanced = createLeverWorkspaceRuntime(createLeverBalanceScene()).captureRaw()
    expect(resultOf(balanced).states.every(state => canonicalValue(state.time) === 4)).toBe(true)
    expect(balanced.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(balanced.cursor).toEqual({ kind: 'static', identity: 'lever-equilibrium' })
    expect(datasetOf(datasetsOf(balanced), 'states').axes[0]?.kind).toBe('static')
  })

  it('keeps finite error details and explicitly marks numeric overflow without crashing failure capture', () => {
    for (const fixture of BENCHES) {
      const simulate = vi.spyOn(fixture.enginePrototype, 'simulate').mockImplementation(() => {
        throw new PhysicsOSError('SOURCE_NUMERIC_OVERFLOW', 'The source engine overflowed before returning a state.', {
          details: {
            momentOfInertia: Number.POSITIVE_INFINITY,
            finiteInput: 0.012,
            nested: { negative: Number.NEGATIVE_INFINITY, undefinedResult: Number.NaN },
          },
        })
      })
      const runtime = fixture.create(pickerScene(fixture.templateId))
      const capture = runtime.captureRaw()
      expect(capture.result).toBeUndefined()
      expect(capture.rawState).toBeUndefined()
      expect(capture.diagnostics).toContainEqual({
        stage: 'runtime',
        code: 'SOURCE_NUMERIC_OVERFLOW',
        message: 'The source engine overflowed before returning a state.',
        retryable: false,
        details: {
          momentOfInertia: { missing: 'non-finite-diagnostic', value: 'Infinity' },
          finiteInput: 0.012,
          nested: {
            negative: { missing: 'non-finite-diagnostic', value: '-Infinity' },
            undefinedResult: { missing: 'non-finite-diagnostic', value: 'NaN' },
          },
        },
      })
      expect(() => publicCapturedResult(capture)).not.toThrow()
      expect(() => snapshotOf(capture)).toThrow('has not retained a result or captured state')
      simulate.mockRestore()
    }
  })

  it('does not evaluate executable error details and records why those details cannot be captured', () => {
    const executable = vi.fn(() => 'not physics data')
    vi.spyOn(AcousticsEngine.prototype, 'simulate').mockImplementation(() => {
      throw new PhysicsOSError('UNSAFE_SOURCE_DETAILS', 'The source returned non-data diagnostic details.', {
        retryable: true,
        details: { callback: executable },
      })
    })
    const capture = createAcousticsWorkspaceRuntime(createEchoRangingScene()).captureRaw()
    expect(executable).not.toHaveBeenCalled()
    expect(capture.diagnostics).toContainEqual({
      stage: 'runtime',
      code: 'UNSAFE_SOURCE_DETAILS',
      retryable: true,
      message: 'The source returned non-data diagnostic details.',
      details: { missing: 'non-json-diagnostic-details' },
    })
    expect(() => publicCapturedResult(capture)).not.toThrow()
  })

  it('retains unsupported-model diagnostics without manufacturing a request, state, or zero-valued result', () => {
    const simulate = vi.spyOn(AcousticsEngine.prototype, 'simulate')
    const runtime = createAcousticsWorkspaceRuntime(createConvexLensScene())
    const capture = runtime.captureRaw()
    expect(simulate).not.toHaveBeenCalled()
    expect(capture.request).toBeUndefined()
    expect(capture.result).toBeUndefined()
    expect(capture.rawState).toBeUndefined()
    expect(capture.diagnostics?.some(entry => entry['stage'] === 'support' && entry['supported'] === false)).toBe(true)
    expect(() => snapshotOf(capture)).toThrow('has not retained a result or captured state')
  })
})
