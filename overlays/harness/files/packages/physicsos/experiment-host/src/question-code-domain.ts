/** Private artifacts have no community review status or active-release pointer. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const questionCodeRecordSchema = z
  .object({
    id: z.string().regex(/^qcode_[a-f0-9]{32}$/),
    ownerSessionId: z.string().min(1).max(200),
    ownerKey: z.string().min(1).max(300),
    childSessionId: z.string().min(1).max(200),
    generationId: z.string().min(1).max(200).optional(),
    requestSha256: digest.optional(),
    sceneId: z.string().min(1).max(200),
    sceneRevision: z.number().int().nonnegative(),
    sceneSha256: digest,
    experimentId: z.string().min(1).max(100),
    sha256: digest,
    title: z.string().min(1).max(120),
    rendererKind: z.literal('independent').optional(),
    summary: z.string().max(1000),
    createdAt: z.string(),
    styleVersion: z.string().min(1).max(100),
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(240),
            sha256: digest,
            size: z.number().int().nonnegative(),
            contentType: z.string(),
          })
          .strict(),
      )
      .max(512),
  })
  .strict()
export type QuestionCodeRecord = z.infer<typeof questionCodeRecordSchema>
/**
 * Durable execution job for one generated experiment.
 *
 * This is the app's authoritative record of background work: the chat only
 * ever sees the projected `generating/ready/failed` state, while trials,
 * leases and validation evidence stay here. Records are keyed by the
 * generation id so the existing artifact lookup and the job always agree.
 */
export const questionCodeJobSchema = z
  .object({
    id: z.string().min(1).max(200),
    ownerSessionId: z.string().min(1).max(200),
    ownerKey: z.string().min(1).max(300),
    sceneId: z.string().min(1).max(200),
    sceneRevision: z.number().int().nonnegative(),
    sceneSha256: digest,
    requestSha256: digest.optional(),
    status: z.enum(['queued', 'running', 'candidate', 'validating', 'ready', 'failed', 'cancelled', 'superseded']),
    /** Lease generation; a result from an older epoch is never published. */
    leaseEpoch: z.number().int().nonnegative(),
    /** Immutable attempts: index, status, candidate digest and bounded diagnostics. */
    attempts: z.array(z.object({
      index: z.number().int().nonnegative(),
      status: z.enum(['running', 'passed', 'rejected', 'infrastructure-failed', 'cancelled']),
      candidateSha256: digest.optional(),
      startedAt: z.string(),
      finishedAt: z.string().optional(),
      code: z.string().max(100).optional(),
      reason: z.string().max(200).optional(),
      diagnostics: z.array(z.string().max(1000)).max(20).optional(),
    }).strict()).max(8),
    /** Validation outcome for the accepted attempt, if any. */
    validation: z.object({
      version: z.literal(1),
      passed: z.boolean(),
      candidateSha256: digest,
      checks: z.array(z.object({ name: z.string().max(80), passed: z.boolean(), detail: z.string().max(600).optional() }).strict()).max(20),
      screenshotRef: z.string().max(300).optional(),
      finishedAt: z.string(),
    }).strict().optional(),
    resultRef: z.string().max(300).optional(),
    resultSha256: digest.optional(),
    code: z.string().max(100).optional(),
    message: z.string().max(1000).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
export type QuestionCodeJob = z.infer<typeof questionCodeJobSchema>

export const questionCodeDomain = defineDomain({
  name: 'physicsos_question_code',
  // Version stays 0 on purpose: the Postgres backend rejects any version
  // change on an existing unit (`version-mismatch`). Adding a table is a
  // `CREATE TABLE IF NOT EXISTS` increment, so existing deployments open the
  // same unit and get the new (initially empty) job table without migration.
  version: 0,
  tables: {
    artifacts: domainTable<string, QuestionCodeRecord>(questionCodeRecordSchema),
    jobs: domainTable<string, QuestionCodeJob>(questionCodeJobSchema),
  },
})
export const openQuestionCodeDomain = (ctx: {
  storageDomain: {
    open(spec: typeof questionCodeDomain): Promise<Domain<typeof questionCodeDomain>>
  }
}): Promise<Domain<typeof questionCodeDomain>> => ctx.storageDomain.open(questionCodeDomain)
