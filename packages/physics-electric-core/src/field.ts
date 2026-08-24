/**
 * Electric domain contract: point charges and the field they produce.
 *
 * This package exists so the electric domain does not grow inside
 * `physics-core`. `physics-core` owns quantities, simulation and verification
 * shapes that EVERY domain shares; a point charge is electric-specific, so it
 * lives here and the engine, the observation layer and the question pipeline all
 * read one definition of it.
 *
 * Everything here is pure: no scene, no engine, no renderer. Units are SI.
 */

import { add, magnitude, scale, subtract, type Vector3 } from '@physicsos/physics-math'
import { PhysicsOSError } from '@physicsos/shared'

/** Coulomb constant k = 1/(4πε₀), in N·m²/C². */
export const COULOMB_CONSTANT = 8.987_551_792_3e9

/**
 * A point charge.
 *
 * `charge` is signed: the sign is the physics, not a display flag. A source is
 * `fixed` when the model treats it as held in place — the V1 slice solves the
 * field of static sources, not their mutual motion.
 */
export interface PointCharge {
  readonly id: string
  /** Signed charge in coulombs. */
  readonly charge: number
  readonly position: Vector3
  readonly fixed: boolean
}

/** A charged body moving in a field produced by others. */
export interface ProbeParticle {
  readonly id: string
  readonly charge: number
  /** Mass in kilograms; must be positive for `F = ma` to have a solution. */
  readonly mass: number
  readonly position: Vector3
  readonly velocity: Vector3
}

/** Field evaluated at one point in space. */
export interface ElectricFieldSample {
  readonly at: Vector3
  /** Field vector in V/m. */
  readonly field: Vector3
  /** |E| in V/m, carried so consumers never recompute it inconsistently. */
  readonly magnitude: number
}

/** Sign of a charge, for labelling and colour. Zero is its own case. */
export type ChargeSign = 'positive' | 'negative' | 'neutral'

export const chargeSignOf = (charge: number): ChargeSign =>
  charge > 0 ? 'positive' : charge < 0 ? 'negative' : 'neutral'

const displacement = (source: Vector3, sample: Vector3): Vector3 => subtract(sample, source)

/**
 * Distance from a source, refusing the singular point.
 *
 * E diverges at r = 0. Returning a huge number there would let a scene render an
 * arrow of meaningless length, so the contract fails loudly instead.
 */
const requireNonZeroDistance = (offset: Vector3): number => {
  const distance = magnitude(offset)
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new PhysicsOSError(
      'ELECTRIC_FIELD_SINGULARITY',
      'Point-charge field and potential are undefined at the source position.',
    )
  }
  return distance
}

/**
 * Field of a single point charge: E = k·q·r̂ / r².
 *
 * The returned vector already carries the sign of `sourceCharge`, so a negative
 * charge yields a field pointing INWARD without the caller flipping anything.
 */
export const pointChargeElectricField = (
  sourceCharge: number,
  sourcePosition: Vector3,
  samplePosition: Vector3,
): Vector3 => {
  const offset = displacement(sourcePosition, samplePosition)
  const distance = requireNonZeroDistance(offset)
  return scale(offset, (COULOMB_CONSTANT * sourceCharge) / distance ** 3)
}

/** Potential of a single point charge: V = k·q / r. */
export const pointChargePotential = (
  sourceCharge: number,
  sourcePosition: Vector3,
  samplePosition: Vector3,
): number => {
  const distance = requireNonZeroDistance(displacement(sourcePosition, samplePosition))
  return (COULOMB_CONSTANT * sourceCharge) / distance
}

/** Superposition: fields add as vectors. */
export const superposeElectricFields = (fields: readonly Vector3[]): Vector3 =>
  fields.reduce((sum, field) => add(sum, field), { x: 0, y: 0, z: 0 })

/** Force on a charge in a field: F = qE. */
export const electricForce = (charge: number, field: Vector3): Vector3 => scale(field, charge)

/** Force between two point charges, via the field of the source. */
export const coulombForce = (
  sourceCharge: number,
  testCharge: number,
  sourcePosition: Vector3,
  testPosition: Vector3,
): Vector3 =>
  electricForce(testCharge, pointChargeElectricField(sourceCharge, sourcePosition, testPosition))

/**
 * Resultant field of several sources at one point.
 *
 * A sample sitting exactly on a source is a modelling error, not a value to
 * approximate, so the singularity propagates rather than being silently skipped.
 */
export const fieldAt = (
  charges: readonly PointCharge[],
  samplePosition: Vector3,
): ElectricFieldSample => {
  const field = superposeElectricFields(
    charges.map((charge) =>
      pointChargeElectricField(charge.charge, charge.position, samplePosition),
    ),
  )
  return { at: samplePosition, field, magnitude: magnitude(field) }
}

/** Force a set of sources exerts on a probe. */
export const forceOnProbe = (
  charges: readonly PointCharge[],
  probe: Pick<ProbeParticle, 'charge' | 'position'>,
): Vector3 => electricForce(probe.charge, fieldAt(charges, probe.position).field)
