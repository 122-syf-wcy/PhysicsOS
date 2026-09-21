import type { Vector3 } from '@physicsos/physics-math'
import type { MechanicsModelId } from '@physicsos/physics-scene'

export interface MechanicsModelBase {
  readonly modelId: MechanicsModelId
  readonly bodyId: string
  readonly mass: number
  readonly position: Vector3
  readonly velocity: Vector3
  readonly acceleration: Vector3
}

export interface UniformLinearModel extends MechanicsModelBase {
  readonly modelId: 'uniform_linear_motion'
}

export interface UniformlyAcceleratedModel extends MechanicsModelBase {
  readonly modelId: 'uniformly_accelerated_motion'
  readonly acceleration: Vector3
}

export interface ProjectileModel extends MechanicsModelBase {
  readonly modelId: 'projectile_motion'
  readonly gravity: Vector3
  readonly groundY: number
  readonly initialPosition: Vector3
  readonly initialVelocity: Vector3
  readonly launchAngle: number
  readonly flightTime: number
  readonly range: number
  readonly maxHeight: number
  readonly impactVelocity: Vector3
}

export interface NewtonSecondLawModel extends MechanicsModelBase {
  readonly modelId: 'newton_second_law'
  readonly netForce: Vector3
  readonly acceleration: Vector3
}

export interface InclinedPlaneModel extends MechanicsModelBase {
  readonly modelId: 'inclined_plane'
  readonly inclineAngle: number
  readonly gravity: Vector3
  readonly gravityParallel: number
  readonly gravityNormal: number
  readonly normalForce: number
  readonly frictionCoefficient: number
  readonly frictionForce: number
  readonly netForce: Vector3
  readonly acceleration: Vector3
}

export interface SpringOscillatorModel extends MechanicsModelBase {
  readonly modelId: 'spring_oscillator'
  /** N/m. */
  readonly stiffness: number
  /** m — the spring's relaxed length. */
  readonly naturalLength: number
  /** Wall-side end of the spring in scene coordinates. */
  readonly anchor: Vector3
  /** rad/s — √(k/m). */
  readonly angularFrequency: number
  /** s — 2π/ω. */
  readonly period: number
  /** m — the motion's half-swing about equilibrium. */
  readonly amplitude: number
  /** rad — initial phase, solved from x(0)/v(0). */
  readonly phase: number
  /** m — where the restoring force vanishes. */
  readonly equilibriumX: number
}

export interface SimplePendulumModel extends MechanicsModelBase {
  readonly modelId: 'simple_pendulum'
  /** m — pivot to bob centre. */
  readonly length: number
  readonly pivot: Vector3
  readonly gravity: Vector3
  /** rad/s — √(g/L). */
  readonly angularFrequency: number
  /** s — 2π√(L/g). */
  readonly period: number
  /** rad — swing amplitude, solved from the launch state. */
  readonly amplitude: number
  /** rad — initial phase. */
  readonly phase: number
}

export interface HorizontalFrictionModel extends MechanicsModelBase {
  readonly modelId: 'horizontal_friction'
  /** μs — static limit coefficient. */
  readonly staticCoefficient: number
  /** μk — kinetic coefficient. */
  readonly kineticCoefficient: number
  readonly gravity: Vector3
  /** N — the pull at t = 0. */
  readonly initialForce: number
  /** N/s — how fast the pull grows. */
  readonly forceRamp: number
  /** N — the pull stops growing here. */
  readonly maxForce: number
  /** N — normal force, mg on a level surface. */
  readonly normalForce: number
  /** s — when the pull reaches μsN; Infinity when it never does. */
  readonly slipTime: number
}

export interface SpringStaticsModel extends MechanicsModelBase {
  readonly modelId: 'spring_statics'
  /** N/m. */
  readonly stiffness: number
  readonly naturalLength: number
  readonly anchor: Vector3
  readonly gravity: Vector3
  /** m — how far the spring stretched below its relaxed length, mg/k. */
  readonly extension: number
  /** N — the spring's pull at equilibrium, equal to mg. */
  readonly springForce: number
}

export type MechanicsModel =
  | UniformLinearModel
  | UniformlyAcceleratedModel
  | ProjectileModel
  | NewtonSecondLawModel
  | InclinedPlaneModel
  | SpringOscillatorModel
  | SimplePendulumModel
  | HorizontalFrictionModel
  | SpringStaticsModel
