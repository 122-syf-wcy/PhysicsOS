/**
 * Durable execution records for generated question-code experiments.
 *
 * The chat-facing `physicsScenes` projection keeps its existing
 * `generating/ready/failed` states. This module adds the app-side record the
 * projection cannot express: which attempt is running under which lease,
 * whether a candidate passed isolated browser acceptance, and why a retry
 * happened. It is the single writer for that record.
 *
 * Storage stays in `physicsos_question_code`, version 0. Strict legacy jobs
 * rows retain their exact shape; prior reports are append-only records in
 * `validation_history`, merged only into read DTOs, never written back to jobs.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { QUESTION_CODE_VALIDATION_HISTORY_LIMIT, type questionCodeDomain, type QuestionCodeJob, type QuestionCodeJobRecord,
  type QuestionCodeRecord, type QuestionCodeValidation, type QuestionCodeValidationHistory } from './question-code-domain.ts'

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
  constructor(readonly code: 'NOT_FOUND' | 'NOT_LIVE' | 'STALE_LEASE' | 'STALE_SOURCE' | 'VALIDATION_BUSY' | 'VALIDATION_HISTORY_FULL' | 'VALIDATION_ARCHIVE_FAILED' | 'CANDIDATE_MISMATCH' | 'NO_ATTEMPT', message: string) {
    super(message)
    this.name = 'QuestionCodeJobError'
  }
}

const LIVE: ReadonlySet<JobStatus> = new Set(['queued', 'running', 'candidate', 'validating'])
const isLive = (status: JobStatus): boolean => LIVE.has(status)
const validationHistoryKey = (job: QuestionCodeJobRecord, validation: QuestionCodeValidation): string =>
  createHash('sha256').update(JSON.stringify([job.id, job.ownerKey, validation.leaseEpoch ?? 0])).digest('hex')
const validationValue = (value: QuestionCodeValidation): string => JSON.stringify([value.version, value.passed, value.candidateSha256,
  value.leaseEpoch, value.sceneSha256, value.sceneRevision, value.sourceRef,
  value.checks.map(check => [check.name, check.passed, check.detail]), value.screenshotRef, value.finishedAt])
const sameValidation = (left: QuestionCodeValidation, right: QuestionCodeValidation): boolean => validationValue(left) === validationValue(right)
const archiveWritesByDomain = new WeakMap<Domain<typeof questionCodeDomain>, Map<string, Promise<void>>>()

/**
 * One authoritative job store over the `jobs` table. Every mutation is
 * conditioned on owner, lease epoch and liveness, so a late or superseded
 * worker cannot publish over newer work.
 */
/** Exact private source binding; a projection's `ready` is not acceptance. */
export function questionCodeJobMatchesArtifact(job: QuestionCodeJob, row: QuestionCodeRecord): boolean {
  return row.generationId === job.id && row.ownerKey === job.ownerKey
    && row.ownerSessionId === job.ownerSessionId && row.sceneId === job.sceneId
    && row.sceneRevision === job.sceneRevision && row.sceneSha256 === job.sceneSha256
    && row.requestSha256 === job.requestSha256
    && job.attempts.at(-1)?.candidateSha256 === row.sha256
}

/** Source identity owned by the app, shared by initial validation and retry. */
export interface ValidationSourceBinding {
  readonly jobId: string
  readonly ownerSessionId: string
  readonly ownerKey: string
  readonly artifactId: string
  readonly sceneId: string
  readonly sceneRevision: number
  readonly sceneSha256: string
  readonly requestSha256?: string
  readonly candidateSha256: string
}

/** One short-lived validation session, not one ticket per HTTP asset. */
export interface ValidationTicket extends ValidationSourceBinding {
  /** Only this opaque handle is sent to the worker; the binding stays app-side. */
  readonly token: string
  readonly epoch: number
  readonly expiresAt: number
}
const MAX_TICKET_TTL_MS = 5 * 60 * 1000
const VALIDATION_LEASE_MS = MAX_TICKET_TTL_MS

