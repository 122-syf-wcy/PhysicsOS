/**
 * Composite-field scene builder: IR → PhysicsScene.
 *
 * Chooses the apparatus factory the IR's model names and passes the parsed
 * quantities through. It performs NO physics: no balance is checked, no radius is
 * computed, no direction is turned into a force. The composite engine solves the
 * scene this produces, and the verifier judges what the engine produced.
 *
 * One physical decision does live here, and it is a GEOMETRY decision rather than
 * a result: when a selector question does not state the field directions, the
 * builder orients E and B so the apparatus can select (qE opposing qv×B for the
 * charge sign the question gave). A selector whose fields add would deflect every
 * particle, which is not the world the question describes.
 */

import { vec3, type Vector3 } from '@physicsos/physics-math'
import {
  createCompositeFieldScene,
  createMassSpectrometerScene,
  createVelocitySelectorScene,
  type CompositeElectricDirection,
  type MagneticOrientation,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { asQuestionId, type IsoDateTime } from '@physicsos/shared'

import type { PhysicsSemanticIR, PlanarDirection } from './semantic-ir.ts'

export interface CompositeSceneBuildResult {
  readonly scene: PhysicsScene
  readonly irToSceneMapping: Record<string, string>
}

const knownValue = (ir: PhysicsSemanticIR, key: string): number | undefined =>
  ir.knowns.find((entry) => entry.key === key)?.value

const signedCharge = (ir: PhysicsSemanticIR, magnitude: number): number =>
  ir.chargeSign === 'negative' ? -Math.abs(magnitude) : Math.abs(magnitude)

const velocityVector = (direction: PlanarDirection | undefined, speed: number): Vector3 => {
  switch (direction) {
    case 'left':
      return vec3(-speed, 0, 0)
    case 'up':
      return vec3(0, speed, 0)
    case 'down':
      return vec3(0, -speed, 0)
    case 'right':
    case 'unknown':
    case undefined:
      return vec3(speed, 0, 0)
  }
}

const electricDirectionOf = (
  direction: PlanarDirection | undefined,
): CompositeElectricDirection | undefined => {
  if (direction === undefined || direction === 'unknown') return undefined
  return direction
}

/**
 * Orient B so `qv×B` opposes `qE`, for a beam along +x and E along ±y.
 *
 * With v = v x̂ and E = E ŷ, `qv×B = -q v B_z ŷ`. Cancelling `qE ŷ` therefore needs
 * `B_z = E/v` — positive, i.e. OUT of the page — and the sign flips with either the
 * charge sign or the field direction. Returns the orientation, never a force.
 */
const selectorOrientation = (
  charge: number,
  electricDirection: CompositeElectricDirection,
): MagneticOrientation => {
  const eUp = electricDirection === 'up'
  const eDown = electricDirection === 'down'
  if (!eUp && !eDown) {
    /* An in-line E (along the beam) cannot be balanced by qv×B at all — that force
       is always perpendicular to v. Leave the page orientation at the default and
       let the verifier report the selection condition as unmet. */
    return 'into_page'
  }
  const positive = charge >= 0
  /* E up + q>0 ⇒ B out of page; each sign flip inverts it. */
  const outOfPage = eUp === positive
  return outOfPage ? 'out_of_page' : 'into_page'
}

/**
 * Build the composite scene an IR describes.
 *
 * `sourceQuestionId` is written into the scene metadata so the Lab can tell that
 * editing a parameter forks an experimental branch instead of silently changing
 * the conditions the printed solution was verified against.
 */
export function buildCompositeSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): CompositeSceneBuildResult {
  const charge = signedCharge(ir, knownValue(ir, 'charge') ?? 1.6e-19)
  const mass = knownValue(ir, 'mass') ?? 1.67e-27
  const speed = knownValue(ir, 'initial_velocity') ?? 1.0e5
  const electricStrength = ir.electricFieldStrength ?? knownValue(ir, 'electric_field_strength') ?? 2.0e4
  const magneticStrength = ir.magneticFluxDensity ?? knownValue(ir, 'magnetic_field_strength') ?? 0.2
  const gravity = knownValue(ir, 'gravity')

  const electricDirection = electricDirectionOf(ir.electricFieldDirection) ?? 'up'
  const magneticOrientation: MagneticOrientation =
    ir.magneticFieldOrientation ??
    (ir.model === 'velocity_selector' || ir.model === 'mass_spectrometer'
      ? selectorOrientation(charge, electricDirection)
      : 'into_page')

  const velocity = velocityVector(ir.initialVelocityDirection, speed)

  /* Long enough that the beam crosses every region at the parsed speed, and no
     longer: a duration set from the speed keeps the trajectory framed. */
  const spanMetres = ir.model === 'mass_spectrometer' ? 1.4 : 0.6
  const duration = speed > 0 ? spanMetres / speed : 1e-5

  const shared = {
    ...(options.sceneId === undefined ? {} : { sceneId: options.sceneId }),
    ...(options.now === undefined ? {} : { now: options.now }),
    charge,
    mass,
    velocity,
    electricFieldStrength: electricStrength,
    electricFieldDirection: electricDirection,
    magneticFieldStrength: magneticStrength,
    magneticFieldOrientation: magneticOrientation,
    duration,
    ...(gravity === undefined ? {} : { gravity }),
    ...(gravity === undefined ? {} : { observableVisibility: { gravityForce: true } }),
  }

  const scene =
    ir.model === 'mass_spectrometer'
      ? createMassSpectrometerScene(shared)
      : ir.model === 'velocity_selector'
        ? createVelocitySelectorScene(shared)
        : createCompositeFieldScene(shared)

  const withProvenance: PhysicsScene = {
    ...scene,
    metadata: {
      ...scene.metadata,
      ...(options.questionId === undefined
        ? {}
        : {
            description: `由试题 ${options.questionId} 的 Composite Question IR 生成`,
            sourceQuestionId: asQuestionId(options.questionId),
          }),
    },
  }

  return {
    scene: withProvenance,
    irToSceneMapping: {
      charge: 'particles[0].charge',
      mass: 'particles[0].mass',
      initial_velocity: 'particles[0].velocity',
      electric_field_strength: 'fields[uniform_electric].fieldStrength',
      magnetic_field_strength: 'fields[uniform_magnetic].magneticFluxDensity',
      ...(gravity === undefined ? {} : { gravity: 'fields[uniform_gravity].acceleration' }),
    },
  }
}
