import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, type SimulationOptions } from '@physicsos/physics-core'
import * as sceneSampling from '@physicsos/physics-scene'
import {
  createDiffractionScene,
  createDopplerScene,
  createLongitudinalWaveScene,
  createReflectionRefractionScene,
  createStandingWaveScene,
  createTravellingWaveScene,
  createWaveInterferenceScene,
  createWaveScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asSceneId } from '@physicsos/shared'

import {
  WAVE_ENGINE_ID,
  WAVE_ENGINE_VERSION,
  WaveEngine,
  createWaveSimulationRequest,
  profileSampleCountOf,
} from '../src/wave-engine.ts'
import * as waveModel from '../src/wave-model.ts'

const requestFor = (scene: PhysicsScene, options?: SimulationOptions) => ({
  ...createWaveSimulationRequest(scene, 'sim-wave-plan', 'trace-wave-plan'),
  ...(options === undefined ? {} : { options }),
})

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

afterEach(() => vi.restoreAllMocks())

describe('WaveEngine.prepareSimulationPlan', () => {
  it.each([
    { make: () => createTravellingWaveScene(), modelId: 'travelling_wave' },
    { make: () => createWaveInterferenceScene(), modelId: 'wave_interference' },
    { make: () => createStandingWaveScene(), modelId: 'standing_wave' },
    { make: () => createLongitudinalWaveScene(), modelId: 'longitudinal_wave' },
    { make: () => createReflectionRefractionScene(), modelId: 'reflection_refraction' },
    { make: () => createDiffractionScene(), modelId: 'wave_diffraction' },
    { make: () => createDopplerScene(), modelId: 'wave_doppler' },
  ])('matches actual $modelId default sampling and reports no numerical solver loops', ({ make, modelId }) => {
    const scene = make()
    const request = requestFor(scene, {})
    const engine = new WaveEngine()
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toEqual({
      schemaVersion: 'simulation-plan/1.0',
      engineId: WAVE_ENGINE_ID,
      engineVersion: WAVE_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      modelId,
      kind: 'analytic',
      metadata: {
        numericalIterationAccounting: expect.stringContaining('not numerical solver iterations'),
      },
      startTime: 0,
      endTime: 1,
      storageSampleCountBound: 61,
      numericalIterationCountBound: 0,
    })
    expect(() => assertSimulationPlan(plan)).not.toThrow()
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(61)
    expect(result.states[0]?.time.value).toBe(0)
    expect(result.states.at(-1)?.time.value).toBe(1)
  })

  it('uses an authored custom scene window rather than replacing it with one second', () => {
    const scene = createWaveScene({
      sceneId: 'custom-wave-plan', revision: 9,
      bench: { type: 'travelling', amplitude: 3, wavelength: 0.25, frequency: 0.5, ropeLength: 2 },
    })
    const engine = new WaveEngine()
    const request = requestFor(scene, {})
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      sceneRevision: 9, endTime: 4, storageSampleCountBound: 61,
    })
    expect(engine.simulate(scene, request).states.at(-1)?.time.value).toBe(4)
  })

  it('uses the one-second fallback only when the actual scene has no end time', () => {
    const built = createTravellingWaveScene({ frequency: 0.5 })
    const timeline = { ...built.timeline }
    delete timeline.endTime
    const scene: PhysicsScene = { ...built, timeline }
    const request = requestFor(scene, {})
    const engine = new WaveEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({ endTime: 1, storageSampleCountBound: 61 })
    expect(engine.simulate(scene, request).states.at(-1)?.time.value).toBe(1)
  })

  it('resolves non-SI scene and request times while retaining raw options and wave quantities', () => {
    const built = createTravellingWaveScene()
    const scene = freeze({
      ...built,
      timeline: { ...built.timeline, endTime: quantity(2, 'min', 'time') },
      waveBenches: (built.waveBenches ?? []).map(bench => ({ ...bench, frequency: quantity(2, 'kHz', 'frequency') })),
    })
    const engine = new WaveEngine()
    expect(engine.prepareSimulationPlan(scene, requestFor(scene, {})).endTime).toBe(120)
    const request = freeze(requestFor(scene, {
      startTime: quantity(250, 'ms', 'time'), endTime: quantity(1250, 'ms', 'time'),
      outputSampleRate: 3,
      timeStep: quantity(1, 'ms', 'time'), maxIterations: 1,
    }))
    const snapshot = structuredClone({ scene, request })
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({
      startTime: 0.25, endTime: 1.25, storageSampleCountBound: 3, numericalIterationCountBound: 0,
    })
    const result = engine.simulate(scene, request)
    expect(result.states.map(state => state.time.value)).toEqual([0.25, 0.75, 1.25])
    expect({ scene, request }).toEqual(snapshot)
  })

  it('counts persisted states rather than the model-dependent spatial profiles inside them', () => {
    const engine = new WaveEngine()
    const compact = createTravellingWaveScene({ ropeLength: 1.2, wavelength: 0.4 })
    const expanded = createTravellingWaveScene({ ropeLength: 40, wavelength: 0.4 })
    for (const [scene, expectedProfiles] of [[compact, 49], [expanded, 481]] as const) {
      const model = waveModel.resolveWaveModel(scene)
      const request = requestFor(scene, { endTime: quantity(1, 's', 'time'), outputSampleRate: 3 })
      const plan = engine.prepareSimulationPlan(scene, request)
      expect(plan.storageSampleCountBound).toBe(3)
      expect(plan.numericalIterationCountBound).toBe(0)
      expect(profileSampleCountOf(model) + 1).toBe(expectedProfiles)
      const result = engine.simulate(scene, request)
      expect(result.states).toHaveLength(3)
      expect(result.states[0]?.objects.filter(object => object.id.includes('.profile.'))).toHaveLength(expectedProfiles)
    }
  })

  it('does not allocate standing-wave profile, node, antinode, or trajectory samples while planning', () => {
    const scene = freeze(createStandingWaveScene({ harmonic: 1000000 }))
    const request = freeze(requestFor(scene, {
      endTime: quantity(1e9, 's', 'time'), outputSampleRate: 2,
      timeStep: quantity(1, 'ms', 'time'), maxIterations: 1,
    }))
    const snapshot = structuredClone({ scene, request })
    const engine = new WaveEngine()
    const forbidden = () => { throw new Error('Planning must not evaluate states or allocate sample arrays.') }
    const sample = vi.spyOn(sceneSampling, 'trajectorySampleTimes').mockImplementation(forbidden)
    const nodes = vi.spyOn(waveModel, 'nodePositionsOf').mockImplementation(forbidden)
    const antinodes = vi.spyOn(waveModel, 'antinodePositionsOf').mockImplementation(forbidden)
    const displacement = vi.spyOn(waveModel, 'standingDisplacement').mockImplementation(forbidden)
    const canHandle = vi.spyOn(engine, 'canHandle').mockImplementation(forbidden)
    const state = vi.spyOn(engine, 'stateAt').mockImplementation(forbidden)
    const simulate = vi.spyOn(engine, 'simulate').mockImplementation(forbidden)
    const arrays = vi.spyOn(Array, 'from').mockImplementation(forbidden)
    const plan = engine.prepareSimulationPlan(scene, request)
    const arrayAllocations = arrays.mock.calls.length
    arrays.mockRestore()
    expect(plan).toMatchObject({
      modelId: 'standing_wave', kind: 'analytic', endTime: 1e9,
      storageSampleCountBound: 2, numericalIterationCountBound: 0,
    })
    expect(arrayAllocations).toBe(0)
    for (const spy of [sample, nodes, antinodes, displacement, canHandle, state, simulate]) expect(spy).not.toHaveBeenCalled()
    expect({ scene, request }).toEqual(snapshot)
  })

  it.each([
    { requested: undefined, count: 61 },
    { requested: 4.8, count: 4 },
    { requested: 0, count: 2 },
    { requested: -3, count: 2 },
    { requested: Number.NaN, count: 61 },
    { requested: Number.POSITIVE_INFINITY, count: 61 },
    { requested: 100000, count: 1024 },
  ])('matches direct-engine storage-count semantics for $requested', ({ requested, count }) => {
    const scene = createWaveInterferenceScene()
    const request = requestFor(scene, {
      endTime: quantity(1, 's', 'time'),
      ...(requested === undefined ? {} : { outputSampleRate: requested }),
    })
    const engine = new WaveEngine()
    expect(engine.prepareSimulationPlan(scene, request).storageSampleCountBound).toBe(count)
    expect(engine.simulate(scene, request).states).toHaveLength(count)
  })

  it('simulates an explicitly sparse long analytical window with the requested two states', () => {
    const scene = createTravellingWaveScene()
    const request = requestFor(scene, { endTime: quantity(1e6, 's', 'time'), outputSampleRate: 2 })
    const engine = new WaveEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      endTime: 1e6, storageSampleCountBound: 2, numericalIterationCountBound: 0,
    })
    expect(engine.simulate(scene, request).states.map(state => state.time.value)).toEqual([0, 1e6])
  })

  it('retains repeated-time samples for a zero-length analytical window', () => {
    const scene = createTravellingWaveScene()
    const request = requestFor(scene, {
      startTime: quantity(2, 's', 'time'), endTime: quantity(2, 's', 'time'), outputSampleRate: 5,
    })
    const engine = new WaveEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      startTime: 2, endTime: 2, storageSampleCountBound: 5, numericalIterationCountBound: 0,
    })
    expect(engine.simulate(scene, request).states.map(state => state.time.value)).toEqual([2, 2, 2, 2, 2])
  })

  it.each([
    { startTime: quantity(-1, 's', 'time'), endTime: quantity(1, 's', 'time') },
    { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
  ])('rejects the same invalid range as simulation', options => {
    const scene = createTravellingWaveScene()
    const request = requestFor(scene, options)
    const engine = new WaveEngine()
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrowError(/0 <= startTime <= endTime/)
    expect(() => engine.simulate(scene, request)).toThrowError(/0 <= startTime <= endTime/)
  })

  it('rejects nonfinite time quantities before planning or simulation', () => {
    const scene = createTravellingWaveScene()
    const engine = new WaveEngine()
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const request = requestFor(scene, { endTime: { ...quantity(1, 's', 'time'), value } })
      expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
      expect(() => engine.simulate(scene, request)).toThrow()
    }
  })

  it.each(['sceneId', 'sceneRevision'] as const)('guards the exact requested %s before resolving a wave model', key => {
    const scene = createTravellingWaveScene()
    const request = requestFor(scene)
    const mismatch = key === 'sceneId'
      ? { ...request, sceneId: asSceneId('another-wave-scene') }
      : { ...request, sceneRevision: scene.revision + 1 }
    expect(() => new WaveEngine().prepareSimulationPlan({ ...scene, waveBenches: [] }, mismatch))
      .toThrowError(/SimulationRequest must reference/)
  })
})
