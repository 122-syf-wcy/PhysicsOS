import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_HEALTH_TIMEOUT_MS, runReadinessChecks, type ReadinessCheck } from './checks.js'

export interface HealthRouteOptions {
  readonly checks: readonly ReadinessCheck[]
  readonly timeoutMs?: number
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(body))
}

/**
 * Build the `/healthz` and `/readyz` HTTP handlers.
 *
 * Liveness never calls a dependency. Readiness is fail-closed: zero configured
 * checks is an unready state, not a silent success.
 * @param options - configured dependency checks and timeout.
 * @returns a Node request handler shared by both exact routes.
 */
export function healthRoutes(options: HealthRouteOptions): Handler {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  return async (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      sendJson(res, 405, {
        error: { code: 'METHOD_NOT_ALLOWED', message: 'health endpoints accept GET only' },
      })
      return
    }

    const path = new URL(req.url ?? '/', 'http://health').pathname
    if (path === '/healthz') {
      sendJson(res, 200, { status: 'ok' })
      return
    }
    if (path !== '/readyz') {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
      return
    }

    const results =
      options.checks.length === 0
        ? [{ name: 'configuration', status: 'failed' as const, code: 'NO_READINESS_CHECKS' }]
        : await runReadinessChecks(options.checks, timeoutMs)
    const ready = results.every((result) => result.status === 'ok')
    const checks = Object.fromEntries(results.map(({ name, ...result }) => [name, result]))
    sendJson(res, ready ? 200 : 503, {
      status: ready ? 'ready' : 'not_ready',
      checks,
    })
  }
}
