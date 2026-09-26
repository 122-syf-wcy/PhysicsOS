import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as sharedStateHost from '../src/index.ts'
import { probeRedis, redisUrl } from './redis-test-utils.ts'

const contexts: Context[] = []
const redisPrefix = `physicsos-composition-${process.pid}-${Math.random().toString(16).slice(2)}`
const redisAvailable = await probeRedis()

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
})

describe('shared-state-host composition', () => {
  it('publishes the shared-state, limiter, and once services from one plugin instance', async () => {
    const context = new Context()
    contexts.push(context)
    await context.plugin(sharedStateHost, { backend: 'memory' })

    const shared = context.get(
      sharedStateHost.SHARED_STATE_SERVICE,
    ) as sharedStateHost.SharedStateService
    const limiter = context.get(
      sharedStateHost.RATE_LIMIT_SERVICE,
    ) as sharedStateHost.AuthLimiterBackend
    const once = context.get(sharedStateHost.ONCE_SERVICE) as sharedStateHost.OnceBackend

    expect(shared.rateLimit.kind).toBe('memory')
    expect(limiter.kind).toBe('memory')
    await expect(
      limiter.consume({ name: 'login', limit: 1, windowMs: 1_000, maxBuckets: 10 }, 'student:1'),
    ).resolves.toBe(true)
    await expect(
      limiter.consume({ name: 'login', limit: 1, windowMs: 1_000, maxBuckets: 10 }, 'student:1'),
    ).resolves.toBe(false)
    expect(
      await limiter.snapshot?.({ name: 'login', limit: 1, windowMs: 1_000, maxBuckets: 10 }),
    ).toMatchObject({ tracked: 1, saturated: 1 })
    expect(await once.claim('composition:once', 10)).toMatchObject({ status: 'claimed' })
  })

  it.skipIf(!redisAvailable)(
    'shares one Redis state across two independent Cordis plugin instances',
    async () => {
      const config = {
        backend: 'redis' as const,
        keyPrefix: redisPrefix,
        redis: { url: redisUrl },
      }
      const a = new Context()
      const b = new Context()
      contexts.push(a, b)
      await a.plugin(sharedStateHost, config)
      await b.plugin(sharedStateHost, config)

      const limiterA = a.get(
        sharedStateHost.RATE_LIMIT_SERVICE,
      ) as sharedStateHost.AuthLimiterBackend
      const limiterB = b.get(
        sharedStateHost.RATE_LIMIT_SERVICE,
      ) as sharedStateHost.AuthLimiterBackend
      const onceA = a.get(sharedStateHost.ONCE_SERVICE) as sharedStateHost.OnceBackend
      const onceB = b.get(sharedStateHost.ONCE_SERVICE) as sharedStateHost.OnceBackend
      const policy = { name: 'login', limit: 1, windowMs: 10_000, maxBuckets: 10 }

      expect(await limiterA.consume(policy, 'plugin:shared')).toBe(true)
      expect(await limiterB.consume(policy, 'plugin:shared')).toBe(false)
      expect(await onceA.claim('plugin:once', 30)).toMatchObject({ status: 'claimed' })
      expect(await onceB.claim('plugin:once', 30)).toMatchObject({ status: 'already-claimed' })
    },
  )
})
