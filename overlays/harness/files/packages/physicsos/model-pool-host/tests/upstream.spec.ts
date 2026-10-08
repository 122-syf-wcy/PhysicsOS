import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chatCompletionsURL, listUpstreamModels, modelsURL, probeChat } from '../src/upstream.ts'
import type { ChannelRecord } from '../src/types.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { while (cleanup.length > 0) await cleanup.pop()?.() })

const channelWith = async (respond: (body: Record<string, unknown>, res: ServerResponse, path: string, headers: IncomingHttpHeaders) => void): Promise<ChannelRecord> => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => { respond(JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>, res, req.url ?? '', req.headers) })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) })
  return { id: 'test', name: 'test', baseURL: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1`, models: ['deepseek-v4.1-flash'], priority: 1, enabled: true, createdAt: '', updatedAt: '', updatedBy: '' }
}

const probe = (channel: ChannelRecord, timeoutMs = 1000, signal = new AbortController().signal) =>
  probeChat({ channel, secret: 'sk-only-local-fixture', timeoutMs, signal })

describe('OpenAI-compatible upstream paths', () => {
  for (const [base, expected] of [
    ['https://gateway.example', 'https://gateway.example/v1'],
    ['https://gateway.example/', 'https://gateway.example/v1'],
    ['http://127.0.0.1:8000', 'http://127.0.0.1:8000/v1'],
    ['https://gateway.example/v1', 'https://gateway.example/v1'],
    ['https://gateway.example/v1/', 'https://gateway.example/v1'],
    ['https://gateway.example/api/openai', 'https://gateway.example/api/openai'],
    ['https://gateway.example/api/openai/', 'https://gateway.example/api/openai'],
  ] as const) {
    it(`routes chat and models under ${base}`, () => {
      expect(chatCompletionsURL(base)).toBe(`${expected}/chat/completions`)
      expect(modelsURL(base)).toBe(`${expected}/models`)
    })
  }

  it('uses /v1 for both the probe and model discovery with a saved origin-only channel', async () => {
    const paths: string[] = []
    const channel = await channelWith((_body, res, path) => {
      paths.push(path)
      if (path === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"data":[{"id":"deepseek-v4.1-flash"}]}')
      } else if (path === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end('data: {"choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":"stop"}]}\n\n')
      } else {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html>SPA fallback</html>')
      }
    })
    const rootChannel = { ...channel, baseURL: new URL(channel.baseURL).origin }
    expect((await probe(rootChannel)).ok).toBe(true)
    expect(await listUpstreamModels({ channel: rootChannel, secret: 'sk-only-local-fixture', timeoutMs: 1000, signal: new AbortController().signal })).toEqual(['deepseek-v4.1-flash'])
    expect(paths).toEqual(['/v1/chat/completions', '/v1/models'])
  })
})

describe('merged upstream alias and protocol behavior', () => {
  it('uses the SDK identity and /v1 for a channel alias without weakening stream validation', async () => {
    const seen: { path: string; model: unknown; stream: unknown; agent: string | undefined }[] = []
    const channel = await channelWith((body, res, path, headers) => {
      seen.push({ path, model: body.model, stream: body.stream, agent: headers['user-agent'] })
      if (path === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"data":[{"id":"provider-chat"}]}')
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    })
    const aliased = { ...channel, baseURL: new URL(channel.baseURL).origin, models: ['provider-chat'] }
    const result = await probe(aliased)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('provider-chat')
    expect(await listUpstreamModels({ channel: aliased, secret: 'sk-only-local-fixture', timeoutMs: 1000, signal: new AbortController().signal })).toEqual(['provider-chat'])
    expect(seen).toEqual([
      { path: '/v1/chat/completions', model: 'provider-chat', stream: true, agent: 'OpenAI/Node 5.0.0' },
      { path: '/v1/models', model: undefined, stream: undefined, agent: 'OpenAI/Node 5.0.0' },
    ])
  })
})

describe('streaming key probe', () => {
  it('retains authentication errors and redacts credentials in non-SSE refusals', async () => {
    const channel = await channelWith((_body, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"invalid sk-only-local-fixture"}}')
    })
    const result = await probe(channel)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.message).toContain('invalid')
    expect(result.message).not.toContain('sk-only-local-fixture')
  })

  it('rejects a gateway that accepts nonstream requests but truncates streamed completions', async () => {
    let request: Record<string, unknown> = {}
    const channel = await channelWith((body, res) => {
      request = body
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"choices":[{"message":{"content":"pong"},"finish_reason":"stop"}]}')
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\ndata: [DONE]\n\n')
    })
    const result = await probe(channel)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('finish_reason')
    expect(request).toMatchObject({ model: 'deepseek-v4.1-flash', stream: true, stream_options: { include_usage: true } })
  })

  for (const [label, contentType, body] of [
    ['HTML page', 'text/html', '<html>sk-only-local-fixture</html>'],
    ['JSON error', 'application/json', '{"error":{"message":"sk-only-local-fixture"}}'],
    ['SSE error', 'text/event-stream', 'data: {"error":{"message":"sk-only-local-fixture"}}\n\n'],
    ['invalid JSON', 'text/event-stream', 'data: {broken sk-only-local-fixture}\n\n'],
    ['empty stream', 'text/event-stream', 'data: [DONE]\n\n'],
    ['empty completion', 'text/event-stream', 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'],
    ['oversized event', 'text/event-stream', `data: ${'x'.repeat(1024 * 1024 + 1)}\n\n`],
  ]) {
    it(`rejects HTTP 200 ${label} without echoing upstream secrets`, async () => {
      const channel = await channelWith((_body, res) => { res.writeHead(200, { 'content-type': contentType! }); res.end(body) })
      const result = await probe(channel)
      expect(result.ok).toBe(false)
      expect(result.status).toBe(502)
      expect(result.message).not.toContain('sk-only-local-fixture')
    })
  }

  for (const [delta, finish] of [
    [{ content: 'pong' }, 'stop'],
    [{ reasoning_content: 'thinking' }, 'length'],
    [{ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'ping', arguments: '{}' } }] }, 'tool_calls'],
  ] as const) {
    it(`verifies ${finish} completion through usage trailers and split SSE records`, async () => {
      const channel = await channelWith((_body, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
        res.write(': keepalive\r\n\r\ndata: {"choices":')
        setTimeout(() => {
          res.end(`${JSON.stringify([{ index: 0, delta, finish_reason: finish }])}}\r\n\r\ndata: {"choices":[],"usage":{"completion_tokens":1}}\n\ndata: [DONE]\n\n`)
        }, 25)
      })
      const result = await probe(channel)
      expect(result.ok).toBe(true)
      expect(result.message).toContain('deepseek-v4.1-flash')
      expect(result.message).toContain('流式')
      expect(result.latencyMs).toBeGreaterThanOrEqual(20)
    })
  }

  for (const mode of ['timeout', 'cancel'] as const) {
    it(`cancels a pending body on ${mode} without marking it healthy`, async () => {
      let closed!: () => void
      const ended = new Promise<void>((resolve) => { closed = resolve })
      const channel = await channelWith((_body, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n')
        res.on('close', closed)
      })
      const controller = new AbortController()
      const resultPromise = probe(channel, 100, controller.signal)
      const timer = mode === 'cancel' ? setTimeout(() => { controller.abort() }, 30) : undefined
      const result = await resultPromise
      clearTimeout(timer)
      expect(result.ok).toBe(false)
      expect(result.status).toBe(mode === 'cancel' ? 499 : 504)
      await ended
    })
  }
})
