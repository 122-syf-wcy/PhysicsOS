import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AuthDomain } from '../domain.ts'
import { userKey } from '../domain.ts'
import { AuthError } from '../service.ts'
import type { AdminActor, AuthService } from '../service.ts'
import { ModerationModelError, reviewWithDeadline } from './model.ts'
import type {
  CapturedMessage, ModerationCase, ModerationCaseRecord, ModerationDecision, ModerationDeps,
  ModerationEnabled, ModerationPage, ModerationQuery, ModerationRetry, ModerationScan, ModerationSettings,
} from './types.ts'

const captureSchema = z.object({
  sessionId: z.string().min(1).max(256), messageId: z.string().min(1).max(256),
  text: z.string(), context: z.string().optional(), sessionTitle: z.string().optional(),
})
const decisionSchema = z.object({
  version: z.number().int().min(1), decision: z.enum(['dismiss', 'ban']), reason: z.string().trim().min(1).max(2_000),
}).strict()
const retrySchema = z.object({ version: z.number().int().min(1) }).strict()
const enabledSchema = z.object({ version: z.number().int().min(1), enabled: z.boolean() }).strict()
const querySchema = z.object({
  page: z.number().int().min(1).max(1_000_000).default(1),
  limit: z.number().int().min(1).transform(n => Math.min(n, 50)).default(50),
  status: z.enum(['pending', 'reviewing', 'allowed', 'flagged', 'error', 'dismissed', 'banned']).optional(),
})
interface DomainWork {
  locks: Map<string, Promise<void>>
  active?: AbortController
  processing: boolean
  lastCompleted?: number
}
const work = new WeakMap<AuthDomain, DomainWork>()
const safeModelCodes = new Set([
  'REVIEW_TIMEOUT', 'REVIEW_ABORTED', 'REVIEW_DISABLED', 'REVIEW_INVALID_OUTPUT',
  'REVIEW_INVALID_INPUT', 'REVIEW_FAILED', 'REVIEW_TOOL_OUTPUT', 'REVIEW_OUTPUT_LIMIT', 'REVIEW_EMPTY',
])

/** One durable capture/review queue in the existing single-writer auth domain. */
export class ModerationService {
  private readonly work: DomainWork
  constructor(private readonly domain: AuthDomain, private readonly auth: AuthService, private readonly deps: ModerationDeps) {
    const existing = work.get(domain)
    this.work = existing ?? { locks: new Map(), processing: false }
    work.set(domain, this.work)
  }

