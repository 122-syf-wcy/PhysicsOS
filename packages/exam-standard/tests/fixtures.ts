/**
 * Clearly-labelled synthetic fixtures.
 *
 * NOTHING here is a real Guizhou structure, count, score, rubric or source.
 * Every id, title and URL is prefixed `TEST-FIXTURE` and every URL uses the
 * reserved `.invalid` TLD (guaranteed non-resolving), so a leak of these values
 * into anything user-facing is obvious. The numbers are deliberately arbitrary
 * (40 分 / 30 分钟, 60 分 for the 高考-shaped fixture) precisely so that tests
 * can prove the runtime reads structure from data rather than hardcoding it.
 */

import {
  examSolution,
  finalAnswer,
  type AnswerStandard,
  type CompetencyModel,
  type ContentScope,
  type DraftPaper,
  type DraftQuestion,
  type ExamProfile,
  type ExamStage,
  type ExamStandardPack,
  type OfficialSourceRef,
  type PackReviewStatus,
  type PaperBlueprint,
  type QuestionTaxonomy,
  type ScoringPoint,
  type ScoringStandard,
} from '../src/index.ts'

export const FIXTURE_VERSION = 'TEST-FIXTURE-1.0.0'

const source = (
  id: string,
  authority: OfficialSourceRef['authority'],
  scope: OfficialSourceRef['scope'],
): OfficialSourceRef => ({
  id,
  authority,
  title: `[TEST FIXTURE] 合成来源 ${id}（非真实官方文件）`,
  issuedAt: '2000-01-01',
  sourceUrl: `https://test-fixture.invalid/${id.toLowerCase()}`,
  scope,
})

export const FIXTURE_SOURCE_CURRICULUM = source(
  'TEST-FIXTURE-SRC-CURRICULUM',
  'MOE',
  'CURRICULUM',
)
export const FIXTURE_SOURCE_POLICY = source(
  'TEST-FIXTURE-SRC-POLICY',
  'GZ_EDUCATION_DEPARTMENT',
  'EXAM_POLICY',
)
export const FIXTURE_SOURCE_STRUCTURE = source(
  'TEST-FIXTURE-SRC-STRUCTURE',
  'GZ_EXAMINATION_AUTHORITY',
  'PAPER_STRUCTURE',
)
export const FIXTURE_SOURCE_SCORING = source(
  'TEST-FIXTURE-SRC-SCORING',
  'GZ_EXAMINATION_AUTHORITY',
  'SCORING',
)
export const FIXTURE_SOURCE_ANSWER = source(
  'TEST-FIXTURE-SRC-ANSWER',
  'GZ_EXAMINATION_AUTHORITY',
  'ANSWER_FORMAT',
)

export const FIXTURE_SOURCES: readonly OfficialSourceRef[] = [
  FIXTURE_SOURCE_CURRICULUM,
  FIXTURE_SOURCE_POLICY,
  FIXTURE_SOURCE_STRUCTURE,
  FIXTURE_SOURCE_SCORING,
  FIXTURE_SOURCE_ANSWER,
]

export const FIXTURE_TAXONOMY: QuestionTaxonomy = {
  id: 'TEST-FIXTURE-TAXONOMY',
  entries: [
    { type: 'CHOICE_SINGLE', label: '[TEST FIXTURE] 单项选择', category: 'CHOICE' },
    { type: 'CHOICE_MULTIPLE', label: '[TEST FIXTURE] 多项选择', category: 'CHOICE' },
    {
      type: 'CALCULATION_SINGLE_MODEL',
      label: '[TEST FIXTURE] 单模型计算',
      category: 'CALCULATION',
    },
    {
      type: 'CALCULATION_MULTI_PROCESS',
      label: '[TEST FIXTURE] 多过程计算',
      category: 'CALCULATION',
    },
    {
      type: 'CALCULATION_COMPREHENSIVE',
      label: '[TEST FIXTURE] 综合计算',
      category: 'CALCULATION',
    },
    { type: 'INSTRUMENT_READING', label: '[TEST FIXTURE] 仪器读数', category: 'EXPERIMENT' },
    { type: 'CONTEXTUAL_PROBLEM', label: '[TEST FIXTURE] 情境问题', category: 'CONTEXTUAL' },
  ],
}

export const FIXTURE_COMPETENCY: CompetencyModel = {
  id: 'TEST-FIXTURE-COMPETENCY',
  dimensions: [
    { dimension: 'PHYSICS_CONCEPT', label: '[TEST FIXTURE] 物理观念' },
    { dimension: 'SCIENTIFIC_THINKING', label: '[TEST FIXTURE] 科学思维' },
    { dimension: 'SCIENTIFIC_INQUIRY', label: '[TEST FIXTURE] 科学探究' },
    { dimension: 'SCIENTIFIC_ATTITUDE', label: '[TEST FIXTURE] 科学态度与责任' },
  ],
}

