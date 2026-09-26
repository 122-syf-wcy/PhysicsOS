import { describe, expect, it } from 'vitest'
import { InMemoryLimiterBackend, type LimiterPolicy } from '../src/limiter.ts'

const policy: LimiterPolicy = {
  name: 'passwordReset',
  limit: 2,
  windowMs: 1_000,
  maxBuckets: 2,
}

describe('in-memory limiter backend', () => {
  it('allows up to the limit in one fixed window and resets at its boundary', () => {
    const limiter = new InMemoryLimiterBackend()
    expect(limiter.consume(policy, 'account:a', 0)).toBe(true)
    expect(limiter.consume(policy, 'account:a', 10)).toBe(true)
    expect(limiter.consume(policy, 'account:a', 20)).toBe(false)
    expect(limiter.consume(policy, 'account:a', 1_000)).toBe(true)
  })

  it('bounds bucket cardinality per policy and never evicts a live bucket', () => {
    const limiter = new InMemoryLimiterBackend()
    expect(limiter.consume(policy, 'a', 0)).toBe(true)
    expect(limiter.consume(policy, 'b', 0)).toBe(true)
    expect(limiter.consume(policy, 'c', 0)).toBe(false)
    expect(limiter.consume(policy, 'c', 1_000)).toBe(true)
  })

  it('reports aggregate snapshots without exposing bucket keys', () => {
    const limiter = new InMemoryLimiterBackend()
    limiter.consume(policy, 'secret-a', 0)
    limiter.consume(policy, 'secret-b', 0)
    limiter.consume(policy, 'secret-b', 1)
    expect(limiter.snapshot(policy, 2)).toEqual({
      tracked: 2,
      saturated: 1,
      limit: 2,
      windowMs: 1_000,
      backend: 'memory',
    })
  })

  it('resets one bucket without affecting its neighbours', () => {
    const limiter = new InMemoryLimiterBackend()
    limiter.consume(policy, 'a', 0)
    limiter.consume(policy, 'a', 1)
    limiter.consume(policy, 'b', 0)
    limiter.reset(policy, 'a')
    expect(limiter.consume(policy, 'a', 2)).toBe(true)
    expect(limiter.snapshot(policy, 2).tracked).toBe(2)
  })
})
