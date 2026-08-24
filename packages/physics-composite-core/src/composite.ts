/**
 * Composite-field domain core: `F = qE + qv×B + mg`, and the closed form that
 * solves it.
 *
 * This layer is deliberately pure maths. It consumes a `FieldSample` — "which
 * uniform fields act here" — and never a `PhysicsScene`, so the force law and the
 * trajectory can be tested against textbook values without a scene, an engine or
 * a renderer in the way. Deciding WHICH scenes are composite, and sampling the
 * fields, already belongs to `physics-scene`; re-deriving either here is how two
 * layers start disagreeing about the same apparatus.
 *
 * There is no integrator here, and that is a constitutional requirement
 * (`docs/15-RUNTIME-ARCHITECTURE.md` §4: `stateAt` is 解析解，不做数值积分).
 * Uniform E + uniform B + uniform g admits an exact solution by drift
 * decomposition:
 *
 *  1. Find the drift velocity `v_d` that balances the non-magnetic forces:
 *     `qE + q(v_d×B) + mg = 0`.
 *  2. Substitute `u = v - v_d`. The constant terms cancel by construction and
 *     `m du/dt = q u×B` remains — pure gyration at `ω = qB_z/m`.
 *  3. So `v(t) = v_d + rotate(u₀, -ωt)`, and position integrates in closed form
 *     too. Every value below is that solution, never a step of it.
 *
 * Units are SI throughout: C, kg, m, s, V/m, T, m/s².
 */

import { PhysicsOSError } from '@physicsos/shared'
import { add, cross, magnitude, rotateAboutZ, scale, subtract, vec3 } from '@physicsos/physics-math'
import type { Vector3 } from '@physicsos/physics-math'
import type { FieldSample } from '@physicsos/physics-scene'

/**
 * Float dust on the magnetic coupling `q·B_z`, in C·T.
 *
 * The branch test is on the PRODUCT, not on `|B|`, because `q·B_z` is what the
 * drift denominator divides by: a neutral particle in a strong field has no
 * magnetic term at all, exactly like a charged particle in no field. The value is
 * far below any real case — a single electron in Earth's field already reaches
 * 8e-24 C·T — so it only ever rejects arithmetic noise.
 */
const MAGNETIC_COUPLING_EPSILON = 1e-30

/**
 * Relative slack on a direction test, used for both "is B along z" and "is E
 * perpendicular to B". Always applied against the product of the magnitudes
 * involved, so it stays a statement about angle rather than about field strength.
 */
const DIRECTION_TOLERANCE = 1e-12

/**
 * The z component of B, refusing an off-axis field.
 *
 * The closed form gyrates about +z, so an in-plane B component would bend the
 * trajectory out of the plane the solution describes. Silently projecting onto z
 * would return a confident, wrong path; `pointInRegion` sets the precedent that
 * geometry the model cannot decide must surface rather than default.
 */
const requireAxialField = (magneticFluxDensity: Vector3): number => {
  const inPlane = Math.hypot(magneticFluxDensity.x, magneticFluxDensity.y)
  const axial = magneticFluxDensity.z
  if (inPlane > DIRECTION_TOLERANCE * Math.max(1, Math.abs(axial))) {
    throw new PhysicsOSError(
      'COMPOSITE_FIELD_OFF_AXIS',
      'The composite closed form solves gyration about +z; a magnetic field with an in-plane component is not supported.',
      { details: { magneticFluxDensity } },
    )
  }
  return axial
}

const requirePositiveMass = (mass: number): number => {
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new PhysicsOSError(
      'COMPOSITE_INVALID_MASS',
      'Composite motion needs a positive finite mass to divide the force by.',
      { details: { mass } },
    )
  }
  return mass
}

/** Rotation by +90° about z, without the round-off of `cos(π/2)`. */
const perpendicular = (v: Vector3): Vector3 => vec3(-v.y, v.x, 0)

/* ------------------------------------------------------------------ forces -- */

/**
 * The three contributions and their resultant, all in newtons.
 *
 * They stay separated because questions ask about them separately — "what is the
 * electric force on the droplet" is a different answer from the net force, and a
 * verifier that only sees the sum cannot check either.
 */
export interface CompositeForce {
  /** qE */
  readonly electricForce: Vector3
  /** qv×B */
  readonly magneticForce: Vector3
  /** mg */
  readonly gravityForce: Vector3
  readonly totalForce: Vector3
}

/**
 * The composite force at one state.
 *
 * Velocity is a parameter rather than part of the sample because the magnetic
 * term is the only velocity-dependent force in the law; a force helper that hid
 * it would let a caller evaluate the Lorentz force at the wrong instant.
 */
