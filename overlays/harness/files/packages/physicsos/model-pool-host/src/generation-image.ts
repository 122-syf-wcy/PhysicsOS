/** Direct Image API generation. Text/main routes, ambient credentials and redirect downloads are excluded. */
import { z } from 'zod'
import type { GenerationAccount } from './generation-pool.ts'
import {
  generationAbortable, generationDeadline, generationEndpoint, generationFailureForStatus,
  GenerationRequestError, readGenerationBytes, secureGenerationFetch, type GenerationFetch,
} from './generation-upstream.ts'
import type { GenerateGenerationImage, GenerationImageResult, GenerationImageUsage } from './generation-types.ts'

export const GENERATION_IMAGE_MAX_BYTES = 6 * 1024 * 1024
export const GENERATION_IMAGE_RESPONSE_MAX_BYTES = 10 * 1024 * 1024
export const GENERATION_IMAGE_TIMEOUT_MS = 180_000

const imageInputSchema = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  size: z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']).optional(),
  background: z.enum(['auto', 'opaque', 'transparent']).optional(),
  quality: z.enum(['auto', 'low', 'medium', 'high']).optional(),
}).strict()

export const validateGenerationImageInput = (input: GenerateGenerationImage): void => {
  const parsed = imageInputSchema.safeParse({
    prompt: input.prompt, ...input.size === undefined ? {} : { size: input.size },
    ...input.background === undefined ? {} : { background: input.background },
    ...input.quality === undefined ? {} : { quality: input.quality },
  })
  if (!parsed.success) throw new GenerationRequestError({ kind: 'client', code: 'INVALID_IMAGE_REQUEST' })
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const numeric = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : undefined

const imageUsage = (raw: unknown): GenerationImageUsage | undefined => {
  const value = recordOf(raw), details = recordOf(value?.input_tokens_details)
  if (value === undefined) return undefined
  const result: GenerationImageUsage = {
    ...numeric(value.input_tokens) === undefined ? {} : { inputTokens: numeric(value.input_tokens)! },
    ...numeric(value.output_tokens) === undefined ? {} : { outputTokens: numeric(value.output_tokens)! },
    ...numeric(value.total_tokens) === undefined ? {} : { totalTokens: numeric(value.total_tokens)! },
    ...numeric(details?.text_tokens) === undefined ? {} : { textInputTokens: numeric(details?.text_tokens)! },
    ...numeric(details?.image_tokens) === undefined ? {} : { imageInputTokens: numeric(details?.image_tokens)! },
  }
  return Object.keys(result).length === 0 ? undefined : result
}

/** Require a bounded PNG with sane IHDR, complete IEND, and no trailing non-image bytes. */
export const validateGenerationPng = (bytes: Uint8Array): void => {
  const fail = (): never => { throw new GenerationRequestError({ kind: 'server', code: 'INVALID_IMAGE' }) }
  if (bytes.byteLength < 57 || bytes.byteLength > GENERATION_IMAGE_MAX_BYTES) fail()
  const buffer = Buffer.from(bytes)
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail()
  let offset = 8, dataSeen = false, ended = false
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8)
    if (offset + 12 + length > buffer.length) fail()
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) fail()
      if (![1, 2, 4, 8, 16].includes(buffer[24]!) || ![0, 2, 3, 4, 6].includes(buffer[25]!)
        || buffer[26] !== 0 || buffer[27] !== 0 || ![0, 1].includes(buffer[28]!)) fail()
      const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20)
      if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_777_216) fail()
    } else if (type === 'IHDR') fail()
    if (type === 'IDAT') dataSeen = true
    offset += length + 12
    if (type === 'IEND') { if (length !== 0 || offset !== buffer.length) fail(); ended = true; break }
  }
  if (!ended || !dataSeen) fail()
}

const inlineImage = (value: string): Uint8Array => {
  if (value.length > 4 * Math.ceil(GENERATION_IMAGE_MAX_BYTES / 3)
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new GenerationRequestError({ kind: 'server', code: 'INVALID_IMAGE_BASE64' })
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'))
  if (Buffer.from(bytes).toString('base64') !== value) throw new GenerationRequestError({ kind: 'server', code: 'INVALID_IMAGE_BASE64' })
  if (bytes.byteLength > GENERATION_IMAGE_MAX_BYTES) throw new GenerationRequestError({ kind: 'server', code: 'IMAGE_TOO_LARGE' })
  return bytes
}

/** Only the configured HTTPS origin can receive a download request; no URL credentials or redirect follow. */
export const generationImageDownloadURL = (raw: string, baseURL: string): string => {
  let url: URL
  try { url = new URL(raw, `${baseURL}/`) }
  catch { throw new GenerationRequestError({ kind: 'server', code: 'UNSAFE_IMAGE_URL' }) }
  const base = new URL(baseURL)
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new GenerationRequestError({ kind: 'server', code: 'UNSAFE_IMAGE_URL' })
  }
  return url.toString()
}

