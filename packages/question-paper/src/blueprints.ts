/**
 * Guizhou exam structure templates (结构模板).
 *
 * These encode the *verified* structures only: the 中考 物化合卷 (物理 90 分)
 * and the 选择性考试 physics paper (100 分 / 75 分钟). Every template ships
 * `status: 'pending'` — a template becomes selectable only after the host
 * confirms every SourcePaper in `basedOn` is verified, so structure claims
 * never outrun the entered evidence.
 *
 * Scores are per-slot (`BlueprintSlot.score`), matching how real papers list
 * uneven per-question values (e.g. 实验题 8+10+10).
 */

import type {
  CheckFinding,
  ExamBlueprint,
  PaperKind,
  PaperLevel,
  PaperRequest,
  SpecRow,
  Subject,
} from './paper.ts'

/* 中考·物理 90 分（物化合卷 150 分 / 150 分钟，2023 起省级统一命题）。
 * 22 题结构按 2025 年省卷实测录入（scripts/ingest-gz-2025-physics.mjs，
 * word 文本层与扫描图互证）：单选 6 + 多选 1 + 填空 4 + 作图 3 + 简答 3 +
 * 实验 3 + 计算 2。与 2024 卷（选择 8 题含 2 多选、简答 2 题）相比，仅选择
 * 与简答两个板块互有增减，总分与题量不变——组卷按最新省卷口径。 */
const ZK_PHYSICS: ExamBlueprint = {
  id: 'gz-zk-physics',
  level: 'zhongkao',
  subject: 'physics',
  title: '贵州省初中学业水平考试·物理',
  totalScore: 90,
  minutes: 150, // 合卷总时长；物理建议用时约 80 分钟
  sections: [
    {
      title: '一、选择题',
      note: '第 1–6 题单项选择，每题 3 分；第 7 题多项选择，全对得 3 分，漏选得 1 分，错选不得分。',
      slots: [
        { kind: 'choice-single', score: 3 },
        { kind: 'choice-single', score: 3 },
        { kind: 'choice-single', score: 3 },
        { kind: 'choice-single', score: 3 },
        { kind: 'choice-single', score: 3 },
        { kind: 'choice-single', score: 3 },
        { kind: 'choice-multi', score: 3 },
      ],
    },
    {
      title: '二、填空题',
      note: '共 4 题 10 分，按空给分。',
      slots: [
        { kind: 'blank', score: 2 },
        { kind: 'blank', score: 2 },
        { kind: 'blank', score: 2 },
        { kind: 'blank', score: 4 },
      ],
    },
    {
      title: '三、作图题',
      slots: [
        { kind: 'drawing', score: 2 },
        { kind: 'drawing', score: 2 },
        { kind: 'drawing', score: 2 },
      ],
    },
    {
      title: '四、简答题',
      slots: [
        { kind: 'short-answer', score: 3 },
        { kind: 'short-answer', score: 3 },
        { kind: 'short-answer', score: 3 },
      ],
    },
    {
      title: '五、实验与科学探究题',
      slots: [
        { kind: 'experiment', score: 8 },
        { kind: 'experiment', score: 10 },
        { kind: 'experiment', score: 10 },
      ],
    },
    {
      title: '六、综合应用题',
      note: '要求写出必要的公式、计算过程或文字说明，只写结果不得分。',
      slots: [
        { kind: 'calculation', score: 8 },
        { kind: 'calculation', score: 8 },
      ],
    },
  ],
  basedOn: [],
  status: 'pending',
  policyLabel: '依据已核实政策编制的训练卷',
}

/* 高考·物理选择性考试 100 分 / 75 分钟。2024 起贵州采用教育部统一命题的
 * 新课标卷：单选 7×4 + 多选 3×6 + 实验 2 题约 15 分 + 计算 3 题约 39 分，
 * 无选考模块；个别年份非选择题分值略有调整，以总分 100 严格对账。 */
