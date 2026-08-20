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

export type MechanicsModel =
  | UniformLinearModel
  | UniformlyAcceleratedModel
  | ProjectileModel
  | NewtonSecondLawModel
  | InclinedPlaneModel
