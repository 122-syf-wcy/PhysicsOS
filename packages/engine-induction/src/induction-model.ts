import { canonicalValue } from '@physicsos/physics-units'
import { inductionBenchesOf, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * The closed-form induction sub-models this engine solves.
 *
 * - `bar_motion_emf`: a conducting rod of length L moves at velocity v through
 *   a uniform field B; the motional EMF is E = BLv (右手定则 gives direction).
 * - `flux_change_emf`: a coil of area S sits in a field B whose flux changes at
 *   a constant rate; Faraday's law gives E = -dΦ/dt.
 * - `double_bar_rail`: two bars slide on parallel rails; the loop EMF is
 *   E = BL(v₁−v₂) and the magnetic coupling decays the relative velocity with
 *   τ = R·m₁m₂/(B²L²(m₁+m₂)).
 *
 * The scene's induction bench carries one primary configuration at a time; the
 * resolved model records which sub-model the bench describes so the engine
 * picks the right closed form.
 */
export type InductionSubModel = 'bar_motion_emf' | 'flux_change_emf' | 'double_bar_rail'

/**
 * Canonical (SI) view of an induction bench. All values are finite and in SI:
 * B in tesla, L / S in metres / square metres, v in m/s, R in ohms.
 *
 * For `bar_motion_emf` the rod sweeps through the field at constant v, so:
 *   E = BLv         (constant, independent of time)
 *   x(t) = v·t      (displacement of the rod)
 *
 * For `flux_change_emf` the bench states a constant flux rate dΦ/dt, so:
 *   E = -dΦ/dt      (constant, sign from Lenz's law)
 *
 * Both carry a closed loop resistance R so the induced current I = E / R.
 */
export interface ResolvedInductionModel {
  readonly benchId: string
  readonly subModel: InductionSubModel
  /** Magnetic flux density (T), > 0. */
  readonly magneticFluxDensity: number
  /** Rod length (m), > 0 for bar_motion; coil area (m²) as `coilArea` for flux_change. */
  readonly barLength: number
  /** Rod velocity (m/s); sign encodes direction relative to the field sweep. */
  readonly barVelocity: number
  /** Loop resistance (Ω), > 0. */
  readonly resistance: number
  /* ----------------------------------------------------- flux_change fields -- */
  /** Coil area (m²), > 0; only meaningful for `flux_change_emf`. */
  readonly coilArea?: number
  /** Angle between B and the coil normal (rad); Φ = B·S·cosθ. */
  readonly coilAngle?: number
  /** Magnetic flux at t = 0 (Wb). */
  readonly initialFlux?: number
  /** Constant rate of change of flux dΦ/dt (Wb/s); E = -dΦ/dt. */
  readonly fluxRate?: number
  /* -------------------------------------------------- double_bar_rail fields -- */
  /** Bar masses (kg), positional [bar1, bar2]; each > 0. */
  readonly barMasses?: readonly [number, number]
  /** Initial bar velocities (m/s); sign encodes direction along the rails. */
  readonly barVelocities?: readonly [number, number]
  /** Initial bar x positions (m); sign encodes side of the origin. */
  readonly barPositions?: readonly [number, number]
  /** Constant external force on bar 1 (N), ≥ 0; 0 = free pair. */
  readonly externalForce?: number
  /** Centre-of-mass velocity at the END of the run window (m/s) — the pair's
      drift the canvas frames around. Constant when F = 0. */
  readonly centreOfMassVelocity?: number
}

const modelError = (code: string, message: string): PhysicsOSError => new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const finiteOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value)) throw modelError(code, message)
  return value
}

/**
 * Resolve the scene's induction bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a scene the model cannot honour.
 */
