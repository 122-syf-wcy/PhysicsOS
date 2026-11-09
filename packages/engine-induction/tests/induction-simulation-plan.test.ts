import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, derivedScalar, type SimulationOptions } from '@physicsos/physics-core'
import * as sceneSampling from '@physicsos/physics-scene'
import {
  createBarMotionScene,
  createDoubleBarRailScene,
  createFluxChangeScene,
  createInductionScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asSceneId } from '@physicsos/shared'

import {
  BAR_MOTION_EMF_MODEL,
  DOUBLE_BAR_RAIL_MODEL,
  FLUX_CHANGE_EMF_MODEL,
  INDUCTION_ENGINE_ID,
  INDUCTION_ENGINE_VERSION,
  InductionEngine,
  createInductionSimulationRequest,
} from '../src/induction-engine.ts'

const requestFor = (scene: PhysicsScene, options?: SimulationOptions) => ({
  ...createInductionSimulationRequest(scene, 'sim-induction-plan', 'trace-induction-plan'),
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

describe('InductionEngine.prepareSimulationPlan', () => {
  it.each([
    { make: () => createBarMotionScene(), modelId: BAR_MOTION_EMF_MODEL, endTime: 5 },
    { make: () => createFluxChangeScene(), modelId: FLUX_CHANGE_EMF_MODEL, endTime: 5 },
    { make: () => createDoubleBarRailScene(), modelId: DOUBLE_BAR_RAIL_MODEL, endTime: 4 },
    {
      make: () => createDoubleBarRailScene({ externalForce: 0.2, barMasses: [75, 125] }),
      modelId: DOUBLE_BAR_RAIL_MODEL,
      endTime: 4,
    },
  ])('matches the actual $modelId default run without inventing integration cost', ({ make, modelId, endTime }) => {
    const scene = make()
    const request = requestFor(scene, {})
    const engine = new InductionEngine()
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toEqual({
      schemaVersion: 'simulation-plan/1.0',
      engineId: INDUCTION_ENGINE_ID,
      engineVersion: INDUCTION_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      modelId,
      kind: 'analytic',
      metadata: {
        numericalIterationAccounting: expect.stringContaining('no numerical integration or solver loops'),
      },
      startTime: 0,
      endTime,
      storageSampleCountBound: 61,
      numericalIterationCountBound: 0,
    })
    expect(() => assertSimulationPlan(plan)).not.toThrow()
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(plan.storageSampleCountBound)
    expect(result.states[0]?.time.value).toBe(0)
    expect(result.states.at(-1)?.time.value).toBe(endTime)
  })

  it('uses the actual five-second fallback only when the scene timeline omits its end', () => {
    const built = createDoubleBarRailScene()
    const timeline = { ...built.timeline }
    delete timeline.endTime
    const scene: PhysicsScene = { ...built, timeline }
    const request = requestFor(scene, {})
    const engine = new InductionEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({ endTime: 5, storageSampleCountBound: 61 })
    expect(engine.simulate(scene, request).states.at(-1)?.time.value).toBe(5)
  })

  it('resolves custom non-SI scene and request windows without rewriting options', () => {
    const built = createInductionScene({
      sceneId: 'custom-induction-plan', revision: 7,
      bench: {
        type: 'bar_motion', magneticFluxDensity: 0.3,
        barLength: 35, barVelocity: 1.5, resistance: 4,
      },
    })
    const scene = freeze({ ...built, timeline: { ...built.timeline, endTime: quantity(2, 'min', 'time') } })
    const engine = new InductionEngine()
    expect(engine.prepareSimulationPlan(scene, requestFor(scene, {})).endTime).toBe(120)
    const request = freeze(requestFor(scene, {
      startTime: quantity(500, 'ms', 'time'),
      endTime: quantity(2500, 'ms', 'time'),
      outputSampleRate: 5,
      timeStep: quantity(1, 'ms', 'time'), maxIterations: 1,
    }))
    const snapshot = structuredClone({ scene, request })
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({
      sceneRevision: 7, startTime: 0.5, endTime: 2.5,
      storageSampleCountBound: 5, numericalIterationCountBound: 0,
    })
    const result = engine.simulate(scene, request)
    expect(result.states.map(state => state.time.value)).toEqual([0.5, 1, 1.5, 2, 2.5])
    expect(derivedScalar(result.derivedQuantities, 'induced_emf').value).toBeCloseTo(0.3 * 0.35 * 1.5, 12)
    expect({ scene, request }).toEqual(snapshot)
  })

  it('preserves the flux_rate Wb/s quantity while preparing a custom flux-change rig', () => {
    const scene = createFluxChangeScene({ fluxRate: -0.08, coilArea: 125, coilAngle: 30, resistance: 4 })
    const request = requestFor(scene, { endTime: quantity(1, 's', 'time'), outputSampleRate: 2 })
    const engine = new InductionEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      modelId: FLUX_CHANGE_EMF_MODEL, kind: 'analytic', numericalIterationCountBound: 0,
    })
    const result = engine.simulate(scene, request)
    expect(derivedScalar(result.derivedQuantities, 'flux_rate')).toMatchObject({
      value: -0.08, unit: 'Wb/s', dimension: 'magnetic_flux_rate',
    })
    expect(derivedScalar(result.derivedQuantities, 'induced_emf').value).toBeCloseTo(0.08, 12)
  })

  it('allows an explicitly sparse long double-bar analytical window without evaluating it in planning', () => {
    const scene = freeze(createDoubleBarRailScene({ externalForce: 0.2 }))
    const request = freeze(requestFor(scene, {
      startTime: quantity(2, 's', 'time'),
      endTime: quantity(1e9, 's', 'time'),
      outputSampleRate: 2,
      timeStep: quantity(1, 'ms', 'time'), maxIterations: 1,
    }))
    const snapshot = structuredClone({ scene, request })
    const engine = new InductionEngine()
    const forbidden = () => { throw new Error('Planning must not evaluate states or allocate sample arrays.') }
    const sample = vi.spyOn(sceneSampling, 'trajectorySampleTimes').mockImplementation(forbidden)
    const canHandle = vi.spyOn(engine, 'canHandle').mockImplementation(forbidden)
    const state = vi.spyOn(engine, 'stateAt').mockImplementation(forbidden)
    const simulate = vi.spyOn(engine, 'simulate').mockImplementation(forbidden)
    const exponential = vi.spyOn(Math, 'exp').mockImplementation(forbidden)
    const arrays = vi.spyOn(Array, 'from').mockImplementation(forbidden)
    const plan = engine.prepareSimulationPlan(scene, request)
    const arrayAllocations = arrays.mock.calls.length
    const exponentialEvaluations = exponential.mock.calls.length
    arrays.mockRestore()
    exponential.mockRestore()
    expect(plan).toMatchObject({
      startTime: 2, endTime: 1e9, storageSampleCountBound: 2,
      modelId: DOUBLE_BAR_RAIL_MODEL, kind: 'analytic', numericalIterationCountBound: 0,
    })
    expect(arrayAllocations).toBe(0)
    expect(exponentialEvaluations).toBe(0)
    for (const spy of [sample, canHandle, state, simulate]) expect(spy).not.toHaveBeenCalled()
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
  ])('keeps direct-engine storage-count semantics for $requested', ({ requested, count }) => {
    const scene = createBarMotionScene()
    const request = requestFor(scene, {
      endTime: quantity(1, 's', 'time'),
      ...(requested === undefined ? {} : { outputSampleRate: requested }),
    })
    const engine = new InductionEngine()
    expect(engine.prepareSimulationPlan(scene, request).storageSampleCountBound).toBe(count)
    expect(engine.simulate(scene, request).states).toHaveLength(count)
  })

  it('simulates an explicitly sparse long double-bar window without expanding its analytical storage', () => {
    const scene = createDoubleBarRailScene()
    const request = requestFor(scene, {
      endTime: quantity(1e6, 's', 'time'), outputSampleRate: 2,
    })
    const engine = new InductionEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      endTime: 1e6, storageSampleCountBound: 2, numericalIterationCountBound: 0,
    })
    const result = engine.simulate(scene, request)
    expect(result.states.map(state => state.time.value)).toEqual([0, 1e6])
    expect(derivedScalar(result.derivedQuantities, 'relative_velocity').value).toBe(0)
  })

  it('preserves repeated-time sampling for an explicit zero-length window', () => {
    const scene = createBarMotionScene()
    const request = requestFor(scene, {
      startTime: quantity(3, 's', 'time'), endTime: quantity(3, 's', 'time'), outputSampleRate: 5,
    })
    const engine = new InductionEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      startTime: 3, endTime: 3, storageSampleCountBound: 5, numericalIterationCountBound: 0,
    })
    expect(engine.simulate(scene, request).states.map(state => state.time.value)).toEqual([3, 3, 3, 3, 3])
  })

  it.each([
    { startTime: quantity(-1, 's', 'time'), endTime: quantity(1, 's', 'time') },
    { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
  ])('rejects the same invalid range as simulation', options => {
    const scene = createBarMotionScene()
    const request = requestFor(scene, options)
    const engine = new InductionEngine()
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrowError(/0 <= startTime <= endTime/)
    expect(() => engine.simulate(scene, request)).toThrowError(/0 <= startTime <= endTime/)
  })

  it('rejects nonfinite time quantities in planning and simulation', () => {
    const scene = createBarMotionScene()
    const engine = new InductionEngine()
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const request = requestFor(scene, { endTime: { ...quantity(1, 's', 'time'), value } })
      expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
      expect(() => engine.simulate(scene, request)).toThrow()
    }
  })

  it.each(['sceneId', 'sceneRevision'] as const)('guards the exact requested %s before model resolution', key => {
    const scene = createBarMotionScene()
    const request = requestFor(scene)
    const mismatch = key === 'sceneId'
      ? { ...request, sceneId: asSceneId('another-induction-scene') }
      : { ...request, sceneRevision: scene.revision + 1 }
    expect(() => new InductionEngine().prepareSimulationPlan({ ...scene, inductionBenches: [] }, mismatch))
      .toThrowError(/SimulationRequest must reference/)
  })
})
