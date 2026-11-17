/**
 * `/physicsos/learning` REST surface.
 *
 * All routes are personal and require a resolved session. The account and
 * tenant are taken exclusively from the identity service; no request body may
 * name either. PUTs are idempotent by path id, reads are cursor-paginated, and
 * deletes are idempotent. Successful writes are NOT copied to the aggregate
 * learning ledger.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { LearningError, requireActor, type PhysicsosIdentity, type IdentityActor } from './identity.ts'
import type { LearningService, ListQuery } from './service.ts'

const ATTEMPT_BODY_LIMIT = 32 * 1024
const SCENE_BODY_LIMIT = 512 * 1024

export interface RouteDeps {
  readonly service: LearningService
  readonly identity: () => PhysicsosIdentity | undefined
}

export const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', vary: 'Cookie, x-physicsos-learning-owner' })
  res.end(JSON.stringify(body))
}

export const sendError = (res: ServerResponse, error: unknown): void => {
  if (error instanceof LearningError) {
    send(res, error.status, { error: { code: error.code, message: error.message,
      ...('current' in error && error.current !== undefined ? { current: error.current } : {}),
    } })
    return
  }
  send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
}

export const readJson = async (req: IncomingMessage, limit: number): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) throw new LearningError(413, 'PAYLOAD_TOO_LARGE', '请求体过大')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new LearningError(400, 'BAD_REQUEST', '请求不是合法 JSON')
  }
}

export const checkJsonMutation = (req: IncomingMessage): void => {
  const type = req.headers['content-type'] ?? ''
  if (!type.startsWith('application/json')) {
    throw new LearningError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
  checkOrigin(req)
}

const checkOrigin = (req: IncomingMessage): void => {
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        throw new LearningError(403, 'FORBIDDEN', '跨站请求被拒绝')
      }
    } catch (error) {
      if (error instanceof LearningError) throw error
      throw new LearningError(403, 'FORBIDDEN', '跨站请求被拒绝')
    }
  }
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    throw new LearningError(403, 'FORBIDDEN', '跨站请求被拒绝')
  }
}

/** The header can only narrow cookie authority; it never supplies an owner. */
export const checkLearningOwner = (req: IncomingMessage, actor: IdentityActor, required = false): void => {
  const header = req.headers['x-physicsos-learning-owner']
  if (header === undefined && !required) return
  if (typeof header !== 'string' || header.length > 2048) throw new LearningError(409, 'LEARNING_OWNER_MISMATCH', '学习记录账号已变化，请刷新后重试')
  try {
    const parsed = JSON.parse(decodeURIComponent(header)) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid owner')
    const value = parsed as Record<string, unknown>
    if (Object.keys(value).length !== 2 || value.schoolId !== actor.schoolId || value.username !== actor.username) throw new Error('owner mismatch')
  } catch { throw new LearningError(409, 'LEARNING_OWNER_MISMATCH', '学习记录账号已变化，请刷新后重试') }
}

const listQueryOf = (url: URL): ListQuery => {
  const query: { limit?: string; cursor?: string } = {}
  const limit = url.searchParams.get('limit')
  if (limit !== null) query.limit = limit
  const cursor = url.searchParams.get('cursor')
  if (cursor !== null) query.cursor = cursor
  return query
}

const pathId = (segments: readonly string[]): string => {
  const raw = segments[1]
  if (raw === undefined) throw new LearningError(400, 'BAD_REQUEST', '路径缺少 id')
  try {
    return decodeURIComponent(raw)
  } catch {
    throw new LearningError(400, 'BAD_REQUEST', '路径 id 无效')
  }
}

export function learningRoutes(
  deps: RouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/learning/, '') || '/'
      const segments = path.split('/').filter(Boolean)
      const method = req.method ?? 'GET'
      const actor = requireActor(deps.identity(), req)
      checkLearningOwner(req, actor)

      if (method === 'GET' && path === '/attempts') {
        send(res, 200, deps.service.listAttempts(actor, listQueryOf(url)))
        return
      }
      if (method === 'PUT' && segments[0] === 'attempts' && segments.length === 2) {
        checkJsonMutation(req)
        send(res, 200, {
          item: await deps.service.saveAttempt(
            actor,
            pathId(segments),
            await readJson(req, ATTEMPT_BODY_LIMIT),
          ),
        })
        return
      }

      if (method === 'GET' && path === '/scenes') {
        send(res, 200, deps.service.listScenes(actor, listQueryOf(url)))
        return
      }
      if (method === 'PUT' && segments[0] === 'scenes' && segments.length === 2) {
        checkJsonMutation(req)
        send(res, 200, {
          item: await deps.service.saveScene(
            actor,
            pathId(segments),
            await readJson(req, SCENE_BODY_LIMIT),
          ),
        })
        return
      }
      if (method === 'DELETE' && segments[0] === 'scenes' && segments.length === 2) {
        checkOrigin(req)
        await deps.service.deleteScene(actor, pathId(segments))
        send(res, 200, { ok: true })
        return
      }

      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    } catch (error) {
      sendError(res, error)
    }
  }
}