  private now(): Date { return this.deps.now?.() ?? new Date() }
  private get cases() { return this.domain.table('moderation_cases') }
  private requireSuper(actor: AdminActor): void {
    if (actor.role !== 'SUPER_ADMIN') throw new AuthError(403, 'FORBIDDEN', '需要平台管理员权限')
  }
  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body)
    if (!result.success) throw new AuthError(400, 'BAD_REQUEST', '请检查审核参数')
    return result.data
  }
  private async serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.work.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const current = previous.then(() => waiting)
    this.work.locks.set(key, current)
    await previous
    try { return await operation() }
    finally {
      release()
      if (this.work.locks.get(key) === current) this.work.locks.delete(key)
    }
  }
  private load(id: string): ModerationCaseRecord {
    const row = this.cases.get(id)
    if (!row) throw new AuthError(404, 'NOT_FOUND', '审核记录不存在')
    return row
  }
  private view(row: ModerationCaseRecord): ModerationCase {
    const user = this.domain.table('users').get(row.ownerKey)
    return { ...row, accountStatus: user?.id === row.userId ? user.status : 'disabled' }
  }
  private matchVersion(row: ModerationCaseRecord, version: number): void {
    if (row.version !== version) throw new AuthError(409, 'VERSION_CONFLICT', '审核记录已更新，请刷新后重试')
  }
  private readSettings(): ModerationSettings {
    return this.domain.table('moderation_settings').get('default') ?? {
      version: 1, enabled: true, updatedAt: new Date(0).toISOString(), captureFailures: 0,
    }
  }

  /** Owner lookup and session/message key are server authoritative, never model or client targets. */
  async capture(input: CapturedMessage): Promise<string | undefined> {
    const data = this.parse(captureSchema, input)
    return this.serial('intake-settings', async () => {
      const owner = this.domain.table('api_resources').get(`session:${data.sessionId}`)
      if (!owner || owner.kind !== 'session' || owner.resourceId !== data.sessionId) return undefined
      const user = this.domain.table('users').get(owner.ownerKey)
      if (!user || user.schoolId !== owner.schoolId || userKey(user.schoolId, user.username) !== owner.ownerKey) return undefined
      const id = `mc_${createHash('sha256').update(JSON.stringify([data.sessionId, data.messageId])).digest('hex')}`
      const existing = this.cases.get(id)
      if (existing) return existing.id
      if (Array.from(this.cases.entries()).length >= 10_000) {
        const settings = this.readSettings()
        await this.domain.table('moderation_settings').put('default', {
          ...settings, captureFailures: Math.min(settings.captureFailures + 1, 1_000_000_000),
          lastCaptureFailure: 'CAPTURE_CAPACITY', version: settings.version + 1, updatedAt: this.now().toISOString(),
        })
        throw new AuthError(503, 'CAPTURE_CAPACITY', '审核记录已达容量上限，请管理员处理留存记录与容量')
      }
      const context = data.context ?? ''
      const now = this.now().toISOString()
      await this.cases.put(id, {
        id, sessionId: data.sessionId, messageId: data.messageId,
        ...(data.sessionTitle !== undefined ? { sessionTitle: data.sessionTitle.slice(0, 256) } : {}),
        ownerKey: owner.ownerKey, schoolId: user.schoolId, username: user.username, userId: user.id,
        text: data.text.slice(0, 12_000), context: context.slice(0, 4_000),
        textTruncated: data.text.length > 12_000, contextTruncated: context.length > 4_000,
        status: 'pending', version: 1, createdAt: now, updatedAt: now,
      })
      return id
    })
  }

  /** Drain one pending/recovered job, serially and with a45-second bounded classifier call. */
  async processNext(): Promise<boolean> {
    if (this.work.processing || !this.readSettings().enabled
      || (this.work.lastCompleted !== undefined && this.now().getTime() - this.work.lastCompleted < 15_000)) return false
    this.work.processing = true
    let didRun = false
    try {
      const selected = [...this.cases.entries()].map(([, row]) => row)
        .filter(row => !row.decision && (row.status === 'pending' || row.status === 'reviewing'))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]
      if (!selected) return false
      const claimed = await this.serial(selected.id, async () => {
        const current = this.load(selected.id)
        if (current.decision || !['pending', 'reviewing'].includes(current.status) || !this.readSettings().enabled) return undefined
        const next: ModerationCaseRecord = { ...current, status: 'reviewing', version: current.version + 1, updatedAt: this.now().toISOString() }
        await this.cases.put(next.id, next)
        return next
      })
      if (!claimed) return false
      didRun = true
      const controller = new AbortController()
      this.work.active = controller
      let review: ModerationCaseRecord['review']
      let error: string | undefined
      try {
        review = await reviewWithDeadline(this.deps.review, {
          text: claimed.text, context: claimed.context, textTruncated: claimed.textTruncated, contextTruncated: claimed.contextTruncated,
        }, controller.signal)
      } catch (failure) {
        error = failure instanceof ModerationModelError && safeModelCodes.has(failure.code) ? failure.code : 'REVIEW_FAILED'
      }
      await this.serial(claimed.id, async () => {
        const current = this.load(claimed.id)
        // A human decision/retry committed meanwhile; old model work has no authority over it.
        if (current.version !== claimed.version || current.status !== 'reviewing' || current.decision) return
        const allowed = review?.risk === 'allow' && review.confidence >= 0.8 && review.severity === 'none'
          && !current.textTruncated && !current.contextTruncated
        await this.cases.put(current.id, {
          ...current, status: error ? 'error' : allowed ? 'allowed' : 'flagged',
          ...(review ? { review } : {}), ...(error ? { error } : {}),
          version: current.version + 1, updatedAt: this.now().toISOString(),
        })
      })
      return true
    } finally {
      delete this.work.active
      this.work.processing = false
      if (didRun) this.work.lastCompleted = this.now().getTime()
    }
  }

  list(actor: AdminActor, query: ModerationQuery = {}): ModerationPage {
    this.requireSuper(actor)
    const { page, limit, status } = this.parse(querySchema, query)
    const rows = [...this.cases.entries()].map(([, row]) => row)
      .filter(row => status === undefined || row.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    return { cases: rows.slice((page - 1) * limit, page * limit).map(row => this.view(row)), total: rows.length, page, limit }
  }
  detail(actor: AdminActor, id: string): ModerationCase { this.requireSuper(actor); return this.view(this.load(id)) }

  async decide(actor: AdminActor, id: string, body: ModerationDecision): Promise<ModerationCase> {
    this.requireSuper(actor)
    const input = this.parse(decisionSchema, body)
    return this.serial(id, async () => {
      const current = this.load(id)
      this.matchVersion(current, input.version)
      if (current.decision) throw new AuthError(409, 'DECISION_FINAL', '该记录已有人工决定')
      if (input.decision === 'ban') {
        const user = this.domain.table('users').get(current.ownerKey)
        if (!user || user.id !== current.userId || userKey(user.schoolId, user.username) !== current.ownerKey) {
          throw new AuthError(409, 'OWNER_CHANGED', '原审核账号已变更，请核查')
        }
        // Re-run the real disable even when already disabled: interrupted revocation/audit must reconcile.
        await this.auth.setUserStatus(actor, current.schoolId, current.username, { status: 'disabled' })
      }
      const now = this.now().toISOString()
      const next: ModerationCaseRecord = {
        ...current, status: input.decision === 'ban' ? 'banned' : 'dismissed', version: current.version + 1, updatedAt: now,
        decision: { decision: input.decision, reason: input.reason, actorKey: actor.userKey, decidedAt: now },
      }
      await this.cases.put(id, next)
      await this.auth.auditAs(actor, `moderation.${input.decision}`, id, {
        caseId: id, action: input.decision, category: current.review?.category ?? 'none',
      })
      return this.view(next)
    })
  }

  async retry(actor: AdminActor, id: string, body: ModerationRetry): Promise<ModerationCase> {
    this.requireSuper(actor)
    const input = this.parse(retrySchema, body)
    return this.serial(id, async () => {
      const row = this.load(id)
      this.matchVersion(row, input.version)
      if (row.decision || row.status === 'pending' || row.status === 'reviewing') throw new AuthError(409, 'RETRY_UNAVAILABLE', '当前记录不能重试')
      const { review: _review, error: _error, ...retained } = row
      const next: ModerationCaseRecord = { ...retained, status: 'pending', version: row.version + 1, updatedAt: this.now().toISOString() }
      await this.cases.put(id, next)
      await this.auth.auditAs(actor, 'moderation.retry', id, { caseId: id, action: 'retry', category: row.review?.category ?? 'none' })
      return this.view(next)
    })
  }

  settings(actor: AdminActor): ModerationSettings { this.requireSuper(actor); return this.readSettings() }
  async setEnabled(actor: AdminActor, body: ModerationEnabled): Promise<ModerationSettings> {
    this.requireSuper(actor)
    const input = this.parse(enabledSchema, body)
    return this.serial('intake-settings', async () => {
      const settings = this.readSettings()
      if (settings.version !== input.version) throw new AuthError(409, 'VERSION_CONFLICT', '审核设置已更新，请刷新')
      const next = { ...settings, enabled: input.enabled, version: settings.version + 1, updatedAt: this.now().toISOString() }
      await this.domain.table('moderation_settings').put('default', next)
      if (!next.enabled) this.work.active?.abort(new ModerationModelError('REVIEW_DISABLED'))
      await this.auth.auditAs(actor, 'moderation.settings', 'default', { action: input.enabled ? 'enable' : 'disable', category: 'none' })
      return next
    })
  }

  async scan(actor: AdminActor): Promise<ModerationScan> {
    this.requireSuper(actor)
    if (!this.deps.scan) throw new AuthError(503, 'SCAN_UNAVAILABLE', '历史补扫未配置，请启用可信服务端历史读取器')
    const messages = (await this.deps.scan(20)).slice(0, 20)
    let captured = 0
    for (const message of messages) {
      const before = Array.from(this.cases.entries()).length
      await this.capture(message)
      if (Array.from(this.cases.entries()).length > before) captured += 1
    }
    await this.auth.auditAs(actor, 'moderation.scan', 'default', { action: 'scan', category: 'none' })
    return { scanned: messages.length, captured }
  }
}
