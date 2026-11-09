import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  derivedScalar,
  type SimulationOptions,
  type SimulationRequest,
  type SimulationResult,
} from '@physicsos/physics-core'
import {
  createCollisionScene,
  createEchoRangingScene,
  createMagneticScene,
  createSceneCommand,
  SceneRuntime,
  createMechanicalEnergyScene,
  createMechanicsScene,
  createNoiseBarrierScene,
  createPhotoelectricEffectScene,
  createPinholeScene,
  createSolidPressureScene,
  createStraightWireFieldScene,
  createThermometerCalibrationScene,
  createTransformerBenchScene,
  createTotalReflectionScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { EXPERIMENT_CATALOG } from '../../agent-tools/src/experiment-catalog.ts'

import {
  ENGINES,
  ENGINE_CAPABILITIES,
  getSimulationPlan,
  pickEngine,
  questionEngine,
  simulateScene,
  type EngineEntry,
} from '../src/index.ts'

const now = '2026-11-08T00:00:00.000Z'
const mechanicsScene = () => createMechanicsScene({
  sceneId: 'runtime-option-mechanics', model: 'uniformly_accelerated_motion',
  mass: 2, position: { x: 1, y: 0, z: 0 }, velocity: { x: 2, y: 0, z: 0 },
  acceleration: { x: 3, y: 0, z: 0 }, now,
})
const magneticScene = () => createMagneticScene({
  sceneId: 'runtime-option-magnetic', mass: 1, charge: 1,
  magneticFieldStrength: 1, magneticFieldDirection: 'out_of_page',
  position: { x: 2, y: -1, z: 0 }, velocity: { x: 2, y: 1, z: 0 }, now,
})
const entryOf = (scene: PhysicsScene): EngineEntry => {
  const entry = pickEngine(scene).entry
  if (entry === undefined) throw new Error('Expected a concrete engine fixture.')
  return entry
}
const firstX = (result: SimulationResult) => result.states[0]!.objects[0]!.position!.vector.x

const fixtureFactories = [
  createMechanicalEnergyScene, createPinholeScene, createNoiseBarrierScene,
  createSolidPressureScene, createThermometerCalibrationScene, createTransformerBenchScene,
  createStraightWireFieldScene, createPhotoelectricEffectScene,
]
const engineFixtures: readonly PhysicsScene[] = [
  ...EXPERIMENT_CATALOG.map(fixture => fixture.build(`shared-contract-${fixture.id}`, fixture.title)),
  ...fixtureFactories.map(factory => factory()),
  createCollisionScene({
    bodies: [
      { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0] },
      { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0] },
    ],
  }),
]

afterEach(() => vi.restoreAllMocks())

