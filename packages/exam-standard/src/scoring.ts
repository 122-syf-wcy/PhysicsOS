/**
 * Structured scoring points — the score split is evidence, not a bare total.
 *
 * A question's marks are a list of {@link ScoringPoint}s, each naming the
 * criterion and the kind of evidence that earns it (equation, substitution,
 * result, unit, direction, reasoning). The split must come from a confirmed
 * rubric profile — {@link ScoringStandard} names the rubric source and the
 * evidence kinds it permits — so the runtime never invents a split. The rules
 * here only check an existing split against that standard.
 */

import {
  isOneOf,
  readNonEmptyArray,
  readObject,
  readString,
  issue,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** The kinds of evidence a scoring point can be awarded for. */
export const SCORING_EVIDENCE = [
  'EQUATION',
  'SUBSTITUTION',
  'RESULT',
  'UNIT',
  'DIRECTION',
  'REASONING',
] as const
export type ScoringEvidence = (typeof SCORING_EVIDENCE)[number]

/** One scored step: how many marks, for what criterion, on what evidence. */
export interface ScoringPoint {
  readonly id: string
  readonly score: number
  readonly criterion: string
  readonly evidence: ScoringEvidence
}

/** The profile's declared scoring standard, bound to a rubric source. */
export interface ScoringStandard {
  readonly id: string
  /** Id of the official source that defines the rubric (must be in the profile's sources). */
  readonly rubricSourceId: string
  /** Evidence kinds the rubric permits. */
  readonly allowedEvidence: readonly ScoringEvidence[]
}

export const isScoringEvidence = (value: unknown): value is ScoringEvidence =>
  isOneOf(value, SCORING_EVIDENCE)

/** Sum of a scoring-point split. */
export const scoringPointTotal = (points: readonly ScoringPoint[]): number =>
  points.reduce((sum, point) => sum + point.score, 0)

/**
 * Check a scoring-point split against the marks allocated to the question and
 * the profile's standard.
 * @param points - the split to check.
 * @param allocatedScore - the question's total marks.
 * @param standard - the profile's scoring standard.
 * @returns the issues found; empty means conformant.
 */
export function scoringPointIssues(
  points: readonly ScoringPoint[],
  allocatedScore: number,
  standard: ScoringStandard,
): readonly string[] {
  const issues: string[] = []
  if (points.length === 0) issues.push('缺少评分点拆分')
  const total = scoringPointTotal(points)
  if (total !== allocatedScore) {
    issues.push(`评分点合计 ${total} 分与题目分值 ${allocatedScore} 分不一致`)
  }
  const seen = new Set<string>()
  for (const point of points) {
    if (seen.has(point.id)) issues.push(`评分点 id 重复：${point.id}`)
    seen.add(point.id)
    if (!standard.allowedEvidence.includes(point.evidence)) {
      issues.push(`评分点证据类型 ${point.evidence} 不在评分标准允许范围内`)
    }
  }
  return issues
}

/** Validate a scoring standard value that arrived as external data. */
export function validateScoringStandard(
  value: unknown,
  path: string,
): ValidationResult<ScoringStandard> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const rubricSourceId = readString(record, 'rubricSourceId', path, issues)
  const rawEvidence = readNonEmptyArray(record, 'allowedEvidence', path, issues)
  const allowedEvidence: ScoringEvidence[] = []
  rawEvidence.forEach((raw, index) => {
    if (isScoringEvidence(raw)) allowedEvidence.push(raw)
    else issues.push(issue(`${path}.allowedEvidence[${index}]`, '不是受支持的证据类型'))
  })
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: { id, rubricSourceId, allowedEvidence } }
}
