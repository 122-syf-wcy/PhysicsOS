/** Synthetic paper fixtures over the real domain write-chain implementation. */
import { Context } from '@deepseek-ai/cordis'
import { descriptorOf } from '@deepseek-ai/dsh-storage-domain'
import { DomainImpl } from '@deepseek-ai/dsh-storage-domain/src/domain.ts'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { documentHash, type PaperDocument, type PaperQuestion, type SolveResult, type SpecRow } from '@physicsos/question-paper'
import { paperDomain, type PaperDomain } from '../src/domain.ts'
import { PaperService } from '../src/service.ts'
import type { ManagedPaperJob } from '../src/workflow-state.ts'

const at = '2026-11-16T08:00:00.000Z'
export const fixtureQuestion = (number = 1, over: Partial<PaperQuestion> = {}): PaperQuestion => ({
  number, subject: 'physics', kind: 'choice-single', score: 3, stem: `合成测试题${number}：声音的传播需要介质。`,
  options: ['A. 正确', 'B. 错误'], knowledge: ['声现象'], ability: '理解', difficulty: 'basic',
  answer: { result: 'A', steps: ['依据声的传播定义判断'], gradingPoints: [{ text: '选择 A', score: 3 }] },
  status: 'draft', ...over,
})
export const fixtureSpec = (question: PaperQuestion): SpecRow => ({
  questionNo: question.number, sectionTitle: '选择题', kind: question.kind, score: question.score,
  knowledge: question.knowledge, ability: question.ability, difficulty: question.difficulty,
})
export const fixtureDocument = (questions: readonly PaperQuestion[] = [fixtureQuestion()]): PaperDocument => ({
  id: 'paper-workflow', title: '合成组卷回归试卷', level: 'zhongkao', kind: 'mock',
  header: { examName: '合成回归', grade: '九年级', subjectLine: '物理', totalScore: questions.reduce((sum, question) => sum + question.score, 0), minutes: 60, candidateFields: [] },
  sections: [{ title: '选择题', items: questions }], specTable: questions.map(fixtureSpec),
})
export const fixtureJob = (over: Partial<ManagedPaperJob> = {}): ManagedPaperJob => {
  const document = over.document ?? fixtureDocument()
  return { id: 'paper-workflow', schoolId: 'test-school', blueprintId: 'fixture-blueprint',
    request: { level: 'zhongkao', subjects: ['physics'], kind: 'mock', totalScore: document.header.totalScore,
      minutes: 60, chapters: [], exclude: [], difficulty: { basic: 1, medium: 0, hard: 0 }, targetYear: 2027, textbook: '人教版' },
    specTable: document.specTable, document, versions: [{ version: 1, hash: documentHash(document), at, summary: '合成初稿' }],
    reviews: [], findings: [], solveReport: [], repairRounds: 0, rowVersion: 0, status: 'review', createdAt: at, updatedAt: at, ...over }
}
export const fixtureSolves = (document: PaperDocument): SolveResult[] => document.sections.flatMap(section => section.items)
  .map(question => ({ questionNo: question.number, draftAnswer: question.answer?.result ?? '',
    solvedAnswer: question.answer?.result ?? '', consistent: true }))

export async function workflowFixture(job = fixtureJob()) {
  let delay: (() => Promise<void>) | undefined
  const records = new Map(Object.keys(paperDomain.tables).map(name => [name, new Map<string, unknown>()]))
  const unit = { descriptor: descriptorOf(paperDomain),
    putRecord: async () => { await delay?.() }, close: async () => undefined,
  } as unknown as KvUnit
  const ctx = new Context()
  const domain = new DomainImpl(ctx, paperDomain, unit, records, undefined, () => undefined) as unknown as PaperDomain
  const service = new PaperService(domain)
  await domain.table('jobs').put(job.id, job)
  return { domain, service, jobId: job.id, delayWrites: (block?: () => Promise<void>) => { delay = block },
    close: async () => { delay = undefined; await domain.close(); await ctx.fiber.dispose() } }
}

export const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
