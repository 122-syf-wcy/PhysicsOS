/** Actual account-private REST operations mounted beneath /physicsos/learning/canvases. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PhysicsosIdentity } from './identity.ts'
import type { CanvasService, CanvasListQuery } from './canvas-service.ts'
import type { CanvasAssistantService } from './canvas-assistant-service.ts'
import { CanvasError } from './canvas-error.ts'
import {
  canvasActor,
  canvasJsonMutation,
  canvasReadBytes,
  canvasReadJson,
  canvasResponseActor,
  canvasSend,
  canvasSendError,
} from './canvas-http.ts'

/** Exact slash-delimited prefix, before the existing learning-route dispatcher. */
export const CANVAS_PREFIX = '/physicsos/learning/canvases'

/** Actual service and per-request identity resolver. */
export interface CanvasRouteDependencies {
  readonly service: CanvasService
  readonly assistant?: CanvasAssistantService
  readonly identity: () => PhysicsosIdentity | undefined
}

/**
 * Test the exact Canvas prefix without claiming adjacent learning paths.
 * @param pathname - URL pathname, not the raw query string.
 * @returns Whether this dispatcher owns the request.
 */
export function isCanvasPath(pathname: string): boolean {
  return pathname === CANVAS_PREFIX || pathname.startsWith(`${CANVAS_PREFIX}/`)
}

const segment = (value: string): string => {
  try { return decodeURIComponent(value) } catch (error) {
    throw new CanvasError(400, 'BAD_REQUEST', 'Canvas path contains invalid encoding.', { cause: error })
  }
}
const parameter = (url: URL, key: string): string | undefined => {
  const values = url.searchParams.getAll(key)
  if (values.length > 1) throw new CanvasError(400, 'BAD_REQUEST', `Canvas query repeats ${key}.`)
  return values[0]
}
const listQuery = (url: URL): CanvasListQuery => {
  const query: { limit?: string; cursor?: string; search?: string; state?: string; sort?: string; order?: string } = {}
  for (const key of ['limit', 'cursor', 'search', 'state', 'sort', 'order'] as const) {
    const value = parameter(url, key)
    if (value !== undefined) query[key] = value
  }
  return query
}

/**
 * Dispatch real Canvas operations; unknown paths return an actual 404.
 * @param deps - Mounted service and lazily resolved cookie authority.
 * @returns An HTTP handler whose entire body/read/write lifetime participates in disposal.
 */
