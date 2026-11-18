import { describe, expect, it, vi } from 'vitest'
import type { PhysicsosIdentity, IdentityRole } from '../src/identity.ts'
import { generationRoutes } from '../src/generation-routes.ts'
import { generationProxyHandler } from '../src/generation-proxy.ts'
import { GenerationChannelsService } from '../src/generation-service.ts'
import { GenerationTestResponse, addGenerationChannel, generationReq, makeGenerationStore } from './generation-helpers.ts'

const base = '/physicsos/model-pool/generation'
const identity = (role: IdentityRole | null): PhysicsosIdentity => ({
  actorOf: () => role === null ? null : { userKey: 'unit-admin', schoolId: 'unit', username: 'unit', role },
  record: async () => {},
})

describe('generation SUPER_ADMIN API', () => {
  it('gates every read/mutation/model discovery with existing identity', async () => {
    for (const [role, status] of [[null, 401], ['STUDENT', 403], ['TEACHER', 403], ['SCHOOL_ADMIN', 403]] as const) {
      const discover = vi.fn(), store = makeGenerationStore(), handler = generationRoutes({ store, identity: () => identity(role), discoverModels: discover })
      for (const [path, method] of [[`${base}/state`, 'GET'], [`${base}/channels`, 'POST'], [`${base}/channels/id/models`, 'POST']]) {
        const res = new GenerationTestResponse()
        await handler(generationReq(path!, method!, {}), res.asResponse())
        expect(res.status).toBe(status)
      }
      expect(discover).not.toHaveBeenCalled()
    }
    const res = new GenerationTestResponse()
    await generationRoutes({ store: makeGenerationStore(), identity: () => undefined, discoverModels: vi.fn() })(generationReq(`${base}/state`), res.asResponse())
    expect(res.status).toBe(503)
  })

  it('creates/patches keys and returns only masked DTOs', async () => {
    const store = makeGenerationStore(), handler = generationRoutes({ store, identity: () => identity('SUPER_ADMIN'), discoverModels: vi.fn() })
    const created = new GenerationTestResponse()
    await handler(generationReq(`${base}/channels`, 'POST', {
      purpose: 'text', api: 'openai-completions', name: 'text', baseURL: 'https://ai.apizn.com', models: [{ id: 'gpt-6.2-sol' }], selectedModel: 'gpt-6.2-sol',
    }), created.asResponse())
    expect(created.status).toBe(201)
    const channel = JSON.parse(created.body).channel
    const keyRes = new GenerationTestResponse()
    await handler(generationReq(`${base}/channels/${channel.id}/keys`, 'POST', { key: 'unit-secret-12340000', label: 'account' }), keyRes.asResponse())
    expect(keyRes.status).toBe(201)
    expect(keyRes.body).not.toContain('unit-secret')
    expect(keyRes.body).toContain('0000')
    const key = JSON.parse(keyRes.body).key
    const reset = new GenerationTestResponse()
    await handler(generationReq(`${base}/keys/${key.id}/reset`, 'POST', {}), reset.asResponse())
    expect(reset.status).toBe(200)
    const state = new GenerationTestResponse()
    await handler(generationReq(`${base}/state`), state.asResponse())
    expect(JSON.parse(state.body).domain).toBe('physicsos_generation_channels')
    expect(state.body).not.toContain('unit-secret')
    expect(state.headers['cache-control']).toBe('no-store')
  })

  it('rejects JSON arrays, unknown fields, cross-purpose edits and non-JSON mutations', async () => {
    const store = makeGenerationStore(), handler = generationRoutes({ store, identity: () => identity('SUPER_ADMIN'), discoverModels: vi.fn() })
    const { channel } = await addGenerationChannel(store)
    for (const body of [[], { purpose: 'image' }, { key: 'unit-secret-1234' }]) {
      const res = new GenerationTestResponse()
      await handler(generationReq(`${base}/channels/${channel.id}`, 'PATCH', body), res.asResponse())
      expect(res.status).toBe(400)
      expect(res.body).not.toContain('unit-secret')
    }
    const res = new GenerationTestResponse()
    await handler(generationReq(`${base}/settings/text`, 'PATCH', { retryCount: 0 }, { 'content-type': 'text/plain' }), res.asResponse())
    expect(res.status).toBe(400)
    expect(store.settings('text').retryCount).toBe(2)
  })

  it('discovers only the named generation channel and selected generation key', async () => {
    const store = makeGenerationStore(), discover = vi.fn().mockResolvedValue({ models: ['gpt-6.2-sol'], channelId: 'unit-channel', purpose: 'text' })
    const handler = generationRoutes({ store, identity: () => identity('SUPER_ADMIN'), discoverModels: discover })
    const res = new GenerationTestResponse()
    await handler(generationReq(`${base}/channels/unit-channel/models`, 'POST', { keyId: 'unit-key' }), res.asResponse())
    expect(res.status).toBe(200)
    expect(discover).toHaveBeenCalledWith('unit-channel', 'unit-key', expect.any(AbortSignal))
  })

  it('does not publish execution, lease or plaintext-key endpoints', async () => {
    const handler = generationRoutes({ store: makeGenerationStore(), identity: () => identity('SUPER_ADMIN'), discoverModels: vi.fn() })
    for (const endpoint of ['acquire', 'generate-image', 'keys/id/reveal', 'leases/id']) {
      const res = new GenerationTestResponse()
      await handler(generationReq(`${base}/${endpoint}`, 'POST', {}), res.asResponse())
      expect(res.status).toBe(404)
    }
  })
})

describe('private generation loopback authority', () => {
  it('rejects arbitrary models, browser cookies/origin, missing sentinel and generic paths without calling upstream', async () => {
    const store = makeGenerationStore(), upstream = vi.fn()
    await addGenerationChannel(store)
    const service = new GenerationChannelsService({ store, fetchImpl: upstream }), handler = generationProxyHandler(service)
    const route = await service.acquireTextRoute({ requestId: 'unit-job', signal: new AbortController().signal })
    if (route.status !== 'ready') throw new Error('ready')
    for (const [path, model, headers] of [
      ['/_physicsos/generation/v1/chat/completions', 'gpt-6.2-sol', { authorization: 'Bearer physicsos-generation-loopback' }],
      ['/_physicsos/generation/v1/chat/completions', route.model, { authorization: 'Bearer physicsos-generation-loopback', origin: 'https://browser.example.com' }],
      ['/_physicsos/generation/v1/chat/completions', route.model, { authorization: 'Bearer physicsos-generation-loopback', cookie: 'session=unit' }],
      ['/_physicsos/generation/v1/chat/completions', route.model, {}],
      ['/v1/chat/completions', route.model, { authorization: 'Bearer physicsos-generation-loopback' }],
    ] as const) {
      const res = new GenerationTestResponse()
      await handler(generationReq(path, 'POST', { model, stream: true, messages: [] }, headers), res.asResponse())
      expect([403, 404]).toContain(res.status)
    }
    expect(upstream).not.toHaveBeenCalled()
  })
})
