import type { PhysicsScene, Body } from '@physicsos/physics-scene'
import { toCanonicalVector } from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'
import { vec3, scale, magnitude, type Vector3 } from '@physicsos/physics-math'
import { PhysicsOSError } from '@physicsos/shared'
import type { CircularOrbitModel, MechanicsModel } from './types.ts'
import { circularOrbitPeriod, circularOrbitSpeed, gravitationalAcceleration } from '../orbit.ts'
import { newtonSecondLaw, inclineAcceleration } from '../solvers/force-dynamics.ts'

export function resolveBody(scene: PhysicsScene): {
  body: Body
  mass: number
  position: Vector3
  velocity: Vector3
} {
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

/** Spring connector facts — resolved from the scene's `spring` constraint. */
const springConstraint = (scene: PhysicsScene) => scene.constraints.find((c) => c.type === 'spring')

export function resolveSpringOscillatorModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const spring = springConstraint(scene)
  const stiffness = Number(spring?.parameters['stiffness'])
  const naturalLength = Number(spring?.parameters['naturalLength'])
  const anchorParam = spring?.parameters['anchor'] as { x?: number; y?: number } | undefined
  if (!Number.isFinite(stiffness) || stiffness <= 0) {
    throw new Error('spring_oscillator requires a spring constraint with stiffness > 0')
  }
  const anchor = vec3(anchorParam?.x ?? -3, anchorParam?.y ?? 0, 0)
  /* Equilibrium sits one natural length from the anchor towards the body:
     left-mounted springs hold the body to their right and vice versa. */
  const side = position.x >= anchor.x ? 1 : -1
  const equilibriumX = anchor.x + side * (Number.isFinite(naturalLength) ? naturalLength : 2)
  const angularFrequency = Math.sqrt(stiffness / mass)
  /* x(t) = x_eq + A cos(ωt) + B sin(ωt); A = x0 − x_eq, B = v0/ω. The
     amplitude/phase pair is the same oscillation written with one cosine. */
  const A = position.x - equilibriumX
  const B = velocity.x / angularFrequency
  const amplitude = Math.hypot(A, B)
  const phase = Math.atan2(-B, A)
  return {
    modelId: 'spring_oscillator',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration: vec3(-angularFrequency * angularFrequency * A, 0, 0),
    stiffness,
    naturalLength: Number.isFinite(naturalLength) ? naturalLength : 2,
    anchor,
    angularFrequency,
    period: (2 * Math.PI) / angularFrequency,
    amplitude,
    phase,
    equilibriumX,
  }
}

export function resolveSimplePendulumModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const rope = scene.constraints.find((c) => c.type === 'rope')
  const pivotParam = rope?.parameters['pivot'] as { x?: number; y?: number } | undefined
  const length = Number(rope?.parameters['length'])
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('simple_pendulum requires a rope constraint with length > 0')
  }
  const pivot = vec3(pivotParam?.x ?? 0, pivotParam?.y ?? 0, 0)
  const gravity = resolveGravity(scene)
  const g = magnitude(gravity)
  const angularFrequency = Math.sqrt(g / length)
  /* θ measured from straight down; θ(t) = θ0 cos(ωt) + (θ̇0/ω) sin(ωt).
     θ̇0 comes from the tangential launch speed: θ̇ = v·ê_t / L. */
  const dx = position.x - pivot.x
  const dy = position.y - pivot.y
  const theta0 = Math.atan2(dx, -dy)
  const tangent = { x: Math.cos(theta0), y: Math.sin(theta0) }
  const thetaDot0 = (velocity.x * tangent.x + velocity.y * tangent.y) / length
  const amplitude = Math.hypot(theta0, thetaDot0 / angularFrequency)
  const phase = Math.atan2(-thetaDot0 / angularFrequency, theta0)
  return {
    modelId: 'simple_pendulum',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration: vec3(0, 0, 0),
    length,
    pivot,
    gravity,
    angularFrequency,
    period: (2 * Math.PI) / angularFrequency,
    amplitude,
    phase,
  }
}

export function resolveHorizontalFrictionModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const gravity = resolveGravity(scene)
  const g = magnitude(gravity)
  const kineticCoefficient = body.material?.frictionCoefficient ?? 0
  /* μs ≥ μk physically; a scene that omits μs models them as equal. */
  const staticCoefficient = body.material?.staticFrictionCoefficient ?? kineticCoefficient
  const surface = scene.observableDefinitions.find(
    (o) => o.parameters?.['kind'] === 'friction_surface',
  )
  const forceRamp = Number(surface?.parameters?.['rampRate'] ?? 0)
  const maxForce = Number(surface?.parameters?.['maxForce'] ?? 30)
  const initialForce = scene.forces
    .filter((f) => f.targetId === body.id && f.type === 'custom' && f.vector)
    .reduce((sum, f) => sum + f.vector!.vector.x, 0)
  const normalForce = mass * g
  const staticLimit = staticCoefficient * normalForce
  /* The pull grows F0 + ramp·t and the body slips when it crosses μsN —
     unless the pull is already moving it or the cap never reaches the limit. */
  const slipTime =
    Math.abs(velocity.x) > 1e-9 || initialForce > staticLimit
      ? 0
      : forceRamp > 0 && staticLimit > initialForce
        ? (staticLimit - initialForce) / forceRamp
        : Number.POSITIVE_INFINITY
  return {
    modelId: 'horizontal_friction',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration: vec3(0, 0, 0),
    staticCoefficient,
    kineticCoefficient,
    gravity,
    initialForce,
    forceRamp,
    maxForce,
    normalForce,
    slipTime,
  }
}

