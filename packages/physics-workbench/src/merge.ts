import { parseManifest } from './codec.ts'
import { freezeData, jsonObject, jsonValue, pointer, WorkbenchDataError } from './json.ts'
import type {
  CanvasManifest, JsonObject, JsonValue, MergeConflict, MergeResult, ParseResult,
} from './types.ts'

type Value = JsonValue | undefined
type EntityKind = 'node' | 'edge' | 'instance' | 'snapshot' | 'comparison' | 'member'
type IdentityKey = 'id' | 'instanceId'
interface MergeContext { readonly conflicts: MergeConflict[] }

const collections = [
  ['nodes', 'node', 'id'],
  ['edges', 'edge', 'id'],
  ['instances', 'instance', 'instanceId'],
  ['snapshots', 'snapshot', 'id'],
  ['comparisons', 'comparison', 'id'],
] as const
const identityKeys = new Map<string, IdentityKey>(collections.map(([name, , key]) => [name, key] as const))

const isArray = (value: Value): value is readonly JsonValue[] => Array.isArray(value)
const isObject = (value: Value): value is JsonObject =>
  value !== null && typeof value === 'object' && !isArray(value)
const own = (value: JsonObject | undefined, key: string): Value =>
  value !== undefined && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined

/** Object property order is not content; array order and text are content. */
const equal = (left: Value, right: Value): boolean => {
  if (left === right) return true
  if (isArray(left) && isArray(right)) {
    return left.length === right.length && left.every((entry, index) => equal(entry, right[index]))
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length && keys.every((key) =>
      Object.prototype.hasOwnProperty.call(right, key) && equal(own(left, key), own(right, key)))
  }
  return false
}

const conflict = (
  context: MergeContext, path: string, kind: MergeConflict['kind'],
  base: Value, local: Value, remote: Value, message: string,
): undefined => {
  context.conflicts.push({
    path, kind,
    ...(base === undefined ? {} : { base }),
    ...(local === undefined ? {} : { local }),
    ...(remote === undefined ? {} : { remote }),
    message,
  })
  return undefined
}

const atomic = (
  context: MergeContext, path: string, base: Value, local: Value, remote: Value,
  message = 'Concurrent edits changed the same value differently.',
  kind: MergeConflict['kind'] = 'value',
): Value => {
  if (equal(local, remote)) return local
  if (equal(base, local)) return remote
  if (equal(base, remote)) return local
  return conflict(context, path,
    base !== undefined && (local === undefined || remote === undefined) ? 'delete-modify' : kind,
    base, local, remote, message)
}

const immutable = (
  context: MergeContext, path: string, base: Value, local: Value, remote: Value, message: string,
): Value => equal(base, local) && equal(base, remote)
  ? base
  : conflict(context, path, 'identity', base, local, remote, message)

/** Only plain object keys recurse here. Even metadata arrays containing IDs remain atomic. */
const mergeJson = (
  context: MergeContext, path: string, base: Value, local: Value, remote: Value,
): Value => {
  if (equal(local, remote)) return local
  if (equal(base, local)) return remote
  if (equal(base, remote)) return local
  if (local === undefined || remote === undefined) {
    return conflict(context, path, 'delete-modify', base, local, remote,
      'One side removed this value while the other modified it.')
  }
  if (isObject(local) && isObject(remote) && (base === undefined || isObject(base))) {
    const output: Record<string, JsonValue> = {}
    const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(remote)])
    for (const key of [...keys].sort()) {
      const value = mergeJson(context, pointer(path, key), own(base, key), own(local, key), own(remote, key))
      if (value !== undefined) output[key] = value
    }
    return output
  }
  return conflict(context, path, 'value', base, local, remote,
    isArray(local) || isArray(remote)
      ? 'Concurrent array changes require a choice; arrays are atomic outside contract-owned entity collections.'
      : 'Concurrent edits changed the same value differently.')
}

const pick = (value: JsonObject, keys: readonly string[]): JsonObject => {
  const output: Record<string, JsonValue> = {}
  for (const key of keys) {
    const entry = own(value, key)
    if (entry !== undefined) output[key] = entry
  }
  return output
}

// Source (including its presentation metadata), domain and release identity travel with the
// scene/edit state. Splicing a new scene into another edit's clock or provenance is not safe.
const instanceEditKeys = [
  'instanceId', 'currentScene', 'clock', 'instanceEditRevision', 'buildMode', 'domain',
  'source', 'templateId', 'templateRelease', 'rendererRelease',
] as const
const instanceIdentityKeys = ['domain', 'source', 'templateId', 'templateRelease', 'rendererRelease'] as const
const memberBindingKeys = ['snapshotAliasId', 'dataset', 'metricId', 'axisId'] as const

