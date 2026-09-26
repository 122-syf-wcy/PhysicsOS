import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * The CLI lives at the PHYSICSOS repository root, while this spec runs from
 * both the overlay copy and its mirror under `vendor/deepseek-harness`. No
 * single relative path reaches the root from both, so walk up from the
 * Vitest working directory to the first `scripts/healthcheck.mjs`.
 */
const findHealthcheckCli = (): string => {
  let dir = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'scripts', 'healthcheck.mjs')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  throw new Error('scripts/healthcheck.mjs not found above the Vitest working directory')
}

const { checkHealth } = (await import(findHealthcheckCli())) as {
  checkHealth: (url: string, options: {
    fetchImpl: typeof globalThis.fetch
    timeoutMs: number
  }) => Promise<unknown>
}

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
