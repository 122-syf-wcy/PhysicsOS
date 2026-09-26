import { describe, expect, it, vi } from 'vitest'
import { OpsCollector } from '../src/collector.ts'
import type { OpsCollectorDependencies } from '../src/collector.ts'

const disk = (usedPercent = 10) => ({
  path: '/',
  totalBytes: 100,
  freeBytes: 100 - usedPercent,
  availableBytes: 100 - usedPercent,
  usedBytes: usedPercent,
  usedPercent,
  available: true,
})

const deps = (overrides: Partial<OpsCollectorDependencies> = {}): OpsCollectorDependencies => ({
  now: () => 1_000,
  paths: { root: '/', data: '/data', sessions: '/data/sessions', workspaces: '/data/workspaces' },
  thresholds: { diskWarningPercent: 85, diskCriticalPercent: 92 },
  readDiskUsage: vi.fn().mockResolvedValue(disk()),
  scanDirectory: vi.fn().mockResolvedValue({ bytes: 12, entries: 2, partial: false }),
  probePostgres: vi.fn().mockResolvedValue({
    ok: true,
    latencyMs: 3,
    sizeBytes: 1000,
    sessions: { live: 2, distinctUsers: 1 },
    accounts: { total: 4, active: 3, disabled: 1 },
  }),
  probeRedis: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1, usedMemoryBytes: 512 }),
  ...overrides,
})

describe('OpsCollector', () => {
  it('caches a successful sample until the TTL expires', async () => {
    let now = 1_000
    const read = vi.fn().mockResolvedValue(disk())
    const collector = new OpsCollector(
      deps({ now: () => now, readDiskUsage: read }),
      { ttlMs: 15_000, timeoutMs: 1_000 },
    )

    const first = await collector.collect()
    const second = await collector.collect()
    expect(first.cache.hit).toBe(false)
    expect(second.cache.hit).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)

    now += 15_001
    const third = await collector.collect()
    expect(third.cache.hit).toBe(false)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('shares one in-flight collection across concurrent requests', async () => {
    const read = vi.fn().mockResolvedValue(disk())
    const collector = new OpsCollector(deps({ readDiskUsage: read }), {
      ttlMs: 15_000,
      timeoutMs: 1_000,
    })
    const [a, b] = await Promise.all([collector.collect(true), collector.collect(true)])
    expect(a.cache.collectedAt).toBe(b.cache.collectedAt)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('force refreshes even while a cached sample is valid', async () => {
    const read = vi.fn().mockResolvedValue(disk())
    const collector = new OpsCollector(deps({ readDiskUsage: read }), {
      ttlMs: 15_000,
      timeoutMs: 1_000,
    })
    await collector.collect()
    await collector.collect(true)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('marks dependency and disk failures partial with stable alerts', async () => {
    const collector = new OpsCollector(deps({
      readDiskUsage: vi.fn().mockRejectedValue(new Error('no statfs')),
      probePostgres: vi.fn().mockResolvedValue({ ok: false, code: 'POSTGRES_UNAVAILABLE' }),
      probeRedis: vi.fn().mockResolvedValue({ ok: false, code: 'REDIS_UNAVAILABLE' }),
    }), { ttlMs: 15_000, timeoutMs: 1_000 })
    const metrics = await collector.collect()
    expect(metrics.partial).toBe(true)
    expect(metrics.health.status).toBe('critical')
    expect(metrics.alerts.map(alert => alert.code)).toEqual(expect.arrayContaining([
      'DISK_PROBE_FAILED',
      'POSTGRES_UNAVAILABLE',
      'REDIS_UNAVAILABLE',
    ]))
    expect(JSON.stringify(metrics)).not.toContain('no statfs')
  })

  it('uses warning and critical disk thresholds at their boundaries', async () => {
    const warning = await new OpsCollector(deps({
      readDiskUsage: vi.fn().mockResolvedValue(disk(85)),
    }), { ttlMs: 15_000, timeoutMs: 1_000 }).collect()
    const critical = await new OpsCollector(deps({
      readDiskUsage: vi.fn().mockResolvedValue(disk(92)),
    }), { ttlMs: 15_000, timeoutMs: 1_000 }).collect()
    expect(warning.health.status).toBe('warning')
    expect(critical.health.status).toBe('critical')
  })
})
