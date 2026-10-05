import { describe, expect, it } from 'vitest'
import {
  EXAM_BLUEPRINTS,
  blueprintById,
  proposeSpecTable,
  runChecks,
  solveFindings,
  renderAnswerMarkdown,
  renderPaperMarkdown,
  documentHash,
  DIFFICULTY_PRESETS,
  coefficientLabel,
  coefficientLevel,
  mixCoefficient,
  paperCoefficient,
  specCoefficient,
} from '../src/index.ts'
import type { ExamBlueprint, PaperDocument, PaperJob, PaperRequest, SpecRow } from '../src/index.ts'

/* ---------------------------------------------------------- fixtures -- */

const zkRequest: PaperRequest = {
  level: 'zhongkao',
  subjects: ['physics'],
  kind: 'mock',
  totalScore: 90,
  minutes: 150,
  chapters: ['人教版九年级·全册'],
  exclude: [],
  difficulty: { basic: 0.75, medium: 0.2, hard: 0.05 },
  targetYear: 2027,
  textbook: '人教版',
}

const sectionTotal = (blueprint: ExamBlueprint): number =>
  blueprint.sections.flatMap((section) => section.slots).reduce((sum, slot) => sum + slot.score, 0)

/** Deep-mutable view of a document for breakage tests. */
type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T

/** A mutable copy of the fixture for breakage tests. */
const mutable = (base: PaperDocument): DeepMutable<PaperDocument> =>
  JSON.parse(JSON.stringify(base)) as DeepMutable<PaperDocument>

const doc = (overrides: Partial<PaperDocument> = {}): PaperDocument => ({
  id: 'doc-1',
  title: '测试卷',
  level: 'zhongkao',
  kind: 'mock',
  header: {
    examName: '贵州省初中学业水平考试',
    grade: '九年级',
    subjectLine: '物理部分',
    totalScore: 90,
    minutes: 150,
    candidateFields: ['姓名', '班级', '考号'],
  },
  specTable: [
    {
      questionNo: 1,
      sectionTitle: '一、选择题',
      kind: 'choice-single',
      score: 3,
      knowledge: ['浮力'],
      ability: '应用',
      difficulty: 'basic',
    },
    {
      questionNo: 2,
      sectionTitle: '六、综合应用题',
      kind: 'calculation',
      score: 87,
      knowledge: ['压强'],
      ability: '应用',
      difficulty: 'hard',
    },
  ],
  sections: [
    {
      title: '一、选择题',
      items: [
        {
          number: 1,
          subject: 'physics',
          kind: 'choice-single',
          score: 3,
          stem: '关于浮力，下列说法正确的是（ ）',
          options: ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'],
          answer: {
            result: 'C',
            steps: ['漂浮时 $F_{\\text{浮}}=G$。'],
            gradingPoints: [{ text: '选对', score: 3 }],
          },
          knowledge: ['浮力'],
          ability: '应用',
          difficulty: 'basic',
          status: 'draft',
        },
      ],
    },
    {
      title: '六、综合应用题',
      items: [
        {
          number: 2,
          subject: 'physics',
          kind: 'calculation',
          score: 87,
          stem: '一圆柱形容器装水，求水对容器底部的压强。',
          answer: {
            result: '$p=2\\times10^{3}\\ \\mathrm{Pa}$',
            steps: [
              '$p=\\rho gh=1.0\\times10^{3}\\times10\\times0.2=2\\times10^{3}\\ \\mathrm{Pa}$',
            ],
            gradingPoints: [
              { text: '公式正确', score: 40 },
              { text: '结果正确', score: 47 },
            ],
          },
          knowledge: ['压强'],
          ability: '应用',
          difficulty: 'hard',
          status: 'draft',
        },
      ],
    },
  ],
  policyLabel: '依据已核实政策编制的训练卷',
  ...overrides,
})

/* ------------------------------------------------------- blueprints -- */

