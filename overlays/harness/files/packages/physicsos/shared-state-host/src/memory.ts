import {
  assertOnceKey,
  assertOnceTtl,
  assertRateLimitRequest,
  type OnceBackend,
  type OnceClaim,
  type RateLimitBackend,
  type RateLimitDecision,
  type RateLimitRequest,
  type RateLimitSnapshot,
} from './contracts.ts'

interface Bucket {
  count: number
  resetAt: number
  limit: number
}

/**
 * Process-local fixed-window counter. This is the deterministic reference
 * implementation and the default for single-instance development.
 */
export class MemoryRateLimitBackend implements RateLimitBackend {
  readonly kind = 'memory'
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly clock: () => number = () => Date.now()) {}

  private composite(request: Pick<RateLimitRequest, 'key' | 'namespace'>): string {
    return `${request.namespace ?? 'default'}\u0000${request.key}`
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key)
    }
  }

  consume(request: RateLimitRequest, now = this.clock()): RateLimitDecision {
    assertRateLimitRequest(request)
    this.prune(now)
    const key = this.composite(request)
    const current = this.buckets.get(key)
    const bucket =
      current === undefined
        ? { count: 0, resetAt: now + request.windowMs, limit: request.limit }
        : current
    bucket.count += 1
    this.buckets.set(key, bucket)
    return {
      allowed: bucket.count <= request.limit,
      count: bucket.count,
      remaining: Math.max(0, request.limit - bucket.count),
      resetAt: bucket.resetAt,
    }
  }

  reset(request: Pick<RateLimitRequest, 'key' | 'namespace'>): void {
    this.buckets.delete(this.composite(request))
  }

  snapshot(namespace: string, now = this.clock()): RateLimitSnapshot {
    this.prune(now)
    let tracked = 0
    let saturated = 0
    const prefix = `${namespace}\u0000`
    for (const [key, bucket] of this.buckets) {
      if (!key.startsWith(prefix)) continue
      tracked += 1
      if (bucket.count >= bucket.limit) saturated += 1
    }
    return { tracked, saturated, backend: this.kind }
  }
}

interface PendingOnce {
  expiresAt: number
}

/** Process-local one-time ledger with the same expiry semantics as Redis. */
export class MemoryOnceBackend implements OnceBackend {
  readonly kind = 'memory'
  private readonly claims = new Map<string, PendingOnce>()

  constructor(private readonly clock: () => number = () => Date.now()) {}

  private live(key: string, now: number): PendingOnce | undefined {
    const claim = this.claims.get(key)
    if (claim === undefined) return undefined
    if (now >= claim.expiresAt) {
      this.claims.delete(key)
      return undefined
    }
    return claim
  }

  claim(key: string, ttlSeconds: number, now = this.clock()): OnceClaim {
    assertOnceKey(key)
    assertOnceTtl(ttlSeconds)
    const current = this.live(key, now)
    if (current !== undefined) {
      return { status: 'already-claimed', expiresAt: current.expiresAt }
    }
    const claim = { expiresAt: now + ttlSeconds * 1_000 }
    this.claims.set(key, claim)
    return { status: 'claimed', expiresAt: claim.expiresAt }
  }

  consume(key: string, now = this.clock()): boolean {
    assertOnceKey(key)
    const current = this.live(key, now)
    if (current === undefined) return false
    this.claims.delete(key)
    return true
  }

  release(key: string): void {
    assertOnceKey(key)
    this.claims.delete(key)
  }
}
