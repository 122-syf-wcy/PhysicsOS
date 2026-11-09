import type { CanvasHead, CanvasOpenResponse } from '@physicsos/physics-workbench/protocol'
import type { CanvasGraph, CanvasManifest, MergeConflict, WorkbenchObject } from '@physicsos/physics-workbench/types'
import { canonicalStringify, fail, freezeData, unwrap, WorkbenchDataError } from '@physicsos/physics-workbench/json'
import { parseManifest, refsOf } from '@physicsos/physics-workbench/codec'
import { CanvasRequestError, type CanvasApi } from './api.ts'
import { CanvasCacheConflict, type CanvasPersistence, type LocalCanvasRecord, type PendingCanvasMutation } from './persistence.ts'
import { readPendingMutation } from './cache-codec.ts'
import type { GraphLimits } from '@physicsos/physics-workbench/graph'
import type { CanvasClientError } from './types.ts'

export interface CanvasSyncOptions {
  readonly limits?: () => Partial<GraphLimits>
  readonly namespace: string
  readonly api: CanvasApi
  readonly persistence: CanvasPersistence
  readonly hash: (value: unknown) => Promise<string>
  readonly id: (prefix: string) => string
  readonly now: () => string
  readonly online: () => boolean
  /** Called before and after each HTTP operation, including an upload which just completed. */
  readonly isCurrent: () => boolean
  readonly onRecord: (record: LocalCanvasRecord, objects?: Readonly<Record<string, WorkbenchObject>>) => void
  readonly onState?: (id: string, syncing: boolean) => void
  readonly onAuthenticationError?: (error: CanvasClientError) => void
  readonly onError?: (error: unknown) => void
}
export interface CanvasSynchronizer {
  sync(id: string, retry?: boolean): Promise<void>
  refresh(id: string): Promise<void>
  loadGraph(id: string, opened: CanvasOpenResponse, signal?: AbortSignal): Promise<CanvasGraph>
  openRemote(id: string): Promise<CanvasOpenResponse>
  pause(): void
  dispose(): Promise<void>
}

export const canvasErrorOf = (error: unknown): CanvasClientError => {
  if (error instanceof CanvasRequestError) return freezeData({ code: error.code, message: error.message,
    retryable: error.retryable, status: error.status })
  if (error instanceof WorkbenchDataError) return freezeData({ code: 'CANVAS_DATA_INVALID', message: error.message, retryable: false })
  if (error instanceof CanvasCacheConflict) return freezeData({ code: 'LOCAL_VERSION_CONFLICT', message: error.message, retryable: true })
  if (error instanceof Error) {
    const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value
    if (code === 'CAPTURE_UNAVAILABLE' || code === 'CAPTURE_REVISION_MISMATCH') {
      return freezeData({ code, message: error.message, retryable: false })
    }
    if (error instanceof TypeError && error.message.startsWith('WORKBENCH_STATE_INVALID')) {
      return freezeData({ code: 'WORKBENCH_STATE_INVALID', message: error.message, retryable: false })
    }
  }
  if (error instanceof Error && error.name === 'AbortError') return freezeData({ code: 'CANVAS_SYNC_PAUSED', message: 'Canvas synchronization is paused.', retryable: false })
  return freezeData({ code: 'CANVAS_NETWORK_FAILED', message: error instanceof Error ? error.message : 'Canvas synchronization failed.', retryable: true })
}

/** Complete protocol-owned closure; metadata is never treated as an inferred object reference. */
export const reachableCanvasGraph = (manifest: CanvasManifest, inventory: Readonly<Record<string, WorkbenchObject>>): CanvasGraph => {
  const objects: Record<string, WorkbenchObject> = {}
  const pending = [...refsOf(manifest)]
  while (pending.length > 0) {
    const reference = pending.pop()!
    const existing = objects[reference.digest]
    if (existing !== undefined) {
      if (existing.kind !== reference.kind) fail('/objects', 'blob-kind', 'A referenced canvas object has the wrong kind.')
      continue
    }
    const object = inventory[reference.digest]
    if (object === undefined) fail(`/objects/${reference.digest}`, 'missing-blob', 'A referenced canvas object is missing from its dependency closure.')
    if (object.kind !== reference.kind) fail('/objects', 'blob-kind', 'A referenced canvas object has the wrong kind.')
    objects[reference.digest] = object
    pending.push(...refsOf(object))
  }
  return freezeData({ schemaVersion: 1, manifest, objects })
}

