import { describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, type SimulationOptions } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import * as physicsScene from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'

import {
  ELECTRIC_ENGINE_ID,
  ELECTRIC_ENGINE_VERSION,
  ElectricEngine,
  UNIFORM_ELECTRIC_PARTICLE_MODEL,
  createElectricSimulationRequest,
} from '../src/electric-engine.ts'
import { POINT_CHARGE_MODEL } from '../src/point-charge-model.ts'

const NOW = '2026-11-08T00:00:00.000Z'

const compareExecution = (
  scene: physicsScene.PhysicsScene,
  options: SimulationOptions = {},
) => {
  const engine = new ElectricEngine()
  const request = {
    ...createElectricSimulationRequest(scene, 'sim-electric-plan', 'trace-electric-plan'),
    options,
  }
  const original = structuredClone(request)
  Object.freeze(request.options)
  Object.freeze(request)
  const plan = engine.prepareSimulationPlan(scene, request)
  assertSimulationPlan(plan)
  expect(request).toEqual(original)
  expect(plan).toMatchObject({
    schemaVersion: 'simulation-plan/1.0',
    engineId: ELECTRIC_ENGINE_ID,
    engineVersion: ELECTRIC_ENGINE_VERSION,
    simulationId: request.simulationId,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    numericalIterationCountBound: 0,
  })

  const result = engine.simulate(scene, request)
  expect(result.states.length).toBeLessThanOrEqual(plan.storageSampleCountBound)
  expect(result.states.length).toBe(plan.storageSampleCountBound)
  expect(canonicalValue(result.states[0]!.time)).toBeCloseTo(plan.startTime, 12)
  expect(canonicalValue(result.states.at(-1)!.time)).toBeCloseTo(
    plan.kind === 'static' ? plan.startTime : plan.endTime,
    12,
  )
  if (plan.kind !== 'static') {
    expect(canonicalValue(result.states.at(-1)!.time) - canonicalValue(result.states[0]!.time))
      .toBeCloseTo(plan.endTime - plan.startTime, 12)
  }
  expect(result.metadata.solver).toMatch(/^analytical-/)
  expect(request).toEqual(original)
  return { plan, result }
}

const staticScene = (withProbe = false) => physicsScene.createPointChargeScene({
  charges: [{ id: 'source-1', charge: 5e-6, position: vec3(0, 0, 0) }],
  ...(withProbe
    ? { probe: { id: 'probe-1', mass: 1, charge: 1e-9, position: vec3(0.2, 0, 0) } }
    : {}),
  now: NOW,
})

