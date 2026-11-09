import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CodeExperimentRef } from '@deepseek-ai/dsh-tool-physicsos/types'
import type { RendererReleaseIdentity } from '@physicsos/physics-workbench/types'
import type { CanvasController, CanvasInstanceActionArguments, CanvasInstanceActionName } from './types.ts'
import { contributionReleaseIdentity, selectContributionRelease, type ContributionCatalog, type ExperimentPackageView } from '../experiments/contribution-api.ts'
import { sameQuestionCodeRef, questionCodeSceneSha256, questionCodeVisualizationOf } from '../experiments/question-code-api.ts'
import { isUniversalExperimentIntent } from '../experiments/universal-contract.ts'
import type { ObservableKey } from '../physics/scene-visual-model.ts'

export interface CanvasRendererState {
  readonly status: 'native' | 'loading' | 'ready' | 'error'
  readonly kind: 'native' | 'community' | 'question-code'
  readonly experimentId?: string
  readonly entryUrl?: string
  readonly title?: string
  readonly author?: string
  readonly release?: RendererReleaseIdentity
  readonly code?: string
}
interface RendererRecord {
  readonly key: string
  readonly source: SnapshotStore<CanvasRendererState>
  readonly displays: Set<string>
  canvasId: string
  instanceId: string
  signature: string
  epoch: number
  stop?: (() => void) | undefined
  request?: AbortController | undefined
  timer?: ReturnType<typeof setTimeout> | undefined
  previewOwner?: string | undefined
  nativeQueue: Promise<void>
}
export type CanvasNativeAction = <K extends CanvasInstanceActionName>(key: string, display: string,
  action: K, ...args: CanvasInstanceActionArguments<K>) => Promise<boolean>
export interface CanvasRendererController {
  source(key: string): SnapshotStore<CanvasRendererState>
  attach(canvasId: string, instanceId: string, key: string, display: string): () => void
  refresh(key: string): void
  applyIntent(key: string, display: string, intent: unknown): Promise<boolean>
  releasePreview(key: string, display: string): void
  nativeAction: CanvasNativeAction
  ownsPreview(key: string, display: string): boolean
  dispose(): void
}
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value)
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** A private renderer reference carries no URL or code and never grants account access. */
export function canvasCodeRef(value: unknown): CodeExperimentRef | undefined {
  if (!plain(value) || value.status !== 'ready' || value.rendererKind !== 'independent') return undefined
  const { artifactId, ownerSessionId, sceneId, sceneRevision, sceneSha256, experimentId, sha256: digest, title, childSessionId, createdAt } = value
  if (!identifier(artifactId) || !identifier(ownerSessionId) || !identifier(sceneId) || !identifier(experimentId)
    || !identifier(childSessionId) || typeof title !== 'string' || !identifier(createdAt)
    || typeof sceneRevision !== 'number' || !Number.isSafeInteger(sceneRevision) || sceneRevision < 0
    || !sha256(sceneSha256) || !sha256(digest)) return undefined
  return { status: 'ready', rendererKind: 'independent', artifactId, ownerSessionId, sceneId, sceneRevision,
    sceneSha256, experimentId, sha256: digest, title, childSessionId, createdAt }
}
const releaseView = (input: unknown): ExperimentPackageView | null => {
  if (input === null) return null
  if (!plain(input) || !identifier(input.id) || !identifier(input.experimentId) || !identifier(input.version)
    || !sha256(input.sha256) || input.status !== 'approved' || input.protocolVersion !== 3 || !identifier(input.entryUrl)
    || !plain(input.author) || typeof input.author.name !== 'string' || typeof input.createdAt !== 'string') throw new Error('RENDERER_CATALOG_INVALID')
  return { id: input.id, experimentId: input.experimentId, version: input.version, sha256: input.sha256,
    status: 'approved', protocolVersion: 3, entryUrl: input.entryUrl, createdAt: input.createdAt, author: { name: input.author.name } }
}

