/** SUPER_ADMIN-only generation configuration API. No public execution or browser credential route. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PoolError } from './errors.ts'
import { requireSuperAdmin, type PhysicsosIdentity } from './identity.ts'
import { GENERATION_ADMIN_PATH, type GenerationModelsResult } from './generation-types.ts'
import type { GenerationStore } from './generation-store.ts'
import {
  generationModelsInputSchema, generationPurposeSchema, parseGeneration, parseGenerationChannelInput,
  parseGenerationChannelPatch, parseGenerationKeyInput, parseGenerationKeyPatch, parseGenerationSettingsPatch,
} from './generation-schemas.ts'

const BODY_LIMIT = 256 * 1024

export interface GenerationRouteDeps {
  readonly store: GenerationStore
  readonly identity: () => PhysicsosIdentity | undefined
  readonly discoverModels: (channelId: string, keyId: string | undefined, signal: AbortSignal) => Promise<GenerationModelsResult>
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}
const bodyOf = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const length = Number(req.headers['content-length'])
  if (Number.isFinite(length) && length > BODY_LIMIT) throw new PoolError(413, 'GENERATION_BODY_TOO_LARGE', '请求体过大')
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
    size += chunk.length
    if (size > BODY_LIMIT) throw new PoolError(413, 'GENERATION_BODY_TOO_LARGE', '请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.concat(chunks, size).toString('utf8')) }
  catch { throw new PoolError(400, 'GENERATION_BAD_REQUEST', '请求体不是合法 JSON') }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PoolError(400, 'GENERATION_BAD_REQUEST', '请求体必须是 JSON 对象')
  return parsed as Record<string, unknown>
}

/** All generation routes pass the identity and JSON mutation gate before body parsing or discovery. */
export const generationRoutes = (deps: GenerationRouteDeps) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const controller = new AbortController()
  const close = (): void => { if (!res.writableEnded) controller.abort() }
  const abort = (): void => { controller.abort() }
  res.on('close', close); req.on('aborted', abort)
  try {
    const actor = requireSuperAdmin(deps.identity(), req)
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD'
      && req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new PoolError(400, 'GENERATION_BAD_REQUEST', 'content-type 必须为 application/json')
    }
    const pathname = new URL(req.url ?? '/', 'http://generation-admin').pathname
    if (!pathname.startsWith(`${GENERATION_ADMIN_PATH}/`)) throw new PoolError(404, 'NOT_FOUND', 'not found')
    let parts: string[]
    try { parts = pathname.slice(GENERATION_ADMIN_PATH.length + 1).split('/').map(part => decodeURIComponent(part)) }
    catch { throw new PoolError(400, 'GENERATION_BAD_REQUEST', '路径参数无效') }
    if (parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new PoolError(404, 'NOT_FOUND', 'not found')
    const route = parts[0]
    if (parts.length === 1 && route === 'state') {
      if (method !== 'GET') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use GET')
      send(res, 200, deps.store.state()); return
    }
    if (parts.length === 1 && route === 'channels') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use POST')
      const channel = await deps.store.createChannel(actor, parseGenerationChannelInput(await bodyOf(req)))
      send(res, 201, { channel }); return
    }
    if (route === 'channels' && parts.length === 2) {
      const id = parts[1]!
      if (method === 'PATCH') {
        const channel = await deps.store.updateChannel(actor, id, parseGenerationChannelPatch(await bodyOf(req)))
        send(res, 200, { channel }); return
      }
      if (method === 'DELETE') { await deps.store.deleteChannel(actor, id); send(res, 200, { ok: true }); return }
      throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use PATCH/DELETE')
    }
    if (route === 'channels' && parts.length === 3 && parts[2] === 'keys') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use POST')
      const key = await deps.store.addKey(actor, parts[1]!, parseGenerationKeyInput(await bodyOf(req)))
      send(res, 201, { key }); return
    }
    if (route === 'channels' && parts.length === 3 && parts[2] === 'models') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use POST')
      const body = parseGeneration(generationModelsInputSchema, await bodyOf(req))
      const models = await deps.discoverModels(parts[1]!, body.keyId, controller.signal)
      send(res, 200, models); return
    }
    if (route === 'keys' && parts.length === 2) {
      const id = parts[1]!
      if (method === 'PATCH') {
        const key = await deps.store.updateKey(actor, id, parseGenerationKeyPatch(await bodyOf(req)))
        send(res, 200, { key }); return
      }
      if (method === 'DELETE') { await deps.store.deleteKey(actor, id); send(res, 200, { ok: true }); return }
      throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use PATCH/DELETE')
    }
    if (route === 'keys' && parts.length === 3 && parts[2] === 'reset') {
      if (method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use POST')
      parseGeneration(generationModelsInputSchema.omit({ keyId: true }), await bodyOf(req))
      const key = await deps.store.resetKey(actor, parts[1]!)
      send(res, 200, { key }); return
    }
    if (route === 'settings' && parts.length === 2) {
      if (method !== 'PATCH') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use PATCH')
      const purpose = parseGeneration(generationPurposeSchema, parts[1])
      const settings = await deps.store.updateSettings(actor, purpose, parseGenerationSettingsPatch(await bodyOf(req)))
      send(res, 200, { settings }); return
    }
    throw new PoolError(404, 'NOT_FOUND', 'not found')
  } catch (error) {
    if (controller.signal.aborted) return
    if (error instanceof PoolError) send(res, error.status, { error: { code: error.code, message: error.message } })
    else send(res, 500, { error: { code: 'GENERATION_INTERNAL', message: '生成通道操作失败' } })
  } finally { res.off('close', close); req.off('aborted', abort) }
}
