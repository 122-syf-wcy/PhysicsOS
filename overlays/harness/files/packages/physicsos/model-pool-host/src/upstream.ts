/**
 * One attempt against one upstream key.
 *
 * The shape of this module is dictated by the streaming rule: a retry is only
 * legal BEFORE the first byte of a response body reaches the caller. So
 * {@link forwardChat} settles as soon as the response HEADERS are known — a
 * 2xx hands back the live body and a `dispose` hook, and the caller pipes it
 * without ever coming back here. Everything that can be retried is decided on
 * the headers or on a transport error.
 */
import { PoolError } from './errors.ts'
import { redactSecrets } from './crypto.ts'
import type { ChannelRecord, KeyFailure } from './types.ts'
import { ChatStreamValidator } from './chat-stream.ts'

const ERROR_BODY_LIMIT = 64 * 1024

/* Some OpenAI-compatible gateways sit behind a CDN that rejects curl-like
   clients before authentication. Keep the standard SDK identity so those
   channels stay reachable without a per-channel header setting. */
const UPSTREAM_USER_AGENT = 'OpenAI/Node 5.0.0'

const upstreamURL = (baseURL: string, endpoint: string): string => {
  const url = new URL(baseURL)
  const prefix = url.pathname.replace(/\/+$/, '') || '/v1'
  url.pathname = `${prefix}/${endpoint}`
  return url.toString()
}

/** Chat route; origin-only addresses default to `/v1`, explicit paths stay intact. */
export const chatCompletionsURL = (baseURL: string): string =>
  upstreamURL(baseURL, 'chat/completions')

/** Model route using the same base-path rule as chat and the key probe. */
export const modelsURL = (baseURL: string): string =>
  upstreamURL(baseURL, 'models')

/**
 * Classify an upstream HTTP status.
 * @param status - the status code.
 * @returns the failure kind driving retry and cooldown decisions.
 */
export const classifyStatus = (status: number): KeyFailure['kind'] => {
  if (status === 401 || status === 403) return 'auth'
  if (status === 408 || status === 409 || status === 425 || status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  return 'client'
}

/**
 * Whether another key may be tried after this failure.
 * @param kind - the classified failure.
 * @returns false only for a caller-side error, which another key cannot fix.
 */
export const isRetryable = (kind: KeyFailure['kind']): boolean => kind !== 'client'

/** A 2xx response whose headers are in; the body may still be streaming. */
export interface ForwardSuccess {
  readonly ok: true
  readonly status: number
  readonly contentType: string
  readonly body: ReadableStream<Uint8Array> | null
  readonly signal: AbortSignal
  /** Detach the client-abort link once the body has been consumed. */
  readonly dispose: () => void
}

/** A refusal carrying enough for the caller to retry or to answer with. */
export interface ForwardFailure {
  readonly ok: false
  readonly failure: KeyFailure
  /** The upstream body, already truncated and redacted, for pass-through. */
  readonly upstreamBody: string
}

/** Result of one attempt. */
export type ForwardResult = ForwardSuccess | ForwardFailure

/** Input of one attempt. */
export interface ForwardInput {
  readonly channel: ChannelRecord
  /** Plaintext credential, decrypted for this attempt only. */
  readonly secret: string
  readonly payload: unknown
  readonly timeoutMs: number
  readonly signal: AbortSignal
}

const messagesOf = (error: unknown): string => {
  if (error instanceof Error) return redactSecrets(error.message)
  return redactSecrets(String(error))
}

const readBoundedText = async (body: ReadableStream<Uint8Array> | null): Promise<string> => {
  if (body === null) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      chunks.push(chunk)
      size += chunk.byteLength
      if (size >= ERROR_BODY_LIMIT) break
    }
  } catch {
    /* A truncated error body is still worth reporting; the status carries more. */
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
  return redactSecrets(buffer.toString('utf8'))
}

/**
 * Send one chat-completions request to one channel with one key.
 * @param input - channel, credential, body, timeout, and client abort signal.
 * @returns the live 2xx response, or a classified failure.
 */
export const forwardChat = async (input: ForwardInput): Promise<ForwardResult> => {
  const controller = new AbortController()
  const link = (): void => { controller.abort(input.signal.reason) }
  if (input.signal.aborted) link()
  else input.signal.addEventListener('abort', link, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new PoolError(504, 'MODEL_POOL_ATTEMPT_TIMEOUT', '上游响应超时'))
  }, input.timeoutMs)

  const detach = (): void => {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', link)
  }

  let response: Response
  try {
    response = await fetch(chatCompletionsURL(input.channel.baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream, application/json',
        authorization: `Bearer ${input.secret}`,
        'user-agent': UPSTREAM_USER_AGENT,
      },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    detach()
    if (!input.signal.aborted && controller.signal.reason instanceof PoolError) throw controller.signal.reason
    throw new PoolError(
      input.signal.aborted ? 499 : 502,
      input.signal.aborted ? 'MODEL_POOL_CLIENT_ABORTED' : 'MODEL_POOL_UPSTREAM_UNREACHABLE',
      messagesOf(error),
    )
  }

  const streaming = (input.payload as { stream?: unknown } | null)?.stream === true
  if (response.ok && streaming && response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'text/event-stream') {
    await response.body?.cancel().catch(() => undefined)
    detach()
    const message = `HTTP ${String(response.status)} 未返回 text/event-stream，通道不支持本次流式请求或返回了网关错误`
    return { ok: false, failure: { kind: 'server', status: 502, message }, upstreamBody: message }
  }

  if (!response.ok) {
    const upstreamBody = await readBoundedText(response.body)
    detach()
    return {
      ok: false,
      upstreamBody,
      failure: {
        kind: classifyStatus(response.status),
        status: response.status,
        message: upstreamBody === '' ? `HTTP ${String(response.status)}` : upstreamBody,
      },
    }
  }

  return {
    ok: true,
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'application/json; charset=utf-8',
    body: response.body,
    signal: controller.signal,
    dispose: detach,
  }
}