const GK_PHYSICS: ExamBlueprint = {
  id: 'gz-gk-physics',
  level: 'gaokao',
  subject: 'physics',
  title: '贵州省普通高中学业水平选择性考试·物理',
  totalScore: 100,
  minutes: 75,
  sections: [
    {
      title: '一、单项选择题',
      note: '每题 4 分，共 28 分。',
      slots: Array.from({ length: 7 }, () => ({ kind: 'choice-single' as const, score: 4 })),
    },
    {
      title: '二、多项选择题',
      note: '每题 6 分，共 18 分；全部选对得 6 分，选对但不全得 3 分，有错选得 0 分。',
      slots: Array.from({ length: 3 }, () => ({ kind: 'choice-multi' as const, score: 6 })),
    },
    {
      title: '三、非选择题',
      note: '实验题 2 题（约 15 分）、计算题 3 题（约 39 分）。计算题须写出必要的公式与过程，只写结果不得分。',
      slots: [
        { kind: 'experiment', score: 6 },
        { kind: 'experiment', score: 9 },
        { kind: 'calculation', score: 12 },
        { kind: 'calculation', score: 13 },
        { kind: 'calculation', score: 14 },
      ],
    },
  ],
  basedOn: [],
  status: 'pending',
  policyLabel: '依据已核实政策编制的训练卷',
}

/** The built-in structure templates, keyed by id. */
export const EXAM_BLUEPRINTS: readonly ExamBlueprint[] = [ZK_PHYSICS, GK_PHYSICS]

/** Look up a structure template by id. */
export function blueprintById(id: string): ExamBlueprint | undefined {
  return EXAM_BLUEPRINTS.find((blueprint) => blueprint.id === id)
}

/**
 * Stage-paper scaling: unit/weekly papers shrink the full blueprint to the
 * scope's chapter range — fewer slots, same question grammar. Mock papers
 * keep the full blueprint.
 * @param level - exam track.
 * @param kind - paper product.
 * @returns fraction of the full slot count the product keeps.
 */
export function kindScale(level: PaperLevel, kind: PaperKind): number {
  if (kind === 'mock') return 1
  const scale: Record<Exclude<PaperKind, 'mock'>, number> = {
    unit: 0.4,
    weekly: 0.45,
    monthly: 0.65,
    midterm: 0.85,
    final: 1,
  }
  return level === 'zhongkao' ? scale[kind] : Math.min(1, scale[kind] + 0.1)
}

/** One ranked evidence-backed knowledge point for spec-row seeding. */
export interface KnowledgePoolEntry {
  readonly knowledge: string
  readonly chapter?: string
}

/** A rejected hotspot/hint is visible in the plan, never silently reintroduced. */
export interface RejectedKnowledge extends KnowledgePoolEntry {
  readonly reason: 'excluded' | 'out-of-scope' | 'unanchored'
}

const scopeText = (text: string): string => text.normalize('NFKC').replace(/\s+/g, '').trim()

/** Exclusions include a named subtopic, not just an exact primary-point label. */
export const isExcludedKnowledge = (knowledge: string, exclude: readonly string[]): boolean =>
  exclude.some((point) => scopeText(point) !== '' && scopeText(knowledge).includes(scopeText(point)))

const chapterNumber = (value: string): number | undefined => {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [tens, ones] = value.split('十')
    const ten = tens === '' ? 1 : digits[tens ?? '']
    const one = ones === '' ? 0 : digits[ones ?? '']
    return ten === undefined || one === undefined ? undefined : ten * 10 + one
  }
  return digits[value]
}

/**
 * Conservative chapter matching: broad evidence never satisfies a narrower
 * requested range. Recognised 第1–4章 ranges are numeric; other labels must
 * be exact or an explicit prefix of the evidence's textbook/chapter label.
 * An untagged hotspot cannot prove it belongs to a taught chapter.
 */
