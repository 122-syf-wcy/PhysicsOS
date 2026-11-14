/** What a task does. One worker kind per task; no generic shell/agent task. */
export type TaskKind = 'experiment-code' | 'web-research'

/**
 * Public lifecycle. `queued`/`running` are the two live phases; a task that
 * needs another bounded attempt stays `running` and records a new attempt.
 */
export type TaskStatus = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'superseded'

/** Immutable per-attempt outcome; a repair is a new attempt, never a rewrite. */
export type AttemptStatus = 'running' | 'passed' | 'rejected' | 'infrastructure-failed' | 'cancelled'

export interface TaskOwner {
  /** Account key. Every read and write is scoped by it, never by a client field. */
  readonly userKey: string
  /** Chat session that started the task; used for ownership checks and event projection. */
  readonly ownerSessionId: string
}

/**
 * Everything a worker must know about its job, frozen at submission. Mutable
 * progress never lives here: changing `sceneRevision` produces a new task.
 */
export interface TaskInput {
  readonly sceneId?: string
  readonly sceneRevision?: number
  /** Canonical digest of the exact scene/source the result belongs to. */
  readonly inputSha256: string
  readonly experimentId?: string
  readonly instructions?: string
  readonly query?: string
  readonly generationId?: string
  readonly requestSha256?: string
}

export interface TaskRecord {
  readonly id: string
  readonly kind: TaskKind
  readonly owner: TaskOwner
  readonly input: TaskInput
  readonly status: TaskStatus
  /** Monotonic generation of the execution lease; results from older epochs are ignored. */
  readonly leaseEpoch: number
  readonly attempts: readonly AttemptRecord[]
  readonly budgetMs: number
  readonly createdAt: string
  readonly updatedAt: string
  /** Terminal failure/cancel information. */
  readonly code?: string
  readonly message?: string
  /** Result summary/artifact pointer written only after a passed validation. */
  readonly resultRef?: string
  readonly resultSha256?: string
  /** Live-request dedupe key; only a live task with the same key suppresses a new submission. */
  readonly dedupeKey?: string
}

export interface AttemptRecord {
  readonly taskId: string
  /** 0-based; the initial generation. */
  readonly index: number
  readonly status: AttemptStatus
  /** Candidate pointer frozen before validation; never overwritten by a repair. */
  readonly candidateRef?: string
  readonly candidateSha256?: string
  /** Structured, model-facing diagnostics from the previous attempt (bounded). */
  readonly repair?: AttemptRepair
  readonly startedAt: string
  readonly finishedAt?: string
  readonly validation?: ValidationReport
  readonly code?: string
  readonly message?: string
}

/** What a failed attempt hands to its single repair attempt. */
export interface AttemptRepair {
  readonly code: string
  readonly reason?: string
  readonly source?: unknown
  readonly diagnostics?: readonly string[]
  readonly screenshotRef?: string
}

export type ValidationCheckName =
  | 'first-frame'
  | 'runtime-error'
  | 'subject-drawn'
  | 'geometry-follows-engine'
  | 'motion-sampled'
  | 'parameter-change'
  | 'mobile-layout'
  | 'scene-binding'

export interface ValidationCheck {
  readonly name: ValidationCheckName
  readonly passed: boolean
  readonly detail?: string
}

/** Evidence returned by the isolated browser worker. It is not trusted until the app re-checks identity. */
export interface ValidationReport {
  readonly version: 1
  readonly passed: boolean
  readonly checks: readonly ValidationCheck[]
  /** sha256 of the canonical candidate (scene binding + source), recomputed by the app. */
  readonly candidateSha256: string
  readonly observations?: readonly Record<string, unknown>[]
  readonly screenshotRef?: string
  readonly finishedAt: string
}

/** Durable outbox row; written in the same transaction as the state change it announces. */
export interface JobEvent {
  readonly id: string
  readonly taskId: string
  readonly seq: number
  readonly kind: 'task' | 'attempt' | 'validated' | 'failed' | 'cancelled' | 'superseded'
  readonly at: string
  /** Summary only; large sources/screenshots stay in object storage by reference. */
  readonly payload: Record<string, unknown>
}

export interface SubmitTaskInput {
  readonly kind: TaskKind
  readonly owner: TaskOwner
  readonly input: TaskInput
  readonly budgetMs?: number
  /** If set, an identical live request returns the existing task instead of starting another. */
  readonly dedupeKey?: string
}

export interface Lease {
  readonly taskId: string
  readonly epoch: number
  readonly ownerToken: string
  readonly expiresAt: string
}

export interface FinishAttemptInput {
  readonly attempt: AttemptRecord
  readonly status: Exclude<AttemptStatus, 'running'>
  /** Present only for passed attempts; becomes the public result. */
  readonly result?: { readonly ref: string; readonly sha256: string }
  readonly code?: string
  readonly message?: string
}

/** One durable job can be provisioned with this narrow table (Postgres adapter maps `put`/`entries`). */
export interface JobTable {
  get(id: string): TaskRecord | undefined
  entries(): Iterable<readonly [string, TaskRecord]>
  put(id: string, record: TaskRecord): Promise<unknown>
  delete(id: string): Promise<unknown>
}

export interface EventTable {
  get(id: string): JobEvent | undefined
  entries(): Iterable<readonly [string, JobEvent]>
  put(id: string, record: JobEvent): Promise<unknown>
  delete(id: string): Promise<unknown>
}
