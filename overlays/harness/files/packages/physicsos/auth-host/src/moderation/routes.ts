import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthError } from '../service.ts'
import type { AuthService } from '../service.ts'
import { checkCsrf, readJson } from '../routes.ts'
import type { ModerationService } from './service.ts'
import type { ModerationDecision, ModerationEnabled, ModerationStatus, ModerationRetry } from './types.ts'

/** Cookie-only SUPER_ADMIN prefix handler, shared JSON/CSRF conventions and private responses. */
export function moderationRoutes(service: ModerationService, auth: AuthService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' })
      res.end(JSON.stringify(body))
    }
    try {
      if (req.headers.authorization !== undefined) throw new AuthError(401, 'UNAUTHENTICATED', '审核接口仅接受 Cookie 会话')
      const resolved = auth.resolveCredential(req.headers.cookie, undefined)
      if (!resolved || resolved.credential.kind !== 'session') throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
      const actor = resolved.actor
      if (actor.role !== 'SUPER_ADMIN') throw new AuthError(403, 'FORBIDDEN', '需要平台管理员权限')
      const url = new URL(req.url ?? '/', 'http://x')
      const prefix = '/physicsos/admin/moderation'
      if (!url.pathname.startsWith(`${prefix}/`)) throw new AuthError(404, 'NOT_FOUND', '接口不存在')
      const path = url.pathname.slice(prefix.length)
      const method = req.method ?? 'GET'
      const parts = path.split('/').filter(Boolean)
      if (method === 'GET' && path === '/cases') {
        send(200, service.list(actor, {
          ...(url.searchParams.has('page') ? { page: Number(url.searchParams.get('page')) } : {}),
          ...(url.searchParams.has('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
          ...(url.searchParams.has('status') ? { status: url.searchParams.get('status') as ModerationStatus } : {}),
        })); return
      }
      if (method === 'GET' && parts[0] === 'cases' && parts.length === 2) {
        send(200, service.detail(actor, parts[1]!)); return
      }
      if (method === 'GET' && path === '/settings') { send(200, service.settings(actor)); return }
      if (method === 'POST') {
        checkCsrf(req, auth.config.trustedProxies ?? [])
        const body = await readJson(req)
        if (path === '/settings') { send(200, await service.setEnabled(actor, body as ModerationEnabled)); return }
        if (path === '/scan') { send(200, await service.scan(actor)); return }
        if (parts[0] === 'cases' && parts.length === 3) {
          if (parts[2] === 'decision') { send(200, await service.decide(actor, parts[1]!, body as ModerationDecision)); return }
          if (parts[2] === 'retry') { send(200, await service.retry(actor, parts[1]!, body as ModerationRetry)); return }
        }
      }
      throw new AuthError(404, 'NOT_FOUND', '接口不存在')
    } catch (error) {
      if (res.headersSent) { res.end(); return }
      if (error instanceof AuthError) send(error.status, { error: { code: error.code, message: error.message } })
      else send(500, { error: { code: 'INTERNAL', message: 'internal error' } })
    }
  }
}
