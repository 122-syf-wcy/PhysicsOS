/** Independent bounded per-record unit. Never modifies usage, saved_scenes or attempts. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { activitySuccessCapsuleSchema } from './activity-contract.ts'

export const experimentRunIdSchema = z.uuid()
export const experimentRunExperimentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const at = z.iso.datetime()
const base = {
  schemaVersion: z.literal(1), runId: experimentRunIdSchema,
  experimentId: experimentRunExperimentIdSchema,
  owner: z.strictObject({ schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160) }),
  capabilityGeneration: z.uuid(), preparedAt: at, expiresAt: at,
  prepareHash: hash, permitHash: hash,
}
export const experimentRunRowSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...base, state: z.literal('prepared') }),
  z.strictObject({ ...base, state: z.literal('recorded'), recordedAt: at, stableHash: hash,
    provenance: z.literal('client-observed'), boundary: z.literal('platform-engine-first-step'), scope: z.literal('lab-workspace'),
    activitySuccess: activitySuccessCapsuleSchema }),
]).superRefine((row, ctx) => {
  if (Date.parse(row.expiresAt) <= Date.parse(row.preparedAt)) ctx.addIssue({ code: 'custom', message: 'Run permit lifetime is invalid' })
  if (row.state === 'recorded' && (Date.parse(row.recordedAt) < Date.parse(row.preparedAt) || Date.parse(row.recordedAt) >= Date.parse(row.expiresAt) ||
    row.activitySuccess.source !== 'experiment-run' || row.activitySuccess.operationId !== row.runId || row.activitySuccess.occurredAt !== row.recordedAt ||
    row.activitySuccess.owner.schoolId !== row.owner.schoolId || row.activitySuccess.owner.userKey !== row.owner.userKey)) {
    ctx.addIssue({ code: 'custom', message: 'Run fact and activity capsule must describe the same original success' })
  }
})
export type ExperimentRunRow = z.infer<typeof experimentRunRowSchema>
export type ExperimentRunRecordedRow = Extract<ExperimentRunRow, { state: 'recorded' }>
export const experimentRunDomain = defineDomain({
  name: 'physicsos_experiment_run_v1', version: 0, layout: 'per-record',
  tables: { runs: domainTable<string, ExperimentRunRow>(experimentRunRowSchema) },
})
export type ExperimentRunDomain = Domain<typeof experimentRunDomain>
/** StorageFacility still loads this entire finite unit before initialize; pagination is not a storage index. */
export const openExperimentRunDomain = (ctx: { storageDomain: { open(spec: typeof experimentRunDomain): Promise<ExperimentRunDomain> } }): Promise<ExperimentRunDomain> => ctx.storageDomain.open(experimentRunDomain)
