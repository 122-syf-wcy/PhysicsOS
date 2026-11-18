/** Register only the isolated text provider; no settings-profile rewrite or generic adapter changes. */
import { PiAiAdapter, type PiAiAdapterOptions, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import type { Api, Model, ModelThinkingLevel, Provider, ProviderStreams } from '@earendil-works/pi-ai'
import { LlmAdapter, LlmError, type GenerateOptions, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerationChannelsService, GenerationTextLease } from './generation-service.ts'
import { GENERATION_LOOPBACK_BASE_PATH, GENERATION_TEXT_PROVIDER, type GenerationModel, type GenerationTextApi } from './generation-types.ts'

const NO_RETRY = Object.freeze({ mode: 'normal' as const, maxRetries: 0, retryableCodes: ['GENERATION_NO_RETRY'], initialDelayMs: 500, maxDelayMs: 500, jitterRatio: 0 })
const EFFORTS: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** API-key accounts only. Never read generic credentials, process env or OAuth/filesystem state. */
const PRIVATE_AUTH: PiAiAdapterOptions['auth'] = {
  credentials: {
    read: async () => undefined, list: async () => [],
    modify: async () => { throw new LlmError('Generation credentials are managed by the admin account pool', 'AUTH') },
    delete: async () => { throw new LlmError('Generation credentials are managed by the admin account pool', 'AUTH') },
  },
  authContext: { env: async () => undefined, fileExists: async () => false },
}

/** Known GPT metadata comes from the installed catalog; unknown models require declared metadata. */
const piModel = (lease: GenerationTextLease, baseURL: string): Model<Api> => {
  const account = lease.preferredAccount
  const declared: GenerationModel = account.model
  const builtin = /^gpt(?:[-_.]|$)/i.test(declared.id)
    ? getBuiltinModels('openai').find(model => model.id === declared.id) : undefined
  const api = account.channel.api as GenerationTextApi
  const efforts = declared.reasoningEfforts
  const thinkingLevelMap = efforts === undefined ? builtin?.thinkingLevelMap : efforts === false ? undefined
    : Object.fromEntries(EFFORTS.flatMap((level): [ModelThinkingLevel, string | null][] => efforts[level] === undefined
      ? [[level, null]] : efforts[level] === null ? [] : [[level, efforts[level]!]]))
  const reasoning = efforts === false ? false : efforts === undefined ? builtin?.reasoning ?? false : true
  const compat = api === 'openai-completions' ? {
    supportsStore: true, supportsDeveloperRole: true, supportsUsageInStreaming: true, supportsFinishReason: true,
    maxTokensField: reasoning ? 'max_completion_tokens' as const : 'max_tokens' as const,
    supportsReasoningEffort: reasoning, thinkingFormat: 'openai' as const,
  } : { supportsDeveloperRole: true, supportsMaxOutputTokens: true, supportsStrictMode: true }
  return {
    id: lease.model, name: declared.name ?? declared.id, provider: GENERATION_TEXT_PROVIDER, api, baseUrl: baseURL,
    reasoning, ...thinkingLevelMap === undefined ? {} : { thinkingLevelMap }, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: declared.contextWindow ?? builtin?.contextWindow ?? 262_144,
    maxTokens: declared.maxTokens ?? builtin?.maxTokens ?? 32_768, compat,
  }
}

const makeProfile = (leases: readonly GenerationTextLease[], baseURL: string): ResolvedPiAiProviderProfile => {
  const models = leases.map(lease => piModel(lease, baseURL))
  const byModel = new Map(models.map(model => [model.id, model]))
  const protocols: Readonly<Record<GenerationTextApi, ProviderStreams>> = {
    'openai-completions': openAICompletionsApi(), 'openai-responses': openAIResponsesApi(),
  }
  const protocol = (model: Model<Api>): ProviderStreams => {
    if (!byModel.has(model.id) || model.api !== 'openai-completions' && model.api !== 'openai-responses') {
      throw new LlmError('Generation model lease is unavailable', 'NO_ADAPTER')
    }
    return model.api === 'openai-completions' ? protocols['openai-completions'] : protocols['openai-responses']
  }
  const provider: Provider = {
    id: GENERATION_TEXT_PROVIDER, name: 'Visualization generation (private)', baseUrl: baseURL,
    auth: { apiKey: { name: 'Generation loopback', resolve: ({ credential }) => Promise.resolve({
      auth: credential?.key === undefined ? {} : { apiKey: credential.key }, source: 'Generation loopback',
    }) } },
    getModels: () => models,
    stream: (model, context, options) => protocol(model).stream(model, context, options),
    streamSimple: (model, context, options) => protocol(model).streamSimple(model, context, options),
  }
  return {
    provider: GENERATION_TEXT_PROVIDER, displayName: 'Visualization generation (private)', piProvider: provider,
    baseURL, streamIdleTimeoutMs: 240_000, timeoutMs: 900_000, transport: 'sse',
    maxRequestImageBytes: 0, requestImagePixelBudget: 1, requestImageMaxBytes: 1,
    retryPolicy: NO_RETRY, modelErrors: new Map(),
    configuredMaxTokens: new Map(leases.flatMap(lease => {
      const declared = lease.preferredAccount.model.maxTokens
      return declared === undefined ? [] : [[lease.model, declared] as const]
    })),
  }
}

/** Wrap PiAI only to keep leases private and sanitize its text-classified failure envelopes. */
class PrivateGenerationAdapter extends LlmAdapter {
  constructor(private readonly service: GenerationChannelsService, private readonly pi: PiAiAdapter) { super() }
  override providerInfo(provider: string) { return { id: provider, name: 'Visualization generation (private)' } }
  override providerRetryPolicy() { return NO_RETRY }
  override listModels() { return Promise.resolve([]) }
  override resolveModel(provider: string, model: string, signal?: AbortSignal) {
    this.assertLease(provider, model, signal)
    return this.pi.resolveModel(provider, model, signal)
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    this.assertLease(provider, model, signal)
    const call = await this.pi.prepareCall(provider, model, signal)
    return { model: call.model, stream: options => this.sanitize(options, () => call.stream(options)) }
  }
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.sanitize(options, () => this.pi.stream(options)) }

  private assertLease(provider: string, model: string, signal?: AbortSignal): GenerationTextLease {
    signal?.throwIfAborted()
    const lease = provider === GENERATION_TEXT_PROVIDER ? this.service.textLeaseForModel(model) : undefined
    if (lease === undefined || lease.signal.aborted || lease.blocked) throw new LlmError('Generation model lease is unavailable', 'GENERATION_LEASE_CLOSED')
    return lease
  }

  private async * sanitize(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
    const lease = this.assertLease(options.provider, options.model, options.signal)
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          const outcome = this.service.textOutcome(lease.routeId)
          yield {
            type: 'finish', reason: {
              kind: options.signal?.aborted || lease.signal.aborted ? 'aborted' : 'error',
              failure: { code: outcome?.cancelled ? 'ABORTED' : 'GENERATION_TEXT_FAILED', message: 'Generation text request failed',
                ...outcome?.status === undefined ? {} : { status: outcome.status } },
            },
          }
        } else yield chunk
      }
    } catch {
      const outcome = this.service.textOutcome(lease.routeId)
      throw new LlmError('Generation text request failed', options.signal?.aborted || lease.signal.aborted ? 'ABORTED' : 'GENERATION_TEXT_FAILED',
        outcome?.status === undefined ? undefined : { status: outcome.status })
    }
  }
}

