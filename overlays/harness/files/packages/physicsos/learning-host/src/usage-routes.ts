/** Account and administrator HTTP entry points for actual usage. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PhysicsosIdentity } from './identity.ts'
import { LearningError, requireActor, type IdentityActor } from './identity.ts'
import type { UsageService } from './usage-service.ts'
import type { UsageQuery } from './usage-types.ts'
import { canvasJsonMutation, canvasReadJson } from './canvas-http.ts'
import { CanvasError } from './canvas-error.ts'
import { z } from 'zod'
export interface UsageRouteDependencies {
  readonly service: UsageService
  readonly identity: () => PhysicsosIdentity | undefined
  readonly flush?: () => Promise<void>
}
const expected = z.strictObject({ schoolId: z.string().min(1).max(64), username: z.string().min(1).max(128) })
const actorOf = (deps: UsageRouteDependencies, req: IncomingMessage): IdentityActor => {
  const actor = requireActor(deps.identity(), req),
    raw = req.headers['x-physicsos-usage-owner']
  if (raw !== undefined) {
    if (typeof raw !== 'string' || raw.length > 4096) throw new LearningError(400, 'BAD_REQUEST', 'Expected usage account is invalid.')
    let principal: z.infer<typeof expected>
    try {
      principal = expected.parse(JSON.parse(decodeURIComponent(raw)))
    } catch {
      throw new LearningError(400, 'BAD_REQUEST', 'Expected usage account is invalid.')
    }
    if (principal.schoolId !== actor.schoolId || principal.username !== actor.username)
      throw new LearningError(401, 'ACCOUNT_CHANGED', 'The authenticated usage account changed.')
  }
  return actor
}
const queryOf = (url: URL): UsageQuery => {
  const values: { from?: string; to?: string; schoolId?: string } = {}
  for (const name of url.searchParams.keys())
    if (!['from', 'to', 'schoolId'].includes(name)) throw new LearningError(400, 'BAD_REQUEST', 'Unexpected usage filter.')
  for (const name of ['from', 'to', 'schoolId'] as const) {
    const entries = url.searchParams.getAll(name)
    if (entries.length > 1) throw new LearningError(400, 'BAD_REQUEST', 'A usage filter was repeated.')
    if (entries[0] !== undefined) values[name] = entries[0]
  }
  return values
}
const send = (res: ServerResponse, status: number, value: unknown): void => {
  if (res.destroyed || res.headersSent) return
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.byteLength,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}
const sendError = (res: ServerResponse, error: unknown): void => {
  if (error instanceof LearningError || error instanceof CanvasError)
    send(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
        retryable: error.status >= 500 || [408, 429].includes(error.status),
      },
    })
  else send(res, 500, { error: { code: 'USAGE_FAILED', message: 'Usage could not be read or durably recorded.', retryable: true } })
}
/**
 * Mount private usage HTTP.
 * @param deps - Durable service and current identity.
 * @returns Handler for personal events and authorized aggregates.
 */
export function usageRoutes(deps: UsageRouteDependencies): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const transport = new AbortController(),
      signal = AbortSignal.any([transport.signal, AbortSignal.timeout(deps.service.limits.requestTimeoutMs)])
    const abort = (): void => {
      transport.abort()
    }
    const close = (): void => {
      if (!res.writableEnded) abort()
    }
    req.once('aborted', abort)
    res.once('close', close)
    try {
      await deps.service.request(async () => {
        const actor = actorOf(deps, req),
          url = new URL(req.url ?? '/', 'http://usage.invalid')
        let body: unknown
        if (req.method === 'GET' && url.pathname === '/physicsos/usage') {
          await deps.flush?.()
          body = await deps.service.summary(actor, queryOf(url))
        } else if (req.method === 'GET' && url.pathname === '/physicsos/admin/usage') {
          await deps.flush?.()
          body = await deps.service.adminSummary(actor, queryOf(url))
        } else if (req.method === 'POST' && url.pathname === '/physicsos/usage/events') {
          canvasJsonMutation(req)
          body = await deps.service.recordEvent(actor, await canvasReadJson(req, deps.service.limits.maxRequestBytes, signal))
        } else throw new LearningError(404, 'NOT_FOUND', 'Usage route does not exist.')
        const current = actorOf(deps, req)
        if (current.schoolId !== actor.schoolId || current.userKey !== actor.userKey)
          throw new LearningError(401, 'ACCOUNT_CHANGED', 'The authenticated usage account changed during the request.')
        signal.throwIfAborted()
        send(res, 200, body)
      })
    } catch (error) {
      sendError(res, error)
    } finally {
      req.off('aborted', abort)
      res.off('close', close)
    }
  }
}