/** Result of the console's "test this key" action. */
export interface ProbeResult {
  readonly ok: boolean
  readonly status: number
  readonly latencyMs: number
  readonly message: string
}

/** A short streaming request; success proves this model's basic SSE path. */
const PROBE_PAYLOAD = {
  model: 'deepseek-v4.1-flash',
  messages: [{ role: 'user', content: 'ping' }],
  max_tokens: 1,
  stream: true,
  stream_options: { include_usage: true },
} as const

/**
 * Consume a one-token SSE request and report the complete round trip.
 * @param input - channel, credential, model, timeout, and abort signal.
 * @returns the probe outcome with latency; the message is always key-free.
 */
export const probeChat = async (input: {
  readonly channel: ChannelRecord
  readonly secret: string
  readonly model?: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}): Promise<ProbeResult> => {
  const started = Date.now()
  const model = input.model?.trim() || input.channel.models[0] || PROBE_PAYLOAD.model
  const payload = { ...PROBE_PAYLOAD, model }
  try {
    const result = await forwardChat({
      channel: input.channel,
      secret: input.secret,
      payload,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    })
    if (result.ok) {
      const validator = new ChatStreamValidator(true)
      const reader = result.body?.getReader()
      try {
        if (reader !== undefined) {
          for (;;) {
            const next = await reader.read()
            if (next.done) break
            validator.push(next.value)
          }
        }
        result.signal.throwIfAborted()
        validator.finish()
      } catch (error) {
        if (input.signal.aborted) throw new PoolError(499, 'MODEL_POOL_CLIENT_ABORTED', '探测已取消')
        if (result.signal.reason instanceof PoolError) throw result.signal.reason
        throw error
      } finally {
        await reader?.cancel().catch(() => undefined)
        reader?.releaseLock()
        result.dispose()
      }
      return { ok: true, status: result.status, latencyMs: Date.now() - started, message: `流式探测通过（${redactSecrets(model)}）；已验证内容和 finish_reason，工具调用及其他思考配置需另行验证` }
    }
    return {
      ok: false,
      status: result.failure.status,
      latencyMs: Date.now() - started,
      message: result.failure.message,
    }
  } catch (error) {
    const message = error instanceof PoolError ? error.message : messagesOf(error)
    const status = error instanceof PoolError ? error.status : 502
    return { ok: false, status, latencyMs: Date.now() - started, message }
  }
}

/** One model-list read, with the refusal the console must be able to show. */
export interface UpstreamModelsResult {
  readonly ok: boolean
  readonly status: number
  readonly ids: readonly string[]
  /** Key-free description of a refusal; empty on success. */
  readonly message: string
}

/**
 * Read an upstream model list, reporting a refusal instead of hiding it.
 *
 * The admin console needs the reason ("invalid api key", "not found") to tell
 * a mistyped base URL from a dead credential; routing does not care and uses
 * {@link listUpstreamModels}, which flattens every refusal to an empty list.
 * @param input - channel, credential, timeout, and abort signal.
 * @returns the ids, or the upstream status and message.
 */
export const fetchUpstreamModels = async (input: {
  readonly channel: ChannelRecord
  readonly secret: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}): Promise<UpstreamModelsResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, input.timeoutMs)
  const link = (): void => { controller.abort() }
  if (input.signal.aborted) link()
  else input.signal.addEventListener('abort', link, { once: true })
  try {
    const response = await fetch(modelsURL(input.channel.baseURL), {
      headers: { authorization: `Bearer ${input.secret}`, 'user-agent': UPSTREAM_USER_AGENT },
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await readBoundedText(response.body)
      return {
        ok: false,
        status: response.status,
        ids: [],
        message: body === '' ? `HTTP ${String(response.status)}` : body,
      }
    }
    const parsed: unknown = await response.json()
    const data = (parsed as { data?: unknown }).data
    const ids: string[] = []
    if (Array.isArray(data)) {
      for (const entry of data) {
        const id = (entry as { id?: unknown }).id
        if (typeof id === 'string' && id !== '') ids.push(id)
      }
    }
    return { ok: true, status: response.status, ids: ids.slice(0, 200), message: '' }
  } catch (error) {
    return { ok: false, status: 502, ids: [], message: messagesOf(error) }
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', link)
  }
}

/**
 * Read an upstream model list, for `/v1/models` when no channel declares one.
 * @param input - channel, credential, timeout, and abort signal.
 * @returns the model ids the upstream reports, or an empty list.
 */
export const listUpstreamModels = async (input: {
  readonly channel: ChannelRecord
  readonly secret: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}): Promise<string[]> => {
  const result = await fetchUpstreamModels(input)
  return result.ok ? [...result.ids] : []
}