/** Validate relationships over already parsed immutable blobs without recopying retained engine samples. */
export const assertCanvasReferences = (
  manifest: CanvasManifest, inventory: Readonly<Record<string, WorkbenchObject>>,
): CanvasGraph => {
  const graph = reachableCanvasGraph(manifest, inventory)
  const ownedScenes = new Set<string>()
  for (const instance of manifest.instances) {
    const current = graph.objects[instance.currentScene.digest]
    if (current?.kind !== 'scene') fail('/instances/currentScene', 'blob-kind', 'Current instance scene is unavailable.')
    if (ownedScenes.has(String(current.scene.id))) fail('/instances/currentScene', 'owned-scene-identity', 'Editable instances cannot share a scene identity.')
    ownedScenes.add(String(current.scene.id))
  }
  const historyEntries = new Map<string, string>()
  const colors = new Map<string, 'active' | 'complete'>()
  const visit = (digest: string): void => {
    if (colors.get(digest) === 'active') fail('/objects', 'blob-cycle', 'Object references contain a cycle.')
    if (colors.get(digest) === 'complete') return
    colors.set(digest, 'active')
    for (const ref of refsOf(graph.objects[digest]!)) visit(ref.digest)
    colors.set(digest, 'complete')
  }
  for (const [digest, object] of Object.entries(graph.objects)) {
    visit(digest)
    if (object.kind === 'dataset') {
      const source = graph.objects[object.sourceScene.digest]
      if (source?.kind !== 'scene' || String(source.scene.id) !== object.origin.sceneId || source.scene.revision !== object.origin.sceneRevision) {
        fail('/objects/dataset/origin', 'scene-identity', 'Dataset origin must match its exact source scene.')
      }
    } else if (object.kind === 'snapshot') {
      const source = graph.objects[object.scene.digest]
      if (source?.kind !== 'scene' || source.scene.revision !== object.sceneRevision) fail('/objects/snapshot/scene', 'revision', 'Captured revision does not match its scene.')
      for (const reading of [object.request, object.result]) {
        if (reading !== undefined && (String(reading.sceneId) !== String(source.scene.id) || reading.sceneRevision !== source.scene.revision)) {
          fail('/objects/snapshot/result', 'scene-identity', 'Captured engine evidence must belong to its exact scene identity and revision.')
        }
      }
      const datasets = new Set<string>()
      for (const ref of object.datasets) {
        const dataset = graph.objects[ref.digest]
        if (dataset?.kind !== 'dataset' || dataset.sourceScene.digest !== object.scene.digest) fail('/objects/snapshot/datasets', 'dataset-scene', 'Snapshot datasets must reference the exact captured scene object.')
        if (datasets.has(dataset.id)) fail('/objects/snapshot/datasets', 'duplicate-identity', 'A snapshot cannot include conflicting dataset identities.')
        datasets.add(dataset.id)
      }
    } else if (object.kind === 'history') {
      for (const entry of object.entries) {
        const canonical = canonicalStringify(entry)
        const previous = historyEntries.get(entry.id)
        if (previous !== undefined && previous !== canonical) fail('/objects/history/entries', 'duplicate-identity', 'An immutable history entry identity has conflicting content.')
        historyEntries.set(entry.id, canonical)
      }
    }
  }
  const aliases = new Map(manifest.snapshots.map(alias => [alias.id, alias]))
  const snapshotDatasets = (aliasId: string): readonly string[] => {
    const alias = aliases.get(aliasId)
    const snapshot = alias === undefined ? undefined : graph.objects[alias.snapshot.digest]
    if (snapshot?.kind !== 'snapshot') return fail('/snapshots', 'reference', 'The result alias does not resolve to a snapshot.')
    return snapshot.datasets.map(ref => ref.digest)
  }
  const memberIds = new Set<string>()
  for (const config of manifest.comparisons) for (const member of config.members) {
    if (memberIds.has(member.id)) fail('/comparisons/members', 'duplicate-identity', 'Comparison member identities must be unique in a workbench.')
    memberIds.add(member.id)
    if (!snapshotDatasets(member.snapshotAliasId).includes(member.dataset.digest)) fail('/comparisons/members/dataset', 'comparison-dataset', 'Comparison data must belong to its selected snapshot.')
    const dataset = graph.objects[member.dataset.digest]
    if (dataset?.kind !== 'dataset' || !dataset.metrics.some(metric => metric.id === member.metricId) ||
      member.axisId !== undefined && !dataset.axes.some(axis => axis.id === member.axisId)) {
      fail('/comparisons/members', 'metric-reference', 'Comparison metric and axis must exist in the selected dataset.')
    }
  }
  for (const node of manifest.nodes) {
    if (node.kind !== 'result' || node.metricIds === undefined) continue
    const datasets = snapshotDatasets(node.snapshotAliasId)
    for (const metricId of node.metricIds) if (!datasets.some(digest => {
      const dataset = graph.objects[digest]
      return dataset?.kind === 'dataset' && dataset.metrics.some(metric => metric.id === metricId)
    })) fail('/nodes/metricIds', 'metric-reference', 'The selected result metric does not exist in its snapshot.')
  }
  return graph
}

