import { describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, type SimulationOptions } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import * as physicsScene from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'

import {
  ELECTRIC_REGION_ENGINE_ID,
  ELECTRIC_REGION_ENGINE_VERSION,
  PARALLEL_PLATE_MODEL,
  ElectricRegionEngine,
  createElectricRegionSimulationRequest,
} from '../src/electric-region-engine.ts'

const NOW = '2026-11-08T00:00:00.000Z'
const passingScene = () => physicsScene.createParallelPlateScene({
  charge: 1,
  mass: 1,
  position: vec3(-2, 0, 0),
  velocity: vec3(1, 0, 0),
  electricFieldStrength: 1,
  electricFieldDirection: 'up',
  plateSeparation: 10,
  plateLength: 2,
  duration: 5,
  now: NOW,
})
const hitScene = () => physicsScene.createParallelPlateScene({
  charge: 1,
  mass: 1,
  position: vec3(-2, 0, 0),
  velocity: vec3(1, 0, 0),
  electricFieldStrength: 10,
  electricFieldDirection: 'up',
  plateSeparation: 2,
  plateLength: 2,
  duration: 5,
  now: NOW,
})

const compareExecution = (
  scene: physicsScene.PhysicsScene,
  options: SimulationOptions = {},
) => {
  const engine = new ElectricRegionEngine()
  const request = {
    ...createElectricRegionSimulationRequest(scene, 'sim-region-plan', 'trace-region-plan'),
    options,
  }
  const original = structuredClone(request)
  Object.freeze(request.options)
  Object.freeze(request)
  const plan = engine.prepareSimulationPlan(scene, request)
  assertSimulationPlan(plan)
  expect(plan).toMatchObject({
    schemaVersion: 'simulation-plan/1.0',
    engineId: ELECTRIC_REGION_ENGINE_ID,
    engineVersion: ELECTRIC_REGION_ENGINE_VERSION,
    simulationId: request.simulationId,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    modelId: PARALLEL_PLATE_MODEL,
    kind: 'analytic',
    numericalIterationCountBound: 0,
  })
  expect(request).toEqual(original)
  const result = engine.simulate(scene, request)
  expect(result.states.length).toBe(plan.storageSampleCountBound)
  expect(canonicalValue(result.states[0]!.time)).toBeCloseTo(plan.startTime, 15)
  expect(canonicalValue(result.states.at(-1)!.time)).toBeCloseTo(plan.endTime, 15)
  expect(canonicalValue(result.states.at(-1)!.time) - canonicalValue(result.states[0]!.time))
    .toBeCloseTo(plan.endTime - plan.startTime, 15)
  expect(result.metadata.solver).toBe('analytical-bounded-electric')
  expect(request).toEqual(original)
  return { plan, result }
}

describe('ElectricRegionEngine.prepareSimulationPlan', () => {
  it('uses the actual timeline duration and 121-state default with options={}', () => {
    const { plan, result } = compareExecution(passingScene())
    expect(plan.endTime).toBe(5)
    expect(plan.storageSampleCountBound).toBe(121)
    expect(result.events.map((event) => event.type)).toEqual(['EnterField', 'ExitField'])
  })

  it('uses the engine 1e-8-second fallback only when the scene omits its end', () => {
    const scene = physicsScene.createParallelPlateScene({ now: NOW })
    delete scene.timeline.endTime
    const { plan } = compareExecution(scene)
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(1e-8)
    expect(plan.storageSampleCountBound).toBe(121)
  })

  it('canonicalizes a timeline end expressed in microseconds', () => {
    const scene = physicsScene.createParallelPlateScene({ now: NOW })
    scene.timeline.endTime = quantity(0.008, 'us', 'time')
    expect(compareExecution(scene).plan.endTime).toBeCloseTo(8e-9, 18)
  })

  it('canonicalizes explicit non-SI endpoints and counts samples rather than hertz', () => {
    const { plan, result } = compareExecution(passingScene(), {
      startTime: quantity(500, 'ms', 'time'),
      endTime: quantity(4500, 'ms', 'time'),
      outputSampleRate: 3.9,
      timeStep: quantity(1e-12, 's', 'time'),
      maxIterations: 1,
    })
    expect(plan.startTime).toBe(0.5)
    expect(plan.endTime).toBe(4.5)
    expect(plan.storageSampleCountBound).toBe(3)
    expect(result.events.map((event) => event.type)).toEqual(['EnterField', 'ExitField'])
  })

  it('keeps crossing events without inventing extra stored samples for the analytic region model', () => {
    const { plan, result } = compareExecution(passingScene(), { outputSampleRate: 2 })
    expect(plan.storageSampleCountBound).toBe(2)
    expect(result.states).toHaveLength(2)
    expect(result.events).toHaveLength(2)
  })

  it('has the same bounded analytic storage when a particle strikes a plate', () => {
    const { plan, result } = compareExecution(hitScene(), { outputSampleRate: 5 })
    expect(plan.storageSampleCountBound).toBe(5)
    expect(result.events.map((event) => event.type)).toEqual(['EnterField', 'HitPlate'])
  })

  it('accepts a very long sparse window without an ODE-step budget', () => {
    const { plan } = compareExecution(passingScene(), {
      startTime: quantity(1, 's', 'time'),
      endTime: quantity(100_000_000, 's', 'time'),
      timeStep: quantity(1e-12, 's', 'time'),
      outputSampleRate: 2,
    })
    expect(plan.storageSampleCountBound).toBe(2)
    expect(plan.endTime).toBe(100_000_000)
    expect(plan.numericalIterationCountBound).toBe(0)
  })

  it.each([
    { requested: 0, count: 2 },
    { requested: -10, count: 2 },
    { requested: 1_000_000, count: 1024 },
    { requested: Number.NaN, count: 121 },
    { requested: Number.POSITIVE_INFINITY, count: 121 },
  ])('uses actual capped/default count for outputSampleRate=$requested', ({ requested, count }) => {
    expect(compareExecution(passingScene(), { outputSampleRate: requested }).plan.storageSampleCountBound)
      .toBe(count)
  })

  it('retains duplicate samples for a zero-width window instead of assuming Set semantics', () => {
    const { plan, result } = compareExecution(passingScene(), {
      startTime: quantity(2000, 'ms', 'time'),
      endTime: quantity(2, 's', 'time'),
      outputSampleRate: 7,
    })
    expect(plan.storageSampleCountBound).toBe(7)
    expect(result.states.every((state) => canonicalValue(state.time) === 2)).toBe(true)
  })

  it('does not simulate, evaluate states, or allocate trajectory samples during planning', () => {
    const scene = passingScene()
    const request = { ...createElectricRegionSimulationRequest(scene, 'sim-plan-only', 'trace-plan-only'), options: {} }
    const engine = new ElectricRegionEngine()
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

  it('rejects stale requests and reversed windows exactly as execution does', () => {
    const engine = new ElectricRegionEngine()
    const scene = passingScene()
    const stale = createElectricRegionSimulationRequest(scene, 'sim-stale-plan', 'trace-stale-plan')
    stale.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, stale)).toThrow(/exact PhysicsScene revision/)
    expect(() => engine.simulate(scene, stale)).toThrow(/exact PhysicsScene revision/)
    const invalid = {
      ...createElectricRegionSimulationRequest(scene, 'sim-invalid-plan', 'trace-invalid-plan'),
      options: { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
    }
    expect(() => engine.prepareSimulationPlan(scene, invalid)).toThrow(/0 <= startTime <= endTime/)
    expect(() => engine.simulate(scene, invalid)).toThrow(/0 <= startTime <= endTime/)
  })
})
