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
export const questionCodeDomain = defineDomain({
  name: 'physicsos_question_code',
  version: 0,
  tables: { artifacts: domainTable<string, QuestionCodeRecord>(questionCodeRecordSchema) },
})
export const openQuestionCodeDomain = (ctx: {
  storageDomain: {
    open(spec: typeof questionCodeDomain): Promise<Domain<typeof questionCodeDomain>>
  }
}): Promise<Domain<typeof questionCodeDomain>> => ctx.storageDomain.open(questionCodeDomain)
