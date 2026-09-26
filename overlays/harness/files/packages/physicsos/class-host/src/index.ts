/**
 * @deepseek-ai/dsh-class-host — PhysicsOS class and teaching workflow.
 *
 * Owns one `physicsos_class` storage unit and one `/physicsos/class` route
 * prefix: class creation, userKey membership, paper/experiment assignments,
 * student submissions and receipts, teacher review, and completion figures.
 *
 * Identity is resolved per request because this plugin is deliberately safe to
 * load before auth-host publishes `physicsosIdentity`.
 *
 * @module @deepseek-ai/dsh-class-host
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { openClassDomain } from './domain.ts'
import { ClassService } from './service.ts'
import { classRoutes } from './routes.ts'
import { identityOf } from './identity.ts'

export const name = 'class-host'
export const inject = ['webServer', 'storageDomain']

/**
 * Open the class domain and serve `/physicsos/class`.
 * @param ctx - plugin context carrying webServer/storageDomain.
 * @returns the effect disposer.
 */
export function apply(ctx: Context): () => Promise<void> {
  return ctx.effect(async function* () {
    const domain = await openClassDomain(ctx)
    const service = new ClassService(domain)

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/class',
      handler: classRoutes({
        service,
        identity: () => identityOf(ctx),
      }),
    })
    yield () => domain.close()
  }, 'class-host')
}
