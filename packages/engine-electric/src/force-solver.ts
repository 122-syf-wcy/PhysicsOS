/**
 * Force on a probe charge.
 *
 * `F = qE` and `a = F/m` only; the probe's motion in a point-charge field is not
 * closed-form, so the V1 slice reports the instantaneous force and acceleration
 * rather than pretending to integrate a trajectory.
 */

import { toCanonicalVector } from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'
import { magnitude, scale, type Vector3 } from '@physicsos/physics-math'
import { chargeSignOf, electricForce, type ChargeSign } from '@physicsos/physics-electric-core'
import { probeParticleOf, type PhysicsScene } from '@physicsos/physics-scene'

export interface ResolvedProbe {
  readonly id: string
  readonly charge: number
  readonly sign: ChargeSign
  readonly mass: number
  readonly position: Vector3
  readonly velocity: Vector3
}

/** Read the probe into SI units, or `undefined` when the scene has none. */
export const resolveProbe = (scene: PhysicsScene): ResolvedProbe | undefined => {
  const particle = probeParticleOf(scene.particles, scene.fields)
  if (particle === undefined) return undefined
  const charge = particle.charge === undefined ? 0 : canonicalValue(particle.charge)
  return {
    id: particle.id,
    charge,
    sign: chargeSignOf(charge),
    mass: canonicalValue(particle.mass),
    position: toCanonicalVector(particle.position).vectorSI,
    velocity: toCanonicalVector(particle.velocity).vectorSI,
  }
}

export interface ProbeForce {
  readonly force: Vector3
  readonly magnitude: number
  readonly acceleration: Vector3
}

/** F = qE and a = F/m at the probe's current position. */
export const solveProbeForce = (probe: ResolvedProbe, field: Vector3): ProbeForce => {
  const force = electricForce(probe.charge, field)
  return {
    force,
    magnitude: magnitude(force),
    /* Mass is validated positive by the scene gate, so this never divides by 0. */
    acceleration: scale(force, 1 / probe.mass),
  }
}
