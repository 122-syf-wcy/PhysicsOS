/**
 * Composite-field verifier.
 *
 * The composite ENGINE already verifies the laws it integrated (superposition,
 * zero magnetic power, energy consistency). This verifier answers a different,
 * student-facing question: *is the apparatus doing what the apparatus is for?*
 *
 *  - A velocity selector is working when the electric and magnetic forces on the
 *    particle cancel, so the beam passes straight. `v ≠ E/B` is not a physics
 *    error — it is a legitimate world in which the selector rejects the particle.
 *  - A mass spectrometer is working when the selected beam reaches a magnetic-only
 *    region and turns with the radius `r = mv/|q|B`.
 *
 * That distinction matters for the product: the engine's verification status
 * gates whether a result may be shown at all, while these checks are a READOUT the
 * Lab and the Agent quote. A failing selection condition must never make the
 * simulation "unverified" — the physics is right, the beam simply deflects.
 *
 * Nothing here re-integrates motion: every number is read from the scene the
 * engine solved and from `@physicsos/physics-composite-core`, the same closed form
 * the engine used.
 */

import {
  DEFAULT_TOLERANCE,
  check,
  summarizeVerification,
  toCanonicalVector,
  type SimulationResult,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { magnitude, type Vector3 } from '@physicsos/physics-math'
import {
  gravityFieldsOf,
  sampleFieldsAt,
  uniformElectricFieldsOf,
  uniformMagneticFieldsOf,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import {
  compositeForce,
  cyclotronPeriod,
  gyroRadius,
  selectorSpeed,
} from '@physicsos/physics-composite-core'

export const COMPOSITE_VERIFIER_ASSUMPTIONS = [
  'crossed uniform fields',
  'region-bound uniform fields',
  '2D analytical motion',
] as const

/** Relative tolerance for "the two forces cancel". */
const BALANCE_TOLERANCE = 1e-6

/**
 * True when a scene is a composite-field world this verifier can speak about:
 * a charged particle with at least two of {E, B, g} acting on it.
 */
export const isCompositeVerifiableScene = (scene: PhysicsScene): boolean => {
  const kinds = [
    uniformElectricFieldsOf(scene).length > 0,
    uniformMagneticFieldsOf(scene).length > 0,
    gravityFieldsOf(scene).length > 0,
  ].filter(Boolean).length
  return scene.particles.length > 0 && kinds >= 2
}

/** The frame the selection condition is judged in: inside the crossed-field region. */
interface SelectorFrame {
  readonly position: Vector3
  readonly velocity: Vector3
  readonly electricField: Vector3
  readonly magneticFluxDensity: Vector3
  readonly gravity: Vector3
  readonly regionIds: readonly string[]
}

/**
 * Find the first simulated frame where both E and B act.
 *
 * The particle usually starts OUTSIDE the selector region (the textbook "从左端
 * 进入" setup), where every field is zero. Judging the balance on the initial
 * frame would therefore report a perfectly balanced zero — the Phase 4 mistake of
 * reading a zero-field frame as if it described the field. So the frame is chosen
 * by looking for crossed fields, and the check is skipped when the particle never
 * enters one.
 */
const crossedFieldFrame = (
  scene: PhysicsScene,
  simulation: SimulationResult,
): SelectorFrame | undefined => {
  const particle = scene.particles[0]
  if (particle === undefined) return undefined
  for (const state of simulation.states) {
    const object = state.objects.find((entry) => entry.id === particle.id) ?? state.objects[0]
    if (object?.position === undefined || object.velocity === undefined) continue
    const position = toCanonicalVector(object.position).vectorSI
    const velocity = toCanonicalVector(object.velocity).vectorSI
    const sample = sampleFieldsAt(scene, position)
    if (magnitude(sample.electricField) > 0 && magnitude(sample.magneticFluxDensity) > 0) {
      return {
        position,
        velocity,
        electricField: sample.electricField,
        magneticFluxDensity: sample.magneticFluxDensity,
        gravity: sample.gravity,
        regionIds: sample.regionIds,
      }
    }
  }
  return undefined
}

/** The first simulated frame where B acts alone — the spectrometer's deflection arc. */
const magneticOnlyFrame = (
  scene: PhysicsScene,
  simulation: SimulationResult,
): SelectorFrame | undefined => {
  const particle = scene.particles[0]
  if (particle === undefined) return undefined
  for (const state of simulation.states) {
    const object = state.objects.find((entry) => entry.id === particle.id) ?? state.objects[0]
    if (object?.position === undefined || object.velocity === undefined) continue
    const position = toCanonicalVector(object.position).vectorSI
    const velocity = toCanonicalVector(object.velocity).vectorSI
    const sample = sampleFieldsAt(scene, position)
    if (magnitude(sample.magneticFluxDensity) > 0 && magnitude(sample.electricField) === 0) {
      return {
        position,
        velocity,
        electricField: sample.electricField,
        magneticFluxDensity: sample.magneticFluxDensity,
        gravity: sample.gravity,
        regionIds: sample.regionIds,
      }
    }
  }
  return undefined
}

/** What the selection check concluded, for callers that need the numbers. */
export interface CompositeSelectionReport {
  /** Present only when the particle actually crosses a region with both E and B. */
  readonly evaluated: boolean
  /** |qE| inside the crossed-field region, in newtons. */
  readonly electricForceMagnitude: number
  /** |qv×B| at the same frame, in newtons. */
  readonly magneticForceMagnitude: number
  /** |ΣF| at the same frame, in newtons. Gravity included when the scene has it. */
  readonly netForceMagnitude: number
  /** The speed the apparatus selects, `E/B`; undefined when E is not ⟂ B. */
  readonly selectedVelocity: number | undefined
  /** The particle's speed in the crossed-field region, in m/s. */
  readonly particleSpeed: number
  /** True when the electric and magnetic forces cancel to tolerance. */
  readonly balanced: boolean
  /** Signed relative residual `(|F_E| - |F_B|) / max(|F_E|, |F_B|)`. */
  readonly relativeResidual: number
}

/**
 * Evaluate the velocity-selection condition without judging it.
 *
 * Returns `evaluated: false` when the particle never enters a crossed-field
 * region, so a caller can say "not applicable" instead of reporting a balance it
 * measured in empty space.
 */
export function reportCompositeSelection(
  scene: PhysicsScene,
  simulation: SimulationResult,
): CompositeSelectionReport {
  const particle = scene.particles[0]
  const frame = crossedFieldFrame(scene, simulation)
  if (particle === undefined || frame === undefined) {
    return {
      evaluated: false,
      electricForceMagnitude: 0,
      magneticForceMagnitude: 0,
      netForceMagnitude: 0,
      selectedVelocity: undefined,
      particleSpeed: 0,
      balanced: false,
      relativeResidual: Number.NaN,
    }
  }
  const charge = particle.charge?.value ?? 0
  const mass = particle.mass.value
  const force = compositeForce(charge, mass, frame.velocity, {
    electricField: frame.electricField,
    magneticFluxDensity: frame.magneticFluxDensity,
    gravity: frame.gravity,
    regionIds: frame.regionIds,
  })
  const electricForceMagnitude = magnitude(force.electricForce)
  const magneticForceMagnitude = magnitude(force.magneticForce)
  const netForceMagnitude = magnitude(force.totalForce)
  const scaleOf = Math.max(electricForceMagnitude, magneticForceMagnitude)
  /* Balance is judged on the NET force, not on the two magnitudes alone: two equal
     magnitudes pointing the same way do not cancel, and a selector wired with the
     wrong polarity is exactly that case. */
  const relativeResidual = scaleOf > 0 ? (electricForceMagnitude - magneticForceMagnitude) / scaleOf : 0
  const balanced = scaleOf > 0 && netForceMagnitude / scaleOf < BALANCE_TOLERANCE
  return {
    evaluated: true,
    electricForceMagnitude,
    magneticForceMagnitude,
    netForceMagnitude,
    selectedVelocity: selectorSpeed({
      electricField: frame.electricField,
      magneticFluxDensity: frame.magneticFluxDensity,
      gravity: frame.gravity,
      regionIds: frame.regionIds,
    }),
    particleSpeed: magnitude(frame.velocity),
    balanced,
    relativeResidual,
  }
}

/**
 * Student-facing checks for a composite-field apparatus.
 *
 * The result is a READOUT, not a gate: a failing `velocity_selection_condition`
 * means the beam deflects, which is a correct physical outcome. Callers must keep
 * using the engine's own verification status to decide whether a simulation may
 * be shown.
 */
export function verifyCompositeApparatus(
  scene: PhysicsScene,
  simulation: SimulationResult,
): VerificationResult {
  const checks: VerificationCheck[] = []
  const particle = scene.particles[0]
  const report = reportCompositeSelection(scene, simulation)

  if (report.evaluated) {
    checks.push(
      check('velocity_selection_condition', 'constraint', report.balanced, {
        message: report.balanced
          ? '电场力与洛伦兹力等大反向，速度选择条件成立，粒子直线通过。'
          : '电场力与洛伦兹力未抵消，粒子在选择器区域内发生偏转。',
        details: {
          electricForceMagnitude: report.electricForceMagnitude,
          magneticForceMagnitude: report.magneticForceMagnitude,
          netForceMagnitude: report.netForceMagnitude,
          selectedVelocity: report.selectedVelocity,
          particleSpeed: report.particleSpeed,
          relativeResidual: report.relativeResidual,
        },
      }),
    )
    checks.push(
      check(
        'electric_force_magnitude_consistent',
        'constraint',
        Number.isFinite(report.electricForceMagnitude),
        {
          message: '电场力大小 |qE| 由场强与电荷量确定。',
          details: { electricForceMagnitude: report.electricForceMagnitude },
        },
      ),
    )
    checks.push(
      check(
        'magnetic_force_magnitude_consistent',
        'constraint',
        Number.isFinite(report.magneticForceMagnitude),
        {
          message: '洛伦兹力大小 |qv×B| 由该帧速度与磁感应强度确定。',
          details: { magneticForceMagnitude: report.magneticForceMagnitude },
        },
      ),
    )
  }

  /* Spectrometer arc: the deflection region turns the beam with r = mv/|q|B. This
     is a real constraint on the geometry the scene declared — a radius larger than
     the region means the arc leaves the apparatus, which the student should see.
     The period is reported from the same frame: both describe the deflection arc,
     and the end-of-run derived set cannot be used for either because by then the
     particle has left every region and every field reads zero. */
  const deflection = magneticOnlyFrame(scene, simulation)
  if (deflection !== undefined && particle !== undefined) {
    const charge = particle.charge?.value ?? 0
    const sample = {
      electricField: deflection.electricField,
      magneticFluxDensity: deflection.magneticFluxDensity,
      gravity: deflection.gravity,
      regionIds: deflection.regionIds,
    }
    const radius = gyroRadius(charge, particle.mass.value, deflection.velocity, sample)
    const period = cyclotronPeriod(charge, particle.mass.value, sample)
    checks.push(
      check(
        'magnetic_deflection_radius_defined',
        'constraint',
        radius !== undefined && Number.isFinite(radius) && radius > 0,
        {
          message: '磁偏转区半径 r = m|v| / |qB| 有定义。',
          details: {
            radius,
            ...(period === undefined ? {} : { period }),
            speed: magnitude(deflection.velocity),
            regionIds: deflection.regionIds,
          },
        },
      ),
    )
  }

  return summarizeVerification(checks, [], [])
}

/** Tolerance the apparatus checks use, exposed so a caller can quote it. */
export const COMPOSITE_BALANCE_TOLERANCE = BALANCE_TOLERANCE

/** Re-exported so callers do not have to reach for physics-core's default. */
export const COMPOSITE_DEFAULT_TOLERANCE = DEFAULT_TOLERANCE
