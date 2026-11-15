import { describe, expect, it } from 'vitest'
import { blueprintById, chapterInScope, proposePaperPlan, proposeSpecTable, sectionNotesForSpec, summarizeSpecTable } from '../src/blueprints.ts'
import type { PaperRequest, SpecRow } from '../src/paper.ts'

const request: PaperRequest = { level: 'zhongkao', subjects: ['physics'], kind: 'unit', totalScore: 90, minutes: 150, chapters: [], exclude: [], difficulty: { basic: 0.6, medium: 0.3, hard: 0.1 }, targetYear: 2027, textbook: '人教版' }
const zk = blueprintById('gz-zk-physics')!

describe('resolved paper plans', () => {
  it('reconciles the default unit 90→34 without manufacturing per-question scores', () => {
    const plan = proposePaperPlan(zk, request)
    expect(plan.questionCount).toBe(9)
    expect(plan.totalScore).toBe(34)
    expect(plan.request.totalScore).toBe(34)
    expect(plan.requestedTotalScore).toBe(90)
    expect(plan.normalized).toBe(true)
    expect(plan.scorePolicy).toBe('blueprint-slot-sum')
    expect(plan.specTable.map((row) => row.score)).toEqual([3, 3, 3, 2, 2, 2, 3, 8, 8])
    expect(plan.sections.map((section) => section.questionCount)).toEqual([3, 2, 1, 1, 1, 1])
    expect(plan.sections.reduce((sum, section) => sum + section.totalScore, 0)).toBe(plan.totalScore)
    expect(request.totalScore).toBe(90)
    expect(proposeSpecTable(zk, request)).toEqual(plan.specTable)
  })

  it('uses the same total/quantity contract for every product and track', () => {
    for (const blueprint of [zk, blueprintById('gz-gk-physics')!]) {
      for (const kind of ['unit', 'weekly', 'monthly', 'midterm', 'final', 'mock'] as const) {
        const input = { ...request, level: blueprint.level, totalScore: blueprint.totalScore, kind }
        const plan = proposePaperPlan(blueprint, input)
        expect(plan.totalScore).toBe(plan.specTable.reduce((sum, row) => sum + row.score, 0))
        expect(plan.questionCount).toBe(plan.specTable.length)
        expect(plan.request.totalScore).toBe(plan.totalScore)
        if (kind === 'mock' || kind === 'final') expect(plan.normalized).toBe(false)
        for (const row of plan.specTable) expect(blueprint.sections.find((section) => section.title === row.sectionTitle)?.slots.some((slot) => slot.kind === row.kind && slot.score === row.score)).toBe(true)
      }
    }
  })

  it('cannot introduce excluded/out-of-scope or unanchored hotspots and hints', () => {
    const scoped = { ...request, chapters: ['人教版八年级·第1–4章'], exclude: ['速度'] }
    const blueprint = { ...zk, sections: [{ title: '测试板块', slots: [{ kind: 'choice-single' as const, score: 3, knowledgeHint: '欧姆定律' }, { kind: 'choice-single' as const, score: 3 }, { kind: 'choice-single' as const, score: 3 }] }] }
    const plan = proposePaperPlan(blueprint, scoped, [
      { knowledge: '欧姆定律', chapter: '人教版九年级·第17章' },
      { knowledge: '平均速度', chapter: '人教版八年级·第1章 机械运动' },
      { knowledge: '声现象', chapter: '人教版八年级·第2章 声现象' },
      { knowledge: '声现象', chapter: '人教版八年级·第2章 声现象' },
      { knowledge: '光的折射' },
    ])
    expect(plan.specTable).toHaveLength(1)
    expect(plan.specTable[0]?.knowledge).toEqual(['声现象'])
    expect(plan.specTable[0]?.chapter).toBe('人教版八年级·第2章 声现象')
    expect(plan.scope.chapters).toEqual(scoped.chapters)
    expect(plan.scope.exclude).toEqual(scoped.exclude)
    expect(plan.scope.rejectedKnowledge.map((entry) => entry.reason)).toContain('excluded')
    expect(plan.scope.rejectedKnowledge.map((entry) => entry.reason)).toContain('out-of-scope')
    expect(plan.scope.rejectedKnowledge.map((entry) => entry.reason)).toContain('unanchored')
    expect(plan.scope.unassignedQuestionNos).toEqual([])
  })

  it('leaves a row unassigned if no evidence proves its taught scope', () => {
    const plan = proposePaperPlan(zk, { ...request, chapters: ['必修一'] }, [{ knowledge: '牛顿第二定律' }])
    expect(plan.specTable.every((row) => row.knowledge.length === 0)).toBe(true)
    expect(plan.scope.unassignedQuestionNos).toEqual(plan.specTable.map((row) => row.questionNo))
  })
})

