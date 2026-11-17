import type { IncomingMessage, ServerResponse } from 'node:http'
import { canvasActor, canvasJsonMutation, canvasReadJson, canvasResponseActor, canvasSend } from './canvas-http.ts'
import { CanvasError } from './canvas-error.ts'
import { LearningError, type PhysicsosIdentity } from './identity.ts'
import { WhiteboardError, type WhiteboardService } from './whiteboard-service.ts'
export const WHITEBOARD_PREFIX = '/physicsos/whiteboards'
/** Exact owned REST routes. Cookie authority is resolved again before any response. */
export function whiteboardRoutes(deps: { readonly service: WhiteboardService; readonly identity: () => PhysicsosIdentity | undefined }): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const controller = new AbortController()
    const aborted = () => controller.abort()
    const timer = setTimeout(aborted, 120000)
    req.once('aborted', aborted)
    try {
      const url = new URL(req.url ?? '/', 'http://whiteboard.invalid')
      const pathname = url.pathname
      if (pathname !== WHITEBOARD_PREFIX && !pathname.startsWith(`${WHITEBOARD_PREFIX}/`)) throw new LearningError(404, 'NOT_FOUND', '画板接口不存在。')
      let segments: string[]
      try { segments = pathname.slice(WHITEBOARD_PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent) } catch { throw new LearningError(400, 'BAD_PATH', '画板路径无效。') }
      const actor = canvasActor(deps.identity(), req)
      const method = req.method ?? 'GET'
      const body = async () => { canvasJsonMutation(req); return canvasReadJson(req, deps.service.maxRequestBytes, controller.signal) }
      let value: unknown
      const boardId = segments[0]
      if (!segments.length && method === 'GET') {
        if (url.searchParams.getAll('state').length > 1) throw new LearningError(400, 'WHITEBOARD_BAD_REQUEST', '画板列表状态不能重复。')
        value = await deps.service.list(actor, url.searchParams.get('state') ?? 'active')
      }
      else if (segments.length === 1 && boardId === 'capabilities' && method === 'GET') value = deps.service.capabilities()
      else if (!segments.length && method === 'POST') value = await deps.service.create(actor, await body())
      else if (boardId && segments.length === 2 && segments[1] === 'retained' && method === 'GET') value = await deps.service.readRetained(actor, boardId)
      else if (boardId && segments.length === 1 && method === 'GET') value = await deps.service.read(actor, boardId)
      else if (boardId && segments.length === 1 && method === 'PUT') value = await deps.service.save(actor, boardId, await body())
      else if (boardId && segments.length === 1 && method === 'DELETE') value = await deps.service.delete(actor, boardId, await body())
      else if (boardId && segments.length === 2 && method === 'POST' && segments[1] === 'archive') value = await deps.service.archive(actor, boardId, await body())
      else if (boardId && segments.length === 2 && method === 'POST' && segments[1] === 'unarchive') value = await deps.service.unarchive(actor, boardId, await body())
      else if (boardId && segments.length === 2 && method === 'POST' && segments[1] === 'restore') value = await deps.service.restore(actor, boardId, await body())
      else if (boardId && segments.length === 2 && method === 'POST' && segments[1] === 'copy') value = await deps.service.copy(actor, boardId, await body())
      else if (boardId && segments.length === 2 && segments[1] === 'images' && method === 'POST') value = await deps.service.upload(actor, boardId, await body())
      else if (boardId && segments.length === 3 && segments[1] === 'images' && method === 'GET') value = await deps.service.readImage(actor, boardId, segments[2]!)
      else if (boardId && segments.length === 2 && segments[1] === 'generations' && method === 'POST') value = await deps.service.generate(actor, boardId, await body())
      else if (boardId && segments.length === 3 && segments[1] === 'generations' && method === 'GET') value = await deps.service.readGeneration(actor, boardId, segments[2]!)
      else if (boardId && segments.length === 4 && segments[1] === 'generations' && segments[3] === 'cancel' && method === 'POST') value = await deps.service.cancelGeneration(actor, boardId, segments[2]!, await body())
      else throw new LearningError(404, 'NOT_FOUND', '画板接口不存在。')
      canvasResponseActor(deps.identity(), req, actor)
      if (!res.destroyed) canvasSend(res, 200, value)
    } catch (error) {
      if (res.destroyed || res.headersSent) return
      if (error instanceof WhiteboardError) canvasSend(res, error.status, { error: error.message, code: error.code, ...(error.currentHead === undefined ? {} : { currentHead: error.currentHead }) })
      else if (error instanceof LearningError) canvasSend(res, error.status, { error: error.message, code: error.code })
      else if (error instanceof CanvasError && error.status < 500) canvasSend(res, error.status, { error: error.status === 401 ? '未登录或会话已变化，请重新登录。' : error.status === 403 ? '请求来源无效。' : error.status === 413 ? '完整画板或原图超过保存大小限制；数据未截断。' : '画板请求无效。' })
      else canvasSend(res, controller.signal.aborted ? 408 : 503, { error: '画板操作暂未完成，修改已保留，请稍后重试。' })
    } finally { clearTimeout(timer); req.off('aborted', aborted) }
  }
}
