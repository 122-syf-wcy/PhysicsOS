import {
  add,
  scale,
  magnitude,
  vec3,
  type Vector3,
} from '@physicsos/physics-math'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asSimulationId, asTraceId, asPhysicsEventId, PhysicsOSError } from '@physicsos/shared'
import {
  check,
  quantityVector,
  summarizeVerification,
  supported,
  unsupportedModel,
  invalidModelCondition,
  toCanonicalVector,
  withinTolerance,
  DEFAULT_TOLERANCE,
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
  validateScene,
  trajectorySampleTimes,
  trajectoryStorageSampleCount,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import type { MechanicsModel } from './models/types.ts'
import { resolveMechanicsModel, detectMechanicsModel } from './mechanics-model-selector.ts'
import { kinematicsAt } from './solvers/analytical-kinematics.ts'

export const MECHANICS_ENGINE_ID = 'engine-mechanics'
export const MECHANICS_ENGINE_VERSION = '1.0.0'

const DEFAULT_TRAJECTORY_SEGMENTS = 64

export function createMechanicsSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'mechanics',
    /* The scene's declared end time is the run window the question states
       ("运动 5 s"); simulate honours options.endTime and falls back to the
       model default duration. */
    options: scene.timeline.endTime === undefined ? {} : { endTime: scene.timeline.endTime },
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* Harmonic rigs are closed-form, not constant-acceleration: the spring obeys
   x = x_eq + A·cos(ωt + φ) and the pendulum swings on its arc with both
   tangential and centripetal acceleration terms. */
const oscillatorStateAt = (
  model: Extract<MechanicsModel, { modelId: 'spring_oscillator' }>,
  t: number,
): { position: Vector3; velocity: Vector3; acceleration: Vector3 } => {
  const wt = model.angularFrequency * t + model.phase
  const offset = model.amplitude * Math.cos(wt)
  const y = model.anchor.y + (model.position.y - model.anchor.y)
  return {
    position: vec3(model.equilibriumX + offset, y, model.position.z),
    velocity: vec3(-model.amplitude * model.angularFrequency * Math.sin(wt), 0, 0),
    acceleration: vec3(-model.angularFrequency * model.angularFrequency * offset, 0, 0),
  }
}

const pendulumStateAt = (
  model: Extract<MechanicsModel, { modelId: 'simple_pendulum' }>,
  t: number,
): { position: Vector3; velocity: Vector3; acceleration: Vector3 } => {
  const wt = model.angularFrequency * t + model.phase
  const theta = model.amplitude * Math.cos(wt)
  const thetaDot = -model.amplitude * model.angularFrequency * Math.sin(wt)
  const thetaDotDot = -model.angularFrequency * model.angularFrequency * theta
  const sin = Math.sin(theta)
  const cos = Math.cos(theta)
  /* Position rides the circle exactly; θ itself is the small-angle solution,
     which is what the lab's T = 2π√(L/g) claims. */
  const position = vec3(
    model.pivot.x + model.length * sin,
    model.pivot.y - model.length * cos,
    model.position.z,
  )
  const velocity = vec3(
    model.length * thetaDot * cos,
    model.length * thetaDot * sin,
    0,
  )
  const acceleration = vec3(
    model.length * thetaDotDot * cos - model.length * thetaDot * thetaDot * sin,
    model.length * thetaDotDot * sin + model.length * thetaDot * thetaDot * cos,
    0,
  )
  return { position, velocity, acceleration }
}

/** Pull the rig applies at time t: linear ramp capped at maxForce. */
const appliedForceAt = (
  model: Extract<MechanicsModel, { modelId: 'horizontal_friction' }>,
  t: number,
): number => Math.min(model.initialForce + model.forceRamp * t, model.maxForce)

const frictionStateAt = (
  model: Extract<MechanicsModel, { modelId: 'horizontal_friction' }>,
  t: number,
): { position: Vector3; velocity: Vector3; acceleration: Vector3 } => {
  const staticLimit = model.staticCoefficient * model.normalForce
  const kineticFriction = model.kineticCoefficient * model.normalForce
  const tSlip = model.slipTime
  /* At rest the pull and static friction are equal and opposite; the body
     only moves once the pull exceeds μsN. A body launched already sliding
     (v0 ≠ 0 or F0 > μsN) skips the static phase entirely. */
  if (t <= tSlip || !Number.isFinite(tSlip)) {
    return { position: model.position, velocity: vec3(0, 0, 0), acceleration: vec3(0, 0, 0) }
  }
  const tau = t - tSlip
  /* Post-slip the net force is F(t) − μkN. While the pull still ramps, a
     grows linearly — the closed form integrates that exactly; past the cap
     the acceleration is constant. */
  const tCap = model.forceRamp > 0 ? (model.maxForce - model.initialForce) / model.forceRamp : 0
  const rampTau = Math.min(tau, Math.max(0, tCap - tSlip))
  const holdTau = Math.max(0, tau - rampTau)
  const netAtSlip = staticLimit - kineticFriction // N — the classic force drop μsN − μkN
  const rampAccel = model.forceRamp / model.mass // m/s³ — da/dt while ramping
  const v0 = Math.max(0, model.velocity.x)
  let velocity = v0 + (netAtSlip / model.mass) * rampTau + 0.5 * rampAccel * rampTau * rampTau
  let displacement = v0 * rampTau + (netAtSlip / (2 * model.mass)) * rampTau * rampTau + (rampAccel / 6) * rampTau ** 3
  if (holdTau > 0) {
    const holdAccel = (model.maxForce - kineticFriction) / model.mass
    displacement += velocity * holdTau + 0.5 * holdAccel * holdTau * holdTau
    velocity += holdAccel * holdTau
  }
  const acceleration =
    holdTau > 0
      ? (model.maxForce - kineticFriction) / model.mass
      : (netAtSlip + model.forceRamp * rampTau) / model.mass
  return {
    position: vec3(model.position.x + displacement, model.position.y, model.position.z),
    velocity: vec3(velocity, 0, 0),
    acceleration: vec3(acceleration, 0, 0),
  }
}

function stateAtForModel(model: MechanicsModel, t: number): SimulationState {
  const ks =
    model.modelId === 'spring_oscillator'
      ? oscillatorStateAt(model, t)
      : model.modelId === 'simple_pendulum'
        ? pendulumStateAt(model, t)
        : model.modelId === 'horizontal_friction'
          ? frictionStateAt(model, t)
          : model.modelId === 'spring_statics'
            ? { position: model.position, velocity: vec3(0, 0, 0), acceleration: vec3(0, 0, 0) }
            : kinematicsAt(model.position, model.velocity, model.acceleration, t)
  return {
    time: quantity(t, 's', 'time'),
    objects: [
      {
        id: model.bodyId,
        position: quantityVector(ks.position, 'm', 'length'),
        velocity: quantityVector(ks.velocity, 'm/s', 'velocity'),
        acceleration: quantityVector(ks.acceleration, 'm/s^2', 'acceleration'),
      },
    ],
    derived: computeDerivedAtTime(model, t),
  }
}

function computeDerivedAtTime(model: MechanicsModel, t: number): DerivedQuantity[] {
  const derived: DerivedQuantity[] = []
  const assumptions = ['analytical solver', 'constant forces']

  /* Instantaneous kinematics at t — for the harmonic rigs acceleration is not
     the constant `model.acceleration` field, it is the closed-form value. */
  const instant =
    model.modelId === 'spring_oscillator'
      ? oscillatorStateAt(model, t)
      : model.modelId === 'simple_pendulum'
        ? pendulumStateAt(model, t)
        : model.modelId === 'horizontal_friction'
          ? frictionStateAt(model, t)
          : undefined
  const accelerationNow = instant?.acceleration ?? model.acceleration
  const velocityNow = instant?.velocity ?? add(model.velocity, scale(model.acceleration, t))

  derived.push({
    key: 'net_force',
    targetId: model.bodyId,
    value: quantityVector(scale(accelerationNow, model.mass), 'N', 'force'),
    formula: { expression: 'F_net = ma' },
    assumptions,
  })

  derived.push({
    key: 'acceleration',
    targetId: model.bodyId,
    value: quantityVector(accelerationNow, 'm/s^2', 'acceleration'),
    formula: { expression: 'a = F_net / m' },
    assumptions,
  })

  derived.push({
    key: 'velocity_magnitude',
    targetId: model.bodyId,
    value: quantity(magnitude(velocityNow), 'm/s', 'velocity'),
    formula: { expression: '|v(t)|' },
    assumptions,
  })

  if (model.modelId === 'uniform_linear_motion') {
    derived.push({
      key: 'displacement',
      targetId: model.bodyId,
      value: quantityVector(scale(model.velocity, t), 'm', 'length'),
      formula: { expression: 's = vt' },
      assumptions,
    })
  }

  if (model.modelId === 'uniformly_accelerated_motion') {
    const disp = add(scale(model.velocity, t), scale(model.acceleration, 0.5 * t * t))
    derived.push({
      key: 'displacement',
      targetId: model.bodyId,
      value: quantityVector(disp, 'm', 'length'),
      formula: { expression: 's = v0*t + 0.5*a*t²' },
      assumptions,
    })
    const finalV = add(model.velocity, scale(model.acceleration, t))
    derived.push({
      key: 'final_velocity',
      targetId: model.bodyId,
      value: quantity(magnitude(finalV), 'm/s', 'velocity'),
      formula: { expression: 'v = v0 + at' },
      assumptions,
    })
  }

  if (model.modelId === 'projectile_motion') {
    derived.push({
      key: 'flight_time',
      targetId: model.bodyId,
      value: quantity(model.flightTime, 's', 'time'),
      formula: { expression: 't_flight' },
      assumptions,
    })
    derived.push({
      key: 'range',
      targetId: model.bodyId,
      value: quantity(model.range, 'm', 'length'),
      formula: { expression: 'R = vx * t_flight' },
      assumptions,
    })
    derived.push({
      key: 'max_height',
      targetId: model.bodyId,
      value: quantity(model.maxHeight, 'm', 'length'),
      formula: { expression: 'H_max' },
      assumptions,
    })
    derived.push({
      key: 'impact_velocity',
      targetId: model.bodyId,
      value: quantityVector(model.impactVelocity, 'm/s', 'velocity'),
      formula: { expression: 'v_impact' },
      assumptions,
    })
  }

  if (model.modelId === 'newton_second_law') {
    derived.push({
      key: 'net_force_magnitude',
      targetId: model.bodyId,
      value: quantity(magnitude(model.netForce), 'N', 'force'),
      formula: { expression: '|F_net|' },
      assumptions,
    })
  }

  if (model.modelId === 'inclined_plane') {
    derived.push({
      key: 'gravity_parallel',
      targetId: model.bodyId,
      value: quantity(model.gravityParallel, 'm/s^2', 'acceleration'),
      formula: { expression: 'g*sin(θ)' },
      assumptions,
    })
    derived.push({
      key: 'gravity_normal',
      targetId: model.bodyId,
      value: quantity(model.gravityNormal, 'm/s^2', 'acceleration'),
      formula: { expression: 'g*cos(θ)' },
      assumptions,
    })
    derived.push({
      key: 'normal_force',
      targetId: model.bodyId,
      value: quantity(model.normalForce, 'N', 'force'),
      formula: { expression: 'N = mg*cos(θ)' },
      assumptions,
    })
    derived.push({
      key: 'friction_force',
      targetId: model.bodyId,
      value: quantity(model.frictionForce, 'N', 'force'),
      formula: { expression: 'f = μN' },
      assumptions,
    })
    derived.push({
      key: 'incline_acceleration',
      targetId: model.bodyId,
      value: quantity(magnitude(model.acceleration), 'm/s^2', 'acceleration'),
      formula: { expression: 'a = g*sin(θ) - μg*cos(θ)' },
      assumptions,
    })
  }

  if (model.modelId === 'spring_oscillator') {
    derived.push({
      key: 'period',
      targetId: model.bodyId,
      value: quantity(model.period, 's', 'time'),
      formula: { expression: 'T = 2π√(m/k)' },
      assumptions,
    })
    derived.push({
      key: 'angular_frequency',
      targetId: model.bodyId,
      value: quantity(model.angularFrequency, 'rad/s', 'angular_velocity'),
      formula: { expression: 'ω = √(k/m)' },
      assumptions,
    })
    derived.push({
      key: 'amplitude',
      targetId: model.bodyId,
      value: quantity(model.amplitude, 'm', 'length'),
      formula: { expression: 'A' },
      assumptions,
    })
    /* The restoring force IS the net force on a frictionless horizontal rig:
       F = −k·x about equilibrium. */
    const offset = instant === undefined ? 0 : instant.position.x - model.equilibriumX
    derived.push({
      key: 'spring_force',
      targetId: model.bodyId,
      value: quantityVector(vec3(-model.stiffness * offset, 0, 0), 'N', 'force'),
      formula: { expression: 'F = -k·x' },
      assumptions,
    })
    derived.push({
      key: 'displacement',
      targetId: model.bodyId,
      value: quantity(offset, 'm', 'length'),
      formula: { expression: 'x 偏离平衡位置' },
      assumptions,
    })
  }

  if (model.modelId === 'simple_pendulum') {
    derived.push({
      key: 'period',
      targetId: model.bodyId,
      value: quantity(model.period, 's', 'time'),
      formula: { expression: 'T = 2π√(L/g)' },
      assumptions,
    })
    derived.push({
      key: 'angular_frequency',
      targetId: model.bodyId,
      value: quantity(model.angularFrequency, 'rad/s', 'angular_velocity'),
      formula: { expression: 'ω = √(g/L)' },
      assumptions,
    })
    derived.push({
      key: 'amplitude_deg',
      targetId: model.bodyId,
      value: quantity((model.amplitude * 180) / Math.PI, '°', 'angle'),
      formula: { expression: 'θ_max' },
      assumptions,
    })
    /* String tension T = mg·cosθ + m·v²/L: the radial support plus the
       centripetal demand. Instant θ,v come from the closed form. */
    if (instant !== undefined) {
      const g = magnitude(model.gravity)
      const theta = Math.atan2(
        instant.position.x - model.pivot.x,
        -(instant.position.y - model.pivot.y),
      )
      const speed = magnitude(instant.velocity)
      const tension = model.mass * g * Math.cos(theta) + (model.mass * speed * speed) / model.length
      derived.push({
        key: 'tension',
        targetId: model.bodyId,
        value: quantity(tension, 'N', 'force'),
        formula: { expression: 'T = mg·cosθ + mv²/L' },
        assumptions,
      })
    }
  }

  if (model.modelId === 'horizontal_friction') {
    const applied = appliedForceAt(model, t)
    const sliding = instant !== undefined && Math.abs(instant.velocity.x) > 1e-9
    const friction =
      sliding || t > model.slipTime
        ? model.kineticCoefficient * model.normalForce
        : Math.min(applied, model.staticCoefficient * model.normalForce)
    derived.push({
      key: 'normal_force',
      targetId: model.bodyId,
      value: quantity(model.normalForce, 'N', 'force'),
      formula: { expression: 'N = mg' },
      assumptions,
    })
    derived.push({
      key: 'applied_force',
      targetId: model.bodyId,
      value: quantity(applied, 'N', 'force'),
      formula: { expression: 'F(t) 拉力' },
      assumptions,
    })
    derived.push({
      key: 'friction_force',
      targetId: model.bodyId,
      value: quantity(friction, 'N', 'force'),
      formula: { expression: sliding ? 'f = μk·N' : 'f = F ≤ μs·N' },
      assumptions,
    })
    derived.push({
      key: 'static_limit',
      targetId: model.bodyId,
      value: quantity(model.staticCoefficient * model.normalForce, 'N', 'force'),
      formula: { expression: 'f_max = μs·N' },
      assumptions,
    })
    if (Number.isFinite(model.slipTime)) {
      derived.push({
        key: 'slip_time',
        targetId: model.bodyId,
        value: quantity(model.slipTime, 's', 'time'),
        formula: { expression: 'F = μs·N 时刻' },
        assumptions,
      })
    }
  }

  if (model.modelId === 'spring_statics') {
    derived.push({
      key: 'spring_extension',
      targetId: model.bodyId,
      value: quantity(model.extension, 'm', 'length'),
      formula: { expression: 'Δx = mg/k' },
      assumptions,
    })
    derived.push({
      key: 'spring_force',
      targetId: model.bodyId,
      value: quantityVector(vec3(0, model.springForce, 0), 'N', 'force'),
      formula: { expression: 'F = k·Δx = mg' },
      assumptions,
    })
  }

  return derived
}

function computeSimulationDuration(model: MechanicsModel): number {
  if (model.modelId === 'projectile_motion') {
    return model.flightTime > 0 ? model.flightTime : 10
  }
  if (model.modelId === 'uniform_linear_motion') {
    return 10
  }
  if (model.modelId === 'uniformly_accelerated_motion') {
    return 10
  }
  if (model.modelId === 'newton_second_law') {
    return 10
  }
  if (model.modelId === 'inclined_plane') {
    return 10
  }
  /* Two full swings is the readable window for a periodic rig — enough to see
     the cycle repeat without making the data table a mile long. */
  if (model.modelId === 'spring_oscillator' || model.modelId === 'simple_pendulum') {
    return 2 * model.period
  }
  if (model.modelId === 'horizontal_friction') {
    if (Number.isFinite(model.slipTime)) return model.slipTime + 3
    /* Never slips: show the ramp until the cap, or a fixed 6 s for a constant
       pull that never reaches μsN. */
    return model.forceRamp > 0
      ? (model.maxForce - model.initialForce) / model.forceRamp + 1
      : 6
  }
  if (model.modelId === 'spring_statics') {
    return 4
  }
  return 10
}

function buildVerification(model: MechanicsModel, scene: PhysicsScene, states: SimulationState[]): VerificationResult {
  const sceneVerification = validateScene(scene)
  const checks: import('@physicsos/physics-core').VerificationCheck[] = [
    ...sceneVerification.checks,
  ]

  if (model.modelId === 'uniform_linear_motion') {
    checks.push(check('zero_acceleration', 'constraint', magnitude(model.acceleration) < 1e-10, {
      message: 'Uniform linear motion requires zero acceleration.',
    }))
    // Velocity is conserved: every sampled state's velocity must equal the
    // first frame's velocity within tolerance. Analytical solver keeps v
    // exactly constant, so DEFAULT_TOLERANCE (rel 1e-9) is appropriate.
    let velocityConserved = states.length > 0
    if (states.length > 0) {
      const first = states[0]
      const firstVel = first?.objects[0]?.velocity
      if (firstVel) {
        const v0 = toCanonicalVector(firstVel).vectorSI
        for (let i = 1; i < states.length && velocityConserved; i++) {
          const v = states[i]?.objects[0]?.velocity
          if (!v) {
            velocityConserved = false
            break
          }
          const vi = toCanonicalVector(v).vectorSI
          const conserved =
            withinTolerance(vi.x, v0.x, DEFAULT_TOLERANCE) &&
            withinTolerance(vi.y, v0.y, DEFAULT_TOLERANCE) &&
            withinTolerance(vi.z, v0.z, DEFAULT_TOLERANCE)
          if (!conserved) velocityConserved = false
        }
      } else {
        velocityConserved = false
      }
    }
    checks.push(check('velocity_conservation', 'conservation', velocityConserved, {
      message: 'Velocity is constant across all sampled states.',
    }))
  }

  if (model.modelId === 'uniformly_accelerated_motion') {
    if (states.length >= 2) {
      const first = states[0]
      const last = states[states.length - 1]
      if (first?.objects[0]?.velocity && last?.objects[0]?.velocity) {
        const v0 = toCanonicalVector(first.objects[0].velocity).vectorSI
        const v1 = toCanonicalVector(last.objects[0].velocity).vectorSI
        const dv = magnitude(add(v1, scale(v0, -1)))
        const expectedDv = magnitude(scale(model.acceleration, last.time.value))
        checks.push(check('velocity_change', 'numerical', Math.abs(dv - expectedDv) < 0.1, {
          message: `Velocity change matches a*t.`,
        }))
      }
    }
  }

  if (model.modelId === 'projectile_motion') {
    // Horizontal velocity is conserved when there is no air resistance: every
    // sampled state's vx must equal the first frame's vx within tolerance.
    // The analytical solver keeps vx exactly constant (acceleration is
    // purely vertical), so DEFAULT_TOLERANCE (rel 1e-9) is appropriate.
    let vxConstant = states.length > 0
    if (states.length > 0) {
      const first = states[0]
      const firstVel = first?.objects[0]?.velocity
      if (firstVel) {
        const v0x = toCanonicalVector(firstVel).vectorSI.x
        for (let i = 1; i < states.length && vxConstant; i++) {
          const v = states[i]?.objects[0]?.velocity
          if (!v) {
            vxConstant = false
            break
          }
          const vx = toCanonicalVector(v).vectorSI.x
          if (!withinTolerance(vx, v0x, DEFAULT_TOLERANCE)) vxConstant = false
        }
      } else {
        vxConstant = false
      }
    }
    checks.push(check('horizontal_velocity_constant', 'conservation', vxConstant, {
      message: 'Horizontal velocity is constant (no air resistance).',
    }))
    checks.push(check('vertical_acceleration', 'constraint', Math.abs(model.acceleration.y + magnitude(model.gravity)) < 1e-10, {
      message: 'Vertical acceleration equals -g.',
    }))
    if (states.length > 0) {
      const last = states[states.length - 1]
      if (last?.objects[0]?.position) {
        const y = toCanonicalVector(last.objects[0].position).vectorSI.y
        checks.push(check('impact_y', 'boundary', Math.abs(y - model.groundY) < 0.5, {
          message: `Impact y ≈ groundY (${y} vs ${model.groundY}).`,
        }))
      }
    }
  }

  if (model.modelId === 'newton_second_law') {
    const computedNetForce = scale(model.acceleration, model.mass)
    const forceDiff = magnitude(add(computedNetForce, scale(model.netForce, -1)))
    checks.push(check('newton_second_law', 'numerical', forceDiff < 1e-6, {
      message: 'ΣF = ma verified.',
    }))
  }

  if (model.modelId === 'inclined_plane') {
    const g = magnitude(model.gravity)
    const angleRad = (model.inclineAngle * Math.PI) / 180
    const expectedParallel = g * Math.sin(angleRad)
    const expectedNormal = g * Math.cos(angleRad)
    checks.push(check('gravity_parallel', 'numerical', Math.abs(model.gravityParallel - expectedParallel) < 1e-6, {
      message: 'mg*sin(θ) verified.',
    }))
    checks.push(check('gravity_normal', 'numerical', Math.abs(model.gravityNormal - expectedNormal) < 1e-6, {
      message: 'mg*cos(θ) verified.',
    }))
    checks.push(check('normal_force', 'numerical', Math.abs(model.normalForce - model.mass * expectedNormal) < 1e-6, {
      message: 'N = mg*cos(θ) verified.',
    }))
  }

  if (model.modelId === 'spring_oscillator') {
    /* Energy bookkeeping: E = ½kx² + ½mv² must be identical at every sampled
       instant — the check that makes the oscillation a verified physics claim
       rather than a drawn sine. */
    const energyOf = (state: (typeof states)[number]): number => {
      const obj = state.objects[0]
      if (obj?.position === undefined || obj.velocity === undefined) return Number.NaN
      const x = obj.position.vector.x - model.equilibriumX
      const v = obj.velocity.vector.x
      return 0.5 * model.stiffness * x * x + 0.5 * model.mass * v * v
    }
    let energyConserved = states.length > 0
    const e0 = states.length > 0 ? energyOf(states[0] as never) : 0
    for (const state of states) {
      const e = energyOf(state as never)
      if (!Number.isFinite(e) || Math.abs(e - e0) > Math.max(Math.abs(e0) * 1e-6, 1e-9)) {
        energyConserved = false
      }
    }
    checks.push(check('energy_conservation', 'conservation', energyConserved, {
      message: 'E = ½kx² + ½mv² is constant across the swing.',
    }))
    checks.push(check('period_consistency', 'numerical',
      Math.abs(model.period - 2 * Math.PI * Math.sqrt(model.mass / model.stiffness)) < 1e-9, {
        message: 'T = 2π√(m/k) verified.',
      }))
    /* Restoring law: at every sample a = −(k/m)·(x − x_eq). */
    const restoringHolds = states.every((state) => {
      const obj = state.objects[0]
      if (obj?.position === undefined || obj.acceleration === undefined) return false
      const offset = obj.position.vector.x - model.equilibriumX
      return Math.abs(obj.acceleration.vector.x + (model.stiffness / model.mass) * offset) < 1e-9
    })
    checks.push(check('restoring_force', 'constraint', restoringHolds, {
      message: 'a = −(k/m)·x holds at every sampled state.',
    }))
  }

  if (model.modelId === 'simple_pendulum') {
    const g = magnitude(model.gravity)
    checks.push(check('period_consistency', 'numerical',
      Math.abs(model.period - 2 * Math.PI * Math.sqrt(model.length / g)) < 1e-9, {
        message: 'T = 2π√(L/g) verified.',
      }))
    /* The bob stays on the string: distance to the pivot equals L at every
       sampled instant. */
    const onArc = states.every((state) => {
      const obj = state.objects[0]
      if (obj?.position === undefined) return false
      const dx = obj.position.vector.x - model.pivot.x
      const dy = obj.position.vector.y - model.pivot.y
      return Math.abs(Math.hypot(dx, dy) - model.length) < 1e-9
    })
    checks.push(check('rope_length', 'constraint', onArc, {
      message: 'Bob stays on the rope circle (r = L) at every state.',
    }))
  }

  if (model.modelId === 'horizontal_friction') {
    const staticLimit = model.staticCoefficient * model.normalForce
    const kineticFriction = model.kineticCoefficient * model.normalForce
    /* Static phase: nothing moves and friction equals the pull. */
    const staticStates = states.filter((s) => s.time.value <= model.slipTime)
    const staticHolds = staticStates.every((s) => {
      const obj = s.objects[0]
      return Math.abs(obj?.velocity?.vector.x ?? 1) < 1e-9
    })
    checks.push(check('static_friction_balance', 'constraint', staticHolds, {
      message: 'Before slip the body stays at rest (f = F ≤ μsN).',
    }))
    /* Sliding phase: friction is exactly μkN and a = (F − f)/m. */
    const slidingStates = states.filter((s) => s.time.value > model.slipTime)
    const kineticHolds = slidingStates.every((s) => {
      const obj = s.objects[0]
      if (obj?.acceleration === undefined) return false
      const applied = appliedForceAt(model, s.time.value)
      const expected = (applied - kineticFriction) / model.mass
      return Math.abs(obj.acceleration.vector.x - expected) < 1e-6
    })
    checks.push(check('kinetic_friction', 'numerical', kineticHolds, {
      message: 'While sliding a = (F − μkN)/m at every state.',
    }))
    checks.push(check('static_limit', 'numerical',
      staticLimit >= kineticFriction - 1e-12, {
        message: 'μs ≥ μk physically required.',
      }))
  }

  if (model.modelId === 'spring_statics') {
    checks.push(check('hooke_equilibrium', 'numerical',
      Math.abs(model.stiffness * model.extension - model.springForce) < 1e-9, {
        message: 'k·Δx = mg verified.',
      }))
    /* The authored scene must actually hang the body at the computed
       equilibrium — a scene that disagrees is a wrong setup, not a wrong
       solver. */
    const body = scene.bodies[0]
    const expectedY = model.anchor.y - model.naturalLength - model.extension
    const actualY = body === undefined ? Number.NaN : body.position.vector.y
    checks.push(check('equilibrium_position', 'constraint',
      Number.isFinite(actualY) && Math.abs(actualY - expectedY) < 1e-6, {
        message: `Body hangs at equilibrium y = ${expectedY.toFixed(3)} m (anchor − L0 − mg/k).`,
      }))
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

export class MechanicsEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = MECHANICS_ENGINE_ID
  readonly engineVersion = MECHANICS_ENGINE_VERSION
  readonly domain = 'mechanics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(MECHANICS_ENGINE_ID, [
        { condition: 'scene_valid', message: error instanceof Error ? error.message : 'Scene validation failed.' },
      ])
    }

    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        MECHANICS_ENGINE_ID,
        sceneVerification.errors.map((issue) => ({ condition: issue.code, message: issue.message })),
      )
    }

    if (scene.dimension !== '2d') {
      return unsupportedModel(
        [{ condition: 'scene_is_2d', message: 'Mechanics V1 supports 2D scenes only.' }],
        MECHANICS_ENGINE_ID,
      )
    }

    if (scene.bodies.length !== 1 || scene.particles.length > 0) {
      return unsupportedModel(
        [{ condition: 'single_body', message: 'Exactly one rigid body is required for mechanics V1.' }],
        MECHANICS_ENGINE_ID,
      )
    }

    const body = scene.bodies[0]
    if (!body) {
      return unsupportedModel(
        [{ condition: 'body_present', message: 'No body found in scene.' }],
        MECHANICS_ENGINE_ID,
      )
    }

    const mass = canonicalValue(body.mass)
    if (mass <= 0) {
      return invalidModelCondition(MECHANICS_ENGINE_ID, [
        { condition: 'mass_positive', message: `Body mass must be > 0, got ${mass}.` },
      ])
    }

    const modelId = detectMechanicsModel(scene)
    return supported(modelId ?? 'uniform_linear_motion', this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const sceneVerification = validateScene(scene)
    const support = this.canHandle(scene)
    return summarizeVerification(
      [
        ...sceneVerification.checks,
        check('mechanics_model_supported', 'constraint', support.supported, {
          message: support.supported
            ? 'Scene satisfies the mechanics model assumptions.'
            : support.failedConditions.map((f) => f.message).join(' '),
        }),
      ],
      sceneVerification.warnings,
      sceneVerification.errors,
    )
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const model = resolveMechanicsModel(scene)
    return stateAtForModel(model, canonicalValue(time))
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
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

    const model = resolveMechanicsModel(scene)
    const duration = computeSimulationDuration(model)

    const startTime = request.options.startTime ? canonicalValue(request.options.startTime) : 0
    const endTime = request.options.endTime ? canonicalValue(request.options.endTime) : duration
    if (endTime < startTime) {
      throw new PhysicsOSError('INVALID_SIMULATION_RANGE', 'endTime must be >= startTime.')
    }

    const trajectoryTimes = trajectorySampleTimes(
      startTime,
      endTime,
      trajectoryStorageSampleCount(request.options, DEFAULT_TRAJECTORY_SEGMENTS + 1),
    )

    const states = trajectoryTimes.map((t) => stateAtForModel(model, t))
    const derivedQuantities = computeDerivedAtTime(model, endTime - startTime)
    const verification = buildVerification(model, scene, states)

    const events: PhysicsEventLike[] = []
    if (model.modelId === 'projectile_motion' && model.flightTime > 0) {
      events.push({
        eventId: asPhysicsEventId(`event-impact-${model.bodyId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'GroundImpact',
      })
    }

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
        solver: 'analytical',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const mechanicsEngine = new MechanicsEngine()