export const compositeForce = (
  charge: number,
  mass: number,
  velocity: Vector3,
  sample: FieldSample,
): CompositeForce => {
  const electricForce = scale(sample.electricField, charge)
  const magneticForce = scale(cross(velocity, sample.magneticFluxDensity), charge)
  const gravityForce = scale(sample.gravity, mass)
  return {
    electricForce,
    magneticForce,
    gravityForce,
    totalForce: add(add(electricForce, magneticForce), gravityForce),
  }
}

/**
 * Acceleration from the velocity-independent forces alone: `qE/m + g`.
 *
 * This is the whole acceleration when there is no magnetic coupling, and it is
 * the axial acceleration even when there is — B along z can never balance `E_z`
 * or `g_z`, because `v×B` is always perpendicular to B.
 */
const nonMagneticAcceleration = (charge: number, mass: number, sample: FieldSample): Vector3 =>
  add(scale(sample.electricField, charge / mass), sample.gravity)

/* ------------------------------------------------------------------- drift -- */

/**
 * The velocity at which the net force vanishes: `qE + q(v_d×B) + mg = 0`.
 *
 * Returns `undefined` when there is no magnetic coupling, because then no
 * velocity can cancel anything — `v×B` is the only velocity-dependent term, and
 * without it the balance is a statement about the fields, not about a velocity.
 *
 * `v_d` has no z component by construction: `v_d×B` with B along z is always
 * in-plane, so the axial force is not the drift's to cancel.
 *
 * ponytail: no small-|ω| series guard — the two closed-form terms `v_d` and
 * `u₀ = v₀ - v_d` cancel catastrophically once |v_d| >> |v₀|, which needs |B|
 * around 1e-12 T against a school-scale E. Ceiling: relative error grows as
 * eps·|v_d|/|v₀|. Upgrade: expand `(I - R(-ωt))·v_d` in ωt, which is finite as
 * ω→0, if a scene ever declares a field that weak.
 */
export const driftVelocity = (
  charge: number,
  mass: number,
  sample: FieldSample,
): Vector3 | undefined => {
  requirePositiveMass(mass)
  const coupling = charge * requireAxialField(sample.magneticFluxDensity)
  if (Math.abs(coupling) <= MAGNETIC_COUPLING_EPSILON) return undefined

  const { electricField, gravity } = sample
  const drift = vec3(
    (charge * electricField.y + mass * gravity.y) / coupling,
    -(charge * electricField.x + mass * gravity.x) / coupling,
    0,
  )
  if (!Number.isFinite(drift.x) || !Number.isFinite(drift.y)) {
    throw new PhysicsOSError(
      'COMPOSITE_DRIFT_OVERFLOW',
      'The drift velocity overflowed; the field magnitudes are outside the classical model.',
      { details: { coupling } },
    )
  }
  return drift
}

/**
 * Signed cyclotron angular frequency `ω = q·B_z/m`, in rad/s.
 *
 * The sign is the physics, and it is NOT the sign of the rotation: gyration
 * carries the velocity through `rotateAboutZ(u, -ω·t)`. A positive charge in a
 * +z field turns clockwise, which is the negative sense about +z. `engine-magnetic`
 * rotates by `-q|B|t/m` about the field axis for the same reason, so the two
 * layers agree on which way a proton curls.
 */
export const cyclotronAngularVelocity = (
  charge: number,
  mass: number,
  sample: FieldSample,
): number => (charge * requireAxialField(sample.magneticFluxDensity)) / requirePositiveMass(mass)

/** Gyration period `T = 2π/|ω|`, or `undefined` when there is no gyration. */
export const cyclotronPeriod = (
  charge: number,
  mass: number,
  sample: FieldSample,
): number | undefined => {
  const omega = cyclotronAngularVelocity(charge, mass, sample)
  if (Math.abs(omega) <= MAGNETIC_COUPLING_EPSILON) return undefined
  return (2 * Math.PI) / Math.abs(omega)
}

/**
 * Radius of the gyration circle, `|u⊥|/|ω|`, where `u = v - v_d`.
 *
 * Measured on the drift-subtracted velocity, not on `v`: with crossed fields the
 * particle traces a cycloid whose loop radius comes from `u`, and feeding `v`
 * straight in would return the radius of a circle it never travels. With B only,
 * `v_d = 0` and this reduces to the textbook `r = mv/(qB)`.
 */
export const gyroRadius = (
  charge: number,
  mass: number,
  velocity: Vector3,
  sample: FieldSample,
): number | undefined => {
  const omega = cyclotronAngularVelocity(charge, mass, sample)
  if (Math.abs(omega) <= MAGNETIC_COUPLING_EPSILON) return undefined
  const drift = driftVelocity(charge, mass, sample) ?? vec3(0, 0, 0)
  const gyrating = subtract(velocity, drift)
  return Math.hypot(gyrating.x, gyrating.y) / Math.abs(omega)
}

/* -------------------------------------------------------------- kinematics -- */

/** State at one instant of a single uniform-field phase. */
export interface CompositeMotion {
  readonly position: Vector3
  readonly velocity: Vector3
  readonly acceleration: Vector3
}

