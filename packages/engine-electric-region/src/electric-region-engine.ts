import {
  add,
  dot,
  isFiniteVector,
  magnitude,
  scale,
  subtract,
  type Vector3,
} from '@physicsos/physics-math'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'
import {
  check,
  invalidModelCondition,
  quantityVector,
  summarizeVerification,
  supported,
  toCanonicalVector,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationResult,
} from '@physicsos/physics-core'
import {
  isParallelPlateScene,
  plateLengthOf,
  plateSeparationOf,
  validateScene,
  type PhysicsScene,
  type UniformElectricField,
} from '@physicsos/physics-scene'
import { electricForce } from '@physicsos/physics-electric-core'

export const ELECTRIC_REGION_ENGINE_ID = 'engine-electric-region'
export const ELECTRIC_REGION_ENGINE_VERSION = '1.0.0'
export const PARALLEL_PLATE_MODEL = 'charged_particle_bounded_uniform_electric_field'

const DEFAULT_DURATION_SECONDS = 1e-8
const DEFAULT_TRAJECTORY_SEGMENTS = 120
const ASSUMPTIONS = [
  'bounded uniform electric field',
  'electric force only inside field region',
  '2D analytical motion',
  'zero field outside region',
] as const

/* --------------------------------------------------------------- model -- */

export interface ParallelPlateModel {
  readonly modelId: typeof PARALLEL_PLATE_MODEL
  readonly particleId: string
  readonly fieldId: string
  readonly regionId: string
  readonly mass: number
  readonly charge: number
  readonly position: Vector3
  readonly velocity: Vector3
  readonly electricField: Vector3
  readonly force: Vector3
  readonly acceleration: Vector3
  readonly plateLength: number
  readonly plateSeparation: number
  /** x-coordinate of the left edge of the field region. */
  readonly xLeft: number
  /** x-coordinate of the right edge of the field region. */
  readonly xRight: number
  /** y-coordinate of the top plate. */
  readonly yTop: number
  /** y-coordinate of the bottom plate. */
  readonly yBottom: number
}

const uniformElectricFields = (scene: PhysicsScene): UniformElectricField[] =>
  scene.fields.filter((field): field is UniformElectricField => field.type === 'uniform_electric')

const failure = (condition: string, message: string) => ({ condition, message })

/**
 * Resolve a parallel-plate scene into the numerical model the solver consumes.
 * Throws when the scene does not satisfy the engine's preconditions.
 */
export const resolveParallelPlateModel = (scene: PhysicsScene): ParallelPlateModel => {
  const engine = new ElectricRegionEngine()
  const support = engine.canHandle(scene)
  if (!support.supported) {
    throw new (class extends Error {
      readonly domainError = { code: 'UNSUPPORTED_MODEL', message: '', category: 'unsupported' as const, retryable: false }
    })(`Engine "${ELECTRIC_REGION_ENGINE_ID}" cannot model this scene.`)
  }

  const particle = scene.particles[0]
  const field = uniformElectricFields(scene)[0]
  if (particle === undefined || particle.charge === undefined || field === undefined || field.regionId === undefined) {
    throw new PhysicsOSError('ELECTRIC_MODEL_INCOMPLETE', 'Parallel-plate model inputs are incomplete.')
  }

  const mass = canonicalValue(particle.mass)
  const charge = canonicalValue(particle.charge)
  const position = toCanonicalVector(particle.position).vectorSI
  const velocity = toCanonicalVector(particle.velocity).vectorSI
  const electricField = toCanonicalVector(field.fieldStrength).vectorSI
  const force = electricForce(charge, electricField)
  const acceleration = scale(force, 1 / mass)

  const plateLength = plateLengthOf(scene)
  const plateSeparation = plateSeparationOf(scene)

  return {
    modelId: PARALLEL_PLATE_MODEL,
    particleId: particle.id,
    fieldId: field.id,
    regionId: field.regionId,
    mass,
    charge,
    position,
    velocity,
    electricField,
    force,
    acceleration,
    plateLength,
    plateSeparation,
    xLeft: -plateLength / 2,
    xRight: plateLength / 2,
    yTop: plateSeparation / 2,
    yBottom: -plateSeparation / 2,
  }
}

