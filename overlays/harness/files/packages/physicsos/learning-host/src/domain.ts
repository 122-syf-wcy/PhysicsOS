/**
 * Storage-domain spec for personal learning sync.
 *
 * This unit is deliberately separate from `physicsos_auth.learning_counts`:
 * attempts and saved scenes here are account-scoped private data, while the
 * aggregate learning counters are anonymous school-by-day observations. Keeping
 * the tables apart makes it impossible for an aggregate dashboard query to
 * accidentally read or expose an account.
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/)
const boundedText = (max: number) => z.string().max(max)
const timestamp = z
  .string()
  .min(1)
  .max(64)
  .refine(value => Number.isFinite(Date.parse(value)), { message: 'timestamp must be parseable' })

const attemptPayload = z.object({
  id: identifier,
  questionId: z.string().min(1).max(200),
  questionTitle: boundedText(500),
  selfCheckId: z.string().min(1).max(200),
  prompt: boundedText(4000),
  answerId: z.string().min(1).max(200),
  answerLabel: boundedText(1000),
  correct: z.boolean(),
  mistakeType: z.enum(['concept', 'direction', 'modeling']).optional(),
  knowledge: z.array(z.string().min(1).max(64)).max(64),
  experimentId: z.string().min(1).max(200).optional(),
  at: timestamp,
})

export const attemptWire = attemptPayload

const personalAttempt = attemptPayload.extend({
  userKey: z.string().min(1).max(160),
  schoolId: z.string().min(1).max(64),
  /** Server write time; used for diagnostics, not ordering. */
  updatedAt: timestamp,
  /** A client self-check is not an authoritative grade. */
  gradingSource: z.literal('self-reported').optional(),
})

const sceneFacts = z
  .object({
    schemaVersion: z.literal('physics-scene/1.0'),
    id: identifier,
    revision: z.number().int().nonnegative(),
    dimension: z.enum(['2d', '3d']),
  })
  .loose()

const scenePayload = z.object({
  sceneId: identifier,
  title: z.string().min(1).max(300),
  domain: z.string().min(1).max(64),
  kind: z.enum(['experiment', 'question']),
  updatedAt: timestamp,
  scene: sceneFacts,
  originScene: sceneFacts.optional(),
  buildMode: z.literal(true).optional(),
})

export const sceneEntryWire = scenePayload

/** Compact replay evidence stays in the same atomic row as each mutation. */
const mutation = z.object({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  hash: z.string().length(64),
  revision: z.number().int().positive(),
})
const sceneSync = {
  userKey: z.string().min(1).max(160),
  schoolId: z.string().min(1).max(64),
  savedAt: timestamp,
  revision: z.number().int().positive().optional(),
  mutations: z.array(mutation).max(128).optional(),
}
const savedScene = scenePayload.extend({
  ...sceneSync,
  checkpointRef: z.object({ digest: z.string().length(64), bytes: z.number().int().positive() }).optional(),
})
const deletedScene = z.object({
  ...sceneSync,
  sceneId: identifier,
  deletedAt: timestamp,
})
const erasureFence = z.object({ userKey: z.string(), schoolId: z.string(), userId: z.string(), requestId: z.string(), complete: z.boolean() })

export type PersonalAttemptRecord = z.infer<typeof personalAttempt>
export type SavedSceneRecord = z.infer<typeof savedScene>
export type DeletedSceneRecord = z.infer<typeof deletedScene>
export type StoredSceneRecord = SavedSceneRecord | DeletedSceneRecord
export type LearningErasure = z.infer<typeof erasureFence>

export const attemptKey = (userKeyValue: string, id: string): string => `${userKeyValue}|${id}`
export const savedSceneKey = (userKeyValue: string, sceneId: string): string =>
  `${userKeyValue}|${sceneId}`

export const learningDomain = defineDomain({
  name: 'physicsos_learning',
  version: 0,
  tables: {
    attempts: domainTable<string, PersonalAttemptRecord>(personalAttempt),
    saved_scenes: domainTable<string, StoredSceneRecord>(z.union([savedScene, deletedScene])),
    erased_accounts: domainTable<string, LearningErasure>(erasureFence),
  },
})

export type LearningDomain = Domain<typeof learningDomain>

export const openLearningDomain = (ctx: {
  storageDomain: { open(spec: typeof learningDomain): Promise<LearningDomain> }
}): Promise<LearningDomain> => ctx.storageDomain.open(learningDomain)
