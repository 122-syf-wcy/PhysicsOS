import type { PhysicsScene } from '@physicsos/physics-scene'
import type { CanvasHead } from '@physicsos/physics-workbench/protocol'
import type {
  AxisDescriptor, BuildMode, CanvasFile, CanvasGraph, CanvasLayout, CanvasManifest, CanvasNode,
  CanvasViewport, ComparisonConfig, InstanceSource, JsonObject, MergeConflict,
  RendererReleaseIdentity, SnapshotAlias, TemplateReleaseIdentity, WorkbenchObject,
} from '@physicsos/physics-workbench/types'
import type {
  CreateWorkbenchInstanceOptions, WorkbenchInstanceActions, WorkbenchInstanceRuntime,
  WorkbenchInstanceSummary,
} from '../physics/workbench-instance-runtime.ts'
import type { WorkspaceFrame } from '../physics/workspace-runtime.ts'
import type { CanvasApi, CanvasListQuery, CanvasVerificationResponse } from './api.ts'
import type { CanvasPersistence } from './persistence.ts'
import type { GraphLimits } from '@physicsos/physics-workbench/graph'

/** Observable values are business data; React bindings are supplied by HarnessClient slots. */
export interface CanvasObservable<T> {
  getSnapshot(this: void): T
  subscribe(this: void, listener: () => void): () => void
}

export interface CanvasAccount {
  readonly id: string
  readonly schoolId: string
  readonly username: string
}
export interface CanvasClientError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly status?: number
}
/** A qualified owner identity; callers capture the document namespace before leaving a view. */
export const canvasNoteDraftKey = (namespace: string, canvasId: string, nodeId: string): string =>
  JSON.stringify([namespace, canvasId, 'note', nodeId])
export interface CanvasNoteDraftState {
  readonly body: string
  readonly format: 'plain' | 'markdown'
  readonly revision: number
  readonly dirty: boolean
  readonly saving: boolean
  readonly conflict: boolean
  readonly error?: CanvasClientError
}
export interface CanvasComparisonCursor {
  readonly axisIdentity: string
  readonly axisId: string
  readonly coordinate: number
}
/** Cursor coordinates are reusable only on the same semantic and displayed axis. */
export const canvasComparisonAxisSignature = (axis: AxisDescriptor): string => JSON.stringify({ identity: axis.identity,
  kind: axis.kind, dimension: axis.dimension, unit: axis.unit, origin: { kind: axis.origin.kind,
    reference: axis.origin.reference, value: { value: axis.origin.value.value, unit: axis.origin.value.unit, dimension: axis.origin.value.dimension } } })
export type CanvasSaveStatus =
  | 'loading' | 'unsaved' | 'saving-local' | 'local-saved' | 'syncing'
  | 'saved' | 'conflict' | 'error' | 'auth-required' | 'deleted'

export interface CanvasDocumentSummary {
  readonly id: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly deleted: boolean
  readonly head?: CanvasHead
  readonly status: CanvasSaveStatus
}
export interface CanvasRosterState {
  readonly items: readonly CanvasHead[]
  /** Includes durable offline documents which do not yet have a server head. */
  readonly documents: readonly CanvasDocumentSummary[]
  readonly loading: boolean
  readonly namespace?: string
  readonly authScope: 'anonymous' | 'authenticated' | 'paused'
  readonly error?: CanvasClientError
}
export interface CanvasDocumentState {
  readonly canvasId: string
  readonly namespace?: string
  readonly manifest?: CanvasManifest
  readonly objects: Readonly<Record<string, WorkbenchObject>>
  readonly head?: CanvasHead
  readonly loading: boolean
  readonly status: CanvasSaveStatus
  readonly localSaved: boolean
  readonly savedAt?: string
  readonly editSequence: number
  readonly acknowledgedSequence: number
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly conflicts: readonly MergeConflict[]
  readonly noteDrafts?: Readonly<Record<string, CanvasNoteDraftState>>
  readonly error?: CanvasClientError
}

