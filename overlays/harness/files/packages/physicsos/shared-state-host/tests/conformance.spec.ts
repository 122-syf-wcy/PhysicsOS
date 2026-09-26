import { afterEach, describe, expect, it } from 'vitest'
import {
  Config,
  MemoryOnceBackend,
  MemoryRateLimitBackend,
  normalizeConfig,
  RedisConnection,
  RedisOnceBackend,
  RedisRateLimitBackend,
  type OnceBackend,
  type RateLimitBackend,
} from '../src/index.ts'
import { probeRedis, redisUrl } from './redis-test-utils.ts'

interface BackendPair {
  readonly rateLimit: RateLimitBackend
  readonly once: OnceBackend
  readonly close: () => Promise<void>
}

const redisAvailable = await probeRedis()
const redisPrefix = `physicsos-conformance-${process.pid}-${Math.random().toString(16).slice(2)}`
const openState: BackendPair[] = []

const memoryPair = (): BackendPair => ({
  rateLimit: new MemoryRateLimitBackend(),
  once: new MemoryOnceBackend(),
  close: async () => {},
})

const redisPair = (): BackendPair => {
  const config = normalizeConfig(
    Config({
      backend: 'redis',
      keyPrefix: redisPrefix,
      redis: { url: redisUrl },
    }),
  )
  const connection = new RedisConnection(config.redis)
  const pair = {
    rateLimit: new RedisRateLimitBackend(connection, config.keyPrefix),
    once: new RedisOnceBackend(connection, config.keyPrefix),
    close: () => connection.close(),
  }
  openState.push(pair)
  return pair
}

afterEach(async () => {
  await Promise.all(openState.splice(0).map(pair => pair.close()))
})

const cases: { name: string; create: () => BackendPair; skip?: boolean }[] = [
  { name: 'memory', create: memoryPair },
  {
    name: `Redis (requires reachable ${redisUrl})`,
    create: redisPair,
    skip: !redisAvailable,
  },
]

const exerciseRateLimit = async (backend: RateLimitBackend): Promise<void> => {
  const request = {
    key: `school:student:42:${Math.random().toString(16).slice(2)}`,
    namespace: 'login',
    limit: 2,
    windowMs: 10_000,
  }

  expect(await backend.consume(request)).toMatchObject({
    allowed: true,
    count: 1,
    remaining: 1,
  })
  expect(await backend.consume(request)).toMatchObject({
    allowed: true,
    count: 2,
    remaining: 0,
  })
  expect(await backend.consume(request)).toMatchObject({
    allowed: false,
    count: 3,
    remaining: 0,
  })
  expect((await backend.consume(request)).resetAt).toBeGreaterThan(Date.now())
}

const exerciseOnce = async (backend: OnceBackend): Promise<void> => {
  const key = `approval:rpc-${Math.random().toString(16).slice(2)}`

  expect(await backend.claim(key, 60)).toMatchObject({ status: 'claimed' })
  expect(await backend.claim(key, 60)).toMatchObject({ status: 'already-claimed' })
  expect(await backend.consume(key)).toBe(true)
  expect(await backend.consume(key)).toBe(false)
  expect(await backend.claim(key, 60)).toMatchObject({ status: 'claimed' })
  await backend.release(key)
  expect(await backend.claim(key, 60)).toMatchObject({ status: 'claimed' })
}

for (const backendCase of cases) {
  describe.skipIf(backendCase.skip ?? false)(
    `shared-state conformance: ${backendCase.name}`,
    () => {
      it('enforces the same fixed-window contract', async () => {
        await exerciseRateLimit(backendCase.create().rateLimit)
      })

      it('enforces the same one-time claim contract', async () => {
        await exerciseOnce(backendCase.create().once)
      })
    },
  )
}

describe('memory fake-clock expiry', () => {
  it('expires rate-limit windows and one-time claims without wall-clock waits', async () => {
    let now = 1_000
    const rateLimit = new MemoryRateLimitBackend(() => now)
    const once = new MemoryOnceBackend(() => now)
    const request = { key: 'fake-clock:rate', limit: 1, windowMs: 1_000 }

    expect(rateLimit.consume(request)).toMatchObject({ allowed: true, count: 1 })
    expect(rateLimit.consume(request)).toMatchObject({ allowed: false, count: 2 })
    expect(once.claim('fake-clock:once', 2, now)).toMatchObject({ status: 'claimed' })
    expect(once.claim('fake-clock:once', 2, now)).toMatchObject({ status: 'already-claimed' })

    now += 1_000
    expect(rateLimit.consume(request)).toMatchObject({ allowed: true, count: 1 })
    expect(once.consume('fake-clock:once', now)).toBe(true)
    expect(once.claim('fake-clock:once', 2, now)).toMatchObject({ status: 'claimed' })

    now += 2_000
    expect(once.claim('fake-clock:once', 2, now)).toMatchObject({ status: 'claimed' })
  })
})

describe('memory diagnostics', () => {
  it('reports saturated buckets without exposing their keys', async () => {
    const backend = new MemoryRateLimitBackend()
    backend.consume({
      key: 'private-student-key',
      namespace: 'login',
      limit: 1,
      windowMs: 1_000,
    })

    expect(backend.snapshot?.('login')).toEqual({
      tracked: 1,
      saturated: 1,
      backend: 'memory',
    })
  })
})
