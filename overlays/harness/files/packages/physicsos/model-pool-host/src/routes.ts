/**
 * The `/physicsos/model-pool` admin surface.
 *
 * One gate in front of every route (SUPER_ADMIN, reads included) and one body
 * limit; the route table is deliberately a flat switch so a new endpoint
 * cannot be reached without passing both.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PoolError } from './errors.ts'
import { requireSuperAdmin, type PhysicsosIdentity } from './identity.ts'
import type { PoolStore } from './store.ts'
import type { ProbeResult } from './upstream.ts'

const BODY_LIMIT = 256 * 1024

/** The model roster one channel's upstream reports, as the console lists it. */
export interface ChannelModelsResult {
  readonly models: readonly string[]
  /** The key the roster was read with, so the admin knows which one answered. */
  readonly keyId: string
}

/** Collaborators of the admin routes. */
export interface ModelPoolRouteDeps {
  readonly store: PoolStore
  /** Resolved per request: this host loads BEFORE auth-host declares it. */
  readonly identity: () => PhysicsosIdentity | undefined
  readonly probe: (keyId: string, signal: AbortSignal) => Promise<ProbeResult>
  /**
   * Read the channel's upstream model roster with one of its keys. Throws a
   * {@link PoolError} carrying the upstream's words when the upstream refuses.
   */
  readonly listModels: (
    channelId: string,
    keyId: string | undefined,
    signal: AbortSignal,
  ) => Promise<ChannelModelsResult>
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

const sendError = (res: ServerResponse, error: unknown): void => {
  const candidate = error as Partial<PoolError> | undefined
  if (candidate !== undefined
    && typeof candidate.status === 'number'
    && typeof candidate.code === 'string'
    && typeof candidate.message === 'string') {
    send(res, candidate.status, { error: { code: candidate.code, message: candidate.message } })
    return
  }
  send(res, 500, { error: { code: 'INTERNAL', message: '模型通道操作失败' } })
}

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    throw new PoolError(413, 'BODY_TOO_LARGE', '请求体过大')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > BODY_LIMIT) throw new PoolError(413, 'BODY_TOO_LARGE', '请求体过大')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    throw new PoolError(400, 'BAD_REQUEST', '请求体不是合法 JSON')
  }
}

/** Mutation fence: a browser form or a cross-site fetch cannot send this. */
const requireJsonContentType = (req: IncomingMessage): void => {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string'
    || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new PoolError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
}

const segment = (segments: readonly string[], index: number): string => {
  const value = segments[index]
  if (value === undefined || value === '') {
    throw new PoolError(400, 'BAD_REQUEST', '路径缺少必要参数')
  }
  return value
}

/**
 * Build the prefix handler for `/physicsos/model-pool`.
 * @param deps - store, identity resolver, and the key probe.
 * @returns the request handler.
 */
export const modelPoolRoutes = (deps: ModelPoolRouteDeps) => async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  try {
    const actor = requireSuperAdmin(deps.identity(), req)
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') requireJsonContentType(req)
    const url = new URL(req.url ?? '/', 'http://model-pool')
    const segments = url.pathname
      .split('/')
      .filter(part => part !== '')
      .slice(2)

    if (segments.length === 1 && segments[0] === 'state') {
      if (method !== 'GET') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'state 只接受 GET')
      send(res, 200, deps.store.state())
      return
    }

    if (segments.length === 1 && segments[0] === 'channels') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'channels 只接受 POST')
      const body = await readJson(req)
      const channel = await deps.store.createChannel(actor, {
        name: body.name,
        baseURL: body.baseURL,
        models: body.models,
        priority: body.priority,
        enabled: body.enabled,
      })
      send(res, 201, { channel })
      return
    }

    if (segments.length === 2 && segments[0] === 'channels') {
      const id = segment(segments, 1)
      if (method === 'PATCH') {
        const body = await readJson(req)
        const channel = await deps.store.updateChannel(actor, id, {
          name: body.name,
          baseURL: body.baseURL,
          models: body.models,
          priority: body.priority,
          enabled: body.enabled,
        })
        send(res, 200, { channel })
        return
      }
      if (method === 'DELETE') {
        await deps.store.deleteChannel(actor, id)
        send(res, 200, { ok: true })
        return
      }
      throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'channels/:id 只接受 PATCH/DELETE')
    }

    if (segments.length === 3 && segments[0] === 'channels' && segments[2] === 'models') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'channels/:id/models 只接受 POST')
      const body = await readJson(req)
      const controller = new AbortController()
      res.on('close', () => { controller.abort() })
      const result = await deps.listModels(
        segment(segments, 1),
        typeof body.keyId === 'string' && body.keyId !== '' ? body.keyId : undefined,
        controller.signal,
      )
      send(res, 200, result)
      return
    }

    if (segments.length === 3 && segments[0] === 'channels' && segments[2] === 'keys') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'keys 只接受 POST')
      const body = await readJson(req)
      const key = await deps.store.addKey(actor, segment(segments, 1), {
        label: body.label,
        key: body.key,
        weight: body.weight,
        enabled: body.enabled,
      })
      send(res, 201, { key })
      return
    }

    if (segments.length === 2 && segments[0] === 'keys') {
      const id = segment(segments, 1)
      if (method === 'PATCH') {
        const body = await readJson(req)
        const key = await deps.store.updateKey(actor, id, {
          label: body.label,
          enabled: body.enabled,
          weight: body.weight,
          key: body.key,
        })
        send(res, 200, { key })
        return
      }
      if (method === 'DELETE') {
        await deps.store.deleteKey(actor, id)
        send(res, 200, { ok: true })
        return
      }
      throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'keys/:id 只接受 PATCH/DELETE')
    }

    if (segments.length === 3 && segments[0] === 'keys' && segments[2] === 'reset') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'reset 只接受 POST')
      const key = await deps.store.resetKey(actor, segment(segments, 1))
      send(res, 200, { key })
      return
    }

    if (segments.length === 3 && segments[0] === 'keys' && segments[2] === 'test') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'test 只接受 POST')
      const controller = new AbortController()
      res.on('close', () => { controller.abort() })
      const result = await deps.probe(segment(segments, 1), controller.signal)
      send(res, 200, result)
      return
    }

    if (segments.length === 1 && segments[0] === 'settings') {
      if (method !== 'PATCH') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'settings 只接受 PATCH')
      const body = await readJson(req)
      const settings = await deps.store.updateSettings(actor, {
        retryCount: body.retryCount,
        failureThreshold: body.failureThreshold,
        cooldownBaseMs: body.cooldownBaseMs,
        cooldownMaxMs: body.cooldownMaxMs,
        autoRecover: body.autoRecover,
      })
      send(res, 200, { settings })
      return
    }

    throw new PoolError(404, 'NOT_FOUND', 'not found')
  } catch (error) {
    sendError(res, error)
  }
}
