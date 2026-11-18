/** One immutable model decision per visualization job; no ambient provider fallback. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'

export interface CodeMainModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: ReasoningEffortId
}
export interface CodeModelDecision extends CodeMainModel {
  readonly source: 'dedicated' | 'main'
  readonly actualModel: string
  readonly configRevision?: string
  readonly fallbackReason?: 'unconfigured' | 'all-http429'
}
export interface VisualizationChannels {
  acquireTextRoute(input: { requestId: string; signal: AbortSignal }): Promise<
    | { status: 'ready'; provider: string; model: string; routeId: string; actualModel: string; configRevision: string }
    | { status: 'unconfigured' | 'rate-limited' }
  >
  textOutcome(routeId: string): { kind: string; allAccountsRateLimited: boolean } | undefined
  releaseTextRoute(routeId: string): void
  recordMainFallback?(input: { requestId: string; provider: string; model: string; reason: 'unconfigured' | 'all-http429' }): void | Promise<void>
}
interface HeldRoute {
  readonly ownerSessionId: string
  readonly main: CodeMainModel
  readonly expiresAt: number
  readonly channels: VisualizationChannels | undefined
  readonly ready: Promise<CodeModelDecision>
  decision?: CodeModelDecision
  routeId?: string
}
const routeName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value)

/** The page may have a server-persisted picker choice not yet consumed by a main turn. */
export function mainModelForVisualization(parent: Agent): CodeMainModel {
  const inherited = parentAgentOptionsForDelegation(parent)
  const projections = parent.ctx.get('sessionProjections') as unknown as {
    stateOf(session: Agent['session'], key: 'modelSelection'): { pending?: unknown } | undefined
  } | undefined
  const pending = projections?.stateOf(parent.session, 'modelSelection')?.pending
  const next = pending !== null && typeof pending === 'object' ? pending as Partial<CodeMainModel> : undefined
  const selected = routeName(next?.provider) && routeName(next?.model) ? next : inherited
  const provider = selected.provider, model = selected.model
  if (!routeName(provider) || !routeName(model)) throw Object.assign(new Error('The initiating conversation has no model route'), { code: 'MODEL_ROUTE_UNAVAILABLE' })
  const effort = selected.reasoningEffort
  return Object.freeze({ provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
}

/** Configuration edits affect new jobs; a retry cannot switch to another account's model. */
export class CodeModelRouting {
  private readonly jobs = new Map<string, HeldRoute>()
  constructor(private readonly lookup: () => VisualizationChannels | undefined, private readonly now = Date.now) {}

  async resolve(parent: Agent, requestId: string, signal: AbortSignal): Promise<CodeModelDecision> {
    signal.throwIfAborted()
    this.prune()
    const prior = this.jobs.get(requestId)
    if (prior) {
      if (prior.ownerSessionId !== String(parent.id)) throw Object.assign(new Error('Visualization job has another initiating session'), { code: 'STALE_GENERATION' })
      return prior.decision ?? prior.ready
    }
    if (this.jobs.size >= 64) throw Object.assign(new Error('Visualization routing capacity reached'), { code: 'GENERATION_CAPACITY' })
    const main = mainModelForVisualization(parent), channels = this.lookup()
    // Defer the lookup one microtask so the reservation is visible first.
    const ready = Promise.resolve().then(async (): Promise<CodeModelDecision> => {
      signal.throwIfAborted()
      const route = channels === undefined ? { status: 'unconfigured' as const } : await channels.acquireTextRoute({ requestId, signal })
      if (signal.aborted) {
        if (route.status === 'ready') channels?.releaseTextRoute(route.routeId)
        signal.throwIfAborted()
      }
      if (route.status !== 'ready') return this.fallback(requestId, held, route.status === 'rate-limited' ? 'all-http429' : 'unconfigured')
      if (![route.provider, route.model, route.routeId, route.actualModel, route.configRevision].every(routeName)) throw new Error('Invalid dedicated visualization route')
      held.routeId = route.routeId
      const selected: CodeModelDecision = Object.freeze({ provider: route.provider, model: route.model, actualModel: route.actualModel, source: 'dedicated', configRevision: route.configRevision })
      held.decision = selected
      return selected
    })
    const held: HeldRoute = { ownerSessionId: String(parent.id), main, channels, expiresAt: this.now() + 20 * 60_000, ready }
    this.jobs.set(requestId, held)
    const release = (): void => { this.release(requestId) }
    signal.addEventListener('abort', release, { once: true })
    if (signal.aborted) release()
    try { return await ready }
    catch (error) { this.release(requestId); throw error }
  }

  /** Only a trusted, fully accounted HTTP429 outcome changes the next author attempt. */
  reviewRateLimit(requestId: string): boolean {
    const held = this.jobs.get(requestId)
    if (!held?.routeId || held.decision?.source !== 'dedicated') return false
    const result = held.channels?.textOutcome(held.routeId)
    if (result?.kind !== 'rate-limited' || result.allAccountsRateLimited !== true) return false
    this.fallback(requestId, held, 'all-http429')
    return true
  }

  release(requestId: string): void {
    const held = this.jobs.get(requestId)
    if (!held) return
    this.jobs.delete(requestId)
    if (held.routeId) held.channels?.releaseTextRoute(held.routeId)
  }
  private fallback(requestId: string, held: HeldRoute, reason: 'unconfigured' | 'all-http429'): CodeModelDecision {
    const decision: CodeModelDecision = Object.freeze({ ...held.main, source: 'main', actualModel: held.main.model, fallbackReason: reason })
    held.decision = decision
    // Observation cannot change an admitted model choice or expose credentials.
    try { void Promise.resolve(held.channels?.recordMainFallback?.({ requestId, ...held.main, reason })).catch(() => {}) } catch {}
    return decision
  }
  private prune(): void { for (const [key, held] of this.jobs) if (held.expiresAt < this.now()) this.release(key) }
}
