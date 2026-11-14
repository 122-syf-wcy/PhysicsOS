/**
 * Durable execution records for generated question-code experiments.
 *
 * The chat-facing `physicsScenes` projection keeps its existing
 * `generating/ready/failed` states. This module adds the app-side record the
 * projection cannot express: which attempt is running under which lease,
 * whether a candidate passed isolated browser acceptance, and why a retry
 * happened. It is the single writer for that record.
 *
 * Storage is the same `physicsos_question_code` unit as the artifacts, in a
 * new `jobs` table. The domain version stays 0 (the Postgres backend rejects
 * version changes on an existing unit); the table is created on open.
 */
import { randomBytes } from 'node:crypto'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { questionCodeDomain, QuestionCodeJob } from './question-code-domain.ts'

export type JobStatus = QuestionCodeJob['status']
export type JobAttempt = QuestionCodeJob['attempts'][number]

export interface SubmitJobInput {
  readonly id: string
  readonly ownerSessionId: string
  readonly ownerKey: string
  readonly sceneId: string
  readonly sceneRevision: number
  readonly sceneSha256: string
  readonly requestSha256?: string
}

export interface CandidateInput {
  readonly candidateSha256: string
  readonly repair?: { readonly code: string; readonly reason?: string; readonly diagnostics?: readonly string[] }
}

export interface ValidationInput {
  readonly passed: boolean
  readonly candidateSha256: string
  readonly checks: readonly { readonly name: string; readonly passed: boolean; readonly detail?: string }[]
  readonly screenshotRef?: string
}

export class QuestionCodeJobError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_LIVE' | 'STALE_LEASE' | 'CANDIDATE_MISMATCH' | 'NO_ATTEMPT', message: string) {
    super(message)
    this.name = 'QuestionCodeJobError'
  }
}

const LIVE: ReadonlySet<JobStatus> = new Set(['queued', 'running', 'candidate', 'validating'])
const isLive = (status: JobStatus): boolean => LIVE.has(status)

/**
 * One authoritative job store over the `jobs` table. Every mutation is
 * conditioned on owner, lease epoch and liveness, so a late or superseded
 * worker cannot publish over newer work.
 */
/** A short-lived, digest-bound capability for the isolated validator. */
export interface ValidationTicket {
  /** Opaque random handle; the ticket itself never carries account data. */
  readonly token: string
  readonly jobId: string
  readonly candidateSha256: string
  readonly expiresAt: number
}

