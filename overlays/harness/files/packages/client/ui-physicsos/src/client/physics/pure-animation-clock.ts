/** Browser/Worker-neutral playback conversions. These never schedule a UI clock. */

/** Shared by both player surfaces and the contributed experiment protocol.
 * 0.01x stretches a 40 Hz wave cycle to 2.5 seconds for close observation. */
export const PLAYBACK_RATES: readonly number[] = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2]

/** One magnetic orbit at 1x is presented over this many wall-clock seconds. */
export const MAGNETIC_CYCLE_WALL_SECONDS = 5

/** Fraction of the visible window each 单步 / step-forward advances. Shared by
    the Lab timeline and Question Space step so the two playback systems cannot
    drift apart. */
export const STEP_FRACTION = 0.1

/** Convert display time into the microscopic physical time consumed by the engine.
 * @param wallSeconds - elapsed wall-clock seconds from the frame clock.
 * @param periodSeconds - physical seconds covered by one visible window.
 * @returns physical seconds to advance; clamps negatives/non-finite to 0.
 */
export const magneticPhysicalDelta = (wallSeconds: number, periodSeconds: number): number =>
  periodSeconds > 0 && Number.isFinite(wallSeconds)
    ? Math.max(0, wallSeconds) * periodSeconds / MAGNETIC_CYCLE_WALL_SECONDS
    : 0

/** A charged-particle run lasts nanoseconds–microseconds of physical time; at 1x
    the whole visible window is presented over this many wall-clock seconds. */
export const MICRO_WINDOW_WALL_SECONDS = 8

/** Convert a wall-clock frame delta into the microscopic physical time consumed
    by the engine, pacing the full window over MICRO_WINDOW_WALL_SECONDS. This
    scales presentation only — the scene clock still advances real physical time,
    so raw wall seconds can never swallow the whole run in a single frame.
 * @param wallSeconds - elapsed wall-clock seconds from the frame clock.
 * @param windowSeconds - physical seconds covered by the visible window.
 * @returns physical seconds to advance; clamps negatives/non-finite to 0.
 */
export const microWindowPhysicalDelta = (wallSeconds: number, windowSeconds: number): number =>
  windowSeconds > 0 && Number.isFinite(wallSeconds)
    ? Math.max(0, wallSeconds) * windowSeconds / MICRO_WINDOW_WALL_SECONDS
    : 0

/** Find the closest monotonically sampled state without scanning the whole trajectory.
 * @param states - samples sorted by `time.value`.
 * @param time - the target physical time.
 * @returns the index of the nearest sample (0 for an empty list).
 */
export const nearestTimedStateIndex = (
  states: readonly { readonly time: { readonly value: number } }[],
  time: number,
): number => {
  if (states.length === 0) return 0
  let low = 0
  let high = states.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((states[middle]?.time.value ?? Number.POSITIVE_INFINITY) < time) low = middle + 1
    else high = middle
  }
  const upper = Math.min(low, states.length - 1)
  const lower = Math.max(0, upper - 1)
  return Math.abs((states[lower]?.time.value ?? 0) - time)
    <= Math.abs((states[upper]?.time.value ?? 0) - time)
    ? lower
    : upper
}
