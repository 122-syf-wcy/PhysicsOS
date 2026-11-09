import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertSimulationPlan,
  type SimulationOptions,
  type SimulationPlan,
  type SimulationRequest,
} from '../../physics-core/src/simulation.ts'
import {
  derivedScalar,
  isScalarQuantity,
  type SimulationState,
} from '../../physics-core/src/simulation-state.ts'
import {
  createArchimedesScene,
  type ArchimedesSceneInput,
} from '../../physics-scene/src/fluid/fluid-templates.ts'
import { createFluidTankScene } from '../../physics-scene/src/fluid/fluid-scene.ts'
import {
  createAtmosphericPressureScene,
  createLiquidPressureScene,
  createSolidPressureScene,
} from '../../physics-scene/src/fluid/pressure-templates.ts'
import type { PhysicsScene } from '../../physics-scene/src/scene.ts'
import * as sceneValidation from '../../physics-scene/src/scene-validation.ts'
import * as trajectorySampling from '../../physics-scene/src/trajectory-sampling.ts'
import { quantity, type Quantity } from '../../physics-units/src/quantity.ts'
import { asSceneId, asSimulationId } from '../../shared/src/ids.ts'

import * as buoyancy from '../src/buoyancy.ts'
import { createFluidSimulationRequest, FluidEngine } from '../src/fluid-engine.ts'
import { createPressureSimulationRequest, PressureEngine } from '../src/pressure-engine.ts'
import * as pressureCalculations from '../src/pressure.ts'

const NOW = '2026-11-08T12:00:00.000Z'

type Engine = FluidEngine | PressureEngine

type PlanIdentity = {
  engineId: string
  modelId: string
  kind: 'analytic' | 'static'
  solver: string
}

type PlanExpectation = PlanIdentity &
  Pick<SimulationPlan, 'startTime' | 'endTime' | 'storageSampleCountBound'>

const fluidIdentity: PlanIdentity = {
  engineId: 'engine-fluid',
  modelId: 'spring_scale_buoyancy',
  kind: 'analytic',
  solver: 'buoyancy-closed-form',
}

const pressureIdentity = (modelId: string): PlanIdentity => ({
  engineId: 'engine-pressure',
  modelId,
  kind: 'static',
  solver: 'pressure-closed-form',
})

const fluidScene = (overrides: ArchimedesSceneInput = {}): PhysicsScene =>
  createArchimedesScene({ ...overrides, now: NOW })

const alteredFluidScene = (lowerRate: number, height: number, mass = 270): PhysicsScene =>
  createFluidTankScene({
    sceneId: 'lab-plan-lowering-protocol',
    revision: 4,
    now: NOW,
    lowerRate,
    block: { id: 'block-1', mass, volume: 100, height },
    liquid: { id: 'liquid-1', density: 1000 },
  })

const fluidRequest = (scene: PhysicsScene, options: SimulationOptions = {}): SimulationRequest => ({
  ...createFluidSimulationRequest(scene, 'sim-plan-fluid', 'trace-plan-fluid'),
  options,
})

const pressureRequest = (
  scene: PhysicsScene,
  options: SimulationOptions = {},
): SimulationRequest => ({
  ...createPressureSimulationRequest(scene, 'sim-plan-pressure', 'trace-plan-pressure'),
  options,
})

const expectPlan = (
  plan: SimulationPlan,
  scene: PhysicsScene,
  request: SimulationRequest,
  expected: PlanExpectation,
): void => {
  expect(plan).toMatchObject({
    schemaVersion: 'simulation-plan/1.0',
    engineId: expected.engineId,
    engineVersion: '1.0.0',
    simulationId: request.simulationId,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    modelId: expected.modelId,
    kind: expected.kind,
    storageSampleCountBound: expected.storageSampleCountBound,
    numericalIterationCountBound: 0,
  })
  expect(plan.startTime).toBeCloseTo(expected.startTime, 12)
  expect(plan.endTime).toBeCloseTo(expected.endTime, 12)
  expect(plan.endTimeExact).not.toBe(false)
  for (const bound of [
    plan.startTime,
    plan.endTime,
    plan.storageSampleCountBound,
    plan.numericalIterationCountBound,
  ]) {
    expect(Number.isFinite(bound)).toBe(true)
  }
  expect(plan.startTime).toBeGreaterThanOrEqual(0)
  expect(plan.endTime).toBeGreaterThanOrEqual(plan.startTime)
  expect(Number.isSafeInteger(plan.sceneRevision)).toBe(true)
  expect(Number.isSafeInteger(plan.storageSampleCountBound)).toBe(true)
  expect(Number.isSafeInteger(plan.numericalIterationCountBound)).toBe(true)
  expect(plan.storageSampleCountBound).toBeGreaterThanOrEqual(1)
  expect(plan.metadata?.['numericalIterationAccounting']).toEqual(
    expect.stringMatching(/No numerical integration.*verification.*excluded/i),
  )
  expect(() => assertSimulationPlan(plan)).not.toThrow()
  expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
}

