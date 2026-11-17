/** Private activity v1 routes; identity/tenant are resolved from the live session on EVERY request. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { CanvasError } from './canvas-error.ts'
import { canvasJsonMutation, canvasReadJson } from './canvas-http.ts'
import { LearningError, requireCookieActor, type IdentityActor, type PhysicsosIdentity } from './identity.ts'
import type { ActivityService } from './activity-service.ts'
import type { ActivityDateQuery, ActivityRankQuery } from './activity-types.ts'

export const ACTIVITY_PREFIX = '/physicsos/activity/v1'
export const ADMIN_ACTIVITY_PREFIX = '/physicsos/admin/activity/v1'
const OWNER_HEADER = 'x-physicsos-activity-owner'
const expectedWire = z.strictObject({ schoolId: z.string().min(1).max(64), username: z.string().min(1).max(128) })
export interface ActivityRouteDependencies { readonly service: ActivityService; readonly identity: () => PhysicsosIdentity | undefined }
const actorOf = (deps: ActivityRouteDependencies, req: IncomingMessage): IdentityActor => {
  const actor = requireCookieActor(deps.identity(), req), header = req.headers[OWNER_HEADER]
  if (header !== undefined) {
    const repetitions = req.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === OWNER_HEADER).length
    if (repetitions > 1 || typeof header !== 'string' || header.length > 2048) throw new LearningError(400, 'BAD_ACCOUNT_HEADER', '统计预期账号头无效。')
    let expected: z.infer<typeof expectedWire>
    try { expected = expectedWire.parse(JSON.parse(decodeURIComponent(header))) } catch { throw new LearningError(400, 'BAD_ACCOUNT_HEADER', '统计预期账号必须仅含schoolId和username。') }
    if (expected.schoolId !== actor.schoolId || expected.username !== actor.username) throw new LearningError(401, 'ACCOUNT_CHANGED', '账号已切换，请重新读取统计。')
  }
  return actor
}
const query = (url: URL, names: readonly string[]): Record<string, string> => {
  if (url.search.length > 2048) throw new LearningError(413, 'ACTIVITY_QUERY_BYTES', '统计筛选超过字节限制。')
  const result: Record<string, string> = {}
  for (const name of url.searchParams.keys()) {
    const values = url.searchParams.getAll(name)
    if (!names.includes(name) || values.length !== 1) throw new LearningError(400, 'BAD_REQUEST', '统计筛选重复或不受支持。')
    result[name] = values[0]!
  }
  return result
}
const dates = (raw: Record<string, string>): ActivityDateQuery => ({
  ...(raw.days === undefined ? {} : { days: Number(raw.days) as 1 | 7 | 30 | 90 }),
  ...(raw.to === undefined ? {} : { to: raw.to }),
})
const send = (res: ServerResponse, status: number, value: unknown): void => {
  if (res.destroyed || res.headersSent) return
  const data = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })
  res.end(data)
}
const sendError = (res: ServerResponse, error: unknown): void => {
  if (error instanceof LearningError || error instanceof CanvasError) send(res, error.status, { error: { code: error.code, message: error.message, retryable: error.status >= 500 || error.status === 408 || error.status === 429 } })
  else if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) send(res, 408, { error: { code: 'ACTIVITY_TIMEOUT', message: '统计请求已中止或超时。', retryable: true } })
  else send(res, 500, { error: { code: 'ACTIVITY_FAILED', message: '统计暂不可读取或持久化。', retryable: true } })
}
/** Mount BOTH prefixes above; there is intentionally no HTTP effective-use/success route. */
export function activityRoutes(deps: ActivityRouteDependencies): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const lifetime = new AbortController(), signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(deps.service.limits.requestTimeoutMs)])
    const abort = (): void => { lifetime.abort() }
    const close = (): void => { if (!res.writableEnded) abort() }
    req.once('aborted', abort); res.once('close', close)
    try {
      const actor = actorOf(deps, req), url = new URL(req.url ?? '/', 'http://activity.invalid')
      let result: unknown
      if (req.method === 'GET' && url.pathname === `${ACTIVITY_PREFIX}/capabilities`) {
        if (url.search !== '') throw new LearningError(400, 'BAD_REQUEST', '统计能力读取不接受查询参数。')
        result = deps.service.capabilities()
      } else if (req.method === 'POST' && url.pathname === `${ACTIVITY_PREFIX}/events`) {
        if (url.search !== '') throw new LearningError(400, 'BAD_REQUEST', '统计事件不接受查询参数。')
        canvasJsonMutation(req)
        result = await deps.service.recordClientEvent(actor, await canvasReadJson(req, deps.service.limits.maxRequestBytes, signal))
      } else if (req.method === 'GET' && url.pathname === `${ADMIN_ACTIVITY_PREFIX}/users`) {
        const raw = query(url, ['schoolId', 'username', 'days', 'to'])
        result = await deps.service.userDetail(actor, { schoolId: raw.schoolId ?? '', username: raw.username ?? '' }, dates(raw))
      } else if (req.method === 'GET' && url.pathname === `${ADMIN_ACTIVITY_PREFIX}/schools`) {
        const raw = query(url, ['schoolId', 'days', 'to', 'q', 'page', 'pageSize', 'sort', 'order'])
        const rank: ActivityRankQuery = { ...dates(raw), ...(raw.schoolId === undefined ? {} : { schoolId: raw.schoolId }), ...(raw.q === undefined ? {} : { q: raw.q }), ...(raw.page === undefined ? {} : { page: Number(raw.page) }), ...(raw.pageSize === undefined ? {} : { pageSize: Number(raw.pageSize) }), ...(raw.sort === undefined ? {} : { sort: raw.sort as NonNullable<ActivityRankQuery['sort']> }), ...(raw.order === undefined ? {} : { order: raw.order as NonNullable<ActivityRankQuery['order']> }) }
        result = await deps.service.schoolRanking(actor, rank)
      } else throw new LearningError(404, 'NOT_FOUND', '统计路由不存在。')
      const current = actorOf(deps, req)
      if (current.userKey !== actor.userKey || current.schoolId !== actor.schoolId || current.username !== actor.username || current.role !== actor.role) throw new LearningError(401, 'ACCOUNT_CHANGED', '请求期间账号或权限已变化，旧统计不会返回。')
      signal.throwIfAborted(); send(res, 200, result)
    } catch (error) { sendError(res, error) } finally { req.off('aborted', abort); res.off('close', close) }
  }
}
