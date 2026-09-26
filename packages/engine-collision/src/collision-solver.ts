import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  quantityVector,
  type DerivedQuantity,
  type QuantityVector,
  type PhysicsEventLike,
} from '@physicsos/physics-core'
import { asPhysicsEventId } from '@physicsos/shared'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { SimulationState } from '@physicsos/physics-core'

/** A collision event published at the scene time it occurs. */
export interface CollisionPhysicsEvent extends PhysicsEventLike {
  type: 'CollisionOccurred'
  bodyA: string
  bodyB: string
  /** Relative normal speed at the instant of impact, m/s. */
  impactSpeed: number
}

/** Mutable solver body — plain SI numbers, no scene wrappers. */
export interface SolverBody {
  readonly id: string
  readonly m: number
  readonly r: number
  /** Coefficient of restitution 0..1; the pair uses min(eA, eB). */
  readonly e: number
  x: number
  y: number
  vx: number
  vy: number
}

export interface CollisionSimulationOptions {
  /** Main storage step in seconds (states are sampled at this cadence). */
  readonly dt?: number
  /** Internal substep in seconds; collisions are resolved per substep. */
  readonly subDt?: number
  readonly startTime?: number
  readonly endTime?: number
}

export interface CollisionSimulation {
  readonly states: SimulationState[]
  readonly events: CollisionPhysicsEvent[]
  /** Scene time of the first wall reflection, or null when no body touched a
     wall. A wall applies an external impulse, so total-momentum conservation
     is only verifiable before this instant. */
  readonly firstWallContactAt: number | null
}

const DEFAULT_DT = 1 / 120
const DEFAULT_SUB_DT = 1 / 2000
/** How many sweep passes a substep may run before accepting residual overlap. */
const MAX_CONTACT_PASSES = 12

export interface ResolvedCollisionScene {
  readonly scene: PhysicsScene
  readonly bodies: SolverBody[]
  /** Gravity acceleration in m/s²; [0,0] when the bench is frictionless. */
  readonly gravity: { x: number; y: number }
  /** Reflective walls centred on the origin; null when unbounded. */
  readonly boundary: { halfW: number; halfH: number; e: number } | null
}

const toVector = (value: QuantityVector): { x: number; y: number; z: number } => {
  /* The scene factories build m / m·s⁻¹ vectors, so .vector carries the SI
     numbers directly. Dimension checks already happened in validateScene. */
  const vector = (value as { vector?: { x: number; y: number; z: number } }).vector
  if (vector !== undefined) return vector
  return value as unknown as { x: number; y: number; z: number }
}

export const resolveCollisionScene = (scene: PhysicsScene): ResolvedCollisionScene => {
  const bodies: SolverBody[] = scene.bodies.map((body) => {
    const position = toVector(body.position)
    const velocity = toVector(body.velocity)
    const radius = body.shape.type === 'circle' ? canonicalValue(body.shape.radius) : 0.5
    const restitution = body.material?.restitution === undefined ? 1 : body.material.restitution
    return {
      id: body.id,
      m: canonicalValue(body.mass),
      r: radius,
      e: restitution,
      x: position.x,
      y: position.y,
      vx: velocity.x,
      vy: velocity.y,
    }
  })

  let gravity = { x: 0, y: 0 }
  for (const field of scene.fields) {
    if (field.type === 'uniform_gravity') {
      const a = toVector(field.acceleration)
      gravity = { x: a.x, y: a.y }
    }
  }

  let boundary: ResolvedCollisionScene['boundary'] = null
  for (const wall of scene.boundaries) {
    if (wall.type !== 'rectangle' || wall.geometry.type !== 'rectangle') continue
    if (wall.behavior !== undefined && wall.behavior.type !== 'reflect') continue
    const width = canonicalValue(wall.geometry.width)
    const height = canonicalValue(wall.geometry.height)
    const e =
      wall.behavior?.type === 'reflect' && wall.behavior.restitution !== undefined
        ? wall.behavior.restitution
        : 1
    boundary = { halfW: width / 2, halfH: height / 2, e }
  }

  return { scene, bodies, gravity, boundary }
}

