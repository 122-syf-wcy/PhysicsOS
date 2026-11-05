import { add, scale, type Vector3 } from '@physicsos/physics-math'
import type { InclinedPlaneModel } from '../models/types.ts'
import { inclineAcceleration } from './force-dynamics.ts'

/** Piecewise sliding/sticking on the fixed surface; equal static/kinetic μ. */
export function inclineStateAt(model: InclinedPlaneModel, t: number): {
  position: Vector3; velocity: Vector3; acceleration: Vector3; friction: Vector3
} {
  const angle = model.inclineAngle * Math.PI / 180
  const along = { x: Math.cos(angle), y: -Math.sin(angle), z: 0 } as Vector3
  const v0 = model.velocity.x * along.x + model.velocity.y * along.y
  const a0 = model.acceleration.x * along.x + model.acceleration.y * along.y
  const stop = v0 * a0 < 0 ? -v0 / a0 : Infinity
  let displacement: number, speed: number, acceleration: number
  if (t < stop) {
    displacement = v0 * t + 0.5 * a0 * t * t
    speed = v0 + a0 * t
    acceleration = a0
  } else {
    const rest = inclineAcceleration(model.mass, model.gravity, model.inclineAngle, model.frictionCoefficient)
    acceleration = rest.acceleration.x * along.x + rest.acceleration.y * along.y
    const remaining = t - stop
    displacement = v0 * stop + 0.5 * a0 * stop * stop + 0.5 * acceleration * remaining * remaining
    speed = acceleration * remaining
  }
  return {
    position: add(model.position, scale(along, displacement)),
    velocity: scale(along, speed), acceleration: scale(along, acceleration),
    friction: scale(along, model.mass * (acceleration - model.gravityParallel)),
  }
}
