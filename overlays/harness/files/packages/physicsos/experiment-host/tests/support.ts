import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { join } from 'node:path'
import { openExperimentDomain } from '../src/domain.ts'
import { ExperimentService } from '../src/service.ts'
export async function host(
  root: string,
  options: { assetOrigin?: string; previewTtlMs?: number } = {},
) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: join(root, 'domain') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  const domain = await openExperimentDomain(ctx)
  const service = new ExperimentService(domain, { root: join(root, 'files'), ...options })
  await service.initialize()
  return {
    ctx,
    domain,
    service,
    close: async () => {
      await domain.close()
      await ctx.fiber.dispose()
    },
  }
}