/* ----------------------------------------------------- trajectory phases -- */

/** Phase of the particle's journey relative to the field region. */
type Phase = 'before' | 'inside' | 'after' | 'hit'

interface PhaseResult {
  readonly phase: Phase
  /** Time elapsed since simulation start when this phase begins. */
  readonly tStart: number
  /** Position at the start of this phase. */
  readonly position: Vector3
  /** Velocity at the start of this phase. */
  readonly velocity: Vector3
}

/**
 * Compute the timeline of the particle's motion phases.
 *
 * The particle starts at `position` with `velocity`. It first travels in a
 * straight line (phase "before"), then enters the field region at x = xLeft
 * (phase "inside"), where it experiences constant acceleration a = qE/m.
 * Inside the field it either:
 *  - exits at x = xRight (phase "after"), or
 *  - strikes a plate at y = ±plateSeparation/2 (phase "hit").
 */
const computePhases = (model: ParallelPlateModel): {
  before: PhaseResult
  inside: PhaseResult
  after: PhaseResult | null
  hit: { plate: 'top' | 'bottom'; time: number; position: Vector3; velocity: Vector3 } | null
  enterTime: number
  exitTime: number | null
  hitTime: number | null
} => {
  const { position: p0, velocity: v0, acceleration: a, xLeft, xRight, yTop, yBottom } = model
  const vx = v0.x

  // Time to enter the field region. Entry can be from the left (vx > 0) or from
  // the right (vx < 0); a particle that starts inside is already in at t=0. A
  // particle that starts outside and moves away (or is stationary) never enters:
  // enterTime = Infinity keeps it in the "before" phase for the whole run, so
  // the field force is never applied to it.
  let enterTime: number
  let entrySide: 'left' | 'right' | 'inside'
  if (p0.x >= xLeft && p0.x <= xRight) {
    // Already inside the field region at t=0.
    enterTime = 0
    entrySide = 'inside'
  } else if (vx > 0 && p0.x < xLeft) {
    enterTime = (xLeft - p0.x) / vx
    entrySide = 'left'
  } else if (vx < 0 && p0.x > xRight) {
    enterTime = (p0.x - xRight) / -vx
    entrySide = 'right'
  } else {
    enterTime = Number.POSITIVE_INFINITY
    entrySide = 'inside'
  }

  const neverEnters = !Number.isFinite(enterTime)

  // Position and velocity at field entry.
  const posAtEntry = neverEnters ? p0 : add(p0, scale(v0, enterTime))
  const velAtEntry = v0 // acceleration is zero before entry

  // Edge the particle crosses when it leaves the region, and the x-coordinate
  // at entry: both depend on the entry side, not on vx alone.
  const entryX = entrySide === 'right' ? xRight : entrySide === 'left' ? xLeft : p0.x
  const exitX = vx >= 0 ? xRight : xLeft

  // Time inside the field (from entry to the far edge at the current vx). For a
  // particle already inside, that is the remaining distance, not the full width.
  const tInside = vx !== 0 ? (exitX - entryX) / vx : Infinity

  if (neverEnters) {
    return {
      before: { phase: 'before', tStart: 0, position: p0, velocity: v0 },
      inside: { phase: 'inside', tStart: Number.POSITIVE_INFINITY, position: p0, velocity: v0 },
      after: null,
      hit: null,
      enterTime: Number.POSITIVE_INFINITY,
      exitTime: null,
      hitTime: null,
    }
  }

  // Check for plate hit during field traversal.
  // y(t_in) = y_entry + vy_entry * t_in + 0.5 * a_y * t_in²
  // Solve y(t_in) = yTop and y(t_in) = yBottom.
  let hitPlate: 'top' | 'bottom' | null = null
  let hitTimeInside = Infinity

  const aY = a.y
  const yEntry = posAtEntry.y
  const vyEntry = velAtEntry.y

  // Quadratic: 0.5*a_y*t² + vy_entry*t + (y_entry - y_target) = 0
  const solveHit = (yTarget: number): number | null => {
    if (Math.abs(aY) < 1e-30) {
      // No acceleration — linear: t = (yTarget - yEntry) / vyEntry
      if (Math.abs(vyEntry) < 1e-30) return null
      const t = (yTarget - yEntry) / vyEntry
      return t >= 0 && t <= tInside ? t : null
    }
    const halfA = 0.5 * aY
    const b = vyEntry
    const c = yEntry - yTarget
    const disc = b * b - 4 * halfA * c
    if (disc < 0) return null
    const sqrtDisc = Math.sqrt(disc)
    const t1 = (-b + sqrtDisc) / (2 * halfA)
    const t2 = (-b - sqrtDisc) / (2 * halfA)
    let earliest: number | null = null
    for (const t of [t1, t2]) {
      if (t >= 0 && t <= tInside) {
        if (earliest === null || t < earliest) earliest = t
      }
    }
    return earliest
  }

  const tHitTop = solveHit(yTop)
  const tHitBottom = solveHit(yBottom)
  if (tHitTop !== null && tHitTop < hitTimeInside) {
    hitTimeInside = tHitTop
    hitPlate = 'top'
  }
  if (tHitBottom !== null && tHitBottom < hitTimeInside) {
    hitTimeInside = tHitBottom
    hitPlate = 'bottom'
  }

  const hitTime = hitPlate !== null ? enterTime + hitTimeInside : null
  const exitTime = hitPlate === null ? enterTime + tInside : null

  // Position/velocity at hit or exit.
  let after: PhaseResult | null = null
  let hit: { plate: 'top' | 'bottom'; time: number; position: Vector3; velocity: Vector3 } | null = null

  if (hitPlate !== null && hitTime !== null) {
    const tIn = hitTimeInside
    const posHit = {
      x: entryX + vx * tIn,
      y: hitPlate === 'top' ? yTop : yBottom,
      z: 0,
    }
    const velHit = {
      x: vx,
      y: vyEntry + aY * tIn,
      z: 0,
    }
    hit = { plate: hitPlate, time: hitTime, position: posHit, velocity: velHit }
  } else if (exitTime !== null) {
    const tIn = tInside
    const posExit = {
      x: exitX,
      y: yEntry + vyEntry * tIn + 0.5 * aY * tIn * tIn,
      z: 0,
    }
    const velExit = {
      x: vx,
      y: vyEntry + aY * tIn,
      z: 0,
    }
    after = {
      phase: 'after',
      tStart: exitTime,
      position: posExit,
      velocity: velExit,
    }
  }

  return {
    before: { phase: 'before', tStart: 0, position: p0, velocity: v0 },
    inside: { phase: 'inside', tStart: enterTime, position: posAtEntry, velocity: velAtEntry },
    after,
    hit,
    enterTime,
    exitTime,
    hitTime,
  }
}

