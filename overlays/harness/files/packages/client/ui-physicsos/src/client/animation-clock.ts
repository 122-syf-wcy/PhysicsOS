import { useEffect, useRef } from 'react'

const MAX_FRAME_DELTA_SECONDS = 0.1

export {
  PLAYBACK_RATES,
  MAGNETIC_CYCLE_WALL_SECONDS,
  STEP_FRACTION,
  magneticPhysicalDelta,
  MICRO_WINDOW_WALL_SECONDS,
  microWindowPhysicalDelta,
  nearestTimedStateIndex,
} from './physics/pure-animation-clock.ts'

/** Drive one UI update per browser paint using actual elapsed wall-clock time.
 * @param running - false pauses the loop without unmounting it.
 * @param onFrame - called each paint with the clamped frame delta in seconds.
 */
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
