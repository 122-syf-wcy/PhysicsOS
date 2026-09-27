import { PhysicsOSError } from '@physicsos/shared'

import type { ResolvedLeverModel } from './lever-model.ts'
import { momentsOf } from './statics.ts'

/**
 * Genuine rotational dynamics for the class-1 lever.
 *
 * ── Convention (explicit) ───────────────────────────────────────────────────
 * θ is the beam's rotation from horizontal, **positive = counter-clockwise =
 * the LEFT arm goes down** — the same sign the statics tilt uses, so a positive
 * net moment and a positive θ are the same physical side.
 *
 * ── Torque about the fulcrum ────────────────────────────────────────────────
 * Each hanging weight is vertical, so its moment arm is the horizontal distance
 * from the fulcrum to its line of action. A load at arm l on a beam tilted by θ
 * sits at horizontal offset l·cos θ, so with G = mg:
 *
 *   τ_left(θ)  = +G₁·l₁·cos θ     (positive: drives θ up, left down)
 *   τ_right(θ) = −G₂·l₂·cos θ
 *   τ_net(θ)   = (G₁l₁ − G₂l₂)·cos θ = netMoment·cos θ
 *
 * netMoment is exactly the statics moment difference, so F₁l₁ = F₂l₂
 * (netMoment = 0) is the special case τ_net ≡ 0.
 *
 * ── Moment of inertia of the modelled configuration ─────────────────────────
 * A massless rigid beam with the two loads as point masses at their arms:
 *
 *   I = m₁l₁² + m₂l₂²     (kg·m²)      — positive for every valid lever
 *
 * ── Equation of motion ──────────────────────────────────────────────────────
 * Viscous pivot damping τ_damp = −c·ω, with c set from a dimensionless damping
 * ratio ζ of the critical damping about the equilibrium: c = 2ζ√(|netMoment|·I)
 * (|netMoment| is the N·m-per-rad stiffness linearised about the vertical).
 *
 *   τ_net(θ) − c·ω = I·α     →     α = (netMoment·cos θ − c·ω) / I
 *
 * ── Equilibrium / stop condition ────────────────────────────────────────────
 * α = 0 and ω = 0 requires cos θ = 0, i.e. **θ = ±π/2**: an unbalanced beam
 * rotates to the vertical (the heavy side straight down), the only moment-free
 * angle of the frictionless model — not a small cosmetic angle. A balanced beam
 * (netMoment = 0) is in equilibrium at every angle, so it never moves. The
 * integration stops at equilibrium (|ω| and |τ| below tolerance) and is bounded
 * (|θ| ≤ LEVER_MAX_ANGLE, |ω| ≤ LEVER_MAX_ANGULAR_SPEED) so it cannot run away.
 *
 * ── Integration step vs the simulation clock ────────────────────────────────
 * The step is FIXED (LEVER_INTEGRATION_STEP), not a frame rate: θ(t), ω(t) are
 * a deterministic function of the simulation time t, produced by sub-stepping
 * [0, t] at that fixed cadence. Sampling at any t (a renderer's per-frame read,
 * or a seek) re-integrates from rest, so the result is frame-rate independent
 * and reproducible. Nothing here uses Math.random.
 */

/** Explicit model kind so a consumer can label the motion truthfully. */
export const LEVER_MODEL_KIND = 'class_one_rotational_dynamics' as const

/**
 * Fixed integration step in seconds (semi-implicit Euler). ~215 steps per
 * period of the fastest realistic swing (ω_n ≈ √(|τ|/I) ≈ 5 rad/s), so the
 * scheme is well inside its stability region; it is a property of the physics,
 * never of the display refresh rate.
 */
export const LEVER_INTEGRATION_STEP = 1 / 240

/** Damping ratio ζ of the pivot about equilibrium (0 < ζ < 1 ⇒ it swings). */
export const LEVER_DAMPING_RATIO = 0.7

/** Moment-free vertical: gravity's torque about the fulcrum vanishes here. */
export const LEVER_EQUILIBRIUM_ANGLE = Math.PI / 2

/** Rest thresholds: |ω| below this and |τ| below the fraction of |netMoment|. */
export const LEVER_SETTLED_ANGULAR_SPEED = 1e-2
export const LEVER_SETTLED_TORQUE_FRACTION = 1e-2

