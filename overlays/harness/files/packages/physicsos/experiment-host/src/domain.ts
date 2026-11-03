/** One atomic state row keeps publication, history and package review consistent. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const author = z.object({
  name: z.string().min(1).max(80),
  bio: z.string().max(300).optional(),
  github: z.string().optional(),
})
const record = z.object({
  id: z.string().regex(/^exp_[a-f0-9]{32}$/),
  experimentId: z.literal('convex-lens'),
  version: z.string(),
  sha256: digest,
  authorKey: z.string().min(1),
  author,
  note: z.string().max(500).optional(),
  status: z.enum(['pending', 'approved', 'rejected']),
  entry: z.literal('dist/index.html'),
  createdAt: z.string(),
  publishedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  avatarPath: z.string().optional(),
  assets: z.array(
    z.object({
      name: z.string(),
      sha256: digest,
      size: z.number().int().min(0),
      contentType: z.string(),
    }),
  ),
})
export const experimentStateSchema = z.object({
  packages: z.array(record),
  activeId: z.string().nullable(),
  sequence: z.number().int().min(0),
  releases: z.array(
    z.object({
      sequence: z.number().int().min(1),
      packageId: z.string(),
      action: z.enum(['approve', 'rollback']),
      actorKey: z.string(),
      createdAt: z.string(),
    }),
  ),
})
export type ExperimentPackageRecord = z.infer<typeof record>
export type ExperimentState = z.infer<typeof experimentStateSchema>
export const experimentDomain = defineDomain({
  name: 'physicsos_experiments',
  version: 0,
  tables: { state: domainTable<string, ExperimentState>(experimentStateSchema) },
})
export const openExperimentDomain = (ctx: {
  storageDomain: { open(spec: typeof experimentDomain): Promise<Domain<typeof experimentDomain>> }
}): Promise<Domain<typeof experimentDomain>> => ctx.storageDomain.open(experimentDomain)