describe('simulateScene backwards-compatible options and raw requests', () => {
  it('keeps a legacy four-argument call on the normal engine/verifier path', () => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    const output = simulateScene(scene, entry, 'legacy', 'legacy-trace')
    expect(output.engineId).toBe(entry.engine.engineId)
    expect(output.request).toEqual(entry.createRequest(scene, 'legacy', 'legacy-trace'))
    expect(output.simulation.verification.status).toBe('passed')
    expect(output.simulation.verification.checks.some(check => check.id === 'mechanics_kinematic_consistency')).toBe(true)
  })

  it('passes accepted non-SI options unchanged to the actual engine and uses absolute-time numerics', () => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    const spy = vi.spyOn(entry.engine, 'simulate')
    const options: SimulationOptions = {
      startTime: quantity(100, 'ms', 'time'),
      endTime: quantity(200, 'ms', 'time'),
      timeStep: quantity(1, 'ms', 'time'),
      outputSampleRate: 7,
      solver: 'analytic-test-hint',
      tolerance: { absolute: 0, relative: 1e-9 },
      maxIterations: 100,
      randomSeed: 0,
    }
    const before = structuredClone(options)
    const output = simulateScene(scene, entry, 'custom-options', 'custom-trace', options)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![1].options).toEqual(options)
    expect(output.request).toBe(spy.mock.calls[0]![1])
    expect(output.request.options.startTime).toBe(options.startTime)
    expect(output.request.options.endTime).toBe(options.endTime)
    expect(options).toEqual(before)
    expect(output.simulation.states).toHaveLength(7)
    expect(canonicalValue(output.simulation.states[0]!.time)).toBe(0.1)
    expect(canonicalValue(output.simulation.states.at(-1)!.time)).toBe(0.2)
    expect(firstX(output.simulation)).toBeCloseTo(1 + 2 * 0.1 + 0.5 * 3 * 0.1 ** 2, 12)
    expect(output.simulation.states.at(-1)!.objects[0]!.velocity!.vector.x).toBeCloseTo(2.6, 12)
    expect(output.simulation.verification.status).toBe('passed')
  })

  it('uses the supplied request object as-is without calling a request factory or enriching trace fields', () => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'raw-request', 'raw-trace')
    request.trace = { traceId: request.trace.traceId }
    request.options = { startTime: quantity(100, 'ms', 'time'), endTime: quantity(200, 'ms', 'time'), outputSampleRate: 7 }
    const original = structuredClone(request)
    const factory = vi.fn(() => { throw new Error('Raw requests must not call the factory.') })
    const spy = vi.spyOn(entry.engine, 'simulate')
    const output = simulateScene(scene, { engine: entry.engine, createRequest: factory }, request)
    expect(factory).not.toHaveBeenCalled()
    expect(spy.mock.calls[0]![1]).toBe(request)
    expect(output.request).toBe(request)
    expect(request).toEqual(original)
    expect(output.simulation.trace).toEqual({ traceId: request.trace.traceId })
    expect(output.simulation.verification.status).toBe('passed')
  })

  it('accepts a traceId-only result when the engine request also identifies the scene in its trace', () => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    const actual = entry.engine.simulate.bind(entry.engine)
    vi.spyOn(entry.engine, 'simulate').mockImplementation((inputScene, inputRequest) => {
      const result = actual(inputScene, inputRequest)
      result.trace = { traceId: inputRequest.trace.traceId }
      return result
    })
    const output = simulateScene(scene, entry, 'trace-only-result', 'trace-only-result')
    expect(output.simulation.verification.status).toBe('passed')
    expect(output.simulation.trace).toEqual({ traceId: output.request.trace.traceId })
    expect(output.simulation.verification.checks.some(check => check.id === 'simulation_result_trace')).toBe(false)
  })

  it('does not turn a status-only guard into a numerical verification family', () => {
    const scene = magneticScene()
    const output = simulateScene(scene, entryOf(scene), 'default-magnetic', 'default-magnetic')
    expect(output.simulation.verification.checks.find(check => check.id === 'engine_verification')).toBeUndefined()
    expect(output.simulation.verification.level).toBe('STRONGLY_VERIFIED')
  })

  it('accepts genuine fractional output count hints while keeping the engine storage cap', () => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    expect(simulateScene(scene, entry, 'fractional', 'fractional', { outputSampleRate: 7.5 }).request.options.outputSampleRate).toBe(7.5)
    expect(simulateScene(scene, entry, 'fractional', 'fractional', { outputSampleRate: 7.5 }).simulation.states).toHaveLength(7)
    const capped = simulateScene(scene, entry, 'capped', 'capped', { outputSampleRate: 1e6 })
    expect(capped.simulation.states.length).toBeLessThanOrEqual(1024)
  })

  it.each([
    { outputSampleRate: 0 }, { outputSampleRate: -1 }, { outputSampleRate: NaN }, { outputSampleRate: Infinity }, { outputSampleRate: '7' },
    { startTime: -1 }, { startTime: { value: -1, unit: 'ms', dimension: 'time' } },
    { startTime: { value: '1', unit: 's', dimension: 'time' } },
    { startTime: { value: 1, unit: 'm', dimension: 'length' } },
    { endTime: { value: Infinity, unit: 's', dimension: 'time' } },
    { startTime: { value: 2, unit: 's', dimension: 'time' }, endTime: { value: 1, unit: 's', dimension: 'time' } },
    { timeStep: { value: 0, unit: 's', dimension: 'time' } },
    { solver: 1 }, { solver: '' }, { tolerance: null }, { tolerance: { absolute: -1, relative: 0 } },
    { tolerance: { absolute: 1, relative: NaN } }, { tolerance: { absolute: 1 } },
    { maxIterations: 1.5 }, { maxIterations: 0 }, { randomSeed: 0.5 }, { randomSeed: Infinity },
    { unrecognizedOption: 1 }, { startTime: { value: 1, unit: 's', dimension: 'time', extra: 1 } },
    null, [], 'defaults',
  ])('rejects illegal raw option shape %j before dispatching', options => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'illegal-options', 'illegal-options')
    request.options = options as unknown as SimulationOptions
    const spy = vi.spyOn(entry.engine, 'simulate')
    expect(() => simulateScene(scene, entry, request)).toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects accessor and non-enumerable options instead of reading or dropping them', () => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    const spy = vi.spyOn(entry.engine, 'simulate')
    let accessed = false
    const accessor = Object.defineProperty({}, 'startTime', { enumerable: true, get: () => { accessed = true; return quantity(1, 's', 'time') } })
    expect(() => simulateScene(scene, entry, 'accessor', 'accessor', accessor)).toThrow()
    expect(accessed).toBe(false)
    const hidden = Object.defineProperty({}, 'startTime', { enumerable: false, value: quantity(1, 's', 'time') })
    expect(() => simulateScene(scene, entry, 'non-enumerable', 'non-enumerable', hidden)).toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects illegal scene/request revision %s rather than repairing it',
    revision => {
      const scene = mechanicsScene()
      scene.revision = revision
      const entry = entryOf(mechanicsScene())
      const request = entry.createRequest(scene, 'revision', 'revision')
      const spy = vi.spyOn(entry.engine, 'simulate')
      expect(() => simulateScene(scene, entry, request)).toThrow()
      expect(request.sceneRevision).toBe(revision)
      expect(spy).not.toHaveBeenCalled()
    },
  )

  it.each(['scene', 'revision', 'domain', 'trace-scene', 'trace-revision', 'schema', 'simulation-id'] as const)(
    'rejects mismatched raw request %s without changing its identity',
    mismatch => {
      const scene = mechanicsScene()
      const entry = entryOf(scene)
      const request = entry.createRequest(scene, 'bad-request', 'bad-request')
      if (mismatch === 'scene') request.sceneId = 'foreign' as SimulationRequest['sceneId']
      if (mismatch === 'revision') request.sceneRevision += 1
      if (mismatch === 'domain') request.requestedDomain = 'magnetic'
      if (mismatch === 'trace-scene') request.trace.sceneId = 'foreign' as SimulationRequest['sceneId']
      if (mismatch === 'trace-revision') request.trace.sceneRevision = request.sceneRevision + 1
      if (mismatch === 'schema') Reflect.set(request, 'schemaVersion', 'simulation-request/2.0')
      if (mismatch === 'simulation-id') Reflect.set(request, 'simulationId', '')
      const original = structuredClone(request)
      const spy = vi.spyOn(entry.engine, 'simulate')
      expect(() => simulateScene(scene, entry, request)).toThrow()
      expect(request).toEqual(original)
      expect(spy).not.toHaveBeenCalled()
    },
  )

  it('keeps real acoustic wave and fluid mechanics hints instead of comparing them to teaching shelves', () => {
    const echo = createEchoRangingScene({ now })
    const echoEntry = entryOf(echo)
    const echoRequest = echoEntry.createRequest(echo, 'echo', 'echo')
    expect(echoRequest.requestedDomain).toBe('wave')
    expect(simulateScene(echo, echoEntry, echoRequest).simulation.verification.status).not.toBe('failed')
    const fluid = createSolidPressureScene()
    const fluidEntry = entryOf(fluid)
    const fluidRequest = fluidEntry.createRequest(fluid, 'fluid', 'fluid')
    expect(fluidRequest.requestedDomain).toBe('mechanics')
    expect(simulateScene(fluid, fluidEntry, fluidRequest).simulation.verification.status).not.toBe('failed')
  })

  it.each(['revision', 'scene', 'simulation-id', 'trace-id', 'trace-revision', 'engine'] as const)(
    'marks a mismatched returned result %s failed without discarding raw states',
    mismatch => {
      const scene = mechanicsScene()
      const entry = entryOf(scene)
      const request = entry.createRequest(scene, 'returned', 'returned')
      const actual = entry.engine.simulate.bind(entry.engine)
      let returned: SimulationResult | undefined
      vi.spyOn(entry.engine, 'simulate').mockImplementation((inputScene, inputRequest) => {
        returned = actual(inputScene, inputRequest)
        if (mismatch === 'revision') returned.sceneRevision += 1
        if (mismatch === 'scene') returned.sceneId = 'foreign' as SimulationRequest['sceneId']
        if (mismatch === 'simulation-id') returned.simulationId = 'foreign' as SimulationRequest['simulationId']
        if (mismatch === 'trace-id') returned.trace = { traceId: 'foreign' as SimulationRequest['trace']['traceId'] }
        if (mismatch === 'trace-revision') returned.trace = { ...returned.trace, sceneRevision: inputScene.revision + 1 }
        if (mismatch === 'engine') returned.metadata.engineId = 'foreign-engine'
        return returned
      })
      const output = simulateScene(scene, entry, request)
      expect(output.simulation.verification.status).toBe('failed')
      expect(output.simulation.verification.checks.some(check => check.id.startsWith('simulation_result_') && !check.passed)).toBe(true)
      expect(output.simulation.states).toBe(returned?.states)
      expect(output.request).toBe(request)
    },
  )

  it.each([null, 'verification', 'states', 'null-check', 'null-issue', 'array-status'] as const)(
    'reports malformed returned envelope %s explicitly and keeps the actual raw value in diagnostic details', malformed => {
      const scene = createPhotoelectricEffectScene({ now })
      const entry = entryOf(scene)
      const actual = entry.engine.simulate.bind(entry.engine)
      let returned: unknown
      vi.spyOn(entry.engine, 'simulate').mockImplementation((inputScene, inputRequest) => {
        returned = malformed === null ? null : actual(inputScene, inputRequest)
        if (returned !== null) {
          if (malformed === 'verification') Reflect.set(returned as object, 'verification', { status: 'passed', checks: null, warnings: [], errors: [] })
          if (malformed === 'states') Reflect.set(returned as object, 'states', null)
          if (malformed === 'null-check') Reflect.set((returned as SimulationResult).verification, 'checks', [null])
          if (malformed === 'null-issue') Reflect.set((returned as SimulationResult).verification, 'errors', [null])
          if (malformed === 'array-status') Reflect.set((returned as SimulationResult).verification, 'status', ['passed'])
        }
        return returned as SimulationResult
      })
      let caught: unknown
      try {
        simulateScene(scene, entry, 'malformed', 'malformed')
      } catch (error: unknown) {
        caught = error
      }
      expect(caught).toMatchObject({ code: 'INVALID_SIMULATION_RESULT' })
      expect((caught as { details: { rawResult: unknown } }).details.rawResult).toBe(returned)
    },
  )

  it('preserves failed raw diagnostic values without silently sanitizing or promoting them', () => {
    const scene = createPhotoelectricEffectScene({ now })
    const entry = entryOf(scene)
    const actual = entry.engine.simulate.bind(entry.engine)
    vi.spyOn(entry.engine, 'simulate').mockImplementation((inputScene, inputRequest) => {
      const result = actual(inputScene, inputRequest)
      result.verification = { status: 'failed', checks: [{ id: 'nonfinite-diagnostic', type: 'constraint', passed: false, details: { expected: Infinity, actual: 1 } }], errors: [], warnings: [] }
      return result
    })
    const result = simulateScene(scene, entry, 'nonfinite-diagnostic', 'nonfinite-diagnostic').simulation
    expect(result.verification.status).toBe('failed')
    expect(result.verification.checks.find(check => check.id === 'nonfinite-diagnostic')?.details?.expected).toBe(Infinity)
    expect(result.verification.checks.find(check => check.id === 'simulation_result_finite')?.passed).toBe(false)
  })

  it('retains non-finite numeric engine evidence as failed raw data instead of coercing it', () => {
    const scene = createPhotoelectricEffectScene({ now })
    const entry = entryOf(scene)
    const actual = entry.engine.simulate.bind(entry.engine)
    vi.spyOn(entry.engine, 'simulate').mockImplementation((inputScene, inputRequest) => {
      const result = actual(inputScene, inputRequest)
      Reflect.set(result.derivedQuantities[0]!.value, 'value', NaN)
      return result
    })
    const result = simulateScene(scene, entry, 'nonfinite-value', 'nonfinite-value').simulation
    expect(result.verification.status).toBe('failed')
    expect(derivedScalar(result.derivedQuantities, 'photon_energy').value).toBeNaN()
    expect(result.verification.checks.find(check => check.id === 'simulation_result_finite')?.passed).toBe(false)
  })

  it('fails a contradictory successful verdict from a non-independent engine without dropping its real check', () => {
    const scene = createPhotoelectricEffectScene({ now })
    const entry = entryOf(scene)
    const actual = entry.engine.simulate.bind(entry.engine)
    vi.spyOn(entry.engine, 'simulate').mockImplementation((inputScene, inputRequest) => {
      const result = actual(inputScene, inputRequest)
      result.verification.checks.push({ id: 'non-independent-failure', type: 'constraint', passed: false })
      return result
    })
    const result = simulateScene(scene, entry, 'contradictory', 'contradictory').simulation
    expect(result.verification.status).toBe('failed')
    expect(result.verification.checks.find(check => check.id === 'non-independent-failure')?.passed).toBe(false)
    expect(result.verification.checks.find(check => check.id === 'simulation_result_verdict')?.passed).toBe(false)
  })

  it('does not erase a failed engine verdict even when independent mechanics checks pass', () => {
    const scene = mechanicsScene()
    const entry = entryOf(scene)
    const actual = entry.engine.simulate.bind(entry.engine)
    vi.spyOn(entry.engine, 'simulate').mockImplementation((inputScene, inputRequest) => {
      const result = actual(inputScene, inputRequest)
      result.verification = {
        status: 'failed',
        checks: [{ id: 'engine-truth-failure', type: 'constraint', passed: false }],
        warnings: [], errors: [],
      }
      return result
    })
    const result = simulateScene(scene, entry, 'failed-engine', 'failed-engine').simulation
    expect(result.verification.status).toBe('failed')
    expect(result.verification.checks.find(check => check.id === 'engine-truth-failure')?.passed).toBe(false)
    expect(result.verification.checks.find(check => check.id === 'engine_verification')?.passed).toBe(false)
    expect(result.verification.checks.find(check => check.id === 'mechanics_kinematic_consistency')?.passed).toBe(true)
  })
})

