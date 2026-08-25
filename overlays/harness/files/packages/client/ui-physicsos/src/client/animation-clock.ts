import { useEffect, useRef } from 'react'

const MAX_FRAME_DELTA_SECONDS = 0.1

/** One magnetic orbit at 1x is presented over this many wall-clock seconds. */
export const MAGNETIC_CYCLE_WALL_SECONDS = 5

/** Fraction of the visible window each 单步 / step-forward advances. Shared by
    the Lab timeline and Question Space step so the two playback systems cannot
    drift apart. */
export const STEP_FRACTION = 0.1

/** Convert display time into the microscopic physical time consumed by the engine. */
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
    so raw wall seconds can never swallow the whole run in a single frame. */
export const microWindowPhysicalDelta = (wallSeconds: number, windowSeconds: number): number =>
  windowSeconds > 0 && Number.isFinite(wallSeconds)
    ? Math.max(0, wallSeconds) * windowSeconds / MICRO_WINDOW_WALL_SECONDS
    : 0

/** Find the closest monotonically sampled state without scanning the whole trajectory. */
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

/** Drive one UI update per browser paint using actual elapsed wall-clock time. */
export function useAnimationClock(
  running: boolean,
  onFrame: (elapsedSeconds: number) => void,
): void {
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  useEffect(() => {
    if (!running) return
    let frameId = 0
    let previousTime: number | undefined
    let pageVisible = !document.hidden
    const resetElapsed = () => {
      pageVisible = !document.hidden
      previousTime = undefined
    }
    const frame = (time: number) => {
      // RAF can still deliver a queued callback as a document is being hidden.
      // Do not advance the simulation until a visible frame establishes a new baseline.
      if (!pageVisible || document.hidden) {
        pageVisible = false
        previousTime = undefined
      } else if (previousTime !== undefined) {
        const elapsedSeconds = (time - previousTime) / 1000
        if (Number.isFinite(elapsedSeconds)) {
          onFrameRef.current(Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, elapsedSeconds)))
        }
      }
      if (pageVisible && Number.isFinite(time)) previousTime = time
      frameId = window.requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', resetElapsed)
    frameId = window.requestAnimationFrame(frame)
    return () => {
      document.removeEventListener('visibilitychange', resetElapsed)
      window.cancelAnimationFrame(frameId)
    }
  }, [running])
}