export interface AddCanvasExperiment {
  readonly scene: PhysicsScene
  readonly originScene?: PhysicsScene
  readonly templateId?: string
  readonly templateRelease?: TemplateReleaseIdentity
  readonly source: InstanceSource
  readonly title?: string
  readonly buildMode?: BuildMode
  readonly rendererRelease?: RendererReleaseIdentity
  readonly layout?: Partial<CanvasLayout>
  readonly metadata?: JsonObject
}
export interface CanvasNodePatch {
  readonly id: string
  readonly layout?: Partial<CanvasLayout>
  readonly title?: string
  readonly locked?: boolean
  /** null removes a parent; undefined leaves it unchanged. */
  readonly groupId?: string | null
}
export interface CanvasNoteInput {
  readonly body?: string
  readonly title?: string
  readonly format?: 'plain' | 'markdown'
  readonly layout?: Partial<CanvasLayout>
}
export interface CanvasCaptureResult {
  readonly alias: SnapshotAlias
  readonly node: Extract<CanvasNode, { readonly kind: 'result' }>
}
export type CanvasComparisonInput = Omit<ComparisonConfig, 'id'> & { readonly id?: string }
export type CanvasComparisonPatch = Partial<Omit<ComparisonConfig, 'id'>>
export type CanvasAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type CanvasDistribution = 'horizontal' | 'vertical'
export type CanvasLayerOperation = 'front' | 'back' | 'forward' | 'backward'
export type CanvasRuntimeFactory = (options: CreateWorkbenchInstanceOptions) => Promise<WorkbenchInstanceRuntime>
export type CanvasInstanceActionName = keyof WorkbenchInstanceActions
export type CanvasInstanceActionArguments<K extends CanvasInstanceActionName> = Parameters<WorkbenchInstanceActions[K]>
export type CanvasInstanceActionResult<K extends CanvasInstanceActionName> = ReturnType<WorkbenchInstanceActions[K]>

/** Timers and lifecycle notifications can be supplied without importing a browser or engine. */
export interface CanvasEnvironment {
  readonly now?: () => string
  readonly id?: (prefix: string) => string
  readonly hash?: (value: unknown) => Promise<string>
  readonly online?: () => boolean
  readonly schedule?: (callback: () => void, milliseconds: number) => unknown
  readonly cancel?: (handle: unknown) => void
  readonly window?: Window | null
  readonly document?: Document | null
  readonly channel?: ((name: string) => BroadcastChannel) | null
}
export interface CanvasControllerOptions extends CanvasEnvironment {
  /** Conservative offline/anonymous fallback; authenticated scopes resolve and cache the Host policy. */
  readonly graphLimits?: Partial<GraphLimits>
  readonly api: CanvasApi
  readonly persistence: CanvasPersistence
  readonly getAccount: () => CanvasAccount | undefined
  /** The caller lazy-loads the workspace module; the controller never imports engine values. */
  readonly createRuntime: CanvasRuntimeFactory
  readonly onError?: (error: unknown) => void
}