/** Safety bounds (never reached by a well-posed lever). */
export const LEVER_MAX_ANGULAR_SPEED = 1e2
export const LEVER_MAX_ANGLE = Math.PI

/** Longest run before "did not settle within the horizon" is reported. */
export const LEVER_MAX_RUN_SECONDS = 4

/** The rotational model of the apparatus: I, the driving moment, damping. */
export interface LeverRotationalModel {
  /** I = Σmᵢlᵢ² (kg·m²). */
  readonly momentOfInertia: number
  /** M₁ − M₂ (N·m); the sign selects which side falls. */
  readonly netMoment: number
  /** Viscous pivot damping c (N·m·s/rad). */
  readonly dampingCoefficient: number
  /** Gravitational field strength (m/s²). */
  readonly gravity: number
  readonly balanced: boolean
  /** The equilibrium angle: ±π/2 unbalanced, 0 balanced. */
  readonly equilibriumAngle: number
}

export interface LeverRotationalOptions {
  readonly dampingRatio?: number
  readonly integrationStep?: number
}

/** Solved angular state at one instant. All values are canonical SI numbers. */
export interface LeverAngularState {
  /** θ (rad), positive = CCW = left down. */
  readonly angle: number
  /** ω (rad/s). */
  readonly angularVelocity: number
  /** α = (τ_net − cω)/I (rad/s²). */
  readonly angularAcceleration: number
  /** τ_net(θ) = netMoment·cos θ (N·m). */
  readonly netTorque: number
  /** True once the beam has reached equilibrium (or a safety bound). */
  readonly settled: boolean
  /** True when a safety bound clamped the state this run. */
  readonly bounded: boolean
}

/**
 * Resolve the apparatus into its rotational model. Throws
 * `PhysicsOSError('LEVER_DEGENERATE_INERTIA')` when I = Σmᵢlᵢ² is not
 * positive-finite (a zero-inertia beam has no defined α), so a degenerate
 * configuration is refused instead of returning NaN.
 */
export const resolveLeverRotationalModel = (
  model: ResolvedLeverModel,
  options: LeverRotationalOptions = {},
): LeverRotationalModel => {
  const { left, right } = model
  const momentOfInertia = left.mass * left.armLength ** 2 + right.mass * right.armLength ** 2
  if (!Number.isFinite(momentOfInertia) || momentOfInertia <= 0) {
    throw new PhysicsOSError(
      'LEVER_DEGENERATE_INERTIA',
      'The lever has no well-defined moment of inertia (I = Σmᵢlᵢ²); rotational dynamics is undefined.',
      { details: { momentOfInertia } },
    )
  }
  const { netMoment, balanced } = momentsOf(model)
  const ratio = options.dampingRatio ?? LEVER_DAMPING_RATIO
  /* |netMoment| is the linearised torsional stiffness (N·m per rad) about the
     vertical; c = 2ζ√(k·I) is the damping for that ratio. */
  const dampingCoefficient = balanced
    ? 0
    : 2 * ratio * Math.sqrt(Math.abs(netMoment) * momentOfInertia)
  return {
    momentOfInertia,
    netMoment,
    dampingCoefficient,
    gravity: model.gravity,
    balanced,
    equilibriumAngle: balanced ? 0 : Math.sign(netMoment) * LEVER_EQUILIBRIUM_ANGLE,
  }
}

/** Gravity's torque about the fulcrum at beam angle θ (N·m). */
export const leverTorqueAt = (model: LeverRotationalModel, angle: number): number =>
  model.netMoment * Math.cos(angle)

/** Rotational potential energy U(θ) = −netMoment·sin θ (J), zero at θ = 0. */
export const leverPotentialEnergyAt = (model: LeverRotationalModel, angle: number): number =>
  -model.netMoment * Math.sin(angle)

