import { describe, expect, it } from 'vitest'

import {
  TRANSFORMER_RELATIVE_TOLERANCE,
  secondaryCurrent,
  secondaryVoltage,
  throughPower,
  transformerReadingOf,
} from '../src/transformer.ts'

/* 1000 turns in, 200 turns out, 220 V and 0.1 A: the classic step-down. */
const R = transformerReadingOf(220, 0.1, 1000, 200)

describe('the ideal transformer', () => {
  it('steps 220 V down to 44 V, five to one', () => {
    expect(R.turnsRatio).toBeCloseTo(5, 12)
    expect(R.secondaryVoltage).toBeCloseTo(44, 12)
    expect(R.stepsUp).toBe(false)
  })

  it('steps the current UP by the same factor the voltage came down', () => {
    /* 0.1 A in, 0.5 A out: the turns ratio works the other way on current. */
    expect(R.secondaryCurrent).toBeCloseTo(0.5, 12)
    expect(secondaryCurrent(0.1, 1000, 200)).toBeCloseTo(0.5, 12)
  })

  it('passes the SAME power through, which is what makes it a transformer', () => {
    expect(R.primaryPower).toBeCloseTo(22, 12)
    expect(R.secondaryPower).toBeCloseTo(22, 12)
    /* Two independent routes to the output power: U₂I₂, and U₁I₁·(N₂/N₁)(N₁/N₂). */
    expect(R.secondaryPower).toBeCloseTo(
      R.primaryPower * (R.secondaryTurns / R.primaryTurns) * (R.primaryTurns / R.secondaryTurns),
      12,
    )
    expect(
      throughPower(secondaryVoltage(220, 1000, 200), secondaryCurrent(0.1, 1000, 200)),
    ).toBeCloseTo(22, 12)
  })

  it('steps UP when the secondary has more turns, and the ratios invert', () => {
    const up = transformerReadingOf(220, 0.1, 200, 1000)
    expect(up.stepsUp).toBe(true)
    expect(up.secondaryVoltage).toBeCloseTo(1100, 12)
    expect(up.secondaryCurrent).toBeCloseTo(0.02, 12)
    expect(up.secondaryPower).toBeCloseTo(up.primaryPower, 12)
  })

  it('is the identity when the windings match', () => {
    const one = transformerReadingOf(220, 0.1, 500, 500)
    expect(one.secondaryVoltage).toBeCloseTo(220, 12)
    expect(one.secondaryCurrent).toBeCloseTo(0.1, 12)
    expect(one.turnsRatio).toBeCloseTo(1, 12)
    expect(one.stepsUp).toBe(false)
  })

  it('scales the output with the turns ratio alone, not with the turns', () => {
    /* Doubling BOTH windings changes nothing: only their ratio is a machine. */
    const bigger = transformerReadingOf(220, 0.1, 2000, 400)
    expect(bigger.secondaryVoltage).toBeCloseTo(R.secondaryVoltage, 12)
    expect(bigger.secondaryCurrent).toBeCloseTo(R.secondaryCurrent, 12)
    expect(TRANSFORMER_RELATIVE_TOLERANCE).toBeLessThan(1e-6)
  })
})