const mergeInstance = (
  context: MergeContext, path: string, base: JsonObject, local: JsonObject, remote: JsonObject,
): JsonObject | undefined => {
  const origin = immutable(context, pointer(path, 'originScene'),
    own(base, 'originScene'), own(local, 'originScene'), own(remote, 'originScene'),
    'An existing instance cannot change its immutable origin scene; a different origin needs a new instance identity.')
  const edit = atomic(context, path, pick(base, instanceEditKeys), pick(local, instanceEditKeys), pick(remote, instanceEditKeys),
    'Concurrent instance edits cannot split currentScene, clock, instanceEditRevision, buildMode, or source/domain and release identity.',
    equal(pick(local, instanceIdentityKeys), pick(remote, instanceIdentityKeys)) ? 'value' : 'identity')
  const metadata = mergeJson(context, pointer(path, 'metadata'), own(base, 'metadata'), own(local, 'metadata'), own(remote, 'metadata'))
  if (!isObject(origin) || !isObject(edit)) return undefined
  return { ...edit, originScene: origin, ...(metadata === undefined ? {} : { metadata }) }
}

const mergeMember = (
  context: MergeContext, path: string, base: JsonObject, local: JsonObject, remote: JsonObject,
): JsonObject | undefined => {
  const binding = atomic(context, path,
    pick(base, memberBindingKeys), pick(local, memberBindingKeys), pick(remote, memberBindingKeys),
    'Concurrent member edits cannot split the snapshot alias, dataset, metric and axis binding.')
  const label = mergeJson(context, pointer(path, 'label'), own(base, 'label'), own(local, 'label'), own(remote, 'label'))
  if (!isObject(binding)) return undefined
  return { ...pick(base, ['id']), ...binding, ...(label === undefined ? {} : { label }) }
}

const mergeEntity = (
  context: MergeContext, path: string, kind: EntityKind,
  base: JsonObject | undefined, local: JsonObject | undefined, remote: JsonObject | undefined,
): JsonObject | undefined => {
  if (base === undefined) {
    if (local === undefined) return remote
    if (remote === undefined || equal(local, remote)) return local
    return conflict(context, path, 'concurrent-add', base, local, remote,
      'Both sides added different entities with the same identity.')
  }
  if (local === undefined && remote === undefined) return undefined
  if (local === undefined || remote === undefined) {
    if (equal(base, local ?? remote)) return undefined
    return conflict(context, path, 'delete-modify', base, local, remote,
      'One side deleted this entity while the other modified it.')
  }
  // Provenance invariants must still be checked when both sides made identical changes.
  if (kind === 'instance') return mergeInstance(context, path, base, local, remote)
  if (equal(local, remote)) return local
  if (equal(base, local)) return remote
  if (equal(base, remote)) return local
  if (kind === 'member') return mergeMember(context, path, base, local, remote)

  const output: Record<string, JsonValue> = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
  for (const key of [...keys].sort()) {
    const at = pointer(path, key)
    const before = own(base, key)
    const left = own(local, key)
    const right = own(remote, key)
    const value = kind === 'comparison' && key === 'members'
      ? mergeCollection(context, at, 'member', 'id', before, left, right)
      : kind === 'snapshot' && key === 'snapshot'
        ? atomic(context, at, before, left, right)
        : mergeJson(context, at, before, left, right)
    if (value !== undefined) output[key] = value
  }
  return output
}

const indexEntities = (
  context: MergeContext, path: string, key: IdentityKey, value: Value,
): Map<string, JsonObject> | undefined => {
  if (!isArray(value)) {
    return conflict(context, path, 'invalid-reference', undefined, undefined, undefined,
      'Expected a validated contract-owned entity collection.')
  }
  const index = new Map<string, JsonObject>()
  for (const [position, entry] of value.entries()) {
    const identity = isObject(entry) ? own(entry, key) : undefined
    if (!isObject(entry) || typeof identity !== 'string' || index.has(identity)) {
      return conflict(context, pointer(path, position), 'invalid-reference', undefined, undefined, undefined,
        'Entity collection contains an invalid or duplicate identity.')
    }
    index.set(identity, entry)
  }
  return index
}

const sameOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/**
 * Preserve an unopposed order edit and matching orders. When both memberships changed,
 * retain surviving base order (or its unopposed reorder), then append new IDs lexically.
 * Shared additions keep their agreed placement. Deletions are not reorders; different
 * reorders of surviving base IDs or placements of shared additions conflict.
 */