export interface GenerationImageAttemptInput {
  readonly account: GenerationAccount
  readonly secret: string
  readonly input: GenerateGenerationImage
  readonly configRevision: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
  readonly fetchImpl?: GenerationFetch
}

export const generateImageAttempt = async (options: GenerationImageAttemptInput): Promise<GenerationImageResult> => {
  const { account, input } = options
  if (account.channel.purpose !== 'image' || account.channel.api !== 'openai-images') {
    throw new GenerationRequestError({ kind: 'client', code: 'NOT_AN_IMAGE_CHANNEL' })
  }
  validateGenerationImageInput(input)
  const deadline = generationDeadline(options.signal, Math.min(options.timeoutMs, GENERATION_IMAGE_TIMEOUT_MS))
  const fetchImpl = options.fetchImpl ?? secureGenerationFetch
  const endpoint = generationEndpoint(account.channel.baseURL, 'images/generations')
  let accepted = false
  try {
    const response = await generationAbortable(fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal: deadline.signal,
      headers: { authorization: `Bearer ${options.secret}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model: account.model.id, prompt: input.prompt.trim(), n: 1, output_format: 'png',
        .../^dall-e-/i.test(account.model.id) ? { response_format: 'b64_json' } : {},
        ...input.size === undefined ? {} : { size: input.size },
        ...input.background === undefined ? {} : { background: input.background },
        ...input.quality === undefined ? {} : { quality: input.quality },
      }),
    }), deadline.signal)
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new GenerationRequestError(generationFailureForStatus(response.status))
    }
    accepted = true
    if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      void response.body?.cancel().catch(() => undefined)
      throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'INVALID_IMAGE_RESPONSE' })
    }
    const jsonBytes = await readGenerationBytes(response, GENERATION_IMAGE_RESPONSE_MAX_BYTES, deadline.signal)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)) }
    catch { throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'INVALID_IMAGE_RESPONSE' }) }
    const root = recordOf(parsed), data = root?.data
    const item = Array.isArray(data) && data.length === 1 ? recordOf(data[0]) : undefined
    if (item === undefined) throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'MISSING_IMAGE' })
    let bytes: Uint8Array
    if (typeof item.b64_json === 'string' && item.b64_json.length > 0) bytes = inlineImage(item.b64_json)
    else if (typeof item.url === 'string' && item.url.length > 0 && item.url.length <= 4096) {
      const download = await generationAbortable(fetchImpl(generationImageDownloadURL(item.url, account.channel.baseURL), {
        method: 'GET', redirect: 'error', signal: deadline.signal,
        // Never send the API key, cookies or upstream authorization to an asset URL.
        headers: { accept: 'image/png' },
      }), deadline.signal)
      if (!download.ok) {
        void download.body?.cancel().catch(() => undefined)
        throw new GenerationRequestError({ kind: 'server', status: download.status, code: 'IMAGE_DOWNLOAD_FAILED' })
      }
      const mediaType = download.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'image/png' && mediaType !== 'application/octet-stream') {
        void download.body?.cancel().catch(() => undefined)
        throw new GenerationRequestError({ kind: 'server', status: download.status, code: 'INVALID_IMAGE_CONTENT_TYPE' })
      }
      bytes = await readGenerationBytes(download, GENERATION_IMAGE_MAX_BYTES, deadline.signal)
    } else throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'MISSING_IMAGE' })
    validateGenerationPng(bytes)
    deadline.signal.throwIfAborted()
    const usage = imageUsage(root?.usage)
    // Provider request IDs are optional and opaque. Do not echo raw arbitrary response headers.
    return {
      bytes, mediaType: 'image/png', model: account.model.id, channelId: account.channel.id, configRevision: options.configRevision,
      ...usage === undefined ? {} : { usage },
    }
  } catch (error) {
    if (options.signal.aborted) options.signal.throwIfAborted()
    if (error instanceof GenerationRequestError) throw accepted
      ? new GenerationRequestError({ ...error.failure, accepted: true }) : error
    if (deadline.signal.reason instanceof GenerationRequestError) throw new GenerationRequestError({
      ...deadline.signal.reason.failure, ...accepted ? { accepted: true } : {},
    })
    throw new GenerationRequestError({ kind: 'transport', code: 'TRANSPORT', ...accepted ? { accepted: true } : {} })
  } finally { deadline.dispose() }
}
