import { createFrameSource } from '@lab/physics/frame-source.ts'
import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import type { LabCheckpoint, PresentationState } from '../shared/checkpoint.ts'
import { initialPresentation } from '../shared/checkpoint.ts'
import { LabError, errorPayload, object } from '../shared/protocol.ts'
import { Metrics } from '../shared/metrics.ts'
import { PREVIEW_ACTIONS, type ActionArguments, type ActionName } from './commands.ts'
import { decodeData, type FramePacket, type Occurrence, type WireSummary, type WorkerOutput, type WorkerRequest, type WorkerTag } from './transport.ts'

export interface WorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerOutput>) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerOutput>) => void): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  terminate(): void
}
export interface ClientSnapshot {
  generation: string; loading: boolean; dirty: boolean; active: boolean
  summary?: WireSummary; frame?: WorkspaceFrame
  error?: { code: string; message: string }
  presentation: PresentationState
}
interface Pending {
  id: string; type: WorkerRequest['type']; payload: unknown
  waiters: { resolve(value: unknown): void; reject(error: unknown): void }[]
  previewKey?: string; startedAt?: number
}
export interface ClientEnvironment {
  createWorker(): WorkerPort
  now(): number
  requestFrame(callback: FrameRequestCallback): number
  cancelFrame(id: number): void
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimeout(id: ReturnType<typeof setTimeout>): void
}
const browserEnvironment = (): ClientEnvironment => ({
  createWorker: () => new Worker(new URL('../worker.js', import.meta.url), { type: 'module', name: 'physicsos-lab' }),
  now: () => performance.now(), requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
  setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: id => clearTimeout(id),
})
/** Synchronous reads return the last completed authoritative frame; every mutation is explicitly async. */
export class LabClient {
  readonly frames = createFrameSource<WorkspaceFrame | undefined>(undefined)
  private readonly source = createFrameSource<ClientSnapshot>({ generation: '', loading: false, dirty: false, active: true, presentation: initialPresentation() })
  private worker: WorkerPort | undefined
  private tag: WorkerTag = { version: 1, generation: '', sceneId: '', revision: 0 }
  private queue: Pending[] = []
  private pending: Pending | undefined
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private summaryTimer: ReturnType<typeof setTimeout> | undefined
  private lastSummaryAt = -Infinity
  private requestId = 0
  private lastFrameSerial = 0
  private lastEventSeq = 0
  private readonly eventListeners = new Set<(events: readonly Occurrence[]) => void>()
  private readonly frameAcks = new Map<number, number>()
  private readonly readouts = new Map<string, readonly { label: string; value: string }[]>()
  private readonly readoutRequests = new Set<string>()
  readonly metrics = new Metrics()
  private disposed = false
  constructor(private readonly env: ClientEnvironment = browserEnvironment()) {}
  readonly getSnapshot = (): ClientSnapshot => this.source.getSnapshot()
  readonly subscribe = (listener: () => void): (() => void) => this.source.subscribe(listener)
  onEvents(listener: (events: readonly Occurrence[]) => void): () => void { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener) } }
  private update(patch: Partial<ClientSnapshot>): void { this.source.set({ ...this.getSnapshot(), ...patch }) }
  private ensureWorker(): WorkerPort {
    if (this.worker === undefined) {
      this.worker = this.env.createWorker()
      this.worker.addEventListener('message', this.onMessage)
      this.worker.addEventListener('error', this.onWorkerError)
    }
    return this.worker
  }
  private report(error: unknown): void { this.update({ loading: false, error: errorPayload(error) }) }
  clearError(): void { this.update({ error: undefined }) }
  private readonly onWorkerError = (event: ErrorEvent): void => {
    event.preventDefault?.()
    const error = new LabError('WORKER_FAILED', '实验计算线程退出。请从最近存档重新加载；未宣称未完成的操作已保存。')
    this.rejectPending(error)
    this.report(error)
    this.disconnect()
  }
  private rejectPending(error: unknown): void {
    if (this.watchdog !== undefined) this.env.clearTimeout(this.watchdog)
    this.watchdog = undefined
    for (const entry of [this.pending, ...this.queue]) entry?.waiters.forEach(waiter => waiter.reject(error))
    this.pending = undefined
    this.queue = []
  }
  private disconnect(): void {
    for (const id of this.frameAcks.values()) this.env.cancelFrame(id)
    this.frameAcks.clear()
    this.worker?.removeEventListener('message', this.onMessage)
    this.worker?.removeEventListener('error', this.onWorkerError)
    this.worker?.terminate()
    this.worker = undefined
  }
  async load(payload: { templateId?: string; scene?: unknown; originScene?: unknown; checkpoint?: unknown }, generation = crypto.randomUUID()): Promise<void> {
    if (this.disposed) throw new LabError('DISPOSED', '实验已关闭。')
    this.rejectPending(new LabError('LOAD_REPLACED', '实验已切换，旧操作不再执行。'))
    this.disconnect()
    this.tag = { version: 1, generation, sceneId: '', revision: 0 }
    this.lastFrameSerial = 0
    this.lastEventSeq = 0
    this.readouts.clear()
    this.readoutRequests.clear()
    this.frames.set(undefined)
    this.source.set({ generation, loading: true, dirty: false, active: this.getSnapshot().active, presentation: initialPresentation() })
    try { await this.request('load', payload); this.update({ loading: false }); if (!this.getSnapshot().active) await this.setActive(false) }
    catch (error) { this.report(error); throw error }
  }
  private request<T>(type: Pending['type'], payload: unknown, previewKey?: string): Promise<T> {
    if (this.disposed) return Promise.reject(new LabError('DISPOSED', '实验已关闭。'))
    return new Promise<T>((resolve, reject) => {
      // Only consecutive, unsent previews of the SAME gesture may be replaced. Commands/events never are.
      const last = this.queue.at(-1)
      const waiter = { resolve: resolve as (value: unknown) => void, reject }
      if (previewKey !== undefined && last?.previewKey === previewKey) { last.payload = payload; last.waiters.push(waiter); return }
      if (this.queue.length >= 64) { reject(new LabError('COMMAND_BACKPRESSURE', '操作队列繁忙，请等待当前修改完成。')); return }
      this.queue.push({ id: `web-${++this.requestId}`, type, payload, waiters: [waiter], ...(previewKey === undefined ? {} : { previewKey }) })
      this.pump()
    })
  }
  private pump(): void {
    if (this.pending !== undefined || this.disposed) return
    const entry = this.queue.shift()
    if (entry === undefined) return
    this.pending = entry
    entry.startedAt = this.env.now()
    try {
      this.ensureWorker().postMessage({ ...this.tag, id: entry.id, type: entry.type, payload: entry.payload } satisfies WorkerRequest)
      this.watchdog = this.env.setTimeout(() => {
        const error = new LabError('WORKER_TIMEOUT', '计算未在设备等待期限内完成。请重新加载最近存档。')
        this.rejectPending(error); this.report(error); this.disconnect()
      }, 60_000)
    } catch (error) { this.rejectPending(error); this.report(error) }
  }
  async action<K extends ActionName>(name: K, ...args: ActionArguments[K]): Promise<void> {
    const key = PREVIEW_ACTIONS.has(name) ? `${name}:${String(args[0])}` : undefined
    try {
      const result = await this.request<{ dirty: boolean }>('action', { name, args }, key)
      this.update({ dirty: result.dirty, error: undefined })
    } catch (error) { if (!(error instanceof LabError) || error.code !== 'LOAD_REPLACED') this.report(error); throw error }
  }
  query<T>(kind: string, payload: Record<string, unknown> = {}): Promise<T> { return this.request<T>('query', { kind, ...payload }) }
  checkpoint(): Promise<LabCheckpoint> { return this.query('checkpoint') }
  async setActive(active: boolean): Promise<void> {
    this.update({ active })
    if (this.tag.sceneId !== '') await this.request('visible', { active })
  }
  async setPresentation(presentation: PresentationState): Promise<void> {
    this.update({ presentation })
    if (this.tag.sceneId !== '') await this.request('presentation', presentation)
  }
  async readout(index: number): Promise<readonly { label: string; value: string }[]> {
    const key = `${this.tag.sceneId}:${this.tag.revision}:${index}`
    const cached = this.readouts.get(key)
    if (cached !== undefined) return cached
    const result = await this.query<readonly { label: string; value: string }[]>('readout', { index })
    if (this.readouts.size >= 128) this.readouts.delete(this.readouts.keys().next().value!)
    this.readouts.set(key, result)
    return result
  }
  private sampleMap: number[] = []
  /** The callback is local; only its named readout(index) request crosses the worker boundary. */
  readonly getSampleReadout = (displayIndex: number): readonly { label: string; value: string }[] => {
    const index = this.sampleMap[displayIndex]
    if (index === undefined) return []
    const key = `${this.tag.sceneId}:${this.tag.revision}:${index}`
    const cached = this.readouts.get(key)
    if (cached !== undefined) return cached
    if (!this.readoutRequests.has(key)) {
      this.readoutRequests.add(key)
      void this.readout(index).then(() => { this.update({}) }).catch(error => this.report(error)).finally(() => { this.readoutRequests.delete(key) })
    }
    return [{ label: '读数', value: '读取中' }]
  }
  private receiveFrame(packet: FramePacket): void {
    if (packet.serial <= this.lastFrameSerial) return
    const start = this.env.now()
    const decoded = decodeData(packet.patch, packet.buffer, packet.used)
    if (!object(decoded) || !object(decoded.patch) || !Array.isArray(decoded.removed)) throw new LabError('FRAME_INVALID', '画面增量无效。')
    const previous = packet.full ? undefined : this.frames.getSnapshot()
    if (!packet.full && previous === undefined) throw new LabError('FRAME_GAP', '画面基线丢失，请恢复实验。')
    const frame = { ...(previous ?? {}), ...decoded.patch } as unknown as WorkspaceFrame
    for (const key of decoded.removed) if (typeof key === 'string') delete (frame as unknown as Record<string, unknown>)[key]
    this.tag = { version: 1, generation: packet.generation, sceneId: packet.sceneId, revision: packet.revision }
    this.lastFrameSerial = packet.serial
    this.sampleMap = packet.sampleIndices
    const events = packet.events.filter(event => event.seq > this.lastEventSeq)
    for (const event of events) {
      if (event.seq !== this.lastEventSeq + 1) throw new LabError('EVENT_GAP', '实验事件出现缺口，不能继续回放。')
      this.lastEventSeq = event.seq
    }
    for (const listener of this.eventListeners) {
      try { listener(events) } catch (error) { this.report(error) }
    }
    this.frames.set(frame)
    this.metrics.duration('decode', this.env.now() - start)
    this.metrics.count('framesReceived')
    this.metrics.count('eventsReceived', events.length)
    const publish = (): void => {
      this.summaryTimer = undefined
      this.lastSummaryAt = this.env.now()
      const current = this.frames.getSnapshot()
      this.update({ frame: current, ...(packet.summary === undefined ? {} : { summary: packet.summary }), loading: false })
    }
    if (packet.summary !== undefined || this.env.now() - this.lastSummaryAt >= 250) {
      if (this.summaryTimer !== undefined) this.env.clearTimeout(this.summaryTimer)
      publish()
    } else if (this.summaryTimer === undefined) this.summaryTimer = this.env.setTimeout(publish, Math.max(0, 250 - (this.env.now() - this.lastSummaryAt)))
    const acknowledge = (): void => {
      this.frameAcks.delete(packet.serial)
      if (this.worker === undefined || packet.generation !== this.tag.generation) return
      this.worker.postMessage({ ...this.tag, id: `ack-${packet.serial}`, type: 'ack', payload: { serial: packet.serial }, buffer: packet.buffer } satisfies WorkerRequest, [packet.buffer])
    }
    if (this.getSnapshot().active) this.frameAcks.set(packet.serial, this.env.requestFrame(acknowledge))
    else acknowledge()
  }
  private readonly onMessage = (event: MessageEvent<WorkerOutput>): void => {
    const message = event.data
    if (this.disposed || message.version !== 1 || message.generation !== this.tag.generation) return
    try {
      if (message.type === 'frame') { this.receiveFrame(message); return }
      const entry = this.pending
      if (entry === undefined || message.id !== entry.id) {
        if (message.type === 'error' && object(message.payload)) this.report(new LabError(String(message.payload.code), String(message.payload.message)))
        return
      }
      if (this.watchdog !== undefined) this.env.clearTimeout(this.watchdog)
      this.watchdog = undefined
      this.pending = undefined
      this.tag = { version: 1, generation: message.generation, sceneId: message.sceneId, revision: message.revision }
      this.metrics.duration('command', this.env.now() - (entry.startedAt ?? this.env.now()))
      if (message.type === 'error') {
        const payload = object(message.payload) ? message.payload : {}
        const error = new LabError(String(payload.code ?? 'WORKER_ERROR'), String(payload.message ?? '实验操作失败。'))
        entry.waiters.forEach(waiter => waiter.reject(error))
      } else entry.waiters.forEach(waiter => waiter.resolve(message.payload))
      this.pump()
    } catch (error) { this.rejectPending(error); this.report(error); this.disconnect() }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.rejectPending(new LabError('DISPOSED', '实验已关闭。'))
    if (this.summaryTimer !== undefined) this.env.clearTimeout(this.summaryTimer)
    this.disconnect()
    this.eventListeners.clear()
    this.readouts.clear()
    this.frames.dispose()
    this.source.dispose()
  }
}
