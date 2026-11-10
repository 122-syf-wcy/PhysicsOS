/** Server-only erasure coordination; public HTTP credentials never authorize these calls. */

/** The composed erasure provider, resolved on every request/retry. */
export const ACCOUNT_ERASURE_SERVICE = 'physicsosAccountErasure'

/** Stable identity of one accepted erasure operation and account incarnation. */
export interface AccountErasureRequest {
  readonly requestId: string
  readonly userKey: string
  readonly userId: string
  readonly schoolId: string
  readonly username: string
}

/** Exact entries from the auth ownership ledger, without an administrator bypass. */
export interface AccountOwnedResource {
  readonly kind: 'session' | 'workspace'
  readonly resourceId: string
}

/** The composite provider must erase all covered domains before resolving. */
export interface AccountErasure {
  /** Check required services before auth accepts or disables the account. */
  assertAvailable(): void | Promise<void>
  /** Idempotent for requestId; rejects while any owned data remains or work is still active. */
  eraseAccount(request: AccountErasureRequest): Promise<void>
}

/**
 * Validate an optional provider before it can accept irreversible user work.
 * @param value - the Cordis service, absent until its provider is mounted.
 * @returns a complete provider, or undefined when unavailable.
 */
export function asAccountErasure(value: unknown): AccountErasure | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null
    || !('assertAvailable' in value) || typeof value.assertAvailable !== 'function'
    || !('eraseAccount' in value) || typeof value.eraseAccount !== 'function') {
    throw new Error('physicsosAccountErasure must implement assertAvailable() and eraseAccount()')
  }
  return value as AccountErasure
}
