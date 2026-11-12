/**
 * 反馈与公告 service — the rules, over the notice domain.
 *
 * The one rule worth stating out loud: a STUDENT reading feedback gets only
 * their OWN rows back, and that is enforced here rather than at the route
 * layer. It is a row filter, not a door — a student may legitimately call the
 * list endpoint (their app does, to show "你提交过"), and answering 403 would
 * break a legitimate screen to enforce a rule about WHICH rows are visible.
 */
import crypto from 'node:crypto'
import { z } from 'zod'

import { NoticeError, atLeast, type IdentityActor } from './identity.ts'
import type {
  AnnouncementRecord, FeedbackRecord, PlatformNoticeAckRecord, PlatformNoticeRecord,
} from './domain.ts'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { noticeDomain } from './domain.ts'

/** Wire shape for one new report. Lengths are capped here, at the boundary. */
const feedbackWire = z.object({
  kind: z.enum(['bug', 'content', 'idea', 'other']),
  body: z.string().min(1).max(4000),
  contact: z.string().max(200).optional(),
  context: z.string().max(400).optional(),
})

/** Wire shape for the operator's answer. */
const replyWire = z.object({
  reply: z.string().min(1).max(4000),
  status: z.enum(['answered', 'closed']).optional(),
})

/** Wire shape for one announcement. */
const announcementWire = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(8000),
  /** Omitted by a SCHOOL_ADMIN (own tenant implied); `null` is platform-wide. */
  schoolId: z.string().min(1).nullable().optional(),
})

const platformNoticeWire = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
  enabled: z.boolean(),
})

const platformNoticeAckWire = z.object({
  version: z.number().int().min(1),
})

/** Stable id and PhysicsOS-owned fallback shown before the first admin edit. */
export const PLATFORM_NOTICE_ID = 'platform-notice'
export const DEFAULT_PLATFORM_NOTICE: PlatformNoticeRecord = {
  id: PLATFORM_NOTICE_ID,
  title: 'PhysicsOS 公测声明',
  body: 'PhysicsOS 目前处于面向初高中物理教学的公测阶段，我们会持续打磨实验、题库与学习体验。\n\n欢迎通过“反馈与公告”提交问题和建议。你的学习数据仅用于改进教学功能与服务稳定性。',
  version: 1,
  enabled: true,
  updatedAt: '',
  updatedBy: '',
}

