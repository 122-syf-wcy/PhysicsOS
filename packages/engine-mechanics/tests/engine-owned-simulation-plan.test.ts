import { describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, quantityVector, type SimulationOptions } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import {
  createMechanicalEnergyScene,
  createMechanicsScene,
  createRampFrictionScene,
  type MechanicsSceneInput,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asSceneId, asSimulationId } from '@physicsos/shared'

import { EnergyEngine, createEnergySimulationRequest } from '../src/energy-engine.ts'
import { MechanicsEngine, createMechanicsSimulationRequest } from '../src/mechanics-engine.ts'
import { resolveMechanicsModel } from '../src/mechanics-model-selector.ts'
import * as kinematics from '../src/solvers/analytical-kinematics.ts'
import * as inclineMotion from '../src/solvers/incline-motion.ts'

const mechanicsVariants: readonly MechanicsSceneInput[] = [
  { model: 'uniform_linear_motion', velocity: vec3(3, 0, 0) },
  { model: 'uniformly_accelerated_motion', velocity: vec3(2, 0, 0), acceleration: vec3(1, 0, 0) },
  { model: 'projectile_motion', position: vec3(0, 20, 0), velocity: vec3(8, 0, 0) },
  { model: 'projectile_motion', velocity: vec3(8, 6, 0) },
  { model: 'projectile_motion', velocity: vec3(0, 0, 0) },
  { model: 'newton_second_law', mass: 2, appliedForce: vec3(4, 0, 0) },
  { model: 'inclined_plane', inclineAngle: 30, frictionCoefficient: 0 },
  { model: 'inclined_plane', inclineAngle: 30, frictionCoefficient: 0.2, velocity: vec3(-1, 0, 0) },
  { model: 'spring_oscillator', springConstant: 12, mass: 3, position: vec3(0.25, 0, 0) },
  { model: 'simple_pendulum', pendulumLength: 2 },
  { model: 'horizontal_friction', appliedForceRamp: 3 },
  { model: 'horizontal_friction', appliedForceRamp: 0, appliedForce: vec3(0, 0, 0) },
  { model: 'horizontal_friction', appliedForceRamp: 0, velocity: vec3(1, 0, 0) },
  { model: 'spring_statics', springConstant: 20 },
  { model: 'circular_orbit', gravitationalParameter: 32, orbitRadius: 2 },
]

const expectedMechanicsDuration = (scene: PhysicsScene): number => {
  const model = resolveMechanicsModel(scene)
  switch (model.modelId) {
    case 'projectile_motion': return model.flightTime > 0 ? model.flightTime : 10
    case 'circular_orbit': return model.period
    case 'spring_oscillator':
    case 'simple_pendulum': return 2 * model.period
    case 'horizontal_friction':
      return Number.isFinite(model.slipTime)
        ? model.slipTime + 3
        : model.forceRamp > 0 ? (model.maxForce - model.initialForce) / model.forceRamp + 1 : 6
    case 'spring_statics': return 4
    default: return 10
  }
}

const mechanicsParity = (scene: PhysicsScene, options: SimulationOptions) => {
  const engine = new MechanicsEngine()
  const request = createMechanicsSimulationRequest(scene, 'mechanics-plan', 'mechanics-plan-trace')
  request.options = options
  const requestBefore = structuredClone(request)
  const sceneBefore = structuredClone(scene)
  const plan = engine.prepareSimulationPlan(scene, request)
  assertSimulationPlan(plan)
  expect(plan).toMatchObject({
    schemaVersion: 'simulation-plan/1.0',
    engineId: engine.engineId,
    engineVersion: engine.engineVersion,
    simulationId: request.simulationId,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    modelId: resolveMechanicsModel(scene).modelId,
    numericalIterationCountBound: 0,
  })
  expect(plan.kind).toBe(plan.modelId === 'spring_statics' ? 'static' : 'analytic')
  const result = engine.simulate(scene, request)
  expect(result.states).toHaveLength(plan.storageSampleCountBound)
  expect(result.states[0]!.time.value).toBeCloseTo(plan.startTime, 12)
  expect(result.states.at(-1)!.time.value).toBeCloseTo(plan.endTime, 12)
  expect(request).toEqual(requestBefore)
  expect(scene).toEqual(sceneBefore)
  return plan
}

