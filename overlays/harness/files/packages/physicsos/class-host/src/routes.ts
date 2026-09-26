/**
 * `/physicsos/class` prefix route handler.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { ClassError, auditWrites, guard, type PhysicsosIdentity } from './identity.ts'
import type { ClassService } from './service.ts'

const MAX_BODY_BYTES = 32 * 1024
const JSON_MEDIA_TYPE = 'application/json'
const SAFE_FETCH_SITES = new Set(['same-origin', 'same-site', 'none'])

export interface RouteDeps {
  readonly service: ClassService
  readonly identity: () => PhysicsosIdentity | undefined
}

const segment = (parts: readonly string[], index: number): string => {
  const value = parts[index]
  if (value === undefined || value === '') {
    throw new ClassError(400, 'BAD_ROUTE', '路径缺少必要参数')
  }
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ClassError(400, 'BAD_ROUTE', '路径参数编码不合法')
  }
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new ClassError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${MAX_BODY_BYTES} 字节`)
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body is not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new ClassError(400, 'BAD_JSON', '请求体不是合法 JSON 对象')
  }
}

const boundedLimit = (url: URL, fallback: number, max: number): number => {
  const raw = url.searchParams.get('limit')
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ClassError(400, 'BAD_QUERY', `limit 必须是 1 到 ${max} 的整数`)
  }
  return value
}

/**
 * Same-origin JSON fence for every mutating request.
 *
 * A cookie-backed API cannot rely on the browser to withhold a cross-site
 * form POST. Requiring a JSON media type blocks simple HTML forms, while the
 * Origin and Fetch Metadata checks reject scripted cross-site calls that can
 * set that media type. This runs before identity resolution or body parsing,
 * so no refused request reaches a service mutation.
 */
const checkJsonWriteFence = (req: IncomingMessage): void => {
  const contentType = req.headers['content-type']
  const mediaType = typeof contentType === 'string'
    ? contentType.split(';', 1)[0]?.trim().toLowerCase()
    : undefined
  if (mediaType !== JSON_MEDIA_TYPE) {
    throw new ClassError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }

  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).host.toLowerCase() !== req.headers.host?.toLowerCase()) {
        throw new ClassError(403, 'BAD_REQUEST', '跨站请求被拒绝')
      }
    } catch (error) {
      if (error instanceof ClassError) throw error
      throw new ClassError(403, 'BAD_REQUEST', '跨站请求被拒绝')
    }
  }

  const fetchSite = req.headers['sec-fetch-site']
  if (
    typeof fetchSite === 'string'
    && !SAFE_FETCH_SITES.has(fetchSite.toLowerCase())
  ) {
    throw new ClassError(403, 'BAD_REQUEST', '跨站请求被拒绝')
  }
}

export function classRoutes(
  deps: RouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { service, identity: identityOf } = deps
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/class/, '') || '/'
      const method = req.method ?? 'GET'
      const seg = path.split('/').filter(Boolean)

      if (method !== 'GET') checkJsonWriteFence(req)

      const identity = identityOf()
      const { actor, writes } = guard(identity, req, writeFloor(path, seg, method))
      if (writes && identity !== undefined) {
        const ledger = identity
        res.on('finish', () => {
          void auditWrites(ledger, actor, req, res, path).catch(() => undefined)
        })
      }

      if (method === 'GET' && path === '/classes') {
        send(res, 200, {
          items: service.listClasses(actor, boundedLimit(url, 100, 500)),
        })
        return
      }
      if (method === 'POST' && path === '/classes') {
        send(res, 201, { item: await service.createClass(actor, await readJson(req)) })
        return
      }
      if (method === 'POST' && seg[0] === 'classes' && seg[2] === 'members') {
        send(res, 201, {
          item: await service.addMember(actor, segment(seg, 1), await readJson(req)),
        })
        return
      }
      if (method === 'GET' && seg[0] === 'classes' && seg[2] === 'members' && seg.length === 3) {
        send(res, 200, {
          items: service.listMembers(actor, segment(seg, 1), boundedLimit(url, 100, 500)),
        })
        return
      }
      if (method === 'DELETE' && seg[0] === 'classes' && seg[2] === 'members' && seg.length === 4) {
        send(res, 200, {
          item: await service.removeMember(actor, segment(seg, 1), segment(seg, 3)),
        })
        return
      }
      if (
        method === 'POST' &&
        seg[0] === 'classes' &&
        seg[2] === 'assignments' &&
        seg.length === 3
      ) {
        send(res, 201, {
          item: await service.createAssignment(actor, segment(seg, 1), await readJson(req)),
        })
        return
      }
      if (
        method === 'GET' &&
        seg[0] === 'classes' &&
        seg[2] === 'assignments' &&
        seg.length === 3
      ) {
        send(res, 200, {
          items: service.listAssignments(actor, segment(seg, 1), boundedLimit(url, 200, 200)),
        })
        return
      }
      if (seg[0] === 'classes' && seg[2] === 'assignments' && seg[4] === 'submission') {
        const classId = segment(seg, 1)
        const assignmentId = segment(seg, 3)
        if (method === 'PUT') {
          send(
            res,
            201,
            await service.submitAssignment(actor, classId, assignmentId, await readJson(req)),
          )
          return
        }
        if (method === 'GET') {
          const result = service.getReceipt(actor, classId, assignmentId)
          send(res, 200, result ?? { item: null, receipt: null })
          return
        }
      }
      if (
        method === 'GET' &&
        seg[0] === 'classes' &&
        seg[2] === 'assignments' &&
        seg[4] === 'submissions' &&
        seg.length === 5
      ) {
        send(res, 200, {
          items: service.listSubmissions(
            actor,
            segment(seg, 1),
            segment(seg, 3),
            boundedLimit(url, 500, 500),
          ),
        })
        return
      }
      if (
        method === 'POST' &&
        seg[0] === 'classes' &&
        seg[2] === 'assignments' &&
        seg[4] === 'submissions' &&
        seg[6] === 'review' &&
        seg.length === 7
      ) {
        send(res, 200, {
          item: await service.reviewSubmission(
            actor,
            segment(seg, 1),
            segment(seg, 3),
            segment(seg, 5),
            await readJson(req),
          ),
        })
        return
      }
      if (method === 'GET' && seg[0] === 'classes' && seg[2] === 'dashboard' && seg.length === 3) {
        send(res, 200, service.dashboard(actor, segment(seg, 1)))
        return
      }

      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    } catch (error) {
      if (error instanceof ClassError) {
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

const writeFloor = (
  path: string,
  seg: readonly string[],
  method: string,
): 'STUDENT' | 'TEACHER' => {
  if (method === 'GET') return 'STUDENT'
  if (
    method === 'PUT' &&
    seg[0] === 'classes' &&
    seg[2] === 'assignments' &&
    seg[4] === 'submission' &&
    path.startsWith('/classes/')
  )
    return 'STUDENT'
  return 'TEACHER'
}
