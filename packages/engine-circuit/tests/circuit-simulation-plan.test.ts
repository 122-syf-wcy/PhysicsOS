import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, derivedScalar, type SimulationOptions } from '@physicsos/physics-core'
import * as sceneSampling from '@physicsos/physics-scene'
import {
  createCircuitScene,
  createEmfMeasurementScene,
  createRheostatCircuitScene,
  createSeriesCircuitScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asSceneId } from '@physicsos/shared'

import {
  CIRCUIT_ENGINE_ID,
  CIRCUIT_ENGINE_VERSION,
  DC_CIRCUIT_MODEL,
  CircuitEngine,
  createCircuitSimulationRequest,
} from '../src/circuit-engine.ts'
import { prepareCircuitModel, resolveCircuitModel } from '../src/circuit-model.ts'
import * as mna from '../src/mna-solver.ts'

const requestFor = (scene: PhysicsScene, options?: SimulationOptions) => ({
  ...createCircuitSimulationRequest(scene, 'sim-circuit-plan', 'trace-circuit-plan'),
  ...(options === undefined ? {} : { options }),
})

const dividerScene = (internalResistance?: number): PhysicsScene =>
  createCircuitScene({
    components: [
      {
        id: 'battery',
        type: 'voltage_source',
        voltage: 12,
        ...(internalResistance === undefined ? {} : { internalResistance }),
        terminals: { positive: 'p', negative: 'n' },
      },
      { id: 'load', type: 'resistor', resistance: 5, terminals: { a: 'p', b: 'n' } },
    ],
  })

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

afterEach(() => vi.restoreAllMocks())

