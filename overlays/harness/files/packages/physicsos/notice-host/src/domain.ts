/**
 * Storage-domain spec for 反馈与公告 — one `physicsos_notice` unit.
 *
 * Two tables, two directions of travel, and they are deliberately in the same
 * unit because they are the same conversation: a student reports something, an
 * operator answers. Splitting them across hosts would mean two identity guards
 * and two audit trails for one exchange.
 *
 *   - `feedback` — written by ANY signed-in account, read by TEACHER and above
 *     in the writer's own tenant. A student only ever sees their own back.
 *   - `announcements` — written by SCHOOL_ADMIN and above, read by everyone in
 *     scope. `schoolId: null` is a platform-wide notice.
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

const feedbackKind = z.enum(['bug', 'content', 'idea', 'other'])
const feedbackStatus = z.enum(['open', 'answered', 'closed'])

const feedback = z.object({
  id: z.string().min(1),
  /** Tenant the submission belongs to — every list read filters on it. */
  schoolId: z.string().min(1),
  /** `schoolId:username` of the writer, as the SERVER resolved it. */
  authorKey: z.string().min(1),
  kind: feedbackKind,
  /** What the reporter typed. Free text by nature; length-capped at the wire. */
  body: z.string().min(1),
  /** Optional way to reach them, when they choose to leave one. */
  contact: z.string().optional(),
  /** Page they were on when they sent it — the most useful context there is. */
  context: z.string().optional(),
  status: feedbackStatus,
  /** Operator's answer, attributed and timestamped. */
  reply: z.string().optional(),
  repliedBy: z.string().optional(),
  repliedAt: z.string().optional(),
  createdAt: z.string(),
})

const announcement = z.object({
  id: z.string().min(1),
  /** `null` = platform-wide. A string = that tenant only. */
  schoolId: z.string().nullable(),
  title: z.string().min(1),
  body: z.string().min(1),
  /** Written by whom, for the record the console shows. */
  authorKey: z.string().min(1),
  /** Retired notices stay in the table and stop being served to clients. */
  publishedAt: z.string().optional(),
  retiredAt: z.string().optional(),
  createdAt: z.string(),
})

/** The platform-wide, versioned internal-testing notice. */
const platformNotice = z.object({
  /** Stable singleton id; one row exists only after the first admin edit. */
  id: z.literal('platform-notice'),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(2000),
  /** Monotonic; every accepted save advances it by exactly one. */
  version: z.number().min(1),
  enabled: z.boolean(),
  updatedAt: z.string(),
  /** `schoolId:username` of the SUPER_ADMIN who saved the version. */
  updatedBy: z.string().min(1),
})

/** One account's acknowledgement of a platform-notice version. */
const platformNoticeAck = z.object({
  /** `schoolId:username`, resolved by the identity gate. */
  userKey: z.string().min(1),
  version: z.number().min(1),
  acknowledgedAt: z.string(),
})

/** One feedback row in `feedback` — author key resolved server-side, reply attributed to the operator. */
export type FeedbackRecord = z.infer<typeof feedback>
/** One announcement row in `announcements`; `schoolId: null` is platform-wide. */
export type AnnouncementRecord = z.infer<typeof announcement>
/** The singleton, versioned platform internal-testing notice. */
export type PlatformNoticeRecord = z.infer<typeof platformNotice>
/** One account's acknowledgement row. */
export type PlatformNoticeAckRecord = z.infer<typeof platformNoticeAck>

/** The `physicsos_notice` domain: the feedback queue plus tenant/platform announcements. */
export const noticeDomain = defineDomain({
  name: 'physicsos_notice',
  version: 0,
  tables: {
    feedback: domainTable<string, FeedbackRecord>(feedback),
    announcements: domainTable<string, AnnouncementRecord>(announcement),
    platform_notice: domainTable<string, PlatformNoticeRecord>(platformNotice),
    platform_notice_acks: domainTable<string, PlatformNoticeAckRecord>(platformNoticeAck),
  },
})

/**
 * Open the notice domain on the shared storage service.
 * @param ctx - context carrying the storageDomain service.
 * @returns the opened domain handle.
 */
export const openNoticeDomain = (
  ctx: { storageDomain: { open(spec: typeof noticeDomain): Promise<Domain<typeof noticeDomain>> } },
): Promise<Domain<typeof noticeDomain>> => ctx.storageDomain.open(noticeDomain)
