import { randomUUID } from 'node:crypto'
import type {
  AttemptRecord,
  EventTable,
  FinishAttemptInput,
  JobEvent,
  JobTable,
  Lease,
  SubmitTaskInput,
  TaskRecord,
  TaskStatus,
  ValidationReport,
} from './types.ts'

/** Stable, client-independent task identity. */
const newTaskId = (): string => `task_${randomUUID().replaceAll('-', '')}`
const newEventId = (): string => `evt_${randomUUID().replaceAll('-', '')}`
const isLive = (status: TaskStatus): boolean => status === 'queued' || status === 'running'

export class JobError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'JobError'
  }
}

export interface TaskStoreOptions {
  readonly tasks: JobTable
  readonly events: EventTable
  readonly now?: () => Date
  readonly id?: () => string
  readonly eventId?: () => string
  /** Default lease length for one attempt. */
  readonly leaseMs?: number
}

/**
 * Durable task state machine.
 *
 * One authoritative writer (the app) calls every method; workers never hold a
 * reference to the tables. State and its outbox event are persisted together
 * so a crash cannot announce work that was never accepted, or accept work
 * whose progress can never be delivered. `put` is the commit point: callers
 * pass a table whose `put` is synchronous-in-transaction, as the existing
 * storage-domain `put` is.
 */
export class TaskStore {
  private readonly now: () => Date
  private readonly taskId: () => string
  private readonly eventId: () => string
  private readonly leaseMs: number

  constructor(private readonly options: TaskStoreOptions) {
    this.now = options.now ?? (() => new Date())
    this.taskId = options.id ?? newTaskId
    this.eventId = options.eventId ?? newEventId
    this.leaseMs = options.leaseMs ?? 10 * 60 * 1000
  }

  /** Submit a task. A live task with the same dedupe key and owner is returned unchanged. */
  async submit(input: SubmitTaskInput): Promise<TaskRecord> {
    const at = this.now().toISOString()
    if (input.dedupeKey !== undefined) {
      const existing = this.findLive(input.dedupeKey, input.owner.userKey, input.kind)
      if (existing !== undefined) return existing
    }
    const task: TaskRecord = {
      id: this.taskId(),
      kind: input.kind,
      owner: input.owner,
      input: input.input,
      status: 'queued',
      leaseEpoch: 0,
      attempts: [],
      budgetMs: input.budgetMs ?? 600_000,
      createdAt: at,
      updatedAt: at,
      ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
    }
    await this.options.tasks.put(task.id, task)
    await this.appendEvent(task, 'task', { status: task.status })
    return task
  }

  /**
   * Read a task. Ownership is mandatory for everything the browser or a
   * model can reach; a mismatched owner is indistinguishable from missing.
   */
  get(taskId: string, ownerKey: string): TaskRecord {
    const task = this.options.tasks.get(taskId)
    if (task === undefined || task.owner.userKey !== ownerKey) throw new JobError('NOT_FOUND', '未找到该任务。')
    return task
  }

  /** Internal lookup without an owner: only the scheduler uses it. */
  find(taskId: string): TaskRecord | undefined {
    return this.options.tasks.get(taskId)
  }

  /**
   * Claim queued work, or reclaim running work whose lease expired (a crashed
   * app/worker). Returns undefined when nothing is claimable.
   */
  async claim(taskId: string, ownerToken: string): Promise<Lease | undefined> {
    const at = this.now()
    let task = this.options.tasks.get(taskId)
    if (task === undefined) return undefined
    if (task.status === 'queued') {
      // The attempt starts empty so a crash before any run still resumes cleanly.
    } else if (task.status === 'running') {
      const current = task.attempts.at(-1)
      if (current !== undefined && current.status === 'running' && !this.expired(task, at)) return undefined
    } else {
      return undefined
    }
    const attempt: AttemptRecord = {
      taskId: task.id,
      index: task.attempts.length,
      status: 'running',
      startedAt: at.toISOString(),
    }
    task = {
      ...task,
      status: 'running',
      leaseEpoch: task.leaseEpoch + 1,
      attempts: [...task.attempts, attempt],
      updatedAt: at.toISOString(),
    }
    await this.options.tasks.put(task.id, task)
    await this.appendEvent(task, 'attempt', { index: attempt.index, leaseEpoch: task.leaseEpoch })
    return { taskId: task.id, epoch: task.leaseEpoch, ownerToken, expiresAt: new Date(at.getTime() + this.leaseMs).toISOString() }
  }

  /** Freeze the candidate a repair attempt produced, before validation. */
  async recordCandidate(taskId: string, epoch: number, candidate: { readonly ref: string; readonly sha256: string; readonly repair?: AttemptRecord['repair'] }): Promise<void> {
    const task = this.requireLive(taskId, epoch)
    const attempts = task.attempts.map((attempt, index) => index === task.attempts.length - 1
      ? { ...attempt, candidateRef: candidate.ref, candidateSha256: candidate.sha256, ...(candidate.repair === undefined ? {} : { repair: candidate.repair }) }
      : attempt)
    await this.options.tasks.put(taskId, { ...task, attempts, updatedAt: this.now().toISOString() })
  }