export class QuestionCodeJobs {
  private readonly tickets = new Map<string, ValidationTicket>()
  private readonly activeTickets = new Map<string, ValidationTicket>()
  private readonly archiveWrites: Map<string, Promise<void>>
  private readonly now: () => Date
  constructor(
    private readonly domain: Domain<typeof questionCodeDomain>,
    options: { readonly now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.archiveWrites = archiveWritesByDomain.get(domain) ?? new Map<string, Promise<void>>()
    archiveWritesByDomain.set(domain, this.archiveWrites)
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
    const job: QuestionCodeJobRecord = {
      // Select input fields, never spread a possible read DTO into the durable row.
      id: input.id, ownerSessionId: input.ownerSessionId, ownerKey: input.ownerKey,
      sceneId: input.sceneId, sceneRevision: input.sceneRevision, sceneSha256: input.sceneSha256,
      ...(input.requestSha256 === undefined ? {} : { requestSha256: input.requestSha256 }),
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
    return this.withHistory(job)
  }

  /** Claim queued work, or reclaim a running attempt whose lease expired. */
  async claim(id: string): Promise<{ job: QuestionCodeJob; epoch: number } | undefined> {
    const job = this.domain.table('jobs').get(id)
    if (job === undefined || !isLive(job.status)) return undefined
    const attempt = job.attempts.at(-1)
    if ((job.status === 'running' || job.status === 'validating') && attempt?.status === 'running') return undefined
    return await this.startAttempt(job)
  }

  /**
   * Owner-requested revalidation of an already frozen candidate, including a
   * proven acceptance rejection. Other terminal jobs stay terminal. The same
   * attempt/source and generation budget are reused, never a child or new job.
   * The update slot claims one new lease, leaving current evidence intact.
   * Archival then runs under that lease before any new ticket/report is allowed;
   * failure settles this lease, never clearing current or forging a pass.
   */
  async claimValidation(id: string, ownerKey: string, fence: () => void): Promise<{ job: QuestionCodeJob; epoch: number }> {
    this.get(id, ownerKey)
    const job = await this.domain.table('jobs').update(id, current => {
      if (current.ownerKey !== ownerKey) throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
      fence()
      const attempt = current.attempts.at(-1)
      const rejectedCandidate = current.status === 'failed' && current.code === 'ACCEPTANCE_REJECTED'
        && attempt?.status === 'rejected'
      const expiredLease = current.status === 'validating' && attempt?.status === 'running'
        && Date.parse(current.updatedAt) + VALIDATION_LEASE_MS <= this.now().getTime()
      if ([...this.activeTickets.values()].some(ticket => ticket.jobId === id && ticket.expiresAt > this.now().getTime())
        || current.status !== 'queued' && current.status !== 'candidate' && !expiredLease && !rejectedCandidate) {
        throw new QuestionCodeJobError('VALIDATION_BUSY', '候选正在验收或任务已结束。')
      }
      if (attempt === undefined || attempt.candidateSha256 === undefined
        || current.status === 'queued' && attempt.status !== 'infrastructure-failed'
        || current.status === 'candidate' && attempt.status !== 'running') {
        throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '任务没有可重验的冻结候选。')
      }
      const row = [...this.domain.table('artifacts').entries()]
        .map(([, value]) => value).find(value => questionCodeJobMatchesArtifact(current, value))
      if (row === undefined) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '任务的冻结源不一致。')
      const previous = current.validation
      // sourceRef also pins the request/owner/job identity checked on the row above.
      if (rejectedCandidate && (previous === undefined || previous.version !== 1 || previous.passed !== false
        || previous.candidateSha256 !== attempt.candidateSha256 || previous.leaseEpoch !== current.leaseEpoch
        || previous.sceneSha256 !== current.sceneSha256 || previous.sceneRevision !== current.sceneRevision
        || previous.sourceRef !== row.id || previous.checks.length === 0)) {
        throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '旧拒绝证据未完整绑定当前冻结候选。')
      }
      if (previous !== undefined && this.domain.table('validation_history').get(validationHistoryKey(current, previous)) !== undefined
        && !this.archived(current, previous)) {
        throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '同租约历史报告不一致，不能覆盖。')
      }
      if (this.historyEntries(current).length >= QUESTION_CODE_VALIDATION_HISTORY_LIMIT) {
        throw new QuestionCodeJobError('VALIDATION_HISTORY_FULL', '验收历史已达上限，不能覆盖旧判定。')
      }
      const at = this.now().toISOString()
      this.revokeJobTickets(id)
      return {
        ...current, status: 'validating', leaseEpoch: current.leaseEpoch + 1,
        attempts: current.attempts.map((value, index) => index === current.attempts.length - 1
          ? { ...value, status: 'running' as const } : value),
        updatedAt: at,
      }
    })
    try {
      await this.archiveValidation(job, fence)
      const current = this.requireLive(id, job.leaseEpoch)
      if (current.status !== 'validating' || current.attempts.at(-1)?.status !== 'running') {
        throw new QuestionCodeJobError('NOT_LIVE', '本次验收租约已结束。')
      }
      fence()
      this.assertArchived(current)
      return { job: this.withHistory(current), epoch: current.leaseEpoch }
    } catch (error) {
      if (error instanceof QuestionCodeJobError && error.code === 'STALE_SOURCE') {
        await this.supersede(id, '归档期间题目源已变化，旧候选不能发布。', job.leaseEpoch)
      } else {
        try { await this.finish(id, job.leaseEpoch, { status: 'infrastructure-failed', code: 'VALIDATION_ARCHIVE_FAILED' }, fence) }
        catch (settlement) {
          if (!(settlement instanceof QuestionCodeJobError && ['NOT_LIVE', 'STALE_LEASE', 'NOT_FOUND'].includes(settlement.code))) {
            await this.supersede(id, '验收归档未完成，旧候选不能发布。', job.leaseEpoch)
          }
        }
      }
      if (error instanceof QuestionCodeJobError) throw error
      throw new QuestionCodeJobError('VALIDATION_ARCHIVE_FAILED', '旧验收报告未能持久化，候选仍未通过。')
    }
  }

  /** Start the next bounded attempt. Attempts are capped at 2 (initial + one repair). */
  async startAttempt(job: QuestionCodeJob): Promise<{ job: QuestionCodeJob; epoch: number }> {
    const next = await this.domain.table('jobs').update(job.id, current => {
      if (current.leaseEpoch !== job.leaseEpoch) throw new QuestionCodeJobError('STALE_LEASE', '任务已被新的执行者接管。')
      if (current.status === 'validating') throw new QuestionCodeJobError('VALIDATION_BUSY', '候选正在隔离验收。')
      if (current.attempts.length >= 2) throw new QuestionCodeJobError('NOT_LIVE', '生成任务的重试次数已用尽。')
      const at = this.now().toISOString()
      const attempt: JobAttempt = { index: current.attempts.length, status: 'running', startedAt: at }
      this.revokeJobTickets(job.id)
      return { ...current, status: 'running', leaseEpoch: current.leaseEpoch + 1,
        attempts: [...current.attempts, attempt], updatedAt: at }
    })
    return { job: next, epoch: next.leaseEpoch }
  }

  /** Freeze the candidate an attempt produced, before acceptance. */
  async recordCandidate(id: string, epoch: number, candidate: CandidateInput): Promise<QuestionCodeJob> {
    this.requireLive(id, epoch)
    return this.domain.table('jobs').update(id, job => {
      this.requireLive(id, epoch)
      const attempt = job.attempts.at(-1)
      if (attempt?.status !== 'running') throw new QuestionCodeJobError('NO_ATTEMPT', '生成任务没有运行中的尝试。')
      if (attempt.candidateSha256 !== undefined) {
        if (attempt.candidateSha256 !== candidate.candidateSha256) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '冻结候选不能在同一次尝试中替换。')
        return job
      }
      const attempts = job.attempts.map((value, index) => index === job.attempts.length - 1
        ? {
          ...value, candidateSha256: candidate.candidateSha256,
          ...(candidate.repair === undefined ? {} : {
            code: candidate.repair.code,
            ...(candidate.repair.reason === undefined ? {} : { reason: candidate.repair.reason }),
            ...(candidate.repair.diagnostics === undefined ? {} : { diagnostics: [...candidate.repair.diagnostics] }),
          }),
        } : value)
      return { ...job, status: 'candidate', attempts, updatedAt: this.now().toISOString() }
    })
  }

  /**
   * Commit current isolated-browser evidence only under its live source/lease.
   * The report must name the frozen digest; prior history never supplies a pass.
   */
  async recordValidation(id: string, epoch: number, validation: ValidationInput, fence?: () => void): Promise<QuestionCodeJob> {
    this.requireLive(id, epoch)
    return this.domain.table('jobs').update(id, current => {
      const job = this.requireLive(id, epoch)
      if (job !== current) throw new QuestionCodeJobError('STALE_LEASE', '任务已变化。')
      fence?.()
      this.assertArchived(job)
      const attempt = job.attempts.at(-1)
      if (attempt?.status !== 'running' || attempt.candidateSha256 !== validation.candidateSha256
        || validation.passed && (validation.checks.length === 0 || validation.checks.some(check => !check.passed))) {
        throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '验收结果与冻结的候选不一致。')
      }
      const row = [...this.domain.table('artifacts').entries()]
        .map(([, value]) => value).find(value => questionCodeJobMatchesArtifact(job, value))
      if (row === undefined) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '验收结果缺少对应的冻结源。')
      return {
        ...job,
        status: 'validating',
        validation: {
          version: 1, passed: validation.passed, candidateSha256: validation.candidateSha256,
          leaseEpoch: epoch, sceneSha256: job.sceneSha256, sceneRevision: job.sceneRevision, sourceRef: row.id,
          checks: validation.checks.map(check => ({ ...check })),
          ...(validation.screenshotRef === undefined ? {} : { screenshotRef: validation.screenshotRef }),
          finishedAt: this.now().toISOString(),
        },
        updatedAt: this.now().toISOString(),
      }
    })
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
  }, fence?: () => void): Promise<QuestionCodeJob> {
    this.requireLive(id, epoch)
    const next = await this.domain.table('jobs').update(id, current => {
      const job = this.requireLive(id, epoch)
      if (job !== current) throw new QuestionCodeJobError('STALE_LEASE', '任务已变化。')
      fence?.()
      const index = job.attempts.length - 1
      const attempt = job.attempts[index]
      if (attempt === undefined) throw new QuestionCodeJobError('NO_ATTEMPT', '生成任务没有可结束的尝试。')
      if (attempt.status !== 'running') throw new QuestionCodeJobError('NOT_LIVE', '该尝试已经结束。')
      if (input.status === 'passed') {
        const validation = job.validation
        if (input.resultSha256 === undefined || input.resultRef === undefined || attempt.candidateSha256 !== input.resultSha256
          || validation?.passed !== true || validation.candidateSha256 !== input.resultSha256
          || validation.leaseEpoch !== epoch || validation.sceneSha256 !== job.sceneSha256
          || validation.sceneRevision !== job.sceneRevision || validation.sourceRef !== input.resultRef
          || validation.checks.length === 0 || validation.checks.some(check => !check.passed)) {
          throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '候选尚未通过同源同版本的验收，不能发布。')
        }
        const row = this.domain.table('artifacts').get(input.resultRef)
        if (row === undefined || !questionCodeJobMatchesArtifact(job, row)) {
          throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '发布结果与冻结源不一致。')
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
      const next: QuestionCodeJobRecord = input.status === 'passed'
        ? { ...job, status: 'ready', attempts, resultRef: input.resultRef, resultSha256: input.resultSha256, updatedAt: at }
        : input.status === 'cancelled'
          ? { ...job, status: 'cancelled', attempts, code: input.code ?? 'CANCELLED', message: input.message, updatedAt: at }
          : input.status === 'infrastructure-failed'
            ? { ...job, status: 'queued', attempts, code: input.code ?? 'INFRASTRUCTURE', updatedAt: at }
            : { ...job, status: 'failed', attempts, code: input.code ?? 'FAILED', message: input.message, updatedAt: at }
      // Once terminal or queued again, no resource capability survives the run.
      this.revokeJobTickets(id)
      return next
    })
    return this.withHistory(next)
  }

  /** Cancellation is terminal; any in-flight attempt becomes cancelled. */
  async cancel(id: string, ownerKey: string, reason = '用户取消'): Promise<QuestionCodeJob> {
    this.get(id, ownerKey)
    return this.domain.table('jobs').update(id, job => {
      if (job.ownerKey !== ownerKey) throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
      if (!isLive(job.status)) return job
      const at = this.now().toISOString()
      const attempts = job.attempts.map((attempt, index) => index === job.attempts.length - 1 && attempt.status === 'running'
        ? { ...attempt, status: 'cancelled' as const, finishedAt: at } : attempt)
      this.revokeJobTickets(id)
      return { ...job, status: 'cancelled', attempts, code: 'CANCELLED', message: reason, leaseEpoch: job.leaseEpoch + 1, updatedAt: at }
    })
  }

  /** A scene/revision move makes older work unpublishable. */
  async supersede(id: string, reason: string, expectedEpoch?: number): Promise<QuestionCodeJob> {
    if (this.domain.table('jobs').get(id) === undefined) throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
    return this.domain.table('jobs').update(id, job => {
      if (!isLive(job.status) || expectedEpoch !== undefined && job.leaseEpoch !== expectedEpoch) return job
      this.revokeJobTickets(id)
      return { ...job, status: 'superseded', code: 'SUPERSEDED', message: reason, leaseEpoch: job.leaseEpoch + 1, updatedAt: this.now().toISOString() }
    })
  }

  private historyEntries(job: QuestionCodeJobRecord): QuestionCodeValidationHistory[] {
    return [...this.domain.table('validation_history').entries()].map(([, entry]) => entry)
      .filter(entry => entry.jobId === job.id && entry.ownerKey === job.ownerKey)
      .sort((left, right) => left.leaseEpoch - right.leaseEpoch)
  }

  private withHistory(job: QuestionCodeJobRecord): QuestionCodeJob {
    const validationHistory = this.historyEntries(job).map(({ validation }) => ({ ...validation, checks: validation.checks.map(check => ({ ...check })) }))
    return validationHistory.length === 0 ? job : { ...job, validationHistory }
  }

  private archived(job: QuestionCodeJobRecord, validation: QuestionCodeValidation): boolean {
    const entry = this.domain.table('validation_history').get(validationHistoryKey(job, validation))
    return entry !== undefined && entry.jobId === job.id && entry.ownerKey === job.ownerKey
      && entry.leaseEpoch === (validation.leaseEpoch ?? 0) && sameValidation(entry.validation, validation)
  }

  /** A claimed/reclaimed lease cannot overwrite prior current evidence before durable archival, even after restart. */
  private assertArchived(job: QuestionCodeJobRecord): void {
    const previous = job.validation
    if (job.status === 'validating' && previous !== undefined && previous.leaseEpoch !== job.leaseEpoch && !this.archived(job, previous)) {
      throw new QuestionCodeJobError('VALIDATION_BUSY', '旧验收报告尚未归档，不能开始新的判定。')
    }
  }

  /** Idempotent, immutable insert by job/owner/old lease; the caller still owns the newly claimed lease. */
  private async archiveValidation(job: QuestionCodeJobRecord, fence: () => void): Promise<void> {
    const previous = job.validation
    if (previous === undefined) return
    const table = this.domain.table('validation_history'), key = validationHistoryKey(job, previous)
    const existing = table.get(key)
    if (existing === undefined) {
      const pending = this.archiveWrites.get(key)
      if (pending !== undefined) await pending
      else {
        this.requireLive(job.id, job.leaseEpoch)
        fence()
        if (this.historyEntries(job).length >= QUESTION_CODE_VALIDATION_HISTORY_LIMIT) {
          throw new QuestionCodeJobError('VALIDATION_HISTORY_FULL', '验收历史已达上限，不能覆盖旧判定。')
        }
        const write = table.put(key, { jobId: job.id, ownerKey: job.ownerKey, leaseEpoch: previous.leaseEpoch ?? 0,
          validation: { ...previous, checks: previous.checks.map(check => ({ ...check })) } })
        this.archiveWrites.set(key, write)
        try { await write } finally { if (this.archiveWrites.get(key) === write) this.archiveWrites.delete(key) }
      }
    }
    if (!this.archived(job, previous)) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '同租约历史报告不一致，不能覆盖。')
  }

  private revokeJobTickets(id: string): void {
    for (const ticket of [...this.tickets.values(), ...this.activeTickets.values()]) {
      if (ticket.jobId === id) this.revokeTicket(ticket.token)
    }
  }

  /** Mint a bounded capability only for this attempt's verified source record. */
  issueTicket(id: string, epoch: number, ttlMs = MAX_TICKET_TTL_MS): ValidationTicket {
    const job = this.requireLive(id, epoch)
    this.assertArchived(job)
    const digest = job.attempts.at(-1)?.candidateSha256
    if (digest === undefined) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '没有冻结的候选可供验收。')
    const row = [...this.domain.table('artifacts').entries()]
      .map(([, value]) => value).find(value => questionCodeJobMatchesArtifact(job, value))
    if (row === undefined) throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '验收候选缺少同任务的冻结源。')
    if (job.attempts.at(-1)?.status !== 'running') throw new QuestionCodeJobError('NOT_LIVE', '该验收尝试已结束。')
    if ([...this.activeTickets.values()].some(ticket => ticket.jobId === id && ticket.expiresAt > this.now().getTime())) {
      throw new QuestionCodeJobError('VALIDATION_BUSY', '候选正在隔离验收。')
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new QuestionCodeJobError('NOT_FOUND', '验收票据有效期无效。')
    for (const ticket of [...this.tickets.values(), ...this.activeTickets.values()]) {
      if (ticket.expiresAt <= this.now().getTime() || ticket.jobId === id) this.revokeTicket(ticket.token)
    }
    // A new ticket never extends or reopens an older validation session.
    const token = `${id}.${randomBytes(24).toString('base64url')}`
    const ticket: ValidationTicket = Object.freeze({
      token, jobId: id, epoch, ownerSessionId: job.ownerSessionId, ownerKey: job.ownerKey,
      artifactId: row.id, sceneId: job.sceneId, sceneRevision: job.sceneRevision,
      sceneSha256: job.sceneSha256, candidateSha256: digest,
      ...(job.requestSha256 === undefined ? {} : { requestSha256: job.requestSha256 }),
      expiresAt: this.now().getTime() + Math.min(ttlMs, MAX_TICKET_TTL_MS),
    })
    this.tickets.set(token, ticket)
    return ticket
  }

  /** Activate once; concurrent validations cannot reuse the same capability. */
  redeemTicket(token: string, id: string, candidateSha256: string): ValidationTicket {
    const ticket = this.requireTicket(this.tickets, token, id, candidateSha256)
    this.tickets.delete(token)
    this.activeTickets.set(token, ticket)
    return ticket
  }

  /** Multiple frozen resources may be read only inside that active validation. */
  validationTicket(token: string, candidateSha256: string): ValidationTicket {
    const ticket = this.activeTickets.get(token)
    if (ticket === undefined) throw new QuestionCodeJobError('NOT_FOUND', '验收票据无效或已过期。')
    return this.requireTicket(this.activeTickets, token, ticket.jobId, candidateSha256)
  }

  revokeTicket(token: string): void {
    this.tickets.delete(token)
    this.activeTickets.delete(token)
  }

  private requireTicket(tickets: Map<string, ValidationTicket>, token: string, id: string, candidateSha256: string): ValidationTicket {
    const ticket = tickets.get(token)
    if (ticket === undefined || ticket.jobId !== id || ticket.candidateSha256 !== candidateSha256) {
      throw new QuestionCodeJobError('NOT_FOUND', '验收票据无效或已过期。')
    }
    try {
      if (ticket.expiresAt <= this.now().getTime()) throw new QuestionCodeJobError('NOT_FOUND', '验收票据无效或已过期。')
      const job = this.requireLive(id, ticket.epoch)
      const row = this.domain.table('artifacts').get(ticket.artifactId)
      if (job.attempts.at(-1)?.status !== 'running' || job.ownerKey !== ticket.ownerKey
        || job.ownerSessionId !== ticket.ownerSessionId || job.sceneId !== ticket.sceneId
        || job.sceneRevision !== ticket.sceneRevision || job.sceneSha256 !== ticket.sceneSha256
        || job.requestSha256 !== ticket.requestSha256 || row === undefined
        || !questionCodeJobMatchesArtifact(job, row)) {
        throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '验收票据与当前冻结候选不一致。')
      }
      return ticket
    } catch (error) {
      this.revokeTicket(token)
      throw error
    }
  }

  /** Jobs left mid-attempt by a restart: queued again after the lease window. */
  stale(now = this.now(), leaseMs = 10 * 60 * 1000): QuestionCodeJob[] {
    return [...this.domain.table('jobs').entries()]
      .map(([, job]) => job)
      .filter(job => job.status === 'running' && job.attempts.at(-1)?.status === 'running'
        && Date.parse(job.attempts.at(-1)!.startedAt) + leaseMs <= now.getTime())
  }

  private requireLive(id: string, epoch: number): QuestionCodeJobRecord {
    const job = this.domain.table('jobs').get(id)
    if (job === undefined) throw new QuestionCodeJobError('NOT_FOUND', '未找到该生成任务。')
    if (!isLive(job.status)) throw new QuestionCodeJobError('NOT_LIVE', '任务已经结束，迟到的结果不会发布。')
    if (job.leaseEpoch !== epoch) throw new QuestionCodeJobError('STALE_LEASE', '任务已被新的执行者接管。')
    return job
  }
}
