import type { CanvasHead, CanvasOpenResponse } from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest, JsonObject, MergeConflict } from '@physicsos/physics-workbench/types'
import { parseManifest } from '@physicsos/physics-workbench/codec'
import {
  boolean, canonicalStringify, digest, exactKeys, fail, freezeData, integer, isoDate,
  jsonObject, jsonValue, list, oneOf, optional, record, text, unique, unwrap,
} from '@physicsos/physics-workbench/json'
import type {
  CanvasConflictCopy, CanvasDocumentHistory, CanvasDocumentPatch, CanvasEntityPatch,
  CanvasLocalConflictCopy, LocalCanvasRecord, PendingCanvasMutation, SealedMutation,
  CanvasPendingNoteDraft,
} from './persistence.ts'
import type { CanvasClientError } from './types.ts'

export const readCanvasHead = (input: unknown, path = '/head'): CanvasHead => {
  const value = record(input, path)
  exactKeys(value, ['id', 'title', 'version', 'generation', 'changeSeq', 'manifestDigest', 'createdAt', 'updatedAt', 'deletedAt'], path)
  const deletedAt = optional(value.deletedAt, `${path}/deletedAt`, isoDate)
  return freezeData({
    id: text(value.id, `${path}/id`, true), title: text(value.title, `${path}/title`),
    version: integer(value.version, `${path}/version`, 1), generation: integer(value.generation, `${path}/generation`, 1),
    changeSeq: integer(value.changeSeq, `${path}/changeSeq`), manifestDigest: digest(value.manifestDigest, `${path}/manifestDigest`),
    createdAt: isoDate(value.createdAt, `${path}/createdAt`), updatedAt: isoDate(value.updatedAt, `${path}/updatedAt`),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  })
}
export const readMergeConflict = (input: unknown, path = '/conflict'): MergeConflict => {
  const value = record(input, path)
  exactKeys(value, ['path', 'kind', 'base', 'local', 'remote', 'message'], path)
  const base = value.base === undefined ? undefined : jsonValue(value.base, `${path}/base`)
  const local = value.local === undefined ? undefined : jsonValue(value.local, `${path}/local`)
  const remote = value.remote === undefined ? undefined : jsonValue(value.remote, `${path}/remote`)
  return freezeData({
    path: text(value.path, `${path}/path`),
    kind: oneOf(value.kind, ['value', 'delete-modify', 'concurrent-add', 'identity', 'invalid-reference'], `${path}/kind`),
    message: text(value.message, `${path}/message`),
    ...(base === undefined ? {} : { base }), ...(local === undefined ? {} : { local }), ...(remote === undefined ? {} : { remote }),
  })
}
export const readCanvasError = (input: unknown, path = '/error'): CanvasClientError => {
  const value = record(input, path)
  exactKeys(value, ['code', 'message', 'retryable', 'status'], path)
  const status = optional(value.status, `${path}/status`, (entry, at) => integer(entry, at, 0))
  if (status !== undefined && status > 599) fail(`${path}/status`, 'status', 'HTTP status exceeds 599.')
  return freezeData({ code: text(value.code, `${path}/code`, true), message: text(value.message, `${path}/message`),
    retryable: boolean(value.retryable, `${path}/retryable`), ...(status === undefined ? {} : { status }) })
}
const readOpen = (input: unknown, id: string, path: string): CanvasOpenResponse => {
  const value = record(input, path)
  exactKeys(value, ['head', 'manifest'], path)
  const head = readCanvasHead(value.head, `${path}/head`)
  const manifest = unwrap(parseManifest(value.manifest))
  if (head.id !== id || manifest.id !== id || manifest.title !== head.title) fail(path, 'identity', 'Remote copy belongs to another document or head.')
  return { head, manifest }
}
const readConflict = (input: unknown, id: string, path: string): CanvasConflictCopy => {
  const value = record(input, path)
  exactKeys(value, ['base', 'local', 'remote', 'conflicts'], path)
  const base = unwrap(parseManifest(value.base))
  const local = unwrap(parseManifest(value.local))
  if (base.id !== id || local.id !== id) fail(path, 'identity', 'Conflict copies belong to another document.')
  return freezeData({ base, local, remote: readOpen(value.remote, id, `${path}/remote`),
    conflicts: list(value.conflicts, `${path}/conflicts`, readMergeConflict) })
}
const entityFields = {
  nodes: ['id', 'kind', 'title', 'layout', 'groupId', 'locked', 'metadata', 'instanceId', 'snapshotAliasId', 'view', 'metricIds', 'body', 'format', 'comparisonId', 'collapsed'],
  edges: ['id', 'kind', 'from', 'to', 'label', 'metadata'],
  instances: ['instanceId', 'currentScene', 'originScene', 'templateId', 'domain', 'source', 'buildMode', 'clock', 'instanceEditRevision', 'templateRelease', 'rendererRelease', 'metadata'],
  snapshots: ['id', 'title', 'snapshot', 'instanceId', 'metadata'],
  comparisons: ['id', 'title', 'members', 'mode', 'alignment', 'targetUnit', 'axisUnit', 'targetBindings', 'metadata'],
} as const
const readEntityPatch = (input: unknown, path: string): CanvasEntityPatch => {
  const value = record(input, path)
  exactKeys(value, ['collection', 'id', 'before', 'after', 'fields'], path)
  const collection = oneOf(value.collection, ['nodes', 'edges', 'instances', 'snapshots', 'comparisons'], `${path}/collection`)
  const id = text(value.id, `${path}/id`, true)
  const readEntity = (input: unknown, at: string): JsonObject => {
    const source = record(input, at)
    exactKeys(source, entityFields[collection], at)
    if (text(source[collection === 'instances' ? 'instanceId' : 'id'], `${at}/id`, true) !== id) fail(at, 'identity', 'Document history entity has another identity.')
    return jsonObject(source, at)
  }
  const before = optional(value.before, `${path}/before`, readEntity)
  const after = optional(value.after, `${path}/after`, readEntity)
  if (before === undefined && after === undefined) fail(path, 'history', 'Document history requires a before or after entity.')
  const fields = list(value.fields, `${path}/fields`, (input, at) => {
    const field = record(input, at)
    exactKeys(field, ['path', 'before', 'after'], at)
    const segments = list(field.path, `${at}/path`, (entry, where) => text(entry, where, true))
    if (segments.length === 0 || segments.some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment))) fail(`${at}/path`, 'history', 'Document history path is empty or unsafe.')
    if (!entityFields[collection].some(key => key === segments[0]) || segments[0] === (collection === 'instances' ? 'instanceId' : 'id')) fail(`${at}/path`, 'history', 'Document history cannot patch an entity identity or unknown field.')
    const before = field.before === undefined ? undefined : jsonValue(field.before, `${at}/before`)
    const after = field.after === undefined ? undefined : jsonValue(field.after, `${at}/after`)
    if (before === undefined && after === undefined) fail(at, 'history', 'A field patch requires an actual before or after value.')
    return { path: segments, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) }
  })
  unique(fields, field => canonicalStringify(field.path), `${path}/fields`)
  if ((before === undefined || after === undefined) && fields.length !== 0) fail(`${path}/fields`, 'history', 'Entity insertion/removal has no partial field patches.')
  return { collection, id, fields, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) }
}
const readDocumentPatch = (input: unknown, path: string): CanvasDocumentPatch => {
  const value = record(input, path)
  exactKeys(value, ['label', 'entities', 'title'], path)
  const title = optional(value.title, `${path}/title`, (input, at) => {
    const title = record(input, at)
    exactKeys(title, ['before', 'after'], at)
    return { before: text(title.before, `${at}/before`), after: text(title.after, `${at}/after`) }
  })
  const entities = list(value.entities, `${path}/entities`, readEntityPatch)
  unique(entities, entity => canonicalStringify([entity.collection, entity.id]), `${path}/entities`)
  return { label: text(value.label, `${path}/label`, true), entities, ...(title === undefined ? {} : { title }) }
}
const readDocumentHistory = (input: unknown, path: string): CanvasDocumentHistory => {
  const value = record(input, path)
  exactKeys(value, ['schemaVersion', 'past', 'future'], path)
  if (value.schemaVersion !== 1) fail(`${path}/schemaVersion`, 'schema', 'Expected document field-patch history version 1.')
  return freezeData({ schemaVersion: 1, past: list(value.past, `${path}/past`, readDocumentPatch), future: list(value.future, `${path}/future`, readDocumentPatch) })
}
const readPendingNoteDraft = (input: unknown, path: string): CanvasPendingNoteDraft => {
  const value = record(input, path)
  exactKeys(value, ['nodeId', 'writerId', 'revision', 'body', 'format', 'baseBody', 'baseFormat'], path)
  return { nodeId: text(value.nodeId, `${path}/nodeId`, true), writerId: text(value.writerId, `${path}/writerId`, true),
    revision: integer(value.revision, `${path}/revision`, 1), body: text(value.body, `${path}/body`),
    format: oneOf(value.format, ['plain', 'markdown'], `${path}/format`), baseBody: text(value.baseBody, `${path}/baseBody`),
    baseFormat: oneOf(value.baseFormat, ['plain', 'markdown'], `${path}/baseFormat`) }
}
const readLocalConflict = (input: unknown, id: string, path: string): CanvasLocalConflictCopy => {
  const value = record(input, path)
  exactKeys(value, ['base', 'local', 'remote', 'remoteCacheVersion', 'conflicts'], path)
  const base = manifestAt(value.base, id)
  const local = manifestAt(value.local, id)
  const remote = manifestAt(value.remote, id)
  return freezeData({ base, local, remote, remoteCacheVersion: integer(value.remoteCacheVersion, `${path}/remoteCacheVersion`, 1),
    conflicts: list(value.conflicts, `${path}/conflicts`, readMergeConflict) })
}
const readSeal = (input: Record<string, unknown>, request: unknown, path: string): SealedMutation => {
  const body = text(input.body, `${path}/body`, true)
  if (body !== canonicalStringify(request)) fail(`${path}/body`, 'sealed-body', 'Pending mutation body does not match its immutable request.')
  return { body, bodyDigest: digest(input.bodyDigest, `${path}/bodyDigest`),
    createdAt: isoDate(input.createdAt, `${path}/createdAt`), editSequence: integer(input.editSequence, `${path}/editSequence`) }
}
export const readPendingMutation = (input: unknown, id: string, path = '/pending'): PendingCanvasMutation => {
  const value = record(input, path)
  exactKeys(value, ['kind', 'request', 'manifest', 'body', 'bodyDigest', 'createdAt', 'editSequence'], path)
  const kind = oneOf(value.kind, ['create', 'commit', 'delete', 'restore'], `${path}/kind`)
  const request = record(value.request, `${path}/request`)
  const mutationId = text(request.mutationId, `${path}/request/mutationId`, true)
  if (kind === 'create') {
    exactKeys(request, ['id', 'title', 'mutationId'], `${path}/request`)
    if (request.id !== id) fail(`${path}/request/id`, 'identity', 'Create mutation belongs to another document.')
    if (value.manifest !== undefined) fail(`${path}/manifest`, 'unknown-field', 'Create mutation does not upload a manifest before the head exists.')
    const parsedRequest = { id, title: text(request.title, `${path}/request/title`), mutationId }
    return freezeData({ kind, request: parsedRequest, ...readSeal(value, parsedRequest, path) })
  }
  const expectedVersion = integer(request.expectedVersion, `${path}/request/expectedVersion`, 1)
  if (kind === 'delete') {
    exactKeys(request, ['expectedVersion', 'mutationId'], `${path}/request`)
    if (value.manifest !== undefined) fail(`${path}/manifest`, 'unknown-field', 'Delete mutation has no manifest payload.')
    const parsedRequest = { expectedVersion, mutationId }
    return freezeData({ kind, request: parsedRequest, ...readSeal(value, parsedRequest, path) })
  }
  const expectedGeneration = optional(request.expectedGeneration, `${path}/request/expectedGeneration`, (entry, at) => integer(entry, at, 1))
  const versioned = { expectedVersion, mutationId, ...(expectedGeneration === undefined ? {} : { expectedGeneration }) }
  if (kind === 'restore') {
    exactKeys(request, ['expectedVersion', 'expectedGeneration', 'mutationId'], `${path}/request`)
    if (value.manifest !== undefined) fail(`${path}/manifest`, 'unknown-field', 'Restore mutation has no manifest payload.')
    return freezeData({ kind, request: versioned, ...readSeal(value, versioned, path) })
  }
  exactKeys(request, ['expectedVersion', 'expectedGeneration', 'mutationId', 'manifestDigest'], `${path}/request`)
  const manifest = unwrap(parseManifest(value.manifest))
  if (manifest.id !== id) fail(`${path}/manifest/id`, 'identity', 'Commit manifest belongs to another document.')
  const parsedRequest = { ...versioned, manifestDigest: digest(request.manifestDigest, `${path}/request/manifestDigest`) }
  return freezeData({ kind, request: parsedRequest, manifest, ...readSeal(value, parsedRequest, path) })
}

