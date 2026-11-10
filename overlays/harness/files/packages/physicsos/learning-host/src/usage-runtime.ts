/** Runtime bridge for exact Session owners and proved Agent descendants. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent'
import type { UsageService } from './usage-service.ts'
import type { UsageOwner } from './usage-types.ts'
import { LearningError } from './identity.ts'
export interface UsageOwnedSession extends UsageOwner {
  readonly sessionId: string
}
export interface UsageOwnership {
  readonly ownerForSession: (sessionId: string) => UsageOwner | undefined
  readonly ownedSessions: () => Iterable<UsageOwnedSession>
}
export class UsageRuntime {
  private readonly releases: (() => void)[] = []
  private readonly lifetime = new AbortController()
  private readonly timer: ReturnType<typeof setInterval>
  private running: Promise<void> | undefined
  private dirty = false
  private closed = false
  private isClosed(): boolean {
    return this.closed
  }
  private constructor(
    private readonly ctx: Context,
    private readonly service: UsageService,
    private readonly ownership: UsageOwnership,
    private readonly onError: (error: Error) => void,
  ) {
    const changed = (): undefined => {
      void this.flush().catch(this.onError)
      return undefined
    }
    this.releases.push(ctx.on('session/event', changed))
    this.releases.push(ctx.on('agent/created', changed))
    this.releases.push(
      ctx.on('domain/changed', (change) => {
        if (change.domain === 'physicsos_auth' && change.table === 'api_resources') changed()
      }),
    )
    this.timer = setInterval(changed, service.limits.scanIntervalMs)
    this.timer.unref()
  }
  /**
   * Mount usage observers.
   * @param ctx - Session and Agent services.
   * @param service - Durable usage service.
   * @param ownership - Exact auth inventory.
   * @param options - Safe diagnostics.
   * @returns Ready runtime.
   */
  static async create(
    ctx: Context,
    service: UsageService,
    ownership: UsageOwnership,
    options: { readonly onError?: (error: Error) => void } = {},
  ): Promise<UsageRuntime> {
    const runtime = new UsageRuntime(ctx, service, ownership, options.onError ?? (() => {}))
    try {
      await runtime.flush()
      return runtime
    } catch (error) {
      await runtime.dispose()
      throw error
    }
  }
  private same(left: UsageOwner | undefined, right: UsageOwner | undefined): boolean {
    return left !== undefined && right !== undefined && left.schoolId === right.schoolId && left.userKey === right.userKey
  }
  private async owned(): Promise<Map<string, UsageOwner>> {
    const found = new Map<string, UsageOwner>()
    for (const row of this.ownership.ownedSessions()) {
      if (this.same(row, this.ownership.ownerForSession(row.sessionId))) found.set(row.sessionId, row)
    }
    const bindings = this.service.childBindings()
    let changed = true
    while (changed) {
      changed = false
      for (const child of bindings) {
        if (found.has(child.sessionId)) continue
        const exact = this.ownership.ownerForSession(child.sessionId)
        if (exact !== undefined || !this.same(found.get(child.parentSessionId), child)) continue
        found.set(child.sessionId, child)
        changed = true
      }
    }
    const agents = this.ctx.get('agents')
    if (agents !== undefined) {
      const live = agents.list()
      for (const [parentId, owner] of found) {
        const parent = agents.get(SessionId(parentId))
        if (parent === undefined) continue
        for (const child of live) {
          if (found.has(child.id) || this.ownership.ownerForSession(child.id) !== undefined || !agents.isOwnedBy(child.id, parent)) continue
          if (!this.same(found.get(parentId), owner) || agents.get(child.id) !== child) continue
          await this.service.bindChild({
            sessionId: child.id,
            parentSessionId: parentId,
            schoolId: owner.schoolId,
            userKey: owner.userKey,
            createdAt: new Date().toISOString(),
          })
          if (
            this.ownership.ownerForSession(child.id) === undefined &&
            agents.get(child.id) === child &&
            agents.isOwnedBy(child.id, parent)
          )
            found.set(child.id, owner)
        }
      }
    }
    return found
  }
  private async scan(): Promise<void> {
    const owners = await this.owned()
    if (owners.size === 0) return
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) throw new LearningError(503, 'USAGE_SESSION_QUERY_UNAVAILABLE', 'Session usage history is unavailable.')
    for (const [sessionId, owner] of owners) {
      if (this.closed) return
      const exact = this.ownership.ownerForSession(sessionId)
      if (exact !== undefined && !this.same(exact, owner)) continue
      try {
        using observation = await query.observeSession(SessionId(sessionId), { projectionMode: 'none', signal: this.lifetime.signal })
        const current = this.currentOwner(sessionId)
        if (!this.same(current, owner)) continue
        // The observation is one immutable cut; bounded passes share its exact inherited boundary.
        while (!this.isClosed() && this.service.sessionCursor(sessionId) < observation.cursor) {
          const before = this.service.sessionCursor(sessionId)
          await this.service.ingestSession({
            sessionId,
            owner,
            inheritedEventCount: observation.inheritedEventCount,
            events: observation.events,
          })
          if (this.service.sessionCursor(sessionId) <= before)
            throw new LearningError(503, 'USAGE_CHECKPOINT_STALLED', 'Session usage did not reach its durable checkpoint.')
        }
        if (!this.isClosed()) await this.service.sessionAvailability(sessionId, owner, true)
      } catch {
        if (this.isClosed()) return
        await this.service.sessionAvailability(sessionId, owner, false)
        this.onError(new LearningError(503, 'USAGE_SESSION_UNAVAILABLE', 'One owned session could not be accounted.'))
      }
    }
  }
  private currentOwner(sessionId: string): UsageOwner | undefined {
    const bindings = new Map(this.service.childBindings().map(row => [row.sessionId, row]))
    const visited = new Set<string>()
    let current = sessionId,
      expected: UsageOwner | undefined
    while (!visited.has(current)) {
      visited.add(current)
      const exact = this.ownership.ownerForSession(current)
      if (exact !== undefined) return expected === undefined || this.same(exact, expected) ? exact : undefined
      const binding = bindings.get(current)
      if (binding === undefined || (expected !== undefined && !this.same(binding, expected))) return undefined
      expected = binding
      current = binding.parentSessionId
    }
    return undefined
  }
  /** Catch up exact owners and retained observations. @returns Completion after admitted notifications settle. */
  flush(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.dirty = true
    if (this.running !== undefined) return this.running
    const task = (async () => {
      while (this.dirty && !this.closed) {
        this.dirty = false
        await this.scan()
      }
    })().catch(() => {
      // Provider/session errors may contain user text; expose only this numerical-accounting failure.
      throw new LearningError(503, 'USAGE_HISTORY_UNAVAILABLE', 'Some session usage could not be read or durably recorded.')
    })
    this.running = task
    void task
      .finally(() => {
        if (this.running === task) this.running = undefined
      })
      .catch(() => {})
    return task
  }
  /** Detach observers before service closure. @returns Completion after retained observations settle. */
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    for (const release of this.releases.splice(0)) release()
    this.lifetime.abort()
    await this.running?.catch(() => {})
  }
}
