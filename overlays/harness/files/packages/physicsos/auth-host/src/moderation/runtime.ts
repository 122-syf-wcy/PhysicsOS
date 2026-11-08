import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { AuthDomain, ModerationCursor } from '../domain.ts'
import { AuthError, type AuthService } from '../service.ts'
import type { CapturedMessage, ModerationReviewer } from './types.ts'
import { ModerationService, moderationCaptureId } from './service.ts'
import { ModerationModelError } from './model.ts'

/** Live sockets retain only their original credential closures, never persisted secrets. */
export class AccountConnections {
  private readonly owners = new Map<string, Set<() => void>>()
  lifetime(owner: string, isActive: () => boolean) {
    return {
      isActive,
      registerInvalidation: (close: () => void): (() => void) => {
        const callbacks = this.owners.get(owner) ?? new Set<() => void>()
        this.owners.set(owner, callbacks)
        callbacks.add(close)
        // Register before checking to close the upgrade/disable race.
        if (!isActive()) close()
        return () => { callbacks.delete(close); if (!callbacks.size) this.owners.delete(owner) }
      },
    }
  }
  invalidate(owner: string): void {
    for (const close of [...this.owners.get(owner) ?? []]) close()
  }
  dispose(): void {
    for (const owner of [...this.owners.keys()]) this.invalidate(owner)
    this.owners.clear()
  }
}

/** Cancel exact persisted roots and descendants proved by the live Agent registry. */
export class AccountRuns {
  private readonly releases: (() => void)[] = []
  constructor(private readonly ctx: Context, private readonly domain: AuthDomain, private readonly auth: AuthService) {
    this.releases.push(ctx.on('agent/created', ({ agent }) => {
      if (this.disabledOwner(agent) !== undefined) {
        agent.cancel({ kind: 'hook', reason: 'account-disabled' }, { keepInbox: false })
        throw new Error('account-disabled')
      }
      return undefined
    }))
    // Session append observers cannot append cancellation events reentrantly.
    // This live notification runs after the durable splice has returned.
    this.releases.push(ctx.on('agent/inbox/inserted', ({ agent }) => { this.guardInput(agent.id) }))
    this.releases.push(ctx.on('agent/request', async ({ agent }, next) => {
      if (this.disabledOwner(agent)) { this.guardInput(agent.id); throw new Error('account-disabled') }
      const config = await next()
      if (this.disabledOwner(agent)) { this.guardInput(agent.id); throw new Error('account-disabled') }
      return config
    }))
  }
  private family(owner: string): Agent[] {
    const registry = this.ctx.get('agents')
    if (!registry) return []
    const live = registry.list()
    const found = new Set(live.filter(agent => this.auth.sessionOwnerKey(agent.id) === owner))
    for (const parent of found) for (const child of live) {
      const childOwner = this.auth.sessionOwnerKey(child.id)
      if ((childOwner === undefined || childOwner === owner) && registry.isOwnedBy(child.id, parent)) found.add(child)
    }
    return [...found].filter(agent => registry.get(agent.id) === agent)
  }
  private disabledOwner(agent: Agent): string | undefined {
    const exact = this.auth.sessionOwnerKey(agent.id)
    if (exact && this.domain.table('users').get(exact)?.status !== 'active') return exact
    const owners = new Set((this.ctx.get('agents')?.list() ?? []).map(root => this.auth.sessionOwnerKey(root.id)))
    for (const owner of owners) {
      if (owner && this.domain.table('users').get(owner)?.status !== 'active' && this.family(owner).includes(agent)) return owner
    }
    return undefined
  }
  guardInput(sessionId: string): void {
    const agent = this.ctx.get('agents')?.get(SessionId(sessionId))
    if (agent && this.disabledOwner(agent)) agent.cancel({ kind: 'hook', reason: 'account-disabled' }, { keepInbox: false })
  }
  async disable(owner: string): Promise<void> {
    const agents = this.family(owner)
    for (const agent of agents) agent.cancel({ kind: 'hook', reason: 'account-disabled' }, { keepInbox: false })
    // Do not let an uncooperative driver hold the administrator's request forever.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([Promise.all(agents.map(agent => agent.whenIdle())),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 1_000) })])
    } finally { clearTimeout(timer) }
    for (const agent of this.family(owner)) agent.cancel({ kind: 'hook', reason: 'account-disabled' }, { keepInbox: false })
  }
  dispose(): void { for (const release of this.releases) release() }
}

