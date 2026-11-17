/** Cookie-only, expected-owner, same-origin experiment run API. This is NOT an HTTP activity.success endpoint. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { CanvasError } from './canvas-error.ts'
import { canvasReadJson, canvasSend } from './canvas-http.ts'
import { LearningError, requireActor, type IdentityActor, type PhysicsosIdentity } from './identity.ts'
import type { ExperimentRunService } from './experiment-run-service.ts'
import { EXPERIMENT_RUN_CAPABILITY, ExperimentRunError } from './experiment-run-types.ts'

export const EXPERIMENT_RUN_PREFIX = '/physicsos/experiment-runs/v1'
export const EXPERIMENT_RUN_OWNER_HEADER = 'x-physicsos-experiment-run-owner'
const expectedWire = z.strictObject({ schoolId: z.string().min(1).max(64), username: z.string().min(1).max(128) })
export interface ExperimentRunHttpDependencies {
  readonly service: ExperimentRunService
  readonly identity: () => PhysicsosIdentity | undefined
  /** Prefer the fixed deployment origin behind the existing trusted reverse proxy. */
  readonly publicOrigin?: string
}
export type ExperimentRunHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
function fail(status: number, code: string, message: string): never { throw new ExperimentRunError(status, code, message) }
function single(req: IncomingMessage, name: string): string | undefined {
  const count = req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length
  const value = req.headers[name]
  if (count > 1 || value !== undefined && typeof value !== 'string') fail(400, 'BAD_RUN_HEADER', '实验运行请求头无效或重复。')
  return value
}
function actorOf(deps: ExperimentRunHttpDependencies, req: IncomingMessage): IdentityActor {
  // Some identity providers prefer Authorization over Cookie. Even a valid cookie + bearer pair must fail closed here.
  if (req.headers.authorization !== undefined) fail(403, 'RUN_COOKIE_ONLY', '实验运行记录仅接受 Cookie 身份，不接受 Authorization。')
  // No bearer token, body owner, query owner or header impersonation fallback.
  if (typeof req.headers.cookie !== 'string' || req.headers.cookie.trim() === '') fail(401, 'UNAUTHENTICATED', '实验运行记录需要有效的登录 Cookie。')
  const actor = requireActor(deps.identity(), req), raw = single(req, EXPERIMENT_RUN_OWNER_HEADER)
  if (raw === undefined) fail(428, 'RUN_EXPECTED_OWNER_REQUIRED', '实验运行记录必须指定当前账号预期。')
  let expected: z.infer<typeof expectedWire>
  try {
    if (raw.length > 2048) throw new Error('header limit')
    expected = expectedWire.parse(JSON.parse(decodeURIComponent(raw)))
  } catch { return fail(400, 'BAD_RUN_OWNER_HEADER', '实验运行账号预期格式无效。') }
  if (actor.schoolId !== expected.schoolId || actor.username !== expected.username) fail(401, 'ACCOUNT_CHANGED', '当前登录账号已变化，已拒绝旧运行请求。')
  return actor
}
function checkOwner(deps: ExperimentRunHttpDependencies, req: IncomingMessage, original: IdentityActor): void {
  const current = actorOf(deps, req)
  if (current.schoolId !== original.schoolId || current.userKey !== original.userKey || current.username !== original.username) fail(401, 'ACCOUNT_CHANGED', '请求期间账号身份已变化，已拒绝旧运行请求。')
}
function sameOrigin(req: IncomingMessage, publicOrigin: string | undefined, mutation: boolean): void {
  const origin = single(req, 'origin'), site = single(req, 'sec-fetch-site')
  if (site !== undefined && site !== 'same-origin' && site !== 'none') fail(403, 'RUN_CROSS_ORIGIN', '实验运行记录仅接受同源请求。')
  if (mutation && origin === undefined) fail(403, 'RUN_ORIGIN_REQUIRED', '实验运行记录必须提供同源 Origin。')
  if (origin === undefined) return
  const host = single(req, 'host')
  if (host === undefined || !/^(?:[A-Za-z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?$/.test(host)) fail(400, 'BAD_RUN_HOST', '实验运行记录来源无效。')
  const encrypted = 'encrypted' in req.socket && req.socket.encrypted === true
  // Preserve the host's existing trusted reverse-Host boundary: HTTPS may terminate before this HTTP socket.
  // Never infer external protocol from x-forwarded-proto. A configured publicOrigin additionally pins the complete external origin.
  try {
    const parsed = new URL(origin)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.host !== host || origin !== parsed.origin || parsed.username || parsed.password ||
      publicOrigin !== undefined && parsed.origin !== publicOrigin || encrypted && parsed.protocol !== 'https:') throw new Error('origin')
  } catch { fail(403, 'RUN_CROSS_ORIGIN', '实验运行记录仅接受完整匹配的同源请求。') }
}
function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.destroyed) return
  if (error instanceof ExperimentRunError || error instanceof CanvasError || error instanceof LearningError) {
    canvasSend(res, error.status, { error: { status: error.status, code: error.code, message: error.message, retryable: error.status >= 500 || [408, 429].includes(error.status) } }); return
  }
  const aborted = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
  canvasSend(res, aborted ? 408 : 503, { error: { status: aborted ? 408 : 503, code: aborted ? 'RUN_REQUEST_TIMEOUT' : 'RUN_SOURCE_UNAVAILABLE', message: aborted ? '运行记录请求已中止，可在许可有效期内用相同标识重试。' : '实验运行记录暂不可用，不影响实验运行。', retryable: true } })
}
export function experimentRunRoutes(deps: ExperimentRunHttpDependencies): ExperimentRunHttpHandler {
  if (deps.publicOrigin !== undefined) {
    const parsed = new URL(deps.publicOrigin)
    if (parsed.origin !== deps.publicOrigin || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Experiment run publicOrigin must be an exact HTTP(S) origin')
  }
  let active = 0
  return async (req, res) => {
    const abort = new AbortController(), stop = (): void => { abort.abort() }
    const closed = (): void => { if (!res.writableEnded) stop() }
    const timer = setTimeout(stop, deps.service.limits.requestTimeoutMs)
    req.once('aborted', stop); res.once('close', closed)
    let admitted = false
    try {
      const url = new URL(req.url ?? '/', 'http://experiment-run.invalid'), method = req.method ?? 'GET'
      if (url.search !== '') fail(400, 'BAD_RUN_QUERY', '实验运行接口不接受查询参数。')
      const capability = method === 'GET' && url.pathname === `${EXPERIMENT_RUN_PREFIX}/capabilities`
      const prepare = method === 'POST' && url.pathname === `${EXPERIMENT_RUN_PREFIX}/prepare`
      const record = method === 'POST' && url.pathname === `${EXPERIMENT_RUN_PREFIX}/record`
      if (!capability && !prepare && !record) fail(404, 'NOT_FOUND', '实验运行接口不存在。')
      const actor = actorOf(deps, req)
      sameOrigin(req, deps.publicOrigin, !capability)
      if (active >= deps.service.limits.maxInFlightRequests) fail(429, 'RUN_HTTP_BUSY', '实验运行记录服务繁忙，请稍后重试。')
      active++; admitted = true
      let value: unknown
      if (capability) value = deps.service.capabilities()
      else {
        if (single(req, 'x-physicsos-experiment-run-capability') !== EXPERIMENT_RUN_CAPABILITY) fail(426, 'RUN_CAPABILITY_REQUIRED', '请更新实验运行记录客户端。')
        const mediaType = single(req, 'content-type')
        if (mediaType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') fail(415, 'UNSUPPORTED_MEDIA_TYPE', '实验运行记录仅接受 JSON。')
        const body = await canvasReadJson(req, deps.service.limits.maxRequestBytes, abort.signal)
        const control = { signal: abort.signal, assertOwner: () => { checkOwner(deps, req, actor) } }
        value = prepare ? await deps.service.prepare(actor, body, control) : await deps.service.record(actor, body, control)
      }
      abort.signal.throwIfAborted(); checkOwner(deps, req, actor)
      if (!res.destroyed) canvasSend(res, 200, value)
    } catch (error) { sendError(res, error) }
    finally { if (admitted) active--; clearTimeout(timer); req.off('aborted', stop); res.off('close', closed) }
  }
}
