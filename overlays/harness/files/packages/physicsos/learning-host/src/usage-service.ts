/** Durable server-owned visits and numerical model settlement accounting. */
import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { checkErasureRequest, checkPersonalFence, type PersonalErasureRequest, type PersonalOwner } from './personal-fence.ts'
import { z } from 'zod'
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import {
  usageEventWire,
  usageTokenSchema,
  type UsageDomain,
  type UsageEventRecord,
  type UsageReceiptRecord,
  type UsageSessionRecord,
  type UsageChildRecord,
} from './usage-domain.ts'
import { LearningError, type IdentityActor } from './identity.ts'
import {
  DEFAULT_USAGE_LIMITS,
  type UsageCoverage,
  type UsageDay,
  type UsageEvent,
  type UsageLimits,
  type UsageModelReceiptInput,
  type UsageOwner,
  type UsageQuery,
  type UsageSummary,
  type UsageTokens,
} from './usage-types.ts'

/** Trusted Session observation; inherited context is not this session's expenditure. */
export interface UsageSessionInput {
  readonly sessionId: string
  readonly owner: UsageOwner
  readonly inheritedEventCount: number
  readonly events: readonly SessionEvent[]
}
export interface UsageServiceOptions {
  readonly now?: () => Date
  readonly limits?: Partial<UsageLimits>
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const key = (...parts: readonly string[]): string => hash(parts)
const own = (owner: UsageOwner, row: { schoolId?: string | undefined; userKey?: string | undefined }): boolean =>
  row.schoolId === owner.schoolId && row.userKey === owner.userKey
const ownerFields = (owner: UsageOwner): UsageOwner => ({ schoolId: owner.schoolId, userKey: owner.userKey })
const zeros = (): UsageTokens => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
})
const coverage = (): UsageCoverage => ({ reportedCalls: 0, missingCalls: 0 })
const safeCount = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new LearningError(409, 'USAGE_COUNTER_RANGE', 'Usage counters exceed the supported integer range.')
  return value
}
const addTokens = (left: UsageTokens, usage: z.infer<typeof usageTokenSchema> | undefined): UsageTokens => {
  if (usage === undefined) return left
  const input = usage.inputTokens,
    output = usage.outputTokens,
    read = usage.cacheReadTokens ?? 0,
    write = usage.cacheWriteTokens ?? 0
  return {
    inputTokens: safeCount(left.inputTokens + input),
    outputTokens: safeCount(left.outputTokens + output),
    cacheReadTokens: safeCount(left.cacheReadTokens + read),
    cacheWriteTokens: safeCount(left.cacheWriteTokens + write),
    reasoningTokens: safeCount(left.reasoningTokens + (usage.reasoningTokens ?? 0)),
    totalTokens: safeCount(left.totalTokens + input + output + read + write),
  }
}
/** Assign the Shanghai day. @param date - Server-owned instant. @returns Calendar date. */
export const usageDayOf = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string): string => parts.find(value => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
const dateWire = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
  })
const queryWire = z.strictObject({ from: dateWire.optional(), to: dateWire.optional(), schoolId: z.string().min(1).max(64).optional() })
const modelWire = z.strictObject({
  id: z.string().min(1).max(200),
  source: z.enum(['session', 'moderation', 'paper', 'image', 'diagram']),
  owner: z.strictObject({ schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160) }).optional(),
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  usage: usageTokenSchema.optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
})