/**
 * Exact state `dt` after the start of a uniform-field phase.
 *
 * Two closed-form branches, chosen by whether a magnetic coupling exists:
 *
 *  - Coupled: drift plus gyration. In-plane motion is `v_d + rotate(u₀, -ωt)`,
 *    whose integral is `v_d·t + perpendicular(u(t) - u₀)/ω`.
 *  - Uncoupled: constant acceleration `qE/m + g`, so `r₀ + v₀t + ½at²`.
 *
 * The axial direction is handled apart from the in-plane pair in the coupled
 * branch. `rotateAboutZ` passes z through untouched, which is right only when
 * nothing accelerates along z; a scene with `E_z` or `g_z` would otherwise gyrate
 * at a frozen z-velocity while the real particle accelerates out of the plane.
 *
 * `dt` is measured from the phase start, not from t = 0 of the scene. A phase
 * boundary is where `sameFieldEnvironment` stops holding, and the caller is
 * expected to restart from the state it reached there — that is what keeps this
 * function a closed form rather than a step.
 */
export const compositeMotionAt = (
  charge: number,
  mass: number,
  position0: Vector3,
  velocity0: Vector3,
  sample: FieldSample,
  dt: number,
): CompositeMotion => {
  requirePositiveMass(mass)
  if (!Number.isFinite(dt)) {
    throw new PhysicsOSError('COMPOSITE_INVALID_TIME', 'Composite motion needs a finite dt.', {
      details: { dt },
    })
  }

  const drift = driftVelocity(charge, mass, sample)
  /* Branch on ω, not merely on the drift: `gyrating` divides by ω, and ω = q·B_z/m
     can underflow to zero for an extreme mass even where q·B_z did not. Deciding
     on the quantity that is actually divided by is what keeps that from becoming a
     silent Infinity. */
  const omega = cyclotronAngularVelocity(charge, mass, sample)
  const state =
    drift === undefined || omega === 0
      ? uniformlyAccelerated(charge, mass, position0, velocity0, sample, dt)
      : gyrating(charge, mass, position0, velocity0, sample, dt, drift, omega)

  return {
    ...state,
    acceleration: scale(compositeForce(charge, mass, state.velocity, sample).totalForce, 1 / mass),
  }
}

const uniformlyAccelerated = (
  charge: number,
  mass: number,
  position0: Vector3,
  velocity0: Vector3,
  sample: FieldSample,
  dt: number,
): Pick<CompositeMotion, 'position' | 'velocity'> => {
  const acceleration = nonMagneticAcceleration(charge, mass, sample)
  return {
    position: add(add(position0, scale(velocity0, dt)), scale(acceleration, 0.5 * dt * dt)),
    velocity: add(velocity0, scale(acceleration, dt)),
  }
}

const gyrating = (
  charge: number,
  mass: number,
  position0: Vector3,
  velocity0: Vector3,
  sample: FieldSample,
  dt: number,
  drift: Vector3,
  omega: number,
): Pick<CompositeMotion, 'position' | 'velocity'> => {
  const axialAcceleration = nonMagneticAcceleration(charge, mass, sample).z

  const gyrating0 = vec3(velocity0.x - drift.x, velocity0.y - drift.y, 0)
  const turned = rotateAboutZ(gyrating0, -omega * dt)
  const swept = scale(perpendicular(subtract(turned, gyrating0)), 1 / omega)

  return {
    position: vec3(
      position0.x + drift.x * dt + swept.x,
      position0.y + drift.y * dt + swept.y,
      position0.z + velocity0.z * dt + 0.5 * axialAcceleration * dt * dt,
    ),
    velocity: vec3(drift.x + turned.x, drift.y + turned.y, velocity0.z + axialAcceleration * dt),
  }
}

/* ---------------------------------------------------------------- selector -- */

/**
 * The speed a velocity selector passes: `v = |E|/|B|`.
 *
 * Gravity and mass are deliberately absent — this is the textbook selector
 * formula, which is posed with gravity neglected. `driftVelocity` is the general
 * answer and reduces to this magnitude when g = 0.
 *
 * `undefined` when there is no field to select with, or when E is not
 * perpendicular to B: `qv×B` is always perpendicular to B, so it can never cancel
 * a component of E along B, and no speed balances the force.
 */
export const selectorSpeed = (sample: FieldSample): number | undefined => {
  const electric = magnitude(sample.electricField)
  const magnetic = magnitude(sample.magneticFluxDensity)
  if (magnetic <= 0) return undefined
  if (electric <= 0) return 0

  const alignment = Math.abs(
    sample.electricField.x * sample.magneticFluxDensity.x +
      sample.electricField.y * sample.magneticFluxDensity.y +
      sample.electricField.z * sample.magneticFluxDensity.z,
  )
  if (alignment > DIRECTION_TOLERANCE * electric * magnetic) return undefined
  return electric / magnetic
}