/**
 * Compute particle position and velocity at absolute simulation time `t`.
 *
 * Inside the field region the particle experiences constant acceleration
 * a = qE/m (along y); outside it moves with constant velocity.
 */
const motionAt = (model: ParallelPlateModel, t: number): { position: Vector3; velocity: Vector3; acceleration: Vector3 } => {
  const phases = computePhases(model)
  const { before, inside, after, hit, enterTime, exitTime, hitTime } = phases

  const zero = { x: 0, y: 0, z: 0 }

  // Before field entry.
  if (t < enterTime) {
    const dt = t - before.tStart
    return {
      position: add(before.position, scale(before.velocity, dt)),
      velocity: before.velocity,
      acceleration: zero,
    }
  }

  // Inside field — but check for hit.
  if (hitTime !== null && t >= hitTime && hit !== null) {
    // After hit: particle stops.
    return {
      position: hit.position,
      velocity: zero,
      acceleration: zero,
    }
  }

  if (exitTime !== null && t >= exitTime && after !== null) {
    // After field exit.
    const dt = t - after.tStart
    return {
      position: add(after.position, scale(after.velocity, dt)),
      velocity: after.velocity,
      acceleration: zero,
    }
  }

  // Inside the field.
  const tIn = t - enterTime
  const posInside = {
    x: inside.position.x + inside.velocity.x * tIn,
    y: inside.position.y + inside.velocity.y * tIn + 0.5 * model.acceleration.y * tIn * tIn,
    z: 0,
  }
  const velInside = {
    x: inside.velocity.x,
    y: inside.velocity.y + model.acceleration.y * tIn,
    z: 0,
  }
  return {
    position: posInside,
    velocity: velInside,
    acceleration: model.acceleration,
  }
}

