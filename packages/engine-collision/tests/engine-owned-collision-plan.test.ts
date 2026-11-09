import { describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, type SimulationOptions } from '@physicsos/physics-core'
import { createCollisionScene, type CollisionSceneInput, type PhysicsScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asSceneId } from '@physicsos/shared'

import { CollisionEngine, createCollisionSimulationRequest } from '../src/collision-engine.ts'
import {
  collisionExecutionBounds,
  resolveCollisionScene,
  simulateCollision,
} from '../src/collision-solver.ts'
import * as collisionSolver from '../src/collision-solver.ts'

const variants: readonly { modelId: string; input: CollisionSceneInput }[] = [
  {
    modelId: 'elastic_collision',
    input: { bodies: [
      { id: 'a', mass: 1, position: [-2, 0], velocity: [2, 0], restitution: 1 },
      { id: 'b', mass: 2, position: [2, 0], velocity: [-1, 0], restitution: 1 },
    ] },
  },
  {
    modelId: 'perfectly_inelastic_collision',
    input: { bodies: [
      { id: 'a', mass: 1, position: [-2, 0], velocity: [2, 0], restitution: 0 },
      { id: 'b', mass: 2, position: [2, 0], velocity: [-1, 0], restitution: 0 },
    ] },
  },
  {
    modelId: 'inelastic_collision',
    input: { bodies: [
      { id: 'a', mass: 1, position: [-2, 0], velocity: [2, 0], restitution: 1 },
      { id: 'b', mass: 2, position: [2, 0], velocity: [-1, 0], restitution: 0.4 },
    ] },
  },
  {
    modelId: 'elastic_collision',
    input: {
      bodies: [
        { id: 'a', mass: 1, position: [-1.5, 0], velocity: [2, 0] },
        { id: 'b', mass: 1, position: [0, 0], velocity: [0, 0] },
        { id: 'c', mass: 1, position: [1.5, 0], velocity: [-2, 0] },
      ],
      boundary: { width: 8, height: 8 },
    },
  },
  {
    modelId: 'inelastic_collision',
    input: {
      bodies: [
        { id: 'a', mass: 1, position: [-2, 1], velocity: [1, 0], restitution: 0.8 },
        { id: 'b', mass: 1, position: [2, 1], velocity: [-1, 0], restitution: 0.8 },
      ],
      gravity: [0, -9.8],
      boundary: { width: 10, height: 10 },
      boundaryRestitution: 0.7,
    },
  },
]

const parity = (scene: PhysicsScene, options: SimulationOptions) => {
  const engine = new CollisionEngine()
  const request = createCollisionSimulationRequest(scene, 'collision-plan', 'collision-plan-trace')
  request.options = options
  const requestBefore = structuredClone(request)
  const sceneBefore = structuredClone(scene)
  const plan = engine.prepareSimulationPlan(scene, request)
  assertSimulationPlan(plan)
  expect(plan).toMatchObject({
    engineId: engine.engineId,
    engineVersion: engine.engineVersion,
    simulationId: request.simulationId,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    kind: 'iterative',
  })
  const result = engine.simulate(scene, request)
  expect(result.states).toHaveLength(plan.storageSampleCountBound)
  expect(result.states[0]!.time.value).toBeCloseTo(plan.startTime, 12)
  expect(result.states.at(-1)!.time.value).toBeCloseTo(plan.endTime, 12)
  expect(result.events.every((event) => event.time === undefined || (event.time >= plan.startTime && event.time <= plan.endTime))).toBe(true)
  const numerical = simulateCollision(resolveCollisionScene(scene), {
    startTime: plan.startTime,
    endTime: plan.endTime,
    outputSampleRate: request.options.outputSampleRate,
  })
  expect(numerical.states).toEqual(result.states)
  expect(numerical.numericalIterationCount).toBeLessThanOrEqual(plan.numericalIterationCountBound)
  expect(request).toEqual(requestBefore)
  expect(scene).toEqual(sceneBefore)
  return { plan, numerical }
}

