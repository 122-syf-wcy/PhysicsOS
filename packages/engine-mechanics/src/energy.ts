import type { ResolvedEnergyModel } from './energy-model.ts'

/**
 * The energy accounting this engine is allowed to state, as closed-form
 * functions. Kept apart from the engine class for the same reason the other
 * slices keep theirs apart: the golden tests import these directly, so the
 * number a student reads and the number a test asserts come from one place.
 */

export const ENERGY_RELATIVE_TOLERANCE = 1e-9

/** Kinetic energy, Ek = ½mv² (J). */
export const kineticEnergy = (mass: number, speed: number): number =>
  0.5 * mass * speed * speed

/** Gravitational potential energy relative to the bottom of the ramp, Ep = mgh (J). */
export const gravitationalPotentialEnergy = (
  mass: number,
  gravity: number,
  height: number,
): number => mass * gravity * height

/**
 * Speed the cart reaches after falling `height` with nothing taking energy out:
 * v = √(2gh), the same number kinematics would give for free fall.
 */
export const speedFromHeight = (gravity: number, height: number): number =>
  Math.sqrt(2 * gravity * height)

/** Length of the ramp that rises `height` at `angle`: L = h/sinθ (m). */
export const rampLengthOf = (height: number, angleRadians: number): number =>
  height / Math.sin(angleRadians)

/**
 * Work kinetic friction does on the way down: W = μ·m·g·cosθ·L.
 *
 * Written with the ramp's own length because that is what the friction acts
 * along. Substituting L = h/sinθ makes it W = μ·m·g·h·cotθ, which is where the
 * counter-intuitive part lives: **a SHALLOWER ramp takes MORE energy away.** The
 * path grows as cotθ while the normal force only falls as cosθ, so easing the
 * slope costs more heat, not less — and at θ = 90° a vertical drop costs none at
 * all, because there is no surface to rub against.
 *
 * At 45° cotθ = 1 and the work is numerically μ·m·g·h, which is why a 45° rig is
 * the one where the friction term reads as "exactly the height".
 */
export const frictionWorkOnRamp = (
  frictionCoefficient: number,
  mass: number,
  gravity: number,
  angleRadians: number,
  rampLength: number,
): number => frictionCoefficient * mass * gravity * Math.cos(angleRadians) * rampLength

/** The ledger: what the energy is at each point of one trip down. */
export interface EnergyLedger {
  readonly mass: number
  readonly gravity: number
  readonly releaseHeight: number
  readonly inclineAngle: number
  readonly frictionCoefficient: number
  /** Ramp length the cart actually travels (m). */
  readonly rampLength: number
  /** Ep at the release point, mgh (J). */
  readonly potentialAtRelease: number
  /** Work friction takes out on the way down (J). */
  readonly frictionWork: number
  /** What is left as motion at the bottom, mgh − W_f (J). */
  readonly kineticAtBottom: number
  /** Speed at the bottom, √(2Ek/m) (m/s). */
  readonly speedAtBottom: number
  /** What the speed would be with no friction, √(2gh) (m/s). */
  readonly idealSpeed: number
  /** Ek + W_f: the ledger's own sum, which has to come back to Ep (J). */
  readonly energyAccounted: number
}

export const energyLedgerOf = (model: ResolvedEnergyModel): EnergyLedger => {
  const rampLength = rampLengthOf(model.releaseHeight, model.inclineAngle)
  const potentialAtRelease = gravitationalPotentialEnergy(
    model.mass,
    model.gravity,
    model.releaseHeight,
  )
  const frictionWork = frictionWorkOnRamp(
    model.frictionCoefficient,
    model.mass,
    model.gravity,
    model.inclineAngle,
    rampLength,
  )
  const kineticAtBottom = potentialAtRelease - frictionWork
  return {
    mass: model.mass,
    gravity: model.gravity,
    releaseHeight: model.releaseHeight,
    inclineAngle: model.inclineAngle,
    frictionCoefficient: model.frictionCoefficient,
    rampLength,
    potentialAtRelease,
    frictionWork,
    kineticAtBottom,
    speedAtBottom: Math.sqrt((2 * Math.max(kineticAtBottom, 0)) / model.mass),
    idealSpeed: speedFromHeight(model.gravity, model.releaseHeight),
    energyAccounted: kineticAtBottom + frictionWork,
  }
}