describe('ElectricEngine.prepareSimulationPlan', () => {
  it('uses the moving particle model default with options={}', () => {
    const scene = physicsScene.createElectricScene({
      charge: 1,
      mass: 1,
      velocity: vec3(2, 0, 0),
      electricFieldStrength: 1,
      now: NOW,
    })
    expect(scene.timeline.endTime).toBeUndefined()
    const { plan } = compareExecution(scene)
    expect(plan.kind).toBe('analytic')
    expect(plan.modelId).toBe(UNIFORM_ELECTRIC_PARTICLE_MODEL)
    expect(plan.endTime).toBe(0.5)
    expect(plan.storageSampleCountBound).toBe(121)
  })

  it('uses the accelerated-from-rest default instead of a fixed macroscopic span', () => {
    const scene = physicsScene.createElectricScene({
      charge: 1.6e-19,
      mass: 1.67e-27,
      velocity: vec3(0, 0, 0),
      electricFieldStrength: 2000,
      electricFieldDirection: 'right',
      now: NOW,
    })
    const { plan } = compareExecution(scene)
    expect(plan.endTime).toBeCloseTo(Math.sqrt((2 * 1.67e-27) / (1.6e-19 * 2000)), 18)
  })

  it('keeps the real five-second fallback when the particle has no motion scale', () => {
    const scene = physicsScene.createElectricScene({
      charge: 0,
      mass: 1,
      velocity: vec3(0, 0, 0),
      electricFieldStrength: 1,
      now: NOW,
    })
    expect(compareExecution(scene).plan.endTime).toBe(5)
  })

  it('takes an omitted request end from the canonical scene timeline', () => {
    const scene = physicsScene.createElectricScene({ now: NOW })
    scene.timeline.endTime = quantity(3000, 'ms', 'time')
    expect(compareExecution(scene).plan.endTime).toBe(3)
  })

  it('accepts a sparse long analytic window without treating timeStep as solver work', () => {
    const scene = physicsScene.createElectricScene({
      charge: 1,
      mass: 1,
      electricFieldStrength: 1,
      velocity: vec3(1, 0, 0),
      now: NOW,
    })
    const { plan } = compareExecution(scene, {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(100_000_000, 's', 'time'),
      timeStep: quantity(1e-12, 's', 'time'),
      maxIterations: 1,
      outputSampleRate: 3,
    })
    expect(plan.startTime).toBe(0.25)
    expect(plan.endTime).toBe(100_000_000)
    expect(plan.storageSampleCountBound).toBe(3)
    expect(plan.numericalIterationCountBound).toBe(0)
  })

  it('canonicalizes a custom non-SI window and floors the requested sample count', () => {
    const { plan } = compareExecution(physicsScene.createElectricScene({ now: NOW }), {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(1250, 'ms', 'time'),
      outputSampleRate: 7.9,
    })
    expect(plan.startTime).toBe(0.25)
    expect(plan.endTime).toBe(1.25)
    expect(plan.storageSampleCountBound).toBe(7)
  })

  it.each([
    { requested: 1, count: 2 },
    { requested: -10, count: 2 },
    { requested: 1_000_000, count: 1024 },
    { requested: Number.NaN, count: 121 },
    { requested: Number.POSITIVE_INFINITY, count: 121 },
  ])('uses actual storage cap/default for outputSampleRate=$requested', ({ requested, count }) => {
    const { plan } = compareExecution(physicsScene.createElectricScene({ now: NOW }), {
      endTime: quantity(1, 's', 'time'),
      outputSampleRate: requested,
    })
    expect(plan.storageSampleCountBound).toBe(count)
  })

  it('preserves duplicate array samples for an accepted zero-width analytic window', () => {
    const { plan, result } = compareExecution(physicsScene.createElectricScene({ now: NOW }), {
      startTime: quantity(500, 'ms', 'time'),
      endTime: quantity(500, 'ms', 'time'),
      outputSampleRate: 5,
    })
    expect(plan.storageSampleCountBound).toBe(5)
    expect(result.states.every((state) => canonicalValue(state.time) === 0.5)).toBe(true)
  })

  it.each([false, true])('plans the static point-charge model with probe=$0', (withProbe) => {
    const { plan } = compareExecution(staticScene(withProbe))
    expect(plan.kind).toBe('static')
    expect(plan.modelId).toBe(POINT_CHARGE_MODEL)
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(0)
    expect(plan.storageSampleCountBound).toBe(1)
  })

  it('retains an explicit static end even though the model stores one instantaneous state', () => {
    const { plan } = compareExecution(staticScene(true), {
      startTime: quantity(500, 'ms', 'time'),
      endTime: quantity(7500, 'ms', 'time'),
      outputSampleRate: 1_000_000,
    })
    expect(plan.startTime).toBe(0.5)
    expect(plan.endTime).toBe(7.5)
    expect(plan.storageSampleCountBound).toBe(1)
  })

  it('uses the requested static start as its omitted-end default', () => {
    const { plan } = compareExecution(staticScene(), { startTime: quantity(2, 's', 'time') })
    expect(plan.startTime).toBe(2)
    expect(plan.endTime).toBe(2)
  })

  it('does not simulate, evaluate state, or generate trajectory times while planning', () => {
    const scene = physicsScene.createElectricScene({ now: NOW })
    const request = { ...createElectricSimulationRequest(scene, 'sim-plan-only', 'trace-plan-only'), options: {} }
    const engine = new ElectricEngine()
    const samples = vi.spyOn(physicsScene, 'trajectorySampleTimes')
    const simulate = vi.spyOn(engine, 'simulate')
    const stateAt = vi.spyOn(engine, 'stateAt')
    try {
      engine.prepareSimulationPlan(scene, request)
      expect(samples).not.toHaveBeenCalled()
      expect(simulate).not.toHaveBeenCalled()
      expect(stateAt).not.toHaveBeenCalled()
    } finally {
      samples.mockRestore()
      simulate.mockRestore()
      stateAt.mockRestore()
    }
  })

  it('rejects the same stale scene and invalid range in planning and execution', () => {
    const engine = new ElectricEngine()
    const scene = physicsScene.createElectricScene({ now: NOW })
    const stale = createElectricSimulationRequest(scene, 'sim-stale-plan', 'trace-stale-plan')
    stale.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, stale)).toThrow(/exact PhysicsScene revision/)
    expect(() => engine.simulate(scene, stale)).toThrow(/exact PhysicsScene revision/)
    const invalid = {
      ...createElectricSimulationRequest(scene, 'sim-invalid-plan', 'trace-invalid-plan'),
      options: { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
    }
    expect(() => engine.prepareSimulationPlan(scene, invalid)).toThrow(/0 <= startTime <= endTime/)
    expect(() => engine.simulate(scene, invalid)).toThrow(/0 <= startTime <= endTime/)
  })
})
