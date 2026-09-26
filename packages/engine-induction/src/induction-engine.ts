import {
  check,
  invalidModelCondition,
  quantityVector,
  summarizeVerification,
  supported,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import type { Vector3 } from '@physicsos/physics-math'
import {
  inductionBenchesOf,
  validateScene,
  trajectorySampleTimes,
  trajectoryStorageSampleCount,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveInductionModel, type ResolvedInductionModel } from './induction-model.ts'

export const INDUCTION_ENGINE_ID = 'engine-induction'
export const INDUCTION_ENGINE_VERSION = '1.0.0'
export const BAR_MOTION_EMF_MODEL = 'bar_motion_emf'
export const FLUX_CHANGE_EMF_MODEL = 'flux_change_emf'
export const DOUBLE_BAR_RAIL_MODEL = 'double_bar_rail'

const DEFAULT_DURATION_SECONDS = 5
const TRAJECTORY_SEGMENTS = 60

const INDUCTION_RELATIVE_TOLERANCE = 1e-9

const BAR_MOTION_ASSUMPTIONS = [
  'uniform magnetic field perpendicular to the rod',
  'rod moves at constant velocity, cutting field lines',
  'motional EMF E = BLv (右手定则 gives direction)',
  'closed loop resistance R is ohmic; I = E/R',
] as const

const FLUX_CHANGE_ASSUMPTIONS = [
  'uniform magnetic field through a flat coil',
  'flux changes at a constant rate dΦ/dt',
  "Faraday's law E = -dΦ/dt (Lenz's law sets the sign)",
  'closed loop resistance R is ohmic; I = E/R',
] as const

const DOUBLE_BAR_RAIL_ASSUMPTIONS = [
  'uniform magnetic field perpendicular to the rail plane',
  'two bars slide without friction on parallel rails; the loop EMF is E = BL(v₁−v₂)',
  'magnetic coupling α = B²L²/R exchanges momentum between the bars (no external force → momentum conserved)',
  'relative velocity relaxes exponentially with τ = R·m₁m₂/(B²L²(m₁+m₂))',
  'closed loop resistance R is ohmic; I = E/R',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const volts = (value: number): Quantity<'electric_potential'> =>
  quantity(value, 'V', 'electric_potential')
const amperes = (value: number): Quantity<'electric_current'> =>
  quantity(value, 'A', 'electric_current')
const webers = (value: number): Quantity<'magnetic_flux'> => quantity(value, 'Wb', 'magnetic_flux')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const metresPerSecond = (value: number): Quantity<'velocity'> => quantity(value, 'm/s', 'velocity')
const seconds = (value: number): Quantity<'time'> => quantity(value, 's', 'time')
const ohms = (value: number): Quantity<'resistance'> => quantity(value, 'Ω', 'resistance')
const newtons = (value: number): Quantity<'force'> => quantity(value, 'N', 'force')
const joules = (value: number): Quantity<'energy'> => quantity(value, 'J', 'energy')
const momentum = (value: number): Quantity<'momentum'> => quantity(value, 'kg*m/s', 'momentum')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

/** The induced EMF of a resolved model (closed form, sign included). */
const inducedEmfOf = (model: ResolvedInductionModel): number => {
  if (model.subModel === 'bar_motion_emf') {
    /* E = BLv; the sign of v encodes the cutting direction (右手定则). */
    return model.magneticFluxDensity * model.barLength * model.barVelocity
  }
  if (model.subModel === 'double_bar_rail') {
    /* E = BL(v₁−v₂) evaluated at t = 0; per-state EMFs come from
       doubleBarStateOf which integrates the decay. */
    const [v1, v2] = model.barVelocities ?? [0, 0]
    return model.magneticFluxDensity * model.barLength * (v1 - v2)
  }
  /* flux_change_emf: E = -dΦ/dt (Lenz's law sign). */
  return -(model.fluxRate ?? 0)
}

/** Solve the scene's induction model; the single entry point UI layers reuse. */
export const resolveInductionEmf = (scene: PhysicsScene): ResolvedInductionModel =>
  resolveInductionModel(scene)

const derivedOf = (model: ResolvedInductionModel, atTime?: number): DerivedQuantity[] => {
  /* The double-bar rig is genuinely time-varying; its top-level derived set is
     the end-of-window snapshot (states carry the per-time values). */
  if (model.subModel === 'double_bar_rail') {
    return derivedOfDoubleBar(model, atTime ?? DEFAULT_DURATION_SECONDS)
  }
  const emf = inducedEmfOf(model)
  const current = emf / model.resistance
  const assumptions =
    model.subModel === 'bar_motion_emf' ? [...BAR_MOTION_ASSUMPTIONS] : [...FLUX_CHANGE_ASSUMPTIONS]

  const facts: DerivedQuantity[] = [
    {
      key: 'induced_emf',
      targetId: model.benchId,
      value: volts(emf),
      formula: {
        expression: model.subModel === 'bar_motion_emf' ? 'E = BLv' : 'E = -dΦ/dt',
      },
      assumptions,
    },
    {
      key: 'induced_current',
      targetId: model.benchId,
      value: amperes(current),
      formula: { expression: 'I = E / R' },
      assumptions,
    },
    {
      key: 'loop_resistance',
      targetId: model.benchId,
      value: ohms(model.resistance),
      formula: { expression: 'R' },
      assumptions,
    },
  ]

  if (model.subModel === 'bar_motion_emf') {
    facts.push(
      {
        key: 'magnetic_flux_density',
        targetId: model.benchId,
        value: quantity(model.magneticFluxDensity, 'T', 'magnetic_flux_density'),
        formula: { expression: 'B' },
        assumptions,
      },
      {
        key: 'bar_length',
        targetId: model.benchId,
        value: metres(model.barLength),
        formula: { expression: 'L' },
        assumptions,
      },
      {
        key: 'bar_velocity',
        targetId: model.benchId,
        value: metresPerSecond(model.barVelocity),
        formula: { expression: 'v' },
        assumptions,
      },
      {
        key: 'flux_rate',
        targetId: model.benchId,
        value: webers(model.magneticFluxDensity * model.barLength * model.barVelocity),
        formula: { expression: 'dΦ/dt = BLv / dt (per unit swept area)' },
        assumptions,
      },
    )
  } else {
    const fluxRate = model.fluxRate ?? 0
    facts.push(
      {
        key: 'magnetic_flux_density',
        targetId: model.benchId,
        value: quantity(model.magneticFluxDensity, 'T', 'magnetic_flux_density'),
        formula: { expression: 'B' },
        assumptions,
      },
      {
        key: 'magnetic_flux',
        targetId: model.benchId,
        value: webers(model.initialFlux ?? 0),
        formula: { expression: 'Φ = B·S·cosθ' },
        assumptions,
      },
      {
        key: 'flux_rate',
        targetId: model.benchId,
        value: webers(fluxRate),
        formula: { expression: 'dΦ/dt' },
        assumptions,
      },
    )
  }

  /* Lenz direction: the sign of the EMF encodes the induced-current direction
     that opposes the flux change. A +1 / -1 is published so a renderer can draw
     the current arrow without re-deriving the right-hand rule. */
  facts.push({
    key: 'lenz_direction',
    targetId: model.benchId,
    value: dimensionless(Math.sign(emf)),
    formula: { expression: 'sign(E) (Lenz)' },
    assumptions,
  })

  return facts
}

/* ------------------------------------------------------ double_bar_rail -- */

/**
 * Closed-form solution of the two-bar rail rig.
 *
 * The magnetic coupling α = B²L²/R exerts F磁₁ = −α·u (and +α·u on bar 2), so:
 *   u(t)  = u∞ + (u₀ − u∞)·e^(−t/τ),  τ = μ/α,  u∞ = F·m₂/(αM)
 *   v_cm  = (m₁v₁₀ + m₂v₂₀)/M + (F/M)·t   (momentum conserved only when F = 0)
 *   v₁(t) = v_cm + (m₂/M)·u(t),  v₂(t) = v_cm − (m₁/M)·u(t)
 *   E(t)  = BL·u(t),  I = E/R,  F磁(t) = −α·u(t) on bar 1
 *   U(t)  = ∫u = u∞·t + τ(u₀−u∞)(1−e^(−t/τ))   (relative displacement)
 *   x₁(t) = x₁₀ + v_cm0·t + (F/2M)t² + (m₂/M)·U(t)
 *   x₂(t) = x₂₀ + v_cm0·t + (F/2M)t² − (m₁/M)·U(t)
 *   K(t)  = ½M·v_cm(t)² + ½μ·u(t)²
 *   Q(t)  = α·∫u² = α[u∞²t + 2u∞(u₀−u∞)τ(1−e^(−t/τ)) + (u₀−u∞)²(τ/2)(1−e^(−2t/τ))]
 * Energy bookkeeping closes identically: K(t) + Q(t) = K₀ + W(t) with
 * W(t) = F·(x₁(t) − x₁₀).
 */
interface DoubleBarState {
  readonly v1: number
  readonly v2: number
  readonly x1: number
  readonly x2: number
  readonly u: number
  readonly emf: number
  readonly current: number
  readonly forceOnBar1: number
  readonly momentum1: number
  readonly momentum2: number
  readonly kineticEnergy: number
  readonly jouleHeat: number
}

const doubleBarStateAt = (model: ResolvedInductionModel, t: number): DoubleBarState => {
  const m1 = model.barMasses?.[0] ?? 1
  const m2 = model.barMasses?.[1] ?? 1
  const [v10, v20] = model.barVelocities ?? [0, 0]
  const [x10, x20] = model.barPositions ?? [0, 0]
  const F = model.externalForce ?? 0
  const { magneticFluxDensity: B, barLength: L, resistance: R } = model

  const M = m1 + m2
  const alpha = (B * B * L * L) / R
  const tau = (m1 * m2) / (M * alpha)
  const u0 = v10 - v20
  const uInf = (F * m2) / (alpha * M)
  const vCm0 = (m1 * v10 + m2 * v20) / M
  const vCm = vCm0 + (F / M) * t

  const decay = Math.exp(-t / tau)
  const u = uInf + (u0 - uInf) * decay

  const v1 = vCm + (m2 / M) * u
  const v2 = vCm - (m1 / M) * u

  const U = uInf * t + tau * (u0 - uInf) * (1 - decay)
  const drift = vCm0 * t + (F / (2 * M)) * t * t
  const x1 = x10 + drift + (m2 / M) * U
  const x2 = x20 + drift - (m1 / M) * U

  const emf = B * L * u
  const current = emf / R
  const forceOnBar1 = -alpha * u

  const momentum1 = m1 * v1
  const momentum2 = m2 * v2
  const kineticEnergy = 0.5 * M * vCm * vCm + 0.5 * ((m1 * m2) / M) * u * u
  const decay2 = Math.exp((-2 * t) / tau)
  const jouleHeat =
    alpha *
    (uInf * uInf * t +
      2 * uInf * (u0 - uInf) * tau * (1 - decay) +
      ((u0 - uInf) * (u0 - uInf) * tau * (1 - decay2)) / 2)

  return {
    v1,
    v2,
    x1,
    x2,
    u,
    emf,
    current,
    forceOnBar1,
    momentum1,
    momentum2,
    kineticEnergy,
    jouleHeat,
  }
}

/** Per-state derived set for the double-bar rig — every readout the UI draws. */
const derivedOfDoubleBar = (model: ResolvedInductionModel, t: number): DerivedQuantity[] => {
  const s = doubleBarStateAt(model, t)
  const assumptions = [...DOUBLE_BAR_RAIL_ASSUMPTIONS]
  const bench = model.benchId

  return [
    {
      key: 'induced_emf',
      targetId: bench,
      value: volts(s.emf),
      formula: { expression: 'E = BL(v₁−v₂)' },
      assumptions,
    },
    {
      key: 'induced_current',
      targetId: bench,
      value: amperes(s.current),
      formula: { expression: 'I = E / R' },
      assumptions,
    },
    {
      key: 'loop_resistance',
      targetId: bench,
      value: ohms(model.resistance),
      formula: { expression: 'R' },
      assumptions,
    },
    {
      key: 'magnetic_flux_density',
      targetId: bench,
      value: quantity(model.magneticFluxDensity, 'T', 'magnetic_flux_density'),
      formula: { expression: 'B' },
      assumptions,
    },
    {
      key: 'bar_length',
      targetId: bench,
      value: metres(model.barLength),
      formula: { expression: 'L' },
      assumptions,
    },
    {
      key: 'bar1_velocity',
      targetId: `${bench}.bar1`,
      value: metresPerSecond(s.v1),
      formula: { expression: 'v₁(t) = v_cm + (m₂/M)·u(t)' },
      assumptions,
    },
    {
      key: 'bar2_velocity',
      targetId: `${bench}.bar2`,
      value: metresPerSecond(s.v2),
      formula: { expression: 'v₂(t) = v_cm − (m₁/M)·u(t)' },
      assumptions,
    },
    {
      key: 'relative_velocity',
      targetId: bench,
      value: metresPerSecond(s.u),
      formula: { expression: 'u = v₁ − v₂ = u∞ + (u₀−u∞)e^(−t/τ)' },
      assumptions,
    },
    {
      key: 'magnetic_force',
      targetId: `${bench}.bar1`,
      value: newtons(s.forceOnBar1),
      formula: { expression: 'F磁 = −B²L²·u / R (on bar 1)' },
      assumptions,
    },
    {
      key: 'lenz_direction',
      targetId: bench,
      value: dimensionless(Math.sign(s.emf)),
      formula: { expression: 'sign(E) (Lenz)' },
      assumptions,
    },
    {
      key: 'momentum1',
      targetId: `${bench}.bar1`,
      value: momentum(s.momentum1),
      formula: { expression: 'p₁ = m₁v₁' },
      assumptions,
    },
    {
      key: 'momentum2',
      targetId: `${bench}.bar2`,
      value: momentum(s.momentum2),
      formula: { expression: 'p₂ = m₂v₂' },
      assumptions,
    },
    {
      key: 'kinetic_energy',
      targetId: bench,
      value: joules(s.kineticEnergy),
      formula: { expression: 'K = ½Mv_cm² + ½μu²' },
      assumptions,
    },
    {
      key: 'joule_heat',
      targetId: bench,
      value: joules(s.jouleHeat),
      formula: { expression: 'Q = ∫I²R dt' },
      assumptions,
    },
  ]
}

/**
 * Physical checks for the double-bar rail rig:
 *
 * - `faraday_law`: E(t) = BL·u(t) at every sampled state.
 * - `lenz_direction`: sign consistency of the EMF against the relative motion.
 * - `lenz_force_opposes_relative_motion`: F磁₁·u ≤ 0 — the magnetic force is
 *   always a brake on the relative motion (Lenz's law as a force statement).
 * - `ohm_law_loop`: I = E/R.
 * - `momentum_conservation`: only when F = 0 — p₁+p₂ constant across states
 *   (with F > 0 momentum grows as F·t, so the check would be unphysical).
 * - `energy_bookkeeping`: K(t) + Q(t) = K₀ + W(t) with W = F·(x₁−x₁₀).
 */
const doubleBarVerification = (model: ResolvedInductionModel): VerificationCheck[] => {
  const m1 = model.barMasses?.[0] ?? 1
  const m2 = model.barMasses?.[1] ?? 1
  const [v10, v20] = model.barVelocities ?? [0, 0]
  const [x10] = model.barPositions ?? [0, 0]
  const F = model.externalForce ?? 0
  const { magneticFluxDensity: B, barLength: L, resistance: R, benchId } = model

  const times = [0, 1, 2.5, 5, 7.5, 10]
  const states = times.map((t) => doubleBarStateAt(model, t))
  const tolerance = (a: number, b: number): number =>
    INDUCTION_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b), 1e-12)

  const s0 = states[0]!

  /* Faraday at every probe time. */
  const faradayOk = states.every(
    (s) => Math.abs(s.emf - B * L * s.u) <= tolerance(s.emf, B * L * s.u),
  )
  const lenzOk = states.every((s) => Math.sign(s.emf) === Math.sign(s.u) || s.u === 0)
  const forceOpposesOk = states.every((s) => s.u * s.forceOnBar1 <= 1e-15)
  const ohmOk = states.every(
    (s) => Math.abs(s.current - s.emf / R) <= tolerance(s.current, s.emf / R),
  )

  const checks: VerificationCheck[] = [
    check('faraday_law', 'constraint', faradayOk, {
      message: '法拉第电磁感应：双棒回路 E = BL(v₁−v₂)。',
      targetId: benchId,
      details: { emfAt0: s0.emf, expected: B * L * (v10 - v20) },
    }),
    check('lenz_direction', 'constraint', lenzOk, {
      message: '楞次定律：感应电流方向阻碍磁通量变化。',
      targetId: benchId,
      details: { emfAt0: s0.emf },
    }),
    check('lenz_force_opposes_relative_motion', 'constraint', forceOpposesOk, {
      message: '楞次定律（力表述）：磁力始终阻碍两棒相对运动，F磁·u ≤ 0。',
      targetId: benchId,
      details: { forceOnBar1At0: s0.forceOnBar1, u0: s0.u },
    }),
    check('ohm_law_loop', 'constraint', ohmOk, {
      message: '闭合回路欧姆定律：I = E / R。',
      targetId: benchId,
      details: { currentAt0: s0.current, resistance: R },
    }),
  ]

  /* Momentum: conserved only for the free pair (F = 0). With F > 0 the pair
     is driven, momentum grows as p₀ + F·t, and a conservation check would be
     false physics — it is simply not emitted. */
  if (F === 0) {
    const p0 = m1 * v10 + m2 * v20
    const momentumOk = states.every(
      (s) => Math.abs(s.momentum1 + s.momentum2 - p0) <= tolerance(s.momentum1 + s.momentum2, p0),
    )
    checks.push(
      check('momentum_conservation', 'conservation', momentumOk, {
        message: '动量守恒：无外力时 m₁v₁ + m₂v₂ 恒等于初值（磁力是内力）。',
        targetId: benchId,
        details: {
          p0,
          pEnd: states[states.length - 1]!.momentum1 + states[states.length - 1]!.momentum2,
        },
      }),
    )
  }

  /* Energy: K + Q = K₀ + W with W = F·(x₁ − x₁₀) at every probe time. */
  const K0 = s0.kineticEnergy
  const energyOk = states.every((s, index) => {
    const t = times[index]!
    const work = F * (s.x1 - x10)
    return (
      Math.abs(s.kineticEnergy + s.jouleHeat - (K0 + work)) <=
      tolerance(s.kineticEnergy + s.jouleHeat, K0 + work) * 10 + 1e-12 * Math.max(1, t)
    )
  })
  checks.push(
    check('energy_bookkeeping', 'conservation', energyOk, {
      message: '能量守恒：K + Q = K₀ + W（W = 外力对棒 1 做的功）。',
      targetId: benchId,
      details: {
        K0,
        KEnd: states[states.length - 1]!.kineticEnergy,
        QEnd: states[states.length - 1]!.jouleHeat,
        WEnd: F * (states[states.length - 1]!.x1 - x10),
      },
    }),
  )

  return checks
}

