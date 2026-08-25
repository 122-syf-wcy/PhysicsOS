/**
 * Physical-time display units.
 *
 * Charged-particle runs live at nanosecond–microsecond scale. Raw notation hides
 * the physics from a student: `1.00e-5s` reads as machine output, and rounding to
 * `0.00 s` announces the wrong instant outright. Times shown to students are
 * therefore expressed in the engineering unit (s / ms / µs / ns / ps) on which
 * the RUN WINDOW reads as a number ≥ 1, so a 10 µs run shows a clock that counts
 * `0.00 µs → 10.00 µs`.
 *
 * The unit is chosen from the window, not from each instant, so the moving clock
 * and its total share one unit and never flip mid-playback.
 */

export interface TimeScale {
  readonly unit: 's' | 'ms' | 'µs' | 'ns' | 'ps'
  /** Multiply seconds by this to express them in `unit`. */
  readonly factor: number
}

const SCALES: readonly TimeScale[] = [
  { unit: 's', factor: 1 },
  { unit: 'ms', factor: 1e3 },
  { unit: 'µs', factor: 1e6 },
  { unit: 'ns', factor: 1e9 },
  { unit: 'ps', factor: 1e12 },
]

const SECONDS: TimeScale = SCALES[0]!

/** Chinese unit names, for screen-reader announcements. */
const UNIT_ARIA: Readonly<Record<TimeScale['unit'], string>> = {
  s: '秒',
  ms: '毫秒',
  'µs': '微秒',
  ns: '纳秒',
  ps: '皮秒',
}

/**
 * The display scale for a run window of physical seconds.
 *
 * Windows of 0.1 s and above stay in seconds — students think of a projectile
 * flight as `0.45 s`, not `450 ms`. Below that, the largest unit on which the
 * window reads ≥ 1 wins; a zero or non-finite window falls back to seconds.
 */
export const timeScaleOf = (windowSeconds: number): TimeScale => {
  const magnitude = Math.abs(windowSeconds)
  if (!Number.isFinite(magnitude) || magnitude === 0 || magnitude >= 0.1) return SECONDS
  return SCALES.find(scale => magnitude * scale.factor >= 1) ?? SCALES.at(-1)!
}

/** `3.75 µs` — an instant expressed on an already-chosen scale. */
export const formatTimeIn = (seconds: number, scale: TimeScale): string => {
  const value = Number.isFinite(seconds) ? seconds * scale.factor : 0
  /* Two decimals up to 100, one above — `328.0 ns` instead of `328.00 ns`. */
  return `${Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2)} ${scale.unit}`
}

/**
 * Window scale, unless it would collapse a genuinely nonzero instant to
 * `0.00` — then the instant's own unit wins ("2.40 ns" inside a 10 µs run).
 * Announcing a rounded zero is the exact failure this module exists to stop.
 */
const scaleFor = (seconds: number, windowSeconds: number): TimeScale => {
  const scale = timeScaleOf(windowSeconds)
  return seconds !== 0 && Math.abs(seconds) * scale.factor < 0.005
    ? timeScaleOf(seconds)
    : scale
}

/** An instant expressed on the scale of its own run window. */
export const formatTimeAt = (seconds: number, windowSeconds: number): string =>
  formatTimeIn(seconds, scaleFor(seconds, windowSeconds))

/**
 * Screen-reader text for an instant: same number, Chinese unit name, so an
 * assistive announcement says 「1.20 微秒」 rather than spelling out "µs".
 */
export const timeAriaText = (seconds: number, windowSeconds: number): string => {
  const scale = scaleFor(seconds, windowSeconds)
  const [value] = formatTimeIn(seconds, scale).split(' ')
  return `${value} ${UNIT_ARIA[scale.unit]}`
}
