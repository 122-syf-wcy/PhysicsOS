/**
 * Small concurrency primitives for host services that used to funnel every
 * caller through one promise chain. A chain is the right tool when one row
 * must be read-modify-written atomically; it is the wrong tool for a
 * CPU-heavy, independent-per-caller pipeline, where it turns one slow user
 * into everyone's latency. These helpers give such pipelines bounded
 * parallelism (`Semaphore`), a drain barrier for shutdown (`InFlight`) and
 * single-flight coalescing of identical writes (`singleFlight`).
 * @module @deepseek-ai/dsh-experiment-host/concurrency
 */

import { availableParallelism } from 'node:os'

/**
 * Counting semaphore: at most `limit` callers hold a permit at once; the rest
 * wait in FIFO order. Permits are released in `finally`, so a throwing job
 * never leaks capacity.
 */
export class Semaphore {
  private active = 0
  private readonly waiting: (() => void)[] = []

  /**
   * @param limit - maximum concurrent holders; must be a positive integer.
   */
  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('Semaphore limit must be a positive integer')
    }
  }

  /** Callers currently holding a permit. */
  get held(): number {
    return this.active
  }

  /** Callers queued behind the limit. */
  get queued(): number {
    return this.waiting.length
  }

  /**
   * Run `job` once a permit is free and release the permit when it settles.
   * @param job - the work to bound.
   * @returns the job's result.
   */
  async run<T>(job: () => Promise<T> | T): Promise<T> {
    if (this.active >= this.limit) {
      // The releasing holder hands its permit straight to us, so `active`
      // already counts this caller when the grant resolves.
      await new Promise<void>((grant) => { this.waiting.push(grant) })
    } else {
      this.active += 1
    }
    try {
      return await job()
    } finally {
      const next = this.waiting.shift()
      if (next === undefined) this.active -= 1
      else next()
    }
  }
}

/**
 * Registry of unsettled operations so `close()` can wait for every one of
 * them without serialising them. Settled operations drop out on their own.
 */
export class InFlight {
  private readonly pending = new Set<Promise<unknown>>()

  /** Operations not yet settled. */
  get size(): number {
    return this.pending.size
  }

  /**
   * Track one operation until it settles.
   * @param operation - the promise to track.
   * @returns the same promise, for chaining.
   */
  track<T>(operation: Promise<T>): Promise<T> {
    const tracked: Promise<unknown> = operation.then(
      () => { this.pending.delete(tracked) },
      () => { this.pending.delete(tracked) },
    )
    this.pending.add(tracked)
    return operation
  }

  /** Resolve once every tracked operation has settled (rejections included). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending])
    }
  }
}

/**
 * Coalesce concurrent calls that share a key onto one in-flight promise, so
 * two callers materialising the same content-addressed blob never race the
 * same path. The slot is released once the shared promise settles; a later
 * caller starts a fresh run.
 * @param slots - the shared in-flight map (one per resource family).
 * @param key - identity of the work (e.g. a digest).
 * @param work - the work to run when no run for `key` is in flight.
 * @returns the in-flight or freshly started promise for `key`.
 */
export function singleFlight<T>(
  slots: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = slots.get(key)
  if (existing !== undefined) return existing
  const started = work().finally(() => {
    if (slots.get(key) === started) slots.delete(key)
  })
  slots.set(key, started)
  return started
}

/**
 * Default permit count for CPU-bound validation pipelines: leave one core to
 * the event loop, never fewer than one permit and never more than four, so a
 * burst of generations cannot starve request handling on a small host.
 * @returns the recommended semaphore limit for this machine.
 */
export const defaultValidationParallelism = (): number =>
  Math.max(1, Math.min(4, availableParallelism() - 1))
