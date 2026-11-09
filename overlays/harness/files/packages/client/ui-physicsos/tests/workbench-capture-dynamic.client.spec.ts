import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompositeEngine } from '@physicsos/engine-composite'
import { ElectricEngine } from '@physicsos/engine-electric'
import { ElectricRegionEngine } from '@physicsos/engine-electric-region'
import { InductionEngine } from '@physicsos/engine-induction'
import { EnergyEngine } from '@physicsos/engine-mechanics'
import { WaveEngine, waveProfileId } from '@physicsos/engine-wave'
import { derivedScalar, isScalarQuantity, type PhysicsEngine, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import {
  createBarMotionScene,
  createCompositeFieldScene,
  createCyclotronScene,
  createDiffractionScene,
  createDoubleBarRailScene,
  createElectricScene,
  createFluxChangeScene,
  createLongitudinalWaveScene,
  createMassSpectrometerScene,
  createMechanicalEnergyScene,
  createParallelPlateScene,
  createPointChargeScene,
  createRampFrictionScene,
  createReflectionRefractionScene,
  createStandingWaveScene,
  createTravellingWaveScene,
  createVelocitySelectorScene,
  createDopplerScene,
  createWaveInterferenceScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue } from '@physicsos/physics-units'
import { asQuestionId } from '@physicsos/shared'
import { createSceneObject } from '@physicsos/physics-workbench/codec'
import { captureDatasets, conditionsFromScene } from '@physicsos/physics-workbench/data'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import type { AnalysisDataset, CapturedResult, DatasetObject, MetricDescriptor, ObjectRef } from '@physicsos/physics-workbench/types'

import { createCompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'
import { createElectricWorkspaceRuntime } from '../src/client/physics/electric-workspace-runtime.ts'
import { createEnergyWorkspaceRuntime } from '../src/client/physics/energy-workspace-runtime.ts'
import { createInductionWorkspaceRuntime } from '../src/client/physics/induction-workspace-runtime.ts'
import { createWaveWorkspaceRuntime } from '../src/client/physics/wave-workspace-runtime.ts'
import type { WorkspaceRuntime } from '../src/client/physics/workspace-runtime.ts'

afterEach(() => { vi.restoreAllMocks() })

type CapturingRuntime = WorkspaceRuntime & { captureRaw(): CapturedResult }

const capture = (runtime: WorkspaceRuntime): CapturedResult => {
  if (runtime.captureRaw === undefined) throw new Error('Runtime does not expose raw capture.')
  return runtime.captureRaw()
}
const resultOf = (raw: CapturedResult): SimulationResult => {
  if (raw.result === undefined) throw new Error('Capture did not retain a simulation result.')
  return raw.result
}
const stateOf = (raw: CapturedResult): SimulationState => {
  if (raw.state === undefined) throw new Error('Capture did not retain its displayed state.')
  return raw.state
}
const sceneRefOf = (scene: PhysicsScene): ObjectRef<'scene'> => ({
  kind: 'scene',
  digest: createHash('sha256').update(canonicalStringify(createSceneObject(scene))).digest('hex'),
})
const datasetsOf = (raw: CapturedResult): readonly DatasetObject[] =>
  captureDatasets(raw, { sourceScene: sceneRefOf(raw.scene) })
const datasetOf = (raw: CapturedResult, collection: DatasetObject['origin']['collection']): DatasetObject => {
  const dataset = datasetsOf(raw).find(entry => entry.origin.collection === collection)
  if (dataset === undefined) throw new Error(`Missing ${collection} dataset.`)
  return dataset
}
const metricOf = (dataset: DatasetObject, semanticKey: string, component: MetricDescriptor['component'] = 'scalar', targetId?: string): MetricDescriptor => {
  const metric = dataset.metrics.find(entry => entry.semanticKey === semanticKey && entry.component === component && (targetId === undefined || entry.targetId === targetId))
  if (metric === undefined) throw new Error(`Missing raw metric ${semanticKey}/${component}.`)
  return metric
}
const analysisOf = (raw: CapturedResult, collection: 'analysis' | 'captured-state'): AnalysisDataset => {
  const dataset = raw.analysis?.find(entry => entry.origin.collection === collection)
  if (dataset === undefined) throw new Error(`Missing wave ${collection} profile.`)
  return dataset
}

const assertJsonData = (value: unknown): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    expect(Number.isFinite(value), 'Capture contains a non-finite number.').toBe(true)
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertJsonData)
    return
  }
  expect(typeof value, 'Capture contains an executable or absent value.').toBe('object')
  if (typeof value !== 'object' || value === null) throw new Error('Capture is not JSON data.')
  expect([Object.prototype, null]).toContain(Object.getPrototypeOf(value))
  Object.values(value).forEach(assertJsonData)
}
const assertCaptureIdentity = (raw: CapturedResult): void => {
  expect(raw.request?.sceneId).toBe(raw.scene.id)
  expect(raw.request?.sceneRevision).toBe(raw.scene.revision)
  expect(raw.result?.sceneId).toBe(raw.scene.id)
  expect(raw.result?.sceneRevision).toBe(raw.scene.revision)
  expect(raw.result?.simulationId).toBe(raw.request?.simulationId)
  expect(raw.engineInfo.id).toBe(raw.result?.metadata.engineId)
  expect(raw.engineInfo.version).toBe(raw.result?.metadata.engineVersion)
}

