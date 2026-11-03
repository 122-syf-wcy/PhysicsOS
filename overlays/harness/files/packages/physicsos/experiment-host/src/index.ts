/** PhysicsOS immutable browser-static experiment contributions. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { openExperimentDomain } from './domain.ts'
import { ExperimentService } from './service.ts'
import { experimentAssets, experimentRoutes } from './routes.ts'
import { identityOf } from './identity.ts'
export { ExperimentService } from './service.ts'
export type { PackageView, ExperimentOptions } from './service.ts'
export { experimentRoutes, experimentAssets } from './routes.ts'
export { experimentDomain, openExperimentDomain } from './domain.ts'

export const name = 'experiment-host'
export const inject = ['webServer', 'storageDomain']
export interface Config { packagesRoot?: string; assetOrigin?: string }
export const Config: z<Config> = z.object({ packagesRoot: z.string(), assetOrigin: z.string() })
export async function apply(ctx: Context, config: Config = {}): Promise<() => Promise<void>> {
  return ctx.effect(async function* () {
    const domain = await openExperimentDomain(ctx)
    const service = new ExperimentService(domain, { root: config.packagesRoot ?? dshHomePath('experiment-packages'), ...(config.assetOrigin === undefined ? {} : { assetOrigin: config.assetOrigin }) })
    yield () => domain.close()
    yield () => service.close()
    await service.initialize()
    yield ctx.webServer.register({ kind: 'prefix', path: '/physicsos/experiments', handler: experimentRoutes({ service, identity: () => identityOf(ctx) }) })
    yield ctx.webServer.register({ kind: 'prefix', path: '/physicsos/experiment-assets', handler: experimentAssets({ service }) })
  }, 'experiment-host')
}