  /**
   * Finish the current attempt. A passed attempt must carry the exact
   * candidate digest that validation reported, and a still-live lease; a
   * late worker from an older epoch cannot publish.
   */
  async finish(taskId: string, epoch: number, input: FinishAttemptInput): Promise<TaskRecord> {
    const task = this.requireLive(taskId, epoch)
    const last = task.attempts.length - 1
    const current = task.attempts[last]
    if (current === undefined) throw new JobError('NO_ATTEMPT', '任务没有可结束的尝试。')
    if (input.status === 'passed') {
      if (input.result === undefined) throw new JobError('RESULT_REQUIRED', '通过验收的尝试必须携带结果摘要。')
      if (current.candidateSha256 !== undefined && current.candidateSha256 !== input.result.sha256) {
        throw new JobError('CANDIDATE_MISMATCH', '验收结果与冻结的候选不一致。')
      }
    }
    const finished: AttemptRecord = {
      ...current,
      status: input.status,
      finishedAt: this.now().toISOString(),
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.message === undefined ? {} : { message: input.message }),
    }
    const attempts = [...task.attempts.slice(0, last), finished]
    const next: TaskRecord = input.status === 'passed'
      ? { ...task, status: 'ready', attempts, resultRef: input.result!.ref, resultSha256: input.result!.sha256, updatedAt: this.now().toISOString() }
      : input.status === 'cancelled'
        ? { ...task, status: 'cancelled', attempts, code: input.code ?? 'CANCELLED', updatedAt: this.now().toISOString() }
        : input.status === 'infrastructure-failed'
          // Infrastructure failure does not consume a model repair: stay queued so the next claim retries.
          ? { ...task, status: 'queued', attempts, code: input.code ?? 'INFRASTRUCTURE', updatedAt: this.now().toISOString() }
          : { ...task, status: 'failed', attempts, code: input.code ?? 'FAILED', message: input.message, updatedAt: this.now().toISOString() }
    await this.options.tasks.put(taskId, next)
    await this.appendEvent(next, input.status === 'passed' ? 'validated' : input.status === 'cancelled' ? 'cancelled' : 'attempt',
      { status: input.status, index: last, ...(input.status === 'passed' ? { resultRef: input.result!.ref } : {}) })
    return next
  }

  /** Attach the browser-worker report to the finished attempt, re-checking the candidate digest. */
  async recordValidation(taskId: string, epoch: number, report: ValidationReport): Promise<void> {
    const task = this.requireLive(taskId, epoch)
    const last = task.attempts.length - 1
    const current = task.attempts[last]
    if (current === undefined) throw new JobError('NO_ATTEMPT', '任务没有可验收的尝试。')
    if (current.candidateSha256 !== report.candidateSha256) throw new JobError('CANDIDATE_MISMATCH', '验收报告的候选摘要不一致。')
    const attempts = task.attempts.map((attempt, index) => index === last ? { ...attempt, validation: report } : attempt)
    await this.options.tasks.put(taskId, { ...task, attempts, updatedAt: this.now().toISOString() })
  }

  /** Cancellation is terminal for the task; late results are refused by `requireLive`. */
  async cancel(taskId: string, ownerKey: string, reason = '用户取消'): Promise<TaskRecord> {
    const task = this.get(taskId, ownerKey)
    if (!isLive(task.status)) return task
    const attempts = task.attempts.map((attempt, index) => index === task.attempts.length - 1 && attempt.status === 'running'
      ? { ...attempt, status: 'cancelled' as const, finishedAt: this.now().toISOString() }
      : attempt)
    const next: TaskRecord = { ...task, status: 'cancelled', attempts, code: 'CANCELLED', message: reason, leaseEpoch: task.leaseEpoch + 1, updatedAt: this.now().toISOString() }
    await this.options.tasks.put(taskId, next)
    await this.appendEvent(next, 'cancelled', { reason })
    return next
  }

  /** Mark a task superseded because its scene/revision moved on. Late work cannot publish. */
  async supersede(taskId: string, reason: string): Promise<TaskRecord> {
    const task = this.options.tasks.get(taskId)
    if (task === undefined) throw new JobError('NOT_FOUND', '未找到该任务。')
    if (!isLive(task.status)) return task
    const next: TaskRecord = { ...task, status: 'superseded', code: 'SUPERSEDED', message: reason, leaseEpoch: task.leaseEpoch + 1, updatedAt: this.now().toISOString() }
    await this.options.tasks.put(taskId, next)
    await this.appendEvent(next, 'superseded', { reason })
    return next
  }

  /** Idempotently deliver pending events. `deliver` must tolerate a repeated event id. */
  async drain(deliver: (event: JobEvent) => Promise<void>, limit = 100): Promise<number> {
    const pending = [...this.options.events.entries()]
      .map(([, event]) => event)
      .sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq)
      .slice(0, limit)
    for (const event of pending) {
      await deliver(event)
      await this.options.events.delete(event.id)
    }
    return pending.length
  }

  private findLive(dedupeKey: string, ownerKey: string, kind: SubmitTaskInput['kind']): TaskRecord | undefined {
    for (const [, task] of this.options.tasks.entries()) {
      if (task.dedupeKey === dedupeKey && task.kind === kind && task.owner.userKey === ownerKey && isLive(task.status)) return task
    }
    return undefined
  }

  private requireLive(taskId: string, epoch: number): TaskRecord {
    const task = this.options.tasks.get(taskId)
    if (task === undefined) throw new JobError('NOT_FOUND', '未找到该任务。')
    if (!isLive(task.status)) throw new JobError('NOT_LIVE', '任务已经结束，迟到的结果不会发布。')
    if (task.leaseEpoch !== epoch) throw new JobError('STALE_LEASE', '任务已被新的执行者接管。')
    return task
  }

  private expired(task: TaskRecord, at: Date): boolean {
    const started = task.attempts.at(-1)?.startedAt
    return started === undefined || Date.parse(started) + this.leaseMs <= at.getTime()
  }

  private async appendEvent(task: TaskRecord, kind: JobEvent['kind'], payload: Record<string, unknown>): Promise<void> {
    const seq = [...this.options.events.entries()].filter(([, event]) => event.taskId === task.id).length
    const event: JobEvent = { id: this.eventId(), taskId: task.id, seq, kind, at: this.now().toISOString(), payload }
    await this.options.events.put(event.id, event)
  }
}