/** One semi-implicit Euler step: ω ← ω + α·dt, θ ← θ + ω·dt (velocity first). */
const angularStep = (
  model: LeverRotationalModel,
  angle: number,
  angularVelocity: number,
  dt: number,
): { angle: number; angularVelocity: number; bounded: boolean } => {
  const torque = leverTorqueAt(model, angle)
  const acceleration =
    (torque - model.dampingCoefficient * angularVelocity) / model.momentOfInertia
  let nextVelocity = angularVelocity + acceleration * dt
  let nextAngle = angle + nextVelocity * dt
  let bounded = false
  if (!Number.isFinite(nextVelocity)) {
    nextVelocity = 0
    bounded = true
  } else if (Math.abs(nextVelocity) > LEVER_MAX_ANGULAR_SPEED) {
    nextVelocity = Math.sign(nextVelocity) * LEVER_MAX_ANGULAR_SPEED
    bounded = true
  }
  if (!Number.isFinite(nextAngle)) {
    nextAngle = 0
    nextVelocity = 0
    bounded = true
  } else if (Math.abs(nextAngle) > LEVER_MAX_ANGLE) {
    nextAngle = Math.sign(nextAngle) * LEVER_MAX_ANGLE
    nextVelocity = 0
    bounded = true
  }
  return { angle: nextAngle, angularVelocity: nextVelocity, bounded }
}

/** Equilibrium test: at rest with the gravity torque gone (cos θ → 0). */
const isAtEquilibrium = (
  model: LeverRotationalModel,
  angle: number,
  angularVelocity: number,
): boolean => {
  if (model.balanced) return true
  const scale = Math.abs(model.netMoment)
  return (
    Math.abs(angularVelocity) <= LEVER_SETTLED_ANGULAR_SPEED &&
    Math.abs(leverTorqueAt(model, angle)) <= LEVER_SETTLED_TORQUE_FRACTION * scale
  )
}

/**
 * Integrate the beam's rotation from rest at θ = 0 up to time `timeSeconds`,
 * sub-stepping at the fixed integration step. The run stops the moment
 * equilibrium is reached (or a safety bound clamps it), so any later time
 * reports the same settled state.
 */
export const integrateLeverAngular = (
  model: LeverRotationalModel,
  timeSeconds: number,
  options: LeverRotationalOptions = {},
): LeverAngularState => {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new PhysicsOSError(
      'INVALID_SIMULATION_TIME',
      'Simulation time must be finite and non-negative.',
    )
  }
  if (model.balanced) {
    return {
      angle: 0,
      angularVelocity: 0,
      angularAcceleration: 0,
      netTorque: 0,
      settled: true,
      bounded: false,
    }
  }
  const dt = options.integrationStep ?? LEVER_INTEGRATION_STEP
  let angle = 0
  let angularVelocity = 0
  let bounded = false
  let settled = false
  const steps = Math.ceil(timeSeconds / dt)
  for (let index = 0; index < steps; index += 1) {
    const h = Math.min(dt, timeSeconds - index * dt)
    const next = angularStep(model, angle, angularVelocity, h)
    angle = next.angle
    angularVelocity = next.angularVelocity
    bounded = bounded || next.bounded
    if (isAtEquilibrium(model, angle, angularVelocity)) {
      settled = true
      break
    }
  }
  const netTorque = leverTorqueAt(model, angle)
  const angularAcceleration =
    (netTorque - model.dampingCoefficient * angularVelocity) / model.momentOfInertia
  return {
    angle,
    angularVelocity,
    angularAcceleration,
    netTorque,
    settled: settled || bounded,
    bounded,
  }
}

/**
 * The time at which the beam first reaches equilibrium, or
 * `LEVER_MAX_RUN_SECONDS` when it has not settled within the horizon (a very
 * small imbalance creeps and may not arrive in time — reported honestly rather
 * than faked). A balanced beam is at equilibrium from t = 0.
 */
export const leverSettleSeconds = (
  model: LeverRotationalModel,
  options: LeverRotationalOptions = {},
): number => {
  if (model.balanced) return 0
  const dt = options.integrationStep ?? LEVER_INTEGRATION_STEP
  let angle = 0
  let angularVelocity = 0
  const maxSteps = Math.ceil(LEVER_MAX_RUN_SECONDS / dt)
  for (let index = 0; index < maxSteps; index += 1) {
    const next = angularStep(model, angle, angularVelocity, dt)
    angle = next.angle
    angularVelocity = next.angularVelocity
    if (next.bounded || isAtEquilibrium(model, angle, angularVelocity)) {
      return (index + 1) * dt
    }
  }
  return LEVER_MAX_RUN_SECONDS
}