export interface CanvasController {
  readonly state: CanvasObservable<CanvasRosterState>
  getSnapshot(this: void): CanvasRosterState
  subscribe(this: void, listener: () => void): () => void
  documentSource(canvasId: string): CanvasObservable<CanvasDocumentState>
  instanceKey(canvasId: string, instanceId: string): string
  instanceSource(instanceKey: string): CanvasObservable<WorkbenchInstanceSummary | undefined>
  frameSource(instanceKey: string): CanvasObservable<WorkspaceFrame | undefined>
  /** Explicitly refresh the cookie-account scope after same-tab authentication changes. */
  refreshAccount(): Promise<void>
  list(query?: CanvasListQuery): Promise<readonly CanvasDocumentSummary[]>
  open(canvasId: string): Promise<CanvasDocumentState>
  create(title: string): Promise<string>
  rename(canvasId: string, title: string): Promise<void>
  duplicate(canvasId: string, title?: string): Promise<string>
  remove(canvasId: string): Promise<void>
  restore(canvasId: string): Promise<void>
  sync(canvasId?: string): Promise<void>
  retry(canvasId?: string): Promise<void>
  resolveConflict(canvasId: string, manifest: CanvasManifest): Promise<void>
  useRemote(canvasId: string): Promise<void>
  keepLocalCopy(canvasId: string, title?: string): Promise<string>
  exportGraph(canvasId: string): Promise<CanvasFile>
  importGraph(input: unknown, title?: string): Promise<string>
  exportDatasetCsv(canvasId: string, datasetDigests: readonly string[]): Promise<string>
  addExperiment(canvasId: string, input: AddCanvasExperiment): Promise<string>
  duplicateInstance(canvasId: string, instanceId: string): Promise<string>
  removeNodes(canvasId: string, nodeIds: readonly string[]): Promise<void>
  updateLayout(canvasId: string, patches: readonly CanvasNodePatch[]): Promise<void>
  updateViewport(canvasId: string, viewport: CanvasViewport): Promise<void>
  renameNode(canvasId: string, nodeId: string, title: string): Promise<void>
  addNote(canvasId: string, input?: CanvasNoteInput): Promise<string>
  updateNote(canvasId: string, nodeId: string, body: string, format?: 'plain' | 'markdown'): Promise<void>
  noteDraftSource(noteKey: string): CanvasObservable<CanvasNoteDraftState | undefined>
  editNoteDraft(noteKey: string, draft: { readonly body: string; readonly format: 'plain' | 'markdown' }): void
  flushNoteDraft(noteKey: string): Promise<void>
  discardNoteDraft(noteKey: string): void
  group(canvasId: string, nodeIds: readonly string[], title?: string): Promise<string>
  ungroup(canvasId: string, groupIds: readonly string[]): Promise<void>
  setGroupCollapsed(canvasId: string, groupId: string, collapsed: boolean): Promise<void>
  align(canvasId: string, nodeIds: readonly string[], alignment: CanvasAlignment): Promise<void>
  distribute(canvasId: string, nodeIds: readonly string[], direction: CanvasDistribution): Promise<void>
  setLocked(canvasId: string, nodeIds: readonly string[], locked: boolean): Promise<void>
  layer(canvasId: string, nodeIds: readonly string[], operation: CanvasLayerOperation): Promise<void>
  copyNodes(canvasId: string, nodeIds: readonly string[]): Promise<void>
  pasteNodes(canvasId: string, offset?: { readonly x: number; readonly y: number }): Promise<readonly string[]>
  undo(canvasId: string): Promise<void>
  redo(canvasId: string): Promise<void>
  capture(canvasId: string, instanceId: string, title?: string): Promise<CanvasCaptureResult>
  verifySnapshot(canvasId: string, aliasId: string): Promise<CanvasVerificationResponse>
  verificationHistory(canvasId: string, aliasId: string): Promise<readonly CanvasVerificationResponse[]>
  /** Event-handler getter only; renderer reads frames through the framework keyed source. */
  getSampleReadout(instanceKey: string, index: number): readonly { readonly label: string; readonly value: string }[]
  renameSnapshot(canvasId: string, aliasId: string, title: string): Promise<void>
  removeSnapshot(canvasId: string, aliasId: string): Promise<void>
  recreateSnapshot(canvasId: string, aliasId: string): Promise<string>
  setResultView(canvasId: string, nodeId: string, view: 'scene' | 'table' | 'chart' | 'summary', metricIds?: readonly string[]): Promise<void>
  addComparison(canvasId: string, config: CanvasComparisonInput): Promise<string>
  updateComparison(canvasId: string, comparisonId: string, patch: CanvasComparisonPatch): Promise<void>
  setComparisonCursor(canvasId: string, comparisonId: string, cursor: CanvasComparisonCursor): Promise<void>
  instanceAction<K extends CanvasInstanceActionName>(instanceKey: string, action: K, ...args: CanvasInstanceActionArguments<K>): Promise<CanvasInstanceActionResult<K>>
  attachDisplay(instanceKey: string, displayKey: string): () => void
  /** Invisible displays detach only their rAF claim; any visible sibling keeps the same owner active. */
  setDisplayVisible(instanceKey: string, displayKey: string, visible: boolean): void
  detachDisplay(instanceKey: string, displayKey: string): void
  setVisible(visible: boolean): void
  /** Wait for every queued local write; rejection means the draft is not durably saved. */
  flush(canvasId?: string): Promise<void>
  dispose(): Promise<void>
}

export interface CanvasClipboard {
  readonly namespace: string
  readonly graph: CanvasGraph
}
