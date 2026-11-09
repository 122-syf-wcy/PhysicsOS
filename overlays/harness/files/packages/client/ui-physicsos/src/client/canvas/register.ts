import type { ClientContext } from '../runtime-compat.ts'
import type { AuthController } from '../auth-store.ts'
import type { LearningRecordController } from '../learning-record-store.ts'
import type { PhysicsSurfaceController, PhysicsSceneRef } from '../surface-store.ts'
import { sceneRefOf } from '../surface-store.ts'
import type { CanvasController, AddCanvasExperiment } from './types.ts'
import type { CanvasBoundViewActions, CanvasInjected } from './contract.ts'
import { canvasCallbacks, createCanvasEntryController, type CanvasEntryCallbacks } from './callbacks.ts'
import { createCanvasViewStore } from './view-store.ts'
import { createCanvasRendererController } from './renderer-controller.ts'
import { createSceneObject, readInstanceSource } from '@physicsos/physics-workbench/codec'
import { copyJsonObject, record, text } from '@physicsos/physics-workbench/json'
import { canvasId } from './digest.ts'
import { loadWorkspaceModule } from '../optional-modules.ts'
import {
  OptionalCanvasSurface, OptionalCanvasWorkspace, OptionalCanvasInstance,
  OptionalCanvasFrame, OptionalCanvasOverlay,
} from '../optional-surfaces.tsx'

/** A scene handover retains source conditions and annotations without inventing another physical result. */
export function canvasExperimentOf(ref: PhysicsSceneRef): AddCanvasExperiment {
  const scene = createSceneObject(ref.scene).scene
  const origin = ref.originScene === undefined ? undefined : createSceneObject(ref.originScene).scene
  const release = scene.metadata.experimentRelease
  const metadata = copyJsonObject(scene.metadata)
  const visualization = metadata.questionCodeVisualization === undefined ? undefined
    : record(metadata.questionCodeVisualization, '/scene/metadata/questionCodeVisualization')
  const questionCode = visualization?.status === 'ready' || visualization?.status === 'generating' || visualization?.status === 'failed'
  const artifactId = visualization?.artifactId === undefined ? undefined : text(visualization.artifactId, '/scene/metadata/questionCodeVisualization/artifactId', true)
  const questionId = scene.metadata.sourceQuestionId ?? scene.metadata.lineage?.originQuestionId
  const source = ref.canvasSource === undefined ? readInstanceSource(copyJsonObject({
    kind: questionCode ? 'question-code' : questionId !== undefined ? 'question' : release !== undefined && release.kind !== 'official' ? 'community'
      : ref.buildMode === true ? 'free-build' : 'import',
    id: ref.sceneId,
    ...(questionId === undefined ? {} : { questionId }),
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(scene.metadata.title === undefined ? {} : { title: scene.metadata.title }),
    ...(release === undefined ? {} : { release }),
    metadata: { handover: 'physics-scene', sourceSceneId: ref.sceneId,
      ...(questionCode && visualization !== undefined ? { questionCodeVisualization: copyJsonObject(visualization) } : {}),
      ...(ref.hasVerifiedSolution === undefined ? {} : { hasVerifiedSolution: ref.hasVerifiedSolution }) },
  })) : readInstanceSource(copyJsonObject({ ...ref.canvasSource,
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(release === undefined ? {} : { release }),
    metadata: { ...(ref.canvasSource.metadata ?? {}), handover: 'physics-scene', sourceSceneId: ref.sceneId,
      ...(ref.hasVerifiedSolution === undefined ? {} : { hasVerifiedSolution: ref.hasVerifiedSolution }),
      ...(questionCode && visualization !== undefined ? { questionCodeVisualization: copyJsonObject(visualization) } : {}) },
  }))
  return { scene, source,
    ...(ref.canvasTemplateId === undefined ? {} : { templateId: text(ref.canvasTemplateId, '/scene/templateId', true) }),
    ...(ref.canvasTemplateRelease === undefined ? {} : { templateRelease: ref.canvasTemplateRelease }), ...(origin === undefined ? {} : { originScene: origin }),
    ...(scene.metadata.title === undefined ? {} : { title: scene.metadata.title }),
    ...(release === undefined ? {} : { rendererRelease: release }),
    buildMode: ref.buildMode === true ? 'construct' : 'inspect' }
}

