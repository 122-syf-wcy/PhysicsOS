import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSceneObject, readInstanceSource } from '@physicsos/physics-workbench/codec'
import { copyJsonObject, freezeData } from '@physicsos/physics-workbench/json'
import type { PhysicsSceneRef } from '../surface-store.ts'
import type { CanvasBoundViewActions, CanvasCommands, CanvasIncomingSourceState, CanvasSourceActions } from './contract.ts'
import type { AddCanvasExperiment, CanvasController } from './types.ts'
import { canvasId } from './digest.ts'

/** Only command callbacks cross into presentation; observable registries remain private. */
export function canvasCallbacks(controller: CanvasController): CanvasCommands {
  return {
    appendAnnotations: controller.appendAnnotations,
    startAssistant: controller.startAssistant,
    assistantJob: controller.assistantJob,
    cancelAssistant: controller.cancelAssistant,
    replaceAnnotations: controller.replaceAnnotations,
    removeAnnotations: controller.removeAnnotations,
    create: controller.create,
    open: controller.open,
    list: controller.list,
    rename: controller.rename,
    duplicate: controller.duplicate,
    remove: controller.remove,
    restore: controller.restore,
    sync: controller.sync,
    retry: controller.retry,
    resolveConflict: controller.resolveConflict,
    useRemote: controller.useRemote,
    keepLocalCopy: controller.keepLocalCopy,
    exportGraph: controller.exportGraph,
    importGraph: controller.importGraph,
    exportDatasetCsv: controller.exportDatasetCsv,
    addExperiment: controller.addExperiment,
    duplicateInstance: controller.duplicateInstance,
    removeNodes: controller.removeNodes,
    updateLayout: controller.updateLayout,
    updateViewport: controller.updateViewport,
    renameNode: controller.renameNode,
    addNote: controller.addNote,
    updateNote: controller.updateNote,
    editNoteDraft: controller.editNoteDraft,
    flushNoteDraft: controller.flushNoteDraft,
    discardNoteDraft: controller.discardNoteDraft,
    group: controller.group,
    ungroup: controller.ungroup,
    setGroupCollapsed: controller.setGroupCollapsed,
    align: controller.align,
    distribute: controller.distribute,
    setLocked: controller.setLocked,
    layer: controller.layer,
    copyNodes: controller.copyNodes,
    pasteNodes: controller.pasteNodes,
    undo: controller.undo,
    redo: controller.redo,
    capture: controller.capture,
    renameSnapshot: controller.renameSnapshot,
    removeSnapshot: controller.removeSnapshot,
    recreateSnapshot: controller.recreateSnapshot,
    setResultView: controller.setResultView,
    addComparison: controller.addComparison,
    updateComparison: controller.updateComparison,
    setComparisonCursor: controller.setComparisonCursor,
    instanceAction: controller.instanceAction,
    attachDisplay: controller.attachDisplay,
    setDisplayVisible: controller.setDisplayVisible,
    getSampleReadout: controller.getSampleReadout,
    verifySnapshot: controller.verifySnapshot,
    verificationHistory: controller.verificationHistory,
    flush: controller.flush,
  }
}

interface HeldSource {
  readonly input: AddCanvasExperiment
  readonly source: SnapshotStore<CanvasIncomingSourceState | undefined>
  promise: Promise<{ readonly canvasId: string; readonly instanceId: string }> | undefined
  createdCanvasId: string | undefined
  canceled: boolean
  creating: Promise<string> | undefined
}
export interface CanvasEntryCallbacks extends CanvasSourceActions {
  readonly openCanvasView: (canvasId?: string) => void
  readonly newCanvas: (title: string) => Promise<string>
}
export interface CanvasEntryController {
  readonly callbacks: CanvasEntryCallbacks
  incomingSource(key: string): SnapshotStore<CanvasIncomingSourceState | undefined>
  bindViewActions(actions: CanvasBoundViewActions): () => void
  clearAccount(): void
  dispose(): void
}
export interface CanvasEntryOptions {
  readonly controller: CanvasController
  readonly openCanvas: (canvasId?: string) => void
  readonly sceneInput: (ref: PhysicsSceneRef) => AddCanvasExperiment | Promise<AddCanvasExperiment>
  readonly isCurrent?: () => boolean
  readonly id?: (prefix: string) => string
}