/** IndexedDB is an untrusted versioned boundary, not a typed in-memory object store. */
export const readLocalCanvasRecord = (input: unknown, namespace: string): LocalCanvasRecord => {
  const value = record(input, '/document')
  exactKeys(value, ['namespace', 'id', 'cacheVersion', 'editSequence', 'acknowledgedSequence', 'working', 'base', 'head',
    'pending', 'conflict', 'localConflict', 'documentHistory', 'pendingNoteDrafts', 'deleted', 'savedAt', 'error'], '/document')
  if (value.namespace !== namespace) fail('/document/namespace', 'account', 'Cached document belongs to another account.')
  const id = text(value.id, '/document/id', true)
  const working = unwrap(parseManifest(value.working))
  const base = value.base === undefined ? undefined : unwrap(parseManifest(value.base))
  const head = optional(value.head, '/document/head', readCanvasHead)
  if (working.id !== id || (base !== undefined && base.id !== id) || (head !== undefined && head.id !== id)) {
    fail('/document', 'identity', 'Cached document identity does not match its working copy, base, or head.')
  }
  if ((base === undefined) !== (head === undefined)) fail('/document/base', 'base', 'A server head and its base manifest must be retained together.')
  if (head !== undefined && base !== undefined && base.title !== head.title) fail('/document/base/title', 'head', 'Base manifest title differs from its server head.')
  const cacheVersion = integer(value.cacheVersion, '/document/cacheVersion')
  const editSequence = integer(value.editSequence, '/document/editSequence')
  const acknowledgedSequence = integer(value.acknowledgedSequence, '/document/acknowledgedSequence')
  if (acknowledgedSequence > editSequence) fail('/document/acknowledgedSequence', 'sequence', 'Acknowledgements cannot cover edits which do not exist.')
  const pending = optional(value.pending, '/document/pending', (entry, at) => readPendingMutation(entry, id, at))
  if (pending !== undefined && pending.editSequence > editSequence) fail('/document/pending/editSequence', 'sequence', 'Pending mutation cannot cover future edits.')
  const conflict = optional(value.conflict, '/document/conflict', (entry, at) => readConflict(entry, id, at))
  const localConflict = optional(value.localConflict, '/document/localConflict', (entry, at) => readLocalConflict(entry, id, at))
  const documentHistory = optional(value.documentHistory, '/document/documentHistory', readDocumentHistory)
  const pendingNoteDrafts = optional(value.pendingNoteDrafts, '/document/pendingNoteDrafts', (input, path) => {
    const drafts = list(input, path, readPendingNoteDraft)
    unique(drafts, draft => draft.nodeId, path)
    for (const draft of drafts) if (!working.nodes.some(node => node.id === draft.nodeId && node.kind === 'note')) {
      fail(path, 'identity', 'A pending note draft must reference a note in this document.')
    }
    return drafts
  })
  const error = optional(value.error, '/document/error', readCanvasError)
  return freezeData({ namespace, id, cacheVersion, editSequence, acknowledgedSequence, working,
    deleted: boolean(value.deleted, '/document/deleted'), savedAt: isoDate(value.savedAt, '/document/savedAt'),
    ...(base === undefined ? {} : { base }), ...(head === undefined ? {} : { head }),
    ...(pending === undefined ? {} : { pending }), ...(conflict === undefined ? {} : { conflict }),
    ...(localConflict === undefined ? {} : { localConflict }), ...(documentHistory === undefined ? {} : { documentHistory }),
    ...(pendingNoteDrafts === undefined ? {} : { pendingNoteDrafts }),
    ...(error === undefined ? {} : { error }) })
}

export const manifestAt = (value: unknown, id: string): CanvasManifest => {
  const manifest = unwrap(parseManifest(value))
  if (manifest.id !== id) fail('/id', 'identity', 'Manifest belongs to another canvas.')
  return manifest
}