describe('engine-owned mechanics simulation plans', () => {
  it.each(mechanicsVariants)('uses the actual $model default duration and storage count', (input) => {
    const scene = createMechanicsScene(input)
    const plan = mechanicsParity(scene, {})
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(expectedMechanicsDuration(scene))
    expect(plan.storageSampleCountBound).toBe(65)
  })

  it.each(mechanicsVariants)('keeps canonical custom windows for $model', (input) => {
    const plan = mechanicsParity(createMechanicsScene(input), {
      startTime: quantity(125, 'ms', 'time'),
      endTime: quantity(500, 'ms', 'time'),
      outputSampleRate: 7.9,
      timeStep: quantity(1, 'ms', 'time'),
      maxIterations: 1,
    })
    expect(plan.startTime).toBe(0.125)
    expect(plan.endTime).toBe(0.5)
    expect(plan.storageSampleCountBound).toBe(7)
  })

  it.each([
    { outputSampleRate: -5, expected: 2 },
    { outputSampleRate: 0, expected: 2 },
    { outputSampleRate: 1, expected: 2 },
    { outputSampleRate: 2.9, expected: 2 },
    { outputSampleRate: 2_048, expected: 1_024 },
    { outputSampleRate: Number.NaN, expected: 65 },
    { outputSampleRate: Number.POSITIVE_INFINITY, expected: 65 },
  ])('uses existing count capping/fallback for $outputSampleRate, not Hz', ({ outputSampleRate, expected }) => {
    const plan = mechanicsParity(createMechanicsScene({ model: 'uniform_linear_motion' }), {
      endTime: quantity(2, 's', 'time'),
      outputSampleRate,
    })
    expect(plan.storageSampleCountBound).toBe(expected)
  })

  it('preserves the existing duplicate samples in a zero-width window', () => {
    const plan = mechanicsParity(createMechanicsScene({ model: 'uniform_linear_motion' }), {
      startTime: quantity(3, 's', 'time'),
      endTime: quantity(3, 's', 'time'),
      outputSampleRate: 5,
    })
    expect(plan.storageSampleCountBound).toBe(5)
    expect(plan.startTime).toBe(plan.endTime)
  })

  it.each(['spring_oscillator', 'simple_pendulum', 'circular_orbit'] as const)(
    'allows a sparse long %s analytic window with zero numerical iterations',
    (model) => {
      const plan = mechanicsParity(createMechanicsScene({ model }), {
        startTime: quantity(1_000_000, 's', 'time'),
        endTime: quantity(1_000_060, 's', 'time'),
        outputSampleRate: 3,
        timeStep: quantity(1e-9, 's', 'time'),
        maxIterations: 1,
      })
      expect(plan.startTime).toBe(1_000_000)
      expect(plan.endTime).toBe(1_000_060)
      expect(plan.storageSampleCountBound).toBe(3)
      expect(plan.numericalIterationCountBound).toBe(0)
    },
  )

  it('resolves non-SI body facts using the same model as simulate', () => {
    const original = createMechanicsScene({ model: 'uniform_linear_motion', velocity: vec3(20, 0, 0) })
    const scene: PhysicsScene = {
      ...original,
      bodies: original.bodies.map((body) => ({
        ...body,
        mass: quantity(1_000, 'g', 'mass'),
        position: quantityVector(vec3(100, 0, 0), 'cm', 'length'),
        velocity: quantityVector(vec3(72, 0, 0), 'km/h', 'velocity'),
      })),
    }
    mechanicsParity(scene, {
      startTime: quantity(1, 's', 'time'),
      endTime: quantity(2, 's', 'time'),
      outputSampleRate: 3,
    })
  })

  it('uses declared timeline end only when the request creator copies it', () => {
    const scene = createMechanicsScene({ model: 'spring_oscillator', endTime: 0.75 })
    const engine = new MechanicsEngine()
    const request = createMechanicsSimulationRequest(scene, 'declared-end', 'declared-end-trace')
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan.endTime).toBe(0.75)
    request.options = {}
    expect(engine.prepareSimulationPlan(scene, request).endTime).toBe(expectedMechanicsDuration(scene))
  })

  it('plans without evaluating states, kinematics or incline trajectories', () => {
    const engine = new MechanicsEngine()
    const simulateSpy = vi.spyOn(engine, 'simulate').mockImplementation(() => { throw new Error('simulate forbidden') })
    const stateSpy = vi.spyOn(engine, 'stateAt').mockImplementation(() => { throw new Error('stateAt forbidden') })
    const kinematicsSpy = vi.spyOn(kinematics, 'kinematicsAt').mockImplementation(() => { throw new Error('kinematics forbidden') })
    const inclineSpy = vi.spyOn(inclineMotion, 'inclineStateAt').mockImplementation(() => { throw new Error('incline forbidden') })
    try {
      for (const input of mechanicsVariants) {
        const scene = createMechanicsScene(input)
        engine.prepareSimulationPlan(scene, createMechanicsSimulationRequest(scene, 'pure-plan', 'pure-plan-trace'))
      }
      expect(simulateSpy).not.toHaveBeenCalled()
      expect(stateSpy).not.toHaveBeenCalled()
      expect(kinematicsSpy).not.toHaveBeenCalled()
      expect(inclineSpy).not.toHaveBeenCalled()
    } finally {
      simulateSpy.mockRestore()
      stateSpy.mockRestore()
      kinematicsSpy.mockRestore()
      inclineSpy.mockRestore()
    }
  })

  it.each([
    { startTime: quantity(-1, 's', 'time') },
    { startTime: { value: Number.NaN, unit: 's', dimension: 'time' as const } },
    { endTime: { value: Number.POSITIVE_INFINITY, unit: 's', dimension: 'time' as const } },
    { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
  ])('rejects the same invalid range before planning or simulation', (options) => {
    const scene = createMechanicsScene({ model: 'uniform_linear_motion' })
    const engine = new MechanicsEngine()
    const request = createMechanicsSimulationRequest(scene, 'invalid-plan', 'invalid-plan-trace')
    request.options = options
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
    expect(() => engine.simulate(scene, request)).toThrow()
  })

  it('rejects empty simulation IDs and unsafe revisions directly in prepare', () => {
    const scene = createMechanicsScene({ model: 'uniform_linear_motion' })
    const engine = new MechanicsEngine()
    const request = createMechanicsSimulationRequest(scene, 'identity-plan', 'identity-plan-trace')
    request.simulationId = asSimulationId('')
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow(/invalid simulation bounds/)
    request.simulationId = asSimulationId('valid-plan')
    const unsafeScene = { ...scene, revision: Number.MAX_SAFE_INTEGER + 1 }
    request.sceneRevision = unsafeScene.revision
    expect(() => engine.prepareSimulationPlan(unsafeScene, request)).toThrow(/invalid simulation bounds/)
  })

  it.each(['sceneId', 'sceneRevision'] as const)('rejects mismatched %s before planning', (field) => {
    const scene = createMechanicsScene({ model: 'uniform_linear_motion' })
    const engine = new MechanicsEngine()
    const request = createMechanicsSimulationRequest(scene, 'mismatch', 'mismatch-trace')
    if (field === 'sceneId') request.sceneId = asSceneId('another-scene')
    else request.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow(/exact PhysicsScene revision/)
    expect(() => engine.simulate(scene, request)).toThrow(/exact PhysicsScene revision/)
  })
})

