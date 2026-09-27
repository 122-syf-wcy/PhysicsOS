import { readImageProviderConfig, type ImageProviderConfig } from './config.ts'
import {
  isImagePurpose,
  type GeneratedImage,
  type GenerateImageInput,
  type ImageGenerationProvider,
  type ImagePurpose,
} from './provider.ts'

/**
 * Sunburst image provider — an OpenAI-compatible `POST /v1/images/generations`
 * gateway (default https://image.haqiuhaqiu.xyz, model gpt-image-2.5-sunburst).
 *
 * Only this module ever touches the credential, and only to set the
 * Authorization header on the outbound request.
 */

const REQUEST_TIMEOUT_MS = 420_000
const DEFAULT_RETRIES = 3

/** A larger canvas for wide concepts, a square for icon/sheet work. */
const DEFAULT_SIZE_BY_PURPOSE: Record<ImagePurpose, string> = {
  'ui-concept': '1536x1024',
  'icon-concept': '1024x1024',
  'experiment-cover': '1536x1024',
  'share-card': '1536x1024',
  'teacher-asset': '1024x1024',
}

export class UnknownImagePurposeError extends Error {
  constructor(purpose: unknown) {
    super(
      `Unknown image purpose ${JSON.stringify(purpose)}; expected one of the ImagePurpose values.`,
    )
    this.name = 'UnknownImagePurposeError'
  }
}

export interface SunburstProviderOptions {
  /** Defaults to `process.env`; injectable so tests stay off the real environment. */
  env?: NodeJS.ProcessEnv
  /** Defaults to the global `fetch`; injectable for tests. */
  fetchImpl?: typeof fetch
  /** Defaults to a real timer sleep; injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>
  retries?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Sniff intrinsic pixel size and media type from the bytes themselves. */
const decodeImage = (bytes: Uint8Array): { width: number; height: number; mediaType: string } => {
  const ascii = (offset: number, length: number): string =>
    Buffer.from(bytes.subarray(offset, offset + length)).toString('latin1')

  if (bytes.length > 24 && ascii(1, 3) === 'PNG') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20), mediaType: 'image/png' }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1] ?? 0
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isStartOfFrame) {
        return {
          width: view.getUint16(offset + 7),
          height: view.getUint16(offset + 5),
          mediaType: 'image/jpeg',
        }
      }
      offset += 2 + view.getUint16(offset + 2)
    }
  }
  if (bytes.length > 16 && ascii(0, 4) === 'RIFF') {
    return { width: 0, height: 0, mediaType: 'image/webp' }
  }
  return { width: 0, height: 0, mediaType: 'application/octet-stream' }
}

/**
 * Some gateways hand back an asset URL on their own loopback host. Re-point it
 * at the public base URL so the download resolves from here.
 */
const resolveAssetUrl = (rawUrl: string, baseUrl: string): string => {
  const url = new URL(rawUrl)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return rawUrl
  const base = new URL(baseUrl)
  url.protocol = base.protocol
  // Assign hostname and port separately: assigning `.host` leaves the original
  // port in place when the new host carries none.
  url.hostname = base.hostname
  url.port = base.port
  return url.toString()
}

export class SunburstImageProvider implements ImageGenerationProvider {
  readonly id = 'sunburst'

  readonly #env: NodeJS.ProcessEnv | undefined
  readonly #fetch: typeof fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #retries: number

  constructor(options: SunburstProviderOptions = {}) {
    this.#env = options.env
    this.#fetch = options.fetchImpl ?? fetch
    this.#sleep = options.sleep ?? defaultSleep
    this.#retries = options.retries ?? DEFAULT_RETRIES
  }

  async generate(input: GenerateImageInput): Promise<GeneratedImage> {
    if (!isImagePurpose(input.purpose)) throw new UnknownImagePurposeError(input.purpose)

    const prompt = input.prompt.trim()
    if (prompt.length === 0) throw new Error('Image generation requires a non-empty prompt.')

    const config = readImageProviderConfig(this.#env ?? process.env)
    const requestedSize = input.size?.trim() ?? DEFAULT_SIZE_BY_PURPOSE[input.purpose]
    const endpoint = `${config.baseUrl}/v1/images/generations`

    const body = JSON.stringify({ model: config.model, prompt, n: 1, size: requestedSize })
    const text = await this.#postWithRetry(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body,
    })

    const parsed: unknown = JSON.parse(text)
    const item = isRecord(parsed) && Array.isArray(parsed['data']) ? parsed['data'][0] : undefined
    if (!isRecord(item)) throw new Error('Image provider returned no image entry.')

    const { bytes, mediaType } = await this.#readImage(item, config)
    const measured = decodeImage(bytes)

    return {
      bytes,
      mediaType: measured.mediaType === 'application/octet-stream' ? mediaType : measured.mediaType,
      model: config.model,
      endpoint,
      purpose: input.purpose,
      prompt,
      requestedSize,
      width: measured.width,
      height: measured.height,
      revisedPrompt: typeof item['revised_prompt'] === 'string' ? item['revised_prompt'] : null,
    }
  }

  /**
   * `b64_json` is present but EMPTY for large sizes on gpt-image-2, so a
   * non-empty check — not a presence check — decides the download path.
   */
  async #readImage(
    item: Record<string, unknown>,
    config: ImageProviderConfig,
  ): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const inline = item['b64_json']
    if (typeof inline === 'string' && inline.length > 0) {
      return { bytes: new Uint8Array(Buffer.from(inline, 'base64')), mediaType: 'image/png' }
    }

    const remote = item['url']
    if (typeof remote === 'string' && remote.length > 0) {
      const response = await this.#fetchWithTimeout(resolveAssetUrl(remote, config.baseUrl), {})
      if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}.`)
      const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim()
      return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType: mediaType ?? '' }
    }

    throw new Error('Image provider returned neither inline data nor a URL.')
  }

  /**
   * These gateways intermittently 5xx on long prompts, so a transient failure is
   * retried; a 4xx is a real request problem and fails immediately. Errors carry
   * the status and a truncated body only — never the credential.
   */
  async #postWithRetry(endpoint: string, init: RequestInit): Promise<string> {
    let lastError = 'Image request failed.'
    for (let attempt = 1; attempt <= this.#retries; attempt += 1) {
      let response: Response
      try {
        response = await this.#fetchWithTimeout(endpoint, init)
      } catch (error) {
        lastError = `Image request failed: ${error instanceof Error ? error.message : String(error)}`
        if (attempt === this.#retries) break
        await this.#sleep(4000 * attempt)
        continue
      }

      const text = await response.text()
      if (response.ok) return text

      lastError = `Image request rejected with HTTP ${response.status}: ${text.slice(0, 300)}`
      const transient = response.status >= 500 || response.status === 429
      if (!transient || attempt === this.#retries) break
      await this.#sleep(6000 * attempt)
    }
    throw new Error(lastError)
  }

  async #fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}