export const FIXTURE_ANSWER_STANDARD: AnswerStandard = {
  id: 'TEST-FIXTURE-ANSWER',
  convention: {
    requiredSteps: ['EQUATION', 'SUBSTITUTION', 'RESULT', 'UNIT'],
    conclusionPrefix: '答：',
  },
  finalAnswerRules: ['[TEST FIXTURE] 只写最终答案'],
  learningExplanationAllowedInExam: false,
}

export const FIXTURE_SCORING_STANDARD: ScoringStandard = {
  id: 'TEST-FIXTURE-SCORING',
  rubricSourceId: FIXTURE_SOURCE_SCORING.id,
  allowedEvidence: ['EQUATION', 'SUBSTITUTION', 'RESULT', 'UNIT', 'DIRECTION', 'REASONING'],
}

export const FIXTURE_CONTENT_SCOPE: ContentScope = {
  id: 'TEST-FIXTURE-SCOPE',
  standardRefIds: [FIXTURE_SOURCE_CURRICULUM.id],
  entries: [
    {
      id: 'TEST-FIXTURE-SCOPE-1',
      label: '[TEST FIXTURE] 范围条目',
      tags: ['TEST-FIXTURE-KP-A', 'TEST-FIXTURE-KP-B', 'TEST-FIXTURE-KP-C'],
    },
  ],
  exclusions: ['TEST-FIXTURE-KP-EXCLUDED'],
}

export const FIXTURE_SECTION_CHOICE = 'TEST-FIXTURE-SEC-CHOICE'
export const FIXTURE_SECTION_CALC = 'TEST-FIXTURE-SEC-CALC'

/** 2×5 + 10 + 20 = 40. Arbitrary, and obviously not a real paper. */
export const FIXTURE_BLUEPRINT: PaperBlueprint = {
  totalScore: 40,
  durationMinutes: 30,
  sections: [
    {
      id: FIXTURE_SECTION_CHOICE,
      title: '[TEST FIXTURE] 选择题',
      questionCount: 2,
      taxonomy: ['CHOICE_SINGLE', 'CHOICE_MULTIPLE'],
      scoring: { kind: 'UNIFORM', scorePerQuestion: 5 },
    },
    {
      id: FIXTURE_SECTION_CALC,
      title: '[TEST FIXTURE] 计算题',
      questionCount: 2,
      taxonomy: ['CALCULATION_SINGLE_MODEL', 'CALCULATION_MULTI_PROCESS'],
      scoring: { kind: 'PER_SLOT', scores: [10, 20] },
    },
  ],
  coverageConstraints: [
    {
      id: 'TEST-FIXTURE-COV-1',
      description: '[TEST FIXTURE] 覆盖 A 与 B',
      kind: 'KNOWLEDGE',
      requiredTags: ['TEST-FIXTURE-KP-A', 'TEST-FIXTURE-KP-B'],
    },
  ],
  difficultyDistribution: {
    buckets: [
      { level: 'EASY', targetRatio: 0.5 },
      { level: 'MEDIUM', targetRatio: 0.3 },
      { level: 'HARD', targetRatio: 0.2 },
    ],
  },
  maxDuplicateModelRatio: 0.5,
}

/** A deliberately different shape (3×20 = 60) to prove nothing is hardcoded. */
export const FIXTURE_GK_BLUEPRINT: PaperBlueprint = {
  totalScore: 60,
  durationMinutes: 45,
  sections: [
    {
      id: 'TEST-FIXTURE-GK-SEC',
      title: '[TEST FIXTURE] 高考形状分卷',
      questionCount: 3,
      taxonomy: ['CHOICE_SINGLE', 'CALCULATION_COMPREHENSIVE'],
      scoring: { kind: 'UNIFORM', scorePerQuestion: 20 },
    },
  ],
  coverageConstraints: [
    {
      id: 'TEST-FIXTURE-GK-COV',
      description: '[TEST FIXTURE] 覆盖 A',
      kind: 'KNOWLEDGE',
      requiredTags: ['TEST-FIXTURE-KP-A'],
    },
  ],
  difficultyDistribution: {
    buckets: [
      { level: 'EASY', targetRatio: 1 / 3 },
      { level: 'MEDIUM', targetRatio: 1 / 3 },
      { level: 'HARD', targetRatio: 1 / 3 },
    ],
  },
  maxDuplicateModelRatio: 1,
}

