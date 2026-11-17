import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openQuestionCodeDomain, questionCodeDomain, questionCodeJobSchema, questionCodeRecordSchema, QUESTION_CODE_VALIDATION_HISTORY_LIMIT,
  type QuestionCodeJob, type QuestionCodeJobRecord, type QuestionCodeRecord } from '../src/question-code-domain.ts'
import { QuestionCodeJobError, QuestionCodeJobs } from '../src/question-code-jobs.ts'

const SHA = 'a'.repeat(64)
let root: string
let close: (() => Promise<void>) | undefined

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'qcode-jobs-')) })
afterEach(async () => { await close?.(); close = undefined; await rm(root, { recursive: true, force: true }) })

async function domainStore<S extends storageDomain.DomainSpec>(spec: S): Promise<storageDomain.Domain<S>> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: join(root, 'domain') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  const domain = await ctx.storageDomain.open(spec)
  close = async () => { await domain.close(); await ctx.fiber.dispose() }
  return domain
}
async function store(now?: () => Date): Promise<QuestionCodeJobs> {
  return new QuestionCodeJobs(await domainStore(questionCodeDomain), now === undefined ? {} : { now })
}

// Freeze the 93/8f field allowlist, not a DTO schema that would silently accept history.
const legacyJobSchema = questionCodeJobSchema.pick({ id: true, ownerSessionId: true, ownerKey: true,
  sceneId: true, sceneRevision: true, sceneSha256: true, requestSha256: true, status: true, leaseEpoch: true,
  attempts: true, validation: true, resultRef: true, resultSha256: true, code: true, message: true, createdAt: true, updatedAt: true }).strict()
const legacyDomain = storageDomain.defineDomain({ name: 'physicsos_question_code', version: 0, tables: {
  artifacts: storageDomain.domainTable<string, QuestionCodeRecord>(questionCodeRecordSchema),
  jobs: storageDomain.domainTable<string, QuestionCodeJobRecord>(legacyJobSchema),
} })

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

