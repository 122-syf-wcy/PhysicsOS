/**
 * Timeline events → canvas bursts.
 *
 * The workspace already publishes every physical event (launch, apex, impact,
 * field enter/exit, plate hit) as a {@link TimelineEvent} with a scene time.
 * This hook watches the playback clock cross those times and emits a short-lived
 * {@link CanvasEffect} anchored where the event happened, so a collision is
 * SEEN on the canvas the instant it happens rather than only read off the
 * timeline.
 *
 * Anchoring is presentation of facts the runtime already stated, in this order:
 *   1. a key point whose id matches the event (mechanics 起点 / 最高点 / 落地点);
 *   2. the live moving object of the frame (live body, particle, probe, pulse,
 *      block, rod, marked wave particle);
 *   3. nothing — an event with no visible anchor draws no burst.
 *
 * Seeks and scrubs (large jumps) never fire: only forward motion across an event
 * inside one animation frame counts as "it just happened".
 */

import { useEffect, useRef, useState } from 'react'
import type { CanvasEffect } from './PhysicsCanvas.tsx'
import type {
  PlaybackClock,
  ScenePoint,
  SceneVisualModel,
  TimelineEvent,
} from './scene-visual-model.ts'

/** How long a burst stays mounted; matches the longest CSS animation. */
const EFFECT_LIFETIME_MS = 1000

/** A jump longer than this fraction of the run window is a seek, not playback. */
const SEEK_FRACTION = 0.2

const kindOf = (event: TimelineEvent): CanvasEffect['kind'] => {
  switch (event.kind) {
    case 'impact':
    case 'plate-impact':
      return 'impact'
    case 'enter':
    case 'exit':
      return 'boundary'
    default:
      return 'mark'
  }
}

/**
 * The moving thing in this frame, whichever domain it belongs to.
 * @returns the scene point.
 * @param view - the visual model.
 */
export const liveAnchorOf = (view: SceneVisualModel): ScenePoint | undefined => {
  const liveBody = view.bodies.find(body => body.live === true) ?? view.bodies[0]
  return liveBody?.at
    ?? view.particles[0]?.at
    ?? view.probe?.at
    ?? view.acousticPulse?.at
    ?? view.fluidBlock?.at
    ?? view.inductionBar?.at
    ?? view.waveMarker?.at
    ?? view.leverHangers?.[0]?.massAt
}

/**
 * Where an event should burst on this frame, if anywhere.
 * @returns the scene point.
 * @param view - the visual model.
 * @param event - the event.
 */
export const anchorForEvent = (event: TimelineEvent, view: SceneVisualModel): ScenePoint | undefined =>
  view.keyPoints.find(point => point.id === event.id)?.at ?? liveAnchorOf(view)

/**
 * Events whose time was crossed between two consecutive frames, in time order.
 * @param previous - clock time of the last frame.
 * @param current - clock time of this frame.
 * @param total - run window, for the seek guard.
 * @returns the crossed events list.
 * @param events - the events.
 */
export const crossedEvents = (
  events: readonly TimelineEvent[],
  previous: number,
  current: number,
  total: number,
): readonly TimelineEvent[] => {
  if (current <= previous) return []
  if (total > 0 && current - previous > total * SEEK_FRACTION) return []
  return events
    .filter(event => event.time > previous && event.time <= current)
    .sort((a, b) => a.time - b.time)
}

/**
 * Track the clock and publish the bursts to draw this frame.
 * @param clock - the playback clock of the current snapshot.
 * @param events - the snapshot's timeline events.
 * @param view - the snapshot's visual frame, for anchoring.
 * @returns the use event effects list.
 */
export function useEventEffects(
  clock: PlaybackClock,
  events: readonly TimelineEvent[],
  view: SceneVisualModel,
): readonly CanvasEffect[] {
  const [effects, setEffects] = useState<readonly CanvasEffect[]>([])
  const previousTime = useRef(clock.time)
  const serial = useRef(0)
  /* Expiry timers outlive the frame that started them, so they are tracked
     here and only cancelled on unmount — a per-frame cleanup would cancel
     every burst before it had a chance to finish. */
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const previous = previousTime.current
    previousTime.current = clock.time
    const fired = crossedEvents(events, previous, clock.time, clock.total)
    if (fired.length === 0) return
    const next: CanvasEffect[] = []
    for (const event of fired) {
      const at = anchorForEvent(event, view)
      if (at === undefined) continue
      serial.current += 1
      next.push({ key: `${event.id}-${String(serial.current)}`, kind: kindOf(event), at })
    }
    if (next.length === 0) return
    setEffects(current => [...current, ...next])
    const keys = new Set(next.map(effect => effect.key))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setEffects(current => current.filter(effect => !keys.has(effect.key)))
    }, EFFECT_LIFETIME_MS)
    timers.current.add(timer)
  }, [clock.time, clock.total, events, view])

  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current.clear()
  }, [])

  return effects
}