/** Short IDB CAS transactions remain independent of HTTP lifetime and cross-tab hints. */
export const updateCanvasRecord = async (
  persistence: CanvasPersistence,
  namespace: string,
  id: string,
  update: (current: LocalCanvasRecord) => LocalCanvasRecord | undefined | Promise<LocalCanvasRecord | undefined>,
  objects: Readonly<Record<string, WorkbenchObject>> = {},
): Promise<LocalCanvasRecord | undefined> => {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const current = await persistence.read(namespace, id)
    if (current === undefined) return undefined
    const next = await update(current)
    if (next === undefined) return current
    try { return await persistence.save(next, objects, current.cacheVersion) } catch (error) {
      if (!(error instanceof CanvasCacheConflict)) throw error
    }
  }
  throw new CanvasCacheConflict(await persistence.read(namespace, id))
}

export interface CanvasGraphMerge {
  readonly manifest?: CanvasManifest
  readonly objects: Readonly<Record<string, WorkbenchObject>>
  readonly conflicts: readonly MergeConflict[]
}

/** Merge business content independently, then retain both immutable history DAG parents. */
export const mergeCanvasGraphs = async (
  base: CanvasManifest, local: CanvasManifest, remote: CanvasManifest,
  objects: Readonly<Record<string, WorkbenchObject>>,
  hash: (value: unknown) => Promise<string>, now: () => string, id: (prefix: string) => string,
  limits?: Partial<GraphLimits>,
): Promise<CanvasGraphMerge> => {
  const { mergeManifests } = await import('@physicsos/physics-workbench/merge')
  const { history: _baseHistory, ...baseContent } = base
  const { history: _localHistory, ...localContent } = local
  const { history: _remoteHistory, ...remoteContent } = remote
  const merged = mergeManifests(baseContent, localContent, remoteContent)
  if (!merged.ok) return { objects, conflicts: merged.conflicts }
  const parents = [...new Map([local.history, remote.history].filter(parent => parent !== undefined)
    .map(parent => [parent.digest, parent])).values()]
  let manifest = merged.manifest
  let inventory = objects
  if (parents.length === 1) manifest = unwrap(parseManifest({ ...manifest, history: parents[0] }))
  else if (parents.length > 1) {
    const { parseObject } = await import('@physicsos/physics-workbench/codec')
    const history = unwrap(parseObject({ schemaVersion: 1, kind: 'history', parents,
      entries: [{ id: id('history-merge'), at: now(), operation: 'merge' }] }))
    const digest = await hash(history)
    inventory = { ...objects, [digest]: history }
    manifest = unwrap(parseManifest({ ...manifest, history: { kind: 'history', digest } }))
  }
  const { validateGraph } = await import('@physicsos/physics-workbench/graph')
  const validated = validateGraph(manifest, reachableCanvasGraph(manifest, inventory).objects, limits)
  if (!validated.ok) return { objects: inventory, conflicts: validated.issues.map(issue => ({
    path: issue.path, kind: 'invalid-reference', message: issue.message,
  })) }
  return { manifest: validated.value.manifest, objects: inventory, conflicts: [] }
}

