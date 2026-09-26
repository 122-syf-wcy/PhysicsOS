/**
 * REST surface for the PhysicsOS 账户体系 — one `/physicsos/auth` prefix route
 * on the webServer service dispatching to AuthService. Every failure answers
 * the same `{error:{code,message}}` envelope; cookies are the only session
 * carrier (the wire never returns the raw token). Bodies are capped and
 * JSON-only, and state-changing verbs carry the origin/fetch-site CSRF gate.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AuthError,
  type AdminActor,
  type AuthService,
  type ResolvedCredential,
} from './service.ts'
import { readSessionCookie, writeSessionCookie } from './cookies.ts'
import { userKey } from './domain.ts'
import { clientAddress, requestScheme } from './proxy.ts'

const BODY_LIMIT = 16 * 1024

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const sendError = (res: ServerResponse, error: unknown): void => {
  if (res.headersSent) {
    res.end()
    return
  }
  if (error instanceof AuthError) {
    send(res, error.status, {
      error: { code: error.code, message: error.message, ...error.details },
    })
    return
  }
  send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
}

const credentialOf = (
  service: AuthService,
  req: IncomingMessage,
): ResolvedCredential | null => service.resolveCredential(
  req.headers.cookie,
  req.headers.authorization,
)

const sessionCredentialOf = (
  service: AuthService,
  req: IncomingMessage,
): ResolvedCredential | null => service.resolveCredential(req.headers.cookie, undefined)

const actorOf = (resolved: ResolvedCredential): AdminActor => resolved.actor

const requireWriteCredential = (resolved: ResolvedCredential): void => {
  if (resolved.credential.kind === 'api-token' && resolved.credential.scope !== 'write') {
    throw new AuthError(403, 'TOKEN_SCOPE_REQUIRED', '该令牌只有只读权限')
  }
}

const requireSessionCredential = (resolved: ResolvedCredential): void => {
  if (resolved.credential.kind !== 'session') {
    throw new AuthError(403, 'FORBIDDEN', '该操作需要登录会话')
  }
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
const checkCsrf = (req: IncomingMessage, trustedProxies: readonly string[]): void => {
  const type = req.headers['content-type']
  if (typeof type !== 'string'
    || type.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new AuthError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
  const origin = req.headers['origin']
  if (origin !== undefined) {
    try {
      const host = req.headers.host
      const expected = host === undefined
        ? ''
        : new URL(`${requestScheme(req, trustedProxies)}://${host}`).origin
      if (typeof origin !== 'string' || new URL(origin).origin !== expected) {
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

/** RFC 4180 cell plus a spreadsheet-formula guard for exported text fields. */
const csvCell = (value: string | undefined): string => {
  let text = value ?? ''
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** Best-effort client address for rate-limit buckets. */
const clientIp = (req: IncomingMessage, trustedProxies: readonly string[]): string =>
  clientAddress(req, trustedProxies)

/**
 * The `/physicsos/auth` prefix handler.
 * @param service - the auth domain service.
 * @returns the webServer route handler.
 */
export function authRoutes(service: AuthService):
(req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const trustedProxies = service.config.trustedProxies ?? []
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/auth/, '') || '/'
      const method = req.method ?? 'GET'
      const ip = clientIp(req, trustedProxies)
      const userAgent = req.headers['user-agent']

      if (method === 'POST' && path === '/register') {
        checkCsrf(req, trustedProxies)
        const result = await service.register(await readJson(req), ip, userAgent)
        writeSessionCookie(req, res, result.token, result.cookieMaxAge, trustedProxies)
        const { user } = result
        send(res, 201, { user })
        return
      }

      if (method === 'POST' && path === '/login') {
        checkCsrf(req, trustedProxies)
        const result = await service.login(await readJson(req), ip, userAgent)
        if ('twoFactorRequired' in result) {
          send(res, 200, result)
          return
        }
        writeSessionCookie(req, res, result.token, result.cookieMaxAge, trustedProxies)
        send(res, 200, { user: result.user })
        return
      }

      if (method === 'POST' && path === '/login/2fa') {
        checkCsrf(req, trustedProxies)
        const result = await service.loginTwoFactor(await readJson(req), ip, userAgent)
        writeSessionCookie(req, res, result.token, result.cookieMaxAge, trustedProxies)
        send(res, 200, { user: result.user })
        return
      }

      if (method === 'POST' && path === '/logout') {
        checkCsrf(req, trustedProxies)
        await service.logout(readSessionCookie(req))
        writeSessionCookie(req, res, null, 0, trustedProxies)
        send(res, 200, { ok: true })
        return
      }

      if (method === 'GET' && path === '/me') {
        const resolved = credentialOf(service, req)
        if (resolved === null) {
          throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        }
        send(res, 200, { user: resolved.user })
        return
      }

      if (method === 'POST' && path === '/2fa/setup') {
        checkCsrf(req, trustedProxies)
        const resolved = sessionCredentialOf(service, req)
        if (resolved === null) throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        requireSessionCredential(resolved)
        send(res, 200, await service.startTotpSetup(actorOf(resolved)))
        return
      }

      if (method === 'POST' && path === '/2fa/enable') {
        checkCsrf(req, trustedProxies)
        const resolved = sessionCredentialOf(service, req)
        if (resolved === null) throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        requireSessionCredential(resolved)
        send(res, 200, await service.enableTotp(actorOf(resolved), await readJson(req)))
        return
      }

      if (method === 'POST' && path === '/2fa/verify') {
        checkCsrf(req, trustedProxies)
        const resolved = sessionCredentialOf(service, req)
        if (resolved === null) throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        requireSessionCredential(resolved)
        await service.verifyTotpForActor(actorOf(resolved), await readJson(req))
        send(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && path === '/2fa/disable') {
        checkCsrf(req, trustedProxies)
        const resolved = sessionCredentialOf(service, req)
        if (resolved === null) throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        requireSessionCredential(resolved)
        await service.disableTotp(actorOf(resolved), await readJson(req))
        send(res, 200, { ok: true })
        return
      }

      if (method === 'GET' && path === '/api-tokens') {
        const resolved = sessionCredentialOf(service, req)
        if (resolved === null) throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        requireSessionCredential(resolved)
        send(res, 200, service.listApiTokens(actorOf(resolved)))
        return
      }

      if (method === 'POST' && path === '/api-tokens') {
        checkCsrf(req, trustedProxies)
        const resolved = sessionCredentialOf(service, req)
        if (resolved === null) throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        requireSessionCredential(resolved)
        send(res, 201, await service.createApiToken(actorOf(resolved), await readJson(req)))
        return
      }

      if (method === 'POST' && path.split('/').filter(Boolean)[0] === 'api-tokens') {
        const segments = path.split('/').filter(Boolean)
        if (segments.length === 3 && segments[2] === 'revoke') {
          checkCsrf(req, trustedProxies)
          const resolved = sessionCredentialOf(service, req)
          if (resolved === null) throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
          requireSessionCredential(resolved)
          send(res, 200, {
            token: await service.revokeApiToken(
              actorOf(resolved),
              decodeURIComponent(segment(segments, 1)),
            ),
          })
          return
        }
      }

      /* ---- 学习上报(匿名聚合)-----------------------------------------
         任何已登录账号都可以上报一次自测的对错 —— 学生就是上报的人,所以门槛
         是「有会话」而不是「是老师」。落库的行里没有账号:学校从会话取,日期
         从服务端时钟取,请求体只有知识点 id(课标闭集形状)与这一次对错。 */
      if (method === 'POST' && path === '/usage/learning') {
        checkCsrf(req, trustedProxies)
        const resolved = credentialOf(service, req)
        if (resolved === null) {
          throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        }
        requireWriteCredential(resolved)
        const cell = await service.reportLearning(actorOf(resolved), await readJson(req))
        send(res, 201, { cell })
        return
      }

      /* ---- 设备登记 -----------------------------------------------------
         已登录账号登记 / 刷新「这台机器」。deviceId 必须是哈希形状(由 wire 的
         正则钉住),账号与学校都取自会话 —— 请求体说不上话。幂等:再见只刷新
         最近活跃时间与次数。被注销的设备在这里返回 403,不悄悄复活。 */
      if (method === 'POST' && path === '/devices') {
        checkCsrf(req, trustedProxies)
        const resolved = credentialOf(service, req)
        if (resolved === null) {
          throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
        }
        requireWriteCredential(resolved)
        const device = await service.registerOwnDevice(actorOf(resolved), await readJson(req))
        send(res, 200, { device })
        return
      }

      if (method === 'POST' && path === '/password/forgot') {
        checkCsrf(req, trustedProxies)
        await service.requestPasswordReset(await readJson(req), ip)
        /* Uniform receipt — never reveals whether the account exists. */
        send(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && path === '/password/reset') {
        checkCsrf(req, trustedProxies)
        await service.submitPasswordReset(await readJson(req), ip)
        send(res, 200, { ok: true })
        return
      }

      /* 申请加入: anonymous by design (the applicant has no account yet); the
         live session — when one exists — only attributes the request. */
      if (method === 'POST' && path === '/school-requests') {
        checkCsrf(req, trustedProxies)
        const resolved = credentialOf(service, req)
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
  const trustedProxies = service.config.trustedProxies ?? []
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/admin/, '') || '/'
      const method = req.method ?? 'GET'
      const segments = path.split('/').filter(Boolean)

      const resolved = credentialOf(service, req)
      if (resolved === null) {
        throw new AuthError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
      }
      if (method === 'POST') requireWriteCredential(resolved)
      const actor: AdminActor = actorOf(resolved)

      if (method === 'GET' && path === '/school-requests') {
        send(res, 200, {
          requests: service.listSchoolRequests(
            actor, url.searchParams.get('status') ?? undefined),
        })
        return
      }

      if (method === 'POST' && segments[0] === 'school-requests' && segments.length === 3) {
        checkCsrf(req, trustedProxies)
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
        checkCsrf(req, trustedProxies)
        send(res, 201, { school: await service.createSchool(actor, await readJson(req)) })
        return
      }

      if (method === 'POST' && segments[0] === 'schools' && segments[2] === 'status') {
        checkCsrf(req, trustedProxies)
        send(res, 200, {
          school: await service.setSchoolStatus(actor, segment(segments, 1), await readJson(req)),
        })
        return
      }

      if (method === 'GET' && path === '/invites') {
        const scope: { schoolId?: string; limit?: number } = {}
        const schoolId = url.searchParams.get('schoolId')
        if (schoolId !== null) scope.schoolId = schoolId
        const limit = url.searchParams.get('limit')
        if (limit !== null) scope.limit = Number(limit)
        send(res, 200, service.listInvites(actor, scope))
        return
      }

      if (method === 'POST' && path === '/invites') {
        checkCsrf(req, trustedProxies)
        send(res, 201, await service.createInvites(actor, await readJson(req)))
        return
      }

      if (method === 'POST' && segments[0] === 'invites' && segments.length === 3
        && segments[2] === 'disable') {
        checkCsrf(req, trustedProxies)
        await readJson(req)
        send(res, 200, {
          invite: await service.disableInvite(actor, decodeURIComponent(segment(segments, 1))),
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
        checkCsrf(req, trustedProxies)
        send(res, 201, { user: await service.createUser(actor, await readJson(req)) })
        return
      }

      /* The user path key is `schoolId:username` — schoolId's wire alphabet
         excludes ':', so the first colon is an unambiguous split point. */
      if (method === 'POST' && segments[0] === 'users' && segments.length === 3) {
        checkCsrf(req, trustedProxies)
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

      if (method === 'GET' && path === '/devices') {
        const filters: { schoolId?: string; q?: string } = {}
        const schoolId = url.searchParams.get('schoolId')
        if (schoolId !== null) filters.schoolId = schoolId
        const q = url.searchParams.get('q')
        if (q !== null) filters.q = q
        send(res, 200, service.listDevices(actor, filters))
        return
      }

      /* 注销 / 恢复。设备哈希是**物理机器**的身份,所以路径里就是它自己,不是
         某一行;租户隔离与审计都在 service 里。 */
      if (method === 'POST' && segments[0] === 'devices' && segments.length === 3
        && segments[2] === 'revoked') {
        checkCsrf(req, trustedProxies)
        const body = await readJson(req)
        const revoked = (body as { revoked?: unknown }).revoked
        if (typeof revoked !== 'boolean') {
          throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
        }
        send(res, 200, await service.setDeviceRevoked(
          actor, decodeURIComponent(segment(segments, 1)), revoked,
        ))
        return
      }

      if (method === 'GET' && path === '/password-resets') {
        const filters: { status?: string; schoolId?: string; q?: string; limit?: number } = {}
        const status = url.searchParams.get('status')
        if (status !== null) filters.status = status
        const schoolId = url.searchParams.get('schoolId')
        if (schoolId !== null) filters.schoolId = schoolId
        const q = url.searchParams.get('q')
        if (q !== null) filters.q = q
        const limit = url.searchParams.get('limit')
        if (limit !== null) filters.limit = Number(limit)
        send(res, 200, service.listPasswordResets(actor, filters))
        return
      }

      if (method === 'POST' && segments[0] === 'password-resets' && segments.length === 3) {
        checkCsrf(req, trustedProxies)
        const id = decodeURIComponent(segment(segments, 1))
        if (segments[2] === 'issue') {
          send(res, 200, await service.issuePasswordReset(actor, id))
          return
        }
        if (segments[2] === 'cancel') {
          send(res, 200, { request: await service.cancelPasswordReset(actor, id) })
          return
        }
      }

      if (method === 'GET' && path === '/dashboard') {
        send(res, 200, await service.dashboard(actor))
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

      if (method === 'POST' && path === '/audit/export') {
        checkCsrf(req, trustedProxies)
        const prepared = service.prepareAuditExport(actor, await readJson(req))
        const extension = prepared.format
        res.writeHead(200, {
          'content-type': prepared.format === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/x-ndjson; charset=utf-8',
          'content-disposition': `attachment; filename="physicsos-audit.${extension}"`,
          'cache-control': 'no-store',
        })
        if (prepared.format === 'csv') {
          res.write('actorKey,schoolId,action,target,detail,createdAt\n')
        }
        for (const event of prepared.stream) {
          if (prepared.format === 'csv') {
            res.write([
              csvCell(event.actorKey),
              csvCell(event.schoolId),
              csvCell(event.action),
              csvCell(event.target),
              csvCell(event.detail === undefined ? '' : JSON.stringify(event.detail)),
              csvCell(event.createdAt),
            ].join(',') + '\n')
          } else {
            res.write(`${JSON.stringify(event)}\n`)
          }
        }
        res.end()
        return
      }

      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
      return
    } catch (error) {
      sendError(res, error)
    }
  }
}