/** Factory definitions, ordinary panes, and overlays share one view handle and one controller. */
export function registerCanvasViews(
  ctx: ClientContext,
  controller: CanvasController,
  surface: PhysicsSurfaceController,
  auth: AuthController,
  learningRecord: LearningRecordController,
): CanvasEntryCallbacks {
  const view = createCanvasViewStore()
  const renderers = createCanvasRendererController(controller, window.location.origin)
  const boundViews = new Map<CanvasBoundViewActions, () => void>()
  const announce = async <T>(operation: () => Promise<T>, success: import('../locales.ts').PhysicsosKey): Promise<T> => {
    const namespace = controller.getSnapshot().namespace
    try {
      const result = await operation()
      if (controller.getSnapshot().namespace === namespace && controller.getSnapshot().authScope !== 'paused') {
        for (const actions of boundViews.keys()) actions.showToast(success, undefined)
      }
      return result
    } catch (error) {
      if (controller.getSnapshot().namespace === namespace && controller.getSnapshot().authScope !== 'paused') {
        for (const actions of boundViews.keys()) actions.showToast('canvas.error.generic', error instanceof Error ? error.message : undefined, true)
      }
      throw error
    }
  }
  const commands = {
    ...canvasCallbacks(controller),
    create: (title: string) => announce(() => controller.create(title), 'canvas.created'),
    rename: (canvasId: string, title: string) => announce(() => controller.rename(canvasId, title), 'canvas.renamed'),
    duplicate: (canvasId: string, title?: string) => announce(() => controller.duplicate(canvasId, title), 'canvas.copied'),
    remove: (canvasId: string) => announce(() => controller.remove(canvasId), 'canvas.deleted'),
    restore: (canvasId: string) => announce(() => controller.restore(canvasId), 'canvas.restored'),
    importGraph: (input: unknown, title?: string) => announce(() => controller.importGraph(input, title), 'canvas.imported'),
  }
  const isCurrent = (): boolean => {
    const account = auth.store.getSnapshot()
    const roster = controller.getSnapshot()
    if (roster.authScope === 'paused') return false
    return account.status !== 'authed' || account.user !== undefined &&
      roster.namespace === `${encodeURIComponent(account.user.id)}|${encodeURIComponent(account.user.schoolId)}`
  }
  const resolveSceneInput = async (ref: PhysicsSceneRef): Promise<AddCanvasExperiment> => {
    const input = canvasExperimentOf(ref)
    if (ref.canvasTemplateId !== undefined || input.source.kind !== 'import') return input
    const module = await loadWorkspaceModule()
    const templateId = module.artTemplateIdOfSceneId(ref.sceneId)
    return templateId === undefined ? input : { ...input, templateId,
      source: { ...input.source, kind: 'template', id: templateId,
        metadata: { ...(input.source.metadata ?? {}), restoredTemplateSceneId: ref.sceneId } } }
  }
  const entry = createCanvasEntryController({ controller, openCanvas: canvasId => { surface.openCanvas(canvasId) }, sceneInput: resolveSceneInput, isCurrent })
  const bind = (actions: CanvasBoundViewActions): void => {
    if (!boundViews.has(actions)) boundViews.set(actions, entry.bindViewActions(actions))
  }
  // Catalogs and source choosers have no selected document; the framework owns the absent source.
  const documentSource = (id: string) => id === '' ? undefined : controller.documentSource(id)
  const noteDraftSource = (key: string) => key === '' ? undefined : controller.noteDraftSource(key)
  const instanceSource = (key: string) => controller.instanceSource(key)
  const frameSource = (key: string) => controller.frameSource(key)
  const incomingSource = (key: string) => entry.incomingSource(key)
  const openCanvasInstanceInLab = async (canvas: string, instanceId: string, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw new DOMException('The lab copy action was canceled.', 'AbortError')
    const namespace = controller.getSnapshot().namespace
    if (controller.getSnapshot().authScope === 'paused') throw new Error('CANVAS_ACCOUNT_CHANGED')
    await controller.flush(canvas)
    if (signal?.aborted) throw new DOMException('The lab copy action was canceled.', 'AbortError')
    if (surface.store.getSnapshot().surface !== 'canvas' || surface.store.getSnapshot().canvasId !== canvas) throw new Error('CANVAS_VIEW_CHANGED')
    if (controller.getSnapshot().namespace !== namespace || controller.getSnapshot().authScope === 'paused') throw new Error('CANVAS_ACCOUNT_CHANGED')
    const document = controller.documentSource(canvas).getSnapshot()
    const instance = document.manifest?.instances.find(item => item.instanceId === instanceId)
    const current = instance === undefined ? undefined : document.objects[instance.currentScene.digest]
    const origin = instance === undefined ? undefined : document.objects[instance.originScene.digest]
    if (instance === undefined || current?.kind !== 'scene' || origin?.kind !== 'scene') throw new Error('CANVAS_INSTANCE_MISSING')
    const ownedId = canvasId('lab-copy')
    const scene = createSceneObject({ ...copyJsonObject(current.scene), id: ownedId, revision: 0 }).scene
    surface.open('lab', sceneRefOf({ sceneId: ownedId, scene, originScene: origin.scene, canvasSource: instance.source,
      ...(typeof instance.source.metadata?.hasVerifiedSolution === 'boolean' ? { hasVerifiedSolution: instance.source.metadata.hasVerifiedSolution } : {}),
      ...(instance.templateId === undefined ? {} : { canvasTemplateId: instance.templateId }),
      ...(instance.templateRelease === undefined ? {} : { canvasTemplateRelease: instance.templateRelease }),
      ...(instance.buildMode === 'construct' ? { buildMode: true } : {}) }))
  }
  const injected = (actions: CanvasBoundViewActions): CanvasInjected => {
    if (actions !== undefined) bind(actions)
    return {
      hooks: { canvasRoster: controller.state, physicsSurface: surface.store,
        canvasRecent: surface.recent, canvasLearning: learningRecord.store },
      keyedHooks: { canvasDocument: documentSource, canvasNoteDraft: noteDraftSource, canvasInstance: instanceSource, canvasFrame: frameSource,
        canvasIncomingSource: incomingSource, canvasRenderer: renderers.source },
      canvasCommands: commands,
      requestCanvasSource: entry.callbacks.requestCanvasSource,
      requestSceneInCanvas: entry.callbacks.requestSceneInCanvas,
      addPendingCanvasSource: entry.callbacks.addPendingCanvasSource,
      addPendingToNewCanvas: entry.callbacks.addPendingToNewCanvas,
      cancelPendingCanvasSource: entry.callbacks.cancelPendingCanvasSource,
      canvasInstanceKey: (canvasId, instanceId) => controller.instanceKey(canvasId, instanceId),
      openCanvasView: entry.callbacks.openCanvasView,
      returnToExperiments: () => { surface.openExperimentPicker() },
      getCanvasReadout: (instanceKey, index) => controller.getSampleReadout(instanceKey, index),
      openCanvasInstanceInLab,
      attachCanvasRenderer: renderers.attach,
      retryCanvasRenderer: renderers.refresh,
      applyCanvasRendererIntent: renderers.applyIntent,
      cancelCanvasRendererPreview: renderers.releasePreview,
      applyCanvasNativeAction: renderers.nativeAction,
      ownsCanvasNativePreview: renderers.ownsPreview,
    }
  }
  ctx.effect(() => {
    let disposed = false
    let owner = JSON.stringify({ id: auth.store.getSnapshot().user?.id, schoolId: auth.store.getSnapshot().user?.schoolId,
      username: auth.store.getSnapshot().user?.username })
    const refresh = (): void => {
      const state = auth.store.getSnapshot()
      const current = JSON.stringify({ id: state.user?.id, schoolId: state.user?.schoolId, username: state.user?.username })
      if (current !== owner) { owner = current; entry.clearAccount() }
      if (!disposed) void controller.refreshAccount().catch(() => undefined)
    }
    const stop = auth.store.subscribe(refresh)
    const onStorage = (event: StorageEvent): void => { if (event.key === 'physicsos.auth.user') entry.clearAccount() }
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
    refresh()
    return async () => {
      disposed = true
      stop()
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      entry.dispose()
      renderers.dispose()
      for (const release of boundViews.values()) release()
      boundViews.clear()
      await controller.dispose()
    }
  }, 'ui-physicsos: canvas account and model lifetime')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'physicsos-canvas', locale: 'physicsos', store: view, inject: injected,
  }, OptionalCanvasSurface))
  ctx.slots.registerFactory({
    name: 'physicsos.canvas.workbench', scope: 'root', locale: 'physicsos', store: view, inject: injected,
    slots: {
      experiment: { scope: 'root' }, result: { scope: 'root' }, note: { scope: 'root' },
      comparison: { scope: 'root' }, group: { scope: 'root' },
    },
  }, OptionalCanvasWorkspace)
  ctx.slots.registerFactory({
    name: 'physicsos.canvas.instance', scope: 'root', locale: 'physicsos', store: view, inject: injected,
    children: { 'physicsos.canvas.frame': { kind: 'single', scope: 'root' } },
  }, OptionalCanvasInstance)
  ctx.slots.inject('physicsos.canvas.frame', () => ctx.slots.register({
    name: 'physicsos.canvas.frame', locale: 'physicsos', store: view, inject: injected,
  }, OptionalCanvasFrame))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'physicsos-canvas-overlay', locale: 'physicsos', store: view, inject: injected,
  }, OptionalCanvasOverlay))
  return entry.callbacks
}