describe('exam blueprints', () => {
  it('slot scores sum to the declared totals', () => {
    for (const blueprint of EXAM_BLUEPRINTS) {
      expect(sectionTotal(blueprint)).toBe(blueprint.totalScore)
    }
  })

  it('中考 physics structure carries the real section grammar', () => {
    const zk = blueprintById('gz-zk-physics')!
    expect(zk.totalScore).toBe(90)
    /* 2024 省卷实测 22 题：单选 6 + 多选 2 + 填空 4 + 作图 3 + 简答 2 + 实验 3 + 计算 2。 */
    expect(zk.sections.map((section) => section.slots.length)).toEqual([8, 4, 3, 2, 3, 2])
    expect(zk.sections[0]?.slots.at(-1)?.kind).toBe('choice-multi')
  })

  it('ships pending until its source papers are verified', () => {
    for (const blueprint of EXAM_BLUEPRINTS) expect(blueprint.status).toBe('pending')
  })
})

describe('proposeSpecTable', () => {
  it('expands every slot of a full mock paper into a numbered row', () => {
    const rows = proposeSpecTable(blueprintById('gz-zk-physics')!, zkRequest)
    expect(rows).toHaveLength(22)
    expect(rows.map((row) => row.questionNo)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1))
    expect(rows.reduce((sum, row) => sum + row.score, 0)).toBe(90)
  })

  it('scales stage papers down while keeping the section grammar', () => {
    const rows = proposeSpecTable(blueprintById('gz-zk-physics')!, { ...zkRequest, kind: 'weekly' })
    expect(rows.length).toBeLessThan(22)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('marks difficulty as 教研估计 spread over the request mix', () => {
    const rows = proposeSpecTable(blueprintById('gz-zk-physics')!, zkRequest)
    const hard = rows.filter((row) => row.difficulty === 'hard').length
    expect(hard).toBe(Math.round(22 * 0.05))
  })

  it('seeds knowledge + chapter from the ranked pool into hint-less slots', () => {
    const pool = [{ knowledge: '欧姆定律', chapter: '第十七章 欧姆定律' }, { knowledge: '浮力' }]
    const rows = proposeSpecTable(blueprintById('gz-zk-physics')!, zkRequest, pool)
    expect(rows[0]?.knowledge).toEqual(['欧姆定律'])
    expect(rows[0]?.chapter).toBe('第十七章 欧姆定律')
    expect(rows[1]?.knowledge).toEqual(['浮力'])
    /* Pool exhausted → remaining rows stay empty for the teacher to fill. */
    expect(rows[2]?.knowledge).toEqual([])
    /* A slot's own hint always wins over the pool. */
    const blueprint = blueprintById('gz-zk-physics')!
    const hinted = {
      ...blueprint,
      sections: [
        {
          ...blueprint.sections[0]!,
          slots: [{ ...blueprint.sections[0]!.slots[0]!, knowledgeHint: '声现象' }],
        },
      ],
    }
    const hintedRows = proposeSpecTable(hinted, { ...zkRequest, kind: 'weekly' }, pool)
    expect(hintedRows[0]?.knowledge).toEqual(['声现象'])
  })
})

/* ----------------------------------------------------------- checks -- */

describe('runChecks', () => {
  it('accepts a consistent draft', () => {
    /* No difficulty target on this request: the drift check stays quiet
       rather than judging the fixture's lopsided tier mix. */
    expect(runChecks(doc(), { totalScore: 90, chapters: [], exclude: [] })).toEqual([])
  })

  it('flags total-score mismatches', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.score = 5
    const findings = runChecks(broken, zkRequest)
    expect(findings.map((f) => f.code)).toContain('score-mismatch')
  })

  it('flags missing answers and unreferenced figures', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.answer = undefined
    broken.sections[1]!.items[0]!.stem = '如图所示，一物块静止在斜面上'
    const codes = runChecks(broken, zkRequest).map((f) => f.code)
    expect(codes).toContain('missing-answer')
    expect(codes).toContain('missing-figure')
  })

  it('does not mistake "四个点未画出" for a figure disclaimer', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.stem =
      '某次实验得到的一条纸带如图所示，相邻两计数点间还有四个点未画出'
    broken.sections[0]!.items[0]!.figure = { kind: 'line-diagram', ref: 'f1', caption: '纸带' }
    const findings = runChecks(broken, zkRequest)
    expect(findings.filter((f) => f.questionNo === broken.sections[0]!.items[0]!.number)).toEqual(
      [],
    )
  })

  it('flags excluded knowledge and near-duplicate stems', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.knowledge = ['超纲内容']
    broken.sections[1]!.items[0]!.stem = '关于浮力，下列说法正确的是（ ）'
    const codes = runChecks(broken, { ...zkRequest, exclude: ['超纲内容'] }).map((f) => f.code)
    expect(codes).toContain('out-of-scope')
    expect(codes).toContain('duplicate')
  })

  it('flags broken numbering', () => {
    const broken = mutable(doc())
    broken.sections[1]!.items[0]!.number = 7
    expect(runChecks(broken, zkRequest).map((f) => f.code)).toContain('numbering')
  })

  it('flags drafts that drift off the confirmed spec row', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.difficulty = 'hard'
    broken.sections[0]!.items[0]!.knowledge = ['杠杆']
    const codes = runChecks(broken, zkRequest).map((f) => f.code)
    expect(codes).toContain('spec-mismatch')
  })

  it('flags grading-point totals that do not reach the question score', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.answer!.gradingPoints = [{ text: '只对一半', score: 1 }]
    expect(runChecks(broken, zkRequest).map((f) => f.code)).toContain('score-mismatch')
  })

  it('flags choice answers that are not valid option letters', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.answer!.result = 'E'
    expect(runChecks(broken, zkRequest).map((f) => f.code)).toContain('answer-format')
  })

  it('flags questions with no stated knowledge points', () => {
    const broken = mutable(doc())
    broken.sections[0]!.items[0]!.knowledge = []
    const codes = runChecks(broken, zkRequest).map((f) => f.code)
    expect(codes).toContain('missing-knowledge')
    expect(codes).toContain('spec-mismatch')
  })

  it('warns when the drafted paper drifts from the difficulty target', () => {
    const uniform = { ...zkRequest, difficulty: { basic: 1, medium: 0, hard: 0 } }
    const codes = runChecks(doc(), uniform).map((f) => f.code)
    expect(codes).toContain('difficulty-drift')
  })
})

