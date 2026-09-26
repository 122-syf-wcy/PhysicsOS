import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as healthHost from '../src/index.ts'

let context: Context | undefined

beforeEach(() => {
  context = undefined
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('real WebServer composition', () => {
  it('serves live and ready probes through the shipped plugin registration shape', async () => {
    let databaseAvailable = true
    context = new Context()
    await context.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await context.plugin(healthHost, {
      checks: [
        {
          name: 'postgres',
          run: async () => {
            if (!databaseAvailable) {
              throw Object.assign(new Error('secret connection string'), { code: 'ECONNREFUSED' })
            }
          },
        },
      ],
      timeoutMs: 250,
    })

    const base = `http://127.0.0.1:${String(context.webServer.port)}`
    const live = await fetch(`${base}/healthz`)
    expect(live.status).toBe(200)

    expect((await fetch(`${base}/readyz`)).status).toBe(200)
    databaseAvailable = false
    const notReady = await fetch(`${base}/readyz`)
    expect(notReady.status).toBe(503)
    expect(await notReady.text()).toContain('ECONNREFUSED')
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
  }, 30_000)

  it('keeps readiness closed when no dependency checks are configured', async () => {
    context = new Context()
    await context.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await context.plugin(healthHost, { checks: [] })

    const base = `http://127.0.0.1:${String(context.webServer.port)}`
    const response = await fetch(`${base}/readyz`)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      status: 'not_ready',
      checks: {
        configuration: { status: 'failed', code: 'NO_READINESS_CHECKS' },
      },
    })
  }, 30_000)
})
