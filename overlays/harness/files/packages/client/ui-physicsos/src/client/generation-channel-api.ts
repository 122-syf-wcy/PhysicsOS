/** Same-origin administration of independent text/image channels; credentials are write-only. */
const BASE = '/physicsos/model-pool/generation'

export type GenerationPurpose = 'text' | 'image'
export type GenerationApiKind = 'openai-responses' | 'openai-completions' | 'openai-images'
export type GenerationEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface GenerationModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly reasoningEfforts?: false | Partial<Record<GenerationEffort, string | null>>
}
export type GenerationFailureKind = 'rate-limited' | 'auth' | 'transport' | 'server' | 'client'
export interface GenerationKeyView {
  readonly id: string
  readonly channelId: string
  readonly purpose: GenerationPurpose
  readonly label: string
  readonly keyTail: string
  readonly enabled: boolean
  readonly weight: number
  readonly status: 'active' | 'cooldown'
  readonly cooldownUntil: number | null
  readonly cooldownReason: GenerationFailureKind | null
  readonly lastHttpStatus: number | null
  readonly lastUsedAt: string | null
  readonly requestCount: number
  readonly failureCount: number
  readonly failureRate: number
}
export interface GenerationChannelView {
  readonly id: string
  readonly purpose: GenerationPurpose
  readonly api: GenerationApiKind
  readonly name: string
  readonly baseURL: string
  readonly models: readonly GenerationModel[]
  readonly selectedModel: string | null
  readonly priority: number
  readonly enabled: boolean
  readonly revision: string
  readonly keys: readonly GenerationKeyView[]
}
export interface GenerationSettings {
  readonly id: GenerationPurpose
  readonly retryCount: number
  readonly failureThreshold: number
  readonly cooldownBaseMs: number
  readonly cooldownMaxMs: number
  readonly autoRecover: boolean
  readonly requestBudgetMs: number
  readonly attemptTimeoutMs: number
  readonly headersTimeoutMs: number
  readonly revision: string
}
export interface GenerationPurposeState {
  readonly configRevision: string
  readonly channels: readonly GenerationChannelView[]
  readonly settings: GenerationSettings
  readonly stats: { readonly channels: number; readonly keys: number; readonly activeKeys: number;
    readonly cooldownKeys: number; readonly disabledKeys: number }
}
export interface GenerationState {
  readonly domain: 'physicsos_generation_channels'
  readonly version: 0
  readonly encryptionReady: boolean
  readonly text: GenerationPurposeState
  readonly image: GenerationPurposeState
}
export interface GenerationChannelInput {
  readonly purpose: GenerationPurpose
  readonly api: GenerationApiKind
  readonly name: string
  readonly baseURL: string
  readonly models: readonly GenerationModel[]
  readonly selectedModel: string | null
  readonly priority: number
  readonly enabled: boolean
}
export type GenerationChannelPatch = Partial<Omit<GenerationChannelInput, 'purpose'>>
export interface GenerationKeyInput {
  readonly key: string
  readonly label?: string
  readonly weight?: number
  readonly enabled?: boolean
}
export type GenerationKeyPatch = Partial<GenerationKeyInput>
export type GenerationSettingsPatch = Partial<Omit<GenerationSettings, 'id' | 'revision'>>
export interface GenerationModelsResult {
  readonly channelId: string
  readonly purpose: GenerationPurpose
  readonly keyId: string
  readonly models: readonly string[]
  readonly suggestedModels: readonly string[]
}

export class GenerationChannelApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super('Generation channel request failed')
    this.name = 'GenerationChannelApiError'
  }
}

async function request<T>(path: string, signal: AbortSignal, method = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method, signal, credentials: 'same-origin', cache: 'no-store',
    ...(input === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  })
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = data !== null && typeof data === 'object' && 'error' in data ? data.error : undefined
    const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : `HTTP_${response.status}`
    throw new GenerationChannelApiError(response.status, code)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new GenerationChannelApiError(502, 'INVALID_RESPONSE')
  }
  return data as T
}

export interface GenerationChannelApi {
  state(signal: AbortSignal): Promise<GenerationState>
  createChannel(input: GenerationChannelInput, signal: AbortSignal): Promise<{ channel: GenerationChannelView }>
  updateChannel(id: string, patch: GenerationChannelPatch, signal: AbortSignal): Promise<{ channel: GenerationChannelView }>
  deleteChannel(id: string, signal: AbortSignal): Promise<{ ok: boolean }>
  addKey(channelId: string, input: GenerationKeyInput, signal: AbortSignal): Promise<{ key: GenerationKeyView }>
  updateKey(id: string, patch: GenerationKeyPatch, signal: AbortSignal): Promise<{ key: GenerationKeyView }>
  deleteKey(id: string, signal: AbortSignal): Promise<{ ok: boolean }>
  resetKey(id: string, signal: AbortSignal): Promise<{ key: GenerationKeyView }>
  listChannelModels(channelId: string, keyId: string | undefined, signal: AbortSignal): Promise<GenerationModelsResult>
  updateSettings(purpose: GenerationPurpose, patch: GenerationSettingsPatch, signal: AbortSignal): Promise<{ settings: GenerationSettings }>
}

/** Each call uses its caller's fresh signal; no credential or response is stored in the browser. */
export function createGenerationChannelApi(): GenerationChannelApi {
  const channel = (id: string) => `/channels/${encodeURIComponent(id)}`
  const key = (id: string) => `/keys/${encodeURIComponent(id)}`
  return {
    state: signal => request('/state', signal),
    createChannel: (input, signal) => request('/channels', signal, 'POST', input),
    updateChannel: (id, patch, signal) => request(channel(id), signal, 'PATCH', patch),
    deleteChannel: (id, signal) => request(channel(id), signal, 'DELETE', {}),
    addKey: (id, input, signal) => request(`${channel(id)}/keys`, signal, 'POST', input),
    updateKey: (id, patch, signal) => request(key(id), signal, 'PATCH', patch),
    deleteKey: (id, signal) => request(key(id), signal, 'DELETE', {}),
    resetKey: (id, signal) => request(`${key(id)}/reset`, signal, 'POST', {}),
    listChannelModels: (id, keyId, signal) => request(`${channel(id)}/models`, signal, 'POST', keyId ? { keyId } : {}),
    updateSettings: (purpose, patch, signal) => request(`/settings/${purpose}`, signal, 'PATCH', patch),
  }
}
