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
  ExamBlueprint,
  PaperKind,
  PaperLevel,
  PaperRequest,
  SpecRow,
  Subject,
} from './paper.ts'

/* 中考·物理 90 分（物化合卷 150 分 / 150 分钟，2023 起省级统一命题）。 */
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
      note: '每空 2 分。',
      slots: [
        { kind: 'blank', score: 3 },
        { kind: 'blank', score: 3 },
        { kind: 'blank', score: 2 },
        { kind: 'blank', score: 2 },
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

/* 高考·物理选择性考试 100 分 / 75 分钟（贵州自主命题）。 */
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
      slots: Array.from({ length: 7 }, () => ({ kind: 'choice-single' as const, score: 4 })),
    },
    {
      title: '二、多项选择题',
      note: '每题 4 分，全部选对得 4 分，选对但不全得 2 分，有错选得 0 分。',
      slots: Array.from({ length: 3 }, () => ({ kind: 'choice-multi' as const, score: 4 })),
    },
    {
      title: '三、非选择题',
      note: '实验题 2 题、计算题 3 题。',
      slots: [
        { kind: 'experiment', score: 10 },
        { kind: 'experiment', score: 12 },
        { kind: 'calculation', score: 12 },
        { kind: 'calculation', score: 12 },
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

/**
 * Propose the 双向细目表 for one request against a blueprint: every blueprint
 * slot becomes a spec row (scaled for stage papers), knowledge hints seeded
 * from the slot, difficulty spread over the request's target mix. Slots
 * without a hint draw from `knowledgePool` — verified-annotation statistics
 * ranked upstream — so the proposal starts data-informed, never guessed.
 * The teacher confirms or edits the returned table before drafting runs.
 * @param blueprint - the structure template to expand.
 * @param request - the teacher's paper request.
 * @param knowledgePool - ranked knowledge candidates from verified evidence.
 * @returns proposed spec rows in printed order.
 */
export function proposeSpecTable(
  blueprint: ExamBlueprint,
  request: PaperRequest,
  knowledgePool: readonly KnowledgePoolEntry[] = [],
): SpecRow[] {
  const keep = kindScale(request.level, request.kind)
  const rows: SpecRow[] = []
  let number = 1
  let poolIndex = 0
  for (const section of blueprint.sections) {
    const take = Math.max(1, Math.round(section.slots.length * keep))
    for (const slot of section.slots.slice(0, take)) {
      const seeded = knowledgePool[poolIndex]
      const hinted = slot.knowledgeHint !== undefined
      if (!hinted && seeded !== undefined) poolIndex++
      rows.push({
        questionNo: number++,
        sectionTitle: section.title,
        kind: slot.kind,
        score: slot.score,
        knowledge: hinted ? [slot.knowledgeHint!] : seeded === undefined ? [] : [seeded.knowledge],
        ability: '应用',
        difficulty: 'basic',
        ...(hinted || seeded?.chapter === undefined ? {} : { chapter: seeded.chapter }),
      })
    }
  }
  /* Spread the difficulty target over the row count (教研估计). */
  const total = rows.length
  const hard = Math.round(total * request.difficulty.hard)
  const medium = Math.round(total * request.difficulty.medium)
  return rows.map((row, index) => ({
    ...row,
    difficulty:
      index >= total - hard ? 'hard' : index >= total - hard - medium ? 'medium' : 'basic',
  }))
}

/** Subjects a combined blueprint request must draft section-by-section. */
export function draftSubjects(request: PaperRequest): readonly Subject[] {
  return request.subjects
}
