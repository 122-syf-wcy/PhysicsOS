/** Offline composition checks: protocol serialization is mocked; no external requests. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { registerGenerationTextProvider } from '../src/generation-registrar.ts'
import { GenerationChannelsService } from '../src/generation-service.ts'
import { ADMIN, addGenerationChannel, makeGenerationStore } from './generation-helpers.ts'

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('private isolated PiAI registrar', () => {
  it('uses exported PiAiAdapter dynamic profiles, exact metadata, no ambient auth or hidden retries, and removes only its own provider', async () => {
    const ctx = new Context(), store = makeGenerationStore()
    const { channel } = await addGenerationChannel(store, 'text', { api: 'openai-responses' })
    await store.updateChannel(ADMIN, channel.id, { models: [{ id: 'gpt-6.2-sol', contextWindow: 200_000, maxTokens: 16_000, reasoningEfforts: { off: 'none', low: 'low' } }] })
    const registered = new Map<string, LlmAdapter>()
    const llm = { registerAdapter(providers: readonly string[], adapter: LlmAdapter) {
      for (const provider of providers) registered.set(provider, adapter)
      return Object.assign(() => { for (const provider of providers) registered.delete(provider) }, { replace: () => {} })
    } }
    const metadata = vi.spyOn(PiAiAdapter.prototype, 'resolveModel').mockImplementation(async function (provider, model) {
      return { provider, id: model, name: 'mocked model' }
    })
    let registrar!: ReturnType<typeof registerGenerationTextProvider>
    const service = new GenerationChannelsService({ store, onLeasesChanged: () => registrar?.refresh() })
    const owner = ctx.plugin((scope) => {
      scope.provide('llm', llm as LlmRuntime)
      registrar = registerGenerationTextProvider(scope, service, '127.0.0.1', 39999)
      scope.effect(() => () => { service.dispose(); return registrar.dispose() })
    })
    try {
      await owner; await settle()
      expect(registrar.available()).toBe(true)
      const route = await service.acquireTextRoute({ requestId: 'job', signal: new AbortController().signal })
      if (route.status !== 'ready') throw new Error('ready')
      const adapter = registered.get(route.provider)!
      expect(await adapter.listModels(route.provider)).toEqual([])
      expect(adapter.providerRetryPolicy(route.provider)).toMatchObject({ maxRetries: 0, retryableCodes: ['GENERATION_NO_RETRY'] })
      await adapter.resolveModel(route.provider, route.model)
      expect(metadata).toHaveBeenCalledWith(route.provider, route.model, undefined)
      service.releaseTextRoute(route.routeId)
      expect(() => adapter.resolveModel(route.provider, route.model)).toThrow()
    } finally {
      metadata.mockRestore(); await owner.dispose()
    }
    expect(registered.size).toBe(0)
  })

  it('stays optional until llm is mounted and does not request any OAuth service', async () => {
    const ctx = new Context(), service = new GenerationChannelsService({ store: makeGenerationStore() })
    let registrar!: ReturnType<typeof registerGenerationTextProvider>
    const owner = ctx.plugin(scope => {
      registrar = registerGenerationTextProvider(scope, service, '127.0.0.1', 39998)
      return () => registrar.dispose()
    })
    await owner; await settle()
    expect(registrar.available()).toBe(false)
    await owner.dispose()
  })
})
