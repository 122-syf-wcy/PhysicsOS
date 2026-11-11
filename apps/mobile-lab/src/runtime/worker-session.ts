import { parsePhysicsScene, type PhysicsScene } from '@physicsos/physics-scene'
import { createSceneObject } from '@physicsos/physics-workbench/codec'
import { captureDatasets } from '@physicsos/physics-workbench/data'
import { datasetsToCsv } from '@physicsos/physics-workbench/csv'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { createWorkbenchInstanceRuntime, type WorkbenchInstanceRuntime } from '@lab/physics/workbench-instance-runtime.ts'
import { EXPERIMENT_TEMPLATES } from '@lab/physics/experiment-templates.ts'
import { BUILDER_PARTS, draftToScene, starterDraft } from '@lab/physics/circuit-builder.ts'
import { buildExperimentReport } from '@lab/physics/experiment-report.ts'
import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import type { TimelineEvent } from '@lab/physics/scene-visual-model.ts'
import { catalog } from 'virtual:lab-catalog'
import { EXPORT_MIME, LabError, MAX_FILE_BYTES, assertJson, errorPayload, fail, finite, isGeneration, object, safeFileName, stringifyBounded, text } from '../shared/protocol.ts'
import { initialPresentation, readCheckpointEnvelope, validatePresentation, type LabCheckpoint, type PresentationState } from '../shared/checkpoint.ts'
import { Metrics } from '../shared/metrics.ts'
import { NON_FACT_ACTIONS, parseAction, type LabAction } from './commands.ts'
import { observationCsv } from './observation-export.ts'
import { MAX_PENDING_EVENTS, TransferPool, displayFrame, encodeData, framePatch, type Occurrence, type WorkerOutput, type WorkerRequest, type WorkerTag, type WireSummary } from './transport.ts'

export interface SessionEnvironment {
  now(): number
  post(message: WorkerOutput, transfer?: Transferable[]): void
  schedule(callback: () => void, delay: number): unknown
  cancel(handle: unknown): void
}
/** Owns the existing workbench and its exact engines. No rendering, DOM, React or host services. */
export class WorkerSession {
  private owner: WorkbenchInstanceRuntime | undefined
  private generation = ''
  private presentation: PresentationState = initialPresentation()
  private active = true
  private dirty = false
  private closed = false
  private timer: unknown
  private lastTick: number | undefined
  private serial = 0
  private inFlight: { serial: number; lastEvent: number } | undefined
  private sentFrame: WorkspaceFrame | undefined
  private lastSummary: object | undefined
  private pendingEvents: Occurrence[] = []
  private eventSequence = 0
  private cycle = 0
  private previousFrame: WorkspaceFrame | undefined
  private readonly buffers = new TransferPool()
  readonly metrics = new Metrics()

