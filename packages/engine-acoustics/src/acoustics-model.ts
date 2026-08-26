import { canonicalValue } from '@physicsos/physics-units'
import { acousticBenchesOf, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of a single-range echo setup. The pulse leaves the
 * source at t = 0 travelling towards +x; the reflecting wall stands ahead at
 * wallDistance = reflectorX − sourceX > 0.
 */
export interface ResolvedAcousticModel {
  readonly benchId: string
  readonly sourceId: string
  readonly reflectorId: string
  /** Signed axis position of the source (m). */
  readonly sourceX: number
  /** Signed axis position of the reflecting face (m). */
  readonly reflectorX: number
  /** Source-to-wall distance d = reflectorX − sourceX (m), > 0. */
  readonly wallDistance: number
  /** Speed of sound in the medium (m/s), > 0. */
  readonly soundSpeed: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

/**
 * Resolve the scene's acoustic bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a scene the model cannot honour.
 */
export const resolveAcousticModel = (scene: PhysicsScene): ResolvedAcousticModel => {
  const benches = acousticBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('ACOUSTICS_SINGLE_BENCH', 'Acoustics Engine requires exactly one echo range.')
  }

  const sourceX = canonicalValue(bench.source.position)
  const reflectorX = canonicalValue(bench.reflector.position)
  const wallDistance = reflectorX - sourceX
  if (!Number.isFinite(wallDistance) || wallDistance <= 0) {
    throw modelError(
      'ACOUSTICS_REFLECTOR_BEHIND_SOURCE',
      'The reflecting wall must stand a finite distance ahead of the source (d > 0).',
    )
  }

  const soundSpeed = canonicalValue(bench.soundSpeed)
  if (!Number.isFinite(soundSpeed) || soundSpeed <= 0) {
    throw modelError('ACOUSTICS_SOUND_SPEED', 'Sound speed must be finite and > 0.')
  }

  return {
    benchId: bench.id,
    sourceId: bench.source.id,
    reflectorId: bench.reflector.id,
    sourceX,
    reflectorX,
    wallDistance,
    soundSpeed,
  }
}