export function chapterInScope(chapter: string | undefined, chapters: readonly string[]): boolean {
  const scopes = chapters.map(scopeText).filter(Boolean)
  if (scopes.length === 0) return true
  if (chapter === undefined || scopeText(chapter) === '') return false
  const actual = scopeText(chapter)
  return scopes.some((scope) => {
    if (scope === actual) return true
    const range = /^(.*?)第([\d零一二两三四五六七八九十]+)[-–—~～至到]([\d零一二两三四五六七八九十]+)章$/.exec(scope)
    if (range !== null) {
      const tagged = /^(.*?)第([\d零一二两三四五六七八九十]+)章/.exec(actual)
      const lo = chapterNumber(range[2]!)
      const hi = chapterNumber(range[3]!)
      const no = tagged === null ? undefined : chapterNumber(tagged[2]!)
      const prefix = range[1]!.replace(/[·・,，;；]+$/g, '')
      return lo !== undefined && hi !== undefined && no !== undefined && lo <= no && no <= hi
        && (prefix === '' || tagged![1]!.startsWith(prefix))
    }
    if (scope.endsWith('全册')) {
      const book = scope.slice(0, -2).replace(/[·・,，;；]+$/g, '')
      return book !== '' && actual.startsWith(book)
    }
    const chapterLabel = /^(.*?第[\d零一二两三四五六七八九十]+章)/.exec(scope)
    if (chapterLabel !== null) return actual === chapterLabel[1] || actual.startsWith(chapterLabel[1]! + '·')
      || actual.startsWith(chapterLabel[1]! + '：')
      || (actual.startsWith(chapterLabel[1]!) && !/^[-–—~～至到\d]/.test(actual.slice(chapterLabel[1]!.length)))
    /* Delimiters prevent a scope such as 必修1 matching 必修10. */
    return actual.startsWith(scope)
      && /^(?:[·・,，;；:：第章节]|$)/.test(actual.slice(scope.length))
  })
}

/** Printed totals use the slot values verbatim; no proportional re-scoring. */
export interface PaperPlan {
  readonly request: PaperRequest
  readonly specTable: readonly SpecRow[]
  readonly requestedTotalScore: number
  readonly totalScore: number
  readonly questionCount: number
  readonly scorePolicy: 'blueprint-slot-sum'
  readonly normalized: boolean
  readonly sections: readonly { readonly title: string; readonly note?: string; readonly questionCount: number; readonly totalScore: number }[]
  readonly scope: {
    readonly chapters: readonly string[]
    readonly exclude: readonly string[]
    readonly unassignedQuestionNos: readonly number[]
    readonly rejectedKnowledge: readonly RejectedKnowledge[]
  }
}

/** The score comparison tolerates only floating-point summation noise. */
export const scoresEqual = (a: number, b: number): boolean =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-8

function specProposal(
  blueprint: ExamBlueprint,
  request: PaperRequest,
  knowledgePool: readonly KnowledgePoolEntry[],
): { rows: SpecRow[]; rejected: RejectedKnowledge[] } {
  const rejected: RejectedKnowledge[] = []
  const rejectReason = (entry: KnowledgePoolEntry): RejectedKnowledge['reason'] | undefined => {
    if (isExcludedKnowledge(entry.knowledge, request.exclude)) return 'excluded'
    if (request.chapters.some((chapter) => scopeText(chapter) !== '') && entry.chapter === undefined) return 'unanchored'
    if (!chapterInScope(entry.chapter, request.chapters)) return 'out-of-scope'
    return undefined
  }
  const seen = new Set<string>()
  const pool = knowledgePool.filter((entry) => {
    if (scopeText(entry.knowledge) === '') return false
    const key = `${scopeText(entry.knowledge)}\0${scopeText(entry.chapter ?? '')}`
    if (seen.has(key)) return false
    seen.add(key)
    const reason = rejectReason(entry)
    if (reason === undefined) return true
    rejected.push({ ...entry, reason })
    return false
  })
  const keep = kindScale(request.level, request.kind)
  const rows: SpecRow[] = []
  let poolIndex = 0
  for (const section of blueprint.sections) {
    const take = Math.max(1, Math.round(section.slots.length * keep))
    for (const slot of section.slots.slice(0, take)) {
      /* Hints are advisory, not a scope override. In a scoped paper they need
         the same verified chapter anchor as any other ranked knowledge point. */
      let seeded: KnowledgePoolEntry | undefined
      if (slot.knowledgeHint !== undefined) {
        const anchor = pool.find((entry) => scopeText(entry.knowledge) === scopeText(slot.knowledgeHint!))
        const hinted: KnowledgePoolEntry = anchor ?? { knowledge: slot.knowledgeHint }
        const reason = rejectReason(hinted)
        if (reason === undefined) seeded = hinted
        else rejected.push({ ...hinted, reason })
      }
      if (seeded === undefined) seeded = pool[poolIndex++]
      rows.push({
        questionNo: rows.length + 1,
        sectionTitle: section.title,
        kind: slot.kind,
        score: slot.score,
        knowledge: seeded === undefined ? [] : [seeded.knowledge],
        ability: '应用',
        difficulty: 'basic',
        ...(seeded?.chapter === undefined ? {} : { chapter: seeded.chapter }),
      })
    }
  }
  /* Spread the difficulty target over the row count (教研估计). */
  const total = rows.length
  const hard = Math.round(total * request.difficulty.hard)
  const medium = Math.round(total * request.difficulty.medium)
  return {
    rows: rows.map((row, index) => ({
      ...row,
      difficulty: index >= total - hard ? 'hard' : index >= total - hard - medium ? 'medium' : 'basic',
    })),
    rejected,
  }
}