const engineFixtures = [
  ['uniform electric', ElectricEngine, () => createElectricWorkspaceRuntime(createElectricScene())],
  ['bounded electric', ElectricRegionEngine, () => createElectricWorkspaceRuntime(createParallelPlateScene())],
  ['point-charge electric', ElectricEngine, () => createElectricWorkspaceRuntime(createPointChargeScene({ charges: [{ id: 'source', charge: 5e-6 }], samplePoint: { x: 0.2, y: 0, z: 0 } }))],
  ['velocity selector', CompositeEngine, () => createCompositeWorkspaceRuntime(createVelocitySelectorScene())],
  ['mass spectrometer', CompositeEngine, () => createCompositeWorkspaceRuntime(createMassSpectrometerScene())],
  ['global composite field', CompositeEngine, () => createCompositeWorkspaceRuntime(createCompositeFieldScene())],
  ['cyclotron', CompositeEngine, () => createCompositeWorkspaceRuntime(createCyclotronScene())],
  ['bar induction', InductionEngine, () => createInductionWorkspaceRuntime(createBarMotionScene())],
  ['flux induction', InductionEngine, () => createInductionWorkspaceRuntime(createFluxChangeScene())],
  ['double-bar induction', InductionEngine, () => createInductionWorkspaceRuntime(createDoubleBarRailScene())],
  ['travelling wave', WaveEngine, () => createWaveWorkspaceRuntime(createTravellingWaveScene())],
  ['standing wave', WaveEngine, () => createWaveWorkspaceRuntime(createStandingWaveScene())],
  ['longitudinal wave', WaveEngine, () => createWaveWorkspaceRuntime(createLongitudinalWaveScene())],
  ['interference wave', WaveEngine, () => createWaveWorkspaceRuntime(createWaveInterferenceScene())],
  ['reflection/refraction wave', WaveEngine, () => createWaveWorkspaceRuntime(createReflectionRefractionScene())],
  ['diffraction wave', WaveEngine, () => createWaveWorkspaceRuntime(createDiffractionScene())],
  ['Doppler wave', WaveEngine, () => createWaveWorkspaceRuntime(createDopplerScene())],
  ['smooth energy ledger', EnergyEngine, () => createEnergyWorkspaceRuntime(createMechanicalEnergyScene())],
  ['rough energy ledger', EnergyEngine, () => createEnergyWorkspaceRuntime(createRampFrictionScene())],
] as const

