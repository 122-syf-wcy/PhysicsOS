import { describe, expect, it } from 'vitest'
import { runChecks } from '../src/checks.ts'
import type { PaperDocument } from '../src/paper.ts'

const fixture = (): PaperDocument => ({ id: 'synthetic', title: '仅合成检查样例', level: 'zhongkao', kind: 'unit', header: { examName: '合成训练', grade: '八年级', subjectLine: '物理', totalScore: 6, minutes: 10, candidateFields: ['姓名'] },
  specTable: [1, 2].map((questionNo) => ({ questionNo, sectionTitle: '一、选择题', kind: 'choice-single', score: 3, knowledge: ['声现象'], ability: '应用', difficulty: 'basic', chapter: '第2章 声现象' })),
  sections: [{ title: '一、选择题', items: [1, 2].map((number) => ({ number, subject: 'physics', kind: 'choice-single', score: 3, stem: number === 1 ? '声音传播需要介质，以下说法哪项正确？' : '用隔音材料改善室内环境，哪一项处理有效？', options: ['A. 甲', 'B. 乙'], answer: { result: 'A', steps: ['概念分析'], gradingPoints: [{ text: '选对', score: 3 }] }, knowledge: ['声现象'], ability: '应用', difficulty: 'basic', status: 'draft' })) }],
})
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T
const broken = (): Mutable<PaperDocument> => JSON.parse(JSON.stringify(fixture())) as Mutable<PaperDocument>
const request = { totalScore: 6, chapters: ['第1–4章'], exclude: [] }

describe('request/spec/header/print reconciliation', () => {
  it('checks a scope-tagged, fully covered consistent document', () => {
    expect(runChecks(fixture(), request).filter((finding) => finding.severity === 'error')).toEqual([])
  })
  it('blocks stale headers even when the actual question and spec sums agree', () => {
    const doc = broken(); doc.header.totalScore = 90
    expect(runChecks(doc, request).some((finding) => finding.code === 'score-mismatch' && finding.detail.includes('卷首'))).toBe(true)
  })
  it('requires every spec row exactly once and forbids unplanned questions', () => {
    const extra = broken(); extra.specTable.pop()
    expect(runChecks(extra, request).some((finding) => finding.code === 'spec-mismatch' && finding.questionNo === 2)).toBe(true)
    const missing = broken(); missing.sections[0]!.items.pop()
    expect(runChecks(missing, request).some((finding) => finding.code === 'spec-mismatch' && finding.detail.includes('对应 0 道'))).toBe(true)
    const duplicate = broken(); duplicate.sections[0]!.items[1]!.number = 1
    expect(runChecks(duplicate, request).some((finding) => finding.detail.includes('对应 2 道'))).toBe(true)
  })
  it('checks printed order and section identity, not a sorted set of numbers', () => {
    const doc = broken(); doc.sections[0]!.items.reverse()
    expect(runChecks(doc, request).map((finding) => finding.code)).toContain('numbering')
    doc.sections[0]!.title = '另一个板块'
    expect(runChecks(doc, request).some((finding) => finding.code === 'spec-mismatch' && finding.detail.includes('板块'))).toBe(true)
  })
  it('blocks excluded subtopics in options/subquestions and chapters missing from confirmed rows', () => {
    const doc = broken(); doc.sections[0]!.items[0]!.options![1] = 'B. 利用牛顿第二定律求加速度'
    doc.specTable[1]!.chapter = undefined
    const findings = runChecks(doc, { ...request, exclude: ['牛顿第二定律'] })
    expect(findings.some((finding) => finding.code === 'out-of-scope' && finding.questionNo === 1)).toBe(true)
    expect(findings.some((finding) => finding.code === 'out-of-scope' && finding.questionNo === 2)).toBe(true)
  })
  it('rejects nonfinite/negative scores and missing deterministic figure input', () => {
    const doc = broken(); doc.sections[0]!.items[0]!.score = Number.POSITIVE_INFINITY
    doc.sections[0]!.items[1]!.figure = { kind: 'line-diagram', ref: 'legacy', caption: '内部作图指令' }
    const codes = runChecks(doc, request).map((finding) => finding.code)
    expect(codes).toContain('score-mismatch')
    expect(codes).toContain('missing-figure')
  })
})
