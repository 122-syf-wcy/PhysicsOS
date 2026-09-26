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
})

const scenePayload = z.object({
  sceneId: identifier,
  title: z.string().min(1).max(300),
  domain: z.string().min(1).max(64),
  kind: z.enum(['experiment', 'question']),
  updatedAt: timestamp,
  scene: z
    .object({
      schemaVersion: z.literal('physics-scene/1.0'),
      id: identifier,
      revision: z.number().int().nonnegative(),
      dimension: z.enum(['2d', '3d']),
    })
    .loose(),
})

export const sceneEntryWire = scenePayload

const savedScene = scenePayload.extend({
  userKey: z.string().min(1).max(160),
  schoolId: z.string().min(1).max(64),
  savedAt: timestamp,
})

export type PersonalAttemptRecord = z.infer<typeof personalAttempt>
export type SavedSceneRecord = z.infer<typeof savedScene>

export const attemptKey = (userKeyValue: string, id: string): string => `${userKeyValue}|${id}`
export const savedSceneKey = (userKeyValue: string, sceneId: string): string =>
  `${userKeyValue}|${sceneId}`

export const learningDomain = defineDomain({
  name: 'physicsos_learning',
  version: 0,
  tables: {
    attempts: domainTable<string, PersonalAttemptRecord>(personalAttempt),
    saved_scenes: domainTable<string, SavedSceneRecord>(savedScene),
  },
})

export type LearningDomain = Domain<typeof learningDomain>

export const openLearningDomain = (ctx: {
  storageDomain: { open(spec: typeof learningDomain): Promise<LearningDomain> }
}): Promise<LearningDomain> => ctx.storageDomain.open(learningDomain)