const mergeOrder = (
  context: MergeContext, path: string, base: readonly string[], local: readonly string[], remote: readonly string[],
  entities: ReadonlyMap<string, JsonObject>,
): readonly string[] | undefined => {
  const surviving = (ids: readonly string[]): string[] => ids.filter((id) => entities.has(id))
  if (sameOrder(local, remote)) return surviving(local)
  if (sameOrder(base, local)) return surviving(remote)
  if (sameOrder(base, remote)) return surviving(local)

  const baseIds = new Set(base)
  const before = surviving(base)
  const left = local.filter((id) => baseIds.has(id) && entities.has(id))
  const right = remote.filter((id) => baseIds.has(id) && entities.has(id))
  const leftReordered = !sameOrder(before, left)
  const rightReordered = !sameOrder(before, right)
  if (leftReordered && rightReordered && !sameOrder(left, right)) {
    return conflict(context, path, 'value', base, local, remote,
      'Both sides intentionally reordered the surviving entities differently.')
  }
  const localIds = new Set(local)
  const remoteIds = new Set(remote)
  const commonIds = new Set([...entities.keys()].filter((id) => localIds.has(id) && remoteIds.has(id)))
  const commonAddition = [...commonIds].some((id) => !baseIds.has(id))
  const leftCommon = local.filter((id) => commonIds.has(id))
  const rightCommon = remote.filter((id) => commonIds.has(id))
  if (commonAddition && !sameOrder(leftCommon, rightCommon)) {
    return conflict(context, path, 'value', base, local, remote,
      'Concurrent orders disagree on the placement of entities added by both sides.')
  }
  const localSurvivors = surviving(local)
  const remoteSurvivors = surviving(remote)
  if (sameOrder(localSurvivors, remoteSurvivors)) return localSurvivors
  const existing = commonAddition ? leftCommon : leftReordered ? left : rightReordered ? right : before
  const placed = new Set(existing)
  const added = [...entities.keys()].filter((id) => !placed.has(id)).sort()
  return [...existing, ...added]
}

function mergeCollection(
  context: MergeContext, path: string, kind: EntityKind, key: IdentityKey,
  base: Value, local: Value, remote: Value,
): readonly JsonObject[] | undefined {
  const before = indexEntities(context, path, key, base)
  const left = indexEntities(context, path, key, local)
  const right = indexEntities(context, path, key, remote)
  if (before === undefined || left === undefined || right === undefined) return undefined
  const entities = new Map<string, JsonObject>()
  const ids = new Set([...before.keys(), ...left.keys(), ...right.keys()])
  for (const id of [...ids].sort()) {
    const entity = mergeEntity(context, pointer(path, id), kind, before.get(id), left.get(id), right.get(id))
    if (entity !== undefined) entities.set(id, entity)
  }
  const order = mergeOrder(context, path, [...before.keys()], [...left.keys()], [...right.keys()], entities)
  return order?.map((id) => entities.get(id)!)
}

const safeParse = (input: unknown): ParseResult<CanvasManifest> => {
  try {
    return parseManifest(input)
  } catch (error) {
    return {
      ok: false,
      issues: error instanceof WorkbenchDataError ? error.issues : [{
        path: '', code: 'json', message: 'Manifest could not be read as plain JSON data.',
      }],
    }
  }
}
const safeJson = (input: unknown): Value => {
  try { return jsonValue(input) } catch { return undefined }
}
const segments = (path: string): string[] => path === '' ? [] : path.slice(1).split('/').map((key) =>
  key.replace(/~1/g, '/').replace(/~0/g, '~'))
const valueAt = (input: Value, keys: readonly string[]): Value => {
  let value = input
  for (const key of keys) {
    if (isObject(value)) value = own(value, key)
    else if (isArray(value) && /^(0|[1-9]\d*)$/.test(key)) value = value[Number(key)]
    else return undefined
  }
  return value
}

