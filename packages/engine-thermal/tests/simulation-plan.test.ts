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
  createBoilingWaterScene,
  createCrystalMeltingScene,
  createHeatCapacityComparisonScene,
  createThermometerCalibrationScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'

import {
  HEATING_CURVE_MODEL,
  THERMAL_ENGINE_ID,
  THERMAL_ENGINE_VERSION,
  ThermalEngine,
  createThermalSimulationRequest,
  thermalEngine,
} from '../src/thermal-engine.ts'
import {
  LIQUID_IN_GLASS_MODEL,
  THERMOMETER_ENGINE_ID,
  THERMOMETER_ENGINE_VERSION,
  ThermometerEngine,
  createThermometerSimulationRequest,
  thermometerEngine,
} from '../src/thermometer-engine.ts'
import * as heatingFunctions from '../src/heating-curve.ts'
import * as thermometerFunctions from '../src/thermometer.ts'

const NOW = '2026-11-08T00:00:00.000Z'
const meltingScene = (): PhysicsScene =>
  createCrystalMeltingScene({ sceneId: 'plan-melting', now: NOW })
const thermometerScene = (): PhysicsScene =>
  createThermometerCalibrationScene({ sceneId: 'plan-thermometer', now: NOW })

const withRunDuration = (scene: PhysicsScene, seconds: number): PhysicsScene => {
  const bench = scene.thermalBenches?.[0]
  if (bench === undefined) throw new Error('Expected a heating bench.')
  return { ...scene, thermalBenches: [{ ...bench, runDuration: quantity(seconds, 's', 'time') }] }
}

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

