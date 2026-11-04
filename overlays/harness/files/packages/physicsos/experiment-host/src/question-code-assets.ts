/** Runtime image assets belong to one verified generation, never to the public library. */
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { crc32, inflateSync } from 'node:zlib'
import { cssReferences } from './html.ts'
export interface AssetBinding { ownerSessionId: string; ownerKey: string; generationId: string; sceneSha256: string }
export interface QuestionAssetDescriptor { path: string; cssPath: string; sha256: string; width: number; height: number; kind: 'environment' | 'material'; model: string }
export interface GenerateQuestionAssetInput extends AssetBinding { prompt: string; kind: 'environment' | 'material'; signal: AbortSignal }
interface StoredAsset { descriptor: QuestionAssetDescriptor; bytes: Buffer; prompt: string }
interface AssetJob { binding: AssetBinding; expires: number; attempts: number; assets: StoredAsset[] }
interface Options { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }
const MAX_IMAGE = 6 * 1024 * 1024, MAX_BODY = 10 * 1024 * 1024, MAX_MEMORY = 64 * 1024 * 1024
const failure = (code: string): Error => Object.assign(new Error(code), { code })
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const sameBinding = (a: AssetBinding, b: AssetBinding): boolean =>
  a.ownerKey === b.ownerKey && a.ownerSessionId === b.ownerSessionId
  && a.generationId === b.generationId && a.sceneSha256 === b.sceneSha256
