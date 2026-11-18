/** Private native generation contract and the independent, version-0 persistence DTOs. */
import type { SealedSecret } from './types.ts'

export const GENERATION_TEXT_PROVIDER = 'physicsos-generation-text'
export const GENERATION_LOOPBACK_BASE_PATH = '/_physicsos/generation/v1'
export const GENERATION_ADMIN_PATH = '/physicsos/model-pool/generation'

export type GenerationPurpose = 'text' | 'image'
export type GenerationTextApi = 'openai-completions' | 'openai-responses'
export type GenerationApi = GenerationTextApi | 'openai-images'
export type GenerationEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type GenerationFailureKind = 'rate-limited' | 'auth' | 'transport' | 'server' | 'client'
export type GenerationOutcomeKind = GenerationFailureKind | 'success' | 'partial-exhausted'

/** Declared metadata, not capabilities guessed from a model name or a /models response. */
export interface GenerationModel {
  readonly id: string
  readonly name?: string | undefined
  readonly contextWindow?: number | undefined
  readonly maxTokens?: number | undefined
  readonly reasoningEfforts?: false | Readonly<Partial<Record<GenerationEffort, string | null | undefined>>> | undefined
}

export interface GenerationChannelRecord {
  readonly id: string
  readonly purpose: GenerationPurpose
  readonly api: GenerationApi
  readonly name: string
  readonly baseURL: string
  readonly models: readonly GenerationModel[]
  /** null prefers a declared GPT model; an explicit choice always wins. */
  readonly selectedModel: string | null
  readonly priority: number
  readonly enabled: boolean
  readonly revision: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly updatedBy: string
}

export interface GenerationKeyRecord {
  readonly id: string
  readonly channelId: string
  readonly purpose: GenerationPurpose
  readonly label: string
  readonly enabled: boolean
  readonly weight: number
  /** Credential identity changes on replacement, never on a request outcome. */
  readonly keyVersion: string
  /** Manual reset fences outcomes already in flight. */
  readonly healthVersion: string
  readonly revision: string
  readonly secret: SealedSecret
  readonly status: 'active' | 'cooldown'
  readonly failCount: number
  readonly cooldownStreak: number
  readonly cooldownUntil: number | null
  readonly cooldownReason: GenerationFailureKind | null
  readonly lastFailureKind: GenerationFailureKind | null
  /** null means no HTTP response was observed; a local timeout is not HTTP 429. */
  readonly lastHttpStatus: number | null
  readonly lastError: string | null
  readonly lastUsedAt: string | null
  readonly requestCount: number
  readonly failureCount: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly updatedBy: string
}

export interface GenerationSettingsRecord {
  readonly id: GenerationPurpose
  readonly retryCount: number
  readonly failureThreshold: number
  readonly cooldownBaseMs: number
  readonly cooldownMaxMs: number
  readonly autoRecover: boolean
  /** Entire HTTP request, including body consumption; not multiplied by retries. */
  readonly requestBudgetMs: number
  readonly attemptTimeoutMs: number
  readonly headersTimeoutMs: number
  readonly revision: string
  readonly updatedAt: string
  readonly updatedBy: string
}

export interface GenerationAuditRecord {
  readonly id: string
  readonly at: string
  readonly actorKey: string
  readonly purpose: GenerationPurpose
  readonly action: string
  /** Only generated ids and allowlisted field names/counts, never input text or keys. */
  readonly target: string
  readonly detail: readonly string[]
}

export interface GenerationKeyView extends Omit<GenerationKeyRecord,
  'secret' | 'createdAt' | 'healthVersion' | 'revision'> {
  readonly keyTail: string
  readonly failureRate: number
}

export interface GenerationChannelView extends Omit<GenerationChannelRecord, 'createdAt'> {
  readonly keys: readonly GenerationKeyView[]
}

export interface GenerationPurposeState {
  readonly configRevision: string
  readonly settings: GenerationSettingsRecord
  readonly channels: readonly GenerationChannelView[]
  readonly stats: {
    readonly channels: number
    readonly keys: number
    readonly activeKeys: number
    readonly cooldownKeys: number
    readonly disabledKeys: number
  }
}

export interface GenerationState {
  readonly domain: 'physicsos_generation_channels'
  readonly version: 0
  readonly encryptionReady: boolean
  readonly text: GenerationPurposeState
  readonly image: GenerationPurposeState
  readonly audit: readonly GenerationAuditRecord[]
}