export function resolveSpringStaticsModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const spring = springConstraint(scene)
  const stiffness = Number(spring?.parameters['stiffness'])
  const naturalLength = Number(spring?.parameters['naturalLength'])
  const anchorParam = spring?.parameters['anchor'] as { x?: number; y?: number } | undefined
  if (!Number.isFinite(stiffness) || stiffness <= 0) {
    throw new Error('spring_statics requires a spring constraint with stiffness > 0')
  }
  const gravity = resolveGravity(scene)
  const g = magnitude(gravity)
  const anchor = vec3(anchorParam?.x ?? 0, anchorParam?.y ?? 3, 0)
  const extension = (mass * g) / stiffness
  return {
    modelId: 'spring_statics',
    bodyId: body.id,
    mass,
    position,
    velocity,
    acceleration: vec3(0, 0, 0),
    stiffness,
    naturalLength: Number.isFinite(naturalLength) ? naturalLength : 2,
    anchor,
    gravity,
    extension,
    springForce: mass * g,
  }
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
    flightTime = Math.sqrt((2 * Math.abs(y0)) / g)
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

  const maxHeight =
    g > 0
      ? y0 > 0
        ? vy0 > 0
          ? y0 + (vy0 * vy0) / (2 * g)
          : y0
        : vy0 > 0
          ? (vy0 * vy0) / (2 * g)
          : 0
      : 0
  const range = vx * flightTime

  const impactVy = vy0 - g * flightTime
  const impactVelocity = vec3(vx, impactVy, 0)

  const launchAngle = Math.atan2(vy0, Math.abs(vx) > 0 ? vx : 1e-10)

  /* Apex is the instant the vertical velocity crosses zero: t = vy0 / g. A
     launch with no upward component (vy0 ≤ 0) never rises above its start, so
     the trajectory has no apex — the field stays undefined rather than naming
     an instant that does not exist. */
  const apexTime = vy0 > 0 && g > 0 ? vy0 / g : undefined

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
    apexTime,
  }
}

export function resolveNewtonSecondLawModel(scene: PhysicsScene): MechanicsModel {
  const { body, mass, position, velocity } = resolveBody(scene)
  const appliedForces = resolveAppliedForces(scene, body.id)
  const gravity = resolveGravity(scene)
  const gravityForce = scale(gravity, mass)

  const allForces = [...appliedForces]
  if (scene.forces.some((f) => f.type === 'gravity' && f.targetId === body.id)) {
    allForces.push(gravityForce)
  }
  /* A declared surface normal on the flat ground is the reaction balancing
     gravity — the block accelerates horizontally only. Without this term the
     gravity/normal force pair the scene declares injects gravity unbalanced
     (net force picked up -mg vertically, inflating |a| to ~2× F/m). */
  if (scene.forces.some((f) => f.type === 'normal' && f.targetId === body.id)) {
    allForces.push(scale(gravityForce, -1))
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

/**
 * Resolve a circular-orbit scene.
 *
 * The orbit observable carries GM and r; the body's own position and velocity
 * are then DERIVED from them rather than read — a scene that stated both would
 * be stating the same fact twice, and this is the one place that decides which
 * of the two wins.
 */
export const resolveCircularOrbitModel = (scene: PhysicsScene): CircularOrbitModel => {
  const body = scene.bodies[0]
  if (body === undefined) {
    throw new PhysicsOSError('ORBIT_BODY', 'A circular orbit needs exactly one satellite body.')
  }
  const orbit = scene.observableDefinitions.find((o) => o.parameters?.['kind'] === 'orbit')
  const gravitationalParameter = Number(orbit?.parameters?.['gravitationalParameter'] ?? NaN)
  const radius = Number(orbit?.parameters?.['radius'] ?? NaN)
  if (!Number.isFinite(gravitationalParameter) || gravitationalParameter <= 0) {
    throw new PhysicsOSError('ORBIT_GM', 'The central body must have a finite, positive GM.')
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new PhysicsOSError('ORBIT_RADIUS', 'The orbit radius must be finite and > 0.')
  }
  const mass = canonicalValue(body.mass)
  const speed = circularOrbitSpeed(gravitationalParameter, radius)
  return {
    modelId: 'circular_orbit',
    bodyId: body.id,
    mass,
    position: toCanonicalVector(body.position).vectorSI,
    velocity: toCanonicalVector(body.velocity).vectorSI,
    acceleration: { x: 0, y: 0, z: 0 },
    gravitationalParameter,
    radius,
    speed,
    period: circularOrbitPeriod(gravitationalParameter, radius),
    angularRate: speed / radius,
    force: mass * gravitationalAcceleration(gravitationalParameter, radius),
    centre: { x: 0, y: 0, z: 0 },
  }
}