export class QuestionCodeJobs {
  private readonly tickets = new Map<string, ValidationTicket>()
  private readonly now: () => Date
  constructor(
    private readonly domain: Domain<typeof questionCodeDomain>,
    options: { readonly now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Accept a job unless a live one already covers the same generation id.
   * A finished job with the same id is returned as-is: the artifact table
   * already owns the immutable result, and re-running would mint a new one.
   */
  async submit(input: SubmitJobInput): Promise<QuestionCodeJob> {
    const existing = this.domain.table('jobs').get(input.id)
    if (existing !== undefined) {
      if (existing.ownerSessionId !== input.ownerSessionId || existing.ownerKey !== input.ownerKey) {
        throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
      }
      return existing
    }
    const at = this.now().toISOString()
    const job: QuestionCodeJob = {
      ...input,
      status: 'queued',
      leaseEpoch: 0,
      attempts: [],
      createdAt: at,
      updatedAt: at,
    }
    await this.domain.table('jobs').put(job.id, job)
    return job
  }

  /** Owner-scoped read; a stranger learns nothing. */
  get(id: string, ownerKey: string): QuestionCodeJob {
    const job = this.domain.table('jobs').get(id)
    if (job === undefined || job.ownerKey !== ownerKey) throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
    return job
  }

  /** Claim queued work, or reclaim a running attempt whose lease expired. */
  async claim(id: string): Promise<{ job: QuestionCodeJob; epoch: number } | undefined> {
    const job = this.domain.table('jobs').get(id)
    if (job === undefined || !isLive(job.status)) return undefined
    const attempt = job.attempts.at(-1)
    if (job.status === 'running' && attempt?.status === 'running') return undefined
    return await this.startAttempt(job)
  }

  /** Start the next bounded attempt. Attempts are capped at 2 (initial + one repair). */
  async startAttempt(job: QuestionCodeJob): Promise<{ job: QuestionCodeJob; epoch: number }> {
    if (job.attempts.length >= 2) throw new QuestionCodeJobError('NOT_LIVE', '生成任务的重试次数已用尽。')
    const at = this.now().toISOString()
    const attempt: JobAttempt = {
      index: job.attempts.length,
      status: 'running',
      startedAt: at,
    }
    const next: QuestionCodeJob = {
      ...job,
      status: 'running',
      leaseEpoch: job.leaseEpoch + 1,
      attempts: [...job.attempts, attempt],
      updatedAt: at,
    }
    await this.domain.table('jobs').put(job.id, next)
    return { job: next, epoch: next.leaseEpoch }
  }

  /** Freeze the candidate an attempt produced, before acceptance. */
  async recordCandidate(id: string, epoch: number, candidate: CandidateInput): Promise<QuestionCodeJob> {
    const job = this.requireLive(id, epoch)
    const attempts = job.attempts.map((attempt, index) => index === job.attempts.length - 1
      ? {
        ...attempt,
        candidateSha256: candidate.candidateSha256,
        ...(candidate.repair === undefined ? {} : {
          code: candidate.repair.code,
          ...(candidate.repair.reason === undefined ? {} : { reason: candidate.repair.reason }),
          ...(candidate.repair.diagnostics === undefined ? {} : { diagnostics: [...candidate.repair.diagnostics] }),
        }),
      }
      : attempt)
    const next: QuestionCodeJob = { ...job, status: 'candidate', attempts, updatedAt: this.now().toISOString() }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Record isolated-browser evidence. The report must name the same candidate
   * digest the attempt froze; a mismatched or missing report never passes.
   */
  async recordValidation(id: string, epoch: number, validation: ValidationInput): Promise<QuestionCodeJob> {
    const job = this.requireLive(id, epoch)
    const attempt = job.attempts.at(-1)
    if (attempt?.candidateSha256 !== validation.candidateSha256) {
      throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '验收结果与冻结的候选不一致。')
    }
    const next: QuestionCodeJob = {
      ...job,
      status: 'validating',
      validation: {
        version: 1,
        passed: validation.passed,
        candidateSha256: validation.candidateSha256,
        checks: validation.checks.map(check => ({ ...check })),
        ...(validation.screenshotRef === undefined ? {} : { screenshotRef: validation.screenshotRef }),
        finishedAt: this.now().toISOString(),
      },
      updatedAt: this.now().toISOString(),
    }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Close the current attempt. `passed` publishes the artifact reference and
   * requires the same digest that validation reported. Infrastructure failures
   * return the job to `queued` without consuming the repair budget.
   */
  async finish(id: string, epoch: number, input: {
    readonly status: 'passed' | 'rejected' | 'infrastructure-failed' | 'cancelled'
    readonly resultSha256?: string
    readonly resultRef?: string
    readonly code?: string
    readonly message?: string
  }): Promise<QuestionCodeJob> {
    const job = this.requireLive(id, epoch)
    const index = job.attempts.length - 1
    const attempt = job.attempts[index]
    if (attempt === undefined) throw new QuestionCodeJobError('NO_ATTEMPT', '生成任务没有可结束的尝试。')
    if (input.status === 'passed') {
      if (input.resultSha256 === undefined || input.resultRef === undefined) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '通过的尝试必须携带结果摘要。')
      if (attempt.candidateSha256 !== input.resultSha256) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '发布结果与验收候选不一致。')
      if (job.validation?.passed !== true || job.validation.candidateSha256 !== input.resultSha256) {
        throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '候选尚未通过验收，不能发布。')
      }
    }
    const at = this.now().toISOString()
    const attempts = job.attempts.map((item, position) => position === index
      ? {
        ...item,
        status: input.status === 'passed' ? 'passed' as const
          : input.status === 'rejected' ? 'rejected' as const
            : input.status === 'cancelled' ? 'cancelled' as const
              : 'infrastructure-failed' as const,
        finishedAt: at,
        ...(input.code === undefined ? {} : { code: input.code }),
      }
      : item)
    const next: QuestionCodeJob = input.status === 'passed'
      ? { ...job, status: 'ready', attempts, resultRef: input.resultRef, resultSha256: input.resultSha256, updatedAt: at }
      : input.status === 'cancelled'
        ? { ...job, status: 'cancelled', attempts, code: input.code ?? 'CANCELLED', message: input.message, updatedAt: at }
        : input.status === 'infrastructure-failed'
          ? { ...job, status: 'queued', attempts, code: input.code ?? 'INFRASTRUCTURE', updatedAt: at }
          : { ...job, status: 'failed', attempts, code: input.code ?? 'FAILED', message: input.message, updatedAt: at }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /** Cancellation is terminal; any in-flight attempt becomes cancelled. */
  async cancel(id: string, ownerKey: string, reason = '用户取消'): Promise<QuestionCodeJob> {
    const job = this.get(id, ownerKey)
    if (!isLive(job.status)) return job
    const at = this.now().toISOString()
    const attempts = job.attempts.map((attempt, index) => index === job.attempts.length - 1 && attempt.status === 'running'
      ? { ...attempt, status: 'cancelled' as const, finishedAt: at }
      : attempt)
    const next: QuestionCodeJob = { ...job, status: 'cancelled', attempts, code: 'CANCELLED', message: reason, leaseEpoch: job.leaseEpoch + 1, updatedAt: at }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /** A scene/revision move makes older work unpublishable. */
  async supersede(id: string, reason: string): Promise<QuestionCodeJob> {
    const job = this.domain.table('jobs').get(id)
    if (job === undefined) throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
    if (!isLive(job.status)) return job
    const next: QuestionCodeJob = { ...job, status: 'superseded', code: 'SUPERSEDED', message: reason, leaseEpoch: job.leaseEpoch + 1, updatedAt: this.now().toISOString() }
    await this.domain.table('jobs').put(id, next)
    return next
  }

  /**
   * Mint a one-time ticket for the isolated validator. It binds the exact
   * candidate digest and expires quickly; it grants read access to that
   * frozen package only, never to an account or another job.
   */
  issueTicket(id: string, epoch: number, ttlMs = 5 * 60 * 1000): ValidationTicket {
    const job = this.requireLive(id, epoch)
    const digest = job.attempts.at(-1)?.candidateSha256
    if (digest === undefined) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '没有冻结的候选可供验收。')
    // `<jobId>.<nonce>`: the route needs the job id to redeem the ticket, and
    // base64url never contains '.', so the split is unambiguous.
    const token = `${id}.${randomBytes(24).toString('base64url')}`
    const ticket: ValidationTicket = { token, jobId: id, candidateSha256: digest, expiresAt: this.now().getTime() + ttlMs }
    this.tickets.set(token, ticket)
    return ticket
  }

  /** Redeem a ticket for its bound candidate; expired or unknown tickets are refused. */
  redeemTicket(token: string, id: string, candidateSha256: string): ValidationTicket {
    const ticket = this.tickets.get(token)
    if (ticket === undefined || ticket.jobId !== id || ticket.candidateSha256 !== candidateSha256 || ticket.expiresAt <= this.now().getTime()) {
      throw new QuestionCodeJobError('NOT_FOUND', '验收票据无效或已过期。')
    }
    // One-time: a replayed ticket must not re-open the package.
    this.tickets.delete(token)
    return ticket
  }

  /** Jobs left mid-attempt by a restart: queued again after the lease window. */
  stale(now = this.now(), leaseMs = 10 * 60 * 1000): QuestionCodeJob[] {
    return [...this.domain.table('jobs').entries()]
      .map(([, job]) => job)
      .filter(job => job.status === 'running' && job.attempts.at(-1)?.status === 'running'
        && Date.parse(job.attempts.at(-1)!.startedAt) + leaseMs <= now.getTime())
  }

  private requireLive(id: string, epoch: number): QuestionCodeJob {
    const job = this.domain.table('jobs').get(id)
    if (job === undefined) throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
    if (!isLive(job.status)) throw new QuestionCodeJobError('NOT_LIVE', '任务已经结束，迟到的结果不会发布。')
    if (job.leaseEpoch !== epoch) throw new QuestionCodeJobError('STALE_LEASE', '任务已被新的执行者接管。')
    return job
  }
}
