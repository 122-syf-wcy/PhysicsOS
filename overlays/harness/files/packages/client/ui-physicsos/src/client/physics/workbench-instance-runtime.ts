import { forkExperimentalScene, parsePhysicsScene, type ExperimentObservation, type PhysicsScene } from '@physicsos/physics-scene'
import { asSceneId, type IsoDateTime } from '@physicsos/shared'
import type { BuildMode, CapturedResult, InstanceSource } from '@physicsos/physics-workbench/types'
import { readInstanceSource, readWorkbenchClock } from '@physicsos/physics-workbench/codec'
import { createFrameSource, type FrameSource } from './frame-source.ts'
import type { WorkspaceFrame, WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'
import { domainOfScene, type SupportedSceneDomain } from './domain-of-scene.ts'
import type { ObservableKey, PlaybackClock, ScenePoint } from './scene-visual-model.ts'
import {
  addComponent, addPart, connectTerminals, disconnectTerminal, draftFromScene,
  moveComponent, removeComponent, rotateComponent, setParams, synchronizeDraftWithScene,
  type BuilderComponentType, type BuilderParams, type BuilderPartSpec, type CircuitDraft, type TerminalRef,
} from './circuit-builder.ts'
import { buildWorkspaceRuntime } from './build-workspace-runtime.ts'
import { captureWorkspaceRuntime, workspaceFrameOf, WorkspaceCaptureError } from './workspace-capture.ts'
import { requiresExperimentalForkForFact } from './experimental-branch.ts'
import { captureObservation, NOTEBOOK_LIMIT, readNotebook } from '../experiments/experiment-notebook.ts'
import { parseCircuitDraft, parseWorkbenchHistory } from './workbench-history-codec.ts'

export type WorkbenchBuildMode = BuildMode

export interface WorkbenchHistoryEntry {
  readonly id: string
  readonly label: string
  readonly before: PhysicsScene
  readonly after: PhysicsScene
  readonly beforeDraft?: CircuitDraft
  readonly afterDraft?: CircuitDraft
}

export interface WorkbenchHistory {
  readonly past: readonly WorkbenchHistoryEntry[]
  readonly future: readonly WorkbenchHistoryEntry[]
}

/** Plain callback/save state; the document layer stores its own content-addressed refs. */
export interface WorkbenchCommittedState {
  readonly instanceKey: string
  readonly scene: PhysicsScene
  readonly originScene?: PhysicsScene
  readonly templateId?: string
  readonly domain: SupportedSceneDomain
  readonly source: InstanceSource
  readonly buildMode: WorkbenchBuildMode
  readonly clock: PlaybackClock
  readonly instanceEditRevision: number
  readonly history: WorkbenchHistory
  readonly draft?: CircuitDraft
}

export interface WorkbenchCapabilities {
  readonly parameterPreview: boolean
  readonly componentPlacement: boolean
  readonly slider: boolean
  readonly switch: boolean
  readonly construct: boolean
  readonly capture: boolean
  readonly restoreOrigin: boolean
}

export interface WorkbenchInstanceSummary {
  readonly instanceKey: string
  readonly sceneId: string
  readonly templateId?: string
  readonly domain: SupportedSceneDomain
  readonly source: InstanceSource
  readonly buildMode: WorkbenchBuildMode
  readonly instanceEditRevision: number
  readonly workspace: WorkspaceFrame
  readonly clock: PlaybackClock
  readonly capabilities: WorkbenchCapabilities
  readonly history: {
    readonly canUndo: boolean
    readonly canRedo: boolean
    readonly past: readonly { readonly id: string; readonly label: string }[]
    readonly future: readonly { readonly id: string; readonly label: string }[]
  }
  readonly draft?: CircuitDraft
  readonly pendingWire?: TerminalRef
  readonly notebook: readonly ExperimentObservation[]
  readonly previewing: boolean
  readonly visible: boolean
  readonly disposed: boolean
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
}

export interface WorkbenchClockScheduler {
  /** Milliseconds on the same monotonic clock as request's callback. */
  now(): number
  request(callback: (now: number) => void): unknown
  cancel(handle: unknown): void
}

export interface CreateWorkbenchInstanceOptions {
  readonly instanceKey?: string
  readonly sceneId?: string
  readonly templateId?: string
  readonly scene: PhysicsScene
  readonly originScene?: PhysicsScene
  readonly source: InstanceSource
  readonly buildMode?: WorkbenchBuildMode
  readonly clock?: PlaybackClock
  readonly instanceEditRevision?: number
  readonly history?: WorkbenchHistory
  readonly draft?: CircuitDraft
  /** Untrusted document metadata is decoded inside this lazily loaded owner. */
  readonly persistedHistory?: unknown
  readonly persistedDraft?: unknown
  readonly visible?: boolean
  readonly scheduler?: WorkbenchClockScheduler | null
  readonly summaryIntervalMs?: number
  readonly onCommitted?: (state: WorkbenchCommittedState, action: string) => void
  readonly onPersist?: (state: WorkbenchCommittedState, reason: 'commit' | 'clock' | 'mode' | 'save') => void
  readonly onError?: (error: unknown) => void
}

/** The public action surface contains no engine, SceneRuntime, React, or callbacks in its snapshots. */
export interface WorkbenchInstanceActions {
  editParameter(id: string, value: number): WorkbenchInstanceSummary
  previewParameter(id: string, value: number): WorkbenchInstanceSummary
  commitParameter(id: string, value: number): WorkbenchInstanceSummary
  cancelParameterPreview(): WorkbenchInstanceSummary
  setChoice(id: string, value: string): WorkbenchInstanceSummary
  setObservable(key: ObservableKey, enabled: boolean): WorkbenchInstanceSummary
  setRunning(running: boolean): WorkbenchInstanceSummary
  setRate(rate: number): WorkbenchInstanceSummary
  seek(time: number): WorkbenchInstanceSummary
  step(delta: number): WorkbenchInstanceSummary
  setHighlight(ids: readonly string[]): WorkbenchInstanceSummary
  previewComponentPlacement(componentId: string, at: ScenePoint): WorkbenchInstanceSummary
  commitComponentPlacement(componentId: string, at: ScenePoint): WorkbenchInstanceSummary
  cancelComponentPlacement(): WorkbenchInstanceSummary
  setSwitchState(componentId: string, state: 'open' | 'closed'): WorkbenchInstanceSummary
  previewSliderPosition(componentId: string, position: number): WorkbenchInstanceSummary
  commitSliderPosition(componentId: string, position: number): WorkbenchInstanceSummary
  cancelSliderPosition(): WorkbenchInstanceSummary
  enterBuilder(): WorkbenchInstanceSummary
  leaveBuilder(): WorkbenchInstanceSummary
  applyDraftEdit(edit: (draft: CircuitDraft) => CircuitDraft): WorkbenchInstanceSummary
  addComponent(type: BuilderComponentType, at?: ScenePoint, params?: BuilderParams): WorkbenchInstanceSummary
  addPart(part: BuilderPartSpec, at?: ScenePoint): WorkbenchInstanceSummary
  removeComponent(componentId: string): WorkbenchInstanceSummary
  moveComponent(componentId: string, at: ScenePoint): WorkbenchInstanceSummary
  rotateComponent(componentId: string): WorkbenchInstanceSummary
  setComponentParams(componentId: string, params: BuilderParams): WorkbenchInstanceSummary
  connectTerminals(from: TerminalRef, to: TerminalRef): WorkbenchInstanceSummary
  disconnectTerminal(ref: TerminalRef): WorkbenchInstanceSummary
  beginWire(ref: TerminalRef): WorkbenchInstanceSummary
  completeWire(ref: TerminalRef): WorkbenchInstanceSummary
  cancelWire(): WorkbenchInstanceSummary
  undo(): WorkbenchInstanceSummary
  redo(): WorkbenchInstanceSummary
  restoreOrigin(): WorkbenchInstanceSummary
  setRelease(release: PhysicsScene['metadata']['experimentRelease']): WorkbenchInstanceSummary
  recordObservation(): WorkbenchInstanceSummary
  removeObservation(id: string): WorkbenchInstanceSummary
  getSampleReadout(index: number): readonly { readonly label: string; readonly value: string }[]
}

export interface WorkbenchInstanceRuntime extends WorkbenchInstanceActions {
  readonly instanceKey: string
  readonly frames: FrameSource<WorkspaceFrame>
  readonly frameSource: FrameSource<WorkspaceFrame>
  readonly summaries: FrameSource<WorkbenchInstanceSummary>
  readonly actions: WorkbenchInstanceActions
  getSnapshot(this: void): WorkbenchInstanceSummary
  subscribe(this: void, listener: () => void): () => void
  getScene(): PhysicsScene
  captureRaw(): CapturedResult
  serialize(): WorkbenchCommittedState
  /** Manual advance for deterministic clocks; the owner alone schedules automatic advance. */
  advance(wallClockSeconds: number, now?: number): WorkbenchInstanceSummary
  /** Detaching the last display suspends automatic advancement, without destroying the owner. */
  attachDisplay(displayKey: string): () => void
  detachDisplay(displayKey: string): void
  /** Hiding pauses, and showing does not catch up hidden wall-clock time. */
  setVisible(visible: boolean): WorkbenchInstanceSummary
  persist(): void
  duplicate(options?: Partial<Pick<CreateWorkbenchInstanceOptions, 'instanceKey' | 'sceneId' | 'onCommitted' | 'onPersist'>>): WorkbenchInstanceRuntime
  dispose(): void
}

const uniqueId = (prefix: string): string =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const copy = <T>(value: T): T => freeze(structuredClone(value))
const sceneContent = (scene: PhysicsScene): string => {
  const { id: _id, revision: _revision, timeline, metadata, ...facts } = scene
  const { currentTime: _currentTime, state: _state, playbackRate: _rate, ...schedule } = timeline
  const { createdAt: _createdAt, updatedAt: _updatedAt, lineage: _lineage, ...annotations } = metadata
  return JSON.stringify({ ...facts, timeline: schedule, metadata: annotations })
}
const defaultScheduler = (): WorkbenchClockScheduler | null => {
  if (typeof globalThis.requestAnimationFrame !== 'function') return null
  return {
    now: () => globalThis.performance.now(),
    request: callback => globalThis.requestAnimationFrame(callback),
    cancel: handle => globalThis.cancelAnimationFrame(handle as number),
  }
}

/** One independently clocked physical world, regardless of how many displays show it. */
export const createWorkbenchInstanceRuntime = (options: CreateWorkbenchInstanceOptions): WorkbenchInstanceRuntime => {
  const instanceKey = options.instanceKey ?? uniqueId('instance')
  const ownedSceneId = options.sceneId ?? uniqueId('scene')
  if (!instanceKey || !ownedSceneId) throw new TypeError('WORKBENCH_STATE_INVALID: instance and scene identities cannot be empty.')
  const parsedScene = parsePhysicsScene(options.scene)
  const parsedOrigin = parsePhysicsScene(options.originScene ?? options.scene)
  if (!parsedScene.ok || !parsedOrigin.ok) throw new TypeError('WORKBENCH_STATE_INVALID: the current or origin scene is malformed.')
  if (options.buildMode !== undefined && options.buildMode !== 'inspect' && options.buildMode !== 'construct') {
    throw new TypeError('WORKBENCH_STATE_INVALID: unknown authoring mode.')
  }
  const savedClock = options.clock === undefined ? undefined : readWorkbenchClock(options.clock)
  if (options.summaryIntervalMs !== undefined && (!Number.isFinite(options.summaryIntervalMs) || options.summaryIntervalMs < 0)) {
    throw new TypeError('WORKBENCH_STATE_INVALID: summary interval must be non-negative and finite.')
  }
  const initial: PhysicsScene = {
    ...parsedScene.value,
    id: asSceneId(ownedSceneId),
    revision: ownedSceneId === String(parsedScene.value.id) ? parsedScene.value.revision : 0,
  }
  const domain = domainOfScene(initial)
  if (domain === 'unsupported') throw new TypeError('This scene has no supported workspace runtime.')
  const originScene = copy(parsedOrigin.value)
  const source = copy(readInstanceSource(options.source))
  let committedScene = copy(initial)
  let release = committedScene.metadata.experimentRelease
  let notebook = copy(readNotebook(committedScene))
  let buildMode = options.buildMode ?? 'inspect'
  let instanceEditRevision = options.instanceEditRevision ?? 0
  if (!Number.isSafeInteger(instanceEditRevision) || instanceEditRevision < 0) {
    throw new TypeError('An instance edit revision must be a non-negative safe integer.')
  }
  const historyInput = options.persistedHistory === undefined ? options.history : options.persistedHistory
  const parsedHistory = historyInput === undefined ? { past: [], future: [] } : parseWorkbenchHistory(historyInput)
  if (parsedHistory === undefined) throw new TypeError('WORKBENCH_STATE_INVALID: the physical history is not a valid persisted history.')
  let history: WorkbenchHistory = copy(parsedHistory)
  const draftInput = options.persistedDraft === undefined ? options.draft : options.persistedDraft
  const parsedDraft = draftInput === undefined ? undefined : parseCircuitDraft(draftInput)
  if (draftInput !== undefined && parsedDraft === undefined) throw new TypeError('WORKBENCH_STATE_INVALID: the circuit draft is not a valid persisted draft.')
  let draft = parsedDraft === undefined ? undefined : copy(parsedDraft)
  if (draft !== undefined) {
    if (domain !== 'circuit' || JSON.stringify(synchronizeDraftWithScene(draft, committedScene)) !== JSON.stringify(draft)) {
      throw new TypeError('WORKBENCH_STATE_INVALID: the persisted draft does not match its committed circuit scene.')
    }
  }
  let pendingWire: TerminalRef | undefined
  let visible = options.visible ?? true
  let disposed = false
  let diagnostics: readonly { readonly code: string; readonly message: string }[] = []
  let runtime: WorkspaceRuntime
  let latest: WorkspaceSnapshot
  let previewRuntime: WorkspaceRuntime | undefined
  let preview: 'parameter' | 'component' | 'slider' | undefined
  let previewIdentity: string | undefined
  let previewClock: PlaybackClock | undefined
  let highlighted: readonly string[] = []
  let staticPlayback = false
  const scheduler = options.scheduler === undefined ? defaultScheduler() : options.scheduler
  const summaryInterval = Math.max(0, options.summaryIntervalMs ?? 250)
  const displays = new Set<string>()
  let scheduled = false
  let scheduledHandle: unknown
  let clockGeneration = 0
  let lastClockAt: number | undefined
  let lastSummaryAt = 0
  let lastPersistAt = 0
  let summary!: WorkbenchInstanceSummary

  const report = (error: unknown): void => {
    try { options.onError?.(error) } catch { /* Error handlers cannot interrupt another owner. */ }
  }
  const requireRuntime = (scene: PhysicsScene): WorkspaceRuntime => {
    const result = buildWorkspaceRuntime(domain, scene)
    if (result === null || result.getScene === undefined) {
      throw new TypeError('A workbench runtime must expose its committed scene.')
    }
    return result
  }
  const detectStaticPlayback = (): void => {
    const kind = runtime.getPlaybackKind?.()
    staticPlayback = kind === 'static' || (kind === undefined && latest.clock.total <= 0)
  }
  runtime = requireRuntime(committedScene)
  latest = runtime.getSnapshot()
  detectStaticPlayback()
  const physicalClockOf = (snapshot: WorkspaceSnapshot = latest): PlaybackClock => {
    const clock = runtime.getPhysicalClock?.() ?? snapshot.clock
    return staticPlayback ? { time: 0, total: 0, running: false, rate: clock.rate } : clock
  }
  const restoreOwnedClock = (clock: PlaybackClock): void => {
    const target = { ...clock, running: clock.running && visible && !staticPlayback }
    if (runtime.restorePhysicalClock !== undefined) latest = runtime.restorePhysicalClock(target)
    else {
      latest = runtime.setRate(target.rate)
      latest = runtime.seek(target.time)
      latest = runtime.setRunning(target.running)
    }
  }
  if (savedClock !== undefined) {
    restoreOwnedClock(savedClock)
  }
  if (buildMode === 'construct' && runtime.enterBuilder !== undefined) {
    latest = runtime.enterBuilder()
    draft ??= copy(runtime.circuitDraft?.() ?? draftFromScene(committedScene))
  } else if (runtime.enterBuilder === undefined) {
    buildMode = 'inspect'
    draft = undefined
  }

  const withAnnotations = (scene: PhysicsScene): PhysicsScene => {
    const metadata = { ...scene.metadata }
    delete metadata.experimentRelease
    if (release !== undefined) metadata.experimentRelease = release
    if (notebook.length > 0 || scene.metadata.experimentNotebook !== undefined) {
      metadata.experimentNotebook = { version: 1, entries: notebook }
    }
    return { ...scene, metadata }
  }
  committedScene = copy(withAnnotations(committedScene))
  const frameOf = (next: WorkspaceSnapshot, isPreview = false): WorkspaceFrame => {
    const frame = workspaceFrameOf(next)
    const lineage = committedScene.metadata.lineage
    const clock = staticPlayback
      ? { time: 0, total: 0, running: false, rate: next.clock.rate }
      : next.clock
    const { branch: _branch, ...withoutBranch } = frame
    return freeze({
      ...withoutBranch,
      sceneRevision: isPreview ? committedScene.revision : next.sceneRevision,
      clock,
      ...(lineage === undefined ? {} : { branch: {
        originQuestionTitle: originScene.metadata.title,
        parentRevision: lineage.parentRevision,
        canRestore: true,
      } }),
    })
  }
  const frames = createFrameSource(frameOf(latest), { onListenerError: report })
  const capabilityOf = (): WorkbenchCapabilities => ({
    parameterPreview: true,
    componentPlacement: runtime.previewComponentPlacement !== undefined && runtime.commitComponentPlacement !== undefined,
    slider: runtime.previewSliderPosition !== undefined && runtime.commitSliderPosition !== undefined,
    switch: runtime.setSwitchState !== undefined,
    construct: runtime.applyDraftEdit !== undefined && runtime.enterBuilder !== undefined,
    capture: runtime.captureRaw !== undefined,
    restoreOrigin: sceneContent(committedScene) !== sceneContent(withAnnotations(originScene)),
  })
  const makeSummary = (): WorkbenchInstanceSummary => freeze({
    instanceKey,
    sceneId: String(committedScene.id),
    ...(options.templateId === undefined ? {} : { templateId: options.templateId }),
    domain,
    source,
    buildMode,
    instanceEditRevision,
    workspace: frames.getSnapshot(),
    clock: disposed ? { ...physicalClockOf(), running: false } : previewClock ?? physicalClockOf(),
    capabilities: capabilityOf(),
    history: {
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      past: history.past.map(entry => ({ id: entry.id, label: entry.label })),
      future: history.future.map(entry => ({ id: entry.id, label: entry.label })),
    },
    ...(draft === undefined ? {} : { draft }),
    ...(pendingWire === undefined ? {} : { pendingWire }),
    notebook,
    previewing: preview !== undefined,
    visible,
    disposed,
    diagnostics,
  })
  summary = makeSummary()
  const summaries = createFrameSource(summary, { onListenerError: report })
  const getSnapshot = (): WorkbenchInstanceSummary => summary
  const subscribe = summaries.subscribe
  const publishSummary = (): WorkbenchInstanceSummary => {
    summary = makeSummary()
    summaries.set(summary)
    return summary
  }
  const publish = (next: WorkspaceSnapshot, lowFrequency = true): WorkbenchInstanceSummary => {
    latest = next
    frames.set(frameOf(next, preview !== undefined))
    return lowFrequency ? publishSummary() : summary
  }
  const serialize = (): WorkbenchCommittedState => copy({
    instanceKey,
    scene: withAnnotations(committedScene),
    originScene,
    ...(options.templateId === undefined ? {} : { templateId: options.templateId }),
    domain,
    source,
    buildMode,
    clock: staticPlayback ? { time: 0, total: 0, running: false, rate: (previewClock ?? physicalClockOf()).rate }
      : previewClock ?? physicalClockOf(),
    instanceEditRevision,
    history,
    ...(draft === undefined ? {} : { draft }),
  })
  const persist = (reason: 'commit' | 'clock' | 'mode' | 'save'): void => {
    if (disposed || preview !== undefined) return
    try { options.onPersist?.(serialize(), reason) } catch (error: unknown) { report(error) }
  }
  const notifyCommitted = (label: string): void => {
    if (disposed) return
    try { options.onCommitted?.(serialize(), label) } catch (error: unknown) { report(error) }
    persist('commit')
  }
  const stopScheduledClock = (): void => {
    clockGeneration += 1
    lastClockAt = undefined
    if (!scheduled) return
    scheduled = false
    try { scheduler?.cancel(scheduledHandle) } catch (error: unknown) { report(error) }
    scheduledHandle = undefined
  }
  const armClock = (): void => {
    if (disposed || scheduled || scheduler === null || !visible || preview !== undefined ||
      displays.size === 0 || !frames.getSnapshot().clock.running || staticPlayback) return
    const generation = clockGeneration
    scheduled = true
    try {
      scheduledHandle = scheduler.request(now => {
        if (disposed || generation !== clockGeneration) return
        scheduled = false
        scheduledHandle = undefined
        if (!visible || displays.size === 0 || preview !== undefined) { lastClockAt = undefined; return }
        const elapsed = lastClockAt === undefined ? 0 : Math.min(0.25, Math.max(0, (now - lastClockAt) / 1000))
        lastClockAt = now
        if (elapsed > 0) advance(elapsed, now)
        armClock()
      })
    } catch (error: unknown) { scheduled = false; report(error) }
  }
  const installRuntime = (scene: PhysicsScene, clock?: PlaybackClock): void => {
    stopScheduledClock()
    const previous = runtime
    runtime = requireRuntime(scene)
    try { previous.dispose?.() } catch (error: unknown) { report(error) }
    detectStaticPlayback()
    latest = runtime.getSnapshot()
    if (buildMode === 'construct' && runtime.enterBuilder !== undefined) latest = runtime.enterBuilder()
    if (clock !== undefined) {
      restoreOwnedClock(clock)
    }
    if (highlighted.length > 0) latest = runtime.setHighlight(highlighted)
  }
  const abandonPreview = (): void => {
    if (preview === undefined) return
    const kind = preview
    preview = undefined
    try { previewRuntime?.dispose?.() } catch (error: unknown) { report(error) }
    previewRuntime = undefined
    if (kind === 'parameter') runtime.cancelParameterPreview?.()
    if (kind === 'component') runtime.cancelComponentPlacement?.()
    if (kind === 'slider') runtime.cancelSliderPosition?.()
    latest = runtime.getSnapshot()
    const restoredClock = physicalClockOf()
    if (previewClock !== undefined && (restoredClock.time !== previewClock.time ||
      restoredClock.running !== previewClock.running || restoredClock.rate !== previewClock.rate)) {
      restoreOwnedClock(previewClock)
    }
    previewClock = undefined
    previewIdentity = undefined
    lastClockAt = undefined
  }
  const actionError = (code: string, message: string): WorkbenchInstanceSummary => {
    if (disposed) return summary
    diagnostics = freeze([{ code, message }])
    frames.set(frameOf(latest, preview !== undefined))
    const next = publishSummary()
    armClock()
    return next
  }
  const nextRevision = (): number => {
    const revision = committedScene.revision + 1
    if (!Number.isSafeInteger(revision)) throw new RangeError('The scene revision is exhausted.')
    return revision
  }
  const transaction = (
    label: string,
    operation: () => WorkspaceSnapshot,
    physicalFact = true,
  ): WorkbenchInstanceSummary => {
    if (disposed) return summary
    abandonPreview()
    const before = committedScene
    const beforeDraft = draft
    const beforeHistory = history
    const beforeEditRevision = instanceEditRevision
    const beforeMode = buildMode
    const beforeRelease = release
    const beforeNotebook = notebook
    const beforeClock = physicalClockOf()
    try {
      const next = operation()
      const candidate = runtime.getScene?.()
      if (candidate === undefined) throw new TypeError('The runtime lost its committed scene.')
      let after = withAnnotations(candidate)
      if (sceneContent(before) === sceneContent(after)) {
        // Some legacy adapters fork before rejecting. The failed attempt owns no revision.
        if (candidate.revision !== before.revision || String(candidate.id) !== String(before.id)) {
          installRuntime(before, beforeClock)
          draft = beforeDraft
          diagnostics = next.error === undefined ? [] : [{ code: next.error.code, message: next.error.message }]
          publish(latest)
        } else { detectStaticPlayback(); publish(next) }
        armClock()
        return summary
      }
      let mustInstall = false
      if (physicalFact && requiresExperimentalForkForFact(before)) {
        const fork = forkExperimentalScene({
          scene: before,
          sceneId: uniqueId('experiment'),
          now: new Date().toISOString() as IsoDateTime,
        })
        after = {
          ...after,
          id: fork.id,
          metadata: { ...after.metadata, ...(fork.metadata.lineage === undefined ? {} : { lineage: fork.metadata.lineage }) },
        }
        mustInstall = true
      } else if (String(after.id) !== String(before.id)) {
        after = { ...after, id: before.id }
        mustInstall = true
      }
      if (after.revision <= before.revision) {
        after = { ...after, revision: nextRevision() }
        mustInstall = true
      }
      committedScene = copy(after)
      instanceEditRevision += 1
      if (!Number.isSafeInteger(instanceEditRevision)) throw new RangeError('The instance edit revision is exhausted.')
      if (mustInstall) installRuntime(committedScene, { ...physicalClockOf(next), running: false })
      else { latest = next; detectStaticPlayback() }
      if (buildMode === 'construct') draft = copy(draft === undefined
        ? runtime.circuitDraft?.() ?? draftFromScene(committedScene)
        : synchronizeDraftWithScene(draft, committedScene))
      pendingWire = undefined
      const entry: WorkbenchHistoryEntry = copy({
        id: uniqueId('physical-edit'), label, before, after: committedScene,
        ...(beforeDraft === undefined ? {} : { beforeDraft }),
        ...(draft === undefined ? {} : { afterDraft: draft }),
      })
      history = freeze({ past: [...history.past, entry], future: [] })
      diagnostics = []
      publish(latest)
      notifyCommitted(label)
      armClock()
      return summary
    } catch (error: unknown) {
      report(error)
      committedScene = before
      draft = beforeDraft
      history = beforeHistory
      instanceEditRevision = beforeEditRevision
      buildMode = beforeMode
      release = beforeRelease
      notebook = beforeNotebook
      try { installRuntime(before, beforeClock); publish(latest) } catch (restoreError: unknown) { report(restoreError) }
      return actionError('WORKBENCH_EDIT_REJECTED', error instanceof Error ? error.message : 'The physical edit was rejected.')
    }
  }
  const parameter = (id: string, value: number): { valid: boolean; unchanged: boolean } => {
    const field = runtime.getSnapshot().inspector.flatMap(section => section.parameters ?? []).find(entry => entry.id === id)
    return {
      valid: field !== undefined && Number.isFinite(value) && (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max),
      unchanged: field !== undefined && Object.is(field.value, value),
    }
  }
  const editParameter = (id: string, value: number): WorkbenchInstanceSummary => {
    if (disposed) return summary
    abandonPreview()
    const check = parameter(id, value)
    if (!check.valid) return actionError('INVALID_PARAMETER', 'This parameter or value is not accepted by the current scene.')
    if (check.unchanged) { publish(latest); armClock(); return summary }
    return transaction(`parameter:${id}`, () => runtime.commitParameter?.(id, value) ?? runtime.editParameter(id, value))
  }
  const beginPreview = (kind: 'parameter' | 'component' | 'slider', identity: string): void => {
    if (preview !== undefined && (preview !== kind || previewIdentity !== identity)) abandonPreview()
    if (preview === undefined) previewClock = { ...physicalClockOf(runtime.getSnapshot()) }
    preview = kind
    previewIdentity = identity
    stopScheduledClock()
  }
  const previewParameter = (id: string, value: number): WorkbenchInstanceSummary => {
    if (disposed) return summary
    const check = parameter(id, value)
    if (!check.valid) return actionError('INVALID_PARAMETER', 'This parameter or value is not accepted by the current scene.')
    beginPreview('parameter', id)
    try {
      if (runtime.previewParameter !== undefined) return publish(runtime.previewParameter(id, value))
      // A transient runtime edits a copy; the committed engine and its evidence stay untouched.
      previewRuntime ??= requireRuntime(committedScene)
      return publish(previewRuntime.editParameter(id, value))
    } catch (error: unknown) { abandonPreview(); report(error); return actionError('PREVIEW_REJECTED', 'The parameter preview was rejected.') }
  }
  const cancelPreview = (): WorkbenchInstanceSummary => {
    if (disposed) return summary
    abandonPreview()
    const next = publish(latest)
    armClock()
    return next
  }
  const setChoice = (id: string, value: string): WorkbenchInstanceSummary => {
    if (disposed) return summary
    abandonPreview()
    const choice = runtime.getSnapshot().inspector.flatMap(section => section.choices ?? []).find(entry => entry.id === id)
    if (choice === undefined || !choice.options.some(option => option.value === value)) {
      return actionError('INVALID_CHOICE', 'This choice is not accepted by the current scene.')
    }
    if (choice.value === value) return publish(latest)
    return transaction(`choice:${id}`, () => runtime.setChoice(id, value))
  }
  const viewAction = (operation: () => WorkspaceSnapshot, saveClock = false): WorkbenchInstanceSummary => {
    if (disposed) return summary
    abandonPreview()
    stopScheduledClock()
    diagnostics = []
    try {
      publish(operation())
      if (saveClock) persist('clock')
      armClock()
      return summary
    } catch (error: unknown) { report(error); return actionError('WORKBENCH_ACTION_REJECTED', 'The runtime action was rejected.') }
  }
  const applyDraftEdit = (edit: (current: CircuitDraft) => CircuitDraft): WorkbenchInstanceSummary => {
    if (disposed || runtime.applyDraftEdit === undefined) return summary
    const current = draft ?? draftFromScene(committedScene)
    let next: CircuitDraft
    try {
      const transformed = edit(copy(current))
      const parsed = parseCircuitDraft(transformed)
      if (parsed === undefined) throw new TypeError('Invalid circuit authoring facts.')
      next = copy(parsed)
    } catch (error: unknown) { report(error); return actionError('INVALID_DRAFT', 'The circuit draft edit was rejected.') }
    if (JSON.stringify(current) === JSON.stringify(next)) return summary
    return transaction('circuit:draft', () => {
      buildMode = 'construct'
      runtime.enterBuilder?.()
      const frame = runtime.applyDraftEdit?.(() => next) ?? runtime.getSnapshot()
      draft = next
      // Rebuilding a circuit clears the adapter highlight; selection belongs to this instance.
      return highlighted.length === 0 ? frame : runtime.setHighlight(highlighted)
    })
  }
  const historyAction = (redo: boolean): WorkbenchInstanceSummary => {
    if (disposed) return summary
    const entry = redo ? history.future[0] : history.past.at(-1)
    if (entry === undefined) return summary
    abandonPreview()
    const before = committedScene
    const revision = nextRevision()
    const target = redo ? entry.after : entry.before
    const restored = copy({ ...structuredClone(target), id: before.id, revision })
    const beforeRelease = release
    const beforeNotebook = notebook
    const beforeHistory = history
    const beforeDraft = draft
    const beforeEditRevision = instanceEditRevision
    const beforeClock = physicalClockOf()
    try {
      release = restored.metadata.experimentRelease
      notebook = copy(readNotebook(restored))
      installRuntime(restored, { time: 0, total: 0, running: false, rate: frames.getSnapshot().clock.rate })
      committedScene = restored
      draft = buildMode === 'construct'
        ? copy((redo ? entry.afterDraft : entry.beforeDraft) ?? draftFromScene(restored))
        : undefined
      history = redo
        ? freeze({ past: [...history.past, entry], future: history.future.slice(1) })
        : freeze({ past: history.past.slice(0, -1), future: [entry, ...history.future] })
      instanceEditRevision += 1
      if (!Number.isSafeInteger(instanceEditRevision)) throw new RangeError('The instance edit revision is exhausted.')
      pendingWire = undefined
      highlighted = []
      diagnostics = []
      publish(latest)
      notifyCommitted(redo ? 'redo' : 'undo')
      return summary
    } catch (error: unknown) {
      report(error)
      committedScene = before
      release = beforeRelease
      notebook = beforeNotebook
      history = beforeHistory
      draft = beforeDraft
      instanceEditRevision = beforeEditRevision
      try { installRuntime(before, beforeClock); publish(latest) } catch (restoreError: unknown) { report(restoreError) }
      return actionError('HISTORY_RESTORE_REJECTED', 'The physical history could not be restored.')
    }
  }
  const restoreOrigin = (): WorkbenchInstanceSummary => {
    if (disposed || sceneContent(committedScene) === sceneContent(withAnnotations(originScene))) return summary
    return transaction('restore-origin', () => {
      const restored = copy(withAnnotations({ ...structuredClone(originScene), id: committedScene.id, revision: nextRevision() }))
      installRuntime(restored, { time: 0, total: 0, running: false, rate: frames.getSnapshot().clock.rate })
      return latest
    }, false)
  }
  const advance = (wallClockSeconds: number, now = scheduler?.now() ?? globalThis.performance.now()): WorkbenchInstanceSummary => {
    if (disposed || !visible || preview !== undefined || !frames.getSnapshot().clock.running || staticPlayback ||
      !Number.isFinite(wallClockSeconds) || wallClockSeconds <= 0) return summary
    const previous = frames.getSnapshot()
    try {
      const next = runtime.advance(wallClockSeconds)
      const transition = next.status !== previous.status || next.sceneRevision !== previous.sceneRevision ||
        next.clock.running !== previous.clock.running
      publish(next, transition || now - lastSummaryAt >= summaryInterval)
      if (transition || now - lastSummaryAt >= summaryInterval) lastSummaryAt = now
      if (transition || now - lastPersistAt >= 5000) { lastPersistAt = now; persist('clock') }
      return summary
    } catch (error: unknown) { report(error); stopScheduledClock(); return actionError('CLOCK_FAILED', 'The physics clock could not advance.') }
  }
  const beginWire = (ref: TerminalRef): WorkbenchInstanceSummary => {
    if (disposed || runtime.applyDraftEdit === undefined) return summary
    const current = draft ?? draftFromScene(committedScene)
    const component = current.components.find(entry => entry.id === ref.componentId)
    if (component?.nets[ref.terminalKey] === undefined) return actionError('INVALID_TERMINAL', 'This terminal is not on the circuit bench.')
    pendingWire = copy(ref)
    return publishSummary()
  }
  const completeWire = (ref: TerminalRef): WorkbenchInstanceSummary => {
    if (disposed || pendingWire === undefined) return summary
    const from = pendingWire
    const previousSummary = summary
    pendingWire = undefined
    applyDraftEdit(current => connectTerminals(current, from, ref))
    if (summary === previousSummary) publishSummary()
    return summary
  }
  const annotate = (
    action: string,
    nextRelease: PhysicsScene['metadata']['experimentRelease'],
    nextNotebook = notebook,
  ): WorkbenchInstanceSummary => {
    if (disposed) return summary
    const previousRelease = release
    const previousNotebook = notebook
    return transaction(action, () => {
      release = nextRelease
      notebook = nextNotebook
      try {
        const updated = copy(withAnnotations({ ...committedScene, revision: nextRevision() }))
        installRuntime(updated, physicalClockOf())
        return latest
      } catch (error: unknown) {
        release = previousRelease
        notebook = previousNotebook
        throw error
      }
    }, false)
  }

  const actions: WorkbenchInstanceActions = {
    editParameter,
    previewParameter,
    commitParameter: editParameter,
    cancelParameterPreview: cancelPreview,
    setChoice,
    setObservable: (key, enabled) => transaction(`observable:${key}`, () => runtime.setObservable(key, enabled), false),
    setRunning: running => viewAction(() => runtime.setRunning(running && visible && !staticPlayback), !running),
    setRate: rate => Number.isFinite(rate) && rate > 0
      ? viewAction(() => runtime.setRate(rate), true) : actionError('INVALID_RATE', 'Playback rate must be positive and finite.'),
    seek: time => Number.isFinite(time) ? viewAction(() => runtime.seek(time), true) : actionError('INVALID_TIME', 'Scene time must be finite.'),
    step: delta => Number.isFinite(delta) ? viewAction(() => runtime.step(delta), true) : actionError('INVALID_TIME', 'Scene time step must be finite.'),
    setHighlight: ids => {
      highlighted = copy(ids)
      return viewAction(() => runtime.setHighlight(highlighted))
    },
    previewComponentPlacement: (componentId, at) => {
      if (disposed || runtime.previewComponentPlacement === undefined || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return summary
      beginPreview('component', componentId)
      return publish(runtime.previewComponentPlacement(componentId, at))
    },
    commitComponentPlacement: (componentId, at) => {
      if (runtime.commitComponentPlacement === undefined || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return cancelPreview()
      const beforeTime = frames.getSnapshot().clock.time
      // Optical rail positions change imaging conditions; circuit furniture
      // positions remain presentation edits. Both still own one gesture entry.
      const result = transaction('component:placement', () => runtime.commitComponentPlacement?.(componentId, at) ?? runtime.getSnapshot(), domain === 'optics')
      if (frames.getSnapshot().clock.time !== beforeTime) persist('clock')
      return result
    },
    cancelComponentPlacement: cancelPreview,
    setSwitchState: (componentId, state) => runtime.setSwitchState === undefined ? summary
      : transaction(`switch:${componentId}`, () => runtime.setSwitchState?.(componentId, state) ?? runtime.getSnapshot()),
    previewSliderPosition: (componentId, position) => {
      if (disposed || runtime.previewSliderPosition === undefined || !Number.isFinite(position)) return summary
      beginPreview('slider', componentId)
      return publish(runtime.previewSliderPosition(componentId, Math.min(1, Math.max(0, position))))
    },
    commitSliderPosition: (componentId, position) => runtime.commitSliderPosition === undefined || !Number.isFinite(position)
      ? cancelPreview() : transaction(`slider:${componentId}`, () => runtime.commitSliderPosition?.(componentId, Math.min(1, Math.max(0, position))) ?? runtime.getSnapshot()),
    cancelSliderPosition: cancelPreview,
    enterBuilder: () => {
      if (disposed || runtime.enterBuilder === undefined) return summary
      abandonPreview()
      buildMode = 'construct'
      draft ??= copy(draftFromScene(committedScene))
      publish(runtime.enterBuilder())
      persist('mode')
      armClock()
      return summary
    },
    leaveBuilder: () => {
      if (disposed) return summary
      abandonPreview()
      buildMode = 'inspect'
      pendingWire = undefined
      draft = undefined
      publish(runtime.leaveBuilder?.() ?? runtime.getSnapshot())
      persist('mode')
      armClock()
      return summary
    },
    applyDraftEdit,
    addComponent: (type, at, params) => applyDraftEdit(current => addComponent(current, type, at, params).draft),
    addPart: (part, at) => applyDraftEdit(current => addPart(current, part, at).draft),
    removeComponent: componentId => applyDraftEdit(current => removeComponent(current, componentId)),
    moveComponent: (componentId, at) => applyDraftEdit(current => moveComponent(current, componentId, at)),
    rotateComponent: componentId => applyDraftEdit(current => rotateComponent(current, componentId)),
    setComponentParams: (componentId, params) => applyDraftEdit(current => setParams(current, componentId, params)),
    connectTerminals: (from, to) => applyDraftEdit(current => connectTerminals(current, from, to)),
    disconnectTerminal: ref => applyDraftEdit(current => disconnectTerminal(current, ref)),
    beginWire,
    completeWire,
    cancelWire: () => { if (!disposed) { pendingWire = undefined; publishSummary() } return summary },
    undo: () => historyAction(false),
    redo: () => historyAction(true),
    restoreOrigin,
    setRelease: next => {
      if (disposed || JSON.stringify(next) === JSON.stringify(release)) return summary
      return annotate('renderer-release', next === undefined ? undefined : copy(next))
    },
    recordObservation: () => {
      if (disposed || preview !== undefined || notebook.length >= NOTEBOOK_LIMIT) return summary
      const observation = captureObservation(committedScene, { ...latest, clock: physicalClockOf() })
      if (observation === undefined) return summary
      const capturedNotebook = copy([...notebook, { ...observation, ...(release === undefined ? {} : { experimentRelease: release }) }])
      return annotate('notebook:capture', release, capturedNotebook)
    },
    removeObservation: id => {
      if (disposed) return summary
      const next = notebook.filter(entry => entry.id !== id)
      if (next.length === notebook.length) return summary
      return annotate('notebook:remove', release, copy(next))
    },
    getSampleReadout: index => disposed || !Number.isSafeInteger(index) || index < 0 ? []
      : copy((previewRuntime?.getSnapshot() ?? latest).sampleReadout?.(index) ?? []),
  }
  const owner: WorkbenchInstanceRuntime = {
    ...actions,
    instanceKey, frames, frameSource: frames, summaries, actions, getSnapshot, subscribe,
    getScene: () => copy(withAnnotations(committedScene)),
    captureRaw: () => {
      if (disposed || preview !== undefined) throw new WorkspaceCaptureError('CAPTURE_UNAVAILABLE', 'CAPTURE_UNAVAILABLE: finish the gesture before capturing committed engine evidence.')
      return captureWorkspaceRuntime(runtime, withAnnotations(committedScene))
    },
    serialize,
    advance,
    attachDisplay: displayKey => {
      if (disposed) return () => undefined
      const wasDetached = displays.size === 0
      displays.add(displayKey)
      if (wasDetached) lastClockAt = undefined
      armClock()
      return () => owner.detachDisplay(displayKey)
    },
    detachDisplay: displayKey => {
      displays.delete(displayKey)
      if (displays.size === 0) stopScheduledClock()
    },
    setVisible: next => {
      if (disposed || visible === next) return summary
      visible = next
      stopScheduledClock()
      if (!visible) { abandonPreview(); latest = runtime.setRunning(false) }
      publish(latest)
      if (!visible) persist('clock')
      armClock()
      return summary
    },
    persist: () => persist('save'),
    duplicate: duplicateOptions => createWorkbenchInstanceRuntime({
      ...options,
      ...duplicateOptions,
      instanceKey: duplicateOptions?.instanceKey ?? uniqueId('instance'),
      sceneId: duplicateOptions?.sceneId ?? uniqueId('scene'),
      scene: copy(withAnnotations(committedScene)), originScene: copy(originScene), source,
      buildMode, ...(draft === undefined ? {} : { draft, persistedDraft: draft }), history, persistedHistory: history, instanceEditRevision,
      clock: { ...physicalClockOf(), running: false },
    }),
    dispose: () => {
      if (disposed) return
      disposed = true
      stopScheduledClock()
      frames.dispose(freeze({ ...frames.getSnapshot(), clock: { ...frames.getSnapshot().clock, running: false } }))
      displays.clear()
      pendingWire = undefined
      preview = undefined
      previewIdentity = undefined
      summary = makeSummary()
      summaries.dispose(summary)
      try { previewRuntime?.dispose?.() } catch (error: unknown) { report(error) }
      previewRuntime = undefined
      try { runtime.dispose?.() } catch (error: unknown) { report(error) }
    },
  }
  return owner
}
