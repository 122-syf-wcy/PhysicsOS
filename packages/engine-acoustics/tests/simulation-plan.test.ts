import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertSimulationPlan,
  derivedScalar,
  type SimulationOptions,
  type SimulationPlan,
  type SimulationResult,
} from '@physicsos/physics-core'
import * as sceneFunctions from '@physicsos/physics-scene'
import {
  createEchoRangingScene,
  createNoiseBarrierScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'

import {
  ACOUSTICS_ENGINE_ID,
  ACOUSTICS_ENGINE_VERSION,
  ECHO_RANGING_MODEL,
  AcousticsEngine,
  acousticsEngine,
  createAcousticsSimulationRequest,
} from '../src/acoustics-engine.ts'
import {
  NOISE_ENGINE_ID,
  NOISE_ENGINE_VERSION,
  POINT_SOURCE_NOISE_MODEL,
  NoiseEngine,
  createNoiseSimulationRequest,
  noiseEngine,
} from '../src/noise-engine.ts'
import * as echoFunctions from '../src/echo.ts'
import * as noiseFunctions from '../src/noise.ts'

const NOW = '2026-11-08T00:00:00.000Z'
const echoScene = (wallDistance = 340, soundSpeed = 340): PhysicsScene =>
  createEchoRangingScene({ sceneId: 'plan-echo', wallDistance, soundSpeed, now: NOW })
const noiseScene = (): PhysicsScene =>
  createNoiseBarrierScene({ sceneId: 'plan-noise', now: NOW })

const expectExecutionBounds = (plan: SimulationPlan, result: SimulationResult): void => {
  expect(() => assertSimulationPlan(plan)).not.toThrow()
  expect(Number.isFinite(plan.startTime)).toBe(true)
  expect(Number.isFinite(plan.endTime)).toBe(true)
  expect(Number.isSafeInteger(plan.storageSampleCountBound)).toBe(true)
  expect(Number.isSafeInteger(plan.numericalIterationCountBound)).toBe(true)
  expect(plan.numericalIterationCountBound).toBe(0)
  expect(plan.endTimeExact).not.toBe(false)
  expect(plan.metadata?.numericalIterationAccounting).toEqual(expect.stringContaining('No numerical integration'))
  expect(result.states).toHaveLength(plan.storageSampleCountBound)
  expect(result.states[0]?.time.unit).toBe('s')
  const times = result.states.map((state) => canonicalValue(state.time))
  expect(times[0]).toBe(plan.startTime)
  if (plan.kind === 'analytic') expect(times.at(-1)).toBeCloseTo(plan.endTime, 9)
  expect(times.every((time) => Number.isFinite(time) && time >= plan.startTime && time <= plan.endTime)).toBe(true)
  expect(result.events.every((event) => event.time === undefined || (event.time >= plan.startTime && event.time <= plan.endTime))).toBe(true)
  expect(result.verification.status).toBe('passed')
}

const refusalCodeOf = (action: () => unknown): string => {
  try {
    action()
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) return String(error.code)
    throw error
  }
  throw new Error('Expected the engine to refuse the request.')
}

afterEach(() => vi.restoreAllMocks())

