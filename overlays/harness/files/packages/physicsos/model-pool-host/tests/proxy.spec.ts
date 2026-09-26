import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { deriveCipherKey } from '../src/crypto.ts'
import { WeightedRotation } from '../src/pool.ts'
import { boundAddress, startModelProxy } from '../src/proxy.ts'
import { PoolStore } from '../src/store.ts'
import { makeDomain } from './fake-domain.ts'

const CIPHER = deriveCipherKey('deployment-secret-value-0123456789')
const ADMIN = { userKey: 'PHYSICSOS-OPEN:admin' }

interface Upstream {
  readonly url: string
  readonly close: () => Promise<void>
  readonly hits: () => number
}

const startUpstream = async (
  respond: (body: Record<string, unknown>, res: import('node:http').ServerResponse) => void,
): Promise<Upstream> => {
  let hits = 0
  const server: Server = createServer((req, res) => {
    hits += 1
    const chunks: Buffer[] = []
    req.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      respond(raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>, res)
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${String(port)}/v1`,
    hits: () => hits,
    close: async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) },
  }
}

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

const makeStore = async (): Promise<PoolStore> => new PoolStore({
  domain: makeDomain(),
  cipherKey: CIPHER,
  /* The same fixed clock and id source make a fresh pool behave identically
     across test runs; production still gets a random first offset. */
  now: () => new Date('2026-09-26T00:00:00.000Z'),
  id: (() => {
    let counter = 0
    return () => `id-${String(++counter)}`
  })(),
  settingsDefaults: {
    retryCount: 2,
    failureThreshold: 3,
    cooldownBaseMs: 30_000,
    cooldownMaxMs: 1_800_000,
    autoRecover: true,
  },
  proxy: { host: '127.0.0.1', port: 0 },
})

const startPool = async (store: PoolStore): Promise<string> => {
  const proxy = await startModelProxy({
    store,
    rotation: new WeightedRotation({ random: () => 0 }),
    attemptTimeoutMs: 5_000,
  }, '127.0.0.1', 0)
  cleanup.push(proxy.close)
  const address = boundAddress(proxy.server)
  return `http://127.0.0.1:${String(address.port)}/v1`
}

const chat = async (base: string): Promise<{ status: number; text: string; attempts: string | null }> => {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }] }),
  })
  return {
    status: response.status,
    text: await response.text(),
    attempts: response.headers.get('x-model-pool-attempts'),
  }
}

describe('model pool proxy', () => {
  it('passes a successful completion through and marks the key healthy', async () => {
    const upstream = await startUpstream((body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'ok', model: body.model }))
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    const key = await store.addKey(ADMIN, channel.id, { key: 'sk-primary-0001' })
    const base = await startPool(store)

    const result = await chat(base)
    expect(result.status).toBe(200)
    expect(result.text).toContain('"ok"')
    expect(result.attempts).toBe('1')
    expect(store.key(key.id)?.requestCount).toBe(1)
  })

  it('fails over to the next key when the first answer is 401', async () => {
    let call = 0
    const upstreamA = await startUpstream((_body, res) => {
      call += 1
      if (call === 1) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid api key sk-leak-me-0001' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'second-key' }))
    })
    cleanup.push(upstreamA.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstreamA.url, priority: 10 })
    const dead = await store.addKey(ADMIN, channel.id, { key: 'sk-dead-0001' })
    const survivor = await store.addKey(ADMIN, channel.id, { key: 'sk-alive-0002' })
    const base = await startPool(store)

    const result = await chat(base)
    expect(result.status).toBe(200)
    expect(result.text).toContain('second-key')
    expect(result.attempts).toBe('2')
    expect(store.key(dead.id)?.status).toBe('cooldown')
    expect(store.key(dead.id)?.lastError).not.toContain('sk-leak-me')
    expect(store.key(survivor.id)?.requestCount).toBe(1)
  })

  it('answers an explicit 503 when every candidate is disabled', async () => {
    const upstream = await startUpstream((_body, res) => { res.writeHead(200); res.end('{}') })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    const key = await store.addKey(ADMIN, channel.id, { key: 'sk-disabled-0003' })
    await store.updateKey(ADMIN, key.id, { enabled: false })
    const base = await startPool(store)

    const result = await chat(base)
    expect(result.status).toBe(503)
    expect(result.text).toContain('MODEL_POOL_MODEL_UNAVAILABLE')
    expect(upstream.hits()).toBe(0)
  })

  it('does not retry a client error the upstream answered with 400', async () => {
    const upstream = await startUpstream((_body, res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad request' } }))
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    await store.addKey(ADMIN, channel.id, { key: 'sk-one-0004' })
    await store.addKey(ADMIN, channel.id, { key: 'sk-two-0005' })
    const base = await startPool(store)

    const result = await chat(base)
    expect(result.status).toBe(400)
    expect(upstream.hits()).toBe(1)
    expect(store.keys()[0]?.lastError).toContain('bad request')
  })

  it('answers 503 MODEL_POOL_EXHAUSTED when every attempt fails', async () => {
    const upstream = await startUpstream((_body, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'upstream down' } }))
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    await store.addKey(ADMIN, channel.id, { key: 'sk-one-0006' })
    await store.addKey(ADMIN, channel.id, { key: 'sk-two-0007' })
    const base = await startPool(store)

    const result = await chat(base)
    expect(result.status).toBe(503)
    expect(result.text).toContain('MODEL_POOL_EXHAUSTED')
    expect(upstream.hits()).toBe(2)
  })

  it('streams a successful response and lists declared models', async () => {
    const upstream = await startUpstream((_body, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"delta":"pong"}\n\n')
      res.end('data: [DONE]\n\n')
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, {
      name: 'a',
      baseURL: upstream.url,
      priority: 10,
      models: ['deepseek-v4.1-flash', 'deepseek-chat'],
    })
    await store.addKey(ADMIN, channel.id, { key: 'sk-stream-0008' })
    const base = await startPool(store)

    const streamed = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4.1-flash', stream: true, messages: [] }),
    })
    expect(streamed.headers.get('content-type')).toContain('text/event-stream')
    expect(await streamed.text()).toContain('[DONE]')

    const models = await fetch(`${base}/models`)
    const listed = await models.json() as { data: { id: string }[] }
    expect(listed.data.map(entry => entry.id).sort()).toEqual(['deepseek-chat', 'deepseek-v4.1-flash'])
  })

  it('rejects an unknown path with the OpenAI error envelope', async () => {
    const store = await makeStore()
    const base = await startPool(store)
    const response = await fetch(`${base}/embeddings`, { method: 'POST' })
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
