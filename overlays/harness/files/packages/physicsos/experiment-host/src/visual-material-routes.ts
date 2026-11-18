/** Authenticated private REST catalog. No image upload/generation or digest-global read surface. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { VisualMaterialError, type VisualMaterialActor, type VisualMaterialLifecycle, type VisualMaterialService } from './visual-material-contracts.ts'
import { visualMaterialManageInput, VISUAL_MATERIAL_ID_RE } from './visual-material-domain.ts'

export const VISUAL_MATERIAL_PREFIX = '/physicsos/visual-materials'
export interface VisualMaterialRouteIdentity {
  actorOf(req: IncomingMessage): VisualMaterialActor | null | Promise<VisualMaterialActor | null>
  record?(actor: VisualMaterialActor, action: string, target: string, detail: Record<string, unknown>): Promise<void>
}
export interface VisualMaterialRoutesOptions {
  readonly service: VisualMaterialService
  /** Resolve lazily per request; a missing seam is 503, an unauthenticated session is 401. */
  readonly identity: () => VisualMaterialRouteIdentity | undefined
  /** Canonical trusted application origin (or trusted host/proxy resolver), never model/request body input. */
  readonly origin: string | ((req: IncomingMessage) => string)
}
const baseHeaders = {
  'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  vary: 'Cookie',
}
const badRequest = (): never => { throw new VisualMaterialError(400, 'INPUT_INVALID', 'Invalid visual material request.') }
function canonicalOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error('origin')
    return url.origin
  } catch { throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Visual material routes require a canonical trusted origin.') }
}
function mutationFence(req: IncomingMessage, origin: string): void {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new VisualMaterialError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Visual material mutations require application/json.')
  }
  const incomingOrigin = req.headers.origin
  if (incomingOrigin !== undefined && incomingOrigin !== origin) throw new VisualMaterialError(403, 'CROSS_SITE', 'Cross-site visual material mutation refused.')
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new VisualMaterialError(403, 'CROSS_SITE', 'Cross-site visual material mutation refused.')
}
async function bodyOf(req: IncomingMessage, signal: AbortSignal): Promise<Record<string, unknown>> {
  const length = req.headers['content-length']
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 16 * 1024)) {
    throw new VisualMaterialError(413, 'BODY_TOO_LARGE', 'Visual material request body is too large.')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    if (signal.aborted) throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'Visual material request canceled.')
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > 16 * 1024) throw new VisualMaterialError(413, 'BODY_TOO_LARGE', 'Visual material request body is too large.')
    chunks.push(bytes)
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return badRequest() }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return badRequest()
  return body as Record<string, unknown>
}
function queryKeys(params: URLSearchParams, allowed: readonly string[], repeated: readonly string[] = []): void {
  const counts = new Map<string, number>()
  for (const key of params.keys()) {
    if (!allowed.includes(key)) return badRequest()
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if ((counts.get(key) ?? 0) > 1 && !repeated.includes(key)) return badRequest()
  }
}
function integer(params: URLSearchParams, name: string): number | undefined {
  const value = params.get(name)
  if (value === null) return undefined
  if (!/^\d{1,8}$/.test(value) || !Number.isSafeInteger(Number(value))) return badRequest()
  return Number(value)
}

