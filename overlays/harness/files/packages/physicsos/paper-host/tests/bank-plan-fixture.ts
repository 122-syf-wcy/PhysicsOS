import type { BankItem, PaperJob, PaperRequest, SpecRow } from '@physicsos/question-paper'
import type { PaperDomain } from '../src/domain.ts'
import { PaperService } from '../src/service.ts'

const at = '2026-11-01T08:00:00.000Z'

/** A real planning service over deterministic in-memory bank and ledger rows. */
export const bankPlanFixture = (itemCount: number, usageCount = 0, questionCount = 3, trackReads = false) => {
  const maps = new Map<string, Map<string, unknown>>()
  const rows = (name: string): Map<string, unknown> => {
    let table = maps.get(name)
    if (table === undefined) { table = new Map(); maps.set(name, table) }
    return table
  }
  const work = { usageRows: 0 }
  const domain = {
    table: (name: string) => ({
      get: (id: string) => rows(name).get(id),
      put: async (id: string, record: unknown) => { rows(name).set(id, record) },
      entries: () => {
        if (name !== 'bank_usage' || !trackReads) return rows(name).entries()
        return (function* () {
          for (const entry of rows(name)) { work.usageRows++; yield entry }
        })()
      },
    }),
  } as unknown as PaperDomain
  const request: PaperRequest = {
    level: 'zhongkao', subjects: ['physics'], kind: 'mock', totalScore: questionCount * 3,
    minutes: 60, chapters: [], exclude: [], difficulty: { basic: 1, medium: 0, hard: 0 },
    targetYear: 2026, textbook: '人教版',
  }
  const spec: SpecRow[] = Array.from({ length: questionCount }, (_, index) => ({
    questionNo: index + 1, sectionTitle: '选择题', kind: 'choice-single', score: 3,
    knowledge: ['声现象'], ability: '理解', difficulty: 'basic',
  }))
  const itemId = (index: number) => `item-${String(index).padStart(4, '0')}`
  for (let index = 0; index < itemCount; index++) {
    const id = itemId(index)
    const item: BankItem = {
      id, level: 'zhongkao', subject: 'physics', kind: 'choice-single',
      knowledge: ['声现象'], ability: '理解', difficulty: 'basic', score: 3,
      stem: `规划测试题 ${index}`, stemHash: `fixture-${index}`, options: ['A. 甲', 'B. 乙'],
      answer: { result: 'A', steps: ['根据定义'], gradingPoints: [{ text: '选择 A', score: 3 }] },
      answerTier: 'manual-transcript', anomalies: [], reuseModes: ['verbatim', 'adapt'],
      enteredBy: 'teacher', enteredAt: at, status: 'verified',
    }
    rows('bank_items').set(id, item)
  }
  const job = (id: string, schoolId: string | null, status: PaperJob['status'], createdAt: string): PaperJob => ({
    id, schoolId, blueprintId: 'fixture', request, specTable: spec, versions: [], reviews: [],
    findings: [], solveReport: [], repairRounds: 0, status, createdAt, updatedAt: createdAt,
  })
  rows('jobs').set('recent', job('recent', 'GZU', 'approved', '2026-11-07T08:00:00.000Z'))
  rows('jobs').set('old', job('old', 'GZU', 'approved', at))
  // Old, distinct papers exercise a growing usage history without changing recent eligibility.
  for (let index = 0; index < usageCount; index++) {
    const paperId = `history-${index}`
    rows('jobs').set(paperId, job(paperId, 'GZU', 'approved', at))
    rows('bank_usage').set(`${itemId(index % itemCount)}@${paperId}`, {
      itemId: itemId(index % itemCount), paperId, usedAt: at, mode: 'verbatim',
    })
  }
  return { domain, work, request, spec, itemId, job, service: new PaperService(domain) }
}
