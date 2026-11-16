/**
 * Scheduler for isolated acceptance of a generated experiment candidate.
 *
 * Flow, all on the app side (the only writer of job state):
 *   1. a candidate has been frozen for a live attempt (`recordCandidate`);
 *   2. the scheduler mints a one-time ticket bound to that digest;
 *   3. it reads the canonical scene frozen with that candidate;
 *   4. the isolated worker plans real engine snapshots and accepts the package;
 *   5. it rechecks the source/lease and only then may publish the job's `ready`.
 *      Owner-only preview readiness is a separate, non-acceptance state.
 *
 * Failure policy:
 *   - a rejection consumes the attempt (the existing repair loop decides
 *     whether a second attempt is allowed);
 *   - an unreachable worker is an infrastructure failure: the job returns to
 *     `queued` and the model repair budget is NOT consumed;
 *   - a missing worker configuration leaves the candidate unaccepted. It is
 *     never treated as a pass.
 */
import { QuestionCodeJobError, type QuestionCodeJobs, type ValidationSourceBinding } from './question-code-jobs.ts'
import { questionSceneSha256, type QuestionCodeArtifactService, type QuestionCodeIdentity } from './question-code-service.ts'
import { ExperimentError, type IdentityActor } from './identity.ts'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { CodeVisualizationState } from '@physicsos/agent-tools'

export interface ValidationFrame {
  readonly frameId: string
  readonly snapshot: Record<string, unknown>
}

interface CandidateSourceEvent {
  readonly type: string
  readonly seq: number
  readonly data: {
    readonly sceneId: string
    readonly revision: number
    readonly scene: PhysicsScene
    readonly visualization?: CodeVisualizationState
  }
}
interface CandidateSourceSession {
  readonly header: { readonly id: string; readonly parentSession?: unknown }
  snapshotEvents(): readonly CandidateSourceEvent[]
  isOwnSeq(seq: number): boolean
}

/** Read-only own-session fence. Never activates an Agent or resumes a model turn. */
export async function currentCandidateSource(
  binding: ValidationSourceBinding,
  deps: { readonly lookup: (key: string) => unknown; readonly identity: () => QuestionCodeIdentity | undefined },
): Promise<() => void> {
  const sessions = deps.lookup('sessions') as { get(id: string): CandidateSourceSession | undefined } | undefined
  const attached = sessions?.get(binding.ownerSessionId)
  let events: readonly CandidateSourceEvent[] = []
  let inherited = 0
  if (attached === undefined) {
    const controller = deps.lookup('sessionController') as {
      inspect(id: string): Promise<{ readonly meta: { readonly id: string; readonly parentSession?: unknown }; readonly inheritedEventCount: number; readonly events: readonly CandidateSourceEvent[] }>
    } | undefined
    if (controller === undefined) throw new ExperimentError(503, 'SESSIONS_UNAVAILABLE', '会话读取服务尚未就绪。')
    const inspected = await controller.inspect(binding.ownerSessionId)
    if (String(inspected.meta.id) !== binding.ownerSessionId || inspected.meta.parentSession !== undefined) {
      throw new ExperimentError(409, 'SESSION_UNAVAILABLE', '无法读取候选所属的主对话。')
    }
    events = inspected.events
    inherited = inspected.inheritedEventCount
  }
  return () => {
    if (deps.identity()?.sessionOwnerKey(binding.ownerSessionId) !== binding.ownerKey) {
      throw new QuestionCodeJobError('STALE_SOURCE', '对话归属已变化。')
    }
    const session = sessions?.get(binding.ownerSessionId)
    if (attached !== undefined && session !== attached) throw new QuestionCodeJobError('STALE_SOURCE', '对话挂载已变化。')
    if (session !== undefined && (String(session.header.id) !== binding.ownerSessionId || session.header.parentSession !== undefined)) {
      throw new QuestionCodeJobError('STALE_SOURCE', '对话身份已变化。')
    }
    // Own events, not inherited scenes or a shared mutable physics runtime.
    const own = session === undefined ? events.filter(event => event.seq >= inherited) : session.snapshotEvents().filter(event => session.isOwnSeq(event.seq))
    const current = own.findLast(event => event.type === 'physics/scene')?.data
    const ref = current?.visualization
    if (current?.sceneId !== binding.sceneId || current.revision !== binding.sceneRevision
      || questionSceneSha256(current.scene) !== binding.sceneSha256
      || ref?.ownerSessionId !== binding.ownerSessionId || ref.sceneId !== binding.sceneId
      || ref.sceneRevision !== binding.sceneRevision || ref.requestSha256 !== binding.requestSha256
      || (ref.status === 'ready' ? ref.artifactId !== binding.artifactId || ref.sha256 !== binding.candidateSha256
        || ref.sceneSha256 !== binding.sceneSha256 : ref.status !== 'generating' || ref.jobId !== binding.jobId)) {
      throw new QuestionCodeJobError('STALE_SOURCE', '当前对话已不再引用这个冻结候选。')
    }
  }
}

