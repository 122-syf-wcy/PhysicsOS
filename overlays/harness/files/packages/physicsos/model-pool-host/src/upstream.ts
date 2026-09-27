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

const ERROR_BODY_LIMIT = 64 * 1024

/** `POST {baseURL}/chat/completions`, tolerant of a trailing slash. */
export const chatCompletionsURL = (baseURL: string): string =>
  `${baseURL.replace(/\/+$/, '')}/chat/completions`

/** `GET {baseURL}/models`, tolerant of a trailing slash. */
export const modelsURL = (baseURL: string): string =>
  `${baseURL.replace(/\/+$/, '')}/models`

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
        /* Some OpenAI-compatible gateways sit behind a CDN that rejects
           curl-like clients before authentication. Keep the standard SDK
           identity so those channels stay reachable without a per-channel
           header setting. */
        'user-agent': 'OpenAI/Node 5.0.0',
      },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    detach()
    throw new PoolError(
      input.signal.aborted ? 499 : 502,
      input.signal.aborted ? 'MODEL_POOL_CLIENT_ABORTED' : 'MODEL_POOL_UPSTREAM_UNREACHABLE',
      messagesOf(error),
    )
  }
  clearTimeout(timer)

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

/** The smallest request that still proves the credential works. */
const PROBE_PAYLOAD = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: 'ping' }],
  max_tokens: 1,
  stream: false,
} as const

/**
 * Send a one-token request with one key and report the round trip.
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
  const payload = input.model === undefined || input.model === ''
    ? PROBE_PAYLOAD
    : { ...PROBE_PAYLOAD, model: input.model }
  try {
    const result = await forwardChat({
      channel: input.channel,
      secret: input.secret,
      payload,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    })
    const latencyMs = Date.now() - started
    if (result.ok) {
      await result.body?.cancel().catch(() => undefined)
      result.dispose()
      return { ok: true, status: result.status, latencyMs, message: '连通正常' }
    }
    return {
      ok: false,
      status: result.failure.status,
      latencyMs,
      message: result.failure.message,
    }
  } catch (error) {
    const message = error instanceof PoolError ? error.message : messagesOf(error)
    const status = error instanceof PoolError ? error.status : 502
    return { ok: false, status, latencyMs: Date.now() - started, message }
  }
}

/**
 * Read an upstream model list, for the console and for `/v1/models` when no
 * channel declares one.
 * @param input - channel, credential, timeout, and abort signal.
 * @returns the model ids the upstream reports, or an empty list.
 */
export const listUpstreamModels = async (input: {
  readonly channel: ChannelRecord
  readonly secret: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}): Promise<string[]> => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, input.timeoutMs)
  const link = (): void => { controller.abort() }
  input.signal.addEventListener('abort', link, { once: true })
  try {
    const response = await fetch(modelsURL(input.channel.baseURL), {
      headers: { authorization: `Bearer ${input.secret}` },
      signal: controller.signal,
    })
    if (!response.ok) return []
    const parsed: unknown = await response.json()
    const data = (parsed as { data?: unknown }).data
    if (!Array.isArray(data)) return []
    const ids: string[] = []
    for (const entry of data) {
      const id = (entry as { id?: unknown }).id
      if (typeof id === 'string' && id !== '') ids.push(id)
    }
    return ids.slice(0, 200)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', link)
  }
}
