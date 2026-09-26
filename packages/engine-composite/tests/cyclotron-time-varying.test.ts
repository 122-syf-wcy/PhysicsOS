import { describe, expect, it } from 'vitest'
import { magnitude } from '@physicsos/physics-math'
import { quantity } from '@physicsos/physics-units'
import { toCanonicalVector } from '@physicsos/physics-core'
import { createCyclotronScene, cyclotronBenchOf, validateScene } from '@physicsos/physics-scene'

import {
  CYCLOTRON_TIME_VARYING_MODEL,
  CompositeEngine,
  createCompositeSimulationRequest,
  gapElectricFieldAt,
  resolveCyclotronModel,
} from '../src/index.ts'

const PROTON = {
  charge: 1.6e-19,
  mass: 1.67e-27,
  speed: 1.0e5,
}

const scene = (overrides: Parameters<typeof createCyclotronScene>[0] = {}) =>
  createCyclotronScene({
    charge: PROTON.charge,
    mass: PROTON.mass,
    initialSpeed: PROTON.speed,
    magneticFluxDensity: 1.5,
    gapVoltage: 2.0e3,
    gapWidth: 0.02,
    deeRadius: 0.5,
    duration: 2e-7,
    ...overrides,
  })

const stateAt = (seconds: number, overrides: Parameters<typeof createCyclotronScene>[0] = {}) =>
  new CompositeEngine().stateAt(scene(overrides), quantity(seconds, 's', 'time'))

const particleAt = (
  seconds: number,
  overrides: Parameters<typeof createCyclotronScene>[0] = {},
) => {
  const particle = stateAt(seconds, overrides).objects.find((entry) => entry.id === 'particle-1')
  if (particle === undefined) throw new Error('particle state missing')
  return particle
}

const derivedScalar = (result: ReturnType<CompositeEngine['simulate']>, key: string): number => {
  const value = result.derivedQuantities.find((entry) => entry.key === key)?.value
  if (value === undefined || 'vector' in value)
    throw new Error(`missing scalar derived quantity ${key}`)
  return value.value
}

describe('time-varying-field cyclotron model', () => {
  it('builds a scene with a typed cyclotron bench and a valid global magnetic field', () => {
    const built = scene()
    const bench = cyclotronBenchOf(built)
    expect(bench?.type).toBe('cyclotron')
    expect(bench?.gapVoltage.value).toBe(2.0e3)
    expect(bench?.gapWidth.value).toBeCloseTo(0.02, 12)
    expect(bench?.deeRadius.value).toBeCloseTo(0.5, 12)
    expect(validateScene(built).status).toBe('passed')
  })

  it('derives the cyclotron period and frequency from q, m and B alone', () => {
    const model = resolveCyclotronModel(scene())
    expect(model.modelId).toBe(CYCLOTRON_TIME_VARYING_MODEL)
    expect(model.period).toBeCloseTo(
      (2 * Math.PI * PROTON.mass) / (PROTON.charge * model.magneticFluxDensity),
      15,
    )
    expect(model.frequency).toBeCloseTo(1 / model.period, 15)
    expect(model.maxSpeed).toBeCloseTo(
      (PROTON.charge * model.magneticFluxDensity * model.deeRadius) / PROTON.mass,
      12,
    )
    expect(model.initialRadius).toBeCloseTo(
      (PROTON.mass * PROTON.speed) / (PROTON.charge * model.magneticFluxDensity),
      12,
    )
  })

  it('uses a gap field that reverses every half cyclotron period', () => {
    const model = resolveCyclotronModel(scene())
    const firstHalf = gapElectricFieldAt(model, model.period * 0.25)
    const secondHalf = gapElectricFieldAt(model, model.period * 0.75)
    expect(Math.sign(firstHalf)).toBe(-Math.sign(secondHalf))
    expect(Math.abs(firstHalf)).toBeCloseTo(model.gapVoltage / model.gapWidth, 12)
    expect(gapElectricFieldAt(model, model.period)).toBeCloseTo(firstHalf, 12)
  })

  it('gains exactly qV of kinetic energy at each synchronized crossing', () => {
    const model = resolveCyclotronModel(scene())
    const initial = particleAt(0)
    const afterFirst = particleAt(model.period / 2)
    const initialSpeed = magnitude(toCanonicalVector(initial.velocity!).vectorSI)
    const speedAfter = magnitude(toCanonicalVector(afterFirst.velocity!).vectorSI)
    const initialEnergy = 0.5 * PROTON.mass * initialSpeed ** 2
    const energyAfter = 0.5 * PROTON.mass * speedAfter ** 2
    expect(energyAfter - initialEnergy).toBeCloseTo(PROTON.charge * 2.0e3, 24)
    expect(speedAfter).toBeCloseTo(
      Math.sqrt(initialSpeed ** 2 + (2 * PROTON.charge * 2.0e3) / PROTON.mass),
      9,
    )
  })

  it('keeps the orbit radius equal to mv/(qB) between acceleration gaps', () => {
    const model = resolveCyclotronModel(scene())
    const state = particleAt(model.period * 0.25)
    const velocity = toCanonicalVector(state.velocity!).vectorSI
    const radius = (PROTON.mass * magnitude(velocity)) / (PROTON.charge * model.magneticFluxDensity)
    const gyro = state.values?.gyro_radius
    expect(gyro !== undefined && !('vector' in gyro) ? gyro.value : Number.NaN).toBeCloseTo(
      radius,
      12,
    )
  })

  it('reports acceleration count, extraction speed and the verified model id', () => {
    const engine = new CompositeEngine()
    const built = scene()
    const result = engine.simulate(
      built,
      createCompositeSimulationRequest(built, 'sim-cyclotron', 'trace-cyclotron'),
    )
    expect(engine.canHandle(built)).toMatchObject({
      supported: true,
      modelId: CYCLOTRON_TIME_VARYING_MODEL,
    })
    expect(result.verification.status).toBe('passed')
    expect(derivedScalar(result, 'cyclotron_frequency')).toBeCloseTo(
      resolveCyclotronModel(built).frequency,
      12,
    )
    expect(derivedScalar(result, 'max_speed')).toBeCloseTo(resolveCyclotronModel(built).maxSpeed, 9)
    expect(derivedScalar(result, 'acceleration_count')).toBeGreaterThan(0)
    expect(
      result.verification.checks.find((entry) => entry.id === 'gap_energy_gain_per_crossing')
        ?.passed,
    ).toBe(true)
    expect(
      result.verification.checks.find((entry) => entry.id === 'time_varying_gap_synchronized')
        ?.passed,
    ).toBe(true)
  })

  it('returns UNSUPPORTED_MODEL when the initial orbit already exceeds the dee radius', () => {
    const built = scene({ initialSpeed: 1.0e9 })
    const support = new CompositeEngine().canHandle(built)
    expect(support.supported).toBe(false)
    if (!support.supported) expect(support.reason).toBe('unsupported_model')
  })

  it('rejects a malformed bench instead of inventing a trajectory', () => {
    const built = scene()
    const bench = cyclotronBenchOf(built)!
    Reflect.set(bench.gapVoltage, 'value', 0)
    const support = new CompositeEngine().canHandle(built)
    expect(support.supported).toBe(false)
    if (!support.supported) expect(support.reason).toBe('unsupported_model')
  })
})
