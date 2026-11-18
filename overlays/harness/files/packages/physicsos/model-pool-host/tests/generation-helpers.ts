/** Source-only, serialized fake domain and HTTP responses. No network or real credentials. */
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DomainError, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { deriveCipherKey } from '../src/crypto.ts'
import type { generationChannelsDomain } from '../src/generation-domain.ts'
import { GenerationStore } from '../src/generation-store.ts'
import type { GenerationPurpose } from '../src/generation-types.ts'

export const makeGenerationDomain = (): Domain<typeof generationChannelsDomain> => {
  let tail: Promise<void> = Promise.resolve()
  const queue = <T>(job: () => T): Promise<T> => {
    const result = tail.then(job)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  const tables = new Map<string, ReturnType<typeof table>>()
  function table() {
    const map = new Map<string, object>()
    return {
      get: (id: string) => map.get(id), entries: () => map.entries(),
      put: (id: string, value: object) => queue(() => { map.set(id, structuredClone(value)) }),
      update: (id: string, update: (record: object) => object) => queue(() => {
        const current = map.get(id)
        if (current === undefined) throw new DomainError('missing-key', 'missing')
        const next = update(structuredClone(current)); map.set(id, structuredClone(next)); return next
      }),
      delete: (id: string) => queue(() => map.delete(id)),
    }
  }
  return {
    name: 'physicsos_generation_channels',
    table: (name: string) => {
      let existing = tables.get(name)
      if (existing === undefined) { existing = table(); tables.set(name, existing) }
      return existing as never
    },
    close: async () => {},
  } as Domain<typeof generationChannelsDomain>
}

export const makeGenerationStore = (options: { now?: () => Date; encryption?: boolean } = {}) => {
  let count = 0
  return new GenerationStore({
    domain: makeGenerationDomain(), cipherKey: options.encryption === false ? undefined : deriveCipherKey('unit-test-generation-secret-0000'),
    id: () => `id-${++count}`, ...options.now === undefined ? {} : { now: options.now },
  })
}
export const ADMIN = { userKey: 'unit-super-admin' }
export const addGenerationChannel = async (store: GenerationStore, purpose: GenerationPurpose = 'text', input: {
  model?: string; api?: 'openai-completions' | 'openai-responses'; priority?: number; keys?: number; baseURL?: string;
} = {}) => {
  const channel = await store.createChannel(ADMIN, {
    purpose, api: purpose === 'image' ? 'openai-images' : input.api ?? 'openai-completions',
    name: 'Unit channel', baseURL: input.baseURL ?? 'https://upstream.example.com/v1',
    models: [{ id: input.model ?? (purpose === 'text' ? 'gpt-6.2-sol' : 'gpt-image-unit') }], priority: input.priority ?? 10,
  })
  const keys = []
  for (let i = 0; i < (input.keys ?? 1); i++) keys.push(await store.addKey(ADMIN, channel.id, { key: `unit-credential-${i}-000000`, label: `account-${i}` }))
  return { channel, keys }
}

export class GenerationTestResponse extends EventEmitter {
  status = 0
  headers: Record<string, string> = {}
  headersSent = false
  writableEnded = false
  destroyed = false
  body = ''
  writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers; this.headersSent = true; return this }
  write(body: string | Uint8Array) { this.body += typeof body === 'string' ? body : Buffer.from(body).toString('utf8'); return true }
  end(body?: string | Uint8Array) { if (body !== undefined) this.write(body); this.writableEnded = true; return this }
  destroy() { this.destroyed = true; this.emit('close'); return this }
  asResponse(): ServerResponse { return this as never }
}

export const generationReq = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): IncomingMessage => {
  const emitter = new EventEmitter()
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
  return Object.assign(emitter, {
    method, url: path, headers: { 'content-type': 'application/json', 'content-length': String(bytes.length), ...headers },
    [Symbol.asyncIterator]: async function* () { if (bytes.length > 0) yield bytes },
  }) as IncomingMessage
}

export const CHAT_SSE = 'data: {"id":"test","choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":null}]}\n\n'
  + 'data: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
  + 'data: [DONE]\n\n'
export const streamResponse = (body = CHAT_SSE) => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
export const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=', 'base64'))
