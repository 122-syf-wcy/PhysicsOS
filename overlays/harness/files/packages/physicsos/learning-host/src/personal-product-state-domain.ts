/** Personal product lifecycle metadata. Never extend the legacy learning unit. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'

export const productResourceId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/)
export const productLifecycle = z.enum(['live', 'archived', 'deleted'])
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)))

const personalState = z.object({
  schemaVersion: z.literal(1),
  ownerKey: z.string().min(1).max(160),
  schoolId: z.string().min(1).max(64),
  resourceId: productResourceId,
  generation: counter,
  version: counter,
  state: productLifecycle,
  restoreState: z.enum(['live', 'archived']).optional(),
  updatedAt: timestamp,
  lastOperation: z.object({ id: productResourceId, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict()

export const productStateMutation = z.object({
  action: z.enum(['delete', 'restore', 'archive', 'unarchive', 'reopen']),
  expectedGeneration: counter,
  expectedVersion: counter,
  operationId: productResourceId,
}).strict()

export const sessionProjectAssignment = z.object({
  schemaVersion: z.literal(1), ownerKey: z.string().min(1).max(160), schoolId: z.string().min(1).max(64),
  sessionId: productResourceId, projectId: productResourceId.nullable(), version: counter, updatedAt: timestamp,
  lastOperation: z.object({ id: productResourceId, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict()
export const sessionProjectMutation = z.object({
  projectId: productResourceId.nullable(), expectedVersion: counter, operationId: productResourceId,
}).strict()
export type SessionProjectAssignmentRecord = z.infer<typeof sessionProjectAssignment>

export type ProductLifecycle = z.infer<typeof productLifecycle>
export type PersonalProductStateRecord = z.infer<typeof personalState>
export type ProductStateMutation = z.infer<typeof productStateMutation>

export const personalProductStateKey = (schoolId: string, ownerKey: string, id: string): string =>
  JSON.stringify([schoolId, ownerKey, id])

export const personalProductStateDomain = defineDomain({
  name: 'physicsos_personal_product_state_v1',
  version: 0,
  tables: {
    recent_scenes: domainTable<string, PersonalProductStateRecord>(personalState),
    projects: domainTable<string, PersonalProductStateRecord>(personalState),
    session_projects: domainTable<string, SessionProjectAssignmentRecord>(sessionProjectAssignment),
  },
})
export type PersonalProductStateDomain = Domain<typeof personalProductStateDomain>
export const openPersonalProductStateDomain = (ctx: {
  storageDomain: { open(spec: typeof personalProductStateDomain): Promise<PersonalProductStateDomain> }
}): Promise<PersonalProductStateDomain> => ctx.storageDomain.open(personalProductStateDomain)