describe('engine-owned moving energy simulation plans', () => {
  const energyScenes = [
    { label: 'smooth', create: () => createMechanicalEnergyScene() },
    { label: 'rough', create: () => createRampFrictionScene() },
    { label: 'custom', create: () => createRampFrictionScene({ mass: 3, releaseHeight: 120, inclineAngle: 60, frictionCoefficient: 0.1 }) },
  ]

  it.each(energyScenes)('budgets every $label motion state for default and non-SI custom windows', ({ create }) => {
    const scene = create()
    const engine = new EnergyEngine()
    for (const options of [
      {},
      { startTime: quantity(500, 'ms', 'time') },
      { startTime: quantity(1, 'min', 'time'), endTime: quantity(2, 'min', 'time'), outputSampleRate: 500 },
    ]) {
      const request = createEnergySimulationRequest(scene, 'energy-plan', 'energy-plan-trace')
      request.options = options
      const before = structuredClone(request)
      const plan = engine.prepareSimulationPlan(scene, request)
      assertSimulationPlan(plan)
      const samples = options.outputSampleRate ?? 65
      expect(plan).toMatchObject({ kind: 'analytic', modelId: 'mechanical_energy_ledger', storageSampleCountBound: samples, numericalIterationCountBound: 0 })
      const result = engine.simulate(scene, request)
      expect(result.states).toHaveLength(samples)
      expect(result.states[0]!.time.value).toBe(plan.startTime)
      expect(result.states.at(-1)?.time.value).toBe(plan.endTime)
      expect(result.events.every((event) => event.time === undefined || (event.time >= plan.startTime && event.time <= plan.endTime))).toBe(true)
      expect(request).toEqual(before)
    }
  })

  it('retains the whole requested range without invoking simulation or state evaluation', () => {
    const scene = createMechanicalEnergyScene()
    const engine = new EnergyEngine()
    const request = createEnergySimulationRequest(scene, 'long-ledger', 'long-ledger-trace')
    request.options = { endTime: quantity(1_000_000, 's', 'time'), outputSampleRate: 3 }
    const simulateSpy = vi.spyOn(engine, 'simulate').mockImplementation(() => { throw new Error('simulate forbidden') })
    const stateSpy = vi.spyOn(engine, 'stateAt').mockImplementation(() => { throw new Error('stateAt forbidden') })
    try {
      const plan = engine.prepareSimulationPlan(scene, request)
      expect(plan.endTime).toBe(1_000_000)
      expect(plan.storageSampleCountBound).toBe(3)
      expect(plan.numericalIterationCountBound).toBe(0)
      expect(simulateSpy).not.toHaveBeenCalled()
      expect(stateSpy).not.toHaveBeenCalled()
    } finally {
      simulateSpy.mockRestore()
      stateSpy.mockRestore()
    }
  })

  it('validates empty static plan identity without producing a ledger state', () => {
    const scene = createMechanicalEnergyScene()
    const engine = new EnergyEngine()
    const request = createEnergySimulationRequest(scene, '', 'empty-energy-identity-trace')
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow(/invalid simulation bounds/)
  })

  it('rejects identity and invalid range errors identically', () => {
    const scene = createMechanicalEnergyScene()
    const engine = new EnergyEngine()
    const request = createEnergySimulationRequest(scene, 'energy-invalid', 'energy-invalid-trace')
    request.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow(/exact PhysicsScene revision/)
    expect(() => engine.simulate(scene, request)).toThrow(/exact PhysicsScene revision/)
    request.sceneRevision = scene.revision
    request.options = { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') }
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
    expect(() => engine.simulate(scene, request)).toThrow()
  })
})
