import { describe, expect, it, onTestFinished } from 'vitest'
import { documentHash, type BankItem } from '@physicsos/question-paper'
import { PaperService } from '../src/service.ts'
import { applyEngineAnswers } from '../src/solve.ts'
import { paperDomain } from '../src/domain.ts'
import { currentChecks, operationFence, questionContentHash } from '../src/workflow-state.ts'
import { deferred, fixtureDocument, fixtureJob, fixtureQuestion, fixtureSolves, workflowFixture } from './workflow-fixture.ts'

const checked = async (count = 1) => {
  const document = fixtureDocument(Array.from({ length: count }, (_, index) => fixtureQuestion(index + 1)))
  const f = await workflowFixture(fixtureJob({ document, specTable: document.specTable }))
  onTestFinished(f.close)
  await f.service.markStage(f.jobId, 'checking')
  await f.service.recordCheckResults(f.jobId, [], fixtureSolves(document))
  return f
}

describe('atomic paper updates and operation fences', () => {
  it('admits exactly one of two concurrent old-version document commits', async () => {
    const f = await checked()
    const before = f.service.getJob(f.jobId)
    const document = before.document!
    const firstDocument = { ...document, title: 'first edit' }
    const secondDocument = { ...document, title: 'second edit' }
    const held = deferred()
    let entered = false
    f.delayWrites(async () => { if (!entered) { entered = true; await held.promise } })
    const first = f.service.commitDocument(f.jobId, firstDocument, 'first', before.versions.length)
    const second = new PaperService(f.domain).commitDocument(f.jobId, secondDocument, 'second', before.versions.length)
    held.resolve()
    const results = await Promise.allSettled([first, second])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1]).toMatchObject({ reason: { code: 'VERSION_CONFLICT' } })
    expect(f.service.getJob(f.jobId).document?.title).toBe('first edit')
    expect(f.service.getJob(f.jobId).versions).toHaveLength(before.versions.length + 1)
  })

  it('merges concurrent question reviews without mutating previously read snapshots', async () => {
    const f = await checked(2)
    const snapshot = f.service.getJob(f.jobId)
    const held = deferred()
    f.delayWrites(() => held.promise)
    const first = f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher-a')
    const second = f.service.reviewQuestion(f.jobId, 2, 'approved', 'teacher-b')
    expect(snapshot.document?.sections[0]?.items.map(question => question.status)).toEqual(['checked', 'checked'])
    held.resolve()
    await Promise.all([first, second])
    expect(f.service.getJob(f.jobId).reviews).toHaveLength(2)
    expect(f.service.getJob(f.jobId).document?.sections[0]?.items.map(question => question.status)).toEqual(['approved', 'approved'])
    expect(snapshot.reviews).toEqual([])
  })

  it('a late progress/failure/result cannot overwrite a restarted newer operation', async () => {
    const f = await checked()
    const running = await f.service.beginOperation(f.jobId, 'check')
    const stale = operationFence(running)
    await f.service.settleInterrupted()
    const newer = await f.service.beginOperation(f.jobId, 'check')
    const live = operationFence(newer)
    await f.service.reportProgress(f.jobId, 'solve', 1, 1, 'new progress', live)
    await f.service.reportProgress(f.jobId, 'draft', 0, 999, 'old progress', stale)
    await f.service.failJob(f.jobId, 'old failure', stale)
    await expect(f.service.recordCheckResults(f.jobId, [], fixtureSolves(newer.document!), stale))
      .rejects.toMatchObject({ code: 'STALE_OPERATION' })
    const current = f.service.getJob(f.jobId)
    expect(current.operation?.id).toBe(newer.operation?.id)
    expect(current.status).toBe('checking')
    expect(current.progress?.detail).toBe('new progress')
    expect(current.lastError).toBeUndefined()
    await f.service.recordCheckResults(f.jobId, [], fixtureSolves(newer.document!), live)
    const complete = f.service.getJob(f.jobId)
    await f.service.reportProgress(f.jobId, 'solve', 0, 100, 'late callback', live)
    expect(f.service.getJob(f.jobId).status).toBe('review')
    expect(f.service.getJob(f.jobId).rowVersion).toBe(complete.rowVersion)
  })

  it('progress updates preserve a version, review and approval arriving at another queue slot', async () => {
    const f = await checked()
    await f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher')
    const approve = f.service.approve(f.jobId, 'teacher', 'physics')
    const progress = f.service.reportProgress(f.jobId, 'export', 0, 1, 'export preparation')
    await Promise.all([approve, progress])
    const current = f.service.getJob(f.jobId)
    expect(current.status).toBe('approved')
    expect(current.reviews).toHaveLength(1)
    expect(current.approval?.physics?.reviewer).toBe('teacher')
    expect(current.versions.at(-1)?.hash).toBe(documentHash(current.document!))
  })
})