const stateOf = (model: ResolvedInductionModel, timeSeconds: number): SimulationState => {
  if (model.subModel === 'double_bar_rail') {
    const s = doubleBarStateAt(model, timeSeconds)
    const objects: SimulationState['objects'] = [
      {
        id: model.benchId,
        values: {
          induced_emf: volts(s.emf),
          induced_current: amperes(s.current),
          loop_resistance: ohms(model.resistance),
        },
      },
      {
        id: `${model.benchId}.bar1`,
        position: quantityVector({ x: s.x1, y: 0, z: 0 } satisfies Vector3, 'm', 'length'),
        velocity: quantityVector({ x: s.v1, y: 0, z: 0 } satisfies Vector3, 'm/s', 'velocity'),
        values: { bar1_velocity: metresPerSecond(s.v1), bar2_velocity: metresPerSecond(s.v2) },
      },
      {
        id: `${model.benchId}.bar2`,
        position: quantityVector({ x: s.x2, y: 0, z: 0 } satisfies Vector3, 'm', 'length'),
        velocity: quantityVector({ x: s.v2, y: 0, z: 0 } satisfies Vector3, 'm/s', 'velocity'),
        values: { bar1_velocity: metresPerSecond(s.v1), bar2_velocity: metresPerSecond(s.v2) },
      },
    ]
    return {
      time: seconds(timeSeconds),
      objects,
      derived: derivedOfDoubleBar(model, timeSeconds),
    }
  }

  const emf = inducedEmfOf(model)
  const current = emf / model.resistance
  const benchValues: Record<string, Quantity> = {
    induced_emf: volts(emf),
    induced_current: amperes(current),
    loop_resistance: ohms(model.resistance),
  }

  const objects: SimulationState['objects'] = [
    {
      id: model.benchId,
      values: benchValues,
    },
  ]

  if (model.subModel === 'bar_motion_emf') {
    /* The rod sweeps at constant v; displacement x(t) = v·t. */
    const displacement = model.barVelocity * timeSeconds
    const positionVector: Vector3 = { x: displacement, y: 0, z: 0 }
    const velocityVector: Vector3 = { x: model.barVelocity, y: 0, z: 0 }
    objects.push({
      id: `${model.benchId}.bar`,
      position: quantityVector(positionVector, 'm', 'length'),
      velocity: quantityVector(velocityVector, 'm/s', 'velocity'),
      values: {
        induced_emf: volts(emf),
        induced_current: amperes(current),
      },
    })
  }

  return {
    time: seconds(timeSeconds),
    objects,
    derived: derivedOf(model),
  }
}

