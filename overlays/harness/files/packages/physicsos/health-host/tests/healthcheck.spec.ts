import { describe, expect, it, vi } from 'vitest'
import { checkHealth } from '../../../../../../../scripts/healthcheck.mjs'

describe('container healthcheck', () => {
  it('succeeds only for a 2xx readiness response', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"status":"ready"}', { status: 200 }))

    await expect(
      checkHealth('http://app:3080/readyz', { fetchImpl, timeoutMs: 50 }),
    ).resolves.toEqual({
      ok: true,
      status: 200,
      body: '{"status":"ready"}',
    })
  })

  it('fails with an actionable result when the endpoint is unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('private endpoint'), { code: 'ECONNREFUSED' })
    })

    await expect(
      checkHealth('http://app:3080/readyz', { fetchImpl, timeoutMs: 50 }),
    ).resolves.toEqual({
      ok: false,
      error: 'ECONNREFUSED',
    })
  })
})
