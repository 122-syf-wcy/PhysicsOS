import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createArchimedesScene,
  createCrystalMeltingScene,
  createSceneCommand,
  isThermalScene,
  thermalBenchOf,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  HEATING_CURVE_MODEL,
  THERMAL_ENGINE_ID,
  ThermalEngine,
  createThermalSimulationRequest,
  heatFromSegments,
  heatingTimingOf,
  resolveThermalModel,
  thermalEngine,
  thermalStateAt,
} from '../src/index.ts'

/* 100 g 冰、50 W：升温 84 s，熔化 668 s，熔化后再升温 84 s 到 10 ℃。 */
const meltingScene = (
  overrides: Parameters<typeof createCrystalMeltingScene>[0] = {},
): PhysicsScene => createCrystalMeltingScene(overrides)

const KELVIN_AT_ZERO_CELSIUS = 273.15

const simulated = (scene: PhysicsScene) =>
  thermalEngine.simulate(
    scene,
    createThermalSimulationRequest(scene, 'sim-heat', 'trace-heat'),
  )

const execute = <T extends SceneCommandType>(
  runtime: SceneRuntime,
  type: T,
  payload: SceneCommandPayloadMap[T],
) => {
  const scene = runtime.getScene()
  return runtime.execute(
    createSceneCommand<T>({
      commandId: `cmd-${type}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `trace-${type}`,
    }) as SceneCommand,
  )
}

describe('heating curve timing', () => {
  it('splits the textbook run into 84 s warm-up, 668 s plateau and 84 s of water', () => {
    const timing = heatingTimingOf(resolveThermalModel(meltingScene()))
    expect(timing.warmUpTime).toBeCloseTo(84, 9)
    expect(timing.meltingDuration).toBeCloseTo(668, 9)
    expect(timing.meltingEndTime).toBeCloseTo(752, 9)
    expect(timing.totalTime).toBeCloseTo(836, 9)
  })

  it('climbs, holds at the melting point, then climbs at half the rate', () => {
    const model = resolveThermalModel(meltingScene())

    expect(thermalStateAt(model, 0)).toMatchObject({ phase: 'solid' })
    expect(thermalStateAt(model, 0).temperature).toBeCloseTo(KELVIN_AT_ZERO_CELSIUS - 20, 9)

    /* Half way up the solid segment: −10 ℃. */
    expect(thermalStateAt(model, 42).temperature).toBeCloseTo(KELVIN_AT_ZERO_CELSIUS - 10, 9)

    /* Anywhere in the plateau the thermometer reads exactly the melting point,
       while the heat absorbed keeps climbing — the whole lesson in one place. */
    for (const time of [84, 200, 418, 700, 752]) {
      const state = thermalStateAt(model, time)
      expect(state.temperature).toBeCloseTo(KELVIN_AT_ZERO_CELSIUS, 9)
      expect(state.heatAbsorbed).toBeCloseTo(50 * time, 9)
    }
    expect(thermalStateAt(model, 418)).toMatchObject({ phase: 'melting' })
    expect(thermalStateAt(model, 418).meltedFraction).toBeCloseTo(0.5, 9)

    /* Water has twice the specific heat, so it warms at half the rate. */
    const end = thermalStateAt(model, 836)
    expect(end.phase).toBe('liquid')
    expect(end.temperature).toBeCloseTo(KELVIN_AT_ZERO_CELSIUS + 10, 9)
    expect(end.meltedFraction).toBe(1)

    /* Past the run the heater is off; the reading holds. */
    expect(thermalStateAt(model, 2000).temperature).toBeCloseTo(KELVIN_AT_ZERO_CELSIUS + 10, 9)
  })

  it('accounts for the same heat segment by segment as the heater delivered', () => {
    const model = resolveThermalModel(meltingScene())
    for (const time of [20, 84, 300, 752, 836]) {
      expect(heatFromSegments(model, time)).toBeCloseTo(50 * time, 6)
    }
  })

  it('drops the plateau entirely for an amorphous sample', () => {
    const model = resolveThermalModel(meltingScene({ latentHeat: 0 }))
    const timing = heatingTimingOf(model)
    expect(model.crystalline).toBe(false)
    expect(timing.meltingDuration).toBe(0)
    expect(timing.totalTime).toBeCloseTo(168, 9)
    /* No stretch where the temperature stands still. */
    expect(thermalStateAt(model, 83).temperature)
      .toBeLessThan(thermalStateAt(model, 85).temperature)
    expect(thermalStateAt(model, 168).temperature).toBeCloseTo(KELVIN_AT_ZERO_CELSIUS + 10, 9)
  })

  it('halves every duration when the heater power doubles', () => {
    const timing = heatingTimingOf(resolveThermalModel(meltingScene({ heaterPower: 100 })))
    expect(timing.warmUpTime).toBeCloseTo(42, 9)
    expect(timing.meltingDuration).toBeCloseTo(334, 9)
  })
})

describe('thermal engine', () => {
  it('handles a pure heating scene as the heating model in the thermal domain', () => {
    expect(thermalEngine.canHandle(meltingScene())).toMatchObject({
      supported: true,
      modelId: HEATING_CURVE_MODEL,
      domain: 'thermal',
    })
    expect(isThermalScene(meltingScene())).toBe(true)
  })

  it('rejects scenes without a bench, naming the failed condition', () => {
    const none = thermalEngine.canHandle({ ...meltingScene(), thermalBenches: [] })
    expect(none.supported).toBe(false)
    if (!none.supported) {
      expect(none.failedConditions[0]?.condition).toBe('single_bench')
    }
    expect(thermalEngine.canHandle(createArchimedesScene()).supported).toBe(false)
  })

  it('refuses a sample that already starts above its melting point', () => {
    const scene = meltingScene()
    const bench = thermalBenchOf(scene)!
    const melted: PhysicsScene = {
      ...scene,
      thermalBenches: [{
        ...bench,
        sample: { ...bench.sample, initialTemperature: quantity(400, 'K', 'temperature') },
      }],
    }
    expect(thermalEngine.canHandle(melted).supported).toBe(false)
  })

  it('derives the segment times and heats the student tabulates', () => {
    const outcome = simulated(meltingScene())
    expect(derivedScalar(outcome.derivedQuantities, 'heater_power').value).toBeCloseTo(50, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'warm_up_time').value).toBeCloseTo(84, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'melting_duration').value).toBeCloseTo(668, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'warm_up_heat').value).toBeCloseTo(4200, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'melting_heat').value).toBeCloseTo(33400, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'total_heat').value).toBeCloseTo(41800, 9)
  })

  it('passes every verification check on the textbook crystal', () => {
    const outcome = simulated(meltingScene())
    const ids = outcome.verification.checks.map(entry => entry.id)
    expect(ids).toContain('energy_conservation')
    expect(ids).toContain('heating_rate_ratio')
    expect(ids).toContain('melting_plateau')
    expect(ids).toContain('plateau_duration')
    expect(outcome.verification.status).toBe('passed')
  })

  it('swaps the plateau checks for the amorphous check when there is no melting point', () => {
    const outcome = simulated(meltingScene({ latentHeat: 0 }))
    const ids = outcome.verification.checks.map(entry => entry.id)
    expect(ids).toContain('amorphous_no_plateau')
    expect(ids).not.toContain('melting_plateau')
    expect(ids).not.toContain('plateau_duration')
    expect(outcome.verification.status).toBe('passed')
  })

  it('marks the start of heating, of melting and of the finished melt', () => {
    const outcome = simulated(meltingScene())
    expect(outcome.events.map(event => event.type)).toEqual([
      'HeatingStarted',
      'MeltingStarted',
      'MeltingComplete',
    ])
    expect(outcome.events[1]?.time).toBeCloseTo(84, 9)
    expect(outcome.events[2]?.time).toBeCloseTo(752, 9)

    const amorphous = simulated(meltingScene({ latentHeat: 0 }))
    expect(amorphous.events.map(event => event.type)).toEqual([
      'HeatingStarted',
      'SofteningStarted',
    ])
  })

  it('samples the run densely enough to draw all three stretches', () => {
    const outcome = simulated(meltingScene())
    expect(outcome.states).toHaveLength(97)
    const plateau = outcome.states.filter((state) => {
      const values = state.objects.find(object => object.id === 'thermal-bench-1')?.values
      const temperature = values?.['temperature']
      return temperature !== undefined &&
        isScalarQuantity(temperature) &&
        Math.abs(temperature.value - KELVIN_AT_ZERO_CELSIUS) < 1e-9
    })
    /* 668 s of a 836 s run is four fifths of the graph. */
    expect(plateau.length).toBeGreaterThan(60)
  })

  it('refuses a simulation request pinned to another revision', () => {
    const scene = meltingScene()
    const stale = createThermalSimulationRequest(scene, 'sim-stale', 'trace-stale')
    expect(() => thermalEngine.simulate({ ...scene, revision: 7 }, stale)).toThrow(
      /SimulationRequest must reference the exact PhysicsScene revision/,
    )
  })

  it('rejects a negative simulation time rather than extrapolating backwards', () => {
    expect(() => thermalEngine.stateAt(meltingScene(), quantity(-1, 's', 'time'))).toThrow(
      /finite and non-negative/,
    )
  })

  it('reports its own identity so results can be traced to this engine', () => {
    expect(new ThermalEngine().engineId).toBe(THERMAL_ENGINE_ID)
    expect(simulated(meltingScene()).metadata.engineId).toBe(THERMAL_ENGINE_ID)
  })
})

describe('thermal scene commands', () => {
  it('re-times the run after a power change through a real scene command', () => {
    const runtime = new SceneRuntime(meltingScene())
    const result = execute(runtime, 'SetHeaterPower', {
      benchId: 'thermal-bench-1',
      power: quantity(100, 'W', 'power'),
    })
    expect(result.ok).toBe(true)
    expect(runtime.getEvents().at(-1)?.type).toBe('HeaterPowerChanged')
    expect(heatingTimingOf(resolveThermalModel(runtime.getScene())).meltingDuration)
      .toBeCloseTo(334, 9)
  })

  it('scales the plateau with the sample mass', () => {
    const runtime = new SceneRuntime(meltingScene())
    expect(execute(runtime, 'SetSampleMass', {
      benchId: 'thermal-bench-1',
      mass: quantity(200, 'g', 'mass'),
    }).ok).toBe(true)
    expect(thermalBenchOf(runtime.getScene())?.sample.mass.value).toBe(200)
    expect(heatingTimingOf(resolveThermalModel(runtime.getScene())).meltingDuration)
      .toBeCloseTo(1336, 9)
  })

  it('rejects a non-positive power or mass instead of solving a broken bench', () => {
    const runtime = new SceneRuntime(meltingScene())
    const zeroPower = execute(runtime, 'SetHeaterPower', {
      benchId: 'thermal-bench-1',
      power: quantity(0, 'W', 'power'),
    })
    expect(zeroPower.ok).toBe(false)
    if (zeroPower.ok) throw new Error('Expected command rejection.')
    expect(zeroPower.error.code).toBe('INVALID_HEATER_POWER')

    const negativeMass = execute(runtime, 'SetSampleMass', {
      benchId: 'thermal-bench-1',
      mass: quantity(-5, 'g', 'mass'),
    })
    expect(negativeMass.ok).toBe(false)
    if (negativeMass.ok) throw new Error('Expected command rejection.')
    expect(negativeMass.error.code).toBe('INVALID_SAMPLE_MASS')
  })

  it('reports a missing bench rather than silently doing nothing', () => {
    const runtime = new SceneRuntime(meltingScene())
    const result = execute(runtime, 'SetHeaterPower', {
      benchId: 'no-such-bench',
      power: quantity(50, 'W', 'power'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected command rejection.')
    expect(result.error.code).toBe('THERMAL_BENCH_NOT_FOUND')
  })
})