function humanInputs(sessionId: string, event: SessionEvent): CapturedMessage[] {
  const messages: readonly UserMessage[] = event.type === 'user/message' ? [event.data]
    : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
  return messages.filter(message => message.source.kind === 'user').map(message => ({
    sessionId, messageId: message.id,
    text: message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
  })).filter(message => message.text.length > 0)
}

/** Cordis-owned capture, bounded history intake and one serialized classifier worker. */
export class ModerationRuntime {
  readonly service: ModerationService
  private readonly lifetime = new AbortController()
  private readonly releases: (() => void)[] = []
  private queue: Promise<void> = Promise.resolve()
  private worker: Promise<void> = Promise.resolve()
  private running = false
  private history: Promise<void> = Promise.resolve()
  private lastCursor = ''
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false
  constructor(private readonly ctx: Context, private readonly domain: AuthDomain, private readonly auth: AuthService, review: ModerationReviewer,
    private readonly ready: () => boolean = () => true) {
    this.service = new ModerationService(domain, auth, {
      review: (input, signal) => review(input, AbortSignal.any([signal, this.lifetime.signal])),
      scan: limit => this.scan(limit),
    })
    this.releases.push(ctx.on('session/event', (session, event) => {
      // Unknown owners are supplemented from the log after claim, never held as raw-text backlog.
      if (event.seq < session.inheritedEventCount || this.auth.sessionOwnerKey(session.id) === undefined) return
      const inputs = humanInputs(session.id, event)
      if (!inputs.length) return
      // Capture only, never call the model on the publication stack.
      this.enqueue(async () => {
        const ownerKey = this.auth.sessionOwnerKey(session.id)
        if (ownerKey === undefined) return
        const cursors = this.domain.table('moderation_cursors'), id = `claim:${session.id}`
        const previous = cursors.get(id)
        // Retain a durable replay boundary before writing cases. A transient
        // case write failure must not turn a committed user event into a lost job.
        await cursors.put(id, { id, kind: 'claim', sessionId: session.id, ownerKey,
          seq: previous?.ownerKey === ownerKey ? Math.min(previous.seq, event.seq) : event.seq, index: 0, done: false })
        for (const input of inputs) await this.service.capture(input)
      })
    }))
    this.releases.push(ctx.on('domain/changed', change => {
      if (change.domain !== 'physicsos_auth' || change.table !== 'api_resources' || change.operation !== 'put') return
      const row = domain.table('api_resources').get(String(change.key))
      if (!row || row.kind !== 'session' || row.id !== change.key || row.id !== `session:${row.resourceId}`
        || auth.sessionOwnerKey(row.resourceId) !== row.ownerKey) return
      this.enqueue(async () => {
        if (auth.sessionOwnerKey(row.resourceId) !== row.ownerKey) return
        const table = domain.table('moderation_cursors')
        const id = `claim:${row.resourceId}`
        const old = table.get(id)
        await table.put(id, old?.ownerKey === row.ownerKey ? { ...old, done: false } : {
          id, sessionId: row.resourceId, ownerKey: row.ownerKey, kind: 'claim', seq: 0, index: 0, done: false,
        })
        await this.supplement()
      })
    }))
    this.timer = setInterval(() => { this.tick() }, 1_000)
    this.timer.unref()
  }
  private enqueue(work: () => Promise<void>): void {
    if (this.closed) return
    this.queue = this.queue.then(work).catch(() => {
      // Original evidence stays in the authoritative log; cursor advances only on success.
      this.ctx.logger.warn('moderation: capture deferred; authoritative history retained')
    })
  }
  private tick(): void {
    if (this.closed || this.running) return
    this.running = true
    this.worker = (async () => {
      await this.flush()
      await this.supplement().catch(() => { this.ctx.logger.warn('moderation: history retry pending') })
      if (!this.closed && this.ready()) await this.service.processNext(this.lifetime.signal)
    })().catch(() => { this.ctx.logger.warn('moderation: worker retry pending') }).finally(() => { this.running = false })
  }
  private valid(cursor: ModerationCursor): boolean {
    return !this.closed && this.auth.sessionOwnerKey(cursor.sessionId) === cursor.ownerKey
      && this.domain.table('users').get(cursor.ownerKey)?.status === 'active'
  }
  private withHistory<T>(work: () => Promise<T>): Promise<T> {
    const next = this.history.then(work)
    this.history = next.then(() => undefined, () => undefined)
    return next
  }
  private supplement(): Promise<void> { return this.withHistory(() => this.captureHistory()) }
  private async captureHistory(): Promise<void> {
    const query = this.ctx.get('sessionQuery')
    if (!query || this.closed) return
    const table = this.domain.table('moderation_cursors')
    const pending = [...table.entries()].map(([, value]) => value)
      .filter(value => value.kind === 'claim' && !value.done && this.valid(value)).sort((a, b) => a.id.localeCompare(b.id))
    const cursor = pending.find(value => value.id > this.lastCursor) ?? pending[0]
    if (!cursor) return
    this.lastCursor = cursor.id
    using observation = await query.observeSession(SessionId(cursor.sessionId), { projectionMode: 'none', signal: this.lifetime.signal })
    let progress = { ...cursor }, captured = 0, visited = 0
    for (const event of observation.events) {
      if (event.seq < Math.max(cursor.seq, observation.inheritedEventCount)) continue
      if (!this.valid(cursor) || this.lifetime.signal.aborted) return
      const messages = humanInputs(cursor.sessionId, event)
      const start = event.seq === cursor.seq ? cursor.index : 0
      for (let index = start; index < messages.length; index++) {
        if (!this.valid(cursor)) return
        const id = await this.service.capture(messages[index]!)
        if (id === undefined) return
        progress = { ...cursor, seq: event.seq, index: index + 1 }
        await table.put(cursor.id, progress)
        if (++captured >= 20) return
      }
      progress = { ...cursor, seq: event.seq + 1, index: 0 }
      if (++visited >= 5_000) { await table.put(cursor.id, progress); return }
    }
    if (this.valid(cursor)) await table.put(cursor.id, { ...progress, done: true })
  }
  private scan(limit: number): Promise<CapturedMessage[]> { return this.withHistory(() => this.collectScan(limit)) }
  private async collectScan(limit: number): Promise<CapturedMessage[]> {
    const query = this.ctx.get('sessionQuery')
    if (!query || this.closed) throw new AuthError(503, 'SCAN_UNAVAILABLE', '可信历史读取器尚未就绪')
    const result: CapturedMessage[] = []
    const cursors = this.domain.table('moderation_cursors')
    let observed = 0
    // Filter exact durable owners BEFORE opening logs. Never enumerate unrelated history.
    for (const [, owner] of this.domain.table('api_resources').entries()) {
      if (owner.kind !== 'session') continue
      const id = `scan:${owner.resourceId}`
      const saved = cursors.get(id)
      const cursor: ModerationCursor = saved?.ownerKey === owner.ownerKey ? saved : {
        id, kind: 'scan', sessionId: owner.resourceId, ownerKey: owner.ownerKey, seq: 0, index: 0, done: false,
      }
      if (cursor.done || !this.valid(cursor)) continue
      if (++observed > 20) break
      using observation = await query.observeSession(SessionId(cursor.sessionId), { projectionMode: 'none', signal: this.lifetime.signal })
      if (!this.valid(cursor)) continue
      let progress = { ...cursor }, held = false, visited = 0
      for (const event of observation.events) {
        if (event.seq < Math.max(cursor.seq, observation.inheritedEventCount)) continue
        const messages = humanInputs(cursor.sessionId, event)
        for (let index = event.seq === cursor.seq ? cursor.index : 0; index < messages.length; index++) {
          const message = messages[index]!
          if (!this.domain.table('moderation_cases').get(moderationCaptureId(message))) {
            held = true
            if (!this.valid(cursor)) return result
            result.push(message)
          }
          if (!held) progress = { ...cursor, seq: event.seq, index: index + 1 }
          if (result.length >= Math.min(limit, 20)) { await cursors.put(id, progress); return result }
        }
        if (!held) progress = { ...cursor, seq: event.seq + 1, index: 0 }
        if (++visited >= 5_000) break
      }
      if (this.valid(cursor)) await cursors.put(id, { ...progress, done: !held && visited < 5_000 })
    }
    return result
  }
  async flush(): Promise<void> { await this.queue }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    for (const release of this.releases) release()
    this.lifetime.abort(new ModerationModelError('REVIEW_ABORTED'))
    await Promise.all([this.queue, this.worker, this.history])
  }
}
