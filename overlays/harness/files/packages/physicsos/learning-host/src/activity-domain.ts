/** Independent bounded activity unit. Do not extend/upgrade physicsos_usage v0. */
import { types } from 'node:util'
import { z } from 'zod'
import { defineDomain, domainTable, type Domain, type DomainValueSchema } from '@deepseek-ai/dsh-storage-domain'
import { ACTIVITY_DEDUP_RETENTION_DAYS, ACTIVITY_MODULES, ACTIVITY_SHARDS, ACTIVITY_SOURCES } from './activity-types.ts'

const at = z.iso.datetime({ offset: true })
const timestampPattern = z.regexes.datetime({ offset: true })
const digestPattern = /^[a-f0-9]{64}$/
const digest = z.string().regex(digestPattern)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
})
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const owner = { schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160) }
const hashPairs = z.record(digest, digest).refine(value => Object.keys(value).length <= 256)
export { activitySuccessCapsuleSchema as activityCapsuleWire } from './activity-contract.ts'
/** Id = original epoch millis + UUID. A retry cannot silently acquire today's date. */
export const activityClientIdWire = z.string().regex(/^\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
export const activityClientWire = z.strictObject({
  kind: z.enum(['visit', 'open']), id: activityClientIdWire, pageInstanceId: activityClientIdWire, module: z.enum(ACTIVITY_MODULES),
}).refine(row => row.kind === 'visit' ? row.id === row.pageInstanceId && row.module === 'app' : row.module !== 'app')
const moduleCounts = z.strictObject({ module: z.enum(ACTIVITY_MODULES), visits: count, opens: count, uses: count, lastUseAt: at.optional() })
const bucketShape = z.strictObject({
  ...owner, day, shard: z.number().int().min(0).max(ACTIVITY_SHARDS - 1),
  visits: count, opens: count, uses: count, modules: z.array(moduleCounts).max(ACTIVITY_MODULES.length),
  /** Open bucket increments and this hash map MUST be replaced by the same KvTable.update. */
  dedup: hashPairs,
  /** A terminal count-only bucket: the entire Shanghai date has passed the replay window. */
  sealedAt: at.optional(),
})
export const activityBucketWire = bucketShape.refine(bucketTotalsAgree)
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
export type ActivityBucketRecord = z.infer<typeof bucketShape>
export type ActivityReceiptRecord = z.infer<typeof activityReceiptWire>
export type ActivityStateRecord = z.infer<typeof state>
export type ActivityWarningRecord = z.infer<typeof warning>

function bucketTotalsAgree(row: ActivityBucketRecord): boolean {
  const total = row.visits + row.opens + row.uses
  if (total > 256) return false
  const proofs = Object.keys(row.dedup).length
  if (row.sealedAt === undefined ? total !== proofs : proofs !== 0 || !(Date.parse(row.sealedAt) >= Date.parse(`${row.day}T00:00:00+08:00`) + ACTIVITY_DEDUP_RETENTION_DAYS * 86_400_000)) return false
  const seen = new Set<string>()
  let visits = 0, opens = 0, uses = 0
  for (const module of row.modules) {
    if (seen.has(module.module) || (module.visits !== 0 && module.module !== 'app')) return false
    seen.add(module.module)
    visits += module.visits; opens += module.opens; uses += module.uses
  }
  return visits === row.visits && opens === row.opens && uses === row.uses
}

/** The hot import path handles plain JSON data only. Other inputs retain the wire parser and its errors. */
const bucketFields = new Set(Object.keys(activityBucketWire.shape))
const moduleFields = new Set(Object.keys(moduleCounts.shape))
const receiptFields = new Set(Object.keys(activityReceiptWire.shape))
const moduleNames = new Set<string>(ACTIVITY_MODULES)
const sourceNames = new Set<string>(ACTIVITY_SOURCES)
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length >= 1 && value.length <= max
const nonnegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const hashToken = (value: unknown): value is string => typeof value === 'string' && digestPattern.test(value)
// `z.iso.datetime` uses this same pattern; avoid a parse envelope for every reading.
const timestamp = (value: unknown): value is string => typeof value === 'string' && timestampPattern.test(value)
const dataField = (descriptor: PropertyDescriptor | undefined): descriptor is PropertyDescriptor & { value: unknown } => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
function plainData(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function fields(value: unknown, names: ReadonlySet<string>, optional: string): Record<string, unknown> | undefined {
  if (!plainData(value)) return undefined
  const keys = Reflect.ownKeys(value)
  if (keys.length !== names.size - Number(!Object.hasOwn(value, optional))) return undefined
  for (const key of keys) if (typeof key !== 'string' || !names.has(key) || !dataField(Object.getOwnPropertyDescriptor(value, key))) return undefined
  return value
}
function copyHashPairs(value: unknown): Record<string, string> | undefined {
  if (!plainData(value)) return undefined
  const keys = Reflect.ownKeys(value)
  if (keys.length > 256) return undefined
  const pairs: Record<string, string> = {}
  for (const key of keys) {
    if (!hashToken(key)) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!dataField(descriptor) || !hashToken(descriptor.value)) return undefined
    pairs[key] = descriptor.value
  }
  return pairs
}
function copyModules(value: unknown): ActivityBucketRecord['modules'] | undefined {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > ACTIVITY_MODULES.length || Reflect.ownKeys(value).length !== value.length + 1) return undefined
  const modules: ActivityBucketRecord['modules'] = []
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i)
    const row = dataField(descriptor) ? fields(descriptor.value, moduleFields, 'lastUseAt') : undefined
    if (!row) return undefined
    const { module, visits, opens, uses } = row
    const hasLastUse = Object.hasOwn(row, 'lastUseAt')
    const lastUseAt = hasLastUse ? row.lastUseAt : undefined
    if (typeof module !== 'string' || !moduleNames.has(module) || !nonnegativeInteger(visits) || !nonnegativeInteger(opens) || !nonnegativeInteger(uses) || (hasLastUse && !timestamp(lastUseAt))) return undefined
    modules.push({ module: module as ActivityBucketRecord['modules'][number]['module'], visits, opens, uses, ...(typeof lastUseAt === 'string' ? { lastUseAt } : {}) })
  }
  return modules
}
function readBucket(value: unknown): ActivityBucketRecord | undefined {
  const row = fields(value, bucketFields, 'sealedAt')
  if (!row) return undefined
  const { schoolId, userKey, day: date, shard, visits, opens, uses } = row
  const hasSeal = Object.hasOwn(row, 'sealedAt')
  const sealedAt = hasSeal ? row.sealedAt : undefined
  if (!boundedText(schoolId, 64) || !boundedText(userKey, 160) || typeof date !== 'string' || !day.safeParse(date).success || !nonnegativeInteger(shard) || shard >= ACTIVITY_SHARDS || !nonnegativeInteger(visits) || !nonnegativeInteger(opens) || !nonnegativeInteger(uses) || (hasSeal && !timestamp(sealedAt))) return undefined
  const dedup = copyHashPairs(row.dedup), modules = copyModules(row.modules)
  if (!dedup || !modules) return undefined
  const result: ActivityBucketRecord = { schoolId, userKey, day: date, shard, visits, opens, uses, modules, dedup, ...(typeof sealedAt === 'string' ? { sealedAt } : {}) }
  return bucketTotalsAgree(result) ? result : undefined
}
function readReceipt(value: unknown): ActivityReceiptRecord | undefined {
  const row = fields(value, receiptFields, 'expiredAt')
  if (!row) return undefined
  const { schoolId, userKey, source, operationHash, requestHash, occurredAt, state } = row
  const hasExpiry = Object.hasOwn(row, 'expiredAt')
  const expiredAt = hasExpiry ? row.expiredAt : undefined
  if (!boundedText(schoolId, 64) || !boundedText(userKey, 160) || typeof source !== 'string' || !sourceNames.has(source) || !hashToken(operationHash) || !hashToken(requestHash) || !timestamp(occurredAt) || (state !== 'pending' && state !== 'applied' && state !== 'expired') || (hasExpiry && !timestamp(expiredAt))) return undefined
  return { schoolId, userKey, source: source as ActivityReceiptRecord['source'], operationHash, requestHash, occurredAt, state, ...(typeof expiredAt === 'string' ? { expiredAt } : {}) }
}
function importSchema<T>(wire: z.ZodType<T>, readPlain: (value: unknown) => T | undefined): DomainValueSchema<T> {
  return { parse: value => readPlain(value) ?? wire.parse(value), safeParse: value => wire.safeParse(value) }
}
export const activityDomain = defineDomain({
  name: 'physicsos_activity_v1', version: 0, layout: 'per-record',
  tables: {
    buckets: domainTable<string, ActivityBucketRecord>(importSchema(activityBucketWire, readBucket)),
    receipts: domainTable<string, ActivityReceiptRecord>(importSchema(activityReceiptWire, readReceipt)),
    state: domainTable<string, ActivityStateRecord>(state),
  },
})
export type ActivityDomain = Domain<typeof activityDomain>
/** Facility loadAll still loads this entire finite unit; see activity-v1.md's cold-start release gate. */
export const openActivityDomain = (ctx: { storageDomain: { open(spec: typeof activityDomain): Promise<ActivityDomain> } }): Promise<ActivityDomain> => ctx.storageDomain.open(activityDomain)
