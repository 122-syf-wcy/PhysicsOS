// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGenerationChannelApi, GenerationChannelApiError } from '../src/client/generation-channel-api.ts'

afterEach(() => { vi.unstubAllGlobals() })
describe('independent generation channel API', () => {
  it('uses authenticated no-store requests, isolated purpose settings and fresh caller signals', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetch)
    const api = createGenerationChannelApi(), first = new AbortController(), second = new AbortController()
    await api.state(first.signal)
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/model-pool/generation/state', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store', signal: first.signal,
    }))
    await api.updateSettings('image', { retryCount: 1 }, second.signal)
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/model-pool/generation/settings/image', expect.objectContaining({
      method: 'PATCH', signal: second.signal, body: '{"retryCount":1}', headers: { 'content-type': 'application/json' },
    }))
  })
  it('sends secrets only in key mutations and discovers models through an existing key ID', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetch)
    const api = createGenerationChannelApi(), signal = new AbortController().signal
    await api.addKey('ch/text', { key: 'sk-only-request-body', weight: 2 }, signal)
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/model-pool/generation/channels/ch%2Ftext/keys', expect.objectContaining({
      method: 'POST', body: '{"key":"sk-only-request-body","weight":2}',
    }))
    await api.listChannelModels('ch/text', 'key-1', signal)
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/model-pool/generation/channels/ch%2Ftext/models', expect.objectContaining({
      body: '{"keyId":"key-1"}',
    }))
    await api.resetKey('key-1', signal)
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/model-pool/generation/keys/key-1/reset', expect.objectContaining({ method: 'POST', body: '{}' }))
  })
  it('retains status and a bounded code without displaying an upstream error body or credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429,
      json: async () => ({ error: { code: 'RATE_LIMITED', message: 'secret sk-do-not-render' } }) }))
    const result = createGenerationChannelApi().state(new AbortController().signal)
    await expect(result).rejects.toEqual(new GenerationChannelApiError(429, 'RATE_LIMITED'))
    await expect(result).rejects.not.toThrow('sk-do-not-render')
  })
})
