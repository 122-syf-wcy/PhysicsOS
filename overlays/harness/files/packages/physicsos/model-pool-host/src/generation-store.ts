/** Generation-only CRUD, ciphertext and version-fenced health accounting. */
import { createHash, hkdfSync, randomUUID } from 'node:crypto'
import { DomainError, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { openSecret, sealSecret } from './crypto.ts'
import { PoolError } from './errors.ts'
import type { generationChannelsDomain } from './generation-domain.ts'
import {
  parseGenerationChannelInput, parseGenerationChannelPatch, parseGenerationKeyInput,
  parseGenerationKeyPatch, parseGenerationSettingsPatch,
} from './generation-schemas.ts'
import type {
  GenerationActor, GenerationAuditRecord, GenerationChannelInput, GenerationChannelPatch,
  GenerationChannelRecord, GenerationChannelView, GenerationFailure, GenerationKeyInput,
  GenerationKeyPatch, GenerationKeyRecord, GenerationKeyView, GenerationModel, GenerationPurpose,
  GenerationPurposeState, GenerationSettingsPatch, GenerationSettingsRecord, GenerationState,
} from './generation-types.ts'

export interface GenerationStoreOptions {
  readonly domain: Domain<typeof generationChannelsDomain>
  readonly cipherKey: Buffer | undefined
  readonly now?: () => Date
  readonly id?: () => string
  readonly auditLimit?: number
}

/** Defaults are independent of all generic pool settings and credentials. */
export const defaultGenerationSettings = (purpose: GenerationPurpose): GenerationSettingsRecord => ({
  id: purpose,
  retryCount: 2,
  failureThreshold: 3,
  cooldownBaseMs: 30_000,
  cooldownMaxMs: 1_800_000,
  autoRecover: true,
  requestBudgetMs: purpose === 'image' ? 180_000 : 240_000,
  attemptTimeoutMs: 180_000,
  headersTimeoutMs: purpose === 'image' ? 180_000 : 60_000,
  revision: `default-${purpose}-v0`,
  updatedAt: '',
  updatedBy: 'system',
})

/** A preference among explicitly configured models, never a generic/main model fallback. */
export const selectedGenerationModel = (channel: GenerationChannelRecord): GenerationModel | undefined =>
  channel.selectedModel === null
    ? channel.models.find(model => /^gpt(?:[-_.]|$)/i.test(model.id)) ?? channel.models[0]
    : channel.models.find(model => model.id === channel.selectedModel)

const assertChannel = (channel: Pick<GenerationChannelRecord, 'purpose' | 'api' | 'models' | 'selectedModel'>): void => {
  if (channel.purpose === 'image' ? channel.api !== 'openai-images' : channel.api === 'openai-images') {
    throw new PoolError(400, 'GENERATION_BAD_REQUEST', '文本和图片通道必须使用各自声明的 API')
  }
  if (channel.selectedModel !== null && !channel.models.some(model => model.id === channel.selectedModel)) {
    throw new PoolError(400, 'GENERATION_BAD_REQUEST', '所选模型必须在该通道的已配置模型列表中')
  }
  if (channel.purpose === 'image' && channel.models.some(model => model.reasoningEfforts !== undefined
    || model.contextWindow !== undefined || model.maxTokens !== undefined)) {
    throw new PoolError(400, 'GENERATION_BAD_REQUEST', '图片模型不接受文本容量或推理档位配置')
  }
}

const healthReset = {
  status: 'active' as const, failCount: 0, cooldownStreak: 0, cooldownUntil: null, cooldownReason: null,
  lastFailureKind: null, lastHttpStatus: null, lastError: null,
}

export class GenerationStore {
  private readonly channelsTable
  private readonly keysTable
  private readonly settingsTable
  private readonly auditTable
  private readonly now: () => Date
  private readonly nextId: () => string
  private readonly auditLimit: number
  private readonly ciphers: ReadonlyMap<GenerationPurpose, Buffer>
  readonly encryptionReady: boolean
  /** Serialize admin read/modify/write independently of per-key durable update callbacks. */
  private writes: Promise<void> = Promise.resolve()

  constructor(options: GenerationStoreOptions) {
    this.channelsTable = options.domain.table('channels')
    this.keysTable = options.domain.table('keys')
    this.settingsTable = options.domain.table('settings')
    this.auditTable = options.domain.table('audit')
    this.now = options.now ?? (() => new Date())
    this.nextId = options.id ?? randomUUID
    this.auditLimit = options.auditLimit ?? 200
    const cipherKey = options.cipherKey
    this.ciphers = new Map(cipherKey === undefined ? [] : (['text', 'image'] as const).map(purpose => [
      purpose, Buffer.from(hkdfSync('sha256', cipherKey, 'physicsos.generation-channels.v0', purpose, 32)),
    ]))
    this.encryptionReady = options.cipherKey !== undefined
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.writes.then(job)
    this.writes = result.then(() => undefined, () => undefined)
    return result
  }

  channels(purpose?: GenerationPurpose): readonly GenerationChannelRecord[] {
    return [...this.channelsTable.entries()].map(([, record]) => structuredClone(record))
      .filter(record => purpose === undefined || record.purpose === purpose)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  keys(purpose?: GenerationPurpose): readonly GenerationKeyRecord[] {
    return [...this.keysTable.entries()].map(([, record]) => structuredClone(record))
      .filter(record => purpose === undefined || record.purpose === purpose)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  channel(id: string): GenerationChannelRecord | undefined {
    const value = this.channelsTable.get(id)
    return value === undefined ? undefined : structuredClone(value)
  }

  key(id: string): GenerationKeyRecord | undefined {
    const value = this.keysTable.get(id)
    return value === undefined ? undefined : structuredClone(value)
  }

  settings(purpose: GenerationPurpose): GenerationSettingsRecord {
    return structuredClone(this.settingsTable.get(purpose) ?? defaultGenerationSettings(purpose))
  }

  /** Health writes do not change configuration identity; revisions contain no ciphertext or key tails. */
  configRevision(purpose: GenerationPurpose): string {
    const facts = [this.settings(purpose).revision,
      ...this.channels(purpose).map(record => `${record.id}:${record.revision}`),
      ...this.keys(purpose).map(record => `${record.id}:${record.revision}`),
    ]
    return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32)
  }

  openKey(record: GenerationKeyRecord): string {
    const cipher = this.ciphers.get(record.purpose)
    if (cipher === undefined) throw new PoolError(503, 'GENERATION_SECRET_UNAVAILABLE', '生成通道加密密钥未配置')
    return openSecret(cipher, record.secret)
  }

  keyView(record: GenerationKeyRecord): GenerationKeyView {
    const { secret, createdAt: _createdAt, healthVersion: _healthVersion, revision: _revision, ...view } = record
    const total = record.requestCount + record.failureCount
    return { ...view, keyTail: secret.tail, failureRate: total === 0 ? 0 : record.failureCount / total }
  }

  channelView(record: GenerationChannelRecord): GenerationChannelView {
    const { createdAt: _createdAt, ...view } = record
    return { ...view, keys: this.keys(record.purpose).filter(key => key.channelId === record.id).map(key => this.keyView(key)) }
  }

  private purposeState(purpose: GenerationPurpose): GenerationPurposeState {
    const channels = this.channels(purpose), keys = this.keys(purpose)
    return {
      configRevision: this.configRevision(purpose), settings: this.settings(purpose),
      channels: channels.map(channel => this.channelView(channel)),
      stats: {
        channels: channels.length, keys: keys.length,
        activeKeys: keys.filter(key => key.enabled && key.status === 'active').length,
        cooldownKeys: keys.filter(key => key.enabled && key.status === 'cooldown').length,
        disabledKeys: keys.filter(key => !key.enabled).length,
      },
    }
  }

  state(): GenerationState {
    return {
      domain: 'physicsos_generation_channels', version: 0, encryptionReady: this.encryptionReady,
      text: this.purposeState('text'), image: this.purposeState('image'),
      audit: [...this.auditTable.entries()].map(([, record]) => structuredClone(record))
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, 40),
    }
  }

  private async audit(actor: GenerationActor, purpose: GenerationPurpose, action: string, target: string, detail: readonly string[]): Promise<void> {
    const record: GenerationAuditRecord = {
      id: this.nextId(), at: this.now().toISOString(), actorKey: actor.userKey, purpose, action, target, detail,
    }
    await this.auditTable.put(record.id, record)
    const all = [...this.auditTable.entries()].map(([, row]) => row).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    for (const stale of all.slice(0, Math.max(0, all.length - this.auditLimit))) await this.auditTable.delete(stale.id)
  }

  createChannel(actor: GenerationActor, input: GenerationChannelInput): Promise<GenerationChannelView> {
    return this.enqueue(async () => {
      const parsed = parseGenerationChannelInput(input)
      const at = this.now().toISOString()
      const record: GenerationChannelRecord = {
        id: this.nextId(), purpose: parsed.purpose, api: parsed.api, name: parsed.name, baseURL: parsed.baseURL,
        models: parsed.models ?? [], selectedModel: parsed.selectedModel ?? null,
        priority: parsed.priority ?? 50, enabled: parsed.enabled ?? true,
        revision: this.nextId(), createdAt: at, updatedAt: at, updatedBy: actor.userKey,
      }
      assertChannel(record)
      if (this.channels().length >= 100) throw new PoolError(409, 'GENERATION_CAPACITY', '生成通道数量已达上限')
      await this.channelsTable.put(record.id, record)
      await this.audit(actor, record.purpose, 'channel.create', record.id, [`models=${record.models.length}`, `priority=${record.priority}`])
      return this.channelView(record)
    })
  }

  updateChannel(actor: GenerationActor, id: string, patch: GenerationChannelPatch): Promise<GenerationChannelView> {
    return this.enqueue(async () => {
      const parsed = parseGenerationChannelPatch(patch)
      const current = this.channel(id)
      if (current === undefined) throw new PoolError(404, 'NOT_FOUND', '生成通道不存在')
      const next: GenerationChannelRecord = {
        ...current, api: parsed.api ?? current.api, name: parsed.name ?? current.name, baseURL: parsed.baseURL ?? current.baseURL,
        models: parsed.models ?? current.models, selectedModel: parsed.selectedModel === undefined ? current.selectedModel : parsed.selectedModel,
        priority: parsed.priority ?? current.priority, enabled: parsed.enabled ?? current.enabled,
        revision: this.nextId(), updatedAt: this.now().toISOString(), updatedBy: actor.userKey,
      }
      assertChannel(next)
      await this.channelsTable.put(id, next)
      await this.audit(actor, next.purpose, 'channel.update', id, Object.keys(parsed).map(field => `field=${field}`))
      return this.channelView(next)
    })
  }

  deleteChannel(actor: GenerationActor, id: string): Promise<void> {
    return this.enqueue(async () => {
      const channel = this.channel(id)
      if (channel === undefined) throw new PoolError(404, 'NOT_FOUND', '生成通道不存在')
      await this.channelsTable.delete(id)
      for (const key of this.keys(channel.purpose).filter(key => key.channelId === id)) await this.keysTable.delete(key.id)
      await this.audit(actor, channel.purpose, 'channel.delete', id, [])
    })
  }

  addKey(actor: GenerationActor, channelId: string, input: GenerationKeyInput): Promise<GenerationKeyView> {
    return this.enqueue(async () => {
      const parsed = parseGenerationKeyInput(input), channel = this.channel(channelId)
      if (channel === undefined) throw new PoolError(404, 'NOT_FOUND', '生成通道不存在')
      const cipher = this.ciphers.get(channel.purpose)
      if (cipher === undefined) throw new PoolError(503, 'GENERATION_SECRET_UNAVAILABLE', '生成通道加密密钥未配置')
      if (this.keys().length >= 600) throw new PoolError(409, 'GENERATION_CAPACITY', '生成账号数量已达上限')
      const at = this.now().toISOString()
      const record: GenerationKeyRecord = {
        id: this.nextId(), channelId, purpose: channel.purpose, label: parsed.label ?? 'API key',
        enabled: parsed.enabled ?? true, weight: parsed.weight ?? 1,
        keyVersion: this.nextId(), healthVersion: this.nextId(), revision: this.nextId(),
        secret: sealSecret(cipher, parsed.key), ...healthReset,
        lastUsedAt: null, requestCount: 0, failureCount: 0, createdAt: at, updatedAt: at, updatedBy: actor.userKey,
      }
      await this.keysTable.put(record.id, record)
      await this.audit(actor, channel.purpose, 'key.create', record.id, [`channelId=${channelId}`, `weight=${record.weight}`])
      return this.keyView(record)
    })
  }

  updateKey(actor: GenerationActor, id: string, patch: GenerationKeyPatch): Promise<GenerationKeyView> {
    return this.enqueue(async () => {
      const parsed = parseGenerationKeyPatch(patch), current = this.key(id)
      if (current === undefined) throw new PoolError(404, 'NOT_FOUND', '生成账号不存在')
      const cipher = this.ciphers.get(current.purpose)
      if (parsed.key !== undefined && cipher === undefined) throw new PoolError(503, 'GENERATION_SECRET_UNAVAILABLE', '生成通道加密密钥未配置')
      const version = parsed.key === undefined ? current.keyVersion : this.nextId()
      const next = await this.keysTable.update(id, record => ({
        ...record,
        label: parsed.label ?? record.label, enabled: parsed.enabled ?? record.enabled, weight: parsed.weight ?? record.weight,
        ...(parsed.key === undefined || cipher === undefined ? {} : {
          secret: sealSecret(cipher, parsed.key), keyVersion: version, healthVersion: this.nextId(),
          ...healthReset, requestCount: 0, failureCount: 0, lastUsedAt: null,
        }),
        revision: this.nextId(), updatedAt: this.now().toISOString(), updatedBy: actor.userKey,
      }))
      await this.audit(actor, next.purpose, 'key.update', id, Object.keys(parsed).map(field => `field=${field}`))
      return this.keyView(next)
    })
  }

  deleteKey(actor: GenerationActor, id: string): Promise<void> {
    return this.enqueue(async () => {
      const key = this.key(id)
      if (key === undefined) throw new PoolError(404, 'NOT_FOUND', '生成账号不存在')
      await this.keysTable.delete(id)
      await this.audit(actor, key.purpose, 'key.delete', id, [])
    })
  }

  resetKey(actor: GenerationActor, id: string): Promise<GenerationKeyView> {
    return this.enqueue(async () => {
      const next = await this.keysTable.update(id, record => ({
        ...record, ...healthReset, healthVersion: this.nextId(), revision: this.nextId(),
        updatedAt: this.now().toISOString(), updatedBy: actor.userKey,
      })).catch((error: unknown) => {
        if (error instanceof DomainError && error.code === 'missing-key') throw new PoolError(404, 'NOT_FOUND', '生成账号不存在')
        throw error
      })
      await this.audit(actor, next.purpose, 'key.reset', id, [])
      return this.keyView(next)
    })
  }

  updateSettings(actor: GenerationActor, purpose: GenerationPurpose, patch: GenerationSettingsPatch): Promise<GenerationSettingsRecord> {
    return this.enqueue(async () => {
      const parsed = parseGenerationSettingsPatch(patch)
      const current = this.settings(purpose)
      const next: GenerationSettingsRecord = {
        ...current, retryCount: parsed.retryCount ?? current.retryCount, failureThreshold: parsed.failureThreshold ?? current.failureThreshold,
        cooldownBaseMs: parsed.cooldownBaseMs ?? current.cooldownBaseMs, cooldownMaxMs: parsed.cooldownMaxMs ?? current.cooldownMaxMs,
        autoRecover: parsed.autoRecover ?? current.autoRecover, requestBudgetMs: parsed.requestBudgetMs ?? current.requestBudgetMs,
        attemptTimeoutMs: parsed.attemptTimeoutMs ?? current.attemptTimeoutMs, headersTimeoutMs: parsed.headersTimeoutMs ?? current.headersTimeoutMs,
        revision: this.nextId(), updatedAt: this.now().toISOString(), updatedBy: actor.userKey,
      }
      if (next.cooldownBaseMs > next.cooldownMaxMs || next.headersTimeoutMs > next.attemptTimeoutMs
        || next.attemptTimeoutMs > next.requestBudgetMs || purpose === 'image' && next.requestBudgetMs > 180_000) {
        throw new PoolError(400, 'GENERATION_BAD_REQUEST', '超时/冷却范围不一致；图片请求总预算不得超过 180 秒')
      }
      await this.settingsTable.put(purpose, next)
      await this.audit(actor, purpose, 'settings.update', purpose, Object.keys(parsed).map(field => `field=${field}`))
      return next
    })
  }

  /** Applies only to the account and manual-health version actually captured by this job. */
  private async health(key: GenerationKeyRecord, update: (current: GenerationKeyRecord) => GenerationKeyRecord, channelRevision?: string): Promise<void> {
    try {
      await this.keysTable.update(key.id, current => current.keyVersion === key.keyVersion
        && current.healthVersion === key.healthVersion
        && (channelRevision === undefined || this.channelsTable.get(current.channelId)?.revision === channelRevision)
        ? update(current) : current)
    } catch (error) {
      if (error instanceof DomainError && error.code === 'missing-key') return
      throw error
    }
  }

  async markSuccess(key: GenerationKeyRecord, channelRevision?: string): Promise<void> {
    await this.health(key, current => ({
      ...current, ...healthReset, requestCount: current.requestCount + 1,
      lastUsedAt: this.now().toISOString(),
    }), channelRevision)
  }

  async markFailure(key: GenerationKeyRecord, failure: GenerationFailure, settings: GenerationSettingsRecord, channelRevision?: string): Promise<void> {
    await this.health(key, current => {
      const failCount = current.failCount + 1
      // A 429 benches immediately. 408/409/425, transport and auth are never rate cooldowns.
      const bench = failure.kind === 'rate-limited' || failure.kind === 'auth' || failCount >= settings.failureThreshold
      const streak = bench ? current.cooldownStreak + 1 : current.cooldownStreak
      const cooldown = Math.min(settings.cooldownMaxMs, settings.cooldownBaseMs * 2 ** Math.min(16, Math.max(0, streak - 1)))
      return {
        ...current, failCount, failureCount: current.failureCount + 1,
        status: bench ? 'cooldown' : current.status, cooldownStreak: streak,
        cooldownUntil: bench ? this.now().getTime() + cooldown : current.cooldownUntil,
        cooldownReason: bench ? failure.kind : current.cooldownReason,
        lastFailureKind: failure.kind, lastHttpStatus: failure.status ?? null,
        lastError: failure.status === undefined ? failure.kind : `HTTP ${failure.status} (${failure.kind})`,
        lastUsedAt: this.now().toISOString(),
      }
    }, channelRevision)
  }

  /** Host-owned fallback observability. No main credential, upstream body or task prompt is persisted. */
  recordMainFallback(input: { readonly requestId: string; readonly provider: string; readonly model: string; readonly reason: 'unconfigured' | 'all-http429' }): Promise<void> {
    return this.enqueue(() => this.audit({ userKey: 'system:generation' }, 'text', 'text.main-fallback',
      createHash('sha256').update(input.requestId).digest('hex').slice(0, 32), [
        `reason=${input.reason}`,
        `provider=${createHash('sha256').update(input.provider).digest('hex').slice(0, 16)}`,
        `model=${createHash('sha256').update(input.model).digest('hex').slice(0, 16)}`,
      ]))
  }
}
