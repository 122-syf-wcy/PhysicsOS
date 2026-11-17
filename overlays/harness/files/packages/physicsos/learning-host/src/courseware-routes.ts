import type { IncomingMessage, ServerResponse } from 'node:http'
import { canvasActor, canvasJsonMutation, canvasReadJson, canvasResponseActor, canvasSend } from './canvas-http.ts'
import { CanvasError } from './canvas-error.ts'
import { coursewareWrapper } from './courseware-embed.ts'
import { coursewareId } from './courseware-domain.ts'
import type { CoursewareService } from './courseware-service.ts'
import { CoursewareError } from './courseware-types.ts'
import type { PhysicsosIdentity } from './identity.ts'
export const COURSEWARE_PREFIX = '/physicsos/courseware'
function bad(): never { throw new CoursewareError(404, 'NOT_FOUND', '课件接口不存在。') }
function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.destroyed) return
  if (error instanceof CoursewareError || error instanceof CanvasError) {
    canvasSend(res, error.status, { error: { status: error.status, code: error.code, message: error.message, retryable: error.status >= 500 || [408, 429].includes(error.status), ...(error.details ? { details: error.details } : {}) } }); return
  }
  const aborted = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
  canvasSend(res, aborted ? 408 : 503, { error: { status: aborted ? 408 : 503, code: aborted ? 'REQUEST_TIMEOUT' : 'UNAVAILABLE', message: aborted ? '课件请求超时，可用同一操作标识重试。' : '课件操作暂未完成；文件与草稿未截断，请稍后重试。', retryable: true } })
}
function html(res: ServerResponse, data: { readonly bytes: Uint8Array; readonly csp: string }): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': data.bytes.byteLength, 'content-security-policy': data.csp, 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()' })
  res.end(data.bytes)
}
export interface CoursewareHttpDependencies { readonly service: CoursewareService; readonly identity: () => PhysicsosIdentity | undefined; readonly publicOrigin?: string }
export type CoursewareHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
/** Prefix match is not route authorization. Every authenticated read/write rechecks cookie identity,
 * every mutation uses canvas-http's same-origin JSON/CSRF checks and optional expected-account refusal.
 * Only two exact, short-lived capability routes bypass cookies. They never provide a fetch proxy. */
