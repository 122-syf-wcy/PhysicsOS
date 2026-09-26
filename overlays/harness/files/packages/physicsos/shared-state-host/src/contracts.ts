/**
 * Backend-neutral contracts for state that must survive a single process.
 *
 * Both implementations are intentionally small: callers own policy and key
 * naming, while the backend owns atomicity and expiry. External backends throw
 * on failure; they never fall back to a local unlimited path.
 */

export type MaybePromise<T> = T | Promise<T>

export interface RateLimitRequest {
  /** Caller-defined, stable identity for the subject being limited. */
  readonly key: string
  /** Logical bucket namespace; kept separate so auth policy names stay visible. */
  readonly namespace?: string
  /** Maximum allowed operations in one fixed window. */
  readonly limit: number
  /** Fixed-window length in milliseconds. */
  readonly windowMs: number
}

export interface RateLimitDecision {
  readonly allowed: boolean
  readonly count: number
  readonly remaining: number
  readonly resetAt: number
}

export interface RateLimitSnapshot {
  readonly tracked: number
  readonly saturated: number
  readonly backend: string
}

export interface RateLimitBackend {
  readonly kind: string
  consume(request: RateLimitRequest, now?: number): MaybePromise<RateLimitDecision>
  reset?(request: Pick<RateLimitRequest, 'key' | 'namespace'>, now?: number): MaybePromise<void>
  snapshot?(namespace: string, now?: number): MaybePromise<RateLimitSnapshot>
}

export type OnceClaimStatus = 'claimed' | 'already-claimed'

export interface OnceClaim {
  readonly status: OnceClaimStatus
  /** Absolute epoch-millisecond expiry for the claim. */
  readonly expiresAt: number
}

/**
 * One-time claim ledger.
 *
 * `claim` reserves a key, `consume` atomically verifies and removes it, and
 * `release` removes a reservation that should not block a retry. A claim that
 * reaches its TTL is automatically available again.
 */
export interface OnceBackend {
  readonly kind: string
  claim(key: string, ttlSeconds: number, now?: number): MaybePromise<OnceClaim>
  consume(key: string, now?: number): MaybePromise<boolean>
  release(key: string, now?: number): MaybePromise<void>
}

export interface SharedStateService {
  readonly backend: 'memory' | 'redis'
  readonly rateLimit: RateLimitBackend
  readonly once: OnceBackend
  close(): Promise<void>
}

/** Structural subset consumed by the existing auth-host limiter seam. */
export interface AuthLimiterPolicy {
  readonly name: string
  readonly limit: number
  readonly windowMs: number
  readonly maxBuckets: number
}

export interface AuthLimiterSnapshot {
  readonly tracked: number
  readonly saturated: number
  readonly limit: number
  readonly windowMs: number
  readonly backend: string
}

export interface AuthLimiterBackend {
  readonly kind: string
  consume(policy: AuthLimiterPolicy, key: string, now?: number): boolean | Promise<boolean>
  reset?(policy: AuthLimiterPolicy, key: string): void | Promise<void>
  snapshot?(
    policy: AuthLimiterPolicy,
    now?: number,
  ): AuthLimiterSnapshot | Promise<AuthLimiterSnapshot>
}

export function assertRateLimitRequest(request: RateLimitRequest): void {
  if (request.key.trim() === '') throw new TypeError('rate-limit key must not be empty')
  if (!Number.isInteger(request.limit) || request.limit < 1) {
    throw new RangeError('rate-limit limit must be a positive integer')
  }
  if (!Number.isFinite(request.windowMs) || request.windowMs <= 0) {
    throw new RangeError('rate-limit windowMs must be greater than zero')
  }
}

export function assertOnceKey(key: string): void {
  if (key.trim() === '') throw new TypeError('once key must not be empty')
}

export function assertOnceTtl(ttlSeconds: number): void {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError('once ttlSeconds must be greater than zero')
  }
}
