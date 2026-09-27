import { describe, expect, it } from 'vitest'
import {
  EXAM_COMPLIANCE_STATUSES,
  learningExplanation,
  verifyExamCompliance,
  type DraftPaper,
  type ExamComplianceReport,
} from '../src/index.ts'
import {
  FIXTURE_PHYSICS_SUMMARY,
  FIXTURE_QUESTIONS,
  FIXTURE_ZK_PROFILE,
  fixturePaper,
} from './fixtures.ts'

const verify = (overrides: Partial<DraftPaper> = {}) =>
  verifyExamCompliance({
    profile: FIXTURE_ZK_PROFILE,
    paper: fixturePaper(overrides),
    physics: FIXTURE_PHYSICS_SUMMARY,
  })

const blocked = (overrides: Partial<DraftPaper>): ExamComplianceReport => {
  const result = verify(overrides)
  expect(result.status).toBe('BLOCKED')
  if (result.status === 'REFUSED') throw new Error(`unexpected refusal: ${result.code}`)
  return result.report
}

const codesOf = (report: ExamComplianceReport): readonly string[] =>
  report.violations.map((violation) => violation.code)

describe('Exam Compliance Verifier — the happy path', () => {
  it('produces a READY_FOR_TEACHER_REVIEW report covering every required item', () => {
    const result = verify()
    expect(result.status).toBe('READY_FOR_TEACHER_REVIEW')
    if (result.status === 'REFUSED') throw new Error('unexpected refusal')
    const report = result.report
    expect(report.status).toBe('READY_FOR_TEACHER_REVIEW')
    expect(report.activeSourceProfileId).toBe(FIXTURE_ZK_PROFILE.id)
    expect(report.generatedLabel).toBe('PHYSICSOS_SIMULATED_PAPER')
    expect(report.generatedLabelText).toBe('PhysicsOS 模拟试卷')
    expect(report.physicsVerifierId).toBe('physics-verifier')
    expect(report.physicsResultCount).toBe(4)
    expect(report.curriculumInScope).toBe(true)
    expect(report.paperStructureMatches).toBe(true)
    expect(report.questionTypesValid).toBe(true)
    expect(report.totalScoreValid).toBe(true)
    expect(report.knowledgeCoverage.missingTags).toEqual([])
    expect(report.difficulty.withinTarget).toBe(true)
    expect(report.answerStandardConformant).toBe(true)
    expect(report.scoringPointIssues).toEqual([])
    expect(report.violations).toEqual([])
    expect(report.checks).toHaveLength(10)
    expect(report.checks.every((check) => check.passed)).toBe(true)
  })

  it('does not adjudicate physics — the count is echoed, not judged', () => {
    const result = verifyExamCompliance({ profile: FIXTURE_ZK_PROFILE, paper: fixturePaper() })
    expect(result.status).toBe('READY_FOR_TEACHER_REVIEW')
    if (result.status === 'REFUSED') throw new Error('unexpected refusal')
    expect(result.report.physicsResultCount).toBe(0)
    expect(result.report.physicsVerifierId).toBe('')
  })

  it('never ends at an official status', () => {
    expect(EXAM_COMPLIANCE_STATUSES).not.toContain('official')
    for (const status of EXAM_COMPLIANCE_STATUSES) {
      expect(status.toLowerCase()).not.toContain('official')
    }
  })
})

describe('Exam Compliance Verifier — refusals', () => {
  it('refuses a fake-official artefact before producing a report', () => {
    const result = verify({ label: 'OFFICIAL_PAPER_CLAIM' })
    expect(result.status).toBe('REFUSED')
    if (result.status === 'REFUSED') {
      expect(result.code).toBe('EXAM_FAKE_OFFICIAL_CLAIM')
      expect(result.report).toBeNull()
    }
  })

  it('refuses a paper belonging to a different profile', () => {
    const result = verify({ profileId: 'TEST-FIXTURE-PROFILE-OTHER' })
    expect(result.status).toBe('REFUSED')
    if (result.status === 'REFUSED') expect(result.code).toBe('PROFILE_MISMATCH')
  })
})

describe('Exam Compliance Verifier — blocking findings', () => {
  it('blocks out-of-scope knowledge', () => {
    const questions = FIXTURE_QUESTIONS.map((question) =>
      question.id === 'TEST-FIXTURE-Q1'
        ? { ...question, knowledgeTags: ['TEST-FIXTURE-KP-NOT-IN-SCOPE'] }
        : question,
    )
    expect(codesOf(blocked({ questions }))).toContain('CURRICULUM_OUT_OF_SCOPE')
  })

  it('blocks a paper whose structure does not match the blueprint', () => {
    const questions = FIXTURE_QUESTIONS.filter((question) => question.id !== 'TEST-FIXTURE-Q4')
    expect(codesOf(blocked({ questions }))).toContain('STRUCTURE_MISMATCH')
  })

  it('blocks a question type the section does not allow', () => {
    const questions = FIXTURE_QUESTIONS.map((question) =>
      question.id === 'TEST-FIXTURE-Q1'
        ? { ...question, type: 'CALCULATION_SINGLE_MODEL' as const }
        : question,
    )
    expect(codesOf(blocked({ questions }))).toContain('INVALID_QUESTION_TYPE')
  })

  it('blocks a declared total that disagrees with the items or blueprint', () => {
    expect(codesOf(blocked({ declaredTotalScore: 41 }))).toContain('TOTAL_SCORE_MISMATCH')
  })

  it('blocks a teaching explanation used as an exam answer', () => {
    const questions = FIXTURE_QUESTIONS.map((question) =>
      question.id === 'TEST-FIXTURE-Q1'
        ? { ...question, answer: learningExplanation('[TEST FIXTURE] 教学讲解') }
        : question,
    )
    const report = blocked({ questions })
    expect(codesOf(report)).toContain('ANSWER_STANDARD')
    expect(report.answerStandardIssues[0]).toContain('LEARNING_EXPLANATION')
  })

  it('blocks a scoring split that does not sum to the allocated score', () => {
    const questions = FIXTURE_QUESTIONS.map((question) =>
      question.id === 'TEST-FIXTURE-Q3'
        ? { ...question, scoringPoints: question.scoringPoints.slice(0, 3) }
        : question,
    )
    expect(codesOf(blocked({ questions }))).toContain('SCORING_POINTS')
  })

  it('blocks too many questions sharing one model', () => {
    const questions = FIXTURE_QUESTIONS.map((question) => ({
      ...question,
      modelId: 'TEST-FIXTURE-MODEL-SAME',
    }))
    expect(codesOf(blocked({ questions }))).toContain('DUPLICATE_MODEL_RATIO')
  })

  it('blocks a difficulty distribution outside the target', () => {
    const questions = FIXTURE_QUESTIONS.map((question) => ({ ...question, difficulty: 'HARD' as const }))
    expect(codesOf(blocked({ questions }))).toContain('DIFFICULTY_OUT_OF_TARGET')
  })
})