/**
 * Preserve the legacy row-array interface. New callers should consume
 * proposePaperPlan so the resolved request/header and row totals agree.
 * Missing in-scope evidence stays blank for teacher confirmation.
 */
export function proposeSpecTable(
  blueprint: ExamBlueprint,
  request: PaperRequest,
  knowledgePool: readonly KnowledgePoolEntry[] = [],
): SpecRow[] {
  return specProposal(blueprint, request, knowledgePool).rows
}

const printedNumbers = (rows: readonly SpecRow[]): string => rows.map((row) => row.questionNo).join('、')

/**
 * Carry template marking rules into the drafted sections. Built-in rules are
 * restated with the retained rows' actual numbers/counts/scores, not stale
 * full-paper quantities. Teacher-authored notes remain teacher evidence.
 */
export function sectionNotesForSpec(
  blueprint: ExamBlueprint,
  rows: readonly SpecRow[],
): { title: string; note?: string }[] {
  return blueprint.sections.flatMap((section) => {
    const retained = rows.filter((row) => row.sectionTitle === section.title)
    if (retained.length === 0) return []
    const original = EXAM_BLUEPRINTS.find((entry) => entry.id === blueprint.id)
      ?.sections.find((entry) => entry.title === section.title)?.note
    if (section.note === undefined) return [{ title: section.title }]
    if (section.note !== original) return [{ title: section.title, note: section.note }]
    const single = retained.filter((row) => row.kind === 'choice-single')
    const multi = retained.filter((row) => row.kind === 'choice-multi')
    const sum = (group: readonly SpecRow[]): number => group.reduce((total, row) => total + row.score, 0)
    const perQuestion = (group: readonly SpecRow[]): string => group.every((row) => scoresEqual(row.score, group[0]!.score))
      ? `每题 ${group[0]!.score} 分` : '各题分值以题面标注为准'
    const notes: string[] = []
    if (single.length > 0) notes.push(`第 ${printedNumbers(single)} 题为单项选择，${perQuestion(single)}，共 ${sum(single)} 分。`)
    if (multi.length > 0) {
      const full = blueprint.id === 'gz-zk-physics' ? 3 : 6
      const partial = blueprint.id === 'gz-zk-physics' ? 1 : 3
      if (multi.some((row) => !scoresEqual(row.score, full))) {
        throw new Error(`板块「${section.title}」多选题分值变更，必须先确认部分给分规则`)
      }
      notes.push(`第 ${printedNumbers(multi)} 题为多项选择，每题 ${full} 分，共 ${sum(multi)} 分；全部选对得 ${full} 分，选对但不全得 ${partial} 分，有错选得 0 分。`)
    }
    if (retained.some((row) => row.kind === 'blank')) notes.push(`共 ${retained.length} 题 ${sum(retained)} 分，按空给分。`)
    if (blueprint.id === 'gz-gk-physics' && section.title === '三、非选择题') {
      const experiment = retained.filter((row) => row.kind === 'experiment')
      const calculation = retained.filter((row) => row.kind === 'calculation')
      notes.push([experiment.length > 0 ? `实验题 ${experiment.length} 题（${sum(experiment)} 分）` : '',
        calculation.length > 0 ? `计算题 ${calculation.length} 题（${sum(calculation)} 分）` : ''].filter(Boolean).join('；') + '。')
    }
    if (retained.some((row) => row.kind === 'calculation')) notes.push('计算题要求写出必要的公式、计算过程或文字说明，只写结果不得分。')
    return [{ title: section.title, note: notes.join('') || section.note }]
  })
}