describe('AcousticsEngine simulation planning', () => {
  it.each([
    [340, 340, 2],
    [510, 340, 3],
    [750, 1500, 1],
  ] as const)('uses the actual echo flight time for distance %s and speed %s', (distance, speed, endTime) => {
    const scene = echoScene(distance, speed)
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-echo', 'trace-plan-echo')
    expect(request.options).toEqual({})
    const plan = acousticsEngine.prepareSimulationPlan(scene, request)
    const result = acousticsEngine.simulate(scene, request)
    expect(plan).toEqual({
      schemaVersion: 'simulation-plan/1.0',
      engineId: ACOUSTICS_ENGINE_ID,
      engineVersion: ACOUSTICS_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      modelId: ECHO_RANGING_MODEL,
      kind: 'analytic',
      startTime: 0,
      endTime,
      storageSampleCountBound: 65,
      numericalIterationCountBound: 0,
      metadata: {
        numericalIterationAccounting:
          'No numerical integration; closed-form sampling. Fixed echo verification probes are excluded.',
      },
    })
    expectExecutionBounds(plan, result)
    expect(result.events.map((event) => event.time)).toEqual([0, endTime / 2, endTime])
    expect(derivedScalar(result.derivedQuantities, 'echo_time')).toEqual(quantity(endTime, 's', 'time'))
    expect(derivedScalar(result.derivedQuantities, 'measured_distance').value).toBeCloseTo(distance, 9)
  })

  it('canonicalizes non-SI apparatus and time options without changing the requested window', () => {
    const base = echoScene()
    const bench = base.acousticBenches?.[0]
    if (bench === undefined) throw new Error('Expected an echo bench.')
    const scene: PhysicsScene = {
      ...base,
      acousticBenches: [{
        ...bench,
        source: { ...bench.source, position: quantity(-200, 'cm', 'length') },
        reflector: { ...bench.reflector, position: quantity(0.748, 'km', 'length') },
        soundSpeed: quantity(1.5, 'km/s', 'velocity'),
      }],
    }
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-units', 'trace-plan-units')
    request.options = {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(750, 'ms', 'time'),
      outputSampleRate: 5,
    }
    const before = JSON.stringify({ scene, request })
    const plan = acousticsEngine.prepareSimulationPlan(scene, request)
    expect(JSON.stringify({ scene, request })).toBe(before)
    const result = acousticsEngine.simulate(scene, request)
    expect(plan).toMatchObject({ startTime: 0.25, endTime: 0.75, storageSampleCountBound: 5 })
    expectExecutionBounds(plan, result)
    expect(result.states.map((state) => state.time.value)).toEqual([0.25, 0.375, 0.5, 0.625, 0.75])
    expect(result.events.map((event) => [event.type, event.time])).toEqual([['PulseReflected', 0.5]])
    expect(derivedScalar(result.derivedQuantities, 'wall_distance')).toEqual(quantity(750, 'm', 'length'))
    expect(derivedScalar(result.derivedQuantities, 'echo_time')).toEqual(quantity(1, 's', 'time'))
  })

  it.each([
    [3, 3],
    [7.9, 7],
    [0, 2],
    [-50, 2],
    [1e12, 1024],
    [Number.NaN, 65],
    [Number.POSITIVE_INFINITY, 65],
  ] as const)('reports outputSampleRate %s as the actual capped count %s, not hertz', (requested, count) => {
    const scene = echoScene()
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-count', 'trace-plan-count')
    request.options = { endTime: quantity(10, 's', 'time'), outputSampleRate: requested }
    const plan = acousticsEngine.prepareSimulationPlan(scene, request)
    const result = acousticsEngine.simulate(scene, request)
    expect(plan.storageSampleCountBound).toBe(count)
    expectExecutionBounds(plan, result)
  })

  it('keeps the default end absolute and ignores unrelated scene timeline defaults', () => {
    const base = echoScene()
    const scene: PhysicsScene = {
      ...base,
      timeline: { ...base.timeline, endTime: quantity(90, 's', 'time') },
    }
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-start', 'trace-plan-start')
    request.options = { startTime: quantity(500, 'ms', 'time'), outputSampleRate: 3 }
    const plan = acousticsEngine.prepareSimulationPlan(scene, request)
    const result = acousticsEngine.simulate(scene, request)
    expect(plan).toMatchObject({ startTime: 0.5, endTime: 2, storageSampleCountBound: 3 })
    expectExecutionBounds(plan, result)
    expect(result.states.map((state) => state.time.value)).toEqual([0.5, 1.25, 2])
    request.options = { startTime: quantity(3, 's', 'time') }
    expect(refusalCodeOf(() => acousticsEngine.prepareSimulationPlan(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(refusalCodeOf(() => acousticsEngine.simulate(scene, request))).toBe('INVALID_SIMULATION_RANGE')
  })

  it('does not collapse a zero-length analytic window to a single state', () => {
    const scene = echoScene()
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-instant', 'trace-plan-instant')
    request.options = {
      startTime: quantity(1, 's', 'time'),
      endTime: quantity(1000, 'ms', 'time'),
      outputSampleRate: 4,
    }
    const plan = acousticsEngine.prepareSimulationPlan(scene, request)
    const result = acousticsEngine.simulate(scene, request)
    expect(plan).toMatchObject({ startTime: 1, endTime: 1, storageSampleCountBound: 4 })
    expectExecutionBounds(plan, result)
    expect(result.states.map((state) => state.time.value)).toEqual([1, 1, 1, 1])
    expect(result.events.map((event) => event.type)).toEqual(['PulseReflected'])
  })

  it('allows an explicitly sparse long analytic run without inventing an iteration budget', () => {
    const scene = echoScene()
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-long', 'trace-plan-long')
    request.options = {
      startTime: quantity(1e9, 's', 'time'),
      endTime: quantity(1e12, 's', 'time'),
      outputSampleRate: 3,
      timeStep: quantity(1, 'us', 'time'),
      maxIterations: 1,
    }
    const plan = acousticsEngine.prepareSimulationPlan(scene, request)
    const result = acousticsEngine.simulate(scene, request)
    expect(plan).toMatchObject({ kind: 'analytic', startTime: 1e9, endTime: 1e12, storageSampleCountBound: 3, numericalIterationCountBound: 0 })
    expectExecutionBounds(plan, result)
    expect(result.events).toEqual([])
    expect(result.states[0]?.objects).toEqual(result.states.at(-1)?.objects)
  })

  it('can plan a finite enormous window without allocating or multiplying sample times', () => {
    const scene = echoScene()
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-finite', 'trace-plan-finite')
    request.options = { endTime: quantity(Number.MAX_VALUE, 's', 'time'), outputSampleRate: 2 }
    const sampler = vi.spyOn(sceneFunctions, 'trajectorySampleTimes').mockImplementation(() => { throw new Error('Planning must not sample.') })
    const plan = acousticsEngine.prepareSimulationPlan(scene, request)
    expect(plan.endTime).toBe(Number.MAX_VALUE)
    expect(plan.storageSampleCountBound).toBe(2)
    expect(() => assertSimulationPlan(plan)).not.toThrow()
    expect(sampler).not.toHaveBeenCalled()
  })

  it('refuses nonfinite physical echo timing even when a finite explicit end hides the default', () => {
    const scene = echoScene(1e308, 1)
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-echo-overflow', 'trace-plan-echo-overflow')
    request.options = { endTime: quantity(1, 's', 'time'), outputSampleRate: 2 }
    const sampler = vi.spyOn(sceneFunctions, 'trajectorySampleTimes')
    const pulse = vi.spyOn(echoFunctions, 'pulseStateAt')
    expect(refusalCodeOf(() => acousticsEngine.prepareSimulationPlan(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(refusalCodeOf(() => acousticsEngine.simulate(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(sampler).not.toHaveBeenCalled()
    expect(pulse).not.toHaveBeenCalled()
  })

  it('the planner purity spy seams observe real trajectory and verification work', () => {
    const scene = echoScene()
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-echo-spies', 'trace-plan-echo-spies')
    const sampler = vi.spyOn(sceneFunctions, 'trajectorySampleTimes')
    const validation = vi.spyOn(sceneFunctions, 'validateScene')
    const pulse = vi.spyOn(echoFunctions, 'pulseStateAt')
    acousticsEngine.simulate(scene, request)
    expect(sampler).toHaveBeenCalledWith(0, 2, 65)
    expect(validation).toHaveBeenCalledWith(scene)
    expect(pulse).toHaveBeenCalled()
  })

  it('prepares bounds without state evaluation, verification, or a simulation run', () => {
    const scene = echoScene()
    const request = createAcousticsSimulationRequest(scene, 'sim-plan-pure', 'trace-plan-pure')
    const engine = new AcousticsEngine()
    const forbidden = () => { throw new Error('Planning must only resolve model, timing, and counts.') }
    const spies = [
      vi.spyOn(sceneFunctions, 'trajectorySampleTimes').mockImplementation(forbidden),
      vi.spyOn(sceneFunctions, 'validateScene').mockImplementation(forbidden),
      vi.spyOn(echoFunctions, 'pulseStateAt').mockImplementation(forbidden),
      vi.spyOn(engine, 'stateAt').mockImplementation(forbidden),
      vi.spyOn(engine, 'simulate').mockImplementation(forbidden),
      vi.spyOn(engine, 'validate').mockImplementation(forbidden),
      vi.spyOn(engine, 'canHandle').mockImplementation(forbidden),
    ]
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({ endTime: 2, storageSampleCountBound: 65 })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('NoiseEngine simulation planning', () => {
  it('reports the one-state static default with the registered engine and model identity', () => {
    const scene = noiseScene()
    const request = createNoiseSimulationRequest(scene, 'sim-plan-noise', 'trace-plan-noise')
    expect(request.options).toEqual({})
    const plan = noiseEngine.prepareSimulationPlan(scene, request)
    const result = noiseEngine.simulate(scene, request)
    expect(plan).toEqual({
      schemaVersion: 'simulation-plan/1.0',
      engineId: NOISE_ENGINE_ID,
      engineVersion: NOISE_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      modelId: POINT_SOURCE_NOISE_MODEL,
      kind: 'static',
      startTime: 0,
      endTime: 0,
      storageSampleCountBound: 1,
      numericalIterationCountBound: 0,
      metadata: {
        numericalIterationAccounting:
          'No numerical integration; one static state. Algebraic noise readings and fixed verification checks are excluded.',
      },
    })
    expectExecutionBounds(plan, result)
    expect(result.events.map((event) => [event.type, event.time])).toEqual([['NoiseMeterReady', 0]])
    expect(derivedScalar(result.derivedQuantities, 'sound_level').value).toBeCloseTo(100 - 10 * Math.log10(4 * Math.PI) - 15, 9)
  })

  it('retains the full accepted non-SI window even though only its start is stored', () => {
    const scene = noiseScene()
    const request = createNoiseSimulationRequest(scene, 'sim-plan-noise-range', 'trace-plan-noise-range')
    request.options = {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(2, 'min', 'time'),
      outputSampleRate: 1e12,
      timeStep: quantity(1, 'us', 'time'),
      maxIterations: 1,
    }
    const plan = noiseEngine.prepareSimulationPlan(scene, request)
    const result = noiseEngine.simulate(scene, request)
    expect(plan).toMatchObject({ kind: 'static', startTime: 0.25, endTime: 120, storageSampleCountBound: 1, numericalIterationCountBound: 0 })
    expectExecutionBounds(plan, result)
    expect(result.states[0]?.time.value).toBe(0.25)
    expect(result.events).toEqual([])
    const baseline = noiseEngine.simulate(scene, createNoiseSimulationRequest(scene, 'sim-noise-baseline', 'trace-noise-baseline'))
    expect(result.states[0]?.objects).toEqual(baseline.states[0]?.objects)
    expect(result.derivedQuantities).toEqual(baseline.derivedQuantities)
    expect(result.verification).toEqual(baseline.verification)
  })

  it('uses start itself when no static end is supplied and permits a long explicit range', () => {
    const base = noiseScene()
    const scene: PhysicsScene = { ...base, timeline: { ...base.timeline, endTime: quantity(99, 's', 'time') } }
    const request = createNoiseSimulationRequest(scene, 'sim-plan-noise-start', 'trace-plan-noise-start')
    request.options = { startTime: quantity(2, 'min', 'time') }
    const plan = noiseEngine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({ startTime: 120, endTime: 120, storageSampleCountBound: 1 })
    expectExecutionBounds(plan, noiseEngine.simulate(scene, request))
    request.options = { startTime: quantity(1e9, 's', 'time'), endTime: quantity(1e12, 's', 'time'), outputSampleRate: 3 }
    const longPlan = noiseEngine.prepareSimulationPlan(scene, request)
    expect(longPlan).toMatchObject({ startTime: 1e9, endTime: 1e12, storageSampleCountBound: 1, numericalIterationCountBound: 0 })
    expectExecutionBounds(longPlan, noiseEngine.simulate(scene, request))
  })

  it('the noise purity spy seams observe actual reading and verification work', () => {
    const scene = noiseScene()
    const request = createNoiseSimulationRequest(scene, 'sim-plan-noise-spies', 'trace-plan-noise-spies')
    const reading = vi.spyOn(noiseFunctions, 'noiseReadingOf')
    const level = vi.spyOn(noiseFunctions, 'soundLevelAt')
    const validation = vi.spyOn(sceneFunctions, 'validateScene')
    noiseEngine.simulate(scene, request)
    expect(reading).toHaveBeenCalled()
    expect(level).toHaveBeenCalled()
    expect(validation).toHaveBeenCalledWith(scene)
  })

  it('does not compute noise readings, verifier checks, states, or samples while planning', () => {
    const scene = noiseScene()
    const request = createNoiseSimulationRequest(scene, 'sim-plan-noise-pure', 'trace-plan-noise-pure')
    const engine = new NoiseEngine()
    const forbidden = () => { throw new Error('Planning must not compute a noise result.') }
    const spies = [
      vi.spyOn(noiseFunctions, 'noiseReadingOf').mockImplementation(forbidden),
      vi.spyOn(noiseFunctions, 'soundLevelAt').mockImplementation(forbidden),
      vi.spyOn(noiseFunctions, 'intensityFromSoundLevel').mockImplementation(forbidden),
      vi.spyOn(sceneFunctions, 'trajectorySampleTimes').mockImplementation(forbidden),
      vi.spyOn(sceneFunctions, 'validateScene').mockImplementation(forbidden),
      vi.spyOn(engine, 'stateAt').mockImplementation(forbidden),
      vi.spyOn(engine, 'simulate').mockImplementation(forbidden),
      vi.spyOn(engine, 'validate').mockImplementation(forbidden),
      vi.spyOn(engine, 'canHandle').mockImplementation(forbidden),
    ]
    expect(engine.prepareSimulationPlan(scene, request)).toMatchObject({ startTime: 0, endTime: 0, storageSampleCountBound: 1 })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('acoustics planning and execution refusal parity', () => {
  const cases = [
    { name: 'echo', engine: acousticsEngine, scene: echoScene, request: createAcousticsSimulationRequest },
    { name: 'noise', engine: noiseEngine, scene: noiseScene, request: createNoiseSimulationRequest },
  ]

  for (const entry of cases) {
    it(`${entry.name} guards the same scene id and revision before planning or running`, () => {
      const scene = entry.scene()
      const request = entry.request(scene, `sim-${entry.name}-mismatch`, `trace-${entry.name}-mismatch`)
      const otherId = createEchoRangingScene({ sceneId: 'different-plan-scene', now: NOW }).id
      for (const changed of [{ ...scene, id: otherId }, { ...scene, revision: scene.revision + 1 }]) {
        expect(refusalCodeOf(() => entry.engine.prepareSimulationPlan(changed, request))).toBe('SIMULATION_SCENE_MISMATCH')
        expect(refusalCodeOf(() => entry.engine.simulate(changed, request))).toBe('SIMULATION_SCENE_MISMATCH')
      }
    })

    it(`${entry.name} refuses matching but unsafe scene revisions with finite plan bounds`, () => {
      for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const scene: PhysicsScene = { ...entry.scene(), revision }
        const request = entry.request(scene, `sim-${entry.name}-revision`, `trace-${entry.name}-revision`)
        expect(refusalCodeOf(() => entry.engine.prepareSimulationPlan(scene, request))).toBe('INVALID_SIMULATION_PLAN')
        expect(refusalCodeOf(() => entry.engine.simulate(scene, request))).toBe('INVALID_SIMULATION_PLAN')
      }
    })

    it(`${entry.name} refuses the same invalid requested ranges`, () => {
      const scene = entry.scene()
      const invalidOptions: SimulationOptions[] = [
        { startTime: quantity(-1, 's', 'time') },
        { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
        { endTime: { value: Number.POSITIVE_INFINITY, unit: 's', dimension: 'time' } },
      ]
      for (const options of invalidOptions) {
        const request = entry.request(scene, `sim-${entry.name}-range`, `trace-${entry.name}-range`)
        request.options = options
        const planCode = refusalCodeOf(() => entry.engine.prepareSimulationPlan(scene, request))
        expect(planCode).toBe(refusalCodeOf(() => entry.engine.simulate(scene, request)))
        expect(['INVALID_SIMULATION_RANGE', 'NON_FINITE_VALUE']).toContain(planCode)
      }
    })
  }
})
