import {
  assertOnceKey,
  assertOnceTtl,
  assertRateLimitRequest,
  type OnceBackend,
  type OnceClaim,
  type RateLimitBackend,
  type RateLimitDecision,
  type RateLimitRequest,
} from './contracts.ts'
import { RedisConnection, RedisConnectionError, redisKey } from './redis-client.ts'

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

const CONSUME_ONCE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`

const CLAIM_ONCE_SCRIPT = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
  return {0, ttl}
end
local requested = tonumber(ARGV[1])
redis.call('SET', KEYS[1], '1', 'PX', requested)
return {1, requested}
`

const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value)

const numberAt = (reply: unknown, index: number): number => {
  if (!isUnknownArray(reply))
    throw new RedisConnectionError('Redis rate-limit reply was not an array', 'PROTOCOL')
  const value: unknown = reply[index]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RedisConnectionError('Redis rate-limit reply was malformed', 'PROTOCOL')
  }
  return value
}

const integerReply = (reply: unknown): number => {
  if (typeof reply !== 'number' || !Number.isFinite(reply)) {
    throw new RedisConnectionError('Redis once reply was malformed', 'PROTOCOL')
  }
  return reply
}

/** Redis fixed-window counter, atomic through one EVAL round trip. */
export class RedisRateLimitBackend implements RateLimitBackend {
  readonly kind = 'redis'

  constructor(
    private readonly connection: RedisConnection,
    private readonly keyPrefix: string,
  ) {}

  async consume(request: RateLimitRequest, now = Date.now()): Promise<RateLimitDecision> {
    assertRateLimitRequest(request)
    const key = redisKey(this.keyPrefix, request.namespace ?? 'default', request.key)
    const reply = await this.connection.eval(
      RATE_LIMIT_SCRIPT,
      [key],
      [String(Math.ceil(request.windowMs))],
    )
    const count = numberAt(reply, 0)
    const ttl = numberAt(reply, 1)
    return {
      allowed: count <= request.limit,
      count,
      remaining: Math.max(0, request.limit - count),
      resetAt: now + (ttl > 0 ? ttl : Math.ceil(request.windowMs)),
    }
  }

  async reset(request: Pick<RateLimitRequest, 'key' | 'namespace'>): Promise<void> {
    await this.connection.command([
      'DEL',
      redisKey(this.keyPrefix, request.namespace ?? 'default', request.key),
    ])
  }
}

/** Redis one-time ledger using Lua-backed claim and consume operations. */
export class RedisOnceBackend implements OnceBackend {
  readonly kind = 'redis'

  constructor(
    private readonly connection: RedisConnection,
    private readonly keyPrefix: string,
  ) {}

  private key(key: string): string {
    return redisKey(this.keyPrefix, 'once', key)
  }

  async claim(key: string, ttlSeconds: number, now = Date.now()): Promise<OnceClaim> {
    assertOnceKey(key)
    assertOnceTtl(ttlSeconds)
    const ttlMs = Math.ceil(ttlSeconds * 1_000)
    const reply = await this.connection.eval(CLAIM_ONCE_SCRIPT, [this.key(key)], [String(ttlMs)])
    const claimed = numberAt(reply, 0) === 1
    const remaining = numberAt(reply, 1)
    return {
      status: claimed ? 'claimed' : 'already-claimed',
      expiresAt: now + remaining,
    }
  }

  async consume(key: string): Promise<boolean> {
    assertOnceKey(key)
    return integerReply(await this.connection.eval(CONSUME_ONCE_SCRIPT, [this.key(key)])) === 1
  }

  async release(key: string): Promise<void> {
    assertOnceKey(key)
    await this.connection.command(['DEL', this.key(key)])
  }
}

export { RedisConnection, RedisConnectionError, redisKey }
