/**
 * REST surface for the PhysicsOS 账户体系 — one `/physicsos/auth` prefix route
 * on the webServer service dispatching to AuthService. Every failure answers
 * the same `{error:{code,message}}` envelope; cookies are the only session
 * carrier (the wire never returns the raw token). Bodies are capped and
 * JSON-only, and state-changing verbs carry the origin/fetch-site CSRF gate.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthError, type AdminActor, type AuthService } from './service.ts'
import { readSessionCookie, writeSessionCookie } from './cookies.ts'
import { userKey } from './domain.ts'

const BODY_LIMIT = 16 * 1024

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const sendError = (res: ServerResponse, error: unknown): void => {
  if (error instanceof AuthError) {
    send(res, error.status, {
      error: { code: error.code, message: error.message, ...error.details },
    })
    return
  }
  send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
}

/** Path segment `index`; a shorter path than the route matched answers 400. */
const segment = (parts: readonly string[], index: number): string => {
  const value = parts[index]
  if (value === undefined) throw new AuthError(400, 'BAD_REQUEST', '路径缺少参数')
  return value
}

/** Reads a capped JSON body; over-limit and non-JSON fail as BAD_REQUEST. */
const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_LIMIT) throw new AuthError(400, 'BAD_REQUEST', '请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new AuthError(400, 'BAD_REQUEST', '请求不是合法 JSON')
  }
}

/**
 * CSRF gate for POSTs: cookie auth + same-origin fetch means a cross-site
 * form cannot send `content-type: application/json`, and any Origin header
 * that does appear must match the request's own host.
 */
const checkCsrf = (req: IncomingMessage): void => {
  const type = req.headers['content-type'] ?? ''
  if (!type.startsWith('application/json')) {
    throw new AuthError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
  const origin = req.headers['origin']
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        throw new AuthError(403, 'BAD_REQUEST', '跨站请求被拒绝')
      }
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError(403, 'BAD_REQUEST', '跨站请求被拒绝')
    }
  }
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string'
    && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    throw new AuthError(403, 'BAD_REQUEST', '跨站请求被拒绝')
  }
}

/** Best-effort client address for rate-limit buckets. */
const clientIp = (req: IncomingMessage): string => {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]
    if (first !== undefined && first.length > 0) return first.trim()
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/**
 * The `/physicsos/auth` prefix handler.
 * @param service - the auth domain service.
 * @returns the webServer route handler.
 */
export function authRoutes(service: AuthService):
(req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/auth/, '') || '/'
      const method = req.method ?? 'GET'
      const ip = clientIp(req)
      const userAgent = req.headers['user-agent']

      if (method === 'POST' && path === '/register') {
        checkCsrf(req)
        const result = await service.register(await readJson(req), ip, userAgent)
        writeSessionCookie(req, res, result.token, result.cookieMaxAge)
        const { user } = result
        send(res, 201, { user })
        return
      }

      if (method === 'POST' && path === '/login') {
        checkCsrf(req)
        const result = await service.login(await readJson(req), ip, userAgent)
        writeSessionCookie(req, res, result.token, result.cookieMaxAge)
        const { user } = result
        send(res, 200, { user })
        return
      }

      if (method === 'POST' && path === '/logout') {
        await service.logout(readSessionCookie(req))
        writeSessionCookie(req, res, null, 0)
        send(res, 200, { ok: true })
        return
      }

      if (method === 'GET' && path === '/me') {
        const token = readSessionCookie(req)
        const resolved = token === null ? null : service.resolveSession(token)
        if (resolved === null) {
          throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        }
        send(res, 200, { user: resolved.user })
        return
      }

      /* ---- 学习上报(匿名聚合)-----------------------------------------
         任何已登录账号都可以上报一次自测的对错 —— 学生就是上报的人,所以门槛
         是「有会话」而不是「是老师」。落库的行里没有账号:学校从会话取,日期
         从服务端时钟取,请求体只有知识点 id(课标闭集形状)与这一次对错。 */
      if (method === 'POST' && path === '/usage/learning') {
        checkCsrf(req)
        const token = readSessionCookie(req)
        const resolved = token === null ? null : service.resolveSession(token)
        if (resolved === null) {
          throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        }
        const { user } = resolved
        const cell = await service.reportLearning({
          userKey: userKey(user.schoolId, user.username),
          schoolId: user.schoolId,
          username: user.username,
          role: user.role,
        }, await readJson(req))
        send(res, 201, { cell })
        return
      }

      if (method === 'POST' && path === '/password/forgot') {
        checkCsrf(req)
        await service.requestPasswordReset(await readJson(req), ip)
        /* Uniform receipt — never reveals whether the account exists. */
        send(res, 200, { ok: true })
        return
      }

      /* 申请加入: anonymous by design (the applicant has no account yet); the
         live session — when one exists — only attributes the request. */
      if (method === 'POST' && path === '/school-requests') {
        checkCsrf(req)
        const token = readSessionCookie(req)
        const resolved = token === null ? null : service.resolveSession(token)
        const requestedBy = resolved === null
          ? null
          : userKey(resolved.user.schoolId, resolved.user.username)
        const request = await service.submitSchoolRequest(await readJson(req), requestedBy, ip)
        send(res, 201, { request })
        return
      }

      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
      return
    } catch (error) {
      sendError(res, error)
    }
  }
}

