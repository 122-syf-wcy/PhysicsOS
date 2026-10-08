/**
 * The Exam Compliance Verifier — "is this a valid Guizhou paper?", distinct
 * from the Physics Verifier's "is the physics right?".
 *
 * This verifier owns exam compliance only: in-scope curriculum, a valid
 * question type, a valid score, a valid answer format, the difficulty target
 * and blueprint coverage. It does **not** adjudicate physics correctness — it
 * records how many physics results the external Physics Verifier supplied
 * ({@link PhysicsVerificationSummary}) and leaves that verdict to it. The report
 * ends at {@link ExamComplianceStatus} `READY_FOR_TEACHER_REVIEW`: the system
 * proposes, a teacher approves. It never ends at "official".
 */

import type { AttributedIssuer, PaperLabel } from './anti-fake-official.ts'
import { checkNotFakeOfficial, type FakeOfficialErrorCode } from './anti-fake-official.ts'
import { answerIssues } from './answer.ts'
import {
  blueprintSection,
  type DifficultyBucket,
} from './blueprint.ts'
import { outOfScopeTags } from './content-scope.ts'
import { profileIssues, type ExamProfile } from './profile.ts'
import {
  DIFFICULTY_LEVELS,
  duplicateModelRatio,
  type DifficultyLevel,
  type DraftQuestion,
} from './question.ts'
import { scoringPointIssues } from './scoring.ts'
import { taxonomyHasType } from './taxonomy.ts'

/** Engine tolerance for matching the difficulty target; not an official figure. */
export const DIFFICULTY_TOLERANCE = 0.1

/** The terminal statuses. `READY_FOR_TEACHER_REVIEW` is the success end; never "official". */
export const EXAM_COMPLIANCE_STATUSES = ['READY_FOR_TEACHER_REVIEW', 'BLOCKED'] as const
export type ExamComplianceStatus = (typeof EXAM_COMPLIANCE_STATUSES)[number]

/**
 * The external Physics Verifier's output, consumed structurally. This package
 * deliberately does not depend on `@physicsos/physics-verifier`: keeping the
 * dependency out is what keeps the two verifiers distinct.
 */
export interface PhysicsResultRecord {
  readonly questionId: string
  readonly verified: boolean
}

/** A summary the Physics Verifier hands to the exam verifier. */
export interface PhysicsVerificationSummary {
  readonly verifierId: string
  readonly results: readonly PhysicsResultRecord[]
}

/** A generated paper submitted for exam-compliance review. */
export interface DraftPaper {
  readonly id: string
  readonly label: PaperLabel
  readonly profileId: string
  readonly declaredTotalScore: number
  readonly questions: readonly DraftQuestion[]
  readonly attributedIssuer?: AttributedIssuer
  readonly bodyText?: string
}

/** One named check and whether it passed. */
export interface ExamComplianceCheck {
  readonly id: string
  readonly passed: boolean
  readonly detail: string
}

/** One blocking finding. */
export interface ExamComplianceViolation {
  readonly code: string
  readonly detail: string
}

/** Knowledge coverage of the blueprint's required tags. */
export interface KnowledgeCoverage {
  readonly requiredTags: readonly string[]
  readonly coveredTags: readonly string[]
  readonly missingTags: readonly string[]
}

/** Difficulty target vs actual. */
export interface DifficultyComparison {
  readonly target: readonly DifficultyBucket[]
  readonly actual: readonly DifficultyBucket[]
  readonly withinTarget: boolean
}

