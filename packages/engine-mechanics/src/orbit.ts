/**
 * Circular orbits and the centripetal force that keeps them.
 *
 * Self-contained physics, kept apart from the engine class the way every other
 * slice keeps its closed forms apart: the golden tests import these directly, so
 * the number a student reads and the number a test asserts come from one place.
 *
 * The one force here is gravity, so `GM` is the single parameter that fixes the
 * whole orbit — radius, speed and period are three consequences of it, and the
 * engine checks them against each other rather than against the formulas that
 * produced them.
 */

export const ORBIT_RELATIVE_TOLERANCE = 1e-9

/** Earth's gravitational parameter GM (m³/s²). */
export const EARTH_GRAVITATIONAL_PARAMETER = 3.986004418e14

/** Speed on a circular orbit of radius r: v = √(GM/r) (m/s). */
export const circularOrbitSpeed = (gravitationalParameter: number, radius: number): number =>
  Math.sqrt(gravitationalParameter / radius)

/** Period of that orbit: T = 2πr/v (s). */
export const circularOrbitPeriod = (gravitationalParameter: number, radius: number): number =>
  (2 * Math.PI * radius) / circularOrbitSpeed(gravitationalParameter, radius)

/**
 * The centripetal acceleration the orbit's own speed demands: a = v²/r (m/s²).
 *
 * This is the KINEMATIC side — what a body going round at that speed must be
 * accelerating at — and it is what the gravitational force has to supply.
 */
export const centripetalAcceleration = (speed: number, radius: number): number =>
  (speed * speed) / radius

/** The acceleration gravity actually supplies at that radius: a = GM/r² (m/s²). */
export const gravitationalAcceleration = (gravitationalParameter: number, radius: number): number =>
  gravitationalParameter / (radius * radius)

/** What a circular orbit reads. */
export interface OrbitReading {
  readonly gravitationalParameter: number
  readonly radius: number
  /** Orbital speed (m/s). */
  readonly speed: number
  /** Orbital period (s). */
  readonly period: number
  /** a = v²/r the motion demands (m/s²). */
  readonly requiredAcceleration: number
  /** a = GM/r² gravity supplies (m/s²). */
  readonly suppliedAcceleration: number
  /** The force on a satellite of the given mass (N). */
  readonly force: number
}

export const orbitReadingOf = (
  gravitationalParameter: number,
  radius: number,
  satelliteMass: number,
): OrbitReading => {
  const speed = circularOrbitSpeed(gravitationalParameter, radius)
  return {
    gravitationalParameter,
    radius,
    speed,
    period: circularOrbitPeriod(gravitationalParameter, radius),
    requiredAcceleration: centripetalAcceleration(speed, radius),
    suppliedAcceleration: gravitationalAcceleration(gravitationalParameter, radius),
    force: satelliteMass * gravitationalAcceleration(gravitationalParameter, radius),
  }
}