export interface FixtureProfileOptions {
  readonly id: string
  readonly stage: ExamStage
  readonly year: number
  readonly jurisdiction?: string
  readonly blueprint?: PaperBlueprint
}

export function makeFixtureProfile(options: FixtureProfileOptions): ExamProfile {
  return {
    id: options.id,
    jurisdiction: options.jurisdiction ?? 'CN-TF',
    stage: options.stage,
    subject: 'PHYSICS',
    year: options.year,
    curriculumStandard: [
      {
        id: FIXTURE_SOURCE_CURRICULUM.id,
        title: FIXTURE_SOURCE_CURRICULUM.title,
        sourceUrl: FIXTURE_SOURCE_CURRICULUM.sourceUrl,
      },
    ],
    paperBlueprint: options.blueprint ?? FIXTURE_BLUEPRINT,
    contentScope: FIXTURE_CONTENT_SCOPE,
    questionTaxonomy: FIXTURE_TAXONOMY,
    competencyModel: FIXTURE_COMPETENCY,
    answerStandard: FIXTURE_ANSWER_STANDARD,
    scoringStandard: FIXTURE_SCORING_STANDARD,
    officialSources: FIXTURE_SOURCES,
  }
}

export const FIXTURE_ZK_PROFILE = makeFixtureProfile({
  id: 'TEST-FIXTURE-PROFILE-ZK-2026',
  stage: 'ZHONGKAO',
  year: 2026,
})

export const FIXTURE_GK_PROFILE = makeFixtureProfile({
  id: 'TEST-FIXTURE-PROFILE-GK-2026',
  stage: 'GAOKAO',
  year: 2026,
  blueprint: FIXTURE_GK_BLUEPRINT,
})

export interface FixturePackOptions {
  readonly id: string
  readonly stage: ExamStage
  readonly year: number
  readonly reviewStatus?: PackReviewStatus
  readonly withProfile?: boolean
  readonly jurisdiction?: string
  readonly blueprint?: PaperBlueprint
}

export function makeFixturePack(options: FixturePackOptions): ExamStandardPack {
  const reviewStatus = options.reviewStatus ?? 'CONFIRMED'
  const withProfile = options.withProfile ?? reviewStatus === 'CONFIRMED'
  const jurisdiction = options.jurisdiction ?? 'CN-TF'
  const profile = withProfile
    ? makeFixtureProfile({
        id: `${options.id}:PROFILE`,
        stage: options.stage,
        year: options.year,
        jurisdiction,
        blueprint: options.blueprint ?? FIXTURE_BLUEPRINT,
      })
    : null
  return {
    id: options.id,
    version: FIXTURE_VERSION,
    reviewStatus,
    jurisdiction,
    stage: options.stage,
    subject: 'PHYSICS',
    year: options.year,
    sources: withProfile ? FIXTURE_SOURCES : [],
    profile,
  }
}

export const FIXTURE_ZK_PACK: ExamStandardPack = {
  id: 'TEST-FIXTURE-PACK-ZK-2026',
  version: FIXTURE_VERSION,
  reviewStatus: 'CONFIRMED',
  jurisdiction: 'CN-TF',
  stage: 'ZHONGKAO',
  subject: 'PHYSICS',
  year: 2026,
  sources: FIXTURE_SOURCES,
  profile: FIXTURE_ZK_PROFILE,
}

export const FIXTURE_GK_PACK: ExamStandardPack = {
  id: 'TEST-FIXTURE-PACK-GK-2026',
  version: FIXTURE_VERSION,
  reviewStatus: 'CONFIRMED',
  jurisdiction: 'CN-TF',
  stage: 'GAOKAO',
  subject: 'PHYSICS',
  year: 2026,
  sources: FIXTURE_SOURCES,
  profile: FIXTURE_GK_PROFILE,
}

export const FIXTURE_DRAFT_PACK: ExamStandardPack = {
  id: 'TEST-FIXTURE-PACK-ZK-2027',
  version: FIXTURE_VERSION,
  reviewStatus: 'DRAFT',
  jurisdiction: 'CN-TF',
  stage: 'ZHONGKAO',
  subject: 'PHYSICS',
  year: 2027,
  sources: [],
  profile: null,
}

/* --------------------------------------------------------- questions -- */

const point = (id: string, score: number, evidence: ScoringPoint['evidence']): ScoringPoint => ({
  id,
  score,
  criterion: `[TEST FIXTURE] 评分点 ${id}`,
  evidence,
})

const SOLUTION_STEPS = [
  { step: 'EQUATION', text: '[TEST FIXTURE] 公式' },
  { step: 'SUBSTITUTION', text: '[TEST FIXTURE] 代入' },
  { step: 'RESULT', text: '[TEST FIXTURE] 结果' },
  { step: 'UNIT', text: '[TEST FIXTURE] 单位' },
] as const

