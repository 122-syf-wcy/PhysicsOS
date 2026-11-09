import { describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, type SimulationOptions } from '@physicsos/physics-core'
import { createLeverBalanceScene, type LeverBalanceSceneInput, type PhysicsScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { asSceneId } from '@physicsos/shared'

import { LeverEngine, createLeverSimulationRequest } from '../src/lever-engine.ts'
import { resolveLeverModel } from '../src/lever-model.ts'
import { leverRunDuration } from '../src/lever-state.ts'
import * as leverState from '../src/lever-state.ts'
import {
  LEVER_INTEGRATION_STEP,
  LEVER_MAX_RUN_SECONDS,
  integrateLeverAngular,
  leverIntegrationStepCount,
  leverSettleSeconds,
  leverSettleStepCountBound,
  resolveLeverRotationalModel,
} from '../src/rotational-dynamics.ts'
import * as rotationalDynamics from '../src/rotational-dynamics.ts'

const variants: readonly { label: string; input: LeverBalanceSceneInput; balanced: boolean }[] = [
  { label: 'balanced', input: {}, balanced: true },
  { label: 'balanced with nondefault masses and arms', input: { leftMass: 400, leftArm: 7.5 }, balanced: true },
  { label: 'left-heavy', input: { leftMass: 400 }, balanced: false },
  { label: 'right-heavy', input: { rightMass: 600 }, balanced: false },
  { label: 'small-imbalance horizon fallback', input: { leftMass: 200.02 }, balanced: false },
]

const parity = (scene: PhysicsScene, options: SimulationOptions) => {
  const engine = new LeverEngine()
  const request = createLeverSimulationRequest(scene, 'lever-plan', 'lever-plan-trace')
  request.options = options
  const beforeRequest = structuredClone(request)
  const beforeScene = structuredClone(scene)
  const plan = engine.prepareSimulationPlan(scene, request)
  assertSimulationPlan(plan)
  expect(plan).toMatchObject({
    engineId: engine.engineId,
    engineVersion: engine.engineVersion,
    simulationId: request.simulationId,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    modelId: 'class_one_moment_balance',
  })
  const result = engine.simulate(scene, request)
  expect(result.states).toHaveLength(plan.storageSampleCountBound)
  expect(result.states[0]!.time.value).toBeCloseTo(plan.startTime, 12)
  if (plan.endTimeExact === false) {
    expect(result.states.at(-1)!.time.value).toBeLessThanOrEqual(plan.endTime)
  } else {
    expect(result.states.at(-1)!.time.value).toBeCloseTo(plan.endTime, 12)
  }
  expect(result.metadata.numericalIterationCount).toBeLessThanOrEqual(plan.numericalIterationCountBound)
  expect(result.events.every((event) => event.time === undefined || (event.time >= plan.startTime && event.time <= plan.endTime))).toBe(true)
  expect(request).toEqual(beforeRequest)
  expect(scene).toEqual(beforeScene)
  return { plan, result }
}

describe('engine-owned lever plans from actual angular solver caps', () => {
  it.each(variants)('bounds $label default without replacing the solved duration', ({ input, balanced }) => {
    const scene = createLeverBalanceScene(input)
    const { plan, result } = parity(scene, {})
    expect(plan.startTime).toBe(0)
    expect(plan.storageSampleCountBound).toBe(25)
    expect(plan.endTime).toBe(balanced ? 0 : LEVER_MAX_RUN_SECONDS)
    expect(plan.endTimeExact).toBe(balanced)
    expect(plan.kind).toBe(balanced ? 'static' : 'iterative')
    expect(result.states.at(-1)!.time.value).toBeCloseTo(leverRunDuration(resolveLeverModel(scene)), 12)
    if (balanced) {
      expect(plan.numericalIterationCountBound).toBe(0)
      expect(result.metadata.numericalIterationCount).toBe(0)
    } else {
      expect(plan.numericalIterationCountBound).toBeGreaterThan(960)
      expect(result.metadata.numericalIterationCount).toBeGreaterThan(0)
    }
  })

  it.each(variants)('keeps explicit non-SI windows exact for $label', ({ input, balanced }) => {
    const { plan, result } = parity(createLeverBalanceScene(input), {
      startTime: quantity(125, 'ms', 'time'),
      endTime: quantity(500, 'ms', 'time'),
      outputSampleRate: 7.9,
      timeStep: quantity(100, 'ms', 'time'),
      maxIterations: 1,
    })
    expect(plan.startTime).toBe(0.125)
    expect(plan.endTime).toBe(0.5)
    expect(plan.endTimeExact).toBe(true)
    expect(plan.storageSampleCountBound).toBe(7)
    expect(result.states.at(-1)!.time.value).toBe(0.5)
    if (balanced) expect(plan.numericalIterationCountBound).toBe(0)
  })

  it.each([
    { outputSampleRate: -2, expected: 2 },
    { outputSampleRate: 1, expected: 2 },
    { outputSampleRate: 3.9, expected: 3 },
    { outputSampleRate: 2_048, expected: 1_024 },
    { outputSampleRate: Number.NaN, expected: 25 },
    { outputSampleRate: Number.POSITIVE_INFINITY, expected: 25 },
  ])('preserves capped/fallback state counts for $outputSampleRate, not Hz', ({ outputSampleRate, expected }) => {
    const { plan } = parity(createLeverBalanceScene({ leftMass: 400 }), {
      endTime: quantity(50, 'ms', 'time'),
      outputSampleRate,
    })
    expect(plan.storageSampleCountBound).toBe(expected)
  })

  it('preserves duplicate stored samples and budgets each from-rest integration at zero-width nonzero time', () => {
    const { plan, result } = parity(createLeverBalanceScene({ leftMass: 400 }), {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(250, 'ms', 'time'),
      outputSampleRate: 5,
    })
    expect(plan.storageSampleCountBound).toBe(5)
    expect(result.states.map((state) => state.time.value)).toEqual([0.25, 0.25, 0.25, 0.25, 0.25])
    expect(plan.numericalIterationCountBound).toBeGreaterThanOrEqual(5 * 60)
  })

  it('requires an explicit end for nonzero-start event-default preflight without solving or changing the request', () => {
    const scene = createLeverBalanceScene({ leftMass: 400 })
    const engine = new LeverEngine()
    const request = createLeverSimulationRequest(scene, 'start-only-lever', 'start-only-lever-trace')
    request.options = { startTime: quantity(3.999, 's', 'time') }
    const before = structuredClone(request)
    const settleSpy = vi.spyOn(rotationalDynamics, 'leverSettleSeconds').mockImplementation(() => { throw new Error('settle forbidden') })
    const integrateSpy = vi.spyOn(rotationalDynamics, 'integrateLeverAngular').mockImplementation(() => { throw new Error('integration forbidden') })
    try {
      expect(() => engine.prepareSimulationPlan(scene, request)).toThrow(/requires an explicit endTime/)
      expect(settleSpy).not.toHaveBeenCalled()
      expect(integrateSpy).not.toHaveBeenCalled()
      expect(request).toEqual(before)
      request.options.endTime = quantity(4, 's', 'time')
      expect(engine.prepareSimulationPlan(scene, request).endTimeExact).toBe(true)
    } finally {
      settleSpy.mockRestore()
      integrateSpy.mockRestore()
    }
  })

  it('pins decimal window endpoints exactly without changing the raw accepted range', () => {
    const { plan, result } = parity(createLeverBalanceScene({ leftMass: 400 }), {
      endTime: quantity(0.1, 's', 'time'),
      outputSampleRate: 4,
    })
    expect(result.states[0]!.time.value).toBe(plan.startTime)
    expect(result.states.at(-1)!.time.value).toBe(0.1)
    expect(result.states.every((state) => state.time.value >= plan.startTime && state.time.value <= plan.endTime)).toBe(true)
  })

  it('has zero numerical work for sparse long balanced windows without clamping the accepted range', () => {
    const { plan, result } = parity(createLeverBalanceScene(), {
      startTime: quantity(1_000_000, 's', 'time'),
      endTime: quantity(1_000_060, 's', 'time'),
      outputSampleRate: 3,
    })
    expect(plan.startTime).toBe(1_000_000)
    expect(plan.endTime).toBe(1_000_060)
    expect(plan.numericalIterationCountBound).toBe(0)
    expect(result.metadata.numericalIterationCount).toBe(0)
  })

  it('keeps sparse long unbalanced windows costly even when the stored interval is short', () => {
    const scene = createLeverBalanceScene({ leftMass: 400 })
    const engine = new LeverEngine()
    const request = createLeverSimulationRequest(scene, 'long-lever', 'long-lever-trace')
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
    expect(plan.endTimeExact).toBe(true)
    expect(plan.storageSampleCountBound).toBe(2)
    expect(plan.numericalIterationCountBound).toBeGreaterThan(480_000_000)
    expect(request).toEqual(before)
  })

  it('uses exactly one settling search and accounts for stored states and all verification integrations', () => {
    const scene = createLeverBalanceScene({ leftMass: 400 })
    const engine = new LeverEngine()
    const request = createLeverSimulationRequest(scene, 'count-lever', 'count-lever-trace')
    request.options = { endTime: quantity(100, 'ms', 'time'), outputSampleRate: 3 }
    const settleSpy = vi.spyOn(rotationalDynamics, 'leverSettleSeconds')
    const integrationSpy = vi.spyOn(rotationalDynamics, 'integrateLeverAngular')
    try {
      const plan = engine.prepareSimulationPlan(scene, request)
      expect(settleSpy).not.toHaveBeenCalled()
      expect(integrationSpy).not.toHaveBeenCalled()
      const result = engine.simulate(scene, request)
      expect(settleSpy).toHaveBeenCalledTimes(1)
      expect(integrationSpy).toHaveBeenCalledTimes(3 + 67)
      expect(result.metadata.numericalIterationCount).toBeLessThanOrEqual(plan.numericalIterationCountBound)
    } finally {
      settleSpy.mockRestore()
      integrationSpy.mockRestore()
    }
  })

  it('shares pure count caps with the actual default and custom-step angular solvers', () => {
    const rotational = resolveLeverRotationalModel(resolveLeverModel(createLeverBalanceScene({ leftMass: 400 })))
    expect(leverSettleStepCountBound(rotational)).toBe(960)
    const counter = { numericalIterationCount: 0 }
    integrateLeverAngular(rotational, 0.25, { iterationCounter: counter })
    expect(counter.numericalIterationCount).toBeLessThanOrEqual(leverIntegrationStepCount(rotational, 0.25))
    const beforeSearch = counter.numericalIterationCount
    leverSettleSeconds(rotational, { integrationStep: LEVER_INTEGRATION_STEP / 2, iterationCounter: counter })
    expect(counter.numericalIterationCount - beforeSearch).toBeLessThanOrEqual(
      leverSettleStepCountBound(rotational, { integrationStep: LEVER_INTEGRATION_STEP / 2 }),
    )
    expect(leverSettleStepCountBound(rotational, { integrationStep: LEVER_INTEGRATION_STEP / 2 })).toBe(1_920)
  })

  it('prepares the default bound without settling, integrating or evaluating any state', () => {
    const scene = createLeverBalanceScene({ leftMass: 400 })
    const engine = new LeverEngine()
    const request = createLeverSimulationRequest(scene, 'pure-lever', 'pure-lever-trace')
    const simulateSpy = vi.spyOn(engine, 'simulate').mockImplementation(() => { throw new Error('simulate forbidden') })
    const stateSpy = vi.spyOn(engine, 'stateAt').mockImplementation(() => { throw new Error('stateAt forbidden') })
    const settleSpy = vi.spyOn(rotationalDynamics, 'leverSettleSeconds').mockImplementation(() => { throw new Error('settle forbidden') })
    const integrateSpy = vi.spyOn(rotationalDynamics, 'integrateLeverAngular').mockImplementation(() => { throw new Error('integration forbidden') })
    const leverStateSpy = vi.spyOn(leverState, 'leverStateAt').mockImplementation(() => { throw new Error('lever state forbidden') })
    const durationSpy = vi.spyOn(leverState, 'leverRunDuration').mockImplementation(() => { throw new Error('solved duration forbidden') })
    try {
      const plan = engine.prepareSimulationPlan(scene, request)
      expect(plan.endTime).toBe(LEVER_MAX_RUN_SECONDS)
      expect(plan.endTimeExact).toBe(false)
      expect(plan.numericalIterationCountBound).toBeGreaterThan(0)
      expect(simulateSpy).not.toHaveBeenCalled()
      expect(stateSpy).not.toHaveBeenCalled()
      expect(settleSpy).not.toHaveBeenCalled()
      expect(integrateSpy).not.toHaveBeenCalled()
      expect(leverStateSpy).not.toHaveBeenCalled()
      expect(durationSpy).not.toHaveBeenCalled()
    } finally {
      simulateSpy.mockRestore()
      stateSpy.mockRestore()
      settleSpy.mockRestore()
      integrateSpy.mockRestore()
      leverStateSpy.mockRestore()
      durationSpy.mockRestore()
    }
  })

  it.each([
    { startTime: quantity(-1, 's', 'time') },
    { startTime: { value: Number.NaN, unit: 's', dimension: 'time' as const } },
    { endTime: { value: Number.POSITIVE_INFINITY, unit: 's', dimension: 'time' as const } },
    { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') },
    { startTime: quantity(5, 's', 'time') },
  ])('rejects invalid ranges before simulation and before any settling work', (options) => {
    const scene = createLeverBalanceScene({ leftMass: 400 })
    const engine = new LeverEngine()
    const request = createLeverSimulationRequest(scene, 'bad-lever', 'bad-lever-trace')
    request.options = options
    const settleSpy = vi.spyOn(rotationalDynamics, 'leverSettleSeconds').mockImplementation(() => { throw new Error('settle forbidden') })
    try {
      expect(() => engine.prepareSimulationPlan(scene, request)).toThrow()
      expect(() => engine.simulate(scene, request)).toThrow()
      expect(settleSpy).not.toHaveBeenCalled()
    } finally {
      settleSpy.mockRestore()
    }
  })

  it('validates empty simulation identity directly without a settling solve', () => {
    const scene = createLeverBalanceScene({ leftMass: 400 })
    const request = createLeverSimulationRequest(scene, '', 'empty-lever-trace')
    expect(() => new LeverEngine().prepareSimulationPlan(scene, request)).toThrow(/invalid simulation bounds/)
  })

  it.each(['sceneId', 'sceneRevision'] as const)('rejects mismatched %s before planning and simulation', (field) => {
    const scene = createLeverBalanceScene()
    const engine = new LeverEngine()
    const request = createLeverSimulationRequest(scene, 'mismatch-lever', 'mismatch-lever-trace')
    if (field === 'sceneId') request.sceneId = asSceneId('another-scene')
    else request.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, request)).toThrow(/exact PhysicsScene revision/)
    expect(() => engine.simulate(scene, request)).toThrow(/exact PhysicsScene revision/)
  })

  it('rejects unrepresentable actual step caps and invalid numerical helper steps', () => {
    const rotational = resolveLeverRotationalModel(resolveLeverModel(createLeverBalanceScene({ leftMass: 400 })))
    expect(() => leverIntegrationStepCount(rotational, Number.MAX_VALUE)).toThrow(/integer step/)
    expect(() => leverIntegrationStepCount(rotational, 1, { integrationStep: 0 })).toThrow(/positive finite/)
    expect(() => leverSettleStepCountBound(rotational, { integrationStep: Number.NaN })).toThrow(/positive finite/)
  })
})