async function rejectedCandidate(jobs: QuestionCodeJobs, exhausted = false) {
  let started = await jobs.startAttempt(await jobs.submit(submit))
  if (exhausted) started = await jobs.startAttempt(await jobs.finish(submit.id, started.epoch, { status: 'rejected', code: 'RENDER_FAILED' }))
  await jobs.recordCandidate(submit.id, started.epoch, { candidateSha256: 'c'.repeat(64) })
  await frozenCandidate(jobs)
  const ticket = jobs.issueTicket(submit.id, started.epoch)
  jobs.redeemTicket(ticket.token, submit.id, ticket.candidateSha256)
  await jobs.recordValidation(submit.id, started.epoch, { passed: false, candidateSha256: ticket.candidateSha256,
    checks: [{ name: 'geometry-probe', passed: false, detail: 'fixture rejection' }], screenshotRef: `screenshot:${submit.id}:${started.epoch}` })
  const job = await jobs.finish(submit.id, started.epoch, { status: 'rejected', code: 'ACCEPTANCE_REJECTED' })
  return { job, ticket }
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

  it.each([{ passed: true, exhausted: false }, { passed: false, exhausted: false },
    { passed: true, exhausted: true }, { passed: false, exhausted: true }])('revalidates a rejected source with durable history and unchanged attempt budget %#', async ({ passed, exhausted }) => {
    const jobs = await store(), { job: rejected, ticket: old } = await rejectedCandidate(jobs, exhausted)
    const previous = structuredClone(rejected.validation)
    const claimed = await jobs.claimValidation(rejected.id, submit.ownerKey, () => {})
    expect(claimed.epoch).toBe(rejected.leaseEpoch + 1)
    expect(claimed.job.validation).toEqual(previous)
    expect(claimed.job.validationHistory).toEqual([previous])
    expect(claimed.job.attempts).toEqual(rejected.attempts.map((attempt, index) => index === rejected.attempts.length - 1
      ? { ...attempt, status: 'running' } : attempt))
    expect(() => jobs.redeemTicket(old.token, rejected.id, old.candidateSha256)).toThrow(QuestionCodeJobError)
    await expect(jobs.recordValidation(rejected.id, rejected.leaseEpoch, { passed: true, candidateSha256: old.candidateSha256,
      checks: [{ name: 'geometry-probe', passed: true }] })).rejects.toMatchObject({ code: 'STALE_LEASE' })
    await expect(jobs.finish(rejected.id, claimed.epoch, { status: 'passed', resultRef: ARTIFACT, resultSha256: old.candidateSha256 }))
      .rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
    const ticket = jobs.issueTicket(rejected.id, claimed.epoch)
    expect(ticket).toMatchObject({ artifactId: ARTIFACT, candidateSha256: old.candidateSha256, requestSha256: submit.requestSha256 })
    await jobs.recordValidation(rejected.id, claimed.epoch, { passed, candidateSha256: old.candidateSha256,
      checks: [{ name: 'geometry-probe', passed }] })
    const finished = await jobs.finish(rejected.id, claimed.epoch, passed
      ? { status: 'passed', resultRef: ARTIFACT, resultSha256: old.candidateSha256 }
      : { status: 'rejected', code: 'ACCEPTANCE_REJECTED' })
    expect(finished.status).toBe(passed ? 'ready' : 'failed')
    expect(finished.validation).toMatchObject({ passed, leaseEpoch: claimed.epoch, sourceRef: ARTIFACT })
    expect(finished.validationHistory).toEqual([previous])
    expect(finished.attempts).toHaveLength(exhausted ? 2 : 1)
    expect(finished.attempts.at(-1)).toMatchObject({ index: rejected.attempts.length - 1,
      startedAt: rejected.attempts.at(-1)!.startedAt, candidateSha256: old.candidateSha256 })
    if (exhausted) await expect(jobs.startAttempt(finished)).rejects.toMatchObject({ code: 'NOT_LIVE' })
    const domain = (jobs as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
    const raw = domain.table('jobs').get(rejected.id)!, history = [...domain.table('validation_history').entries()]
    expect(raw).not.toHaveProperty('validationHistory')
    expect(legacyJobSchema.safeParse(finished).success).toBe(false)
    expect(legacyJobSchema.safeParse(raw).success).toBe(true)
    await close?.(); close = undefined
    const legacyStore = await domainStore(legacyDomain)
    expect(Object.keys(legacyDomain.tables)).toEqual(['artifacts', 'jobs'])
    expect(legacyStore.table('jobs').get(rejected.id)).toEqual(raw)
    expect(legacyStore.table('jobs').get(rejected.id)).not.toHaveProperty('validationHistory')
    await close?.(); close = undefined
    const reopened = await store()
    expect(reopened.get(rejected.id, submit.ownerKey)).toEqual(finished)
    const reopenedDomain = (reopened as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
    expect([...reopenedDomain.table('validation_history').entries()]).toEqual(history)
  })

  it.each<{ name: string; evidence?: Partial<NonNullable<QuestionCodeJob['validation']>> }>([
    { name: 'missing report' }, { name: 'passed report', evidence: { passed: true } },
    { name: 'missing lease', evidence: { leaseEpoch: undefined } }, { name: 'old lease', evidence: { leaseEpoch: 0 } },
    { name: 'wrong candidate', evidence: { candidateSha256: 'f'.repeat(64) } },
    { name: 'missing source', evidence: { sourceRef: undefined } }, { name: 'wrong source', evidence: { sourceRef: 'qcode_' + 'f'.repeat(32) } },
    { name: 'missing scene hash', evidence: { sceneSha256: undefined } }, { name: 'wrong scene hash', evidence: { sceneSha256: 'f'.repeat(64) } },
    { name: 'missing revision', evidence: { sceneRevision: undefined } }, { name: 'wrong revision', evidence: { sceneRevision: 4 } },
    { name: 'empty checks', evidence: { checks: [] } },
  ])('refuses revalidation with $name instead of treating old evidence as acceptance', async ({ evidence }) => {
    const jobs = await store(), { job } = await rejectedCandidate(jobs)
    const domain = (jobs as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
    const { validation, ...rest } = job
    await domain.table('jobs').put(job.id, { ...rest, ...(evidence === undefined ? {} : { validation: { ...validation!, ...evidence } }) })
    const before = structuredClone(jobs.get(job.id, submit.ownerKey))
    await expect(jobs.claimValidation(job.id, submit.ownerKey, () => {})).rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
    expect(jobs.get(job.id, submit.ownerKey)).toEqual(before)
    expect(before.validationHistory).toBeUndefined()
  })

  it.each(['ready', 'cancelled', 'superseded', 'model-failed', 'wrong-attempt', 'no-attempt', 'no-candidate', 'no-artifact'] as const)(
    'does not reopen %s even with matching old rejection evidence', async kind => {
      const jobs = await store(), { job } = await rejectedCandidate(jobs)
      const domain = (jobs as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
      const attempt = job.attempts.at(-1)!
      if (kind === 'ready' || kind === 'cancelled' || kind === 'superseded') await domain.table('jobs').put(job.id, { ...job, status: kind })
      if (kind === 'model-failed') await domain.table('jobs').put(job.id, { ...job, code: 'MODEL_FAILED' })
      if (kind === 'wrong-attempt') await domain.table('jobs').put(job.id, { ...job, attempts: [{ ...attempt, status: 'infrastructure-failed' }] })
      if (kind === 'no-attempt') await domain.table('jobs').put(job.id, { ...job, attempts: [] })
      if (kind === 'no-candidate') { const { candidateSha256: _digest, ...rest } = attempt; await domain.table('jobs').put(job.id, { ...job, attempts: [rest] }) }
      if (kind === 'no-artifact') await domain.table('artifacts').delete(ARTIFACT)
      const before = structuredClone(jobs.get(job.id, submit.ownerKey))
      await expect(jobs.claimValidation(job.id, submit.ownerKey, () => {})).rejects.toBeInstanceOf(QuestionCodeJobError)
      expect(jobs.get(job.id, submit.ownerKey)).toEqual(before)
    })

  it.each([{ ownerKey: 'user-b' }, { ownerSessionId: 'session-2' }, { generationId: 'another-job' }, { sceneId: 'scene-2' },
    { sceneRevision: 4 }, { sceneSha256: 'f'.repeat(64) }, { requestSha256: 'f'.repeat(64) }, { sha256: 'f'.repeat(64) }])(
    'refuses a moved frozen source on a rejected candidate %#', async mismatch => {
      const jobs = await store(), { job } = await rejectedCandidate(jobs)
      await frozenCandidate(jobs, mismatch)
      await expect(jobs.claimValidation(job.id, submit.ownerKey, () => {})).rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
      expect(jobs.get(job.id, submit.ownerKey)).toEqual(job)
    })

  it('fences owner/source moves before archiving and permits only one concurrent rejected-candidate lease', async () => {
    const jobs = await store(), { job } = await rejectedCandidate(jobs)
    await expect(jobs.claimValidation(job.id, 'user-b', () => {})).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(jobs.claimValidation(job.id, submit.ownerKey, () => { throw new QuestionCodeJobError('STALE_SOURCE', 'source moved') }))
      .rejects.toMatchObject({ code: 'STALE_SOURCE' })
    expect(jobs.get(job.id, submit.ownerKey)).toEqual(job)
    const claims = await Promise.allSettled([jobs.claimValidation(job.id, submit.ownerKey, () => {}), jobs.claimValidation(job.id, submit.ownerKey, () => {})])
    expect(claims.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(claims.find(value => value.status === 'rejected')).toMatchObject({ reason: { code: 'VALIDATION_BUSY' } })
    const current = jobs.get(job.id, submit.ownerKey)
    expect(current.leaseEpoch).toBe(job.leaseEpoch + 1)
    expect(current.attempts).toHaveLength(1)
    expect(current.validationHistory).toEqual([job.validation])
  })

  it('retains every rejection and refuses a full history without increasing attempts or dropping reports', async () => {
    const jobs = await store(), { job } = await rejectedCandidate(jobs)
    const evidence = [structuredClone(job.validation!)]
    for (let index = 0; index < QUESTION_CODE_VALIDATION_HISTORY_LIMIT; index++) {
      const claimed = await jobs.claimValidation(job.id, submit.ownerKey, () => {})
      expect(claimed.job.validationHistory).toEqual(evidence)
      await jobs.recordValidation(job.id, claimed.epoch, { passed: false, candidateSha256: 'c'.repeat(64),
        checks: [{ name: 'geometry-probe', passed: false, detail: `rejection ${index + 1}` }] })
      const failed = await jobs.finish(job.id, claimed.epoch, { status: 'rejected', code: 'ACCEPTANCE_REJECTED' })
      evidence.push(structuredClone(failed.validation!))
    }
    const before = structuredClone(jobs.get(job.id, submit.ownerKey))
    expect(before.validationHistory).toEqual(evidence.slice(0, -1))
    expect(before.attempts).toHaveLength(1)
    await expect(jobs.claimValidation(job.id, submit.ownerKey, () => {})).rejects.toMatchObject({ code: 'VALIDATION_HISTORY_FULL' })
    expect(jobs.get(job.id, submit.ownerKey)).toEqual(before)
    const domain = (jobs as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
    expect(domain.table('validation_history').size).toBe(QUESTION_CODE_VALIDATION_HISTORY_LIMIT)
    expect(domain.table('jobs').get(job.id)).not.toHaveProperty('validationHistory')
    expect(questionCodeJobSchema.safeParse({ ...before, validationHistory: evidence }).success).toBe(false)
    const { validationHistory: _history, ...original } = before
    expect(questionCodeJobSchema.safeParse(original).success).toBe(true)
  })

  it('settles archive failure without losing current and archives the same old lease idempotently on infrastructure retries', async () => {
    const jobs = await store(), { job } = await rejectedCandidate(jobs)
    const domain = (jobs as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
    const history = domain.table('validation_history'), insert = vi.spyOn(history, 'put').mockRejectedValueOnce(new Error('archive unavailable'))
    const generate = vi.spyOn(jobs, 'startAttempt'), submitJob = vi.spyOn(jobs, 'submit')
    await expect(jobs.claimValidation(job.id, submit.ownerKey, () => {})).rejects.toMatchObject({ code: 'VALIDATION_ARCHIVE_FAILED' })
    const queued = jobs.get(job.id, submit.ownerKey)
    expect(queued).toMatchObject({ status: 'queued', code: 'VALIDATION_ARCHIVE_FAILED', leaseEpoch: job.leaseEpoch + 1 })
    expect(queued.validation).toEqual(job.validation)
    expect(queued.validationHistory).toBeUndefined()
    expect(queued.attempts).toHaveLength(job.attempts.length)
    expect(history.size).toBe(0)
    const retry = await jobs.claimValidation(job.id, submit.ownerKey, () => {})
    expect(retry.job.validationHistory).toEqual([job.validation])
    await jobs.finish(job.id, retry.epoch, { status: 'infrastructure-failed', code: 'WORKER_400' })
    const again = await jobs.claimValidation(job.id, submit.ownerKey, () => {})
    expect(again.job.validation).toEqual(job.validation)
    expect(again.job.validationHistory).toEqual([job.validation])
    expect(again.job.attempts).toHaveLength(job.attempts.length)
    expect(history.size).toBe(1)
    expect(insert).toHaveBeenCalledTimes(2)
    expect(insert.mock.calls[0]?.[0]).toBe(insert.mock.calls[1]?.[0])
    expect([...history.entries()][0]?.[1]).toMatchObject({ jobId: job.id, ownerKey: submit.ownerKey, leaseEpoch: job.leaseEpoch, validation: job.validation })
    expect(domain.table('jobs').get(job.id)).not.toHaveProperty('validationHistory')
    await jobs.finish(job.id, again.epoch, { status: 'infrastructure-failed', code: 'WORKER_400' })
    const saved = [...history.entries()], record = domain.table('jobs').get(job.id)!
    const conflicting = { ...record, validation: { ...record.validation!, checks: [{ name: 'geometry-probe', passed: false, detail: 'conflicting evidence' }] } }
    await domain.table('jobs').put(job.id, conflicting)
    await expect(jobs.claimValidation(job.id, submit.ownerKey, () => {})).rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
    expect(domain.table('jobs').get(job.id)).toEqual(conflicting)
    expect([...history.entries()]).toEqual(saved)
    expect(insert).toHaveBeenCalledTimes(2)
    expect(generate).not.toHaveBeenCalled(); expect(submitJob).not.toHaveBeenCalled()
  })

  it.each(['source', 'lease'] as const)('blocks tickets/current replacement during archival and fences a %s move before returning the claim', async change => {
    const jobs = await store(), { job } = await rejectedCandidate(jobs)
    const domain = (jobs as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
    const history = domain.table('validation_history'), put = history.put.bind(history), generate = vi.spyOn(jobs, 'startAttempt')
    let release!: () => void, entered!: () => void, sourceCurrent = true
    const pause = new Promise<void>(resolve => { release = resolve }), dispatched = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(history, 'put').mockImplementationOnce(async (key, record) => { entered(); await pause; await put(key, record) })
    const fence = () => { if (!sourceCurrent) throw new QuestionCodeJobError('STALE_SOURCE', 'source moved') }
    const pending = jobs.claimValidation(job.id, submit.ownerKey, fence).then(value => ({ value }), error => ({ error }))
    await dispatched
    const current = jobs.get(job.id, submit.ownerKey)
    expect(current.validation).toEqual(job.validation)
    expect(() => jobs.issueTicket(job.id, current.leaseEpoch)).toThrow(expect.objectContaining({ code: 'VALIDATION_BUSY' }))
    await expect(jobs.recordValidation(job.id, current.leaseEpoch, { passed: true, candidateSha256: 'c'.repeat(64), checks: [{ name: 'render', passed: true }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_BUSY' })
    await expect(jobs.claimValidation(job.id, submit.ownerKey, fence)).rejects.toMatchObject({ code: 'VALIDATION_BUSY' })
    if (change === 'source') sourceCurrent = false
    else await jobs.supersede(job.id, 'newer source')
    release()
    expect(await pending).toMatchObject({ error: { code: change === 'source' ? 'STALE_SOURCE' : 'NOT_LIVE' } })
    const settled = jobs.get(job.id, submit.ownerKey)
    expect(settled.status).toBe('superseded')
    expect(settled.validation).toEqual(job.validation)
    expect(settled.validationHistory).toEqual([job.validation])
    expect(settled.attempts).toHaveLength(job.attempts.length)
    expect(domain.table('jobs').get(job.id)).not.toHaveProperty('validationHistory')
    expect(generate).not.toHaveBeenCalled()
  })

  it('exposes the JSON single-layout old-writer limitation instead of claiming all-backend rollback compatibility', async () => {
    const jobs = await store(), { job } = await rejectedCandidate(jobs)
    await jobs.claimValidation(job.id, submit.ownerKey, () => {})
    expect(jobs.get(job.id, submit.ownerKey).validationHistory).toEqual([job.validation])
    await close?.(); close = undefined
    const old = await domainStore(legacyDomain)
    expect(old.table('jobs').get(job.id)).not.toHaveProperty('validationHistory')
    // Even a no-op old writer republishes only declared tables in single JSON layout.
    await old.table('jobs').update(job.id, current => current)
    await close?.(); close = undefined
    const reopened = await store()
    const domain = (reopened as unknown as { domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> }).domain
    expect(domain.table('validation_history').size).toBe(0)
    expect(reopened.get(job.id, submit.ownerKey).validation).toEqual(job.validation)
    expect(reopened.get(job.id, submit.ownerKey).status).not.toBe('ready')
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
