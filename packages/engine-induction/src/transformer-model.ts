import { canonicalValue } from '@physicsos/physics-units'
import {
  transformerBenchesOf,
  type PhysicsScene,
  type TransformerBench,
} from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of the ideal transformer: the driven winding, the output
 * winding, and the two facts the source states about the primary.
 *
 * The flux rate is NOT stored — it follows from U₁ = N₁·dΦ/dt, which is the one
 * equation the whole machine rests on. Storing it as well would be a second
 * statement of the same fact, free to disagree with the first.
 */
export interface ResolvedTransformerModel {
  readonly benchId: string
  /** Voltage across the primary (V), > 0. */
  readonly primaryVoltage: number
  /** Current into the primary (A), >= 0. */
  readonly primaryCurrent: number
  /** Turns on the driven winding, > 0. */
  readonly primaryTurns: number
  /** Turns on the output winding, > 0. */
  readonly secondaryTurns: number
  /** dΦ/dt the primary voltage implies (Wb/s). */
  readonly fluxRate: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const benchOf = (bench: TransformerBench): ResolvedTransformerModel => {
  const primaryVoltage = positiveOrThrow(
    canonicalValue(bench.primaryVoltage),
    'TRANSFORMER_VOLTAGE',
    `Transformer bench "${bench.id}" primary voltage must be finite and > 0.`,
  )
  const current = canonicalValue(bench.primaryCurrent)
  if (!Number.isFinite(current) || current < 0) {
    throw modelError(
      'TRANSFORMER_CURRENT',
      `Transformer bench "${bench.id}" primary current must be finite and >= 0.`,
    )
  }
  const primaryTurns = positiveOrThrow(
    canonicalValue(bench.primaryTurns),
    'TRANSFORMER_PRIMARY_TURNS',
    `Transformer bench "${bench.id}" primary turns must be finite and > 0.`,
  )
  return {
    benchId: bench.id,
    primaryVoltage,
    primaryCurrent: current,
    primaryTurns,
    secondaryTurns: positiveOrThrow(
      canonicalValue(bench.secondaryTurns),
      'TRANSFORMER_SECONDARY_TURNS',
      `Transformer bench "${bench.id}" secondary turns must be finite and > 0.`,
    ),
    fluxRate: primaryVoltage / primaryTurns,
  }
}

/**
 * Resolve the scene's transformer into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a rig the model cannot honour.
 */
export const resolveTransformerModel = (scene: PhysicsScene): ResolvedTransformerModel => {
  const benches = transformerBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError(
      'TRANSFORMER_SINGLE_BENCH',
      'Transformer Engine requires exactly one transformer bench.',
    )
  }
  return benchOf(bench)
}