describe('ThermalEngine simulation planning', () => {
  const defaults = [
    { name: 'crystalline melting', scene: meltingScene, endTime: 836, objectCount: 2 },
    { name: 'amorphous softening', scene: () => createCrystalMeltingScene({ sceneId: 'plan-amorphous', latentHeat: 0, now: NOW }), endTime: 168, objectCount: 2 },
    { name: 'double heater power', scene: () => createCrystalMeltingScene({ sceneId: 'plan-hotter', heaterPower: 100, now: NOW }), endTime: 418, objectCount: 2 },
    { name: 'liquid heat-capacity comparison', scene: () => createHeatCapacityComparisonScene({ sceneId: 'plan-comparison', now: NOW }), endTime: 420, objectCount: 3 },
    { name: 'already-liquid boiling', scene: () => createBoilingWaterScene({ sceneId: 'plan-boiling', now: NOW }), endTime: 2596, objectCount: 2 },
  ]

  for (const entry of defaults) {
    it(`uses the real ${entry.name} default and counts states, not object records`, () => {
      const scene = entry.scene()
      const request = createThermalSimulationRequest(scene, `sim-${entry.name}`, `trace-${entry.name}`)
      expect(request.options).toEqual({})
      const plan = thermalEngine.prepareSimulationPlan(scene, request)
      const result = thermalEngine.simulate(scene, request)
      expect(plan).toEqual({
        schemaVersion: 'simulation-plan/1.0',
        engineId: THERMAL_ENGINE_ID,
        engineVersion: THERMAL_ENGINE_VERSION,
        simulationId: request.simulationId,
        sceneId: scene.id,
        sceneRevision: scene.revision,
        modelId: HEATING_CURVE_MODEL,
        kind: 'analytic',
        startTime: 0,
        endTime: entry.endTime,
        storageSampleCountBound: 97,
        numericalIterationCountBound: 0,
        metadata: {
          numericalIterationAccounting:
            'No numerical integration; closed-form sampling. Fixed thermal energy and phase verification probes are excluded.',
        },
      })
      expectExecutionBounds(plan, result)
      expect(result.states.every((state) => state.objects.length === entry.objectCount)).toBe(true)
      expect(result.states.at(-1)?.time.value).toBeCloseTo(entry.endTime, 9)
    })
  }

  it('keeps the actual phase durations and numeric temperatures on the default melting run', () => {
    const scene = meltingScene()
    const request = createThermalSimulationRequest(scene, 'sim-plan-phases', 'trace-plan-phases')
    const plan = thermalEngine.prepareSimulationPlan(scene, request)
    const result = thermalEngine.simulate(scene, request)
    expect(plan.endTime).toBe(836)
    expect(result.events.map((event) => [event.type, event.time])).toEqual([
      ['HeatingStarted', 0],
      ['MeltingStarted', 84],
      ['MeltingComplete', 752],
    ])
    expect(derivedScalar(result.derivedQuantities, 'warm_up_time')).toEqual(quantity(84, 's', 'time'))
    expect(derivedScalar(result.derivedQuantities, 'melting_duration')).toEqual(quantity(668, 's', 'time'))
    expect(derivedScalar(result.derivedQuantities, 'total_heat')).toEqual(quantity(41800, 'J', 'energy'))
    const final = result.states.at(-1)
    expect(final?.objects.find((object) => object.id === 'sample-1')?.values?.temperature).toEqual(quantity(283.15, 'K', 'temperature'))
  })

  it('derives the boiling default from warm-up plus vaporization and honors a shorter authored run', () => {
    const base = createBoilingWaterScene({ sceneId: 'plan-boiling-duration', now: NOW })
    for (const [duration, expectedEnd] of [[120, 120], [5000, 2596]] as const) {
      const scene = withRunDuration(base, duration)
      const request = createThermalSimulationRequest(scene, 'sim-plan-boil-default', 'trace-plan-boil-default')
      const plan = thermalEngine.prepareSimulationPlan(scene, request)
      expect(plan.endTime).toBe(expectedEnd)
      expectExecutionBounds(plan, thermalEngine.simulate(scene, request))
    }
    const request = createThermalSimulationRequest(base, 'sim-plan-boil-explicit', 'trace-plan-boil-explicit')
    request.options = { endTime: quantity(5000, 's', 'time'), outputSampleRate: 3 }
    const plan = thermalEngine.prepareSimulationPlan(base, request)
    const result = thermalEngine.simulate(base, request)
    expect(plan.endTime).toBe(5000)
    expectExecutionBounds(plan, result)
    const final = result.states.at(-1)
    expect(final?.objects.find((object) => object.id === 'water')?.values?.temperature).toEqual(quantity(373.15, 'K', 'temperature'))
    expect(final?.objects.find((object) => object.id === 'thermal-bench-1')?.values?.heat_absorbed).toEqual(quantity(500 * 2596, 'J', 'energy'))
  })

  it('canonicalizes an authored liquid duration and keeps both comparison samples in each stored state', () => {
    const base = createHeatCapacityComparisonScene({ sceneId: 'plan-liquid-duration', now: NOW })
    const bench = base.thermalBenches?.[0]
    if (bench === undefined) throw new Error('Expected a comparison bench.')
    const scene: PhysicsScene = {
      ...base,
      thermalBenches: [{ ...bench, runDuration: quantity(2, 'min', 'time') }],
    }
    const request = createThermalSimulationRequest(scene, 'sim-plan-liquid-duration', 'trace-plan-liquid-duration')
    request.options = { outputSampleRate: 3 }
    const plan = thermalEngine.prepareSimulationPlan(scene, request)
    const result = thermalEngine.simulate(scene, request)
    expect(plan).toMatchObject({ startTime: 0, endTime: 120, storageSampleCountBound: 3 })
    expectExecutionBounds(plan, result)
    expect(result.states.map((state) => state.time.value)).toEqual([0, 60, 120])
    expect(result.states.every((state) => state.objects.length === 3)).toBe(true)
    expect(derivedScalar(result.derivedQuantities, 'temperature_rise').value).toBeCloseTo(50 * 120 / (0.1 * 4200), 9)
    expect(derivedScalar(result.derivedQuantities, 'comparison_temperature_rise').value).toBeCloseTo(50 * 120 / (0.1 * 2100), 9)
  })

  it('uses explicit canonical scene times and count-capped storage across phase changes', () => {
    const scene = meltingScene()
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-units', 'trace-plan-thermal-units')
    request.options = {
      startTime: quantity(1, 'min', 'time'),
      endTime: quantity(120000, 'ms', 'time'),
      outputSampleRate: 5,
    }
    const before = JSON.stringify({ scene, request })
    const plan = thermalEngine.prepareSimulationPlan(scene, request)
    expect(JSON.stringify({ scene, request })).toBe(before)
    const result = thermalEngine.simulate(scene, request)
    expect(plan).toMatchObject({ startTime: 60, endTime: 120, storageSampleCountBound: 5 })
    expectExecutionBounds(plan, result)
    expect(result.states.map((state) => state.time.value)).toEqual([60, 75, 90, 105, 120])
    expect(result.events.map((event) => [event.type, event.time])).toEqual([['MeltingStarted', 84]])
    const first = result.states[0]?.objects.find((object) => object.id === 'sample-1')?.values?.temperature
    expect(first !== undefined && 'value' in first ? first.value : Number.NaN).toBeCloseTo(253.15 + 50 * 60 / (0.1 * 2100), 9)
    expect(result.states.at(-1)?.objects.find((object) => object.id === 'sample-1')?.values?.temperature).toEqual(quantity(273.15, 'K', 'temperature'))
  })

  it.each([
    [3, 3],
    [11.9, 11],
    [0, 2],
    [-1, 2],
    [1e12, 1024],
    [Number.NaN, 97],
    [Number.POSITIVE_INFINITY, 97],
  ] as const)('reports outputSampleRate %s as the actual storage count %s, not a frequency', (requested, count) => {
    const scene = meltingScene()
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-count', 'trace-plan-thermal-count')
    request.options = { endTime: quantity(1000, 's', 'time'), outputSampleRate: requested }
    const plan = thermalEngine.prepareSimulationPlan(scene, request)
    const result = thermalEngine.simulate(scene, request)
    expect(plan.storageSampleCountBound).toBe(count)
    expectExecutionBounds(plan, result)
  })

  it('does not convert the absolute default end into a duration or read the scene timeline instead', () => {
    const base = meltingScene()
    const scene: PhysicsScene = { ...base, timeline: { ...base.timeline, endTime: quantity(9999, 's', 'time') } }
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-start', 'trace-plan-thermal-start')
    request.options = { startTime: quantity(1, 'min', 'time'), outputSampleRate: 3 }
    const plan = thermalEngine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({ startTime: 60, endTime: 836 })
    expectExecutionBounds(plan, thermalEngine.simulate(scene, request))
    request.options = { startTime: quantity(1000, 's', 'time') }
    expect(refusalCodeOf(() => thermalEngine.prepareSimulationPlan(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(refusalCodeOf(() => thermalEngine.simulate(scene, request))).toBe('INVALID_SIMULATION_RANGE')
  })

  it('retains repeated samples in a zero-length analytic window', () => {
    const scene = meltingScene()
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-instant', 'trace-plan-thermal-instant')
    request.options = { startTime: quantity(84, 's', 'time'), endTime: quantity(84000, 'ms', 'time'), outputSampleRate: 4 }
    const plan = thermalEngine.prepareSimulationPlan(scene, request)
    const result = thermalEngine.simulate(scene, request)
    expect(plan).toMatchObject({ startTime: 84, endTime: 84, storageSampleCountBound: 4 })
    expectExecutionBounds(plan, result)
    expect(result.states.map((state) => state.time.value)).toEqual([84, 84, 84, 84])
  })

  it('allows a sparse long analytic run without stepping through its requested microseconds', () => {
    const scene = meltingScene()
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-long', 'trace-plan-thermal-long')
    request.options = {
      startTime: quantity(1e9, 's', 'time'),
      endTime: quantity(1e12, 's', 'time'),
      outputSampleRate: 3,
      timeStep: quantity(1, 'us', 'time'),
      maxIterations: 1,
    }
    const plan = thermalEngine.prepareSimulationPlan(scene, request)
    const result = thermalEngine.simulate(scene, request)
    expect(plan).toMatchObject({ kind: 'analytic', startTime: 1e9, endTime: 1e12, storageSampleCountBound: 3, numericalIterationCountBound: 0 })
    expectExecutionBounds(plan, result)
    expect(result.states[0]?.objects).toEqual(result.states.at(-1)?.objects)
    expect(result.events).toEqual([])
  })

  it('refuses overflowing physical phase times even with finite authored and requested ends', () => {
    const base = meltingScene()
    const bench = base.thermalBenches?.[0]
    if (bench === undefined) throw new Error('Expected a heating bench.')
    const scene: PhysicsScene = {
      ...base,
      thermalBenches: [{
        ...bench,
        sample: { ...bench.sample, mass: quantity(1e308, 'kg', 'mass') },
        runDuration: quantity(1, 's', 'time'),
      }],
    }
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-overflow', 'trace-plan-thermal-overflow')
    request.options = { endTime: quantity(1, 's', 'time'), outputSampleRate: 2 }
    const sampler = vi.spyOn(sceneFunctions, 'trajectorySampleTimes')
    const state = vi.spyOn(heatingFunctions, 'thermalStateAt')
    expect(refusalCodeOf(() => thermalEngine.prepareSimulationPlan(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(refusalCodeOf(() => thermalEngine.simulate(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(sampler).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()
  })

  it('also refuses nonfinite comparison phase times when the primary timing is finite', () => {
    const base = meltingScene()
    const bench = base.thermalBenches?.[0]
    if (bench === undefined) throw new Error('Expected a heating bench.')
    const scene: PhysicsScene = {
      ...base,
      thermalBenches: [{
        ...bench,
        comparisonSample: { ...bench.sample, id: 'sample-overflow-comparison', mass: quantity(1e308, 'kg', 'mass') },
        runDuration: quantity(1, 's', 'time'),
      }],
    }
    const request = createThermalSimulationRequest(scene, 'sim-plan-comparison-overflow', 'trace-plan-comparison-overflow')
    request.options = { endTime: quantity(1, 's', 'time'), outputSampleRate: 2 }
    const sampler = vi.spyOn(sceneFunctions, 'trajectorySampleTimes')
    const state = vi.spyOn(heatingFunctions, 'sampleStateAt')
    expect(refusalCodeOf(() => thermalEngine.prepareSimulationPlan(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(refusalCodeOf(() => thermalEngine.simulate(scene, request))).toBe('INVALID_SIMULATION_RANGE')
    expect(sampler).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()
  })

  it('the thermal purity spy seams observe actual sampling and verification work', () => {
    const scene = meltingScene()
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-spies', 'trace-plan-thermal-spies')
    const sampler = vi.spyOn(sceneFunctions, 'trajectorySampleTimes')
    const state = vi.spyOn(heatingFunctions, 'thermalStateAt')
    const energy = vi.spyOn(heatingFunctions, 'sampleHeatFromSegments')
    const validation = vi.spyOn(sceneFunctions, 'validateScene')
    thermalEngine.simulate(scene, request)
    expect(sampler).toHaveBeenCalledWith(0, 836, 97)
    expect(state).toHaveBeenCalled()
    expect(energy).toHaveBeenCalled()
    expect(validation).toHaveBeenCalledWith(scene)
  })

  it('prepares timing and budgets without evaluating samples, states, or verification', () => {
    const scene = createBoilingWaterScene({ sceneId: 'plan-thermal-pure', now: NOW })
    const request = createThermalSimulationRequest(scene, 'sim-plan-thermal-pure', 'trace-plan-thermal-pure')
    request.options = { endTime: quantity(Number.MAX_VALUE, 's', 'time'), outputSampleRate: 2 }
    const engine = new ThermalEngine()
    const forbidden = () => { throw new Error('Planning must only resolve thermal timing and counts.') }
    const spies = [
      vi.spyOn(sceneFunctions, 'trajectorySampleTimes').mockImplementation(forbidden),
      vi.spyOn(sceneFunctions, 'validateScene').mockImplementation(forbidden),
      vi.spyOn(heatingFunctions, 'thermalStateAt').mockImplementation(forbidden),
      vi.spyOn(heatingFunctions, 'sampleStateAt').mockImplementation(forbidden),
      vi.spyOn(heatingFunctions, 'sampleHeatFromSegments').mockImplementation(forbidden),
      vi.spyOn(engine, 'stateAt').mockImplementation(forbidden),
      vi.spyOn(engine, 'simulate').mockImplementation(forbidden),
      vi.spyOn(engine, 'validate').mockImplementation(forbidden),
      vi.spyOn(engine, 'canHandle').mockImplementation(forbidden),
    ]
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({ endTime: Number.MAX_VALUE, storageSampleCountBound: 2, numericalIterationCountBound: 0 })
    expect(() => assertSimulationPlan(plan)).not.toThrow()
    for (const entry of defaults) {
      const defaultScene = entry.scene()
      const defaultRequest = createThermalSimulationRequest(defaultScene, `sim-pure-${entry.name}`, `trace-pure-${entry.name}`)
      expect(engine.prepareSimulationPlan(defaultScene, defaultRequest)).toMatchObject({
        endTime: entry.endTime,
        storageSampleCountBound: 97,
        numericalIterationCountBound: 0,
      })
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('ThermometerEngine simulation planning', () => {
  it('reports a static equilibrium reading rather than inventing a heat-up duration', () => {
    const scene = thermometerScene()
    const request = createThermometerSimulationRequest(scene, 'sim-plan-thermometer', 'trace-plan-thermometer')
    expect(request.options).toEqual({})
    const plan = thermometerEngine.prepareSimulationPlan(scene, request)
    const result = thermometerEngine.simulate(scene, request)
    expect(plan).toEqual({
      schemaVersion: 'simulation-plan/1.0',
      engineId: THERMOMETER_ENGINE_ID,
      engineVersion: THERMOMETER_ENGINE_VERSION,
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      modelId: LIQUID_IN_GLASS_MODEL,
      kind: 'static',
      startTime: 0,
      endTime: 0,
      storageSampleCountBound: 1,
      numericalIterationCountBound: 0,
      metadata: {
        numericalIterationAccounting:
          'No numerical integration; one static state. Algebraic thermometer readings and fixed verification checks are excluded.',
      },
    })
    expectExecutionBounds(plan, result)
    expect(result.events.map((event) => [event.type, event.time])).toEqual([['ThermometerReady', 0]])
    expect(derivedScalar(result.derivedQuantities, 'reading_temperature')).toEqual(quantity(298.15, 'K', 'temperature'))
    const area = Math.PI * (0.00016 / 2) ** 2
    expect(derivedScalar(result.derivedQuantities, 'column_length').value).toBeCloseTo(0.02 + 1e-7 * 2e-4 * 25 / area, 9)
  })

  it('keeps the full accepted range and one stored state with non-SI times and any requested count', () => {
    const scene = thermometerScene()
    const request = createThermometerSimulationRequest(scene, 'sim-plan-thermometer-range', 'trace-plan-thermometer-range')
    request.options = {
      startTime: quantity(250, 'ms', 'time'),
      endTime: quantity(2, 'min', 'time'),
      outputSampleRate: 1e12,
      timeStep: quantity(1, 'us', 'time'),
      maxIterations: 1,
    }
    const plan = thermometerEngine.prepareSimulationPlan(scene, request)
    const result = thermometerEngine.simulate(scene, request)
    expect(plan).toMatchObject({ kind: 'static', startTime: 0.25, endTime: 120, storageSampleCountBound: 1, numericalIterationCountBound: 0 })
    expectExecutionBounds(plan, result)
    expect(result.events).toEqual([])
    const baseline = thermometerEngine.simulate(scene, createThermometerSimulationRequest(scene, 'sim-thermometer-baseline', 'trace-thermometer-baseline'))
    expect(result.states[0]?.objects).toEqual(baseline.states[0]?.objects)
    expect(result.derivedQuantities).toEqual(baseline.derivedQuantities)
    expect(result.verification).toEqual(baseline.verification)
  })

  it('uses the start alone for an omitted static end and accepts an explicit long range', () => {
    const base = thermometerScene()
    const scene: PhysicsScene = { ...base, timeline: { ...base.timeline, endTime: quantity(99, 's', 'time') } }
    const request = createThermometerSimulationRequest(scene, 'sim-plan-thermometer-start', 'trace-plan-thermometer-start')
    request.options = { startTime: quantity(2, 'min', 'time') }
    const plan = thermometerEngine.prepareSimulationPlan(scene, request)
    expect(plan).toMatchObject({ startTime: 120, endTime: 120, storageSampleCountBound: 1 })
    expectExecutionBounds(plan, thermometerEngine.simulate(scene, request))
    request.options = { startTime: quantity(1e9, 's', 'time'), endTime: quantity(1e12, 's', 'time'), outputSampleRate: 3 }
    const longPlan = thermometerEngine.prepareSimulationPlan(scene, request)
    expect(longPlan).toMatchObject({ startTime: 1e9, endTime: 1e12, storageSampleCountBound: 1, numericalIterationCountBound: 0 })
    expectExecutionBounds(longPlan, thermometerEngine.simulate(scene, request))
  })

  it('the thermometer purity spy seams observe actual reading and verification work', () => {
    const scene = thermometerScene()
    const request = createThermometerSimulationRequest(scene, 'sim-plan-thermometer-spies', 'trace-plan-thermometer-spies')
    const reading = vi.spyOn(thermometerFunctions, 'thermometerReadingOf')
    const expansion = vi.spyOn(thermometerFunctions, 'expansionVolume')
    const validation = vi.spyOn(sceneFunctions, 'validateScene')
    thermometerEngine.simulate(scene, request)
    expect(reading).toHaveBeenCalled()
    expect(expansion).toHaveBeenCalled()
    expect(validation).toHaveBeenCalledWith(scene)
  })

  it('does not compute thermometer readings or run verification, sampling, or simulation while planning', () => {
    const scene = thermometerScene()
    const request = createThermometerSimulationRequest(scene, 'sim-plan-thermometer-pure', 'trace-plan-thermometer-pure')
    const engine = new ThermometerEngine()
    const forbidden = () => { throw new Error('Planning must not compute a thermometer result.') }
    const spies = [
      vi.spyOn(thermometerFunctions, 'thermometerReadingOf').mockImplementation(forbidden),
      vi.spyOn(thermometerFunctions, 'columnLengthAt').mockImplementation(forbidden),
      vi.spyOn(thermometerFunctions, 'expansionVolume').mockImplementation(forbidden),
      vi.spyOn(thermometerFunctions, 'scaleFactor').mockImplementation(forbidden),
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

describe('thermal planning and execution refusal parity', () => {
  const cases = [
    { name: 'heating', engine: thermalEngine, scene: meltingScene, request: createThermalSimulationRequest },
    { name: 'thermometer', engine: thermometerEngine, scene: thermometerScene, request: createThermometerSimulationRequest },
  ]

  for (const entry of cases) {
    it(`${entry.name} guards the same scene id and revision before planning or executing`, () => {
      const scene = entry.scene()
      const request = entry.request(scene, `sim-${entry.name}-mismatch`, `trace-${entry.name}-mismatch`)
      const otherId = createCrystalMeltingScene({ sceneId: 'different-plan-scene', now: NOW }).id
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

    it(`${entry.name} refuses the same nonfinite, negative, and reversed ranges`, () => {
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

  it('refuses an already-liquid sample with no physical duration before either plan or execution', () => {
    const base = meltingScene()
    const bench = base.thermalBenches?.[0]
    if (bench === undefined) throw new Error('Expected a heating bench.')
    const scene: PhysicsScene = {
      ...base,
      thermalBenches: [{
        ...bench,
        sample: { ...bench.sample, initialTemperature: quantity(293.15, 'K', 'temperature') },
      }],
    }
    const request = createThermalSimulationRequest(scene, 'sim-plan-missing-duration', 'trace-plan-missing-duration')
    expect(refusalCodeOf(() => thermalEngine.prepareSimulationPlan(scene, request))).toBe('THERMAL_RUN_DURATION')
    expect(refusalCodeOf(() => thermalEngine.simulate(scene, request))).toBe('THERMAL_RUN_DURATION')
  })
})
