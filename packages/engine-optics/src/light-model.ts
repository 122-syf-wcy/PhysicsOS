import { canonicalValue } from '@physicsos/physics-units'
import { lightBenchesOf, type LightBench, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of the pinhole rig: how tall the object is, how far it
 * stands from the hole, and how far the screen is behind it.
 *
 * All three are lengths, and the only thing that decides the image is their
 * RATIO — which is why the model keeps them separately rather than storing an
 * already-computed magnification: the student edits the ruler, not the answer.
 */
export interface ResolvedPinholeModel {
  readonly type: 'pinhole'
  readonly benchId: string
  /** Height of the object (m), > 0. */
  readonly objectHeight: number
  /** Object-to-hole distance (m), > 0. */
  readonly objectDistance: number
  /** Hole-to-screen distance (m), > 0. */
  readonly screenDistance: number
}

/**
 * Light meeting a boundary between two media: where it comes from, what it
 * meets, and the angle it strikes at. The refracted and reflected directions
 * are DERIVED — the rig states the geometry, and Snell's law is what follows.
 */
export interface ResolvedRefractionModel {
  readonly type: 'total_reflection'
  readonly benchId: string
  /** Refractive index the light comes from, >= 1. */
  readonly incidentIndex: number
  /** Refractive index it meets, > 0. */
  readonly refractedIndex: number
  /** Angle of incidence from the normal (rad), in [0, pi/2). */
  readonly incidentAngle: number
}

export type ResolvedLightModel = ResolvedPinholeModel | ResolvedRefractionModel

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const benchOf = (bench: LightBench): ResolvedLightModel => {
  if (bench.type === 'total_reflection') {
    if (
      bench.incidentIndex === undefined ||
      bench.refractedIndex === undefined ||
      bench.incidentAngle === undefined
    ) {
      throw modelError(
        'LIGHT_REFRACTION_INCOMPLETE',
        `Light bench "${bench.id}" must state both indices and the angle of incidence.`,
      )
    }
    const incidentIndex = canonicalValue(bench.incidentIndex)
    if (!Number.isFinite(incidentIndex) || incidentIndex < 1) {
      throw modelError(
        'LIGHT_INCIDENT_INDEX',
        `Light bench "${bench.id}" incident index must be finite and >= 1.`,
      )
    }
    const angle = canonicalValue(bench.incidentAngle)
    if (!Number.isFinite(angle) || angle < 0 || angle >= Math.PI / 2) {
      throw modelError(
        'LIGHT_INCIDENT_ANGLE',
        `Light bench "${bench.id}" angle of incidence must be in [0, 90) degrees.`,
      )
    }
    return {
      type: 'total_reflection',
      benchId: bench.id,
      incidentIndex,
      refractedIndex: positiveOrThrow(
        canonicalValue(bench.refractedIndex),
        'LIGHT_REFRACTED_INDEX',
        `Light bench "${bench.id}" refracted index must be finite and > 0.`,
      ),
      incidentAngle: angle,
    }
  }

  if (
    bench.objectHeight === undefined ||
    bench.objectDistance === undefined ||
    bench.screenDistance === undefined
  ) {
    throw modelError(
      'LIGHT_PINHOLE_INCOMPLETE',
      `Light bench "${bench.id}" must state the object height and both distances.`,
    )
  }
  return {
    type: 'pinhole',
    benchId: bench.id,
    objectHeight: positiveOrThrow(
      canonicalValue(bench.objectHeight),
      'LIGHT_OBJECT_HEIGHT',
      `Light bench "${bench.id}" object height must be finite and > 0.`,
    ),
    objectDistance: positiveOrThrow(
      canonicalValue(bench.objectDistance),
      'LIGHT_OBJECT_DISTANCE',
      `Light bench "${bench.id}" object distance must be finite and > 0.`,
    ),
    screenDistance: positiveOrThrow(
      canonicalValue(bench.screenDistance),
      'LIGHT_SCREEN_DISTANCE',
      `Light bench "${bench.id}" screen distance must be finite and > 0.`,
    ),
  }
}

/**
 * Resolve the scene's light bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a rig the model cannot honour.
 */
export const resolveLightModel = (scene: PhysicsScene): ResolvedLightModel => {
  const benches = lightBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError(
      'LIGHT_SINGLE_BENCH',
      'Light Engine requires exactly one light-propagation bench.',
    )
  }
  return benchOf(bench)
}
