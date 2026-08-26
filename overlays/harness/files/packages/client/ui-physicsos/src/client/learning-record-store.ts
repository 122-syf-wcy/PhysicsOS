/**
 * Learning record — the student's attempt history.
 *
 * A {@link StudentAttempt} is written every time the student answers a
 * self-check — in Question Space (keyed by golden question) or in the Lab's
 * 自测 tab (keyed by lab topic, carrying `experimentId`). The record is what
 * the 学习记录 surface reads: mistakes grouped by their classified type,
 * mastery per knowledge node, and a re-practice path back to the question or
 * the experiment. Persistence is localStorage so the record survives a reload;
 * a corrupt payload degrades to an empty record.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { MistakeType } from '@physicsos/question-core'

export interface StudentAttempt {
  readonly id: string
  /** Golden question id, or the lab topic key for an experiment self-check. */
  readonly questionId: string
  readonly questionTitle: string
  readonly selfCheckId: string
  readonly prompt: string
  readonly answerId: string
  readonly answerLabel: string
  readonly correct: boolean
  /** Present exactly when the answer was wrong. */
  readonly mistakeType?: MistakeType
  /** Knowledge node ids the question exercises, for mastery aggregation. */
  readonly knowledge: readonly string[]
  /**
   * Present for lab self-checks: the experiment template that re-practises
   * this topic, so 重新练习 reopens the apparatus instead of Question Space.
   */
  readonly experimentId?: string
  readonly at: string
}

export interface LearningRecordState {
  attempts: readonly StudentAttempt[]
}

const STORAGE_KEY = 'physicsos.learning-record'
const ATTEMPT_LIMIT = 200

type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>

const readStored = (storage: RecordStorage | undefined): StudentAttempt[] => {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is StudentAttempt =>
        typeof entry === 'object' && entry !== null &&
        typeof (entry as { questionId?: unknown }).questionId === 'string' &&
        typeof (entry as { selfCheckId?: unknown }).selfCheckId === 'string' &&
        typeof (entry as { correct?: unknown }).correct === 'boolean')
      .slice(0, ATTEMPT_LIMIT)
  } catch {
    return []
  }
}

export interface LearningRecordController {
  store: SnapshotStore<LearningRecordState>
  record: (attempt: Omit<StudentAttempt, 'id' | 'at'>) => StudentAttempt
}

let attemptSerial = 0

/** Create the learning-record store, optionally persisted. */
export function createLearningRecordController(
  storage?: RecordStorage,
): LearningRecordController {
  const store = createSnapshotStore<LearningRecordState>({ attempts: readStored(storage) })
  return {
    store,
    record: (input) => {
      const attempt: StudentAttempt = {
        ...input,
        id: `attempt-${Date.now().toString(36)}-${(attemptSerial++).toString(36)}`,
        at: new Date().toISOString(),
      }
      const attempts = [attempt, ...store.getSnapshot().attempts].slice(0, ATTEMPT_LIMIT)
      store.set({ attempts })
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(attempts))
      } catch {
        /* Storage full or unavailable — the in-memory record still works. */
      }
      return attempt
    },
  }
}

/* -------------------------------------------------------------- aggregation -- */

export interface KnowledgeMastery {
  readonly nodeId: string
  readonly total: number
  readonly correct: number
}

/** Attempts per knowledge node, insertion-ordered by first appearance. */
export const knowledgeMasteryOf = (
  attempts: readonly Pick<StudentAttempt, 'correct' | 'knowledge'>[],
): readonly KnowledgeMastery[] => {
  const byNode = new Map<string, { total: number; correct: number }>()
  for (const attempt of attempts) {
    for (const nodeId of attempt.knowledge) {
      const entry = byNode.get(nodeId) ?? { total: 0, correct: 0 }
      entry.total += 1
      if (attempt.correct) entry.correct += 1
      byNode.set(nodeId, entry)
    }
  }
  return [...byNode.entries()].map(([nodeId, entry]) => ({ nodeId, ...entry }))
}

/** Wrong attempts per mistake type. */
export const mistakeCountsOf = (
  attempts: readonly StudentAttempt[],
): Readonly<Record<MistakeType, number>> => {
  const counts: Record<MistakeType, number> = { concept: 0, direction: 0, modeling: 0 }
  for (const attempt of attempts) {
    if (attempt.correct || attempt.mistakeType === undefined) continue
    counts[attempt.mistakeType] += 1
  }
  return counts
}

/** Newest-first wrong attempts. */
export const recentMistakesOf = (
  attempts: readonly StudentAttempt[],
  limit = 20,
): readonly StudentAttempt[] =>
  attempts.filter(attempt => !attempt.correct).slice(0, limit)
