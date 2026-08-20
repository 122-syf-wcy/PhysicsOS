/**
 * Pure-numeric comparison helpers. No unit or dimension semantics: physics
 * tolerance policy lives in physics-core, this file only does arithmetic.
 */

export const approxEqual = (
  a: number,
  b: number,
  relativeTolerance = 1e-9,
  absoluteTolerance = 1e-12,
): boolean => {
  if (a === b) return true
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const difference = Math.abs(a - b)
  if (difference <= absoluteTolerance) return true
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return difference <= relativeTolerance * scale
}

export const relativeError = (actual: number, expected: number): number => {
  if (expected === 0) return actual === 0 ? 0 : Number.POSITIVE_INFINITY
  return Math.abs(actual - expected) / Math.abs(expected)
}

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

export const TWO_PI = Math.PI * 2

/** Wraps an angle into `[0, 2π)`. */
export const wrapAngle = (radians: number): number => {
  const wrapped = radians % TWO_PI
  return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

/** Wraps an angle into `(-π, π]`. */
export const wrapSignedAngle = (radians: number): number => {
  const wrapped = wrapAngle(radians)
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Sign as -1, 0 or +1 without JavaScript's `-0` result. */
export const signOf = (value: number): -1 | 0 | 1 => {
  if (value > 0) return 1
  if (value < 0) return -1
  return 0
}
