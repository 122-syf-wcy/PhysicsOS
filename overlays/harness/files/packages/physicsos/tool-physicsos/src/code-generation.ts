/**
 * Bounded, parent-owned code generation.
 *
 * One job = at most two child runs (the second either repairs a refused
 * source or resumes a run the upstream cut short), one shared deadline
 * (`CODE_TIMEOUT_MS`), one shared write budget, and a stale check against the
 * exact scene revision at every step. Durable parent events contain
 * references only: the source lives in the host's artifact store.
 * @module @deepseek-ai/dsh-tool-physicsos/code-generation
 */
import { randomUUID, createHash } from 'node:crypto'
import { canonicalJson, type CodeExperimentRef, type CodeVisualizationSource, type CodeVisualizationState } from '@physicsos/agent-tools'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { PhysicsSceneSnapshot } from './types.ts'
import {
  classifyIncompleteRun,
  codeOf,
  failureMessageFor,
  generationError,
  isRetryable,
  trustedSourceValidationReason,
  type GenerationCode,
  type PartialSource,
} from './generation-errors.ts'
import { questionCodePrompt, type CodeRepair, type CodeStyleContext } from './question-code-prompt.ts'

export type { CodeStyleContext } from './question-code-prompt.ts'

export const CODE_TIMEOUT_MS = 600_000
/** Child runs per job: the first attempt plus one repair or resume. */
const MAX_ATTEMPTS = 2
/** Output cap per child request; the parent's own cap is never raised for the child. */
const CHILD_MAX_TOKENS = 8192

export const CODE_SOURCE_SCHEMA: ObjectJsonSchema = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string', description: 'Required nonempty title, at most 120 characters.' }, summary: { type: 'string', description: 'At most 1000 characters.' },
  rendererJs: { type: 'string', description: 'Start with export async function renderFrame(snapshot) { ... }, then any small helpers. Use native Canvas2D or SVG. No imports, old renderer or empty wrapper; at most 96000 characters.' }, stylesheet: { type: 'string', description: 'CSS for the independent experimental scene, at most 24000 characters.' },
}, required: ['title', 'summary', 'rendererJs', 'stylesheet'] }

export interface CodeGenerationDependencies {
  ownerSessionId: string
  snapshot: PhysicsSceneSnapshot
  signal: AbortSignal
  experimentId: string
  instructions?: string
  timeoutMs?: number
  context(experimentId: string): Promise<CodeStyleContext>
  start(request: Pick<
    SubagentStartRequest, 'prompt' | 'signal' | 'outputSchema' | 'maxDepth' | 'toolFilter' | 'label' | 'agentOptions'
  >): Promise<Pick<SubagentRun, 'id' | 'result' | 'dispose'>>
  create(input: {
    ownerSessionId: string
    scene: unknown
    experimentId: string
    childSessionId: string
    source: CodeVisualizationSource
    generationId: string
  }, signal?: AbortSignal): Promise<CodeExperimentRef>
  assetManifest?(generationId: string): unknown
  current(): PhysicsSceneSnapshot | undefined
  isCurrent?(): boolean
  publish(snapshot: PhysicsSceneSnapshot): void
}

const sceneHash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex')

/** Static quality boundary: metadata/CSS changes cannot turn a bare SDK reexport into question code. */
const MODULE_TRIVIA = String.raw`(?:\s|//[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*`
const MODULE_REEXPORT = String.raw`export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^{}]*\})\s+from\s+(?:"[^"\r\n]+"|'[^'\r\n]+')\s*;?`
const ONLY_REEXPORT = new RegExp(`^${MODULE_TRIVIA}(?:${MODULE_REEXPORT}${MODULE_TRIVIA})+$`)