const expectExecution = (
  engine: Engine,
  scene: PhysicsScene,
  request: SimulationRequest,
  expected: PlanExpectation,
) => {
  const before = structuredClone({ scene, request })
  const plan = engine.prepareSimulationPlan(scene, request)
  expectPlan(plan, scene, request, expected)
  expect({ scene, request }).toEqual(before)

  const result = engine.simulate(scene, request)
  expect(result).toMatchObject({
    schemaVersion: 'simulation-result/1.0',
    simulationId: plan.simulationId,
    sceneId: plan.sceneId,
    sceneRevision: plan.sceneRevision,
    metadata: {
      engineId: plan.engineId,
      engineVersion: plan.engineVersion,
      solver: expected.solver,
      deterministic: true,
      durationMs: 0,
    },
  })
  expect(result.trace).toEqual(request.trace)
  expect(result.states).toHaveLength(plan.storageSampleCountBound)
  expect(result.states).toHaveLength(expected.storageSampleCountBound)
  result.states.forEach((state, index) => {
    const time =
      expected.kind === 'static'
        ? expected.startTime
        : expected.startTime +
          ((expected.endTime - expected.startTime) * index) /
            (expected.storageSampleCountBound - 1)
    expect(state.time).toMatchObject({ unit: 's', dimension: 'time' })
    expect(Number.isFinite(state.time.value)).toBe(true)
    expect(state.time.value).toBeCloseTo(time, 9)
    expect(state.time.value).toBeGreaterThanOrEqual(plan.startTime)
    expect(state.time.value).toBeLessThanOrEqual(plan.endTime)
  })
  for (const event of result.events) {
    expect(event.sceneId).toBe(plan.sceneId)
    expect(event.revision).toBe(plan.sceneRevision)
    if (event.time !== undefined) {
      expect(Number.isFinite(event.time)).toBe(true)
      expect(event.time).toBeGreaterThanOrEqual(plan.startTime)
      expect(event.time).toBeLessThanOrEqual(plan.endTime)
    }
  }
  expect(result.measurements).toEqual([])
  expect(result.verification.status).toBe('passed')
  expect(result.verification.errors).toEqual([])
  expect(result.verification.checks.every((check) => check.passed)).toBe(true)
  expect({ scene, request }).toEqual(before)
  return { plan, result }
}

const scalarStateValue = (
  state: SimulationState | undefined,
  objectId: string,
  key: string,
): Quantity => {
  const value = state?.objects.find((object) => object.id === objectId)?.values?.[key]
  if (value === undefined || !isScalarQuantity(value)) {
    throw new Error(`Expected scalar ${objectId}.${key} in a stored state.`)
  }
  return value
}

const expectScalar = (
  actual: Quantity,
  value: number,
  unit: string,
  dimension: Quantity['dimension'],
  precision = 9,
): void => {
  expect(actual).toMatchObject({ unit, dimension })
  expect(actual.value).toBeCloseTo(value, precision)
}

const expectRefusal = (action: () => unknown, code: string): void => {
  try {
    action()
  } catch (error: unknown) {
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`Expected refusal with ${code}, but the call returned.`)
}

type PressureFixture = {
  name: string
  makeScene: () => PhysicsScene
  identity: PlanIdentity
  readings: readonly {
    key: string
    value: number
    unit: string
    dimension: Quantity['dimension']
  }[]
  checkIds: readonly string[]
  readingMethod: 'solidPressureOf' | 'liquidPressureOf' | 'atmosphericPressureOf'
  hydrostaticIntegral: boolean
  surfaceIntegral: boolean
}

const pressureFixtures: PressureFixture[] = [
  {
    name: 'solid',
    makeScene: () => createSolidPressureScene({ now: NOW }),
    identity: pressureIdentity('solid_contact_pressure'),
    readings: [
      { key: 'contact_force', value: 20, unit: 'N', dimension: 'force' },
      { key: 'contact_area', value: 0.02, unit: 'm^2', dimension: 'area' },
      { key: 'contact_pressure', value: 1000, unit: 'Pa', dimension: 'pressure' },
      { key: 'comparison_area', value: 0.005, unit: 'm^2', dimension: 'area' },
      { key: 'comparison_pressure', value: 4000, unit: 'Pa', dimension: 'pressure' },
    ],
    checkIds: ['contact_force_invariant'],
    readingMethod: 'solidPressureOf',
    hydrostaticIntegral: false,
    surfaceIntegral: false,
  },
  {
    name: 'liquid',
    makeScene: () => createLiquidPressureScene({ now: NOW }),
    identity: pressureIdentity('hydrostatic_pressure'),
    readings: [
      { key: 'liquid_density', value: 1000, unit: 'kg/m^3', dimension: 'density' },
      { key: 'probe_depth', value: 0.2, unit: 'm', dimension: 'length' },
      { key: 'liquid_pressure', value: 1960, unit: 'Pa', dimension: 'pressure' },
      { key: 'comparison_depth_pressure', value: 3920, unit: 'Pa', dimension: 'pressure' },
      { key: 'comparison_liquid_pressure', value: 2156, unit: 'Pa', dimension: 'pressure' },
    ],
    checkIds: [
      'hydrostatic_gradient_integral',
      'pressure_proportional_to_depth',
      'pressure_proportional_to_density',
    ],
    readingMethod: 'liquidPressureOf',
    hydrostaticIntegral: true,
    surfaceIntegral: false,
  },
  {
    name: 'atmospheric',
    makeScene: () => createAtmosphericPressureScene({ now: NOW }),
    identity: pressureIdentity('atmospheric_pressure'),
    readings: [
      { key: 'atmospheric_pressure', value: 101_300, unit: 'Pa', dimension: 'pressure' },
      {
        key: 'barometer_column',
        value: 101_300 / (13_600 * 9.8),
        unit: 'm',
        dimension: 'length',
      },
      {
        key: 'hemisphere_force',
        value: 101_300 * Math.PI * 0.05 ** 2,
        unit: 'N',
        dimension: 'force',
      },
    ],
    checkIds: ['hemisphere_projected_force', 'barometer_column_balance'],
    readingMethod: 'atmosphericPressureOf',
    hydrostaticIntegral: true,
    surfaceIntegral: true,
  },
]

