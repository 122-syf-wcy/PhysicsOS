/**
 * The `/physicsos/notice` prefix handler.
 *
 * One gate in front of every route, for the reason paper-host records: thirty
 * routes each remembering to check is how the thirty-first forgets. The floor
 * is per-surface rather than uniform, because 反馈 is written by students and
 * announcements are written by admins.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { NoticeError, auditWrites, guard, type PhysicsosIdentity } from './identity.ts'
import type { NoticeService } from './service.ts'

type Body = Record<string, unknown>

export interface RouteDeps {
  readonly service: NoticeService
  /** Resolved per request: this host loads BEFORE auth-host declares it. */
  readonly identity: () => PhysicsosIdentity | undefined
}

/**
 * The `seg[i]` value as a string, or a 400 when the route shape did not carry
 * it. Explicit rather than a `!` assertion: a URL that reaches the branch
 * without its id should answer the client rather than hand `undefined` to the
 * service and turn into a 500.
 */
const segment = (seg: readonly string[], index: number): string => {
  const value = seg[index]
  if (value === undefined || value === '') {
    throw new NoticeError(400, 'BAD_REQUEST', '路径缺少必要参数')
  }
  return value
}

/**
 * Build a one-key filter object from a query parameter, or nothing when it is
 * absent — the shape the service's filter argument expects, without a
 * non-null assertion on `searchParams.get`.
 */
const filterOf = (url: URL, key: string): Record<string, string> => {
  const value = url.searchParams.get(key)
  return value === null ? {} : { [key]: value }
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

const readJson = async (req: IncomingMessage): Promise<Body> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return (parsed !== null && typeof parsed === 'object') ? parsed as Body : {}
  } catch {
    throw new NoticeError(400, 'BAD_REQUEST', '请求体不是合法 JSON')
  }
}

/**
 * The `/physicsos/notice` prefix handler.
 * @param deps - the service and the lazily-resolved identity provider.
 * @returns the webServer route handler.
 */
export function noticeRoutes(deps: RouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { service, identity: identityOf } = deps
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/notice/, '') || '/'
      const method = req.method ?? 'GET'
      const seg = path.split('/').filter(Boolean)

      /* Per-surface floors. Reading anything needs a session; writing 反馈 is
         open to any account; publishing a notice needs a school admin. The
         service re-checks the write rules it owns, so this is the outer door
         rather than the only one. */
      const floor = writeFloor(path, seg, method)
      const identity = identityOf()
      const { actor, writes } = guard(identity, req, floor)
      if (writes && identity !== undefined) {
        const ledger = identity
        res.on('finish', () => {
          void auditWrites(ledger, actor, req, res.statusCode, path)
        })
      }

      /* ---- 反馈 ---- */
      if (method === 'GET' && path === '/feedback') {
        send(res, 200, { items: service.listFeedback(actor, {
          ...filterOf(url, 'schoolId'),
          ...filterOf(url, 'status'),
        }) })
        return
      }
      if (method === 'POST' && path === '/feedback') {
        send(res, 201, { item: await service.submitFeedback(actor, await readJson(req)) })
        return
      }
      if (method === 'POST' && seg[0] === 'feedback' && seg[2] === 'reply') {
        send(res, 200, { item: await service.replyFeedback(actor, segment(seg, 1), await readJson(req)) })
        return
      }
      if (method === 'GET' && path === '/feedback/stats') {
        send(res, 200, service.stats(actor))
        return
      }

      /* ---- 公告 ---- */
      if (method === 'GET' && path === '/announcements') {
        send(res, 200, { items: service.listAnnouncements(actor) })
        return
      }
      if (method === 'POST' && path === '/announcements') {
        send(res, 201, { item: await service.publishAnnouncement(actor, await readJson(req)) })
        return
      }
      if (method === 'POST' && seg[0] === 'announcements' && seg[2] === 'retire') {
        send(res, 200, { item: await service.retireAnnouncement(actor, segment(seg, 1)) })
        return
      }

      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    } catch (error) {
      if (error instanceof NoticeError) {
        send(res, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      send(res, 500, {
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
}

/**
 * The minimum role for a write to this path; reads always need only a session.
 * @param path - the path below the prefix.
 * @param seg - the same path split into segments.
 * @param method - the request method.
 * @returns the role floor the guard enforces for mutating calls.
 */
const writeFloor = (path: string, seg: readonly string[], method: string): 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' => {
  if (method === 'GET') return 'STUDENT'
  /* Reports may be filed by any account — that is who has them. Everything
     else that is not a read belongs to an admin surface. */
  if (path === '/feedback') return 'STUDENT'
  if (seg[0] === 'feedback' && seg[2] === 'reply') return 'TEACHER'
  return 'SCHOOL_ADMIN'
}
