/**
 * @deepseek-ai/dsh-learning-host — account-scoped personal learning sync.
 *
 * Serves `/physicsos/learning` over a dedicated `physicsos_learning` unit.
 * Attempts and saved scenes are isolated by the server-resolved `userKey`;
 * anonymous aggregate reporting remains in auth-host and is not written here.
 *
 * @module @deepseek-ai/dsh-learning-host
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { openLearningDomain } from './domain.ts'
import { identityOf } from './identity.ts'
import { learningRoutes } from './routes.ts'
import { LearningService } from './service.ts'

export const name = 'learning-host'
export const inject = ['webServer', 'storageDomain']

export function apply(ctx: Context): () => Promise<void> {
  return ctx.effect(async function* () {
    const domain = await openLearningDomain(ctx)
    const service = new LearningService(domain)
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/learning',
      handler: learningRoutes({
        service,
        /* Loaded before auth-host, so this must resolve per request. */
        identity: () => identityOf(ctx),
      }),
    })
    yield () => domain.close()
  }, 'learning-host')
}
