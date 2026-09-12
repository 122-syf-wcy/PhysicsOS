/**
 * Shared helpers for the visual bridges.
 *
 * Both helpers only SHAPE facts the engine already published — a field
 * magnitude and an equally-time-sampled path with its playhead — into the
 * presentation contract the renderers consume. Neither computes physics.
 */
import type { ScenePoint, SceneVisualModel, TrajectoryVisual } from './scene-visual-model.ts'

/**
 * Density ceiling for a field texture. One texture unit of "strongest" may at
 * most pack 2.5× more lattice lines into the same box — beyond that the glyph
 * grid stops reading as separate marks and becomes a grey wash.
 */
export const LATTICE_DENSITY_MAX = 2.5

/**
 * Lattice spacing as a monotonic function of field magnitude.
 *
 * `base / k` with `k = 1 + log10(1 + magnitude / reference)` clamped to
 * `LATTICE_DENSITY_MAX`: a stronger field draws a denser lattice, a weaker one
 * sparser, and dragging E or B visibly re-packs the texture. `reference` is a
 * per-domain typical magnitude so the logarithm works on a dimensionless ratio.
 * Non-finite or zero magnitudes degrade to the base (sparsest) spacing — the
 * function never divides by zero and never returns NaN for finite inputs.
 *
 * The texture is a RELATIVE reading aid (see the readout line every caller
 * adds); the quantitative |E| / |B| stay in the numbers, never in the ink.
 */
export const latticeSpacingOf = (base: number, magnitude: number, reference: number): number => {
  if (!Number.isFinite(base) || base <= 0) return base
  return base / latticeDensityFactor(magnitude, reference)
}

/** The density factor itself, clamped into [1, LATTICE_DENSITY_MAX]. */
export const latticeDensityFactor = (magnitude: number, reference: number): number => {
  const safe = Number.isFinite(magnitude) && magnitude > 0 ? magnitude : 0
  const ratio = Number.isFinite(reference) && reference > 0 ? safe / reference : 0
  return Math.min(LATTICE_DENSITY_MAX, 1 + Math.log10(1 + ratio))
}

/**
 * Streamline count radiating from a point charge, banded on |q|: a µC-class
 * source earns the full 18-line picture, an nC source 12, anything smaller 6.
 * The banding keeps the "bigger charge, denser field lines" statement honest
 * without letting a weak source crowd the canvas.
 */
export const radialCountForCharge = (chargeCoulombs: number): 6 | 12 | 18 => {
  const magnitude = Number.isFinite(chargeCoulombs) ? Math.abs(chargeCoulombs) : 0
  if (magnitude >= 1e-6) return 18
  if (magnitude >= 1e-9) return 12
  return 6
}

/**
 * Split an equally-time-sampled path at the engine's playhead.
 *
 * The canvas rule is "travelled = solid, future = dashed (predicted)": the
 * renderer may not draw the whole future solution as a solid line at t = 0.
 * The split follows the sample TIMES the engine published (both observation
 * points and simulation states carry them), so the cut is at the frame the
 * runtime is playing, never at a renderer-guessed fraction.
 *
 * Both pieces keep the SAME id: "this frame draws a trajectory" stays true
 * whatever the playhead, so Agent gates and highlight aliases are unaffected.
 * The pieces never overlap, so concatenated they remain parallel to the
 * runtime's `trajectoryTimes` (prefix = history), which keeps hover, seek and
 * strobe sampling intact.
 */
export const splitTrajectoryAtTime = (
  id: string,
  points: readonly ScenePoint[],
  times: readonly number[],
  now: number,
): SceneVisualModel['trajectories'] => {
  if (points.length < 2) return []
  if (times.length !== points.length || !Number.isFinite(now)) {
    /* No reliable clock for this sample stream — keep the old honest shape:
       one solid path rather than inventing a split point. */
    return [{ id, kind: 'history', points }]
  }
  let travelled = 0
  while (travelled < times.length && (times[travelled] as number) <= now) travelled += 1
  const pieces: TrajectoryVisual[] = []
  if (travelled > 0) pieces.push({ id, kind: 'history', points: points.slice(0, travelled) })
  if (travelled < points.length) pieces.push({ id, kind: 'predicted', points: points.slice(travelled) })
  return pieces
}
