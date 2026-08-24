import { describe, expect, it } from 'vitest'

import {
  COULOMB_CONSTANT,
  chargeSignOf,
  coulombForce,
  electricForce,
  fieldAt,
  forceOnProbe,
  pointChargeElectricField,
  pointChargePotential,
  superposeElectricFields,
  type PointCharge,
} from '../src/index.ts'

const charge = (id: string, q: number, x: number, y: number): PointCharge => ({
  id,
  charge: q,
  position: { x, y, z: 0 },
  fixed: true,
})

describe('pointChargeElectricField', () => {
  it('matches E = kq/r² for a textbook case', () => {
    /* q = 5 μC at 20 cm: E = 8.9876e9 * 5e-6 / 0.04 = 1.1235e6 V/m. */
    const field = pointChargeElectricField(5e-6, { x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 })
    expect(field.x).toBeCloseTo((COULOMB_CONSTANT * 5e-6) / 0.04, 3)
    expect(field.y).toBe(0)
    expect(field.x).toBeCloseTo(1_123_443.974, 2)
  })

  it('points away from a positive charge and into a negative one', () => {
    const outward = pointChargeElectricField(1e-6, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const inward = pointChargeElectricField(-1e-6, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(outward.x).toBeGreaterThan(0)
    expect(inward.x).toBeLessThan(0)
    /* Same magnitude: only the sign of q differs. */
    expect(Math.abs(inward.x)).toBeCloseTo(outward.x, 12)
  })

  it('falls off as the inverse square', () => {
    const near = pointChargeElectricField(1e-6, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const far = pointChargeElectricField(1e-6, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })
    expect(far.x).toBeCloseTo(near.x / 4, 12)
  })

  it('refuses the singular point instead of returning a huge number', () => {
    /* An arrow of meaningless length is worse than a failure. */
    expect(() => pointChargeElectricField(1e-6, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toThrow(
      /ELECTRIC_FIELD_SINGULARITY|undefined at the source/,
    )
  })
})

describe('pointChargePotential', () => {
  it('matches V = kq/r and carries the sign of the charge', () => {
    expect(pointChargePotential(2e-6, { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 })).toBeCloseTo(
      (COULOMB_CONSTANT * 2e-6) / 0.5,
      6,
    )
    expect(pointChargePotential(-2e-6, { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 })).toBeLessThan(0)
  })
})

describe('superposition', () => {
  it('cancels exactly midway between equal like charges', () => {
    const sample = fieldAt([charge('a', 1e-6, -1, 0), charge('b', 1e-6, 1, 0)], { x: 0, y: 0, z: 0 })
    expect(sample.field.x).toBeCloseTo(0, 12)
    expect(sample.field.y).toBeCloseTo(0, 12)
    expect(sample.magnitude).toBeCloseTo(0, 12)
  })

  it('doubles midway between equal opposite charges', () => {
    /* A dipole's field on the axis between the charges adds rather than cancels. */
    const single = pointChargeElectricField(1e-6, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    const sample = fieldAt([charge('a', 1e-6, -1, 0), charge('b', -1e-6, 1, 0)], { x: 0, y: 0, z: 0 })
    expect(sample.field.x).toBeCloseTo(single.x * 2, 12)
  })

  it('adds nothing for an empty source set', () => {
    expect(superposeElectricFields([])).toEqual({ x: 0, y: 0, z: 0 })
    expect(fieldAt([], { x: 1, y: 1, z: 0 }).magnitude).toBe(0)
  })
})

describe('force', () => {
  it('gives F = qE, along E for a positive probe and against it for a negative one', () => {
    const field = { x: 1000, y: 0, z: 0 }
    expect(electricForce(2e-6, field).x).toBeCloseTo(2e-3, 12)
    expect(electricForce(-2e-6, field).x).toBeCloseTo(-2e-3, 12)
  })

  it('is attractive between opposite charges and repulsive between like charges', () => {
    const attract = coulombForce(1e-6, -1e-6, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const repel = coulombForce(1e-6, 1e-6, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    /* The probe sits at +x, so attraction pulls it back towards the origin. */
    expect(attract.x).toBeLessThan(0)
    expect(repel.x).toBeGreaterThan(0)
    expect(Math.abs(attract.x)).toBeCloseTo(repel.x, 12)
  })

  it('obeys Newton III between a pair of charges', () => {
    const onB = coulombForce(3e-6, -4e-6, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })
    const onA = coulombForce(-4e-6, 3e-6, { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    expect(onA.x).toBeCloseTo(-onB.x, 12)
    expect(onA.y).toBeCloseTo(-onB.y, 12)
  })

  it('resolves the force on a probe from several sources', () => {
    const force = forceOnProbe([charge('a', 1e-6, -1, 0), charge('b', 1e-6, 1, 0)], {
      charge: 1e-9,
      position: { x: 0, y: 0.5, z: 0 },
    })
    /* Symmetric like charges: the horizontal parts cancel, the probe is pushed +y. */
    expect(force.x).toBeCloseTo(0, 15)
    expect(force.y).toBeGreaterThan(0)
  })
})

describe('chargeSignOf', () => {
  it('treats zero as its own case rather than folding it into negative', () => {
    expect(chargeSignOf(1e-9)).toBe('positive')
    expect(chargeSignOf(-1e-9)).toBe('negative')
    expect(chargeSignOf(0)).toBe('neutral')
  })
})