/** Incoming physical facts are held by this owner; the shared view store carries only their key. */
export function createCanvasEntryController(options: CanvasEntryOptions): CanvasEntryController {
  const ids = options.id ?? canvasId
  const isCurrent = options.isCurrent ?? (() => true)
  const sources = new Map<string, HeldSource>()
  const canceledCreations = new Map<string, Promise<void>>()
  const cells = new Map<string, SnapshotStore<CanvasIncomingSourceState | undefined>>()
  const views = new Set<CanvasBoundViewActions>()
  let pendingKey: string | undefined
  let disposed = false
  let accountGeneration = 0
  let selectionGeneration = 0
  let creatingCanvas: Promise<string> | undefined
  const incomingSource = (key: string): SnapshotStore<CanvasIncomingSourceState | undefined> => {
    let source = cells.get(key)
    if (source === undefined) { source = createSnapshotStore<CanvasIncomingSourceState | undefined>(undefined); cells.set(key, source) }
    return source
  }
  const publishViewKey = (key: string | undefined): void => {
    pendingKey = key
    for (const actions of views) actions.setPendingSourceKey(key)
  }
  const release = (key: string): void => {
    const held = sources.get(key)
    if (held !== undefined) { held.canceled = true; held.source.set(undefined); sources.delete(key) }
    if (pendingKey === key) publishViewKey(undefined)
  }
  const installCanvasSource = (input: AddCanvasExperiment): void => {
    if (disposed) throw new Error('CANVAS_ENTRY_DISPOSED')
    if (!isCurrent()) throw new Error('CANVAS_ACCOUNT_CHANGED')
    const scene = createSceneObject(input.scene).scene
    const origin = input.originScene === undefined ? undefined : createSceneObject(input.originScene).scene
    copyJsonObject(input)
    const safe: AddCanvasExperiment = freezeData({ ...structuredClone(input), scene, source: readInstanceSource(copyJsonObject(input.source)),
      ...(origin === undefined ? {} : { originScene: origin }),
      ...(input.metadata === undefined ? {} : { metadata: copyJsonObject(input.metadata) }) })
    if (pendingKey !== undefined) release(pendingKey)
    const key = ids('canvas-source')
    const source = incomingSource(key)
    sources.set(key, { input: safe, source, canceled: false, promise: undefined, creating: undefined, createdCanvasId: undefined })
    source.set({ key, title: input.title ?? input.source.title ?? scene.metadata.title ?? '', status: 'ready' })
    publishViewKey(key)
  }
  const add = (key: string, canvasId: string): Promise<{ readonly canvasId: string; readonly instanceId: string }> => {
    const held = sources.get(key)
    if (disposed || held === undefined || held.canceled) return Promise.reject(new Error('CANVAS_SOURCE_MISSING'))
    if (!isCurrent()) return Promise.reject(new Error('CANVAS_ACCOUNT_CHANGED'))
    if (held.promise !== undefined) return held.promise
    if (held.creating !== undefined) return held.creating.then(() => add(key, canvasId))
    const state = held.source.getSnapshot()!
    const generation = accountGeneration
    held.source.set({ ...state, status: 'adding', ...(held.createdCanvasId === undefined ? {} : { createdCanvasId: held.createdCanvasId }) })
    const promise = options.controller.addExperiment(canvasId, held.input).then(instanceId => {
      if (!disposed && !held.canceled && generation === accountGeneration && isCurrent()) {
        options.openCanvas(canvasId)
        for (const actions of views) actions.showToast('canvas.added', undefined)
        release(key)
      }
      return { canvasId, instanceId }
    }).catch(error => {
      if (!disposed && !held.canceled) held.source.set({ ...state, status: 'error',
        ...(held.createdCanvasId === undefined ? {} : { createdCanvasId: held.createdCanvasId }),
        error: error instanceof Error ? error.message : 'CANVAS_ADD_FAILED' })
      throw error
    }).finally(() => { held.promise = undefined })
    held.promise = promise
    return promise
  }
  const sourceError = (error: unknown): void => {
    if (!disposed) for (const actions of views) actions.showToast('canvas.error.import', error instanceof Error ? error.message : undefined, true)
  }
  const requestCanvasSource = (input: AddCanvasExperiment): void => {
    selectionGeneration += 1
    try { installCanvasSource(input) } catch (error) { sourceError(error) }
  }
  const requestSceneInCanvas = (ref: PhysicsSceneRef): void => {
    const generation = accountGeneration
    const selection = ++selectionGeneration
    try {
      const parsed = options.sceneInput(ref)
      if (parsed instanceof Promise) {
        void parsed.then(input => {
          if (!disposed && generation === accountGeneration && selection === selectionGeneration && isCurrent()) installCanvasSource(input)
        }).catch(error => {
          if (!disposed && generation === accountGeneration && selection === selectionGeneration && isCurrent()) sourceError(error)
        })
      } else installCanvasSource(parsed)
    } catch (error) { sourceError(error) }
  }
  const callbacks: CanvasEntryCallbacks = {
    requestCanvasSource,
    requestSceneInCanvas,
    addPendingCanvasSource: add,
    addPendingToNewCanvas: async (key, title) => {
      const generation = accountGeneration
      const held = sources.get(key)
      if (disposed || held === undefined || held.canceled) throw new Error('CANVAS_SOURCE_MISSING')
      if (!isCurrent()) throw new Error('CANVAS_ACCOUNT_CHANGED')
      if (held.promise !== undefined) return held.promise
      if (held.createdCanvasId === undefined) {
        if (held.creating === undefined) {
          const state = held.source.getSnapshot()!
          held.source.set({ ...state, status: 'adding' })
          held.creating = options.controller.create(title).then(canvasId => {
            held.createdCanvasId = canvasId
            return canvasId
          }).catch(error => {
            if (!disposed && !held.canceled) held.source.set({ ...state, status: 'error', error: error instanceof Error ? error.message : 'CANVAS_CREATE_FAILED' })
            throw error
          }).finally(() => { held.creating = undefined })
        }
        await held.creating
      }
      if (disposed || held.canceled) {
        if (held.createdCanvasId !== undefined && generation === accountGeneration && isCurrent()) {
          let removing = canceledCreations.get(held.createdCanvasId)
          if (removing === undefined) {
            removing = options.controller.remove(held.createdCanvasId)
            canceledCreations.set(held.createdCanvasId, removing)
          }
          await removing
        }
        throw new Error('CANVAS_SOURCE_MISSING')
      }
      if (held.createdCanvasId === undefined) throw new Error('CANVAS_SOURCE_MISSING')
      return add(key, held.createdCanvasId)
    },
    cancelPendingCanvasSource: key => { selectionGeneration += 1; release(key) },
    openCanvasView: options.openCanvas,
    newCanvas: title => {
      if (disposed || !isCurrent()) return Promise.reject(new Error('CANVAS_ACCOUNT_CHANGED'))
      if (creatingCanvas !== undefined) return creatingCanvas
      const generation = accountGeneration
      const creation = (async () => {
        try {
          if (disposed || !isCurrent()) throw new Error('CANVAS_ACCOUNT_CHANGED')
          const id = await options.controller.create(title)
          if (!disposed && generation === accountGeneration && isCurrent()) {
            options.openCanvas(id)
            for (const actions of views) actions.showToast('canvas.created', undefined)
          }
          return id
        } catch (error) {
          if (!disposed && generation === accountGeneration && isCurrent()) for (const actions of views) actions.showToast('canvas.error.generic', error instanceof Error ? error.message : undefined, true)
          throw error
        }
      })()
      creatingCanvas = creation
      void creation.finally(() => { if (creatingCanvas === creation) creatingCanvas = undefined }).catch(() => undefined)
      return creation
    },
  }
  return {
    callbacks, incomingSource,
    bindViewActions: actions => {
      views.add(actions)
      actions.setPendingSourceKey(pendingKey)
      return () => { views.delete(actions) }
    },
    clearAccount: () => {
      accountGeneration += 1
      selectionGeneration += 1
      creatingCanvas = undefined
      for (const key of sources.keys()) release(key)
      publishViewKey(undefined)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      selectionGeneration += 1
      creatingCanvas = undefined
      for (const key of [...sources.keys()]) release(key)
      for (const source of cells.values()) source.set(undefined)
      views.clear()
    },
  }
}
