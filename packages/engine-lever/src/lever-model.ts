import { canonicalValue } from '@physicsos/physics-units'
import { leverBenchesOf, type LeverHanger, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of a class-1 lever. Two hangers sit on opposite sides of
 * the fulcrum; everything below is time-independent apparatus. Tilt is NOT
 * stored here — it is derived from the moment difference.
 */
export interface ResolvedLeverHanger {
  readonly hangerId: string
  readonly side: 'left' | 'right'
  /** Mass (kg), > 0. */
  readonly mass: number
  /** Arm length from the fulcrum (m), > 0. */
  readonly armLength: number
}

export interface ResolvedLeverModel {
  readonly leverId: string
  /** Total beam length (m), > 0. */
  readonly beamLength: number
  /** Gravitational field strength (m/s²), > 0. */
  readonly gravity: number
  readonly left: ResolvedLeverHanger
  readonly right: ResolvedLeverHanger
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const hangerOf = (hanger: LeverHanger, halfBeam: number): ResolvedLeverHanger => {
  const mass = positiveOrThrow(
    canonicalValue(hanger.mass),
    'LEVER_HANGER_MASS',
    `Hanger "${hanger.id}" mass must be finite and > 0.`,
  )
  const armLength = positiveOrThrow(
    canonicalValue(hanger.armLength),
    'LEVER_HANGER_ARM',
    `Hanger "${hanger.id}" arm must be finite and > 0.`,
  )
  if (armLength > halfBeam) {
    throw modelError(
      'LEVER_ARM_OFF_BEAM',
      `Hanger "${hanger.id}" arm must not exceed half the beam.`,
    )
  }
  return { hangerId: hanger.id, side: hanger.side, mass, armLength }
}

/**
 * Resolve the scene's lever into canonical SI numbers. Throws `PhysicsOSError`
 * on structural violations; `canHandle` converts those into model-support
 * failures instead of solving a scene the model cannot honour.
 */
export const resolveLeverModel = (scene: PhysicsScene): ResolvedLeverModel => {
  const benches = leverBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('LEVER_SINGLE_BENCH', 'Lever Engine requires exactly one lever.')
  }

  const beamLength = positiveOrThrow(
    canonicalValue(bench.beamLength),
    'LEVER_BEAM_LENGTH',
    'Beam length must be finite and > 0.',
  )
  const gravity = positiveOrThrow(
    canonicalValue(bench.gravity),
    'LEVER_GRAVITY',
    'Gravity must be finite and > 0.',
  )
  const left = bench.hangers.find((hanger) => hanger.side === 'left')
  const right = bench.hangers.find((hanger) => hanger.side === 'right')
  if (left === undefined || right === undefined || bench.hangers.length !== 2) {
    throw modelError(
      'LEVER_CLASS_ONE',
      'Lever Engine models a class-1 lever: exactly one hanger on each side of the fulcrum.',
    )
  }

  const halfBeam = beamLength / 2
  return {
    leverId: bench.id,
    beamLength,
    gravity,
    left: hangerOf(left, halfBeam),
    right: hangerOf(right, halfBeam),
  }
}