/** The compliance report. */
export interface ExamComplianceReport {
  readonly reportId: string
  readonly activeSourceProfileId: string
  readonly generatedLabel: PaperLabel
  readonly generatedLabelText: string
  readonly physicsVerifierId: string
  readonly physicsResultCount: number
  readonly curriculumInScope: boolean
  readonly outOfScopeKnowledgeTags: readonly string[]
  readonly paperStructureMatches: boolean
  readonly structureIssues: readonly string[]
  readonly questionTypesValid: boolean
  readonly invalidQuestionTypes: readonly string[]
  readonly totalScoreValid: boolean
  readonly declaredTotalScore: number
  readonly actualTotalScore: number
  readonly blueprintTotalScore: number
  readonly knowledgeCoverage: KnowledgeCoverage
  readonly difficulty: DifficultyComparison
  readonly answerStandardConformant: boolean
  readonly answerStandardIssues: readonly string[]
  readonly scoringPointIssues: readonly string[]
  readonly duplicateModelRatio: number
  readonly maxDuplicateModelRatio: number
  readonly checks: readonly ExamComplianceCheck[]
  readonly violations: readonly ExamComplianceViolation[]
  readonly status: ExamComplianceStatus
}

/** Why the verifier refused to produce a report. */
export type ExamComplianceRefusalCode = FakeOfficialErrorCode | 'PROFILE_MISMATCH' | 'PROFILE_INCOMPLETE'

/** Verification outcome: a report ending at a review status, or an explicit refusal. */
export type ExamComplianceResult =
  | { readonly status: ExamComplianceStatus; readonly report: ExamComplianceReport }
  | {
      readonly status: 'REFUSED'
      readonly code: ExamComplianceRefusalCode
      readonly reason: string
      readonly report: null
    }

/** The verifier input. */
export interface ExamComplianceInput {
  readonly profile: ExamProfile
  readonly paper: DraftPaper
  /** The external Physics Verifier's summary, if one was run. */
  readonly physics?: PhysicsVerificationSummary
}

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)]

const inScopeDetail = (outOfScope: readonly string[]): string =>
  outOfScope.length === 0 ? '全部知识点在考试范围内' : `超出范围：${outOfScope.join('、')}`

const joinOr = (items: readonly string[], fallback: string): string =>
  items.length === 0 ? fallback : items.join('；')

const difficultyRatios = (
  questions: readonly DraftQuestion[],
): readonly DifficultyBucket[] =>
  DIFFICULTY_LEVELS.map((level) => ({
    level,
    targetRatio:
      questions.length === 0
        ? 0
        : questions.filter((question) => question.difficulty === level).length / questions.length,
  }))

const levelOf = (
  buckets: readonly DifficultyBucket[],
  level: DifficultyLevel,
): DifficultyBucket | undefined => buckets.find((bucket) => bucket.level === level)

/**
 * Verify a paper's exam compliance against a profile.
 * @param input - the profile, the draft paper and the optional physics summary.
 * @returns a report ending at `READY_FOR_TEACHER_REVIEW`/`BLOCKED`, or a refusal.
 */
