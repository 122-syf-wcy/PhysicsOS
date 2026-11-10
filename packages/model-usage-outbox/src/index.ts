import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
export interface ModelUsage { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens?: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number; readonly reasoningTokens?: number }
export interface ReceiptOwner { readonly schoolId: string; readonly userKey: string }
export interface ModelReceipt { readonly id: string; readonly source: 'moderation' | 'paper'; readonly provider: string; readonly model: string; readonly occurredAt: string; readonly owner?: ReceiptOwner; readonly usage?: ModelUsage }
export interface ModelUsageOutboxRecord { readonly id: string; readonly state: 'started' | 'pending'; readonly receipt: ModelReceipt }
export interface ReceiptTable { get(id: string): ModelUsageOutboxRecord | undefined; entries(): Iterable<readonly [string, ModelUsageOutboxRecord]>; put(id: string, record: ModelUsageOutboxRecord): Promise<unknown>; delete(id: string): Promise<unknown> }
export interface ReceiptSink { recordModelReceipt(receipt: ModelReceipt): Promise<void> }
export interface UsageAttempt { readonly id: string; finish(usage?: ModelUsage): Promise<void>; abandon(): Promise<void> }
export interface OutboxOptions { readonly source: ModelReceipt['source']; readonly table: ReceiptTable; readonly sink: () => ReceiptSink | undefined; readonly onError: (phase: 'persist' | 'deliver') => void; readonly now?: () => Date; readonly id?: () => string; readonly retryMs?: number }
const usageKeys = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const
const finiteCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export function copyModelUsage(value: ModelUsage | undefined): ModelUsage | undefined {
  if (!value) return undefined
  if (!finiteCount(value.inputTokens) || !finiteCount(value.outputTokens) || usageKeys.some(key => value[key] !== undefined && !finiteCount(value[key]))) throw new Error('Invalid model usage counters')
  return Object.fromEntries(usageKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as unknown as ModelUsage
}
export function isModelUsageOutboxRecord(value: unknown): value is ModelUsageOutboxRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as ModelUsageOutboxRecord; const receipt = row.receipt
  if (typeof row.id !== 'string' || !row.id || !['started', 'pending'].includes(row.state) || !receipt || receipt.id !== row.id) return false
  if (!['moderation', 'paper'].includes(receipt.source) || typeof receipt.provider !== 'string' || !receipt.provider || typeof receipt.model !== 'string' || !receipt.model || typeof receipt.occurredAt !== 'string' || !Number.isFinite(Date.parse(receipt.occurredAt))) return false
  if (receipt.owner && (typeof receipt.owner.schoolId !== 'string' || !receipt.owner.schoolId || typeof receipt.owner.userKey !== 'string' || !receipt.owner.userKey)) return false
  try { copyModelUsage(receipt.usage); return true } catch { return false }
}
/** The caller persists first; downstream usage availability never owns its model outcome. */
export class ModelUsageOutbox {
  private readonly shutdown = new AbortController()
  readonly signal = this.shutdown.signal
  private readonly owner = new AsyncLocalStorage<ReceiptOwner | undefined>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly abandoned = new Set<string>()
  private readonly unsaved = new Map<string, ModelUsageOutboxRecord>()
  private writing: Promise<void> = Promise.resolve()
  private flushing: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private closing = false
  constructor(readonly options: OutboxOptions) {}
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.writing.then(work)
    this.writing = operation.then(() => {}, () => {})
    return operation
  }
  private persist(): Promise<void> {
    return this.serialize(async () => {
      for (const id of this.abandoned) { await this.options.table.delete(id); this.abandoned.delete(id); this.unsaved.delete(id) }
      for (const [id, row] of this.unsaved) { await this.options.table.put(id, row); if (this.unsaved.get(id) === row) this.unsaved.delete(id) }
    })
  }
  private schedule(delay = this.options.retryMs ?? 5000): void {
    if (this.closing || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => { this.options.onError('deliver'); this.schedule() })
    }, delay)
    this.timer.unref?.()
  }
  async initialize(): Promise<void> {
    for (const [id, row] of this.options.table.entries()) {
      if (!isModelUsageOutboxRecord(row)) throw new Error('Invalid stored model usage receipt')
      if (row.state === 'started') await this.options.table.put(id, { ...row, state: 'pending' })
    }
    try { await this.flush() } catch { this.options.onError('deliver'); this.schedule() }
  }
  async begin(route: { readonly provider: string; readonly model: string }, signal?: AbortSignal): Promise<UsageAttempt> {
    if (this.closing) throw new Error('Model usage outbox is closing')
    const admissionSignal = signal ? AbortSignal.any([this.signal, signal]) : this.signal
    admissionSignal.throwIfAborted()
    const id = `${this.options.source}:${this.options.id?.() ?? randomUUID()}`
    const owner = this.owner.getStore()
    const receipt: ModelReceipt = { id, source: this.options.source, provider: route.provider, model: route.model, occurredAt: (this.options.now?.() ?? new Date()).toISOString(), ...(owner ? { owner: { schoolId: owner.schoolId, userKey: owner.userKey } } : {}) }
    await this.serialize(async () => {
      admissionSignal.throwIfAborted()
      if (this.options.table.get(id)) throw new Error('Model receipt identity already exists')
      await this.options.table.put(id, { id, state: 'started', receipt })
      if (admissionSignal.aborted) {
        this.abandoned.add(id)
        try { await this.options.table.delete(id); this.abandoned.delete(id) } catch { this.options.onError('persist'); this.schedule() }
        admissionSignal.throwIfAborted()
      }
    })
    let completion: Promise<void> | undefined
    return { id, finish: usage => completion ??= (async () => {
      const copied = copyModelUsage(usage)
      this.unsaved.set(id, { id, state: 'pending', receipt: { ...receipt, ...(copied ? { usage: copied } : {}) } })
      try { await this.persist() } catch { this.options.onError('persist') }
      this.schedule(0)
    })(), abandon: () => completion ??= (async () => {
      this.abandoned.add(id); this.unsaved.delete(id)
      try { await this.persist() } catch { this.options.onError('persist') }
      this.schedule(0)
    })() }
  }
  withOwner<T>(owner: ReceiptOwner | undefined, operation: () => Promise<T>): Promise<T> {
    return this.owner.run(owner ? { schoolId: owner.schoolId, userKey: owner.userKey } : undefined, () => this.run(operation))
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = operation()
    this.operations.add(result)
    void result.then(() => this.operations.delete(result), () => this.operations.delete(result))
    return result
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing
    const run = async () => {
      await this.persist()
      for (const [id, row] of this.options.table.entries()) {
        if (row.state !== 'pending' || this.unsaved.has(id)) continue
        const sink = this.options.sink()
        if (!sink) throw new Error('Usage sink is unavailable; receipt retained')
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([sink.recordModelReceipt(row.receipt), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Usage delivery timed out; receipt retained')), 5000); timeout.unref?.() })])
        } finally { clearTimeout(timeout) }
        await this.serialize(async () => { await this.options.table.delete(id) })
      }
    }
    const promise = run().finally(() => { if (this.flushing === promise) this.flushing = undefined; if ([...this.options.table.entries()].some(([, row]) => row.state === 'pending') || this.unsaved.size || this.abandoned.size) this.schedule() })
    this.flushing = promise
    return promise
  }
  async close(): Promise<void> {
    this.closing = true; this.shutdown.abort(); clearTimeout(this.timer); this.timer = undefined
    await Promise.allSettled([...this.operations])
    try { await this.flush() } catch { this.options.onError(this.unsaved.size || this.abandoned.size ? 'persist' : 'deliver') }
    if (this.unsaved.size || this.abandoned.size) throw new Error('Model usage receipts could not be persisted before shutdown')
  }
}
