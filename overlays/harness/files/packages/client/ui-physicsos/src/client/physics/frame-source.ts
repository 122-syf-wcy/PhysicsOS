/** A renderer update channel independent of the workspace's low-frequency source. */
export interface BareFrameSource<T> {
  getSnapshot?(this: void): T
  get?(this: void): T
  set?(this: void, next: T): void
  subscribe(this: void, listener: () => void): () => void
}

export interface FrameSource<T> {
  /** Both names have the same stable function identity. */
  getSnapshot(this: void): T
  get(this: void): T
  set(this: void, next: T): void
  subscribe(this: void, listener: () => void): () => void
  /** Retains the last frame, but closes publication and notification. */
  dispose(this: void, finalSnapshot?: T): void
}

export interface FrameSourceOptions {
  onListenerError?(error: unknown): void
}

const reportListenerError = (options: FrameSourceOptions, error: unknown): void => {
  try {
    options.onListenerError?.(error)
  } catch {
    // A failed observer must not prevent another renderer receiving its frame.
  }
}

/** The source's functions and its snapshot remain stable between publications. */
export const createFrameSource = <T>(initial: T, options: FrameSourceOptions = {}): FrameSource<T> => {
  let current = initial
  let disposed = false
  const listeners = new Set<() => void>()
  const getSnapshot = (): T => current
  const subscribe = (listener: () => void): (() => void) => {
    if (disposed) return () => undefined
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const set = (next: T): void => {
    if (disposed || Object.is(next, current)) return
    current = next
    for (const listener of [...listeners]) {
      if (disposed) break
      if (!listeners.has(listener)) continue
      try { listener() } catch (error: unknown) { reportListenerError(options, error) }
    }
  }
  const dispose = (finalSnapshot?: T): void => {
    if (disposed) return
    disposed = true
    listeners.clear()
    if (finalSnapshot !== undefined) current = finalSnapshot
  }
  return { getSnapshot, get: getSnapshot, set, subscribe, dispose }
}

/**
 * Adapt a getSnapshot/get source without exporting a framework or React binding.
 * The adapter owns its subscription, not the supplied source's lifetime. A bad
 * read leaves the last complete frame in place and is reported to the caller.
 */
export const adaptFrameSource = <T>(
  source: BareFrameSource<T>,
  options: FrameSourceOptions = {},
): FrameSource<T> => {
  const read = source.getSnapshot ?? source.get
  if (read === undefined) throw new TypeError('A frame source needs getSnapshot or get.')
  const local = createFrameSource(read(), options)
  let disposed = false
  let unsubscribe: (() => void) | undefined
  const refresh = (): void => {
    if (disposed) return
    try { local.set(read()) } catch (error: unknown) { reportListenerError(options, error) }
  }
  try {
    unsubscribe = source.subscribe(refresh)
    refresh()
  } catch (error: unknown) { reportListenerError(options, error) }
  return {
    getSnapshot: local.getSnapshot,
    get: local.get,
    subscribe: local.subscribe,
    set: (next: T): void => {
      if (disposed) return
      if (source.set === undefined) { local.set(next); return }
      try { source.set(next); refresh() } catch (error: unknown) { reportListenerError(options, error) }
    },
    dispose: (finalSnapshot?: T): void => {
      if (disposed) return
      disposed = true
      local.dispose(finalSnapshot)
      try { unsubscribe?.() } catch (error: unknown) { reportListenerError(options, error) }
      unsubscribe = undefined
    },
  }
}
