/**
 * Paper blueprint — the paper's structure, carried by the profile.
 *
 * The blueprint is data on the {@link ExamProfile}, never a constant in the
 * engine and never "whatever the model felt like". It states the total score,
 * the duration, the sections with their exact question counts and scoring, the
 * coverage constraints, the difficulty distribution and the duplicate-model
 * cap. Nothing here is a hardcoded count or score: if a confirmed profile lacks
 * any of it, {@link blueprintIssues} reports the gap and the runtime refuses to
 * build a paper rather than guessing.
 */

import {
  isFiniteNumber,
  isPositiveNumber,
  issue,
  readArray,
  readCount,
  readNonEmptyArray,
  readObject,
  readOneOf,
  readPositiveNumber,
  readRecord,
  readString,
  readStringArray,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'
import { DIFFICULTY_LEVELS, type DifficultyLevel } from './question.ts'
import { isQuestionType, type QuestionType } from './taxonomy.ts'

/** How a section's marks are laid out across its questions. */
export const SECTION_SCORING_KINDS = ['UNIFORM', 'PER_SLOT'] as const
export type SectionScoringKind = (typeof SECTION_SCORING_KINDS)[number]

/** Uniform marks for every question, or an explicit score per slot. */
export type SectionScoring =
  | { readonly kind: 'UNIFORM'; readonly scorePerQuestion: number }
  | { readonly kind: 'PER_SLOT'; readonly scores: readonly number[] }

/** One section of the paper. */
export interface BlueprintSection {
  readonly id: string
  readonly title: string
  readonly questionCount: number
  /** Question types this section may draw from. */
  readonly taxonomy: readonly QuestionType[]
  readonly scoring: SectionScoring
}

/** What a coverage constraint ranges over. */
export const COVERAGE_KINDS = ['KNOWLEDGE', 'COMPETENCY', 'TYPE', 'CONTEXT'] as const
export type CoverageKind = (typeof COVERAGE_KINDS)[number]

/** A constraint the paper must satisfy (e.g. a knowledge point must appear). */
export interface CoverageConstraint {
  readonly id: string
  readonly description: string
  readonly kind: CoverageKind
  readonly requiredTags: readonly string[]
  readonly minCount?: number
  readonly maxCount?: number
}

/** One difficulty band's target share. */
export interface DifficultyBucket {
  readonly level: DifficultyLevel
  readonly targetRatio: number
}

/** The target difficulty distribution. */
export interface DifficultyDistribution {
  readonly buckets: readonly DifficultyBucket[]
}

/** The paper blueprint a profile carries. */
export interface PaperBlueprint {
  readonly totalScore: number
  readonly durationMinutes: number
  readonly sections: readonly BlueprintSection[]
  readonly coverageConstraints: readonly CoverageConstraint[]
  readonly difficultyDistribution: DifficultyDistribution
  /** Cap on the share of questions sharing a single model, in [0, 1]. */
  readonly maxDuplicateModelRatio: number
}

/** Marks a section contributes. */
export const sectionScore = (section: BlueprintSection): number =>
  section.scoring.kind === 'UNIFORM'
    ? section.questionCount * section.scoring.scorePerQuestion
    : section.scoring.scores.reduce((sum, score) => sum + score, 0)

/** Total marks the blueprint's sections add up to. */
export const blueprintTotalScore = (blueprint: PaperBlueprint): number =>
  blueprint.sections.reduce((sum, section) => sum + sectionScore(section), 0)

/** Total questions the blueprint's sections add up to. */
export const blueprintQuestionCount = (blueprint: PaperBlueprint): number =>
  blueprint.sections.reduce((sum, section) => sum + section.questionCount, 0)

/** The section with the given id, if any. */
export const blueprintSection = (
  blueprint: PaperBlueprint,
  id: string,
): BlueprintSection | undefined => blueprint.sections.find((section) => section.id === id)

/**
 * Arithmetic and completeness of a blueprint. Reports every gap; an empty
 * result means the blueprint is a usable, internally consistent structure.
 * @param blueprint - the blueprint to check.
 */
export function blueprintIssues(blueprint: PaperBlueprint): readonly string[] {
  const issues: string[] = []
  if (blueprint.sections.length === 0) issues.push('蓝图缺少分卷')
  if (!(blueprint.durationMinutes > 0)) issues.push('蓝图缺少有效考试时长')
  const seenSections = new Set<string>()
  for (const section of blueprint.sections) {
    if (seenSections.has(section.id)) issues.push(`分卷 id 重复：${section.id}`)
    seenSections.add(section.id)
    if (!(section.questionCount > 0)) issues.push(`分卷 ${section.id} 缺少题量`)
    if (section.taxonomy.length === 0) issues.push(`分卷 ${section.id} 缺少题型`)
    if (section.scoring.kind === 'UNIFORM') {
      if (!(section.scoring.scorePerQuestion > 0)) {
        issues.push(`分卷 ${section.id} 缺少每题分值`)
      }
    } else if (section.scoring.scores.length !== section.questionCount) {
      issues.push(`分卷 ${section.id} 的分值槽位与题量不一致`)
    } else if (!section.scoring.scores.every((score) => score > 0)) {
      issues.push(`分卷 ${section.id} 存在非法分值`)
    }
  }
  if (blueprintTotalScore(blueprint) !== blueprint.totalScore) {
    issues.push('分卷分值合计与总分不一致')
  }
  if (blueprint.difficultyDistribution.buckets.length === 0) {
    issues.push('蓝图缺少难度分布')
  }
  const ratioSum = blueprint.difficultyDistribution.buckets.reduce(
    (sum, bucket) => sum + bucket.targetRatio,
    0,
  )
  if (blueprint.difficultyDistribution.buckets.length > 0 && Math.abs(ratioSum - 1) > 1e-6) {
    issues.push('难度分布比例合计应为 1')
  }
  for (const constraint of blueprint.coverageConstraints) {
    if (constraint.requiredTags.length === 0) {
      issues.push(`覆盖约束 ${constraint.id} 缺少标签`)
    }
  }
  return issues
}

/** Read a number constrained to `[0, 1]`. */
const readRatio = (
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number => {
  const raw = source[key]
  if (isFiniteNumber(raw) && raw >= 0 && raw <= 1) return raw
  issues.push(issue(`${path}.${key}`, '必须是 0 到 1 之间的数字'))
  return 0
}

/** Read the union-tagged section scoring. */
const readSectionScoring = (
  source: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): SectionScoring => {
  const kind = readOneOf(source, 'kind', SECTION_SCORING_KINDS, path, issues)
  if (kind === 'UNIFORM') {
    return { kind: 'UNIFORM', scorePerQuestion: readPositiveNumber(source, 'scorePerQuestion', path, issues) }
  }
  const rawScores = readNonEmptyArray(source, 'scores', path, issues)
  const scores: number[] = []
  rawScores.forEach((raw, index) => {
    if (isPositiveNumber(raw)) scores.push(raw)
    else issues.push(issue(`${path}.scores[${index}]`, '必须是正数'))
  })
  return { kind: 'PER_SLOT', scores }
}

/** Validate a paper blueprint value that arrived as external data. */
export function validatePaperBlueprint(
  value: unknown,
  path: string,
): ValidationResult<PaperBlueprint> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const totalScore = readPositiveNumber(record, 'totalScore', path, issues)
  const durationMinutes = readPositiveNumber(record, 'durationMinutes', path, issues)

  const rawSections = readNonEmptyArray(record, 'sections', path, issues)
  const sections: BlueprintSection[] = []
  rawSections.forEach((raw, index) => {
    const sectionPath = `${path}.sections[${index}]`
    const section = readObject(raw, sectionPath, issues)
    const id = readString(section, 'id', sectionPath, issues)
    const title = readString(section, 'title', sectionPath, issues)
    const questionCount = readCount(section, 'questionCount', sectionPath, issues)
    const rawTaxonomy = readNonEmptyArray(section, 'taxonomy', sectionPath, issues)
    const taxonomy: QuestionType[] = []
    rawTaxonomy.forEach((entry, typeIndex) => {
      if (isQuestionType(entry)) taxonomy.push(entry)
      else issues.push(issue(`${sectionPath}.taxonomy[${typeIndex}]`, '不是受支持的题型'))
    })
    const scoring = readSectionScoring(readRecord(section, 'scoring', sectionPath, issues), `${sectionPath}.scoring`, issues)
    sections.push({ id, title, questionCount, taxonomy, scoring })
  })

  const rawConstraints = readArray(record, 'coverageConstraints', path, issues)
  const coverageConstraints: CoverageConstraint[] = []
  rawConstraints.forEach((raw, index) => {
    const constraintPath = `${path}.coverageConstraints[${index}]`
    const constraint = readObject(raw, constraintPath, issues)
    const id = readString(constraint, 'id', constraintPath, issues)
    const description = readString(constraint, 'description', constraintPath, issues)
    const kind = readOneOf(constraint, 'kind', COVERAGE_KINDS, constraintPath, issues)
    const requiredTags = readStringArray(constraint, 'requiredTags', constraintPath, issues)
    coverageConstraints.push({ id, description, kind, requiredTags })
  })

  const distributionPath = `${path}.difficultyDistribution`
  const distribution = readRecord(record, 'difficultyDistribution', path, issues)
  const rawBuckets = readNonEmptyArray(distribution, 'buckets', distributionPath, issues)
  const buckets: DifficultyBucket[] = []
  rawBuckets.forEach((raw, index) => {
    const bucketPath = `${distributionPath}.buckets[${index}]`
    const bucket = readObject(raw, bucketPath, issues)
    const level = readOneOf(bucket, 'level', DIFFICULTY_LEVELS, bucketPath, issues)
    const targetRatio = readRatio(bucket, 'targetRatio', bucketPath, issues)
    buckets.push({ level, targetRatio })
  })

  const maxDuplicateModelRatio = readRatio(record, 'maxDuplicateModelRatio', path, issues)

  if (issues.length > 0) return { ok: false, issues }
  const blueprint: PaperBlueprint = {
    totalScore,
    durationMinutes,
    sections,
    coverageConstraints,
    difficultyDistribution: { buckets },
    maxDuplicateModelRatio,
  }
  const arithmetic = blueprintIssues(blueprint)
  if (arithmetic.length > 0) return { ok: false, issues: arithmetic.map((message) => issue(path, message)) }
  return { ok: true, value: blueprint }
}
