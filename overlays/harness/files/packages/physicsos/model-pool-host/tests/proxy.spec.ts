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
  respond: (
    body: Record<string, unknown>,
    res: import('node:http').ServerResponse,
    headers: import('node:http').IncomingHttpHeaders,
    path: string,
  ) => void,
): Promise<Upstream> => {
  let hits = 0
  const server: Server = createServer((req, res) => {
    hits += 1
    const chunks: Buffer[] = []
    req.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      respond(raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>, res, req.headers, req.url ?? '')
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${String(port)}/v1`,
    hits: () => hits,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) },
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

const startPool = async (store: PoolStore, attemptTimeoutMs = 5_000): Promise<string> => {
  const proxy = await startModelProxy({
    store,
    rotation: new WeightedRotation({ random: () => 0 }),
    attemptTimeoutMs,
    nowMs: () => new Date('2026-09-26T00:00:00.000Z').getTime(),
  }, '127.0.0.1', 0)
  cleanup.push(proxy.close)
  const address = boundAddress(proxy.server)
  return `http://127.0.0.1:${String(address.port)}/v1`
}

const chat = async (
  base: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; text: string; attempts: string | null }> => {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-v4.1-flash',
      messages: [{ role: 'user', content: 'hi' }],
      ...body,
    }),
  })
  return {
    status: response.status,
    text: await response.text(),
    attempts: response.headers.get('x-model-pool-attempts'),
  }
}