export const resolveInductionModel = (scene: PhysicsScene): ResolvedInductionModel => {
  const benches = inductionBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('INDUCTION_SINGLE_BENCH', 'Induction Engine requires exactly one induction bench.')
  }

  const magneticFluxDensity = positiveOrThrow(
    canonicalValue(bench.magneticFluxDensity),
    'INDUCTION_FIELD',
    'Magnetic flux density must be finite and > 0.',
  )
  const resistance = positiveOrThrow(
    canonicalValue(bench.resistance),
    'INDUCTION_RESISTANCE',
    'Loop resistance must be finite and > 0.',
  )

  if (bench.type === 'bar_motion') {
    if (bench.barLength === undefined) {
      throw modelError('INDUCTION_BAR_LENGTH', 'Rod length must be defined for a bar_motion bench.')
    }
    if (bench.barVelocity === undefined) {
      throw modelError('INDUCTION_BAR_VELOCITY', 'Rod velocity must be defined for a bar_motion bench.')
    }
    const barLength = positiveOrThrow(
      canonicalValue(bench.barLength),
      'INDUCTION_BAR_LENGTH',
      'Rod length must be finite and > 0.',
    )
    const barVelocity = finiteOrThrow(
      canonicalValue(bench.barVelocity),
      'INDUCTION_BAR_VELOCITY',
      'Rod velocity must be finite.',
    )
    return {
      benchId: bench.id,
      subModel: 'bar_motion_emf',
      magneticFluxDensity,
      barLength,
      barVelocity,
      resistance,
    }
  }

  if (bench.type === 'double_bar_rail') {
    if (bench.barLength === undefined) {
      throw modelError('INDUCTION_BAR_LENGTH', 'Rail spacing (bar length) must be defined for a double_bar_rail bench.')
    }
    if (bench.barMasses === undefined) {
      throw modelError('INDUCTION_BAR_MASSES', 'Both bar masses must be defined for a double_bar_rail bench.')
    }
    if (bench.barVelocities === undefined) {
      throw modelError('INDUCTION_BAR_VELOCITIES', 'Both initial bar velocities must be defined for a double_bar_rail bench.')
    }
    if (bench.barPositions === undefined) {
      throw modelError('INDUCTION_BAR_POSITIONS', 'Both initial bar positions must be defined for a double_bar_rail bench.')
    }
    const barLength = positiveOrThrow(
      canonicalValue(bench.barLength),
      'INDUCTION_BAR_LENGTH',
      'Rail spacing (bar length) must be finite and > 0.',
    )
    const massesSI = [
      canonicalValue(bench.barMasses[0]),
      canonicalValue(bench.barMasses[1]),
    ] as const
    if (!Number.isFinite(massesSI[0]) || !Number.isFinite(massesSI[1]) || massesSI[0] <= 0 || massesSI[1] <= 0) {
      throw modelError('INDUCTION_BAR_MASSES', 'Each bar mass must be finite and > 0.')
    }
    const velocitiesSI = [
      canonicalValue(bench.barVelocities[0]),
      canonicalValue(bench.barVelocities[1]),
    ] as const
    if (!Number.isFinite(velocitiesSI[0]) || !Number.isFinite(velocitiesSI[1])) {
      throw modelError('INDUCTION_BAR_VELOCITIES', 'Each initial bar velocity must be finite.')
    }
    const positionsSI = [
      canonicalValue(bench.barPositions[0]),
      canonicalValue(bench.barPositions[1]),
    ] as const
    if (!Number.isFinite(positionsSI[0]) || !Number.isFinite(positionsSI[1])) {
      throw modelError('INDUCTION_BAR_POSITIONS', 'Each initial bar position must be finite.')
    }
    const externalForceRaw = bench.externalForce === undefined ? 0 : canonicalValue(bench.externalForce)
    if (!Number.isFinite(externalForceRaw) || externalForceRaw < 0) {
      throw modelError('INDUCTION_EXTERNAL_FORCE', 'The external force must be finite and ≥ 0.')
    }
    /* The canvas frames the rig around the pair's drift over the run window;
       v_cm(T) = (m₁v₁₀+m₂v₂₀)/M + (F/M)·T with the scene's stamped end time. */
    const totalMass = massesSI[0] + massesSI[1]
    const runEnd = scene.timeline.endTime === undefined ? 5 : canonicalValue(scene.timeline.endTime)
    const centreOfMassVelocity =
      (massesSI[0] * velocitiesSI[0] + massesSI[1] * velocitiesSI[1]) / totalMass +
      (externalForceRaw / totalMass) * runEnd
    return {
      benchId: bench.id,
      subModel: 'double_bar_rail',
      magneticFluxDensity,
      barLength,
      barVelocity: velocitiesSI[0],
      resistance,
      barMasses: [massesSI[0], massesSI[1]],
      barVelocities: [velocitiesSI[0], velocitiesSI[1]],
      barPositions: [positionsSI[0], positionsSI[1]],
      externalForce: externalForceRaw,
      centreOfMassVelocity,
    }
  }

  /* flux_change */
  if (bench.coilArea === undefined) {
    throw modelError('INDUCTION_COIL_AREA', 'Coil area must be defined for a flux_change bench.')
  }
  if (bench.coilAngle === undefined) {
    throw modelError('INDUCTION_COIL_ANGLE', 'Coil angle must be defined for a flux_change bench.')
  }
  if (bench.fluxRate === undefined) {
    throw modelError('INDUCTION_FLUX_RATE', 'Flux rate must be defined for a flux_change bench.')
  }
  const coilArea = positiveOrThrow(
    canonicalValue(bench.coilArea),
    'INDUCTION_COIL_AREA',
    'Coil area must be finite and > 0.',
  )
  const coilAngle = finiteOrThrow(
    canonicalValue(bench.coilAngle),
    'INDUCTION_COIL_ANGLE',
    'Coil angle must be finite.',
  )
  const fluxRate = finiteOrThrow(
    canonicalValue(bench.fluxRate),
    'INDUCTION_FLUX_RATE',
    'Flux rate dΦ/dt must be finite.',
  )
  const initialFlux = magneticFluxDensity * coilArea * Math.cos(coilAngle)
  return {
    benchId: bench.id,
    subModel: 'flux_change_emf',
    magneticFluxDensity,
    barLength: 0,
    barVelocity: 0,
    resistance,
    coilArea,
    coilAngle,
    initialFlux,
    fluxRate,
  }
}
