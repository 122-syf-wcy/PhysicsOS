import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openQuestionCodeDomain, type QuestionCodeRecord } from '../src/question-code-domain.ts'
import { QuestionCodeJobError, QuestionCodeJobs } from '../src/question-code-jobs.ts'

const SHA = 'a'.repeat(64)
let root: string
let close: (() => Promise<void>) | undefined

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'qcode-jobs-')) })
afterEach(async () => { await close?.(); close = undefined; await rm(root, { recursive: true, force: true }) })

async function store(now?: () => Date): Promise<QuestionCodeJobs> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: join(root, 'domain') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  const domain = await openQuestionCodeDomain(ctx)
  close = async () => { await domain.close(); await ctx.fiber.dispose() }
  return new QuestionCodeJobs(domain, now === undefined ? {} : { now })
}

const submit = {
  id: 'gen-1', ownerSessionId: 'session-1', ownerKey: 'user-a',
  sceneId: 'scene-1', sceneRevision: 3, sceneSha256: SHA, requestSha256: 'b'.repeat(64),
}
const ARTIFACT = 'qcode_' + 'e'.repeat(32)
async function frozenCandidate(jobs: QuestionCodeJobs, overrides: Partial<QuestionCodeRecord> = {}): Promise<void> {
  const domain = (jobs as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
  await domain.table('artifacts').put(ARTIFACT, {
    id: ARTIFACT, ownerSessionId: submit.ownerSessionId, ownerKey: submit.ownerKey, generationId: submit.id,
    childSessionId: 'child', sceneId: submit.sceneId, sceneRevision: submit.sceneRevision, sceneSha256: submit.sceneSha256,
    requestSha256: submit.requestSha256, experimentId: 'incline', sha256: 'c'.repeat(64), rendererKind: 'independent',
    title: 'Frozen source fixture', summary: '', createdAt: '2026-11-14T00:00:00Z', styleVersion: 'v1', files: [], ...overrides,
  })
}

describe('question-code jobs', () => {
  it('accepts a job once and returns the same row for the same generation', async () => {
    const jobs = await store()
    const first = await jobs.submit(submit)
    expect(first.status).toBe('queued')
    expect((await jobs.submit(submit)).createdAt).toBe(first.createdAt)
    expect(() => jobs.get('gen-1', 'user-b')).toThrow(QuestionCodeJobError)
  })

  it('runs candidate → validating → ready only with matching digests', async () => {
    const jobs = await store()
    const job = await jobs.submit(submit)
    const started = await jobs.startAttempt(job)
    await jobs.recordCandidate('gen-1', started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    await jobs.recordValidation('gen-1', started.epoch, {
      passed: true, candidateSha256: 'c'.repeat(64), checks: [{ name: 'first-frame', passed: true }],
    })
    await expect(jobs.finish('gen-1', started.epoch, { status: 'passed', resultRef: ARTIFACT, resultSha256: 'd'.repeat(64) }))
      .rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
    const ready = await jobs.finish('gen-1', started.epoch, { status: 'passed', resultRef: ARTIFACT, resultSha256: 'c'.repeat(64) })
    expect(ready.status).toBe('ready')
    expect(jobs.get('gen-1', 'user-a').resultRef).toBe(ARTIFACT)
    expect(ready.validation).toMatchObject({ version: 1, leaseEpoch: started.epoch, sourceRef: ARTIFACT,
      sceneRevision: submit.sceneRevision, sceneSha256: submit.sceneSha256 })
  })

  it('refuses to publish a candidate that never passed acceptance', async () => {
    const jobs = await store()
    const job = await jobs.submit(submit)
    const started = await jobs.startAttempt(job)
    await jobs.recordCandidate('gen-1', started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    await jobs.recordValidation('gen-1', started.epoch, { passed: false, candidateSha256: 'c'.repeat(64), checks: [] })
    await expect(jobs.finish('gen-1', started.epoch, { status: 'passed', resultRef: 'a', resultSha256: 'c'.repeat(64) }))
      .rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
    const failed = await jobs.finish('gen-1', started.epoch, { status: 'rejected', code: 'SUBJECT_NOT_DRAWN' })
    expect(failed.status).toBe('failed')
  })

  it('rejects a late result from a superseded lease', async () => {
    const jobs = await store()
    const job = await jobs.submit(submit)
    const started = await jobs.startAttempt(job)
    await jobs.cancel('gen-1', 'user-a')
    await expect(jobs.recordCandidate('gen-1', started.epoch, { candidateSha256: 'c'.repeat(64) }))
      .rejects.toMatchObject({ code: 'NOT_LIVE' })
  })

  it('does not consume the repair budget on infrastructure failure', async () => {
    const jobs = await store()
    const job = await jobs.submit(submit)
    const started = await jobs.startAttempt(job)
    const retried = await jobs.finish('gen-1', started.epoch, { status: 'infrastructure-failed', code: 'BROWSER_DOWN' })
    expect(retried.status).toBe('queued')
    const again = await jobs.claim('gen-1')
    expect(again?.epoch).toBeGreaterThan(started.epoch)
    expect(again?.job.attempts).toHaveLength(2)
    await expect(jobs.claim('gen-1')).resolves.toBeUndefined()
  })

  it('caps attempts at two', async () => {
    const jobs = await store()
    const job = await jobs.submit(submit)
    const first = await jobs.startAttempt(job)
    const second = await jobs.finish('gen-1', first.epoch, { status: 'rejected', code: 'RENDER_FAILED' })
    const attempt2 = await jobs.startAttempt(second)
    expect(attempt2.job.attempts).toHaveLength(2)
    const failed = await jobs.finish('gen-1', attempt2.epoch, { status: 'rejected', code: 'RENDER_FAILED' })
    await expect(jobs.startAttempt(failed)).rejects.toMatchObject({ code: 'NOT_LIVE' })
  })

  it('reclaims only jobs whose attempt lease actually expired', async () => {
    let clock = new Date('2026-11-14T00:00:00Z')
    const jobs = await store(() => clock)
    const job = await jobs.submit(submit)
    await jobs.startAttempt(job)
    expect(await jobs.claim('gen-1')).toBeUndefined()
    expect(jobs.stale(clock)).toEqual([])
    clock = new Date('2026-11-14T00:11:00Z')
    expect(jobs.stale(clock).map(item => item.id)).toEqual(['gen-1'])
  })

  it('issues one-time, digest-bound validator tickets', async () => {
    const jobs = await store()
    const job = await jobs.submit(submit)
    expect(() => jobs.issueTicket(job.id, 0)).toThrow(QuestionCodeJobError)
    const started = await jobs.startAttempt(job)
    await jobs.recordCandidate('gen-1', started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    const ticket = jobs.issueTicket('gen-1', started.epoch)
    expect(ticket.jobId).toBe('gen-1')
    expect(ticket.candidateSha256).toBe('c'.repeat(64))
    expect(() => jobs.redeemTicket(ticket.token, 'gen-1', 'd'.repeat(64))).toThrow(QuestionCodeJobError)
    expect(() => jobs.validationTicket(ticket.token, 'c'.repeat(64))).toThrow(QuestionCodeJobError)
    expect(jobs.redeemTicket(ticket.token, 'gen-1', 'c'.repeat(64)).jobId).toBe('gen-1')
    // Activation is once, but wrapper/entry/dependencies share the bounded run.
    expect(() => jobs.redeemTicket(ticket.token, 'gen-1', 'c'.repeat(64))).toThrow(QuestionCodeJobError)
    expect(jobs.validationTicket(ticket.token, 'c'.repeat(64)).artifactId).toBe(ARTIFACT)
    expect(jobs.validationTicket(ticket.token, 'c'.repeat(64)).epoch).toBe(started.epoch)
    expect(() => jobs.validationTicket(ticket.token, 'd'.repeat(64))).toThrow(QuestionCodeJobError)
    jobs.revokeTicket(ticket.token)
    expect(() => jobs.validationTicket(ticket.token, 'c'.repeat(64))).toThrow(QuestionCodeJobError)
  })

  it('expires a validator ticket', async () => {
    let clock = new Date('2026-11-14T00:00:00Z')
    const jobs = await store(() => clock)
    const job = await jobs.submit(submit)
    const started = await jobs.startAttempt(job)
    await jobs.recordCandidate('gen-1', started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    const ticket = jobs.issueTicket('gen-1', started.epoch, 1_000)
    clock = new Date('2026-11-14T00:00:02Z')
    expect(() => jobs.redeemTicket(ticket.token, 'gen-1', 'c'.repeat(64))).toThrow(QuestionCodeJobError)
  })

  it('hard-caps active ticket lifetime and rejects a new activation during validation', async () => {
    let clock = new Date('2026-11-14T00:00:00Z')
    const jobs = await store(() => clock), job = await jobs.submit(submit), started = await jobs.startAttempt(job)
    await jobs.recordCandidate(job.id, started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    const ticket = jobs.issueTicket(job.id, started.epoch, 60 * 60 * 1000)
    expect(ticket.expiresAt - clock.getTime()).toBe(5 * 60 * 1000)
    jobs.redeemTicket(ticket.token, job.id, ticket.candidateSha256)
    expect(() => jobs.issueTicket(job.id, started.epoch)).toThrow(expect.objectContaining({ code: 'VALIDATION_BUSY' }))
    clock = new Date('2026-11-14T00:05:00Z')
    expect(() => jobs.validationTicket(ticket.token, ticket.candidateSha256)).toThrow(QuestionCodeJobError)
  })

  it.each([
    { ownerKey: 'user-b' }, { ownerSessionId: 'session-2' }, { sceneRevision: 4 },
    { sceneSha256: 'f'.repeat(64) }, { generationId: 'another-job' }, { requestSha256: 'f'.repeat(64) },
  ])('refuses a ticket for a source binding mismatch %#', async mismatch => {
    const jobs = await store(), job = await jobs.submit(submit), started = await jobs.startAttempt(job)
    await jobs.recordCandidate(job.id, started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs, mismatch)
    expect(() => jobs.issueTicket(job.id, started.epoch)).toThrow(expect.objectContaining({ code: 'CANDIDATE_MISMATCH' }))
  })

  it('validate-only retries one frozen attempt atomically and rejects old evidence without adding a child attempt', async () => {
    const jobs = await store(), job = await jobs.submit(submit), started = await jobs.startAttempt(job)
    await jobs.recordCandidate(job.id, started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    const old = jobs.issueTicket(job.id, started.epoch)
    jobs.redeemTicket(old.token, job.id, old.candidateSha256)
    await jobs.finish(job.id, started.epoch, { status: 'infrastructure-failed', code: 'WORKER_400' })
    expect(() => jobs.validationTicket(old.token, old.candidateSha256)).toThrow(QuestionCodeJobError)
    const claims = await Promise.allSettled([
      jobs.claimValidation(job.id, submit.ownerKey, () => {}), jobs.claimValidation(job.id, submit.ownerKey, () => {}),
    ])
    expect(claims.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(claims.find(value => value.status === 'rejected')).toMatchObject({ reason: { code: 'VALIDATION_BUSY' } })
    const current = jobs.get(job.id, submit.ownerKey)
    expect(current.leaseEpoch).toBe(started.epoch + 1)
    expect(current.attempts).toHaveLength(1)
    expect(current.attempts[0]?.candidateSha256).toBe(old.candidateSha256)
    await expect(jobs.recordValidation(job.id, started.epoch, { passed: true, candidateSha256: old.candidateSha256, checks: [{ name: 'render', passed: true }] }))
      .rejects.toMatchObject({ code: 'STALE_LEASE' })
    await expect(jobs.claimValidation(job.id, 'user-b', () => {})).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('reclaims only an expired validation lease without creating another attempt', async () => {
    let clock = new Date('2026-11-14T00:00:00Z')
    const jobs = await store(() => clock), job = await jobs.submit(submit), started = await jobs.startAttempt(job)
    await jobs.recordCandidate(job.id, started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    const first = await jobs.claimValidation(job.id, submit.ownerKey, () => {})
    const ticket = jobs.issueTicket(job.id, first.epoch)
    jobs.redeemTicket(ticket.token, job.id, ticket.candidateSha256)
    await expect(jobs.claimValidation(job.id, submit.ownerKey, () => {})).rejects.toMatchObject({ code: 'VALIDATION_BUSY' })
    clock = new Date('2026-11-14T00:05:01Z')
    const next = await jobs.claimValidation(job.id, submit.ownerKey, () => {})
    expect(next.epoch).toBe(first.epoch + 1)
    expect(next.job.attempts).toHaveLength(1)
    expect(() => jobs.validationTicket(ticket.token, ticket.candidateSha256)).toThrow()
    await expect(jobs.recordValidation(job.id, first.epoch, { passed: true, candidateSha256: ticket.candidateSha256, checks: [{ name: 'render', passed: true }] }))
      .rejects.toMatchObject({ code: 'STALE_LEASE' })
  })

  it('superseding the scene revokes active resource access and fences queued evidence writes', async () => {
    const jobs = await store(), job = await jobs.submit(submit), started = await jobs.startAttempt(job)
    await jobs.recordCandidate(job.id, started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    const ticket = jobs.issueTicket(job.id, started.epoch)
    jobs.redeemTicket(ticket.token, job.id, ticket.candidateSha256)
    const superseded = jobs.supersede(job.id, 'revision changed')
    const report = jobs.recordValidation(job.id, started.epoch, { passed: true, candidateSha256: ticket.candidateSha256, checks: [{ name: 'render', passed: true }] })
    await superseded
    await expect(report).rejects.toMatchObject({ code: 'NOT_LIVE' })
    expect(() => jobs.validationTicket(ticket.token, ticket.candidateSha256)).toThrow(QuestionCodeJobError)
    expect(jobs.get(job.id, submit.ownerKey).validation).toBeUndefined()
  })

  it('does not reuse a passed report from an older epoch for the same digest', async () => {
    const jobs = await store(), job = await jobs.submit(submit), started = await jobs.startAttempt(job)
    await jobs.recordCandidate(job.id, started.epoch, { candidateSha256: 'c'.repeat(64) })
    await frozenCandidate(jobs)
    await jobs.recordValidation(job.id, started.epoch, { passed: true, candidateSha256: 'c'.repeat(64), checks: [{ name: 'render', passed: true }] })
    await jobs.finish(job.id, started.epoch, { status: 'infrastructure-failed', code: 'WRITE_FAILED' })
    const retried = await jobs.claimValidation(job.id, submit.ownerKey, () => {})
    await expect(jobs.finish(job.id, retried.epoch, { status: 'passed', resultRef: ARTIFACT, resultSha256: 'c'.repeat(64) }))
      .rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
  })

  it('keeps the domain readable with a pre-existing artifact row', async () => {
    const jobs = await store()
    const domain = (jobs as unknown as { domain: { table(name: string): { put(key: string, value: unknown): Promise<unknown> } } }).domain
    await domain.table('artifacts').put('qcode_' + 'a'.repeat(32), {
      id: 'qcode_' + 'a'.repeat(32), ownerSessionId: 'session-1', ownerKey: 'user-a', childSessionId: 'child',
      sceneId: 'scene-1', sceneRevision: 1, sceneSha256: SHA, experimentId: 'incline',
      sha256: SHA, title: '旧实验', summary: '', createdAt: '2026-11-01T00:00:00Z', styleVersion: 'v1', files: [],
    })
    expect((await jobs.submit(submit)).status).toBe('queued')
  })
})
