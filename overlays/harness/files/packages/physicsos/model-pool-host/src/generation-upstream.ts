/** One bounded, status-exact generation attempt. No ambient key, redirects or SDK retries. */
import { lookup as dnsLookup } from 'node:dns/promises'
import { Agent } from 'undici'
import { isPublicGenerationAddress } from './generation-schemas.ts'
import type { GenerationFailure, GenerationTextApi } from './generation-types.ts'

export type GenerationFetch = (url: string, init: RequestInit) => Promise<Response>

export class GenerationRequestError extends Error {
  constructor(readonly failure: GenerationFailure) {
    super(`Generation request failed (${failure.code})`)
    this.name = 'GenerationRequestError'
  }
}

export const generationFailureForStatus = (status: number): GenerationFailure => ({
  kind: status === 429 ? 'rate-limited'
    : status === 401 || status === 403 ? 'auth'
      : status === 408 || status === 409 || status === 425 ? 'transport'
        : status >= 500 ? 'server' : 'client',
  status,
  code: `HTTP_${status}`,
})

export const generationEndpoint = (baseURL: string, endpoint: string): string => {
  const url = new URL(baseURL)
  const prefix = url.pathname.replace(/\/+$/, '') || '/v1'
  url.pathname = `${prefix}/${endpoint}`
  return url.toString()
}

/** Cancel an outstanding read even when a mock/provider stream does not implement AbortSignal. */
export const generationAbortable = async <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  signal.throwIfAborted()
  let stop: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', stop, { once: true })
  })
  try { return await Promise.race([promise, aborted]) }
  finally { if (stop !== undefined) signal.removeEventListener('abort', stop) }
}

/** DNS is checked and pinned for the connection, preventing rebinding between validation and fetch. */
export const secureGenerationFetch: GenerationFetch = async (rawURL, init) => {
  const url = new URL(rawURL)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new GenerationRequestError({ kind: 'client', code: 'UNSAFE_ENDPOINT' })
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const lookup = dnsLookup(hostname, { all: true, verbatim: true })
  const addresses = init.signal === undefined || init.signal === null ? await lookup : await generationAbortable(lookup, init.signal)
  if (addresses.length === 0 || addresses.some(address => !isPublicGenerationAddress(address.address))) {
    throw new GenerationRequestError({ kind: 'client', code: 'UNSAFE_ENDPOINT' })
  }
  const pinned = addresses[0]!
  // proxy-exempt: this request pins already validated public DNS addresses; a global proxy cannot enforce that destination.
  const dispatcher = new Agent({
    connect: {
      lookup: (_host, options, callback) => {
        if (typeof options !== 'number' && options.all) callback(null, [pinned])
        else callback(null, pinned.address, pinned.family)
      },
    },
    headersTimeout: 900_000, bodyTimeout: 900_000,
  })
  const dispose = (): void => { void dispatcher.destroy().catch(() => undefined) }
  try {
    // Use Node's Fetch implementation and TLS identity, with a per-request DNS-pinned dispatcher.
    const requestInit: RequestInit & { dispatcher: Agent } = { ...init, credentials: 'omit', redirect: 'error', dispatcher }
    const response = await fetch(url, requestInit)
    if (response.body === null) { dispose(); return response }
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read()
          if (next.done) { reader.releaseLock(); dispose(); controller.close() }
          else controller.enqueue(next.value)
        } catch (error) { dispose(); controller.error(error) }
      },
      async cancel() { dispose(); await reader.cancel().catch(() => undefined) },
    })
    return new Response(body, { status: response.status, headers: response.headers })
  } catch (error) { dispose(); throw error }
}

export interface GenerationDeadline {
  readonly signal: AbortSignal
  readonly dispose: () => void
}

export const generationDeadline = (signal: AbortSignal, timeoutMs: number): GenerationDeadline => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new GenerationRequestError({ kind: 'transport', code: 'TIMEOUT' })), timeoutMs)
  timer.unref?.()
  return { signal: AbortSignal.any([signal, controller.signal]), dispose: () => { clearTimeout(timer) } }
}

/** Bounded reads include single oversized chunks and pending-body cancellation. */
export const readGenerationBytes = async (response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> => {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    void response.body?.cancel().catch(() => undefined)
    throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'RESPONSE_TOO_LARGE' })
  }
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await generationAbortable(reader.read(), signal)
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'RESPONSE_TOO_LARGE' })
      chunks.push(next.value)
    }
    signal.throwIfAborted()
    return new Uint8Array(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size))
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export interface GenerationTextForwardInput {
  readonly baseURL: string
  readonly api: GenerationTextApi
  readonly secret: string
  readonly payload: Record<string, unknown>
  readonly timeoutMs: number
  readonly headersTimeoutMs: number
  readonly signal: AbortSignal
  readonly fetchImpl?: GenerationFetch
}

export type GenerationForwardResult = { readonly ok: false; readonly failure: GenerationFailure }
  | { readonly ok: true; readonly response: Response; readonly signal: AbortSignal; readonly dispose: () => void }

export const forwardGenerationText = async (input: GenerationTextForwardInput): Promise<GenerationForwardResult> => {
  const deadline = generationDeadline(input.signal, input.timeoutMs)
  const headers = generationDeadline(deadline.signal, Math.min(input.timeoutMs, input.headersTimeoutMs))
  let response: Response
  try {
    response = await generationAbortable((input.fetchImpl ?? secureGenerationFetch)(
      generationEndpoint(input.baseURL, input.api === 'openai-responses' ? 'responses' : 'chat/completions'), {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/json', authorization: `Bearer ${input.secret}` },
        body: JSON.stringify(input.payload), redirect: 'error', signal: headers.signal,
      }), headers.signal)
  } catch (error) {
    deadline.dispose(); headers.dispose()
    if (input.signal.aborted) input.signal.throwIfAborted()
    const timed = headers.signal.reason instanceof GenerationRequestError ? headers.signal.reason : undefined
    return { ok: false, failure: error instanceof GenerationRequestError ? error.failure : timed?.failure ?? { kind: 'transport', code: 'TRANSPORT' } }
  }
  headers.dispose()
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    deadline.dispose()
    return { ok: false, failure: generationFailureForStatus(response.status) }
  }
  const streaming = input.payload.stream === true
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (streaming && mediaType !== 'text/event-stream' || !streaming && mediaType !== 'application/json') {
    void response.body?.cancel().catch(() => undefined)
    deadline.dispose()
    return { ok: false, failure: { kind: 'server', status: response.status, code: 'INVALID_CONTENT_TYPE', accepted: true } }
  }
  return { ok: true, response, signal: deadline.signal, dispose: deadline.dispose }
}