export function visualMaterialRoutes(options: VisualMaterialRoutesOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const fixedOrigin = typeof options.origin === 'string' ? canonicalOrigin(options.origin) : undefined
  return async (req, res) => {
    const controller = new AbortController()
    const abort = (): void => { controller.abort() }
    const close = (): void => { if (!res.writableEnded) abort() }
    req.once('aborted', abort); res.once('close', close)
    const send = (status: number, body: unknown): void => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(status, { ...baseHeaders, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body))
    }
    try {
      const identity = options.identity()
      if (identity === undefined || typeof identity.actorOf !== 'function') throw new VisualMaterialError(503, 'IDENTITY_UNAVAILABLE', 'Visual material identity service is unavailable.')
      const actor = await identity.actorOf(req)
      if (actor === null || actor === undefined) throw new VisualMaterialError(401, 'UNAUTHENTICATED', 'Authentication is required for visual materials.')
      if ((req.url?.length ?? 0) > 4096) return badRequest()
      const url = new URL(req.url ?? '/', 'http://local'), params = url.searchParams
      const method = req.method ?? 'GET'
      if (!['GET', 'HEAD'].includes(method)) {
        const origin = fixedOrigin ?? canonicalOrigin((options.origin as (req: IncomingMessage) => string)(req))
        mutationFence(req, origin)
      }
      if (url.pathname === VISUAL_MATERIAL_PREFIX && method === 'GET') {
        queryKeys(params, ['query', 'theme', 'purpose', 'kind', 'tag', 'style', 'minWidth', 'minHeight', 'cursor', 'limit'], ['tag'])
        const string = (name: string): string | undefined => params.get(name) ?? undefined
        const query = string('query'), theme = string('theme'), purpose = string('purpose'), kind = string('kind')
        const style = string('style'), cursor = string('cursor'), minWidth = integer(params, 'minWidth'), minHeight = integer(params, 'minHeight'), limit = integer(params, 'limit')
        if (kind !== undefined && kind !== 'environment' && kind !== 'material') return badRequest()
        const result = await options.service.search(actor, {
          ...(query === undefined ? {} : { query }), ...(theme === undefined ? {} : { theme }), ...(purpose === undefined ? {} : { purpose }),
          ...(kind === undefined ? {} : { kind }), ...(style === undefined ? {} : { style }), ...(cursor === undefined ? {} : { cursor }),
          ...(minWidth === undefined ? {} : { minWidth }), ...(minHeight === undefined ? {} : { minHeight }),
          ...(limit === undefined ? {} : { limit }), tags: params.getAll('tag'),
        }, controller.signal)
        send(200, result); return
      }
      if (url.pathname === `${VISUAL_MATERIAL_PREFIX}/owned` && method === 'GET') {
        queryKeys(params, ['lifecycle', 'cursor', 'limit'])
        const lifecycle = params.get('lifecycle') ?? undefined, cursor = params.get('cursor') ?? undefined, limit = integer(params, 'limit')
        if (lifecycle !== undefined && !['all', 'pending', 'ready', 'deleted', 'canceled', 'failed'].includes(lifecycle)) return badRequest()
        const result = await options.service.list(actor, {
          ...(lifecycle === undefined ? {} : { lifecycle: lifecycle as VisualMaterialLifecycle | 'all' }),
          ...(cursor === undefined ? {} : { cursor }), ...(limit === undefined ? {} : { limit }),
        }, controller.signal)
        send(200, result); return
      }
      if (url.pathname === `${VISUAL_MATERIAL_PREFIX}/quota` && method === 'GET') {
        queryKeys(params, [])
        send(200, await options.service.quota(actor, controller.signal)); return
      }
      const match = /^\/physicsos\/visual-materials\/(vmat_[a-f0-9]{32})(?:\/(content|preview\.png|restore))?$/.exec(url.pathname)
      const id = match?.[1], action = match?.[2]
      if (id === undefined || !VISUAL_MATERIAL_ID_RE.test(id)) { send(404, { error: { code: 'NOT_FOUND', message: 'Visual material not found.' } }); return }
      if (method === 'GET' && (action === 'content' || action === 'preview.png')) {
        queryKeys(params, ['sha256'])
        const file = await options.service.readBytes(actor, id, params.get('sha256') ?? undefined, controller.signal)
        if (res.destroyed) return
        res.writeHead(200, { ...baseHeaders, 'content-type': 'image/png', 'content-length': file.bytes.length,
          'content-disposition': `inline; filename="${id}.png"` })
        res.end(file.bytes); return
      }
      if (method === 'GET' && action === undefined) {
        queryKeys(params, [])
        send(200, { material: await options.service.describe(actor, id, controller.signal) }); return
      }
      if (method === 'PATCH' && action === undefined || method === 'DELETE' && action === undefined || method === 'POST' && action === 'restore') {
        queryKeys(params, [])
        const body = await bodyOf(req, controller.signal)
        if (method !== 'PATCH' && Object.keys(body).some(key => !['expectedRevision', 'operationId'].includes(key))) return badRequest()
        const input = visualMaterialManageInput({ ...body, ...(method === 'DELETE' ? { softdelete: true } : {}), ...(action === 'restore' ? { restore: true } : {}) } as unknown as import('./visual-material-contracts.ts').ManageVisualMaterial)
        const material = await options.service.manage(actor, id, input, controller.signal)
        await identity.record?.(actor, 'visual-material.manage', id, { revision: material.revision, lifecycle: material.lifecycle, visibility: material.visibility })
        send(200, { material }); return
      }
      send(404, { error: { code: 'NOT_FOUND', message: 'Visual material not found.' } })
    } catch (error) {
      if (error instanceof VisualMaterialError) send(error.status, { error: { code: error.code, message: error.message } })
      else send(500, { error: { code: 'INTERNAL', message: 'Visual material request failed.' } })
    } finally { req.off('aborted', abort); res.off('close', close) }
  }
}