describe('conservative taught-chapter reconciliation', () => {
  it('accepts exact/broader explicit scopes and real chapter ranges, not vague inverse matches', () => {
    expect(chapterInScope('人教版八年级·第3章 物态变化', ['人教版八年级·第1-4章'])).toBe(true)
    expect(chapterInScope('人教版八年级·第三章 物态变化', ['人教版八年级·第一至四章'])).toBe(true)
    expect(chapterInScope('人教版八年级·第5章 透镜', ['人教版八年级·第1-4章'])).toBe(false)
    expect(chapterInScope('人教版九年级·第3章', ['人教版八年级·第1-4章'])).toBe(false)
    expect(chapterInScope('人教版九年级·第17章 欧姆定律', ['人教版九年级·全册'])).toBe(true)
    expect(chapterInScope('必修10·第一章', ['必修1'])).toBe(false)
    expect(chapterInScope('全册', ['第3章'])).toBe(false)
    expect(chapterInScope(undefined, ['第3章'])).toBe(false)
    expect(chapterInScope(undefined, [])).toBe(true)
  })

  it('finds missing knowledge, nonfinite scores, duplicate/out-of-order rows and scope violations', () => {
    const rows: SpecRow[] = [
      { questionNo: 1, sectionTitle: '一', kind: 'blank', score: 3, knowledge: ['速度计算'], ability: '应用', difficulty: 'basic', chapter: '第5章' },
      { questionNo: 1, sectionTitle: '二', kind: 'blank', score: Number.NaN, knowledge: [], ability: '应用', difficulty: 'basic' },
    ]
    const summary = summarizeSpecTable(rows, { totalScore: 34, chapters: ['第1-4章'], exclude: ['速度'] })
    expect(summary.questionCount).toBe(2)
    expect(summary.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(['numbering', 'score-mismatch', 'missing-knowledge', 'out-of-scope']))
  })
})

describe('printed marking notes', () => {
  it('preserves multi-choice partial credit while replacing full-paper numbers', () => {
    const gk = blueprintById('gz-gk-physics')!
    const rows = proposeSpecTable(gk, { ...request, level: 'gaokao', totalScore: 100 })
    const multi = sectionNotesForSpec(gk, rows).find((section) => section.title === '二、多项选择题')?.note
    expect(multi).toContain('第 5、6 题')
    expect(multi).toContain('全部选对得 6 分')
    expect(multi).toContain('选对但不全得 3 分')
    expect(multi).toContain('共 12 分')
    expect(multi).not.toContain('共 18 分')
    const blank = proposePaperPlan(zk, request).sections.find((section) => section.title === '二、填空题')?.note
    expect(blank).toContain('共 2 题 4 分')
    expect(blank).not.toContain('共 4 题 10 分')
  })

  it('does not invent partial-credit scales or discard teacher-authored notes', () => {
    const gk = blueprintById('gz-gk-physics')!
    const rows = proposeSpecTable(gk, { ...request, level: 'gaokao', totalScore: 100 })
    const changed = rows.map((row) => row.kind === 'choice-multi' ? { ...row, score: 5 } : row)
    expect(() => sectionNotesForSpec(gk, changed)).toThrow('必须先确认部分给分规则')
    const custom = { ...gk, sections: gk.sections.map((section) => ({ ...section, note: '本校教研确认：选对但不全按本板块标准计分。' })) }
    expect(sectionNotesForSpec(custom, rows).every((section) => section.note === '本校教研确认：选对但不全按本板块标准计分。')).toBe(true)
  })
})
