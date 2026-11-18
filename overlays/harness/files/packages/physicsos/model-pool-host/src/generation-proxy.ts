/** Private generation loopback routes. The opaque model plus in-process lease is the only authority. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PoolError } from './errors.ts'
import { GENERATION_LOOPBACK_BASE_PATH } from './generation-types.ts'
import type { GenerationChannelsService } from './generation-service.ts'

const BODY_LIMIT = 10 * 1024 * 1024

export const isGenerationLoopbackPath = (pathname: string): boolean =>
  pathname === GENERATION_LOOPBACK_BASE_PATH || pathname.startsWith(`${GENERATION_LOOPBACK_BASE_PATH}/`)

const sendError = (res: ServerResponse, status: number, code: string): void => {
  if (res.destroyed || res.writableEnded) return
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify({ error: { type: 'physicsos_generation_channels', code, message: 'Generation route unavailable' } }))
}

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new PoolError(413, 'GENERATION_BODY_TOO_LARGE', '请求体过大')
  const chunks: Buffer[] = []
  let length = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
    length += chunk.length
    if (length > BODY_LIMIT) throw new PoolError(413, 'GENERATION_BODY_TOO_LARGE', '请求体过大')
    chunks.push(chunk)
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.concat(chunks, length).toString('utf8')) }
  catch { throw new PoolError(400, 'GENERATION_BAD_REQUEST', '请求体无效') }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PoolError(400, 'GENERATION_BAD_REQUEST', '请求体必须为对象')
  return parsed as Record<string, unknown>
}

export const generationProxyHandler = (service: GenerationChannelsService) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const controller = new AbortController()
  const close = (): void => { if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError')) }
  const aborted = (): void => { controller.abort(new DOMException('Request aborted', 'AbortError')) }
  res.on('close', close); req.on('aborted', aborted)
  try {
    const url = new URL(req.url ?? '/', 'http://generation-loopback')
    const api = url.pathname === `${GENERATION_LOOPBACK_BASE_PATH}/chat/completions` ? 'openai-completions'
      : url.pathname === `${GENERATION_LOOPBACK_BASE_PATH}/responses` ? 'openai-responses' : undefined
    if (api === undefined || url.search !== '') throw new PoolError(404, 'NOT_FOUND', 'not found')
    if (req.method !== 'POST') throw new PoolError(405, 'METHOD_NOT_ALLOWED', 'use POST')
    // A browser may not authorize or discover generation leases. No CORS and no cookie-based access.
    if (req.headers.origin !== undefined || req.headers.cookie !== undefined || req.headers['sec-fetch-site'] !== undefined) {
      throw new PoolError(403, 'GENERATION_PRIVATE_ROUTE', 'private route')
    }
    const auth = req.headers.authorization
    // This is a protocol sentinel, not a credential. Authorization is the registered lease model below.
    if (auth !== 'Bearer physicsos-generation-loopback') throw new PoolError(403, 'GENERATION_PRIVATE_ROUTE', 'private route')
    if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new PoolError(400, 'GENERATION_BAD_REQUEST', 'use JSON')
    }
    const payload = await readBody(req)
    if (typeof payload.model !== 'string' || service.textLeaseForModel(payload.model) === undefined) {
      throw new PoolError(403, 'GENERATION_INVALID_LEASE', 'invalid lease')
    }
    if (payload.stream !== true) throw new PoolError(400, 'GENERATION_STREAM_REQUIRED', 'use streaming')
    if (api === 'openai-completions' && !Array.isArray(payload.messages)
      || api === 'openai-responses' && !Array.isArray(payload.input)) throw new PoolError(400, 'GENERATION_BAD_REQUEST', 'invalid input')
    await service.serveText(payload.model, api, payload, res, controller.signal)
  } catch (error) {
    const status = error instanceof PoolError ? error.status : controller.signal.aborted ? 499 : 502
    const code = error instanceof PoolError ? error.code : controller.signal.aborted ? 'GENERATION_CANCELLED' : 'GENERATION_FAILED'
    sendError(res, status, code)
  } finally { res.off('close', close); req.off('aborted', aborted) }
}
