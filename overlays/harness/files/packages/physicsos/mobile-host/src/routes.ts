/**
 * Route table for `/physicsos/mobile/v1`.
 *
 * One prefix, one dispatcher. Every handler is a thin adapter: resolve the
 * device principal, call the business facade that already owns the rule, and
 * wrap the answer in the mobile envelope. Nothing here re-implements password,
 * grading, membership or publication policy.
 *
 * @module @deepseek-ai/dsh-mobile-host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  MOBILE_PREFIX,
  MobileApiError,
  listQuery,
  mutationIdOf,
  readJson,
  requireStudent,
  sendData,
  sendFailure,
  type IdentityActor,
  type MobileAuthFacade,
  type MobileClassFacade,
  type MobileLearningFacade,
  type MobileNoticeFacade,
  type MobilePaperFacade,
  type MobilePushFacade,
  type ResolvedMobile,
} from './contract.ts'

/** Attempt bodies are small; a saved scene carries the whole checkpoint. */
const ATTEMPT_BODY_LIMIT = 32 * 1024
const SCENE_BODY_LIMIT = 2 * 1024 * 1024
const DEFAULT_BODY_LIMIT = 64 * 1024

/** Everything this host composes; each dependency is optional so boot order never breaks. */
export interface RouteDeps {
  auth: () => MobileAuthFacade | undefined
  learning: () => MobileLearningFacade | undefined
  classes: () => MobileClassFacade | undefined
  paper: () => MobilePaperFacade | undefined
  notice: () => MobileNoticeFacade | undefined
  push: () => MobilePushFacade | undefined
  /** Export sections this deployment can actually produce, in the app's expected order. */
  exports: () => readonly ExportSection[]
  /** Trusted proxy addresses for the auth host's rate-limit keys. */
  clientIp: (req: IncomingMessage) => string | undefined
  /** Account erasure fan-out across the composed domains. */
  erase: (request: ErasureRequest) => Promise<'deleted' | 'deletion_pending'>
}

/** One exportable section; `rows` is called per page so memory stays bounded. */
export interface ExportSection {
  readonly id: string
  rows(actor: IdentityActor): readonly Record<string, unknown>[]
}

/** Exact account incarnation an erasure request is bound to. */
export interface ErasureRequest {
  readonly requestId: string
  readonly userId: string
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
}

const ERASURE_BODY = 4 * 1024

function authOf(deps: RouteDeps): MobileAuthFacade {
  const facade = deps.auth()
  if (facade === undefined) throw new MobileApiError(503, 'AUTH_UNAVAILABLE', '账户服务未挂载')
  return facade
}

function learningOf(deps: RouteDeps): MobileLearningFacade {
  const facade = deps.learning()
  if (facade === undefined) throw new MobileApiError(503, 'LEARNING_UNAVAILABLE', '学习服务未挂载')
  return facade
}

function classesOf(deps: RouteDeps): MobileClassFacade {
  const facade = deps.classes()
  if (facade === undefined) throw new MobileApiError(503, 'CLASS_UNAVAILABLE', '班级服务未挂载')
  return facade
}

function paperOf(deps: RouteDeps): MobilePaperFacade {
  const facade = deps.paper()
  if (facade === undefined) throw new MobileApiError(503, 'PAPER_UNAVAILABLE', '资料服务未挂载')
  return facade
}

function noticeOf(deps: RouteDeps): MobileNoticeFacade {
  const facade = deps.notice()
  if (facade === undefined) throw new MobileApiError(503, 'NOTICE_UNAVAILABLE', '通知服务未挂载')
  return facade
}

/** Resolve the principal or fail with the app's sign-in prompt. */
function requireMobile(deps: RouteDeps, req: IncomingMessage): ResolvedMobile {
  const resolved = authOf(deps).resolve(req)
  if (resolved === null) throw new MobileApiError(401, 'sign_in_required', '请先登录')
  return resolved
}

/** Page an in-memory list with the same cursor contract the app already speaks. */
function paginate<T>(rows: readonly T[], url: URL, idOf: (row: T) => string): { items: T[]; nextCursor?: string } {
  const query = listQuery(url)
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200)
  let start = 0
  if (query.cursor !== undefined) {
    const index = rows.findIndex(row => idOf(row) === query.cursor)
    if (index < 0) throw new MobileApiError(400, 'BAD_CURSOR', '分页游标无效')
    start = index + 1
  }
  const page = rows.slice(start, start + limit)
  const last = page.at(-1)
  const nextCursor = start + limit < rows.length && last !== undefined ? idOf(last) : undefined
  return nextCursor === undefined ? { items: page } : { items: page, nextCursor }
}

/**
 * Build the prefix handler.
 * @param deps - the composed facades plus export and erasure hooks.
 * @returns an HTTP handler for every mobile route.
 */
