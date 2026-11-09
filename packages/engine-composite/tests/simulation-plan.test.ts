import { describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, type SimulationOptions } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import * as compositeCore from '@physicsos/physics-composite-core'
import * as physicsScene from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'

import {
  COMPOSITE_ENGINE_ID,
  COMPOSITE_ENGINE_VERSION,
  COMPOSITE_FIELD_MODEL,
  CompositeEngine,
  createCompositeSimulationRequest,
} from '../src/composite-engine.ts'
import * as cyclotron from '../src/cyclotron-model.ts'
import * as phaseSearch from '../src/phase-search.ts'

const NOW = '2026-11-08T00:00:00.000Z'
const uniformScene = () => physicsScene.createCompositeFieldScene({
  charge: 1,
  mass: 1,
  velocity: vec3(1, 0, 0),
  electricFieldStrength: 1,
  electricFieldDirection: 'up',
  magneticFieldStrength: 1,
  magneticFieldOrientation: 'out_of_page',
  duration: 4,
  now: NOW,
})
const selectorScene = () => physicsScene.createVelocitySelectorScene({
  charge: 1,
  mass: 1,
  position: vec3(-1, 0, 0),
  velocity: vec3(1, 0, 0),
  electricFieldStrength: 1,
  electricFieldDirection: 'up',
  magneticFieldStrength: 1,
  magneticFieldOrientation: 'out_of_page',
  regionWidth: 2,
  regionHeight: 10,
  duration: 4,
  now: NOW,
})
const cyclotronScene = () => physicsScene.createCyclotronScene({ now: NOW })

const compareExecution = (
  scene: physicsScene.PhysicsScene,
  options: SimulationOptions = {},
) => {
  const engine = new CompositeEngine()
  const request = {
    ...createCompositeSimulationRequest(scene, 'sim-composite-plan', 'trace-composite-plan'),
    options,
  }
  const original = structuredClone(request)
  Object.freeze(request.options)
  Object.freeze(request)
  const searches = vi.spyOn(phaseSearch, 'findCompositePhaseBoundary')
  const samples = vi.spyOn(physicsScene, 'trajectorySampleTimes')
  try {
    const plan = engine.prepareSimulationPlan(scene, request)
    assertSimulationPlan(plan)
    expect(searches).not.toHaveBeenCalled()
    expect(samples).not.toHaveBeenCalled()
    expect(request).toEqual(original)
    expect(plan).toMatchObject({
      schemaVersion: 'simulation-plan/1.0',
      engineId: COMPOSITE_ENGINE_ID,
      engineVersion: COMPOSITE_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
    })

    const result = engine.simulate(scene, request)
    let numericalIterations = 0
    for (const entry of searches.mock.results) {
      expect(entry.type).toBe('return')
      if (entry.type === 'return') numericalIterations += entry.value.numericalIterationCount
    }
    expect(numericalIterations).toBeLessThanOrEqual(plan.numericalIterationCountBound)
    expect(result.states.length).toBeLessThanOrEqual(plan.storageSampleCountBound)
    expect(canonicalValue(result.states[0]!.time)).toBeCloseTo(plan.startTime, 15)
    expect(canonicalValue(result.states.at(-1)!.time)).toBeCloseTo(plan.endTime, 15)
    expect(canonicalValue(result.states.at(-1)!.time) - canonicalValue(result.states[0]!.time))
      .toBeCloseTo(plan.endTime - plan.startTime, 15)
    for (const event of result.events) {
      if (event.time !== undefined) {
        expect(event.time).toBeGreaterThanOrEqual(plan.startTime)
        expect(event.time).toBeLessThanOrEqual(plan.endTime)
      }
    }
    expect(request).toEqual(original)
    return { plan, result, numericalIterations, phaseCount: searches.mock.calls.length }
  } finally {
    searches.mockRestore()
    samples.mockRestore()
  }
}

