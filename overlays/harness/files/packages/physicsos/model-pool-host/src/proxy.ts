/**
 * The OpenAI-compatible local proxy.
 *
 * This is the seam that makes the pool a "兜底" rather than a second system:
 * the Harness keeps speaking `POST {DEEPSEEK_BASE_URL}/chat/completions`, and
 * `DEEPSEEK_BASE_URL` simply points at this loopback listener. The proxy owns
 * channel selection, retry, cooldown accounting, and streaming pass-through;
 * the caller never learns which key answered except through
 * `x-model-pool-attempts`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { PoolError } from './errors.ts'
import { explainMiss, selectCandidates, type WeightedRotation } from './pool.ts'
import type { PoolStore } from './store.ts'
import { forwardChat, isRetryable, listUpstreamModels } from './upstream.ts'
import type { KeyFailure } from './types.ts'

const CHAT_PATH = '/v1/chat/completions'
const MODELS_PATH = '/v1/models'
const BODY_LIMIT = 2 * 1024 * 1024
const MODELS_CACHE_MS = 60_000

/** Collaborators of the proxy listener. */
export interface ProxyDeps {
  readonly store: PoolStore
  readonly rotation: WeightedRotation
  /** Header-phase timeout for one upstream attempt. */
  readonly attemptTimeoutMs: number
  readonly nowMs?: () => number
  readonly log?: (line: string) => void
}

const openAiError = (res: ServerResponse, status: number, code: string, message: string): void => {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify({ error: { message, type: 'physicsos_model_pool', code } }))
}

const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > BODY_LIMIT) {
      throw new PoolError(413, 'BODY_TOO_LARGE', '请求体过大')
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object') {
      throw new PoolError(400, 'BAD_REQUEST', '请求体不是 JSON 对象')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof PoolError) throw error
    throw new PoolError(400, 'BAD_REQUEST', '请求体不是合法 JSON')
  }
}

/**
 * Translate Harness sentinels into the OpenAI-compatible vocabulary expected
 * by current gateways. `off` means "do not spend reasoning tokens"; upstream
 * enumerates that as `none`, not as the literal `off`.
 */
const normalizeUpstreamPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> => payload.reasoning_effort === 'off'
  ? { ...payload, reasoning_effort: 'none' }
  : payload

const writeStream = async (
  res: ServerResponse,
  body: ReadableStream<Uint8Array> | null,
): Promise<void> => {
  if (body === null) {
    res.end()
    return
  }
  const reader = body.getReader()
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (res.writableEnded || res.destroyed) break
      if (!res.write(Buffer.from(next.value))) await once(res, 'drain')
    }
  } finally {
    reader.releaseLock()
  }
  if (!res.writableEnded && !res.destroyed) res.end()
}

/**
 * Build the request listener.
 * @param deps - store, rotation state, clock, and an optional log sink.
 * @returns the Node request listener.
 */
