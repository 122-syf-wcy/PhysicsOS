/**
 * Point charge as a scene object.
 *
 * A point charge is a `Particle` that the model holds in place plus a
 * `PointChargeField` naming it as the source. There is deliberately no second
 * Scene type: `PhysicsScene` stays the one world description, so every existing
 * gate (validation, commands, revision, observation) applies unchanged.
 *
 * The SIGN lives in `charge.value`. The UI never decides whether a charge is
 * positive — that is a physical fact carried by the scene.
 */

import { quantityVector } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'
import { vec3, type Vector3 } from '@physicsos/physics-math'

import type { Particle, PointChargeField } from '../scene.ts'

/** Input for one source charge. `charge` is signed, in coulombs. */
export interface PointChargeInput {
  readonly id: string
  readonly charge: number
  readonly position?: Vector3
  /** Drawn radius in metres; presentation only, never used by the solver. */
  readonly radius?: number
}

/** Input for the charge that FEELS the field rather than producing it. */
export interface ProbeParticleInput {
  readonly id?: string
  readonly charge: number
  readonly mass: number
  readonly position?: Vector3
  readonly velocity?: Vector3
}

/** Source charge → a fixed particle. */
export const pointChargeParticle = (input: PointChargeInput): Particle => ({
  id: input.id,
  type: 'particle',
  /* A source charge has no dynamics in this model, but mass is part of the
     Particle contract and must stay positive to keep the scene valid. */
  mass: quantity(1, 'kg', 'mass'),
  charge: quantity(input.charge, 'C', 'electric_charge'),
  position: quantityVector(input.position ?? vec3(0, 0, 0), 'm', 'length'),
  velocity: quantityVector(vec3(0, 0, 0), 'm/s', 'velocity'),
  fixed: true,
  ...(input.radius === undefined ? {} : { metadata: { radius: input.radius } }),
})

/** The field a source charge produces, referenced by id. */
export const pointChargeField = (input: PointChargeInput): PointChargeField => ({
  id: `field-${input.id}`,
  type: 'point_charge',
  sourceParticleId: input.id,
})

/** Probe charge → a free particle. */
export const probeParticle = (input: ProbeParticleInput): Particle => ({
  id: input.id ?? 'probe-1',
  type: 'particle',
  mass: quantity(input.mass, 'kg', 'mass'),
  charge: quantity(input.charge, 'C', 'electric_charge'),
  position: quantityVector(input.position ?? vec3(0, 0, 0), 'm', 'length'),
  velocity: quantityVector(input.velocity ?? vec3(0, 0, 0), 'm/s', 'velocity'),
  fixed: false,
})

/** Source charges in a scene: fixed particles that a point-charge field names. */
export const sourceChargesOf = (
  particles: readonly Particle[],
  fields: readonly { type: string; sourceParticleId?: string }[],
): readonly Particle[] => {
  const sourceIds = new Set(
    fields
      .filter((field) => field.type === 'point_charge')
      .map((field) => field.sourceParticleId)
      .filter((id): id is string => id !== undefined),
  )
  return particles.filter((particle) => sourceIds.has(particle.id))
}

/**
 * The probe, if the scene has one.
 *
 * A scene may describe a field with no probe at all — "what is E at 20 cm" is a
 * complete question — so callers must handle its absence rather than assuming one.
 */
export const probeParticleOf = (
  particles: readonly Particle[],
  fields: readonly { type: string; sourceParticleId?: string }[],
): Particle | undefined => {
  const sources = new Set(sourceChargesOf(particles, fields).map((particle) => particle.id))
  return particles.find((particle) => !sources.has(particle.id) && particle.fixed !== true)
}