export interface GenerationActor {
  readonly userKey: string
}

export interface GenerationChannelInput {
  readonly purpose: GenerationPurpose
  readonly api: GenerationApi
  readonly name: string
  readonly baseURL: string
  readonly models?: readonly GenerationModel[] | undefined
  readonly selectedModel?: string | null | undefined
  readonly priority?: number | undefined
  readonly enabled?: boolean | undefined
}

/** Purpose is immutable. Moving an account to another purpose requires a new sealed key. */
export type GenerationChannelPatch = { readonly [K in keyof Omit<GenerationChannelInput, 'purpose'>]?: GenerationChannelInput[K] | undefined }
export interface GenerationKeyInput {
  readonly key: string
  readonly label?: string | undefined
  readonly weight?: number | undefined
  readonly enabled?: boolean | undefined
}
export type GenerationKeyPatch = { readonly [K in keyof GenerationKeyInput]?: GenerationKeyInput[K] | undefined }
export type GenerationSettingsPatch = { readonly [K in keyof Omit<GenerationSettingsRecord,
  'id' | 'revision' | 'updatedAt' | 'updatedBy'>]?: GenerationSettingsRecord[K] | undefined }

export interface GenerationFailure {
  readonly kind: GenerationFailureKind
  readonly status?: number
  /** A host-owned diagnostic code; upstream bodies and exception messages are never copied. */
  readonly code: string
  /** Provider accepted work; replay/account failover would duplicate a partial result. */
  readonly accepted?: boolean
}

export interface GenerationAttempt extends Omit<GenerationFailure, 'kind'> {
  readonly kind: GenerationFailureKind | 'success'
  readonly channelId: string
  readonly keyId: string
  readonly keyVersion: string
  readonly model: string
}

export interface GenerationTextOutcome {
  readonly kind: GenerationOutcomeKind
  readonly allAccountsRateLimited: boolean
  readonly requestId: string
  readonly configRevision: string
  readonly actualModel: string
  readonly totalAccounts: number
  readonly attemptedAccounts: number
  readonly untriedAccounts: number
  readonly attempts: readonly GenerationAttempt[]
  readonly status?: number
  readonly causeKind?: GenerationFailureKind
  readonly code?: string
  readonly cancelled?: boolean
}

export interface AcquireGenerationTextRoute {
  readonly requestId: string
  readonly signal: AbortSignal
}

export type GenerationTextRoute = {
  readonly status: 'ready'
  readonly provider: string
  /** Opaque, process-local lease model. Never an upstream model id or credential. */
  readonly model: string
  readonly routeId: string
  readonly actualModel: string
  readonly configRevision: string
} | { readonly status: 'unconfigured' | 'rate-limited' }

export interface GenerateGenerationImage {
  readonly requestId: string
  readonly prompt: string
  readonly size?: string
  readonly background?: 'auto' | 'opaque' | 'transparent'
  readonly quality?: 'auto' | 'low' | 'medium' | 'high'
  readonly signal: AbortSignal
}

/** Non-negative safe-integer token counts <= 1e9 only; invalid upstream values are omitted, never replaced by zero. */
export interface GenerationImageUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly textInputTokens?: number
  readonly imageInputTokens?: number
}

export interface GenerationImageResult {
  readonly bytes: Uint8Array
  readonly mediaType: 'image/png'
  readonly model: string
  readonly channelId: string
  readonly configRevision: string
  readonly requestId?: string
  readonly usage?: GenerationImageUsage
}

/** Not a remote/browser service. The caller must already have verified the native job owner. */
export interface VisualizationChannels {
  acquireTextRoute(input: AcquireGenerationTextRoute): Promise<GenerationTextRoute>
  textOutcome(routeId: string): GenerationTextOutcome | undefined
  releaseTextRoute(routeId: string): void
  generateImage(input: GenerateGenerationImage): Promise<GenerationImageResult>
  /** Optional host audit; identities are hashed and no main credentials are recorded. */
  recordMainFallback?(input: {
    readonly requestId: string
    readonly provider: string
    readonly model: string
    readonly reason: 'unconfigured' | 'all-http429'
  }): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    visualizationChannels: VisualizationChannels
  }
}

export interface GenerationModelsResult {
  readonly channelId: string
  readonly purpose: GenerationPurpose
  readonly keyId: string
  readonly keyVersion: string
  readonly configRevision: string
  readonly models: readonly string[]
  readonly suggestedModels: readonly string[]
}