describe('dynamic workbench raw capture', () => {
  it.each(engineFixtures)('%s retains actual request, result, state and all samples without calling an engine on capture', (_name, Engine, create) => {
    const simulate = vi.spyOn(Engine.prototype, 'simulate')
    const runtime = create()
    const frame = runtime.getSnapshot()
    expect(frame.status).not.toBe('failed')
    if (frame.clock.total > 0) runtime.seek(frame.clock.total * 0.371)
    const actualRequest = simulate.mock.calls.at(-1)?.[1]
    const actualResult = simulate.mock.results.at(-1)?.value as SimulationResult | undefined
    const simulationCalls = simulate.mock.calls.length
    const canHandle = vi.spyOn(Engine.prototype, 'canHandle')
    const stateAt = vi.spyOn(Engine.prototype, 'stateAt')
    const stateAtSeconds = Engine === ElectricEngine
      ? vi.spyOn(ElectricEngine.prototype, 'stateAtSeconds')
      : Engine === ElectricRegionEngine
        ? vi.spyOn(ElectricRegionEngine.prototype, 'stateAtSeconds')
        : Engine === CompositeEngine
          ? vi.spyOn(CompositeEngine.prototype, 'stateAtSeconds')
          : undefined
    const raw = capture(runtime)
    const again = capture(runtime)

    expect(simulate).toHaveBeenCalledTimes(simulationCalls)
    expect(canHandle).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
    if (stateAtSeconds !== undefined) expect(stateAtSeconds).not.toHaveBeenCalled()
    expect(raw.request).toEqual(actualRequest)
    expect(canonicalStringify(raw.result)).toBe(canonicalStringify(actualResult))
    expect(again).toEqual(raw)
    expect(again).not.toBe(raw)
    assertCaptureIdentity(raw)
    if (raw.cursor.kind === 'time') {
      expect(canonicalValue(raw.cursor.time)).toBe(raw.clock.time)
      expect(canonicalValue(stateOf(raw).time)).toBe(raw.clock.time)
    } else {
      expect(raw.cursor.kind).toBe('static')
      expect(raw.clock.total).toBe(0)
      expect(raw.clock.running).toBe(false)
    }
    const states = datasetOf(raw, 'states')
    expect(states.rows).toHaveLength(resultOf(raw).states.length)
    expect(states.sourceScene).toEqual(sceneRefOf(raw.scene))
    assertJsonData(raw)
    assertJsonData(datasetsOf(raw))
    expect(JSON.parse(JSON.stringify(raw))).toEqual(raw)
    expect(Object.isFrozen(raw)).toBe(true)
  })

  it.each([
    ['induction', InductionEngine, () => createInductionWorkspaceRuntime(createDoubleBarRailScene())],
    ['wave', WaveEngine, () => createWaveWorkspaceRuntime(createTravellingWaveScene())],
  ] as const)('%s can capture its initialized held state before getSnapshot is ever requested', (_name, Engine, create) => {
    const runtime = create()
    const simulate = vi.spyOn(Engine.prototype, 'simulate')
    const stateAt = vi.spyOn(Engine.prototype, 'stateAt')
    const raw = runtime.captureRaw()
    expect(canonicalValue(stateOf(raw).time)).toBe(0)
    expect(resultOf(raw).states).toHaveLength(61)
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
    assertCaptureIdentity(raw)
  })

  it('captures uniform electric acceleration at an unsampled instant, in SI, without UI rounding', () => {
    const scene = createElectricScene({
      charge: 2,
      mass: 4,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 1, y: 0, z: 0 },
      electricFieldStrength: 6,
      electricFieldDirection: 'up',
      duration: 2,
    })
    const runtime = createElectricWorkspaceRuntime(scene)
    runtime.seek(0.731)
    const raw = runtime.captureRaw()
    const object = stateOf(raw).objects[0]!
    expect(object.position).toMatchObject({ unit: 'm', dimension: 'length' })
    expect(object.position?.vector.x).toBeCloseTo(0.731, 14)
    expect(object.position?.vector.y).toBeCloseTo(1.5 * 0.731 ** 2, 14)
    expect(object.velocity?.vector.y).toBeCloseTo(3 * 0.731, 14)
    const samples = resultOf(raw).states
    expect(samples).toHaveLength(121)
    expect(samples.at(-1)?.objects[0]?.position?.vector).toEqual({ x: 2, y: 6, z: 0 })
    expect(samples.some(state => Math.abs(canonicalValue(state.time) - 0.731) < 1e-12)).toBe(false)
    expect(runtime.getSnapshot().table.rows.length).toBeLessThan(samples.length)
    const dataset = datasetOf(raw, 'states')
    const y = metricOf(dataset, 'position', 'y', scene.particles[0]?.id)
    expect(y).toMatchObject({ unit: 'm', dimension: 'length', scale: { kind: 'linear' } })
    expect(dataset.rows.at(-1)?.values[y.id]).toBe(6)
    const speed = runtime.getSnapshot().inspector.flatMap(section => section.derived ?? []).find(entry => entry.id === 'speed')
    expect(Number(speed?.value)).toBeCloseTo(derivedScalar(stateOf(raw).derived, 'speed').value, 3)
  })

  it('keeps bounded-field crossing events as the actual raw engine evidence', () => {
    const runtime = createElectricWorkspaceRuntime(createParallelPlateScene())
    const raw = runtime.captureRaw()
    expect(resultOf(raw).events.map(event => event.type)).toEqual(expect.arrayContaining(['EnterField', 'ExitField']))
    expect(resultOf(raw).states[0]?.objects[0]?.acceleration?.vector).toEqual({ x: 0, y: 0, z: 0 })
    expect(raw.engineInfo).toMatchObject({ id: 'engine-electric-region', model: 'charged_particle_bounded_uniform_electric_field' })
    expect(datasetOf(raw, 'states').rows.length).toBeGreaterThan(runtime.getSnapshot().table.rows.length)
    const directions = runtime.getSnapshot().inspector.flatMap(section => section.choices ?? []).find(choice => choice.id === 'direction')
    expect(directions?.options.map(option => option.value)).toEqual(['up', 'down'])
  })

  it('captures a point-charge field as static, not as a fabricated one-point time series', () => {
    const runtime = createElectricWorkspaceRuntime(createPointChargeScene({
      charges: [{ id: 'source', charge: 5e-6 }],
      samplePoint: { x: 0.2, y: 0, z: 0 },
    }))
    const raw = runtime.captureRaw()
    expect(raw.cursor.kind).toBe('static')
    expect(raw.clock).toMatchObject({ time: 0, total: 0, running: false })
    const field = derivedScalar(stateOf(raw).derived, 'electric_field_magnitude')
    expect(field).toMatchObject({ unit: 'V/m', dimension: 'electric_field' })
    expect(field.value).toBeGreaterThan(1e6)
    expect(datasetOf(raw, 'states').axes.map(axis => axis.kind)).toEqual(['static'])
  })

  it('keeps cyclotron qV energy increments, crossing times and the true current state', () => {
    const charge = 1.6e-19
    const mass = 1.67e-27
    const voltage = 2000
    const field = 1.5
    const period = 2 * Math.PI * mass / (charge * field)
    const runtime = createCompositeWorkspaceRuntime(createCyclotronScene({ charge, mass, gapVoltage: voltage, magneticFluxDensity: field }))
    runtime.seek(0)
    const initial = runtime.captureRaw()
    runtime.seek(period / 2)
    const after = runtime.captureRaw()
    const initialEnergy = derivedScalar(stateOf(initial).derived, 'kinetic_energy').value
    const afterEnergy = derivedScalar(stateOf(after).derived, 'kinetic_energy').value
    expect(afterEnergy - initialEnergy).toBeCloseTo(charge * voltage, 24)
    expect(after.engineInfo.model).toBe('cyclotron_time_varying_field')
    const crossings = resultOf(after).events.filter(event => event.type === 'AcceleratingGapCrossing')
    expect(crossings.length).toBeGreaterThan(0)
    expect(crossings.some(event => event.time !== undefined && Math.abs(event.time - period / 2) < 1e-15)).toBe(true)
    expect(resultOf(after).states.length).toBeGreaterThanOrEqual(241)
    expect(after.result).toEqual(initial.result)
  })

  it('captures exact double-bar momentum and heat at tau, not the end-of-run UI table', () => {
    const runtime = createInductionWorkspaceRuntime(createDoubleBarRailScene())
    runtime.seek(0.25)
    const raw = runtime.captureRaw()
    const state = stateOf(raw)
    expect(derivedScalar(state.derived, 'induced_emf').value).toBeCloseTo(0.2 / Math.E, 12)
    expect(derivedScalar(state.derived, 'bar1_velocity').value).toBeCloseTo(1 + 1 / Math.E, 12)
    expect(derivedScalar(state.derived, 'bar2_velocity').value).toBeCloseTo(1 - 1 / Math.E, 12)
    expect(derivedScalar(state.derived, 'kinetic_energy').value + derivedScalar(state.derived, 'joule_heat').value).toBeCloseTo(0.1, 12)
    expect(resultOf(raw).states.some(entry => Math.abs(canonicalValue(entry.time) - 0.25) < 1e-12)).toBe(false)
    expect(derivedScalar(resultOf(raw).derivedQuantities, 'induced_emf').value).not.toBe(derivedScalar(state.derived, 'induced_emf').value)
    const dataset = datasetOf(raw, 'states')
    expect(dataset.rows).toHaveLength(61)
    for (const sample of resultOf(raw).states) {
      expect(derivedScalar(sample.derived, 'momentum1').value + derivedScalar(sample.derived, 'momentum2').value).toBeCloseTo(0.1, 12)
      expect(derivedScalar(sample.derived, 'kinetic_energy').value + derivedScalar(sample.derived, 'joule_heat').value).toBeCloseTo(0.1, 12)
    }
    expect(metricOf(dataset, 'joule_heat')).toMatchObject({ unit: 'J', dimension: 'energy' })
    expect(metricOf(dataset, 'induced_emf')).toMatchObject({ unit: 'V', dimension: 'electric_potential' })
    expect(metricOf(dataset, 'induced_current')).toMatchObject({ unit: 'A', dimension: 'electric_current' })
    expect(runtime.getSnapshot().table.rows).toHaveLength(1)
    const direction = runtime.getSnapshot().inspector.flatMap(section => section.derived ?? []).find(entry => entry.id === 'lenz-text')
    expect(direction?.value).toContain('相对运动')
    expect(direction?.value).not.toContain('无感应电流')
  })

  it.each([
    ['bar', () => createBarMotionScene(), 0.2, 0.04],
    ['flux', () => createFluxChangeScene(), -0.05, -0.025],
  ] as const)('captures the signed %s induction readings with their original engine units', (_name, createScene, emf, current) => {
    const runtime = createInductionWorkspaceRuntime(createScene())
    runtime.seek(1.234)
    const raw = runtime.captureRaw()
    expect(derivedScalar(stateOf(raw).derived, 'induced_emf')).toMatchObject({ unit: 'V', dimension: 'electric_potential' })
    expect(derivedScalar(stateOf(raw).derived, 'induced_emf').value).toBeCloseTo(emf, 14)
    expect(derivedScalar(stateOf(raw).derived, 'induced_current')).toMatchObject({ unit: 'A', dimension: 'electric_current' })
    expect(derivedScalar(stateOf(raw).derived, 'induced_current').value).toBeCloseTo(current, 14)
    const fluxRate = derivedScalar(stateOf(raw).derived, 'flux_rate')
    expect(fluxRate).toMatchObject({ unit: 'Wb/s', dimension: 'magnetic_flux_rate' })
    expect(fluxRate.value).toBeCloseTo(_name === 'bar' ? emf : -emf, 14)
    expect(metricOf(datasetOf(raw, 'states'), 'flux_rate')).toMatchObject({ unit: 'Wb/s', dimension: 'magnetic_flux_rate' })
    expect(resultOf(raw).states).toHaveLength(61)
  })

  it('captures all wave time/space samples, without canvas centimetres or display gain', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const raw = runtime.captureRaw()
    const profile = analysisOf(raw, 'analysis')
    const frameProfile = analysisOf(raw, 'captured-state')
    const initialObjects = resultOf(raw).states[0]?.objects.filter(object => object.id.startsWith('wave-bench-1.profile.')) ?? []
    expect(initialObjects).toHaveLength(49)
    expect(profile.rows).toHaveLength(61 * 49)
    expect(frameProfile.rows).toHaveLength(49)
    expect(profile.axes.map(axis => [axis.id, axis.kind, axis.unit, axis.dimension])).toEqual([
      ['time', 'time', 's', 'time'],
      ['x', 'space', 'm', 'length'],
    ])
    expect(profile.metrics[0]).toMatchObject({ semanticKey: 'wave_transverse_displacement', unit: 'm', dimension: 'length' })
    expect(profile.conditions).toEqual(conditionsFromScene(raw.scene))
    expect(frameProfile.conditions).toEqual(profile.conditions)
    const point = frameProfile.rows.find(row => row.evidence?.objectId === waveProfileId('wave-bench-1', 12))!
    expect(point.axes.x).toBeCloseTo(0.3, 14)
    expect(point.values.displacement).toBeCloseTo(-0.05, 14)
    expect('sourceScene' in profile).toBe(false)
    const published = datasetsOf(raw).find(dataset => dataset.id === profile.id)!
    expect(published.sourceScene).toEqual(sceneRefOf(raw.scene))
    expect(published.rows).toEqual(profile.rows)
    runtime.seek(0.037)
    const next = runtime.captureRaw()
    expect(analysisOf(next, 'analysis')).toEqual(profile)
    expect(analysisOf(next, 'captured-state').rows).not.toEqual(frameProfile.rows)
  })

  it('retains the real phase-aligned wave request and keeps the current cursor distinct from the submitted history window', () => {
    const base = createTravellingWaveScene()
    const scene: PhysicsScene = { ...base, timeline: { ...base.timeline, endTime: { value: 0.02, unit: 's', dimension: 'time' } } }
    const runtime = createWaveWorkspaceRuntime(scene)
    runtime.seek(0.08)
    const raw = runtime.captureRaw()
    // main requests one complete 5 Hz period; recording retains that exact
    // effective request instead of claiming the source's 0.02 s was simulated.
    expect(raw.request?.options.endTime).toEqual({ value: 0.2, unit: 's', dimension: 'time' })
    expect(raw.clock).toMatchObject({ time: 0.08, total: 0.2, running: false })
    expect(canonicalValue(stateOf(raw).time)).toBe(0.08)
    expect(canonicalValue(resultOf(raw).states.at(-1)!.time)).toBe(canonicalValue(raw.request!.options.endTime!))
    expect(resultOf(raw).states).toHaveLength(61)
    expect(analysisOf(raw, 'captured-state').rows.every(row => row.axes.time === 0.08)).toBe(true)
  })

  it('captures the full standing-wave node geometry and SI spatial profile', () => {
    const runtime = createWaveWorkspaceRuntime(createStandingWaveScene())
    runtime.seek(0.009)
    const raw = runtime.captureRaw()
    const nodes = stateOf(raw).objects.filter(object => object.id.startsWith('wave-bench-1.node.'))
    expect(nodes.map(object => object.position?.vector.x)).toEqual([0, 0.5, 1])
    expect(nodes.every(object => object.position?.vector.y === 0)).toBe(true)
    expect(derivedScalar(stateOf(raw).derived, 'wavelength')).toMatchObject({ value: 1, unit: 'm', dimension: 'length' })
    const profile = analysisOf(raw, 'captured-state')
    expect(profile.rows).toHaveLength(49)
    expect(profile.rows.at(-1)?.axes.x).toBe(1)
    expect(profile.metrics[0]?.unit).toBe('m')
  })

  it('captures a longitudinal profile on equilibrium space coordinates with raw strain and categorical pressure', () => {
    const runtime = createWaveWorkspaceRuntime(createLongitudinalWaveScene())
    runtime.seek(0.043)
    const raw = runtime.captureRaw()
    const frame = analysisOf(raw, 'captured-state')
    const object = stateOf(raw).objects.find(entry => entry.id === waveProfileId('wave-bench-1', 12))!
    const displacement = object.values?.['displacement']
    if (displacement === undefined || !isScalarQuantity(displacement)) throw new Error('Missing longitudinal displacement.')
    const row = frame.rows.find(entry => entry.evidence?.objectId === object.id)!
    expect(row.axes.x).toBeCloseTo(object.position!.vector.x - canonicalValue(displacement), 14)
    expect(row.values.displacement).toBe(canonicalValue(displacement))
    expect(row.values.position_x).toBe(object.position!.vector.x)
    expect(frame.metrics.find(metric => metric.id === 'strain')).toMatchObject({ unit: '', dimension: 'dimensionless', scale: { kind: 'linear' } })
    expect(frame.metrics.find(metric => metric.id === 'pressure_state')?.scale.kind).toBe('unresolved')
    expect(analysisOf(raw, 'analysis').rows.length).toBeGreaterThan(61 * 48)
    expect(frame.rows.every(entry => entry.values.pressure_state === -1 || entry.values.pressure_state === 0 || entry.values.pressure_state === 1)).toBe(true)
  })

  it('retains diffraction minima and native live intensities without manufacturing a solved spatial wave-field sweep', () => {
    const raw = createWaveWorkspaceRuntime(createDiffractionScene()).captureRaw()
    expect(raw.analysis).toEqual([])
    expect(raw.cursor.kind).toBe('time')
    expect(raw.clock.time).toBe(0)
    expect(raw.clock.total).toBeGreaterThan(0)
    expect(raw.clock.running).toBe(false)
    expect(datasetOf(raw, 'states').axes.map(axis => axis.kind)).toEqual(['time'])
    const objects = stateOf(raw).objects
    expect(objects.some(object => object.id.includes('.minimum.'))).toBe(true)
    const minimum = objects.find(object => object.id.includes('.minimum.'))!
    expect(minimum.values?.['angle']).toMatchObject({ unit: 'rad', dimension: 'angle' })
    expect(minimum.values?.['intensity_ratio']).toMatchObject({ value: 0, dimension: 'dimensionless' })
    expect(objects.some(object => object.id.includes('.profile.'))).toBe(false)
    expect(objects.filter(object => object.id.includes('.intensity.'))).toHaveLength(129)
  })

  it.each([
    ['reflection/refraction', createReflectionRefractionScene],
    ['diffraction', createDiffractionScene],
  ] as const)('captures %s with its real static or live cursor while retaining native history timestamps', (_name, createScene) => {
    const runtime = createWaveWorkspaceRuntime(createScene())
    runtime.seek(0.371)
    const raw = runtime.captureRaw()
    const staticRun = _name === 'reflection/refraction'
    expect(raw.cursor.kind).toBe(staticRun ? 'static' : 'time')
    if (staticRun) expect(raw.clock).toMatchObject({ time: 0, total: 0, running: false })
    else expect(raw.clock).toMatchObject({ time: 0.371, running: false })
    expect(canonicalValue(stateOf(raw).time)).toBeCloseTo(0.371, 14)
    const dataset = datasetOf(raw, 'states')
    expect(dataset.axes.map(axis => axis.kind)).toEqual([staticRun ? 'static' : 'time'])
    expect(dataset.rows).toHaveLength(61)
    expect(dataset.rows[1]?.evidence?.rawTime).toEqual(resultOf(raw).states[1]?.time)
  })

  it.each([
    ['smooth', createMechanicalEnergyScene, 0, 17.64, 4.2],
    ['rough', createRampFrictionScene, 3.528, 14.112, Math.sqrt(14.112)],
  ] as const)('captures the %s moving cart and all history states beside its unchanged static endpoint ledger', (_name, createScene, heat, kinetic, speed) => {
    const runtime = createEnergyWorkspaceRuntime(createScene())
    runtime.setRunning(true)
    runtime.seek(12)
    runtime.advance(5)
    const stateAt = vi.spyOn(EnergyEngine.prototype, 'stateAt')
    const simulate = vi.spyOn(EnergyEngine.prototype, 'simulate')
    const raw = runtime.captureRaw()
    const end = canonicalValue(resultOf(raw).states.at(-1)!.time)
    expect(raw.clock).toEqual({ time: end, total: end, running: false, rate: 1 })
    expect(raw.cursor.kind).toBe('time')
    expect(resultOf(raw).states).toHaveLength(65)
    expect(stateOf(raw).objects[0]?.position?.unit).toBe('m')
    expect(stateOf(raw).objects[0]?.velocity?.unit).toBe('m/s')
    expect(canonicalValue(stateOf(raw).time)).toBe(end)
    expect(derivedScalar(stateOf(raw).derived, 'potential_energy').value).toBeCloseTo(17.64, 12)
    expect(derivedScalar(stateOf(raw).derived, 'friction_work').value).toBeCloseTo(heat, 12)
    expect(derivedScalar(stateOf(raw).derived, 'kinetic_energy').value).toBeCloseTo(kinetic, 12)
    expect(derivedScalar(stateOf(raw).derived, 'speed_at_bottom').value).toBeCloseTo(speed, 12)
    expect(raw.rawState?.ledger).toMatchObject({ energyAccounted: expect.closeTo(17.64, 12), idealSpeed: expect.closeTo(4.2, 12) })
    const dataset = datasetOf(raw, 'states')
    expect(dataset.axes.map(axis => axis.kind)).toEqual(['time'])
    expect(derivedScalar(stateOf(raw).derived, 'current_potential_energy').value).toBeCloseTo(0, 12)
    expect(derivedScalar(stateOf(raw).derived, 'current_kinetic_energy').value).toBeCloseTo(kinetic, 12)
    expect(derivedScalar(stateOf(raw).derived, 'current_thermal_energy').value).toBeCloseTo(heat, 12)
    expect(metricOf(dataset, 'gravitational_potential_energy')).toMatchObject({ unit: 'J', dimension: 'energy', scale: { kind: 'linear' } })
    const ledger = raw.analysis?.find(entry => entry.origin.analysisId === 'energy-ledger')
    expect(ledger?.axes.map(axis => axis.kind)).toEqual(['static'])
    expect(ledger?.rows).toHaveLength(1)
    expect(ledger?.metrics).toHaveLength(12)
    expect(ledger?.conditions).toEqual(conditionsFromScene(raw.scene))
    expect(ledger?.rows[0]?.values.idealSpeed).toBeCloseTo(4.2, 12)
    expect(ledger?.rows[0]?.values.energyAccounted).toBeCloseTo(17.64, 12)
    expect(stateAt).not.toHaveBeenCalled()
    expect(simulate).not.toHaveBeenCalled()
  })

  it('keeps stated energy controls available so a failed rough-ramp ledger can be corrected', () => {
    const runtime = createEnergyWorkspaceRuntime(createRampFrictionScene())
    const failed = runtime.editParameter('ramp-angle', 5)
    expect(failed.status).toBe('failed')
    expect(failed.inspector.flatMap(section => section.parameters ?? []).find(row => row.id === 'ramp-angle')?.value).toBeCloseTo(5, 12)
    expect(failed.inspector.flatMap(section => section.derived ?? [])).toEqual([])
    const rejected = runtime.captureRaw()
    expect(rejected.result?.verification.status).toBe('failed')
    expect(rejected.state).toBeUndefined()
    const corrected = runtime.setChoice('ramp-surface', 'smooth')
    expect(corrected.status).not.toBe('failed')
    const raw = runtime.captureRaw()
    expect(derivedScalar(stateOf(raw).derived, 'friction_work').value).toBe(0)
    expect(raw.scene.revision).toBeGreaterThan(rejected.scene.revision)
    assertCaptureIdentity(raw)
  })

  it.each(engineFixtures.filter(([_name]) => !['point-charge electric', 'reflection/refraction wave', 'diffraction wave', 'smooth energy ledger', 'rough energy ledger'].includes(_name)))('%s replay retains its model-defined physical clock and held state', (_name, _Engine, create) => {
    const runtime = create()
    const end = runtime.getSnapshot().clock.total
    runtime.seek(end)
    runtime.setRunning(true)
    const raw = capture(runtime)
    // Interference fronts retain physical age; only their chart is periodic.
    const expectedTime = _name === 'interference wave' ? end : 0
    expect(raw.clock.time).toBe(expectedTime)
    expect(raw.clock.running).toBe(true)
    expect(canonicalValue(stateOf(raw).time)).toBe(expectedTime)
  })

  it.each([
    ['electric', () => createElectricWorkspaceRuntime(createElectricScene())],
    ['composite', () => createCompositeWorkspaceRuntime(createVelocitySelectorScene())],
    ['induction', () => createInductionWorkspaceRuntime(createBarMotionScene())],
    ['wave', () => createWaveWorkspaceRuntime(createTravellingWaveScene())],
  ] as const)('%s keeps its memoized frame panels when capture and playback change only the cursor', (_name, create) => {
    const runtime = create()
    const frame = runtime.getSnapshot()
    runtime.captureRaw()
    const next = runtime.seek(frame.clock.total * 0.437)
    expect(next.charts).toBe(frame.charts)
    expect(next.table).toBe(frame.table)
    expect(next.verification).toBe(frame.verification)
    expect(next.trajectoryTimes).toBe(frame.trajectoryTimes)
    runtime.captureRaw()
    expect(runtime.getSnapshot().charts).toBe(frame.charts)
  })

  it.each([
    ['electric', () => createElectricWorkspaceRuntime(createElectricScene())],
    ['composite', () => createCompositeWorkspaceRuntime(createVelocitySelectorScene())],
    ['induction', () => createInductionWorkspaceRuntime(createBarMotionScene())],
    ['wave', () => createWaveWorkspaceRuntime(createTravellingWaveScene())],
  ] as const)('%s ignores invalid wall-clock deltas rather than making its held capture time negative or non-finite', (_name, create) => {
    const runtime = create()
    runtime.seek(0)
    runtime.setRunning(true)
    const before = runtime.captureRaw()
    for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY]) runtime.advance(delta)
    const after = runtime.captureRaw()
    expect(after.clock).toEqual(before.clock)
    expect(after.state).toEqual(before.state)
    assertJsonData(after)
  })

  it.each([
    ['electric', ElectricEngine, createElectricScene, createElectricWorkspaceRuntime, 'm'],
    ['composite', CompositeEngine, createVelocitySelectorScene, createCompositeWorkspaceRuntime, 'm'],
    ['induction', InductionEngine, createBarMotionScene, createInductionWorkspaceRuntime, 'loop-resistance'],
    ['wave', WaveEngine, createTravellingWaveScene, createWaveWorkspaceRuntime, 'amplitude'],
    ['energy', EnergyEngine, createMechanicalEnergyScene, createEnergyWorkspaceRuntime, 'cart-mass'],
  ] as const)('%s rejects a first fact edit without pairing a forked scene with old raw data', (_name, Engine, createScene, createRuntime, parameter) => {
    const base = createScene()
    const scene: PhysicsScene = { ...base, metadata: { ...base.metadata, sourceQuestionId: asQuestionId('capture-question') } }
    const runtime: CapturingRuntime = createRuntime(scene)
    const before = runtime.captureRaw()
    const simulate = vi.spyOn(Engine.prototype, 'simulate')
    runtime.editParameter(parameter, -1)
    const after = runtime.captureRaw()
    expect(after.scene).toEqual(before.scene)
    expect(after.request).toEqual(before.request)
    expect(after.result).toEqual(before.result)
    expect(after.state).toEqual(before.state)
    expect(after.scene.metadata.lineage).toBeUndefined()
    expect(after.diagnostics?.length).toBeGreaterThan(0)
    expect(simulate).not.toHaveBeenCalled()
    assertCaptureIdentity(after)
  })

  it('retains source renderer identity and keeps earlier captures immutable through fork, edit and restore', () => {
    const base = createElectricScene({ duration: 2 })
    const release = { kind: 'official' as const, id: 'capture-release', experimentId: 'electric-field', version: '1.2.3' }
    const scene: PhysicsScene = { ...base, metadata: { ...base.metadata, sourceQuestionId: asQuestionId('capture-question'), experimentRelease: release } }
    const runtime = createElectricWorkspaceRuntime(scene)
    runtime.seek(0.7)
    const original = runtime.captureRaw()
    const saved = JSON.stringify(original)
    runtime.editParameter('E', 1.6)
    const edited = runtime.captureRaw()
    expect(edited.scene.id).not.toBe(original.scene.id)
    expect(edited.scene.metadata.lineage?.originSceneId).toBe(original.scene.id)
    expect(edited.engineInfo.release).toEqual(release)
    assertCaptureIdentity(edited)
    runtime.restoreOrigin()
    const restored = runtime.captureRaw()
    expect(restored.scene.id).toBe(original.scene.id)
    expect(restored.scene.revision).toBe(original.scene.revision)
    expect(restored.engineInfo.release).toEqual(release)
    expect(JSON.stringify(original)).toBe(saved)
    assertCaptureIdentity(restored)
  })

  it.each([
    ['electric', ElectricEngine, () => createElectricWorkspaceRuntime(createElectricScene())],
    ['bounded electric', ElectricRegionEngine, () => createElectricWorkspaceRuntime(createParallelPlateScene())],
    ['composite', CompositeEngine, () => createCompositeWorkspaceRuntime(createVelocitySelectorScene())],
    ['induction', InductionEngine, () => createInductionWorkspaceRuntime(createBarMotionScene())],
    ['wave', WaveEngine, () => createWaveWorkspaceRuntime(createTravellingWaveScene())],
    ['energy', EnergyEngine, () => createEnergyWorkspaceRuntime(createMechanicalEnergyScene())],
  ] as const)('%s exposes a failed real-engine result after verification rejection without inventing a state', (_name, Engine, create) => {
    const prototype: Pick<PhysicsEngine<PhysicsScene>, 'simulate'> = Engine.prototype
    const actualSimulate = prototype.simulate
    const simulated = vi.spyOn(prototype, 'simulate').mockImplementation(function (this: PhysicsEngine<PhysicsScene>, scene, request): SimulationResult {
      const real = actualSimulate.call(this, scene, request)
      return {
        ...real,
        verification: {
          ...real.verification,
          status: 'failed',
          checks: [...real.verification.checks, { id: 'capture-rejection', type: 'numerical', passed: false, message: 'Retained verification rejection.' }],
          errors: [...real.verification.errors, { code: 'CAPTURE_REJECTION', severity: 'error', message: 'Retained verification rejection.' }],
        },
      }
    })
    const runtime = create()
    expect(runtime.getSnapshot().status).toBe('failed')
    const actualResult = simulated.mock.results[0]?.value
    const raw = capture(runtime)
    expect(canonicalStringify(raw.result)).toBe(canonicalStringify(actualResult))
    expect(raw.result?.verification.status).toBe('failed')
    expect(raw.state).toBeUndefined()
    expect(raw.clock.running).toBe(false)
    expect(raw.cursor.kind).toBe('time')
    expect(raw.clock.total).toBe(canonicalValue(resultOf(raw).states.at(-1)!.time))
    expect(datasetOf(raw, 'states').axes.map(axis => axis.kind)).toEqual(['time'])
    if (_name === 'energy') expect(raw.result?.states).toHaveLength(65)
    expect(raw.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'Retained verification rejection.' })]))
    expect(raw.result?.states.length).toBeGreaterThan(0)
    if (_name === 'wave') expect(raw.analysis?.[0]?.rows).toHaveLength(61 * 49)
    expect(simulated).toHaveBeenCalledTimes(1)
    assertJsonData(datasetsOf(raw))
    runtime.getSnapshot()
    expect(canonicalStringify(capture(runtime).result)).toBe(canonicalStringify(actualResult))
    expect(simulated).toHaveBeenCalledTimes(1)
    assertCaptureIdentity(raw)
    assertJsonData(raw)
  })

  it.each([
    ['electric', ElectricEngine, () => createElectricWorkspaceRuntime(createElectricScene())],
    ['composite', CompositeEngine, () => createCompositeWorkspaceRuntime(createVelocitySelectorScene())],
    ['induction', InductionEngine, () => createInductionWorkspaceRuntime(createBarMotionScene())],
    ['wave', WaveEngine, () => createWaveWorkspaceRuntime(createTravellingWaveScene())],
    ['energy', EnergyEngine, () => createEnergyWorkspaceRuntime(createMechanicalEnergyScene())],
  ] as const)('%s retains the actual submitted request and honest diagnostic when simulate throws', (_name, Engine, create) => {
    const prototype: Pick<PhysicsEngine<PhysicsScene>, 'simulate'> = Engine.prototype
    const simulate = vi.spyOn(prototype, 'simulate').mockImplementation(() => { throw new Error('Engine did not produce a result.') })
    const runtime = create()
    const raw = capture(runtime)
    expect(raw.request).toEqual(simulate.mock.calls[0]?.[1])
    expect(raw.result).toBeUndefined()
    expect(raw.state).toBeUndefined()
    expect(raw.rawState).toBeUndefined()
    expect(raw.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'Engine did not produce a result.' })]))
    expect(raw.request?.sceneId).toBe(raw.scene.id)
    expect(raw.request?.sceneRevision).toBe(raw.scene.revision)
    expect(raw.clock).toMatchObject({ total: 0, running: false })
    expect(simulate).toHaveBeenCalledTimes(1)
    assertJsonData(raw)
  })

  it('exposes honest diagnostics, not a result or zero state, when the engine cannot handle a valid scene', () => {
    const scene: PhysicsScene = { ...createMechanicalEnergyScene(), energyBenches: [], observableDefinitions: [], measurementDefinitions: [], annotations: [] }
    const simulate = vi.spyOn(EnergyEngine.prototype, 'simulate')
    const raw = createEnergyWorkspaceRuntime(scene).captureRaw()
    expect(raw.request).toBeUndefined()
    expect(raw.result).toBeUndefined()
    expect(raw.state).toBeUndefined()
    expect(raw.rawState).toBeUndefined()
    expect(raw.diagnostics?.length).toBeGreaterThan(0)
    expect(simulate).not.toHaveBeenCalled()
    assertJsonData(raw)
  })
})