  constructor(private readonly env: SessionEnvironment) {}
  private tag(): WorkerTag {
    const frame = this.owner?.frames.getSnapshot()
    return { version: 1, generation: this.generation, sceneId: this.owner?.getSnapshot().sceneId ?? '', revision: frame?.sceneRevision ?? 0 }
  }
  private reply(request: WorkerRequest, payload: unknown): void { this.env.post({ ...this.tag(), type: 'reply', id: request.id, payload }) }
  private requireOwner(): WorkbenchInstanceRuntime {
    return this.owner ?? fail('NOT_LOADED', '尚未加载实验。')
  }
  private cancelClock(): void {
    if (this.timer !== undefined) this.env.cancel(this.timer)
    this.timer = undefined
    this.lastTick = undefined
  }
  private armClock(): void {
    if (this.closed || !this.active || this.timer !== undefined || this.owner?.frames.getSnapshot().clock.running !== true) return
    // Receiver pressure suspends production, not the event stream. Resume uses a fresh wall-clock baseline.
    if (this.pendingEvents.length >= MAX_PENDING_EVENTS / 2) { this.lastTick = undefined; return }
    this.timer = this.env.schedule(() => {
      this.timer = undefined
      if (!this.active || this.closed) return
      const now = this.env.now()
      const elapsed = this.lastTick === undefined ? 0 : Math.min(0.25, Math.max(0, (now - this.lastTick) / 1000))
      this.lastTick = now
      try {
        if (elapsed > 0) {
          const start = this.env.now()
          const owner = this.requireOwner()
          owner.advance(elapsed, now)
          this.metrics.duration('compute', this.env.now() - start)
          this.collectEvents(owner.frames.getSnapshot(), true)
          this.publish()
        }
        this.armClock()
      } catch (error) {
        this.requireOwner().setRunning(false)
        this.cancelClock()
        this.env.post({ ...this.tag(), type: 'error', id: 'clock', payload: errorPayload(error) })
      }
    }, 1000 / 60)
  }
  private collectEvents(frame: WorkspaceFrame, playback: boolean): void {
    const previous = this.previousFrame
    this.previousFrame = frame
    if (!playback || previous === undefined || frame.sceneRevision !== previous.sceneRevision) return
    const from = previous.clock.time
    const to = frame.clock.time
    if (from === to) return
    const crossed: TimelineEvent[] = []
    if (to < from && previous.clock.running) {
      crossed.push(...previous.events.filter(event => event.time > from && event.time <= previous.clock.total))
      this.cycle += 1
      crossed.push(...frame.events.filter(event => event.time >= 0 && event.time <= to))
    } else if (to > from) crossed.push(...frame.events.filter(event => event.time > from && event.time <= to))
    if (this.pendingEvents.length + crossed.length > MAX_PENDING_EVENTS) {
      // Leave no partial event batch. Legal scene events fit the preflight limit in load().
      this.requireOwner().setRunning(false)
      this.cancelClock()
      throw new LabError('EVENT_BACKPRESSURE', '事件接收过慢；已暂停实验以保留事件顺序。')
    }
    for (const event of crossed) this.pendingEvents.push({ seq: ++this.eventSequence, event,
      sceneId: this.tag().sceneId, revision: frame.sceneRevision, cycle: this.cycle })
    this.metrics.count('eventsProduced', crossed.length)
  }
  private publish(force = false): void {
    if (this.owner === undefined || this.inFlight !== undefined || this.closed) return
    const start = this.env.now()
    const raw = this.owner.frames.getSnapshot()
    const selected = displayFrame(raw)
    const delta = framePatch(selected.frame, this.sentFrame)
    const summary = this.owner.getSnapshot()
    const { workspace: _workspace, ...rest } = summary
    const encoded = encodeData(delta, this.buffers)
    const serial = ++this.serial
    const events = this.pendingEvents.slice()
    this.inFlight = { serial, lastEvent: events.at(-1)?.seq ?? 0 }
    this.env.post({ ...this.tag(), type: 'frame', serial, full: this.sentFrame === undefined,
      patch: encoded.json, buffer: encoded.buffer, used: encoded.used,
      ...(force || summary !== this.lastSummary ? { summary: rest as WireSummary } : {}),
      events, sampleIndices: selected.indices, sentAt: this.env.now() }, [encoded.buffer])
    this.sentFrame = selected.frame
    this.lastPublishedRaw = raw
    this.lastSummary = summary
    this.metrics.duration('encode', this.env.now() - start)
    this.metrics.count('framesSent')
    this.metrics.count('bytesSent', encoded.used * 8)
  }
  private makeOwner(checkpoint: LabCheckpoint): WorkbenchInstanceRuntime {
    const scene = parsePhysicsScene(checkpoint.scene)
    const origin = parsePhysicsScene(checkpoint.originScene)
    if (!scene.ok || !origin.ok) fail('SCENE_INVALID', '存档内的物理场景未通过共享格式校验。')
    const e = checkpoint.editing
    const instance = createWorkbenchInstanceRuntime({
      scene: scene.value, sceneId: String(scene.value.id), originScene: origin.value,
      instanceKey: e.instanceKey, instanceEditRevision: e.instanceEditRevision,
      ...(checkpoint.templateId === undefined ? {} : { templateId: checkpoint.templateId }),
      source: e.source, buildMode: e.buildMode, persistedHistory: checkpoint.history,
      ...(e.draft === undefined ? {} : { persistedDraft: e.draft }),
      clock: { time: checkpoint.playback.time, total: checkpoint.playback.duration,
        rate: checkpoint.playback.rate, running: checkpoint.playback.running && this.active },
      scheduler: null, summaryIntervalMs: 250, visible: this.active,
      onCommitted: () => { this.dirty = true },
    })
    const frame = instance.frames.getSnapshot()
    if (frame.events.length > MAX_PENDING_EVENTS / 2) { instance.dispose(); fail('EVENT_LIMIT', '场景单周期事件超过设备缓冲限制。') }
    if (e.selectedIds.length) instance.setHighlight(e.selectedIds)
    // Visibility is already persisted in scene commands. Do not create new edit history on restore.
    this.presentation = { viewport: { ...e.viewport }, activePanel: e.activePanel }
    return instance
  }
  private load(payload: unknown, generation: string): void {
    if (!object(payload)) fail('LOAD_INVALID', '实验加载参数无效。')
    let checkpoint: LabCheckpoint
    if (payload.checkpoint !== undefined) checkpoint = readCheckpointEnvelope(payload.checkpoint)
    else {
      let scene: PhysicsScene
      let templateId: string | undefined
      if (payload.scene !== undefined) {
        assertJson(payload.scene)
        const parsed = parsePhysicsScene(payload.scene)
        if (!parsed.ok) fail('SCENE_INVALID', '场景未通过 PhysicsScene 格式校验。')
        scene = parsed.value
      } else if (payload.templateId === 'free-circuit') scene = draftToScene(starterDraft())
      else {
        if (!text(payload.templateId)) fail('TEMPLATE_UNKNOWN', '实验目录标识无效。')
        const template = EXPERIMENT_TEMPLATES.find(item => item.id === payload.templateId)
        const info = catalog.experiments.find(item => item.id === payload.templateId)
        if (template === undefined || info === undefined) fail('TEMPLATE_UNKNOWN', '当前应用未包含这个实验。')
        templateId = template.id
        scene = template.createScene(info.title).scene
      }
      const origin = payload.originScene === undefined ? { ok: true as const, value: scene } : parsePhysicsScene(payload.originScene)
      if (!origin.ok) fail('SCENE_INVALID', '来源场景未通过 PhysicsScene 格式校验。')
      checkpoint = { version: 1, scene, originScene: origin.value,
        ...(templateId === undefined ? {} : { templateId }),
        playback: { time: 0, duration: 0, rate: 1, running: false },
        editing: { instanceKey: `mobile-${crypto.randomUUID()}`, instanceEditRevision: 0,
          source: templateId === undefined ? { kind: payload.templateId === 'free-circuit' ? 'free-build' : 'import' }
            : { kind: 'template', id: templateId, title: scene.metadata.title ?? templateId },
          buildMode: payload.templateId === 'free-circuit' ? 'construct' : 'inspect', selectedIds: [], observables: {}, ...initialPresentation() },
        history: { past: [], future: [] } }
    }
    // Build before replacing the last recoverable owner. A rejected load leaves it intact.
    const next = this.makeOwner(checkpoint)
    this.cancelClock()
    this.owner?.dispose()
    this.owner = next
    this.generation = generation
    this.dirty = false
    this.inFlight = undefined
    this.sentFrame = undefined
    this.lastSummary = undefined
    this.pendingEvents = []
    this.eventSequence = 0
    this.cycle = 0
    this.previousFrame = next.frames.getSnapshot()
    this.publish(true)
    this.armClock()
  }
  checkpoint(): LabCheckpoint {
    const owner = this.requireOwner()
    const saved = owner.serialize()
    const frame = owner.frames.getSnapshot()
    const checkpoint: LabCheckpoint = { version: 1, scene: saved.scene, originScene: saved.originScene ?? saved.scene,
      ...(saved.templateId === undefined ? {} : { templateId: saved.templateId }),
      playback: { time: saved.clock.time, duration: saved.clock.total, rate: saved.clock.rate, running: saved.clock.running },
      history: saved.history,
      editing: { instanceKey: saved.instanceKey, instanceEditRevision: saved.instanceEditRevision, source: saved.source,
        buildMode: saved.buildMode, ...(saved.draft === undefined ? {} : { draft: saved.draft }),
        selectedIds: [...(frame.view.highlighted ?? [])], observables: { ...frame.view.visible }, ...this.presentation } }
    assertJson(checkpoint)
    return checkpoint
  }
  private apply(action: LabAction): void {
    let owner = this.requireOwner()
    const isFact = !NON_FACT_ACTIONS.has(action.name)
    const before = isFact ? this.checkpoint() : undefined
    try {
      if (action.name === 'addPart') {
        const part = BUILDER_PARTS.find(item => item.id === action.args[0])
        if (part === undefined) fail('PART_UNKNOWN', '器材未包含在当前目录中。')
        if (!owner.getSnapshot().capabilities.construct) fail('ACTION_UNAVAILABLE', '这个实验不是可接线的电路工作台。')
        if (owner.getSnapshot().buildMode !== 'construct') owner.enterBuilder()
        const beforeIds = new Set(owner.getSnapshot().draft?.components.map(component => component.id))
        owner.addPart(part, action.args[1])
        const added = owner.getSnapshot().draft?.components.find(component => !beforeIds.has(component.id))
        if (added !== undefined) owner.setHighlight([added.id])
      } else if (action.name === 'reset') { owner.setRunning(false); owner.seek(0) }
      else {
        const fn = owner.actions[action.name] as (...args: unknown[]) => unknown
        fn(...action.args)
      }
      const diagnostics = owner.getSnapshot().diagnostics
      if (diagnostics.length) throw new LabError(diagnostics[0]!.code, diagnostics[0]!.message)
      if (isFact) this.checkpoint() // Reject oversize history rather than silently discarding undo entries.
    } catch (error) {
      if (before !== undefined) {
        const restored = this.makeOwner(before)
        owner.dispose()
        this.owner = owner = restored
        this.sentFrame = undefined
      }
      throw error
    } finally {
      this.collectEvents(owner.frames.getSnapshot(), action.name === 'step')
      this.publish(true)
      if (!owner.frames.getSnapshot().clock.running) this.cancelClock()
      else this.armClock()
    }
  }
  private async query(payload: unknown): Promise<unknown> {
    if (!object(payload) || !text(payload.kind)) fail('QUERY_INVALID', '查询格式无效。')
    const owner = this.requireOwner()
    const frame = owner.frames.getSnapshot()
    switch (payload.kind) {
      case 'checkpoint': return this.checkpoint()
      case 'snapshot': return frame
      case 'report': return buildExperimentReport(frame, new Date(), owner.getSnapshot().notebook)
      case 'metrics': return this.metrics.snapshot()
      case 'readout': {
        if (!Number.isSafeInteger(payload.index) || (payload.index as number) < 0) fail('QUERY_INVALID', '读数索引无效。')
        return owner.getSampleReadout(payload.index as number)
      }
      case 'table': {
        const start = this.pageStart(payload.start)
        return { columns: frame.table.columns, rows: frame.table.rows.slice(start, start + 200), total: frame.table.rows.length, start }
      }
      case 'chart': {
        const chart = frame.charts.find(item => item.id === payload.id)
        if (chart === undefined) fail('QUERY_INVALID', '曲线不存在。')
        const start = this.pageStart(payload.start)
        return { ...chart, points: chart.points.slice(start, start + 200), total: chart.points.length, start }
      }
      case 'raw': {
        const capture = owner.captureRaw()
        assertJson(capture)
        return capture
      }
      case 'export': {
        const format = payload.format
        if (format === 'observations') return observationCsv(frame.title, owner.getSnapshot().notebook)
        const name = safeFileName(frame.title, String(format))
        if (format === 'json') return { name, mime: EXPORT_MIME.json, encoding: 'utf8', content: stringifyBounded(this.checkpoint()) }
        if (format === 'markdown') return { name, mime: EXPORT_MIME.markdown, encoding: 'utf8', content: buildExperimentReport(frame, new Date(), owner.getSnapshot().notebook).markdown }
        if (format === 'csv') {
          const raw = owner.captureRaw()
          const sceneObject = createSceneObject(raw.scene)
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalStringify(sceneObject)))
          const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
          const datasets = captureDatasets(raw, { sourceScene: { kind: 'scene', digest }, cursor: raw.cursor })
          return { name, mime: EXPORT_MIME.csv, encoding: 'utf8', content: datasetsToCsv(datasets, { bom: true, maxBytes: MAX_FILE_BYTES }) }
        }
        fail('EXPORT_FORMAT', '此文件格式由绘制线程导出。')
      }
      default: fail('QUERY_INVALID', '未支持的实验查询。')
    }
  }
  private pageStart(value: unknown): number {
    if (value === undefined) return 0
    if (!Number.isSafeInteger(value) || (value as number) < 0) fail('QUERY_INVALID', '分页位置无效。')
    return value as number
  }
  async receive(request: WorkerRequest): Promise<void> {
    if (this.closed) return
    try {
      if (!object(request) || request.version !== 1 || !text(request.id) || !isGeneration(request.generation)) fail('WORKER_PROTOCOL', 'Worker 消息协议无效。')
      if (request.type === 'load') { this.load(request.payload, request.generation); this.reply(request, { loaded: true, presentation: this.presentation }); return }
      if (request.generation !== this.generation) return
      if (request.type === 'ack') {
        if (this.inFlight === undefined || !object(request.payload) || request.payload.serial !== this.inFlight.serial) return
        const through = this.inFlight.lastEvent
        this.pendingEvents = this.pendingEvents.filter(event => event.seq > through)
        if (request.buffer !== undefined) this.buffers.recycle(request.buffer)
        this.inFlight = undefined
        const changed = this.requireOwner().frames.getSnapshot() !== this.previousPublishedRaw
        if (changed || this.pendingEvents.length) this.publish()
        this.armClock()
        return
      }
      const tag = this.tag()
      if (request.sceneId !== tag.sceneId || request.revision !== tag.revision) fail('STALE_REVISION', '操作针对旧场景，请等待当前修改完成后重试。')
      switch (request.type) {
        case 'action': this.apply(parseAction(request.payload)); this.reply(request, { dirty: this.dirty }); break
        case 'query': this.reply(request, await this.query(request.payload)); break
        case 'visible':
          if (!object(request.payload) || typeof request.payload.active !== 'boolean') fail('LIFECYCLE_INVALID', '生命周期状态无效。')
          this.active = request.payload.active
          this.cancelClock()
          this.requireOwner().setVisible(this.active)
          this.publish(true)
          this.reply(request, { active: this.active })
          this.armClock()
          break
        case 'presentation':
          validatePresentation(request.payload)
          this.presentation = { viewport: { ...request.payload.viewport }, activePanel: request.payload.activePanel }
          this.reply(request, { updated: true })
          break
        case 'dispose': this.dispose(); break
        default: fail('WORKER_PROTOCOL', '不支持的 Worker 操作。')
      }
    } catch (error) {
      if (request.type === 'load' && isGeneration(request.generation)) {
        this.env.post({ version: 1, generation: request.generation, sceneId: '', revision: 0, type: 'error', id: request.id, payload: errorPayload(error) })
      } else this.env.post({ ...this.tag(), type: 'error', id: request.id, payload: errorPayload(error) })
    }
  }
  private get previousPublishedRaw(): WorkspaceFrame | undefined { return this.lastPublishedRaw }
  private lastPublishedRaw: WorkspaceFrame | undefined
  dispose(): void { this.closed = true; this.cancelClock(); this.owner?.dispose(); this.owner = undefined; this.pendingEvents = []; this.inFlight = undefined }
}
