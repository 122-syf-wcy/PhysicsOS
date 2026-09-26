import type { ResolvedPinholeModel, ResolvedRefractionModel } from './light-model.ts'

/**
 * The rectilinear-propagation geometry this engine is allowed to state.
 *
 * Kept apart from the engine class for the same reason every other slice keeps
 * its physics apart: the golden tests import these directly, so the number a
 * student reads and the number a test asserts come from one implementation.
 */

export const LIGHT_RELATIVE_TOLERANCE = 1e-9

/** Magnification of a pinhole image: m = v/u. */
export const pinholeMagnification = (objectDistance: number, screenDistance: number): number =>
  screenDistance / objectDistance

/**
 * Image height, h′ = h·v/u (m).
 *
 * A MAGNITUDE: the image is inverted, and the inversion is carried by
 * {@link imagePointOf} below rather than by a negative height, because the
 * height of a picture is not a signed quantity.
 */
export const pinholeImageHeight = (
  objectHeight: number,
  objectDistance: number,
  screenDistance: number,
): number => objectHeight * pinholeMagnification(objectDistance, screenDistance)

/**
 * Where a point of the object lands on the screen, by straight-line propagation.
 *
 * The hole is the origin, the object stands at −u (in front), the screen is at
 * +v (behind). A ray from the object's point (x = −u, y = y₀) through the hole
 * continues along the same line, so at x = +v it is at y = −y₀·v/u: the
 * inversion is not a rule, it is what "straight" means when the lines cross.
 *
 * The engine checks the two object extremes against this, which is a route to
 * the image that never computes a ratio of heights.
 */
export const imagePointOf = (
  objectHeight: number,
  objectDistance: number,
  screenDistance: number,
): { readonly tip: number; readonly tail: number } => {
  const scale = screenDistance / objectDistance
  return { tip: -objectHeight * scale, tail: objectHeight * scale }
}

/** What the pinhole rig reads at its current geometry. */
export interface PinholeReading {
  readonly objectHeight: number
  readonly objectDistance: number
  readonly screenDistance: number
  /** Magnification v/u (dimensionless). */
  readonly magnification: number
  /** Image height (m) — a magnitude; the image is inverted. */
  readonly imageHeight: number
  /** Where the object's tip lands on the screen (m, negative = below the axis). */
  readonly tipAt: number
  /** Where the object's tail lands (m, positive = above the axis). */
  readonly tailAt: number
  /** True when the image is inverted — which the geometry always makes it. */
  readonly inverted: boolean
}

export const pinholeReadingOf = (model: ResolvedPinholeModel): PinholeReading => {
  const points = imagePointOf(model.objectHeight, model.objectDistance, model.screenDistance)
  return {
    objectHeight: model.objectHeight,
    objectDistance: model.objectDistance,
    screenDistance: model.screenDistance,
    magnification: pinholeMagnification(model.objectDistance, model.screenDistance),
    imageHeight: pinholeImageHeight(model.objectHeight, model.objectDistance, model.screenDistance),
    tipAt: points.tip,
    tailAt: points.tail,
    inverted: points.tip < 0 && points.tail > 0,
  }
}

/* --------------------------------------------------------- refraction -- */

/**
 * The angle at which the refracted ray grazes along the boundary: sinθ_c = n₂/n₁.
 *
 * Only exists when light runs from the DENSER medium into the thinner one
 * (n₁ > n₂). Into a denser medium there is a solution for every angle, so there
 * is no angle to find — and `undefined` says exactly that, rather than a number
 * that would be meaningless.
 */
export const criticalAngleOf = (
  incidentIndex: number,
  refractedIndex: number,
): number | undefined =>
  incidentIndex > refractedIndex ? Math.asin(refractedIndex / incidentIndex) : undefined

/**
 * Where the refracted ray goes, by Snell's law: n₁sinθ₁ = n₂sinθ₂.
 *
 * `undefined` past the critical angle, because there is no refracted ray to
 * find: the light comes back. That absence is the physics — 全反射 is not a
 * strong refraction, it is the disappearance of the refracted branch — so the
 * model reports it as absent rather than as a large angle.
 */
export const refractedAngleOf = (
  incidentIndex: number,
  refractedIndex: number,
  incidentAngle: number,
): number | undefined => {
  const sine = (incidentIndex * Math.sin(incidentAngle)) / refractedIndex
  return sine > 1 ? undefined : Math.asin(sine)
}

/** What the refraction rig reads at its current geometry. */
export interface RefractionReading {
  readonly incidentIndex: number
  readonly refractedIndex: number
  readonly incidentAngle: number
  /** Critical angle (rad), or undefined when light enters a denser medium. */
  readonly criticalAngle: number | undefined
  /** Refracted angle (rad), or undefined when nothing refracts. */
  readonly refractedAngle: number | undefined
  /** True when the light is sent back rather than through. */
  readonly totalInternalReflection: boolean
}

export const refractionReadingOf = (model: ResolvedRefractionModel): RefractionReading => {
  const criticalAngle = criticalAngleOf(model.incidentIndex, model.refractedIndex)
  const refractedAngle = refractedAngleOf(
    model.incidentIndex,
    model.refractedIndex,
    model.incidentAngle,
  )
  return {
    incidentIndex: model.incidentIndex,
    refractedIndex: model.refractedIndex,
    incidentAngle: model.incidentAngle,
    criticalAngle,
    refractedAngle,
    totalInternalReflection: refractedAngle === undefined,
  }
}