/** Turn codec array-index paths into stable entity paths without inspecting metadata refs. */
const identityPath = (manifest: JsonObject, path: string): string => {
  const keys = segments(path)
  const collection = keys[0]
  const position = keys[1]
  const identityKey = collection === undefined ? undefined : identityKeys.get(collection)
  if (collection !== undefined && identityKey !== undefined && position !== undefined && /^(0|[1-9]\d*)$/.test(position)) {
    const entity = valueAt(manifest, [collection, position])
    const id = isObject(entity) ? own(entity, identityKey) : undefined
    if (typeof id === 'string') keys[1] = id
    if (collection === 'comparisons' && keys[2] === 'members' && keys[3] !== undefined) {
      const member = valueAt(entity, ['members', keys[3]])
      const memberId = isObject(member) ? own(member, 'id') : undefined
      if (typeof memberId === 'string') keys[3] = memberId
    }
  }
  return keys.reduce((result, key) => pointer(result, key), '')
}
const identityValueAt = (manifest: JsonObject, path: string): Value => {
  const keys = segments(path)
  const collection = keys[0]
  const identityKey = collection === undefined ? undefined : identityKeys.get(collection)
  if (collection === undefined || identityKey === undefined || keys.length < 2) return valueAt(manifest, keys)
  const entries = own(manifest, collection)
  if (!isArray(entries)) return undefined
  const entity = entries.find((entry) => isObject(entry) && own(entry, identityKey) === keys[1])
  if (collection === 'comparisons' && keys[2] === 'members' && keys.length >= 4) {
    const members = valueAt(entity, ['members'])
    if (!isArray(members)) return undefined
    const member = members.find((entry) => isObject(entry) && own(entry, 'id') === keys[3])
    return valueAt(member, keys.slice(4))
  }
  return valueAt(entity, keys.slice(2))
}

/** Timestamp policy, not a content winner: never regress base, prefer it on equal instants. */
const latestUpdatedAt = (base: string, local: string, remote: string): string => {
  const latest = Math.max(Date.parse(base), Date.parse(local), Date.parse(remote))
  if (Date.parse(base) === latest) return base
  // Equivalent side timestamps use a deterministic existing spelling, not a fabricated time.
  return [local, remote].filter((value) => Date.parse(value) === latest).sort()[0]!
}
const failure = (context: MergeContext): MergeResult => {
  const result: MergeResult = { ok: false, conflicts: context.conflicts }
  return freezeData(result)
}

/**
 * Conservative, detached three-way document merge. Immutable canvas/origin identities
 * are invariants even for identical side changes. Any conflict withholds the candidate.
 * Blob contents are not loaded, and arbitrary metadata never manufactures references.
 */
export const mergeManifests = (
  base: CanvasManifest, local: CanvasManifest, remote: CanvasManifest,
): MergeResult => {
  const context: MergeContext = { conflicts: [] }
  const before = safeParse(base)
  const left = safeParse(local)
  const right = safeParse(remote)
  if (!before.ok || !left.ok || !right.ok) {
    const inputs = [
      { side: 'base', input: base, result: before },
      { side: 'local', input: local, result: left },
      { side: 'remote', input: remote, result: right },
    ] as const
    for (const { side, input, result } of inputs) {
      if (result.ok) continue
      const data = safeJson(input)
      for (const issue of result.issues) {
        const value = valueAt(data, segments(issue.path))
        conflict(context, `${pointer('', side)}${issue.path}`, 'invalid-reference',
          side === 'base' ? value : undefined, side === 'local' ? value : undefined, side === 'remote' ? value : undefined,
          `Invalid ${side} manifest (${issue.code}): ${issue.message}`)
      }
    }
    return failure(context)
  }

  const baseJson = jsonObject(before.value)
  const localJson = jsonObject(left.value)
  const remoteJson = jsonObject(right.value)
  const candidate: Record<string, JsonValue> = {
    schemaVersion: 1,
    updatedAt: latestUpdatedAt(before.value.updatedAt, left.value.updatedAt, right.value.updatedAt),
  }
  const set = (key: string, value: Value): void => { if (value !== undefined) candidate[key] = value }
  set('id', immutable(context, '/id', before.value.id, left.value.id, right.value.id,
    'All three manifests must have the same canvas identity.'))
  set('createdAt', immutable(context, '/createdAt', before.value.createdAt, left.value.createdAt, right.value.createdAt,
    'Canvas createdAt is immutable across merge inputs.'))
  for (const key of ['title', 'viewport', 'metadata']) {
    set(key, mergeJson(context, pointer('', key), own(baseJson, key), own(localJson, key), own(remoteJson, key)))
  }
  set('history', atomic(context, '/history', own(baseJson, 'history'), own(localJson, 'history'), own(remoteJson, 'history')))
  for (const [name, kind, key] of collections) {
    set(name, mergeCollection(context, pointer('', name), kind, key, own(baseJson, name), own(localJson, name), own(remoteJson, name)))
  }
  if (context.conflicts.length > 0) return failure(context)

  const checked = safeParse(candidate)
  if (!checked.ok) {
    for (const issue of checked.issues) {
      const path = identityPath(candidate, issue.path)
      conflict(context, path, 'invalid-reference', identityValueAt(baseJson, path), identityValueAt(localJson, path), identityValueAt(remoteJson, path),
        `Merged manifest is invalid (${issue.code}): ${issue.message}`)
    }
    return failure(context)
  }
  const result: MergeResult = { ok: true, manifest: checked.value, conflicts: [] }
  return freezeData(result)
}