describe('solveFindings', () => {
  it('reports only disagreements', () => {
    const findings = solveFindings([
      { questionNo: 1, consistent: true },
      { questionNo: 2, consistent: false, note: '独立解题得 43.9' },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.code).toBe('solve-mismatch')
  })
})

/* ------------------------------------------------------ export render -- */

describe('export markdown', () => {
  it('paper markdown has no answers; answer markdown carries grading points', () => {
    const paper = renderPaperMarkdown(doc())
    const answers = renderAnswerMarkdown(doc())
    expect(paper).not.toContain('答案')
    expect(paper).not.toContain('评分点')
    expect(paper).toContain('满分：90 分')
    expect(paper).toContain('依据已核实政策编制的训练卷')
    expect(answers).toContain('参考答案')
    expect(answers).toContain('评分点')
    expect(answers).toContain('40 分')
  })

  it('keeps LaTeX intact for the OMML pipeline', () => {
    expect(renderAnswerMarkdown(doc())).toContain('F_{\\text{浮}}')
  })

  it('normalizes model quirks: paren-wrapped sub numbers, spaced math, blank runs', () => {
    const messy = mutable(doc())
    const item = messy.sections[0]!.items[0]!
    item.stem = '电阻为 $R_3 = $____ Ω，温度 $100\\,^\\circ\\mathrm{C}$'
    item.subQuestions = [{ no: '(1)', text: '效率 $\\eta = $____ %', score: 2 }]
    const paper = renderPaperMarkdown(messy)
    expect(paper).toContain('$R_3 =\\text{＿＿＿＿}$ Ω')
    expect(paper).toContain('$100\\ \\mathrm{℃}$')
    expect(paper).toContain('（1）（2 分）效率 $\\eta =\\text{＿＿＿＿}$ %')
    expect(paper).not.toContain('（(1)）')
    expect(paper).not.toContain(' = $')
  })

  it('converts a LaTeX array data table into a real pipe table', () => {
    const messy = mutable(doc())
    messy.sections[0]!.items[0]!.stem = [
      '测得多组数据如下表：',
      '$$\\begin{array}{|c|c|c|}\\hline',
      'I/\\mathrm{A} & 0.10 & 0.20 \\\\ \\hline',
      'U/\\mathrm{V} & 2.92 & 2.84 \\\\ \\hline',
      '\\end{array}$$',
    ].join('\n')
    const paper = renderPaperMarkdown(messy)
    expect(paper).toContain('| $I/\\mathrm{A}$ | 0.10 | 0.20 |')
    expect(paper).toContain('| $U/\\mathrm{V}$ | 2.92 | 2.84 |')
    expect(paper).not.toContain('\\begin{array}')
    expect(paper).not.toContain('\\hline')
  })
})

/* --------------------------------------------------------- versioning -- */

describe('documentHash', () => {
  it('is stable across key order and changes on any edit', () => {
    const a = documentHash(doc())
    const reordered = doc()
    expect(documentHash(reordered)).toBe(a)
    const edited = mutable(doc())
    edited.sections[0]!.items[0]!.stem = '改动后的题面'
    expect(documentHash(edited)).not.toBe(a)
  })
})

/* ------------------------------------------------------------- types -- */

describe('PaperJob audit trail', () => {
  it('carries versions, reviews, approval and findings in one record', () => {
    const job: PaperJob = {
      id: 'job-1',
      blueprintId: 'gz-zk-physics',
      request: zkRequest,
      specTable: [] as unknown as SpecRow[],
      versions: [
        { version: 1, hash: documentHash(doc()), at: '2026-09-17T00:00:00Z', summary: '初稿' },
      ],
      reviews: [],
      findings: [],
      solveReport: [],
      repairRounds: 0,
      status: 'spec',
      createdAt: '2026-09-17T00:00:00Z',
      updatedAt: '2026-09-17T00:00:00Z',
    }
    expect(job.versions).toHaveLength(1)
    expect(job.status).toBe('spec')
  })
})

/* -------------------------------------------------------- difficulty -- */

describe('difficulty coefficient', () => {
  it('weights each tier by its expected score rate', () => {
    // 0.85×0.85 + 0.12×0.60 + 0.03×0.35
    expect(mixCoefficient(DIFFICULTY_PRESETS[0]!.mix)).toBeCloseTo(0.805, 4)
    expect(mixCoefficient({ basic: 1, medium: 0, hard: 0 })).toBeCloseTo(0.85, 4)
    expect(mixCoefficient({ basic: 0, medium: 0, hard: 1 })).toBeCloseTo(0.35, 4)
  })

  it('lands every preset inside its own band', () => {
    for (const preset of DIFFICULTY_PRESETS) {
      const band = coefficientLevel(mixCoefficient(preset.mix))
      expect(band, preset.key).toBe(preset.label.slice(0, 2))
    }
  })

  it('assigns Guizhou-frame band labels at the boundaries', () => {
    expect(coefficientLevel(0.72)).toBe('偏易')
    expect(coefficientLevel(0.719)).toBe('标准')
    expect(coefficientLevel(0.62)).toBe('标准')
    expect(coefficientLevel(0.5)).toBe('偏难')
    expect(coefficientLevel(0.499)).toBe('选拔')
  })

  it('rates the paper score-weighted over its questions', () => {
    // doc(): 3 分 basic + 87 分 hard → (3×0.85 + 87×0.35) / 90
    expect(paperCoefficient(doc())).toBeCloseTo(0.3667, 4)
    expect(specCoefficient(doc().specTable)).toBeCloseTo(0.3667, 4)
    expect(coefficientLabel(paperCoefficient(doc()))).toContain('选拔')
    expect(coefficientLabel(paperCoefficient(doc()))).toContain('教研估计')
  })

  it('marks the estimate in the answer-export header', () => {
    const answer = renderAnswerMarkdown(doc())
    expect(answer).toContain('整卷预估：难度系数 ≈0.37 · 选拔（教研估计）')
  })
})
