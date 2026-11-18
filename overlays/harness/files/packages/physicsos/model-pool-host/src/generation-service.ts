/** Native generation service. Job leases freeze configuration, credentials and account order. */
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { ServerResponse } from 'node:http'
import { PoolError } from './errors.ts'
import { WeightedRotation } from './pool.ts'
import {
  allGenerationRateCooling, generationKeyEligible, orderGenerationAccounts,
  snapshotGeneration, type GenerationAccount, type GenerationSnapshot,
} from './generation-pool.ts'
import type { GenerationStore } from './generation-store.ts'
import { generateImageAttempt, validateGenerationImageInput } from './generation-image.ts'
import { failureFromGenerationStream, GenerationStreamValidator } from './generation-stream.ts'
import {
  forwardGenerationText, generationAbortable, generationDeadline, GenerationRequestError,
  readGenerationBytes, type GenerationFetch,
} from './generation-upstream.ts'
import {
  GENERATION_TEXT_PROVIDER, type AcquireGenerationTextRoute, type GenerateGenerationImage,
  type GenerationAttempt, type GenerationFailure, type GenerationImageResult, type GenerationTextOutcome,
  type GenerationTextRoute, type VisualizationChannels,
} from './generation-types.ts'

const TEXT_RESPONSE_LIMIT = 10 * 1024 * 1024
const LEASE_LIMIT = 1024
const LEASE_IDLE_MS = 30 * 60_000
const opaque = (): string => randomBytes(24).toString('hex')

interface LeaseAccount extends GenerationAccount {
  readonly secret: string | undefined
  readonly decryptFailure: boolean
}

/** Public only to the sibling in-process registrar, never the Cordis/browser service. */
export interface GenerationTextLease {
  readonly routeId: string
  readonly model: string
  readonly requestId: string
  readonly actualModel: string
  readonly preferredAccount: LeaseAccount
  readonly signal: AbortSignal
  readonly snapshot: GenerationSnapshot
  readonly accounts: readonly LeaseAccount[]
  readonly cancel: AbortController
  readonly release: () => void
  readonly expiry: ReturnType<typeof setTimeout>
  readonly callerSignal: AbortSignal
  busy: boolean
  blocked: boolean
  lastUsedMs: number
  outcome: GenerationTextOutcome | undefined
  readonly health: Map<string, {
    readonly status: 'active' | 'cooldown'
    readonly until: number | null
    readonly failure: GenerationFailure | undefined
    readonly failCount: number
    readonly cooldownStreak: number
  }>
}

export interface GenerationServiceOptions {
  readonly store: GenerationStore
  readonly fetchImpl?: GenerationFetch
  readonly nowMs?: () => number
  readonly elapsedMs?: () => number
  readonly rotation?: WeightedRotation
  /** Rebuild only the private PiAI profiles. */
  readonly onLeasesChanged?: () => void
  /** Resolves only the isolated adapter registration, not generic/main availability. */
  readonly textAvailable?: () => boolean
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

export class GenerationChannelsService {
  private readonly leases = new Map<string, GenerationTextLease>()
  private readonly byModel = new Map<string, GenerationTextLease>()
  private readonly rotation: WeightedRotation
  private readonly imageRotation = new WeightedRotation()
  private readonly nowMs: () => number
  private readonly elapsedMs: () => number
  private disposed = false
  private readonly shutdown = new AbortController()

  constructor(private readonly options: GenerationServiceOptions) {
    this.rotation = options.rotation ?? new WeightedRotation()
    this.nowMs = options.nowMs ?? Date.now
    this.elapsedMs = options.elapsedMs ?? (() => performance.now())
  }

  /** Only these closures are provided to Cordis. No store, endpoint, lease records or plaintext access. */
  runtime(): VisualizationChannels {
    return Object.freeze({
      acquireTextRoute: (input: AcquireGenerationTextRoute) => this.acquireTextRoute(input),
      textOutcome: (routeId: string) => this.textOutcome(routeId),
      releaseTextRoute: (routeId: string) => this.releaseTextRoute(routeId),
      generateImage: (input: GenerateGenerationImage) => this.generateImage(input),
      recordMainFallback: (input: { requestId: string; provider: string; model: string; reason: 'unconfigured' | 'all-http429' }) => this.options.store.recordMainFallback(input),
    })
  }