export interface CandidateValidationInput {
  readonly jobId: string
  readonly epoch: number
  readonly candidateSha256: string
  /** Digest and revision of the scene the candidate was frozen for. */
  readonly sceneSha256: string
  readonly sceneRevision: number
  /** App-authorized canonical scene from the candidate's frozen source. */
  readonly scene?: Record<string, unknown>
  /** Pinned engine frames; omit to let the worker plan them from the scene. */
  readonly frames?: readonly ValidationFrame[]
  readonly changedFrame?: ValidationFrame
  /**
   * Absolute URLs the worker can reach. The worker generates the driving host
   * page itself; only the opaque wrapper (app-owned) needs serving.
   */
  readonly wrapperUrl: string
  readonly entryUrl: string
  readonly ticket: string
}

export type CandidateValidationOutcome =
  | { readonly kind: 'passed'; readonly checks: readonly { readonly name: string; readonly passed: boolean; readonly detail?: string }[]; readonly screenshotRef?: string; readonly durationMs: number }
  | { readonly kind: 'rejected'; readonly checks: readonly { readonly name: string; readonly passed: boolean; readonly detail?: string }[]; readonly screenshotRef?: string; readonly durationMs: number }
  | { readonly kind: 'infrastructure'; readonly code: string; readonly message: string }

export interface ValidationWorkerConfig {
  readonly url: string
  readonly token: string
  readonly timeoutMs?: number
}

export class ValidationWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ValidationWorkerError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Trusted app seam: callers identify a candidate; they cannot supply scene/frames/URLs. */
export type FrozenCandidateValidationInput = Pick<CandidateValidationInput,
  'jobId' | 'epoch' | 'candidateSha256' | 'sceneSha256' | 'sceneRevision' | 'ticket'>