const id = (prefix: string): string => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`
export interface NoticeErasureRequest {
  readonly requestId: string
  readonly userId: string
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
}
type AccountScope = Pick<IdentityActor, 'schoolId' | 'userKey'>
const accountKey = (actor: AccountScope): string => JSON.stringify([actor.schoolId, actor.userKey])
const instanceKey = (actor: AccountScope & { userId: string }): string => JSON.stringify([actor.schoolId, actor.userKey, actor.userId])

/**
 * The notice rules over the `physicsos_notice` domain: the feedback queue
 * (row-filtered by tenant) and announcements (tenant + platform scope).
 */
export class NoticeService {
  /**
   * Serializes platform-notice read-modify-write calls inside this service.
   * Storage-domain backends may complete a write asynchronously; without this
   * tail two concurrent saves can both read version N and publish N+1.
   */
  private platformNoticeTail: Promise<void> = Promise.resolve()

  constructor(private readonly domain: Domain<typeof noticeDomain>) {}

  private get feedback() { return this.domain.table('feedback') }
  private get announcements() { return this.domain.table('announcements') }
  private get platformNotices() { return this.domain.table('platform_notice') }
  private get platformNoticeAcks() { return this.domain.table('platform_notice_acks') }
  private readonly accounts = new Map<string, Promise<void>>()
  private closing = false

  private serial<T>(scope: AccountScope, action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new NoticeError(503, 'NOTICE_UNAVAILABLE', '通知服务正在关闭'))
    const key = accountKey(scope)
    const result = (this.accounts.get(key) ?? Promise.resolve()).then(action)
    const settled = result.then(() => {}, () => {})
    this.accounts.set(key, settled)
    void settled.then(() => { if (this.accounts.get(key) === settled) this.accounts.delete(key) })
    return result
  }
  private assertActive(actor: IdentityActor): void {
    if (typeof actor.userId !== 'string' || actor.userId.length === 0) throw new NoticeError(401, 'UNAUTHENTICATED', '缺少有效账户实例')
    if (this.domain.table('erased_accounts').get(instanceKey(actor)) !== undefined) throw new NoticeError(410, 'ACCOUNT_ERASED', '账户已删除或正在删除')
  }
  private account<T>(actor: IdentityActor, action: () => Promise<T>): Promise<T> {
    return this.serial(actor, async () => { this.assertActive(actor); return action() })
  }

  /** The persisted notice when present, otherwise the immutable default copy. */
  private currentPlatformNotice(): PlatformNoticeRecord {
    return this.platformNotices.get(PLATFORM_NOTICE_ID) ?? DEFAULT_PLATFORM_NOTICE
  }

  /**
   * Read the platform notice together with the caller's own acknowledgement.
   * @param actor - the server-resolved account.
   * @returns the platform notice and this account's acknowledged version.
   */
  getPlatformNotice(
    actor: IdentityActor,
  ): { notice: PlatformNoticeRecord; acknowledgedVersion: number | null } {
    this.assertActive(actor)
    const acknowledgement = this.platformNoticeAcks.get(actor.userKey)
    return {
      notice: this.currentPlatformNotice(),
      acknowledgedVersion: acknowledgement?.userId === actor.userId && acknowledgement.schoolId === actor.schoolId ? acknowledgement.version : null,
    }
  }

  /**
   * Save a new platform notice. Only a platform SUPER_ADMIN reaches this
   * method; the route enforces the outer floor and this check keeps the rule
   * local to the service as well.
   * @param actor - the platform administrator.
   * @param body - title, body and enabled flag.
   * @returns the previous and newly persisted rows, for the audit summary.
   */
  async updatePlatformNotice(
    actor: IdentityActor,
    body: unknown,
  ): Promise<{ previous: PlatformNoticeRecord; notice: PlatformNoticeRecord }> {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new NoticeError(403, 'FORBIDDEN', '只有平台管理员可以编辑内测声明')
    }
    const input = platformNoticeWire.safeParse(body)
    if (!input.success) {
      throw new NoticeError(400, 'BAD_REQUEST', '标题或正文长度不符合要求')
    }
    const commit = this.platformNoticeTail.then(async () => {
      const previous = this.currentPlatformNotice()
      const notice: PlatformNoticeRecord = {
        id: PLATFORM_NOTICE_ID,
        title: input.data.title,
        body: input.data.body,
        enabled: input.data.enabled,
        version: previous.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.userKey,
      }
      await this.platformNotices.put(notice.id, notice)
      return { previous, notice }
    })
    this.platformNoticeTail = commit.then(() => undefined, () => undefined)
    return commit
  }

  /**
   * Record one account's acknowledgement of the current version.
   * @param actor - the server-resolved account.
   * @param body - wire payload carrying the version the client rendered.
   * @returns the persisted acknowledgement version.
   */
  async acknowledgePlatformNotice(
    actor: IdentityActor,
    body: unknown,
  ): Promise<{ acknowledgedVersion: number }> {
    const input = platformNoticeAckWire.safeParse(body)
    if (!input.success) {
      throw new NoticeError(400, 'BAD_REQUEST', '声明版本无效')
    }
    return this.account(actor, async () => {
      const current = this.currentPlatformNotice()
      if (input.data.version !== current.version) throw new NoticeError(409, 'VERSION_CONFLICT', '声明已更新，请刷新后重试')
      const acknowledgement: PlatformNoticeAckRecord = {
        userKey: actor.userKey, userId: actor.userId, schoolId: actor.schoolId,
        version: input.data.version, acknowledgedAt: new Date().toISOString(),
      }
      await this.platformNoticeAcks.put(actor.userKey, acknowledgement)
      return { acknowledgedVersion: acknowledgement.version }
    })
  }

  /**
   * File a report. Any signed-in account may do this — that is the whole point
   * of 反馈, and the identity comes from the session, never the body.
   * @param actor - the server-resolved account.
   * @param body - the wire payload.
   * @returns the stored row.
   */
  async submitFeedback(actor: IdentityActor, body: unknown): Promise<FeedbackRecord> {
    const input = feedbackWire.safeParse(body)
    if (!input.success) throw new NoticeError(400, 'BAD_REQUEST', '请填写反馈内容')
    return this.account(actor, async () => {
      const record: FeedbackRecord = {
        id: id('fb'), schoolId: actor.schoolId, authorKey: actor.userKey, userId: actor.userId,
        kind: input.data.kind, body: input.data.body, status: 'open', createdAt: new Date().toISOString(),
        ...(input.data.contact === undefined ? {} : { contact: input.data.contact }),
        ...(input.data.context === undefined ? {} : { context: input.data.context }),
      }
      await this.feedback.put(record.id, record)
      return record
    })
  }

  /**
   * List reports visible to `actor`.
   *
   *   - STUDENT: only their own, whatever filters they pass.
   *   - TEACHER and above: the whole tenant; a SUPER_ADMIN may name another.
   * @param actor - the server-resolved account.
   * @param filter - optional tenant and status narrowing.
   * @returns rows, newest first.
   */
  listFeedback(
    actor: IdentityActor,
    filter: { schoolId?: string; status?: string } = {},
  ): FeedbackRecord[] {
    this.assertActive(actor)
    const schoolId = actor.role === 'SUPER_ADMIN' ? filter.schoolId : actor.schoolId
    const rows = [...this.feedback.entries()].map(([, row]) => row)
    if (actor.role === 'STUDENT' && rows.some(row => row.authorKey === actor.userKey && row.schoolId === actor.schoolId && row.userId === undefined)) {
      throw new NoticeError(503, 'NOTICE_MIGRATION_REQUIRED', '旧反馈尚未完成账户实例归属迁移')
    }
    return rows
      /* A student's view is their own account incarnation, never the tenant queue. */
      .filter(row => atLeast(actor.role, 'TEACHER') || (row.authorKey === actor.userKey && row.userId === actor.userId))
      .filter(row => schoolId === undefined || row.schoolId === schoolId)
      .filter(row => filter.status === undefined || row.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Answer a report. TEACHER and above, and — for anyone but a super admin —
   * only inside their own tenant: a teacher must not be able to reply to
   * another school's student.
   * @param actor - the server-resolved account.
   * @param feedbackId - the row to answer.
   * @param body - the wire payload carrying the reply text.
   * @returns the updated row.
   */
  async replyFeedback(actor: IdentityActor, feedbackId: string, body: unknown): Promise<FeedbackRecord> {
    if (!atLeast(actor.role, 'TEACHER')) {
      throw new NoticeError(403, 'FORBIDDEN', '只有教师及以上角色可以回复反馈')
    }
    const input = replyWire.safeParse(body)
    if (!input.success) throw new NoticeError(400, 'BAD_REQUEST', '请填写回复内容')
    const existing = this.feedback.get(feedbackId)
    if (existing === undefined) throw new NoticeError(404, 'NOT_FOUND', '反馈不存在')
    if (actor.role !== 'SUPER_ADMIN' && existing.schoolId !== actor.schoolId) {
      throw new NoticeError(403, 'FORBIDDEN', '无权回复其他学校的反馈')
    }
    return this.serial({ schoolId: existing.schoolId, userKey: existing.authorKey }, async () => {
      this.assertActive(actor)
      const current = this.feedback.get(feedbackId)
      if (current === undefined) throw new NoticeError(404, 'NOT_FOUND', '反馈不存在')
      const erased = [...this.domain.table('erased_accounts').entries()].some(([, row]) =>
        row.schoolId === current.schoolId && row.userKey === current.authorKey && (current.userId === undefined || current.userId === row.userId))
      if (erased) throw new NoticeError(410, 'ACCOUNT_ERASED', '反馈所属账户已删除或正在删除')
      const updated: FeedbackRecord = { ...current, reply: input.data.reply, repliedBy: actor.userKey,
        repliedAt: new Date().toISOString(), status: input.data.status ?? 'answered' }
      await this.feedback.put(updated.id, updated)
      return updated
    })
  }

  /**
   * Publish an announcement. SCHOOL_ADMIN and above.
   *
   * A SCHOOL_ADMIN may only address their own tenant — the `schoolId` in the
   * body is ignored for them rather than validated, so there is no value they
   * could send that targets someone else.
   * @param actor - the server-resolved account.
   * @param body - the wire payload.
   * @returns the stored row.
   */
  async publishAnnouncement(actor: IdentityActor, body: unknown): Promise<AnnouncementRecord> {
    if (!atLeast(actor.role, 'SCHOOL_ADMIN')) {
      throw new NoticeError(403, 'FORBIDDEN', '只有校管理员及以上角色可以发布公告')
    }
    const input = announcementWire.safeParse(body)
    if (!input.success) throw new NoticeError(400, 'BAD_REQUEST', '请填写公告标题与正文')
    /* Resolved rather than trusted: a school admin's notice is always their
       own tenant, and only a super admin may address the platform (null). */
    const schoolId = actor.role === 'SUPER_ADMIN'
      ? (input.data.schoolId === undefined ? null : input.data.schoolId)
      : actor.schoolId
    const now = new Date().toISOString()
    const record: AnnouncementRecord = {
      id: id('an'),
      schoolId,
      title: input.data.title,
      body: input.data.body,
      authorKey: actor.userKey,
      publishedAt: now,
      createdAt: now,
    }
    await this.announcements.put(record.id, record)
    return record
  }

  /**
   * Announcements that apply to `actor`: their own tenant's plus the
   * platform's, newest first, retired rows excluded.
   * @param actor - the server-resolved account.
   * @returns the visible notices.
   */
  listAnnouncements(actor: IdentityActor): AnnouncementRecord[] {
    this.assertActive(actor)
    return [...this.announcements.entries()]
      .map(([, row]) => row)
      .filter(row => row.retiredAt === undefined)
      .filter(row => row.schoolId === null || row.schoolId === actor.schoolId)
      .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt))
  }

  /**
   * Retire a notice. Same ownership rule as publishing: a school admin may
   * only retire their own tenant's.
   * @param actor - the server-resolved account.
   * @param announcementId - the row to retire.
   * @returns the updated row.
   */
  async retireAnnouncement(actor: IdentityActor, announcementId: string): Promise<AnnouncementRecord> {
    if (!atLeast(actor.role, 'SCHOOL_ADMIN')) {
      throw new NoticeError(403, 'FORBIDDEN', '只有校管理员及以上角色可以撤回公告')
    }
    const existing = this.announcements.get(announcementId)
    if (existing === undefined) throw new NoticeError(404, 'NOT_FOUND', '公告不存在')
    if (actor.role !== 'SUPER_ADMIN' && existing.schoolId !== actor.schoolId) {
      throw new NoticeError(403, 'FORBIDDEN', '无权限操作其他学校的公告')
    }
    const updated: AnnouncementRecord = { ...existing, retiredAt: new Date().toISOString() }
    await this.announcements.put(updated.id, updated)
    return updated
  }

  /** No provider/SDK is configured: a database row is not an operational push registration. */
  registerPush(actor: IdentityActor, _body: unknown): Promise<{ id: string; platform: 'android'; registeredAt: string }> {
    return this.account(actor, async () => { throw new NoticeError(503, 'PUSH_UNAVAILABLE', '尚未配置并验证真实推送服务') })
  }

  /** Revoke only this exact account incarnation's legacy terminal. */
  revokePush(actor: IdentityActor, id: string): Promise<void> {
    return this.account(actor, async () => {
      const table = this.domain.table('push_terms')
      const row = table.get(id)
      if (row === undefined || row.userKey !== actor.userKey || row.schoolId !== actor.schoolId || row.userId !== actor.userId) {
        throw new NoticeError(404, 'NOT_FOUND', '推送终端不存在')
      }
      if (row.revokedAt === undefined) await table.put(id, { ...row, revokedAt: new Date().toISOString() })
    })
  }

  /** All private notice data, not merely a list of public announcements; tokens/digests are excluded. */
  exportAccount(actor: IdentityActor): Promise<Record<string, unknown>[]> {
    return this.account(actor, async () => {
      const feedback = [...this.feedback.entries()].filter(([, row]) => row.authorKey === actor.userKey && row.schoolId === actor.schoolId)
      const ack = this.platformNoticeAcks.get(actor.userKey)
      const terminals = [...this.domain.table('push_terms').entries()].filter(([, row]) => row.userKey === actor.userKey && row.schoolId === actor.schoolId)
      if (feedback.some(([, row]) => row.userId === undefined) || terminals.some(([, row]) => row.userId === undefined)
        || (ack !== undefined && (ack.userId === undefined || ack.schoolId === undefined))) {
        throw new NoticeError(503, 'NOTICE_MIGRATION_REQUIRED', '旧通知数据缺少账户实例归属，不能返回不完整导出')
      }
      const rows: Record<string, unknown>[] = feedback.filter(([, row]) => row.userId === actor.userId)
        .map(([key, value]) => ({ id: `feedback:${key}`, table: 'feedback', value }))
      if (ack?.userId === actor.userId && ack.schoolId === actor.schoolId) rows.push({ id: `ack:${actor.userId}`, table: 'platform_notice_acks', value: ack })
      for (const [key, row] of terminals) {
        if (row.userId !== actor.userId) continue
        const { tokenHash: _hash, ...value } = row
        rows.push({ id: `push:${key}`, table: 'push_terms', value })
      }
      return rows
    })
  }

  /** Server-only, durable incarnation fence plus the same write queue used by feedback, acknowledgement and push. */
  eraseAccount(request: NoticeErasureRequest): Promise<void> {
    if (!request.requestId || !request.userId || !request.userKey || !request.schoolId || !request.username) {
      throw new NoticeError(400, 'BAD_REQUEST', '账户擦除必须绑定真实账户实例')
    }
    return this.serial(request, async () => {
      const fences = this.domain.table('erased_accounts')
      const key = instanceKey(request)
      const prior = fences.get(key)
      if (prior?.complete) return
      if (prior !== undefined && prior.requestId !== request.requestId) throw new NoticeError(409, 'ERASURE_CONFLICT', '该账户的另一擦除请求尚未完成')
      const fence = { requestId: request.requestId, userId: request.userId, userKey: request.userKey, schoolId: request.schoolId, complete: false }
      await fences.put(key, fence)
      for (const [id, row] of this.feedback.entries()) {
        if (row.schoolId === request.schoolId && row.authorKey === request.userKey && (row.userId === undefined || row.userId === request.userId)) await this.feedback.delete(id)
      }
      const ack = this.platformNoticeAcks.get(request.userKey)
      if (ack !== undefined && (ack.schoolId === undefined || ack.schoolId === request.schoolId) && (ack.userId === undefined || ack.userId === request.userId)) {
        await this.platformNoticeAcks.delete(request.userKey)
      }
      const push = this.domain.table('push_terms')
      for (const [id, row] of push.entries()) {
        if (row.schoolId === request.schoolId && row.userKey === request.userKey && (row.userId === undefined || row.userId === request.userId)) await push.delete(id)
      }
      await fences.put(key, { ...fence, complete: true })
    })
  }

  async dispose(): Promise<void> {
    this.closing = true
    await Promise.all([this.platformNoticeTail, ...this.accounts.values()])
  }

  /**
   * Counts for the console: how much of the queue is still open.
   * @param actor - the operator reading the counts (tenant-scoped like `listFeedback`).
   * @returns per-status totals over the rows this actor may see.
   */
  stats(actor: IdentityActor): { open: number; answered: number; closed: number } {
    const rows = this.listFeedback(actor)
    return {
      open: rows.filter(row => row.status === 'open').length,
      answered: rows.filter(row => row.status === 'answered').length,
      closed: rows.filter(row => row.status === 'closed').length,
    }
  }
}
