/** Bounded, single-writer activity accounting. No cross-domain exactly-once promise. */
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { activitySuccessCapsuleSchema, type ActivityDelivery, type ActivityOwner, type ActivityReplaySource, type ActivitySink, type ActivitySource, type ActivitySuccessCapsule } from './activity-contract.ts'
import { activityBucketWire, activityClientWire, type ActivityDomain, type ActivityReceiptRecord, type ActivityStateRecord, type ActivityWarningRecord } from './activity-domain.ts'
import { ACTIVITY_MODULES, ACTIVITY_REPLAY_MS, ACTIVITY_RETENTION_DAYS, ACTIVITY_SHARDS, ACTIVITY_SOURCES, ACTIVITY_SOURCE_MODULE, DEFAULT_ACTIVITY_LIMITS, type ActivityAvatar, type ActivityAvatarSnapshot, type ActivityCounts, type ActivityDateQuery, type ActivityEventAck, type ActivityIntegrity, type ActivityLimits, type ActivityModule, type ActivityModuleCounts, type ActivityRankQuery, type ActivityRoster, type ActivityRosterUser, type ActivitySchoolRanking, type ActivitySchoolRow, type ActivityUserDetail } from './activity-types.ts'
import { LearningError, type IdentityActor } from './identity.ts'