/** One service owns each account's durable admission queue. */
export class UsageService {
  readonly limits: UsageLimits
  private readonly now: () => Date
  private readonly queues = new Map<string, Promise<void>>()
  private readonly requests = new Set<Promise<unknown>>()
  private readonly requestContext = new AsyncLocalStorage<boolean>()
  private closing = false
  private disposal?: Promise<void>
  constructor(
    readonly domain: UsageDomain,
    options: UsageServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.limits = { ...DEFAULT_USAGE_LIMITS, ...options.limits }
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Object.hasOwn(DEFAULT_USAGE_LIMITS, name) || !Number.isSafeInteger(value) || value < 1)
        throw new Error(`Invalid usage limit: ${name}`)
    }
  }
  private get events() {
    return this.domain.table('events')
  }
  private get receipts() {
    return this.domain.table('receipts')
  }
  private get sessions() {
    return this.domain.table('sessions')
  }
  private get children() {
    return this.domain.table('children')
  }
  private queue<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(scope) ?? Promise.resolve()).then(operation)
    const settled = result.then(
      () => {},
      () => {},
    )
    this.queues.set(scope, settled)
    void settled.then(() => {
      if (this.queues.get(scope) === settled) this.queues.delete(scope)
    })
    return result
  }
  /** Track admitted work through disposal. @param operation - Complete request or runtime operation. @returns Actual outcome. */
  request<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.requestContext.getStore() === true) return Promise.resolve().then(operation)
    if (this.closing) return Promise.reject(new LearningError(503, 'USAGE_CLOSED', 'Usage storage is closing.'))
    if (this.requests.size >= this.limits.maxInFlightRequests)
      return Promise.reject(new LearningError(429, 'USAGE_REQUEST_LIMIT', 'Usage request capacity is currently exhausted.'))
    const result = this.requestContext.run(true, () => Promise.resolve().then(operation))
    this.requests.add(result)
    void result.then(
      () => this.requests.delete(result),
      () => this.requests.delete(result),
    )
    return result
  }
  private account<T>(owner: PersonalOwner | undefined, operation: () => Promise<T>): Promise<T> {
    return this.request(() => this.queue(owner === undefined ? 'system' : key(owner.schoolId, owner.userKey), () => {
      if (owner !== undefined) checkPersonalFence(owner, this.domain.table('erased_accounts').get(owner.userKey))
      return operation()
    }))
  }
  /**
   * Admit server-owned events.
   * @param actor - Authenticated account.
   * @param input - Strict product event.
   * @returns Durable original event.
   */
  recordEvent(actor: IdentityActor, input: unknown): Promise<UsageEvent> {
    return this.account(actor, async () => {
      let bytes: number
      try {
        bytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
      } catch {
        throw new LearningError(400, 'BAD_REQUEST', 'Usage event must be JSON.')
      }
      if (bytes > this.limits.maxRequestBytes) throw new LearningError(413, 'USAGE_REQUEST_LIMIT', 'Usage event exceeds its byte limit.')
      const parsed = usageEventWire.safeParse(input)
      if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', 'Usage event fields are invalid.')
      const body = parsed.data,
        eventKey = key(actor.schoolId, actor.userKey, body.id),
        requestHash = hash(body),
        previous = this.events.get(eventKey)
      if (previous !== undefined) {
        if (!own(actor, previous) || previous.requestHash !== requestHash)
          throw new LearningError(409, 'USAGE_EVENT_CONFLICT', 'This usage event id already has different content.')
        return this.eventOf(previous)
      }
      if ([...this.events.entries()].filter(([, row]) => own(actor, row)).length >= this.limits.maxEventsPerAccount)
        throw new LearningError(413, 'USAGE_EVENT_LIMIT', 'Account usage events reached the configured retention limit.')
      const instant = this.now(),
        row = {
          ...body,
          schoolId: actor.schoolId,
          userKey: actor.userKey,
          requestHash,
          at: instant.toISOString(),
          date: usageDayOf(instant),
        }
      await this.events.put(eventKey, row)
      return this.eventOf(row)
    })
  }
  private eventOf(row: UsageEventRecord): UsageEvent {
    return { id: row.id, kind: row.kind, surface: row.surface, at: row.at, ...(row.action === undefined ? {} : { action: row.action }) }
  }
  /** Read exact personal usage. @param actor - Authenticated account. @param query - Inclusive date window. @returns Personal counters. */
  summary(actor: IdentityActor, query: UsageQuery = {}): Promise<UsageSummary> {
    return this.request(() => {
      if (query.schoolId !== undefined) throw new LearningError(403, 'FORBIDDEN', 'Personal usage cannot address a different school.')
      return this.summarize('account', query, row => own(actor, row), false)
    })
  }
  /** Read authorized aggregates. @param actor - Administrator. @param query - Date and optional school filter. @returns Scoped counters. */
  adminSummary(actor: IdentityActor, query: UsageQuery = {}): Promise<UsageSummary> {
    return this.request(() => {
      if (actor.role !== 'SCHOOL_ADMIN' && actor.role !== 'SUPER_ADMIN')
        throw new LearningError(403, 'FORBIDDEN', 'Usage aggregates require an administrator.')
      if (actor.role !== 'SUPER_ADMIN' && query.schoolId !== undefined && query.schoolId !== actor.schoolId)
        throw new LearningError(403, 'FORBIDDEN', 'Another school cannot be inspected.')
      const school = actor.role === 'SUPER_ADMIN' ? query.schoolId : actor.schoolId
      return this.summarize(
        school === undefined ? 'platform' : 'school',
        query,
        row => school === undefined || row.schoolId === school,
        school === undefined,
      )
    })
  }
  private summarize(
    scope: UsageSummary['scope'],
    query: UsageQuery,
    selected: (row: { schoolId?: string | undefined; userKey?: string | undefined }) => boolean,
    includeSystem: boolean,
  ): UsageSummary {
    const parsed = queryWire.safeParse(query)
    if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', 'Usage date filters are invalid.')
    const to = parsed.data.to ?? usageDayOf(this.now()),
      from = parsed.data.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
    if (days < 1 || days > this.limits.maxWindowDays)
      throw new LearningError(400, 'USAGE_DATE_RANGE', 'Usage date range exceeds its configured bound.')
    const daily = new Map<string, UsageDay>()
    const day = (date: string): UsageDay => daily.get(date) ?? { date, visits: 0, uses: 0, tokens: zeros(), ...coverage() }
    const inRange = (date: string): boolean => date >= from && date <= to
    let visits = 0,
      uses = 0,
      tokens = zeros(),
      covered = coverage(),
      systemTokens = zeros(),
      systemCovered = coverage()
    for (const [, row] of this.events.entries()) {
      if (!selected(row) || !inRange(row.date)) continue
      const previous = day(row.date),
        visit = row.kind === 'visit' ? 1 : 0,
        use = row.kind === 'use' ? 1 : 0
      visits = safeCount(visits + visit)
      uses = safeCount(uses + use)
      daily.set(row.date, { ...previous, visits: safeCount(previous.visits + visit), uses: safeCount(previous.uses + use) })
    }
    for (const [, row] of this.receipts.entries()) {
      if (!inRange(row.date)) continue
      const report = row.usage === undefined ? 0 : 1,
        missing = row.usage === undefined ? 1 : 0
      if (row.scope === 'system') {
        if (includeSystem) {
          systemTokens = addTokens(systemTokens, row.usage)
          systemCovered = {
            reportedCalls: safeCount(systemCovered.reportedCalls + report),
            missingCalls: safeCount(systemCovered.missingCalls + missing),
          }
        }
        continue
      }
      if (!selected(row)) continue
      tokens = addTokens(tokens, row.usage)
      covered = { reportedCalls: safeCount(covered.reportedCalls + report), missingCalls: safeCount(covered.missingCalls + missing) }
      const previous = day(row.date)
      daily.set(row.date, {
        ...previous,
        tokens: addTokens(previous.tokens, row.usage),
        reportedCalls: safeCount(previous.reportedCalls + report),
        missingCalls: safeCount(previous.missingCalls + missing),
      })
    }
    const unavailableSessions = [...this.sessions.entries()].filter(([, row]) => selected(row) && row.unavailable === true).length
    return {
      scope,
      timezone: 'Asia/Shanghai',
      from,
      to,
      visits,
      uses,
      activeDays: daily.size,
      tokens,
      coverage: { ...covered, unavailableSessions },
      system: { ...systemCovered, tokens: systemTokens },
      daily: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)),
      updatedAt: this.now().toISOString(),
    }
  }
  /** Publish trusted host usage. @param input - Settled attempt's numeric receipt. @returns Completion after durable publication. */
  recordModelReceipt(input: UsageModelReceiptInput): Promise<void> {
    const parsed = modelWire.safeParse(input)
    if (!parsed.success) return Promise.reject(new LearningError(400, 'USAGE_RECEIPT_INVALID', 'Model usage receipt fields are invalid.'))
    const body = parsed.data
    return this.account(body.owner, async () => {
      const at = body.occurredAt === undefined ? this.now().toISOString() : new Date(body.occurredAt).toISOString()
      const row: UsageReceiptRecord = {
        id: body.id,
        source: body.source,
        scope: body.owner === undefined ? 'system' : 'account',
        ...body.owner,
        provider: body.provider,
        model: body.model,
        at,
        date: usageDayOf(new Date(at)),
        revision: 0,
        requestHash: hash(body),
        ...(body.usage === undefined ? {} : { usage: body.usage }),
      }
      await this.writeReceipt(row, false)
    })
  }
  private async writeReceipt(row: UsageReceiptRecord, replace: boolean): Promise<void> {
    const receiptKey = key(row.schoolId ?? 'system', row.userKey ?? 'system', row.source, row.id),
      previous = this.receipts.get(receiptKey)
    if (previous !== undefined) {
      if (previous.requestHash === row.requestHash || (replace && previous.revision > row.revision)) return
      if (!replace || previous.revision === row.revision)
        throw new LearningError(409, 'USAGE_RECEIPT_CONFLICT', 'A model receipt id already contains different accounting data.')
      const next = {
        ...row,
        at: previous.at,
        date: previous.date,
        ...(row.usage !== undefined || previous.usage === undefined ? {} : { usage: previous.usage }),
      }
      await this.receipts.update(receiptKey, current => (current.revision >= row.revision ? current : next))
      return
    }
    const count = [...this.receipts.entries()].filter(
      ([, stored]) => stored.scope === row.scope && stored.schoolId === row.schoolId && stored.userKey === row.userKey,
    ).length
    if (count >= this.limits.maxReceiptsPerAccount)
      throw new LearningError(413, 'USAGE_RECEIPT_LIMIT', 'Usage receipts reached their configured retention limit.')
    await this.receipts.put(receiptKey, row)
  }
  /** Settle own Session events once. @param input - Exact authorized observation. @returns Completion after durable checkpoint. */
  ingestSession(input: UsageSessionInput): Promise<void> {
    return this.account(input.owner, async () => {
      const sessionKey = key(input.sessionId),
        previous = this.sessions.get(sessionKey)
      if (previous !== undefined && !own(input.owner, previous))
        throw new LearningError(409, 'USAGE_OWNER_CONFLICT', 'Session usage already belongs to another account.')
      let state: UsageSessionRecord = previous ?? {
        sessionId: input.sessionId,
        ...ownerFields(input.owner),
        cursor: -1,
        inheritedEventCount: input.inheritedEventCount,
        attempt: 0,
        updatedAt: this.now().toISOString(),
      }
      if (state.cursor === -1) state = { ...state, inheritedEventCount: input.inheritedEventCount }
      if (state.inheritedEventCount !== input.inheritedEventCount)
        throw new LearningError(409, 'USAGE_FORK_CONFLICT', 'The inherited session boundary changed.')
      let processed = 0
      for (const event of input.events) {
        if (event.seq <= state.cursor) continue
        if (processed >= this.limits.maxSessionEventsPerPass) break
        processed += 1
        if (event.seq >= input.inheritedEventCount) {
          if (event.type === 'request/header')
            state = { ...state, provider: event.data.header.config.provider, model: event.data.header.config.model }
          else if (event.type === 'llm/retry-started')
            state = {
              ...state,
              turn: event.data.turn,
              step: event.data.step,
              attempt: state.turn === event.data.turn && state.step === event.data.step ? state.attempt + 1 : 1,
            }
          else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
            const { turn, step } = event.data,
              attempt = state.turn === turn && state.step === step ? state.attempt : 0
            const id = key(input.sessionId, String(turn), String(step), String(attempt))
            const usage =
              event.type === 'assistant/message' && event.data.usage !== undefined
                ? event.data.usage
                : lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
            const parsedUsage = usage === undefined ? undefined : usageTokenSchema.safeParse(usage)
            if (parsedUsage !== undefined && !parsedUsage.success)
              throw new LearningError(400, 'USAGE_RECEIPT_INVALID', 'The saved session contains invalid numerical usage.')
            const source = event.type === 'assistant/message' ? event.data.message.source : undefined
            const provider = source?.provider ?? state.provider ?? 'unreported',
              model = source?.model ?? state.model ?? 'unreported',
              at = new Date(event.time).toISOString()
            const row: UsageReceiptRecord = {
              id,
              source: 'session',
              scope: 'account',
              ...ownerFields(input.owner),
              provider,
              model,
              at,
              date: usageDayOf(new Date(at)),
              revision: event.seq,
              sessionId: input.sessionId,
              turn,
              step,
              attempt,
              requestHash: hash({ id, provider, model, usage: parsedUsage?.success === true ? parsedUsage.data : null }),
              ...(parsedUsage?.success === true ? { usage: parsedUsage.data } : {}),
            }
            await this.writeReceipt(row, true)
            state = { ...state, turn, step, attempt, lastReceiptId: id }
          }
        }
        state = { ...state, cursor: event.seq, updatedAt: this.now().toISOString() }
      }
      // Receipts are already durable. A failed batch checkpoint safely replays their immutable ids.
      if (processed > 0 || state.unavailable === true) await this.sessions.put(sessionKey, { ...state, unavailable: false })
    })
  }
  /** Record incomplete history without discarding other accounts' available totals. */
  sessionAvailability(sessionId: string, owner: UsageOwner, available: boolean): Promise<void> {
    return this.account(owner, async () => {
      const sessionKey = key(sessionId),
        previous = this.sessions.get(sessionKey)
      if (previous !== undefined && !own(owner, previous))
        throw new LearningError(409, 'USAGE_OWNER_CONFLICT', 'Session usage belongs to another account.')
      if (previous?.unavailable === !available || (previous === undefined && available)) return
      const state = previous ?? {
        sessionId,
        ...ownerFields(owner),
        cursor: -1,
        inheritedEventCount: 0,
        attempt: 0,
        updatedAt: this.now().toISOString(),
      }
      await this.sessions.put(sessionKey, { ...state, unavailable: !available, updatedAt: this.now().toISOString() })
    })
  }
  /** Read catch-up progress. @param sessionId - Session identity. @returns Durable last admitted sequence. */
  sessionCursor(sessionId: string): number {
    return this.sessions.get(key(sessionId))?.cursor ?? -1
  }
  /** Persist a proved Agent relation. @param child - Actual parent/account binding. @returns Durable publication completion. */
  bindChild(child: UsageChildRecord): Promise<void> {
    return this.request(() =>
      this.queue('relations', async () => {
        checkPersonalFence(child, this.domain.table('erased_accounts').get(child.userKey))
        const childKey = key(child.sessionId),
          previous = this.children.get(childKey)
        if (previous !== undefined) {
          if (!own(child, previous) || previous.parentSessionId !== child.parentSessionId)
            throw new LearningError(409, 'USAGE_OWNER_CONFLICT', 'The child already has a different usage owner.')
          return
        }
        await this.children.put(childKey, child)
      }),
    )
  }
  /** Recover proved descendants. @returns Durable parent/account bindings. */
  childBindings(): readonly UsageChildRecord[] {
    return [...this.children.entries()].map(([, row]) => row)
  }
  /** Export the caller's durable events and settlement facts, never another tenant's totals. */
  exportAccount(actor: IdentityActor): Promise<readonly Record<string, unknown>[]> {
    return this.account(actor, async () => {
      const rows: Record<string, unknown>[] = []
      for (const [id, row] of this.events.entries()) if (own(actor, row)) rows.push({ id: `event:${id}`, kind: 'event', record: row })
      for (const [id, row] of this.receipts.entries()) if (own(actor, row)) rows.push({ id: `receipt:${id}`, kind: 'receipt', record: row })
      for (const [id, row] of this.sessions.entries()) if (own(actor, row)) rows.push({ id: `session:${id}`, kind: 'session', record: row })
      for (const [id, row] of this.children.entries()) if (own(actor, row)) rows.push({ id: `child:${id}`, kind: 'child', record: row })
      return rows.sort((a, b) => String(a['id']).localeCompare(String(b['id'])))
    })
  }

  /** Install a persistent fence and settle already-admitted account/relationship updates. */
  async prepareAccountErasure(request: PersonalErasureRequest): Promise<void> {
    await this.request(() => this.queue(key(request.schoolId, request.userKey), async () => {
      const table = this.domain.table('erased_accounts')
      const previous = table.get(request.userKey)
      checkErasureRequest(request, previous)
      if (previous?.complete && previous.requestId === request.requestId) return
      await table.put(request.userKey, { ...request, complete: false })
    }))
    await this.queue('relations', async () => {})
  }

  /** Remove only this account's persisted usage, leaving system/unrelated accounting untouched. */
  async eraseAccount(request: PersonalErasureRequest): Promise<void> {
    await this.prepareAccountErasure(request)
    await this.request(() => this.queue(key(request.schoolId, request.userKey), async () => {
      const table = this.domain.table('erased_accounts')
      const fence = table.get(request.userKey)
      checkErasureRequest(request, fence)
      if (fence?.complete && fence.requestId === request.requestId) return
      for (const [id, row] of this.events.entries()) if (own(request, row)) await this.events.delete(id)
      for (const [id, row] of this.receipts.entries()) if (own(request, row)) await this.receipts.delete(id)
      for (const [id, row] of this.sessions.entries()) if (own(request, row)) await this.sessions.delete(id)
      await this.queue('relations', async () => {
        for (const [id, row] of this.children.entries()) if (own(request, row)) await this.children.delete(id)
      })
      await table.put(request.userKey, { ...request, complete: true })
    }))
  }

  /** Stop admission before unit closure. @returns Completion after every admitted queue settles. */
  dispose(): Promise<void> {
    this.closing = true
    this.disposal ??= (async () => {
      await Promise.allSettled([...this.requests])
      await Promise.all([...this.queues.values()])
    })()
    return this.disposal
  }
}
