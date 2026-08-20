import { approxEqual, relativeError } from '@physicsos/physics-math'

/**
 * Single tolerance policy shared by every engine and the verifier, so that a
 * golden test, a conservation check and a metamorphic assertion never disagree
 * about what "equal" means.
 */
export interface PhysicsTolerance {
  /** Relative tolerance for comparing physics magnitudes. */
  readonly relative: number
  /** Absolute floor so near-zero comparisons do not demand impossible precision. */
  readonly absolute: number
  /** Relative tolerance for orthogonality and other direction checks. */
  readonly angular: number
}

export const DEFAULT_TOLERANCE: PhysicsTolerance = Object.freeze({
  relative: 1e-9,
  absolute: 1e-12,
  angular: 1e-9,
})

/** Looser policy for numeric integrators; analytical solvers keep the default. */
export const NUMERIC_TOLERANCE: PhysicsTolerance = Object.freeze({
  relative: 1e-6,
  absolute: 1e-9,
  angular: 1e-6,
})

export const withinTolerance = (
  actual: number,
  expected: number,
  tolerance: PhysicsTolerance = DEFAULT_TOLERANCE,
): boolean => approxEqual(actual, expected, tolerance.relative, tolerance.absolute)

export const toleranceError = (actual: number, expected: number): number =>
  relativeError(actual, expected)
