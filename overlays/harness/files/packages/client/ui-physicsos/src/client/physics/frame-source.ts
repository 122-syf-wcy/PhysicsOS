/**
 * Frame source — the renderer's independent update channel.
 *
 * `#123 Canvas 性能` forbids React updating the whole component tree on every
 * animation frame: the renderer must have its own update loop and React must
 * only subscribe to low-frequency summaries / Selection / Panel Data / Status.
 *
 * A `FrameSource` is a tiny external store holding the latest physics frame.
 * The playback loop writes into it without touching React state; only the
 * canvas (the renderer) subscribes via `useFrameSource`, so per-frame updates
 * re-render the canvas alone instead of the whole workspace tree.
 */

import { useSyncExternalStore } from 'react'

/** External store holding the latest frame value. */
export interface FrameSource<T> {
  /** Current frame; stable between publishes. */
  get(this: void): T
  /** Publish a new frame; notifies every subscriber. */
  set(this: void, next: T): void
  /** Subscribe to future frames; returns an unsubscribe function. */
  subscribe(this: void, listener: () => void): () => void
}

/** Create an external frame store seeded with the first frame. */
export const createFrameSource = <T>(initial: T): FrameSource<T> => {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (next: T) => {
      if (next === current) return
      current = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Subscribe a component to the latest frame.
 *
 * Re-renders only when the frame value changes (React's built-in external-store
 * subscription), so a canvas fed by a frame source never re-renders on parent
 * state churn that does not touch its frame.
 */
export const useFrameSource = <T>(source: FrameSource<T>): T =>
  useSyncExternalStore(source.subscribe, source.get, source.get)
