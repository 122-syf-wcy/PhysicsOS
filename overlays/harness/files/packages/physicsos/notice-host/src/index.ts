/**
 * @deepseek-ai/dsh-notice-host — the 反馈与公告 host plugin.
 *
 * Two surfaces over one prefix:
 *
 *   - `/physicsos/notice/feedback` — students and teachers report bugs,
 *     content problems and ideas; teachers and above answer them. Reading is
 *     row-filtered, not door-filtered: a student calling the list gets their
 *     OWN submissions back, because their app shows exactly that.
 *   - `/physicsos/notice/announcements` — admins publish to their tenant (or,
 *     for a super admin, to the platform); every signed-in account reads the
 *     ones that apply to them.
 *
 * The identity gate is the same contract the paper host uses, resolved lazily
 * per request because this host loads BEFORE auth-host declares the service.
 *
 * @module @deepseek-ai/dsh-notice-host
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { openNoticeDomain } from './domain.ts'
import { NoticeService } from './service.ts'
import { noticeRoutes } from './routes.ts'
import { identityOf } from './identity.ts'

export const name = 'notice-host'
export const inject = ['webServer', 'storageDomain']

/**
 * Plugin entry: open the notice domain and serve `/physicsos/notice`.
 * @param ctx - plugin context carrying webServer/storageDomain.
 * @returns the effect disposer (route unregisters, domain closes).
 */
export function apply(ctx: Context): () => Promise<void> {
  return ctx.effect(async function* () {
    const domain = await openNoticeDomain(ctx)
    const service = new NoticeService(domain)

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/notice',
      handler: noticeRoutes({
        service,
        /* Resolved per request: this host is declared before auth-host, so the
           service does not exist yet when this line runs. */
        identity: () => identityOf(ctx),
      }),
    })
    yield () => domain.close()
  }, 'notice-host')
}