/* ----------------------------------------------------------- state/dq's -- */

const stateAtForModel = (model: ParallelPlateModel, t: number): SimulationState => {
  const motion = motionAt(model, t)
  const isInField =
    motion.position.x >= model.xLeft &&
    motion.position.x <= model.xRight &&
    motion.position.y >= model.yBottom &&
    motion.position.y <= model.yTop

  return {
    time: quantity(t, 's', 'time'),
    objects: [
      {
        id: model.particleId,
        position: quantityVector(motion.position, 'm', 'length'),
        velocity: quantityVector(motion.velocity, 'm/s', 'velocity'),
        acceleration: quantityVector(motion.acceleration, 'm/s^2', 'acceleration'),
        values: {
          electricField: quantityVector(
            isInField ? model.electricField : { x: 0, y: 0, z: 0 },
            'V/m',
            'electric_field',
          ),
          electricForce: quantityVector(
            isInField ? model.force : { x: 0, y: 0, z: 0 },
            'N',
            'force',
          ),
        },
      },
    ],
    derived: derivedAt(model, t),
  }
}

const derivedAt = (model: ParallelPlateModel, t: number): DerivedQuantity[] => {
  const motion = motionAt(model, t)
  const phases = computePhases(model)
  const isInField =
    motion.position.x >= model.xLeft &&
    motion.position.x <= model.xRight &&
    motion.position.y >= model.yBottom &&
    motion.position.y <= model.yTop

  const displacement = subtract(motion.position, model.position)
  const speed = magnitude(motion.velocity)
  const kineticEnergy = 0.5 * model.mass * speed * speed
  const initialKineticEnergy = 0.5 * model.mass * magnitude(model.velocity) ** 2

  // Work and potential energy: only the field-portion contributes.
  // W = F · Δr but F is only active inside the field region.
  // For simplicity, W_field = q * E · Δr_inside (displacement while inside field).
  // If currently inside, use displacement from entry to current; if after exit, use full inside displacement.
  let workByField: number
  let potentialEnergyChange: number
  if (isInField) {
    const tIn = t - phases.enterTime
    const dispInside = {
      x: model.velocity.x * tIn,
      y: model.velocity.y * tIn + 0.5 * model.acceleration.y * tIn * tIn,
      z: 0,
    }
    workByField = dot(model.force, dispInside)
    potentialEnergyChange = -model.charge * dot(model.electricField, dispInside)
  } else if (phases.exitTime !== null && t >= phases.exitTime) {
    // After exit: work is done only over the inside portion.
    const tInside = phases.exitTime - phases.enterTime
    const dispInside = {
      x: model.velocity.x * tInside,
      y: model.velocity.y * tInside + 0.5 * model.acceleration.y * tInside * tInside,
      z: 0,
    }
    workByField = dot(model.force, dispInside)
    potentialEnergyChange = -model.charge * dot(model.electricField, dispInside)
  } else {
    // Before entry or after hit: no work done by field.
    workByField = 0
    potentialEnergyChange = 0
  }

  const derived: DerivedQuantity[] = [
    {
      key: 'electric_field_vector',
      targetId: model.fieldId,
      value: quantityVector(
        isInField ? model.electricField : { x: 0, y: 0, z: 0 },
        'V/m',
        'electric_field',
      ),
      formula: { expression: isInField ? 'E = constant (inside region)' : 'E = 0 (outside region)' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_field_magnitude',
      targetId: model.fieldId,
      value: quantity(
        isInField ? magnitude(model.electricField) : 0,
        'V/m',
        'electric_field',
      ),
      formula: { expression: '|E|' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_force_vector',
      targetId: model.particleId,
      value: quantityVector(
        isInField ? model.force : { x: 0, y: 0, z: 0 },
        'N',
        'force',
      ),
      formula: { expression: 'F = qE' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_force_magnitude',
      targetId: model.particleId,
      value: quantity(isInField ? magnitude(model.force) : 0, 'N', 'force'),
      formula: { expression: '|F| = |qE|' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'acceleration_vector',
      targetId: model.particleId,
      value: quantityVector(motion.acceleration, 'm/s^2', 'acceleration'),
      formula: { expression: isInField ? 'a = qE / m' : 'a = 0 (outside region)' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'acceleration_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(motion.acceleration), 'm/s^2', 'acceleration'),
      formula: { expression: '|a| = |qE| / m' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'displacement_vector',
      targetId: model.particleId,
      value: quantityVector(displacement, 'm', 'length'),
      formula: { expression: 'Δr = r(t) - r0' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'speed',
      targetId: model.particleId,
      value: quantity(speed, 'm/s', 'velocity'),
      formula: { expression: '|v(t)|' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'kinetic_energy',
      targetId: model.particleId,
      value: quantity(kineticEnergy, 'J', 'energy'),
      formula: { expression: 'K = 0.5m|v|²' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'work_by_electric_field',
      targetId: model.particleId,
      value: quantity(workByField, 'J', 'energy'),
      formula: { expression: 'W = F · Δr_inside' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_potential_energy_change',
      targetId: model.particleId,
      value: quantity(potentialEnergyChange, 'J', 'energy'),
      formula: { expression: 'ΔU = -qE · Δr_inside' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'kinetic_energy_change',
      targetId: model.particleId,
      value: quantity(kineticEnergy - initialKineticEnergy, 'J', 'energy'),
      formula: { expression: 'ΔK = W_electric' },
      assumptions: [...ASSUMPTIONS],
    },
  ]

  // Exit-derived quantities (only when the particle has exited the field).
  if (phases.exitTime !== null && t >= phases.exitTime && phases.after !== null) {
    const exitVelocity = phases.after.velocity
    const deflection = phases.after.position.y // y-displacement at exit (relative to y=0)
    derived.push(
      {
        key: 'exit_velocity',
        targetId: model.particleId,
        value: quantityVector(exitVelocity, 'm/s', 'velocity'),
        formula: { expression: 'v_exit' },
        assumptions: [...ASSUMPTIONS],
      },
      {
        key: 'deflection',
        targetId: model.particleId,
        value: quantity(deflection, 'm', 'length'),
        formula: { expression: 'y_exit = vy0*(L/vx) + 0.5*a*(L/vx)²' },
        assumptions: [...ASSUMPTIONS],
      },
    )
  }

  // Hit-derived quantities.
  if (phases.hit !== null && t >= phases.hit.time) {
    derived.push({
      key: 'hit_velocity',
      targetId: model.particleId,
      value: quantityVector(phases.hit.velocity, 'm/s', 'velocity'),
      formula: { expression: 'v at plate impact' },
      assumptions: [...ASSUMPTIONS],
    })
  }

  return derived
}

/* ---------------------------------------------------------- verification -- */

const buildVerification = (
  model: ParallelPlateModel,
  scene: PhysicsScene,
  states: SimulationState[],
  events: PhysicsEventLike[],
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: import('@physicsos/physics-core').VerificationCheck[] = [
    ...sceneVerification.checks,
  ]

  // Bounded field geometry: region must have positive width and height.
  checks.push(
    check(
      'bounded_field_geometry',
      'constraint',
      model.plateLength > 0 && model.plateSeparation > 0,
      {
        message: 'Field region must have positive width (plate length) and height (plate separation).',
        details: { plateLength: model.plateLength, plateSeparation: model.plateSeparation },
      },
    ),
  )

  // Electric force consistency: F = qE.
  const computedForce = electricForce(model.charge, model.electricField)
  const forceDiff = magnitude(subtract(computedForce, model.force))
  checks.push(
    check('electric_force_consistency', 'constraint', forceDiff < 1e-12, {
      message: 'F = qE verified.',
    }),
  )

  // Kinematic consistency: inside field, a = qE/m constant.
  const computedAccel = scale(computedForce, 1 / model.mass)
  const accelDiff = magnitude(subtract(computedAccel, model.acceleration))
  checks.push(
    check('kinematic_consistency', 'constraint', accelDiff < 1e-12, {
      message: 'a = qE/m verified (constant inside field region).',
    }),
  )

  // Energy consistency: W = ΔK.
  // Check at the final state: work done by field = change in kinetic energy.
  const phases = computePhases(model)
  if (states.length >= 2) {
    const firstState = states[0]
    const lastState = states[states.length - 1]
    if (firstState?.objects[0]?.velocity !== undefined && lastState?.objects[0]?.velocity !== undefined) {
      const v0 = toCanonicalVector(firstState.objects[0].velocity).vectorSI
      const v1 = toCanonicalVector(lastState.objects[0].velocity).vectorSI
      const k0 = 0.5 * model.mass * magnitude(v0) ** 2
      const k1 = 0.5 * model.mass * magnitude(v1) ** 2
      const dK = k1 - k0
      // Work by field: only computed over the inside-field portion.
      let wField = 0
      // Kinetic energy the plate absorbs on impact (velocity zeroes after a hit),
      // so ΔK reflects that loss on top of the field's work.
      let plateAbsorbed = 0
      const endTime = canonicalValue(lastState.time)
      if (phases.exitTime !== null && endTime >= phases.exitTime) {
        const tInside = phases.exitTime - phases.enterTime
        const dispInside = {
          x: model.velocity.x * tInside,
          y: model.velocity.y * tInside + 0.5 * model.acceleration.y * tInside * tInside,
          z: 0,
        }
        wField = dot(model.force, dispInside)
      } else if (phases.hitTime !== null && endTime >= phases.hitTime) {
        const tIn = phases.hitTime - phases.enterTime
        const dispInside = {
          x: model.velocity.x * tIn,
          y: model.velocity.y * tIn + 0.5 * model.acceleration.y * tIn * tIn,
          z: 0,
        }
        wField = dot(model.force, dispInside)
        if (phases.hit !== null) {
          plateAbsorbed = 0.5 * model.mass * magnitude(phases.hit.velocity) ** 2
        }
      } else if (endTime > phases.enterTime) {
        // Still inside field.
        const tIn = endTime - phases.enterTime
        const dispInside = {
          x: model.velocity.x * tIn,
          y: model.velocity.y * tIn + 0.5 * model.acceleration.y * tIn * tIn,
          z: 0,
        }
        wField = dot(model.force, dispInside)
      }
      checks.push(
        check('energy_consistency', 'conservation', Math.abs(dK + plateAbsorbed - wField) < 1e-15, {
          message: 'W = ΔK verified.',
          details: { dK, wField, plateAbsorbed, diff: Math.abs(dK + plateAbsorbed - wField) },
        }),
      )
    }
  }

  // Event consistency: a trajectory that crosses the region boundary within the
  // simulated window must produce a transition event. A trajectory that never
  // enters the region (or whose crossing lies outside the window, including an
  // empty window with no sampled states) produces none legitimately.
  const finalState = states.at(-1)
  const crossedInWindow = finalState !== undefined
    && Number.isFinite(phases.enterTime)
    && phases.enterTime <= canonicalValue(finalState.time)
  checks.push(
    check('events_present', 'trajectory', !crossedInWindow || events.length > 0, {
      message: 'A bounded-field trajectory that crosses the region produces region-transition events.',
    }),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createElectricRegionSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'electric',
    options: {
      ...(scene.timeline.endTime === undefined ? {} : { endTime: scene.timeline.endTime }),
    },
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

export class ElectricRegionEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = ELECTRIC_REGION_ENGINE_ID
  readonly engineVersion = ELECTRIC_REGION_ENGINE_VERSION
  readonly domain = 'electric' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    // Fast path: use isParallelPlateScene for quick rejection.
    if (!isParallelPlateScene(scene)) {
      // Not a parallel-plate scene. Could be an unbounded uniform field or a
      // point-charge scene — either way, not our model.
      return unsupportedModel(
        [failure('parallel_plate_scene', 'Electric Region Engine requires a parallel-plate scene with a region-bound uniform electric field.')],
        ELECTRIC_REGION_ENGINE_ID,
      )
    }

    // Structural validation.
    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(ELECTRIC_REGION_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        ELECTRIC_REGION_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    // Strict dimension check.
    if (scene.dimension !== '2d') {
      return unsupportedModel(
        [failure('scene_is_2d', 'Electric Region Engine supports 2D scenes only.')],
        ELECTRIC_REGION_ENGINE_ID,
      )
    }

    // Exactly one particle, no rigid bodies.
    if (scene.particles.length !== 1 || scene.bodies.length > 0) {
      return unsupportedModel(
        [failure('single_particle', 'Electric Region Engine requires exactly one particle and no rigid bodies.')],
        ELECTRIC_REGION_ENGINE_ID,
      )
    }

    // Exactly one uniform electric field with a regionId.
    const fields = uniformElectricFields(scene)
    if (scene.fields.length !== 1 || fields.length !== 1) {
      return unsupportedModel(
        [failure('single_region_bound_field', 'Electric Region Engine requires one uniform electric field bound to a region.')],
        ELECTRIC_REGION_ENGINE_ID,
      )
    }
    const field = fields[0]
    if (field === undefined || field.regionId === undefined) {
      return unsupportedModel(
        [failure('field_region_binding', 'The uniform electric field must have a regionId.')],
        ELECTRIC_REGION_ENGINE_ID,
      )
    }

    // The regionId must point to an existing region.
    const region = scene.regions.find((r) => r.id === field.regionId)
    if (region === undefined) {
      return invalidModelCondition(ELECTRIC_REGION_ENGINE_ID, [
        failure('region_exists', `Field regionId "${field.regionId}" does not match any scene region.`),
      ])
    }
    if (region.shape.type !== 'rectangle') {
      return invalidModelCondition(ELECTRIC_REGION_ENGINE_ID, [
        failure('region_rectangle', 'The field region must be a rectangle.'),
      ])
    }

    // No explicit forces or constraints.
    if (scene.forces.length > 0 || scene.constraints.length > 0) {
      return unsupportedModel(
        [failure('electric_force_only', 'Electric Region Engine does not combine explicit forces or constraints.')],
        ELECTRIC_REGION_ENGINE_ID,
      )
    }

    // Particle must have charge and positive mass.
    const particle = scene.particles[0]
    if (particle === undefined || particle.charge === undefined) {
      return invalidModelCondition(ELECTRIC_REGION_ENGINE_ID, [
        failure('charge_defined', 'The particle charge must be defined.'),
      ])
    }
    const mass = canonicalValue(particle.mass)
    if (!Number.isFinite(mass) || mass <= 0) {
      return invalidModelCondition(ELECTRIC_REGION_ENGINE_ID, [
        failure('mass_positive', 'Particle mass must be greater than zero.'),
      ])
    }

    // Field vector must be finite and in the xy plane.
    const fieldVector = toCanonicalVector(field.fieldStrength).vectorSI
    if (!isFiniteVector(fieldVector) || Math.abs(fieldVector.z) > 1e-10) {
      return invalidModelCondition(ELECTRIC_REGION_ENGINE_ID, [
        failure('field_vector_2d', 'Electric Region Engine requires a finite field vector in the xy plane.'),
      ])
    }

    return supported(PARALLEL_PLATE_MODEL, this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const support = this.canHandle(scene)
    if (support.supported) {
      return { status: 'passed', checks: [], warnings: [], errors: [] }
    }
    return {
      status: 'failed',
      checks: support.failedConditions.map((entry) => ({
        id: entry.condition,
        type: 'constraint',
        passed: false,
        message: entry.message,
      })),
      warnings: [],
      errors: support.failedConditions.map((entry) => ({
        code: entry.condition,
        severity: 'error',
        message: entry.message,
      })),
    }
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const model = resolveParallelPlateModel(scene)
    const seconds = canonicalValue(time)
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new PhysicsOSError('INVALID_SIMULATION_TIME', 'Simulation time must be finite and non-negative.')
    }
    return stateAtForModel(model, seconds)
  }

  stateAtSeconds(scene: PhysicsScene, seconds: number): SimulationState {
    return this.stateAt(scene, quantity(seconds, 's', 'time'))
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
    // Validate request matches scene.
    if (request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
      throw new PhysicsOSError(
        'SIMULATION_SCENE_MISMATCH',
        'SimulationRequest must reference the exact PhysicsScene revision being simulated.',
        {
          details: {
            requestSceneId: request.sceneId,
            sceneId: scene.id,
            requestRevision: request.sceneRevision,
            sceneRevision: scene.revision,
          },
        },
      )
    }

    const model = resolveParallelPlateModel(scene)
    const startTime = request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const sceneDuration = scene.timeline.endTime === undefined
      ? DEFAULT_DURATION_SECONDS
      : canonicalValue(scene.timeline.endTime)
    const endTime = request.options.endTime === undefined ? sceneDuration : canonicalValue(request.options.endTime)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime) {
      throw new PhysicsOSError('INVALID_SIMULATION_RANGE', 'Simulation range must satisfy 0 <= startTime <= endTime.')
    }

    // Sample trajectory.
    const times = Array.from(
      { length: DEFAULT_TRAJECTORY_SEGMENTS + 1 },
      (_, index) => startTime + ((endTime - startTime) * index) / DEFAULT_TRAJECTORY_SEGMENTS,
    )
    const states = times.map((t) => stateAtForModel(model, t))

    // Detect events.
    const events: PhysicsEventLike[] = []
    const phases = computePhases(model)

    // EnterField event.
    if (phases.enterTime >= startTime && phases.enterTime <= endTime) {
      events.push({
        eventId: asPhysicsEventId('event-enter-field'),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'EnterField',
      })
    }

    // ExitField event.
    if (phases.exitTime !== null && phases.exitTime >= startTime && phases.exitTime <= endTime) {
      events.push({
        eventId: asPhysicsEventId('event-exit-field'),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'ExitField',
      })
    }

    // HitPlate event.
    if (phases.hit !== null && phases.hitTime !== null && phases.hitTime >= startTime && phases.hitTime <= endTime) {
      events.push({
        eventId: asPhysicsEventId(`event-hit-plate-${phases.hit.plate}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'HitPlate',
      })
    }

    // Derived quantities at the final time.
    const derivedQuantities = derivedAt(model, endTime)

    // Verification.
    const verification = buildVerification(model, scene, states, events)

    const startedAt = new Date().toISOString()

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events,
      measurements: [],
      derivedQuantities,
      verification,
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'analytical-bounded-electric',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const electricRegionEngine = new ElectricRegionEngine()
