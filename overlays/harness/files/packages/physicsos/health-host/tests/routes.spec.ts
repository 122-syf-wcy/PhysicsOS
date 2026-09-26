import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { healthRoutes, type ReadinessCheck } from '../src/index.ts'

let server: Server
let base: string
let healthy = true

const checks: readonly ReadinessCheck[] = [
  {
    name: 'postgres',
    run: async () => {
      if (!healthy) throw Object.assign(new Error('private database URL'), { code: 'ECONNREFUSED' })
    },
  },
  {
    name: 'redis',
    run: async () => {},
  },
]

beforeAll(async () => {
  const handler = healthRoutes({ checks, timeoutMs: 200 })
  server = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    }),
)

describe('health routes', () => {
  it('reports liveness without depending on readiness checks', async () => {
    healthy = false
    const response = await fetch(`${base}/healthz`)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('reports readiness when every dependency responds', async () => {
    healthy = true
    const response = await fetch(`${base}/readyz`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      checks: {
        postgres: { status: 'ok' },
        redis: { status: 'ok' },
      },
    })
  })

  it('returns a bounded, sanitized failure when a dependency is unavailable', async () => {
    healthy = false
    const response = await fetch(`${base}/readyz`)
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(JSON.parse(body)).toEqual({
      status: 'not_ready',
      checks: {
        postgres: { status: 'failed', code: 'ECONNREFUSED' },
        redis: { status: 'ok' },
      },
    })
    expect(body).not.toContain('private database URL')
  })

  it('allows only GET', async () => {
    const response = await fetch(`${base}/healthz`, { method: 'POST' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    await expect(response.json()).resolves.toEqual({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'health endpoints accept GET only' },
    })
  })
})