/**
 * The impulse of one contact pair along the collision normal n (from A to B):
 *
 *   vn  = (vB − vA)·n          (closing speed, negative when approaching)
 *   j   = −(1+e)·vn / (1/mA + 1/mB)
 *   vA −= (j/mA)·n
 *   vB += (j/mB)·n
 *
 * Internal pairs conserve momentum exactly (the impulses are equal and
 * opposite) and reproduce the restitution definition: the normal relative speed
 * after the collision is −e times the closing speed before it.
 */
const resolvePair = (a: SolverBody, b: SolverBody, nx: number, ny: number): number => {
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn >= 0) return 0
  const e = Math.min(a.e, b.e)
  const invA = 1 / a.m
  const invB = 1 / b.m
  const j = (-(1 + e) * vn) / (invA + invB)
  a.vx -= j * invA * nx
  a.vy -= j * invA * ny
  b.vx += j * invB * nx
  b.vy += j * invB * ny
  return -vn
}

/** Positional correction: push overlapping circles apart along the normal. */
const separate = (a: SolverBody, b: SolverBody, nx: number, ny: number, overlap: number): void => {
  const invA = 1 / a.m
  const invB = 1 / b.m
  const total = invA + invB
  const shift = overlap / total
  a.x -= nx * shift * invA
  a.y -= ny * shift * invA
  b.x += nx * shift * invB
  b.y += ny * shift * invB
}

/**
 * Advances the scene by one substep: integrate (semi-implicit Euler when there
 * is gravity, free drift otherwise), then resolve contacts to convergence and
 * reflect off the boundary. Each contact resolved in this substep is reported
 * once, with the substep's scene time.
 */
const substep = (
  scene: ResolvedCollisionScene,
  dt: number,
  time: number,
  events: CollisionPhysicsEvent[],
  wall: { count: number; firstAt: number | null },
): void => {
  const { bodies, gravity, boundary } = scene

  for (const body of bodies) {
    if (gravity.x !== 0 || gravity.y !== 0) {
      body.vx += gravity.x * dt
      body.vy += gravity.y * dt
    }
    body.x += body.vx * dt
    body.y += body.vy * dt
  }

  /* Sweep contacts to convergence: a new collision created by a resolved one
     (three bodies collapsing at once) is caught by the next pass. */
  for (let pass = 0; pass < MAX_CONTACT_PASSES; pass += 1) {
    let resolvedAny = false
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i]
      if (a === undefined) continue
      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j]
        if (b === undefined) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        const minD = a.r + b.r
        if (d < 1e-12) continue
        const nx = dx / d
        const ny = dy / d
        if (d < minD) {
          const impactSpeed = resolvePair(a, b, nx, ny)
          if (impactSpeed > 0) {
            events.push({
              eventId: asPhysicsEventId(`event-collision-${a.id}-${b.id}-${events.length}`),
              sceneId: scene.scene.id,
              revision: scene.scene.revision,
              type: 'CollisionOccurred',
              time,
              bodyA: a.id,
              bodyB: b.id,
              impactSpeed,
            })
          }
          separate(a, b, nx, ny, minD - d)
          resolvedAny = true
        }
      }
    }
    if (!resolvedAny) break
  }

  /* Boundary reflection. The wall's restitution scales the outgoing normal
     component; tangential motion is untouched. A reflection is an external
     impulse on the system, so each one is counted for the verifier. */
  if (boundary !== null) {
    for (const body of bodies) {
      const { halfW, halfH, e } = boundary
      let reflected = false
      if (body.x - body.r < -halfW) {
        body.x = -halfW + body.r
        body.vx = Math.abs(body.vx) * e
        reflected = true
      } else if (body.x + body.r > halfW) {
        body.x = halfW - body.r
        body.vx = -Math.abs(body.vx) * e
        reflected = true
      }
      if (body.y - body.r < -halfH) {
        body.y = -halfH + body.r
        body.vy = Math.abs(body.vy) * e
        reflected = true
      } else if (body.y + body.r > halfH) {
        body.y = halfH - body.r
        body.vy = -Math.abs(body.vy) * e
        reflected = true
      }
      if (reflected) {
        wall.count += 1
        if (wall.firstAt === null) wall.firstAt = time
      }
    }
  }
}

