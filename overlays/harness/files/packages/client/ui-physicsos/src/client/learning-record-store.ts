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

import { createSnapshotStore, type SnapshotStore } from './runtime-compat.ts'
import type { MistakeType } from '@physicsos/question-core'
import type { LearningApi } from './learning-api.ts'

/** One recorded self-check answer — local-only history, never leaves the browser. */
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

/** The store's snapshot shape — newest-first attempts, capped at 200. */
export interface LearningRecordState {
  attempts: readonly StudentAttempt[]
}

/** One answered self-check, as a surface reports it to {@link LearningRecordController.record}. */
export type SelfCheckAttemptInput = Omit<StudentAttempt, 'id' | 'at'>

const STORAGE_KEY = 'physicsos.learning-record'
const ATTEMPT_LIMIT = 200

type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>
type LearningRecordSync = Pick<LearningApi, 'listAttempts' | 'putAttempt'>

const readStored = (storage: RecordStorage | undefined): StudentAttempt[] => {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (entry): entry is StudentAttempt =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { questionId?: unknown }).questionId === 'string' &&
          typeof (entry as { selfCheckId?: unknown }).selfCheckId === 'string' &&
          typeof (entry as { correct?: unknown }).correct === 'boolean' &&
          /* `knowledge` drives `for…of` in mastery aggregation — a row that
           lacks it is corrupt and is dropped here, not downstream. */
          Array.isArray((entry as { knowledge?: unknown }).knowledge),
      )
      .slice(0, ATTEMPT_LIMIT)
  } catch {
    return []
  }
}

/** The surface the views bind against: snapshot store plus `record`. */
export interface LearningRecordController {
  store: SnapshotStore<LearningRecordState>
  record: (attempt: Omit<StudentAttempt, 'id' | 'at'>) => StudentAttempt
  /** Migrate local attempts, upload unsynced rows, then merge server pages. */
  sync: () => Promise<void>
}

let attemptSerial = 0

/** Create the learning-record store, optionally persisted.
 * @param storage - the per-user storage view; absent keeps attempts in memory only.
 * @returns the controller the views bind against.
 */
export function createLearningRecordController(
  storage?: RecordStorage,
  remote?: LearningRecordSync,
): LearningRecordController {
  const store = createSnapshotStore<LearningRecordState>({ attempts: readStored(storage) })
  const persist = (attempts: readonly StudentAttempt[]): void => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(attempts))
    } catch {
      /* Storage full or unavailable - the in-memory record still works. */
    }
  }
  const merge = (groups: readonly (readonly StudentAttempt[])[]): StudentAttempt[] => {
    const byId = new Map<string, StudentAttempt>()
    for (const group of groups) {
      for (const attempt of group) {
        const current = byId.get(attempt.id)
        if (current === undefined || current.at <= attempt.at) byId.set(attempt.id, attempt)
      }
    }
    return [...byId.values()]
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, ATTEMPT_LIMIT)
  }
  let activeSync: Promise<void> | undefined
  const sync = (): Promise<void> => {
    if (remote === undefined) return Promise.resolve()
    activeSync ??= (async () => {
      for (const attempt of store.getSnapshot().attempts) {
        await remote.putAttempt(attempt)
      }
      const remoteAttempts: StudentAttempt[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < 100; page += 1) {
        const result = await remote.listAttempts(cursor === undefined ? {} : { cursor })
        remoteAttempts.push(...result.items)
        if (result.nextCursor === undefined) break
        if (seenCursors.has(result.nextCursor)) throw new Error('learning sync repeated a cursor')
        seenCursors.add(result.nextCursor)
        cursor = result.nextCursor
      }
      const attempts = merge([remoteAttempts, store.getSnapshot().attempts])
      store.set({ attempts })
      persist(attempts)
    })().finally(() => {
      activeSync = undefined
    })
    return activeSync
  }
  return {
    store,
    record: (input) => {
      const attempt: StudentAttempt = {
        ...input,
        id: `attempt-${Date.now().toString(36)}-${(attemptSerial++).toString(36)}-${globalThis.crypto.randomUUID()}`,
        at: new Date().toISOString(),
      }
      const attempts = [attempt, ...store.getSnapshot().attempts].slice(0, ATTEMPT_LIMIT)
      store.set({ attempts })
      persist(attempts)
      void remote?.putAttempt(attempt).catch(() => {
        /* Local-first: the next explicit sync retries this row. */
      })
      return attempt
    },
    sync,
  }
}

/* -------------------------------------------------------------- aggregation -- */

/** Per-knowledge-node totals over a student's attempts. */
export interface KnowledgeMastery {
  readonly nodeId: string
  readonly total: number
  readonly correct: number
}

/** Attempts per knowledge node, insertion-ordered by first appearance.
 * @param attempts - the student's attempts (only `correct`/`knowledge` are read).
 * @returns one mastery row per knowledge node.
 */
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

/** Wrong attempts per mistake type.
 * @param attempts - the student's attempts.
 * @returns a `{concept, direction, modeling}` count map.
 */
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

/** Newest-first wrong attempts.
 * @param attempts - the student's attempts (already newest-first).
 * @param limit - cap on returned rows, default 20.
 * @returns the wrong attempts, up to `limit`.
 */
export const recentMistakesOf = (
  attempts: readonly StudentAttempt[],
  limit = 20,
): readonly StudentAttempt[] => attempts.filter(attempt => !attempt.correct).slice(0, limit)
