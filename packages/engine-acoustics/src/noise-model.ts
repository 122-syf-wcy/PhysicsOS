import { canonicalValue } from '@physicsos/physics-units'
import { noiseBenchesOf, type NoiseBench, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical view of the noise rig: how loud the source is, how far the listener
 * stands, and what the barrier takes out.
 *
 * Levels are in decibels, which are logarithmic and therefore dimensionless; the
 * distance is the only dimensional quantity here, which is itself the point —
 * the whole subject is what a length does to a level.
 */
export interface ResolvedNoiseModel {
  readonly benchId: string
  /** Sound power level of the source (dB). */
  readonly soundPowerLevel: number
  /** Distance from the source to the listener (m), > 0. */
  readonly distance: number
  /** Insertion loss of the barrier (dB), >= 0. */
  readonly barrierAttenuation: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const benchOf = (bench: NoiseBench): ResolvedNoiseModel => {
  const powerLevel = canonicalValue(bench.soundPowerLevel)
  if (!Number.isFinite(powerLevel)) {
    throw modelError(
      'NOISE_POWER_LEVEL',
      `Noise bench "${bench.id}" sound power level must be finite.`,
    )
  }
  const attenuation = canonicalValue(bench.barrierAttenuation)
  if (!Number.isFinite(attenuation) || attenuation < 0) {
    throw modelError(
      'NOISE_BARRIER',
      `Noise bench "${bench.id}" barrier attenuation must be finite and >= 0.`,
    )
  }
  const distance = canonicalValue(bench.distance)
  if (!Number.isFinite(distance) || distance <= 0) {
    throw modelError('NOISE_DISTANCE', `Noise bench "${bench.id}" distance must be finite and > 0.`)
  }
  return {
    benchId: bench.id,
    soundPowerLevel: powerLevel,
    distance,
    barrierAttenuation: attenuation,
  }
}

/**
 * Resolve the scene's noise rig. Throws `PhysicsOSError` on structural
 * violations; `canHandle` converts those into model-support failures instead of
 * solving a rig the model cannot honour.
 */
export const resolveNoiseModel = (scene: PhysicsScene): ResolvedNoiseModel => {
  const benches = noiseBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('NOISE_SINGLE_BENCH', 'Noise Engine requires exactly one noise bench.')
  }
  return benchOf(bench)
}
