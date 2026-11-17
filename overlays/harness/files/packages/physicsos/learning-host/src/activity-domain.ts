/** Independent bounded activity unit. Do not extend/upgrade physicsos_usage v0. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { ACTIVITY_DEDUP_RETENTION_DAYS, ACTIVITY_MODULES, ACTIVITY_SHARDS, ACTIVITY_SOURCES } from './activity-types.ts'

const at = z.iso.datetime({ offset: true })
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
})
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const owner = { schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160) }
export { activitySuccessCapsuleSchema as activityCapsuleWire } from './activity-contract.ts'
/** Id = original epoch millis + UUID. A retry cannot silently acquire today's date. */
export const activityClientIdWire = z.string().regex(/^\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
export const activityClientWire = z.strictObject({
  kind: z.enum(['visit', 'open']), id: activityClientIdWire, pageInstanceId: activityClientIdWire, module: z.enum(ACTIVITY_MODULES),
}).refine(row => row.kind === 'visit' ? row.id === row.pageInstanceId && row.module === 'app' : row.module !== 'app')
const moduleCounts = z.strictObject({ module: z.enum(ACTIVITY_MODULES), visits: count, opens: count, uses: count, lastUseAt: at.optional() })
export const activityBucketWire = z.strictObject({
  ...owner, day, shard: z.number().int().min(0).max(ACTIVITY_SHARDS - 1),
  visits: count, opens: count, uses: count, modules: z.array(moduleCounts).max(ACTIVITY_MODULES.length),
  /** Open bucket increments and this hash map MUST be replaced by the same KvTable.update. */
  dedup: z.record(digest, digest).refine(value => Object.keys(value).length <= 256),
  /** A terminal count-only bucket: the entire Shanghai date has passed the replay window. */
  sealedAt: at.optional(),
}).refine(row => new Set(row.modules.map(value => value.module)).size === row.modules.length
  && row.visits + row.opens + row.uses <= 256
  && (row.sealedAt === undefined
    ? row.visits + row.opens + row.uses === Object.keys(row.dedup).length
    : Object.keys(row.dedup).length === 0 && Date.parse(row.sealedAt) >= Date.parse(`${row.day}T00:00:00+08:00`) + ACTIVITY_DEDUP_RETENTION_DAYS * 86_400_000)
  && row.modules.reduce((n, value) => n + value.visits, 0) === row.visits
  && row.modules.reduce((n, value) => n + value.opens, 0) === row.opens
  && row.modules.reduce((n, value) => n + value.uses, 0) === row.uses
  && row.modules.every(value => value.visits === 0 || value.module === 'app'))
export const activityReceiptWire = z.strictObject({
  ...owner, source: z.enum(ACTIVITY_SOURCES), operationHash: digest, requestHash: digest,
  occurredAt: at, state: z.enum(['pending', 'applied', 'expired']),
  /** Terminal audit/checkpoint after the original-day integrity warning is durable. */
  expiredAt: at.optional(),
})
const warning = z.strictObject({
  code: z.string().regex(/^ACTIVITY_[A-Z_]+$/).max(80), schoolId: owner.schoolId.optional(),
  fromDay: day, toDay: day, occurrences: count,
})
const state = z.strictObject({
  version: z.literal(1), collectionStartedAt: at, warnings: z.array(warning).max(32),
  sourceCheckpoints: z.array(z.strictObject({ source: z.enum(ACTIVITY_SOURCES), throughAt: at })).max(ACTIVITY_SOURCES.length),
  /** Monotonic original-time rejection floor, durably advanced BEFORE clearing any dedup/journal. */
  replayFloorAt: at.optional(),
})
export type ActivityBucketRecord = z.infer<typeof activityBucketWire>
export type ActivityReceiptRecord = z.infer<typeof activityReceiptWire>
export type ActivityStateRecord = z.infer<typeof state>
export type ActivityWarningRecord = z.infer<typeof warning>
export const activityDomain = defineDomain({
  name: 'physicsos_activity_v1', version: 0, layout: 'per-record',
  tables: {
    buckets: domainTable<string, ActivityBucketRecord>(activityBucketWire),
    receipts: domainTable<string, ActivityReceiptRecord>(activityReceiptWire),
    state: domainTable<string, ActivityStateRecord>(state),
  },
})
export type ActivityDomain = Domain<typeof activityDomain>
/** Facility loadAll still loads this entire finite unit; see activity-v1.md's cold-start release gate. */
export const openActivityDomain = (ctx: { storageDomain: { open(spec: typeof activityDomain): Promise<ActivityDomain> } }): Promise<ActivityDomain> => ctx.storageDomain.open(activityDomain)
