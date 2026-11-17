/** Durable client-observed run facts, not server simulation or a physics verification certificate. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { ActivityReplaySource, ActivitySink, ActivitySuccessCapsule } from './activity-contract.ts'
import { experimentRunExperimentIdSchema, experimentRunIdSchema, experimentRunRowSchema,
  type ExperimentRunDomain, type ExperimentRunRecordedRow, type ExperimentRunRow } from './experiment-run-domain.ts'
import { DEFAULT_EXPERIMENT_RUN_LIMITS, EXPERIMENT_RUN_CAPABILITY, EXPERIMENT_RUN_REPLAY_MS, ExperimentRunError,
  type ExperimentRunCapabilities, type ExperimentRunLimits, type ExperimentRunMode, type ExperimentRunOwner,
  type ExperimentRunPermit, type ExperimentRunReceipt } from './experiment-run-types.ts'
import type { IdentityActor } from './identity.ts'

const prepareWire = z.strictObject({ runId: experimentRunIdSchema, experimentId: experimentRunExperimentIdSchema, expectedCapabilityGeneration: z.uuid() })
const recordWire = prepareWire.extend({ permit: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
const cursorWire = z.strictObject({ v: z.literal(1), from: z.number().int(), to: z.number().int(), at: z.number().int(), id: z.uuid() })
const ownerWire = z.strictObject({ schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160) })
const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const ownerKey = (owner: ExperimentRunOwner): string => JSON.stringify([owner.schoolId, owner.userKey])
const ownerOf = (actor: ExperimentRunOwner): ExperimentRunOwner => ownerWire.parse({ schoolId: actor.schoolId, userKey: actor.userKey })
const owns = (a: ExperimentRunOwner, b: ExperimentRunOwner): boolean => a.schoolId === b.schoolId && a.userKey === b.userKey
function fail(status: number, code: string, message: string): never { throw new ExperimentRunError(status, code, message) }
export interface ExperimentRunControl {
  readonly signal?: AbortSignal
  /** Rechecks cookie authority after body/queue waits and immediately before a durable write. Never an owner supplied by JSON. */
  readonly assertOwner?: () => void
}
export interface ExperimentRunServiceOptions {
  readonly mode?: ExperimentRunMode
  /** Must resolve the EXISTING server-approved catalog. Missing resolver is fail-closed, not an arbitrary slug allowlist. */
  readonly resolveExperiment?: ((experimentId: string) => boolean) | undefined
  /** Lazy ctx seams can be missing during plugin startup/reconnect. Do not advertise a resolver which is not mounted. */
  readonly catalogAvailable?: () => boolean
  readonly limits?: Partial<ExperimentRunLimits>
  readonly now?: () => Date
  readonly activitySink?: ActivitySink
  /** Fixed diagnostic code only; no tokens, request bodies, owner data or exception text. */
  readonly onIssue?: (code: string) => void
}
interface AccountBudget { rows: number; bytes: number }
interface RowBudget { readonly owner: string; readonly bytes: number; readonly retainedAt: number }
interface ReplayEntry { readonly id: string; readonly at: number; readonly capsule: ActivitySuccessCapsule }