const DAY = 86_400_000
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytes = (key: string, value: unknown): number => Buffer.byteLength(key, 'utf8') + Buffer.byteLength(JSON.stringify(value), 'utf8')
const sameOwner = (left: ActivityOwner, right: ActivityOwner): boolean => left.schoolId === right.schoolId && left.userKey === right.userKey
const compareId = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const later = (left: string | undefined, right: string | undefined): string | undefined => right === undefined ? left : left === undefined || right > left ? right : left
const counts = (): ActivityCounts => ({ visits: 0, opens: 0, uses: 0 })
const add = (left: ActivityCounts, right: ActivityCounts): ActivityCounts => {
  const value = { visits: left.visits + right.visits, opens: left.opens + right.opens, uses: left.uses + right.uses }
  if (Object.values(value).some(count => !Number.isSafeInteger(count) || count < 0)) throw new LearningError(409, 'ACTIVITY_COUNTER_RANGE', '统计计数超出安全整数范围。')
  return value
}
export const activityDayOf = (instant: Date): string => new Date(instant.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
const offsetDay = (day: string, offset: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10)
/** Only dates STRICTLY before this date may discard dedup/applied journals; the boundary date stays whole. */
export const activityReplayOldestDay = (instant: Date): string => activityDayOf(new Date(instant.getTime() - ACTIVITY_REPLAY_MS))
const dayWire = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
})
const dateQueryWire = z.strictObject({ days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]).optional(), to: dayWire.optional() })
const rankQueryWire = dateQueryWire.extend({
  schoolId: z.string().min(1).max(64).optional(), q: z.string().max(100).optional(),
  page: z.number().int().min(1).max(10_000).optional(), pageSize: z.number().int().min(1).max(100).optional(),
  sort: z.enum(['uses', 'visits', 'opens', 'activeUsers', 'adoptedUsers']).optional(), order: z.enum(['asc', 'desc']).optional(),
})
const targetWire = z.strictObject({ schoolId: z.string().min(1).max(64), username: z.string().min(1).max(128) })
const schoolWire = z.strictObject({ id: z.string().min(1).max(64), name: z.string().min(1).max(160), status: z.enum(['active', 'disabled']), mergedInto: z.string().max(64).optional(), rosterAliasOf: z.string().max(64).optional(), archivedAt: z.string().max(80).optional(), reviewState: z.string().max(40).optional() })
const rosterUserWire = z.strictObject({ schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160), username: z.string().min(1).max(128), status: z.enum(['active', 'disabled']), role: z.enum(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']), avatarUrl: z.string().max(512).optional() })
const rosterWire = z.strictObject({ version: z.string().min(1).max(200), schools: z.array(schoolWire), users: z.array(rosterUserWire) })
const avatarIds = ['silver-greeting', 'indigo-reader', 'butterfly-light', 'pendulum', 'batik-star', 'mountain-sound', 'lens-maker', 'copper-drum', 'green-wave', 'red-embroidery', 'silver-moon', 'discovery'] as const
const avatarLabels = ['银饰迎新', '靛蓝读书', '蝶光绣纹', '摆球探索', '蜡染星图', '山水听音', '透镜小匠', '铜鼓节律', '青绿涟漪', '绛红绣纹', '银月静思', '灵感发现'] as const
/** Catalog paths are compared EXACTLY; arbitrary/legacy/external avatar URLs never count as adoption. */
export const ACTIVITY_AVATARS: readonly ActivityAvatar[] = avatarIds.map((id, index) => ({ id, label: avatarLabels[index] ?? id, path: `/physicsos/avatars/guizhou-v1/${id}-192.webp` }))

export interface ActivityServiceOptions {
  readonly mode?: 'off' | 'bridge' | 'enabled'
  readonly now?: () => Date
  readonly limits?: Partial<ActivityLimits>
  readonly roster: (actor: IdentityActor) => ActivityRoster | Promise<ActivityRoster>
  readonly avatars?: readonly ActivityAvatar[]
  readonly replaySources?: readonly ActivityReplaySource[]
  readonly excludedSchoolIds?: readonly string[]
  /** Exact owner tuples only. No username, domain or school-name prefix heuristics. Ranking-only, not detail/history deletion. */
  readonly excludedAccountKeys?: readonly ActivityOwner[]
  /** Only set after the documented real-storage 90-day/10x cold-start+query gate passes on the server. */
  readonly queryCapacityVerified?: boolean
  readonly onAlert?: (warning: { readonly code: string; readonly schoolId?: string }) => void
}
interface AccountAggregate { totals: ActivityCounts; modules: Map<ActivityModule, ActivityModuleCounts>; lastUseAt?: string }
interface Grouped {
  readonly from: string; readonly to: string; readonly updatedAt: string; readonly roster: ActivityRoster
  readonly users: Map<string, AccountAggregate>; readonly schools: readonly ActivitySchoolRow[]; readonly pending: ReadonlyMap<string, number>
}
interface AdmittedEvent extends ActivityOwner {
  readonly id: string; readonly requestHash: string; readonly kind: 'visit' | 'open' | 'use'; readonly module: ActivityModule; readonly occurredAt: string
}
interface ReplayProgress { cursor?: string; from: string; to: string; caughtUp: boolean; lastCheckedAt?: string }
interface Table<T> { readonly size: number; get(key: string): T | undefined; put(key: string, value: T): Promise<void>; update(key: string, transform: (value: T) => T): Promise<T>; delete(key: string): Promise<boolean> }

export class ActivityService implements ActivitySink {
  readonly limits: ActivityLimits
  readonly mode: 'off' | 'bridge' | 'enabled'
  private readonly now: () => Date
  private readonly avatars: readonly ActivityAvatar[]
  private readonly excluded: ReadonlySet<string>
  private readonly excludedAccounts: ReadonlySet<string>
  private readonly sources: readonly ActivityReplaySource[]
  private readonly progress = new Map<ActivitySource, ReplayProgress>()
  private readonly cache = new Map<string, { value: Grouped; expires: number; size: number }>()
  private cacheBytes = 0
  private storedBytes = 0
  private storageUncertain = false
  private revision = 0
  private state: ActivityStateRecord | undefined
  private warnings: ActivityWarningRecord[] = []
  private initialized = false
  private initialization?: Promise<void>
  private chain: Promise<unknown> = Promise.resolve()
  private queued = 0
  private readonly requests = new Set<Promise<unknown>>()
  private closing = false
  private disposal?: Promise<void>
  private recovery: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private minute = -1
  private globalRate = 0
  private writeMinute = -1
  private writeRate = 0
  private readonly ownerRates = new Map<string, number>()
  private bucketScans = 0
  private receiptScans = 0

  constructor(readonly domain: ActivityDomain, private readonly options: ActivityServiceOptions) {
    this.mode = options.mode ?? 'bridge'
    this.now = options.now ?? (() => new Date())
    this.limits = { ...DEFAULT_ACTIVITY_LIMITS, ...options.limits }
    for (const [name, value] of Object.entries(this.limits)) if (!Object.hasOwn(DEFAULT_ACTIVITY_LIMITS, name) || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid activity limit: ${name}`)
    if (this.limits.maxEventsPerBucket > 256 || this.limits.maxBucketBytes > 64 * 1024) throw new Error('Activity bucket limits cannot exceed the v1 schema envelope.')
    this.avatars = options.avatars ?? ACTIVITY_AVATARS
    if (this.avatars.length !== 12 || new Set(this.avatars.map(value => value.id)).size !== 12 || new Set(this.avatars.map(value => value.path)).size !== 12
      || this.avatars.some(value => !/^[a-z0-9-]+$/.test(value.id) || value.id.length > 64 || value.label.length > 80 || !/^\/physicsos\/avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+-192\.webp$/.test(value.path))) throw new Error('Activity needs twelve distinct controlled avatar catalog entries.')
    this.excluded = new Set(options.excludedSchoolIds ?? [])
    this.excludedAccounts = new Set((options.excludedAccountKeys ?? []).map(owner => digest([owner.schoolId, owner.userKey])))
    this.sources = options.replaySources ?? []
    if (this.sources.length > ACTIVITY_SOURCES.length || new Set(this.sources.map(source => source.source)).size !== this.sources.length || this.sources.some(source => !ACTIVITY_SOURCES.includes(source.source))) throw new Error('Activity replay sources must be unique, closed-set business hosts.')
  }
  private get buckets() { return this.domain.table('buckets') }
  private get receipts() { return this.domain.table('receipts') }
  private get states() { return this.domain.table('state') }
  private rowCount(): number { return this.buckets.size + this.receipts.size + this.states.size }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.queued >= this.limits.maxQueuedWrites) return Promise.reject(new LearningError(429, 'ACTIVITY_QUEUE_LIMIT', '统计写入队列已满。'))
    this.queued += 1
    const result = this.chain.then(operation)
    this.chain = result.then(() => { this.queued -= 1 }, () => { this.queued -= 1 })
    return result
  }
  private request<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closing || !this.initialized) return Promise.reject(new LearningError(503, 'ACTIVITY_UNAVAILABLE', '统计服务尚未就绪。'))
    if (this.requests.size >= this.limits.maxInFlight) return Promise.reject(new LearningError(429, 'ACTIVITY_REQUEST_LIMIT', '统计请求并发已达上限。'))
    const result = Promise.resolve().then(operation)
    this.requests.add(result)
    void result.then(() => this.requests.delete(result), () => this.requests.delete(result))
    return result
  }
  /** Scan once, account exact encoded bytes, and refuse oversized units; DomainFacility has already loadAll'd. */
  initialize(): Promise<void> {
    this.initialization ??= this.serial(async () => {
      const start = performance.now()
      if (this.rowCount() > this.limits.maxRows || this.rowCount() > this.limits.maxScanRows || this.states.size > 1 || this.buckets.size > this.limits.maxBucketRows || this.receipts.size > this.limits.maxReceiptRows) throw new LearningError(503, 'ACTIVITY_COLD_START_BUDGET', '统计存储行数超出冷启动预算，需可索引存储或受控迁移。')
      let total = 0
      for (const table of [this.buckets, this.receipts, this.states]) for (const [key, row] of table.entries()) {
        total += bytes(key, row)
        if (total > Math.min(this.limits.maxStoredBytes, this.limits.maxScanBytes) || performance.now() - start > this.limits.maxColdStartMs) throw new LearningError(503, 'ACTIVITY_COLD_START_BUDGET', '统计冷启动超出行、字节或时长预算。')
      }
      this.storedBytes = total
      this.state = this.states.get('v1')
      if (this.states.size !== 0 && this.state === undefined) throw new LearningError(503, 'ACTIVITY_STATE_INVALID', '统计元数据无效。')
      this.warnings = this.state?.warnings.slice() ?? []
      if (this.state === undefined && this.mode === 'enabled') {
        const next: ActivityStateRecord = { version: 1, collectionStartedAt: this.now().toISOString(), warnings: [], sourceCheckpoints: [] }
        await this.put(this.states, 'v1', next)
        this.state = next
      }
      this.initialized = true
    }).catch(error => {
      this.note('ACTIVITY_COLD_START_BUDGET')
      throw error
    })
    return this.initialization
  }
  private budget<T>(table: Table<T>, key: string, next: T): number {
    const previous = table.get(key), delta = bytes(key, next) - (previous === undefined ? 0 : bytes(key, previous))
    if ((previous === undefined && this.rowCount() >= this.limits.maxRows) || this.storedBytes + delta > this.limits.maxStoredBytes) throw new LearningError(413, 'ACTIVITY_CAPACITY', '统计全局行数或字节预算已满。')
    return delta
  }
  private async put<T>(table: Table<T>, key: string, next: T): Promise<void> {
    const delta = this.budget(table, key, next)
    this.admitWrite()
    try { await table.put(key, next) } catch (error) { this.uncertainWrite(error); throw error }
    this.storedBytes += delta; this.revision += 1
  }
  private async update<T>(table: Table<T>, key: string, transform: (current: T) => T): Promise<void> {
    let delta = 0
    this.admitWrite()
    try {
      await table.update(key, current => {
        const next = transform(current)
        delta = this.budget(table, key, next)
        return next
      })
    } catch (error) { this.uncertainWrite(error); throw error }
    this.storedBytes += delta; this.revision += 1
  }
  private async remove<T>(table: Table<T>, key: string): Promise<void> {
    const row = table.get(key)
    if (row !== undefined) {
      this.admitWrite()
      try { if (await table.delete(key)) { this.storedBytes -= bytes(key, row); this.revision += 1 } } catch (error) { this.uncertainWrite(error); throw error }
    }
  }
  /** A rejected backend ACK may have committed. Never overwrite from the stale in-memory snapshot. */
  private uncertainWrite(error: unknown): void {
    if (error instanceof LearningError) return
    this.storageUncertain = true
    this.note('ACTIVITY_STORAGE_UNCERTAIN')
  }
  private admitWrite(): void {
    if (this.storageUncertain) throw new LearningError(503, 'ACTIVITY_STORAGE_UNCERTAIN', '统计持久化结果不确定，需重新打开统计单元后重放原回执。')
    const minute = Math.floor(this.now().getTime() / 60_000)
    if (minute !== this.writeMinute) { this.writeMinute = minute; this.writeRate = 0 }
    if (this.writeRate >= this.limits.maxPersistWritesPerMinute) throw new LearningError(429, 'ACTIVITY_WRITE_RATE', '统计全局持久化写频率已达上限。')
    this.writeRate += 1
  }
  /** Fixed codes only. Storage-down alarms go to the host logger immediately and are persisted on recovery. */
  private note(code: string, schoolId?: string, affectedDay = activityDayOf(this.now())): void {
    const index = this.warnings.findIndex(value => value.code === code && value.schoolId === schoolId)
    if (index >= 0) {
      const old = this.warnings[index]!
      this.warnings[index] = { ...old, fromDay: old.fromDay < affectedDay ? old.fromDay : affectedDay, toDay: old.toDay > affectedDay ? old.toDay : affectedDay, occurrences: Math.min(Number.MAX_SAFE_INTEGER, old.occurrences + 1) }
    } else if (this.warnings.length < 32) this.warnings.push({ code, ...(schoolId === undefined ? {} : { schoolId }), fromDay: affectedDay, toDay: affectedDay, occurrences: 1 })
    else this.warnings[31] = { code: 'ACTIVITY_WARNING_OVERFLOW', fromDay: '1970-01-01', toDay: activityDayOf(this.now()), occurrences: 1 }
    this.revision += 1
    try { this.options.onAlert?.({ code, ...(schoolId === undefined ? {} : { schoolId }) }) } catch { /* A logging hook is never a business dependency. */ }
  }
  private async persistWarnings(): Promise<void> {
    if (this.mode !== 'enabled' || this.state === undefined || JSON.stringify(this.state.warnings) === JSON.stringify(this.warnings)) return
    const next = { ...this.state, warnings: this.warnings.slice() }
    await this.put(this.states, 'v1', next)
    this.state = next
  }
  private alertFailure(error: unknown, schoolId?: string, at?: string): void {
    const code = error instanceof LearningError ? error.code : 'ACTIVITY_STORAGE_WRITE'
    this.note(code.startsWith('ACTIVITY_') ? code : 'ACTIVITY_STORAGE_WRITE', schoolId, at === undefined ? undefined : activityDayOf(new Date(at)))
    // Best effort only: if the medium is down, the original BUSINESS capsule is the durable recovery point.
    void this.serial(() => this.persistWarnings()).catch(() => {})
  }
  private collection(): void {
    if (this.mode !== 'enabled') throw new LearningError(409, 'ACTIVITY_COLLECTION_DISABLED', '当前版本仅保留统计读取，尚未开启新采集。')
  }
  private replayCutoff(): number {
    return Math.max(this.now().getTime() - ACTIVITY_REPLAY_MS, this.state?.replayFloorAt === undefined ? -Infinity : Date.parse(this.state.replayFloorAt))
  }
  private originalTime(at: string): void {
    const time = Date.parse(at), now = this.now().getTime()
    if (!Number.isFinite(time) || time > now + 30_000) throw new LearningError(400, 'ACTIVITY_TIME_INVALID', '统计原操作时间无效或晚于服务器。')
    if (time < this.replayCutoff()) throw new LearningError(410, 'ACTIVITY_REPLAY_EXPIRED', '统计回执已超过原操作时间起七日的受控重放窗口。')
    if (this.state === undefined || time < Date.parse(this.state.collectionStartedAt)) throw new LearningError(410, 'ACTIVITY_BEFORE_COLLECTION', '不补造新采集起点之前的历史。')
  }
  private limitedInput(input: unknown): void {
    let length: number
    try { length = Buffer.byteLength(JSON.stringify(input), 'utf8') } catch { throw new LearningError(400, 'BAD_REQUEST', '统计请求必须为JSON。') }
    if (length > this.limits.maxRequestBytes) throw new LearningError(413, 'ACTIVITY_REQUEST_BYTES', '统计请求超过字节限制。')
  }
  private eventLocation(event: AdmittedEvent): { key: string; day: string; shard: number } {
    const day = activityDayOf(new Date(event.occurredAt)), shard = Number.parseInt(event.id.slice(0, 8), 16) % ACTIVITY_SHARDS
    return { key: digest([event.schoolId, event.userKey, day, shard]), day, shard }
  }
  private duplicate(event: AdmittedEvent): boolean {
    const previous = this.buckets.get(this.eventLocation(event).key)?.dedup[event.id]
    if (previous === undefined) return false
    if (previous !== event.requestHash) throw new LearningError(409, 'ACTIVITY_ID_CONFLICT', '同一统计操作标识不能对应不同内容。')
    return true
  }
  private rate(owner: ActivityOwner): void {
    const minute = Math.floor(this.now().getTime() / 60_000)
    if (minute !== this.minute) { this.minute = minute; this.globalRate = 0; this.ownerRates.clear() }
    const key = digest([owner.schoolId, owner.userKey]), prior = this.ownerRates.get(key) ?? 0
    if (this.globalRate >= this.limits.maxGlobalClientEventsPerMinute || prior >= this.limits.maxClientEventsPerMinute || (!this.ownerRates.has(key) && this.ownerRates.size >= this.limits.maxRateOwners)) throw new LearningError(429, 'ACTIVITY_RATE_LIMIT', '统计上报频率已达上限。')
    this.globalRate += 1; this.ownerRates.set(key, prior + 1)
  }
  /** Empty bucket creation carries no count. Count + id/hash always land in ONE atomic update. */
  private async admit(event: AdmittedEvent): Promise<'recorded' | 'duplicate'> {
    this.originalTime(event.occurredAt)
    if (this.duplicate(event)) return 'duplicate'
    const location = this.eventLocation(event)
    if (this.buckets.get(location.key) === undefined) {
      if (this.buckets.size >= this.limits.maxBucketRows) throw new LearningError(413, 'ACTIVITY_BUCKET_ROWS', '统计日桶行数已达上限。')
      const empty = { schoolId: event.schoolId, userKey: event.userKey, day: location.day, shard: location.shard, ...counts(), modules: [], dedup: {} }
      if (bytes(location.key, empty) > this.limits.maxBucketBytes) throw new LearningError(413, 'ACTIVITY_BUCKET_BYTES', '统计空日桶超过配置字节预算。')
      await this.put(this.buckets, location.key, empty)
    }
    await this.update(this.buckets, location.key, current => {
      // Recheck at the atomic slot: a backend/queue delay may cross the exact seven-day boundary.
      this.originalTime(event.occurredAt)
      if (current.sealedAt !== undefined) throw new LearningError(410, 'ACTIVITY_BUCKET_SEALED', '统计日桶已封存，不能重新接收事件或重建去重键。')
      if (!sameOwner(current, event) || current.day !== location.day || current.shard !== location.shard) throw new LearningError(409, 'ACTIVITY_BUCKET_CONFLICT', '统计日桶归属冲突。')
      if (current.dedup[event.id] !== undefined) {
        if (current.dedup[event.id] !== event.requestHash) throw new LearningError(409, 'ACTIVITY_ID_CONFLICT', '统计操作哈希冲突。')
        return current
      }
      if (Object.keys(current.dedup).length >= this.limits.maxEventsPerBucket) throw new LearningError(413, 'ACTIVITY_BUCKET_EVENTS', '统计日桶去重键已满；不会创建溢出桶。')
      const increment = { visits: Number(event.kind === 'visit'), opens: Number(event.kind === 'open'), uses: Number(event.kind === 'use') }
      const previous = current.modules.find(row => row.module === event.module)
      const module: ActivityModuleCounts = { module: event.module, ...add(previous ?? counts(), increment), ...(event.kind === 'use' ? { lastUseAt: later(previous?.lastUseAt, event.occurredAt)! } : previous?.lastUseAt === undefined ? {} : { lastUseAt: previous.lastUseAt }) }
      const next = activityBucketWire.parse({ ...current, ...add(current, increment), modules: [...current.modules.filter(row => row.module !== event.module), module], dedup: { ...current.dedup, [event.id]: event.requestHash } })
      if (bytes(location.key, next) > this.limits.maxBucketBytes) throw new LearningError(413, 'ACTIVITY_BUCKET_BYTES', '统计日桶字节数已达上限。')
      return next
    })
    return 'recorded'
  }
  /** Public collection admits ONLY visit/open. No body can impersonate owner, time, or effective use. */
  recordClientEvent(actor: IdentityActor, input: unknown): Promise<ActivityEventAck> {
    return this.request(() => this.serial(async () => {
      this.collection(); this.limitedInput(input)
      const parsed = activityClientWire.safeParse(input)
      if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '统计仅接收闭集访问/打开事件。')
      const body = parsed.data, occurredAt = new Date(Number(body.id.slice(0, 13))).toISOString()
      this.originalTime(occurredAt)
      const pageTime = Number(body.pageInstanceId.slice(0, 13))
      if (!Number.isFinite(pageTime) || pageTime > Date.parse(occurredAt)) throw new LearningError(400, 'ACTIVITY_PAGE_INVALID', '页面实例时间无效。')
      const event: AdmittedEvent = { schoolId: actor.schoolId, userKey: actor.userKey, id: digest([actor.schoolId, actor.userKey, body.id]), requestHash: digest(body), kind: body.kind, module: body.module, occurredAt }
      if (!this.duplicate(event)) this.rate(actor)
      const status = await this.admit(event)
      await this.persistWarnings()
      return { status, occurredAt }
    })).catch(error => { if (!(error instanceof LearningError) || [409, 410, 413, 429].includes(error.status)) this.alertFailure(error, actor.schoolId); throw error })
  }
  private eventFromReceipt(row: ActivityReceiptRecord): AdmittedEvent {
    return { schoolId: row.schoolId, userKey: row.userKey, id: row.operationHash, requestHash: row.requestHash, kind: 'use', module: ACTIVITY_SOURCE_MODULE[row.source], occurredAt: row.occurredAt }
  }
  private async deliver(key: string, row: ActivityReceiptRecord): Promise<'recorded' | 'duplicate'> {
    this.originalTime(row.occurredAt)
    const status = await this.admit(this.eventFromReceipt(row))
    if (row.state !== 'applied') await this.update(this.receipts, key, current => ({ ...current, state: 'applied' as const }))
    return status
  }
  /** Nonthrowing success hook. Original business capsule is required to recover the crash-before-hook gap. */
  async success(input: ActivitySuccessCapsule): Promise<ActivityDelivery> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<ActivityDelivery>(resolve => {
      timer = setTimeout(() => { this.note('ACTIVITY_SINK_DELAYED'); resolve({ status: 'pending', code: 'ACTIVITY_SINK_DELAYED' }) }, this.limits.successTimeoutMs)
      timer.unref?.()
    })
    try { return await Promise.race([this.successWork(input), timeout]) } finally { if (timer !== undefined) clearTimeout(timer) }
  }
  private async successWork(input: ActivitySuccessCapsule): Promise<ActivityDelivery> {
    if (this.mode !== 'enabled') return { status: 'rejected', code: 'ACTIVITY_COLLECTION_DISABLED' }
    let owner: ActivityOwner | undefined, at: string | undefined
    try {
      return await this.request(() => this.serial(async () => {
        this.limitedInput(input)
        const parsed = activitySuccessCapsuleSchema.safeParse(input)
        if (!parsed.success) throw new LearningError(400, 'ACTIVITY_CAPSULE_INVALID', '业务统计回执字段无效。')
        const body = parsed.data
        owner = body.owner; at = new Date(body.occurredAt).toISOString(); this.originalTime(at)
        const key = digest([body.owner.schoolId, body.owner.userKey, body.source, body.operationId])
        const requestHash = digest({ version: 1, source: body.source, operationHash: key, occurredAt: at, owner: body.owner })
        let row = this.receipts.get(key)
        if (row !== undefined && row.requestHash !== requestHash) throw new LearningError(409, 'ACTIVITY_ID_CONFLICT', '持久业务操作ID已对应另一时间或内容。')
        if (row === undefined) {
          if (this.receipts.size >= this.limits.maxReceiptRows) throw new LearningError(413, 'ACTIVITY_RECEIPT_ROWS', '业务统计回执预算已满。')
          row = { ...body.owner, source: body.source, operationHash: key, requestHash, occurredAt: at, state: 'pending' }
          await this.put(this.receipts, key, row)
        }
        const status = await this.deliver(key, row)
        await this.persistWarnings()
        return { status }
      }))
    } catch (error) {
      this.alertFailure(error, owner?.schoolId, at)
      return { status: error instanceof LearningError && [400, 409, 410].includes(error.status) ? 'rejected' : 'pending', code: error instanceof LearningError ? error.code : 'ACTIVITY_STORAGE_WRITE' }
    }
  }
  /** Bounded receipt recovery plus one page per durable business source. Repeat calls resume opaque cursors. */
  recover(): Promise<void> {
    if (this.mode !== 'enabled' || this.closing) return Promise.resolve()
    this.recovery ??= this.recoverPass().finally(() => { this.recovery = undefined })
    return this.recovery
  }
  private async recoverPass(): Promise<void> {
    try {
      await this.request(() => this.serial(async () => {
        this.readBudget()
        this.receiptScans += 1
        const pending: [string, ActivityReceiptRecord][] = []
        for (const entry of this.receipts.entries()) if (entry[1].state === 'pending' && pending.length < this.limits.maxReplayBatch) pending.push(entry)
        for (const [key, row] of pending) {
          this.note('ACTIVITY_RECOVERY_REPLAY', row.schoolId, activityDayOf(new Date(row.occurredAt)))
          try { await this.deliver(key, row) } catch (error) {
            this.note(error instanceof LearningError ? error.code : 'ACTIVITY_STORAGE_WRITE', row.schoolId, activityDayOf(new Date(row.occurredAt)))
            if (error instanceof LearningError && error.status === 410) {
              // Preserve both original scope and discovery day; even a >90-day backlog must raise a current alarm.
              this.note(error.code, row.schoolId)
              // Warning first, terminal receipt second. A failure of either keeps the durable pending fact.
              await this.persistWarnings()
              await this.update(this.receipts, key, current => ({ ...current, state: 'expired' as const, expiredAt: this.now().toISOString() }))
            }
          }
        }
        await this.prune(); await this.persistWarnings()
      }))
      for (const source of this.sources) {
        if (this.closing) break
        let progress = this.progress.get(source.source)
        if (progress === undefined || progress.caughtUp) {
          const oldest = this.replayCutoff()
          const checkpoint = this.state?.sourceCheckpoints.find(item => item.source === source.source)?.throughAt ?? this.state?.collectionStartedAt
          if (checkpoint !== undefined && Date.parse(checkpoint) < oldest) {
            this.note('ACTIVITY_REPLAY_GAP', undefined, activityDayOf(new Date(checkpoint)))
            this.note('ACTIVITY_REPLAY_GAP', undefined, activityDayOf(new Date(oldest)))
          }
          progress = { from: new Date(Math.max(oldest, Date.parse(this.state?.collectionStartedAt ?? this.now().toISOString()))).toISOString(), to: this.now().toISOString(), caughtUp: false }
          this.progress.set(source.source, progress)
        }
        try {
          const page = await source.read({ from: progress.from, to: progress.to, limit: this.limits.maxReplayBatch, ...(progress.cursor === undefined ? {} : { cursor: progress.cursor }), signal: AbortSignal.timeout(this.limits.requestTimeoutMs) })
          if (page.capsules.length > this.limits.maxReplayBatch || (page.nextCursor !== undefined && (page.nextCursor.length > 512 || page.nextCursor === progress.cursor))) throw new LearningError(503, 'ACTIVITY_SOURCE_BUDGET', '业务回执重放源未遵守有界游标合同。')
          let accepted = true
          for (const capsule of page.capsules) {
            if (!activitySuccessCapsuleSchema.safeParse(capsule).success) throw new LearningError(503, 'ACTIVITY_SOURCE_INVALID', '业务重放源包含非严格成功胶囊。')
            if (capsule.source !== source.source || Date.parse(capsule.occurredAt) < Date.parse(progress.from) || Date.parse(capsule.occurredAt) > Date.parse(progress.to)) throw new LearningError(503, 'ACTIVITY_SOURCE_INVALID', '业务回执重放源越过原操作时间或类型边界。')
            const delivered = await this.success(capsule)
            if (delivered.status === 'pending') accepted = false
          }
          if (accepted) {
            if (page.nextCursor === undefined) delete progress.cursor
            else progress.cursor = page.nextCursor
            progress.caughtUp = page.nextCursor === undefined
            progress.lastCheckedAt = this.now().toISOString()
            if (progress.caughtUp) {
              const throughAt = progress.to
              await this.serial(async () => {
                if (this.state === undefined) return
                const next = { ...this.state, sourceCheckpoints: [...this.state.sourceCheckpoints.filter(item => item.source !== source.source), { source: source.source, throughAt }], warnings: this.warnings.slice() }
                await this.put(this.states, 'v1', next); this.state = next
              })
            }
          }
          this.revision += 1
        } catch (error) {
          progress.caughtUp = false; this.alertFailure(error instanceof LearningError ? error : new LearningError(503, 'ACTIVITY_SOURCE_UNAVAILABLE', '业务统计回执暂不可重放。'))
        }
      }
    } catch (error) { this.alertFailure(error) }
  }
  /** The caller owns this disposer. No recovery writes in bridge/off mode. */
  startRecovery(): () => void {
    if (this.mode !== 'enabled' || this.timer !== undefined) return () => {}
    void this.recover()
    this.timer = setInterval(() => { void this.recover() }, this.limits.recoveryIntervalMs)
    this.timer.unref?.()
    return () => { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined }
  }
  private async prune(): Promise<void> {
    // Commit the irreversible rejection floor before discarding any proof, including across restart/clock rollback.
    const floor = new Date(this.replayCutoff()).toISOString()
    if (this.state !== undefined && (this.state.replayFloorAt === undefined || Date.parse(floor) > Date.parse(this.state.replayFloorAt))) {
      const next = { ...this.state, replayFloorAt: floor, warnings: this.warnings.slice() }
      await this.put(this.states, 'v1', next); this.state = next
    }
    const retentionNow = new Date(Date.parse(floor) + ACTIVITY_REPLAY_MS)
    const replayOldest = activityReplayOldestDay(retentionNow), oldest = offsetDay(activityDayOf(retentionNow), -(ACTIVITY_RETENTION_DAYS - 1))
    let changed = 0
    for (const [key, row] of this.buckets.entries()) {
      if (changed >= this.limits.maxPrunePerPass) break
      if (row.day < oldest) { await this.remove(this.buckets, key); changed += 1 }
      else if (row.day < replayOldest && row.sealedAt === undefined) {
        await this.update(this.buckets, key, current => activityBucketWire.parse({ ...current, dedup: {}, sealedAt: retentionNow.toISOString() }))
        changed += 1
      }
    }
    for (const [key, row] of this.receipts.entries()) {
      if (changed >= this.limits.maxPrunePerPass) break
      const originalDay = activityDayOf(new Date(row.occurredAt))
      if (row.state === 'applied' && originalDay < replayOldest) { await this.remove(this.receipts, key); changed += 1 }
      else if (row.state === 'expired' && originalDay < oldest) {
        // An expired terminal row is a 90-day audit checkpoint, not a success. Never directly prune pending.
        this.note('ACTIVITY_REPLAY_EXPIRED', row.schoolId, originalDay)
        this.note('ACTIVITY_REPLAY_EXPIRED', row.schoolId, activityDayOf(new Date(row.expiredAt ?? this.now().toISOString())))
        await this.persistWarnings()
        await this.remove(this.receipts, key); changed += 1
      }
    }
    this.warnings = this.warnings.filter(value => value.toDay >= oldest)
  }
  private admin(actor: IdentityActor, schoolId?: string): string | undefined {
    if (this.mode === 'off') throw new LearningError(404, 'NOT_FOUND', '统计功能未启用。')
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'SCHOOL_ADMIN') throw new LearningError(403, 'FORBIDDEN', '仅管理员可读取管理统计。')
    if (actor.role !== 'SUPER_ADMIN' && schoolId !== undefined && schoolId !== actor.schoolId) throw new LearningError(403, 'FORBIDDEN', '不能查看其它学校统计。')
    return actor.role === 'SUPER_ADMIN' ? schoolId : actor.schoolId
  }
  private window(input: ActivityDateQuery): { from: string; to: string } {
    const parsed = dateQueryWire.safeParse(input)
    if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '统计时间筛选无效。')
    const today = activityDayOf(this.now()), to = parsed.data.to ?? today, from = offsetDay(to, -((parsed.data.days ?? 7) - 1))
    if (to > today || from < offsetDay(today, -(ACTIVITY_RETENTION_DAYS - 1))) throw new LearningError(400, 'ACTIVITY_DATE_RANGE', '仅支持最近九十个上海自然日的在线查询。')
    return { from, to }
  }
  private readBudget(): void {
    if (this.rowCount() > this.limits.maxScanRows || this.storedBytes > this.limits.maxScanBytes) throw new LearningError(503, 'ACTIVITY_QUERY_BUDGET', '统计全表扫描超出预算；分页不能替代索引。')
  }
  private async roster(actor: IdentityActor): Promise<ActivityRoster> {
    let raw: ActivityRoster
    try { raw = await this.options.roster(actor) } catch { throw new LearningError(503, 'ACTIVITY_ROSTER_UNAVAILABLE', '安全账号目录暂不可读取。') }
    if (raw.users.length > this.limits.maxRosterUsers || raw.schools.length > this.limits.maxRosterSchools || bytes('', raw) > this.limits.maxRosterBytes) throw new LearningError(503, 'ACTIVITY_ROSTER_BUDGET', '账号目录超过统计查询预算。')
    const parsed = rosterWire.safeParse(raw)
    if (!parsed.success) throw new LearningError(503, 'ACTIVITY_ROSTER_INVALID', '统计仅接受不含敏感字段的最小账号目录。')
    const roster = parsed.data
    if (new Set(roster.schools.map(row => row.id)).size !== roster.schools.length || new Set(roster.users.map(row => digest([row.schoolId, row.userKey]))).size !== roster.users.length || new Set(roster.users.map(row => digest([row.schoolId, row.username]))).size !== roster.users.length) throw new LearningError(503, 'ACTIVITY_ROSTER_CONFLICT', '账号目录存在重复归属。')
    return {
      version: roster.version,
      schools: roster.schools.map(row => ({ id: row.id, name: row.name, status: row.status,
        ...(row.mergedInto === undefined ? {} : { mergedInto: row.mergedInto }),
        ...(row.rosterAliasOf === undefined ? {} : { rosterAliasOf: row.rosterAliasOf }),
        ...(row.archivedAt === undefined ? {} : { archivedAt: row.archivedAt }),
        ...(row.reviewState === undefined ? {} : { reviewState: row.reviewState }) })),
      users: roster.users.map(row => ({ schoolId: row.schoolId, userKey: row.userKey, username: row.username, status: row.status, role: row.role,
        ...(row.avatarUrl === undefined ? {} : { avatarUrl: row.avatarUrl }) })),
    }
  }
  private avatarSnapshot(users: readonly ActivityRosterUser[], at: string): ActivityAvatarSnapshot {
    const distribution = this.avatars.map(avatar => ({ ...avatar, users: 0 })), byPath = new Map(distribution.map(value => [value.path, value]))
    let adoptedUsers = 0
    for (const user of users) {
      const item = user.avatarUrl === undefined ? undefined : byPath.get(user.avatarUrl)
      if (item !== undefined) { item.users += 1; adoptedUsers += 1 }
    }
    return { asOf: at, eligibleUsers: users.length, adoptedUsers, otherUsers: users.length - adoptedUsers, distribution }
  }
  /** One bucket pass and one receipt pass group ALL visible users/schools; no per-school summary calls. */
  private async grouped(actor: IdentityActor, schoolId: string | undefined, window: { from: string; to: string }): Promise<Grouped> {
    if (this.options.queryCapacityVerified !== true) throw new LearningError(503, 'ACTIVITY_CAPACITY_UNVERIFIED', '统计查询需先通过服务器真实存储的九十日及十倍容量验收。')
    this.readBudget()
    const roster = await this.roster(actor), key = digest([actor.role, actor.schoolId, actor.userKey, schoolId ?? '*', window.from, window.to, roster.version, this.revision])
    const cached = this.cache.get(key)
    if (cached !== undefined && cached.expires > this.now().getTime()) return cached.value
    const scanStarted = performance.now()
    const checkTime = (): void => { if (performance.now() - scanStarted > this.limits.maxQueryMs) throw new LearningError(503, 'ACTIVITY_QUERY_TIME', '统计全局归组超出时长预算，需可索引存储。') }
    const updatedAt = this.now().toISOString(), visibleSchools = roster.schools.filter(row => (schoolId === undefined || row.id === schoolId) && row.status === 'active' && row.mergedInto === undefined && row.rosterAliasOf === undefined && row.archivedAt === undefined && row.reviewState === undefined && !this.excluded.has(row.id))
    const schoolMap = new Map(visibleSchools.map(school => [school.id, school])), users = new Map<string, AccountAggregate>(), eligible = new Map<string, ActivityRosterUser>(), observed = new Map<string, ActivityRosterUser>(), schoolUsers = new Map<string, ActivityRosterUser[]>()
    for (const user of roster.users) {
      if (schoolId === undefined || user.schoolId === schoolId) observed.set(digest([user.schoolId, user.userKey]), user)

      if (!schoolMap.has(user.schoolId) || user.status !== 'active' || user.role === 'SUPER_ADMIN' || this.excludedAccounts.has(digest([user.schoolId, user.userKey]))) continue
      eligible.set(digest([user.schoolId, user.userKey]), user)
      const list = schoolUsers.get(user.schoolId) ?? []; list.push(user); schoolUsers.set(user.schoolId, list)
    }
    this.bucketScans += 1
    for (const [, row] of this.buckets.entries()) {
      checkTime()
      if (row.day < window.from || row.day > window.to || !observed.has(digest([row.schoolId, row.userKey]))) continue
      const key = digest([row.schoolId, row.userKey]), user = users.get(key) ?? { totals: counts(), modules: new Map<ActivityModule, ActivityModuleCounts>() }
      user.totals = add(user.totals, row)
      for (const module of row.modules) {
        const previous = user.modules.get(module.module), lastUseAt = later(previous?.lastUseAt, module.lastUseAt)
        user.modules.set(module.module, { module: module.module, ...add(previous ?? counts(), module), ...(lastUseAt === undefined ? {} : { lastUseAt }) })
        if (module.lastUseAt !== undefined) user.lastUseAt = later(user.lastUseAt, module.lastUseAt)!
      }
      users.set(key, user)
    }
    const schoolTotals = new Map<string, { totals: ActivityCounts; active: Set<string>; lastUseAt?: string }>()
    for (const [key, aggregate] of users) {
      const owner = eligible.get(key)
      if (owner === undefined) continue
      const school = schoolTotals.get(owner.schoolId) ?? { totals: counts(), active: new Set<string>() }
      school.totals = add(school.totals, aggregate.totals)
      if (aggregate.totals.uses > 0) school.active.add(owner.userKey)
      if (aggregate.lastUseAt !== undefined) school.lastUseAt = later(school.lastUseAt, aggregate.lastUseAt)!
      schoolTotals.set(owner.schoolId, school)
    }
    const rows: ActivitySchoolRow[] = visibleSchools.map(school => {
      const value = schoolTotals.get(school.id)
      return { rank: 0, schoolId: school.id, schoolName: school.name, ...(value?.totals ?? counts()), activeUsers: value?.active.size ?? 0, ...(value?.lastUseAt === undefined ? {} : { lastUseAt: value.lastUseAt }), avatars: this.avatarSnapshot(schoolUsers.get(school.id) ?? [], updatedAt) }
    }).sort((left, right) => right.uses - left.uses || compareId(left.schoolId, right.schoolId))
    let rank = 0, previous: number | undefined
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!
      if (row.uses !== previous) rank = index + 1
      rows[index] = { ...row, rank }; previous = row.uses
    }
    const pending = new Map<string, number>()
    this.receiptScans += 1
    for (const [, row] of this.receipts.entries()) if (row.state === 'pending' && schoolMap.has(row.schoolId) && activityDayOf(new Date(row.occurredAt)) >= window.from && activityDayOf(new Date(row.occurredAt)) <= window.to) pending.set(row.schoolId, (pending.get(row.schoolId) ?? 0) + 1)
    checkTime()
    const value: Grouped = { ...window, updatedAt, roster, users, schools: rows, pending }
    const size = bytes('', { ...value, users: [...users].map(([id, value]) => [id, { ...value, modules: [...value.modules] }]), pending: [...pending] })
    checkTime()
    if (size <= this.limits.maxCacheBytes) {
      for (const [oldKey, item] of this.cache) if (item.expires <= this.now().getTime()) { this.cache.delete(oldKey); this.cacheBytes -= item.size }
      while (this.cache.size >= this.limits.maxCacheEntries || this.cacheBytes + size > this.limits.maxCacheBytes) {
        const first = this.cache.keys().next().value as string | undefined
        if (first === undefined) break
        this.cacheBytes -= this.cache.get(first)!.size; this.cache.delete(first)
      }
      this.cache.set(key, { value, size, expires: this.now().getTime() + this.limits.cacheTtlMs }); this.cacheBytes += size
    }
    return value
  }
  private integrity(group: Grouped, schoolId?: string): ActivityIntegrity {
    const codes = new Set(this.warnings.filter(row => (row.schoolId === undefined || schoolId === undefined || row.schoolId === schoolId) && row.toDay >= group.from && row.fromDay <= group.to).map(row => row.code))
    if (this.mode !== 'enabled') codes.add('ACTIVITY_COLLECTION_PAUSED')
    if (this.state === undefined) codes.add('ACTIVITY_NOT_COLLECTING')
    const sources = ACTIVITY_SOURCES.map(source => {
      const progress = this.progress.get(source)
      if (!this.sources.some(item => item.source === source)) codes.add('ACTIVITY_SOURCE_NOT_CONNECTED')
      return { source, caughtUp: progress?.caughtUp ?? false, ...(progress?.lastCheckedAt === undefined ? {} : { lastCheckedAt: progress.lastCheckedAt }) }
    })
    const pendingReceipts = schoolId === undefined ? [...group.pending.values()].reduce((a, b) => a + b, 0) : group.pending.get(schoolId) ?? 0
    return { state: codes.size > 0 ? 'incomplete' : pendingReceipts > 0 || sources.some(source => !source.caughtUp) ? 'delayed' : 'complete', codes: [...codes].sort(), pendingReceipts, sources }
  }
  private rankingExclusions(group: Grouped, schoolId?: string): ActivityUserDetail['rankingExclusions'] {
    return {
      schoolIds: group.roster.schools.filter(row => (schoolId === undefined || row.id === schoolId) && this.excluded.has(row.id)).map(row => row.id).sort(compareId),
      accounts: group.roster.users.filter(row => (schoolId === undefined || row.schoolId === schoolId) && this.excludedAccounts.has(digest([row.schoolId, row.userKey]))).map(row => ({ schoolId: row.schoolId, username: row.username })),
    }
  }
  userDetail(actor: IdentityActor, target: { readonly schoolId: string; readonly username: string }, query: ActivityDateQuery = {}): Promise<ActivityUserDetail> {
    return this.request<ActivityUserDetail>(async () => {
      const parsed = targetWire.safeParse(target)
      if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '目标用户筛选无效。')
      const schoolId = this.admin(actor, parsed.data.schoolId), group = await this.grouped(actor, schoolId, this.window(query))
      const user = group.roster.users.find(user => user.schoolId === parsed.data.schoolId && user.username === parsed.data.username)
      if (user === undefined) throw new LearningError(404, 'NOT_FOUND', '目标用户不存在。')
      const aggregate = group.users.get(digest([user.schoolId, user.userKey]))
      return { version: 1, timezone: 'Asia/Shanghai', from: group.from, to: group.to, collectionStartedAt: this.state?.collectionStartedAt ?? null, updatedAt: group.updatedAt, integrity: this.integrity(group, user.schoolId), rankingExclusions: this.rankingExclusions(group, user.schoolId), schoolId: user.schoolId, username: user.username, ...(aggregate?.totals ?? counts()), ...(aggregate?.lastUseAt === undefined ? {} : { lastUseAt: aggregate.lastUseAt }), modules: ACTIVITY_MODULES.map(module => aggregate?.modules.get(module) ?? { module, ...counts() }) }
    }).catch(error => { if (!(error instanceof LearningError) || error.status >= 500) this.alertFailure(error, actor.role === 'SCHOOL_ADMIN' ? actor.schoolId : undefined); throw error })
  }
  schoolRanking(actor: IdentityActor, query: ActivityRankQuery = {}): Promise<ActivitySchoolRanking> {
    return this.request<ActivitySchoolRanking>(async () => {
      const parsed = rankQueryWire.safeParse(query)
      if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '学校排行筛选无效。')
      const body = parsed.data, schoolId = this.admin(actor, body.schoolId), group = await this.grouped(actor, schoolId, this.window({ ...(body.days === undefined ? {} : { days: body.days }), ...(body.to === undefined ? {} : { to: body.to }) }))
      const sort = body.sort ?? 'uses', order = body.order ?? 'desc', needle = body.q?.trim().toLocaleLowerCase() ?? ''
      const filtered = group.schools.filter(row => `${row.schoolName} ${row.schoolId}`.toLocaleLowerCase().includes(needle))
      const number = (row: ActivitySchoolRow): number => sort === 'adoptedUsers' ? row.avatars.adoptedUsers : row[sort]
      const ordered = [...filtered].sort((left, right) => (number(left) - number(right)) * (order === 'desc' ? -1 : 1) || compareId(left.schoolId, right.schoolId))
      const page = body.page ?? 1, pageSize = body.pageSize ?? 20
      const overview = group.schools.reduce((total, row) => ({ ...add(total, row), schools: total.schools + 1, activeUsers: total.activeUsers + row.activeUsers, adoptedUsers: total.adoptedUsers + row.avatars.adoptedUsers }), { ...counts(), schools: 0, activeUsers: 0, adoptedUsers: 0 })
      return { version: 1, timezone: 'Asia/Shanghai', from: group.from, to: group.to, collectionStartedAt: this.state?.collectionStartedAt ?? null, updatedAt: group.updatedAt, integrity: this.integrity(group, schoolId), rankingExclusions: this.rankingExclusions(group, schoolId), scope: schoolId === undefined ? 'platform' : 'school', total: filtered.length, page, pageSize, sort, order, overview, rows: ordered.slice((page - 1) * pageSize, page * pageSize) }
    }).catch(error => { if (!(error instanceof LearningError) || error.status >= 500) this.alertFailure(error, actor.role === 'SCHOOL_ADMIN' ? actor.schoolId : undefined); throw error })
  }
  /** Non-admin authenticated capability read is safe: no counts, roster, or internal budget values. */
  capabilities(): { readonly schemaVersion: 1; readonly mode: 'off' | 'bridge' | 'enabled'; readonly collectionEnabled: boolean; readonly queryCapacityVerified: boolean } {
    return { schemaVersion: 1, mode: this.mode, collectionEnabled: this.mode === 'enabled' && this.initialized && !this.closing, queryCapacityVerified: this.options.queryCapacityVerified === true }
  }
  /** Numeric diagnostics only, for server capacity tests/alerts; never expose raw events or auth projections. */
  diagnostics(): { rows: number; storedBytes: number; cacheEntries: number; cacheBytes: number; bucketScans: number; receiptScans: number } {
    return { rows: this.rowCount(), storedBytes: this.storedBytes, cacheEntries: this.cache.size, cacheBytes: this.cacheBytes, bucketScans: this.bucketScans, receiptScans: this.receiptScans }
  }
  dispose(): Promise<void> {
    this.closing = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.disposal ??= (async () => { await this.recovery; await Promise.allSettled([...this.requests]); await this.chain; this.cache.clear(); this.cacheBytes = 0 })()
    return this.disposal
  }
}
