import { describe, expect, it } from 'vitest'
import {
  answerIssues,
  blueprintIssues,
  blueprintQuestionCount,
  blueprintTotalScore,
  categoryOf,
  coversAllDimensions,
  examSolution,
  examSolutionIssues,
  finalAnswer,
  learningExplanation,
  scoringPointIssues,
  scoringPointTotal,
  taxonomyHasType,
  validateAnswerStandard,
  validateCompetencyModel,
  validatePaperBlueprint,
  validateQuestionTaxonomy,
  type ScoringPoint,
  type ScoringStandard,
} from '../src/index.ts'
import {
  FIXTURE_ANSWER_STANDARD,
  FIXTURE_BLUEPRINT,
  FIXTURE_COMPETENCY,
  FIXTURE_SCORING_STANDARD,
  FIXTURE_TAXONOMY,
} from './fixtures.ts'

describe('question taxonomy', () => {
  it('maps every type to its family', () => {
    expect(categoryOf('CHOICE_SINGLE')).toBe('CHOICE')
    expect(categoryOf('CHOICE_MULTIPLE')).toBe('CHOICE')
    expect(categoryOf('INSTRUMENT_READING')).toBe('EXPERIMENT')
    expect(categoryOf('INQUIRY_EXPERIMENT')).toBe('EXPERIMENT')
    expect(categoryOf('CALCULATION_COMPREHENSIVE')).toBe('CALCULATION')
    expect(categoryOf('CONTEXTUAL_PROBLEM')).toBe('CONTEXTUAL')
  })

  it('reports listed and unlisted types', () => {
    expect(taxonomyHasType(FIXTURE_TAXONOMY, 'CHOICE_SINGLE')).toBe(true)
    expect(taxonomyHasType(FIXTURE_TAXONOMY, 'ERROR_ANALYSIS')).toBe(false)
  })

  it('validates external taxonomy values and refuses malformed ones', () => {
    expect(validateQuestionTaxonomy(FIXTURE_TAXONOMY, 'taxonomy').ok).toBe(true)
    expect(validateQuestionTaxonomy({ id: 'x', entries: [] }, 'taxonomy').ok).toBe(false)
    expect(
      validateQuestionTaxonomy({ id: 'x', entries: [{ type: 'NOT_A_TYPE', label: 'x' }] }, 'taxonomy')
        .ok,
    ).toBe(false)
  })
})

describe('competency model', () => {
  it('requires every core-competency dimension', () => {
    expect(coversAllDimensions(FIXTURE_COMPETENCY)).toBe(true)
    const partial = { ...FIXTURE_COMPETENCY, dimensions: FIXTURE_COMPETENCY.dimensions.slice(0, 3) }
    expect(coversAllDimensions(partial)).toBe(false)
  })

  it('validates external competency values', () => {
    expect(validateCompetencyModel(FIXTURE_COMPETENCY, 'competency').ok).toBe(true)
    expect(validateCompetencyModel({ id: 'x', dimensions: [{ dimension: 'NOPE', label: 'x' }] }, 'c').ok).toBe(
      false,
    )
  })
})

