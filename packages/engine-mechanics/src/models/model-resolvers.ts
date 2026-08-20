import type { PhysicsScene, Body } from '@physicsos/physics-scene'
import { toCanonicalVector } from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'
import { vec3, scale, type Vector3 } from '@physicsos/physics-math'
import type { MechanicsModel } from './types.ts'
import { newtonSecondLaw, inclineAcceleration } from '../solvers/force-dynamics.ts'

export function resolveBody(scene: PhysicsScene): { body: Body; mass: number; position: Vector3; velocity: Vector3 } {
  const body = scene.bodies[0]
  if (!body) throw new Error('No body in scene')
  const mass = canonicalValue(body.mass)
  const position = toCanonicalVector(body.position).vectorSI
  const velocity = toCanonicalVector(body.velocity).vectorSI
  return { body, mass, position, velocity }
}

export function resolveGravity(scene: PhysicsScene): Vector3 {
  const gravityField = scene.fields.find((f) => f.type === 'uniform_gravity')
  if (!gravityField || gravityField.type !== 'uniform_gravity') return vec3(0, -9.8, 0)
  return toCanonicalVector(gravityField.acceleration).vectorSI
}

export function resolveAppliedForces(scene: PhysicsScene, bodyId: string): Vector3[] {
  const forces: Vector3[] = []
  for (const f of scene.forces) {
    if (f.targetId !== bodyId) continue
    if (f.type === 'custom' && f.vector) {
      forces.push(toCanonicalVector(f.vector).vectorSI)
    }
  }
  return forces
}

export function resolveGroundY(scene: PhysicsScene): number {
  for (const obs of scene.observableDefinitions) {
    if (obs.parameters?.['kind'] === 'ground' && typeof obs.parameters?.['groundY'] === 'number') {
      return obs.parameters['groundY'] as number
    }
  }
  return 0
}

export function resolveInclineAngle(scene: PhysicsScene): number {
  for (const obs of scene.observableDefinitions) {
    if (obs.parameters?.['kind'] === 'incline' && typeof obs.parameters?.['angle'] === 'number') {
      return obs.parameters['angle'] as number
    }
  }
  return 30
}

export function resolveFrictionCoefficient(scene: PhysicsScene): number {
  for (const f of scene.forces) {
    if (f.type === 'friction' && f.model === 'kinetic_friction') {
      const body = scene.bodies[0]
      if (body?.material?.frictionCoefficient !== undefined) {
        return body.material.frictionCoefficient
      }
    }
  }
  return 0
}

export function resolveUniformLinearModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  return {
    modelId: 'uniform_linear_motion',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration: vec3(0, 0, 0),
  }
}

export function resolveUniformlyAcceleratedModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  let acceleration = vec3(0, 0, 0)
  if (body.acceleration) {
    acceleration = toCanonicalVector(body.acceleration).vectorSI
  } else {
    const appliedForces = resolveAppliedForces(scene, body.id)
    if (appliedForces.length > 0) {
      const { acceleration: a } = newtonSecondLaw(mass, appliedForces)
      acceleration = a
    }
  }
  return {
    modelId: 'uniformly_accelerated_motion',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration,
  }
}

export function resolveProjectileModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const gravity = resolveGravity(scene)
  const groundY = resolveGroundY(scene)
  
  const g = Math.abs(gravity.y)
  const y0 = position.y - groundY
  const vy0 = velocity.y
  const vx = velocity.x
  
  let flightTime: number
  if (g === 0) {
    flightTime = 10
  } else if (Math.abs(vy0) < 1e-12) {
    flightTime = Math.sqrt(2 * Math.abs(y0) / g)
  } else {
    const disc = vy0 * vy0 + 2 * g * Math.abs(y0)
    if (vy0 > 0) {
      flightTime = (vy0 + Math.sqrt(disc)) / g
    } else if (y0 > 0) {
      flightTime = (-vy0 + Math.sqrt(Math.max(0, disc))) / g
    } else {
      flightTime = 0
    }
  }
  if (flightTime < 0) flightTime = 0
  if (!Number.isFinite(flightTime)) flightTime = 0

  const maxHeight = g > 0
    ? (y0 > 0 ? y0 + (vy0 * vy0) / (2 * g) : (vy0 > 0 ? (vy0 * vy0) / (2 * g) : 0))
    : 0
  const range = vx * flightTime

  const impactVy = vy0 - g * flightTime
  const impactVelocity = vec3(vx, impactVy, 0)

  const launchAngle = Math.atan2(vy0, Math.abs(vx) > 0 ? vx : 1e-10)

  return {
    modelId: 'projectile_motion',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration: vec3(0, -g, 0),
    gravity,
    groundY,
    initialPosition: position,
    initialVelocity: velocity,
    launchAngle,
    flightTime,
    range,
    maxHeight,
    impactVelocity,
  }
}

export function resolveNewtonSecondLawModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const appliedForces = resolveAppliedForces(scene, body.id)
  const gravity = resolveGravity(scene)
  const gravityForce = scale(gravity, mass)
  
  const allForces = [...appliedForces]
  if (scene.forces.some((f) => f.type === 'gravity')) {
    allForces.push(gravityForce)
  }
  
  const { netForce, acceleration } = newtonSecondLaw(mass, allForces)
  
  return {
    modelId: 'newton_second_law',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration,
    netForce,
  }
}

export function resolveInclinedPlaneModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const gravity = resolveGravity(scene)
  const inclineAngle = resolveInclineAngle(scene)
  const frictionCoefficient = resolveFrictionCoefficient(scene)
  
  const result = inclineAcceleration(mass, gravity, inclineAngle, frictionCoefficient)
  
  return {
    modelId: 'inclined_plane',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration: result.acceleration,
    inclineAngle,
    gravity,
    gravityParallel: result.gravityParallel,
    gravityNormal: result.gravityNormal,
    normalForce: result.normalForce,
    frictionCoefficient,
    frictionForce: result.frictionForce,
    netForce: result.netForce,
  }
}
