/**
 * Shared rate-limit seam for auth and password-reset attempts.
 *
 * The in-memory backend is the reference implementation for a single process.
 * A deployment that runs more than one app instance supplies a Cordis service
 * named {@link LIMITER_SERVICE}. The backend must be atomic. The documented
 * Redis boundary is:
 *
 *   - key: `physicsos:limiter:<policy.name>:<sha256(rawKey)>` (never the raw
 *     username, token, device id, or IP in the Redis key);
 *   - one Lua script performs `INCR` and `PEXPIRE <windowMs>` only when the key
 *     is new, returning the count plus `PTTL` in the same round trip;
 *   - a Redis error throws. The auth service translates that into HTTP 503
 *     `DEPENDENCY_UNAVAILABLE`; it never falls back to an unlimited path.
 *
 * `snapshot` is optional because a remote backend may not expose an exact
 * cross-instance bucket count. Authentication decisions never depend on it.
 */

/** Auth operations that share the limiter backend. */
export type LimiterName =
  | 'login'
  | 'ip'
  | 'apply'
  | 'registration'
  | 'learning'
  | 'passwordReset'

/** One fixed-window policy, named so shared backends can isolate keys. */
export interface LimiterPolicy {
  readonly name: LimiterName
  readonly limit: number
  readonly windowMs: number
  readonly maxBuckets: number
}

/** Aggregate limiter health; bucket keys are intentionally absent. */
export interface LimiterSnapshot {
  readonly tracked: number
  readonly saturated: number
  readonly limit: number
  readonly windowMs: number
  readonly backend: string
}

/**
 * The replaceable backend. Implementations must be atomic per key and fail
 * closed by throwing when their external store is unavailable.
 */
export interface LimiterBackend {
  readonly kind: string
  consume(policy: LimiterPolicy, key: string, now?: number): boolean | Promise<boolean>
  reset?(policy: LimiterPolicy, key: string): void | Promise<void>
  snapshot?(policy: LimiterPolicy, now?: number): LimiterSnapshot | Promise<LimiterSnapshot>
}

interface Bucket {
  count: number
  resetAt: number
}

/** Process-local fixed-window counter; the single-instance reference backend. */
export class InMemoryLimiterBackend implements LimiterBackend {
  readonly kind = 'memory'
  private readonly buckets = new Map<string, Bucket>()

  private prefix(policy: LimiterPolicy): string {
    return `${policy.name}\0`
  }

  private prune(policy: LimiterPolicy, now: number): void {
    const prefix = this.prefix(policy)
    for (const [key, bucket] of this.buckets) {
      if (key.startsWith(prefix) && now >= bucket.resetAt) this.buckets.delete(key)
    }
  }

  private liveCount(policy: LimiterPolicy): number {
    const prefix = this.prefix(policy)
    let count = 0
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) count += 1
    }
    return count
  }

  consume(policy: LimiterPolicy, key: string, now = Date.now()): boolean {
    this.prune(policy, now)
    const composite = `${policy.name}\0${key}`
    const existing = this.buckets.get(composite)
    if (existing === undefined) {
      if (this.liveCount(policy) >= policy.maxBuckets) return false
      this.buckets.set(composite, { count: 1, resetAt: now + policy.windowMs })
      return true
    }
    existing.count += 1
    return existing.count <= policy.limit
  }

  reset(policy: LimiterPolicy, key: string): void {
    this.buckets.delete(`${policy.name}\0${key}`)
  }

  snapshot(policy: LimiterPolicy, now = Date.now()): LimiterSnapshot {
    this.prune(policy, now)
    let tracked = 0
    let saturated = 0
    const prefix = this.prefix(policy)
    for (const [key, bucket] of this.buckets) {
      if (!key.startsWith(prefix)) continue
      tracked += 1
      if (bucket.count >= policy.limit) saturated += 1
    }
    return {
      tracked,
      saturated,
      limit: policy.limit,
      windowMs: policy.windowMs,
      backend: this.kind,
    }
  }
}

/** Cordis service key a multi-instance deployment may provide. */
export const LIMITER_SERVICE = 'physicsosRateLimiter'

/**
 * Validate an externally supplied backend before authentication starts.
 * @param value - the service resolved from Cordis, when present.
 * @returns the validated backend, or undefined when no service was supplied.
 */
export function asLimiterBackend(value: unknown): LimiterBackend | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${LIMITER_SERVICE} must be an object with consume()`)
  }
  const candidate = value as Partial<LimiterBackend>
  if (typeof candidate.kind !== 'string' || candidate.kind.trim() === '') {
    throw new Error(`${LIMITER_SERVICE}.kind must be a non-empty string`)
  }
  if (typeof candidate.consume !== 'function') {
    throw new Error(`${LIMITER_SERVICE}.consume must be a function`)
  }
  if (candidate.reset !== undefined && typeof candidate.reset !== 'function') {
    throw new Error(`${LIMITER_SERVICE}.reset must be a function when present`)
  }
  if (candidate.snapshot !== undefined && typeof candidate.snapshot !== 'function') {
    throw new Error(`${LIMITER_SERVICE}.snapshot must be a function when present`)
  }
  return candidate as LimiterBackend
}
