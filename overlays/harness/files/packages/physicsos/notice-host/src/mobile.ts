/** Mobile notice reads and server-only account hooks over the one live NoticeService. */
import type { IdentityActor } from './identity.ts'
import type { NoticeService, NoticeErasureRequest } from './service.ts'

export const MOBILE_NOTICE_SERVICE = 'physicsosMobileNotice'
export const MOBILE_PUSH_SERVICE = 'physicsosMobilePush'
export type { NoticeErasureRequest } from './service.ts'
export type { PushTermRecord } from './domain.ts'

/** No feedback, erasure principal or account identity is accepted from a mobile request body. */
export function createMobileNotice(service: NoticeService) {
  return {
    platformNotice: (actor: IdentityActor) => service.getPlatformNotice(actor),
    acknowledgePlatformNotice: (actor: IdentityActor, body: unknown) => service.acknowledgePlatformNotice(actor, body),
    listAnnouncements(actor: IdentityActor) {
      return service.listAnnouncements(actor).map(row => ({
        id: row.id, title: row.title, body: row.body, publishedAt: row.publishedAt ?? row.createdAt,
      }))
    },
    exportAccount: (actor: IdentityActor) => service.exportAccount(actor),
    eraseAccount: (request: NoticeErasureRequest) => service.eraseAccount(request),
  }
}
export type MobileNoticeFacade = ReturnType<typeof createMobileNotice>

/** Register refuses until a real provider exists; legacy revocation shares the account erasure queue. */
export function createMobilePush(service: NoticeService) {
  return {
    register: (actor: IdentityActor, body: unknown) => service.registerPush(actor, body),
    revoke: (actor: IdentityActor, id: string) => service.revokePush(actor, id),
  }
}
export type MobilePushFacade = ReturnType<typeof createMobilePush>
