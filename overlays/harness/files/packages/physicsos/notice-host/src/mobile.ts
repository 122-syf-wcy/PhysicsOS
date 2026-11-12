/**
 * Student-facing notice facade plus the Android push-term table.
 *
 * The notice host already owns the platform notice and tenant announcements;
 * the app reads exactly those two surfaces and nothing about the feedback
 * queue or the website content. Push terms live here, next to the notices they
 * deliver, and store only an opaque provider token the server cannot reverse
 * into an account on its own.
 *
 * @module @deepseek-ai/dsh-notice-host/mobile
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { IdentityActor } from './identity.ts'
import type { NoticeService } from './service.ts'

/** Cordis service name consumed by `@deepseek-ai/dsh-mobile-host`. */
export const MOBILE_NOTICE_SERVICE = 'physicsosMobileNotice'
/** Cordis service name for the push-term table. */
export const MOBILE_PUSH_SERVICE = 'physicsosMobilePush'

/** The app shows `id/title/body/publishedAt`; platform notices carry a version. */
const announcementView = (row: {
  id: string
  title: string
  body: string
  publishedAt?: string | undefined
  createdAt: string
}) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  publishedAt: row.publishedAt ?? row.createdAt,
})

const pushWire = z.object({
  token: z.string().trim().min(16).max(4096),
  deviceName: z.string().trim().min(1).max(80).optional(),
  appVersion: z.string().trim().min(1).max(32).optional(),
}).strict()

/**
 * One registered terminal, exactly as persisted.
 *
 * Under `exactOptionalPropertyTypes` an absent optional field and a field set
 * to `undefined` are different types, and the storage domain produces the
 * latter; declaring them here keeps the table and the facade identical.
 */
export interface PushTerm {
  readonly id: string
  readonly userKey: string
  readonly schoolId: string
  readonly platform: 'android'
  readonly tokenHash: string
  readonly deviceName?: string | undefined
  readonly appVersion?: string | undefined
  readonly registeredAt: string
  readonly revokedAt?: string | undefined
}

/** Minimal table face this module needs; the domain provides the real one. */
export interface PushTable<T extends PushTerm = PushTerm> {
  entries(): Iterable<[string, T]>
  get(id: string): T | undefined
  put(id: string, row: T): Promise<void>
}

/** Hash a provider token so the database never holds a usable credential. */
const hashToken = async (token: string): Promise<string> => {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Build the student notice facade.
 * @param service - the live NoticeService.
 * @returns platform notice, acknowledgement and announcements for the app.
 */
export function createMobileNotice(service: NoticeService) {
  return {
    platformNotice(actor: IdentityActor) {
      const current = service.getPlatformNotice(actor)
      return { notice: current.notice, acknowledgedVersion: current.acknowledgedVersion }
    },
    acknowledgePlatformNotice(actor: IdentityActor, body: unknown) {
      return service.acknowledgePlatformNotice(actor, body)
    },
    listAnnouncements(actor: IdentityActor) {
      // The service already filters tenant + platform rows and retirements.
      return [...service.listAnnouncements(actor)].map(announcementView)
    },
  }
}
export type MobileNoticeFacade = ReturnType<typeof createMobileNotice>

/**
 * Build the push-term facade over the notice domain's own table.
 * @param table - the domain-backed push table.
 * @returns register/revoke scoped to the calling account.
 */
export function createMobilePush(table: PushTable) {
  return {
    async register(actor: IdentityActor, body: unknown) {
      const input = pushWire.safeParse(body)
      if (!input.success) throw Object.assign(new Error('推送终端信息无效'), { status: 400, code: 'BAD_REQUEST' })
      const tokenHash = await hashToken(input.data.token)
      const existing = [...table.entries()]
        .map(([, row]) => row)
        .find(row => row.tokenHash === tokenHash && row.userKey === actor.userKey && row.revokedAt === undefined)
      if (existing !== undefined) {
        return { id: existing.id, platform: 'android' as const, registeredAt: existing.registeredAt }
      }
      const row: PushTerm = {
        id: `push_${randomUUID()}`,
        userKey: actor.userKey,
        schoolId: actor.schoolId,
        platform: 'android',
        tokenHash,
        ...(input.data.deviceName === undefined ? {} : { deviceName: input.data.deviceName }),
        ...(input.data.appVersion === undefined ? {} : { appVersion: input.data.appVersion }),
        registeredAt: new Date().toISOString(),
      }
      await table.put(row.id, row)
      return { id: row.id, platform: 'android' as const, registeredAt: row.registeredAt }
    },
    async revoke(actor: IdentityActor, id: string): Promise<void> {
      const row = table.get(id)
      // A foreign id is indistinguishable from absence.
      if (row === undefined || row.userKey !== actor.userKey) {
        throw Object.assign(new Error('推送终端不存在'), { status: 404, code: 'NOT_FOUND' })
      }
      if (row.revokedAt !== undefined) return
      await table.put(id, { ...row, revokedAt: new Date().toISOString() })
    },
  }
}
export type MobilePushFacade = ReturnType<typeof createMobilePush>