/** The four-field source a completed child must have produced, or an `INVALID_SOURCE` refusal. */
function checkedSource(result: SubagentResult): CodeVisualizationSource {
  if (result.stopReason !== 'completed') throw generationError('CHILD_INCOMPLETE', 'Child did not finish')
  const value = result.structured
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw generationError('INVALID_SOURCE', 'Invalid structured result')
  const source = value as CodeVisualizationSource
  if (Object.keys(value).sort().join(',') !== 'rendererJs,stylesheet,summary,title' || Object.values(value).some(v => typeof v !== 'string')
    || !source.title.trim() || source.title.length > 120 || source.summary.length > 1000 || !source.rendererJs.trim()
    || source.rendererJs.length > 96000 || source.stylesheet.length > 24000) throw generationError('INVALID_SOURCE', 'Invalid structured result')
  return source
}

/** The job's cancellation: the caller's signal fused with the job deadline. */
class GenerationClock {
  private readonly controller = new AbortController()
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly onAbort = (): void => { this.controller.abort(this.caller.reason) }

  constructor(private readonly caller: AbortSignal, timeoutMs: number) {
    caller.addEventListener('abort', this.onAbort, { once: true })
    if (caller.aborted) this.onAbort()
    this.timer = setTimeout(() => {
      this.controller.abort(generationError('GENERATION_TIMEOUT', 'Code generation timed out'))
    }, timeoutMs)
  }

  get signal(): AbortSignal { return this.controller.signal }
  get aborted(): boolean { return this.controller.signal.aborted }

  /** The code a cancellation reports: timeout when the deadline fired, abort otherwise. */
  private abortError(): Error {
    const code = codeOf(this.controller.signal.reason) === 'GENERATION_TIMEOUT' ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED'
    return generationError(code, 'Generation aborted')
  }

  /** Race `work` against cancellation so no awaited step outlives the job. */
  async wait<T>(work: Promise<T>): Promise<T> {
    if (this.aborted) throw this.abortError()
    let listener: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      listener = () => { reject(this.abortError()) }
      this.controller.signal.addEventListener('abort', listener, { once: true })
    })
    try {
      return await Promise.race([work, aborted])
    } finally {
      if (listener !== undefined) this.controller.signal.removeEventListener('abort', listener)
    }
  }

  /** Release the deadline and the caller listener; abort so every retry checkpoint settles. */
  dispose(): void {
    clearTimeout(this.timer)
    this.caller.removeEventListener('abort', this.onAbort)
    // The shared signal owns all retry checkpoints, including a final failed run.
    // Disposal has already settled the children before this releases job resources.
    this.controller.abort()
  }
}

/**
 * Run one job: context → up to two child runs → host validation → publish.
 * Resolves with the final visualization state (ready or failed); it rejects
 * only for programming errors, never for a model or host refusal.
 * @param deps - the parent's capabilities and the frozen scene snapshot.
 * @returns the terminal state, which has also been published when still current.
 */
export async function generateQuestionCode(deps: CodeGenerationDependencies): Promise<CodeVisualizationState> {
  const jobId = randomUUID()
  const original = deps.snapshot
  const expectedHash = sceneHash(original.scene)
  const clock = new GenerationClock(deps.signal, deps.timeoutMs ?? CODE_TIMEOUT_MS)
  const deadlineAt = Date.now() + (deps.timeoutMs ?? CODE_TIMEOUT_MS)
  const identity = { ownerSessionId: deps.ownerSessionId, sceneId: original.sceneId, sceneRevision: original.revision }
  /* Still the same scene revision, same facts, and still this job's own `generating` marker. */
  const isCurrent = (): boolean => {
    const current = deps.current()
    return deps.isCurrent?.() !== false && current?.sceneId === original.sceneId && current.revision === original.revision
      && sceneHash(current.scene) === expectedHash && current.visualization?.status === 'generating' && current.visualization.jobId === jobId
  }
  const publish = (visualization: CodeVisualizationState): void => { deps.publish({ ...original, visualization }) }
  publish({ status: 'generating', jobId, deadlineAt, ...identity })

  try {
    const style = await clock.wait(deps.context(deps.experimentId))
    let repair: CodeRepair | undefined
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (!isCurrent()) throw generationError('STALE_GENERATION', 'Scene changed')
      const outcome = await runAttempt(deps, clock, style, original, repair, jobId, isCurrent)
      if (outcome.kind === 'ready') return outcome.ref
      const last = attempt === MAX_ATTEMPTS - 1
      if (last || !outcome.retryable || clock.aborted || !isCurrent()) throw outcome.error
      repair = outcome.repair
    }
    throw new Error('Code generation did not settle')
  } catch (error) {
    const code = codeOf(error)
    const failed: CodeVisualizationState = { status: 'failed', jobId, ...identity, code, message: failureMessageFor(code) }
    if (isCurrent()) publish(failed)
    return failed
  } finally {
    clock.dispose()
  }
}

