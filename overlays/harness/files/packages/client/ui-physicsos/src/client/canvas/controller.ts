import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { CanvasHead, CanvasVerificationListResponse } from '@physicsos/physics-workbench/protocol'
import type {
  CanvasGraph, CanvasLayout, CanvasManifest, CanvasNode, ComparisonConfig,
  DatasetObject, ExperimentInstance, HistoryEntry, JsonObject, JsonValue, ObjectRef, SnapshotAlias,
  TemplateReleaseIdentity, WorkbenchObject,
} from '@physicsos/physics-workbench/types'
import {
  createManifest, createSceneObject, parseManifest, parseObject, readExperimentInstance, readInstanceSource, refsOf,
} from '@physicsos/physics-workbench/codec'
import { captureDatasets, createSnapshotObject } from '@physicsos/physics-workbench/data'
import {
  canonicalStringify, copyJsonObject, digest, exactKeys, fail, finite, freezeData, integer, jsonObject,
  jsonValue, list, oneOf, record, text, unwrap,
} from '@physicsos/physics-workbench/json'
import { readRendererRelease } from '@physicsos/physics-workbench'
import type {
  CreateWorkbenchInstanceOptions, WorkbenchCommittedState, WorkbenchInstanceRuntime,
  WorkbenchInstanceSummary,
} from '../physics/workbench-instance-runtime.ts'
import type { WorkspaceFrame } from '../physics/workspace-runtime.ts'
import { CanvasRequestError, readCanvasResourcePolicy, readCanvasVerificationResponse, type CanvasApi, type CanvasListQuery, type CanvasVerificationResponse } from './api.ts'
import { GRAPH_LIMITS, type GraphLimits } from '@physicsos/physics-workbench/graph'
import { canvasId, createCanvasDigest, payloadDigest } from './digest.ts'
import { CanvasCacheConflict, type CanvasDocumentPatch, type CanvasEntityPatch, type CanvasPendingNoteDraft, type LocalCanvasRecord } from './persistence.ts'
import { assertCanvasReferences, canvasErrorOf, createCanvasSynchronizer, mergeCanvasGraphs, reachableCanvasGraph, type CanvasSynchronizer } from './sync.ts'
import type {
  AddCanvasExperiment, CanvasAlignment, CanvasClipboard, CanvasComparisonInput,
  CanvasComparisonPatch, CanvasController, CanvasControllerOptions, CanvasDistribution,
  CanvasDocumentState, CanvasDocumentSummary, CanvasInstanceActionArguments,
  CanvasInstanceActionName, CanvasInstanceActionResult, CanvasLayerOperation,
  CanvasNodePatch, CanvasNoteInput, CanvasRosterState, CanvasSaveStatus,
  CanvasNoteDraftState,
} from './types.ts'
import { canvasComparisonAxisSignature, canvasNoteDraftKey } from './types.ts'

interface StableCells {
  readonly summary: SnapshotStore<WorkbenchInstanceSummary | undefined>
  readonly frame: SnapshotStore<WorkspaceFrame | undefined>
}
const isJsonObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
interface InstanceOwner {
  readonly instanceId: string
  readonly key: string
  readonly cells: StableCells
  readonly displays: Set<string>
  readonly invisibleDisplays: Set<string>
  readonly detachments: Map<string, () => void>
  generation: number
  persistedInstance?: ExperimentInstance | undefined
  runtime?: WorkbenchInstanceRuntime | undefined
  loading?: Promise<WorkbenchInstanceRuntime> | undefined
  unsubscribeSummary?: (() => void) | undefined
  unsubscribeFrame?: (() => void) | undefined
  suppressPersistence: boolean
}
type EntityPatch = CanvasEntityPatch
type DocumentPatch = CanvasDocumentPatch
interface DocumentEntry {
  readonly id: string
  readonly namespace: string
  readonly source: SnapshotStore<CanvasDocumentState>
  readonly instanceRegistry: Map<string, InstanceOwner>
  objects: Readonly<Record<string, WorkbenchObject>>
  readonly durableObjects: Set<string>
  record?: LocalCanvasRecord | undefined
  durableRecord?: LocalCanvasRecord | undefined
  noteCheckpoint?: Promise<void> | undefined
  loading: boolean
  loaded: boolean
  loadingPromise?: Promise<void> | undefined
  writing: boolean
  syncing: boolean
  localSaved: boolean
  error?: ReturnType<typeof canvasErrorOf> | undefined
  queue: Promise<void>
  pendingWrites: Set<Promise<unknown>>
  failedWrite?: unknown
  failedBase?: LocalCanvasRecord | undefined
  timer?: unknown
  past: readonly DocumentPatch[]
  future: readonly DocumentPatch[]
}
type NoteNode = Extract<CanvasNode, { readonly kind: 'note' }>
interface NoteOwner {
  readonly key: string
  readonly entry: DocumentEntry
  readonly nodeId: string
  readonly source: SnapshotStore<CanvasNoteDraftState | undefined>
  original: NoteNode
  writerId: string
  revision: number
  body: string
  format: 'plain' | 'markdown'
  baseBody: string
  baseFormat: 'plain' | 'markdown'
  dirty: boolean
  staged: boolean
  saving: boolean
  conflict: boolean
  readonly known: Map<number, { readonly body: string; readonly format: 'plain' | 'markdown' }>
  checkpointRevision?: number | undefined
  storedDraft?: CanvasPendingNoteDraft | undefined
  error?: ReturnType<typeof canvasErrorOf> | undefined
  timer?: unknown
  flushing?: Promise<void> | undefined
  inFlight?: { readonly revision: number; readonly body: string; readonly format: 'plain' | 'markdown' } | undefined
  failedHistory?: string | undefined
  failedParent?: ObjectRef<'history'> | undefined
}
interface ControllerScope {
  readonly namespace: string
  readonly fingerprint: string
  readonly api?: CanvasApi
  readonly sync?: CanvasSynchronizer
  readonly epoch: number
  readonly limits: GraphLimits
}

const emptyObjects: Readonly<Record<string, WorkbenchObject>> = Object.freeze({})
const emptyConflicts: CanvasDocumentState['conflicts'] = Object.freeze([])
const namespaceOf = (account: ReturnType<CanvasControllerOptions['getAccount']>): string => account === undefined
  ? 'guest|local'
  : `${encodeURIComponent(text(account.id, '/account/id', true))}|${encodeURIComponent(text(account.schoolId, '/account/schoolId', true))}`
const fingerprintOf = (account: ReturnType<CanvasControllerOptions['getAccount']>): string => account === undefined
  ? 'anonymous'
  : canonicalStringify({ id: account.id, schoolId: account.schoolId, username: account.username })
const initialDocument = (id: string, namespace?: string): CanvasDocumentState => ({
  canvasId: id, ...(namespace === undefined ? {} : { namespace }), objects: emptyObjects,
  loading: false, status: 'loading', localSaved: false, editSequence: 0,
  acknowledgedSequence: 0, canUndo: false, canRedo: false, conflicts: emptyConflicts,
})
const isJsonRecord = (value: JsonValue | undefined): value is JsonObject =>
  value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
const sameJson = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (left === undefined || right === undefined) return false
  return canonicalStringify(left) === canonicalStringify(right)
}
const shallowFieldsEqual = (left: object, right: object): boolean => {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => Object.is(Reflect.get(left, key), Reflect.get(right, key)))
}
const mergeObjectInventory = (
  current: Readonly<Record<string, WorkbenchObject>>, incoming: Readonly<Record<string, WorkbenchObject>>,
): Readonly<Record<string, WorkbenchObject>> => {
  const changes = Object.entries(incoming).filter(([digest, object]) => current[digest] !== object)
  if (changes.length === 0) return current
  const next = { ...current }
  for (const [digest, object] of changes) next[digest] = object
  return next
}
const entityCollections = ['nodes', 'edges', 'instances', 'snapshots', 'comparisons'] as const
const entityId = (collection: EntityPatch['collection'], entity: JsonObject): string =>
  text(entity[collection === 'instances' ? 'instanceId' : 'id'], '/entity/id', true)
const entityList = (manifest: JsonObject, collection: EntityPatch['collection']): readonly JsonObject[] =>
  list(manifest[collection], `/${collection}`, jsonObject)
const diffFields = (before: JsonObject, after: JsonObject, path: readonly string[] = []): EntityPatch['fields'] => {
  const fields: EntityPatch['fields'][number][] = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const left = before[key]
    const right = after[key]
    if (sameJson(left, right)) continue
    if (isJsonRecord(left) && isJsonRecord(right)) fields.push(...diffFields(left, right, [...path, key]))
    else fields.push({ path: [...path, key], ...(left === undefined ? {} : { before: left }), ...(right === undefined ? {} : { after: right }) })
  }
  return fields
}
const documentPatch = (before: CanvasManifest, after: CanvasManifest, label: string): DocumentPatch => {
  const left = copyJsonObject(before)
  const right = copyJsonObject(after)
  const entities: EntityPatch[] = []
  for (const collection of entityCollections) {
    const previous = new Map(entityList(left, collection).map(entity => [entityId(collection, entity), entity]))
    const next = new Map(entityList(right, collection).map(entity => [entityId(collection, entity), entity]))
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const oldEntity = previous.get(id)
      const newEntity = next.get(id)
      if (sameJson(oldEntity, newEntity)) continue
      entities.push({ collection, id, ...(oldEntity === undefined ? {} : { before: oldEntity }),
        ...(newEntity === undefined ? {} : { after: newEntity }),
        fields: oldEntity === undefined || newEntity === undefined ? [] : diffFields(oldEntity, newEntity) })
    }
  }
  return freezeData({ label, entities, ...(before.title === after.title ? {} : { title: { before: before.title, after: after.title } }) })
}
const setJsonPath = (input: JsonObject, path: readonly string[], value: JsonValue | undefined): JsonObject => {
  const key = path[0]
  if (key === undefined) return input
  const next: Record<string, JsonValue> = { ...input }
  if (path.length === 1) {
    if (value === undefined) delete next[key]
    else next[key] = value
  } else {
    const child = input[key]
    if (!isJsonRecord(child)) fail('/history', 'patch', 'The document field to undo no longer has its original shape.')
    next[key] = setJsonPath(child, path.slice(1), value)
  }
  return next
}
const applyDocumentPatch = (manifest: CanvasManifest, patch: DocumentPatch, reverse: boolean): CanvasManifest => {
  const working: Record<string, JsonValue> = { ...copyJsonObject(manifest) }
  for (const collection of entityCollections) {
    const entities = new Map(entityList(working, collection).map(entity => [entityId(collection, entity), entity]))
    for (const change of patch.entities.filter(entity => entity.collection === collection)) {
      const target = reverse ? change.before : change.after
      if (change.before === undefined || change.after === undefined) {
        if (target === undefined) entities.delete(change.id)
        else entities.set(change.id, target)
      } else {
        let current = entities.get(change.id)
        if (current === undefined) fail('/history', 'patch', 'The document item to undo has been removed in another edit.')
        for (const field of change.fields) current = setJsonPath(current, field.path, reverse ? field.before : field.after)
        entities.set(change.id, current)
      }
    }
    working[collection] = [...entities.values()]
  }
  if (patch.title !== undefined) working.title = reverse ? patch.title.before : patch.title.after
  return unwrap(parseManifest(working))
}
const refreshRemovedEntities = (manifest: CanvasManifest, patch: DocumentPatch, reverse: boolean): DocumentPatch => {
  const input = copyJsonObject(manifest)
  return { ...patch, entities: patch.entities.map(change => {
    const removes = reverse ? change.before === undefined : change.after === undefined
    if (!removes) return change
    const current = entityList(input, change.collection).find(value => entityId(change.collection, value) === change.id)
    if (current === undefined) return change
    return reverse ? { ...change, after: current } : { ...change, before: current }
  }) }
}
const withoutGroup = (node: CanvasNode): CanvasNode => {
  const { groupId: _group, ...retained } = node
  return retained
}
const defaultLayout = (manifest: CanvasManifest, partial: Partial<CanvasLayout> = {}): CanvasLayout => ({
  x: 80 + (manifest.nodes.length % 3) * 660, y: 80 + Math.floor(manifest.nodes.length / 3) * 500,
  width: 620, height: 440, zIndex: manifest.nodes.reduce((value, node) => Math.max(value, node.layout.zIndex), 0) + 1,
  ...partial,
})
const sceneObject = (objects: Readonly<Record<string, WorkbenchObject>>, reference: ObjectRef<'scene'>): PhysicsScene => {
  const object = objects[reference.digest]
  if (object?.kind !== 'scene') fail('/instances', 'reference', 'The instance scene has not been loaded or has the wrong kind.')
  return object.scene
}
const runtimeMetadata = (instance: ExperimentInstance): { readonly history?: JsonValue; readonly draft?: JsonValue } => {
  const input = instance.metadata?.physicsosWorkbenchRuntime
  if (input === undefined) return {}
  const value = record(input, '/metadata/physicsosWorkbenchRuntime')
  exactKeys(value, ['schemaVersion', 'history', 'draft'], '/metadata/physicsosWorkbenchRuntime')
  if (integer(value.schemaVersion, '/metadata/physicsosWorkbenchRuntime/schemaVersion', 1) !== 1) {
    fail('/metadata/physicsosWorkbenchRuntime', 'schema', 'Unsupported persisted workbench runtime state.')
  }
  return { ...(value.history === undefined ? {} : { history: jsonValue(value.history) }),
    ...(value.draft === undefined ? {} : { draft: jsonValue(value.draft) }) }
}