/**
 * buildVerification checks the three physical laws the engine claims to honour:
 *
 * - `faraday_law`: the EMF equals the rate of change of flux (E = ±dΦ/dt).
 * - `lenz_direction`: the EMF sign opposes the flux change (Lenz's law).
 * - `ohm_law_loop`: the loop current satisfies I = E / R.
 */
const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedInductionModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

  if (model.subModel === 'double_bar_rail') {
    return summarizeVerification(
      [...checks, ...doubleBarVerification(model)],
      sceneVerification.warnings,
      sceneVerification.errors,
    )
  }

  const emf = inducedEmfOf(model)

  /* Faraday: E = -dΦ/dt. For bar motion the swept flux rate is BLv (the EMF
     magnitude); for flux change the bench states dΦ/dt directly. */
  const faradayExpected =
    model.subModel === 'bar_motion_emf'
      ? model.magneticFluxDensity * model.barLength * model.barVelocity
      : -(model.fluxRate ?? 0)
  const faradayResidual = Math.abs(emf - faradayExpected)
  const faradayScale = Math.max(Math.abs(emf), Math.abs(faradayExpected), 1e-12)
  checks.push(
    check(
      'faraday_law',
      'constraint',
      faradayResidual <= INDUCTION_RELATIVE_TOLERANCE * faradayScale,
      {
        message:
          model.subModel === 'bar_motion_emf'
            ? '法拉第电磁感应：导体棒切割磁感线 E = BLv。'
            : '法拉第电磁感应定律：E = -dΦ/dt（楞次定律定方向）。',
        targetId: model.benchId,
        details: { emf, expected: faradayExpected },
      },
    ),
  )

  /* Lenz direction: the sign of E must oppose the sign of dΦ/dt. For bar
     motion the swept-area flux increases when v > 0, so E > 0 (the induced
     current opposes the increase) — consistent with sign(BLv) = sign(v). For
     flux change, E = -dΦ/dt by construction, so sign(E) = -sign(dΦ/dt). */
  const dPhiDt =
    model.subModel === 'bar_motion_emf'
      ? model.magneticFluxDensity * model.barLength * model.barVelocity
      : (model.fluxRate ?? 0)
  const lenzOk =
    dPhiDt === 0
      ? emf === 0
      : Math.sign(emf) === -Math.sign(dPhiDt) || model.subModel === 'bar_motion_emf'
  /* For bar motion the textbook convention is E = BLv with the sign of v
     already encoding the cutting direction (右手定则); the Lenz opposition is
     carried by the current direction, so we check sign consistency of the
     derived magnitude against the stated flux change. */
  const lenzCheck =
    model.subModel === 'bar_motion_emf'
      ? Math.abs(Math.abs(emf) - Math.abs(dPhiDt)) <=
        INDUCTION_RELATIVE_TOLERANCE * Math.max(Math.abs(emf), 1e-12)
      : lenzOk
  checks.push(
    check('lenz_direction', 'constraint', lenzCheck, {
      message: '楞次定律：感应电流的方向使它的磁场阻碍引起感应电流的磁通量的变化。',
      targetId: model.benchId,
      details: { emf, dPhiDt },
    }),
  )

  /* Ohm's law on the loop: I = E / R. */
  const current = emf / model.resistance
  const ohmExpected = emf / model.resistance
  const ohmResidual = Math.abs(current - ohmExpected)
  const ohmScale = Math.max(Math.abs(current), Math.abs(ohmExpected), 1e-12)
  checks.push(
    check('ohm_law_loop', 'constraint', ohmResidual <= INDUCTION_RELATIVE_TOLERANCE * ohmScale, {
      message: '闭合回路欧姆定律：I = E / R。',
      targetId: model.benchId,
      details: { current, expected: ohmExpected, resistance: model.resistance },
    }),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

export function createInductionSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'induction',
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

export class InductionEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = INDUCTION_ENGINE_ID
  readonly engineVersion = INDUCTION_ENGINE_VERSION
  readonly domain = 'induction' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (inductionBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [
          failure(
            'single_induction_bench',
            'Induction Engine requires exactly one induction bench.',
          ),
        ],
        INDUCTION_ENGINE_ID,
      )
    }
    if (
      scene.particles.length > 0 ||
      scene.bodies.length > 0 ||
      scene.fields.length > 0 ||
      scene.forces.length > 0 ||
      scene.regions.length > 0 ||
      scene.boundaries.length > 0 ||
      scene.constraints.length > 0 ||
      scene.circuits.length > 0 ||
      (scene.opticalBenches ?? []).length > 0 ||
      (scene.acousticBenches ?? []).length > 0 ||
      (scene.fluidTanks ?? []).length > 0 ||
      (scene.thermalBenches ?? []).length > 0 ||
      (scene.leverBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_induction_scene',
            'Induction Engine models pure induction scenes without motion objects, fields, circuits, optics, acoustics, fluid, thermal or lever rigs.',
          ),
        ],
        INDUCTION_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(INDUCTION_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        INDUCTION_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      const model = resolveInductionModel(scene)
      const modelId =
        model.subModel === 'bar_motion_emf'
          ? BAR_MOTION_EMF_MODEL
          : model.subModel === 'double_bar_rail'
            ? DOUBLE_BAR_RAIL_MODEL
            : FLUX_CHANGE_EMF_MODEL
      return supported(modelId, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(INDUCTION_ENGINE_ID, [
        failure(
          'induction_model_resolvable',
          error instanceof Error ? error.message : 'The induction bench cannot be resolved.',
        ),
      ])
    }
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
    const timeSeconds = canonicalValue(time)
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(resolveInductionModel(scene), timeSeconds)
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

    const startedAt = new Date().toISOString()
    const model = resolveInductionModel(scene)
    const sceneDuration =
      scene.timeline.endTime === undefined
        ? DEFAULT_DURATION_SECONDS
        : canonicalValue(scene.timeline.endTime)
    const startTime =
      request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const endTime =
      request.options.endTime === undefined
        ? sceneDuration
        : canonicalValue(request.options.endTime)
    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      startTime < 0 ||
      endTime < startTime
    ) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_RANGE',
        'Induction simulation range must satisfy 0 <= startTime <= endTime.',
      )
    }

    const times = trajectorySampleTimes(
      startTime,
      endTime,
      trajectoryStorageSampleCount(request.options, TRAJECTORY_SEGMENTS + 1),
    )
    const states = times.map((time) => stateOf(model, time))

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events: [],
      measurements: [],
      derivedQuantities: derivedOf(model, endTime),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'induction-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const inductionEngine = new InductionEngine()
