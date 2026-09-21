/**
 * Difficulty coefficient （难度系数） — the exam-design P-value:
 * expected mean score ÷ total score. Guizhou zhongkao physics papers
 * conventionally target ≈0.65–0.70; the gaokao selective exam sits lower.
 * All values here are 教研估计 until trial-calibrated — they guide drafting
 * and review, never claim measured performance.
 */

import type { Difficulty, PaperDocument } from './paper.ts'

export type { Difficulty } from './paper.ts'

/** Expected score-rate per difficulty tier (教研估计). */
export const DIFFICULTY_COEFFICIENT: Record<Difficulty, number> = {
  basic: 0.85, medium: 0.60, hard: 0.35,
}

/** Difficulty mix a paper request carries. */
export interface DifficultyMix {
  readonly basic: number
  readonly medium: number
  readonly hard: number
}

/**
 * Selectable targets for the new-paper form, Guizhou-calibrated. The
 * coefficient shown for a preset is `mixCoefficient(p.mix)` — never a
 * hand-written number that could drift from the mix.
 */
export const DIFFICULTY_PRESETS = [
  { key: 'easy', label: '偏易（巩固检测）', mix: { basic: 0.85, medium: 0.12, hard: 0.03 } },
  { key: 'standard', label: '标准（贵州中考常态）', mix: { basic: 0.55, medium: 0.35, hard: 0.10 } },
  { key: 'hard', label: '偏难（模拟选拔）', mix: { basic: 0.30, medium: 0.45, hard: 0.25 } },
  { key: 'selective', label: '选拔（压轴导向）', mix: { basic: 0.10, medium: 0.35, hard: 0.55 } },
] as const

/** Coefficient a difficulty mix implies — the request's stated target. */
export const mixCoefficient = (mix: DifficultyMix): number =>
  mix.basic * DIFFICULTY_COEFFICIENT.basic
  + mix.medium * DIFFICULTY_COEFFICIENT.medium
  + mix.hard * DIFFICULTY_COEFFICIENT.hard

/** Band label for a coefficient, on the Guizhou zhongkao reference frame. */
export const coefficientLevel = (coefficient: number): string => {
  if (coefficient >= 0.72) return '偏易'
  if (coefficient >= 0.62) return '标准'
  if (coefficient >= 0.50) return '偏难'
  return '选拔'
}

/** Weighted coefficient over the document's questions (score × tier). */
export const paperCoefficient = (doc: PaperDocument): number => {
  let weighted = 0
  let total = 0
  for (const section of doc.sections) {
    for (const question of section.items) {
      weighted += question.score * DIFFICULTY_COEFFICIENT[question.difficulty]
      total += question.score
    }
  }
  return total === 0 ? 0 : weighted / total
}

/** Same weighting over spec rows — usable before drafting produces items. */
export const specCoefficient = (rows: readonly { score: number; difficulty: Difficulty }[]): number => {
  const total = rows.reduce((n, r) => n + r.score, 0)
  if (total === 0) return 0
  return rows.reduce((n, r) => n + r.score * DIFFICULTY_COEFFICIENT[r.difficulty], 0) / total
}

/** One display string: `难度系数 ≈0.68 · 标准（教研估计）`. */
export const coefficientLabel = (coefficient: number): string =>
  `难度系数 ≈${coefficient.toFixed(2)} · ${coefficientLevel(coefficient)}（教研估计）`