/** Factory-owned business objects and stable sources; no React, ctx, engine imports, or singleton. */
export function createCanvasController(options: CanvasControllerOptions): CanvasController {
  const now = options.now ?? (() => new Date().toISOString())
  const id = options.id ?? canvasId
  const hashing = createCanvasDigest(options.hash ?? payloadDigest)
  const hash = hashing.digest
  const sameJson = (left: unknown, right: unknown): boolean => Object.is(left, right) ||
    left !== undefined && right !== undefined && hashing.stringify(left) === hashing.stringify(right)
  const online = options.online ?? (() => typeof navigator === 'undefined' || navigator.onLine)
  const schedule = options.schedule ?? ((callback: () => void, milliseconds: number) => globalThis.setTimeout(callback, milliseconds))
  const cancel = options.cancel ?? ((handle: unknown) => { if (typeof handle === 'number') globalThis.clearTimeout(handle) })
  const browserWindow = options.window === null ? undefined : options.window ?? (typeof window === 'undefined' ? undefined : window)
  const browserDocument = options.document === null ? undefined : options.document ?? (typeof document === 'undefined' ? undefined : document)
  const roster = createSnapshotStore<CanvasRosterState>({ items: [], documents: [], loading: true, authScope: 'anonymous' })
  const entries = new Map<string, DocumentEntry>()
  const cells = new Map<string, StableCells>()
  const instanceLocations = new Map<string, { readonly entry: DocumentEntry; readonly instanceId: string }>()
  const heads = new Map<string, Map<string, CanvasHead>>()
  const notes = new Map<string, NoteOwner>()
  const fallbackLimits = readCanvasResourcePolicy({ schemaVersion: 1, limits: { ...GRAPH_LIMITS, ...options.graphLimits } }).limits
  const policies = new Map<string, GraphLimits>()
  const limitsFor = (namespace: string): GraphLimits => policies.get(namespace) ?? fallbackLimits
  const noteCells = new Map<string, SnapshotStore<CanvasNoteDraftState | undefined>>()
  const noteViews = new Map<string, ReturnType<CanvasController['noteDraftSource']>>()
  const verificationTasks = new Map<string, Promise<CanvasVerificationResponse>>()
  let scope: ControllerScope | undefined
  let epoch = 0
  let paused = false
  let disposed = false
  let visible = browserDocument?.visibilityState !== 'hidden'
  let clipboard: CanvasClipboard | undefined
  let activating: Promise<void> = Promise.resolve()
  let channel: BroadcastChannel | undefined
  let rootLoading = false
  let rootError: ReturnType<typeof canvasErrorOf> | undefined
  const publishRootState = (next: CanvasRosterState): void => {
    if (!sameJson(roster.getSnapshot(), next)) roster.set(next)
  }
  const report = (error: unknown): void => { try { options.onError?.(error) } catch { /* An observer cannot reject another document edit. */ } }
  const keyOf = (namespace: string, canvas: string, instance?: string): string => canonicalStringify(
    instance === undefined ? [namespace, canvas] : [namespace, canvas, instance],
  )
  const currentScope = (): ControllerScope => {
    if (disposed) throw new Error('CANVAS_CONTROLLER_DISPOSED')
    if (scope === undefined || paused || scope.fingerprint !== fingerprintOf(options.getAccount())) {
      if (!paused && scope !== undefined) pauseScope()
      throw new CanvasRequestError(401, 'CANVAS_ACCOUNT_CHANGED', 'The previous account canvas draft is retained but hidden.', undefined, false)
    }
    return scope
  }
  const entryNotes = (entry: DocumentEntry): NoteOwner[] => [...notes.values()].filter(owner => owner.entry === entry)
  const noteState = (owner: NoteOwner): CanvasNoteDraftState => ({ body: owner.body, format: owner.format,
    revision: owner.revision, dirty: owner.dirty, saving: owner.saving, conflict: owner.conflict,
    ...(owner.error === undefined ? {} : { error: owner.error }) })
  const publishNote = (owner: NoteOwner): void => {
    const shown = !disposed && !paused && scope?.namespace === owner.entry.namespace &&
      scope?.fingerprint === fingerprintOf(options.getAccount())
    const next = shown ? noteState(owner) : undefined
    if (!sameJson(next, owner.source.getSnapshot())) owner.source.set(next)
  }
  const ensureNote = (entry: DocumentEntry, node: NoteNode, pending?: CanvasPendingNoteDraft): NoteOwner => {
    const key = canvasNoteDraftKey(entry.namespace, entry.id, node.id)
    const existing = notes.get(key)
    if (existing !== undefined) return existing
    let source = noteCells.get(key)
    if (source === undefined) { source = createSnapshotStore<CanvasNoteDraftState | undefined>(undefined); noteCells.set(key, source) }
    const body = pending?.body ?? node.body
    const format = pending?.format ?? node.format
    const baseBody = pending?.baseBody ?? node.body
    const baseFormat = pending?.baseFormat ?? node.format
    const owner: NoteOwner = { key, entry, nodeId: node.id, source, original: node,
      writerId: pending?.writerId ?? id('note-writer'), revision: pending?.revision ?? 0,
      body, format, baseBody, baseFormat, dirty: body !== baseBody || format !== baseFormat, staged: pending !== undefined, saving: false, conflict: false,
      known: new Map([[pending?.revision ?? 0, { body, format }]]), ...(pending === undefined ? {} : { storedDraft: pending }) }
    notes.set(key, owner)
    publishNote(owner)
    return owner
  }
  const draftJson = (owner: NoteOwner): CanvasPendingNoteDraft => ({ nodeId: owner.nodeId, writerId: owner.writerId,
    revision: owner.revision, body: owner.body, format: owner.format, baseBody: owner.baseBody, baseFormat: owner.baseFormat })
  const projectNotes = (entry: DocumentEntry, value: LocalCanvasRecord): LocalCanvasRecord => {
    const owners = entryNotes(entry)
    let nodes = value.working.nodes
    for (const owner of owners) {
      if (!owner.dirty && !owner.staged) continue
      const existing = nodes.find(node => node.id === owner.nodeId)
      if (existing?.kind === 'note') {
        if (existing.body !== owner.body || existing.format !== owner.format) nodes = nodes.map(node => node.id === owner.nodeId
          ? { ...existing, body: owner.body, format: owner.format } : node)
      } else if (owner.dirty) nodes = [...nodes, { ...owner.original, body: owner.body, format: owner.format }]
    }
    const working = nodes === value.working.nodes ? value.working : { ...value.working, nodes }
    const pending = owners.filter(owner => owner.dirty).map(draftJson)
    const { pendingNoteDrafts: _pending, ...retained } = value
    return { ...retained, working, ...(pending.length === 0 ? {} : { pendingNoteDrafts: pending }),
      ...(value.conflict === undefined ? {} : { conflict: { ...value.conflict, local: working } }),
      ...(value.localConflict === undefined ? {} : { localConflict: { ...value.localConflict, local: working } }) }
  }
  const adoptNotes = (entry: DocumentEntry, value: LocalCanvasRecord): { readonly value: LocalCanvasRecord; readonly saved: boolean } => {
    for (const node of value.working.nodes) if (node.kind === 'note') ensureNote(entry, node,
      value.pendingNoteDrafts?.find(draft => draft.nodeId === node.id))
    let saved = true
    const conflicts: CanvasDocumentState['conflicts'][number][] = []
    let beforeNodes = value.working.nodes
    for (const owner of entryNotes(entry)) {
      const node = value.working.nodes.find(node => node.id === owner.nodeId)
      const pending = value.pendingNoteDrafts?.find(draft => draft.nodeId === owner.nodeId &&
        (draft.body !== draft.baseBody || draft.format !== draft.baseFormat))
      if (node?.kind === 'note') owner.original = node
      if (owner.dirty) {
        const known = pending === undefined ? undefined : owner.known.get(pending.revision)
        const stored = owner.storedDraft
        const ownPending = pending?.writerId === owner.writerId && pending.revision <= owner.revision &&
          node?.kind === 'note' && (node.body === pending.body && node.format === pending.format ||
            node.body === pending.baseBody && node.format === pending.baseFormat) &&
          (known?.body === pending.body && known?.format === pending.format ||
            stored?.revision === pending.revision && stored.writerId === pending.writerId && stored.body === pending.body && stored.format === pending.format)
        if (ownPending) owner.storedDraft = pending
        const ownFinal = node?.kind === 'note' && owner.inFlight !== undefined &&
          node.body === owner.inFlight.body && node.format === owner.inFlight.format
        const unchanged = node?.kind === 'note' && node.body === owner.baseBody && node.format === owner.baseFormat
        const matches = node?.kind === 'note' && node.body === owner.body && node.format === owner.format
        if (pending === undefined && matches && !ownFinal) {
          owner.baseBody = owner.body; owner.baseFormat = owner.format; owner.dirty = false; owner.staged = false; owner.conflict = false; owner.error = undefined
        } else if (!ownPending && !ownFinal && !unchanged && !matches) {
          owner.conflict = true
          const local = { body: owner.body, format: owner.format }
          const base = { body: owner.baseBody, format: owner.baseFormat }
          conflicts.push({ path: `/nodes/${owner.nodeId.replaceAll('~', '~0').replaceAll('/', '~1')}`,
            kind: node === undefined ? 'delete-modify' : 'value', base, local,
            ...(node?.kind === 'note' ? { remote: { body: node.body, format: node.format } } : {}),
            message: 'This note changed elsewhere while its local draft was retained.' })
          beforeNodes = beforeNodes.filter(node => node.id !== owner.nodeId)
          beforeNodes = [...beforeNodes, { ...owner.original, body: owner.baseBody, format: owner.baseFormat }]
        }
        if (!(matches || pending?.body === owner.body && pending.format === owner.format)) saved = false
      } else if (node?.kind === 'note' && owner.inFlight !== undefined && node.body === owner.inFlight.body &&
        node.format === owner.inFlight.format && pending?.body === pending?.baseBody && pending?.format === pending?.baseFormat) {
        owner.body = node.body; owner.format = node.format; owner.baseBody = node.body; owner.baseFormat = node.format; owner.staged = false
      } else if (pending !== undefined && pending.writerId === owner.writerId && pending.revision < owner.revision) {
        saved = false // An old checkpoint cannot revive text which was explicitly discarded.
      } else if (pending !== undefined) {
        owner.writerId = pending.writerId; owner.revision = Math.max(owner.revision, pending.revision)
        owner.body = pending.body; owner.format = pending.format; owner.baseBody = pending.baseBody; owner.baseFormat = pending.baseFormat
        owner.dirty = owner.body !== owner.baseBody || owner.format !== owner.baseFormat; owner.staged = owner.dirty; owner.conflict = false
        rememberNote(owner)
      } else if (node?.kind === 'note') {
        owner.body = node.body; owner.format = node.format; owner.baseBody = node.body; owner.baseFormat = node.format
        owner.staged = false; owner.conflict = false; owner.error = undefined
      } else {
        if (owner.timer !== undefined) cancel(owner.timer)
        notes.delete(owner.key); owner.source.set(undefined)
      }
      const path = `/nodes/${owner.nodeId.replaceAll('~', '~0').replaceAll('/', '~1')}`
      if ([...(value.conflict?.conflicts ?? []), ...(value.localConflict?.conflicts ?? [])].some(conflict => conflict.path === path || conflict.path.startsWith(`${path}/`))) owner.conflict = true
      publishNote(owner)
      if (owner.dirty && owner.timer === undefined && owner.flushing === undefined) scheduleNote(owner)
    }
    let projected = projectNotes(entry, value)
    if (conflicts.length > 0 && value.conflict === undefined && value.localConflict === undefined) projected = { ...projected,
      localConflict: { base: { ...value.working, nodes: beforeNodes }, local: projected.working, remote: value.working,
        remoteCacheVersion: value.cacheVersion, conflicts } }
    return { value: projected, saved }
  }
  const statusOf = (entry: DocumentEntry): CanvasSaveStatus => {
    if (paused || scope?.namespace !== entry.namespace) return 'auth-required'
    if (entry.loading) return 'loading'
    if (entry.writing || entryNotes(entry).some(owner => owner.saving)) return 'saving-local'
    if (entry.error !== undefined) return 'error'
    if (entry.record?.conflict !== undefined || entry.record?.localConflict !== undefined) return 'conflict'
    if (entry.record?.error !== undefined) return 'error'
    if (entry.record?.deleted) return 'deleted'
    if (entryNotes(entry).some(owner => owner.dirty)) return entry.localSaved ? 'local-saved' : 'unsaved'
    if (entry.syncing) return 'syncing'
    if (!entry.localSaved) return 'unsaved'
    if (entry.record?.head !== undefined && entry.record.pending === undefined && entry.record.base !== undefined &&
      entry.record.acknowledgedSequence === entry.record.editSequence && sameJson(entry.record.working, entry.record.base)) return 'saved'
    return 'local-saved'
  }
  const summaryOf = (entry: DocumentEntry): CanvasDocumentSummary | undefined => entry.record === undefined ? undefined : ({
    id: entry.id, title: entry.record.working.title, createdAt: entry.record.head?.createdAt ?? entry.record.working.createdAt,
    updatedAt: entry.record.working.updatedAt,
    deleted: entry.record.deleted, status: statusOf(entry), ...(entry.record.head === undefined ? {} : { head: entry.record.head }),
  })
  const publishRoster = (): void => {
    if (paused || scope === undefined || scope.fingerprint !== fingerprintOf(options.getAccount())) {
      publishRootState({ items: [], documents: [], loading: rootLoading,
        authScope: paused ? 'paused' : 'anonymous', ...(rootError === undefined ? {} : { error: rootError }) })
      return
    }
    const serverHeads = heads.get(scope.namespace) ?? new Map<string, CanvasHead>()
    const documents = new Map<string, CanvasDocumentSummary>()
    for (const head of serverHeads.values()) documents.set(head.id, { id: head.id, title: head.title, createdAt: head.createdAt, updatedAt: head.updatedAt,
      deleted: head.deletedAt !== undefined, head, status: head.deletedAt === undefined ? 'saved' : 'deleted' })
    for (const entry of entries.values()) {
      if (entry.namespace !== scope.namespace) continue
      const summary = summaryOf(entry)
      if (summary !== undefined) documents.set(entry.id, summary)
    }
    publishRootState({ items: [...serverHeads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      documents: [...documents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), loading: rootLoading,
      namespace: scope.namespace, authScope: scope.api === undefined ? 'anonymous' : 'authenticated',
      ...(rootError === undefined ? {} : { error: rootError }) })
  }
  const publishDocument = (entry: DocumentEntry): void => {
    const shown = !paused && scope?.namespace === entry.namespace && scope?.fingerprint === fingerprintOf(options.getAccount())
    const value = entry.record
    const error = entry.error ?? value?.error
    const next: CanvasDocumentState = shown ? {
      canvasId: entry.id, namespace: entry.namespace, objects: entry.objects,
      ...(value === undefined ? {} : { manifest: value.working, ...(value.head === undefined ? {} : { head: value.head }), savedAt: value.savedAt }),
      loading: entry.loading, status: statusOf(entry), localSaved: entry.localSaved && !entry.writing && !entryNotes(entry).some(owner => owner.saving),
      editSequence: value?.editSequence ?? 0, acknowledgedSequence: value?.acknowledgedSequence ?? 0,
      canUndo: entry.past.length > 0, canRedo: entry.future.length > 0, conflicts: value?.conflict?.conflicts ?? value?.localConflict?.conflicts ?? emptyConflicts,
      noteDrafts: Object.fromEntries(entryNotes(entry).map(owner => [owner.nodeId, noteState(owner)])),
      ...(error === undefined ? {} : { error }),
    } : { ...initialDocument(entry.id), status: 'auth-required', ...(error === undefined ? {} : { error }) }
    const previous = entry.source.getSnapshot()
    if (!shallowFieldsEqual(next, previous)) entry.source.set(next)
    publishRoster()
  }
  const entryOf = (canvas: string, namespace = currentScope().namespace): DocumentEntry => {
    text(canvas, '/canvasId', true)
    const key = keyOf(namespace, canvas)
    const existing = entries.get(key)
    if (existing !== undefined) return existing
    const entry: DocumentEntry = {
      id: canvas, namespace, source: createSnapshotStore(initialDocument(canvas, namespace)), instanceRegistry: new Map(),
      objects: emptyObjects, durableObjects: new Set(), loading: false, loaded: false, writing: false, syncing: false, localSaved: false,
      queue: Promise.resolve(), pendingWrites: new Set(), past: [], future: [],
    }
    entries.set(key, entry)
    return entry
  }
  const createStableCells = (entry: DocumentEntry, instanceId: string): InstanceOwner => {
    const existing = entry.instanceRegistry.get(instanceId)
    if (existing !== undefined) return existing
    const key = keyOf(entry.namespace, entry.id, instanceId)
    let stable = cells.get(key)
    if (stable === undefined) {
      stable = { summary: createSnapshotStore<WorkbenchInstanceSummary | undefined>(undefined),
        frame: createSnapshotStore<WorkspaceFrame | undefined>(undefined) }
      cells.set(key, stable)
    }
    const owner: InstanceOwner = { instanceId, key, cells: stable, displays: new Set(), invisibleDisplays: new Set(), detachments: new Map(), generation: 0, suppressPersistence: false }
    entry.instanceRegistry.set(instanceId, owner)
    instanceLocations.set(key, { entry, instanceId })
    return owner
  }
  const disposeOwner = (owner: InstanceOwner): void => {
    owner.generation += 1
    owner.unsubscribeFrame?.()
    owner.unsubscribeSummary?.()
    owner.unsubscribeFrame = undefined
    owner.unsubscribeSummary = undefined
    for (const detach of owner.detachments.values()) detach()
    owner.detachments.clear()
    owner.runtime?.dispose()
    owner.runtime = undefined
    owner.loading = undefined
    owner.persistedInstance = undefined
    owner.cells.summary.set(undefined)
    owner.cells.frame.set(undefined)
  }
  const adoptRecord = (entry: DocumentEntry, value: LocalCanvasRecord, objects: Readonly<Record<string, WorkbenchObject>> = {}): void => {
    if (value.namespace !== entry.namespace || value.id !== entry.id) throw new Error('CANVAS_ACCOUNT_MISMATCH')
    if (entry.record !== undefined && value.cacheVersion < entry.record.cacheVersion) return
    if (value.head !== undefined && value.base !== undefined && value.pending === undefined && value.editSequence === value.acknowledgedSequence &&
      value.working !== value.base && sameJson(value.working, value.base)) value = { ...value, working: value.base }
    entry.durableRecord = value
    for (const digest of Object.keys(objects)) entry.durableObjects.add(digest)
    const noteProjection = adoptNotes(entry, value)
    entry.record = noteProjection.value
    entry.objects = mergeObjectInventory(entry.objects, objects)
    if (!entry.writing) entry.failedBase = undefined
    entry.localSaved = noteProjection.saved
    entry.past = value.documentHistory?.past ?? []
    entry.future = value.documentHistory?.future ?? []
    entry.error = undefined
    if (value.head !== undefined) {
      let known = heads.get(entry.namespace)
      if (known === undefined) { known = new Map(); heads.set(entry.namespace, known) }
      known.set(entry.id, value.head)
    }
    // Families exist before a roster/document publication can make new cards render.
    for (const instance of value.working.instances) createStableCells(entry, instance.instanceId)
    for (const [instanceId, owner] of entry.instanceRegistry) {
      if (value.deleted || !value.working.instances.some(instance => instance.instanceId === instanceId)) {
        disposeOwner(owner)
        entry.instanceRegistry.delete(instanceId)
      }
    }
    publishDocument(entry)
  }
  const enqueue = <T>(entry: DocumentEntry, operation: () => Promise<T>): Promise<T> => {
    const promise = entry.queue.then(operation)
    entry.pendingWrites.add(promise)
    entry.queue = promise.then(() => undefined, error => { entry.failedWrite = error; report(error) })
    void promise.then(() => { entry.pendingWrites.delete(promise) }, () => { entry.pendingWrites.delete(promise) })
    return promise
  }
  const hint = (entry: DocumentEntry): void => {
    try { channel?.postMessage({ namespace: entry.namespace, id: entry.id, cacheVersion: entry.record?.cacheVersion }) } catch (error) { report(error) }
  }
  const scheduleSync = (entry: DocumentEntry): void => {
    if (entry.timer !== undefined) cancel(entry.timer)
    if (disposed || paused || scope?.namespace !== entry.namespace || scope.sync === undefined) return
    entry.timer = schedule(() => {
      entry.timer = undefined
      void controller.sync(entry.id).catch(report)
    }, 450)
  }
  const commitLocal = async (
    entry: DocumentEntry, original: LocalCanvasRecord, candidate: LocalCanvasRecord,
    objects: Readonly<Record<string, WorkbenchObject>>,
  ): Promise<LocalCanvasRecord> => {
    const { validateGraph } = await import('@physicsos/physics-workbench/graph')
    const closure = reachableCanvasGraph(candidate.working, { ...entry.objects, ...objects })
    const validated = unwrap(validateGraph(closure.manifest, closure.objects, limitsFor(entry.namespace)))
    candidate = { ...candidate, working: validated.manifest }
    objects = Object.fromEntries(Object.entries(objects).map(([digest, object]) => [digest, validated.objects[digest] ?? object]))
    // Keep the losslessly validated canonical objects for subsequent metadata edits;
    // policy totals and graph relationships are still checked by every validation.
    entry.objects = mergeObjectInventory(entry.objects, validated.objects)
    entry.writing = true
    entry.localSaved = false
    for (const node of candidate.working.nodes) if (node.kind === 'note') ensureNote(entry, node,
      candidate.pendingNoteDrafts?.find(draft => draft.nodeId === node.id))
    entry.record = projectNotes(entry, candidate)
    entry.objects = mergeObjectInventory(entry.objects, objects)
    publishDocument(entry)
    let previous = original
    let next: LocalCanvasRecord = { ...candidate,
      ...(original.pending !== undefined && original.error?.retryable === false &&
        candidate.pending?.request.mutationId === original.pending.request.mutationId ? { error: original.error } : {}),
      ...(candidate.conflict === undefined ? {} : { conflict: { ...candidate.conflict, local: candidate.working } }),
      ...(candidate.localConflict === undefined ? {} : { localConflict: { ...candidate.localConflict, local: candidate.working } }),
    }
    try {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        try {
          const saved = await options.persistence.save(next, objects, previous.cacheVersion)
          entry.writing = false
          entry.failedWrite = undefined
          adoptRecord(entry, saved, objects)
          hint(entry)
          scheduleSync(entry)
          return saved
        } catch (error) {
          if (!(error instanceof CanvasCacheConflict) || error.current === undefined) throw error
          const latest = error.current
          if (previous.head === undefined && latest.head !== undefined && previous.working.createdAt !== latest.working.createdAt) {
            previous = { ...previous, working: unwrap(parseManifest({ ...previous.working, createdAt: latest.working.createdAt })) }
            next = { ...next, working: unwrap(parseManifest({ ...next.working, createdAt: latest.working.createdAt })) }
          }
          const inventory = { ...await options.persistence.objects(entry.namespace, entry.id), ...entry.objects, ...objects }
          const merged = await mergeCanvasGraphs(previous.working, next.working, latest.working, inventory, hash, now, id, limitsFor(entry.namespace))
          if (merged.manifest === undefined) {
            const { pendingNoteDrafts: _peerDrafts, ...latestFields } = latest
            const conflicted: LocalCanvasRecord = { ...latestFields, working: next.working, editSequence: latest.editSequence + 1,
              ...(next.pendingNoteDrafts === undefined ? {} : { pendingNoteDrafts: next.pendingNoteDrafts }),
              ...(next.documentHistory === undefined ? {} : { documentHistory: next.documentHistory }),
              localConflict: { base: previous.working, local: next.working, remote: latest.working,
                remoteCacheVersion: latest.cacheVersion, conflicts: merged.conflicts }, savedAt: now() }
            try {
              const saved = await options.persistence.save(conflicted, merged.objects, latest.cacheVersion)
              entry.writing = false; entry.failedWrite = undefined
              adoptRecord(entry, saved, merged.objects); hint(entry)
              return saved
            } catch (conflictError) {
              if (!(conflictError instanceof CanvasCacheConflict) || conflictError.current === undefined) throw conflictError
              previous = latest
              next = { ...next, cacheVersion: latest.cacheVersion }
              continue
            }
          }
          objects = merged.objects
          if (previous.deleted !== next.deleted && previous.deleted !== latest.deleted && next.deleted !== latest.deleted) throw error
          const combined = { ...latest, working: merged.manifest,
            pendingNoteDrafts: [...new Map([...(latest.pendingNoteDrafts ?? []), ...(next.pendingNoteDrafts ?? [])].map(draft => [draft.nodeId, draft])).values()],
            ...(next.documentHistory === undefined ? {} : { documentHistory: next.documentHistory }),
            editSequence: latest.editSequence + 1, deleted: previous.deleted === next.deleted ? latest.deleted : next.deleted,
            savedAt: now() }
          const { error: permanentError, ...retained } = combined
          next = { ...retained, ...(latest.pending !== undefined && permanentError?.retryable === false ? { error: permanentError } : {}) }
          previous = latest
          entry.record = next
          entry.objects = { ...await options.persistence.objects(entry.namespace, entry.id), ...entry.objects, ...objects }
        }
      }
      throw new CanvasCacheConflict(await options.persistence.read(entry.namespace, entry.id))
    } catch (error) {
      entry.writing = false
      entry.localSaved = false
      entry.error = canvasErrorOf(error)
      entry.failedWrite = error
      entry.failedBase = original
      publishDocument(entry)
      throw error
    }
  }
  const appendHistory = async (
    manifest: CanvasManifest, objects: Readonly<Record<string, WorkbenchObject>>, patch: DocumentPatch,
  ): Promise<{ readonly manifest: CanvasManifest; readonly objects: Readonly<Record<string, WorkbenchObject>> }> => {
    const entries: HistoryEntry[] = []
    const at = now()
    const operation = patch.label === 'capture' ? 'capture' : patch.label === 'remove' ? 'remove'
      : patch.label === 'duplicate' || patch.label === 'paste' ? 'clone' : patch.label === 'import' ? 'import' : 'edit'
    for (const change of patch.entities) {
      if (change.collection === 'instances') {
        const value = change.after ?? change.before
        if (value === undefined) continue
        const instance = manifest.instances.find(item => item.instanceId === change.id)
        const source = instance ?? readExperimentInstance(value)
        if (source === undefined) continue
        entries.push({ id: id('history-entry'), instanceId: source.instanceId, scene: source.currentScene, at, operation,
          details: copyJsonObject({ label: patch.label, source: source.source }) })
        if (source.originScene.digest !== source.currentScene.digest) entries.push({ id: id('history-entry'), instanceId: source.instanceId,
          scene: source.originScene, at, operation, details: { label: patch.label, role: 'origin' } })
      } else if (change.collection === 'snapshots') {
        const target = change.after ?? change.before
        if (target === undefined) continue
        const reference = record(target.snapshot, '/snapshot/ref')
        entries.push({ id: id('history-entry'), snapshot: { kind: 'snapshot', digest: text(reference.digest, '/snapshot/ref/digest') },
          at, operation, details: { label: patch.label } })
      }
    }
    entries.push({ id: id('history-entry'), at, operation, details: copyJsonObject({ label: patch.label, documentPatch: patch }) })
    const history = unwrap(parseObject({ schemaVersion: 1, kind: 'history', parents: manifest.history === undefined ? [] : [manifest.history], entries }))
    if (history.kind !== 'history') throw new Error('CANVAS_HISTORY_INVALID')
    const digest = await hash(history)
    return { manifest: unwrap(parseManifest({ ...manifest, history: { kind: 'history', digest } })), objects: { ...objects, [digest]: history } }
  }
  const requireRecord = (entry: DocumentEntry): LocalCanvasRecord => {
    currentScope()
    const value = entry.record
    if (entry.namespace !== scope?.namespace) throw new Error('CANVAS_ACCOUNT_MISMATCH')
    if (value === undefined) throw new Error('CANVAS_NOT_OPEN')
    if (value.deleted) throw new Error('CANVAS_DELETED')
    return value
  }
  const mutate = async (
    entry: DocumentEntry,
    label: string,
    operation: (manifest: CanvasManifest) => CanvasManifest | Promise<CanvasManifest>,
    extraObjects: Readonly<Record<string, WorkbenchObject>> = {},
    history = true,
  ): Promise<void> => enqueue(entry, async () => {
    const original = requireRecord(entry)
    if (!entry.localSaved && entry.failedWrite !== undefined) throw entry.failedWrite
    const updated = unwrap(parseManifest(await operation(original.working)))
    if (updated.id !== entry.id) throw new Error('CANVAS_DOCUMENT_MISMATCH')
    if (sameJson(updated, original.working)) return
    let working = unwrap(parseManifest({ ...updated, updatedAt: now() }))
    let objects = extraObjects
    const patch = history ? documentPatch(original.working, working, label) : undefined
    if (history && patch !== undefined) {
      const recorded = await appendHistory(working, objects, patch)
      working = recorded.manifest
      objects = recorded.objects
    }
    assertCanvasReferences(working, mergeObjectInventory(entry.objects, objects))
    const { error: oldError, ...retained } = original
    await commitLocal(entry, original, { ...retained,
      ...(original.pending !== undefined && oldError?.retryable === false ? { error: oldError } : {}),
      ...(patch === undefined ? {} : { documentHistory: { schemaVersion: 1, past: [...entry.past, patch], future: [] } }),
      working, editSequence: original.editSequence + 1, savedAt: now() }, objects)
    publishDocument(entry)
  })
  const rememberNote = (owner: NoteOwner, revision = owner.revision, body = owner.body, format = owner.format): void => {
    owner.known.set(revision, { body, format })
    for (const key of owner.known.keys()) if (key !== owner.revision && key !== owner.checkpointRevision && key !== owner.inFlight?.revision) owner.known.delete(key)
  }
  const lookupNote = (key: string): NoteOwner => {
    const current = currentScope()
    const owner = notes.get(key)
    if (owner === undefined) throw new Error('CANVAS_NOTE_MISSING')
    if (owner.entry.namespace !== current.namespace) throw new CanvasRequestError(401, 'CANVAS_ACCOUNT_CHANGED',
      'The previous account note draft is retained but cannot be edited by this account.', undefined, false)
    if (owner.entry.record?.deleted) throw new Error('CANVAS_DELETED')
    return owner
  }
  const resetFailedNoteHistory = (entry: DocumentEntry, working: CanvasManifest): CanvasManifest => {
    const owner = entryNotes(entry).find(note => note.failedHistory !== undefined && working.history?.digest === note.failedHistory)
    if (owner === undefined) return working
    const { history: _history, ...retained } = working
    return { ...retained, ...(owner.failedParent === undefined ? {} : { history: owner.failedParent }) }
  }
  const noteObjects = (entry: DocumentEntry, working: CanvasManifest,
    extra: Readonly<Record<string, WorkbenchObject>> = {}): Readonly<Record<string, WorkbenchObject>> => {
    const graph = reachableCanvasGraph(working, { ...entry.objects, ...extra })
    return Object.fromEntries(Object.entries(graph.objects).filter(([digest]) => !entry.durableObjects.has(digest)))
  }
  const checkpointNotes = (entry: DocumentEntry, retry = false): Promise<void> => {
    if (entry.noteCheckpoint !== undefined) return entry.noteCheckpoint
    if (disposed || entry.record === undefined || entry.record.deleted || entry.failedWrite !== undefined && !retry) return Promise.resolve()
    if (!entryNotes(entry).some(owner => owner.dirty || owner.staged) && (entry.record.pendingNoteDrafts?.length ?? 0) === 0 &&
      (entry.durableRecord?.pendingNoteDrafts?.length ?? 0) === 0) return Promise.resolve()
    const promise = enqueue(entry, async () => {
      if (!entry.loaded) await loadLocal(entry)
      for (let turn = 0; turn < 16; turn += 1) {
        if (entry.record === undefined || entry.record.deleted || entry.failedWrite !== undefined && !retry) return
        const original = entry.durableRecord ?? entry.failedBase ?? entry.record
        let candidate = projectNotes(entry, entry.record)
        const working = resetFailedNoteHistory(entry, candidate.working)
        if (working !== candidate.working) candidate = { ...candidate, working,
          documentHistory: { schemaVersion: 1, past: entry.past, future: entry.future } }
        const { error: _error, ...retained } = candidate
        candidate = { ...retained, cacheVersion: original.cacheVersion, savedAt: now() }
        if (sameJson(candidate.working, original.working) && sameJson(candidate.pendingNoteDrafts, original.pendingNoteDrafts)) {
          for (const owner of entryNotes(entry)) if (!owner.dirty) { owner.staged = false; publishNote(owner) }
          entry.failedWrite = undefined; entry.error = undefined; entry.failedBase = undefined
          entry.record = projectNotes(entry, original)
          entry.localSaved = true; publishDocument(entry); return
        }
        for (const draft of candidate.pendingNoteDrafts ?? []) {
          const owner = notes.get(canvasNoteDraftKey(entry.namespace, entry.id, draft.nodeId))
          if (owner !== undefined) { owner.checkpointRevision = draft.revision; rememberNote(owner, draft.revision, draft.body, draft.format) }
        }
        await commitLocal(entry, original, candidate, noteObjects(entry, candidate.working))
        for (const owner of entryNotes(entry)) { owner.checkpointRevision = undefined; rememberNote(owner) }
        if (entry.record?.conflict !== undefined || entry.record?.localConflict !== undefined) return
        if (sameJson(entry.record?.pendingNoteDrafts, entry.durableRecord?.pendingNoteDrafts) &&
          sameJson(entry.record?.working, entry.durableRecord?.working)) return
      }
    })
    entry.noteCheckpoint = promise
    void promise.catch(error => {
      for (const owner of entryNotes(entry)) if (owner.dirty) { owner.error = canvasErrorOf(error); owner.checkpointRevision = undefined; publishNote(owner) }
      report(error)
    }).finally(() => { if (entry.noteCheckpoint === promise) entry.noteCheckpoint = undefined })
    return promise
  }
  const scheduleNote = (owner: NoteOwner): void => {
    if (owner.timer !== undefined) cancel(owner.timer)
    owner.timer = undefined
    if (!owner.dirty || owner.conflict || disposed || paused || scope?.namespace !== owner.entry.namespace) return
    owner.timer = schedule(() => {
      owner.timer = undefined
      if (owner.error !== undefined || owner.conflict || disposed || paused || scope?.namespace !== owner.entry.namespace) return
      void flushOwnedNote(owner).catch(report)
    }, 600)
  }
  const flushOwnedNote = (owner: NoteOwner): Promise<void> => {
    if (owner.flushing !== undefined) return owner.flushing
    const task = (async () => {
      lookupNote(owner.key)
      if (owner.timer !== undefined) { cancel(owner.timer); owner.timer = undefined }
      owner.saving = true; owner.error = undefined; publishNote(owner)
      if (!owner.entry.loaded) await openEntry(owner.entry)
      const checkpoint = owner.entry.noteCheckpoint
      if (checkpoint !== undefined) await checkpoint
      while (owner.dirty) {
        lookupNote(owner.key)
        if (owner.conflict) throw new Error('CANVAS_NOTE_DRAFT_CONFLICT')
        await enqueue(owner.entry, async () => {
          const entry = owner.entry
          lookupNote(owner.key)
          if (!owner.dirty) return
          const current = requireRecord(entry)
          const original = entry.durableRecord ?? entry.failedBase ?? current
          const sent = { revision: owner.revision, body: owner.body, format: owner.format }
          owner.inFlight = sent; rememberNote(owner)
          const before = resetFailedNoteHistory(entry, current.working)
          const node = before.nodes.find(node => node.id === owner.nodeId)
          if (node?.kind !== 'note') throw new Error('CANVAS_NOTE_MISSING')
          const baseline = { ...before, nodes: before.nodes.map(value => value.id === owner.nodeId
            ? { ...node, body: owner.baseBody, format: owner.baseFormat } : value) }
          const updated = { ...before, updatedAt: now(), nodes: before.nodes.map(value => value.id === owner.nodeId
            ? { ...node, body: sent.body, format: sent.format } : value) }
          const patch = documentPatch(baseline, updated, 'note')
          const recorded = await appendHistory(updated, {}, patch)
          owner.failedParent = before.history
          owner.failedHistory = recorded.manifest.history?.digest
          const pending = entryNotes(entry).filter(note => note.dirty).map(note =>
            note === owner ? { ...draftJson(note), baseBody: sent.body, baseFormat: sent.format } : draftJson(note))
          const { error: _error, pendingNoteDrafts: _drafts, ...retained } = current
          const saved = await commitLocal(entry, original, { ...retained, cacheVersion: original.cacheVersion,
            working: recorded.manifest, editSequence: current.editSequence + 1, savedAt: now(),
            documentHistory: { schemaVersion: 1, past: [...entry.past, patch], future: [] },
            ...(pending.length === 0 ? {} : { pendingNoteDrafts: pending }) }, noteObjects(entry, recorded.manifest, recorded.objects))
          if (saved.conflict !== undefined || saved.localConflict !== undefined) {
            owner.conflict = true; throw new Error('CANVAS_NOTE_DRAFT_CONFLICT')
          }
          owner.baseBody = sent.body; owner.baseFormat = sent.format
          owner.dirty = owner.body !== sent.body || owner.format !== sent.format
          owner.staged = owner.dirty
          owner.failedHistory = undefined; owner.failedParent = undefined; owner.inFlight = undefined; owner.error = undefined
          if (entry.record !== undefined) entry.record = projectNotes(entry, entry.record)
          publishNote(owner); publishDocument(entry)
          scheduleSync(entry)
        })
      }
      await checkpointNotes(owner.entry, true)
    })()
    const settled = task.then(() => {
      owner.saving = false; if (owner.flushing === settled) owner.flushing = undefined
      publishNote(owner); publishDocument(owner.entry)
    }, error => {
      owner.error = canvasErrorOf(error); owner.inFlight = undefined; owner.saving = false
      if (owner.flushing === settled) owner.flushing = undefined
      publishNote(owner); publishDocument(owner.entry)
      throw error
    })
    owner.flushing = settled
    void settled.catch(report)
    return settled
  }
  const flushEntryNotes = async (entry: DocumentEntry): Promise<void> => {
    for (const owner of entryNotes(entry)) if (owner.dirty) await flushOwnedNote(owner)
    if (entry.noteCheckpoint !== undefined) await entry.noteCheckpoint
    if (!sameJson(entry.record?.pendingNoteDrafts, entry.durableRecord?.pendingNoteDrafts)) await checkpointNotes(entry)
  }
  const acceptNoteChoices = (entry: DocumentEntry, manifest: CanvasManifest): void => {
    for (const owner of entryNotes(entry)) {
      if (owner.timer !== undefined) cancel(owner.timer)
      owner.timer = undefined; owner.revision += 1; owner.dirty = false; owner.staged = false; owner.conflict = false; owner.error = undefined
      const node = manifest.nodes.find(node => node.id === owner.nodeId)
      if (node?.kind === 'note') {
        owner.original = node; owner.body = node.body; owner.format = node.format; owner.baseBody = node.body; owner.baseFormat = node.format
      }
      rememberNote(owner); publishNote(owner)
    }
  }
  const writeRuntimeState = (entry: DocumentEntry, instanceId: string, state: WorkbenchCommittedState, reason: string): Promise<void> =>
    enqueue(entry, async () => {
      const original = entry.record
      if (original === undefined || original.deleted || !original.working.instances.some(instance => instance.instanceId === instanceId)) return
      const stored = original.working.instances.find(instance => instance.instanceId === instanceId)!
      const current = createSceneObject(state.scene)
      const origin = createSceneObject(state.originScene ?? sceneObject(entry.objects, stored.originScene))
      const currentDigest = await hash(current)
      const originDigest = await hash(origin)
      const metadata = copyJsonObject({ ...(stored.metadata ?? {}), physicsosWorkbenchRuntime: {
        schemaVersion: 1, history: state.history, ...(state.draft === undefined ? {} : { draft: state.draft }),
      } })
      const { rendererRelease: _rendererRelease, ...retainedInstance } = stored
      const instance: ExperimentInstance = {
        ...retainedInstance, currentScene: { kind: 'scene', digest: currentDigest }, originScene: { kind: 'scene', digest: originDigest },
        source: state.source, domain: state.domain, buildMode: state.buildMode, clock: state.clock,
        instanceEditRevision: state.instanceEditRevision, metadata,
        ...(state.templateId === undefined ? {} : { templateId: state.templateId }),
        ...(state.scene.metadata.experimentRelease === undefined ? {} : { rendererRelease: state.scene.metadata.experimentRelease }),
      }
      if (sameJson(instance, stored)) return
      let working = unwrap(parseManifest({ ...original.working, updatedAt: now(),
        instances: original.working.instances.map(value => value.instanceId === instanceId ? instance : value) }))
      let objects: Readonly<Record<string, WorkbenchObject>> = { [currentDigest]: current, [originDigest]: origin }
      if (reason === 'commit' && (!sameJson(stored.currentScene, instance.currentScene) || stored.instanceEditRevision !== instance.instanceEditRevision)) {
        const item = await appendHistory(working, objects, documentPatch(original.working, working, 'physical-edit'))
        working = item.manifest
        objects = item.objects
      }
      const { error: oldError, ...retained } = original
      const slot = entry.instanceRegistry.get(instanceId)
      if (slot !== undefined) slot.persistedInstance = instance
      await commitLocal(entry, original, { ...retained,
        ...(original.pending !== undefined && oldError?.retryable === false ? { error: oldError } : {}),
        working, editSequence: original.editSequence + 1, savedAt: now() }, objects)
    })
  const ensureOwner = (entry: DocumentEntry, instanceId: string): Promise<WorkbenchInstanceRuntime> => {
    const current = currentScope()
    if (entry.namespace !== current.namespace) return Promise.reject(new Error('CANVAS_ACCOUNT_MISMATCH'))
    const stored = requireRecord(entry).working.instances.find(instance => instance.instanceId === instanceId)
    if (stored === undefined) return Promise.reject(new Error('CANVAS_INSTANCE_REMOVED'))
    const slot = createStableCells(entry, instanceId)
    if (slot.runtime !== undefined) return Promise.resolve(slot.runtime)
    if (slot.loading !== undefined) return slot.loading
    const generation = ++slot.generation
    slot.persistedInstance = stored
    const state = runtimeMetadata(stored)
    const restoredScene = sceneObject(entry.objects, stored.currentScene)
    const origin = sceneObject(entry.objects, stored.originScene)
    const persist = (value: WorkbenchCommittedState, reason: string): void => {
      if (slot.suppressPersistence || disposed || slot.generation !== generation) return
      void writeRuntimeState(entry, instanceId, value, reason).catch(report)
    }
    const runtimeOptions: CreateWorkbenchInstanceOptions = {
      instanceKey: slot.key, sceneId: String(restoredScene.id), scene: restoredScene, originScene: origin,
      source: stored.source, buildMode: stored.buildMode, clock: stored.clock, instanceEditRevision: stored.instanceEditRevision,
      ...(stored.templateId === undefined ? {} : { templateId: stored.templateId }),
      ...(state.history === undefined ? {} : { persistedHistory: state.history }),
      ...(state.draft === undefined ? {} : { persistedDraft: state.draft }), visible,
      onCommitted: (value, _action) => persist(value, 'commit'), onPersist: persist,
      onError: error => { entry.error = canvasErrorOf(error); publishDocument(entry); report(error) },
    }
    slot.loading = options.createRuntime(runtimeOptions).then(runtime => {
      if (disposed || paused || scope?.namespace !== entry.namespace || slot.generation !== generation ||
        entry.record?.deleted || !entry.record?.working.instances.some(instance => instance.instanceId === instanceId)) {
        runtime.dispose()
        throw new Error('CANVAS_INSTANCE_REMOVED')
      }
      slot.runtime = runtime
      slot.persistedInstance = stored
      slot.loading = undefined
      const shown = (): boolean => !paused && scope?.namespace === entry.namespace &&
        scope?.fingerprint === fingerprintOf(options.getAccount()) && slot.generation === generation
      const publishSummary = (): void => { if (shown()) slot.cells.summary.set(runtime.summaries.getSnapshot()) }
      const publishFrame = (): void => { if (shown()) slot.cells.frame.set(runtime.frames.getSnapshot()) }
      slot.unsubscribeSummary = runtime.summaries.subscribe(publishSummary)
      slot.unsubscribeFrame = runtime.frames.subscribe(publishFrame)
      publishFrame()
      publishSummary()
      for (const display of slot.displays) if (!slot.invisibleDisplays.has(display)) slot.detachments.set(display, runtime.attachDisplay(display))
      return runtime
    }).catch(error => {
      if (slot.generation === generation) {
        slot.loading = undefined
        entry.error = canvasErrorOf(error)
        publishDocument(entry)
      }
      throw error
    })
    return slot.loading
  }
  const startOwners = (entry: DocumentEntry): void => {
    if (!entry.loaded || paused || entry.record?.deleted || scope?.namespace !== entry.namespace) return
    for (const instance of entry.record?.working.instances ?? []) {
      const slot = createStableCells(entry, instance.instanceId)
      if (slot.loading !== undefined && slot.persistedInstance !== undefined && !sameJson(slot.persistedInstance, instance)) {
        disposeOwner(slot)
      }
      if (slot.runtime !== undefined && slot.persistedInstance !== instance) {
        const expected = sceneObject(entry.objects, instance.currentScene)
        const persisted = runtimeMetadata(instance)
        if (!sameJson(copyJsonObject(slot.runtime.getScene()), copyJsonObject(expected)) ||
          (persisted.history !== undefined && !sameJson(copyJsonObject(slot.runtime.serialize().history), persisted.history)) ||
          (slot.persistedInstance !== undefined && (!sameJson(slot.persistedInstance.clock, instance.clock) ||
            slot.persistedInstance.buildMode !== instance.buildMode))) {
          disposeOwner(slot)
        } else slot.persistedInstance = instance
      }
      void ensureOwner(entry, instance.instanceId).catch(report)
    }
  }
  const loadLocal = async (entry: DocumentEntry): Promise<void> => {
    const value = await options.persistence.read(entry.namespace, entry.id)
    if (value === undefined) return
    const objects = await options.persistence.objects(entry.namespace, entry.id)
    const { validateGraph } = await import('@physicsos/physics-workbench/graph')
    const validated = unwrap(validateGraph(value.working, reachableCanvasGraph(value.working, objects).objects, limitsFor(entry.namespace)))
    // The IDB object reader has already checked every blob's hash before exposing it.
    adoptRecord(entry, value, { ...objects, ...validated.objects })
    entry.loaded = true
  }
  const openEntry = async (entry: DocumentEntry): Promise<void> => {
    if (entry.loadingPromise !== undefined) return entry.loadingPromise
    if (entry.loaded) {
      // Reconcile only after preceding owned edits reach the local record.
      // Otherwise a following action can replace its live owner with stale facts.
      await entry.queue
      startOwners(entry)
      return
    }
    entry.loading = true
    publishDocument(entry)
    entry.loadingPromise = (async () => {
      try {
        await loadLocal(entry)
        const current = currentScope()
        if (current.namespace !== entry.namespace) throw new Error('CANVAS_ACCOUNT_MISMATCH')
        if (entry.record === undefined) {
          if (current.api === undefined || current.sync === undefined || !online()) throw new Error('CANVAS_NOT_AVAILABLE_OFFLINE')
          const opened = await current.sync.openRemote(entry.id)
          if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
          const graph = await current.sync.loadGraph(entry.id, opened)
          const value: LocalCanvasRecord = { namespace: entry.namespace, id: entry.id, cacheVersion: 0,
            editSequence: 0, acknowledgedSequence: 0, working: opened.manifest, base: opened.manifest, head: opened.head,
            deleted: opened.head.deletedAt !== undefined, savedAt: now() }
          try { adoptRecord(entry, await options.persistence.save(value, graph.objects, 0), graph.objects) } catch (error) {
            if (!(error instanceof CanvasCacheConflict)) throw error
            await loadLocal(entry)
          }
        }
        entry.loaded = true
        startOwners(entry)
        if (entry.record?.head !== undefined && current.sync !== undefined && online()) {
          void current.sync.refresh(entry.id).then(() => startOwners(entry)).catch(error => {
            if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
            else { entry.error = canvasErrorOf(error); publishDocument(entry); report(error) }
          })
        }
      } catch (error) {
        if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
        entry.error = canvasErrorOf(error)
        publishDocument(entry)
        throw error
      } finally { entry.loading = false; entry.loadingPromise = undefined; publishDocument(entry) }
    })()
    return entry.loadingPromise
  }
  const openForEdit = async (canvas: string): Promise<DocumentEntry> => {
    const fingerprint = fingerprintOf(options.getAccount())
    await activating
    if (fingerprintOf(options.getAccount()) !== fingerprint) throw new CanvasRequestError(401,
      'CANVAS_ACCOUNT_CHANGED', 'The account changed before this canvas action could begin.', undefined, false)
    const entry = entryOf(canvas)
    await openEntry(entry)
    requireRecord(entry)
    return entry
  }
  const createFromGraph = async (graph: CanvasGraph): Promise<string> => {
    const current = currentScope()
    const { verifyGraphDigests } = await import('@physicsos/physics-workbench/graph')
    unwrap(await verifyGraphDigests(graph, canonical => hash(JSON.parse(canonical)), limitsFor(current.namespace)))
    if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
    const entry = entryOf(graph.manifest.id)
    const value: LocalCanvasRecord = { namespace: current.namespace, id: graph.manifest.id, cacheVersion: 0,
      editSequence: 1, acknowledgedSequence: 0, working: graph.manifest, deleted: false, savedAt: now() }
    entry.writing = true
    entry.localSaved = false
    entry.record = value
    entry.objects = graph.objects
    publishDocument(entry)
    try {
      const saved = await options.persistence.save(value, graph.objects, 0)
      entry.writing = false
      adoptRecord(entry, saved, graph.objects)
      entry.loaded = true
      startOwners(entry)
      hint(entry)
      scheduleSync(entry)
      return entry.id
    } catch (error) {
      entry.writing = false
      entry.error = canvasErrorOf(error)
      entry.localSaved = false
      publishDocument(entry)
      throw error
    }
  }
  const clone = async (graph: CanvasGraph, title?: string): Promise<CanvasGraph> => {
    const { cloneGraph } = await import('@physicsos/physics-workbench/graph')
    const current = currentScope()
    const cloned = (await cloneGraph(graph, { id: kind => id(kind), hash: canonical => hash(JSON.parse(canonical)),
      ...(title === undefined ? {} : { title }), now: now(), preserveServerAuthority: false, limits: limitsFor(current.namespace) })).graph
    if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
    return cloned
  }
  const getGraph = async (canvas: string): Promise<CanvasGraph> => {
    await activating
    const entry = entryOf(canvas)
    await openEntry(entry)
    const current = currentScope()
    try { await controller.flush(canvas) } catch (error) {
      // A valid optimistic graph can still be downloaded as a recovery point after disk failure.
      if (entry.record === undefined) throw error
    }
    if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
    const { verifyGraphDigests } = await import('@physicsos/physics-workbench/graph')
    const value = entry.record
    if (value === undefined) throw new Error('CANVAS_NOT_OPEN')
    const graph = reachableCanvasGraph(value.working, entry.objects)
    unwrap(await verifyGraphDigests(graph, canonical => hash(JSON.parse(canonical)), limitsFor(entry.namespace)))
    return graph
  }
  const addInstance = async (
    entry: DocumentEntry, input: AddCanvasExperiment, runtimeState?: Pick<WorkbenchCommittedState, 'history' | 'draft' | 'clock' | 'instanceEditRevision'>,
  ): Promise<string> => {
    const instanceId = id('instance')
    const key = keyOf(entry.namespace, entry.id, instanceId)
    // Initial ownership is minted by the same real runtime factory used by subsequent cards.
    const persisted = input.metadata?.physicsosWorkbenchRuntime === undefined ? undefined
      : record(input.metadata.physicsosWorkbenchRuntime, '/metadata/physicsosWorkbenchRuntime')
    if (persisted !== undefined) {
      exactKeys(persisted, ['schemaVersion', 'history', 'draft'], '/metadata/physicsosWorkbenchRuntime')
      if (persisted.schemaVersion !== 1) fail('/metadata/physicsosWorkbenchRuntime/schemaVersion', 'schema', 'Unsupported runtime state schema.')
    }
    const created = await options.createRuntime({ instanceKey: key, sceneId: id('scene'), scene: input.scene,
      originScene: input.originScene ?? input.scene, source: input.source, buildMode: input.buildMode ?? 'inspect',
      ...(input.templateId === undefined ? {} : { templateId: input.templateId }),
      ...(runtimeState === undefined ? {
        ...(persisted?.history === undefined ? {} : { persistedHistory: persisted.history }),
        ...(persisted?.draft === undefined ? {} : { persistedDraft: persisted.draft }),
      } : { ...runtimeState, clock: { ...runtimeState.clock, running: false } }),
      visible: false,
    })
    let state: WorkbenchCommittedState
    try {
      if (input.rendererRelease !== undefined) created.setRelease(input.rendererRelease)
      state = created.serialize()
    } finally { created.dispose() }
    const scene = createSceneObject(state.scene)
    const origin = createSceneObject(state.originScene ?? input.originScene ?? input.scene)
    const sceneDigest = await hash(scene)
    const originDigest = await hash(origin)
    const instance: ExperimentInstance = {
      instanceId, currentScene: { kind: 'scene', digest: sceneDigest }, originScene: { kind: 'scene', digest: originDigest },
      domain: state.domain, source: state.source, buildMode: state.buildMode, clock: { ...state.clock, running: false },
      instanceEditRevision: state.instanceEditRevision,
      ...(input.templateId === undefined ? {} : { templateId: input.templateId }),
      ...(input.templateRelease === undefined ? {} : { templateRelease: input.templateRelease }),
      ...(input.rendererRelease === undefined ? {} : { rendererRelease: input.rendererRelease }),
      metadata: copyJsonObject({ ...(input.metadata ?? {}), physicsosWorkbenchRuntime: { schemaVersion: 1, history: state.history,
        ...(state.draft === undefined ? {} : { draft: state.draft }) } }),
    }
    currentScope()
    if (entry.namespace !== scope?.namespace) throw new Error('CANVAS_ACCOUNT_MISMATCH')
    const nodeId = id('node')
    await mutate(entry, runtimeState === undefined ? 'add-experiment' : 'duplicate', manifest => ({ ...manifest,
      instances: [...manifest.instances, instance], nodes: [...manifest.nodes, { id: nodeId, kind: 'experiment', instanceId,
        title: input.title ?? input.source.title ?? input.scene.metadata.title ?? '', layout: defaultLayout(manifest, { ...(state.buildMode === 'construct' ? { width: 1080, height: 700 } : {}), ...input.layout }) }] }),
    { [sceneDigest]: scene, [originDigest]: origin })
    await ensureOwner(entry, instanceId)
    return instanceId
  }
  const selectedRoots = (manifest: CanvasManifest, nodeIds: readonly string[]): readonly CanvasNode[] => {
    const selected = new Set(manifest.nodes.filter(node => nodeIds.includes(node.id) && !node.locked).map(node => node.id))
    const nodes = new Map(manifest.nodes.map(node => [node.id, node]))
    return manifest.nodes.filter(node => {
      if (!selected.has(node.id)) return false
      let parent = node.groupId
      const visited = new Set<string>()
      while (parent !== undefined && !visited.has(parent)) {
        if (selected.has(parent)) return false
        visited.add(parent)
        parent = nodes.get(parent)?.groupId
      }
      return true
    })
  }
  const patchLayout = (manifest: CanvasManifest, patches: readonly CanvasNodePatch[]): CanvasManifest => {
    const updates = new Map(patches.map(patch => [patch.id, patch]))
    const nodeMap = new Map(manifest.nodes.map(node => [node.id, node]))
    return { ...manifest, nodes: manifest.nodes.map(node => {
      const patch = updates.get(node.id)
      let next = node
      if (patch !== undefined && !node.locked) {
        const groupChanged = patch.groupId === null ? withoutGroup(next) : patch.groupId === undefined ? next : { ...next, groupId: patch.groupId }
        next = { ...groupChanged, ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.locked === undefined ? {} : { locked: patch.locked }), layout: { ...node.layout, ...(patch.layout ?? {}) } }
      }
      if (node.locked || patch?.layout?.x === undefined || patch?.layout?.y === undefined) {
        let parent = node.groupId === undefined ? undefined : nodeMap.get(node.groupId)
        const seen = new Set<string>()
        while (parent !== undefined && !seen.has(parent.id)) {
          seen.add(parent.id)
          const move = updates.get(parent.id)
          if (move !== undefined && (move.layout?.x !== undefined || move.layout?.y !== undefined) && !parent.locked) {
            next = { ...next, layout: { ...next.layout,
              x: next.layout.x + (node.locked || patch?.layout?.x === undefined ? (move.layout?.x ?? parent.layout.x) - parent.layout.x : 0),
              y: next.layout.y + (node.locked || patch?.layout?.y === undefined ? (move.layout?.y ?? parent.layout.y) - parent.layout.y : 0) } }
            break
          }
          parent = parent.groupId === undefined ? undefined : nodeMap.get(parent.groupId)
        }
      }
      return next
    }) }
  }
  const removeNodesManifest = (manifest: CanvasManifest, nodeIds: readonly string[]): CanvasManifest => {
    const selected = new Set(nodeIds)
    for (const node of manifest.nodes) if (node.locked) selected.delete(node.id)
    let changed = true
    while (changed) {
      changed = false
      for (const node of manifest.nodes) if (!node.locked && node.groupId !== undefined && selected.has(node.groupId) && !selected.has(node.id)) {
        selected.add(node.id); changed = true
      }
    }
    const nodes = manifest.nodes.filter(node => !selected.has(node.id)).map(node => node.groupId !== undefined && selected.has(node.groupId) ? withoutGroup(node) : node)
    const usedInstances = new Set(nodes.flatMap(node => node.kind === 'experiment' ? [node.instanceId] : []))
    const usedComparisons = new Set(nodes.flatMap(node => node.kind === 'comparison' ? [node.comparisonId] : []))
    const removedInstances = new Set(manifest.nodes.flatMap(node => selected.has(node.id) && node.kind === 'experiment' ? [node.instanceId] : []))
    const removedComparisons = new Set(manifest.nodes.flatMap(node => selected.has(node.id) && node.kind === 'comparison' ? [node.comparisonId] : []))
    const instances = manifest.instances.filter(instance => !removedInstances.has(instance.instanceId) || usedInstances.has(instance.instanceId))
    const retainedInstances = new Set(instances.map(instance => instance.instanceId))
    return { ...manifest, nodes, edges: manifest.edges.filter(edge => !selected.has(edge.from) && !selected.has(edge.to)),
      instances, comparisons: manifest.comparisons.filter(comparison => !removedComparisons.has(comparison.id) || usedComparisons.has(comparison.id)),
      snapshots: manifest.snapshots.map(alias => alias.instanceId === undefined || retainedInstances.has(alias.instanceId) ? alias : (() => {
        const { instanceId: _instance, ...retained } = alias
        return retained
      })()) }
  }
  const pauseScope = (error?: unknown): void => {
    if (paused && error === undefined) return
    paused = true
    scope?.sync?.pause()
    if (error !== undefined) rootError = canvasErrorOf(error)
    for (const entry of entries.values()) {
      if (entry.namespace !== scope?.namespace) continue
      for (const owner of entryNotes(entry)) {
        if (owner.timer !== undefined) cancel(owner.timer)
        owner.timer = undefined; publishNote(owner)
      }
      void checkpointNotes(entry, true).catch(report)
      if (entry.timer !== undefined) { cancel(entry.timer); entry.timer = undefined }
      for (const owner of entry.instanceRegistry.values()) {
        owner.runtime?.setVisible(false)
        owner.cells.summary.set(undefined)
        owner.cells.frame.set(undefined)
      }
      publishDocument(entry)
    }
    publishRoster()
  }
  const activate = async (): Promise<void> => {
    if (disposed) throw new Error('CANVAS_CONTROLLER_DISPOSED')
    const account = options.getAccount()
    const fingerprint = fingerprintOf(account)
    if (scope?.fingerprint === fingerprint && !paused) return
    pauseScope()
    const previous = scope
    await Promise.allSettled([...entries.values()].filter(entry => entry.namespace === previous?.namespace).map(entry => entry.queue))
    await Promise.allSettled([...notes.values()].filter(owner => owner.entry.namespace === previous?.namespace)
      .flatMap(owner => owner.flushing === undefined ? [] : [owner.flushing]))
    await previous?.sync?.dispose()
    for (const entry of entries.values()) if (entry.namespace === previous?.namespace) {
      for (const owner of entry.instanceRegistry.values()) disposeOwner(owner)
    }
    channel?.close()
    channel = undefined
    const namespace = namespaceOf(account)
    const activeEpoch = ++epoch
    const api = account === undefined ? undefined : options.api.forOwner(account)
    let synchronizer: CanvasSynchronizer | undefined
    if (api !== undefined) synchronizer = createCanvasSynchronizer({ namespace, api, persistence: options.persistence,
      limits: () => limitsFor(namespace),
      hash, id, now, online, isCurrent: () => !disposed && !paused && scope?.epoch === activeEpoch &&
        fingerprintOf(options.getAccount()) === fingerprint,
      onRecord: (value, objects) => {
        if (disposed || paused || scope?.epoch !== activeEpoch || fingerprintOf(options.getAccount()) !== fingerprint) return
        const entry = entryOf(value.id, namespace)
        const previousVersion = entry.record?.cacheVersion ?? 0
        if (!entry.writing && entry.pendingWrites.size === 0 && entry.failedWrite === undefined) { adoptRecord(entry, value, objects); startOwners(entry) }
        else if (objects !== undefined) entry.objects = mergeObjectInventory(entry.objects, objects)
        // The receiving tab only loads IndexedDB and never broadcasts its load.
        if (value.cacheVersion > previousVersion) hint(entry)
      },
      onState: (canvas, syncing) => { const entry = entryOf(canvas, namespace); entry.syncing = syncing; publishDocument(entry) },
      onAuthenticationError: pauseScope, onError: report,
    })
    scope = { namespace, fingerprint, epoch: activeEpoch, limits: limitsFor(namespace), ...(api === undefined ? {} : { api }), ...(synchronizer === undefined ? {} : { sync: synchronizer }) }
    paused = false
    rootError = undefined
    rootLoading = true
    publishRoster()
    try {
      const cached = await options.persistence.getPreference(namespace, 'resource-policy')
      if (cached !== undefined) policies.set(namespace, readCanvasResourcePolicy(JSON.parse(cached)).limits)
      if (api !== undefined && online()) {
        try {
          const policy = await api.resourcePolicy()
          if (scope.epoch !== activeEpoch || fingerprintOf(options.getAccount()) !== fingerprint) return
          policies.set(namespace, policy.limits)
          await options.persistence.setPreference(namespace, 'resource-policy', canonicalStringify(policy))
        } catch (error) {
          if (cached === undefined || error instanceof CanvasRequestError && [401, 403].includes(error.status)) throw error
          report(error) // A last validated policy remains usable during a transport outage.
        }
      }
      if (scope.epoch !== activeEpoch) return
      scope = { ...scope, limits: limitsFor(namespace) }
      const records = await options.persistence.list(namespace)
      if (scope.epoch !== activeEpoch) return
      for (const value of records) {
        const entry = entryOf(value.id, namespace)
        if (entry.failedWrite === undefined) adoptRecord(entry, value)
      }
      const channelFactory = options.channel === null ? undefined : options.channel ?? (browserWindow !== undefined && typeof BroadcastChannel !== 'undefined'
        ? (name: string) => new BroadcastChannel(name) : undefined)
      if (channelFactory !== undefined) {
        channel = channelFactory(`physicsos-canvas:${namespace}`)
        channel.addEventListener('message', event => {
          try {
            const message = record(event.data, '/hint')
            if (message.namespace !== namespace || paused || scope?.epoch !== activeEpoch) return
            const canvas = text(message.id, '/hint/id', true)
            const entry = entryOf(canvas, namespace)
            void enqueue(entry, async () => {
              if (entry.failedWrite !== undefined) return
              await loadLocal(entry)
              startOwners(entry)
            }).catch(report)
          } catch (error) { report(error) }
        })
      }
      if (api !== undefined && online()) await listHeads({}, scope)
      if (synchronizer !== undefined && online() && scope.epoch === activeEpoch) {
        for (const entry of entries.values()) {
          if (entry.namespace !== namespace || entry.record === undefined) continue
          if ((entry.record.pendingNoteDrafts?.length ?? 0) > 0) await flushEntryNotes(entry)
          await synchronizer.sync(entry.id)
          if (scope?.epoch !== activeEpoch || paused) return
        }
      }
      for (const entry of entries.values()) if (entry.namespace === namespace && entry.loaded) startOwners(entry)
    } catch (error) {
      if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
      else { rootError = canvasErrorOf(error); report(error) }
    } finally { rootLoading = false; publishRoster() }
  }
  const listHeads = async (query: CanvasListQuery, current: ControllerScope): Promise<void> => {
    if (current.api === undefined || !online()) return
    let cursor = query.cursor
    let known = heads.get(current.namespace)
    if (known === undefined) { known = new Map(); heads.set(current.namespace, known) }
    do {
      const response = await current.api.list({ ...query, deleted: query.deleted ?? 'all', ...(cursor === undefined ? {} : { cursor }) })
      if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
      for (const head of response.items) known.set(head.id, head)
      cursor = response.nextCursor
    } while (cursor !== undefined)
    publishRoster()
  }
  const syncScope = async (canvas?: string, retry = false): Promise<void> => {
    await activating
    const current = currentScope()
    if (current.sync === undefined || !online()) return
    const selected = canvas === undefined ? [...entries.values()].filter(entry => entry.namespace === current.namespace && entry.record !== undefined)
      : [entryOf(canvas)]
    for (const entry of selected) {
      await flushEntryNotes(entry)
      await entry.queue
      if (entry.failedWrite !== undefined) throw entry.failedWrite
      await current.sync.sync(entry.id, retry)
    }
    let cursor = Number(await options.persistence.getPreference(current.namespace, 'changes-cursor') ?? '0')
    if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0
    try {
      let more = true
      while (more) {
        const changes = await current.api!.changes(cursor)
        if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
        for (const change of changes.changes) {
          let known = heads.get(current.namespace)
          if (known === undefined) { known = new Map(); heads.set(current.namespace, known) }
          const old = known.get(change.head.id)
          if (old === undefined || change.head.changeSeq >= old.changeSeq) known.set(change.head.id, change.head)
          const entry = entries.get(keyOf(current.namespace, change.head.id))
          if (entry?.loaded && !entry.writing && entry.record?.head !== undefined && entry.record.head.version < change.head.version) {
            await current.sync.refresh(change.head.id)
            startOwners(entry)
          }
        }
        if (changes.hasMore && changes.cursor <= cursor) throw new CanvasRequestError(502, 'CANVAS_CURSOR_INVALID', 'The canvas change cursor did not advance.', undefined, false)
        cursor = changes.cursor
        more = changes.hasMore
        await options.persistence.setPreference(current.namespace, 'changes-cursor', String(cursor))
      }
      publishRoster()
    } catch (error) {
      if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
      else { rootError = canvasErrorOf(error); publishRoster(); report(error) }
    }
  }

  const controller: CanvasController = {
    state: roster, getSnapshot: roster.getSnapshot, subscribe: roster.subscribe,
    documentSource: canvas => entryOf(canvas, scope?.namespace ?? namespaceOf(options.getAccount())).source,
    instanceKey: (canvas, instanceId) => createStableCells(entryOf(canvas, scope?.namespace ?? namespaceOf(options.getAccount())), instanceId).key,
    instanceSource: key => {
      const value = cells.get(key)
      if (value !== undefined) return value.summary
      const stable: StableCells = { summary: createSnapshotStore<WorkbenchInstanceSummary | undefined>(undefined), frame: createSnapshotStore<WorkspaceFrame | undefined>(undefined) }
      cells.set(key, stable)
      return stable.summary
    },
    frameSource: key => {
      const value = cells.get(key)
      if (value !== undefined) return value.frame
      const stable: StableCells = { summary: createSnapshotStore<WorkbenchInstanceSummary | undefined>(undefined), frame: createSnapshotStore<WorkspaceFrame | undefined>(undefined) }
      cells.set(key, stable)
      return stable.frame
    },
    refreshAccount: () => {
      activating = activating.catch(() => undefined).then(activate)
      return activating
    },
    list: async (query = {}) => {
      await activating
      const current = currentScope()
      rootLoading = true; publishRoster()
      try { await listHeads(query, current) } catch (error) {
        if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
        else { rootError = canvasErrorOf(error); report(error) }
      } finally { rootLoading = false; publishRoster() }
      const search = query.search?.toLocaleLowerCase()
      const summaries = roster.getSnapshot().documents.filter(item => (search === undefined || item.title.toLocaleLowerCase().includes(search)) &&
        (query.deleted === 'all' || (query.deleted === 'deleted' ? item.deleted : !item.deleted)))
      return [...summaries].sort(query.sort === 'title' ? (a, b) => a.title.localeCompare(b.title)
        : query.sort === 'created' ? (a, b) => b.createdAt.localeCompare(a.createdAt)
          : (a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    open: async canvas => { await activating; const entry = entryOf(canvas); await openEntry(entry); return entry.source.getSnapshot() },
    create: async title => {
      const fingerprint = fingerprintOf(options.getAccount())
      await activating
      if (fingerprintOf(options.getAccount()) !== fingerprint) throw new CanvasRequestError(401,
        'CANVAS_ACCOUNT_CHANGED', 'The account changed before this workbench could be created.', undefined, false)
      const manifest = createManifest({ id: id('canvas'), title, now: now() })
      return createFromGraph({ schemaVersion: 1, manifest, objects: emptyObjects })
    },
    rename: async (canvas, title) => { const entry = await openForEdit(canvas); await mutate(entry, 'rename', manifest => ({ ...manifest, title })) },
    duplicate: async (canvas, title) => {
      const copied = await clone(await getGraph(canvas), title)
      currentScope()
      return createFromGraph(copied)
    },
    remove: async canvas => {
      await activating
      const entry = entryOf(canvas); await openEntry(entry)
      await controller.flush(canvas)
      await enqueue(entry, async () => {
        const original = entry.record
        if (original === undefined || original.deleted) return
        const { error: _error, ...retained } = original
        await commitLocal(entry, original, { ...retained, deleted: true, editSequence: original.editSequence + 1, savedAt: now() }, {})
      })
    },
    restore: async canvas => {
      await activating
      const entry = entryOf(canvas); await openEntry(entry)
      await enqueue(entry, async () => {
        const original = entry.record
        if (original === undefined || !original.deleted) return
        const { error: _error, conflict: _conflict, localConflict: _localConflict, ...retained } = original
        await commitLocal(entry, original, { ...retained, deleted: false, editSequence: original.editSequence + 1, savedAt: now() }, {})
        startOwners(entry)
      })
    },
    sync: canvas => syncScope(canvas),
    retry: async canvas => {
      await activating
      const current = currentScope()
      const selected = canvas === undefined ? [...entries.values()].filter(entry => entry.namespace === current.namespace)
        : [entryOf(canvas)]
      for (const entry of selected) {
        if (entryNotes(entry).some(owner => owner.dirty)) await flushEntryNotes(entry)
        if (entry.failedWrite === undefined || entry.record === undefined) continue
        await enqueue(entry, async () => {
          const candidate = entry.record
          if (candidate === undefined) return
          const previous = entry.failedBase ?? await options.persistence.read(entry.namespace, entry.id)
          if (previous === undefined) {
            entry.writing = true; entry.localSaved = false; publishDocument(entry)
            try {
              const saved = await options.persistence.save({ ...candidate, cacheVersion: 0, savedAt: now() }, entry.objects, 0)
              entry.writing = false; entry.failedWrite = undefined
              adoptRecord(entry, saved, entry.objects); entry.loaded = true; startOwners(entry)
              hint(entry); scheduleSync(entry)
            } catch (error) {
              entry.writing = false; entry.error = canvasErrorOf(error); entry.failedWrite = error; publishDocument(entry)
              throw error
            }
          } else await commitLocal(entry, previous, candidate, entry.objects)
        })
      }
      await syncScope(canvas, true)
    },
    resolveConflict: async (canvas, manifest) => {
      const entry = await openForEdit(canvas)
      await enqueue(entry, async () => {
        const original = requireRecord(entry)
        const checked = unwrap(parseManifest(manifest))
        if (checked.id !== canvas) throw new Error('CANVAS_DOCUMENT_MISMATCH')
        assertCanvasReferences(checked, entry.objects)
        const { conflict: _conflict, localConflict: _localConflict, error: _error, ...retained } = original
        acceptNoteChoices(entry, checked)
        await commitLocal(entry, original, { ...retained, working: { ...checked, updatedAt: now() },
          pendingNoteDrafts: [],
          documentHistory: { schemaVersion: 1, past: [], future: [] },
          editSequence: original.editSequence + 1, savedAt: now() }, {})
        startOwners(entry)
      })
    },
    useRemote: async canvas => {
      await activating
      const entry = entryOf(canvas); await openEntry(entry)
      await enqueue(entry, async () => {
        const original = entry.record
        const remote = original?.conflict?.remote
        const localRemote = original?.localConflict?.remote
        if (original === undefined || (remote === undefined && localRemote === undefined)) throw new Error('CANVAS_CONFLICT_MISSING')
        const { pending: _pending, conflict: _conflict, localConflict: _localConflict, error: _error, ...retained } = original
        const sequence = original.editSequence + 1
        acceptNoteChoices(entry, remote?.manifest ?? localRemote!)
        await commitLocal(entry, original, { ...retained, working: remote?.manifest ?? localRemote!,
          pendingNoteDrafts: [],
          ...(remote === undefined ? (original.pending === undefined ? {} : { pending: original.pending })
            : { base: remote.manifest, head: remote.head, deleted: remote.head.deletedAt !== undefined }),
          editSequence: sequence, acknowledgedSequence: remote === undefined ? original.acknowledgedSequence : sequence,
          documentHistory: { schemaVersion: 1, past: [], future: [] }, savedAt: now() }, {})
        startOwners(entry); publishDocument(entry)
      })
    },
    keepLocalCopy: async (canvas, title) => {
      await activating
      const entry = entryOf(canvas); await openEntry(entry)
      const graph = await getGraph(canvas)
      const value = entry.record
      if (value === undefined) throw new Error('CANVAS_NOT_OPEN')
      const copied = await createFromGraph(await clone(graph, title ?? `${graph.manifest.title} (local copy)`))
      if (value.conflict !== undefined || value.localConflict !== undefined) await controller.useRemote(canvas)
      return copied
    },
    exportGraph: async canvas => {
      const graph = await getGraph(canvas)
      const { exportGraph } = await import('@physicsos/physics-workbench/graph')
      return exportGraph(graph, { exportedAt: now(), limits: limitsFor(currentScope().namespace) })
    },
    importGraph: async (input, title) => {
      await activating; currentScope()
      const current = currentScope()
      const { importGraph } = await import('@physicsos/physics-workbench/graph')
      const result = unwrap(await importGraph(input, { id: kind => id(kind), hash: canonical => hash(JSON.parse(canonical)),
        ...(title === undefined ? {} : { title }), now: now(), limits: limitsFor(current.namespace) }))
      if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
      return createFromGraph(result.graph)
    },
    exportDatasetCsv: async (canvas, datasetDigests) => {
      await activating
      const entry = entryOf(canvas)
      await openEntry(entry)
      currentScope()
      const datasets = datasetDigests.map(digest => {
        const object = entry.objects[digest]
        if (object?.kind !== 'dataset') fail('/datasets', 'reference', 'The selected raw dataset does not exist.')
        return object
      })
      const { datasetsToCsv } = await import('@physicsos/physics-workbench/csv')
      return datasetsToCsv(datasets, { bom: true })
    },
    addExperiment: async (canvas, input) => addInstance(await openForEdit(canvas), input),
    duplicateInstance: async (canvas, instanceId) => {
      const entry = await openForEdit(canvas)
      const runtime = await ensureOwner(entry, instanceId)
      const state = runtime.serialize()
      const stored = requireRecord(entry).working.instances.find(instance => instance.instanceId === instanceId)!
      const node = requireRecord(entry).working.nodes.find(value => value.kind === 'experiment' && value.instanceId === instanceId)
      return addInstance(entry, { scene: state.scene, source: stored.source, buildMode: state.buildMode,
        ...(state.originScene === undefined ? {} : { originScene: state.originScene }),
        ...(stored.templateId === undefined ? {} : { templateId: stored.templateId }),
        ...(stored.templateRelease === undefined ? {} : { templateRelease: stored.templateRelease }),
        ...(stored.rendererRelease === undefined ? {} : { rendererRelease: stored.rendererRelease }),
        ...(node?.title === undefined ? {} : { title: node.title }),
        ...(stored.metadata === undefined ? {} : { metadata: stored.metadata }),
        ...(node === undefined ? {} : { layout: { ...node.layout, x: node.layout.x + 40, y: node.layout.y + 40, zIndex: node.layout.zIndex + 1 } }) }, state)
    },
    removeNodes: async (canvas, nodeIds) => {
      const entry = await openForEdit(canvas)
      for (const owner of entry.instanceRegistry.values()) owner.runtime?.persist()
      await controller.flush(canvas)
      await mutate(entry, 'remove', manifest => removeNodesManifest(manifest, nodeIds))
    },
    updateLayout: async (canvas, patches) => { const entry = await openForEdit(canvas); await mutate(entry, 'layout', manifest => patchLayout(manifest, patches)) },
    updateViewport: async (canvas, viewport) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'viewport', manifest => ({ ...manifest, viewport }), {}, false)
    },
    renameNode: async (canvas, nodeId, title) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'rename-node', manifest => ({ ...manifest, nodes: manifest.nodes.map(node => node.id === nodeId ? { ...node, title } : node) }))
    },
    addNote: async (canvas, input: CanvasNoteInput = {}) => {
      const entry = await openForEdit(canvas)
      const nodeId = id('node')
      await mutate(entry, 'add-note', manifest => ({ ...manifest, nodes: [...manifest.nodes, { id: nodeId, kind: 'note',
        body: input.body ?? '', format: input.format ?? 'markdown', ...(input.title === undefined ? {} : { title: input.title }),
        layout: defaultLayout(manifest, { width: 340, height: 240, ...(input.layout ?? {}) }) }] }))
      return nodeId
    },
    updateNote: async (canvas, nodeId, body, format) => {
      const entry = await openForEdit(canvas)
      const key = canvasNoteDraftKey(entry.namespace, canvas, nodeId)
      const owner = lookupNote(key)
      controller.editNoteDraft(key, { body, format: format ?? owner.format })
      await controller.flushNoteDraft(key)
    },
    noteDraftSource: key => {
      let source = noteCells.get(key)
      if (source === undefined) { source = createSnapshotStore<CanvasNoteDraftState | undefined>(undefined); noteCells.set(key, source) }
      let view = noteViews.get(key)
      if (view === undefined) {
        const held = source
        view = { getSnapshot: () => {
          const owner = notes.get(key)
          return owner !== undefined && !disposed && !paused && scope?.namespace === owner.entry.namespace &&
            scope?.fingerprint === fingerprintOf(options.getAccount()) ? held.getSnapshot() : undefined
        }, subscribe: held.subscribe }
        noteViews.set(key, view)
      }
      return view
    },
    editNoteDraft: (key, input) => {
      const owner = lookupNote(key)
      const value = record(input, '/noteDraft')
      exactKeys(value, ['body', 'format'], '/noteDraft')
      const body = text(value.body, '/noteDraft/body')
      const format = oneOf(value.format, ['plain', 'markdown'], '/noteDraft/format')
      if (owner.body === body && owner.format === format) return
      owner.revision += 1; owner.body = body; owner.format = format; owner.staged = true
      owner.dirty = body !== owner.baseBody || format !== owner.baseFormat
      owner.error = undefined; rememberNote(owner)
      const entry = owner.entry
      if (entry.record !== undefined) entry.record = projectNotes(entry, entry.record)
      entry.localSaved = false
      publishNote(owner); publishDocument(entry)
      void checkpointNotes(entry).catch(report)
      scheduleNote(owner)
    },
    flushNoteDraft: async key => {
      await activating
      await flushOwnedNote(lookupNote(key))
    },
    discardNoteDraft: key => {
      const owner = lookupNote(key)
      if (owner.timer !== undefined) cancel(owner.timer)
      const entry = owner.entry
      const original = entry.record
      const remote = original?.conflict?.remote.manifest ?? original?.localConflict?.remote ?? entry.durableRecord?.working
      const remoteNode = owner.conflict ? remote?.nodes.find(node => node.id === owner.nodeId) : undefined
      if (owner.conflict && remoteNode?.kind === 'note') {
        owner.baseBody = remoteNode.body; owner.baseFormat = remoteNode.format; owner.original = remoteNode
      }
      owner.timer = undefined; owner.revision += 1; owner.body = owner.baseBody; owner.format = owner.baseFormat
      const acceptRemoval = owner.conflict && remote !== undefined && remoteNode === undefined
      owner.dirty = false; owner.staged = true; owner.conflict = false; owner.error = undefined; rememberNote(owner)
      if (original !== undefined) {
        const path = `/nodes/${owner.nodeId.replaceAll('~', '~0').replaceAll('/', '~1')}`
        const relevant = (conflict: CanvasDocumentState['conflicts'][number]): boolean => conflict.path === path || conflict.path.startsWith(`${path}/`)
        const serverConflicts = original.conflict?.conflicts.filter(conflict => !relevant(conflict))
        const localConflicts = original.localConflict?.conflicts.filter(conflict => !relevant(conflict))
        const { conflict: _server, localConflict: _local, ...retained } = original
        const working = resetFailedNoteHistory(entry, original.working)
        if (acceptRemoval) { notes.delete(key); owner.source.set(undefined) }
        entry.record = projectNotes(entry, { ...retained,
          working: acceptRemoval ? { ...working, nodes: working.nodes.filter(node => node.id !== owner.nodeId) } : working,
          documentHistory: { schemaVersion: 1, past: entry.past, future: entry.future },
          ...(original.conflict === undefined || serverConflicts?.length === 0 ? {} : { conflict: { ...original.conflict, conflicts: serverConflicts! } }),
          ...(original.localConflict === undefined || localConflicts?.length === 0 ? {} : { localConflict: { ...original.localConflict, conflicts: localConflicts! } }),
        })
      }
      entry.localSaved = false
      if (!acceptRemoval) publishNote(owner)
      publishDocument(entry)
      void checkpointNotes(entry, true).catch(report)
    },
    group: async (canvas, nodeIds, title) => {
      const entry = await openForEdit(canvas)
      const groupId = id('node')
      await mutate(entry, 'group', manifest => {
        const selected = selectedRoots(manifest, nodeIds)
        if (selected.length === 0) throw new Error('CANVAS_SELECTION_EMPTY')
        const x = Math.min(...selected.map(node => node.layout.x)) - 24
        const y = Math.min(...selected.map(node => node.layout.y)) - 48
        const width = Math.max(...selected.map(node => node.layout.x + node.layout.width)) - x + 24
        const height = Math.max(...selected.map(node => node.layout.y + node.layout.height)) - y + 24
        return { ...manifest, nodes: [...manifest.nodes.map(node => selected.some(item => item.id === node.id) ? { ...node, groupId } : node),
          { id: groupId, kind: 'group', collapsed: false, ...(title === undefined ? {} : { title }),
            layout: { x, y, width, height, zIndex: Math.min(...selected.map(node => node.layout.zIndex)) - 1 } }] }
      })
      return groupId
    },
    ungroup: async (canvas, groupIds) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'ungroup', manifest => {
        const removed = new Set(manifest.nodes.filter(node => node.kind === 'group' && groupIds.includes(node.id) && !node.locked).map(node => node.id))
        return { ...manifest, nodes: manifest.nodes.filter(node => !removed.has(node.id)).map(node => node.groupId !== undefined && removed.has(node.groupId) ? withoutGroup(node) : node),
          edges: manifest.edges.filter(edge => !removed.has(edge.from) && !removed.has(edge.to)) }
      })
    },
    setGroupCollapsed: async (canvas, groupId, collapsed) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'group-collapse', manifest => ({ ...manifest, nodes: manifest.nodes.map(node => node.id === groupId && node.kind === 'group' ? { ...node, collapsed } : node) }))
    },
    align: async (canvas, nodeIds, alignment: CanvasAlignment) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'align', manifest => {
        const selected = selectedRoots(manifest, nodeIds)
        if (selected.length < 2) return manifest
        const left = Math.min(...selected.map(node => node.layout.x)); const right = Math.max(...selected.map(node => node.layout.x + node.layout.width))
        const top = Math.min(...selected.map(node => node.layout.y)); const bottom = Math.max(...selected.map(node => node.layout.y + node.layout.height))
        return patchLayout(manifest, selected.map(node => ({ id: node.id, layout: {
          ...(alignment === 'left' ? { x: left } : alignment === 'center' ? { x: (left + right - node.layout.width) / 2 } : alignment === 'right' ? { x: right - node.layout.width } : {}),
          ...(alignment === 'top' ? { y: top } : alignment === 'middle' ? { y: (top + bottom - node.layout.height) / 2 } : alignment === 'bottom' ? { y: bottom - node.layout.height } : {}),
        } })))
      })
    },
    distribute: async (canvas, nodeIds, direction: CanvasDistribution) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'distribute', manifest => {
        const horizontal = direction === 'horizontal'
        const selected = [...selectedRoots(manifest, nodeIds)].sort((a, b) => horizontal ? a.layout.x - b.layout.x : a.layout.y - b.layout.y)
        if (selected.length < 3) return manifest
        const first = selected[0]!.layout; const last = selected.at(-1)!.layout
        const start = horizontal ? first.x : first.y
        const end = horizontal ? last.x + last.width : last.y + last.height
        const span = selected.reduce((sum, node) => sum + (horizontal ? node.layout.width : node.layout.height), 0)
        const gap = (end - start - span) / (selected.length - 1)
        let position = start
        const patches = selected.map(node => {
          const patch = { id: node.id, layout: horizontal ? { x: position } : { y: position } }
          position += (horizontal ? node.layout.width : node.layout.height) + gap
          return patch
        })
        return patchLayout(manifest, patches)
      })
    },
    setLocked: async (canvas, nodeIds, locked) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'lock', manifest => ({ ...manifest, nodes: manifest.nodes.map(node => nodeIds.includes(node.id) ? { ...node, locked } : node) }))
    },
    layer: async (canvas, nodeIds, operation: CanvasLayerOperation) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'layer', manifest => {
        const ordered = [...manifest.nodes].sort((a, b) => a.layout.zIndex - b.layout.zIndex || a.id.localeCompare(b.id))
        const selected = new Set(ordered.filter(node => nodeIds.includes(node.id) && !node.locked).map(node => node.id))
        if (operation === 'front' || operation === 'back') {
          const picked = ordered.filter(node => selected.has(node.id)); const rest = ordered.filter(node => !selected.has(node.id))
          ordered.splice(0, ordered.length, ...(operation === 'front' ? [...rest, ...picked] : [...picked, ...rest]))
        } else if (operation === 'forward') {
          for (let index = ordered.length - 2; index >= 0; index -= 1) if (selected.has(ordered[index]!.id) && !selected.has(ordered[index + 1]!.id)) {
            const next = ordered[index + 1]!; ordered[index + 1] = ordered[index]!; ordered[index] = next
          }
        } else {
          for (let index = 1; index < ordered.length; index += 1) if (selected.has(ordered[index]!.id) && !selected.has(ordered[index - 1]!.id)) {
            const previous = ordered[index - 1]!; ordered[index - 1] = ordered[index]!; ordered[index] = previous
          }
        }
        const positions = new Map(ordered.map((node, index) => [node.id, index + 1]))
        return { ...manifest, nodes: manifest.nodes.map(node => ({ ...node, layout: { ...node.layout, zIndex: positions.get(node.id)! } })) }
      })
    },
    copyNodes: async (canvas, nodeIds) => {
      const graph = await getGraph(canvas)
      const selected = new Set(nodeIds)
      let expanded = true
      while (expanded) { expanded = false; for (const node of graph.manifest.nodes) if (node.groupId !== undefined && selected.has(node.groupId) && !selected.has(node.id)) { selected.add(node.id); expanded = true } }
      const nodes = graph.manifest.nodes.filter(node => selected.has(node.id)).map(node => node.groupId !== undefined && !selected.has(node.groupId) ? withoutGroup(node) : node)
      const comparisons = graph.manifest.comparisons.filter(config => nodes.some(node => node.kind === 'comparison' && node.comparisonId === config.id))
      const aliases = new Set([...nodes.flatMap(node => node.kind === 'result' ? [node.snapshotAliasId] : []), ...comparisons.flatMap(config => config.members.map(member => member.snapshotAliasId))])
      const instances = graph.manifest.instances.filter(instance => nodes.some(node => node.kind === 'experiment' && node.instanceId === instance.instanceId))
      const includedInstances = new Set(instances.map(instance => instance.instanceId))
      const snapshots = graph.manifest.snapshots.filter(alias => aliases.has(alias.id)).map(alias => alias.instanceId === undefined || includedInstances.has(alias.instanceId) ? alias : (() => { const { instanceId: _id, ...retained } = alias; return retained })())
      const { history: _history, ...manifest } = graph.manifest
      const partial = unwrap(parseManifest({ ...manifest, nodes, instances, snapshots, comparisons,
        edges: manifest.edges.filter(edge => selected.has(edge.from) && selected.has(edge.to)) }))
      clipboard = { namespace: currentScope().namespace, graph: reachableCanvasGraph(partial, graph.objects) }
    },
    pasteNodes: async (canvas, offset = { x: 40, y: 40 }) => {
      const entry = await openForEdit(canvas)
      if (clipboard === undefined || clipboard.namespace !== currentScope().namespace) throw new Error('CANVAS_CLIPBOARD_EMPTY')
      const copied = await clone(clipboard.graph)
      const nodes = copied.manifest.nodes.map(node => ({ ...node, layout: { ...node.layout, x: node.layout.x + offset.x, y: node.layout.y + offset.y } }))
      await mutate(entry, 'paste', manifest => ({ ...manifest, nodes: [...manifest.nodes, ...nodes], edges: [...manifest.edges, ...copied.manifest.edges],
        instances: [...manifest.instances, ...copied.manifest.instances], snapshots: [...manifest.snapshots, ...copied.manifest.snapshots], comparisons: [...manifest.comparisons, ...copied.manifest.comparisons] }), copied.objects)
      startOwners(entry)
      return nodes.map(node => node.id)
    },
    undo: async canvas => {
      const entry = await openForEdit(canvas)
      await controller.flush(canvas)
      await enqueue(entry, async () => {
        const previousPatch = entry.past.at(-1); if (previousPatch === undefined) return
        const original = requireRecord(entry)
        const patch = refreshRemovedEntities(original.working, previousPatch, true)
        const working = { ...applyDocumentPatch(original.working, patch, true), updatedAt: now() }
        await commitLocal(entry, original, { ...original, working, editSequence: original.editSequence + 1, savedAt: now(),
          documentHistory: { schemaVersion: 1, past: entry.past.slice(0, -1), future: [patch, ...entry.future] } }, {})
        startOwners(entry); publishDocument(entry)
      })
    },
    redo: async canvas => {
      const entry = await openForEdit(canvas)
      await controller.flush(canvas)
      await enqueue(entry, async () => {
        const previousPatch = entry.future[0]; if (previousPatch === undefined) return
        const original = requireRecord(entry)
        const patch = refreshRemovedEntities(original.working, previousPatch, false)
        const working = { ...applyDocumentPatch(original.working, patch, false), updatedAt: now() }
        await commitLocal(entry, original, { ...original, working, editSequence: original.editSequence + 1, savedAt: now(),
          documentHistory: { schemaVersion: 1, future: entry.future.slice(1), past: [...entry.past, patch] } }, {})
        startOwners(entry); publishDocument(entry)
      })
    },
    capture: async (canvas, instanceId, title) => {
      const entry = await openForEdit(canvas)
      const runtime = await ensureOwner(entry, instanceId)
      runtime.cancelParameterPreview(); runtime.cancelComponentPlacement(); runtime.cancelSliderPosition()
      const raw = runtime.captureRaw()
      const state = runtime.serialize()
      await writeRuntimeState(entry, instanceId, state, 'save')
      const scene = createSceneObject(raw.scene)
      const sceneDigest = await hash(scene)
      const sceneRef: ObjectRef<'scene'> = { kind: 'scene', digest: sceneDigest }
      const datasets = captureDatasets(raw, { sourceScene: sceneRef, cursor: raw.cursor })
      const objects: Record<string, WorkbenchObject> = { [sceneDigest]: scene }
      const refs: ObjectRef<'dataset'>[] = []
      for (const dataset of datasets) { const digest = await hash(dataset); objects[digest] = dataset; refs.push({ kind: 'dataset', digest }) }
      const stored = requireRecord(entry).working.instances.find(instance => instance.instanceId === instanceId)!
      const snapshot = createSnapshotObject({ ...raw, sceneRef, instanceId, instanceEditRevision: state.instanceEditRevision,
        capturedAt: now(), source: 'client-engine', datasets: refs, metadata: copyJsonObject({ instanceProvenance: {
          source: stored.source, originScene: state.originScene ?? raw.scene, buildMode: state.buildMode,
          ...(stored.templateId === undefined ? {} : { templateId: stored.templateId }),
          ...(stored.templateRelease === undefined ? {} : { templateRelease: stored.templateRelease }),
          ...(stored.rendererRelease === undefined ? {} : { rendererRelease: stored.rendererRelease }),
          history: state.history, ...(state.draft === undefined ? {} : { draft: state.draft }),
        } }) })
      const snapshotDigest = await hash(snapshot)
      objects[snapshotDigest] = snapshot
      const alias: SnapshotAlias = { id: id('snapshot-alias'), title: title ?? raw.scene.metadata.title ?? stored.source.title ?? '',
        snapshot: { kind: 'snapshot', digest: snapshotDigest }, instanceId }
      const node: Extract<CanvasNode, { kind: 'result' }> = { id: id('node'), kind: 'result', snapshotAliasId: alias.id,
        title: alias.title, view: 'summary', layout: defaultLayout(requireRecord(entry).working, { width: 480, height: 360 }) }
      await mutate(entry, 'capture', manifest => ({ ...manifest, snapshots: [...manifest.snapshots, alias], nodes: [...manifest.nodes, node] }), objects)
      return { alias, node }
    },
    verifySnapshot: (canvas, aliasId) => {
      const key = keyOf(namespaceOf(options.getAccount()), canvas, aliasId)
      const running = verificationTasks.get(key)
      if (running !== undefined) return running
      const task = (async () => {
        const entry = await openForEdit(canvas)
        await controller.flush(canvas)
        await controller.sync(canvas)
        const current = currentScope()
        if (current.api === undefined || !online()) throw new CanvasRequestError(401, 'CANVAS_AUTH_REQUIRED', 'Sign in and connect to verify a captured result.', undefined, false)
        const local = requireRecord(entry)
        if (local.head === undefined || local.pending !== undefined || local.conflict !== undefined || local.localConflict !== undefined || local.error !== undefined) {
          throw new Error('CANVAS_CAPTURE_NOT_PUBLISHED')
        }
        const alias = local.working.snapshots.find(item => item.id === aliasId)
        if (alias === undefined) throw new Error('CANVAS_SNAPSHOT_MISSING')
        const pendingKey = `verification-pending:${canvas}:${alias.snapshot.digest}`
        const retained = await options.persistence.getPreference(entry.namespace, pendingKey)
        let mutationId: string
        if (retained === undefined || retained === '') {
          mutationId = id('verification')
          await options.persistence.setPreference(entry.namespace, pendingKey, canonicalStringify({ canvasId: canvas,
            captureDigest: alias.snapshot.digest, mutationId }))
        } else {
          const pending = record(JSON.parse(retained), '/pendingVerification')
          exactKeys(pending, ['canvasId', 'captureDigest', 'mutationId'], '/pendingVerification')
          if (pending.canvasId !== canvas || pending.captureDigest !== alias.snapshot.digest) throw new Error('CANVAS_VERIFICATION_REQUEST_MISMATCH')
          mutationId = text(pending.mutationId, '/pendingVerification/mutationId', true)
        }
        if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
        let response: CanvasVerificationResponse
        try { response = await current.api.verify(canvas, { captureDigest: alias.snapshot.digest, mutationId }) } catch (error) {
          if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
          throw error
        }
        if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
        const capture = entry.objects[alias.snapshot.digest]
        if (capture?.kind !== 'snapshot' || response.receipt.sceneDigest !== capture.scene.digest) {
          throw new CanvasRequestError(502, 'CANVAS_VERIFICATION_INVALID', 'The receipt does not reference the captured immutable scene.', undefined, false)
        }
        const legacyPreference = await options.persistence.getPreference(entry.namespace, `verification:${alias.snapshot.digest}`)
        let legacyResponse: CanvasVerificationResponse | undefined
        if (legacyPreference !== undefined && legacyPreference !== '') {
          const previous = readCanvasVerificationResponse(JSON.parse(legacyPreference))
          if (previous.receipt.canvasId === canvas && previous.receipt.captureDigest === alias.snapshot.digest &&
            previous.receipt.sceneDigest === capture.scene.digest) legacyResponse = previous
        }
        await options.persistence.setPreference(entry.namespace, `verification-receipt:${canvas}:${response.receipt.id}`, canonicalStringify(response))
        await mutate(entry, 'verification-receipt', manifest => ({ ...manifest, snapshots: manifest.snapshots.map(item => {
          if (item.id !== aliasId) return item
          const previous = isJsonObject(item.metadata?.verificationReceiptsById) ? item.metadata.verificationReceiptsById : {}
          const byId: Record<string, JsonValue> = { ...previous }
          const oldReferences: readonly JsonValue[] = Array.isArray(item.metadata?.verificationReceipts) ? item.metadata.verificationReceipts : []
          for (const reference of oldReferences) if (isJsonObject(reference) && typeof reference.id === 'string' &&
            reference.canvasId === canvas && reference.captureDigest === alias.snapshot.digest) byId[reference.id] = reference
          if (legacyResponse !== undefined) byId[legacyResponse.receipt.id] = { id: legacyResponse.receipt.id,
            canvasId: canvas, captureDigest: alias.snapshot.digest }
          byId[response.receipt.id] = { id: response.receipt.id, canvasId: canvas, captureDigest: alias.snapshot.digest }
          // A new keyed field merges independent additions even when its base
          // still contains the old atomic array. The frozen snapshot is untouched.
          return { ...item, metadata: copyJsonObject({ ...item.metadata, verificationReceiptsById: byId }) }
        }) }))
        // The old preference is replaced only after its reference was durably migrated.
        await options.persistence.setPreference(entry.namespace, `verification:${alias.snapshot.digest}`, canonicalStringify(response))
        if (response.resultDigest !== undefined && response.resultDigest !== alias.snapshot.digest) {
          const root = await current.api.getObject(canvas, response.resultDigest)
          if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
          if (await hash(root) !== response.resultDigest) throw new CanvasRequestError(502, 'CANVAS_OBJECT_DIGEST_MISMATCH', 'The server verification result failed its SHA256 check.', undefined, false)
          // A receipt or another object kind is never made into a snapshot alias.
          if (root.kind === 'snapshot') {
            if (root.source !== 'server-engine' || root.scene.digest !== response.receipt.sceneDigest ||
              root.engine.id !== response.receipt.engineId || root.engine.version !== response.receipt.engineVersion) {
              throw new CanvasRequestError(502, 'CANVAS_VERIFICATION_INVALID', 'The returned snapshot does not match its verification receipt.', undefined, false)
            }
            const objects: Record<string, WorkbenchObject> = { [response.resultDigest]: root }
            const queue = [...refsOf(root)]
            while (queue.length > 0) {
              const ref = queue.pop()!
              if (objects[ref.digest] !== undefined) {
                if (objects[ref.digest]!.kind !== ref.kind) throw new Error('CANVAS_OBJECT_KIND_MISMATCH')
                continue
              }
              const object = entry.objects[ref.digest] ?? await current.api.getObject(canvas, ref.digest)
              if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
              if (object.kind !== ref.kind || await hash(object) !== ref.digest) throw new CanvasRequestError(502, 'CANVAS_OBJECT_DIGEST_MISMATCH', 'A server result dependency failed its SHA256 check.', undefined, false)
              objects[ref.digest] = object
              queue.push(...refsOf(object))
            }
            const alreadyRecorded = requireRecord(entry).working.snapshots.some(item => isJsonObject(item.metadata?.verificationReceipt) &&
              item.metadata.verificationReceipt.id === response.receipt.id)
            const resultAlias: SnapshotAlias = { id: id('snapshot-alias'), title: `${alias.title} (server result)`,
              snapshot: { kind: 'snapshot', digest: response.resultDigest },
              metadata: copyJsonObject({ verificationReceipt: response.receipt, verifiedCaptureDigest: alias.snapshot.digest }) }
            if (!alreadyRecorded) await mutate(entry, 'verification-result', manifest => ({ ...manifest, snapshots: [...manifest.snapshots, resultAlias],
              nodes: [...manifest.nodes, { id: id('node'), kind: 'result', snapshotAliasId: resultAlias.id, title: resultAlias.title,
                view: 'summary', layout: defaultLayout(manifest, { width: 480, height: 360 }) }] }), objects)
          }
        }
        await options.persistence.setPreference(entry.namespace, pendingKey, '')
        return response
      })()
      verificationTasks.set(key, task)
      void task.finally(() => { if (verificationTasks.get(key) === task) verificationTasks.delete(key) }).catch(report)
      return task
    },
    verificationHistory: async (canvas, aliasId) => {
      await activating
      const entry = entryOf(canvas)
      await openEntry(entry)
      const current = currentScope()
      if (entry.namespace !== current.namespace) throw new CanvasRequestError(401, 'CANVAS_ACCOUNT_CHANGED',
        'The account changed before this private receipt history could be read.', undefined, false)
      const retainedRecord = entry.record
      if (retainedRecord === undefined) throw new Error('CANVAS_NOT_OPEN')
      const alias = retainedRecord.working.snapshots.find(item => item.id === aliasId)
      if (alias === undefined) throw new Error('CANVAS_SNAPSHOT_MISSING')
      const snapshot = entry.objects[alias.snapshot.digest]
      if (snapshot?.kind !== 'snapshot') throw new Error('CANVAS_SNAPSHOT_MISSING')
      const originalCaptureDigest = snapshot.source === 'server-engine' && typeof alias.metadata?.verifiedCaptureDigest === 'string'
        ? digest(alias.metadata.verifiedCaptureDigest, '/verification/captureDigest') : undefined
      const allowedDigests = new Set([alias.snapshot.digest, ...(originalCaptureDigest === undefined ? [] : [originalCaptureDigest])])
      const legacyReferences: readonly JsonValue[] = Array.isArray(alias.metadata?.verificationReceipts) ? alias.metadata.verificationReceipts : []
      const references: readonly JsonValue[] = [...legacyReferences,
        ...Object.values(isJsonObject(alias.metadata?.verificationReceiptsById) ? alias.metadata.verificationReceiptsById : {})]
      const ids = new Map<string, string>()
      // Receipts can exist before any browser received or persisted their IDs.
      // Discover all metadata pages, then retain the individual GET authority checks.
      if (current.api !== undefined && online() && retainedRecord.head !== undefined) for (const captureDigest of allowedDigests) {
        let cursor: string | undefined
        const seen = new Set<string>()
        do {
          let page: CanvasVerificationListResponse
          try { page = await current.api.verifications(canvas, captureDigest, cursor === undefined ? {} : { cursor }) } catch (error) {
            if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
            throw error
          }
          if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
          for (const item of page.items) {
            if (item.receipt.sceneDigest !== snapshot.scene.digest) {
              throw new CanvasRequestError(502, 'CANVAS_VERIFICATION_INVALID', 'A discovered receipt does not reference this immutable scene.', undefined, false)
            }
            if (captureDigest !== alias.snapshot.digest && item.resultDigest !== alias.snapshot.digest) continue
            ids.set(item.receipt.id, captureDigest)
          }
          cursor = page.nextCursor
          if (cursor !== undefined) {
            if (seen.has(cursor)) throw new CanvasRequestError(502, 'CANVAS_CURSOR_INVALID', 'The verification discovery cursor did not advance.', undefined, false)
            seen.add(cursor)
          }
        } while (cursor !== undefined)
      }
      const legacyReceipt = alias.metadata?.verificationReceipt
      if (isJsonObject(legacyReceipt) && legacyReceipt.canvasId === canvas && typeof legacyReceipt.captureDigest === 'string' &&
        allowedDigests.has(legacyReceipt.captureDigest) && typeof legacyReceipt.id === 'string' && !ids.has(legacyReceipt.id)) ids.set(legacyReceipt.id, legacyReceipt.captureDigest)
      for (const reference of references) {
        if (isJsonObject(reference) && reference.canvasId === canvas && typeof reference.captureDigest === 'string' &&
          allowedDigests.has(reference.captureDigest) && typeof reference.id === 'string' && !ids.has(reference.id)) ids.set(reference.id, reference.captureDigest)
      }
      const legacyResponses = new Map<string, CanvasVerificationResponse>()
      for (const captureDigest of allowedDigests) {
        const legacy = await options.persistence.getPreference(entry.namespace, `verification:${captureDigest}`)
        if (legacy !== undefined && legacy !== '') {
          const previous = readCanvasVerificationResponse(JSON.parse(legacy))
          if (previous.receipt.canvasId === canvas && previous.receipt.captureDigest === captureDigest) {
            if (!ids.has(previous.receipt.id)) ids.set(previous.receipt.id, captureDigest)
            legacyResponses.set(previous.receipt.id, previous)
          }
        }
      }
      const history: CanvasVerificationResponse[] = []
      for (const [receiptId, captureDigest] of ids) {
        const preference = `verification-receipt:${canvas}:${receiptId}`
        let response: CanvasVerificationResponse | undefined
        if (current.api !== undefined && online()) {
          try { response = await current.api.verification(canvas, receiptId) } catch (error) {
            if (error instanceof CanvasRequestError && error.status === 404) continue
            if (error instanceof CanvasRequestError && [401, 403].includes(error.status)) pauseScope(error)
            throw error
          }
        } else {
          const cached = await options.persistence.getPreference(entry.namespace, preference)
          if (cached !== undefined && cached !== '') response = readCanvasVerificationResponse(JSON.parse(cached))
          else response = legacyResponses.get(receiptId)
        }
        if (currentScope().epoch !== current.epoch) throw new Error('CANVAS_ACCOUNT_MISMATCH')
        if (response === undefined) continue
        if (response.receipt.id !== receiptId || response.receipt.canvasId !== canvas || response.receipt.captureDigest !== captureDigest ||
          response.receipt.sceneDigest !== snapshot.scene.digest || (captureDigest !== alias.snapshot.digest && response.resultDigest !== alias.snapshot.digest)) {
          throw new CanvasRequestError(502, 'CANVAS_VERIFICATION_INVALID', 'The persisted receipt does not match this immutable captured result.', undefined, false)
        }
        await options.persistence.setPreference(entry.namespace, preference, canonicalStringify(response))
        history.push(response)
      }
      // Persist newly discovered references for offline reopen and document export,
      // without adding an undoable layout/physics edit or changing the frozen capture.
      if (history.length > 0 && !entry.record?.deleted) await mutate(entry, 'verification-discovery', manifest => ({
        ...manifest, snapshots: manifest.snapshots.map(item => {
          if (item.id !== aliasId || item.snapshot.digest !== alias.snapshot.digest) return item
          const existing = isJsonObject(item.metadata?.verificationReceiptsById) ? item.metadata.verificationReceiptsById : {}
          const byId: Record<string, JsonValue> = { ...existing }
          for (const response of history) byId[response.receipt.id] = { id: response.receipt.id,
            canvasId: response.receipt.canvasId, captureDigest: response.receipt.captureDigest }
          return { ...item, metadata: copyJsonObject({ ...item.metadata, verificationReceiptsById: byId }) }
        }),
      }), {}, false)
      return history.sort((left, right) => left.receipt.checkedAt.localeCompare(right.receipt.checkedAt) || left.receipt.id.localeCompare(right.receipt.id))
    },
    getSampleReadout: (key, index) => {
      if (paused || disposed || scope?.fingerprint !== fingerprintOf(options.getAccount()) || !Number.isSafeInteger(index) || index < 0) return []
      const location = instanceLocations.get(key)
      if (location === undefined || location.entry.namespace !== scope?.namespace) return []
      return location.entry.instanceRegistry.get(location.instanceId)?.runtime?.getSampleReadout(index) ?? []
    },
    renameSnapshot: async (canvas, aliasId, title) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'rename-snapshot', manifest => ({ ...manifest, snapshots: manifest.snapshots.map(alias => alias.id === aliasId ? { ...alias, title } : alias),
        nodes: manifest.nodes.map(node => node.kind === 'result' && node.snapshotAliasId === aliasId ? { ...node, title } : node) }))
    },
    removeSnapshot: async (canvas, aliasId) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'remove-snapshot', manifest => {
        const removed = new Set(manifest.nodes.filter(node => node.kind === 'result' && node.snapshotAliasId === aliasId).map(node => node.id))
        return { ...manifest, snapshots: manifest.snapshots.filter(alias => alias.id !== aliasId), nodes: manifest.nodes.filter(node => !removed.has(node.id)),
          edges: manifest.edges.filter(edge => !removed.has(edge.from) && !removed.has(edge.to)),
          comparisons: manifest.comparisons.map(config => ({ ...config, members: config.members.filter(member => member.snapshotAliasId !== aliasId) })) }
      })
    },
    recreateSnapshot: async (canvas, aliasId) => {
      const entry = await openForEdit(canvas)
      const alias = requireRecord(entry).working.snapshots.find(value => value.id === aliasId)
      const snapshot = alias === undefined ? undefined : entry.objects[alias.snapshot.digest]
      if (alias === undefined || snapshot?.kind !== 'snapshot') throw new Error('CANVAS_SNAPSHOT_MISSING')
      const scene = sceneObject(entry.objects, snapshot.scene)
      const provenance = snapshot.metadata?.instanceProvenance === undefined ? undefined : record(snapshot.metadata.instanceProvenance, '/snapshot/provenance')
      const source = provenance?.source === undefined ? { kind: 'import' as const, metadata: { captureDigest: alias.snapshot.digest } }
        : readInstanceSource(provenance.source, '/snapshot/provenance/source')
      const origin = provenance?.originScene === undefined ? scene : createSceneObject(provenance.originScene).scene
      let templateRelease: TemplateReleaseIdentity | undefined
      if (provenance?.templateRelease !== undefined) {
        const release = record(provenance.templateRelease, '/snapshot/provenance/templateRelease')
        exactKeys(release, ['id', 'version', 'digest'], '/snapshot/provenance/templateRelease')
        templateRelease = { id: text(release.id, '/snapshot/provenance/templateRelease/id', true),
          version: text(release.version, '/snapshot/provenance/templateRelease/version', true),
          ...(release.digest === undefined ? {} : { digest: digest(release.digest, '/snapshot/provenance/templateRelease/digest') }) }
      }
      const instanceId = await addInstance(entry, { scene, originScene: origin, source, title: alias.title,
        ...(provenance?.buildMode === undefined ? {} : { buildMode: oneOf(provenance.buildMode, ['inspect', 'construct'], '/snapshot/provenance/buildMode') }),
        ...(templateRelease === undefined ? {} : { templateRelease }),
        ...(provenance?.rendererRelease === undefined ? {} : { rendererRelease: readRendererRelease(provenance.rendererRelease, '/snapshot/provenance/rendererRelease') }),
        ...(provenance?.templateId === undefined ? {} : { templateId: text(provenance.templateId, '/snapshot/provenance/templateId', true) }),
        metadata: copyJsonObject({ recreatedFrom: { aliasId, snapshotDigest: alias.snapshot.digest },
          ...(provenance?.history === undefined ? {} : { physicsosWorkbenchRuntime: { schemaVersion: 1, history: provenance.history,
            ...(provenance.draft === undefined ? {} : { draft: provenance.draft }) } }) }),
      })
      const runtime = await ensureOwner(entry, instanceId)
      runtime.setRunning(false); runtime.setRate(snapshot.clock.rate); runtime.seek(snapshot.clock.time)
      await controller.flush(canvas)
      return instanceId
    },
    setResultView: async (canvas, nodeId, view, metricIds) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'result-view', manifest => ({ ...manifest, nodes: manifest.nodes.map(node => node.id === nodeId && node.kind === 'result'
        ? { ...node, view, ...(metricIds === undefined ? {} : { metricIds }) } : node) }))
    },
    addComparison: async (canvas, input: CanvasComparisonInput) => {
      const entry = await openForEdit(canvas)
      const comparisonId = input.id ?? id('comparison')
      const config: ComparisonConfig = { ...input, id: comparisonId }
      await mutate(entry, 'add-comparison', manifest => ({ ...manifest, comparisons: [...manifest.comparisons, config],
        nodes: [...manifest.nodes, { id: id('node'), kind: 'comparison', comparisonId, ...(config.title === undefined ? {} : { title: config.title }),
          layout: defaultLayout(manifest, { width: 620, height: 420 }) }] }))
      return comparisonId
    },
    updateComparison: async (canvas, comparisonId, patch: CanvasComparisonPatch) => {
      const entry = await openForEdit(canvas)
      await mutate(entry, 'comparison', manifest => ({ ...manifest, comparisons: manifest.comparisons.map(config => config.id === comparisonId ? { ...config, ...patch } : config) }))
    },
    setComparisonCursor: async (canvas, comparisonId, input) => {
      const entry = await openForEdit(canvas)
      const value = record(input, '/comparisonCursor')
      exactKeys(value, ['axisIdentity', 'axisId', 'coordinate'], '/comparisonCursor')
      const axisIdentity = text(value.axisIdentity, '/comparisonCursor/axisIdentity', true)
      const axisId = text(value.axisId, '/comparisonCursor/axisId', true)
      const coordinate = finite(value.coordinate, '/comparisonCursor/coordinate')
      await mutate(entry, 'comparison-cursor', async manifest => {
        const config = manifest.comparisons.find(config => config.id === comparisonId)
        if (config === undefined) throw new Error('CANVAS_COMPARISON_MISSING')
        const datasets: Record<string, DatasetObject> = {}
        for (const member of config.members) {
          const alias = manifest.snapshots.find(alias => alias.id === member.snapshotAliasId)
          const snapshot = alias === undefined ? undefined : entry.objects[alias.snapshot.digest]
          const dataset = entry.objects[member.dataset.digest]
          if (snapshot?.kind !== 'snapshot' || dataset?.kind !== 'dataset' || dataset.sourceScene.digest !== snapshot.scene.digest ||
            !snapshot.datasets.some(ref => ref.digest === member.dataset.digest && ref.kind === member.dataset.kind)) throw new Error('CANVAS_COMPARISON_DATASET_MISSING')
          datasets[member.dataset.digest] = dataset
        }
        const { prepareComparison } = await import('@physicsos/physics-workbench/comparison')
        const prepared = prepareComparison(config.mode === 'conditions' ? { ...config, mode: 'overlay' } : config, datasets)
        const axis = prepared.series[0]?.axis
        if (!prepared.compatible || axis === undefined || axis.identity !== axisIdentity || axis.id !== axisId) {
          throw new Error('CANVAS_COMPARISON_CURSOR_AXIS_MISMATCH')
        }
        if (!prepared.series.some(series => series.points.some(point => typeof point.coordinate === 'number' && point.coordinate === coordinate))) {
          throw new Error('CANVAS_COMPARISON_CURSOR_NOT_OBSERVED')
        }
        const cursor = { axisIdentity, axisId, coordinate, axisSignature: canvasComparisonAxisSignature(axis) }
        return { ...manifest, comparisons: manifest.comparisons.map(item => item.id === comparisonId
          ? { ...item, metadata: copyJsonObject({ ...item.metadata, cursor }) } : item) }
      }, {}, false)
    },
    instanceAction: async <K extends CanvasInstanceActionName>(key: string, action: K, ...args: CanvasInstanceActionArguments<K>): Promise<CanvasInstanceActionResult<K>> => {
      await activating; currentScope()
      const location = instanceLocations.get(key)
      if (location === undefined || location.entry.namespace !== currentScope().namespace) throw new Error('CANVAS_INSTANCE_MISSING')
      await openEntry(location.entry)
      const owner = await ensureOwner(location.entry, location.instanceId)
      const callback = owner.actions[action] as (...arguments_: CanvasInstanceActionArguments<K>) => CanvasInstanceActionResult<K>
      return callback(...args)
    },
    attachDisplay: (key, displayKey) => {
      const location = instanceLocations.get(key)
      if (location === undefined || paused || location.entry.namespace !== scope?.namespace) return () => undefined
      const slot = createStableCells(location.entry, location.instanceId)
      slot.displays.add(displayKey)
      if (slot.runtime !== undefined && !slot.invisibleDisplays.has(displayKey) && !slot.detachments.has(displayKey)) {
        slot.detachments.set(displayKey, slot.runtime.attachDisplay(displayKey))
      }
      else void openEntry(location.entry).then(() => ensureOwner(location.entry, location.instanceId)).catch(report)
      return () => controller.detachDisplay(key, displayKey)
    },
    setDisplayVisible: (key, displayKey, shown) => {
      const location = instanceLocations.get(key)
      const slot = location?.entry.instanceRegistry.get(location.instanceId)
      if (slot === undefined || !slot.displays.has(displayKey)) return
      if (shown) {
        slot.invisibleDisplays.delete(displayKey)
        if (!paused && location?.entry.namespace === scope?.namespace && slot.runtime !== undefined && !slot.detachments.has(displayKey)) {
          slot.detachments.set(displayKey, slot.runtime.attachDisplay(displayKey))
        }
      } else {
        slot.invisibleDisplays.add(displayKey)
        slot.detachments.get(displayKey)?.()
        slot.detachments.delete(displayKey)
        slot.runtime?.detachDisplay(displayKey)
      }
    },
    detachDisplay: (key, displayKey) => {
      const location = instanceLocations.get(key)
      const slot = location?.entry.instanceRegistry.get(location.instanceId)
      if (slot === undefined) return
      slot.displays.delete(displayKey)
      slot.invisibleDisplays.delete(displayKey)
      slot.detachments.get(displayKey)?.()
      slot.detachments.delete(displayKey)
      slot.runtime?.detachDisplay(displayKey)
    },
    setVisible: next => {
      visible = next
      for (const entry of entries.values()) if (entry.namespace === scope?.namespace) for (const owner of entry.instanceRegistry.values()) {
        owner.runtime?.setVisible(next && !paused)
      }
    },
    flush: async canvas => {
      const selected = canvas === undefined ? [...entries.values()] : [entryOf(canvas, scope?.namespace ?? namespaceOf(options.getAccount()))]
      for (const entry of selected) {
        for (const owner of entry.instanceRegistry.values()) owner.runtime?.persist()
        if (entry.namespace === scope?.namespace && !paused) await flushEntryNotes(entry)
        else if (entryNotes(entry).some(owner => owner.dirty)) await checkpointNotes(entry, true)
        await entry.queue
        if (entry.failedWrite !== undefined) throw entry.failedWrite
      }
    },
    dispose: async () => {
      if (disposed) return
      try { await controller.flush() } catch (error) { report(error) }
      disposed = true
      scope?.sync?.pause()
      channel?.close()
      browserWindow?.removeEventListener('storage', onStorage)
      browserWindow?.removeEventListener('online', onOnline)
      browserWindow?.removeEventListener('focus', onFocus)
      browserDocument?.removeEventListener('visibilitychange', onVisibility)
      for (const entry of entries.values()) {
        if (entry.timer !== undefined) cancel(entry.timer)
        for (const owner of entry.instanceRegistry.values()) disposeOwner(owner)
      }
      for (const owner of notes.values()) {
        if (owner.timer !== undefined) cancel(owner.timer)
        owner.timer = undefined; owner.source.set(undefined)
      }
      await scope?.sync?.dispose()
      await options.persistence.close()
      publishRootState({ items: [], documents: [], loading: false, authScope: 'paused' })
    },
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== 'physicsos.auth.user') return
    pauseScope(new CanvasRequestError(401, 'CANVAS_ACCOUNT_CHANGED', 'Account data changed in another tab. The previous draft is retained.', undefined, false))
    if (scope?.fingerprint !== fingerprintOf(options.getAccount())) void controller.refreshAccount().catch(report)
  }
  const onOnline = (): void => { if (!paused) void controller.sync().catch(report) }
  const onFocus = (): void => { if (visible && !paused && !disposed) void controller.sync().catch(report) }
  const onVisibility = (): void => {
    controller.setVisible(browserDocument?.visibilityState !== 'hidden')
    if (visible && !paused) void controller.sync().catch(report)
  }
  browserWindow?.addEventListener('storage', onStorage)
  browserWindow?.addEventListener('online', onOnline)
  browserWindow?.addEventListener('focus', onFocus)
  browserDocument?.addEventListener('visibilitychange', onVisibility)
  activating = activate()
  void activating.catch(report)
  return controller
}
