/**
 * Read/write projections for the two domains that carry account-scoped data
 * alongside auth. The projections preserve every stored field (`.loose()`)
 * and only require the fields the merge engine must rewrite or validate. A
 * missing/renamed field therefore fails schema validation instead of being
 * silently dropped by the CLI.
 */

import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'

const classRecord = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  ownerKey: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).loose()

const membershipRecord = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  schoolId: z.string().min(1),
  userKey: z.string().min(1),
  addedBy: z.string().min(1),
  addedAt: z.string().min(1),
}).loose()

const assignmentTarget = z.object({
  kind: z.enum(['paper', 'experiment']),
  id: z.string().min(1),
}).loose()

const assignmentRecord = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  schoolId: z.string().min(1),
  title: z.string().min(1),
  instructions: z.string().optional(),
  target: assignmentTarget,
  dueAt: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).loose()

const submissionReview = z.object({
  status: z.enum(['accepted', 'returned']),
  comment: z.string().optional(),
  score: z.number().optional(),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().min(1),
}).loose()

const submissionRecord = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  assignmentId: z.string().min(1),
  schoolId: z.string().min(1),
  studentKey: z.string().min(1),
  content: z.string().min(1),
  submittedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  review: submissionReview.optional(),
}).loose()

const attemptRecord = z.object({
  id: z.string().min(1),
  questionId: z.string().min(1),
  questionTitle: z.string(),
  selfCheckId: z.string().min(1),
  prompt: z.string(),
  answerId: z.string().min(1),
  answerLabel: z.string(),
  correct: z.boolean(),
  mistakeType: z.enum(['concept', 'direction', 'modeling']).optional(),
  knowledge: z.array(z.string()).max(64),
  experimentId: z.string().optional(),
  at: z.string().min(1),
  userKey: z.string().min(1),
  schoolId: z.string().min(1),
  updatedAt: z.string().min(1),
}).loose()

const savedSceneRecord = z.object({
  sceneId: z.string().min(1),
  title: z.string().min(1),
  domain: z.string().min(1),
  kind: z.enum(['experiment', 'question']),
  updatedAt: z.string().min(1),
  scene: z.object({
    schemaVersion: z.literal('physics-scene/1.0'),
    id: z.string().min(1),
    revision: z.number().int().nonnegative(),
    dimension: z.enum(['2d', '3d']),
  }).loose(),
  userKey: z.string().min(1),
  schoolId: z.string().min(1),
  savedAt: z.string().min(1),
}).loose()

/** Storage projection of the class host's durable table set. */
export const classMergeDomain = defineDomain({
  name: 'physicsos_class',
  version: 0,
  tables: {
    classes: domainTable<string, z.infer<typeof classRecord>>(classRecord),
    memberships: domainTable<string, z.infer<typeof membershipRecord>>(membershipRecord),
    assignments: domainTable<string, z.infer<typeof assignmentRecord>>(assignmentRecord),
    submissions: domainTable<string, z.infer<typeof submissionRecord>>(submissionRecord),
  },
})

/** Storage projection of the personal learning host's durable table set. */
export const learningMergeDomain = defineDomain({
  name: 'physicsos_learning',
  version: 0,
  tables: {
    attempts: domainTable<string, z.infer<typeof attemptRecord>>(attemptRecord),
    saved_scenes: domainTable<string, z.infer<typeof savedSceneRecord>>(savedSceneRecord),
  },
})

export type ClassMergeDomain = Domain<typeof classMergeDomain>
export type LearningMergeDomain = Domain<typeof learningMergeDomain>