  private capture(snapshot: GenerationSnapshot): readonly LeaseAccount[] {
    return orderGenerationAccounts(snapshot.accounts, snapshot.purpose === 'text' ? this.rotation : this.imageRotation).map(account => {
      let secret: string | undefined
      try { secret = this.options.store.openKey(account.key) }
      catch { /* A local decrypt failure is auth/unconfigured, never rate evidence. */ }
      return { ...account, secret, decryptFailure: secret === undefined }
    })
  }

  async acquireTextRoute(input: AcquireGenerationTextRoute): Promise<GenerationTextRoute> {
    input.signal.throwIfAborted()
    if (this.disposed) throw new PoolError(503, 'GENERATION_DISPOSED', '生成通道服务已关闭')
    if (this.options.textAvailable?.() === false) throw new PoolError(503, 'GENERATION_PROVIDER_UNAVAILABLE', '独立生成提供器尚未挂载')
    this.prune()
    const snapshot = snapshotGeneration(this.options.store, 'text')
    if (snapshot.accounts.length === 0) return { status: 'unconfigured' }
    if (allGenerationRateCooling(snapshot, this.nowMs())) return { status: 'rate-limited' }
    if (this.leases.size >= LEASE_LIMIT) throw new PoolError(503, 'GENERATION_BUSY', '生成任务租约已达上限')
    const accounts = this.capture(snapshot)
    // Keep failover within one exact wire API/model metadata. Other configured accounts remain untried,
    // which prevents their exclusion from being mistaken for ALL rate-limited accounts.
    const first = accounts.find(account => generationKeyEligible(account.key, this.nowMs(), snapshot.settings)) ?? accounts[0]!
    const routeId = opaque(), model = `generation-lease-${opaque()}`, cancel = new AbortController()
    const signal = AbortSignal.any([input.signal, cancel.signal])
    const expiry = setTimeout(() => { this.releaseTextRoute(routeId) }, LEASE_IDLE_MS)
    expiry.unref?.()
    const release = (): void => { clearTimeout(expiry); this.releaseTextRoute(routeId) }
    const lease: GenerationTextLease = {
      routeId, model, requestId: input.requestId, actualModel: first.model.id, preferredAccount: first,
      snapshot, accounts, cancel, signal, release, expiry, callerSignal: input.signal,
      busy: false, blocked: false, lastUsedMs: this.nowMs(), outcome: undefined,
      health: new Map(accounts.map(account => [account.key.id, {
        status: account.key.status, until: account.key.cooldownUntil,
        failCount: account.key.failCount, cooldownStreak: account.key.cooldownStreak,
        failure: account.key.lastFailureKind === null ? undefined : {
          kind: account.key.lastFailureKind, ...account.key.lastHttpStatus === null ? {} : { status: account.key.lastHttpStatus }, code: 'COOLDOWN',
        },
      }])),
    }
    this.leases.set(routeId, lease)
    this.byModel.set(model, lease)
    input.signal.addEventListener('abort', release, { once: true })
    this.options.onLeasesChanged?.()
    return { status: 'ready', provider: GENERATION_TEXT_PROVIDER, model, routeId, actualModel: first.model.id, configRevision: snapshot.configRevision }
  }

  textOutcome(routeId: string): GenerationTextOutcome | undefined {
    const outcome = this.leases.get(routeId)?.outcome
    return outcome === undefined ? undefined : structuredClone(outcome)
  }

  releaseTextRoute(routeId: string): void {
    const lease = this.leases.get(routeId)
    if (lease === undefined) return
    this.leases.delete(routeId); this.byModel.delete(lease.model)
    lease.callerSignal.removeEventListener('abort', lease.release)
    clearTimeout(lease.expiry)
    lease.cancel.abort(new DOMException('Generation lease released', 'AbortError'))
    this.options.onLeasesChanged?.()
  }

  /** Registrar-only access; ordinary model catalogs do not advertise these lease models. */
  activeTextLeases(): readonly GenerationTextLease[] { return [...this.leases.values()] }
  textLeaseForModel(model: string): GenerationTextLease | undefined { return this.byModel.get(model) }

  private prune(): void {
    for (const lease of this.leases.values()) {
      if (!lease.busy && this.nowMs() - lease.lastUsedMs > LEASE_IDLE_MS) this.releaseTextRoute(lease.routeId)
    }
  }

