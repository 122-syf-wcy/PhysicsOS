import type { SimulationOptions } from '@physicsos/physics-core'

/**
 * Trajectory storage / sampling contract (docs/01-DEVELOPMENT-GUIDE #85,
 * docs/02-ENGINEERING-STANDARDS #25/#124).
 *
 * PhysicsOS never stores every solver step: solver timestep, storage sample
 * rate, render sample rate and chart sample rate are deliberately distinct.
 * These helpers give every engine a single, bounded answer for how many states
 * to store, and every observation a bounded way to decimate them for the
 * renderer — while keeping the first and last points (the launch and the impact
 * which carry physical meaning) under all circumstances.
 *
 * Defaults are chosen so that existing scenes keep their current behaviour:
 * only a caller that explicitly sets `SimulationOptions.outputSampleRate` gets
 * a different (and still capped) storage density.
 */

/** Storage never grows past this many states per SimulationResult, whatever
 * a caller asks for — the #124 "no unbounded trajectory" bound. */
export const MAX_TRAJECTORY_STORAGE_SAMPLES = 1024

/** Observation-side render budget: trajectory points are decimated to at most
 * this many before reaching the renderer, so draw cost is bounded regardless
 * of how densely the engine stored states. */
export const MAX_TRAJECTORY_RENDER_POINTS = 512

/** Minimum meaningful number of states / points (start and end). */
const MIN_TRAJECTORY_SAMPLES = 2

const clampToRange = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(Math.floor(value), max))

/**
 * Number of states an engine should store for one simulation.
 *
 * `SimulationOptions.outputSampleRate` is the storage sample count the caller
 * asks for; when absent the engine keeps its own fallback (its existing
 * trajectory segment constant + 1). Either way the result is clamped to
 * [2, MAX_TRAJECTORY_STORAGE_SAMPLES] so a hostile or accidental huge request
 * cannot allocate an unbounded state array.
 */
export const trajectoryStorageSampleCount = (
  options: SimulationOptions | undefined,
  fallback: number,
): number => {
  const requested = options?.outputSampleRate
  if (requested === undefined || !Number.isFinite(requested)) {
    return clampToRange(fallback, MIN_TRAJECTORY_SAMPLES, MAX_TRAJECTORY_STORAGE_SAMPLES)
  }
  return clampToRange(requested, MIN_TRAJECTORY_SAMPLES, MAX_TRAJECTORY_STORAGE_SAMPLES)
}

/**
 * Evenly spaced sample times across [startTime, endTime], endpoints included.
 * Mirrors the fixed-rate arrays the engines already built, now parameterised
 * by the storage sample count.
 */
export const trajectorySampleTimes = (
  startTime: number,
  endTime: number,
  sampleCount: number,
): number[] => {
  const count = clampToRange(sampleCount, MIN_TRAJECTORY_SAMPLES, MAX_TRAJECTORY_STORAGE_SAMPLES)
  return Array.from(
    { length: count },
    (_, index) => startTime + ((endTime - startTime) * index) / (count - 1),
  )
}

/**
 * Decimate an ordered point list to at most `maxPoints`, always keeping the
 * first and last entries. `maxPoints === 0` returns the input unchanged. The
 * selection is by evenly spaced index (it never invents values), so the drawn
 * polyline keeps its shape while the point count stays bounded.
 *
 * `protect` (optional) lists indices that MUST survive decimation — e.g. the
 * composite engine's phase-boundary states, whose kink would otherwise be
 * dropped between two evenly spaced picks and drawn as a straight chord across
 * a region crossing. Protected points are taken first; the remaining budget is
 * filled with evenly spaced picks among the rest. When the protected points
 * alone exceed the budget (pathological), the protected set itself is uniformly
 * decimated to fit — the bound is never violated and no values are invented.
 * Callers that pass no `protect` get the exact original selection.
 */
export const decimateTrajectoryPoints = <T>(
  points: readonly T[],
  maxPoints: number,
  protect?: ReadonlySet<number> | readonly number[],
): readonly T[] => {
  const count = points.length
  if (maxPoints <= 0 || count <= maxPoints) return points
  const budget = Math.max(2, Math.floor(maxPoints))

  /* Normalise the protect argument: keep only integer, in-range indices. */
  const protectedIndices = new Set<number>()
  if (protect !== undefined) {
    for (const raw of protect) {
      const index = Math.floor(raw)
      if (index >= 0 && index < count) protectedIndices.add(index)
    }
  }
  protectedIndices.add(0)
  protectedIndices.add(count - 1)

  /* Fast path: nothing extra to protect — byte-identical to the pre-protect
     selection so existing callers see zero behaviour change. */
  if (protectedIndices.size === 2) {
    const keep = new Set<number>([0, count - 1])
    for (let i = 1; i < budget - 1; i += 1) {
      keep.add(Math.round((i * (count - 1)) / (budget - 1)))
    }
    return points.filter((_, index) => keep.has(index))
  }

  /* Protected points alone exceed the budget: uniformly decimate the protected
     set to fit, still never inventing values. */
  if (protectedIndices.size > budget) {
    const ordered = [...protectedIndices].sort((a, b) => a - b)
    const keep = new Set<number>()
    for (let i = 0; i < budget; i += 1) {
      keep.add(ordered[Math.round((i * (ordered.length - 1)) / (budget - 1))]!)
    }
    return points.filter((_, index) => keep.has(index))
  }

  /* Protected points fit: fill the remaining budget with evenly spaced picks
     among the unprotected indices. */
  const remaining = budget - protectedIndices.size
  if (remaining > 0) {
    const free: number[] = []
    for (let i = 0; i < count; i += 1) if (!protectedIndices.has(i)) free.push(i)
    if (free.length > 0) {
      for (let i = 0; i < remaining; i += 1) {
        protectedIndices.add(
          free[Math.min(free.length - 1, Math.round((i * (free.length - 1)) / Math.max(1, remaining - 1)))]!,
        )
      }
    }
  }

  return points.filter((_, index) => protectedIndices.has(index))
}

/**
 * Split a trajectory point list into chunks of at most `chunkSize` points, in
 * order — the #124 chunking primitive for consumers that lazy-load long
 * trajectories. Returns a single chunk when the list fits.
 */
export const chunkTrajectoryPoints = <T>(
  points: readonly T[],
  chunkSize = 256,
): readonly (readonly T[])[] => {
  const size = Math.max(1, Math.floor(chunkSize))
  const chunks: T[][] = []
  for (let offset = 0; offset < points.length; offset += size) {
    chunks.push(points.slice(offset, offset + size))
  }
  return chunks
}