describe('engine-owned execution preflight', () => {
  it('plans the actual magnetic natural period without running stateAt or simulate or rewriting an empty-options request', () => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'planned', 'planned')
    const before = structuredClone(request)
    const simulate = vi.spyOn(entry.engine, 'simulate')
    const stateAt = vi.spyOn(entry.engine, 'stateAt')
    const plan = getSimulationPlan(scene, entry, request)
    expect(plan).toMatchObject({ engineId: entry.engine.engineId, engineVersion: entry.engine.engineVersion, sceneId: scene.id, sceneRevision: scene.revision, simulationId: request.simulationId, kind: 'analytic', startTime: 0, storageSampleCountBound: 65, numericalIterationCountBound: 0 })
    expect(plan.endTime).toBeCloseTo(2 * Math.PI, 12)
    expect(request).toEqual(before)
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })

  it('reports a very large true default magnetic period instead of replacing it with a safe-looking limit', () => {
    const scene = magneticScene()
    scene.particles[0]!.mass = quantity(1e6, 'kg', 'mass')
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'large-period', 'large-period')
    const simulate = vi.spyOn(entry.engine, 'simulate')
    const plan = getSimulationPlan(scene, entry, request)
    expect(plan.endTime).toBeGreaterThan(86400)
    expect(plan.endTime).toBeCloseTo(2 * Math.PI * 1e6, 6)
    expect(plan.storageSampleCountBound).toBeLessThanOrEqual(1024)
    expect(simulate).not.toHaveBeenCalled()
    expect(request.options).toEqual({})
  })

  it('bounds the real magnetic window and final protected sample storage for non-SI options', () => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'bounded-window', 'bounded-window')
    request.options = { startTime: quantity(200, 'ms', 'time'), endTime: quantity(1500, 'ms', 'time'), outputSampleRate: 1e6 }
    const before = structuredClone(request)
    const plan = getSimulationPlan(scene, entry, request)
    const result = entry.engine.simulate(scene, request)
    expect(plan.startTime).toBe(0.2)
    expect(plan.endTime).toBe(1.5)
    expect(plan.storageSampleCountBound).toBe(result.states.length)
    expect(plan.storageSampleCountBound).toBeLessThanOrEqual(1024)
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(request).toEqual(before)
  })

  it('plans unchanged modern readings using the real requested range and existing output count contract', () => {
    const scene = createPhotoelectricEffectScene({ now })
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'modern-plan', 'modern-plan')
    request.options = { startTime: quantity(100, 'ms', 'time'), endTime: quantity(200, 'ms', 'time'), outputSampleRate: 7 }
    const before = structuredClone(request)
    const simulate = vi.spyOn(entry.engine, 'simulate')
    const plan = getSimulationPlan(scene, entry, request)
    expect(plan).toMatchObject({ kind: 'static', modelId: 'photoelectric_effect', startTime: 0.1, endTime: 0.2, storageSampleCountBound: 7, numericalIterationCountBound: 0 })
    expect(simulate).not.toHaveBeenCalled()
    expect(request).toEqual(before)
    expect(entry.engine.simulate(scene, request).states).toHaveLength(plan.storageSampleCountBound)
  })

  it('rejects illegal or stale request values before asking the engine for a plan', () => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'stale-plan', 'stale-plan')
    request.sceneRevision += 1
    const prepare = vi.spyOn(entry.engine, 'prepareSimulationPlan')
    expect(() => getSimulationPlan(scene, entry, request)).toThrow()
    expect(prepare).not.toHaveBeenCalled()
    request.sceneRevision = scene.revision
    request.options = { timeStep: quantity(0, 'ms', 'time') }
    expect(() => getSimulationPlan(scene, entry, request)).toThrow()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects a plan that collapses an explicit requested window while preserving all identities', () => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'plan-range-mismatch', 'plan-range-mismatch')
    request.options = { startTime: quantity(100, 'ms', 'time'), endTime: quantity(200, 'ms', 'time') }
    const actual = entry.engine.prepareSimulationPlan!.bind(entry.engine)
    vi.spyOn(entry.engine, 'prepareSimulationPlan').mockImplementation((inputScene, inputRequest) => ({ ...actual(inputScene, inputRequest), endTime: 0.1 }))
    expect(() => getSimulationPlan(scene, entry, request)).toThrow(/plan must match/)
  })

  it('rejects an inexact plan end for an explicit requested window even when the bounds match', () => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'explicit-inexact-plan', 'explicit-inexact-plan')
    request.options = { startTime: quantity(100, 'ms', 'time'), endTime: quantity(200, 'ms', 'time') }
    const before = structuredClone(request)
    const actual = entry.engine.prepareSimulationPlan!.bind(entry.engine)
    vi.spyOn(entry.engine, 'prepareSimulationPlan').mockImplementation((inputScene, inputRequest) => ({
      ...actual(inputScene, inputRequest), kind: 'iterative', endTimeExact: false,
    }))
    expect(() => getSimulationPlan(scene, entry, request)).toThrow(/plan must match/)
    expect(request).toEqual(before)
  })

  it.each(['analytic', 'static'] as const)('rejects an inexact default end for a %s plan', kind => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, `inexact-${kind}`, `inexact-${kind}`)
    const actual = entry.engine.prepareSimulationPlan!.bind(entry.engine)
    vi.spyOn(entry.engine, 'prepareSimulationPlan').mockImplementation((inputScene, inputRequest) => ({
      ...actual(inputScene, inputRequest), kind, endTimeExact: false,
    }))
    expect(() => getSimulationPlan(scene, entry, request)).toThrow(/plan must match/)
  })

  it('accepts an engine-owned inexact default end only for an iterative plan without solving or changing the request', () => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'iterative-bound', 'iterative-bound')
    const before = structuredClone(request)
    const actual = entry.engine.prepareSimulationPlan!.bind(entry.engine)
    vi.spyOn(entry.engine, 'prepareSimulationPlan').mockImplementation((inputScene, inputRequest) => ({
      ...actual(inputScene, inputRequest), kind: 'iterative', endTimeExact: false,
      metadata: { endBound: 'event-driven default upper bound' },
    }))
    const simulate = vi.spyOn(entry.engine, 'simulate')
    const plan = getSimulationPlan(scene, entry, request)
    expect(plan.kind).toBe('iterative')
    expect(plan.endTimeExact).toBe(false)
    expect(plan.endTime).toBeCloseTo(2 * Math.PI, 12)
    expect(plan.metadata).toEqual({ endBound: 'event-driven default upper bound' })
    expect(request).toEqual(before)
    expect(simulate).not.toHaveBeenCalled()
  })

  it('rejects mismatched plans instead of substituting request or scene defaults', () => {
    const scene = magneticScene()
    const entry = entryOf(scene)
    const request = entry.createRequest(scene, 'plan-mismatch', 'plan-mismatch')
    const actual = entry.engine.prepareSimulationPlan!.bind(entry.engine)
    vi.spyOn(entry.engine, 'prepareSimulationPlan').mockImplementation((inputScene, inputRequest) => ({ ...actual(inputScene, inputRequest), sceneRevision: inputScene.revision + 1 }))
    expect(() => getSimulationPlan(scene, entry, request)).toThrow(/plan must match/)
  })
})

