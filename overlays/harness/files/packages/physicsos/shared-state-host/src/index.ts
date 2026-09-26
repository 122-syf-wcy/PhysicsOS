/**
 * PhysicsOS shared runtime state.
 *
 * This host owns the two cross-replica primitives used by the auth, learning,
 * class, and API-proxy planes: fixed-window rate-limit counters and one-time
 * claim ledgers. The memory backends are the single-process reference
 * implementation; the Redis backends are selected by configuration for
 * multi-replica deployments.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  Config,
  DEFAULT_CONFIG,
  normalizeConfig,
  redactRedisUrl,
  validateRedisUrl,
  type SharedStateConfigInput,
} from './config.ts'
import { MemoryOnceBackend, MemoryRateLimitBackend } from './memory.ts'
import { RedisConnection } from './redis-client.ts'
import { RedisOnceBackend, RedisRateLimitBackend } from './redis.ts'
import type {
  AuthLimiterBackend,
  OnceBackend,
  RateLimitBackend,
  SharedStateService,
} from './contracts.ts'

export { Config, DEFAULT_CONFIG, normalizeConfig, redactRedisUrl, validateRedisUrl }
export { MemoryOnceBackend, MemoryRateLimitBackend }
export {
  RedisConnection,
  RedisOnceBackend,
  RedisRateLimitBackend,
  RedisConnectionError,
  redisKey,
} from './redis.ts'
export type * from './contracts.ts'

export const name = 'shared-state-host'

export const SHARED_STATE_SERVICE = 'physicsosSharedState'
export const RATE_LIMIT_SERVICE = 'physicsosRateLimiter'
export const ONCE_SERVICE = 'physicsosOnceLedger'

const toAuthLimiter = (backend: RateLimitBackend): AuthLimiterBackend => ({
  kind: backend.kind,
  async consume(policy, key, now) {
    const result = await backend.consume(
      {
        key,
        namespace: `limiter:${policy.name}`,
        limit: policy.limit,
        windowMs: policy.windowMs,
      },
      now,
    )
    return result.allowed
  },
  async reset(policy, key) {
    await backend.reset?.({ key, namespace: `limiter:${policy.name}` })
  },
  async snapshot(policy, now) {
    const snapshot = await backend.snapshot?.(`limiter:${policy.name}`, now)
    return {
      tracked: snapshot?.tracked ?? 0,
      saturated: snapshot?.saturated ?? 0,
      limit: policy.limit,
      windowMs: policy.windowMs,
      backend: backend.kind,
    }
  },
})

function createMemoryState(config: ReturnType<typeof normalizeConfig>): SharedStateService {
  const rateLimit = new MemoryRateLimitBackend()
  const once = new MemoryOnceBackend()
  return {
    backend: config.backend,
    rateLimit,
    once,
    close: async () => {},
  }
}

/**
 * Create a state service without requiring a Cordis context. Redis support is
 * wired in by `createSharedState` once the connection host is available.
 */
export function createSharedState(
  input: SharedStateConfigInput = {},
): SharedStateService {
  const config = normalizeConfig(input)
  if (config.backend === 'memory') return createMemoryState(config)
  const connection = new RedisConnection(config.redis)
  return {
    backend: 'redis',
    rateLimit: new RedisRateLimitBackend(connection, config.keyPrefix),
    once: new RedisOnceBackend(connection, config.keyPrefix),
    close: () => connection.close(),
  }
}

/**
 * Cordis entry point. The compatibility service is published under
 * `physicsosRateLimiter` so the existing auth-host seam can consume it.
 */
export function apply(
  ctx: Context,
  input: SharedStateConfigInput = {},
): void {
  const config = normalizeConfig(input)
  const state = createSharedState(config)
  ctx.effect(() => () => state.close(), 'shared-state-host')
  ctx.provide(SHARED_STATE_SERVICE, state)
  ctx.provide(RATE_LIMIT_SERVICE, toAuthLimiter(state.rateLimit))
  ctx.provide(ONCE_SERVICE, state.once)
  ctx.logger.info(
    `shared-state-host: ${config.backend} backend (${redactRedisUrl(config.redis.url)})`,
  )
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    physicsosSharedState: SharedStateService
    physicsosRateLimiter: AuthLimiterBackend
    physicsosOnceLedger: OnceBackend
  }
}
