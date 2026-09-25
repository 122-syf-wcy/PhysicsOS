import { describe, expect, it } from 'vitest'

import {
  boreArea,
  columnLengthAt,
  expansionVolume,
  scaleFactor,
  thermometerReadingOf,
} from '../src/thermometer.ts'

/* A lab thermometer: a 0.1 cm³ bulb of a liquid that expands by 2×10⁻⁴ per
   kelvin, drawn up a bore 0.16 mm across. */
const V0 = 1e-7
const D = 1.6e-4
const BETA = 2e-4
const ICE = 0.02

const R = thermometerReadingOf(V0, D, BETA, 25, ICE)

describe('the liquid-in-glass thermometer', () => {
  it('turns expansion into height through the bore', () => {
    /* ΔV = V₀βΔT: 100 K of rise on this bulb is 2×10⁻⁹ m³. */
    expect(expansionVolume(V0, BETA, 100)).toBeCloseTo(2e-9, 15)
    /* And the bore converts it: Δh = ΔV/A. */
    expect(boreArea(D)).toBeCloseTo(Math.PI * 8e-5 * 8e-5, 18)
    expect(thermometerReadingOf(V0, D, BETA, 100, ICE).span).toBeCloseTo(
      expansionVolume(V0, BETA, 100) / boreArea(D),
      12,
    )
  })

  it('rules a UNIFORM scale: equal steps of temperature are equal distances', () => {
    const scale = scaleFactor(V0, boreArea(D), BETA)
    /* The instrument's sensitivity, in mm per kelvin — a shade under 1. */
    expect(scale * 1000).toBeCloseTo(0.9947, 3)
    /* Ten degrees is exactly ten times the rise of one, at every starting point. */
    const at = (t: number) => columnLengthAt(ICE, scale, t)
    expect(at(10) - at(0)).toBeCloseTo(at(70) - at(60), 15)
    expect(at(100) - at(0)).toBeCloseTo(10 * (at(10) - at(0)), 12)
  })

  it('puts the two fixed points exactly 100 degrees apart', () => {
    const scale = scaleFactor(V0, boreArea(D), BETA)
    const ice = columnLengthAt(ICE, scale, 0)
    const steam = columnLengthAt(ICE, scale, 100)
    /* 冰水混合物与沸水 DEFINE the scale: the distance between them is the whole
       0…100 interval, and dividing it into 100 parts is what makes a degree. */
    expect(R.icePoint).toBeCloseTo(ice, 15)
    expect(R.steamPoint).toBeCloseTo(steam, 15)
    expect(R.span).toBeCloseTo(steam - ice, 15)
    expect(R.span / 100).toBeCloseTo(scale, 15)
    /* One degree is just under a millimetre of glass. */
    expect(R.degreesPerMetre / 1000).toBeCloseTo(1.0053, 3)
  })

  it('reads the temperature it is dipped in', () => {
    /* At the lower fixed point the column sits there; at 25 °C it has climbed
       25 steps of one sensitivity. */
    expect(thermometerReadingOf(V0, D, BETA, 0, ICE).column).toBeCloseTo(ICE, 15)
    expect(R.column).toBeCloseTo(ICE + 25 * R.scale, 15)
    expect(R.column).toBeGreaterThan(R.icePoint)
    expect(R.column).toBeLessThan(R.steamPoint)
  })

  it('makes a more expansive liquid a more sensitive thermometer', () => {
    /* Twice β, twice the climb for the same temperature — the bulb and the bore
       are unchanged, so only the liquid got better at its job. */
    const better = thermometerReadingOf(V0, D, 2 * BETA, 25, ICE)
    expect(better.scale / R.scale).toBeCloseTo(2, 12)
    expect(better.column - ICE).toBeCloseTo(2 * (R.column - ICE), 12)
    /* And a wider bore is a WORSE thermometer: the same volume has more room to
       spread into, so the column barely moves. */
    const wide = thermometerReadingOf(V0, 2 * D, BETA, 25, ICE)
    expect(wide.scale / R.scale).toBeCloseTo(0.25, 12)
  })
})