export function mobileRoutes(deps: RouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname.startsWith(MOBILE_PREFIX)
      ? url.pathname.slice(MOBILE_PREFIX.length) || '/'
      : url.pathname
    const method = req.method ?? 'GET'
    const segments = path.split('/').filter(Boolean)
    const ip = deps.clientIp(req)
    const userAgent = req.headers['user-agent']

    try {
      // ---- auth: credential issuance -------------------------------------
      if (method === 'POST' && path === '/auth/login') {
        sendData(res, await authOf(deps).login(await readJson(req, DEFAULT_BODY_LIMIT), ip, userAgent))
        return
      }
      if (method === 'POST' && path === '/auth/register') {
        sendData(res, await authOf(deps).register(await readJson(req, DEFAULT_BODY_LIMIT), ip, userAgent), 201)
        return
      }
      if (method === 'POST' && path === '/auth/login/2fa') {
        sendData(res, await authOf(deps).loginTwoFactor(await readJson(req, DEFAULT_BODY_LIMIT), ip, userAgent))
        return
      }
      if (method === 'POST' && path === '/auth/refresh') {
        sendData(res, await authOf(deps).refresh(await readJson(req, DEFAULT_BODY_LIMIT), ip))
        return
      }
      if (method === 'POST' && path === '/auth/logout') {
        const body = await readJson(req, DEFAULT_BODY_LIMIT)
        await authOf(deps).logout(req, body, ip)
        sendData(res, { ok: true })
        return
      }
      if (method === 'GET' && path === '/auth/schools') {
        const q = url.searchParams.get('q') ?? ''
        sendData(res, { items: await authOf(deps).schools(q) })
        return
      }

      // ---- auth: authenticated principal ---------------------------------
      if (method === 'GET' && path === '/auth/me') {
        sendData(res, { user: requireMobile(deps, req).user })
        return
      }
      if (method === 'GET' && path === '/auth/devices') {
        requireMobile(deps, req)
        sendData(res, authOf(deps).listDevices(req))
        return
      }
      if (method === 'DELETE' && segments[0] === 'auth' && segments[1] === 'devices' && segments.length === 3) {
        requireMobile(deps, req)
        await authOf(deps).revokeDevice(req, segments[2] as string)
        sendData(res, { ok: true })
        return
      }
      if (method === 'PATCH' && path === '/auth/profile') {
        requireMobile(deps, req)
        sendData(res, { user: await authOf(deps).updateProfile(req, await readJson(req, DEFAULT_BODY_LIMIT)) })
        return
      }
      if (method === 'POST' && path === '/auth/password') {
        requireMobile(deps, req)
        await authOf(deps).changePassword(req, await readJson(req, DEFAULT_BODY_LIMIT), ip)
        sendData(res, { ok: true })
        return
      }
      if (method === 'DELETE' && path === '/auth/account') {
        const principal = requireMobile(deps, req)
        const body = await readJson(req, ERASURE_BODY)
        // The auth host verifies the password and the literal confirmation before any erasure.
        const result = await authOf(deps).deleteAccount(req, body, ip)
        const completed = await deps.erase({
          requestId: result.requestId,
          userId: principal.actor.userId ?? '',
          userKey: principal.actor.userKey,
          schoolId: principal.actor.schoolId,
          username: principal.actor.username,
        })
        if (result.status === 'deleted') await authOf(deps).completeErasure(result.requestId)
        sendData(res, { status: completed, requestId: result.requestId })
        return
      }

      // ---- learning ------------------------------------------------------
      if (segments[0] === 'learning') {
        const principal = requireMobile(deps, req)
        const actor = principal.actor
        requireStudent(actor)
        const learning = learningOf(deps)

        if (method === 'GET' && path === '/learning/attempts') {
          sendData(res, paginate(learning.listAttempts(actor), url, row => row.id))
          return
        }
        if (method === 'PUT' && segments[1] === 'attempts' && segments.length === 3) {
          sendData(res, await learning.saveAttempt(actor, segments[2] as string, await readJson(req, ATTEMPT_BODY_LIMIT)))
          return
        }
        if (method === 'GET' && path === '/learning/scenes') {
          sendData(res, paginate(learning.listScenes(actor), url, row => row.sceneId))
          return
        }
        if (segments[1] === 'scenes' && segments.length === 3) {
          const sceneId = segments[2] as string
          if (method === 'GET') {
            sendData(res, await learning.getScene(actor, sceneId))
            return
          }
          if (method === 'PUT') {
            const mutationId = mutationIdOf(req)
            sendData(res, await learning.saveScene(actor, sceneId, await readJson(req, SCENE_BODY_LIMIT), mutationId))
            return
          }
          if (method === 'DELETE') {
            const mutationId = mutationIdOf(req)
            sendData(res, await learning.deleteScene(actor, sceneId, await readJson(req, DEFAULT_BODY_LIMIT), mutationId))
            return
          }
        }
      }

      // ---- classes -------------------------------------------------------
      if (segments[0] === 'classes') {
        const principal = requireMobile(deps, req)
        const actor = principal.actor
        requireStudent(actor)
        const classes = classesOf(deps)

        if (method === 'GET' && segments.length === 1) {
          sendData(res, { items: classes.listClasses(actor) })
          return
        }
        if (method === 'GET' && segments.length === 3 && segments[2] === 'assignments') {
          sendData(res, { items: classes.listAssignments(actor, segments[1] as string) })
          return
        }
        if (segments.length === 5 && segments[2] === 'assignments' && segments[4] === 'submission') {
          const classId = segments[1] as string
          const assignmentId = segments[3] as string
          if (method === 'GET') {
            sendData(res, classes.getSubmission(actor, classId, assignmentId))
            return
          }
          if (method === 'PUT') {
            sendData(res, await classes.submit(
              actor, classId, assignmentId, await readJson(req, DEFAULT_BODY_LIMIT), mutationIdOf(req),
            ))
            return
          }
        }
        if (method === 'GET' && segments.length === 5 && segments[2] === 'assignments' && segments[4] === 'target') {
          // The target carries the approved paper or experiment the student may open.
          sendData(res, await paperOf(deps).target(actor, segments[1] as string, segments[3] as string))
          return
        }
        if (method === 'GET' && segments.length === 7 && segments[2] === 'assignments'
          && segments[4] === 'target' && segments[5] === 'figures') {
          // Verified PNG bytes; the paper host already constrained the reference.
          const bytes = await paperOf(deps).figure(
            actor, segments[1] as string, segments[3] as string, segments[6] as string,
          )
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': bytes.byteLength,
            'cache-control': 'private, max-age=300',
          })
          res.end(Buffer.from(bytes))
          return
        }
      }

      // ---- verified library ---------------------------------------------
      if (segments[0] === 'library') {
        const principal = requireMobile(deps, req)
        const actor = principal.actor
        requireStudent(actor)
        const paper = paperOf(deps)
        if (method === 'GET' && path === '/library/questions') {
          sendData(res, paginate(paper.listQuestions(actor), url, row => String(row['id'])))
          return
        }
        if (method === 'GET' && path === '/library/sources') {
          sendData(res, paginate(paper.listSources(actor), url, row => String(row['id'])))
          return
        }
        if (method === 'GET' && path === '/library/annotations') {
          const source = url.searchParams.get('source') ?? undefined
          sendData(res, paginate(paper.listAnnotations(actor, source), url, row => String(row['id'])))
          return
        }
      }

      // ---- notices -------------------------------------------------------
      if (segments[0] === 'notices') {
        const principal = requireMobile(deps, req)
        const actor = principal.actor
        const notice = noticeOf(deps)
        if (method === 'GET' && path === '/notices/platform') {
          sendData(res, notice.platformNotice(actor))
          return
        }
        if (method === 'POST' && path === '/notices/platform/ack') {
          sendData(res, await notice.acknowledgePlatformNotice(actor, await readJson(req, DEFAULT_BODY_LIMIT)))
          return
        }
        if (method === 'GET' && path === '/notices/announcements') {
          const rows = notice.listAnnouncements(actor)
          sendData(res, paginate(rows, url, row => String(row['id'])))
          return
        }
      }

      // ---- push registration ---------------------------------------------
      if (segments[0] === 'devices' && segments[1] === 'push') {
        const principal = requireMobile(deps, req)
        const push = deps.push()
        if (push === undefined) throw new MobileApiError(503, 'PUSH_UNAVAILABLE', '推送服务未挂载')
        if (method === 'POST' && segments.length === 2) {
          sendData(res, await push.register(principal.actor, await readJson(req, DEFAULT_BODY_LIMIT)), 201)
          return
        }
        if (method === 'DELETE' && segments.length === 3) {
          await push.revoke(principal.actor, segments[2] as string)
          sendData(res, { ok: true })
          return
        }
      }

      // ---- account export -------------------------------------------------
      if (method === 'GET' && path === '/account/export') {
        const principal = requireMobile(deps, req)
        const actor = principal.actor
        const section = url.searchParams.get('section')
        const sections = deps.exports()
        if (section === null) {
          sendData(res, {
            version: 1,
            sections: sections.map(entry => ({
              id: entry.id,
              path: `account/export?section=${encodeURIComponent(entry.id)}`,
            })),
          })
          return
        }
        const entry = sections.find(candidate => candidate.id === section)
        if (entry === undefined) throw new MobileApiError(404, 'SECTION_NOT_FOUND', '导出分组不存在')
        const rows = entry.rows(actor)
        const page = paginate(rows, url, row => String(row['id']))
        sendData(res, { section, ...page })
        return
      }

      throw new MobileApiError(404, 'NOT_FOUND', '移动接口不存在')
    } catch (error) {
      sendFailure(res, error)
    }
  }
}