  private eligible(lease: GenerationTextLease, account: LeaseAccount): boolean {
    const health = lease.health.get(account.key.id)
    return health?.status !== 'cooldown' || lease.snapshot.settings.autoRecover && health.until !== null && this.nowMs() >= health.until
  }

  private rateCooling(lease: GenerationTextLease, account: LeaseAccount): boolean {
    const health = lease.health.get(account.key.id)
    return health?.status === 'cooldown' && health.failure?.kind === 'rate-limited' && health.failure.status === 429 && !this.eligible(lease, account)
  }

  private outcome(lease: GenerationTextLease, attempts: readonly GenerationAttempt[], kind: GenerationTextOutcome['kind'], failure?: GenerationFailure,
    options: { partial?: boolean; cancelled?: boolean } = {}): void {
    const attempted = new Set(attempts.map(attempt => attempt.keyId))
    const allLimited = kind === 'rate-limited' && !options.partial && !options.cancelled && !lease.snapshot.incomplete
      && lease.accounts.length > 0 && lease.accounts.every(account => {
        const result = attempts.find(attempt => attempt.keyId === account.key.id)
        return result === undefined ? this.rateCooling(lease, account) : result.kind === 'rate-limited' && result.status === 429
      })
    lease.outcome = {
      kind: options.partial ? 'partial-exhausted' : kind, allAccountsRateLimited: allLimited,
      requestId: lease.requestId, configRevision: lease.snapshot.configRevision, actualModel: lease.actualModel,
      totalAccounts: lease.accounts.length, attemptedAccounts: attempted.size,
      untriedAccounts: lease.accounts.filter(account => !attempted.has(account.key.id) && !this.rateCooling(lease, account)).length,
      attempts: structuredClone(attempts), ...failure?.status === undefined ? {} : { status: failure.status },
      ...failure === undefined ? {} : { causeKind: failure.kind, code: failure.code },
      ...options.cancelled ? { cancelled: true } : {},
    }
  }

  private async markFailure(lease: GenerationTextLease, account: LeaseAccount, failure: GenerationFailure): Promise<void> {
    const settings = lease.snapshot.settings
    const current = lease.health.get(account.key.id)
    const failCount = (current?.failCount ?? account.key.failCount) + 1
    const bench = failure.kind === 'rate-limited' || failure.kind === 'auth' || failCount >= settings.failureThreshold
    const cooldownStreak = (current?.cooldownStreak ?? account.key.cooldownStreak) + (bench ? 1 : 0)
    const cooldownMs = Math.min(settings.cooldownMaxMs, settings.cooldownBaseMs * 2 ** Math.min(16, Math.max(0, cooldownStreak - 1)))
    lease.health.set(account.key.id, {
      status: bench ? 'cooldown' : 'active', until: bench ? this.nowMs() + cooldownMs : null,
      failCount, cooldownStreak, failure,
    })
    try { await this.options.store.markFailure(account.key, failure, settings, account.channel.revision) }
    catch { /* The lease still retains the exact HTTP outcome; storage errors do not authorize retries. */ }
  }

  private attempt(account: LeaseAccount, failure: GenerationFailure | { readonly kind: 'success'; readonly status: number; readonly code: string }): GenerationAttempt {
    return { ...failure, channelId: account.channel.id, keyId: account.key.id, keyVersion: account.key.keyVersion, model: account.model.id }
  }

