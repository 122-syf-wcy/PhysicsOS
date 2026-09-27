/**
 * The question record — knowledge + competency + reasoning + representation.
 *
 * A paper question must be able to state more than its knowledge point: which
 * core competency it exercises, the reasoning it demands, how it is
 * represented (图/表/文字), its difficulty and its context, plus its answer as
 * one of the three answer levels and its structured scoring split. This is the
 * unit the compliance verifier reasons over; it is produced by the question
 * compiler, not authored as external data.
 */

import type { AnswerLevel } from './answer.ts'
import type { CompetencyDimension } from './competency.ts'
import type { ScoringPoint } from './scoring.ts'
import type { QuestionType } from './taxonomy.ts'

/** Difficulty bands. */
export const DIFFICULTY_LEVELS = ['EASY', 'MEDIUM', 'HARD'] as const
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number]

/** A compiled question, ready for exam-compliance review. */
export interface QuestionRecord {
  readonly id: string
  readonly type: QuestionType
  readonly knowledgeTags: readonly string[]
  readonly competency: readonly CompetencyDimension[]
  readonly reasoning: readonly string[]
  readonly representation: readonly string[]
  readonly difficulty: DifficultyLevel
  readonly context: string
  readonly score: number
  readonly answer: AnswerLevel
  readonly scoringPoints: readonly ScoringPoint[]
  /** Model identity for duplicate-model detection; absent means "not modelled". */
  readonly modelId?: string
}

/** A question placed in a paper section. */
export interface DraftQuestion extends QuestionRecord {
  readonly sectionId: string
}

/** Maximum share of questions allowed to share a single model; from the blueprint. */
export const duplicateModelRatio = (questions: readonly QuestionRecord[]): number => {
  if (questions.length === 0) return 0
  const counts = new Map<string, number>()
  for (const question of questions) {
    if (question.modelId === undefined) continue
    counts.set(question.modelId, (counts.get(question.modelId) ?? 0) + 1)
  }
  let max = 0
  for (const count of counts.values()) max = Math.max(max, count)
  return max / questions.length
}
