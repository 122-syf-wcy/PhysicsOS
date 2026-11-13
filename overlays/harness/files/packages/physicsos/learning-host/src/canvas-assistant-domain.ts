import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { usageTokenSchema } from './usage-domain.ts'
import type { CanvasAssistantBinding, CanvasAssistantModelRequest, CanvasAssistantResult } from './canvas-assistant-types.ts'
const id = z.string().min(1).max(200)
const job = z.strictObject({
  id, canvasId: id, requestHash: z.string().length(64), operationId: id,
  mode: z.enum(['check', 'draw']), status: z.enum(['queued', 'reading', 'thinking', 'validating', 'ready', 'error', 'cancelled']),
  binding: z.custom<CanvasAssistantBinding>(), request: z.custom<CanvasAssistantModelRequest>(),
  nodeIds: z.array(id), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  result: z.custom<CanvasAssistantResult>().optional(), error: z.string().max(1000).optional(),
  usage: usageTokenSchema.optional(), attempt: z.number().int().nonnegative().max(1), usageRecorded: z.boolean(),
})
const receipt = z.strictObject({ id, canvasId: id, requestHash: z.string().length(64) })
const account = z.strictObject({ schoolId: id, userKey: id, jobs: z.record(z.string(), job), cancellations: z.record(z.string(), z.string().length(64)), receipts: z.record(z.string(), receipt).default({}) })
export type CanvasAssistantStoredJob = z.infer<typeof job>
export type CanvasAssistantAccount = z.infer<typeof account>
/** Independent private account rows; no client can upload assistant or verification records. */
export const canvasAssistantDomain = defineDomain({ name: 'physicsos_canvas_assistant', version: 1, tables: { accounts: domainTable<string, CanvasAssistantAccount>(account) } })
export type CanvasAssistantDomain = Domain<typeof canvasAssistantDomain>
export const openCanvasAssistantDomain = (ctx: { storageDomain: { open(spec: typeof canvasAssistantDomain): Promise<CanvasAssistantDomain> } }): Promise<CanvasAssistantDomain> => ctx.storageDomain.open(canvasAssistantDomain)