export interface GenerationRegistrar {
  readonly refresh: () => void
  readonly available: () => boolean
  readonly dispose: () => Promise<void>
}

export const registerGenerationTextProvider = (
  ctx: Context, service: GenerationChannelsService, host: string, port: number,
): GenerationRegistrar => {
  const baseURL = `http://${host.includes(':') ? `[${host}]` : host}:${port}${GENERATION_LOOPBACK_BASE_PATH}`
  let profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  const refresh = (): void => {
    profiles = new Map([[GENERATION_TEXT_PROVIDER, makeProfile(service.activeTextLeases(), baseURL)]])
  }
  refresh()
  const pi = new PiAiAdapter({
    profiles: () => profiles,
    auth: PRIVATE_AUTH,
    resolveApiKey: async provider => {
      if (provider !== GENERATION_TEXT_PROVIDER) throw new LlmError('Unknown generation provider', 'NO_ADAPTER')
      return 'physicsos-generation-loopback'
    },
  })
  const adapter = new PrivateGenerationAdapter(service, pi)
  let registered = false
  const pending = ctx.inject(['llm'], (ready) => ready.effect(() => {
    const registration = ready.llm.registerAdapter([GENERATION_TEXT_PROVIDER], adapter)
    registered = true
    return () => { registered = false; registration() }
  }))
  return { refresh, available: () => registered, dispose: () => pending.dispose() }
}