export function coursewareRoutes(deps: CoursewareHttpDependencies): CoursewareHttpHandler {
  let active = 0
  return async (req, res) => {
    const abort = new AbortController(); const stop = (): void => abort.abort()
    const timer = setTimeout(stop, deps.service.config.limits.requestTimeoutMs)
    req.once('aborted', stop)
    let admitted = false
    try {
      if (!deps.service.config.enabled) throw new CoursewareError(404, 'FEATURE_DISABLED', '课件功能尚未启用。')
      if (active >= deps.service.config.limits.maxInFlightRequests) throw new CoursewareError(429, 'BUSY', '正在处理其它课件文件，请稍后重试。')
      active++; admitted = true
      const url = new URL(req.url ?? '/', 'http://courseware.invalid'); const path = url.pathname
      if (path !== COURSEWARE_PREFIX && !path.startsWith(`${COURSEWARE_PREFIX}/`)) bad()
      const tail = path.slice(COURSEWARE_PREFIX.length)
      if (tail.includes('//') || tail.endsWith('/') && tail !== '/') bad()
      let parts: string[]
      try { parts = tail.split('/').filter(Boolean).map(decodeURIComponent) } catch { throw new CoursewareError(400, 'BAD_PATH', '课件路径编码无效。') }
      const method = req.method ?? 'GET'
      const [first, second, third, fourth, fifth] = parts
      if (method === 'GET' && parts.length === 2 && ['embed', 'content'].includes(first ?? '')) {
        if (!second || !/^[A-Za-z0-9_-]{43}$/.test(second)) bad()
        if (first === 'content') {
          // A bearer URL is not permission to execute HTML in a top-level browsing context.
          // Script cannot forge Fetch Metadata. Old/unsupported browsers fail closed rather than
          // bypassing the trusted wrapper's exact frame-src self-navigation boundary.
          if (req.headers['sec-fetch-dest'] !== 'iframe' || req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-site'] !== 'same-origin') throw new CoursewareError(403, 'EMBED_CONTEXT_REQUIRED', '课件内容只能在受控同源 iframe 中执行，请从课件播放器打开。')
          const ticket = await deps.service.ticket(second)
          if (url.searchParams.getAll('cwNonce').length !== 1 || url.searchParams.get('cwNonce') !== ticket.nonce || url.searchParams.getAll('parentOrigin').length !== 1 || [...url.searchParams.keys()].some(key => !['cwNonce', 'parentOrigin'].includes(key))) throw new CoursewareError(403, 'EMBED_CONTEXT_REQUIRED', '课件嵌入上下文校验失败。')
          const parentOrigin = url.searchParams.get('parentOrigin')!
          try { const origin = new URL(parentOrigin); if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== parentOrigin || origin.host !== req.headers.host || deps.publicOrigin && origin.origin !== deps.publicOrigin) throw new Error('origin mismatch') } catch { throw new CoursewareError(403, 'EMBED_CONTEXT_REQUIRED', '课件嵌入来源无效。') }
          html(res, await deps.service.content(second, abort.signal)); return
        }
        const ticket = await deps.service.ticket(second)
        const host = req.headers.host
        if (typeof host !== 'string' || !/^(?:[A-Za-z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?$/.test(host)) throw new CoursewareError(400, 'BAD_HOST', '课件来源无效。')
        const encrypted = 'encrypted' in req.socket && req.socket.encrypted === true
        // Production's existing reverse proxy sets this single value. It cannot change the fixed Host/path.
        const protocol = encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:'
        const origin = deps.publicOrigin ?? `${protocol}//${host}`
        html(res, coursewareWrapper({ origin, contentPath: `${COURSEWARE_PREFIX}/content/${second}`, nonce: ticket.nonce })); return
      }
      if (req.headers.authorization !== undefined) throw new CoursewareError(403, 'COOKIE_ONLY', '课件功能只接受当前浏览器登录会话，不接受访问令牌。')
      if (typeof req.headers.cookie !== 'string' || req.headers.cookie.trim() === '') throw new CoursewareError(401, 'UNAUTHENTICATED', '请先登录后打开课件。')
      const actor = canvasActor(deps.identity(), req)
      if (method !== 'GET') {
        if (req.headers['x-physicsos-courseware-capability'] !== 'courseware-v1') throw new CoursewareError(426, 'CAPABILITY_REQUIRED', '请更新课件客户端后再修改，旧客户端不能写入此单元。')
        canvasJsonMutation(req)
      }
      const body = async (): Promise<unknown> => canvasReadJson(req, deps.service.maxRequestBytes, abort.signal)
      let value: unknown
      if (parts.length === 1 && first === 'capabilities' && method === 'GET') value = deps.service.capabilities(actor)
      else if (parts.length === 0 && method === 'GET') {
        const allowed = ['search', 'lifecycle', 'scope', 'cursor', 'limit']; for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new CoursewareError(400, 'BAD_QUERY', '课件筛选参数无效。')
        value = await deps.service.list(actor, { ...(url.searchParams.has('search') ? { search: url.searchParams.get('search')! } : {}), ...(url.searchParams.has('lifecycle') ? { lifecycle: url.searchParams.get('lifecycle')! } : {}), ...(url.searchParams.has('scope') ? { scope: url.searchParams.get('scope')! } : {}), ...(url.searchParams.has('cursor') ? { cursor: url.searchParams.get('cursor')! } : {}), ...(url.searchParams.has('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}) })
      } else if (parts.length === 0 && method === 'POST') value = await deps.service.import(actor, await body(), undefined, abort.signal)
      else {
        if (!first || !coursewareId.safeParse(first).success) bad()
        const deckId = first
        if (parts.length === 1 && method === 'GET') value = await deps.service.read(actor, deckId)
        else if (parts.length === 2 && second === 'versions' && method === 'POST') value = await deps.service.import(actor, await body(), deckId, abort.signal)
        else if (parts.length === 2 && second === 'activate' && method === 'POST') value = await deps.service.activate(actor, deckId, await body())
        else if (parts.length === 2 && second === 'manage' && method === 'POST') value = await deps.service.manage(actor, deckId, await body())
        else if (parts.length === 2 && second === 'tickets' && method === 'POST') {
          const raw = await body()
          if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || !('versionId' in raw) || !coursewareId.safeParse(raw.versionId).success) throw new CoursewareError(400, 'BAD_REQUEST', '课件播放请求无效。')
          value = await deps.service.issueTicket(actor, deckId, raw.versionId as string)
        } else if (parts.length === 3 && second === 'source' && third && coursewareId.safeParse(third).success && method === 'GET') {
          const bytes = await deps.service.source(actor, deckId, third, abort.signal)
          canvasResponseActor(deps.identity(), req, actor)
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.byteLength, 'content-disposition': 'attachment; filename="courseware-original.html"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes); return
        } else if (parts.length === 2 && second === 'lessons' && method === 'GET') {
          const versionId = url.searchParams.get('versionId'); if (!versionId || !coursewareId.safeParse(versionId).success || [...url.searchParams.keys()].some(key => key !== 'versionId') || url.searchParams.getAll('versionId').length !== 1) throw new CoursewareError(400, 'BAD_QUERY', '请指定准确课件版本。')
          value = await deps.service.listLessons(actor, deckId, versionId)
        } else if (parts.length === 2 && second === 'lessons' && method === 'POST') value = await deps.service.startLesson(actor, deckId, await body())
        else if (second === 'lessons' && third && coursewareId.safeParse(third).success) {
          if (parts.length === 3 && method === 'GET') value = await deps.service.readLesson(actor, deckId, third)
          else if (parts.length === 4 && fourth === 'blank-pages' && method === 'POST') value = await deps.service.addBlankPage(actor, deckId, third, await body())
          else if (parts.length === 5 && fourth === 'pages' && fifth && coursewareId.safeParse(fifth).success && method === 'GET') value = await deps.service.readAnnotation(actor, deckId, third, fifth)
          else if (parts.length === 5 && fourth === 'pages' && fifth && coursewareId.safeParse(fifth).success && method === 'PUT') value = await deps.service.saveAnnotation(actor, deckId, third, fifth, await body(), abort.signal)
          else bad()
        } else bad()
      }
      abort.signal.throwIfAborted(); canvasResponseActor(deps.identity(), req, actor)
      if (!res.destroyed) canvasSend(res, 200, value)
    } catch (error) { sendError(res, error) }
    finally { if (admitted) active--; clearTimeout(timer); req.off('aborted', stop) }
  }
}