/** One service owner per open unit. All admissions/updates serialize; a storage ACK failure freezes writes until reopen. */
export class ExperimentRunService {
  readonly mode: ExperimentRunMode
  readonly limits: Readonly<ExperimentRunLimits>
  readonly capabilityGeneration = randomUUID()
  private readonly permitKey = randomBytes(32)
  private readonly now: () => Date
  private chain: Promise<void> = Promise.resolve()
  private queued = 0
  private initialized = false
  private closing = false
  private uncertain = false
  private readonly rowBudgets = new Map<string, RowBudget>()
  private readonly accountBudgets = new Map<string, AccountBudget>()
  private totalBytes = 0
  private rateMinute = -1
  private globalRequests = 0
  private readonly ownerRequests = new Map<string, number>()
  private nextPruneAt = 0
  private readonly replay = new Map<string, ReplayEntry>()
  private ordered: readonly ReplayEntry[] | undefined
  private readonly delivering = new Map<string, Promise<void>>()
  constructor(readonly domain: ExperimentRunDomain, readonly options: ExperimentRunServiceOptions = {}) {
    this.mode = options.mode ?? 'bridge'; this.now = options.now ?? (() => new Date())
    if (!['off', 'bridge', 'enabled'].includes(this.mode)) throw new Error('Invalid experiment run mode')
    for (const key of Object.keys(options.limits ?? {})) if (!Object.hasOwn(DEFAULT_EXPERIMENT_RUN_LIMITS, key)) throw new Error('Unknown experiment run limit')
    const limits = { ...DEFAULT_EXPERIMENT_RUN_LIMITS, ...options.limits }
    for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Experiment run limits must be positive safe integers')
    if (limits.retentionMs < EXPERIMENT_RUN_REPLAY_MS || limits.permitTtlMs > 5 * 60_000 || limits.permitTtlMs > limits.retentionMs || limits.activityTimeoutMs > 3000 || limits.maxReplayPage > 500 || limits.maxRowBytes > limits.maxAccountBytes || limits.maxAccountBytes > limits.maxBytes || limits.maxAccountRows > limits.maxRows || limits.maxRequestsPerAccountMinute > limits.maxRequestsGlobalMinute) throw new Error('Incompatible experiment run limits')
    this.limits = Object.freeze(limits)
  }
  private get runs() { return this.domain.table('runs') }
  private issue(code: string): void { try { this.options.onIssue?.(code) } catch { /* Diagnostics cannot invalidate business success. */ } }
  private time(): number {
    const now = this.now().getTime()
    if (!Number.isSafeInteger(now)) return fail(503, 'CLOCK_UNAVAILABLE', '实验运行记录时钟暂不可用。')
    return now
  }
  private available(): void {
    if (!this.initialized || this.closing) fail(503, 'RUN_SOURCE_UNAVAILABLE', '实验运行记录服务尚未就绪。')
    if (this.uncertain) fail(503, 'RUN_STORAGE_UNCERTAIN', '实验运行记录写入结果尚未核实，需重新打开存储后恢复。')
  }
  private enabled(): void {
    this.available()
    if (this.mode !== 'enabled') fail(423, 'RUN_RECORDING_DISABLED', '当前兼容模式不接受新的实验运行记录。')
    if (!this.catalogReady()) fail(503, 'RUN_CATALOG_UNAVAILABLE', '实验运行记录尚未接入服务端实验目录。')
  }
  private catalogReady(): boolean {
    if (this.options.resolveExperiment === undefined) return false
    try { return this.options.catalogAvailable === undefined || this.options.catalogAvailable() === true } catch { return false }
  }
  private check(control: ExperimentRunControl): void { control.signal?.throwIfAborted(); control.assertOwner?.() }
  private generation(value: string): void {
    if (value !== this.capabilityGeneration) fail(409, 'RUN_CAPABILITY_CHANGED', '实验运行记录能力已变更，请在下次运行前重新读取能力。')
  }
  private catalog(id: string): void {
    let approved: boolean
    try { approved = this.options.resolveExperiment?.(id) === true } catch { return fail(503, 'RUN_CATALOG_UNAVAILABLE', '服务端实验目录暂不可用。') }
    if (!approved) fail(400, 'RUN_EXPERIMENT_NOT_APPROVED', '实验标识不在服务端已批准目录中。')
  }
  private parse<T>(wire: z.ZodType<T>, value: unknown): T {
    const parsed = wire.safeParse(value)
    return parsed.success ? parsed.data : fail(400, 'BAD_RUN_REQUEST', '实验运行记录请求格式无效。')
  }
  private enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    try { this.available() } catch (error) { return Promise.reject(error) }
    if (this.queued >= this.limits.maxQueuedOperations) return Promise.reject(new ExperimentRunError(429, 'RUN_QUEUE_FULL', '实验运行记录队列已满，请稍后重试。'))
    this.queued++
    const result = this.chain.then(() => { this.available(); return work() })
    this.chain = result.then(() => {}, () => {})
    return result.finally(() => { this.queued-- })
  }
  private rate(actor: ExperimentRunOwner, now: number): void {
    const minute = Math.floor(now / 60_000)
    if (this.rateMinute !== minute) { this.rateMinute = minute; this.globalRequests = 0; this.ownerRequests.clear() }
    const key = ownerKey(actor), used = this.ownerRequests.get(key) ?? 0
    if (used >= this.limits.maxRequestsPerAccountMinute || this.globalRequests >= this.limits.maxRequestsGlobalMinute || !this.ownerRequests.has(key) && this.ownerRequests.size >= this.limits.maxRateOwners) fail(429, 'RUN_RATE_LIMIT', '实验运行记录请求过于频繁。')
    this.globalRequests++; this.ownerRequests.set(key, used + 1)
  }
  private bytes(row: ExperimentRunRow): number {
    // A prepared row reserves enough budget for the complete success row, not only its smaller permit hash.
    const encoded = Buffer.byteLength(JSON.stringify(row), 'utf8') + Buffer.byteLength(row.runId, 'utf8')
    if (encoded > this.limits.maxRowBytes) fail(507, 'RUN_ROW_LIMIT', '完整实验运行记录超过单行容量，未截断保存。')
    return row.state === 'prepared' ? this.limits.maxRowBytes : encoded
  }
  private admit(row: ExperimentRunRow): number {
    const bytes = this.bytes(row), previous = this.rowBudgets.get(row.runId), key = ownerKey(row.owner)
    const account = this.accountBudgets.get(key) ?? { rows: 0, bytes: 0 }
    if (previous !== undefined && previous.owner !== key) fail(403, 'RUN_OWNER_MISMATCH', '该运行标识不属于当前会话账号。')
    const extraRows = previous === undefined ? 1 : 0, extraBytes = bytes - (previous?.bytes ?? 0)
    if (account.rows + extraRows > this.limits.maxAccountRows || account.bytes + extraBytes > this.limits.maxAccountBytes) fail(413, 'RUN_ACCOUNT_QUOTA', '账号实验运行记录已达容量上限。')
    if (this.rowBudgets.size + extraRows > this.limits.maxRows || this.totalBytes + extraBytes > this.limits.maxBytes) fail(507, 'RUN_GLOBAL_QUOTA', '实验运行记录全局容量已达上限。')
    return bytes
  }
  private index(row: ExperimentRunRow, bytes: number): void {
    const key = ownerKey(row.owner), previous = this.rowBudgets.get(row.runId), account = this.accountBudgets.get(key) ?? { rows: 0, bytes: 0 }
    account.rows += previous === undefined ? 1 : 0; account.bytes += bytes - (previous?.bytes ?? 0)
    this.accountBudgets.set(key, account); this.totalBytes += bytes - (previous?.bytes ?? 0)
    this.rowBudgets.set(row.runId, { owner: key, bytes, retainedAt: Date.parse(row.state === 'recorded' ? row.recordedAt : row.preparedAt) })
    if (row.state === 'recorded') { this.replay.set(row.runId, { id: row.runId, at: Date.parse(row.recordedAt), capsule: structuredClone(row.activitySuccess) }); this.ordered = undefined }
  }
  private async store(row: ExperimentRunRow, control: ExperimentRunControl): Promise<void> {
    const valid = experimentRunRowSchema.parse(row), bytes = this.admit(valid)
    this.check(control)
    try {
      if (this.runs.get(valid.runId) === undefined) await this.runs.put(valid.runId, valid)
      else await this.runs.update(valid.runId, () => valid)
    } catch {
      // A backend may have durably written before rejecting its ACK. Never overwrite it using stale in-memory state.
      this.uncertain = true; this.issue('EXPERIMENT_RUN_STORAGE_UNCERTAIN')
      return fail(503, 'RUN_STORAGE_UNCERTAIN', '实验运行记录写入结果尚未核实，请稍后用同一标识重试。')
    }
    this.index(valid, bytes)
  }
  /** Read-only boot, including bridge. No row is synthesized for an empty or unavailable source. */
  async initialize(): Promise<void> {
    if (this.initialized || this.closing) throw new Error('Experiment run service already initialized or disposed')
    for (const [key, input] of this.runs.entries()) {
      const row = experimentRunRowSchema.parse(input)
      if (key !== row.runId) throw new Error('Experiment run key differs from its receipt')
      this.index(row, this.admit(row))
    }
    this.initialized = true
  }
  capabilities(): ExperimentRunCapabilities {
    this.available()
    return { schemaVersion: 1, capability: EXPERIMENT_RUN_CAPABILITY, mode: this.mode,
      recordingEnabled: this.mode === 'enabled' && this.catalogReady(),
      capabilityGeneration: this.capabilityGeneration, provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', permitTtlMs: this.limits.permitTtlMs }
  }
  private prepareHash(row: { readonly owner: ExperimentRunOwner; readonly runId: string; readonly experimentId: string; readonly capabilityGeneration: string }): string {
    return hash(JSON.stringify([row.owner.schoolId, row.owner.userKey, row.runId, row.experimentId, row.capabilityGeneration]))
  }
  private permit(row: ExperimentRunRow): string {
    // Process-private PRF permits deterministic prepare retries without retaining any plaintext permit.
    // A new process/service generation refuses all old permits, including after a cold reopen.
    return createHmac('sha256', this.permitKey).update(JSON.stringify([row.owner.schoolId, row.owner.userKey, row.runId, row.experimentId, row.capabilityGeneration, row.preparedAt, row.expiresAt])).digest('base64url')
  }
  private expires(row: ExperimentRunRow, now: number): void {
    if (now < Date.parse(row.preparedAt)) fail(409, 'RUN_CLOCK_CHANGED', '记录时钟早于运行准备时刻，未接纳该运行。')
    if (now >= Date.parse(row.expiresAt)) fail(410, 'RUN_PERMIT_EXPIRED', '实验运行许可已过期；不把旧运行改记为今天。')
  }
  private row(actor: ExperimentRunOwner, id: string): ExperimentRunRow {
    const row = this.runs.get(id)
    if (row === undefined) return fail(404, 'RUN_NOT_PREPARED', '实验运行尚未取得有效许可。')
    if (!owns(row.owner, actor)) fail(403, 'RUN_OWNER_MISMATCH', '该运行标识不属于当前会话账号。')
    return row
  }
  async prepare(actor: IdentityActor, input: unknown, control: ExperimentRunControl = {}): Promise<ExperimentRunPermit> {
    this.enabled(); const body = this.parse(prepareWire, input), owner = ownerOf(actor)
    return this.enqueue(async () => {
      this.enabled(); this.check(control)
      const now = this.time(); this.rate(owner, now); this.generation(body.expectedCapabilityGeneration); this.catalog(body.experimentId)
      await this.pruneExpired(now, control)
      const previous = this.runs.get(body.runId)
      const expectedHash = this.prepareHash({ owner, runId: body.runId, experimentId: body.experimentId, capabilityGeneration: body.expectedCapabilityGeneration })
      let row: ExperimentRunRow
      if (previous !== undefined) {
        row = this.row(owner, body.runId)
        if (row.prepareHash !== expectedHash) fail(409, 'RUN_ID_REUSED', '同一运行标识已用于不同内容，不能覆盖旧记录。')
        this.expires(row, now)
      } else {
        const preparedAt = new Date(now).toISOString(), expiresAt = new Date(now + this.limits.permitTtlMs).toISOString()
        const draft = { schemaVersion: 1 as const, state: 'prepared' as const, runId: body.runId, experimentId: body.experimentId, owner,
          capabilityGeneration: this.capabilityGeneration, preparedAt, expiresAt, prepareHash: expectedHash }
        const permit = this.permit({ ...draft, permitHash: '0'.repeat(64) })
        // Reserve the worst complete success shape before issuing a permit. A too-small row limit fails at prepare, not after the experiment ran.
        const reservedAt = preparedAt
        this.bytes({ ...draft, permitHash: hash(permit), state: 'recorded', recordedAt: reservedAt, stableHash: '0'.repeat(64),
          provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace',
          activitySuccess: { version: 1, source: 'experiment-run', operationId: body.runId, occurredAt: reservedAt, owner } })
        row = { ...draft, permitHash: hash(permit) }
        await this.store(row, control) // prepare is only a reservation: no recordedAt and no activity capsule
      }
      const permit = this.permit(row)
      if (hash(permit) !== row.permitHash) fail(409, 'RUN_CAPABILITY_CHANGED', '运行许可已失效，请在下次运行前刷新能力。')
      return { ...body, permit, expiresAt: row.expiresAt }
    })
  }
  private receipt(row: ExperimentRunRecordedRow, replayed: boolean): ExperimentRunReceipt {
    return { runId: row.runId, experimentId: row.experimentId, recordedAt: row.recordedAt, provenance: row.provenance, boundary: row.boundary, scope: row.scope, replayed }
  }
  async record(actor: IdentityActor, input: unknown, control: ExperimentRunControl = {}): Promise<ExperimentRunReceipt> {
    this.enabled(); const body = this.parse(recordWire, input), owner = ownerOf(actor)
    const result = await this.enqueue(async () => {
      this.enabled(); this.check(control)
      const now = this.time(); this.rate(owner, now); this.generation(body.expectedCapabilityGeneration); this.catalog(body.experimentId)
      const row = this.row(owner, body.runId)
      if (row.prepareHash !== this.prepareHash({ owner, runId: body.runId, experimentId: body.experimentId, capabilityGeneration: body.expectedCapabilityGeneration })) fail(409, 'RUN_ID_REUSED', '运行标识、实验或能力代际与准备记录不一致。')
      this.expires(row, now)
      const suppliedHash = hash(body.permit)
      if (!timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(row.permitHash, 'hex'))) fail(403, 'RUN_PERMIT_INVALID', '实验运行许可无效。')
      const stableHash = hash(JSON.stringify([row.prepareHash, suppliedHash, 'client-observed', 'platform-engine-first-step', 'lab-workspace']))
      if (row.state === 'recorded') {
        if (row.stableHash !== stableHash) fail(409, 'RUN_ID_REUSED', '同一运行标识已保存不同的成功内容。')
        return { row, replayed: true }
      }
      const recordedAt = new Date(now).toISOString()
      const activitySuccess: ActivitySuccessCapsule = { version: 1, source: 'experiment-run', operationId: row.runId, occurredAt: recordedAt, owner: ownerOf(owner) }
      const recorded: ExperimentRunRecordedRow = { ...row, state: 'recorded', recordedAt, stableHash,
        provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', activitySuccess }
      await this.store(recorded, control) // fact + immutable original time/owner/hash + success capsule are ONE atomic row update
      return { row: recorded, replayed: false }
    })
    await this.deliver(result.row.activitySuccess) // never throws or changes the already durable receipt
    return this.receipt(result.row, result.replayed)
  }
  private async deliver(capsule: ActivitySuccessCapsule): Promise<void> {
    if (this.options.activitySink === undefined || this.closing) { this.issue('EXPERIMENT_RUN_ACTIVITY_PENDING'); return }
    let delivery = this.delivering.get(capsule.operationId)
    if (delivery === undefined) {
      if (this.delivering.size >= this.limits.maxActivityInFlight) { this.issue('EXPERIMENT_RUN_ACTIVITY_PENDING'); return }
      delivery = Promise.resolve().then(() => this.options.activitySink!.success(structuredClone(capsule))).then(result => {
        if (result.status !== 'recorded' && result.status !== 'duplicate') this.issue('EXPERIMENT_RUN_ACTIVITY_PENDING')
      }, () => { this.issue('EXPERIMENT_RUN_ACTIVITY_PENDING') })
      this.delivering.set(capsule.operationId, delivery)
      void delivery.finally(() => { this.delivering.delete(capsule.operationId) }).catch(() => {})
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([delivery, new Promise<void>(resolve => { timer = setTimeout(() => { this.issue('EXPERIMENT_RUN_ACTIVITY_PENDING'); resolve() }, this.limits.activityTimeoutMs) })]) }
    catch { this.issue('EXPERIMENT_RUN_ACTIVITY_PENDING') }
    finally { if (timer !== undefined) clearTimeout(timer) }
  }
  private async pruneExpired(now: number, control: ExperimentRunControl): Promise<void> {
    if (now < this.nextPruneAt) return
    this.nextPruneAt = now + 60_000
    let removed = 0
    for (const [id, budget] of this.rowBudgets) {
      if (removed >= this.limits.maxPruneRows) break
      if (budget.retainedAt >= now - this.limits.retentionMs) continue
      this.check(control)
      try { await this.runs.delete(id) } catch { this.uncertain = true; this.issue('EXPERIMENT_RUN_STORAGE_UNCERTAIN'); return fail(503, 'RUN_STORAGE_UNCERTAIN', '运行记录保留清理结果尚未核实。') }
      this.rowBudgets.delete(id); this.totalBytes -= budget.bytes
      const account = this.accountBudgets.get(budget.owner)!
      account.rows--; account.bytes -= budget.bytes
      if (account.rows === 0) this.accountBudgets.delete(budget.owner)
      this.replay.delete(id); this.ordered = undefined; removed++
    }
  }
  /** Source is built ONLY from committed recorded rows. Prepared, expired-without-success and failed writes never replay. */
  get activityReplaySource(): ActivityReplaySource { return { source: 'experiment-run', read: async query => {
    this.available(); query.signal.throwIfAborted()
    if (this.mode === 'enabled' && !this.catalogReady()) fail(503, 'RUN_CATALOG_UNAVAILABLE', '真实运行目录未接好，不能把此来源报告为已完整追平。')
    const from = Date.parse(query.from), to = Date.parse(query.to), now = this.time()
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to || to > now || to - from > EXPERIMENT_RUN_REPLAY_MS || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > this.limits.maxReplayPage) fail(400, 'BAD_RUN_REPLAY', '实验运行重放必须使用有界的七日原时间窗口。')
    let after: z.infer<typeof cursorWire> | undefined
    if (query.cursor !== undefined) {
      try {
        if (query.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error('cursor')
        after = cursorWire.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')))
        if (after.from !== from || after.to !== to || after.at < from || after.at >= to) throw new Error('bounds')
      } catch { return fail(400, 'BAD_RUN_REPLAY_CURSOR', '实验运行重放游标与窗口不匹配。') }
    }
    this.ordered ??= [...this.replay.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const ordered = this.ordered, oldest = Math.max(from, now - EXPERIMENT_RUN_REPLAY_MS)
    let low = 0, high = ordered.length
    while (low < high) {
      const middle = (low + high) >>> 1, row = ordered[middle]!
      if (row.at < from || after !== undefined && (row.at < after.at || row.at === after.at && row.id <= after.id)) low = middle + 1
      else high = middle
    }
    // Never silently skip a known fact which aged out while a recovery window was paging.
    // The activity owner must retain an incomplete/gap state instead of treating an empty page as caught up.
    const first = ordered[low]
    if (first !== undefined && first.at < oldest && first.at < to) fail(410, 'RUN_REPLAY_EXPIRED', '原运行记录已超出七日恢复窗口，不能改记当前时间或宣称恢复完整。')
    const page: ReplayEntry[] = []
    for (let index = low; index < ordered.length && page.length <= query.limit; index++) {
      query.signal.throwIfAborted(); const row = ordered[index]!
      if (row.at >= to) break
      page.push(row)
    }
    const retained = page.slice(0, query.limit), last = retained.at(-1)
    return { capsules: retained.map(row => structuredClone(row.capsule)), ...(page.length > query.limit && last !== undefined ? {
      nextCursor: Buffer.from(JSON.stringify({ v: 1, from, to, at: last.at, id: last.id })).toString('base64url'),
    } : {}) }
  } } }
  async dispose(): Promise<void> { this.closing = true; await this.chain; this.permitKey.fill(0) }
}
