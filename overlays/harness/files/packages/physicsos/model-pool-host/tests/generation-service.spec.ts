import { describe, expect, it, vi } from 'vitest'
import { WeightedRotation } from '../src/pool.ts'
import { GenerationChannelsService } from '../src/generation-service.ts'
import { generationFailureForStatus } from '../src/generation-upstream.ts'
import { ADMIN, CHAT_SSE, GenerationTestResponse, addGenerationChannel, makeGenerationStore, streamResponse } from './generation-helpers.ts'

const acquire = async (service: GenerationChannelsService, requestId = 'unit-job') => {
  const route = await service.acquireTextRoute({ requestId, signal: new AbortController().signal })
  if (route.status !== 'ready') throw new Error('expected ready')
  return route
}
const run = (service: GenerationChannelsService, model: string, res = new GenerationTestResponse(), signal = new AbortController().signal) =>
  service.serveText(model, 'openai-completions', { model, messages: [{ role: 'user', content: 'test' }], stream: true }, res.asResponse(), signal)
const make = (store: ReturnType<typeof makeGenerationStore>, fetchImpl: (url: string, init: RequestInit) => Promise<Response>, elapsedMs?: () => number) =>
  new GenerationChannelsService({ store, fetchImpl, rotation: new WeightedRotation({ random: () => 0 }), ...elapsedMs === undefined ? {} : { elapsedMs } })

