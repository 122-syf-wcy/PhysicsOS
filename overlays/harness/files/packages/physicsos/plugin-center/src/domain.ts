import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { PluginEnablementRecord } from './catalog.ts'

const enablement = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  updatedAt: z.string().min(1),
  updatedBy: z.string().min(1),
})

/** The only durable plugin-center state: administrator enable/disable choices. */
export const pluginCenterDomain = defineDomain({
  name: 'physicsos_plugin_center',
  version: 0,
  tables: {
    enablement: domainTable<string, PluginEnablementRecord>(enablement),
  },
})

export type PluginCenterDomain = Domain<typeof pluginCenterDomain>

export const openPluginCenterDomain = (
  ctx: { storageDomain: { open(spec: typeof pluginCenterDomain): Promise<PluginCenterDomain> } },
): Promise<PluginCenterDomain> => ctx.storageDomain.open(pluginCenterDomain)