describe('current content, checks and explicit subject approval', () => {
  it('rejects a nonexistent question number without inventing a review', async () => {
    const f = await checked()
    const before = f.service.getJob(f.jobId)
    await expect(f.service.reviewQuestion(f.jobId, 99, 'approved', 'teacher')).rejects.toMatchObject({ status: 404, code: 'NO_QUESTION' })
    expect(f.service.getJob(f.jobId).reviews).toEqual(before.reviews)
  })

  it('content changes invalidate findings/report and forged old approved flags', async () => {
    const f = await checked()
    await f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher')
    const before = f.service.getJob(f.jobId)
    const edited = fixtureDocument([fixtureQuestion(1, { stem: 'changed content', status: 'approved' })])
    const next = await f.service.commitDocument(f.jobId, edited, 'edit', before.versions.length)
    expect(next.document?.sections[0]?.items[0]?.status).toBe('draft')
    expect(next.solveReport).toEqual([])
    expect(next.checkBinding).toBeUndefined()
    await expect(f.service.approve(f.jobId, 'teacher')).rejects.toMatchObject({ code: 'CHECKS_REQUIRED' })
    await f.service.markStage(f.jobId, 'checking')
    await f.service.recordCheckResults(f.jobId, [], fixtureSolves(edited))
    await expect(f.service.approve(f.jobId, 'teacher')).rejects.toMatchObject({ code: 'QUESTIONS_UNREVIEWED' })
  })

  it('does not treat incomplete or stale solves as current-version check coverage', async () => {
    const f = await checked(2)
    const job = await f.service.beginOperation(f.jobId, 'check')
    const fence = operationFence(job)
    await expect(f.service.recordCheckResults(f.jobId, [], fixtureSolves(job.document!).slice(0, 1), fence))
      .rejects.toMatchObject({ code: 'CHECK_COVERAGE' })
    const solve = fixtureSolves(job.document!).map(result => ({ ...result, questionHash: 'old hash' }))
    await expect(f.service.recordCheckResults(f.jobId, [], solve, fence)).rejects.toMatchObject({ code: 'STALE_OPERATION' })
  })

  it('retains unchanged question review only when that question content and evidence are identical', async () => {
    const f = await checked(2)
    await f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher')
    await f.service.reviewQuestion(f.jobId, 2, 'approved', 'teacher')
    const current = f.service.getJob(f.jobId)
    const changed = { ...current.document!, sections: [{ title: '选择题', items: [fixtureQuestion(1, { stem: 'new first question' }), current.document!.sections[0]!.items[1]!] }] }
    await f.service.commitDocument(f.jobId, changed, 'only Q1', current.versions.length)
    await f.service.markStage(f.jobId, 'checking')
    await f.service.recordCheckResults(f.jobId, [], fixtureSolves(changed))
    expect(f.service.getJob(f.jobId).document?.sections[0]?.items.map(question => question.status)).toEqual(['checked', 'approved'])
    const running = await f.service.beginOperation(f.jobId, 'check')
    await f.service.recordCheckResults(f.jobId, [{ questionNo: 2, code: 'engine-mismatch', severity: 'warning', detail: 'changed evidence' }], fixtureSolves(changed), operationFence(running))
    expect(f.service.getJob(f.jobId).document?.sections[0]?.items[1]?.status).toBe('checked')
  })

  it('chemistry-first records only chemistry and waits for an explicit physics signature', async () => {
    const document = fixtureDocument([fixtureQuestion(1), fixtureQuestion(2, { subject: 'chemistry' })])
    const base = fixtureJob({ document, specTable: document.specTable })
    const f = await workflowFixture({ ...base, request: { ...base.request, subjects: ['physics', 'chemistry'] } })
    onTestFinished(f.close)
    await f.service.markStage(f.jobId, 'checking')
    await f.service.recordCheckResults(f.jobId, [], fixtureSolves(document))
    await f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher')
    await f.service.reviewQuestion(f.jobId, 2, 'approved', 'teacher')
    const chemistry = await f.service.approve(f.jobId, 'chemist', 'chemistry')
    expect(chemistry.status).toBe('review')
    expect(chemistry.approval?.chemistry?.reviewer).toBe('chemist')
    expect(chemistry.approval?.physics).toBeUndefined()
    await expect(Promise.resolve().then(() => f.service.requireApprovedDocument(f.jobId))).rejects.toMatchObject({ code: 'NOT_APPROVED' })
    const physics = await f.service.approve(f.jobId, 'physicist', 'physics')
    expect(physics.status).toBe('approved')
    expect(physics.approval?.chemistry?.reviewer).toBe('chemist')
    expect(physics.approval?.physics?.reviewer).toBe('physicist')
  })

  it('retains original explanation after engine correction, but blocks until explicitly re-reviewed', async () => {
    const f = await checked()
    await f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher')
    let current = await f.service.beginOperation(f.jobId, 'check')
    const solve = [{ questionNo: 1, draftAnswer: 'A', solvedAnswer: 'B', consistent: false }]
    const corrected = applyEngineAnswers(current.document!, solve)!
    expect(corrected.sections[0]?.items[0]?.status).toBe('flagged')
    expect(corrected.sections[0]?.items[0]?.answer?.steps).toEqual(current.document?.sections[0]?.items[0]?.answer?.steps)
    current = await f.service.commitEngineAnswers(f.jobId, corrected, operationFence(current))
    await f.service.recordCheckResults(f.jobId, [{ questionNo: 1, code: 'solve-mismatch', severity: 'error', detail: 'answer differs' }], solve, operationFence(current))
    expect(currentChecks(f.service.getJob(f.jobId))).toBeDefined()
    await expect(f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher')).rejects.toMatchObject({ code: 'REVIEW_REASON_REQUIRED' })
    await expect(f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher', 'checked', { acknowledgeFindings: true }))
      .rejects.toMatchObject({ code: 'ANALYSIS_REVIEW_REQUIRED' })
    const reviewed = await f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher', '人工已核对最终答案与原解析、评分点', { acknowledgeFindings: true, analysisConfirmed: true })
    expect(reviewed.findings).toHaveLength(2)
    expect(reviewed.reviews.at(-1)?.analysisConfirmed).toBe(true)
    expect((await f.service.approve(f.jobId, 'teacher', 'physics')).status).toBe('approved')
  })

  it('structural/spec/figure errors cannot be waived through a question approval', async () => {
    const f = await checked()
    const job = await f.service.beginOperation(f.jobId, 'check')
    await f.service.recordCheckResults(f.jobId, [{ questionNo: 1, code: 'spec-mismatch', severity: 'error', detail: 'kind differs from confirmed slot' }], fixtureSolves(job.document!), operationFence(job))
    await expect(f.service.reviewQuestion(f.jobId, 1, 'approved', 'teacher', 'accept', { acknowledgeFindings: true }))
      .rejects.toMatchObject({ code: 'UNRESOLVED_FINDINGS' })
  })

  it('preserves historical finalized hash-bound exports without fabricating old check metadata', async () => {
    const { rowVersion: _rowVersion, ...legacy } = fixtureJob({ status: 'exported', approval: {
      versionHash: documentHash(fixtureDocument()), reviewer: 'historic teacher', at: '2025-01-01',
    } })
    const f = await workflowFixture(legacy); onTestFinished(f.close)
    expect(f.service.requireApprovedDocument(f.jobId).job.checkBinding).toBeUndefined()
    const parsed = paperDomain.tables.jobs.valueSchema.parse(legacy)
    expect(parsed.approval?.versionHash).toBe(legacy.approval?.versionHash)
    expect(parsed.checkBinding).toBeUndefined()
    const oldFigure = { ...legacy, document: fixtureDocument([fixtureQuestion(1, { figure: {
      kind: 'line-diagram', ref: 'legacy:any/path', caption: 'a long historical internal caption '.repeat(100),
    } })]) }
    expect(paperDomain.tables.jobs.valueSchema.safeParse(oldFigure).success).toBe(true)
  })
})

const bankInput = (schoolId: string, stem = 'Synthetic shared text for scoped duplicate checks') => ({
  schoolId, level: 'zhongkao', subject: 'physics', kind: 'choice-single', score: 3, knowledge: ['声现象'],
  ability: '理解', difficulty: 'basic', stem, answer: { result: 'A', steps: [], gradingPoints: [] },
  answerTier: 'manual-transcript', anomalies: [], reuseModes: ['adapt'], enteredBy: 'synthetic teacher',
} satisfies Omit<BankItem, 'id' | 'stemHash' | 'enteredAt' | 'status'>)

describe('school-scoped duplicate evidence', () => {
  it('allows a same-stem school-private item in another school without leaking id/source', async () => {
    const f = await workflowFixture(); onTestFinished(f.close)
    const a = await f.service.addBankItem({ ...bankInput('school-a'), sourceLabel: 'private source-a' })
    const b = await f.service.addBankItem(bankInput('school-b'))
    expect(b.id).not.toBe(a.id)
    const local = await f.service.ingestBankItems([bankInput('school-b')])
    expect(local.duplicates.join(' ')).toContain(b.id)
    expect(local.duplicates.join(' ')).not.toContain(a.id)
    expect(local.duplicates.join(' ')).not.toContain('private source-a')
    await expect(f.service.addBankItem(bankInput('school-b'))).rejects.toMatchObject({ code: 'DUPLICATE_ITEM' })
  })

  it('a stem update checks only the current school-visible pool and triage drops stale content', async () => {
    const f = await workflowFixture(); onTestFinished(f.close)
    await f.service.addBankItem(bankInput('school-a', 'other school text'))
    const b = await f.service.addBankItem(bankInput('school-b', 'before update'))
    const beforeHash = f.service.bankContentHash(b)
    const updated = await f.service.updateBankItem(b.id, { stem: 'other school text' })
    expect(questionContentHash(fixtureQuestion())).not.toBe(beforeHash)
    await expect(f.service.noteBankTriage(b.id, 'agreed', undefined, beforeHash)).rejects.toMatchObject({ code: 'STALE_OPERATION' })
    expect(updated.anomalies).toEqual([])
  })
})