export async function validateFrozenCandidate(
  config: ValidationWorkerConfig | undefined,
  input: FrozenCandidateValidationInput,
  deps: {
    readonly jobs: QuestionCodeJobs
    readonly artifacts: Pick<QuestionCodeArtifactService, 'validatorScene' | 'assertValidationSource'>
    readonly publicOrigin: string
    /** Server-owned current own-session source check; never forwarded to the worker. */
    readonly sourceFence?: (binding: ValidationSourceBinding) => void
    readonly currentSource?: (binding: ValidationSourceBinding) => Promise<() => void>
    readonly fetchImpl?: typeof fetch
  },
): Promise<CandidateValidationOutcome | undefined> {
  // No worker means a private candidate, never a made-up validation pass.
  if (config === undefined) return undefined
  const binding = deps.jobs.redeemTicket(input.ticket, input.jobId, input.candidateSha256)
  let currentFence: (() => void) | undefined
  let workerOutcome: CandidateValidationOutcome | undefined
  const assertCurrent = (): void => {
    deps.jobs.validationTicket(binding.token, binding.candidateSha256)
    deps.artifacts.assertValidationSource(binding)
    deps.sourceFence?.(binding)
    currentFence?.()
    if (binding.epoch !== input.epoch || binding.sceneSha256 !== input.sceneSha256
      || binding.sceneRevision !== input.sceneRevision) {
      throw new QuestionCodeJobError('CANDIDATE_MISMATCH', '验收请求与冻结的候选身份不一致。')
    }
  }
  try {
    assertCurrent()
    currentFence = await deps.currentSource?.(binding)
    assertCurrent()
    const scene = await deps.artifacts.validatorScene(binding)
    assertCurrent()
    const base = deps.publicOrigin.replace(/\/$/, '')
    const prefix = `${base}/physicsos/question-code/validation/${binding.token}/${binding.candidateSha256}`
    const outcome = await requestCandidateValidation(config, {
      jobId: binding.jobId, epoch: binding.epoch, candidateSha256: binding.candidateSha256,
      sceneSha256: binding.sceneSha256, sceneRevision: binding.sceneRevision, scene,
      ticket: binding.token, wrapperUrl: `${prefix}/shell/wrapper.html`, entryUrl: `${prefix}/dist/index.html`,
    }, deps.fetchImpl)
    workerOutcome = outcome
    // Refresh persisted reads as well as live-session fences after the worker round trip.
    if (deps.currentSource !== undefined) currentFence = await deps.currentSource(binding)
    assertCurrent()
    if (outcome.kind === 'infrastructure') {
      await deps.jobs.finish(binding.jobId, binding.epoch, {
        status: 'infrastructure-failed', code: outcome.code, message: outcome.message,
      }, assertCurrent)
      return outcome
    }
    await deps.jobs.recordValidation(binding.jobId, binding.epoch, {
      passed: outcome.kind === 'passed', candidateSha256: binding.candidateSha256, checks: outcome.checks,
      ...(outcome.screenshotRef === undefined ? {} : { screenshotRef: outcome.screenshotRef }),
    }, assertCurrent)
    await deps.jobs.finish(binding.jobId, binding.epoch, outcome.kind === 'passed'
      ? { status: 'passed', resultRef: binding.artifactId, resultSha256: binding.candidateSha256 }
      : { status: 'rejected', code: 'ACCEPTANCE_REJECTED' }, assertCurrent)
    return outcome
  } catch (error) {
    // A source/lease move fences both evidence and subsequent resource reads.
    if (error instanceof QuestionCodeJobError && error.code === 'STALE_SOURCE') {
      await deps.jobs.supersede(binding.jobId, '题目源已变化，旧候选不能通过验收。', binding.epoch)
    } else {
      // An expired ticket/read failure cannot strand the validation lease. Queue
      // only an infrastructure settlement, guarded by the still-current source.
      try {
        await deps.jobs.finish(binding.jobId, binding.epoch, {
          status: 'infrastructure-failed', code: workerOutcome?.kind === 'infrastructure' ? workerOutcome.code : 'VALIDATION_INTERRUPTED',
        }, () => { deps.artifacts.assertValidationSource(binding); deps.sourceFence?.(binding); currentFence?.() })
      } catch { /* A newer lease/source already owns settlement; never overwrite it. */ }
    }
    throw error
  } finally {
    deps.jobs.revokeTicket(binding.token)
  }
}

/** Owner-only recovery of worker failures, without generation or model calls. */
export async function retryFrozenCandidate(
  config: ValidationWorkerConfig | undefined,
  jobId: string,
  actor: IdentityActor,
  deps: {
    readonly jobs: QuestionCodeJobs
    readonly artifacts: Pick<QuestionCodeArtifactService, 'validationSource' | 'validatorScene' | 'assertValidationSource'>
    readonly publicOrigin: string
    readonly currentSource: (binding: ValidationSourceBinding) => Promise<() => void>
    readonly fetchImpl?: typeof fetch
  },
): Promise<import('./question-code-domain.ts').QuestionCodeJob> {
  const binding = deps.artifacts.validationSource(jobId, actor)
  if (config === undefined) throw new ValidationWorkerError('WORKER_UNCONFIGURED', '隔离验收服务尚未配置，候选仍未通过。')
  const sourceFence = await deps.currentSource(binding)
  const assertCurrent = (): void => {
    deps.artifacts.assertValidationSource(binding)
    sourceFence()
  }
  assertCurrent()
  // Verify canonical frozen bytes before changing the lease, not from request JSON.
  await deps.artifacts.validatorScene(binding)
  assertCurrent()
  const started = await deps.jobs.claimValidation(jobId, actor.userKey, assertCurrent)
  const ticket = deps.jobs.issueTicket(jobId, started.epoch)
  await validateFrozenCandidate(config, {
    jobId, epoch: started.epoch, candidateSha256: binding.candidateSha256,
    sceneSha256: binding.sceneSha256, sceneRevision: binding.sceneRevision, ticket: ticket.token,
  }, { jobs: deps.jobs, artifacts: deps.artifacts, publicOrigin: deps.publicOrigin, currentSource: deps.currentSource,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }) })
  return deps.jobs.get(jobId, actor.userKey)
}

