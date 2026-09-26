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
    const acknowledgement = this.platformNoticeAcks.get(actor.userKey)
    return {
      notice: this.currentPlatformNotice(),
      acknowledgedVersion: acknowledgement?.version ?? null,
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
    const current = this.currentPlatformNotice()
    if (input.data.version !== current.version) {
      throw new NoticeError(409, 'VERSION_CONFLICT', '声明已更新，请刷新后重试')
    }
    const acknowledgement: PlatformNoticeAckRecord = {
      userKey: actor.userKey,
      version: input.data.version,
      acknowledgedAt: new Date().toISOString(),
    }
    await this.platformNoticeAcks.put(actor.userKey, acknowledgement)
    return { acknowledgedVersion: acknowledgement.version }
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
    const record: FeedbackRecord = {
      id: id('fb'),
      schoolId: actor.schoolId,
      authorKey: actor.userKey,
      kind: input.data.kind,
      body: input.data.body,
      status: 'open',
      createdAt: new Date().toISOString(),
      ...(input.data.contact === undefined ? {} : { contact: input.data.contact }),
      ...(input.data.context === undefined ? {} : { context: input.data.context }),
    }
    await this.feedback.put(record.id, record)
    return record
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
    const schoolId = actor.role === 'SUPER_ADMIN' ? filter.schoolId : actor.schoolId
    return [...this.feedback.entries()]
      .map(([, row]) => row)
      /* A student's view is their own submissions, never the tenant queue. */
      .filter(row => atLeast(actor.role, 'TEACHER') || row.authorKey === actor.userKey)
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
    const updated: FeedbackRecord = {
      ...existing,
      reply: input.data.reply,
      repliedBy: actor.userKey,
      repliedAt: new Date().toISOString(),
      status: input.data.status ?? 'answered',
    }
    await this.feedback.put(updated.id, updated)
    return updated
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