const derivedOf = (bodies: readonly SolverBody[]): DerivedQuantity[] => {
  const derived: DerivedQuantity[] = []
  const assumptions = ['collision solver', 'internal impulses conserve momentum']
  let totalPx = 0
  let totalPy = 0
  let totalK = 0
  for (const body of bodies) {
    const px = body.m * body.vx
    const py = body.m * body.vy
    totalPx += px
    totalPy += py
    totalK += 0.5 * body.m * (body.vx * body.vx + body.vy * body.vy)
    derived.push({
      key: 'momentum',
      targetId: body.id,
      value: quantityVector({ x: px, y: py, z: 0 }, 'kg*m/s', 'momentum'),
      formula: { expression: 'p = mv' },
      assumptions,
    })
    derived.push({
      key: 'kinetic_energy',
      targetId: body.id,
      value: quantity(0.5 * body.m * (body.vx * body.vx + body.vy * body.vy), 'J', 'energy'),
      formula: { expression: 'K = ½mv²' },
      assumptions,
    })
  }
  derived.push({
    key: 'total_momentum',
    value: quantityVector({ x: totalPx, y: totalPy, z: 0 }, 'kg*m/s', 'momentum'),
    formula: { expression: 'P = Σpᵢ' },
    assumptions,
  })
  derived.push({
    key: 'total_kinetic_energy',
    value: quantity(totalK, 'J', 'energy'),
    formula: { expression: 'K = Σ½mᵢvᵢ²' },
    assumptions,
  })
  return derived
}

const stateOf = (scene: ResolvedCollisionScene, time: number): SimulationState => ({
  time: quantity(time, 's', 'time'),
  objects: scene.bodies.map((body) => ({
    id: body.id,
    position: quantityVector({ x: body.x, y: body.y, z: 0 }, 'm', 'length'),
    velocity: quantityVector({ x: body.vx, y: body.vy, z: 0 }, 'm/s', 'velocity'),
  })),
  derived: derivedOf(scene.bodies),
})

/**
 * Runs the collision simulation over [startTime, endTime] in ONE forward pass,
 * recording a state at every storage sample. The substep cadence keeps fast
 * bodies from tunnelling through each other or the walls: each substep
 * integrates, then sweeps contacts to convergence before the next one. Events
 * carry the scene time at which the contact was resolved.
 */
export const simulateCollision = (
  scene: ResolvedCollisionScene,
  options: CollisionSimulationOptions,
): CollisionSimulation => {
  const dt = options.dt ?? DEFAULT_DT
  const subDt = Math.min(options.subDt ?? DEFAULT_SUB_DT, dt)
  const startTime = options.startTime ?? 0
  const endTime = options.endTime ?? 10

  const events: CollisionPhysicsEvent[] = []
  const states: SimulationState[] = []
  const wall = { count: 0, firstAt: null as number | null }

  const time = startTime
  states.push(stateOf(scene, time))

  const totalDuration = Math.max(0, endTime - startTime)
  const totalSubsteps = Math.ceil(totalDuration / subDt)
  let nextSample = startTime + dt

  for (let step = 0; step < totalSubsteps; step += 1) {
    const t = startTime + (step + 1) * subDt
    substep(scene, subDt, t, events, wall)
    if (t >= nextSample - 1e-12) {
      states.push(stateOf(scene, t))
      nextSample += dt
    }
  }

  /* Make sure the final state lands exactly on endTime's sample. */
  const last = states[states.length - 1]
  if (last === undefined || Math.abs(last.time.value - endTime) > dt / 2) {
    states.push(stateOf(scene, endTime))
  }

  return { states, events, firstWallContactAt: wall.firstAt }
}
