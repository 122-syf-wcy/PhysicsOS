/** Independent generation storage. Existing physicsos_model_pool records never enter this domain. */
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import {
  generationAuditRecordSchema, generationChannelRecordSchema, generationKeyRecordSchema,
  generationSettingsRecordSchema,
} from './generation-schemas.ts'
import type {
  GenerationAuditRecord, GenerationChannelRecord, GenerationKeyRecord, GenerationSettingsRecord,
} from './generation-types.ts'

export const generationChannelsDomain = defineDomain({
  name: 'physicsos_generation_channels',
  version: 0,
  tables: {
    channels: domainTable<string, GenerationChannelRecord>(generationChannelRecordSchema),
    keys: domainTable<string, GenerationKeyRecord>(generationKeyRecordSchema),
    settings: domainTable<string, GenerationSettingsRecord>(generationSettingsRecordSchema),
    audit: domainTable<string, GenerationAuditRecord>(generationAuditRecordSchema),
  },
})

export const openGenerationChannelsDomain = (
  ctx: { storageDomain: { open(spec: typeof generationChannelsDomain): Promise<Domain<typeof generationChannelsDomain>> } },
): Promise<Domain<typeof generationChannelsDomain>> => ctx.storageDomain.open(generationChannelsDomain)