/** Renderer resources are ephemeral, account-fenced, and separate from the physics instance's saved facts. */
export function createCanvasRendererController(controller: Pick<CanvasController, 'getSnapshot' | 'subscribe' | 'documentSource' | 'instanceSource' | 'instanceAction'>, origin: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): CanvasRendererController {
  const records = new Map<string, RendererRecord>()
  let disposed = false
  let namespace = controller.getSnapshot().namespace
  const cell = (key: string): RendererRecord => {
    let record = records.get(key)
    if (record === undefined) {
      record = { key, source: createSnapshotStore<CanvasRendererState>({ status: 'native', kind: 'native' }),
        displays: new Set(), canvasId: '', instanceId: '', signature: '', epoch: 0, nativeQueue: Promise.resolve() }
      records.set(key, record)
    }
    return record
  }
  const stopWork = (record: RendererRecord): void => {
    record.epoch += 1
    record.request?.abort()
    record.request = undefined
    if (record.timer !== undefined) clearTimeout(record.timer)
    record.timer = undefined
  }
  const urlOf = (value: string, question: boolean): string => {
    const url = new URL(value, origin)
    const prefix = question ? '/physicsos/experiment-assets/embed/question/' : '/physicsos/experiment-assets/embed/'
    if (url.origin !== origin || !url.pathname.startsWith(prefix) || url.username || url.password) throw new Error('RENDERER_URL_INVALID')
    return url.toString()
  }
  const json = async (path: string, signal: AbortSignal): Promise<unknown> => {
    const response = await fetcher(new URL(path, origin), { signal, credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'RENDERER_ACCESS_DENIED' : 'RENDERER_UNAVAILABLE')
    return response.json()
  }
  const reload = (record: RendererRecord, force = false): void => {
    if (disposed || record.displays.size === 0) return
    const document = controller.documentSource(record.canvasId).getSnapshot()
    const instance = document.manifest?.instances.find(value => value.instanceId === record.instanceId)
    const current = instance === undefined ? undefined : document.objects[instance.currentScene.digest]
    if (instance === undefined || current?.kind !== 'scene' || document.status === 'deleted' || document.status === 'auth-required') {
      stopWork(record); record.source.set({ status: 'native', kind: 'native' }); return
    }
    const code = canvasCodeRef(instance.source.metadata?.questionCodeVisualization ?? questionCodeVisualizationOf(current.scene))
    const release = instance.rendererRelease ?? current.scene.metadata.experimentRelease ?? instance.source.release
    const template = instance.templateId ?? release?.experimentId
    const signature = JSON.stringify([document.namespace, template, release, code, instance.source.kind])
    if (!force && signature === record.signature) return
    stopWork(record)
    record.signature = signature
    if (code === undefined && instance.source.kind === 'question-code') {
      record.source.set({ status: 'error', kind: 'question-code', code: 'RENDERER_NOT_READY' })
      return
    }
    const bundledTemplate = release === undefined && instance.source.kind === 'template'
    if (code === undefined && (template === undefined || release?.kind === 'official' || bundledTemplate)) {
      record.source.set({ status: 'native', kind: 'native', ...(template === undefined ? {} : { experimentId: template }), ...(release === undefined ? {} : { release }) })
      return
    }
    const abort = new AbortController()
    record.request = abort
    const ticket = record.epoch
    const owner = document.namespace
    const valid = (): boolean => !disposed && !abort.signal.aborted && record.epoch === ticket && record.displays.size > 0
      && controller.getSnapshot().namespace === owner && controller.getSnapshot().authScope !== 'paused'
    record.source.set({ status: 'loading', kind: code === undefined ? 'community' : 'question-code' })
    void (async () => {
      if (code !== undefined) {
        const original = document.objects[instance.originScene.digest]
        // The first handover can verify the original byte identity. Copies retain the server-owned artifact reference.
        if (original?.kind === 'scene' && String(original.scene.id) === code.sceneId && original.scene.revision === code.sceneRevision) {
          if (await questionCodeSceneSha256(original.scene) !== code.sceneSha256) throw new Error('RENDERER_SOURCE_MISMATCH')
        }
        const path = `/physicsos/question-code/artifacts/${encodeURIComponent(code.artifactId)}`
        const query = `?sha256=${encodeURIComponent(code.sha256)}`
        const [preview, source] = await Promise.all([json(`${path}/preview${query}`, abort.signal), json(`${path}/source${query}`, abort.signal)])
        if (!plain(preview) || !identifier(preview.entryUrl) || typeof preview.expiresAt !== 'number' || !Number.isFinite(preview.expiresAt) || preview.expiresAt <= Date.now()
          || !plain(source) || !plain(source.source)) throw new Error('RENDERER_RESPONSE_INVALID')
        const returned = canvasCodeRef(source.ref)
        if (returned === undefined || !sameQuestionCodeRef(code, returned)) throw new Error('RENDERER_SOURCE_MISMATCH')
        const entryUrl = urlOf(preview.entryUrl, true)
        if (!valid()) return
        record.source.set({ status: 'ready', kind: 'question-code', entryUrl, experimentId: code.experimentId, title: code.title })
        record.timer = setTimeout(() => reload(record, true), Math.max(250, Math.min(2_147_483_647, preview.expiresAt - Date.now() - 1000)))
        return
      }
      if (template === undefined) return
      const value = await json(`/physicsos/experiments/${encodeURIComponent(template)}`, abort.signal)
      if (!plain(value) || !Array.isArray(value.items)) throw new Error('RENDERER_CATALOG_INVALID')
      const active = releaseView(value.active)
      const items = value.items.filter(item => plain(item) && item.status === 'approved').map(releaseView).filter((item): item is ExperimentPackageView => item !== null)
      const catalog: ContributionCatalog = { active, items, canReview: false }
      const selected = selectContributionRelease(catalog, release, template)
      if (selected === undefined) throw new Error('RENDERER_RELEASE_MISSING')
      const pinned = contributionReleaseIdentity(selected, template)
      if (!valid()) return
      if (release === undefined) {
        await controller.instanceAction(record.key, 'setRelease', pinned)
        if (!valid()) return
      }
      if (selected === null) {
        record.source.set({ status: 'native', kind: 'native', experimentId: template, release: pinned })
      } else {
        record.source.set({ status: 'ready', kind: 'community', entryUrl: urlOf(selected.entryUrl!, false), experimentId: template,
          title: selected.experimentId, author: selected.author.name, release: pinned })
      }
    })().catch(error => {
      if (valid()) record.source.set({ status: 'error', kind: code === undefined ? 'community' : 'question-code',
        code: error instanceof Error ? error.message : 'RENDERER_UNAVAILABLE' })
    })
  }
  const accountChanged = (): void => {
    const state = controller.getSnapshot()
    if (state.namespace === namespace && state.authScope !== 'paused') return
    namespace = state.namespace
    for (const record of records.values()) { stopWork(record); record.signature = ''; record.previewOwner = undefined; record.source.set({ status: 'native', kind: 'native' }) }
  }
  const stopAccount = controller.subscribe(accountChanged)
  const queued = <T>(record: RendererRecord, action: () => Promise<T>): Promise<T> => {
    const result = record.nativeQueue.then(action)
    record.nativeQueue = result.then(() => undefined, () => undefined)
    return result
  }
  const previews = new Set<CanvasInstanceActionName>(['previewParameter', 'previewComponentPlacement', 'previewSliderPosition'])
  const commits = new Set<CanvasInstanceActionName>(['commitParameter', 'commitComponentPlacement', 'commitSliderPosition'])
  const cancellations = new Set<CanvasInstanceActionName>(['cancelParameterPreview', 'cancelComponentPlacement', 'cancelSliderPosition'])
  const manager: CanvasRendererController = {
    source: key => cell(key).source,
    attach: (canvasId, instanceId, key, display) => {
      const record = cell(key)
      record.canvasId = canvasId; record.instanceId = instanceId; record.displays.add(display)
      if (record.stop === undefined) record.stop = controller.documentSource(canvasId).subscribe(() => reload(record))
      reload(record, record.displays.size === 1)
      return () => {
        manager.releasePreview(key, display)
        record.displays.delete(display)
        if (record.displays.size === 0) { stopWork(record); record.stop?.(); record.stop = undefined }
      }
    },
    refresh: key => reload(cell(key), true),
    releasePreview: (key, display) => {
      const record = records.get(key)
      if (record === undefined) return
      void queued(record, async () => {
        if (record.previewOwner !== display) return
        record.previewOwner = undefined
        await controller.instanceAction(key, 'cancelParameterPreview')
      }).catch(() => {})
    },
    ownsPreview: (key, display) => !disposed && records.get(key)?.previewOwner === display
      && records.get(key)?.displays.has(display) === true && controller.instanceSource(key).getSnapshot()?.previewing === true,
    nativeAction: (key, display, action, ...args) => {
      const record = cell(key)
      return queued(record, async () => {
        if (disposed || !record.displays.has(display) || controller.getSnapshot().authScope === 'paused'
          || controller.instanceSource(key).getSnapshot() === undefined) return false
        const preview = previews.has(action)
        const end = commits.has(action) || cancellations.has(action)
        if (end && record.previewOwner !== undefined && record.previewOwner !== display) return false
        if (cancellations.has(action) && record.previewOwner !== display) return false
        if (preview) {
          if (record.previewOwner !== undefined && record.previewOwner !== display) {
            record.previewOwner = undefined
            await controller.instanceAction(key, 'cancelParameterPreview')
          }
          if (!record.displays.has(display)) return false
          record.previewOwner = display
        }
        await controller.instanceAction(key, action, ...args)
        if (end && record.previewOwner === display) record.previewOwner = undefined
        if (!preview && controller.instanceSource(key).getSnapshot()?.previewing !== true) record.previewOwner = undefined
        return true
      })
    },
    applyIntent: async (key, display, value) => {
      const record = records.get(key)
      const summary = controller.instanceSource(key).getSnapshot()
      if (disposed || record === undefined || !record.displays.has(display) || summary === undefined || !isUniversalExperimentIntent(value)) return false
      const frame = summary.workspace
      const action = controller.instanceAction
      switch (value.type) {
        case 'parameter/preview':
        case 'parameter/commit': {
          const parameter = frame.inspector.flatMap(section => section.parameters ?? []).find(item => item.id === value.id)
          if (parameter === undefined || (parameter.min !== undefined && value.value < parameter.min) || (parameter.max !== undefined && value.value > parameter.max)) return false
          return value.type === 'parameter/preview'
            ? manager.nativeAction(key, display, 'previewParameter', value.id, value.value)
            : manager.nativeAction(key, display, 'commitParameter', value.id, value.value)
        }
        case 'parameter/cancel': await manager.nativeAction(key, display, 'cancelParameterPreview'); return true
        case 'choice/set': {
          const choice = frame.inspector.flatMap(section => section.choices ?? []).find(item => item.id === value.id)
          if (!choice?.options.some(option => option.value === value.value)) return false
          await action(key, 'setChoice', value.id, value.value); return true
        }
        case 'observable/set': {
          const observable = Object.keys(frame.view.visible).find(item => item === value.key)
          if (observable === undefined) return false
          await action(key, 'setObservable', observable as ObservableKey, value.enabled); return true
        }
        case 'playback/running': if (frame.clock.total <= 0 || frame.status === 'failed') return false; await action(key, 'setRunning', value.running); return true
        case 'playback/rate': if (frame.clock.total <= 0 || ![0.25, 0.5, 1, 2, 5, 20].includes(value.rate)) return false; await action(key, 'setRate', value.rate); return true
        case 'playback/seek': if (value.time < 0 || value.time > frame.clock.total) return false; await action(key, 'seek', value.time); return true
      }
    },
    dispose: () => { disposed = true; stopAccount(); for (const record of records.values()) { stopWork(record); record.stop?.(); record.previewOwner = undefined; record.source.set({ status: 'native', kind: 'native' }); record.displays.clear() } },
  }
  return manager
}
