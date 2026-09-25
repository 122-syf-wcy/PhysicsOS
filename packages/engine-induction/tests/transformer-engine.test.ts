import { describe, expect, it } from 'vitest'
import { createTransformerBenchScene } from '@physicsos/physics-scene'
import { isScalarQuantity } from '@physicsos/physics-core'

import { TransformerEngine, createTransformerSimulationRequest } from '../src/index.ts'

/* The classroom step-down: 1000 turns in, 200 out, 220 V and 0.1 A. */
const scene = () => createTransformerBenchScene({})
const engine = new TransformerEngine()

const result = () => {
  const built = scene()
  return engine.simulate(built, createTransformerSimulationRequest(built, 'sim-tr', 'trace-tr'))
}

const scalarOf = (key: string): number => {
  const derived = result().derivedQuantities.find((entry) => entry.key === key)
  if (derived === undefined) throw new Error(`derived missing: ${key}`)
  if (!isScalarQuantity(derived.value)) throw new Error(`not scalar: ${key}`)
  return derived.value.value
}

describe('transformer through the engine', () => {
  it('accepts the bench and reads 44 V and 0.5 A out of 220 V and 0.1 A in', () => {
    expect(engine.canHandle(scene()).supported).toBe(true)
    expect(scalarOf('primary_voltage')).toBeCloseTo(220, 9)
    expect(scalarOf('turns_ratio')).toBeCloseTo(5, 12)
    expect(scalarOf('secondary_voltage')).toBeCloseTo(44, 9)
    expect(scalarOf('secondary_current')).toBeCloseTo(0.5, 12)
  })

  it('derives the flux rate the primary voltage implies', () => {
    /* U₁ = N₁·dΦ/dt: 220 V over 1000 turns is 0.22 Wb/s. Nothing stores it. */
    expect(scalarOf('flux_rate')).toBeCloseTo(0.22, 12)
  })

  it('passes the power through unchanged, on both routes', () => {
    expect(scalarOf('primary_power')).toBeCloseTo(22, 9)
    expect(scalarOf('secondary_power')).toBeCloseTo(22, 9)
  })

  it('verifies the shared flux, the power balance and the turns ratio', () => {
    const checks = result().verification.checks
    const byId = (id: string) => checks.find((c) => c.id === id)?.passed
    expect(byId('both_windings_share_one_flux')).toBe(true)
    expect(byId('power_passes_through_unchanged')).toBe(true)
    expect(byId('output_scales_with_the_turns_ratio')).toBe(true)
    expect(result().verification.status).toBe('passed')
  })

  it('refuses a bench that is not a transformer, or has no windings', () => {
    expect(engine.canHandle({ ...scene(), transformerBenches: [] }).supported).toBe(false)
    expect(
      engine.canHandle(createTransformerBenchScene({ secondaryTurns: 0 })).supported,
    ).toBe(false)
    expect(engine.canHandle(createTransformerBenchScene({ primaryVoltage: 0 })).supported).toBe(false)
    /* A secondary drawing no current is a real (open-circuit) rig. */
    expect(engine.canHandle(createTransformerBenchScene({ primaryCurrent: 0 })).supported).toBe(true)
  })
})
