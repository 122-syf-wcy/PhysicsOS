import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { parseSourceImage, type JsonObject, type SourceImage } from '@physicsos/physics-whiteboard'
import { usageTokenSchema } from './usage-domain.ts'
const id = z.string().min(1).max(160)
const reference = z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() })
const head = z.strictObject({ id, title: z.string().min(1).max(200), revision: z.number().int().positive(), updatedAt: z.string().datetime(), document: reference })
const image = z.strictObject({ boardId: id, source: z.unknown().transform(value => parseSourceImage(value)), attachment: z.record(z.string(), z.unknown()) })
const job = z.strictObject({ id, boardId: id, imageId: id, status: z.enum(['queued', 'reading', 'drawing', 'validating', 'ready', 'error', 'cancelled']), request: reference, output: reference.optional(), result: reference.optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), error: z.string().optional(), usage: usageTokenSchema.optional(), usageRecorded: z.boolean(), attempt: z.number().int().nonnegative(), provider: id, model: id })
const receipt = z.strictObject({ hash: z.string().length(64), boardId: id, kind: z.enum(['create', 'save', 'upload', 'generate', 'cancel']), head: head.optional(), imageId: id.optional(), jobId: id.optional() })
const allocation = z.strictObject({ boardId: id, digest: z.string().length(64), bytes: z.number().int().positive(), ready: z.boolean().optional() })
const account = z.strictObject({ schoolId: id, userKey: id, boards: z.record(z.string(), head), images: z.record(z.string(), image), jobs: z.record(z.string(), job), receipts: z.record(z.string(), receipt), allocations: z.record(z.string(), allocation) })
export type WhiteboardHead = z.infer<typeof head>
export type WhiteboardJob = z.infer<typeof job>
export type WhiteboardAccount = z.infer<typeof account>
export type WhiteboardBlobRef = z.infer<typeof reference>
export type WhiteboardStoredImage = { boardId: string; source: SourceImage; attachment: JsonObject }
/** One atomic account row keeps CAS heads, receipts and job status consistent across restarts. */
export const whiteboardDomain = defineDomain({ name: 'physicsos_whiteboard', version: 1, tables: { accounts: domainTable<string, WhiteboardAccount>(account) } })
export type WhiteboardDomain = Domain<typeof whiteboardDomain>
export const openWhiteboardDomain = (ctx: { storageDomain: { open(spec: typeof whiteboardDomain): Promise<WhiteboardDomain> } }): Promise<WhiteboardDomain> => ctx.storageDomain.open(whiteboardDomain)