type PlannerFixture = {
  name: string
  makeEngine: () => Engine
  makeScene: () => PhysicsScene
  makeRequest: (scene: PhysicsScene, options?: SimulationOptions) => SimulationRequest
  identity: PlanIdentity
  defaultEndTime: number
  defaultStorageSamples: number
}

const plannerFixtures: PlannerFixture[] = [
  {
    name: 'fluid sinker',
    makeEngine: () => new FluidEngine(),
    makeScene: () => fluidScene(),
    makeRequest: fluidRequest,
    identity: fluidIdentity,
    defaultEndTime: 5,
    defaultStorageSamples: 65,
  },
  {
    name: 'fluid floater',
    makeEngine: () => new FluidEngine(),
    makeScene: () => fluidScene({ blockMass: 60 }),
    makeRequest: fluidRequest,
    identity: fluidIdentity,
    defaultEndTime: 1.5,
    defaultStorageSamples: 65,
  },
  {
    name: 'fluid altered lowering protocol',
    makeEngine: () => new FluidEngine(),
    makeScene: () => alteredFluidScene(1, 4),
    makeRequest: fluidRequest,
    identity: fluidIdentity,
    defaultEndTime: 8,
    defaultStorageSamples: 65,
  },
  ...pressureFixtures.map((fixture) => ({
    name: `${fixture.name} pressure`,
    makeEngine: () => new PressureEngine(),
    makeScene: fixture.makeScene,
    makeRequest: pressureRequest,
    identity: fixture.identity,
    defaultEndTime: 0,
    defaultStorageSamples: 1,
  })),
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(plannerFixtures)('$name simulation plans', (fixture) => {
  it('plans an empty options object with exact identity and execution bounds', () => {
    const scene = fixture.makeScene()
    const request = fixture.makeRequest(scene)
    expect(request.options).toEqual({})
    expectExecution(fixture.makeEngine(), scene, request, {
      ...fixture.identity,
      startTime: 0,
      endTime: fixture.defaultEndTime,
      storageSampleCountBound: fixture.defaultStorageSamples,
    })
  })

  it('uses an absolute fallback end, not a duration added to the requested start', () => {
    const scene = fixture.makeScene()
    expectExecution(fixture.makeEngine(), scene, fixture.makeRequest(scene, {
      startTime: quantity(1000, 'ms', 'time'),
    }), {
      ...fixture.identity,
      startTime: 1,
      endTime: fixture.identity.kind === 'static' ? 1 : fixture.defaultEndTime,
      storageSampleCountBound: fixture.defaultStorageSamples,
    })
  })

  it('converts non-SI time options into numeric seconds without clipping the requested end', () => {
    const scene = fixture.makeScene()
    expectExecution(fixture.makeEngine(), scene, fixture.makeRequest(scene, {
      startTime: quantity(1250, 'ms', 'time'),
      endTime: quantity(0.0625, 'min', 'time'),
      timeStep: quantity(250, 'us', 'time'),
      outputSampleRate: 3,
      maxIterations: 1,
    }), {
      ...fixture.identity,
      startTime: 1.25,
      endTime: 3.75,
      storageSampleCountBound: fixture.identity.kind === 'static' ? 1 : 3,
    })
  })

  it('preserves a nonzero exact scene revision and custom simulation id', () => {
    const scene = { ...fixture.makeScene(), revision: 12 }
    const request = {
      ...fixture.makeRequest(scene),
      simulationId: asSimulationId(`sim-exact-${fixture.name}`),
    }
    const { plan, result } = expectExecution(fixture.makeEngine(), scene, request, {
      ...fixture.identity,
      startTime: 0,
      endTime: fixture.defaultEndTime,
      storageSampleCountBound: fixture.defaultStorageSamples,
    })
    expect(plan.sceneRevision).toBe(12)
    expect(plan.simulationId).toBe(request.simulationId)
    expect(result.sceneRevision).toBe(12)
  })

  it.each(['scene id', 'revision', 'scene id and revision'])('refuses a different %s at both entry points', (mismatch) => {
    const scene = fixture.makeScene()
    const request = fixture.makeRequest(scene)
    const stale: SimulationRequest = {
      ...request,
      sceneId: mismatch === 'revision' ? scene.id : asSceneId('another-scene'),
      sceneRevision: mismatch === 'scene id' ? scene.revision : scene.revision + 1,
    }
    const engine = fixture.makeEngine()
    expectRefusal(() => engine.prepareSimulationPlan(scene, stale), 'SIMULATION_SCENE_MISMATCH')
    expectRefusal(() => engine.simulate(scene, stale), 'SIMULATION_SCENE_MISMATCH')
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY])(
    'refuses matching but invalid scene revision %s as an invalid plan',
    (revision) => {
      const scene = { ...fixture.makeScene(), revision }
      const request = fixture.makeRequest(scene)
      const engine = fixture.makeEngine()
      expectRefusal(() => engine.prepareSimulationPlan(scene, request), 'INVALID_SIMULATION_PLAN')
      expectRefusal(() => engine.simulate(scene, request), 'INVALID_SIMULATION_PLAN')
    },
  )

  it('rejects an empty simulation id before execution', () => {
    const scene = fixture.makeScene()
    const request = { ...fixture.makeRequest(scene), simulationId: asSimulationId('') }
    const engine = fixture.makeEngine()
    expectRefusal(() => engine.prepareSimulationPlan(scene, request), 'INVALID_SIMULATION_PLAN')
    expectRefusal(() => engine.simulate(scene, request), 'INVALID_SIMULATION_PLAN')
  })
})

describe('fluid plan numeric agreement', () => {
  it('keeps the 5 s / 65-state sinker trajectory, values, units and verifier', () => {
    const scene = fluidScene()
    const engine = new FluidEngine()
    const { result } = expectExecution(engine, scene, fluidRequest(scene), {
      ...fluidIdentity,
      startTime: 0,
      endTime: 5,
      storageSampleCountBound: 65,
    })
    for (const [index, time, reading] of [
      [0, 0, 2.646],
      [16, 1.25, 2.156],
      [32, 2.5, 1.666],
      [64, 5, 1.666],
    ] as const) {
      expect(result.states[index]).toEqual(engine.stateAt(scene, quantity(time, 's', 'time')))
      expectScalar(scalarStateValue(result.states[index], 'fluid-tank-1', 'scale_reading'), reading, 'N', 'force')
    }
    expectScalar(scalarStateValue(result.states[64], 'fluid-tank-1', 'immersion_depth'), 0.1, 'm', 'length', 12)
    expectScalar(scalarStateValue(result.states[32], 'fluid-tank-1', 'displaced_volume'), 1e-4, 'm^3', 'volume', 12)
    expectScalar(derivedScalar(result.derivedQuantities, 'block_weight'), 2.646, 'N', 'force')
    expectScalar(derivedScalar(result.derivedQuantities, 'block_density'), 2700, 'kg/m^3', 'density')
    expectScalar(derivedScalar(result.derivedQuantities, 'liquid_density'), 1000, 'kg/m^3', 'density')
    expectScalar(derivedScalar(result.derivedQuantities, 'displaced_weight'), 0.98, 'N', 'force')
    expectScalar(derivedScalar(result.derivedQuantities, 'buoyant_force'), 0.98, 'N', 'force')
    expectScalar(derivedScalar(result.derivedQuantities, 'scale_reading'), 1.666, 'N', 'force')
    expect(result.verification.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'archimedes_principle',
      'scale_reading_balance',
      'buoyancy_depth_independent',
    ]))
    expect(result.events.map(({ type, time }) => ({ type, time }))).toEqual([
      { type: 'BlockEntersLiquid', time: 0 },
      { type: 'BlockFullySubmerged', time: 2.5 },
      { type: 'DescentComplete', time: 5 },
    ])
  })

  it('plans 1.5 s for a 60 g floater while preserving the float equilibrium', () => {
    const scene = fluidScene({ blockMass: 60 })
    const engine = new FluidEngine()
    const { result } = expectExecution(engine, scene, fluidRequest(scene), {
      ...fluidIdentity,
      startTime: 0,
      endTime: 1.5,
      storageSampleCountBound: 65,
    })
    const settled = result.states.at(-1)
    expectScalar(scalarStateValue(result.states[0], 'fluid-tank-1', 'scale_reading'), 0.588, 'N', 'force')
    expectScalar(scalarStateValue(settled, 'fluid-tank-1', 'submerged_height'), 0.03, 'm', 'length', 12)
    expectScalar(scalarStateValue(settled, 'fluid-tank-1', 'displaced_volume'), 6e-5, 'm^3', 'volume', 12)
    expectScalar(scalarStateValue(settled, 'fluid-tank-1', 'buoyant_force'), 0.588, 'N', 'force')
    expectScalar(scalarStateValue(settled, 'fluid-tank-1', 'scale_reading'), 0, 'N', 'force')
    expectScalar(derivedScalar(result.derivedQuantities, 'block_density'), 600, 'kg/m^3', 'density')
    expectScalar(derivedScalar(result.derivedQuantities, 'scale_reading'), 0, 'N', 'force')
    expect(engine.stateAt(scene, quantity(10, 's', 'time')).objects).toEqual(settled?.objects)
    const checkIds = result.verification.checks.map((check) => check.id)
    expect(checkIds).toContain('float_equilibrium')
    expect(checkIds).not.toContain('buoyancy_depth_independent')
    expect(result.events.map(({ type, time }) => ({ type, time }))).toEqual([
      { type: 'BlockEntersLiquid', time: 0 },
      { type: 'BlockFloats', time: expect.closeTo(1.5, 12) },
      { type: 'DescentComplete', time: expect.closeTo(1.5, 12) },
    ])
  })

  it.each([
    { name: 'slower descent', lowerRate: 1, height: 5, mass: 270, end: 10, transition: 5 },
    { name: 'faster descent', lowerRate: 4, height: 5, mass: 270, end: 2.5, transition: 1.25 },
    { name: 'shorter block', lowerRate: 1, height: 4, mass: 270, end: 8, transition: 4 },
    { name: 'slower floater', lowerRate: 1, height: 5, mass: 60, end: 3, transition: 3 },
  ])('recomputes the default horizon for $name, independently of playback protocol', ({ lowerRate, height, mass, end, transition }) => {
    const original = alteredFluidScene(lowerRate, height, mass)
    const scene: PhysicsScene = {
      ...original,
      timeline: {
        ...original.timeline,
        startTime: quantity(30, 's', 'time'),
        currentTime: quantity(40, 's', 'time'),
        endTime: quantity(60, 's', 'time'),
        playbackRate: 4,
        simulationTimeStep: quantity(2, 'ms', 'time'),
      },
    }
    const { result } = expectExecution(new FluidEngine(), scene, fluidRequest(scene), {
      ...fluidIdentity,
      startTime: 0,
      endTime: end,
      storageSampleCountBound: 65,
    })
    expect(result.events[1]?.time).toBeCloseTo(transition, 12)
    expect(result.events[2]?.time).toBeCloseTo(end, 12)
    expectScalar(derivedScalar(result.derivedQuantities, 'scale_reading'), mass === 60 ? 0 : 1.666, 'N', 'force')
  })

  it('honours an explicit slow-descent window past equilibrium and filters earlier events', () => {
    const scene = alteredFluidScene(1, 5)
    const { result } = expectExecution(new FluidEngine(), scene, fluidRequest(scene, {
      startTime: quantity(6, 's', 'time'),
      endTime: quantity(11, 's', 'time'),
      outputSampleRate: 3,
    }), {
      ...fluidIdentity,
      startTime: 6,
      endTime: 11,
      storageSampleCountBound: 3,
    })
    expect(result.states.map((state) => state.time.value)).toEqual([6, 8.5, 11])
    expect(result.events.map(({ type, time }) => ({ type, time }))).toEqual([
      { type: 'DescentComplete', time: 10 },
    ])
    expectScalar(scalarStateValue(result.states[0], 'fluid-tank-1', 'scale_reading'), 1.666, 'N', 'force')
    expectScalar(scalarStateValue(result.states[2], 'fluid-tank-1', 'scale_reading'), 1.666, 'N', 'force')
  })

  it('samples canonical non-SI endpoints with the covering event inside the requested window', () => {
    const scene = fluidScene()
    const { result } = expectExecution(new FluidEngine(), scene, fluidRequest(scene, {
      startTime: quantity(1250, 'ms', 'time'),
      endTime: quantity(0.0625, 'min', 'time'),
      outputSampleRate: 3,
    }), {
      ...fluidIdentity,
      startTime: 1.25,
      endTime: 3.75,
      storageSampleCountBound: 3,
    })
    expect(result.states.map((state) => state.time.value)).toEqual([1.25, 2.5, 3.75])
    expect(result.events.map(({ type, time }) => ({ type, time }))).toEqual([
      { type: 'BlockFullySubmerged', time: 2.5 },
    ])
    expectScalar(scalarStateValue(result.states[0], 'fluid-tank-1', 'scale_reading'), 2.156, 'N', 'force')
    expectScalar(scalarStateValue(result.states[2], 'fluid-tank-1', 'immersion_depth'), 0.075, 'm', 'length', 12)
  })

  it.each([
    { mass: 270, start: 6 },
    { mass: 60, start: 2 },
  ])('refuses a start past the absolute default end for a $mass g block', ({ mass, start }) => {
    const scene = fluidScene({ blockMass: mass })
    const request = fluidRequest(scene, { startTime: quantity(start, 's', 'time') })
    const engine = new FluidEngine()
    expectRefusal(() => engine.prepareSimulationPlan(scene, request), 'INVALID_SIMULATION_RANGE')
    expectRefusal(() => engine.simulate(scene, request), 'INVALID_SIMULATION_RANGE')
  })

  it('refuses a nonfinite physical descent duration even when an explicit end is finite', () => {
    const base = fluidScene()
    const tank = base.fluidTanks?.[0]
    if (tank === undefined) throw new Error('Expected a fluid tank.')
    const scene: PhysicsScene = {
      ...base,
      fluidTanks: [{ ...tank, lowerRate: quantity(Number.MIN_VALUE, 'm/s', 'velocity') }],
    }
    const request = fluidRequest(scene, { endTime: quantity(1, 's', 'time'), outputSampleRate: 2 })
    const engine = new FluidEngine()
    try {
      const sampler = vi.spyOn(trajectorySampling, 'trajectorySampleTimes')
      const immersion = vi.spyOn(buoyancy, 'immersionStateAt')
      expectRefusal(() => engine.prepareSimulationPlan(scene, request), 'INVALID_SIMULATION_RANGE')
      expectRefusal(() => engine.simulate(scene, request), 'INVALID_SIMULATION_RANGE')
      expect(sampler).not.toHaveBeenCalled()
      expect(immersion).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('allows a sparse 1e12 s analytic window without turning the tiny timestep into iterations', () => {
    const scene = fluidScene()
    const { plan, result } = expectExecution(new FluidEngine(), scene, fluidRequest(scene, {
      endTime: quantity(1e12, 's', 'time'),
      timeStep: quantity(1e-12, 's', 'time'),
      outputSampleRate: 3,
      maxIterations: 0,
    }), {
      ...fluidIdentity,
      startTime: 0,
      endTime: 1e12,
      storageSampleCountBound: 3,
    })
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(result.states.map((state) => state.time.value)).toEqual([0, 5e11, 1e12])
    expect(result.states[1]?.objects).toEqual(result.states[2]?.objects)
    expectScalar(scalarStateValue(result.states[2], 'fluid-tank-1', 'scale_reading'), 1.666, 'N', 'force')
    expect(result.events.map((event) => event.time)).toEqual([0, 2.5, 5])
    for (const state of result.states) {
      for (const object of state.objects) {
        for (const value of Object.values(object.values ?? {})) {
          expect(isScalarQuantity(value)).toBe(true)
          if (isScalarQuantity(value)) expect(Number.isFinite(value.value)).toBe(true)
        }
      }
    }
  })
})

const fluidSampleCases: { name: string; options: SimulationOptions; count: number }[] = [
  { name: 'absent sample count', options: {}, count: 65 },
  { name: 'explicit undefined', options: { outputSampleRate: undefined }, count: 65 },
  { name: 'custom count', options: { outputSampleRate: 3 }, count: 3 },
  { name: 'fractional count', options: { outputSampleRate: 17.9 }, count: 17 },
  { name: 'fraction below minimum', options: { outputSampleRate: 1.9 }, count: 2 },
  { name: 'one sample', options: { outputSampleRate: 1 }, count: 2 },
  { name: 'zero samples', options: { outputSampleRate: 0 }, count: 2 },
  { name: 'negative count', options: { outputSampleRate: -5 }, count: 2 },
  { name: 'fraction just below cap', options: { outputSampleRate: 1023.9 }, count: 1023 },
  { name: 'exact cap', options: { outputSampleRate: 1024 }, count: 1024 },
  { name: 'fraction above cap', options: { outputSampleRate: 1024.9 }, count: 1024 },
  { name: 'oversized count', options: { outputSampleRate: Number.MAX_VALUE }, count: 1024 },
  { name: 'NaN fallback', options: { outputSampleRate: Number.NaN }, count: 65 },
  { name: 'positive Infinity fallback', options: { outputSampleRate: Number.POSITIVE_INFINITY }, count: 65 },
  { name: 'negative Infinity fallback', options: { outputSampleRate: Number.NEGATIVE_INFINITY }, count: 65 },
]

describe('fluid storage-count planning', () => {
  it.each(fluidSampleCases)('matches stored states for $name', ({ options, count }) => {
    const scene = fluidScene()
    expectExecution(new FluidEngine(), scene, fluidRequest(scene, options), {
      ...fluidIdentity,
      startTime: 0,
      endTime: 5,
      storageSampleCountBound: count,
    })
  })

  it.each(fluidSampleCases)('keeps the sampled count on a zero-length window for $name', ({ options, count }) => {
    const scene = fluidScene()
    const engine = new FluidEngine()
    const instant = quantity(2500, 'ms', 'time')
    const { result } = expectExecution(engine, scene, fluidRequest(scene, {
      ...options,
      startTime: instant,
      endTime: instant,
    }), {
      ...fluidIdentity,
      startTime: 2.5,
      endTime: 2.5,
      storageSampleCountBound: count,
    })
    const reference = engine.stateAt(scene, instant)
    expect(result.states).toEqual(Array.from({ length: count }, () => reference))
    expect(result.events.map(({ type, time }) => ({ type, time }))).toEqual([
      { type: 'BlockFullySubmerged', time: 2.5 },
    ])
  })

  it('keeps all 65 samples when a start-only request equals the fallback end', () => {
    const scene = fluidScene()
    const { result } = expectExecution(new FluidEngine(), scene, fluidRequest(scene, {
      startTime: quantity(5, 's', 'time'),
    }), {
      ...fluidIdentity,
      startTime: 5,
      endTime: 5,
      storageSampleCountBound: 65,
    })
    expect(result.states.every((state) => state.time.value === 5)).toBe(true)
    expect(result.events.map(({ type, time }) => ({ type, time }))).toEqual([
      { type: 'DescentComplete', time: 5 },
    ])
  })
})

describe.each(pressureFixtures)('$name static pressure planning', (fixture) => {
  it.each([
    { name: 'full range from zero', start: 0, end: 12, settledEvent: true },
    { name: 'later range', start: 2, end: 9, settledEvent: false },
    { name: 'instant at zero', start: 0, end: 0, settledEvent: true },
    { name: 'later instant', start: 3, end: 3, settledEvent: false },
    { name: 'very long range', start: 0, end: 1e12, settledEvent: true },
  ])('preserves the $name while storing only the start state', ({ start, end, settledEvent }) => {
    const scene = fixture.makeScene()
    const engine = new PressureEngine()
    const { result } = expectExecution(engine, scene, pressureRequest(scene, {
      startTime: quantity(start, 's', 'time'),
      endTime: quantity(end, 's', 'time'),
      outputSampleRate: 3,
      maxIterations: 0,
      timeStep: quantity(1e-12, 's', 'time'),
    }), {
      ...fixture.identity,
      startTime: start,
      endTime: end,
      storageSampleCountBound: 1,
    })
    expect(result.states[0]).toEqual(engine.stateAt(scene, quantity(start, 's', 'time')))
    expect(engine.stateAt(scene, quantity(end, 's', 'time')).objects).toEqual(result.states[0]?.objects)
    expect(result.events.map(({ type, time }) => ({ type, time }))).toEqual(
      settledEvent ? [{ type: 'PressureReadingSettled', time: 0 }] : [],
    )
  })

  it.each(fluidSampleCases)('ignores $name and iterative work options for static storage', ({ options }) => {
    const scene = fixture.makeScene()
    expectExecution(new PressureEngine(), scene, pressureRequest(scene, {
      ...options,
      startTime: quantity(1250, 'ms', 'time'),
      endTime: quantity(0.25, 'min', 'time'),
      timeStep: quantity(250, 'us', 'time'),
      maxIterations: 0,
    }), {
      ...fixture.identity,
      startTime: 1.25,
      endTime: 15,
      storageSampleCountBound: 1,
    })
  })

  it.each([
    { name: 'fractional work limit', maxIterations: 0.5, step: 0 },
    { name: 'negative work limit and step', maxIterations: -1, step: -1 },
    { name: 'NaN work limit', maxIterations: Number.NaN, step: 1e-12 },
    { name: 'infinite work limit', maxIterations: Number.POSITIVE_INFINITY, step: 1e-12 },
  ])('does not invent work for $name', ({ maxIterations, step }) => {
    const scene = fixture.makeScene()
    expectExecution(new PressureEngine(), scene, pressureRequest(scene, {
      endTime: quantity(10, 's', 'time'),
      timeStep: quantity(step, 'ms', 'time'),
      outputSampleRate: 1_000_000,
      maxIterations,
    }), {
      ...fixture.identity,
      startTime: 0,
      endTime: 10,
      storageSampleCountBound: 1,
    })
  })

  it('preserves canonical readings, derived values and branch-specific verification', () => {
    const scene = fixture.makeScene()
    const { result } = expectExecution(new PressureEngine(), scene, pressureRequest(scene, {
      startTime: quantity(2, 's', 'time'),
      endTime: quantity(9, 's', 'time'),
    }), {
      ...fixture.identity,
      startTime: 2,
      endTime: 9,
      storageSampleCountBound: 1,
    })
    expect(result.states[0]?.objects).toHaveLength(1)
    expect(result.states[0]?.objects[0]?.id).toBe('pressure-bench-1')
    expect(result.states[0]?.derived).toEqual(result.derivedQuantities)
    for (const { key, value, unit, dimension } of fixture.readings) {
      expectScalar(derivedScalar(result.derivedQuantities, key), value, unit, dimension)
      expectScalar(scalarStateValue(result.states[0], 'pressure-bench-1', key), value, unit, dimension)
      expect(result.derivedQuantities.find((entry) => entry.key === key)).toMatchObject({
        targetId: 'pressure-bench-1',
        formula: { expression: expect.any(String) },
        assumptions: expect.arrayContaining([expect.any(String)]),
      })
    }
    expect(result.verification.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(fixture.checkIds),
    )
    expect(result.events).toEqual([])
  })
})

// Wire-shaped quantities let the engine boundary, not quantity(), reject non-finite input.
const uncheckedTime = (value: number, unit = 's'): Quantity<'time'> => ({
  value,
  unit,
  dimension: 'time',
})

const rangeRefusals: { name: string; options: SimulationOptions; code: string }[] = [
  { name: 'negative start', options: { startTime: quantity(-1, 's', 'time') }, code: 'INVALID_SIMULATION_RANGE' },
  { name: 'negative end', options: { endTime: quantity(-1, 's', 'time') }, code: 'INVALID_SIMULATION_RANGE' },
  {
    name: 'reversed range',
    options: { startTime: quantity(3, 's', 'time'), endTime: quantity(2, 's', 'time') },
    code: 'INVALID_SIMULATION_RANGE',
  },
  {
    name: 'reversed non-SI range',
    options: { startTime: quantity(1, 'min', 'time'), endTime: quantity(59_000, 'ms', 'time') },
    code: 'INVALID_SIMULATION_RANGE',
  },
  { name: 'NaN start', options: { startTime: uncheckedTime(Number.NaN) }, code: 'NON_FINITE_VALUE' },
  { name: 'NaN end', options: { endTime: uncheckedTime(Number.NaN) }, code: 'NON_FINITE_VALUE' },
  { name: 'infinite start', options: { startTime: uncheckedTime(Number.POSITIVE_INFINITY) }, code: 'NON_FINITE_VALUE' },
  { name: 'infinite end', options: { endTime: uncheckedTime(Number.POSITIVE_INFINITY) }, code: 'NON_FINITE_VALUE' },
  { name: 'negative infinite start', options: { startTime: uncheckedTime(Number.NEGATIVE_INFINITY) }, code: 'NON_FINITE_VALUE' },
  { name: 'negative infinite end', options: { endTime: uncheckedTime(Number.NEGATIVE_INFINITY) }, code: 'NON_FINITE_VALUE' },
  { name: 'overflow converting minutes', options: { endTime: quantity(Number.MAX_VALUE, 'min', 'time') }, code: 'NON_FINITE_VALUE' },
]

describe.each(plannerFixtures)('$name range refusals', (fixture) => {
  it.each(rangeRefusals)('rejects $name consistently in planning and execution', ({ options, code }) => {
    const scene = fixture.makeScene()
    const request = fixture.makeRequest(scene, options)
    const engine = fixture.makeEngine()
    const before = structuredClone({ scene, request })
    expectRefusal(() => engine.prepareSimulationPlan(scene, request), code)
    expectRefusal(() => engine.simulate(scene, request), code)
    expect({ scene, request }).toEqual(before)
  })
})

const installForbiddenPlanningWork = () => {
  const forbidden = (name: string) => (): never => {
    throw new Error(`${name} must not run during prepareSimulationPlan.`)
  }
  return [
    vi.spyOn(trajectorySampling, 'trajectorySampleTimes').mockImplementation(forbidden('trajectorySampleTimes')),
    vi.spyOn(buoyancy, 'immersionStateAt').mockImplementation(forbidden('immersionStateAt')),
    vi.spyOn(buoyancy, 'buoyancyFromPressure').mockImplementation(forbidden('buoyancyFromPressure')),
    vi.spyOn(pressureCalculations, 'pressureReadingOf').mockImplementation(forbidden('pressureReadingOf')),
    vi.spyOn(pressureCalculations, 'solidPressureOf').mockImplementation(forbidden('solidPressureOf')),
    vi.spyOn(pressureCalculations, 'liquidPressureOf').mockImplementation(forbidden('liquidPressureOf')),
    vi.spyOn(pressureCalculations, 'atmosphericPressureOf').mockImplementation(forbidden('atmosphericPressureOf')),
    vi.spyOn(pressureCalculations, 'hydrostaticPressureByIntegration').mockImplementation(forbidden('hydrostaticPressureByIntegration')),
    vi.spyOn(pressureCalculations, 'hemisphereForceBySurfaceIntegral').mockImplementation(forbidden('hemisphereForceBySurfaceIntegral')),
    vi.spyOn(sceneValidation, 'validateScene').mockImplementation(forbidden('validateScene')),
    vi.spyOn(FluidEngine.prototype, 'simulate').mockImplementation(forbidden('FluidEngine.simulate')),
    vi.spyOn(FluidEngine.prototype, 'stateAt').mockImplementation(forbidden('FluidEngine.stateAt')),
    vi.spyOn(FluidEngine.prototype, 'validate').mockImplementation(forbidden('FluidEngine.validate')),
    vi.spyOn(FluidEngine.prototype, 'canHandle').mockImplementation(forbidden('FluidEngine.canHandle')),
    vi.spyOn(PressureEngine.prototype, 'simulate').mockImplementation(forbidden('PressureEngine.simulate')),
    vi.spyOn(PressureEngine.prototype, 'stateAt').mockImplementation(forbidden('PressureEngine.stateAt')),
    vi.spyOn(PressureEngine.prototype, 'validate').mockImplementation(forbidden('PressureEngine.validate')),
    vi.spyOn(PressureEngine.prototype, 'canHandle').mockImplementation(forbidden('PressureEngine.canHandle')),
  ]
}

describe('planner purity', () => {
  it.each(plannerFixtures)('$name plans without sampling, state evaluation, verification or simulation', (fixture) => {
    const scene = fixture.makeScene()
    const engine = fixture.makeEngine()
    const request = fixture.makeRequest(scene)
    const longRequest = fixture.makeRequest(scene, {
      startTime: quantity(1250, 'ms', 'time'),
      endTime: quantity(1e12, 's', 'time'),
      outputSampleRate: 1_000_000,
      timeStep: quantity(1e-12, 's', 'time'),
      maxIterations: 0,
    })
    const before = structuredClone({ scene, request, longRequest })
    try {
      const spies = installForbiddenPlanningWork()
      const plan = engine.prepareSimulationPlan(scene, request)
      expectPlan(plan, scene, request, {
        ...fixture.identity,
        startTime: 0,
        endTime: fixture.defaultEndTime,
        storageSampleCountBound: fixture.defaultStorageSamples,
      })
      expect(engine.prepareSimulationPlan(scene, request)).toEqual(plan)
      expectPlan(engine.prepareSimulationPlan(scene, longRequest), scene, longRequest, {
        ...fixture.identity,
        startTime: 1.25,
        endTime: 1e12,
        storageSampleCountBound: fixture.identity.kind === 'static' ? 1 : 1024,
      })
      expect({ scene, request, longRequest }).toEqual(before)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
    expectExecution(engine, scene, request, {
      ...fixture.identity,
      startTime: 0,
      endTime: fixture.defaultEndTime,
      storageSampleCountBound: fixture.defaultStorageSamples,
    })
  })

  it('the direct fluid spy seams observe actual sampling and verification', () => {
    const scene = fluidScene()
    try {
      const sampling = vi.spyOn(trajectorySampling, 'trajectorySampleTimes')
      const immersion = vi.spyOn(buoyancy, 'immersionStateAt')
      const pressureRoute = vi.spyOn(buoyancy, 'buoyancyFromPressure')
      const validation = vi.spyOn(sceneValidation, 'validateScene')
      expectExecution(new FluidEngine(), scene, fluidRequest(scene), {
        ...fluidIdentity,
        startTime: 0,
        endTime: 5,
        storageSampleCountBound: 65,
      })
      expect(sampling).toHaveBeenCalledWith(0, 5, 65)
      expect(immersion).toHaveBeenCalled()
      expect(pressureRoute).toHaveBeenCalled()
      expect(validation).toHaveBeenCalledWith(scene)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it.each(pressureFixtures)('the direct $name pressure spy seams observe real readings and fixed quadrature', (fixture) => {
    const scene = fixture.makeScene()
    try {
      const reading = vi.spyOn(pressureCalculations, fixture.readingMethod)
      const hydrostatic = vi.spyOn(pressureCalculations, 'hydrostaticPressureByIntegration')
      const hemisphere = vi.spyOn(pressureCalculations, 'hemisphereForceBySurfaceIntegral')
      const validation = vi.spyOn(sceneValidation, 'validateScene')
      expectExecution(new PressureEngine(), scene, pressureRequest(scene), {
        ...fixture.identity,
        startTime: 0,
        endTime: 0,
        storageSampleCountBound: 1,
      })
      expect(reading).toHaveBeenCalled()
      expect(hydrostatic.mock.calls.length > 0).toBe(fixture.hydrostaticIntegral)
      expect(hemisphere.mock.calls.length > 0).toBe(fixture.surfaceIntegral)
      expect(validation).toHaveBeenCalledWith(scene)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
