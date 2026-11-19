/** One magnetic orbit at 1x is presented over this many wall-clock seconds. */
export const MAGNETIC_CYCLE_WALL_SECONDS = 5

/** Pure display-to-physical time mapping shared by the UI and headless runtime. */
export const magneticPhysicalDelta = (wallSeconds: number, periodSeconds: number): number =>
  periodSeconds > 0 && Number.isFinite(wallSeconds)
    ? Math.max(0, wallSeconds) * periodSeconds / MAGNETIC_CYCLE_WALL_SECONDS
    : 0
