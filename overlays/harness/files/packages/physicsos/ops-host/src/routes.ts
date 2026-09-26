import type { IncomingMessage, ServerResponse } from 'node:http'
import { OpsError, requireSuperAdmin, type PhysicsosIdentity } from './identity.ts'
import type { OpsMetrics } from './types.ts'

export interface OpsRouteDeps {
  readonly identity: () => PhysicsosIdentity | undefined
  readonly collect: (force: boolean) => Promise<OpsMetrics>
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
  const candidate = error as Partial<OpsError> | undefined
  if (candidate !== undefined
    && typeof candidate.status === 'number'
    && typeof candidate.code === 'string'
    && typeof candidate.message === 'string') {
    sendJson(res, candidate.status, {
      error: { code: candidate.code, message: candidate.message },
    })
    return
  }
  sendJson(res, 500, { error: { code: 'INTERNAL', message: '运维指标采集失败' } })
}

const forceRequested = (url: URL): boolean => {
  const value = url.searchParams.get('force')
  return value === '1' || value === 'true'
}

export const opsRoutes = (deps: OpsRouteDeps) => async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  try {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      throw new OpsError(405, 'METHOD_NOT_ALLOWED', '运维指标只读，只接受 GET 请求')
    }
    requireSuperAdmin(deps.identity(), req)
    const url = new URL(req.url ?? '/', 'http://ops')
    if (url.pathname !== '/physicsos/ops/metrics') {
      throw new OpsError(404, 'NOT_FOUND', 'not found')
    }
    const metrics = await deps.collect(forceRequested(url))
    sendJson(res, 200, metrics)
  } catch (error) {
    sendError(res, error)
  }
}
