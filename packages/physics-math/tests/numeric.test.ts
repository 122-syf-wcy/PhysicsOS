import { describe, expect, it } from 'vitest'

import {
  approxEqual,
  clamp,
  isFiniteNumber,
  relativeError,
  signOf,
  TWO_PI,
  wrapAngle,
  wrapSignedAngle,
} from '../src/numeric.ts'

describe('approxEqual', () => {
  it('treats identical numbers as equal', () => {
    expect(approxEqual(1, 1)).toBe(true)
    expect(approxEqual(0, 0)).toBe(true)
  })

  it('uses absolute tolerance near zero', () => {
    expect(approxEqual(0, 1e-15)).toBe(true)
    expect(approxEqual(0, 1e-6)).toBe(false)
  })

  it('uses relative tolerance for large magnitudes', () => {
    expect(approxEqual(1e12, 1e12 + 1)).toBe(true)
    expect(approxEqual(1, 1.5)).toBe(false)
  })

  it('rejects non-finite comparisons', () => {
    expect(approxEqual(Number.NaN, Number.NaN)).toBe(false)
    expect(approxEqual(Number.POSITIVE_INFINITY, 1)).toBe(false)
  })
})

describe('relativeError', () => {
  it('is zero for exact matches', () => {
    expect(relativeError(2, 2)).toBe(0)
    expect(relativeError(0, 0)).toBe(0)
  })

  it('scales with the expected magnitude', () => {
    expect(relativeError(1.1, 1)).toBeCloseTo(0.1, 12)
    expect(relativeError(0.5, 1)).toBeCloseTo(0.5, 12)
  })

  it('is infinite when the expected value is zero but actual is not', () => {
    expect(relativeError(1, 0)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('angle wrapping', () => {
  it('wraps into [0, 2pi)', () => {
    expect(wrapAngle(0)).toBe(0)
    expect(wrapAngle(TWO_PI)).toBeCloseTo(0, 12)
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12)
    expect(wrapAngle(TWO_PI + 1)).toBeCloseTo(1, 12)
  })

  it('wraps into (-pi, pi]', () => {
    expect(wrapSignedAngle(0)).toBe(0)
    expect(wrapSignedAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12)
    expect(wrapSignedAngle(Math.PI)).toBeCloseTo(Math.PI, 12)
  })
})

describe('scalar helpers', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })

  it('reports sign without negative zero', () => {
    expect(signOf(3)).toBe(1)
    expect(signOf(-3)).toBe(-1)
    expect(signOf(0)).toBe(0)
    expect(signOf(-0)).toBe(0)
  })

  it('detects finite numbers', () => {
    expect(isFiniteNumber(1)).toBe(true)
    expect(isFiniteNumber(Number.NaN)).toBe(false)
    expect(isFiniteNumber('1')).toBe(false)
  })
})
