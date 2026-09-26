import { describe, expect, it } from 'vitest'
import type { PaperDocument, PaperJob, PaperRequest } from '@physicsos/question-paper'
import type { PaperDomain } from '../src/domain.ts'
import { PaperService } from '../src/service.ts'

const request: PaperRequest = {
  level: 'zhongkao',
  subjects: ['physics'],
  kind: 'mock',
  totalScore: 3,
  minutes: 60,
  chapters: [],
  exclude: [],
  difficulty: { basic: 1, medium: 0, hard: 0 },
  targetYear: 2026,
  textbook: '人教版',
}

const document: PaperDocument = {
  id: 'paper-state',
  title: '状态机回归卷',
  level: 'zhongkao',
  kind: 'mock',
  header: {
    examName: '状态机回归卷',
    grade: '九年级',
    subjectLine: '物理',
    totalScore: 3,
    minutes: 60,
    candidateFields: [],
  },
  sections: [{
    title: '一、选择题',
    items: [{
      number: 1,
      subject: 'physics',
      kind: 'choice-single',
      score: 3,
      stem: '状态机测试题干',
      options: ['A. 甲', 'B. 乙'],
      knowledge: ['声现象'],
      ability: '理解',
      difficulty: 'basic',
      status: 'draft',
    }],
  }],
  specTable: [],
}

const buildJob = (status: PaperJob['status']): PaperJob => ({
  id: 'paper-state',
  blueprintId: 'blueprint-state',
  request,
  specTable: [],
  document,
  versions: [{ version: 1, hash: 'seed-hash', at: '2026-09-25T00:00:00.000Z', summary: 'seed' }],
  reviews: [],
  findings: [],
  solveReport: [],
  repairRounds: 0,
  status,
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
})

const makeFakeDomain = (): PaperDomain => {
  const maps = new Map<string, Map<string, unknown>>()
  return {
    table: (name: string) => {
      const map = maps.get(name) ?? new Map<string, unknown>()
      maps.set(name, map)
      return {
        get: (id: string) => map.get(id),
        put: async (id: string, record: unknown) => { map.set(id, record) },
        entries: () => map.entries(),
      }
    },
  } as unknown as PaperDomain
}

const seeded = async (status: PaperJob['status']) => {
  const domain = makeFakeDomain()
  const service = new PaperService(domain)
  await domain.table('jobs').put('paper-state', buildJob(status))
  return { domain, service }
}

describe('paper job state machine', () => {
  it('requires checking before results and review before a verdict', async () => {
    const { service } = await seeded('review')

    await expect(service.recordCheckResults('paper-state', [], []))
      .rejects.toMatchObject({ status: 409, code: 'BAD_STATE' })

    await service.markStage('paper-state', 'checking')
    expect((await service.recordCheckResults('paper-state', [], [])).status).toBe('review')
    expect((await service.reviewQuestion('paper-state', 1, 'approved', 'teacher')).status).toBe('review')
  })

  it('does not let a job skip drafting or fail outside an async stage', async () => {
    const { service } = await seeded('spec')

    await expect(service.commitDocument('paper-state', document, 'skip drafting'))
      .rejects.toMatchObject({ status: 409, code: 'BAD_STATE' })
    await service.markStage('paper-state', 'drafting')
    expect((await service.commitDocument('paper-state', document, 'drafted')).status).toBe('review')
    await expect(service.failJob('paper-state', 'not running'))
      .rejects.toMatchObject({ status: 409, code: 'BAD_STATE' })
    await service.markStage('paper-state', 'checking')
    await service.failJob('paper-state', 'provider failed')
    expect(service.getJob('paper-state')).toMatchObject({ status: 'failed', lastError: 'provider failed' })
  })

  it('keeps review and approval actions tied to the review stage', async () => {
    const { service } = await seeded('checking')

    await expect(service.reviewQuestion('paper-state', 1, 'approved', 'teacher'))
      .rejects.toMatchObject({ status: 409, code: 'BAD_STATE' })
    await expect(service.approve('paper-state', 'teacher'))
      .rejects.toMatchObject({ status: 409, code: 'BAD_STATE' })
    await expect(service.markStage('paper-state', 'drafting'))
      .rejects.toMatchObject({ status: 409, code: 'BAD_STATE' })
  })
})
