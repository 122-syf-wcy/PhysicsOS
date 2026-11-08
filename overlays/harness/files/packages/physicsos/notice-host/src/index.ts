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
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import z from '@deepseek-ai/schemastery'
import { openNoticeDomain } from './domain.ts'
import { NoticeService } from './service.ts'
import { noticeRoutes } from './routes.ts'
import { identityOf } from './identity.ts'
import { WebsiteService } from './website-service.ts'
import { validateTrustedProxies } from './website-proxy.ts'

export const name = 'notice-host'
export const inject = ['webServer', 'storageDomain']

export interface Config { trustedProxies?: string[] }
export const Config: z<Config> = z.object({ trustedProxies: z.array(z.string()).default([]) })

/**
 * Plugin entry: open the notice domain and serve `/physicsos/notice`.
 * @param ctx - plugin context carrying webServer/storageDomain.
 * @returns after the route is registered; the plugin fiber owns cleanup.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const trustedProxies = config.trustedProxies ?? []
  validateTrustedProxies(trustedProxies)
  await ctx.effect(async function* () {
    const domain = await openNoticeDomain(ctx)
    const service = new NoticeService(domain)
    const website = new WebsiteService(domain, () => ctx.get('attachments') as AttachmentStore | undefined)

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/notice',
      handler: noticeRoutes({
        service,
        /* Resolved per request: this host is declared before auth-host, so the
           service does not exist yet when this line runs. */
        identity: () => identityOf(ctx),
        website: {
          service: website,
          identity: () => identityOf(ctx),
          limiter: () => ctx.get('physicsosRateLimiter'),
          trustedProxies,
        },
      }),
    })
    yield () => domain.close()
  }, 'notice-host')
}