/**
 * Call the worker and normalise its answer. Anything that is not a
 * well-formed report is an infrastructure failure, not a rejection: a broken
 * worker must never look like a judgement about the experiment.
 */
export async function requestCandidateValidation(
  config: ValidationWorkerConfig,
  input: CandidateValidationInput,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<CandidateValidationOutcome> {
  const pinnedFrames = Array.isArray(input.frames) && input.frames.length >= 2 && input.frames.length <= 8
    && isRecord(input.changedFrame)
  if (!isRecord(input.scene) && !pinnedFrames) {
    return { kind: 'infrastructure', code: 'WORKER_INPUT_MISSING', message: 'frozen scene or complete engine frames required' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, config.timeoutMs ?? 60_000)
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { reject(new Error('worker deadline exceeded')) }
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const response = await Promise.race([fetchImpl(`${config.url.replace(/\/$/, '')}/validate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        wrapperUrl: input.wrapperUrl,
        entryUrl: input.entryUrl,
        token: input.ticket,
        ...(input.scene === undefined ? {} : { scene: input.scene }),
        ...(input.frames === undefined ? {} : { frames: input.frames }),
        ...(input.changedFrame === undefined ? {} : { changedFrame: input.changedFrame }),
        expected: {
          candidateSha256: input.candidateSha256,
          sceneSha256: input.sceneSha256,
          sceneRevision: input.sceneRevision,
        },
      }),
      signal: controller.signal,
    }), aborted])
    if (!response.ok) {
      return { kind: 'infrastructure', code: `WORKER_${response.status}`, message: `worker answered ${response.status}` }
    }
    let body: unknown
    try { body = await Promise.race([response.json(), aborted]) } catch {
      return { kind: 'infrastructure', code: controller.signal.aborted ? 'WORKER_TIMEOUT' : 'WORKER_BAD_JSON', message: controller.signal.aborted ? 'worker deadline exceeded' : 'worker returned invalid JSON' }
    }
    if (!isRecord(body) || !Array.isArray(body.checks) || typeof body.durationMs !== 'number'
      || !Number.isFinite(body.durationMs) || body.durationMs < 0 || typeof body.passed !== 'boolean') {
      return { kind: 'infrastructure', code: 'WORKER_BAD_REPORT', message: 'worker returned an unexpected report' }
    }
    const checks = body.checks.filter((check): check is { name: string; passed: boolean; detail?: string } =>
      isRecord(check) && typeof check.name === 'string' && check.name.length > 0 && check.name.length <= 80
      && typeof check.passed === 'boolean' && (check.detail === undefined || typeof check.detail === 'string' && check.detail.length <= 600))
      .map(check => ({ name: check.name, passed: check.passed, ...(check.detail === undefined ? {} : { detail: check.detail }) }))
    if (checks.length === 0) return { kind: 'infrastructure', code: 'WORKER_EMPTY_REPORT', message: 'worker returned no checks' }
    if (checks.length !== body.checks.length || checks.length > 20) {
      return { kind: 'infrastructure', code: 'WORKER_BAD_REPORT', message: 'worker returned invalid checks' }
    }
    const passed = body.passed === true && checks.every(check => check.passed)
    const screenshotRef = typeof body.screenshot === 'string' && body.screenshot.length > 100
      ? `screenshot:${input.jobId}:${input.epoch}`
      : undefined
    return {
      kind: passed ? 'passed' : 'rejected',
      checks,
      ...(screenshotRef === undefined ? {} : { screenshotRef }),
      durationMs: body.durationMs,
    }
  } catch {
    // Do not relay fetch errors: their URL can contain the validation capability.
    return { kind: 'infrastructure', code: controller.signal.aborted ? 'WORKER_TIMEOUT' : 'WORKER_UNREACHABLE', message: controller.signal.aborted ? 'worker deadline exceeded' : 'worker unreachable' }
  } finally {
    clearTimeout(timer)
    if (onAbort !== undefined) controller.signal.removeEventListener('abort', onAbort)
  }
}

/** A configured worker, or undefined when the deployment has none (fail closed). */
export function validationWorkerFromEnv(env: NodeJS.ProcessEnv = process.env): ValidationWorkerConfig | undefined {
  const url = env.PHYSICSOS_VALIDATION_URL?.trim()
  const token = env.PHYSICSOS_VALIDATION_TOKEN?.trim()
  if (url === undefined || url === '' || token === undefined || token.length < 24) return undefined
  return { url, token }
}
