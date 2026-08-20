import { describe, expect, it } from 'vitest'

import { DimensionMismatchError, UnknownUnitError } from '../src/unit-registry.ts'
import {
  canonicalQuantity,
  canonicalValue,
  convert,
  fromCanonical,
  isCanonicalUnit,
  NonFiniteValueError,
  parseQuantity,
  quantity,
  sameDimension,
  toCanonical,
  validateQuantity,
  type Quantity,
} from '../src/quantity.ts'

describe('quantity canonicalization', () => {
  it('keeps SI values identical under canonicalization', () => {
    expect(canonicalValue(quantity(0.5, 'T', 'magnetic_flux_density'))).toBe(0.5)
    expect(canonicalValue(quantity(9.11e-31, 'kg', 'mass'))).toBe(9.11e-31)
    expect(canonicalValue(quantity(2, 'm/s', 'velocity'))).toBe(2)
  })

  it('converts cm to m', () => {
    expect(canonicalValue(quantity(1, 'cm', 'length'))).toBeCloseTo(0.01, 15)
    expect(canonicalValue(quantity(250, 'cm', 'length'))).toBeCloseTo(2.5, 15)
  })

  it('converts ms to s', () => {
    expect(canonicalValue(quantity(500, 'ms', 'time'))).toBeCloseTo(0.5, 15)
    expect(canonicalValue(quantity(2, 'ms', 'time'))).toBeCloseTo(0.002, 15)
  })

  it('converts km/h to m/s', () => {
    expect(canonicalValue(quantity(36, 'km/h', 'velocity'))).toBeCloseTo(10, 12)
  })

  it('converts degrees to radians', () => {
    expect(canonicalValue(quantity(180, 'deg', 'angle'))).toBeCloseTo(Math.PI, 15)
  })

  it('preserves scientific notation magnitudes', () => {
    const charge = quantity(1.602176634e-19, 'C', 'electric_charge')
    expect(canonicalValue(charge)).toBe(1.602176634e-19)

    const tiny = quantity(1e-30, 'kg', 'mass')
    expect(canonicalValue(tiny)).toBe(1e-30)

    const huge = quantity(6.02e23, 'C', 'electric_charge')
    expect(canonicalValue(huge)).toBe(6.02e23)
  })

  it('round-trips canonical quantities back to SI display units', () => {
    const back = fromCanonical(canonicalQuantity(0.5, 'magnetic_flux_density'))
    expect(back.unit).toBe('T')
    expect(back.value).toBe(0.5)
    expect(isCanonicalUnit(back)).toBe(true)
  })

  it('reports non-canonical input units', () => {
    expect(isCanonicalUnit(quantity(1, 'cm', 'length'))).toBe(false)
    expect(isCanonicalUnit(quantity(1, 'm', 'length'))).toBe(true)
  })

  it('converts between two non-SI units of one dimension', () => {
    const converted = convert(quantity(1, 'km', 'length'), 'cm')
    expect(converted.unit).toBe('cm')
    expect(converted.value).toBeCloseTo(100000, 9)
  })
})

describe('dimension validation', () => {
  it('treats equal dimensions as compatible', () => {
    const a = quantity(1, 'm', 'length')
    const b = quantity(2, 'cm', 'length')
    expect(sameDimension(a, b)).toBe(true)
  })

  it('treats different dimensions as incompatible', () => {
    const a = quantity(1, 'm', 'length')
    const b = quantity(2, 's', 'time')
    expect(sameDimension(a, b)).toBe(false)
  })

  it('rejects a unit that does not match the requested dimension', () => {
    expect(() => quantity(1, 'T', 'mass')).toThrow(DimensionMismatchError)
    expect(() => convert(quantity(1, 'm', 'length'), 's')).toThrow(DimensionMismatchError)
  })

  it('rejects a quantity whose declared dimension contradicts its unit', () => {
    const lying = { value: 1, unit: 'T', dimension: 'mass' } as unknown as Quantity
    expect(() => validateQuantity(lying, 'mass')).toThrow(DimensionMismatchError)
  })

  it('validates a well-formed quantity and narrows its dimension', () => {
    const parsed = parseQuantity(0.5, 'T')
    const validated = validateQuantity(parsed, 'magnetic_flux_density')
    expect(validated.dimension).toBe('magnetic_flux_density')
    expect(validated.value).toBe(0.5)
  })

  it('infers dimension from the registry when parsing', () => {
    expect(parseQuantity(3, 'N').dimension).toBe('force')
    expect(parseQuantity(3, 'rad/s').dimension).toBe('angular_velocity')
    expect(() => parseQuantity(3, 'not-a-unit')).toThrow(UnknownUnitError)
  })
})

describe('numeric guards', () => {
  it('rejects NaN and Infinity', () => {
    expect(() => quantity(Number.NaN, 'T', 'magnetic_flux_density')).toThrow(NonFiniteValueError)
    expect(() => quantity(Number.POSITIVE_INFINITY, 'kg', 'mass')).toThrow(NonFiniteValueError)
    expect(() => quantity(Number.NEGATIVE_INFINITY, 'm', 'length')).toThrow(NonFiniteValueError)
    expect(() => canonicalQuantity(Number.NaN, 'force')).toThrow(NonFiniteValueError)
  })

  it('accepts negative values: sign validity is domain policy, not unit policy', () => {
    expect(canonicalValue(quantity(-1.6e-19, 'C', 'electric_charge'))).toBe(-1.6e-19)
    expect(canonicalValue(quantity(-5, 'kg', 'mass'))).toBe(-5)
    expect(canonicalValue(quantity(-0.5, 'T', 'magnetic_flux_density'))).toBe(-0.5)
  })

  it('accepts zero', () => {
    expect(canonicalValue(quantity(0, 'T', 'magnetic_flux_density'))).toBe(0)
  })

  it('does not let metadata precision alter the stored value', () => {
    const b = quantity(0.5000000001, 'T', 'magnetic_flux_density')
    expect(toCanonical(b).valueSI).toBe(0.5000000001)
  })
})
