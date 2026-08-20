import { add, scale, type Vector3 } from '@physicsos/physics-math'

export interface KinematicsState {
  position: Vector3
  velocity: Vector3
  acceleration: Vector3
}

export function kinematicsAt(
  initialPosition: Vector3,
  initialVelocity: Vector3,
  acceleration: Vector3,
  t: number,
): KinematicsState {
  return {
    position: add(add(initialPosition, scale(initialVelocity, t)), scale(acceleration, 0.5 * t * t)),
    velocity: add(initialVelocity, scale(acceleration, t)),
    acceleration,
  }
}

export function displacementAt(
  initialVelocity: Vector3,
  acceleration: Vector3,
  t: number,
): Vector3 {
  return add(scale(initialVelocity, t), scale(acceleration, 0.5 * t * t))
}