export const modelProxyHandler = (deps: ProxyDeps) => {
  const nowMs = deps.nowMs ?? ((): number => Date.now())
  let modelsCache: { readonly at: number; readonly ids: readonly string[] } | null = null

  const listModels = async (signal: AbortSignal): Promise<readonly string[]> => {
    const channels = deps.store.channels().filter(channel => channel.enabled)
    const declared = new Set<string>()
    for (const channel of channels) for (const model of channel.models) declared.add(model)
    if (declared.size > 0) return [...declared].sort()
    if (modelsCache !== null && nowMs() - modelsCache.at < MODELS_CACHE_MS) return modelsCache.ids
    const keys = deps.store.keys()
    const settings = deps.store.settings
    const candidates = selectCandidates({
      channels,
      keys,
      model: '',
      nowMs: nowMs(),
      settings,
      rotation: deps.rotation,
    })
    const first = candidates[0]
    if (first === undefined) return []
    let ids: readonly string[] = []
    try {
      ids = await listUpstreamModels({
        channel: first.channel,
        secret: deps.store.openKey(first.key),
        timeoutMs: 5_000,
        signal,
      })
    } catch {
      /* An unreadable model list is not a routing failure — answer with what we know. */
      ids = []
    }
    modelsCache = { at: nowMs(), ids }
    return ids
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://model-pool')
    if (url.pathname !== CHAT_PATH && url.pathname !== MODELS_PATH) {
      openAiError(res, 404, 'NOT_FOUND', 'only /v1/chat/completions and /v1/models are served')
      return
    }
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort(new Error('client disconnected'))
    })

    if (url.pathname === MODELS_PATH) {
      if (req.method !== 'GET') {
        openAiError(res, 405, 'METHOD_NOT_ALLOWED', 'use GET')
        return
      }
      const ids = await listModels(abort.signal)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({
        object: 'list',
        data: ids.map(id => ({ id, object: 'model', owned_by: 'physicsos' })),
      }))
      return
    }

    if (req.method !== 'POST') {
      openAiError(res, 405, 'METHOD_NOT_ALLOWED', 'use POST')
      return
    }

    let payload: Record<string, unknown>
    try {
      payload = await readJsonBody(req)
    } catch (error) {
      const failure = error as PoolError
      openAiError(res, failure.status, failure.code, failure.message)
      return
    }
    const model = payload.model
    if (typeof model !== 'string' || model.trim() === '') {
      openAiError(res, 400, 'BAD_REQUEST', 'model 字段缺失')
      return
    }

    const settings = deps.store.settings
    const channels = deps.store.channels()
    const keys = deps.store.keys()
    const candidates = selectCandidates({
      channels,
      keys,
      model,
      nowMs: nowMs(),
      settings,
      rotation: deps.rotation,
    })
    if (candidates.length === 0) {
      const miss = explainMiss({ channels, keys, model, nowMs: nowMs(), settings })
      openAiError(res, 503, miss?.code ?? 'MODEL_POOL_EMPTY', miss?.message ?? '没有可用的模型通道')
      return
    }

    const budget = Math.min(candidates.length, settings.retryCount + 1)
    let lastFailure: KeyFailure | undefined
    let attempt = 0
    for (const candidate of candidates) {
      if (attempt >= budget) break
      attempt += 1
      let secret: string
      try {
        secret = deps.store.openKey(candidate.key)
      } catch (error) {
        const failure = error as PoolError
        lastFailure = { kind: 'auth', status: failure.status, message: failure.message }
        await deps.store.markFailure(candidate.key.id, lastFailure)
        continue
      }
      try {
        const result = await forwardChat({
          channel: candidate.channel,
          secret,
          payload: normalizeUpstreamPayload(payload),
          timeoutMs: deps.attemptTimeoutMs,
          signal: abort.signal,
        })
        if (result.ok) {
          await deps.store.markSuccess(candidate.key.id)
          res.writeHead(result.status, {
            'content-type': result.contentType,
            'cache-control': 'no-store',
            'x-model-pool-attempts': String(attempt),
          })
          try {
            await writeStream(res, result.body)
          } finally {
            result.dispose()
          }
          return
        }
        lastFailure = result.failure
        await deps.store.markFailure(candidate.key.id, result.failure)
        if (!isRetryable(result.failure.kind)) {
          openAiError(res, result.failure.status, 'MODEL_POOL_UPSTREAM_REFUSED', result.failure.message)
          return
        }
      } catch (error) {
        const failure = error as PoolError
        lastFailure = {
          kind: 'transport',
          status: failure.status,
          message: failure.message,
        }
        await deps.store.markFailure(candidate.key.id, lastFailure)
        if (failure.code === 'MODEL_POOL_CLIENT_ABORTED') return
      }
    }

    const message = lastFailure === undefined
      ? '没有可用的模型通道'
      : `全部 ${String(attempt)} 个候选 key 都失败了：${lastFailure.message}`
    deps.log?.(`model-pool: exhausted after ${String(attempt)} attempt(s) — ${message}`)
    openAiError(res, 503, 'MODEL_POOL_EXHAUSTED', message)
  }
}

/**
 * Start the loopback proxy.
 * @param deps - proxy collaborators.
 * @param host - bind host, normally `127.0.0.1`.
 * @param port - bind port.
 * @returns the listening server plus a close helper.
 */
export const startModelProxy = async (
  deps: ProxyDeps,
  host: string,
  port: number,
): Promise<{ readonly server: Server; readonly close: () => Promise<void> }> => {
  const handler = modelProxyHandler(deps)
  const server = createServer((req, res) => {
    void handler(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        openAiError(res, 500, 'INTERNAL', error instanceof Error ? error.message : String(error))
      } else {
        res.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { reject(error) }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
  return {
    server,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

/** The address a server actually bound, for the state response. */
export const boundAddress = (server: Server): { host: string; port: number } => {
  const address = server.address() as AddressInfo | null
  return address === null
    ? { host: '127.0.0.1', port: 0 }
    : { host: address.address, port: address.port }
}