export function verifyExamCompliance(input: ExamComplianceInput): ExamComplianceResult {
  const { profile, paper } = input
  const gate = checkNotFakeOfficial({
    id: paper.id,
    label: paper.label,
    attributedIssuer: paper.attributedIssuer,
    bodyText: paper.bodyText,
  })
  if (!gate.ok) {
    return { status: 'REFUSED', code: gate.code, reason: gate.reason, report: null }
  }
  const profileProblems = profileIssues(profile)
  if (profileProblems.length > 0) {
    return { status: 'REFUSED', code: 'PROFILE_INCOMPLETE', reason: profileProblems.join('；'), report: null }
  }
  if (paper.profileId !== profile.id) {
    return {
      status: 'REFUSED',
      code: 'PROFILE_MISMATCH',
      reason: `试卷档案 id ${paper.profileId} 与当前激活档案 id ${profile.id} 不一致`,
      report: null,
    }
  }

  const blueprint = profile.paperBlueprint
  const questions = paper.questions

  /* Curriculum scope. */
  const allTags = unique(questions.flatMap((question) => question.knowledgeTags))
  const outOfScope = outOfScopeTags(profile.contentScope, allTags)
  const curriculumInScope = outOfScope.length === 0

  /* Paper structure vs the active blueprint. */
  const structureIssues: string[] = []
  const countBySection = new Map<string, number>()
  for (const question of questions) {
    countBySection.set(question.sectionId, (countBySection.get(question.sectionId) ?? 0) + 1)
  }
  for (const section of blueprint.sections) {
    const actual = countBySection.get(section.id) ?? 0
    if (actual !== section.questionCount) {
      structureIssues.push(`分卷 ${section.id} 题量 ${actual} 与蓝图 ${section.questionCount} 不符`)
    }
  }
  for (const sectionId of countBySection.keys()) {
    if (blueprintSection(blueprint, sectionId) === undefined) {
      structureIssues.push(`存在蓝图之外的分卷 ${sectionId}`)
    }
  }
  const paperStructureMatches = structureIssues.length === 0

  /* Question types: listed by the taxonomy and permitted by the section. */
  const invalidQuestionTypes: string[] = []
  for (const question of questions) {
    const section = blueprintSection(blueprint, question.sectionId)
    const listed = taxonomyHasType(profile.questionTaxonomy, question.type)
    const allowedInSection = section !== undefined && section.taxonomy.includes(question.type)
    if (!listed || !allowedInSection) invalidQuestionTypes.push(`${question.id}:${question.type}`)
  }
  const questionTypesValid = invalidQuestionTypes.length === 0

  /* Score arithmetic. */
  const actualTotalScore = questions.reduce((sum, question) => sum + question.score, 0)
  const blueprintTotal = blueprint.totalScore
  const totalScoreValid =
    paper.declaredTotalScore === actualTotalScore && actualTotalScore === blueprintTotal

  /* Knowledge coverage against the blueprint's constraints. */
  const constraints = blueprint.coverageConstraints
  const requiredTags = unique(constraints.flatMap((constraint) => constraint.requiredTags))
  const coveredTags = requiredTags.filter((tag) => allTags.includes(tag))
  const missingTags = requiredTags.filter((tag) => !coveredTags.includes(tag))
  const coverageIssues: string[] = []
  for (const constraint of constraints) {
    const minimum = constraint.minCount
    if (minimum === undefined) continue
    const hitting = questions.filter((question) =>
      question.knowledgeTags.some((tag) => constraint.requiredTags.includes(tag)),
    ).length
    if (hitting < minimum) {
      coverageIssues.push(`覆盖约束 ${constraint.id} 命中 ${hitting} 题，少于最小 ${minimum} 题`)
    }
  }

  /* Difficulty target vs actual. */
  const targetBuckets = blueprint.difficultyDistribution.buckets
  const actualBuckets = difficultyRatios(questions)
  const withinTarget = targetBuckets.every((target) => {
    const actual = levelOf(actualBuckets, target.level)
    return actual !== undefined && Math.abs(actual.targetRatio - target.targetRatio) <= DIFFICULTY_TOLERANCE
  })

  /* Answer and scoring standards. */
  const answerStandardIssues = questions.flatMap((question) =>
    answerIssues(question.answer, profile.answerStandard).map((message) => `${question.id}: ${message}`),
  )
  const scoringIssues = questions.flatMap((question) =>
    scoringPointIssues(question.scoringPoints, question.score, profile.scoringStandard).map(
      (message) => `${question.id}: ${message}`,
    ),
  )
  const answerStandardConformant = answerStandardIssues.length === 0
  const scoringPointsValid = scoringIssues.length === 0

  /* Duplicate-model cap. */
  const actualDuplicateRatio = duplicateModelRatio(questions)
  const duplicateWithinCap = actualDuplicateRatio <= blueprint.maxDuplicateModelRatio

  const checks: ExamComplianceCheck[] = [
    { id: 'anti-fake-official', passed: true, detail: `已标注为 ${gate.displayText}` },
    { id: 'curriculum-in-scope', passed: curriculumInScope, detail: inScopeDetail(outOfScope) },
    { id: 'paper-structure', passed: paperStructureMatches, detail: joinOr(structureIssues, '分卷结构与蓝图一致') },
    { id: 'question-types', passed: questionTypesValid, detail: joinOr(invalidQuestionTypes, '题型均合法') },
    { id: 'total-score', passed: totalScoreValid, detail: `声明 ${paper.declaredTotalScore} / 实际 ${actualTotalScore} / 蓝图 ${blueprintTotal}` },
    { id: 'knowledge-coverage', passed: missingTags.length === 0 && coverageIssues.length === 0, detail: joinOr([...missingTags, ...coverageIssues], '覆盖约束满足') },
    { id: 'difficulty-target', passed: withinTarget, detail: `容差 ${DIFFICULTY_TOLERANCE}` },
    { id: 'answer-standard', passed: answerStandardConformant, detail: joinOr(answerStandardIssues, '作答符合考试约定') },
    { id: 'scoring-points', passed: scoringPointsValid, detail: joinOr(scoringIssues, '评分点拆分合法') },
    { id: 'duplicate-model-ratio', passed: duplicateWithinCap, detail: `实际 ${actualDuplicateRatio.toFixed(2)} / 上限 ${blueprint.maxDuplicateModelRatio}` },
  ]

  const violations: ExamComplianceViolation[] = []
  if (!curriculumInScope) violations.push({ code: 'CURRICULUM_OUT_OF_SCOPE', detail: outOfScope.join('、') })
  if (!paperStructureMatches) violations.push({ code: 'STRUCTURE_MISMATCH', detail: structureIssues.join('；') })
  if (!questionTypesValid) violations.push({ code: 'INVALID_QUESTION_TYPE', detail: invalidQuestionTypes.join('、') })
  if (!totalScoreValid) {
    violations.push({
      code: 'TOTAL_SCORE_MISMATCH',
      detail: `声明 ${paper.declaredTotalScore} / 实际 ${actualTotalScore} / 蓝图 ${blueprintTotal}`,
    })
  }
  if (missingTags.length > 0 || coverageIssues.length > 0) {
    violations.push({ code: 'KNOWLEDGE_COVERAGE', detail: joinOr([...missingTags, ...coverageIssues], '') })
  }
  if (!withinTarget) violations.push({ code: 'DIFFICULTY_OUT_OF_TARGET', detail: '实际难度分布超出目标容差' })
  if (!answerStandardConformant) violations.push({ code: 'ANSWER_STANDARD', detail: answerStandardIssues.join('；') })
  if (!scoringPointsValid) violations.push({ code: 'SCORING_POINTS', detail: scoringIssues.join('；') })
  if (!duplicateWithinCap) {
    violations.push({ code: 'DUPLICATE_MODEL_RATIO', detail: `${actualDuplicateRatio.toFixed(2)} > ${blueprint.maxDuplicateModelRatio}` })
  }

  const status: ExamComplianceStatus = violations.length === 0 ? 'READY_FOR_TEACHER_REVIEW' : 'BLOCKED'
  const report: ExamComplianceReport = {
    reportId: `${profile.id}:${paper.id}`,
    activeSourceProfileId: profile.id,
    generatedLabel: paper.label,
    generatedLabelText: gate.displayText,
    physicsVerifierId: input.physics?.verifierId ?? '',
    physicsResultCount: input.physics?.results.length ?? 0,
    curriculumInScope,
    outOfScopeKnowledgeTags: outOfScope,
    paperStructureMatches,
    structureIssues,
    questionTypesValid,
    invalidQuestionTypes,
    totalScoreValid,
    declaredTotalScore: paper.declaredTotalScore,
    actualTotalScore,
    blueprintTotalScore: blueprintTotal,
    knowledgeCoverage: { requiredTags, coveredTags, missingTags },
    difficulty: { target: targetBuckets, actual: actualBuckets, withinTarget },
    answerStandardConformant,
    answerStandardIssues,
    scoringPointIssues: scoringIssues,
    duplicateModelRatio: actualDuplicateRatio,
    maxDuplicateModelRatio: blueprint.maxDuplicateModelRatio,
    checks,
    violations,
    status,
  }
  return { status, report }
}
