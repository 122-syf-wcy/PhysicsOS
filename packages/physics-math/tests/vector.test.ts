import { describe, expect, it } from 'vitest'

import {
  add,
  angleBetween,
  cross,
  distance,
  dot,
  equals,
  fromVector2,
  isFiniteVector,
  isOrthogonal,
  isZero,
  magnitude,
  magnitudeSquared,
  negate,
  normalize,
  projectOnto,
  rejectFrom,
  rotateAboutZ,
  scale,
  subtract,
  toVector2,
  tryNormalize,
  UNIT_X,
  UNIT_Y,
  UNIT_Z,
  vec3,
  ZERO,
  ZeroVectorError,
} from '../src/vector.ts'

const EPS = 1e-12

describe('vector algebra', () => {
  it('adds, subtracts, scales and negates componentwise', () => {
    expect(add(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual(vec3(5, 7, 9))
    expect(subtract(vec3(4, 5, 6), vec3(1, 2, 3))).toEqual(vec3(3, 3, 3))
    expect(scale(vec3(1, -2, 3), 2)).toEqual(vec3(2, -4, 6))
    expect(negate(vec3(1, -2, 3))).toEqual(vec3(-1, 2, -3))
  })

  it('computes magnitude and magnitudeSquared', () => {
    expect(magnitude(vec3(3, 4, 0))).toBe(5)
    expect(magnitude(vec3(0, 0, 0))).toBe(0)
    expect(magnitudeSquared(vec3(3, 4, 0))).toBe(25)
    expect(magnitude(vec3(1, 1, 1))).toBeCloseTo(Math.sqrt(3), 15)
  })

  it('computes distance between two points', () => {
    expect(distance(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(5)
  })
})

describe('dot product', () => {
  it('is zero for orthogonal vectors', () => {
    expect(dot(UNIT_X, UNIT_Y)).toBe(0)
    expect(dot(UNIT_X, UNIT_Z)).toBe(0)
    expect(dot(UNIT_Y, UNIT_Z)).toBe(0)
    expect(dot(vec3(2, 0, 0), vec3(0, 7, 0))).toBe(0)
  })

  it('is the squared magnitude for a vector with itself', () => {
    const v = vec3(1, 2, 3)
    expect(dot(v, v)).toBe(magnitudeSquared(v))
  })

  it('is commutative', () => {
    const a = vec3(1, 2, 3)
    const b = vec3(-4, 5, 6)
    expect(dot(a, b)).toBe(dot(b, a))
  })

  it('detects orthogonality with tolerance', () => {
    expect(isOrthogonal(UNIT_X, UNIT_Y)).toBe(true)
    expect(isOrthogonal(UNIT_X, UNIT_X)).toBe(false)
    expect(isOrthogonal(UNIT_X, ZERO)).toBe(false)
  })

  it('computes the angle between vectors', () => {
    expect(angleBetween(UNIT_X, UNIT_Y)).toBeCloseTo(Math.PI / 2, 15)
    expect(angleBetween(UNIT_X, UNIT_X)).toBeCloseTo(0, 15)
    expect(angleBetween(UNIT_X, negate(UNIT_X))).toBeCloseTo(Math.PI, 15)
    expect(() => angleBetween(UNIT_X, ZERO)).toThrow(ZeroVectorError)
  })
})

describe('cross product right-handedness', () => {
  it('satisfies the right-hand rule on basis vectors', () => {
    expect(equals(cross(UNIT_X, UNIT_Y), UNIT_Z, EPS)).toBe(true)
    expect(equals(cross(UNIT_Y, UNIT_Z), UNIT_X, EPS)).toBe(true)
    expect(equals(cross(UNIT_Z, UNIT_X), UNIT_Y, EPS)).toBe(true)
  })

  it('is antisymmetric: cross(a,b) = -cross(b,a)', () => {
    const a = vec3(1, 2, 3)
    const b = vec3(-4, 5, 6)
    expect(equals(cross(a, b), negate(cross(b, a)), EPS)).toBe(true)
    expect(equals(cross(UNIT_X, UNIT_Y), negate(cross(UNIT_Y, UNIT_X)), EPS)).toBe(true)
  })

  it('is zero for parallel and antiparallel vectors', () => {
    expect(isZero(cross(UNIT_X, UNIT_X), EPS)).toBe(true)
    expect(isZero(cross(vec3(2, 0, 0), vec3(5, 0, 0)), EPS)).toBe(true)
    expect(isZero(cross(vec3(2, 0, 0), vec3(-5, 0, 0)), EPS)).toBe(true)
  })

  it('produces a vector orthogonal to both inputs', () => {
    const a = vec3(1, 2, 3)
    const b = vec3(-4, 5, 6)
    const c = cross(a, b)
    expect(Math.abs(dot(c, a))).toBeLessThan(1e-9)
    expect(Math.abs(dot(c, b))).toBeLessThan(1e-9)
  })

  /**
   * These two cases lock the rotation semantics the magnetic engine relies on:
   * with +z out of the page, B into the page is (0,0,-B).
   */
  it('maps v=+x, B=+z to -y', () => {
    expect(equals(cross(UNIT_X, UNIT_Z), negate(UNIT_Y), EPS)).toBe(true)
  })

  it('maps v=+x, B=-z to +y', () => {
    expect(equals(cross(UNIT_X, negate(UNIT_Z)), UNIT_Y, EPS)).toBe(true)
  })

  it('scales linearly with either operand', () => {
    const a = vec3(1, 2, 0)
    const b = vec3(0, 0, 3)
    expect(equals(cross(scale(a, 2), b), scale(cross(a, b), 2), EPS)).toBe(true)
    expect(equals(cross(a, scale(b, 2)), scale(cross(a, b), 2), EPS)).toBe(true)
  })
})

describe('normalize and zero-vector handling', () => {
  it('returns a unit-length vector', () => {
    const unit = normalize(vec3(3, 4, 0))
    expect(magnitude(unit)).toBeCloseTo(1, 15)
    expect(unit.x).toBeCloseTo(0.6, 15)
    expect(unit.y).toBeCloseTo(0.8, 15)
  })

  it('preserves direction', () => {
    const unit = normalize(vec3(0, -7, 0))
    expect(equals(unit, negate(UNIT_Y), EPS)).toBe(true)
  })

  it('throws on the zero vector rather than emitting NaN', () => {
    expect(() => normalize(ZERO)).toThrow(ZeroVectorError)
    expect(() => normalize(vec3(0, 0, 0))).toThrow(ZeroVectorError)
  })

  it('offers a non-throwing variant that returns undefined', () => {
    expect(tryNormalize(ZERO)).toBeUndefined()
    expect(tryNormalize(vec3(5, 0, 0))).toEqual(UNIT_X)
  })

  it('identifies the zero vector', () => {
    expect(isZero(ZERO)).toBe(true)
    expect(isZero(vec3(1e-15, 0, 0), 1e-12)).toBe(true)
    expect(isZero(UNIT_X)).toBe(false)
  })

  it('rejects non-finite components via isFiniteVector', () => {
    expect(isFiniteVector(vec3(1, 2, 3))).toBe(true)
    expect(isFiniteVector(vec3(Number.NaN, 0, 0))).toBe(false)
    expect(isFiniteVector(vec3(0, Number.POSITIVE_INFINITY, 0))).toBe(false)
  })
})

describe('projection and rotation', () => {
  it('splits a vector into parallel and perpendicular parts', () => {
    const v = vec3(3, 4, 0)
    const parallel = projectOnto(v, UNIT_X)
    const perpendicular = rejectFrom(v, UNIT_X)
    expect(equals(parallel, vec3(3, 0, 0), EPS)).toBe(true)
    expect(equals(perpendicular, vec3(0, 4, 0), EPS)).toBe(true)
    expect(equals(add(parallel, perpendicular), v, EPS)).toBe(true)
  })

  it('throws when projecting onto the zero vector', () => {
    expect(() => projectOnto(UNIT_X, ZERO)).toThrow(ZeroVectorError)
  })

  it('rotates counter-clockwise about +z', () => {
    const rotated = rotateAboutZ(UNIT_X, Math.PI / 2)
    expect(equals(rotated, UNIT_Y, 1e-15)).toBe(true)
  })

  it('preserves magnitude under rotation', () => {
    const v = vec3(3, 4, 0)
    expect(magnitude(rotateAboutZ(v, 0.7))).toBeCloseTo(magnitude(v), 15)
  })
})

describe('vector2 interop', () => {
  it('drops and restores the z component', () => {
    expect(toVector2(vec3(1, 2, 3))).toEqual({ x: 1, y: 2 })
    expect(fromVector2({ x: 1, y: 2 })).toEqual(vec3(1, 2, 0))
    expect(fromVector2({ x: 1, y: 2 }, 5)).toEqual(vec3(1, 2, 5))
  })
})