export function canvasRoutes(deps: CanvasRouteDependencies): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const controller = new AbortController()
    const aborted = (): void => { controller.abort(new DOMException('Canvas transport closed.', 'AbortError')) }
    const closed = (): void => { if (!res.writableEnded) aborted() }
    req.once('aborted', aborted)
    res.once('close', closed)
    try {
      await deps.service.request(controller.signal, async (signal) => {
        const url = new URL(req.url ?? '/', 'http://canvas.invalid')
        if (!isCanvasPath(url.pathname)) throw new CanvasError(404, 'NOT_FOUND', 'Canvas route does not exist.')
        const path = url.pathname.slice(CANVAS_PREFIX.length)
        const segments = path.split('/').filter(Boolean).map(segment)
        const method = req.method ?? 'GET'
        const actor = canvasActor(deps.identity(), req)
        let responseCompleted: Promise<void> | undefined
        const responseCompletion = (): Promise<void> => {
          responseCompleted ??= new Promise<void>(resolve => {
            if (res.writableFinished || res.destroyed) { resolve(); return }
            const settle = (): void => {
              res.off('finish', settle)
              res.off('close', settle)
              signal.removeEventListener('abort', abortResponse)
              resolve()
            }
            const abortResponse = (): void => {
              res.destroy()
              settle()
            }
            signal.addEventListener('abort', abortResponse, { once: true })
            res.once('finish', settle)
            res.once('close', settle)
            if (signal.aborted) abortResponse()
          })
          return responseCompleted
        }
        const reply = (status: number, body: unknown): void => {
          canvasResponseActor(deps.identity(), req, actor)
          responseCompletion()
          canvasSend(res, status, body)
        }
        const read = async (limit = deps.service.config.limits.maxRequestBytes): Promise<unknown> => {
          canvasJsonMutation(req)
          return canvasReadJson(req, limit, signal)
        }
        try {
        if (segments.length === 0 && method === 'GET') {
          reply(200, await deps.service.list(actor, listQuery(url)))
          return
        }
        if (segments.length === 0 && method === 'POST') {
          const response = await deps.service.create(actor, await read())
          reply(response.replayed ? 200 : 201, response)
          return
        }
        if (segments.length === 1 && segments[0] === 'changes' && method === 'GET') {
          reply(200, await deps.service.changes(actor, parameter(url, 'cursor') ?? '0', parameter(url, 'limit')))
          return
        }
        if (segments.length === 1 && segments[0] === 'policy' && method === 'GET') {
          reply(200, await deps.service.resourcePolicy(actor))
          return
        }
        if (segments.length === 1 && segments[0] === 'gc' && method === 'POST') {
          const body = await read()
          if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
            throw new CanvasError(400, 'BAD_REQUEST', 'Account collection request must be an empty JSON object.')
          }
          reply(200, await deps.service.collect(actor))
          return
        }
        const id = segments[0]
        if (id === undefined) throw new CanvasError(404, 'NOT_FOUND', 'Canvas route does not exist.')
        if (deps.assistant && segments[1] === 'assistant' && segments[2] === 'jobs') {
          if (segments.length === 3 && method === 'POST') {
            reply(202, await deps.assistant.create(actor, id, await read(deps.assistant.maxRequestBytes)))
            return
          }
          if (segments.length === 4 && method === 'GET') {
            reply(200, await deps.assistant.read(actor, id, segments[3]!))
            return
          }
          if (segments.length === 5 && segments[4] === 'cancel' && method === 'POST') {
            reply(200, await deps.assistant.cancel(actor, id, segments[3]!, await read(4096)))
            return
          }
        }
        if (segments.length === 1 && method === 'GET') {
          reply(200, await deps.service.open(actor, id))
          return
        }
        if (segments.length === 1 && method === 'DELETE') {
          reply(200, await deps.service.delete(actor, id, await read()))
          return
        }
        if (segments.length === 2 && segments[1] === 'verifications' && method === 'GET') {
          const captureDigest = parameter(url, 'captureDigest')
          if (captureDigest === undefined) throw new CanvasError(400, 'BAD_REQUEST', 'captureDigest is required for replay receipt discovery.')
          const cursor = parameter(url, 'cursor')
          const limit = parameter(url, 'limit')
          reply(200, await deps.service.listVerifications(actor, id, captureDigest, {
            ...(cursor === undefined ? {} : { cursor }), ...(limit === undefined ? {} : { limit }),
          }))
          return
        }
        if (segments.length === 2 && method === 'POST') {
          const action = segments[1]
          if (action === 'commit') { reply(200, await deps.service.commit(actor, id, await read())); return }
          if (action === 'rename') { reply(200, await deps.service.rename(actor, id, await read())); return }
          if (action === 'restore') { reply(200, await deps.service.restore(actor, id, await read())); return }
          if (action === 'copy') {
            const response = await deps.service.copy(actor, id, await read())
            reply(response.replayed ? 200 : 201, response)
            return
          }
          if (action === 'verify') { reply(200, await deps.service.verify(actor, id, await read())); return }
          if (action === 'gc') {
            const body = await read()
            if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) throw new CanvasError(400, 'BAD_REQUEST', 'Collection request must be an empty JSON object.')
            reply(200, await deps.service.collect(actor, id))
            return
          }
        }
        if (segments.length === 3 && segments[1] === 'objects') {
          const digest = segments[2]!
          if (method === 'PUT') {
            canvasJsonMutation(req)
            const bytes = await canvasReadBytes(req, deps.service.config.limits.maxRequestBytes, signal)
            reply(200, await deps.service.uploadObject(actor, id, digest, bytes))
            return
          }
          if (method === 'GET') {
            const object = await deps.service.downloadObject(actor, id, digest)
            canvasResponseActor(deps.identity(), req, actor)
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8', 'content-length': object.bytes.byteLength,
              'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
              'x-physicsos-object-digest': digest, 'x-physicsos-object-kind': object.kind,
            })
            responseCompletion()
            res.end(object.bytes)
            return
          }
        }
        if (segments.length === 3 && segments[1] === 'verifications' && method === 'GET') {
          reply(200, await deps.service.verification(actor, id, segments[2]!))
          return
        }
        if (segments.length === 3 && segments[1] === 'snapshots' && segments[2]!.endsWith('.csv') && method === 'GET') {
          const digest = segments[2]!.slice(0, -4)
          const csv = await deps.service.snapshotCsv(actor, id, digest)
          canvasResponseActor(deps.identity(), req, actor)
          const bytes = Buffer.from(csv, 'utf8')
          res.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8', 'content-length': bytes.byteLength,
            'content-disposition': `attachment; filename="canvas-${digest}.csv"`,
            'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
          })
          responseCompletion()
          res.end(bytes)
          return
        }
        throw new CanvasError(404, 'NOT_FOUND', 'Canvas route does not exist.')
        } catch (error) {
          let responseError: unknown = error
          try { canvasResponseActor(deps.identity(), req, actor) } catch (identityError) { responseError = identityError }
          responseCompletion()
          if (res.headersSent && !res.writableEnded) res.destroy()
          else canvasSendError(res, responseError)
        } finally {
          if (responseCompleted !== undefined) await responseCompleted
        }
      })
    } catch (error) { canvasSendError(res, error) } finally {
      req.off('aborted', aborted)
      res.off('close', closed)
    }
  }
}