describe('answer levels — three distinct types', () => {
  it('keeps the three kinds discriminated by `kind`', () => {
    expect(finalAnswer('A').kind).toBe('FINAL_ANSWER')
    expect(examSolution([], '答：x').kind).toBe('EXAM_SOLUTION')
    expect(learningExplanation('x').kind).toBe('LEARNING_EXPLANATION')
  })

  it('accepts a conforming exam solution and rejects a missing step or wrong conclusion', () => {
    const conforming = examSolution(
      [
        { step: 'EQUATION', text: 'e' },
        { step: 'SUBSTITUTION', text: 's' },
        { step: 'RESULT', text: 'r' },
        { step: 'UNIT', text: 'u' },
      ],
      '答：结果',
    )
    expect(examSolutionIssues(conforming, FIXTURE_ANSWER_STANDARD.convention)).toEqual([])

    const missingUnit = examSolution(
      [
        { step: 'EQUATION', text: 'e' },
        { step: 'RESULT', text: 'r' },
      ],
      '答：结果',
    )
    expect(examSolutionIssues(missingUnit, FIXTURE_ANSWER_STANDARD.convention).length).toBeGreaterThan(0)

    const wrongConclusion = examSolution([{ step: 'EQUATION', text: 'e' }], '所以是 1N')
    expect(
      examSolutionIssues(wrongConclusion, FIXTURE_ANSWER_STANDARD.convention).some((message) =>
        message.includes('答：'),
      ),
    ).toBe(true)
  })

  it('rejects a teaching explanation used as an exam answer', () => {
    const issues = answerIssues(learningExplanation('教学讲解'), FIXTURE_ANSWER_STANDARD)
    expect(issues.length).toBe(1)
    expect(issues[0]).toContain('LEARNING_EXPLANATION')
  })

  it('accepts a final answer and rejects an empty one', () => {
    expect(answerIssues(finalAnswer('A'), FIXTURE_ANSWER_STANDARD)).toEqual([])
    expect(answerIssues(finalAnswer('   '), FIXTURE_ANSWER_STANDARD).length).toBe(1)
  })

  it('validates external answer standards', () => {
    expect(validateAnswerStandard(FIXTURE_ANSWER_STANDARD, 'answer').ok).toBe(true)
    const bad = {
      id: 'x',
      convention: { requiredSteps: [], conclusionPrefix: '' },
      finalAnswerRules: [],
      learningExplanationAllowedInExam: false,
    }
    expect(validateAnswerStandard(bad, 'answer').ok).toBe(false)
  })
})

describe('structured scoring points', () => {
  const split: readonly ScoringPoint[] = [
    { id: 'p1', score: 4, criterion: '方程', evidence: 'EQUATION' },
    { id: 'p2', score: 6, criterion: '结果', evidence: 'RESULT' },
  ]

  it('sums a split', () => {
    expect(scoringPointTotal(split)).toBe(10)
  })

  it('accepts a split that matches the allocated score', () => {
    expect(scoringPointIssues(split, 10, FIXTURE_SCORING_STANDARD)).toEqual([])
  })

  it('rejects a split that does not match the allocated score', () => {
    expect(scoringPointIssues(split, 12, FIXTURE_SCORING_STANDARD).length).toBeGreaterThan(0)
  })

  it('rejects evidence outside the standard and duplicate ids', () => {
    const narrow: ScoringStandard = { ...FIXTURE_SCORING_STANDARD, allowedEvidence: ['RESULT'] }
    expect(scoringPointIssues(split, 10, narrow).some((m) => m.includes('EQUATION'))).toBe(true)

    const duplicated: readonly ScoringPoint[] = [
      { id: 'p1', score: 5, criterion: 'a', evidence: 'RESULT' },
      { id: 'p1', score: 5, criterion: 'b', evidence: 'RESULT' },
    ]
    expect(scoringPointIssues(duplicated, 10, FIXTURE_SCORING_STANDARD).some((m) => m.includes('重复'))).toBe(
      true,
    )
  })
})

describe('paper blueprint arithmetic', () => {
  it('derives totals from the sections, never from a constant', () => {
    expect(blueprintTotalScore(FIXTURE_BLUEPRINT)).toBe(40)
    expect(blueprintQuestionCount(FIXTURE_BLUEPRINT)).toBe(4)
  })

  it('accepts a complete blueprint', () => {
    expect(blueprintIssues(FIXTURE_BLUEPRINT)).toEqual([])
    expect(validatePaperBlueprint(FIXTURE_BLUEPRINT, 'bp').ok).toBe(true)
  })

  it('reports an incomplete blueprint instead of defaulting', () => {
    expect(blueprintIssues({ ...FIXTURE_BLUEPRINT, totalScore: 999 })).toContain(
      '分卷分值合计与总分不一致',
    )
    expect(blueprintIssues({ ...FIXTURE_BLUEPRINT, sections: [] })).toContain('蓝图缺少分卷')
    expect(validatePaperBlueprint({ ...FIXTURE_BLUEPRINT, totalScore: 999 }, 'bp').ok).toBe(false)
  })
})
