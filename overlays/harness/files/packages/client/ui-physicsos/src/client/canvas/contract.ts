import type { Node, NodeProps } from '@xyflow/react'
import type {
  FactoryComponentPropsOf,
  FactoryLocalComponentPropsOf,
  InjectFace,
  PropsLocale,
  PropsStore,
  PropsRenderFactories,
  PropsRuntime,
  FactoryInjectParams,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { AddCanvasExperiment, CanvasController, CanvasDocumentState, CanvasNoteDraftState, CanvasObservable, CanvasRosterState } from './types.ts'
import type { PhysicsSceneRef } from '../surface-store.ts'
import type { WorkbenchInstanceSummary } from '../physics/workbench-instance-runtime.ts'
import type { WorkspaceFrame } from '../physics/workspace-runtime.ts'
import type { PhysicsSurfaceState, RecentExperimentsState } from '../surface-store.ts'
import type { LearningRecordState } from '../learning-record-store.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { createCanvasViewStore } from './view-store.ts'
import type { CanvasNativeAction, CanvasRendererState } from './renderer-controller.ts'

export type CanvasFlowKind = 'experiment' | 'result' | 'note' | 'comparison' | 'group'
export type CanvasFlowNode = Node<{ canvasId: string; nodeId: string }, CanvasFlowKind>
export type CanvasViewStore = ReturnType<typeof createCanvasViewStore>
export type CanvasBoundViewActions = FactoryInjectParams<'physicsos.canvas.workbench'>[0]

/** The rendering layer receives commands, not the model or its runtime registry. */
export type CanvasCommands = Pick<CanvasController,
  | 'create' | 'open' | 'list' | 'rename' | 'duplicate' | 'remove' | 'restore'
  | 'sync' | 'retry' | 'resolveConflict' | 'useRemote' | 'keepLocalCopy' | 'exportGraph' | 'importGraph'
  | 'exportDatasetCsv' | 'addExperiment' | 'duplicateInstance' | 'removeNodes'
  | 'updateLayout' | 'updateViewport' | 'renameNode' | 'addNote' | 'updateNote'
  | 'group' | 'ungroup' | 'setGroupCollapsed' | 'align' | 'distribute' | 'setLocked'
  | 'editNoteDraft' | 'flushNoteDraft' | 'discardNoteDraft'
  | 'layer' | 'copyNodes' | 'pasteNodes' | 'undo' | 'redo' | 'capture'
  | 'renameSnapshot' | 'removeSnapshot' | 'recreateSnapshot' | 'setResultView'
  | 'addComparison' | 'updateComparison' | 'setComparisonCursor' | 'instanceAction' | 'attachDisplay'
  | 'setDisplayVisible' | 'flush' | 'getSampleReadout' | 'verifySnapshot' | 'verificationHistory'
>

export interface CanvasIncomingSourceState {
  readonly key: string
  readonly title: string
  readonly status: 'ready' | 'adding' | 'error'
  readonly createdCanvasId?: string
  readonly error?: string
}
export interface CanvasSourceActions {
  readonly requestCanvasSource: (input: AddCanvasExperiment) => void
  readonly requestSceneInCanvas: (ref: PhysicsSceneRef) => void
  readonly addPendingCanvasSource: (key: string, canvasId: string) => Promise<{ readonly canvasId: string; readonly instanceId: string }>
  readonly addPendingToNewCanvas: (key: string, title: string) => Promise<{ readonly canvasId: string; readonly instanceId: string }>
  readonly cancelPendingCanvasSource: (key: string) => void
}

export interface CanvasInjected extends CanvasSourceActions {
  readonly hooks: {
    readonly canvasRoster: CanvasObservable<CanvasRosterState>
    readonly physicsSurface: SnapshotStore<PhysicsSurfaceState>
    readonly canvasRecent: SnapshotStore<RecentExperimentsState>
    readonly canvasLearning: SnapshotStore<LearningRecordState>
  }
  readonly keyedHooks: {
    readonly canvasDocument: (key: string) => CanvasObservable<CanvasDocumentState> | undefined
    readonly canvasNoteDraft: (key: string) => CanvasObservable<CanvasNoteDraftState | undefined> | undefined
    readonly canvasInstance: (key: string) => CanvasObservable<WorkbenchInstanceSummary | undefined>
    readonly canvasFrame: (key: string) => CanvasObservable<WorkspaceFrame | undefined>
    readonly canvasIncomingSource: (key: string) => CanvasObservable<CanvasIncomingSourceState | undefined>
    readonly canvasRenderer: (key: string) => CanvasObservable<CanvasRendererState>
  }
  readonly canvasCommands: CanvasCommands
  readonly canvasInstanceKey: (canvasId: string, instanceId: string) => string
  readonly openCanvasView: (canvasId?: string) => void
  readonly returnToExperiments: () => void
  readonly getCanvasReadout: (instanceKey: string, index: number) => readonly { label: string; value: string }[]
  readonly openCanvasInstanceInLab: (canvasId: string, instanceId: string, signal?: AbortSignal) => Promise<void>
  readonly attachCanvasRenderer: (canvasId: string, instanceId: string, key: string, display: string) => () => void
  readonly retryCanvasRenderer: (key: string) => void
  readonly applyCanvasRendererIntent: (key: string, display: string, value: unknown) => Promise<boolean>
  readonly cancelCanvasRendererPreview: (key: string, display: string) => void
  readonly applyCanvasNativeAction: CanvasNativeAction
  readonly ownsCanvasNativePreview: (key: string, display: string) => boolean
}

export type CanvasSurfaceProps = PropsRuntime<'main'> & PropsRenderFactories & PropsLocale<'physicsos'> & PropsStore<CanvasViewStore> & InjectFace<CanvasInjected>
export type CanvasOverlayProps = PropsRuntime<'shell.overlay'> & PropsRenderFactories & PropsLocale<'physicsos'> & PropsStore<CanvasViewStore> & InjectFace<CanvasInjected>
export type CanvasWorkbenchProps = FactoryComponentPropsOf<'physicsos.canvas.workbench'>
export type CanvasNodeProps<K extends CanvasFlowKind = CanvasFlowKind> = FactoryLocalComponentPropsOf<'physicsos.canvas.workbench', K>
export type CanvasInstanceProps = FactoryComponentPropsOf<'physicsos.canvas.instance'>
export type CanvasFrameProps = PropsRuntime<'physicsos.canvas.frame'> & PropsLocale<'physicsos'> & PropsStore<CanvasViewStore> & InjectFace<CanvasInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'physicsos.canvas.workbench': {
      scope: 'root'
      props: { readonly canvasId: string }
      store: CanvasViewStore
      inject: CanvasInjected
      locale: 'physicsos'
      slots: {
        experiment: { scope: 'root'; props: NodeProps<CanvasFlowNode> }
        result: { scope: 'root'; props: NodeProps<CanvasFlowNode> }
        note: { scope: 'root'; props: NodeProps<CanvasFlowNode> }
        comparison: { scope: 'root'; props: NodeProps<CanvasFlowNode> }
        group: { scope: 'root'; props: NodeProps<CanvasFlowNode> }
      }
    }
    'physicsos.canvas.instance': {
      scope: 'root'
      props: {
        readonly canvasId: string
        readonly instanceId: string
        readonly instanceKey: string
        readonly presentation: 'card' | 'focus'
      }
      store: CanvasViewStore
      inject: CanvasInjected
      locale: 'physicsos'
      children: { 'physicsos.canvas.frame': { kind: 'single'; scope: 'root' } }
    }
  }
  interface SlotMap {
    'physicsos.canvas.frame': {
      kind: 'single'
      scope: 'root'
      owner: { readonly canvasId: string; readonly instanceId: string; readonly instanceKey: string; readonly displayKey: string; readonly presentation?: 'card' | 'focus' }
    }
  }
}
