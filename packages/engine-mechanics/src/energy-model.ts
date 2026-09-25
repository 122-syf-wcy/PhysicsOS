import { canonicalValue } from '@physicsos/physics-units'
import { energyBenchesOf, type EnergyBench, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of the mechanical-energy rig: a cart of mass m released
 * from a height h on a ramp of angle θ, with kinetic friction μ along it.
 *
 * Everything is time-independent apparatus in the same sense the pressure and
 * current rigs are: the ledger is a function of WHERE the cart is, not of when,
 * so the rig reports it from the geometry rather than integrating a trajectory.
 */
export interface ResolvedEnergyModel {
  readonly benchId: string
  /** Mass of the cart (kg), > 0. */
  readonly mass: number
  /** Gravitational field strength (m/s²), > 0. */
  readonly gravity: number
  /** Release height above the bottom of the ramp (m), > 0. */
  readonly releaseHeight: number
  /** Incline angle (rad), strictly between 0 and π/2. */
  readonly inclineAngle: number
  /** Kinetic friction coefficient along the ramp, ≥ 0. */
  readonly frictionCoefficient: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const benchOf = (bench: EnergyBench): ResolvedEnergyModel => {
  const angle = canonicalValue(bench.inclineAngle)
  if (!Number.isFinite(angle) || angle <= 0 || angle >= Math.PI / 2) {
    throw modelError(
      'ENERGY_ANGLE_RANGE',
      `Energy bench "${bench.id}" angle must be strictly between 0° and 90°.`,
    )
  }
  const friction = canonicalValue(bench.frictionCoefficient)
  if (!Number.isFinite(friction) || friction < 0) {
    throw modelError(
      'ENERGY_FRICTION',
      `Energy bench "${bench.id}" friction coefficient must be finite and ≥ 0.`,
    )
  }
  return {
    benchId: bench.id,
    mass: positiveOrThrow(
      canonicalValue(bench.mass),
      'ENERGY_MASS',
      `Energy bench "${bench.id}" mass must be finite and > 0.`,
    ),
    gravity: positiveOrThrow(
      canonicalValue(bench.gravity),
      'ENERGY_GRAVITY',
      `Energy bench "${bench.id}" gravity must be finite and > 0.`,
    ),
    releaseHeight: positiveOrThrow(
      canonicalValue(bench.releaseHeight),
      'ENERGY_HEIGHT',
      `Energy bench "${bench.id}" release height must be finite and > 0.`,
    ),
    inclineAngle: angle,
    frictionCoefficient: friction,
  }
}

/**
 * Resolve the scene's energy bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a rig the model cannot honour.
 */
export const resolveEnergyModel = (scene: PhysicsScene): ResolvedEnergyModel => {
  const benches = energyBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError(
      'ENERGY_SINGLE_BENCH',
      'Energy Engine requires exactly one mechanical-energy bench.',
    )
  }
  return benchOf(bench)
}
