import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { parseSourceImage, type JsonObject, type SourceImage } from '@physicsos/physics-whiteboard'
import { usageTokenSchema } from './usage-domain.ts'
import { activitySuccessCapsuleSchema } from './activity-contract.ts'
const id = z.string().min(1).max(160)
const integer = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const date = z.string().datetime()
const reference = z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: integer })
/** Optional additive fields keep legacy v1 rows byte-shape compatible until a lifecycle write. */
const head = z.strictObject({ id, title: z.string().min(1).max(200), revision: integer, updatedAt: date, document: reference,
  generation: integer.optional(), archivedAt: date.optional(), deletedAt: date.optional() })
const image = z.strictObject({ boardId: id, source: z.unknown().transform(value => parseSourceImage(value)), attachment: z.record(z.string(), z.unknown()) })
const job = z.strictObject({ id, boardId: id, imageId: id, status: z.enum(['queued', 'reading', 'drawing', 'validating', 'ready', 'error', 'cancelled']), request: reference, output: reference.optional(), result: reference.optional(),
  generation: integer.optional(), createdAt: date, updatedAt: date, error: z.string().optional(), usage: usageTokenSchema.optional(), usageRecorded: z.boolean(), attempt: z.number().int().nonnegative(), provider: id, model: id })
const receipt = z.strictObject({ hash: z.string().length(64), boardId: id, kind: z.enum(['create', 'save', 'upload', 'generate', 'cancel', 'archive', 'unarchive', 'delete', 'restore', 'copy']), head: head.optional(), imageId: id.optional(), jobId: id.optional(),
  activitySuccess: activitySuccessCapsuleSchema.optional() })
const allocation = z.strictObject({ boardId: id, digest: z.string().length(64), bytes: integer, ready: z.boolean().optional() })
const account = z.strictObject({ schoolId: id, userKey: id, boards: z.record(z.string(), head), images: z.record(z.string(), image), jobs: z.record(z.string(), job), receipts: z.record(z.string(), receipt), allocations: z.record(z.string(), allocation) })
export type WhiteboardHead = z.infer<typeof head>
export type WhiteboardJob = z.infer<typeof job>
export type WhiteboardAccount = z.infer<typeof account>
export type WhiteboardBlobRef = z.infer<typeof reference>
export type WhiteboardStoredImage = { boardId: string; source: SourceImage; attachment: JsonObject }
/** One atomic account row keeps CAS heads, receipts and job status consistent across restarts. Unit version intentionally stays 1. */
export const whiteboardDomain = defineDomain({ name: 'physicsos_whiteboard', version: 1, tables: { accounts: domainTable<string, WhiteboardAccount>(account) } })
export type WhiteboardDomain = Domain<typeof whiteboardDomain>
export const openWhiteboardDomain = (ctx: { storageDomain: { open(spec: typeof whiteboardDomain): Promise<WhiteboardDomain> } }): Promise<WhiteboardDomain> => ctx.storageDomain.open(whiteboardDomain)