describe('CompositeEngine.prepareSimulationPlan', () => {
  it('uses the actual scene duration and analytic constant-environment path with options={}', () => {
    const { plan, result, numericalIterations } = compareExecution(uniformScene())
    expect(plan.modelId).toBe(COMPOSITE_FIELD_MODEL)
    expect(plan.kind).toBe('analytic')
    expect(plan.endTime).toBe(4)
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(numericalIterations).toBe(0)
    expect(result.states).toHaveLength(241)
  })

  it('uses the engine 1e-6-second fallback when a uniform scene omits its timeline end', () => {
    const scene = uniformScene()
    delete scene.timeline.endTime
    const { plan } = compareExecution(scene)
    expect(plan.endTime).toBe(1e-6)
    expect(plan.kind).toBe('analytic')
  })

  it('takes a canonical non-SI end from the scene timeline', () => {
    const scene = uniformScene()
    scene.timeline.endTime = quantity(1500, 'ms', 'time')
    expect(compareExecution(scene).plan.endTime).toBe(1.5)
  })

  it('keeps an E+B+gravity model analytic without fabricating integration work', () => {
    const scene = physicsScene.createCompositeFieldScene({
      charge: 1,
      mass: 1,
      velocity: vec3(1, 0, 0),
      electricFieldStrength: 2,
      electricFieldDirection: 'up',
      magneticFieldStrength: 1,
      magneticFieldOrientation: 'out_of_page',
      gravity: 1,
      duration: 2,
      now: NOW,
    })
    const { plan, numericalIterations } = compareExecution(scene, { outputSampleRate: 7 })
    expect(plan.kind).toBe('analytic')
    expect(numericalIterations).toBe(0)
  })

  it('recognizes an explicitly unbounded region as the same constant environment', () => {
    const scene = uniformScene()
    scene.regions.push({
      id: 'global-region',
      shape: { type: 'unbounded' },
      center: scene.particles[0]!.position,
    })
    for (const field of scene.fields) field.regionId = 'global-region'
    const { plan, numericalIterations } = compareExecution(scene, { outputSampleRate: 3 })
    expect(plan.kind).toBe('analytic')
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(numericalIterations).toBe(0)
  })

  it('accepts a sparse long closed-form window without a duration/timeStep-derived budget', () => {
    const { plan, result } = compareExecution(uniformScene(), {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(100_000_000, 's', 'time'),
      outputSampleRate: 2,
      timeStep: quantity(1e-12, 's', 'time'),
      maxIterations: 1,
    })
    expect(plan.startTime).toBe(0.25)
    expect(plan.endTime).toBe(100_000_000)
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(result.states).toHaveLength(2)
  })

  it('canonicalizes a non-SI custom window and floors the capped count', () => {
    const { plan, result } = compareExecution(uniformScene(), {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(2250, 'ms', 'time'),
      outputSampleRate: 5.9,
    })
    expect(plan.startTime).toBe(0.25)
    expect(plan.endTime).toBe(2.25)
    expect(result.states).toHaveLength(5)
  })

  it('advertises and numerically bounds the actual region scan and bisection rounds', () => {
    const { plan, result, numericalIterations, phaseCount } = compareExecution(selectorScene(), {
      outputSampleRate: 2,
      maxIterations: 1,
    })
    expect(plan.kind).toBe('iterative')
    expect(plan.numericalIterationCountBound).toBe(512 * (400 + 40))
    expect(numericalIterations).toBeGreaterThan(400)
    expect(phaseCount).toBeLessThanOrEqual(512)
    expect(result.states.length).toBeGreaterThan(2)
    expect(result.events.map((event) => event.type)).toContain('EnterRegion')
    expect(result.events.map((event) => event.type)).toContain('ExitRegion')
    for (const event of result.events) {
      expect(result.states.some((state) => canonicalValue(state.time) === event.time)).toBe(true)
    }
  })

  it('reports the root cap even when the actual sparse run only needs 400 no-crossing probes', () => {
    const scene = selectorScene()
    scene.particles[0]!.velocity.vector.x = -1
    const { plan, numericalIterations } = compareExecution(scene, {
      startTime: quantity(500, 'ms', 'time'),
      endTime: quantity(100_000_000, 's', 'time'),
      outputSampleRate: 2,
      maxIterations: 1,
    })
    expect(numericalIterations).toBe(400)
    expect(plan.numericalIterationCountBound).toBe(225_280)
    expect(plan.endTime).toBe(100_000_000)
  })

  it('uses the absolute launch-to-end search horizon even for a zero-width positive-time window', () => {
    const { plan, result, numericalIterations } = compareExecution(selectorScene(), {
      startTime: quantity(2, 's', 'time'),
      endTime: quantity(2000, 'ms', 'time'),
      outputSampleRate: 7,
    })
    expect(plan.startTime).toBe(2)
    expect(plan.endTime).toBe(2)
    expect(plan.kind).toBe('iterative')
    expect(plan.storageSampleCountBound).toBe(1)
    expect(result.states).toHaveLength(1)
    expect(numericalIterations).toBeGreaterThan(0)
  })

  it('performs no boundary search at the launch instant and deduplicates zero-width times', () => {
    const { plan, result, numericalIterations } = compareExecution(selectorScene(), {
      startTime: quantity(0, 'ms', 'time'),
      endTime: quantity(0, 's', 'time'),
      outputSampleRate: 1024,
    })
    expect(plan.kind).toBe('analytic')
    expect(plan.storageSampleCountBound).toBe(1)
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(numericalIterations).toBe(0)
    expect(result.states).toHaveLength(1)
  })

  it.each([
    { name: 'velocity selector', build: () => physicsScene.createVelocitySelectorScene({ now: NOW }) },
    { name: 'mass spectrometer', build: () => physicsScene.createMassSpectrometerScene({ now: NOW }) },
    { name: 'multiple field regions', build: () => physicsScene.createMultiRegionFieldScene({ now: NOW }) },
  ])('bounds the supported $name apparatus using the actual private search', ({ build }) => {
    const { plan, numericalIterations, phaseCount } = compareExecution(build(), { outputSampleRate: 5 })
    expect(plan.modelId).toBe(COMPOSITE_FIELD_MODEL)
    expect(plan.kind).toBe('iterative')
    expect(phaseCount).toBeLessThanOrEqual(512)
    expect(numericalIterations).toBeLessThanOrEqual(225_280)
  })

  it('fails certification when more than 512 region transitions exceed the actual phase cap', () => {
    const scene = uniformScene()
    scene.timeline.endTime = quantity(100, 's', 'time')
    // Balanced global E+B keeps x(t)=t exactly. Geometrically shrinking marker
    // regions keep every entry/exit wider than the next coarse search step.
    const boundaryTime = (index: number) => 100 * (1 - 0.99 ** index)
    for (let index = 0; index < 257; index += 1) {
      const enterTime = boundaryTime(2 * index + 1)
      const exitTime = boundaryTime(2 * index + 2)
      scene.regions.push({
        id: `marker-region-${index}`,
        shape: {
          type: 'rectangle',
          width: quantity(exitTime - enterTime, 'm', 'length'),
          height: quantity(10, 'm', 'length'),
        },
        center: {
          vector: vec3((enterTime + exitTime) / 2, 0, 0),
          unit: 'm',
          dimension: 'length',
        },
      })
    }
    expect(scene.regions.length * 2).toBe(514)
    const { plan, result, phaseCount } = compareExecution(scene, { outputSampleRate: 2 })
    expect(plan.numericalIterationCountBound).toBe(225_280)
    expect(phaseCount).toBe(512)
    expect(result.events).toHaveLength(512)
    expect(result.states).toHaveLength(514)
    expect(canonicalValue(result.states.at(-1)!.time)).toBe(100)
    expect(result.verification.status).toBe('failed')
    const complete = result.verification.checks.find((entry) => entry.id === 'composite_phase_horizon_complete')
    expect(complete).toMatchObject({
      passed: false,
      details: {
        phaseCount: 512,
        phaseCountLimit: 512,
        requestedEndTime: 100,
        truncated: true,
      },
    })
    expect(complete!.details!.resolvedEndTime).toBeCloseTo(boundaryTime(512), 7)
    expect(complete!.details!.resolvedEndTime).toBeLessThan(100)
    expect(complete!.message).toMatch(/diagnostic extrapolations.*not verified/)
    expect(result.verification.errors.some((entry) => entry.code === 'composite_phase_horizon_complete')).toBe(true)
  })

  it('uses actual cyclotron model resolution and the real omitted-end engine fallback', () => {
    const scene = cyclotronScene()
    delete scene.timeline.endTime
    const { plan, result, numericalIterations } = compareExecution(scene)
    expect(plan.modelId).toBe(cyclotron.CYCLOTRON_TIME_VARYING_MODEL)
    expect(plan.kind).toBe('analytic')
    expect(plan.endTime).toBe(1e-6)
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(numericalIterations).toBe(0)
    expect(result.states.length).toBeGreaterThan(241)
  })

  it('counts protected cyclotron crossings above the 1024 base storage cap', () => {
    const scene = cyclotronScene()
    const model = cyclotron.resolveCyclotronModel(scene)
    expect(model.accelerationCount).toBeGreaterThan(512)
    const { plan, result, numericalIterations } = compareExecution(scene, {
      endTime: quantity(model.period * 300, 's', 'time'),
      outputSampleRate: 1_000_000,
    })
    expect(plan.storageSampleCountBound).toBe(1024 + 513)
    expect(result.states.length).toBeGreaterThan(1024)
    expect(result.events.filter((event) => event.type === 'AcceleratingGapCrossing')).toHaveLength(512)
    expect(numericalIterations).toBe(0)
    expect(plan.numericalIterationCountBound).toBe(0)
  })

  it('counts only the actual cyclotron crossing window for custom non-SI endpoints', () => {
    const scene = cyclotronScene()
    const model = cyclotron.resolveCyclotronModel(scene)
    const { plan, result } = compareExecution(scene, {
      startTime: quantity((model.period * 0.25) / 1e-6, 'us', 'time'),
      endTime: quantity((model.period * 1.25) / 1e-6, 'us', 'time'),
      outputSampleRate: 2,
    })
    expect(plan.storageSampleCountBound).toBe(4)
    expect(result.states).toHaveLength(4)
    expect(result.events.filter((event) => event.type === 'AcceleratingGapCrossing')).toHaveLength(2)
  })

  it('uses exact inclusive crossing times rather than a rounded time/period count', () => {
    const scene = cyclotronScene()
    const model = cyclotron.resolveCyclotronModel(scene)
    const { result } = compareExecution(scene, {
      startTime: quantity((1 * model.period) / 2, 's', 'time'),
      endTime: quantity((2 * model.period) / 2, 's', 'time'),
      outputSampleRate: 2,
    })
    expect(result.events.filter((event) => event.type === 'AcceleratingGapCrossing')).toHaveLength(2)
  })

  it('adds no protected crossings after their real cap, even for a long sparse analytic window', () => {
    const scene = cyclotronScene()
    const model = cyclotron.resolveCyclotronModel(scene)
    const { plan, result } = compareExecution(scene, {
      startTime: quantity(model.period * 300, 's', 'time'),
      endTime: quantity(100_000_000, 's', 'time'),
      outputSampleRate: 2,
      timeStep: quantity(1e-12, 's', 'time'),
    })
    expect(plan.storageSampleCountBound).toBe(2)
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(result.states).toHaveLength(2)
  })

  it('deduplicates the launch sample for a zero-width cyclotron window', () => {
    const { plan, result } = compareExecution(cyclotronScene(), {
      startTime: quantity(0, 'us', 'time'),
      endTime: quantity(0, 's', 'time'),
      outputSampleRate: 1024,
    })
    expect(plan.storageSampleCountBound).toBe(1)
    expect(result.states).toHaveLength(1)
  })

  it('does not run state evaluation, motion, decomposition, or sample generation while planning', () => {
    const engine = new CompositeEngine()
    const searches = vi.spyOn(phaseSearch, 'findCompositePhaseBoundary')
    const samples = vi.spyOn(physicsScene, 'trajectorySampleTimes')
    const motion = vi.spyOn(compositeCore, 'compositeMotionAt')
    const cyclotronMotion = vi.spyOn(cyclotron, 'cyclotronMotionAt')
    const simulate = vi.spyOn(engine, 'simulate')
    const stateAt = vi.spyOn(engine, 'stateAt')
    try {
      for (const scene of [uniformScene(), selectorScene(), cyclotronScene()]) {
        const request = { ...createCompositeSimulationRequest(scene, 'sim-plan-only', 'trace-plan-only'), options: {} }
        engine.prepareSimulationPlan(scene, request)
      }
      expect(searches).not.toHaveBeenCalled()
      expect(samples).not.toHaveBeenCalled()
      expect(motion).not.toHaveBeenCalled()
      expect(cyclotronMotion).not.toHaveBeenCalled()
      expect(simulate).not.toHaveBeenCalled()
      expect(stateAt).not.toHaveBeenCalled()
    } finally {
      searches.mockRestore()
      samples.mockRestore()
      motion.mockRestore()
      cyclotronMotion.mockRestore()
      simulate.mockRestore()
      stateAt.mockRestore()
    }
  })

  it('rejects stale requests and invalid windows consistently with simulate', () => {
    const engine = new CompositeEngine()
    const scene = uniformScene()
    const stale = createCompositeSimulationRequest(scene, 'sim-stale-plan', 'trace-stale-plan')
    stale.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, stale)).toThrow(/exact PhysicsScene revision/)
    expect(() => engine.simulate(scene, stale)).toThrow(/exact PhysicsScene revision/)
    const invalid = {
      ...createCompositeSimulationRequest(scene, 'sim-invalid-plan', 'trace-invalid-plan'),
      options: { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
    }
    expect(() => engine.prepareSimulationPlan(scene, invalid)).toThrow(/0 <= startTime <= endTime/)
    expect(() => engine.simulate(scene, invalid)).toThrow(/0 <= startTime <= endTime/)
  })
})