describe('engine-owned collision plans and actual solver budgets', () => {
  it.each(variants)('plans all actual variants ($modelId), defaults included', ({ input, modelId }) => {
    const { plan } = parity(createCollisionScene(input), {})
    expect(plan.modelId).toBe(modelId)
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(10)
    expect(plan.storageSampleCountBound).toBe(1_024)
    expect(plan.numericalIterationCountBound).toBeGreaterThan(20_000)
  })

  it.each(variants)('preserves custom non-SI windows for $modelId and counts the discarded prefix', ({ input, modelId }) => {
    const { plan, numerical } = parity(createCollisionScene(input), {
      startTime: quantity(1_250, 'ms', 'time'),
      endTime: quantity(1_500, 'ms', 'time'),
      outputSampleRate: 7.9,
      timeStep: quantity(100, 'ms', 'time'),
      maxIterations: 1,
    })
    expect(plan.modelId).toBe(modelId)
    expect(plan.startTime).toBe(1.25)
    expect(plan.endTime).toBe(1.5)
    expect(plan.storageSampleCountBound).toBe(7)
    expect(numerical.numericalIterationCount).toBeGreaterThanOrEqual(2_500)
    const originScene = createCollisionScene(input)
    const originRequest = createCollisionSimulationRequest(originScene, 'origin-plan', 'origin-plan-trace')
    originRequest.options = { endTime: quantity(250, 'ms', 'time'), outputSampleRate: 7.9 }
    const originPlan = new CollisionEngine().prepareSimulationPlan(originScene, originRequest)
    expect(plan.numericalIterationCountBound).toBeGreaterThan(originPlan.numericalIterationCountBound)
  })

  it.each([
    { outputSampleRate: -1, expected: 2 },
    { outputSampleRate: 1, expected: 2 },
    { outputSampleRate: 3.9, expected: 3 },
    { outputSampleRate: 2_000, expected: 1_024 },
    { outputSampleRate: Number.NaN, expected: 13 },
    { outputSampleRate: Number.POSITIVE_INFINITY, expected: 13 },
  ])('retains capped count/fallback semantics for $outputSampleRate', ({ outputSampleRate, expected }) => {
    const { plan } = parity(createCollisionScene(variants[0]!.input), {
      endTime: quantity(100, 'ms', 'time'),
      outputSampleRate,
    })
    expect(plan.storageSampleCountBound).toBe(expected)
  })

  it('stores one zero-width sample but integrates its nonzero absolute prefix', () => {
    const { plan, numerical } = parity(createCollisionScene(variants[0]!.input), {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(250, 'ms', 'time'),
      outputSampleRate: 1_024,
    })
    expect(plan.storageSampleCountBound).toBe(1)
    expect(plan.numericalIterationCountBound).toBe(500 * (1 + 2 + 12 * (1 + 2 + 3) + 4 * 2))
    expect(numerical.numericalIterationCount).toBeGreaterThanOrEqual(500)
  })

  it('uses a real counted substep cap and accounts for all contact passes', () => {
    const scene = createCollisionScene(variants[3]!.input)
    const options = { startTime: 0.02, endTime: 0.2, outputSampleRate: 5, dt: 0.02, subDt: 0.001 }
    const bounds = collisionExecutionBounds(options, scene.bodies.length)
    const numerical = simulateCollision(resolveCollisionScene(scene), options)
    expect(bounds.numericalIterationsPerSubstepBound).toBe(1 + 3 + 12 * (1 + 3 + 3 * 3) + 4 * 3)
    expect(bounds.numericalIterationCountBound).toBe(bounds.substepCountBound * bounds.numericalIterationsPerSubstepBound)
    expect(numerical.numericalIterationCount).toBeLessThanOrEqual(bounds.numericalIterationCountBound)
    expect(numerical.numericalIterationCount).toBeGreaterThanOrEqual(bounds.substepCountBound)
    expect(numerical.states).toHaveLength(5)
    expect(numerical.states.at(-1)!.time.value).toBe(0.2)
  })

  it('pins exact first and last samples inside decimal windows', () => {
    const { plan, numerical } = parity(createCollisionScene(variants[0]!.input), {
      endTime: quantity(0.1, 's', 'time'),
      outputSampleRate: 4,
    })
    expect(numerical.states[0]!.time.value).toBe(plan.startTime)
    expect(numerical.states.at(-1)!.time.value).toBe(0.1)
    expect(numerical.states.every((state) => state.time.value >= plan.startTime && state.time.value <= plan.endTime)).toBe(true)
  })

  it('budgets every body-pair inspection for a large sparse scene without running the solver', () => {
    const bodyCount = 1_000
    const scene = createCollisionScene({ bodies: Array.from({ length: bodyCount }, (_, index) => ({
      id: `body-${index}`,
      mass: 1,
      position: [index * 2, 0] as [number, number],
      velocity: [0, 0] as [number, number],
    })) })
    const request = createCollisionSimulationRequest(scene, 'large-pair-budget', 'large-pair-budget-trace')
    request.options = { endTime: quantity(0.1, 's', 'time'), outputSampleRate: 2 }
    const solverSpy = vi.spyOn(collisionSolver, 'simulateCollision').mockImplementation(() => { throw new Error('solver forbidden') })
    const resolveSpy = vi.spyOn(collisionSolver, 'resolveCollisionScene').mockImplementation(() => { throw new Error('mutable bodies forbidden') })
    try {
      const plan = new CollisionEngine().prepareSimulationPlan(scene, request)
      const pairCount = bodyCount * (bodyCount - 1) / 2
      expect(plan.storageSampleCountBound).toBe(2)
      expect(plan.numericalIterationCountBound).toBeGreaterThanOrEqual(200 * pairCount)
      expect(plan.numericalIterationCountBound).toBeGreaterThan(1_000_000)
      expect(plan.metadata?.bodyCount).toBe(bodyCount)
      expect(solverSpy).not.toHaveBeenCalled()
      expect(resolveSpy).not.toHaveBeenCalled()
    } finally {
      solverSpy.mockRestore()
      resolveSpy.mockRestore()
    }
  })

  it('counts all pair inspections in the actual no-contact solver, not just convergence passes', () => {
    const bodyCount = 30
    const scene = createCollisionScene({ bodies: Array.from({ length: bodyCount }, (_, index) => ({
      id: `body-${index}`,
      mass: 1,
      position: [index * 2, 0] as [number, number],
      velocity: [0, 0] as [number, number],
    })) })
    const options = { endTime: 0.01, outputSampleRate: 2 }
    const bounds = collisionExecutionBounds(options, bodyCount)
    const numerical = simulateCollision(resolveCollisionScene(scene), options)
    const pairCount = bodyCount * (bodyCount - 1) / 2
    // No overlap: each substep executes one pass, every body and every pair.
    expect(numerical.numericalIterationCount).toBe(bounds.substepCountBound * (2 + 2 * bodyCount + pairCount))
    expect(numerical.numericalIterationCount).toBeLessThanOrEqual(bounds.numericalIterationCountBound)
  })

  it('keeps sparse long collision windows costly without mutating host-sized requests', () => {
    const scene = createCollisionScene(variants[0]!.input)
    const engine = new CollisionEngine()
    const request = createCollisionSimulationRequest(scene, 'long-collision', 'long-collision-trace')
    request.options = {
      startTime: quantity(1_000_000, 's', 'time'),
      endTime: quantity(1_000_000.001, 's', 'time'),
      outputSampleRate: 2,
      maxIterations: 1,
    }
    const before = structuredClone(request)
    const plan = engine.prepareSimulationPlan(scene, request)
    assertSimulationPlan(plan)
    expect(plan.startTime).toBe(1_000_000)
    expect(plan.endTime).toBe(1_000_000.001)
    expect(plan.storageSampleCountBound).toBe(2)
    expect(plan.numericalIterationCountBound).toBeGreaterThan(2_000_000_000)
    expect(request).toEqual(before)
  })

  it('plans without resolving mutable solver bodies, simulating or evaluating states', () => {
    const scene = createCollisionScene(variants[0]!.input)
    const engine = new CollisionEngine()
    const request = createCollisionSimulationRequest(scene, 'pure-collision', 'pure-collision-trace')
    const simulateSpy = vi.spyOn(engine, 'simulate').mockImplementation(() => { throw new Error('simulate forbidden') })
    const stateSpy = vi.spyOn(engine, 'stateAt').mockImplementation(() => { throw new Error('stateAt forbidden') })
    const solverSpy = vi.spyOn(collisionSolver, 'simulateCollision').mockImplementation(() => { throw new Error('solver forbidden') })
    const resolveSpy = vi.spyOn(collisionSolver, 'resolveCollisionScene').mockImplementation(() => { throw new Error('mutable bodies forbidden') })
    try {
      const plan = engine.prepareSimulationPlan(scene, request)
      expect(plan.storageSampleCountBound).toBe(1_024)
      expect(simulateSpy).not.toHaveBeenCalled()
      expect(stateSpy).not.toHaveBeenCalled()
      expect(solverSpy).not.toHaveBeenCalled()
      expect(resolveSpy).not.toHaveBeenCalled()
    } finally {
      simulateSpy.mockRestore()
      stateSpy.mockRestore()
      solverSpy.mockRestore()
      resolveSpy.mockRestore()
    }
  })

  it.each([
    { startTime: quantity(-1, 's', 'time') },
    { startTime: { value: Number.NaN, unit: 's', dimension: 'time' as const } },
    { endTime: { value: Number.POSITIVE_INFINITY, unit: 's', dimension: 'time' as const } },
    { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
    { startTime: quantity(11, 's', 'time') },
  ])('rejects invalid accepted ranges before planning and simulation', (options) => {
    const scene = createCollisionScene(variants[0]!.input)
    const engine = new CollisionEngine()
    const request = createCollisionSimulationRequest(scene, 'bad-collision', 'bad-collision-trace')
    request.options = options
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
    expect(() => engine.simulate(scene, request)).toThrow()
  })

  it('validates empty simulation identity directly in the pure planner', () => {
    const scene = createCollisionScene(variants[0]!.input)
    const request = createCollisionSimulationRequest(scene, '', 'empty-collision-trace')
    expect(() => new CollisionEngine().prepareSimulationPlan(scene, request)).toThrow(/invalid simulation bounds/)
  })

  it.each(['sceneId', 'sceneRevision'] as const)('rejects mismatched %s identically', (field) => {
    const scene = createCollisionScene(variants[0]!.input)
    const engine = new CollisionEngine()
    const request = createCollisionSimulationRequest(scene, 'mismatch-collision', 'mismatch-collision-trace')
    if (field === 'sceneId') request.sceneId = asSceneId('another-scene')
    else request.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow(/exact PhysicsScene revision/)
    expect(() => engine.simulate(scene, request)).toThrow(/exact PhysicsScene revision/)
  })

  it('rejects unrepresentable counts and invalid actual solver steps, never inventing a policy clamp', () => {
    expect(() => collisionExecutionBounds({ endTime: Number.MAX_VALUE, outputSampleRate: 2 }, 2)).toThrow(/integer step/)
    expect(() => collisionExecutionBounds({ dt: 0 }, 2)).toThrow(/positive finite/)
    expect(() => collisionExecutionBounds({ subDt: Number.NaN }, 2)).toThrow(/positive finite/)
    expect(() => collisionExecutionBounds({ subDt: -1 }, 2)).toThrow(/positive finite/)
    expect(() => collisionExecutionBounds({ endTime: 0.1 }, Number.MAX_SAFE_INTEGER)).toThrow(/integer step/)
  })
})