/** One resolved plan consumed by the UI, job request and document header. */
export function proposePaperPlan(
  blueprint: ExamBlueprint,
  request: PaperRequest,
  knowledgePool: readonly KnowledgePoolEntry[] = [],
): PaperPlan {
  const { rows, rejected } = specProposal(blueprint, request, knowledgePool)
  const totalScore = rows.reduce((total, row) => total + row.score, 0)
  const normalized = !scoresEqual(totalScore, request.totalScore)
  return {
    request: { ...request, totalScore },
    specTable: rows,
    requestedTotalScore: request.totalScore,
    totalScore,
    questionCount: rows.length,
    scorePolicy: 'blueprint-slot-sum',
    normalized,
    sections: sectionNotesForSpec(blueprint, rows).map((section) => {
      const items = rows.filter((row) => row.sectionTitle === section.title)
      return { ...section, questionCount: items.length, totalScore: items.reduce((total, row) => total + row.score, 0) }
    }),
    scope: {
      chapters: [...request.chapters], exclude: [...request.exclude],
      unassignedQuestionNos: rows.filter((row) => row.knowledge.length === 0
        || !chapterInScope(row.chapter, request.chapters)).map((row) => row.questionNo),
      rejectedKnowledge: rejected,
    },
  }
}

/** Mechanical reconciliation for a teacher-confirmed table (no re-scoring). */
export function summarizeSpecTable(
  rows: readonly SpecRow[],
  request: Pick<PaperRequest, 'totalScore' | 'chapters' | 'exclude'>,
): { totalScore: number; questionCount: number; findings: CheckFinding[] } {
  const findings: CheckFinding[] = []
  const totalScore = rows.reduce((total, row) => total + row.score, 0)
  if (rows.length === 0) findings.push({ severity: 'error', code: 'spec-mismatch', detail: '细目表为空，无法核对卷面题量' })
  const closedSections = new Set<string>(); let currentSection: string | undefined
  for (const row of rows) {
    if (row.sectionTitle !== currentSection) {
      if (currentSection !== undefined) closedSections.add(currentSection)
      if (closedSections.has(row.sectionTitle)) findings.push({ questionNo: row.questionNo, severity: 'error', code: 'spec-mismatch', detail: '同一板块的细目表行必须连续，不能拆成重复卷面板块' })
      currentSection = row.sectionTitle
    }
  }
  if (!scoresEqual(totalScore, request.totalScore) || request.totalScore <= 0) {
    findings.push({ severity: 'error', code: 'score-mismatch', detail: `细目表合计 ${totalScore} 分，目标总分 ${request.totalScore} 分` })
  }
  for (const [index, row] of rows.entries()) {
    if (row.questionNo !== index + 1) findings.push({ severity: 'error', code: 'numbering', detail: `细目表第 ${index + 1} 行题号为 ${row.questionNo}，题号须按印刷顺序唯一连续` })
    if (!Number.isFinite(row.score) || row.score <= 0) findings.push({ questionNo: row.questionNo, severity: 'error', code: 'score-mismatch', detail: '细目表分值必须为有限正数' })
    if (row.sectionTitle.trim() === '') findings.push({ questionNo: row.questionNo, severity: 'error', code: 'spec-mismatch', detail: '细目表缺少板块名称' })
    if (row.knowledge.length === 0) findings.push({ questionNo: row.questionNo, severity: 'error', code: 'missing-knowledge', detail: '细目表未确认考点' })
    for (const point of row.knowledge) {
      if (isExcludedKnowledge(point, request.exclude)) findings.push({ questionNo: row.questionNo, severity: 'error', code: 'out-of-scope', detail: `细目表考点「${point}」命中排除范围` })
    }
    if (!chapterInScope(row.chapter, request.chapters)) findings.push({ questionNo: row.questionNo, severity: 'error', code: 'out-of-scope', detail: row.chapter === undefined
      ? '细目表未标注章节，无法核对已教范围' : `细目表章节「${row.chapter}」不在已教范围内` })
  }
  return { totalScore, questionCount: rows.length, findings }
}

/** Subjects a combined blueprint request must draft section-by-section. */
export function draftSubjects(request: PaperRequest): readonly Subject[] {
  return request.subjects
}
