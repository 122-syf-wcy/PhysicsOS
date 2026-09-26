import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_CONFIG, normalizeConfig, redactRedisUrl } from '../src/index.ts'

describe('shared-state configuration', () => {
  it('applies bounded defaults through schemastery', () => {
    const config = normalizeConfig(Config({ backend: 'memory' }))

    expect(config.backend).toBe('memory')
    expect(config.keyPrefix).toBe('physicsos')
    expect(config.redis.url).toBe('redis://127.0.0.1:6379/0')
    expect(config.redis.maxRetries).toBe(3)
  })

  it('rejects an unsupported backend', () => {
    expect(() => Config({ backend: 'postgres' } as never)).toThrow()
  })

  it('fills nested Redis defaults when only the URL is supplied', () => {
    const config = normalizeConfig({
      backend: 'redis',
      redis: { url: 'rediss://redis.example:6380/2' },
    } as never)

    expect(config.redis.connectTimeoutMs).toBe(DEFAULT_CONFIG.redis.connectTimeoutMs)
    expect(config.redis.tls.rejectUnauthorized).toBe(true)
    expect(config.redis.tls.servername).toBe('')
  })

  it('rejects non-integer retry counts and zero-sized windows', () => {
    expect(() =>
      normalizeConfig({
        ...DEFAULT_CONFIG,
        defaultRateLimitWindowMs: 0,
      }),
    ).toThrow()
    expect(() =>
      normalizeConfig({
        ...DEFAULT_CONFIG,
        redis: { ...DEFAULT_CONFIG.redis, maxRetries: 1.5 },
      }),
    ).toThrow()
  })

  it('redacts credentials from redis URLs', () => {
    expect(redactRedisUrl('rediss://user:super-secret@redis.example:6380/2')).toBe(
      'rediss://<redacted>@redis.example:6380/2',
    )
  })
})