describe('shared dispatch engine coverage and magnetic windows', () => {
  it('preserves explicit mechanics and collision question capability routing from the working baseline', () => {
    expect(questionEngine('mechanics', 'one_dimensional_collision')?.engineId).toBe('engine-collision')
    expect(questionEngine('mechanics', 'circular_orbit')?.engineId).toBe('engine-mechanics')
    expect(questionEngine('mechanics', 'unknown-mechanics-model')).toBeUndefined()
  })

  it('preserves all 22 registered engine/request pairs through actual supplied-request dispatch', () => {
    const covered = new Set<string>()
    for (const scene of engineFixtures) {
      const entry = entryOf(scene)
      if (covered.has(entry.engine.engineId)) continue
      const request = entry.createRequest(scene, `coverage-${entry.engine.engineId}`, 'coverage')
      request.options = {
        startTime: quantity(100, 'ms', 'time'), endTime: quantity(200, 'ms', 'time'), outputSampleRate: 7,
      }
      const output = simulateScene(scene, entry, request)
      expect(output.request).toBe(request)
      expect(output.simulation.verification.status, `${output.engineId}: ${output.simulation.verification.errors.map(error => error.message).join('; ')}`).not.toBe('failed')
      expect(canonicalValue(output.simulation.states[0]!.time), output.engineId).toBeCloseTo(0.1, 12)
      expect(output.simulation.states.length, output.engineId).toBeGreaterThan(0)
      expect(output.simulation.states.length, output.engineId).toBeLessThanOrEqual(1024)
      for (const event of output.simulation.events) {
        if (event.time === undefined) continue
        expect(event.time).toBeGreaterThanOrEqual(0.1)
        expect(event.time).toBeLessThanOrEqual(0.2)
      }
      covered.add(output.engineId)
    }
    expect(ENGINES).toHaveLength(22)
    expect(ENGINE_CAPABILITIES).toHaveLength(22)
    expect([...covered].sort()).toEqual(ENGINES.map(entry => entry.engine.engineId).sort())
  })

  it.each([[0.1, 0.2], [0.8, 1.2], [0.2, 1.2]] as const)(
    'simulates [%sT, %sT] and independently checks absolute magnetic positions',
    (startFraction, endFraction) => {
      const scene = magneticScene()
      const entry = entryOf(scene)
      const period = 2 * Math.PI
      const request = entry.createRequest(scene, 'magnetic-subrange', 'magnetic-subrange')
      request.options = {
        startTime: quantity(startFraction * period * 1000, 'ms', 'time'),
        endTime: quantity(endFraction * period * 1000, 'ms', 'time'), outputSampleRate: 7,
      }
      const output = simulateScene(scene, entry, request)
      const time = canonicalValue(output.simulation.states[0]!.time)
      expect(firstX(output.simulation)).toBeCloseTo(3 - Math.cos(time) + 2 * Math.sin(time), 12)
      expect(output.simulation.verification.status).not.toBe('failed')
      expect(output.simulation.verification.checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(true)
      expect(output.simulation.states.every(state => canonicalValue(state.time) >= canonicalValue(request.options.startTime!) && canonicalValue(state.time) <= canonicalValue(request.options.endTime!))).toBe(true)
      expect(derivedScalar(output.simulation.derivedQuantities, 'cyclotron_period').value).toBeCloseTo(period, 12)
    },
  )

  it('recomputes actual orbital speed and period after genuine radius and SI GM commands', () => {
    const source = createMechanicsScene({ model: 'circular_orbit', orbitRadius: 2, gravitationalParameter: 32, mass: 3, now })
    const runtime = new SceneRuntime(source, { now: () => now })
    const observableId = source.observableDefinitions.find(observable => observable.parameters?.kind === 'orbit')!.id
    const editRadius = runtime.execute(createSceneCommand({
      commandId: 'radius', sceneId: source.id, expectedRevision: source.revision,
      type: 'SetOrbitRadius', payload: { observableId, radius: quantity(8, 'm', 'length') }, traceId: 'radius', issuedAt: now,
    }))
    expect(editRadius.ok).toBe(true)
    let scene = runtime.getScene()
    let result = simulateScene(scene, entryOf(scene), 'radius-sim', 'radius-sim').simulation
    expect(derivedScalar(result.derivedQuantities, 'orbital_speed').value).toBe(2)
    expect(derivedScalar(result.derivedQuantities, 'orbital_period').value).toBeCloseTo(8 * Math.PI, 12)
    expect(result.states[0]!.objects[0]!.position!.vector).toEqual({ x: 8, y: 0, z: 0 })
    expect(result.verification.status).not.toBe('failed')
    expect(runtime.execute(createSceneCommand({
      commandId: 'gm', sceneId: scene.id, expectedRevision: scene.revision,
      type: 'SetOrbitalGravitationalParameter', payload: { observableId, gravitationalParameter: 128 }, traceId: 'gm', issuedAt: now,
    })).ok).toBe(true)
    scene = runtime.getScene()
    result = simulateScene(scene, entryOf(scene), 'gm-sim', 'gm-sim').simulation
    expect(derivedScalar(result.derivedQuantities, 'orbital_speed').value).toBe(4)
    expect(derivedScalar(result.derivedQuantities, 'orbital_period').value).toBeCloseTo(4 * Math.PI, 12)
    expect(result.verification.status).not.toBe('failed')
  })

  it('recomputes true normal-incidence refraction after a zero-angle scene command', () => {
    const source = createTotalReflectionScene({ incidentAngle: 45, now })
    const runtime = new SceneRuntime(source, { now: () => now })
    const result = runtime.execute(createSceneCommand({
      commandId: 'normal-incidence', sceneId: source.id, expectedRevision: source.revision,
      type: 'SetIncidentAngle', payload: { benchId: source.lightBenches![0]!.id, angle: quantity(0, 'deg', 'angle') },
      traceId: 'normal-incidence', issuedAt: now,
    }))
    expect(result.ok).toBe(true)
    const scene = runtime.getScene()
    const simulation = simulateScene(scene, entryOf(scene), 'normal-incidence-sim', 'normal-incidence-sim').simulation
    expect(derivedScalar(simulation.derivedQuantities, 'incident_angle').value).toBe(0)
    expect(derivedScalar(simulation.derivedQuantities, 'refracted_angle').value).toBe(0)
    expect(derivedScalar(simulation.derivedQuantities, 'total_internal_reflection').value).toBe(1)
    expect(simulation.verification.status).toBe('passed')
    expect(source.lightBenches![0]!.incidentAngle!.value).toBe(45)
  })

  it('passes genuine photoelectric edits through the same request dispatch without fake derived values', () => {
    const scene = createPhotoelectricEffectScene({ photonWavelengthNm: 300, workFunctionEv: 2.5, lightIntensity: 20, cathodeArea: 2e-4, quantumEfficiency: 0.25, now })
    const entry = entryOf(scene)
    const result = simulateScene(scene, entry, 'photoelectric', 'photoelectric', {
      startTime: quantity(100, 'ms', 'time'), endTime: quantity(200, 'ms', 'time'), outputSampleRate: 7,
    }).simulation
    const photonEnergy = 6.62607015e-34 * 2.99792458e8 / 300e-9
    expect(derivedScalar(result.derivedQuantities, 'photon_energy').value).toBeCloseTo(photonEnergy, 31)
    expect(derivedScalar(result.derivedQuantities, 'max_kinetic_energy').value).toBeCloseTo(photonEnergy - 2.5 * 1.602176634e-19, 31)
    expect(derivedScalar(result.derivedQuantities, 'photocurrent').value).toBeCloseTo(0.25 * 1.602176634e-19 * 20 * 2e-4 / photonEnergy, 14)
    expect(result.verification.status).toBe('passed')
    expect(result.states).toHaveLength(7)
  })
})
