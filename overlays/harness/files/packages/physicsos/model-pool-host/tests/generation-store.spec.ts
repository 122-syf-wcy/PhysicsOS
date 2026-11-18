import { describe, expect, it } from 'vitest'
import { openSecret, deriveCipherKey } from '../src/crypto.ts'
import { generationChannelsDomain } from '../src/generation-domain.ts'
import { normalizeGenerationBaseURL } from '../src/generation-schemas.ts'
import { selectedGenerationModel } from '../src/generation-store.ts'
import { ADMIN, addGenerationChannel, makeGenerationStore } from './generation-helpers.ts'

describe('independent generation persistence', () => {
  it('uses its own version-0 domain and purpose-specific settings', async () => {
    expect(generationChannelsDomain.name).toBe('physicsos_generation_channels')
    expect(generationChannelsDomain.version).toBe(0)
    const store = makeGenerationStore()
    await store.updateSettings(ADMIN, 'text', { retryCount: 5, failureThreshold: 2 })
    expect(store.settings('text').retryCount).toBe(5)
    expect(store.settings('image').retryCount).toBe(2)
    expect(store.state().image.channels).toEqual([])
  })

  it('seals per purpose, masks keys and never persists raw upstream error text', async () => {
    const store = makeGenerationStore()
    const { channel, keys } = await addGenerationChannel(store)
    const key = store.key(keys[0]!.id)!
    expect(store.openKey(key)).toBe('unit-credential-0-000000')
    expect(JSON.stringify(key)).not.toContain('unit-credential')
    expect(() => openSecret(deriveCipherKey('unit-test-generation-secret-0000'), key.secret)).toThrow()
    const image = await addGenerationChannel(store, 'image')
    expect(() => store.openKey({ ...key, purpose: 'image', channelId: image.channel.id })).toThrow()
    await store.markFailure(key, { kind: 'auth', status: 401, code: 'HTTP_401' }, store.settings('text'))
    const state = JSON.stringify(store.state())
    expect(state).not.toContain(key.secret.iv)
    expect(state).not.toContain(key.secret.tag)
    expect(state).not.toContain(key.secret.data)
    expect(state).not.toContain('unit-credential')
    expect(store.state().text.channels[0]?.id).toBe(channel.id)
  })

  it('prefers configured GPT models and honors exact admin selection', async () => {
    const store = makeGenerationStore()
    const created = await store.createChannel(ADMIN, {
      purpose: 'text', api: 'openai-responses', name: 'exact', baseURL: 'https://ai.apizn.com',
      models: [{ id: 'other-text' }, { id: 'gpt-6.2-sol', reasoningEfforts: { off: 'none', low: 'low' } }],
    })
    expect(selectedGenerationModel(store.channel(created.id)!)?.id).toBe('gpt-6.2-sol')
    await store.updateChannel(ADMIN, created.id, { selectedModel: 'other-text' })
    expect(selectedGenerationModel(store.channel(created.id)!)?.id).toBe('other-text')
    await expect(store.updateChannel(ADMIN, created.id, { selectedModel: 'not-declared' })).rejects.toThrow()
  })

  it('does not let old outcomes poison replacement credentials or manual resets', async () => {
    const store = makeGenerationStore()
    const { keys } = await addGenerationChannel(store)
    const original = store.key(keys[0]!.id)!
    await store.updateKey(ADMIN, original.id, { key: 'unit-replacement-value-2222' })
    await store.markFailure(original, { kind: 'rate-limited', status: 429, code: 'HTTP_429' }, store.settings('text'))
    expect(store.key(original.id)?.status).toBe('active')
    expect(store.key(original.id)?.failureCount).toBe(0)
    const replaced = store.key(original.id)!
    await store.resetKey(ADMIN, original.id)
    await store.markFailure(replaced, { kind: 'auth', status: 401, code: 'HTTP_401' }, store.settings('text'))
    expect(store.key(original.id)?.lastFailureKind).toBe(null)
  })

  it('does not carry a previous endpoint failure into newly configured channel health', async () => {
    const store = makeGenerationStore()
    const { channel, keys } = await addGenerationChannel(store)
    const original = store.channel(channel.id)!, key = store.key(keys[0]!.id)!
    await store.updateChannel(ADMIN, channel.id, { baseURL: 'https://next.example.com/v1' })
    await store.markFailure(key, { kind: 'rate-limited', status: 429, code: 'HTTP_429' }, store.settings('text'), original.revision)
    expect(store.key(key.id)?.cooldownReason).toBe(null)
  })

  it('records exact 429 separately from auth and 408/409/425', async () => {
    const store = makeGenerationStore()
    const { keys } = await addGenerationChannel(store, 'text', { keys: 3 })
    for (const [index, failure] of [
      { kind: 'rate-limited' as const, status: 429, code: 'HTTP_429' },
      { kind: 'auth' as const, status: 403, code: 'HTTP_403' },
      { kind: 'transport' as const, status: 408, code: 'HTTP_408' },
    ].entries()) await store.markFailure(store.key(keys[index]!.id)!, failure, store.settings('text'))
    expect(store.key(keys[0]!.id)?.cooldownReason).toBe('rate-limited')
    expect(store.key(keys[0]!.id)?.lastHttpStatus).toBe(429)
    expect(store.key(keys[1]!.id)?.cooldownReason).toBe('auth')
    expect(store.key(keys[2]!.id)?.lastFailureKind).toBe('transport')
    expect(store.key(keys[2]!.id)?.cooldownReason).not.toBe('rate-limited')
  })

  it('fails closed without encryption and rejects purpose/protocol moves', async () => {
    const store = makeGenerationStore({ encryption: false })
    const channel = await store.createChannel(ADMIN, { purpose: 'text', api: 'openai-completions', name: 'empty', baseURL: 'https://upstream.example.com/v1' })
    await expect(store.addKey(ADMIN, channel.id, { key: 'unit-key-123456' })).rejects.toThrow()
    await expect(store.updateChannel(ADMIN, channel.id, { api: 'openai-images' })).rejects.toThrow()
    await expect(store.updateSettings(ADMIN, 'image', { requestBudgetMs: 181_000 })).rejects.toThrow()
  })

  it('rejects embedded credentials and local/private endpoint authorities', () => {
    for (const url of ['http://upstream.example.com', 'https://user:pass@upstream.example.com/v1', 'https://127.0.0.1/v1', 'https://10.0.0.3', 'https://[::ffff:127.0.0.1]', 'https://localhost', 'https://gateway.internal', 'https://upstream.example.com?key=value']) {
      expect(() => normalizeGenerationBaseURL(url)).toThrow()
    }
    expect(normalizeGenerationBaseURL('https://ai.apizn.com/')).toBe('https://ai.apizn.com')
  })
})