describe('private generation text leases', () => {
  it('is unconfigured for missing text config even when image accounts exist', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'image')
    const upstream = vi.fn()
    const service = make(store, upstream)
    expect(await service.acquireTextRoute({ requestId: 'job', signal: new AbortController().signal })).toEqual({ status: 'unconfigured' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('keeps descriptors secret-free and sends exact configured model and key', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { baseURL: 'https://ai.apizn.com', model: 'gpt-6.2-sol' })
    const upstream = vi.fn().mockImplementation(async () => streamResponse())
    const service = make(store, upstream), route = await acquire(service)
    expect(route.actualModel).toBe('gpt-6.2-sol')
    expect(JSON.stringify(route)).not.toContain('credential')
    expect(JSON.stringify(route)).not.toContain('ai.apizn.com')
    const res = new GenerationTestResponse()
    await run(service, route.model, res)
    expect(upstream).toHaveBeenCalledOnce()
    const [url, options] = upstream.mock.calls[0]!
    expect(url).toBe('https://ai.apizn.com/v1/chat/completions')
    expect(JSON.parse(options.body).model).toBe('gpt-6.2-sol')
    expect(options.redirect).toBe('error')
    expect(service.textOutcome(route.routeId)?.kind).toBe('success')
    expect(res.body).toBe(CHAT_SSE)
    service.releaseTextRoute(route.routeId)
    expect(service.textOutcome(route.routeId)).toBeUndefined()
  })

  it('asserts all-limited only after every account returned exact HTTP429', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { keys: 3 })
    const upstream = vi.fn().mockResolvedValue(new Response('never echo unit-credential', { status: 429 }))
    const service = make(store, upstream), route = await acquire(service)
    await expect(run(service, route.model)).rejects.toThrow()
    expect(upstream).toHaveBeenCalledTimes(3)
    expect(service.textOutcome(route.routeId)).toMatchObject({ kind: 'rate-limited', allAccountsRateLimited: true, attemptedAccounts: 3, untriedAccounts: 0 })
    expect(JSON.stringify(service.textOutcome(route.routeId))).not.toContain('unit-credential')
    expect(await service.acquireTextRoute({ requestId: 'next', signal: new AbortController().signal })).toEqual({ status: 'rate-limited' })
  })

  it('never asserts all-limited for mixed auth, transport, server and 429', async () => {
    for (const failure of [401, 403, 408, 409, 425, 500]) {
      const store = makeGenerationStore()
      await addGenerationChannel(store, 'text', { keys: 2 })
      const upstream = vi.fn().mockResolvedValueOnce(new Response('', { status: failure })).mockResolvedValueOnce(new Response('', { status: 429 }))
      const service = make(store, upstream), route = await acquire(service)
      await expect(run(service, route.model)).rejects.toThrow()
      expect(service.textOutcome(route.routeId)?.allAccountsRateLimited).toBe(false)
      expect(service.textOutcome(route.routeId)?.attempts[0]?.status).toBe(failure)
    }
    expect(generationFailureForStatus(408).kind).toBe('transport')
  })

  it('keeps ALL false when account retry budget leaves accounts untried', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { keys: 3 })
    await store.updateSettings(ADMIN, 'text', { retryCount: 0 })
    const upstream = vi.fn().mockResolvedValue(new Response('', { status: 429 }))
    const service = make(store, upstream), route = await acquire(service)
    await expect(run(service, route.model)).rejects.toThrow()
    expect(upstream).toHaveBeenCalledOnce()
    expect(service.textOutcome(route.routeId)).toMatchObject({ allAccountsRateLimited: false, untriedAccounts: 2 })
  })

  it('does not exclude another configured model to fabricate all-limited', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { model: 'gpt-first' })
    await addGenerationChannel(store, 'text', { model: 'gpt-second' })
    const upstream = vi.fn().mockResolvedValue(new Response('', { status: 429 }))
    const service = make(store, upstream), route = await acquire(service)
    await expect(run(service, route.model)).rejects.toThrow()
    expect(service.textOutcome(route.routeId)?.allAccountsRateLimited).toBe(false)
    expect(service.textOutcome(route.routeId)?.untriedAccounts).toBe(1)
  })

  it('uses immutable endpoint/model/key/settings snapshots while config edits affect the next job', async () => {
    const store = makeGenerationStore()
    const { channel, keys } = await addGenerationChannel(store)
    const upstream = vi.fn().mockImplementation(async () => streamResponse())
    const service = make(store, upstream), first = await acquire(service)
    await store.updateChannel(ADMIN, channel.id, { baseURL: 'https://next.example.com/v1', models: [{ id: 'gpt-next' }] })
    await store.updateKey(ADMIN, keys[0]!.id, { key: 'unit-replacement-3333' })
    await store.updateSettings(ADMIN, 'text', { retryCount: 0 })
    await run(service, first.model)
    expect(upstream.mock.calls[0]?.[0]).toBe('https://upstream.example.com/v1/chat/completions')
    expect(JSON.parse(upstream.mock.calls[0]?.[1].body).model).toBe('gpt-6.2-sol')
    expect(upstream.mock.calls[0]?.[1].headers.authorization).toBe('Bearer unit-credential-0-000000')
    const next = await acquire(service, 'next-job')
    expect(next.actualModel).toBe('gpt-next')
    expect(next.configRevision).not.toBe(first.configRevision)
    await run(service, next.model)
    expect(upstream.mock.calls[1]?.[0]).toBe('https://next.example.com/v1/chat/completions')
    expect(store.key(keys[0]!.id)?.requestCount).toBe(1)
  })

  it('allows successive complete same-job code steps but never repeats a failed HTTP dispatch', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store)
    const upstream = vi.fn().mockImplementation(async () => streamResponse())
    const service = make(store, upstream), route = await acquire(service)
    await run(service, route.model); await run(service, route.model)
    expect(upstream).toHaveBeenCalledTimes(2)
    expect(service.textOutcome(route.routeId)?.kind).toBe('success')
  })

  it('marks partial streams terminal and never replays on another key', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { keys: 3 })
    const upstream = vi.fn().mockResolvedValue(streamResponse('data: {"choices":[{"index":0,"delta":{"content":"half"},"finish_reason":null}]}\n\n'))
    const service = make(store, upstream), route = await acquire(service), res = new GenerationTestResponse()
    await run(service, route.model, res)
    expect(upstream).toHaveBeenCalledOnce()
    expect(res.destroyed).toBe(true)
    expect(service.textOutcome(route.routeId)).toMatchObject({ kind: 'partial-exhausted', allAccountsRateLimited: false })
    await expect(run(service, route.model)).rejects.toThrow()
    expect(upstream).toHaveBeenCalledOnce()
  })

  it('does not infer HTTP429 from HTTP200 SSE error text', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store)
    const upstream = vi.fn().mockResolvedValue(streamResponse('data: {"error":{"message":"429 rate limit unit-credential-0-000000"}}\n\n'))
    const service = make(store, upstream), route = await acquire(service)
    await run(service, route.model)
    expect(service.textOutcome(route.routeId)).toMatchObject({ kind: 'partial-exhausted', allAccountsRateLimited: false, status: 200, causeKind: 'server' })
    expect(JSON.stringify(store.state())).not.toContain('unit-credential')
  })

  it('cancels pending body reads without key failure or retry', async () => {
    const store = makeGenerationStore()
    const { keys } = await addGenerationChannel(store, 'text', { keys: 2 })
    const upstream = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } }))
    const service = make(store, upstream), route = await acquire(service), abort = new AbortController()
    const pending = run(service, route.model, new GenerationTestResponse(), abort.signal)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    abort.abort()
    await pending
    expect(service.textOutcome(route.routeId)?.allAccountsRateLimited).toBe(false)
    expect(service.textOutcome(route.routeId)?.cancelled).toBe(true)
    expect(upstream).toHaveBeenCalledOnce()
    expect(store.key(keys[0]!.id)?.failureCount).toBe(0)
  })

  it('supports declared Responses streaming without using completions', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { api: 'openai-responses' })
    const wire = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n'
      + 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message"}]}}\n\n'
    const upstream = vi.fn().mockResolvedValue(streamResponse(wire))
    const service = make(store, upstream), route = await acquire(service), res = new GenerationTestResponse()
    await service.serveText(route.model, 'openai-responses', { model: route.model, stream: true, input: [{ role: 'user', content: 'test' }] }, res.asResponse(), new AbortController().signal)
    expect(upstream.mock.calls[0]?.[0]).toBe('https://upstream.example.com/v1/responses')
    expect(service.textOutcome(route.routeId)).toMatchObject({ kind: 'success', allAccountsRateLimited: false, attemptedAccounts: 1 })
    expect(res.body).toBe(wire)
  })

  it('does not replay an HTTP200 wrong content type against another account', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { keys: 2 })
    const upstream = vi.fn().mockResolvedValue(new Response('gateway page', { headers: { 'content-type': 'text/html' } }))
    const service = make(store, upstream), route = await acquire(service)
    await expect(run(service, route.model)).rejects.toThrow()
    expect(upstream).toHaveBeenCalledOnce()
    expect(service.textOutcome(route.routeId)).toMatchObject({ kind: 'partial-exhausted', allAccountsRateLimited: false, status: 200 })
  })

  it('keeps all-limited false when the time budget leaves eligible accounts untried', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text', { keys: 2 })
    let clock = 0
    const upstream = vi.fn().mockImplementation(async () => { clock = 200_000; return new Response('', { status: 429 }) })
    const service = make(store, upstream, () => clock), route = await acquire(service)
    await expect(run(service, route.model)).rejects.toThrow()
    expect(upstream).toHaveBeenCalledOnce()
    expect(service.textOutcome(route.routeId)).toMatchObject({ allAccountsRateLimited: false, untriedAccounts: 1 })
  })

  it('releases model authority on shared job signal abort', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store)
    const service = make(store, vi.fn()), signal = new AbortController()
    const route = await service.acquireTextRoute({ requestId: 'cancelled-job', signal: signal.signal })
    if (route.status !== 'ready') throw new Error('ready')
    signal.abort()
    expect(service.textLeaseForModel(route.model)).toBeUndefined()
  })
})