/** A single-model calculation answer, 10 分 split EQUATION 4 / SUBSTITUTION 3 / RESULT 2 / UNIT 1. */
const CALC_SMALL_ANSWER = examSolution([...SOLUTION_STEPS], '答：[TEST FIXTURE] 结果')

/** A multi-process calculation answer, 20 分 split EQUATION 8 / SUBSTITUTION 6 / RESULT 4 / UNIT 2. */
const CALC_LARGE_ANSWER = examSolution([...SOLUTION_STEPS], '答：[TEST FIXTURE] 结果')

const BASE_QUESTION: DraftQuestion = {
  id: 'TEST-FIXTURE-Q1',
  type: 'CHOICE_SINGLE',
  knowledgeTags: ['TEST-FIXTURE-KP-A'],
  competency: ['PHYSICS_CONCEPT'],
  reasoning: ['[TEST FIXTURE] 推理'],
  representation: ['文字'],
  difficulty: 'EASY',
  context: '[TEST FIXTURE] 情境',
  score: 5,
  answer: finalAnswer('A'),
  scoringPoints: [point('TEST-FIXTURE-Q1-SP1', 5, 'RESULT')],
  sectionId: FIXTURE_SECTION_CHOICE,
}

export const FIXTURE_QUESTIONS: readonly DraftQuestion[] = [
  BASE_QUESTION,
  {
    ...BASE_QUESTION,
    id: 'TEST-FIXTURE-Q2',
    type: 'CHOICE_MULTIPLE',
    knowledgeTags: ['TEST-FIXTURE-KP-B'],
    competency: ['SCIENTIFIC_THINKING'],
    answer: finalAnswer('AB'),
    scoringPoints: [point('TEST-FIXTURE-Q2-SP1', 5, 'RESULT')],
  },
  {
    ...BASE_QUESTION,
    id: 'TEST-FIXTURE-Q3',
    type: 'CALCULATION_SINGLE_MODEL',
    knowledgeTags: ['TEST-FIXTURE-KP-A'],
    competency: ['SCIENTIFIC_THINKING'],
    difficulty: 'MEDIUM',
    score: 10,
    answer: CALC_SMALL_ANSWER,
    scoringPoints: [
      point('TEST-FIXTURE-Q3-SP1', 4, 'EQUATION'),
      point('TEST-FIXTURE-Q3-SP2', 3, 'SUBSTITUTION'),
      point('TEST-FIXTURE-Q3-SP3', 2, 'RESULT'),
      point('TEST-FIXTURE-Q3-SP4', 1, 'UNIT'),
    ],
    modelId: 'TEST-FIXTURE-MODEL-1',
    sectionId: FIXTURE_SECTION_CALC,
  },
  {
    ...BASE_QUESTION,
    id: 'TEST-FIXTURE-Q4',
    type: 'CALCULATION_MULTI_PROCESS',
    knowledgeTags: ['TEST-FIXTURE-KP-B'],
    competency: ['PHYSICS_CONCEPT', 'SCIENTIFIC_THINKING'],
    difficulty: 'HARD',
    score: 20,
    answer: CALC_LARGE_ANSWER,
    scoringPoints: [
      point('TEST-FIXTURE-Q4-SP1', 8, 'EQUATION'),
      point('TEST-FIXTURE-Q4-SP2', 6, 'SUBSTITUTION'),
      point('TEST-FIXTURE-Q4-SP3', 4, 'RESULT'),
      point('TEST-FIXTURE-Q4-SP4', 2, 'UNIT'),
    ],
    modelId: 'TEST-FIXTURE-MODEL-2',
    sectionId: FIXTURE_SECTION_CALC,
  },
]

/** Build a draft question from a base, for BLOCKED-case variants. */
export const fixtureQuestion = (overrides: Partial<DraftQuestion>): DraftQuestion => ({
  ...BASE_QUESTION,
  ...overrides,
})

export const FIXTURE_PHYSICS_SUMMARY = {
  verifierId: 'physics-verifier',
  results: FIXTURE_QUESTIONS.map((question) => ({ questionId: question.id, verified: true })),
}

export function fixturePaper(overrides: Partial<DraftPaper> = {}): DraftPaper {
  return {
    id: 'TEST-FIXTURE-PAPER',
    label: 'PHYSICSOS_SIMULATED_PAPER',
    profileId: FIXTURE_ZK_PROFILE.id,
    declaredTotalScore: 40,
    questions: FIXTURE_QUESTIONS,
    ...overrides,
  }
}
