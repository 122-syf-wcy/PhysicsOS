/**
 * Storage-domain spec for the PhysicsOS class workflow.
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

const classroom = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  ownerKey: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ClassRecord = z.infer<typeof classroom>

const membership = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  schoolId: z.string().min(1),
  userKey: z.string().min(1),
  addedBy: z.string().min(1),
  addedAt: z.string(),
})

export type MembershipRecord = z.infer<typeof membership>

const assignmentTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paper'),
    id: z.string().min(1).max(128),
  }),
  z.object({
    kind: z.literal('experiment'),
    id: z.string().min(1).max(128),
  }),
])

const assignment = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  schoolId: z.string().min(1),
  title: z.string().min(1),
  instructions: z.string().optional(),
  target: assignmentTarget,
  dueAt: z.string(),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type AssignmentRecord = z.infer<typeof assignment>
export type AssignmentTarget = z.infer<typeof assignmentTarget>

const submissionReview = z.object({
  status: z.enum(['accepted', 'returned']),
  comment: z.string().optional(),
  score: z.number().min(0).max(100).optional(),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string(),
})

const submission = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  assignmentId: z.string().min(1),
  schoolId: z.string().min(1),
  studentKey: z.string().min(1),
  content: z.string().min(1),
  submittedAt: z.string(),
  updatedAt: z.string(),
  review: submissionReview.optional(),
})

export type SubmissionReview = z.infer<typeof submissionReview>
export type SubmissionRecord = z.infer<typeof submission>

export const classDomain = defineDomain({
  name: 'physicsos_class',
  version: 0,
  tables: {
    classes: domainTable<string, ClassRecord>(classroom),
    memberships: domainTable<string, MembershipRecord>(membership),
    assignments: domainTable<string, AssignmentRecord>(assignment),
    submissions: domainTable<string, SubmissionRecord>(submission),
  },
})

export const openClassDomain = (ctx: {
  storageDomain: { open(spec: typeof classDomain): Promise<Domain<typeof classDomain>> }
}): Promise<Domain<typeof classDomain>> => ctx.storageDomain.open(classDomain)