/** Immutable outbox entries are sealed before uploading anything or awaiting the network. */
export function createCanvasSynchronizer(options: CanvasSyncOptions): CanvasSynchronizer {
  const running = new Map<string, Promise<void>>()
  const aborters = new Set<AbortController>()
  let paused = false
  let disposed = false
  const report = (error: unknown): void => {
    try { options.onError?.(error) } catch { /* Diagnostics cannot alter a queue acknowledgement. */ }
  }
  const requireCurrent = (): void => {
    if (disposed || paused || !options.isCurrent()) {
      throw new CanvasRequestError(401, 'CANVAS_ACCOUNT_CHANGED', 'The canvas account changed; the previous account draft has been retained.', undefined, false)
    }
  }
  const request = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    requireCurrent()
    const controller = new AbortController()
    aborters.add(controller)
    try {
      const value = await operation(controller.signal)
      requireCurrent()
      return value
    } finally { aborters.delete(controller) }
  }
  const publish = (record: LocalCanvasRecord | undefined, objects?: Readonly<Record<string, WorkbenchObject>>): void => {
    if (record === undefined) return
    try { options.onRecord(record, objects) } catch (error) { report(error) }
  }
  const saveError = async (id: string, error: CanvasClientError): Promise<void> => {
    const saved = await updateCanvasRecord(options.persistence, options.namespace, id,
      current => ({ ...current, error, savedAt: options.now() }))
    publish(saved)
  }
  const loadGraph = async (id: string, opened: CanvasOpenResponse, signal?: AbortSignal): Promise<CanvasGraph> => {
    if (opened.head.id !== id || opened.manifest.id !== id || await options.hash(opened.manifest) !== opened.head.manifestDigest) {
      throw new CanvasRequestError(502, 'CANVAS_MANIFEST_DIGEST_MISMATCH', 'The server canvas manifest failed its content digest check.', undefined, false)
    }
    const inventory = await options.persistence.objects(options.namespace, id)
    const objects: Record<string, WorkbenchObject> = {}
    const queue = [...refsOf(opened.manifest)]
    while (queue.length > 0) {
      const reference = queue.pop()!
      const loaded = objects[reference.digest]
      if (loaded !== undefined) {
        if (loaded.kind !== reference.kind) throw new CanvasRequestError(502, 'CANVAS_OBJECT_KIND_MISMATCH', 'An object dependency has the wrong kind.', undefined, false)
        continue
      }
      const object = inventory[reference.digest] ?? await request(innerSignal => options.api.getObject(id, reference.digest, signal ?? innerSignal))
      if (object.kind !== reference.kind || await options.hash(object) !== reference.digest) {
        throw new CanvasRequestError(502, 'CANVAS_OBJECT_DIGEST_MISMATCH', 'A canvas object failed its kind or SHA256 check.', undefined, false)
      }
      objects[reference.digest] = object
      queue.push(...refsOf(object))
    }
    requireCurrent()
    const graph = reachableCanvasGraph(opened.manifest, objects)
    // Cross-object identity and metric relationships are checked by the shared graph validator.
    const { validateGraph } = await import('@physicsos/physics-workbench/graph')
    return unwrap(validateGraph(graph.manifest, graph.objects, options.limits?.()))
  }
  const reconcileRemote = async (id: string, opened: CanvasOpenResponse): Promise<boolean> => {
    const graph = await loadGraph(id, opened)
    const inventory: Record<string, WorkbenchObject> = {
      ...await options.persistence.objects(options.namespace, id), ...graph.objects,
    }
    let conflicted = false
    const saved = await updateCanvasRecord(options.persistence, options.namespace, id, async current => {
      requireCurrent()
      if (current.head !== undefined && (opened.head.generation < current.head.generation ||
        (opened.head.generation === current.head.generation && opened.head.version < current.head.version))) return undefined
      Object.assign(inventory, await options.persistence.objects(options.namespace, id))
      if (current.localConflict !== undefined) return undefined
      if (current.head !== undefined && opened.head.version === current.head.version &&
        opened.head.generation === current.head.generation && opened.head.manifestDigest === current.head.manifestDigest) return undefined
      if (current.pending?.kind === 'commit' && current.pending.request.manifestDigest === opened.head.manifestDigest &&
        opened.head.deletedAt === undefined) {
        const { pending: _pending, error: _error, ...retained } = current
        return { ...retained, head: opened.head, base: opened.manifest,
          acknowledgedSequence: Math.max(current.acknowledgedSequence, current.pending.editSequence), savedAt: options.now() }
      }
      const base = current.base ?? opened.manifest
      const local = current.working
      const clean = current.pending === undefined && current.editSequence === current.acknowledgedSequence &&
        !(current.pendingNoteDrafts ?? []).some(draft => draft.body !== draft.baseBody || draft.format !== draft.baseFormat) &&
        current.conflict === undefined && current.localConflict === undefined && current.deleted === (current.head?.deletedAt !== undefined)
      if (clean) {
        const { error: _error, conflict: _conflict, ...retained } = current
        return { ...retained, head: opened.head, base: opened.manifest, working: opened.manifest,
          deleted: opened.head.deletedAt !== undefined, savedAt: options.now() }
      }
      const merged = await mergeCanvasGraphs(base, local, opened.manifest, inventory, options.hash, options.now, options.id, options.limits?.())
      Object.assign(inventory, merged.objects)
      const { pending: _pending, error: _error, conflict: _conflict, ...retained } = current
      if (opened.head.deletedAt !== undefined && !current.deleted) {
        conflicted = true
        const conflict: MergeConflict = { path: '/deleted', kind: 'delete-modify', base: false, local: false, remote: true,
          message: 'This canvas was deleted remotely while a local draft was being edited.' }
        return { ...retained, head: opened.head, base: opened.manifest, deleted: true, savedAt: options.now(),
          conflict: { base, local, remote: opened, conflicts: [conflict] } }
      }
      if (merged.manifest === undefined) {
        conflicted = true
        return { ...retained, head: opened.head, base: opened.manifest, savedAt: options.now(),
          conflict: { base, local, remote: opened, conflicts: merged.conflicts } }
      }
      return { ...retained, head: opened.head, base: opened.manifest, working: merged.manifest,
        editSequence: current.editSequence + (canonicalStringify(merged.manifest) === canonicalStringify(local) ? 0 : 1),
        savedAt: options.now() }
    }, inventory)
    publish(saved, inventory)
    return !conflicted
  }
  const openRemote = async (id: string): Promise<CanvasOpenResponse> => {
    try { return await request(signal => options.api.open(id, signal)) } catch (error) {
      if (!(error instanceof CanvasRequestError) || ![404, 410].includes(error.status) || error.currentHead?.deletedAt === undefined) throw error
      const head = error.currentHead
      const manifest = await request(signal => options.api.getManifest(id, head.manifestDigest, signal))
      if (manifest.id !== id || await options.hash(manifest) !== head.manifestDigest) throw new CanvasRequestError(502,
        'CANVAS_MANIFEST_DIGEST_MISMATCH', 'The retained tombstone manifest failed its SHA256 check.', undefined, false)
      return { head, manifest }
    }
  }
  const refresh = async (id: string): Promise<void> => {
    if (!options.online()) return
    await reconcileRemote(id, await openRemote(id))
  }
  const seal = async (id: string): Promise<LocalCanvasRecord | undefined> => {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      requireCurrent()
      const current = await options.persistence.read(options.namespace, id)
      if (current === undefined || current.pending !== undefined || current.conflict !== undefined || current.localConflict !== undefined) return current
      if ((current.pendingNoteDrafts?.length ?? 0) > 0) return current
      let kind: PendingCanvasMutation['kind']
      let body: unknown
      if (current.head === undefined) {
        if (current.deleted) return current
        kind = 'create'
        body = { id, title: current.working.title, mutationId: options.id('mutation') }
      } else if (current.deleted && current.head.deletedAt === undefined) {
        kind = 'delete'
        body = { expectedVersion: current.head.version, mutationId: options.id('mutation') }
      } else if (!current.deleted && current.head.deletedAt !== undefined) {
        kind = 'restore'
        body = { expectedVersion: current.head.version, expectedGeneration: current.head.generation, mutationId: options.id('mutation') }
      } else {
        if (current.deleted) return current
        if (current.base !== undefined && canonicalStringify(current.working) === canonicalStringify(current.base)) {
          if (current.acknowledgedSequence !== current.editSequence || current.error !== undefined) {
            const { error: _error, ...retained } = current
            try {
              const saved = await options.persistence.save({ ...retained, acknowledgedSequence: current.editSequence, savedAt: options.now() }, {}, current.cacheVersion)
              publish(saved)
              return saved
            } catch (error) { if (error instanceof CanvasCacheConflict) continue; throw error }
          }
          return current
        }
        kind = 'commit'
        body = { expectedVersion: current.head.version, expectedGeneration: current.head.generation,
          mutationId: options.id('mutation'), manifestDigest: await options.hash(current.working) }
      }
      const pending = readPendingMutation({ kind, request: body, body: canonicalStringify(body), bodyDigest: await options.hash(body),
        createdAt: options.now(), editSequence: current.editSequence, ...(kind === 'commit' ? { manifest: current.working } : {}) }, id)
      const { error: _error, ...retained } = current
      try {
        const saved = await options.persistence.save({ ...retained, pending, savedAt: options.now() }, {}, current.cacheVersion)
        publish(saved)
        return saved
      } catch (error) { if (!(error instanceof CanvasCacheConflict)) throw error }
    }
    throw new CanvasCacheConflict(await options.persistence.read(options.namespace, id))
  }
  const upload = async (id: string, manifest: CanvasManifest): Promise<void> => {
    const inventory = await options.persistence.objects(options.namespace, id)
    const graph = reachableCanvasGraph(manifest, inventory)
    const { verifyGraphDigests } = await import('@physicsos/physics-workbench/graph')
    unwrap(await verifyGraphDigests(graph, canonical => options.hash(JSON.parse(canonical)), options.limits?.()))
    // Children precede parents; the manifest is uploaded only after its complete closure.
    const uploaded = new Set<string>()
    const visiting = new Set<string>()
    const send = async (hash: string): Promise<void> => {
      if (uploaded.has(hash)) return
      if (visiting.has(hash)) throw new WorkbenchDataError([{ path: '/objects', code: 'cycle', message: 'Canvas object dependencies contain a cycle.' }])
      visiting.add(hash)
      const object = graph.objects[hash]!
      for (const ref of refsOf(object)) await send(ref.digest)
      if (object.kind === 'snapshot' && object.source === 'server-engine') {
        let stored: WorkbenchObject
        try { stored = await request(signal => options.api.getObject(id, hash, signal)) } catch (error) {
          if (error instanceof CanvasRequestError && error.status === 404) throw new CanvasRequestError(422,
            'CANVAS_SERVER_OBJECT_UNAVAILABLE', 'Server evidence must already exist in this authorized Canvas before it can be referenced.', undefined, false)
          throw error
        }
        if (stored.kind !== 'snapshot' || stored.source !== 'server-engine' || await options.hash(stored) !== hash) {
          throw new CanvasRequestError(502, 'CANVAS_SERVER_OBJECT_INVALID', 'The authorized server evidence does not match this immutable snapshot.', undefined, false)
        }
      } else await request(signal => options.api.putObject(id, hash, object, signal))
      visiting.delete(hash)
      uploaded.add(hash)
    }
    for (const hash of Object.keys(graph.objects)) await send(hash)
    const manifestDigest = await options.hash(manifest)
    await request(signal => options.api.putObject(id, manifestDigest, manifest, signal))
  }
  const acknowledge = async (
    id: string, pending: PendingCanvasMutation, head: CanvasHead, base: CanvasManifest,
  ): Promise<void> => {
    if (head.id !== id || base.id !== id || await options.hash(base) !== head.manifestDigest) {
      throw new CanvasRequestError(502, 'CANVAS_ACK_INVALID', 'The canvas acknowledgement does not match its published manifest.', undefined, false)
    }
    const saved = await updateCanvasRecord(options.persistence, options.namespace, id, current => {
      if (current.pending?.request.mutationId !== pending.request.mutationId) return undefined
      const { pending: _pending, error: _error, ...retained } = current
      const isNewer = current.head === undefined || head.generation > current.head.generation ||
        (head.generation === current.head.generation && head.version >= current.head.version)
      const working = pending.kind === 'create'
        ? unwrap(parseManifest({ ...current.working, createdAt: base.createdAt,
          updatedAt: Date.parse(current.working.updatedAt) < Date.parse(base.updatedAt) ? base.updatedAt : current.working.updatedAt }))
        : current.working
      const acknowledgesContent = pending.kind === 'commit' || pending.kind === 'delete' || pending.kind === 'restore'
      return { ...retained, ...(isNewer ? { head, base } : {}), working,
        acknowledgedSequence: acknowledgesContent
          ? Math.max(current.acknowledgedSequence, pending.editSequence) : current.acknowledgedSequence,
        savedAt: options.now() }
    })
    publish(saved)
  }
  const run = async (id: string, retry: boolean, conflictAttempts = 0): Promise<void> => {
    if (!options.online() || disposed || paused) return
    try {
      requireCurrent()
      let record = await options.persistence.read(options.namespace, id)
      if (record === undefined || record.conflict !== undefined || record.localConflict !== undefined) return
      // A new authenticated scope may resume its retained envelope explicitly. A
      // paused scope still exits above, and rejected data or quotas remain stopped.
      if (retry && record.error !== undefined && ([401, 403].includes(record.error.status ?? 0) || record.error.code === 'CANVAS_SYNC_PAUSED')) {
        record = await updateCanvasRecord(options.persistence, options.namespace, id, current => {
          requireCurrent()
          if (current.error === undefined || !([401, 403].includes(current.error.status ?? 0) || current.error.code === 'CANVAS_SYNC_PAUSED')) return undefined
          const { error: _error, ...retained } = current
          return { ...retained, savedAt: options.now() }
        })
        publish(record)
      }
      if (record === undefined) return
      if (record.error !== undefined && !record.error.retryable) return
      options.onState?.(id, true)
      for (let turn = 0; turn < 32; turn += 1) {
        record = await seal(id)
        const pending = record?.pending
        if (record === undefined || pending === undefined) return
        if (pending.kind === 'create') {
          const created = await request(signal => options.api.create(pending.request, signal))
          await acknowledge(id, pending, created.head, created.manifest)
        } else if (pending.kind === 'commit') {
          await upload(id, pending.manifest)
          const committed = await request(signal => options.api.commit(id, pending.request, signal))
          if (committed.head.manifestDigest !== pending.request.manifestDigest) {
            throw new CanvasRequestError(502, 'CANVAS_ACK_INVALID', 'The commit acknowledgement belongs to a different sealed payload.', undefined, false)
          }
          await acknowledge(id, pending, committed.head, committed.manifest ?? pending.manifest)
        } else {
          const head = pending.kind === 'delete'
            ? await request(signal => options.api.remove(id, pending.request, signal))
            : await request(signal => options.api.restore(id, pending.request, signal))
          const base = record.base
          if (base === undefined) throw new WorkbenchDataError([{ path: '/base', code: 'base', message: 'A delete/restore acknowledgement has no retained base manifest.' }])
          await acknowledge(id, pending, head, base)
        }
      }
    } catch (error) {
      const failure = canvasErrorOf(error)
      if (error instanceof CanvasRequestError && error.status === 409 && options.isCurrent() && !paused) {
        try {
          await refresh(id)
          const reconciled = await options.persistence.read(options.namespace, id)
          if (reconciled !== undefined && reconciled.conflict === undefined && reconciled.localConflict === undefined) {
            if (conflictAttempts >= 4) await saveError(id, { code: 'CANVAS_CONCURRENT_WRITES',
              message: 'Another tab is publishing this canvas; retry after its changes settle.', retryable: true })
            else await run(id, false, conflictAttempts + 1)
          }
        } catch (refreshError) { await saveError(id, canvasErrorOf(refreshError)); report(refreshError) }
      } else if (error instanceof CanvasRequestError && [404, 410].includes(error.status)) {
        if (error.currentHead?.deletedAt !== undefined) {
          try { await reconcileRemote(id, await openRemote(id)) } catch (retainedError) { await saveError(id, canvasErrorOf(retainedError)); report(retainedError) }
        } else {
          const saved = await updateCanvasRecord(options.persistence, options.namespace, id, current => {
            const { pending: _pending, ...retained } = current
            return { ...retained, deleted: true, error: failure, savedAt: options.now() }
          })
          publish(saved)
        }
      } else {
        try { await saveError(id, failure) } catch (cacheError) { report(cacheError); throw cacheError }
        if (failure.status === 401 || failure.status === 403) {
          paused = true
          for (const controller of aborters) controller.abort()
          options.onAuthenticationError?.(failure)
        }
      }
      report(error)
    } finally { options.onState?.(id, false) }
  }
  return {
    sync: (id, retry = false) => {
      const existing = running.get(id)
      if (existing !== undefined) return existing
      const promise = run(id, retry)
      running.set(id, promise)
      void promise.finally(() => { if (running.get(id) === promise) running.delete(id) }).catch(report)
      return promise
    },
    refresh, loadGraph, openRemote,
    pause: () => { paused = true; for (const controller of aborters) controller.abort() },
    dispose: async () => {
      disposed = true
      paused = true
      for (const controller of aborters) controller.abort()
      await Promise.allSettled([...running.values()])
    },
  }
}