  /** Private loopback dispatch: model is the lease token and must never be rewritten by the browser. */
  async serveText(model: string, api: 'openai-completions' | 'openai-responses', payload: Record<string, unknown>, res: ServerResponse, callerSignal: AbortSignal): Promise<void> {
    const lease = this.byModel.get(model)
    if (lease === undefined || lease.signal.aborted) throw new PoolError(403, 'GENERATION_INVALID_LEASE', '生成租约无效')
    if (lease.busy || lease.blocked) throw new PoolError(409, 'GENERATION_LEASE_CLOSED', '生成租约已有请求或不可重放的失败')
    const first = lease.preferredAccount
    if (first.channel.api !== api) throw new PoolError(400, 'GENERATION_API_MISMATCH', '生成租约 API 不匹配')
    lease.busy = true; lease.outcome = undefined; lease.lastUsedMs = this.nowMs(); lease.expiry.refresh()
    const request = generationDeadline(AbortSignal.any([lease.signal, callerSignal]), lease.snapshot.settings.requestBudgetMs)
    const attempts: GenerationAttempt[] = []
    const deadlineMs = this.elapsedMs() + lease.snapshot.settings.requestBudgetMs
    let last: GenerationFailure | undefined
    let accepted = false
    try {
      const capabilities = (account: LeaseAccount): string => JSON.stringify({
        id: account.model.id, contextWindow: account.model.contextWindow, maxTokens: account.model.maxTokens,
        reasoningEfforts: account.model.reasoningEfforts,
      })
      const available = lease.accounts.filter(account => account.channel.api === api
        && capabilities(account) === capabilities(first) && this.eligible(lease, account))
      for (const account of available) {
        request.signal.throwIfAborted()
        if (attempts.length > lease.snapshot.settings.retryCount || attempts.length > 0
          && deadlineMs - this.elapsedMs() < lease.snapshot.settings.headersTimeoutMs) break
        if (account.decryptFailure || account.secret === undefined) {
          last = { kind: 'auth', code: 'KEY_DECRYPT_FAILED' }; attempts.push(this.attempt(account, last))
          await this.markFailure(lease, account, last); continue
        }
        const result = await forwardGenerationText({
          baseURL: account.channel.baseURL, api, secret: account.secret, payload: { ...payload, model: account.model.id },
          timeoutMs: Math.min(lease.snapshot.settings.attemptTimeoutMs, deadlineMs - this.elapsedMs()),
          headersTimeoutMs: lease.snapshot.settings.headersTimeoutMs, signal: request.signal,
          ...this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl },
        })
        if (!result.ok) {
          last = result.failure; attempts.push(this.attempt(account, last)); await this.markFailure(lease, account, last)
          if (last.accepted === true) {
            this.outcome(lease, attempts, last.kind, last, { partial: true })
            lease.blocked = true
            throw new PoolError(502, 'GENERATION_PARTIAL_EXHAUSTED', '已接受的生成响应无效，不可重放')
          }
          if (last.kind === 'client') break
          continue
        }
        accepted = true
        try {
          await this.deliverText(result.response, result.signal, payload.stream === true, api, res)
          lease.health.set(account.key.id, { status: 'active', until: null, failure: undefined, failCount: 0, cooldownStreak: 0 })
          attempts.push(this.attempt(account, { kind: 'success', status: result.response.status, code: 'SUCCESS' }))
          this.outcome(lease, attempts, 'success')
          try { await this.options.store.markSuccess(account.key, account.channel.revision) }
          catch { /* A completed answer must not be replayed because a health write failed. */ }
        } catch (error) {
          const failure = { ...failureFromGenerationStream(error), status: result.response.status, accepted: true }
          const cancelled = lease.signal.aborted || callerSignal.aborted
          attempts.push(this.attempt(account, failure))
          this.outcome(lease, attempts, failure.kind, failure, { partial: true, cancelled })
          lease.blocked = true
          if (!cancelled) await this.markFailure(lease, account, failure)
          if (res.headersSent) res.destroy()
          else throw new PoolError(502, 'GENERATION_PARTIAL_EXHAUSTED', '生成响应未完整完成，不可重放')
        } finally { result.dispose() }
        return
      }
      if (last === undefined) {
        last = lease.accounts.every(account => this.rateCooling(lease, account)) && !lease.snapshot.incomplete
          ? { kind: 'rate-limited', code: 'ALL_RATE_COOLDOWN' }
          : { kind: 'transport', code: 'NO_ELIGIBLE_ACCOUNT_OR_BUDGET' }
      }
      this.outcome(lease, attempts, last.kind, last)
      lease.blocked = true
      throw new PoolError(last.kind === 'rate-limited' ? 429 : 502, 'GENERATION_TEXT_EXHAUSTED', '生成通道本次请求失败')
    } catch (error) {
      if (lease.outcome === undefined) {
        const cancelled = lease.signal.aborted || callerSignal.aborted
        const failure = error instanceof GenerationRequestError ? error.failure : { kind: 'transport' as const, code: cancelled ? 'CANCELLED' : 'REQUEST_BUDGET_EXHAUSTED' }
        this.outcome(lease, attempts, failure.kind, failure, { partial: accepted, cancelled })
        lease.blocked = true
      }
      throw error
    } finally {
      request.dispose(); lease.busy = false; lease.lastUsedMs = this.nowMs()
      if (this.leases.has(lease.routeId)) lease.expiry.refresh()
    }
  }

