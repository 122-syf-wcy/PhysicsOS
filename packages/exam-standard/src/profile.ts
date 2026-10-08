/**
 * The exam profile — one versioned official standard for one exam target.
 *
 * A profile is identified by `(jurisdiction, stage, subject, year)`. 中考 and
 * 高考 are *entirely separate profiles*: they have different curriculum roots
 * (义务教育物理课程标准 for 中考; 国家高中物理课程标准 plus the province's
 * 3+1+2 selective-exam arrangement for 高考). There is deliberately no shared
 * template with a difficulty switch — the stage is part of the key, so a query
 * can never cross from one to the other. Everything Guizhou-specific lives in
 * the profile data, so onboarding another province or the national 新高考 is a
 * new pack, not an engine branch.
 */

import { validateAnswerStandard, type AnswerStandard } from './answer.ts'
import { blueprintIssues, validatePaperBlueprint, type PaperBlueprint } from './blueprint.ts'
import { coversAllDimensions, validateCompetencyModel, type CompetencyModel } from './competency.ts'
import { validateContentScope, type ContentScope } from './content-scope.ts'
import { validateScoringStandard, type ScoringStandard } from './scoring.ts'
import {
  validateOfficialSourceRef,
  validateSourceRef,
  type OfficialSourceRef,
  type SourceRef,
} from './sources.ts'
import { validateQuestionTaxonomy, type QuestionTaxonomy } from './taxonomy.ts'
import {
  issue,
  readArray,
  readCount,
  readObject,
  readOneOf,
  readString,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** Exam stages. 中考 and 高考 never share a profile. */
export const EXAM_STAGES = ['ZHONGKAO', 'GAOKAO'] as const
export type ExamStage = (typeof EXAM_STAGES)[number]

/** Subjects. Widening this is a standard-level decision, not a per-province one. */
export const SUBJECTS = ['PHYSICS'] as const
export type Subject = (typeof SUBJECTS)[number]

/**
 * Jurisdiction key, e.g. `CN-GZ`. Typed as a string so a new province or a
 * national (`CN`) pack is pure data — the engine never branches on it.
 */
export type Jurisdiction = string

/** The full versioned standard for one exam target. */
export interface ExamProfile {
  readonly id: string
  readonly jurisdiction: Jurisdiction
  readonly stage: ExamStage
  readonly subject: Subject
  readonly year: number
  readonly curriculumStandard: readonly SourceRef[]
  readonly paperBlueprint: PaperBlueprint
  readonly contentScope: ContentScope
  readonly questionTaxonomy: QuestionTaxonomy
  readonly competencyModel: CompetencyModel
  readonly answerStandard: AnswerStandard
  readonly scoringStandard: ScoringStandard
  readonly officialSources: readonly OfficialSourceRef[]
}

/** The identity a profile is looked up by. */
export interface ProfileTarget {
  readonly jurisdiction: Jurisdiction
  readonly stage: ExamStage
  readonly subject: Subject
  readonly year: number
}

/** The canonical key of a target — `jurisdiction:stage:subject:year`. */
export const targetKey = (target: ProfileTarget): string =>
  `${target.jurisdiction}:${target.stage}:${target.subject}:${target.year}`

/**
 * Cross-field integrity of a typed profile: the blueprint must be arithmetically
 * complete, the rubric and curriculum sources must actually be present, and the
 * competency model must name every core dimension. Empty means usable.
 */
export function profileIssues(profile: ExamProfile): readonly string[] {
  const issues: string[] = [...blueprintIssues(profile.paperBlueprint)]
  if (profile.curriculumStandard.length === 0) issues.push('档案缺少课程标准来源')
  if (profile.officialSources.length === 0) issues.push('档案缺少官方来源')
  const sourceIds = new Set(profile.officialSources.map((source) => source.id))
  if (!sourceIds.has(profile.scoringStandard.rubricSourceId)) {
    issues.push('评分标准引用的评分细则来源不在官方来源中')
  }
  const curriculumIds = new Set(profile.curriculumStandard.map((source) => source.id))
  for (const refId of profile.contentScope.standardRefIds) {
    if (!curriculumIds.has(refId)) issues.push(`考试范围引用的课程标准 ${refId} 不在课程来源中`)
  }
  if (!coversAllDimensions(profile.competencyModel)) issues.push('素养模型未覆盖全部核心素养维度')
  return issues
}

/** Run a nested validator, forwarding its (already path-qualified) issues. */
const take = <T>(
  result: ValidationResult<T>,
  issues: ValidationIssue[],
): T | undefined => {
  if (result.ok) return result.value
  for (const item of result.issues) issues.push(item)
  return undefined
}

/** Validate an exam profile value that arrived as external data. */
export function validateExamProfile(value: unknown, path: string): ValidationResult<ExamProfile> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const jurisdiction = readString(record, 'jurisdiction', path, issues)
  const stage = readOneOf(record, 'stage', EXAM_STAGES, path, issues)
  const subject = readOneOf(record, 'subject', SUBJECTS, path, issues)
  const year = readCount(record, 'year', path, issues)

  const curriculumStandard: SourceRef[] = []
  readArray(record, 'curriculumStandard', path, issues).forEach((raw, index) => {
    const ref = take(validateSourceRef(raw, `${path}.curriculumStandard[${index}]`), issues)
    if (ref !== undefined) curriculumStandard.push(ref)
  })
  const officialSources: OfficialSourceRef[] = []
  readArray(record, 'officialSources', path, issues).forEach((raw, index) => {
    const source = take(validateOfficialSourceRef(raw, `${path}.officialSources[${index}]`), issues)
    if (source !== undefined) officialSources.push(source)
  })

  const paperBlueprint = take(validatePaperBlueprint(record['paperBlueprint'], `${path}.paperBlueprint`), issues)
  const contentScope = take(validateContentScope(record['contentScope'], `${path}.contentScope`), issues)
  const questionTaxonomy = take(validateQuestionTaxonomy(record['questionTaxonomy'], `${path}.questionTaxonomy`), issues)
  const competencyModel = take(validateCompetencyModel(record['competencyModel'], `${path}.competencyModel`), issues)
  const answerStandard = take(validateAnswerStandard(record['answerStandard'], `${path}.answerStandard`), issues)
  const scoringStandard = take(validateScoringStandard(record['scoringStandard'], `${path}.scoringStandard`), issues)

  if (
    paperBlueprint === undefined ||
    contentScope === undefined ||
    questionTaxonomy === undefined ||
    competencyModel === undefined ||
    answerStandard === undefined ||
    scoringStandard === undefined
  ) {
    return { ok: false, issues }
  }
  const profile: ExamProfile = {
    id,
    jurisdiction,
    stage,
    subject,
    year,
    curriculumStandard,
    paperBlueprint,
    contentScope,
    questionTaxonomy,
    competencyModel,
    answerStandard,
    scoringStandard,
    officialSources,
  }
  if (issues.length > 0) return { ok: false, issues }
  const structural = profileIssues(profile)
  if (structural.length > 0) {
    return { ok: false, issues: structural.map((message) => issue(path, message)) }
  }
  return { ok: true, value: profile }
}