describe('CircuitEngine.prepareSimulationPlan', () => {
  it.each([
    { name: 'static DC', make: () => createSeriesCircuitScene(), endTime: 0, count: 1 },
    { name: 'rheostat sweep', make: () => createRheostatCircuitScene(), endTime: 8, count: 121 },
    { name: 'internal-resistance sweep', make: () => createEmfMeasurementScene(), endTime: 8, count: 121 },
  ])('matches the actual $name run with options={}', ({ make, endTime, count }) => {
    const scene = make()
    const request = requestFor(scene, {})
    const engine = new CircuitEngine()
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({
      schemaVersion: 'simulation-plan/1.0',
      engineId: CIRCUIT_ENGINE_ID,
      engineVersion: CIRCUIT_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      modelId: DC_CIRCUIT_MODEL,
      kind: 'iterative',
      metadata: {
        numericalIterationAccounting: expect.stringContaining('Gaussian'),
      },
      startTime: 0,
      endTime,
      storageSampleCountBound: count,
    })
    expect(() => assertSimulationPlan(plan)).not.toThrow()
    expect(engine.simulate(scene, request).states).toHaveLength(count)
    expect(plan.numericalIterationCountBound).toBeGreaterThan(0)
  })

  it('counts Gaussian loops for every stored solve and the extra final solve', () => {
    const engine = new CircuitEngine()
    const scene = dividerScene()
    const model = resolveCircuitModel(scene, 0)
    // One non-ground potential plus the source current: a 2-by-2 MNA system.
    // Two pivot stages, one pivot-search row, one elimination row with three
    // entries, and two back-substitution rows with one trailing entry = 10.
    expect(mna.circuitNumericalIterationCountBoundOf(model)).toBe(10)
    const request = requestFor(scene, {
      endTime: quantity(2, 's', 'time'),
      outputSampleRate: 3,
    })
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan.storageSampleCountBound).toBe(3)
    expect(plan.metadata?.gaussianIterationCountBound).toBe(40)
    expect(plan.metadata?.processingIterationCountBound).toBeGreaterThan(0)
    expect(plan.numericalIterationCountBound).toBe(
      40 + Number(plan.metadata?.processingIterationCountBound),
    )
    const solve = vi.spyOn(mna, 'solveCircuit')
    expect(engine.simulate(scene, request).states).toHaveLength(3)
    expect(solve).toHaveBeenCalledTimes(4)
  })

  it('uses the same layout for private source nodes and disconnected islands', () => {
    const engine = new CircuitEngine()
    const internal = dividerScene(1)
    // Internal source resistance adds one potential unknown: size 3, bound 26.
    expect(engine.prepareSimulationPlan(internal, requestFor(internal, {}))
      .metadata?.gaussianIterationCountBound).toBe(52)
    const disconnected = createCircuitScene({
      components: [
        {
          id: 'battery', type: 'voltage_source', voltage: 6,
          terminals: { positive: 'p', negative: 'n' },
        },
        { id: 'load', type: 'resistor', resistance: 10, terminals: { a: 'p', b: 'n' } },
        { id: 'island', type: 'resistor', resistance: 20, terminals: { a: 'x', b: 'y' } },
      ],
    })
    const request = requestFor(disconnected, {})
    expect(engine.prepareSimulationPlan(disconnected, request).metadata?.gaussianIterationCountBound).toBe(52)
    expect(engine.simulate(disconnected, request).states).toHaveLength(1)
  })

  it('budgets many parallel rheostats even when the MNA matrix remains two by two', () => {
    const parallel = (count: number) => createCircuitScene({
      components: [
        {
          id: 'battery', type: 'voltage_source', voltage: 12,
          terminals: { positive: 'p', negative: 'n' },
        },
        ...Array.from({ length: count }, (_, index) => ({
          id: `slider-${index}`, type: 'variable_resistor' as const,
          totalResistance: 10, sliderPosition: 0.5,
          terminals: { a: 'p', b: 'n' },
        })),
      ],
    })
    const engine = new CircuitEngine()
    const small = parallel(1)
    const many = parallel(256)
    const smallPlan = engine.prepareSimulationPlan(small, requestFor(small, {}))
    const request = requestFor(many, {})
    const plan = engine.prepareSimulationPlan(many, request)
    const zeroRequest = requestFor(many, { endTime: quantity(0, 's', 'time') })
    const zeroPlan = engine.prepareSimulationPlan(many, zeroRequest)
    expect(mna.circuitNumericalIterationCountBoundOf(resolveCircuitModel(many, 0))).toBe(10)
    expect(plan.metadata?.gaussianIterationCountBound).toBe(1220)
    expect(zeroPlan.metadata?.gaussianIterationCountBound).toBe(20)
    expect(zeroPlan.numericalIterationCountBound).toBeGreaterThan(20)
    expect(plan.numericalIterationCountBound).toBeGreaterThan(smallPlan.numericalIterationCountBound)
    expect(Number(plan.metadata?.processingIterationCountBound)).toBeGreaterThan(256 * 121)
    expect(plan.numericalIterationCountBound).toBe(
      Number(plan.metadata?.gaussianIterationCountBound) + Number(plan.metadata?.processingIterationCountBound),
    )
    expect(() => assertSimulationPlan(plan)).not.toThrow()
    const prepared = prepareCircuitModel(many, 0)
    expect(prepared.model).toEqual(resolveCircuitModel(many, 0))
    expect(prepared.iterationCount).toBeGreaterThan(256)
    const result = engine.simulate(many, request)
    expect(result.states).toHaveLength(121)
    expect(derivedScalar(result.states[0]!.derived, 'main_current').value).toBeCloseTo(256 * 12 / 5, 9)
    expect(derivedScalar(result.derivedQuantities, 'main_current').value).toBeCloseTo(256 * 12 / 10, 9)
    expect(derivedScalar(result.states[0]!.derived, 'slider_resistance:slider-255')).toMatchObject({
      value: 5, unit: 'Ω', dimension: 'resistance',
    })
    expect(derivedScalar(result.derivedQuantities, 'slider_resistance:slider-255')).toMatchObject({
      value: 10, unit: 'Ω', dimension: 'resistance',
    })
    expect(result.verification.status).toBe('passed')
  })

  it('resolves non-SI request and scene times without changing the raw quantities', () => {
    const built = createRheostatCircuitScene({ voltage: 9, totalResistance: 30 })
    const scene = freeze({
      ...built,
      timeline: { ...built.timeline, endTime: quantity(8000, 'ms', 'time') },
    })
    const request = freeze(requestFor(scene, {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(1750, 'ms', 'time'),
      outputSampleRate: 4,
    }))
    const snapshot = structuredClone({ scene, request })
    const engine = new CircuitEngine()
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({ startTime: 0.25, endTime: 1.75, storageSampleCountBound: 4 })
    const result = engine.simulate(scene, request)
    expect(result.states.map(state => state.time.value)).toEqual([0.25, 0.75, 1.25, 1.75])
    expect({ scene, request }).toEqual(snapshot)
  })

  it('defaults to zero only when the circuit timeline actually omits its end', () => {
    const built = dividerScene()
    const timeline = { ...built.timeline }
    delete timeline.endTime
    const scene: PhysicsScene = { ...built, timeline }
    const request = requestFor(scene, {})
    const engine = new CircuitEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      startTime: 0, endTime: 0, storageSampleCountBound: 1,
    })
    expect(engine.simulate(scene, request).states).toHaveLength(1)
  })

  it('keeps a positive requested window on a physically static circuit', () => {
    const scene = dividerScene()
    const request = requestFor(scene, {
      startTime: quantity(2, 's', 'time'),
      endTime: quantity(5, 's', 'time'),
    })
    const engine = new CircuitEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      startTime: 2, endTime: 5, storageSampleCountBound: 121,
    })
    expect(engine.simulate(scene, request).states).toHaveLength(121)
  })

  it.each([
    { requested: undefined, count: 121 },
    { requested: 3.9, count: 3 },
    { requested: 0, count: 2 },
    { requested: -1, count: 2 },
    { requested: Number.NaN, count: 121 },
    { requested: Number.POSITIVE_INFINITY, count: 121 },
    { requested: 100000, count: 1024 },
  ])('uses the actual storage-count semantics for $requested', ({ requested, count }) => {
    const scene = dividerScene()
    const request = requestFor(scene, {
      endTime: quantity(1, 's', 'time'),
      ...(requested === undefined ? {} : { outputSampleRate: requested }),
    })
    const engine = new CircuitEngine()
    expect(engine.prepareSimulationPlan(scene, request).storageSampleCountBound).toBe(count)
    expect(engine.simulate(scene, request).states).toHaveLength(count)
  })

  it('keeps sparse long requested windows without expanding the numerical work', () => {
    const scene = createRheostatCircuitScene()
    const request = requestFor(scene, {
      endTime: quantity(1e6, 's', 'time'), outputSampleRate: 2,
    })
    const engine = new CircuitEngine()
    const plan = engine.prepareSimulationPlan(scene, request)
    const result = engine.simulate(scene, request)
    expect(plan).toMatchObject({ endTime: 1e6, storageSampleCountBound: 2 })
    expect(result.states.map(state => state.time.value)).toEqual([0, 1e6])
    expect(plan.metadata?.gaussianIterationCountBound).toBe(
      3 * mna.circuitNumericalIterationCountBoundOf(resolveCircuitModel(scene, 0)),
    )
    expect(plan.numericalIterationCountBound).toBeGreaterThan(Number(plan.metadata?.gaussianIterationCountBound))
  })

  it('retains one state for a zero window even when many storage samples are requested', () => {
    const scene = dividerScene()
    const request = requestFor(scene, {
      startTime: quantity(3, 's', 'time'),
      endTime: quantity(3, 's', 'time'),
      outputSampleRate: 1024,
    })
    const engine = new CircuitEngine()
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({
      startTime: 3, endTime: 3, storageSampleCountBound: 1,
      metadata: { gaussianIterationCountBound: 20 },
    })
    expect(engine.simulate(scene, request).states).toHaveLength(1)
  })

  it('does not invent numerical iterations from ignored solver hints', () => {
    const scene = dividerScene()
    const engine = new CircuitEngine()
    const request = requestFor(scene, {})
    const plan = engine.prepareSimulationPlan(scene, request)
    const hints = requestFor(scene, {
      timeStep: quantity(1, 'ms', 'time'), solver: 'custom-hint', maxIterations: 1,
      tolerance: { absolute: 1e-12, relative: 1e-9 }, randomSeed: 42,
    })
    expect(engine.prepareSimulationPlan(scene, hints)).toEqual(plan)
  })

  it('prepares without MNA, sampling, canHandle, stateAt, or simulate', () => {
    const scene = freeze(createRheostatCircuitScene())
    const request = freeze(requestFor(scene, {
      endTime: quantity(1e9, 's', 'time'), outputSampleRate: 2,
    }))
    const snapshot = structuredClone({ scene, request })
    const engine = new CircuitEngine()
    const forbidden = () => { throw new Error('Planning must not execute simulation.') }
    const solve = vi.spyOn(mna, 'solveCircuit').mockImplementation(forbidden)
    const sample = vi.spyOn(sceneSampling, 'trajectorySampleTimes').mockImplementation(forbidden)
    const canHandle = vi.spyOn(engine, 'canHandle').mockImplementation(forbidden)
    const state = vi.spyOn(engine, 'stateAt').mockImplementation(forbidden)
    const simulate = vi.spyOn(engine, 'simulate').mockImplementation(forbidden)
    const arrays = vi.spyOn(Array, 'from').mockImplementation(forbidden)
    const plan = engine.prepareSimulationPlan(scene, request)
    const arrayAllocations = arrays.mock.calls.length
    arrays.mockRestore()
    expect(plan).toMatchObject({ endTime: 1e9, storageSampleCountBound: 2 })
    expect(arrayAllocations).toBe(0)
    for (const spy of [solve, sample, canHandle, state, simulate]) expect(spy).not.toHaveBeenCalled()
    expect({ scene, request }).toEqual(snapshot)
  })

  it.each([
    { startTime: quantity(-1, 's', 'time'), endTime: quantity(1, 's', 'time') },
    { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
  ])('rejects the same invalid range before planning or simulation', options => {
    const scene = dividerScene()
    const request = requestFor(scene, options)
    const engine = new CircuitEngine()
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrowError(/0 <= startTime <= endTime/)
    expect(() => engine.simulate(scene, request)).toThrowError(/0 <= startTime <= endTime/)
  })

  it('rejects malformed/nonfinite time options with the same unit error as simulate', () => {
    const scene = dividerScene()
    const engine = new CircuitEngine()
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const request = requestFor(scene, {
        endTime: { ...quantity(1, 's', 'time'), value },
      })
      expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
      expect(() => engine.simulate(scene, request)).toThrow()
    }
  })

  it.each(['sceneId', 'sceneRevision'] as const)('guards the requested %s before resolving a model', key => {
    const scene = dividerScene()
    const request = requestFor(scene)
    const mismatch = key === 'sceneId'
      ? { ...request, sceneId: asSceneId('other-circuit-scene') }
      : { ...request, sceneRevision: scene.revision + 1 }
    const invalidScene: PhysicsScene = { ...scene, circuits: [] }
    expect(() => new CircuitEngine().prepareSimulationPlan(invalidScene, mismatch))
      .toThrowError(/SimulationRequest must reference/)
  })
})