  private async deliverText(response: Response, signal: AbortSignal, streaming: boolean, api: 'openai-completions' | 'openai-responses', res: ServerResponse): Promise<void> {
    if (!streaming) {
      const bytes = await readGenerationBytes(response, TEXT_RESPONSE_LIMIT, signal)
      let parsed: unknown
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
      catch { throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'INVALID_RESPONSE' }) }
      const root = recordOf(parsed)
      if (root === undefined || root.error !== undefined || api === 'openai-completions' && !Array.isArray(root.choices)
        || api === 'openai-responses' && root.status !== 'completed') {
        throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'INVALID_RESPONSE' })
      }
      res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(Buffer.from(bytes)); return
    }
    if (response.body === null) throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'EMPTY_STREAM' })
    const validator = new GenerationStreamValidator(api), reader = response.body.getReader()
    let size = 0
    try {
      res.writeHead(response.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      for (;;) {
        const next = await generationAbortable(reader.read(), signal)
        if (next.done) break
        size += next.value.byteLength
        if (size > TEXT_RESPONSE_LIMIT) throw new GenerationRequestError({ kind: 'server', status: response.status, code: 'RESPONSE_TOO_LARGE' })
        for (const frame of validator.push(next.value)) {
          if (!res.write(frame)) await once(res, 'drain', { signal })
        }
      }
      signal.throwIfAborted()
      for (const frame of validator.finish()) if (!res.write(frame)) await once(res, 'drain', { signal })
      res.end()
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
  }

  async generateImage(input: GenerateGenerationImage): Promise<GenerationImageResult> {
    input.signal.throwIfAborted(); validateGenerationImageInput(input)
    if (this.disposed) throw new PoolError(503, 'GENERATION_DISPOSED', '生成通道服务已关闭')
    const snapshot = snapshotGeneration(this.options.store, 'image')
    if (snapshot.accounts.length === 0) throw new GenerationRequestError({ kind: 'client', code: 'IMAGE_UNCONFIGURED' })
    if (allGenerationRateCooling(snapshot, this.nowMs())) {
      throw new GenerationRequestError({ kind: 'rate-limited', status: 429, code: 'IMAGE_ALL_RATE_COOLDOWN' })
    }
    const accounts = this.capture(snapshot)
    const deadline = generationDeadline(AbortSignal.any([input.signal, this.shutdown.signal]), Math.min(180_000, snapshot.settings.requestBudgetMs))
    const until = this.elapsedMs() + Math.min(180_000, snapshot.settings.requestBudgetMs)
    let count = 0, last: GenerationFailure = { kind: 'transport', code: 'IMAGE_EXHAUSTED' }
    try {
      for (const account of accounts.filter(account => generationKeyEligible(account.key, this.nowMs(), snapshot.settings))) {
        deadline.signal.throwIfAborted()
        if (count > snapshot.settings.retryCount || until - this.elapsedMs() < 1000) break
        count += 1
        if (account.secret === undefined) { last = { kind: 'auth', code: 'KEY_DECRYPT_FAILED' }; await this.options.store.markFailure(account.key, last, snapshot.settings, account.channel.revision); continue }
        try {
          const result = await generateImageAttempt({
            account, secret: account.secret, input, configRevision: snapshot.configRevision,
            timeoutMs: Math.min(snapshot.settings.attemptTimeoutMs, until - this.elapsedMs()), signal: deadline.signal,
            ...this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl },
          })
          try { await this.options.store.markSuccess(account.key, account.channel.revision) }
          catch { /* The image is complete; a health-write failure cannot resend paid generation. */ }
          return result
        } catch (error) {
          if (input.signal.aborted) input.signal.throwIfAborted()
          if (deadline.signal.aborted) throw deadline.signal.reason
          last = error instanceof GenerationRequestError ? error.failure : { kind: 'transport', code: 'TRANSPORT' }
          await this.options.store.markFailure(account.key, last, snapshot.settings, account.channel.revision)
          // Only an explicit rejection before image acceptance permits account failover.
          if (last.accepted === true || last.kind === 'client' || last.status === undefined || last.status >= 200 && last.status < 300) break
        }
      }
      throw new GenerationRequestError(last)
    } finally { deadline.dispose() }
  }

  dispose(): void {
    this.disposed = true
    this.shutdown.abort(new DOMException('Generation service disposed', 'AbortError'))
    for (const routeId of this.leases.keys()) this.releaseTextRoute(routeId)
  }
}
