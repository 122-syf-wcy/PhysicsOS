/**
 * Client for the platform model pool's `/physicsos/model-pool` REST surface.
 *
 * The host encrypts every upstream credential and only returns its last four
 * characters. This client mirrors that boundary: submit a plaintext key only
 * when creating or replacing one, and never keep it in component state after
 * the request returns.
 */

const BASE = '/physicsos/model-pool'

export type ModelPoolKeyStatus = 'active' | 'cooldown'

export interface ModelPoolSealedSecretView {
  readonly keyTail: string
}

export interface ModelPoolSettings {
  readonly id: 'settings'
  readonly retryCount: number
  readonly failureThreshold: number
  readonly cooldownBaseMs: number
  readonly cooldownMaxMs: number
  readonly autoRecover: boolean
  readonly updatedAt: string
  readonly updatedBy: string
}

export interface ModelPoolKeyView {
  readonly id: string
  readonly channelId: string
  readonly label: string
  readonly keyTail: string
  readonly enabled: boolean
  readonly weight: number
  readonly status: ModelPoolKeyStatus
  readonly failCount: number
  readonly cooldownUntil: number | null
  readonly lastError: string | null
  readonly lastUsedAt: string | null
  readonly requestCount: number
  readonly failureCount: number
  readonly failureRate: number
  readonly updatedAt: string
  readonly updatedBy: string
}

export interface ModelPoolChannelView {
  readonly id: string
  readonly name: string
  readonly baseURL: string
  readonly models: readonly string[]
  readonly priority: number
  readonly enabled: boolean
  readonly updatedAt: string
  readonly updatedBy: string
  readonly keys: readonly ModelPoolKeyView[]
}

export interface ModelPoolStats {
  readonly channels: number
  readonly keys: number
  readonly activeKeys: number
  readonly cooldownKeys: number
  readonly disabledKeys: number
}

export interface ModelPoolAuditRecord {
  readonly id: string
  readonly at: string
  readonly actorKey: string
  readonly action: string
  readonly target: string
  readonly detail: readonly string[]
}

export interface ModelPoolState {
  readonly settings: ModelPoolSettings
  readonly channels: readonly ModelPoolChannelView[]
  readonly stats: ModelPoolStats
  readonly audit: readonly ModelPoolAuditRecord[]
  readonly encryptionReady: boolean
  readonly proxy: { readonly host: string; readonly port: number }
}

export interface ModelPoolProbeResult {
  readonly ok: boolean
  readonly status: number
  readonly latencyMs: number
  readonly message: string
}

/** The models one channel's upstream reports, and the key that read them. */
export interface ModelPoolChannelModels {
  readonly models: readonly string[]
  readonly keyId: string
}

export interface ModelPoolChannelInput {
  readonly name: string
  readonly baseURL: string
  readonly models?: readonly string[]
  readonly priority?: number
  readonly enabled?: boolean
}

export interface ModelPoolChannelPatch {
  readonly name?: string
  readonly baseURL?: string
  readonly models?: readonly string[]
  readonly priority?: number
  readonly enabled?: boolean
}

export interface ModelPoolKeyInput {
  readonly label?: string
  readonly key: string
  readonly weight?: number
  readonly enabled?: boolean
}

export interface ModelPoolKeyPatch {
  readonly label?: string
  readonly key?: string
  readonly weight?: number
  readonly enabled?: boolean
}

export interface ModelPoolSettingsPatch {
  readonly retryCount?: number
  readonly failureThreshold?: number
  readonly cooldownBaseMs?: number
  readonly cooldownMaxMs?: number
  readonly autoRecover?: boolean
}

/** A host failure with its stable machine-readable code. */
export class ModelPoolApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ModelPoolApiError'
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    ...init,
  })
  const body = await response.json().catch(() => ({})) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new ModelPoolApiError(
      response.status,
      body.error?.code ?? `HTTP_${String(response.status)}`,
      body.error?.message ?? String(response.status),
    )
  }
  return body as T
}

const mutate = <T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<T> =>
  request<T>(path, {
    method,
    body: JSON.stringify(body),
  })

export interface ModelPoolApi {
  state: () => Promise<ModelPoolState>
  createChannel: (input: ModelPoolChannelInput) => Promise<{ channel: ModelPoolChannelView }>
  updateChannel: (id: string, patch: ModelPoolChannelPatch) => Promise<{ channel: ModelPoolChannelView }>
  deleteChannel: (id: string) => Promise<{ ok: boolean }>
  addKey: (channelId: string, input: ModelPoolKeyInput) => Promise<{ key: ModelPoolKeyView }>
  updateKey: (id: string, patch: ModelPoolKeyPatch) => Promise<{ key: ModelPoolKeyView }>
  deleteKey: (id: string) => Promise<{ ok: boolean }>
  resetKey: (id: string) => Promise<{ key: ModelPoolKeyView }>
  testKey: (id: string) => Promise<ModelPoolProbeResult>
  /** Read the channel's upstream model roster with one of its keys. */
  listChannelModels: (channelId: string, keyId?: string) => Promise<ModelPoolChannelModels>
  updateSettings: (patch: ModelPoolSettingsPatch) => Promise<{ settings: ModelPoolSettings }>
}

const channelPath = (id: string): string => `/channels/${encodeURIComponent(id)}`
const keyPath = (id: string): string => `/keys/${encodeURIComponent(id)}`

/** Concrete client bound to the current same-origin session. */
export function createModelPoolApi(): ModelPoolApi {
  return {
    state: () => request('/state'),
    createChannel: input => mutate('/channels', 'POST', input),
    updateChannel: (id, patch) => mutate(channelPath(id), 'PATCH', patch),
    deleteChannel: id => mutate(channelPath(id), 'DELETE', {}),
    addKey: (channelId, input) =>
      mutate(`/channels/${encodeURIComponent(channelId)}/keys`, 'POST', input),
    updateKey: (id, patch) => mutate(keyPath(id), 'PATCH', patch),
    deleteKey: id => mutate(keyPath(id), 'DELETE', {}),
    resetKey: id => mutate(`${keyPath(id)}/reset`, 'POST', {}),
    testKey: id => mutate(`${keyPath(id)}/test`, 'POST', {}),
    listChannelModels: (channelId, keyId) =>
      mutate(`${channelPath(channelId)}/models`, 'POST', keyId === undefined ? {} : { keyId }),
    updateSettings: patch => mutate('/settings', 'PATCH', patch),
  }
}
