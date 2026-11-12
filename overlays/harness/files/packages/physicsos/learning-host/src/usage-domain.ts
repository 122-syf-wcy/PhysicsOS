/** Independent persistence unit for exact server-owned visits and model settlement counters. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { USAGE_ACTIONS, USAGE_SURFACES } from './usage-types.ts'

const id = z.string().min(1).max(200)
const owner = { schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160) }
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const at = z.iso.datetime({ offset: true })
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const usageEventWire = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/),
  kind: z.enum(['visit', 'use']),
  surface: z.enum(USAGE_SURFACES),
  action: z.enum(USAGE_ACTIONS).optional(),
})
const event = usageEventWire.extend({ ...owner, at, date, requestHash: z.string().length(64) })
export const usageTokenSchema = z.strictObject({
  inputTokens: count,
  outputTokens: count,
  totalTokens: count.optional(),
  cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(),
  reasoningTokens: count.optional(),
})
const receipt = z
  .strictObject({
    id,
    source: z.enum(['session', 'moderation', 'paper', 'image', 'diagram']),
    scope: z.enum(['account', 'system']),
    schoolId: owner.schoolId.optional(),
    userKey: owner.userKey.optional(),
    provider: id,
    model: id,
    at,
    date,
    requestHash: z.string().length(64),
    revision: count,
    usage: usageTokenSchema.optional(),
    sessionId: id.optional(),
    turn: count.optional(),
    step: count.optional(),
    attempt: count.optional(),
  })
  .refine(row =>
    row.scope === 'system'
      ? row.schoolId === undefined && row.userKey === undefined
      : row.schoolId !== undefined && row.userKey !== undefined,
  )
const session = z.strictObject({
  sessionId: id,
  ...owner,
  cursor: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  inheritedEventCount: count,
  provider: id.optional(),
  model: id.optional(),
  turn: count.optional(),
  step: count.optional(),
  attempt: count,
  lastReceiptId: id.optional(),
  unavailable: z.boolean().optional(),
  updatedAt: at,
})
const child = z.strictObject({ sessionId: id, parentSessionId: id, ...owner, createdAt: at })
export type UsageEventRecord = z.infer<typeof event>
export type UsageReceiptRecord = z.infer<typeof receipt>
export type UsageSessionRecord = z.infer<typeof session>
export type UsageChildRecord = z.infer<typeof child>
export const usageDomain = defineDomain({
  name: 'physicsos_usage',
  version: 0,
  tables: {
    events: domainTable<string, UsageEventRecord>(event),
    receipts: domainTable<string, UsageReceiptRecord>(receipt),
    sessions: domainTable<string, UsageSessionRecord>(session),
    children: domainTable<string, UsageChildRecord>(child),
  },
})
export type UsageDomain = Domain<typeof usageDomain>
/** Open the independent durable unit. @param ctx - Existing storage facility. @returns Open usage domain. */
export const openUsageDomain = (ctx: { storageDomain: { open(spec: typeof usageDomain): Promise<UsageDomain> } }): Promise<UsageDomain> =>
  ctx.storageDomain.open(usageDomain)