describe('model pool proxy', () => {
  it('uses the conventional /v1 prefix for an origin-only channel during actual chat', async () => {
    let path = ''
    const upstream = await startUpstream((_body, res, _headers, url) => {
      path = url
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":"stop"}]}\n\n')
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: new URL(upstream.url).origin, priority: 10 })
    await store.addKey(ADMIN, channel.id, { key: 'sk-root-path-001' })
    const base = await startPool(store)
    expect((await chat(base, { stream: true })).status).toBe(200)
    expect(path).toBe('/v1/chat/completions')
  })

  it('passes a successful completion through and marks the key healthy', async () => {
    let seenUserAgent = ''
    const upstream = await startUpstream((body, res, headers) => {
      seenUserAgent = headers['user-agent'] ?? ''
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
    expect(seenUserAgent).toBe('OpenAI/Node 5.0.0')
    expect(store.key(key.id)?.requestCount).toBe(1)
  })

  it('translates the off reasoning sentinel to the gateway-supported none value', async () => {
    let seen: Record<string, unknown> = {}
    const upstream = await startUpstream((body, res) => {
      seen = body
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'ok' }))
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    await store.addKey(ADMIN, channel.id, { key: 'sk-fast-0000' })
    const base = await startPool(store)

    const result = await chat(base, { reasoning_effort: 'off' })
    expect(result.status).toBe(200)
    expect(seen.reasoning_effort).toBe('none')
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

    for (let index = 0; index < 4; index += 1) {
      const result = await chat(base, { stream: true })
      expect(result.status).toBe(400)
    }
    expect(upstream.hits()).toBe(4)
    expect(store.keys()[0]?.failCount).toBe(0)
    expect(store.keys()[0]?.failureCount).toBe(0)
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
      res.write('data: {"choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":null}]}\n\n')
      res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n')
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


describe('committed stream failures', () => {
  for (const truncated of [false, true]) {
    it(`keeps fragmented UTF-8 SSE events parseable with a ${truncated ? 'truncated' : 'complete'} tail`, async () => {
      const first = 'data: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}\r\n\r\n'
      const tail = truncated ? 'data: {"choices":[' : 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\r\n\r\n'
      const upstream = await startUpstream((_body, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const bytes = Buffer.from(first)
        let index = 0
        const send = (): void => {
          if (index === bytes.length) { res.end(tail); return }
          res.write(bytes.subarray(index, index + 1))
          index += 1
          setImmediate(send)
        }
        send()
      })
      cleanup.push(upstream.close)
      const store = await makeStore()
      const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
      const key = await store.addKey(ADMIN, channel.id, { key: 'sk-fragmented-tail' })
      const base = await startPool(store)
      const result = await chat(base, { stream: true })
      const frames = result.text.split(/\r?\n\r?\n/).filter(Boolean)
        .map((frame): unknown => JSON.parse(frame.replace(/^data: /, '')))
      expect(frames).toHaveLength(2)
      expect(frames[0]).toEqual({ choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }] })
      if (truncated) {
        expect(frames[1]).toMatchObject({ error: { code: 'MODEL_POOL_INVALID_STREAM' } })
        expect(store.key(key.id)?.failCount).toBe(1)
        expect(store.key(key.id)?.requestCount).toBe(0)
      } else {
        expect(frames[1]).toEqual({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
        expect(store.key(key.id)?.requestCount).toBe(1)
      }
    })
  }

  it('forwards a complete SSE event before waiting for the rest of the response', async () => {
    const first = 'data: {"choices":[{"index":0,"delta":{"content":"first"},"finish_reason":null}]}\n\n'
    let finish!: () => void
    const upstream = await startUpstream((_body, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(first)
      finish = () => { res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n') }
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    await store.addKey(ADMIN, channel.id, { key: 'sk-event-latency' })
    const base = await startPool(store)
    const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4.1-flash', stream: true }) })
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(first)
    finish()
    while (!(await reader.read()).done) { /* Consume the remaining finished event. */ }
    reader.releaseLock()
  })

  it('does not cool a key when the client cancels while an error body is pending', async () => {
    let started!: () => void
    let ended!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const closed = new Promise<void>((resolve) => { ended = resolve })
    const upstream = await startUpstream((_body, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.write('{"error":')
      res.on('close', ended)
      started()
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    const key = await store.addKey(ADMIN, channel.id, { key: 'sk-errorbody-001' })
    const base = await startPool(store)
    const controller = new AbortController()
    const response = fetch(`${base}/chat/completions`, { signal: controller.signal, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4.1-flash', stream: true }) }).catch(() => undefined)
    await ready
    controller.abort()
    await response
    await closed
    expect(store.key(key.id)?.failCount).toBe(0)
    expect(store.key(key.id)?.status).toBe('active')
  })

  it('reports incomplete SSE and accumulates failures until the key cools down', async () => {
    let calls = 0
    const upstream = await startUpstream((_body, res) => {
      calls += 1
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n')
      setTimeout(() => { res.end(calls % 2 === 0 ? 'data: [DONE]\n\n' : '') }, 5)
    })
    cleanup.push(upstream.close)
    const store = await makeStore()
    const channel = await store.createChannel(ADMIN, { name: 'a', baseURL: upstream.url, priority: 10 })
    const key = await store.addKey(ADMIN, channel.id, { key: 'sk-incomplete-stream' })
    const base = await startPool(store)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await chat(base, { stream: true })
      expect(response.text).toContain('MODEL_POOL_INVALID_STREAM')
      expect(response.text).toContain('finish_reason')
      expect(response.text).not.toContain('"finish_reason":"stop"')
    }
    expect(store.key(key.id)?.failCount).toBe(3)
    expect(store.key(key.id)?.failureCount).toBe(3)
    expect(store.key(key.id)?.requestCount).toBe(0)
    expect(store.key(key.id)?.status).toBe('cooldown')
    expect((await chat(base, { stream: true })).text).toContain('MODEL_POOL_ALL_COOLING')
    expect(upstream.hits()).toBe(3)
  })

  it('fails over an HTTP 200 HTML page before committing the streaming response', async () => {
    const invalid = await startUpstream((_body, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>gateway error sk-do-not-expose</html>')
    })
    cleanup.push(invalid.close)
    let received: Record<string, unknown> = {}
    const valid = await startUpstream((body, res) => {
      received = body
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"check","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n')
    })
    cleanup.push(valid.close)
    const store = await makeStore()
    for (const [index, url] of [invalid.url, valid.url].entries()) {
      const channel = await store.createChannel(ADMIN, { name: `a-${index}`, baseURL: url, priority: index })
      await store.addKey(ADMIN, channel.id, { key: 'sk-stream-002' })
    }
    const base = await startPool(store)
    const tools = [{ type: 'function', function: { name: 'check', parameters: { type: 'object' } } }]
    const response = await chat(base, { stream: true, tools, thinking: { type: 'enabled' } })
    expect(response.status).toBe(200)
    expect(response.attempts).toBe('2')
    expect(response.text).toContain('tool_calls')
    expect(response.text).not.toContain('<html>')
    expect(received.tools).toEqual(tools)
    expect(received.thinking).toEqual({ type: 'enabled' })
    expect(store.keys()[0]?.lastError).toContain('text/event-stream')
    expect(store.keys()[0]?.lastError).not.toContain('sk-do-not-expose')
  })

  for (const mode of ['broken', 'stalled', 'cancelled'] as const) {
    it(`terminates a ${mode} stream without replaying another paid request`, async () => {
      let upstreamClosed!: () => void
      const closed = new Promise<void>((resolve) => { upstreamClosed = resolve })
      const upstream = await startUpstream((_body, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n')
        res.on('close', upstreamClosed)
        if (mode === 'broken') setTimeout(() => res.destroy(), 30)
      })
      cleanup.push(upstream.close)
      const fallback = await startUpstream((_body, res) => { res.end('fallback replay') })
      cleanup.push(fallback.close)
      const store = await makeStore()
      for (const [index, url] of [upstream.url, fallback.url].entries()) {
        const channel = await store.createChannel(ADMIN, { name: `stream-${index}`, baseURL: url, models: ['deepseek-v4.1-flash'], priority: index })
        await store.addKey(ADMIN, channel.id, { key: 'sk-test-stream-001' })
      }
      const base = await startPool(store, 120)
      const abort = new AbortController()
      const response = await fetch(`${base}/chat/completions`, { signal: abort.signal, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4.1-flash', stream: true }) })
      if (mode === 'cancelled') {
        await response.body!.cancel()
      } else {
        const result = await Promise.race([
          response.text().then(value => ({ ok: true, value }), () => ({ ok: false })),
          new Promise(resolve => setTimeout(() => { resolve('still streaming') }, 600)),
        ])
        if (result === 'still streaming') abort.abort()
        expect(result).toEqual({ ok: false })
      }
      await Promise.race([closed, new Promise((_, reject) => setTimeout(() => { reject(new Error('upstream not cancelled')) }, 800))])
      expect(upstream.hits()).toBe(1)
      expect(fallback.hits()).toBe(0)
      if (mode === 'cancelled') {
        expect(store.keys()[0]?.failCount).toBe(0)
        expect(store.keys()[0]?.requestCount).toBe(0)
      }
      if (mode === 'stalled') expect(store.keys()[0]?.lastError).toContain('超时')
    })
  }
})
