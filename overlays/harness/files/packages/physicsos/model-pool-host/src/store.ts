/**
 * Channel and key state over the `physicsos_model_pool` domain.
 *
 * The store is the only place that touches key material: it seals on write,
 * opens for one attempt, and hands every other reader a {@link KeyView} whose
 * credential is a four-character tail. Validation lives here too — the admin
 * routes stay a thin shape-checking layer above it.
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { PoolError } from './errors.ts'
import { openSecret, sealSecret, tailOf } from './crypto.ts'
import { cooldownMsFor } from './pool.ts'
import type { modelPoolDomain } from './domain.ts'
import type {
  AuditRecord,
  ChannelRecord,
  ChannelView,
  KeyFailure,
  KeyRecord,
  KeyView,
  PoolState,
  PoolStats,
  SettingsRecord,
} from './types.ts'

const AUDIT_LIMIT = 200
const MAX_LABEL = 60
const MAX_MODELS = 50
const MAX_MODEL_CHARS = 120
const MAX_SECRET_CHARS = 4096
const MIN_SECRET_CHARS = 8

/** `example.com/path` with a scheme, no query, no fragment, no trailing slash. */
const normalizeBaseURL = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PoolError(400, 'BAD_REQUEST', '通道地址不能为空')
  }
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new PoolError(400, 'BAD_REQUEST', `通道地址不是合法 URL：${trimmed}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PoolError(400, 'BAD_REQUEST', '通道地址只支持 http/https')
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new PoolError(400, 'BAD_REQUEST', '通道地址不要带查询参数或锚点')
  }
  return parsed.toString().replace(/\/+$/, '')
}

const normalizeLabel = (value: unknown, fallback: string): string => {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new PoolError(400, 'BAD_REQUEST', '名称必须是字符串')
  const trimmed = value.trim()
  if (trimmed === '') throw new PoolError(400, 'BAD_REQUEST', '名称不能为空')
  if (trimmed.length > MAX_LABEL) throw new PoolError(400, 'BAD_REQUEST', `名称最长 ${String(MAX_LABEL)} 个字符`)
  return trimmed
}

const normalizeModels = (value: unknown): readonly string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new PoolError(400, 'BAD_REQUEST', 'models 必须是字符串数组')
  const models: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') throw new PoolError(400, 'BAD_REQUEST', 'models 必须是字符串数组')
    const trimmed = entry.trim()
    if (trimmed === '') continue
    if (trimmed.length > MAX_MODEL_CHARS) {
      throw new PoolError(400, 'BAD_REQUEST', `模型名最长 ${String(MAX_MODEL_CHARS)} 个字符`)
    }
    if (!models.includes(trimmed)) models.push(trimmed)
  }
  if (models.length > MAX_MODELS) {
    throw new PoolError(400, 'BAD_REQUEST', `一个通道最多声明 ${String(MAX_MODELS)} 个模型`)
  }
  return models
}

const normalizeWeight = (value: unknown, fallback: number): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) {
    throw new PoolError(400, 'BAD_REQUEST', 'weight 必须是 1..1000 的整数')
  }
  return value
}

const normalizePriority = (value: unknown, fallback: number): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) {
    throw new PoolError(400, 'BAD_REQUEST', 'priority 必须是 0..1000 的整数')
  }
  return value
}

const normalizeSecret = (value: unknown): string => {
  if (typeof value !== 'string') throw new PoolError(400, 'BAD_REQUEST', 'key 必须是字符串')
  const trimmed = value.trim()
  if (trimmed.length < MIN_SECRET_CHARS) {
    throw new PoolError(400, 'BAD_REQUEST', `key 至少 ${String(MIN_SECRET_CHARS)} 个字符`)
  }
  if (trimmed.length > MAX_SECRET_CHARS) {
    throw new PoolError(400, 'BODY_TOO_LARGE', 'key 过长')
  }
  if (/[\r\n]/.test(trimmed)) throw new PoolError(400, 'BAD_REQUEST', 'key 不能包含换行')
  return trimmed
}

const asBoolean = (value: unknown, fallback: boolean, field: string): boolean => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new PoolError(400, 'BAD_REQUEST', `${field} 必须是布尔值`)
  return value
}

/** Everything the store needs to run. */
export interface PoolStoreOptions {
  readonly domain: Domain<typeof modelPoolDomain>
  /** Deployment secret, already derived; `undefined` leaves the pool write-locked. */
  readonly cipherKey: Buffer | undefined
  readonly now?: () => Date
  readonly id?: () => string
  readonly auditLimit?: number
  /** Values the settings singleton starts from — the plugin config, bounded already. */
  readonly settingsDefaults: Omit<SettingsRecord, 'id' | 'updatedAt' | 'updatedBy'>
  readonly proxy: { readonly host: string; readonly port: number }
}

/** One actor's change, as the audit table records it. */
export interface ActorRef {
  readonly userKey: string
}

/** Fields accepted when creating a channel. */
export interface ChannelInput {
  readonly name: unknown
  readonly baseURL: unknown
  readonly models?: unknown
  readonly priority?: unknown
  readonly enabled?: unknown
}

/** Fields accepted when updating a channel. */
export interface ChannelPatch {
  readonly name?: unknown
  readonly baseURL?: unknown
  readonly models?: unknown
  readonly priority?: unknown
  readonly enabled?: unknown
}

/** Fields accepted when adding a key. */
export interface KeyInput {
  readonly label?: unknown
  readonly key?: unknown
  readonly weight?: unknown
  readonly enabled?: unknown
}

/** Fields accepted when updating a key. */
export interface KeyPatch {
  readonly label?: unknown
  readonly enabled?: unknown
  readonly weight?: unknown
  readonly key?: unknown
}

export class PoolStore {
  private readonly channelsTable
  private readonly keysTable
  private readonly auditTable
  private readonly settingsTable
  private readonly now: () => Date
  private readonly nextId: () => string
  private readonly auditLimit: number
  readonly encryptionReady: boolean
  readonly proxy: { readonly host: string; readonly port: number }
  private readonly defaults: Omit<SettingsRecord, 'id' | 'updatedAt' | 'updatedBy'>
  private readonly cipherKey: Buffer | undefined

  constructor(options: PoolStoreOptions) {
    this.channelsTable = options.domain.table('channels')
    this.keysTable = options.domain.table('keys')
    this.auditTable = options.domain.table('audit')
    this.settingsTable = options.domain.table('settings')
    this.now = options.now ?? ((): Date => new Date())
    this.nextId = options.id ?? ((): string => globalThis.crypto.randomUUID())
    this.auditLimit = options.auditLimit ?? AUDIT_LIMIT
    this.defaults = options.settingsDefaults
    this.cipherKey = options.cipherKey
    this.encryptionReady = options.cipherKey !== undefined
    this.proxy = options.proxy
  }

  /* ---- reads ---- */

  /** Policy in force; the singleton's defaults until an admin saves one. */
  get settings(): SettingsRecord {
    return this.settingsTable.get('settings') ?? {
      id: 'settings',
      ...this.defaults,
      updatedAt: '',
      updatedBy: 'system',
    }
  }

  /** Every channel, oldest first. */
  channels(): readonly ChannelRecord[] {
    return [...this.channelsTable.entries()]
      .map(([, record]) => record)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /** Every key, in creation order. */
  keys(): readonly KeyRecord[] {
    return [...this.keysTable.entries()]
      .map(([, record]) => record)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /** Keys of one channel. */
  keysOf(channelId: string): readonly KeyRecord[] {
    return this.keys().filter(record => record.channelId === channelId)
  }

  /** One channel by id. */
  channel(id: string): ChannelRecord | undefined {
    return this.channelsTable.get(id)
  }

  /** One key by id. */
  key(id: string): KeyRecord | undefined {
    return this.keysTable.get(id)
  }

  /** Decrypt one key for a single attempt. Fail-closed when no secret is mounted. */
  openKey(record: KeyRecord): string {
    if (this.cipherKey === undefined) {
      throw new PoolError(
        503,
        'POOL_SECRET_MISSING',
        '未配置 PHYSICSOS_MODEL_POOL_SECRET，无法解密模型 key',
      )
    }
    return openSecret(this.cipherKey, record.secret)
  }

  /* ---- views ---- */

  keyView(record: KeyRecord): KeyView {
    const attempts = record.requestCount + record.failureCount > 0
      ? record.requestCount + record.failureCount
      : 0
    return {
      id: record.id,
      channelId: record.channelId,
      label: record.label,
      keyTail: record.secret.tail,
      enabled: record.enabled,
      weight: record.weight,
      status: record.status,
      failCount: record.failCount,
      cooldownUntil: record.cooldownUntil,
      lastError: record.lastError,
      lastUsedAt: record.lastUsedAt,
      requestCount: record.requestCount,
      failureCount: record.failureCount,
      failureRate: attempts === 0 ? 0 : record.failureCount / attempts,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    }
  }

  channelView(record: ChannelRecord): ChannelView {
    return {
      id: record.id,
      name: record.name,
      baseURL: record.baseURL,
      models: record.models,
      priority: record.priority,
      enabled: record.enabled,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
      keys: this.keysOf(record.id).map(key => this.keyView(key)),
    }
  }

  stats(): PoolStats {
    const keys = this.keys()
    return {
      channels: this.channels().length,
      keys: keys.length,
      activeKeys: keys.filter(key => key.enabled && key.status === 'active').length,
      cooldownKeys: keys.filter(key => key.enabled && key.status === 'cooldown').length,
      disabledKeys: keys.filter(key => !key.enabled).length,
    }
  }

  recentAudit(limit = 20): readonly AuditRecord[] {
    return [...this.auditTable.entries()]
      .map(([, record]) => record)
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, limit)
  }

  /** The single response the 模型通道 tab renders. */
  state(): PoolState {
    return {
      settings: this.settings,
      channels: this.channels().map(channel => this.channelView(channel)),
      stats: this.stats(),
      audit: this.recentAudit(),
      encryptionReady: this.encryptionReady,
      proxy: this.proxy,
    }
  }

  /* ---- writes ---- */

  async recordAudit(
    actorKey: string,
    action: string,
    target: string,
    detail: readonly string[],
  ): Promise<void> {
    const at = this.now().toISOString()
    const record: AuditRecord = {
      id: this.nextId(),
      at,
      actorKey,
      action,
      target,
      detail: detail.slice(0, 20),
    }
    await this.auditTable.put(record.id, record)
    const rows = [...this.auditTable.entries()].map(([, value]) => value)
    if (rows.length <= this.auditLimit) return
    rows.sort((left, right) => left.at.localeCompare(right.at))
    for (const stale of rows.slice(0, rows.length - this.auditLimit)) {
      await this.auditTable.delete(stale.id)
    }
  }

  async createChannel(
    actor: ActorRef,
    input: ChannelInput,
  ): Promise<ChannelView> {
    const at = this.now().toISOString()
    const record: ChannelRecord = {
      id: this.nextId(),
      name: normalizeLabel(input.name, '未命名通道'),
      baseURL: normalizeBaseURL(input.baseURL),
      models: normalizeModels(input.models),
      priority: normalizePriority(input.priority, 50),
      enabled: asBoolean(input.enabled, true, 'enabled'),
      createdAt: at,
      updatedAt: at,
      updatedBy: actor.userKey,
    }
    await this.channelsTable.put(record.id, record)
    await this.recordAudit(actor.userKey, 'channel.create', record.name, [
      `baseURL=${record.baseURL}`,
      `priority=${String(record.priority)}`,
      `models=${String(record.models.length)}`,
    ])
    return this.channelView(record)
  }

  async updateChannel(
    actor: ActorRef,
    id: string,
    patch: ChannelPatch,
  ): Promise<ChannelView> {
    const current = this.channelsTable.get(id)
    if (current === undefined) throw new PoolError(404, 'NOT_FOUND', '通道不存在')
    const next: ChannelRecord = {
      ...current,
      name: patch.name === undefined ? current.name : normalizeLabel(patch.name, current.name),
      baseURL: patch.baseURL === undefined ? current.baseURL : normalizeBaseURL(patch.baseURL),
      models: patch.models === undefined ? current.models : normalizeModels(patch.models),
      priority: normalizePriority(patch.priority, current.priority),
      enabled: asBoolean(patch.enabled, current.enabled, 'enabled'),
      updatedAt: this.now().toISOString(),
      updatedBy: actor.userKey,
    }
    await this.channelsTable.put(id, next)
    await this.recordAudit(actor.userKey, 'channel.update', next.name, [
      `enabled=${String(next.enabled)}`,
      `priority=${String(next.priority)}`,
    ])
    return this.channelView(next)
  }

  async deleteChannel(actor: ActorRef, id: string): Promise<void> {
    const current = this.channelsTable.get(id)
    if (current === undefined) throw new PoolError(404, 'NOT_FOUND', '通道不存在')
    for (const key of this.keysOf(id)) await this.keysTable.delete(key.id)
    await this.channelsTable.delete(id)
    await this.recordAudit(actor.userKey, 'channel.delete', current.name, [
      `baseURL=${current.baseURL}`,
    ])
  }

  async addKey(
    actor: ActorRef,
    channelId: string,
    input: KeyInput,
  ): Promise<KeyView> {
    const channel = this.channelsTable.get(channelId)
    if (channel === undefined) throw new PoolError(404, 'NOT_FOUND', '通道不存在')
    if (this.cipherKey === undefined) {
      throw new PoolError(
        503,
        'POOL_SECRET_MISSING',
        '未配置 PHYSICSOS_MODEL_POOL_SECRET，无法加密保存 key',
      )
    }
    const secret = normalizeSecret(input.key)
    const at = this.now().toISOString()
    const record: KeyRecord = {
      id: this.nextId(),
      channelId,
      label: normalizeLabel(input.label, `key-${tailOf(secret)}`),
      enabled: asBoolean(input.enabled, true, 'enabled'),
      weight: normalizeWeight(input.weight, 1),
      status: 'active',
      failCount: 0,
      cooldownStreak: 0,
      cooldownUntil: null,
      lastError: null,
      lastUsedAt: null,
      requestCount: 0,
      failureCount: 0,
      secret: sealSecret(this.cipherKey, secret),
      createdAt: at,
      updatedAt: at,
      updatedBy: actor.userKey,
    }
    await this.keysTable.put(record.id, record)
    await this.recordAudit(actor.userKey, 'key.create', `${channel.name}/${record.label}`, [
      `tail=${record.secret.tail}`,
      `weight=${String(record.weight)}`,
    ])
    return this.keyView(record)
  }

  async updateKey(
    actor: ActorRef,
    id: string,
    patch: KeyPatch,
  ): Promise<KeyView> {
    const current = this.keysTable.get(id)
    if (current === undefined) throw new PoolError(404, 'NOT_FOUND', 'key 不存在')
    const replaced = patch.key === undefined ? undefined : normalizeSecret(patch.key)
    if (replaced !== undefined && this.cipherKey === undefined) {
      throw new PoolError(503, 'POOL_SECRET_MISSING', '未配置 PHYSICSOS_MODEL_POOL_SECRET，无法加密保存 key')
    }
    const next: KeyRecord = {
      ...current,
      label: patch.label === undefined ? current.label : normalizeLabel(patch.label, current.label),
      enabled: asBoolean(patch.enabled, current.enabled, 'enabled'),
      weight: normalizeWeight(patch.weight, current.weight),
      secret: replaced === undefined || this.cipherKey === undefined
        ? current.secret
        : sealSecret(this.cipherKey, replaced),
      /* A replaced credential has no history worth keeping. */
      ...(replaced === undefined
        ? {}
        : { status: 'active' as const, failCount: 0, cooldownStreak: 0, cooldownUntil: null, lastError: null }),
      updatedAt: this.now().toISOString(),
      updatedBy: actor.userKey,
    }
    await this.keysTable.put(id, next)
    await this.recordAudit(actor.userKey, 'key.update', next.label, [
      `enabled=${String(next.enabled)}`,
      `weight=${String(next.weight)}`,
      ...(replaced === undefined ? [] : [`replaced=tail:${next.secret.tail}`]),
    ])
    return this.keyView(next)
  }

  async deleteKey(actor: ActorRef, id: string): Promise<void> {
    const current = this.keysTable.get(id)
    if (current === undefined) throw new PoolError(404, 'NOT_FOUND', 'key 不存在')
    await this.keysTable.delete(id)
    await this.recordAudit(actor.userKey, 'key.delete', current.label, [`tail=${current.secret.tail}`])
  }

  /** Clear the health counters and return the key to service. */
  async resetKey(actor: ActorRef, id: string): Promise<KeyView> {
    const current = this.keysTable.get(id)
    if (current === undefined) throw new PoolError(404, 'NOT_FOUND', 'key 不存在')
    const next: KeyRecord = {
      ...current,
      status: 'active',
      failCount: 0,
      cooldownStreak: 0,
      cooldownUntil: null,
      lastError: null,
      updatedAt: this.now().toISOString(),
      updatedBy: actor.userKey,
    }
    await this.keysTable.put(id, next)
    await this.recordAudit(actor.userKey, 'key.reset', next.label, [`tail=${next.secret.tail}`])
    return this.keyView(next)
  }

  async updateSettings(
    actor: ActorRef,
    patch: {
      readonly retryCount?: unknown
      readonly failureThreshold?: unknown
      readonly cooldownBaseMs?: unknown
      readonly cooldownMaxMs?: unknown
      readonly autoRecover?: unknown
    },
  ): Promise<SettingsRecord> {
    const current = this.settings
    const intOr = (value: unknown, fallback: number, min: number, max: number, field: string): number => {
      if (value === undefined) return fallback
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new PoolError(400, 'BAD_REQUEST', `${field} 必须是 ${String(min)}..${String(max)} 的整数`)
      }
      return value
    }
    const cooldownBaseMs = intOr(patch.cooldownBaseMs, current.cooldownBaseMs, 1_000, 3_600_000, 'cooldownBaseMs')
    const cooldownMaxMs = Math.max(
      cooldownBaseMs,
      intOr(patch.cooldownMaxMs, current.cooldownMaxMs, 1_000, 86_400_000, 'cooldownMaxMs'),
    )
    const next: SettingsRecord = {
      id: 'settings',
      retryCount: intOr(patch.retryCount, current.retryCount, 0, 5, 'retryCount'),
      failureThreshold: intOr(patch.failureThreshold, current.failureThreshold, 1, 20, 'failureThreshold'),
      cooldownBaseMs,
      cooldownMaxMs,
      autoRecover: asBoolean(patch.autoRecover, current.autoRecover, 'autoRecover'),
      updatedAt: this.now().toISOString(),
      updatedBy: actor.userKey,
    }
    await this.settingsTable.put('settings', next)
    await this.recordAudit(actor.userKey, 'settings.update', 'settings', [
      `retryCount=${String(next.retryCount)}`,
      `failureThreshold=${String(next.failureThreshold)}`,
      `autoRecover=${String(next.autoRecover)}`,
    ])
    return next
  }

  /* ---- health counters ---- */

  /** One successful attempt: clear the streak and count the request. */
  async markSuccess(keyId: string): Promise<void> {
    const current = this.keysTable.get(keyId)
    if (current === undefined) return
    const next: KeyRecord = {
      ...current,
      status: 'active',
      failCount: 0,
      cooldownStreak: 0,
      cooldownUntil: null,
      lastError: null,
      lastUsedAt: this.now().toISOString(),
      requestCount: current.requestCount + 1,
      updatedAt: this.now().toISOString(),
    }
    await this.keysTable.put(keyId, next)
  }

  /**
   * One failed attempt: count it, and bench the key when it crosses the
   * threshold or failed for an authentication reason.
   * @param keyId - the key that failed.
   * @param failure - the classified upstream outcome.
   * @returns the stored key after the update.
   */
  async markFailure(keyId: string, failure: KeyFailure): Promise<KeyRecord | undefined> {
    const current = this.keysTable.get(keyId)
    if (current === undefined) return undefined
    const settings = this.settings
    const failCount = current.failCount + 1
    const bench = failure.kind === 'auth' || failCount >= settings.failureThreshold
    const streak = bench ? current.cooldownStreak + 1 : current.cooldownStreak
    const at = this.now()
    const next: KeyRecord = {
      ...current,
      failCount,
      status: bench ? 'cooldown' : current.status,
      cooldownStreak: streak,
      cooldownUntil: bench ? at.getTime() + cooldownMsFor(streak, settings) : current.cooldownUntil,
      lastError: failure.message.slice(0, 400),
      lastUsedAt: at.toISOString(),
      failureCount: current.failureCount + 1,
      updatedAt: at.toISOString(),
    }
    await this.keysTable.put(keyId, next)
    return next
  }
}
