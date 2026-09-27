/**
 * Answer levels — three distinct types, never one string.
 *
 * The defect the owner called out is a single free-text "answer" that blends an
 * exam final answer, an exam-convention worked solution and a teaching
 * explanation. They have different audiences and different rules, so they are
 * three discriminated types here:
 *
 *  - {@link FinalAnswer}          — the exam's final answer only.
 *  - {@link ExamSolution}         — exam-convention worked answer: 公式 → 代入
 *                                   → 结果 → 单位, ending 答：…
 *  - {@link LearningExplanation}  — the teaching explanation, correct for
 *                                   learning content and forbidden on a paper.
 *
 * {@link AnswerStandard} declares the convention a profile mandates; the
 * validators below check an answer against it. Any `kind` value that presents
 * exam output through the wrong level is a violation the compliance verifier
 * reports, not a formatting nit.
 */

import {
  isOneOf,
  readBoolean,
  readNonEmptyArray,
  readObject,
  readRecord,
  readString,
  readStringArray,
  issue,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'

/** The stages of an exam-convention worked answer, in order. */
export const ANSWER_STEPS = ['EQUATION', 'SUBSTITUTION', 'RESULT', 'UNIT'] as const
export type AnswerStep = (typeof ANSWER_STEPS)[number]

/** Exam final answer: value plus optional unit. */
export interface FinalAnswer {
  readonly kind: 'FINAL_ANSWER'
  readonly text: string
  readonly unit?: string
}

/** One stage of an {@link ExamSolution}. */
export interface ExamSolutionStep {
  readonly step: AnswerStep
  readonly text: string
}

/** Exam-convention worked answer: staged steps and a 答：… conclusion. */
export interface ExamSolution {
  readonly kind: 'EXAM_SOLUTION'
  readonly steps: readonly ExamSolutionStep[]
  readonly conclusion: string
}

/** Teaching explanation: narrative prose, not an exam answer. */
export interface LearningExplanation {
  readonly kind: 'LEARNING_EXPLANATION'
  readonly narrative: string
}

/** The three answer levels, discriminated by `kind`. */
export type AnswerLevel = FinalAnswer | ExamSolution | LearningExplanation

/** The convention a profile's answer standard mandates. */
export interface ExamSolutionConvention {
  readonly requiredSteps: readonly AnswerStep[]
  readonly conclusionPrefix: string
}

/** The profile's declared answer standard. */
export interface AnswerStandard {
  readonly id: string
  readonly convention: ExamSolutionConvention
  /** Rules the final answer must follow (wording comes from the source pack). */
  readonly finalAnswerRules: readonly string[]
  /** Whether a teaching explanation is acceptable on an exam paper (normally false). */
  readonly learningExplanationAllowedInExam: boolean
}

export const isAnswerStep = (value: unknown): value is AnswerStep => isOneOf(value, ANSWER_STEPS)

/** Build a final answer. */
export const finalAnswer = (text: string, unit?: string): FinalAnswer =>
  unit === undefined ? { kind: 'FINAL_ANSWER', text } : { kind: 'FINAL_ANSWER', text, unit }

/** Build an exam solution ending in a 答：… conclusion. */
export const examSolution = (
  steps: readonly ExamSolutionStep[],
  conclusion: string,
): ExamSolution => ({ kind: 'EXAM_SOLUTION', steps, conclusion })

/** Build a teaching explanation. */
export const learningExplanation = (narrative: string): LearningExplanation => ({
  kind: 'LEARNING_EXPLANATION',
  narrative,
})

/**
 * Check an {@link ExamSolution} against a convention: every required step must
 * appear in order, and the conclusion must open with the mandated prefix.
 * @returns the issues found; empty means conformant.
 */
export function examSolutionIssues(
  solution: ExamSolution,
  convention: ExamSolutionConvention,
): readonly string[] {
  const issues: string[] = []
  const present = solution.steps.map((step) => step.step)
  let cursor = 0
  for (const required of convention.requiredSteps) {
    const at = present.indexOf(required, cursor)
    if (at === -1) {
      issues.push(`考试作答缺少步骤 ${required}（要求顺序 ${convention.requiredSteps.join(' → ')}）`)
      continue
    }
    cursor = at + 1
  }
  if (!solution.conclusion.trim().startsWith(convention.conclusionPrefix)) {
    issues.push(`考试作答结论必须以「${convention.conclusionPrefix}」开头`)
  }
  return issues
}

/**
 * Check any answer level against a profile's answer standard.
 * A teaching explanation on a paper is the mixing defect, reported here.
 * @returns the issues found; empty means conformant.
 */
export function answerIssues(answer: AnswerLevel, standard: AnswerStandard): readonly string[] {
  switch (answer.kind) {
    case 'FINAL_ANSWER':
      return answer.text.trim().length > 0 ? [] : ['最终答案不能为空']
    case 'EXAM_SOLUTION':
      return examSolutionIssues(answer, standard.convention)
    case 'LEARNING_EXPLANATION':
      return standard.learningExplanationAllowedInExam
        ? []
        : ['考试作答不得使用教学讲解（LEARNING_EXPLANATION），必须使用 EXAM_SOLUTION']
  }
}

/** Validate an answer standard value that arrived as external data. */
export function validateAnswerStandard(
  value: unknown,
  path: string,
): ValidationResult<AnswerStandard> {
  const issues: ValidationIssue[] = []
  const record = readObject(value, path, issues)
  const id = readString(record, 'id', path, issues)
  const learningExplanationAllowedInExam = readBoolean(
    record,
    'learningExplanationAllowedInExam',
    path,
    issues,
  )
  const finalAnswerRules = readStringArray(record, 'finalAnswerRules', path, issues)
  const conventionPath = `${path}.convention`
  const convention = readRecord(record, 'convention', path, issues)
  const rawSteps = readNonEmptyArray(convention, 'requiredSteps', conventionPath, issues)
  const requiredSteps: AnswerStep[] = []
  rawSteps.forEach((raw, index) => {
    if (isAnswerStep(raw)) requiredSteps.push(raw)
    else issues.push(issue(`${conventionPath}.requiredSteps[${index}]`, '不是受支持的作答步骤'))
  })
  const conclusionPrefix = readString(convention, 'conclusionPrefix', conventionPath, issues)
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      id,
      convention: { requiredSteps, conclusionPrefix },
      finalAnswerRules,
      learningExplanationAllowedInExam,
    },
  }
}