type AttemptOutcome =
  | { kind: 'ready'; ref: CodeExperimentRef }
  | { kind: 'failed'; error: unknown; retryable: boolean; repair: CodeRepair }

/**
 * One child run through host validation. Never throws for a refusal: the
 * caller decides whether the outcome earns the second attempt.
 */
async function runAttempt(
  deps: CodeGenerationDependencies,
  clock: GenerationClock,
  style: CodeStyleContext,
  original: PhysicsSceneSnapshot,
  repair: CodeRepair | undefined,
  jobId: string,
  isCurrent: () => boolean,
): Promise<AttemptOutcome> {
  // Await start directly: its provider owns cancellation until publication;
  // racing start would lose the holder and leak a late published child.
  const run = await deps.start({
    label: `题目实验代码 · ${original.title.slice(0, 100)}`,
    prompt: [{ type: 'text', text: questionCodePrompt(style, original, deps.instructions, repair, deps.assetManifest?.(jobId)) }],
    signal: clock.signal,
    outputSchema: CODE_SOURCE_SCHEMA,
    toolFilter: { allow: [] },
    maxDepth: 1,
    agentOptions: { maxTokens: CHILD_MAX_TOKENS },
  })
  let rejectedSource: CodeVisualizationSource | undefined
  let canContinueTokenLimit = false
  try {
    const result = await clock.wait(run.result) as SubagentResult & { partialSource?: unknown; diagnostic?: string }
    if (result.stopReason !== 'completed') {
      if (result.stopReason === 'aborted') throw generationError('GENERATION_ABORTED', 'Child aborted')
      const incomplete = classifyIncompleteRun(result, deps.assetManifest?.(jobId))
      canContinueTokenLimit = incomplete.canContinueTokenLimit
      throw generationError(incomplete.code, 'Child did not finish', { partialSource: incomplete.partialSource })
    }
    const source = checkedSource(result)
    rejectedSource = source
    if (ONLY_REEXPORT.test(source.rendererJs)) {
      throw generationError('INVALID_SOURCE', 'A renderer must draw the question independently', { sourceValidationReason: 'legacy_renderer' })
    }
    if (!isCurrent()) throw generationError('STALE_GENERATION', 'Scene changed')
    if (clock.aborted) throw generationError('GENERATION_ABORTED', 'Generation aborted')
    const ref = await clock.wait(deps.create({
      ownerSessionId: deps.ownerSessionId, scene: original.scene, experimentId: style.experimentId,
      childSessionId: String(run.id), source, generationId: jobId,
    }, clock.signal))
    if (ref.rendererKind !== 'independent') throw generationError('INVALID_METADATA', 'Host did not validate an independent renderer')
    if (!isCurrent()) throw generationError('STALE_GENERATION', 'Scene changed')
    deps.publish({ ...original, visualization: ref })
    return { kind: 'ready', ref }
  } catch (error) {
    const code: GenerationCode = codeOf(error)
    const retryable = isRetryable(code) || (code === 'MAX_TOKENS' && canContinueTokenLimit)
    const reason = trustedSourceValidationReason(error)
    const partial = typeof error === 'object' && error !== null && 'partialSource' in error
      ? error.partialSource as PartialSource | undefined
      : undefined
    const source = rejectedSource ?? partial
    return {
      kind: 'failed',
      error,
      retryable,
      repair: {
        code,
        ...(reason === undefined ? {} : { reason }),
        ...(source === undefined ? {} : { source: { ...source } }),
      },
    }
  } finally {
    await run.dispose()
  }
}
