import { ASSET_ORIGIN, ASSET_PREFIX, MAX_ENVELOPE_BYTES, PROTOCOL_VERSION, STATE_INTERVAL_MS, errorPayload, parseNativeCommand, stringifyBounded, validateExport, type Envelope, type ExportFile, type NativeCommand } from './protocol.ts'

export type NativeSink = (message: string) => void
export interface NativeBridgeOptions {
  onCommand(command: NativeCommand): void | Promise<void>
  capabilities: readonly string[]
  onError?(error: unknown): void
  sink?: NativeSink
}
/** The only native callable is postMessage(JSON). No credentials or runtime handles enter the bridge. */
export class NativeBridge {
  private generation = ''
  private serial = 0
  private lastStateAt = -Infinity
  private stateTimer: ReturnType<typeof setTimeout> | undefined
  private pendingState: Record<string, unknown> | undefined
  private disposed = false
  private readonly sink: NativeSink | undefined
  private readonly seen = new Set<string>()
  constructor(private readonly options: NativeBridgeOptions) {
    if (window.top !== window) throw new Error('The native bridge is main-frame only.')
    const testOrigin = __LAB_TEST__ && ['127.0.0.1', 'localhost'].includes(location.hostname)
    if ((!testOrigin && location.origin !== ASSET_ORIGIN) || !location.pathname.startsWith(ASSET_PREFIX)) {
      throw new Error('The lab must be served from its dedicated HTTPS asset origin and /assets/lab/ path.')
    }
    this.sink = options.sink ?? (window.PhysicsNative === undefined ? undefined : message => window.PhysicsNative!.postMessage(message))
    window.addEventListener('message', this.receive)
    this.emit('ready', { capabilities: [...options.capabilities] }, this.nextId())
  }
  get currentGeneration(): string { return this.generation }
  get connected(): boolean { return this.sink !== undefined }
  nextId(): string { return `lab-${++this.serial}` }
  private readonly receive = (event: MessageEvent<unknown>): void => {
    const expected = __LAB_TEST__ ? location.origin : ASSET_ORIGIN
    if (this.disposed || event.origin !== expected || (event.source !== null && event.source !== window)) return
    let command: NativeCommand
    try {
      command = parseNativeCommand(event.data)
      if (command.type !== 'load' && command.type !== 'document' && command.payload.generation !== this.generation) return
      if (command.type === 'load' || command.type === 'document') {
        if (command.payload.generation !== this.generation) this.seen.clear()
        this.generation = command.payload.generation
      }
      const key = `${this.generation}:${command.type}:${command.id}`
      if (this.seen.has(key)) return
      if (this.seen.size >= 4096) this.seen.delete(this.seen.values().next().value!)
      this.seen.add(key)
      const generation = this.generation
      void Promise.resolve(this.options.onCommand(command)).catch(error => {
        if (generation === this.generation) this.error(error, command.id)
      })
    } catch (error) { this.options.onError?.(error); if (this.generation) this.error(error) }
  }
  /** Standalone UI actions keep the native document generation; they never invent a new native load. */
  adoptGeneration(generation: string): void { if (!this.connected) this.generation = generation }
  emit(type: string, payload: Record<string, unknown>, id = this.nextId()): void {
    if (this.disposed || this.sink === undefined) return
    const envelope: Envelope = { version: PROTOCOL_VERSION, id, type,
      payload: type === 'ready' ? payload : { ...payload, generation: this.generation } }
    this.sink(stringifyBounded(envelope, MAX_ENVELOPE_BYTES))
  }
  state(payload: Record<string, unknown>): void {
    this.pendingState = payload
    if (this.stateTimer !== undefined) return
    const send = (): void => {
      this.stateTimer = undefined
      if (this.pendingState === undefined || this.disposed) return
      const latest = this.pendingState
      this.pendingState = undefined
      this.lastStateAt = performance.now()
      this.emit('state', latest)
    }
    const remaining = STATE_INTERVAL_MS - (performance.now() - this.lastStateAt)
    if (remaining <= 0) send()
    else this.stateTimer = setTimeout(send, remaining)
  }
  export(file: ExportFile, requestId: string): void {
    validateExport(file)
    this.emit('export', { ...file }, requestId)
  }
  error(error: unknown, id = this.nextId()): void { this.options.onError?.(error); this.emit('error', errorPayload(error), id) }
  dispose(): void {
    this.disposed = true
    window.removeEventListener('message', this.receive)
    if (this.stateTimer !== undefined) clearTimeout(this.stateTimer)
    this.pendingState = undefined
    this.seen.clear()
  }
}
