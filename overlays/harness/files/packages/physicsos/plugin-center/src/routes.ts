import type { IncomingMessage, ServerResponse } from 'node:http'
import { PluginCenterError, type PluginCenter } from './catalog.ts'
import {
  PluginRoutesError,
  requireSuperAdmin,
  type PhysicsosIdentity,
} from './identity.ts'

const BODY_LIMIT = 16 * 1024

export interface PluginCenterRouteDeps {
  readonly center: PluginCenter
  readonly identity: () => PhysicsosIdentity | undefined
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

const sendError = (res: ServerResponse, error: unknown): void => {
  const candidate = error as Partial<PluginRoutesError | PluginCenterError> | undefined
  if (candidate !== undefined
    && typeof candidate.status === 'number'
    && typeof candidate.code === 'string'
    && typeof candidate.message === 'string') {
    sendJson(res, candidate.status, {
      error: { code: candidate.code, message: candidate.message },
    })
    return
  }
  sendJson(res, 500, { error: { code: 'INTERNAL', message: '插件中心请求失败' } })
}

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    throw new PluginRoutesError(413, 'BODY_TOO_LARGE', '请求体过大')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_LIMIT) throw new PluginRoutesError(413, 'BODY_TOO_LARGE', '请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new PluginRoutesError(400, 'BAD_REQUEST', '请求体不是合法 JSON')
  }
}

const checkJsonContentType = (req: IncomingMessage): void => {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string'
    || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new PluginRoutesError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
}

const patchTarget = (pathname: string): string | undefined => {
  const match = /^\/physicsos\/plugins\/entries\/([^/]+)$/.exec(pathname)
  if (match?.[1] === undefined) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    throw new PluginRoutesError(400, 'BAD_REQUEST', '插件 id 编码无效')
  }
}

/**
 * Exact administrator plugin-center surface.
 * @param deps storage-backed center and lazily-resolved identity service.
 * @returns Node HTTP handler.
 */
export const pluginCenterRoutes = (deps: PluginCenterRouteDeps) => async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  try {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://plugins')
    const actor = requireSuperAdmin(deps.identity(), req)

    if (method === 'GET' && url.pathname === '/physicsos/plugins/state') {
      sendJson(res, 200, await deps.center.state())
      return
    }

    const id = method === 'PATCH' ? patchTarget(url.pathname) : undefined
    if (id !== undefined) {
      checkJsonContentType(req)
      const body = await readJson(req)
      if (typeof body !== 'object'
        || body === null
        || Array.isArray(body)
        || typeof (body as { enabled?: unknown }).enabled !== 'boolean') {
        throw new PluginRoutesError(400, 'BAD_REQUEST', '请求体必须为 { enabled: boolean }')
      }
      const enabled = (body as { enabled: boolean }).enabled
      const entry = await deps.center.setEnabled(id, enabled, actor)
      void deps.identity()?.record(actor, 'plugin.set-enabled', id, { enabled }).catch(() => {
        console.error('[plugin-center] audit write failed')
      })
      sendJson(res, 200, { entry })
      return
    }

    if (method !== 'GET' && method !== 'PATCH') {
      res.setHeader('allow', 'GET, PATCH')
      throw new PluginRoutesError(405, 'METHOD_NOT_ALLOWED', '插件中心不接受该请求方法')
    }
    throw new PluginRoutesError(404, 'NOT_FOUND', 'not found')
  } catch (error) {
    sendError(res, error)
  }
}