async function bounded(response: Response, maximum: number, signal: AbortSignal): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maximum || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw failure('IMAGE_RESPONSE_INVALID')
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximum) throw failure('IMAGE_RESPONSE_INVALID')
      chunks.push(next.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  signal.throwIfAborted()
  return Buffer.concat(chunks)
}
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 45 || bytes.length > MAX_IMAGE || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw failure('IMAGE_RESPONSE_INVALID')
  let width = 0, height = 0, depth = 0, color = 0, ended = false, afterData = false, palette = false
  const compressed: Buffer[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    if (end > bytes.length || length > MAX_IMAGE) throw failure('IMAGE_RESPONSE_INVALID')
    const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + length)
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw failure('IMAGE_RESPONSE_INVALID')
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw failure('IMAGE_RESPONSE_INVALID')
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8] ?? 0; color = data[9] ?? 0
      if (width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > 8_388_608 || depth !== 8 || ![0,2,4,6].includes(color) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw failure('IMAGE_RESPONSE_INVALID')
    } else if (type === 'IDAT') {
      if (!width || afterData) throw failure('IMAGE_RESPONSE_INVALID')
      compressed.push(data)
    }
    else if (type === 'IEND') { ended = length === 0 && end === bytes.length; break }
    else if (type === 'PLTE') {
      if (!width || palette || compressed.length || [0, 4].includes(color) || length === 0 || length > 768 || length % 3) throw failure('IMAGE_RESPONSE_INVALID')
      palette = true
    } else {
      if (!/^[A-Za-z]{4}$/.test(type) || type[0] === type[0]?.toUpperCase()) throw failure('IMAGE_RESPONSE_INVALID')
      if (compressed.length) afterData = true
    }
    offset = end
  }
  if (!ended || !compressed.length || !width) throw failure('IMAGE_RESPONSE_INVALID')
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : 1
  const expected = height * (width * channels + 1)
  try {
    const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected })
    if (pixels.length !== expected) throw failure('IMAGE_RESPONSE_INVALID')
    for (let row = 0; row < height; row++) if ((pixels[row * (width * channels + 1)] ?? 255) > 4) throw failure('IMAGE_RESPONSE_INVALID')
  }
  catch { throw failure('IMAGE_RESPONSE_INVALID') }
  return { width, height }
}
export class QuestionCodeAssets {
  private readonly jobs = new Map<string, AssetJob>()
  private readonly env: NodeJS.ProcessEnv
  private readonly fetcher: typeof fetch
  constructor(options: Options = {}) { this.env = options.env ?? process.env; this.fetcher = options.fetchImpl ?? fetch }
  private prune(): void { for (const [key, job] of this.jobs) if (job.expires < Date.now()) this.jobs.delete(key) }
  private job(binding: AssetBinding, create = false): AssetJob | undefined {
    this.prune()
    if (!binding.generationId || binding.generationId.length > 200 || !binding.ownerKey || !binding.ownerSessionId || !/^[a-f0-9]{64}$/.test(binding.sceneSha256)) throw failure('IMAGE_BINDING_INVALID')
    const prior = this.jobs.get(binding.generationId)
    if (prior && !sameBinding(prior.binding, binding)) throw failure('IMAGE_BINDING_INVALID')
    if (prior || !create) return prior
    if (this.jobs.size >= 64) throw failure('IMAGE_CAPACITY')
    const job = { binding: { ...binding }, expires: Date.now() + 20 * 60_000, attempts: 0, assets: [] }
    this.jobs.set(binding.generationId, job)
    return job
  }
  manifest(binding: AssetBinding): QuestionAssetDescriptor[] {
    return (this.job(binding)?.assets ?? []).map(asset => ({ ...asset.descriptor }))
  }
  files(binding: AssetBinding, source: string, stylesheet = ''): Map<string, Buffer> {
    const available = this.job(binding)?.assets ?? []
    const masked = source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, value => ' '.repeat(value.length))
    const references = new Set(cssReferences(stylesheet.replace(/\/\*[\s\S]*?\*\//g, '')))
    for (const match of source.matchAll(/\.src\s*=\s*(["'])([^"']+)\1/g)) {
      if (masked.slice(match.index, match.index + 4) === '.src') references.add(match[2] ?? '')
    }
    for (const match of source.matchAll(/\.setAttribute\s*\(\s*(["'])src\1\s*,\s*(["'])([^"']+)\2\s*\)/g)) {
      if (masked.slice(match.index, match.index + 13) === '.setAttribute') references.add(match[3] ?? '')
    }
    const selected = available.filter(asset => references.has(asset.descriptor.path) || references.has(asset.descriptor.cssPath))
    for (const match of (source + '\n' + stylesheet).matchAll(/(?:\.\/)?(?:assets\/)?generated\/[a-f0-9]+\.png/g)) {
      if (!available.some(asset => asset.descriptor.path.endsWith(match[0].replace(/^\.\//, '')))) throw failure('IMAGE_BINDING_INVALID')
    }
    if (available.length && !selected.length) throw failure('IMAGE_UNUSED')
    const files = new Map<string, Buffer>()
    for (const asset of selected) {
      const name = asset.descriptor.path.slice(2)
      files.set('public/' + name, asset.bytes); files.set('dist/' + name, asset.bytes)
    }
    if (selected.length) {
      const provenance = Buffer.from(JSON.stringify(selected.map(asset => ({ ...asset.descriptor, prompt: asset.prompt, source: 'PhysicsOS runtime image model', usage: 'Appearance only; physics remains engine-owned' })), null, 2))
      files.set('public/assets/generated/provenance.json', provenance)
      files.set('dist/assets/generated/provenance.json', provenance)
    }
    return files
  }
  async generate(input: GenerateQuestionAssetInput): Promise<QuestionAssetDescriptor> {
    const isAborted = (): boolean => input.signal.aborted
    if (isAborted()) throw failure('IMAGE_ABORTED')
    if (!['environment', 'material'].includes(input.kind) || !input.prompt.trim() || input.prompt.length > 5000) throw failure('IMAGE_INPUT_INVALID')
    const job = this.job(input, true)
    if (!job) throw failure('IMAGE_BINDING_INVALID')
    if (job.attempts >= 2) throw failure('IMAGE_LIMIT')
    job.attempts++
    const controller = new AbortController(), onAbort = (): void => { controller.abort() }
    input.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { controller.abort() }, 180_000)
    try {
      const env = this.env
      const keyFile = env.PHYSICSOS_IMAGE_API_KEY_FILE ?? env.PHYSICOS_IMAGE_API_KEY_FILE ?? '/run/secrets/image_api_key'
      const key = (env.PHYSICSOS_IMAGE_API_KEY ?? env.PHYSICOS_IMAGE_API_KEY ?? await readFile(keyFile, 'utf8').catch(() => '')).trim()
      if (!key || /placeholder|set-later/i.test(key)) throw failure('IMAGE_NOT_CONFIGURED')
      const base = new URL(env.PHYSICSOS_IMAGE_API_BASE ?? env.PHYSICOS_IMAGE_API_BASE ?? 'https://image.haqiuhaqiu.xyz')
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw failure('IMAGE_NOT_CONFIGURED')
      const model = env.PHYSICSOS_IMAGE_API_MODEL ?? env.PHYSICOS_IMAGE_API_MODEL ?? 'gpt-image-2.5-sunburst'
      const endpoint = base.href.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/images/generations'
      const prompt = 'PhysicsOS Warm Lab runtime appearance asset. Natural materials, soft daylight, credible physical laboratory. No text, numbers, formulas, arrows, trajectories, graphs, watermarks or baked-in moving objects. Leave clear space for engine-driven apparatus.\n' + input.prompt
      const response = await this.fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model, prompt, n: 1, size: input.kind === 'environment' ? '1536x1024' : '1024x1024', response_format: 'b64_json' }), redirect: 'error', signal: controller.signal })
      if (!response.ok) { await response.body?.cancel(); throw failure('IMAGE_GENERATION_FAILED') }
      const parsed: unknown = JSON.parse((await bounded(response, MAX_BODY, controller.signal)).toString('utf8'))
      const item = typeof parsed === 'object' && parsed !== null && 'data' in parsed && Array.isArray(parsed.data) ? parsed.data[0] as unknown : undefined
      if (typeof item !== 'object' || item === null) throw failure('IMAGE_RESPONSE_INVALID')
      let bytes: Buffer
      if ('b64_json' in item && typeof item.b64_json === 'string' && item.b64_json.length > 0) {
        if (item.b64_json.length > MAX_IMAGE * 1.4 || !/^[A-Za-z0-9+/=\r\n]+$/.test(item.b64_json)) throw failure('IMAGE_RESPONSE_INVALID')
        bytes = Buffer.from(item.b64_json, 'base64')
      } else if ('url' in item && typeof item.url === 'string') {
        const url = new URL(item.url)
        if (url.origin !== base.origin || url.protocol !== 'https:' || url.username || url.password || url.hash) throw failure('IMAGE_RESPONSE_INVALID')
        const download = await this.fetcher(url, { signal: controller.signal, redirect: 'error' })
        if (!download.ok) { await download.body?.cancel(); throw failure('IMAGE_GENERATION_FAILED') }
        bytes = await bounded(download, MAX_IMAGE, controller.signal)
      } else throw failure('IMAGE_RESPONSE_INVALID')
      controller.signal.throwIfAborted()
      const dimensions = pngSize(bytes)
      const resident = [...this.jobs.values()].flatMap(value => value.assets).reduce((sum, asset) => sum + asset.bytes.length, 0)
      if (resident + bytes.length > MAX_MEMORY) throw failure('IMAGE_CAPACITY')
      const id = randomBytes(16).toString('hex'), descriptor: QuestionAssetDescriptor = { path: './assets/generated/' + id + '.png', cssPath: './generated/' + id + '.png', sha256: digest(bytes), ...dimensions, kind: input.kind, model }
      job.assets.push({ descriptor, bytes, prompt })
      return { ...descriptor }
    } catch (error) {
      if (controller.signal.aborted || isAborted()) throw failure(isAborted() ? 'IMAGE_ABORTED' : 'IMAGE_TIMEOUT')
      if (error instanceof Error && /^IMAGE_[A-Z_]+$/.test(error.message)) throw error
      throw failure('IMAGE_GENERATION_FAILED')
    } finally { clearTimeout(timer); input.signal.removeEventListener('abort', onAbort); controller.abort() }
  }
}