/**
 * The `/physicsos/admin` prefix handler. Every request resolves the session
 * into the server-authoritative actor first — role and tenant come from the
 * session row, never from the wire — then dispatches to AuthService, which
 * owns the role/tenant enforcement and the audit ledger.
 * @param service - the auth domain service.
 * @returns the webServer route handler.
 */
export function adminRoutes(service: AuthService):
(req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/admin/, '') || '/'
      const method = req.method ?? 'GET'
      const segments = path.split('/').filter(Boolean)

      const token = readSessionCookie(req)
      const resolved = token === null ? null : service.resolveSession(token)
      if (resolved === null) {
        throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
      }
      const actor: AdminActor = {
        userKey: userKey(resolved.user.schoolId, resolved.user.username),
        schoolId: resolved.user.schoolId,
        username: resolved.user.username,
        role: resolved.user.role,
      }

      if (method === 'GET' && path === '/school-requests') {
        send(res, 200, {
          requests: service.listSchoolRequests(
            actor, url.searchParams.get('status') ?? undefined),
        })
        return
      }

      if (method === 'POST' && segments[0] === 'school-requests' && segments.length === 3) {
        checkCsrf(req)
        const id = segments[1]
        const verb = segments[2]
        if (id !== undefined && verb === 'approve') {
          send(res, 200, await service.approveSchoolRequest(actor, id, await readJson(req)))
          return
        }
        if (id !== undefined && verb === 'reject') {
          send(res, 200, {
            request: await service.rejectSchoolRequest(actor, id, await readJson(req)),
          })
          return
        }
      }

      if (method === 'GET' && path === '/schools') {
        send(res, 200, { schools: service.listSchoolsAdmin(actor) })
        return
      }

      if (method === 'POST' && path === '/schools') {
        checkCsrf(req)
        send(res, 201, { school: await service.createSchool(actor, await readJson(req)) })
        return
      }

      if (method === 'POST' && segments[0] === 'schools' && segments[2] === 'status') {
        checkCsrf(req)
        send(res, 200, {
          school: await service.setSchoolStatus(actor, segment(segments, 1), await readJson(req)),
        })
        return
      }

      if (method === 'GET' && path === '/users') {
        /* Narrow each filter where it is read — repeating `searchParams.get`
           inside the spread would discard the null check. */
        const filters: { schoolId?: string; role?: string; q?: string } = {}
        const schoolId = url.searchParams.get('schoolId')
        if (schoolId !== null) filters.schoolId = schoolId
        const role = url.searchParams.get('role')
        if (role !== null) filters.role = role
        const q = url.searchParams.get('q')
        if (q !== null) filters.q = q
        send(res, 200, { users: service.listUsers(actor, filters) })
        return
      }

      if (method === 'POST' && path === '/users') {
        checkCsrf(req)
        send(res, 201, { user: await service.createUser(actor, await readJson(req)) })
        return
      }

      /* The user path key is `schoolId:username` — schoolId's wire alphabet
         excludes ':', so the first colon is an unambiguous split point. */
      if (method === 'POST' && segments[0] === 'users' && segments.length === 3) {
        checkCsrf(req)
        const key = decodeURIComponent(segment(segments, 1))
        const split = key.indexOf(':')
        if (split > 0) {
          const schoolId = key.slice(0, split)
          const username = key.slice(split + 1)
          const verb = segments[2]
          if (verb === 'status') {
            send(res, 200, {
              user: await service.setUserStatus(actor, schoolId, username, await readJson(req)),
            })
            return
          }
          if (verb === 'reset-password') {
            await service.resetUserPassword(actor, schoolId, username, await readJson(req))
            send(res, 200, { ok: true })
            return
          }
          if (verb === 'revoke-sessions') {
            await service.revokeUserSessionsByAdmin(actor, schoolId, username)
            send(res, 200, { ok: true })
            return
          }
        }
      }

      if (method === 'GET' && path === '/dashboard') {
        send(res, 200, service.dashboard(actor))
        return
      }

      if (method === 'GET' && path === '/audit') {
        const limitParam = url.searchParams.get('limit')
        const scope: { schoolId?: string; limit?: number } = {}
        const schoolId = url.searchParams.get('schoolId')
        if (schoolId !== null) scope.schoolId = schoolId
        if (limitParam !== null) scope.limit = Number(limitParam)
        send(res, 200, { events: service.listAudit(actor, scope) })
        return
      }

      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
      return
    } catch (error) {
      sendError(res, error)
    }
  }
}
