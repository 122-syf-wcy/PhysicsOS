/**
 * Scheduler for isolated acceptance of a generated experiment candidate.
 *
 * Flow, all on the app side (the only writer of job state):
 *   1. a candidate has been frozen for a live attempt (`recordCandidate`);
 *   2. the scheduler mints a one-time ticket bound to that digest;
 *   3. it builds engine snapshots from the same runtime the Lab uses;
 *   4. it asks the isolated browser worker to accept the frozen package;
 *   5. it records the report and only then may publish `ready`.
 *
 * Failure policy:
 *   - a rejection consumes the attempt (the existing repair loop decides
 *     whether a second attempt is allowed);
 *   - an unreachable worker is an infrastructure failure: the job returns to
 *     `queued` and the model repair budget is NOT consumed;
 *   - a missing worker configuration leaves the candidate unaccepted. It is
 *     never treated as a pass.
 */

export interface ValidationFrame {
  readonly frameId: string
  readonly snapshot: Record<string, unknown>
}

export interface CandidateValidationInput {
  readonly jobId: string
  readonly epoch: number
  readonly candidateSha256: string
  /** Digest and revision of the scene the candidate was frozen for. */
  readonly sceneSha256: string
  readonly sceneRevision: number
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

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
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, config.timeoutMs ?? 60_000)
  let response: Response
  try {
    response = await fetchImpl(`${config.url.replace(/\/$/, '')}/validate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        wrapperUrl: input.wrapperUrl,
        entryUrl: input.entryUrl,
        token: input.ticket,
        ...(input.frames === undefined ? {} : { frames: input.frames }),
        ...(input.changedFrame === undefined ? {} : { changedFrame: input.changedFrame }),
        expected: {
          candidateSha256: input.candidateSha256,
          sceneSha256: input.sceneSha256,
          sceneRevision: input.sceneRevision,
        },
      }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    return { kind: 'infrastructure', code: controller.signal.aborted ? 'WORKER_TIMEOUT' : 'WORKER_UNREACHABLE', message: error instanceof Error ? error.message.slice(0, 300) : 'worker unreachable' }
  }
  clearTimeout(timer)
  if (!response.ok) {
    return { kind: 'infrastructure', code: `WORKER_${response.status}`, message: `worker answered ${response.status}` }
  }
  let body: unknown
  try { body = await response.json() } catch { return { kind: 'infrastructure', code: 'WORKER_BAD_JSON', message: 'worker returned invalid JSON' } }
  if (!isRecord(body) || !Array.isArray(body.checks) || typeof body.durationMs !== 'number') {
    return { kind: 'infrastructure', code: 'WORKER_BAD_REPORT', message: 'worker returned an unexpected report' }
  }
  const checks = body.checks.filter((check): check is { name: string; passed: boolean; detail?: string } =>
    isRecord(check) && typeof check.name === 'string' && typeof check.passed === 'boolean'
    && (check.detail === undefined || typeof check.detail === 'string'))
    .map(check => ({ name: check.name, passed: check.passed, ...(check.detail === undefined ? {} : { detail: check.detail }) }))
  if (checks.length === 0) return { kind: 'infrastructure', code: 'WORKER_EMPTY_REPORT', message: 'worker returned no checks' }
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
}

/** A configured worker, or undefined when the deployment has none (fail closed). */
export function validationWorkerFromEnv(env: NodeJS.ProcessEnv = process.env): ValidationWorkerConfig | undefined {
  const url = env.PHYSICSOS_VALIDATION_URL?.trim()
  const token = env.PHYSICSOS_VALIDATION_TOKEN?.trim()
  if (url === undefined || url === '' || token === undefined || token.length < 24) return undefined
  return { url, token }
}
