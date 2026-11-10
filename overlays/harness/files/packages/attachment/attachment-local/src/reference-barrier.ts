/** Reader/writer exclusion covering complete attachment admission, reads, and collection. */

import { AsyncLocalStorage } from 'node:async_hooks'
import { LocalErasureError } from '@deepseek-ai/dsh-attachment/local-erasure'

interface Waiter {
  readonly write: boolean
  readonly resolve: (release: () => void) => void
  readonly reject: (error: Error) => void
  readonly signal?: AbortSignal
  abort?: () => void
}

/** Shared operations may nest while an exclusive waiter is queued; every nested lifetime stays counted. */
export class ReferenceBarrier {
  private readers = 0
  private writing = false
  private readonly queue: Waiter[] = []
  private readonly scope = new AsyncLocalStorage<{ active: boolean }>()

  /**
   * Hold one shared operation until its complete promise settles.
   * @param operation - attachment operation, including any publication.
   * @returns the operation's result.
   */
  async shared<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(false, undefined, this.scope.getStore()?.active === true)
    const scope = { active: true }
    try {
      return await this.scope.run(scope, operation)
    } finally {
      scope.active = false
      release()
    }
  }

  /**
   * Exclude every current and future shared operation for one collection transaction.
   * @param operation - transaction invoked only after all earlier operations settle.
   * @param signal - cancellation while waiting; a started transaction is not abandoned.
   * @returns the transaction's result.
   */
  async exclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(true, signal, false)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private acquire(write: boolean, signal: AbortSignal | undefined, nested: boolean): Promise<() => void> {
    if (signal?.aborted === true) return Promise.reject(new LocalErasureError('ERASURE_BUSY'))
    if (!write && nested && !this.writing) {
      this.readers += 1
      return Promise.resolve(() => { this.readers -= 1; this.pump() })
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { write, resolve, reject, ...(signal === undefined ? {} : { signal }) }
      if (signal !== undefined) {
        waiter.abort = () => {
          const index = this.queue.indexOf(waiter)
          if (index < 0) return
          this.queue.splice(index, 1)
          reject(new LocalErasureError('ERASURE_BUSY'))
          this.pump()
        }
        signal.addEventListener('abort', waiter.abort, { once: true })
      }
      this.queue.push(waiter)
      this.pump()
    })
  }

  private pump(): void {
    if (this.writing) return
    for (;;) {
      const waiter = this.queue[0]
      if (waiter === undefined || (waiter.write && this.readers > 0)) return
      this.queue.shift()
      if (waiter.abort !== undefined) waiter.signal?.removeEventListener('abort', waiter.abort)
      if (waiter.write) {
        this.writing = true
        waiter.resolve(() => { this.writing = false; this.pump() })
        return
      }
      this.readers += 1
      waiter.resolve(() => { this.readers -= 1; this.pump() })
    }
  }
}
