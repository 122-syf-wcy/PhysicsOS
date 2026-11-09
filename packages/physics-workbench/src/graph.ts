import { parseManifest, parseObject, refsOf } from './codec.ts'
import {
  boolean, canonicalJsonStats, canonicalStringify, copyCanonicalData, copyJsonObject, digest, exactKeys, fail, finite, freezeData,
  integer, isCanonicalData, isoDate, optional, parsed, pointer, record, text, WorkbenchDataError,
} from './json.ts'
import {
  CANVAS_FILE_FORMAT,
  type CanvasFile, type CanvasGraph, type CanvasManifest, type CanvasNode, type CanvasStoredValue,
  type CloneGraphOptions, type CloneGraphResult, type DatasetObject, type Digest,
  type ExperimentInstance, type HistoryObject, type InstanceSource, type JsonValue,
  type ObjectRef, type ParseIssue, type ParseResult, type SceneObject,
  type WorkbenchObject,
} from './types.ts'

/** Resource budgets are caller-overridable; portable defaults do not override a Host policy. */
export interface GraphLimits {
  readonly maxBytes: number
  readonly maxJsonNodes: number
  readonly maxDepth: number
  readonly maxObjects: number
  readonly maxReferences: number
  readonly maxReferencesPerObject: number
  readonly maxIssues: number
}
export const GRAPH_LIMITS: GraphLimits = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxJsonNodes: 2_000_000,
  maxDepth: 256,
  maxObjects: 50_000,
  maxReferences: 250_000,
  maxReferencesPerObject: 16_384,
  maxIssues: 128,
})

const readLimits = (input: Partial<GraphLimits> | undefined): GraphLimits => {
  const value = record(input ?? {}, '/limits')
  exactKeys(value, Object.keys(GRAPH_LIMITS), '/limits')
  const result = { ...GRAPH_LIMITS }
  for (const key of Object.keys(GRAPH_LIMITS) as (keyof GraphLimits)[]) {
    const candidate = value[key]
    if (candidate !== undefined) result[key] = integer(candidate, pointer('/limits', key), key === 'maxIssues' ? 1 : 0)
  }
  // The shared recursive codec has a fixed security ceiling, independent of portable policy.
  if (result.maxDepth > 512) fail('/limits/maxDepth', 'depth-limit', 'The JSON codec security ceiling is 512 nesting levels.')
  return result
}
/** Resolve one explicit graph policy without changing conservative portable defaults. */
export const resolveGraphLimits = (input?: Partial<GraphLimits>): GraphLimits => readLimits(input)

const encoder = new TextEncoder()
const objectPath = (identity: Digest): string => pointer('/objects', identity)
const refKey = (ref: ObjectRef): string => `${ref.kind}:${ref.digest}`
const identityKey = (kind: string, identity: string): string => pointer(kind, identity)
const distinctRefs = <K extends ObjectRef['kind']>(refs: readonly ObjectRef<K>[]): ObjectRef<K>[] => {
  const seen = new Set<Digest>()
  return refs.filter((ref) => {
    if (seen.has(ref.digest)) return false
    seen.add(ref.digest)
    return true
  })
}

interface JsonVisit {
  readonly kind: 'visit'
  readonly value: unknown
  readonly path: string
  readonly depth: number
}
interface JsonLeave { readonly kind: 'leave'; readonly value: object }

/** Bounds decoded input before the recursive JSON/domain readers can allocate copies. */
const assertJsonLimits = (input: unknown, limits: GraphLimits): void => {
  const stack: (JsonVisit | JsonLeave)[] = [{ kind: 'visit', value: input, path: '', depth: 0 }]
  const active = new Set<object>()
  let scheduled = 1
  if (scheduled > limits.maxJsonNodes) return fail('', 'graph-quota', 'Graph JSON exceeds the portable value-count limit.')
  let bytes = 0
  const addBytes = (count: number, path: string): void => {
    bytes += count
    if (bytes > limits.maxBytes) fail(path, 'graph-quota', 'Canonical graph JSON exceeds the portable byte limit.')
  }
  const stringBytes = (value: string, path: string): number => {
    if (value.length > limits.maxBytes - bytes) fail(path, 'graph-quota', 'A JSON string exceeds the portable byte limit.')
    return encoder.encode(JSON.stringify(text(value, path))).byteLength
  }
  const schedule = (value: unknown, path: string, depth: number): void => {
    scheduled += 1
    if (scheduled > limits.maxJsonNodes) fail(path, 'graph-quota', 'Graph JSON exceeds the portable value-count limit.')
    if (depth > limits.maxDepth) fail(path, 'graph-quota', 'Graph JSON exceeds the portable nesting limit.')
    stack.push({ kind: 'visit', value, path, depth })
  }
  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.kind === 'leave') {
      active.delete(frame.value)
      continue
    }
    const { value, path, depth } = frame
    const cached = canonicalJsonStats(value)
    if (cached !== undefined) {
      scheduled += cached.nodes - 1
      if (scheduled > limits.maxJsonNodes) fail(path, 'graph-quota', 'Graph JSON exceeds the portable value-count limit.')
      if (depth + cached.depth > limits.maxDepth) fail(path, 'graph-quota', 'Graph JSON exceeds the portable nesting limit.')
      addBytes(cached.bytes, path)
      continue
    }
    if (value === null) { addBytes(4, path); continue }
    if (typeof value === 'boolean') { addBytes(value ? 4 : 5, path); continue }
    if (typeof value === 'number') { addBytes(JSON.stringify(finite(value, path)).length, path); continue }
    if (typeof value === 'string') { addBytes(stringBytes(value, path), path); continue }
    if (typeof value !== 'object') return fail(path, 'json', 'Graph content must be plain JSON data.')
    if (active.has(value)) fail(path, 'cycle', 'Cyclic JSON data cannot form a portable graph.')
    active.add(value)
    stack.push({ kind: 'leave', value })
    if (Array.isArray(value)) {
      const prototype: unknown = Object.getPrototypeOf(value)
      if (prototype !== Array.prototype) fail(path, 'prototype', 'Only plain JSON arrays are accepted.')
      if (Object.getOwnPropertySymbols(value).length > 0) fail(path, 'symbol', 'Array symbols are not JSON data.')
      const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return fail(path, 'array', 'Expected a finite JSON array length.')
      if (length > limits.maxJsonNodes - scheduled) fail(path, 'graph-quota', 'A JSON array exceeds the portable value-count limit.')
      const names = Object.getOwnPropertyNames(value)
      if (names.length !== length + 1) fail(path, 'array-entry', 'Sparse arrays and additional array properties are not JSON data.')
      for (const key of names) {
        if (key === 'length') continue
        const index = Number(key)
        if (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(index) || index >= length) {
          fail(pointer(path, key), 'array-property', 'Arrays may contain only their indexed entries.')
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
          fail(pointer(path, key), 'array-entry', 'Array entries must be enumerable data properties.')
        }
      }
      addBytes(2 + Math.max(0, length - 1), path)
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))!
        schedule(descriptor.value, pointer(path, index), depth + 1)
      }
    } else {
      const source = record(value, path)
      const keys = Object.keys(source)
      if (keys.length > limits.maxJsonNodes - scheduled) fail(path, 'graph-quota', 'A JSON object exceeds the portable value-count limit.')
      addBytes(2 + Math.max(0, keys.length - 1) + keys.length, path)
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index]!
        const at = pointer(path, key)
        addBytes(stringBytes(key, at), at)
        schedule(source[key], at, depth + 1)
      }
    }
  }
}

const readAt = <T>(result: ParseResult<T>, path: string, limits: GraphLimits): T => {
  if (result.ok) return result.value
  throw new WorkbenchDataError(result.issues.slice(0, limits.maxIssues).map((issue) => ({ ...issue, path: `${path}${issue.path}` })))
}

/** A content-addressed reader must not silently drop extensions or invent hashed data. */
const requireLossless = (input: unknown, output: unknown, path: string): void => {
  if (canonicalStringify(input) !== canonicalStringify(output)) {
    fail(path, 'noncanonical-object', 'The parsed contract would change canonical content; publish an explicitly validated object first.')
  }
}

const typedObjectReads = new WeakMap<object, WorkbenchObject>()
const typedManifestReads = new WeakMap<object, CanvasManifest>()
const readObjectAt = (input: unknown, path: string, limits: GraphLimits): WorkbenchObject => {
  if (isCanonicalData(input)) {
    const cached = typedObjectReads.get(input)
    if (cached !== undefined) return cached
  }
  const object = copyCanonicalData(readAt(parseObject(input), path, limits))
  requireLossless(input, object, path)
  typedObjectReads.set(object, object)
  if (isCanonicalData(input)) typedObjectReads.set(input, object)
  return object
}
const readManifestAt = (input: unknown, limits: GraphLimits): CanvasManifest => {
  if (isCanonicalData(input)) {
    const cached = typedManifestReads.get(input)
    if (cached !== undefined) return cached
  }
  const manifest = copyCanonicalData(readAt(parseManifest(input), '/manifest', limits))
  requireLossless(input, manifest, '/manifest')
  typedManifestReads.set(manifest, manifest)
  if (isCanonicalData(input)) typedManifestReads.set(input, manifest)
  return manifest
}

const referenceLocations = (value: CanvasStoredValue, path: string): ReadonlyMap<string, string> => {
  const locations = new Map<string, string>()
  const add = (ref: ObjectRef, at: string): void => { if (!locations.has(refKey(ref))) locations.set(refKey(ref), at) }
  if (!('kind' in value)) {
    value.instances.forEach((instance, index) => {
      add(instance.currentScene, `${path}/instances/${index}/currentScene`)
      add(instance.originScene, `${path}/instances/${index}/originScene`)
    })
    value.snapshots.forEach((alias, index) => add(alias.snapshot, `${path}/snapshots/${index}/snapshot`))
    value.comparisons.forEach((comparison, index) => comparison.members.forEach((member, memberIndex) => {
      add(member.dataset, `${path}/comparisons/${index}/members/${memberIndex}/dataset`)
    }))
    if (value.history !== undefined) add(value.history, `${path}/history`)
  } else {
    switch (value.kind) {
      case 'scene': break
      case 'snapshot':
        add(value.scene, `${path}/scene`)
        value.datasets.forEach((ref, index) => add(ref, `${path}/datasets/${index}`))
        break
      case 'dataset': add(value.sourceScene, `${path}/sourceScene`); break
      case 'history':
        value.parents.forEach((ref, index) => add(ref, `${path}/parents/${index}`))
        value.entries.forEach((entry, index) => {
          if (entry.scene !== undefined) add(entry.scene, `${path}/entries/${index}/scene`)
          if (entry.snapshot !== undefined) add(entry.snapshot, `${path}/entries/${index}/snapshot`)
        })
        break
    }
  }
  return locations
}

const referenceCount = (value: CanvasStoredValue): number => {
  if (!('kind' in value)) {
    let count = value.instances.length * 2 + value.snapshots.length + (value.history === undefined ? 0 : 1)
    for (const comparison of value.comparisons) count += comparison.members.length
    return count
  }
  switch (value.kind) {
    case 'scene': return 0
    case 'dataset': return 1
    case 'snapshot': return 1 + value.datasets.length
    case 'history': {
      let count = value.parents.length
      for (const entry of value.entries) count += (entry.scene === undefined ? 0 : 1) + (entry.snapshot === undefined ? 0 : 1)
      return count
    }
  }
}

const sceneAt = (objects: CanvasGraph['objects'], ref: ObjectRef<'scene'>, path: string): SceneObject => {
  const object = objects[ref.digest]
  return object?.kind === 'scene' ? object : fail(path, 'blob-kind', 'Expected a referenced scene object.')
}
const datasetAt = (objects: CanvasGraph['objects'], ref: ObjectRef<'dataset'>, path: string): DatasetObject => {
  const object = objects[ref.digest]
  return object?.kind === 'dataset' ? object : fail(path, 'blob-kind', 'Expected a referenced dataset object.')
}

/** Dependencies precede their users. An explicit stack also handles long history DAGs. */
const dependencyOrder = (adjacency: ReadonlyMap<Digest, readonly ObjectRef[]>): readonly Digest[] => {
  const colors = new Map<Digest, 'active' | 'complete'>()
  const ordered: Digest[] = []
  interface Frame { readonly digest: Digest; readonly refs: readonly ObjectRef[]; next: number }
  for (const identity of adjacency.keys()) {
    if (colors.has(identity)) continue
    const stack: Frame[] = [{ digest: identity, refs: adjacency.get(identity)!, next: 0 }]
    colors.set(identity, 'active')
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      if (frame.next === frame.refs.length) {
        colors.set(frame.digest, 'complete')
        ordered.push(frame.digest)
        stack.pop()
        continue
      }
      const ref = frame.refs[frame.next++]!
      const color = colors.get(ref.digest)
      if (color === 'active') fail(objectPath(frame.digest), 'blob-cycle', 'Content-addressed object dependencies contain a cycle.')
      if (color === 'complete') continue
      const refs = adjacency.get(ref.digest)
      if (refs === undefined) return fail(objectPath(frame.digest), 'missing-blob', 'A dependency is absent from the portable graph.')
      colors.set(ref.digest, 'active')
      stack.push({ digest: ref.digest, refs, next: 0 })
    }
  }
  return ordered
}

const closureDigests = (manifest: CanvasManifest, adjacency: ReadonlyMap<Digest, readonly ObjectRef[]>): ReadonlySet<Digest> => {
  const reachable = new Set<Digest>()
  const stack = refsOf(manifest).map((ref) => ref.digest)
  while (stack.length > 0) {
    const identity = stack.pop()!
    if (reachable.has(identity)) continue
    const refs = adjacency.get(identity)
    if (refs === undefined) return fail(objectPath(identity), 'missing-blob', 'A dependency is absent from the portable graph.')
    reachable.add(identity)
    for (const ref of refs) if (!reachable.has(ref.digest)) stack.push(ref.digest)
  }
  return reachable
}

interface GraphRead { readonly graph: CanvasGraph; readonly order: readonly Digest[]; readonly limits: GraphLimits }

const validateRelationships = (graph: CanvasGraph, allowSharedCurrentScenes: boolean, limits: GraphLimits): readonly Digest[] => {
  const { manifest, objects } = graph
  const issues: ParseIssue[] = []
  const problem = (path: string, code: string, message: string): void => {
    issues.push({ path, code, message })
    if (issues.length >= limits.maxIssues) throw new WorkbenchDataError(issues)
  }
  let references = 0
  const dependencies = (value: CanvasStoredValue, path: string): readonly ObjectRef[] => {
    const count = referenceCount(value)
    if ('kind' in value && count > limits.maxReferencesPerObject) fail(path, 'graph-quota', 'Object dependency fan-out exceeds the portable limit.')
    references += count
    if (references > limits.maxReferences) fail(path, 'graph-quota', 'Graph dependency count exceeds the portable limit.')
    const refs = refsOf(value)
    let locations: ReadonlyMap<string, string> | undefined
    for (const ref of refs) {
      const object = objects[ref.digest]
      if (object === undefined || object.kind !== ref.kind) {
        locations ??= referenceLocations(value, path)
        const at = locations.get(refKey(ref)) ?? path
        problem(at, object === undefined ? 'missing-blob' : 'blob-kind', object === undefined
          ? 'The required content-addressed object is missing.'
          : `The referenced object must have kind '${ref.kind}', not '${object.kind}'.`)
      }
    }
    return refs
  }
  dependencies(manifest, '/manifest')
  const adjacency = new Map<Digest, readonly ObjectRef[]>()
  for (const [identity, object] of Object.entries(objects)) adjacency.set(identity, dependencies(object, objectPath(identity)))
  if (issues.length > 0) throw new WorkbenchDataError(issues)
  const order = dependencyOrder(adjacency)

  const datasetIndices = new Map<Digest, { readonly metrics: ReadonlySet<string>; readonly axes: ReadonlySet<string> }>()
  const metricOwners = new Map<string, Set<Digest>>()
  const snapshotDatasets = new Map<Digest, ReadonlySet<Digest>>()
  for (const [identity, object] of Object.entries(objects)) {
    const path = objectPath(identity)
    if (object.kind === 'scene') {
      // Historical presentation/notebook variants may share a physical ID and revision.
    } else if (object.kind === 'dataset') {
      const source = sceneAt(objects, object.sourceScene, `${path}/sourceScene`).scene
      if (source.id !== object.origin.sceneId) problem(`${path}/origin/sceneId`, 'scene-identity', 'Dataset origin does not identify its source scene.')
      if (source.revision !== object.origin.sceneRevision) problem(`${path}/origin/sceneRevision`, 'revision', 'Dataset origin revision differs from its source scene.')
      datasetIndices.set(identity, { metrics: new Set(object.metrics.map((metric) => metric.id)), axes: new Set(object.axes.map((axis) => axis.id)) })
      for (const metric of object.metrics) {
        const owners = metricOwners.get(metric.id) ?? new Set<Digest>()
        owners.add(identity)
        metricOwners.set(metric.id, owners)
      }
    } else if (object.kind === 'snapshot') {
      const scene = sceneAt(objects, object.scene, `${path}/scene`).scene
      if (scene.revision !== object.sceneRevision) problem(`${path}/sceneRevision`, 'revision', 'Captured revision differs from the referenced physical scene revision.')
      for (const [field, reading] of [['request', object.request], ['result', object.result]] as const) {
        if (reading === undefined) continue
        if (reading.sceneId !== scene.id) problem(`${path}/${field}/sceneId`, 'scene-identity', 'Captured simulation identity differs from the referenced physical scene.')
        if (reading.sceneRevision !== scene.revision) problem(`${path}/${field}/sceneRevision`, 'revision', 'Captured simulation revision differs from the referenced physical scene.')
      }
      snapshotDatasets.set(identity, new Set(object.datasets.map((ref) => ref.digest)))
      const localDatasetIds = new Set<string>()
      object.datasets.forEach((ref, index) => {
        const dataset = datasetAt(objects, ref, `${path}/datasets/${index}`)
        if (localDatasetIds.has(dataset.id)) problem(`${path}/datasets/${index}`, 'duplicate-identity', 'Dataset selection identities must be unique within one snapshot.')
        localDatasetIds.add(dataset.id)
        if (dataset.sourceScene.digest !== object.scene.digest) problem(`${path}/datasets/${index}`, 'dataset-scene', 'Every snapshot dataset must belong to the exact captured scene object.')
      })
    }
    // History IDs are local to their immutable envelope; import rewrites only digest links.
  }

  const ownedCurrentScenes = new Set<string>()
  manifest.instances.forEach((instance, index) => {
    const scene = sceneAt(objects, instance.currentScene, `/manifest/instances/${index}/currentScene`).scene
    if (!allowSharedCurrentScenes && ownedCurrentScenes.has(scene.id)) {
      problem(`/manifest/instances/${index}/currentScene`, 'owned-scene-identity', 'Current physical scene identities cannot be owned by multiple editable instances.')
    }
    ownedCurrentScenes.add(scene.id)
    // Origin and historical revisions are independent of the current instance edit counter.
  })
  const aliases = new Map(manifest.snapshots.map((alias) => [alias.id, alias]))
  const memberIds = new Set<string>()
  manifest.comparisons.forEach((comparison, index) => comparison.members.forEach((member, memberIndex) => {
    const path = `/manifest/comparisons/${index}/members/${memberIndex}`
    if (memberIds.has(member.id)) problem(`${path}/id`, 'duplicate-identity', 'Comparison member identities must be unique across the canvas.')
    memberIds.add(member.id)
    const alias = aliases.get(member.snapshotAliasId)!
    const datasets = snapshotDatasets.get(alias.snapshot.digest)!
    if (!datasets.has(member.dataset.digest)) problem(`${path}/dataset`, 'comparison-dataset', 'A comparison dataset must be included in its referenced snapshot alias payload.')
    const indexOfDataset = datasetIndices.get(member.dataset.digest)!
    if (!indexOfDataset.metrics.has(member.metricId)) problem(`${path}/metricId`, 'metric-reference', 'The selected metric does not exist in the referenced dataset.')
    if (member.axisId !== undefined && !indexOfDataset.axes.has(member.axisId)) problem(`${path}/axisId`, 'axis-reference', 'The selected axis does not exist in the referenced dataset.')
  }))
  const membership = new Map<Digest, Map<string, boolean>>()
  manifest.nodes.forEach((node, index) => {
    if (node.kind !== 'result' || node.metricIds === undefined) return
    const alias = aliases.get(node.snapshotAliasId)!
    const datasets = snapshotDatasets.get(alias.snapshot.digest)!
    const cached = membership.get(alias.snapshot.digest) ?? new Map<string, boolean>()
    membership.set(alias.snapshot.digest, cached)
    node.metricIds.forEach((metricId, metricIndex) => {
      let present = cached.get(metricId)
      if (present === undefined) {
        present = false
        const owners = metricOwners.get(metricId)
        if (owners !== undefined) {
          const smaller = owners.size < datasets.size ? owners : datasets
          const larger = owners.size < datasets.size ? datasets : owners
          for (const identity of smaller) if (larger.has(identity)) { present = true; break }
        }
        cached.set(metricId, present)
      }
      if (!present) problem(`/manifest/nodes/${index}/metricIds/${metricIndex}`, 'metric-reference', 'The result metric does not exist in the referenced snapshot datasets.')
    })
  })
  const reachable = closureDigests(manifest, adjacency)
  for (const identity of adjacency.keys()) {
    if (!reachable.has(identity)) problem(objectPath(identity), 'unreachable-object', 'Portable graphs contain exactly the manifest dependency closure, not extra cache objects.')
  }
  if (issues.length > 0) throw new WorkbenchDataError(issues)
  return order
}

const safeGraphJson = (input: unknown, limits: GraphLimits): JsonValue => {
  try {
    assertJsonLimits(input, limits)
    return copyCanonicalData(input) as JsonValue
  } catch (error) {
    if (error instanceof WorkbenchDataError) throw error
    return fail('', 'unsafe-object', 'Graph data could not be inspected as stable plain JSON.')
  }
}

const readGraph = (input: unknown, limits: GraphLimits, allowSharedCurrentScenes = false): GraphRead => {
  const value = record(safeGraphJson(input, limits), '')
  exactKeys(value, ['schemaVersion', 'manifest', 'objects', 'format', 'exportedAt'], '')
  if (value.schemaVersion !== 1) fail('/schemaVersion', 'schema', 'Expected graph schemaVersion 1.')
  if (Object.hasOwn(value, 'format') || Object.hasOwn(value, 'exportedAt')) {
    if (value.format !== CANVAS_FILE_FORMAT) fail('/format', 'format', `Expected portable format '${CANVAS_FILE_FORMAT}'.`)
    isoDate(value.exportedAt, '/exportedAt')
  }
  const manifest = readManifestAt(value.manifest, limits)
  const source = record(value.objects, '/objects')
  if (Object.keys(source).length > limits.maxObjects) fail('/objects', 'graph-quota', 'Graph object count exceeds the portable limit.')
  const objects: Record<Digest, WorkbenchObject> = {}
  for (const [identity, object] of Object.entries(source)) {
    digest(identity, objectPath(identity))
    objects[identity] = readObjectAt(object, objectPath(identity), limits)
  }
  const graph: CanvasGraph = { schemaVersion: 1, manifest, objects }
  return { graph, order: validateRelationships(graph, allowSharedCurrentScenes, limits), limits }
}

/** Structural validation only; SHA256 truth is checked by verifyGraphDigests/importGraph. Extra cache blobs are rejected. */
export const validateGraph = (
  manifest: CanvasManifest,
  objects: Readonly<Record<Digest, WorkbenchObject>>,
  limits?: Partial<GraphLimits>,
): ParseResult<CanvasGraph> => parsed(() => readGraph({ schemaVersion: 1, manifest, objects }, readLimits(limits)).graph)

/** Accepts decoded plain JSON CanvasGraph or CanvasFile, never runtime objects or executable state. */
export const parseGraph = (input: unknown, limits?: Partial<GraphLimits>): ParseResult<CanvasGraph> => parsed(() => readGraph(input, readLimits(limits)).graph)

export const exportGraph = (graph: CanvasGraph, options?: { exportedAt?: string; limits?: Partial<GraphLimits> }): CanvasFile => {
  const settings = record(options ?? {}, '/options')
  exactKeys(settings, ['exportedAt', 'limits'], '/options')
  const limits = readLimits(settings.limits as Partial<GraphLimits> | undefined)
  const value = readGraph(graph, limits).graph
  const exportedAt = optional(settings.exportedAt, '/options/exportedAt', isoDate) ?? new Date().toISOString()
  const file: CanvasFile = { ...value, format: CANVAS_FILE_FORMAT, exportedAt }
  assertJsonLimits(file, limits)
  return freezeData(file)
}

interface HashClaims {
  readonly byDigest: Map<Digest, string>
  readonly byContent: Map<string, Digest>
}

const hashed = async (canonical: string, hash: CloneGraphOptions['hash'], path: string, claims: HashClaims): Promise<Digest> => {
  let output: unknown
  try { output = await hash(canonical) } catch { return fail(path, 'hash-failed', 'The SHA256 callback failed while hashing canonical object content.') }
  const identity = digest(output, path)
  const priorContent = claims.byDigest.get(identity)
  if (priorContent !== undefined && priorContent !== canonical) fail(path, 'hash-collision', 'The SHA256 callback assigned one digest to different object kinds or canonical content.')
  const priorDigest = claims.byContent.get(canonical)
  if (priorDigest !== undefined && priorDigest !== identity) fail(path, 'hash-inconsistent', 'The SHA256 callback assigned different digests to identical canonical content.')
  claims.byDigest.set(identity, canonical)
  claims.byContent.set(canonical, identity)
  return identity
}

const verifyDigests = async (graph: CanvasGraph, hash: CloneGraphOptions['hash']): Promise<HashClaims> => {
  if (typeof hash !== 'function') fail('/options/hash', 'hash', 'A canonical UTF-8 SHA256 callback is required.')
  const claims: HashClaims = { byDigest: new Map(), byContent: new Map() }
  for (const identity of Object.keys(graph.objects).sort()) {
    const actual = await hashed(canonicalStringify(graph.objects[identity]), hash, objectPath(identity), claims)
    if (actual !== identity) fail(objectPath(identity), 'digest-mismatch', 'The stored digest does not match the SHA256 of its canonical object content.')
  }
  return claims
}

const parsedAsync = async <T>(parse: () => Promise<T>): Promise<ParseResult<T>> => {
  try { return { ok: true, value: freezeData(await parse()) } } catch (error) {
    if (error instanceof WorkbenchDataError) return { ok: false, issues: freezeData([...error.issues]) }
    throw error
  }
}

/** The supplied hash must implement SHA256 over canonical UTF-8; this is integrity, not server certification. */
export const verifyGraphDigests = (
  graph: CanvasGraph,
  hash: CloneGraphOptions['hash'],
  limits?: Partial<GraphLimits>,
): Promise<ParseResult<CanvasGraph>> => parsedAsync(async () => {
  const value = readGraph(graph, readLimits(limits)).graph
  await verifyDigests(value, hash)
  return value
})

interface CopyOptions {
  readonly id: CloneGraphOptions['id']
  readonly hash: CloneGraphOptions['hash']
  readonly title?: string
  readonly now: string
  readonly limits: GraphLimits
  readonly preserveServerAuthority: boolean
}
const readCopyOptions = (input: CloneGraphOptions): CopyOptions => {
  const value = record(input, '/options')
  exactKeys(value, ['id', 'hash', 'title', 'now', 'limits', 'preserveServerAuthority'], '/options')
  if (typeof value.id !== 'function') fail('/options/id', 'id-generator', 'An identity generator is required.')
  if (typeof value.hash !== 'function') fail('/options/hash', 'hash', 'A canonical UTF-8 SHA256 callback is required.')
  const title = optional(value.title, '/options/title', text)
  return {
    id: value.id as CloneGraphOptions['id'], hash: value.hash as CloneGraphOptions['hash'],
    now: optional(value.now, '/options/now', isoDate) ?? new Date().toISOString(),
    limits: readLimits(value.limits as Partial<GraphLimits> | undefined),
    preserveServerAuthority: optional(value.preserveServerAuthority, '/options/preserveServerAuthority', boolean) ?? true,
    ...(title === undefined ? {} : { title }),
  }
}

const ownedScene = (object: SceneObject, instance: ExperimentInstance, identity: string, now: string, limits: GraphLimits): SceneObject => {
  const { scene } = object
  const previous = scene.metadata.lineage
  const originQuestionId = scene.metadata.sourceQuestionId ?? previous?.originQuestionId
  const candidate = {
    ...object,
    scene: {
      ...scene, id: identity, revision: 0,
      metadata: {
        ...scene.metadata, createdAt: now, updatedAt: now,
        lineage: {
          ...previous,
          origin: previous?.origin ?? (originQuestionId !== undefined ? 'question' : instance.source.kind === 'free-build' ? 'blank' : 'template'),
          branchType: 'experimental',
          ...(originQuestionId === undefined ? {} : { originQuestionId }),
          originSceneId: previous?.originSceneId ?? scene.id,
          parentSceneId: scene.id, parentRevision: scene.revision, forkedAt: now,
        },
      },
    },
  }
  const result = readObjectAt(candidate, '/clone/scene', limits)
  return result.kind === 'scene' ? result : fail('/clone/scene', 'blob-kind', 'Expected a newly owned scene.')
}

const importedSource = (instance: ExperimentInstance, manifest: CanvasManifest, now: string): InstanceSource => {
  const metadata: Record<string, JsonValue> = { ...instance.source.metadata }
  const { metadata: previousMetadata, ...sourceIdentity } = instance.source
  void previousMetadata
  let key = 'physicsosImport'
  for (let suffix = 1; Object.hasOwn(metadata, key); suffix += 1) key = `physicsosImport${suffix}`
  metadata[key] = copyJsonObject({
    operation: 'import', at: now, canvasId: manifest.id, instanceId: instance.instanceId,
    currentScene: instance.currentScene, originScene: instance.originScene, source: sourceIdentity,
  })
  // Original source/release metadata is recorded provenance, never an authority receipt.
  return { ...instance.source, kind: 'import', metadata }
}

const takeClosure = (manifest: CanvasManifest, pool: Readonly<Record<Digest, WorkbenchObject>>, limits: GraphLimits): Record<Digest, WorkbenchObject> => {
  const objects: Record<Digest, WorkbenchObject> = {}
  const stack = [...refsOf(manifest)]
  let count = 0
  while (stack.length > 0) {
    const ref = stack.pop()!
    if (Object.hasOwn(objects, ref.digest)) continue
    const object = pool[ref.digest]
    if (object === undefined) return fail(objectPath(ref.digest), 'missing-blob', 'Cloning produced a missing dependency.')
    if (object.kind !== ref.kind) fail(objectPath(ref.digest), 'blob-kind', 'Cloning produced an incompatible dependency kind.')
    objects[ref.digest] = object
    count += 1
    if (count > limits.maxObjects) fail('/objects', 'graph-quota', 'Cloned object closure exceeds the portable limit.')
    for (const dependency of refsOf(object)) if (!Object.hasOwn(objects, dependency.digest)) stack.push(dependency)
  }
  return objects
}

const copyGraph = async (
  source: GraphRead,
  options: CopyOptions,
  importing: boolean,
): Promise<CloneGraphResult> => {
  const { graph, order, limits } = source
  const claims = await verifyDigests(graph, options.hash)
  const ids: Record<string, string> = Object.create(null)
  const reserved = new Set<string>([graph.manifest.id])
  for (const instance of graph.manifest.instances) reserved.add(instance.instanceId)
  for (const node of graph.manifest.nodes) reserved.add(node.id)
  for (const edge of graph.manifest.edges) reserved.add(edge.id)
  for (const alias of graph.manifest.snapshots) reserved.add(alias.id)
  for (const comparison of graph.manifest.comparisons) {
    reserved.add(comparison.id)
    for (const member of comparison.members) reserved.add(member.id)
  }
  for (const object of Object.values(graph.objects)) {
    if (object.kind === 'scene') {
      reserved.add(object.scene.id)
      if (object.scene.metadata.lineage !== undefined) {
        reserved.add(object.scene.metadata.lineage.originSceneId)
        reserved.add(object.scene.metadata.lineage.parentSceneId)
      }
      for (const entry of object.scene.metadata.experimentNotebook?.entries ?? []) reserved.add(entry.sceneId)
    } else if (object.kind === 'snapshot') reserved.add(object.instanceId)
    else if (object.kind === 'dataset') reserved.add(object.id)
    else for (const entry of object.entries) {
      reserved.add(entry.id)
      if (entry.instanceId !== undefined) reserved.add(entry.instanceId)
    }
  }
  const generated = new Set<string>()
  const newId = (kind: Parameters<CloneGraphOptions['id']>[0], oldId: string, key = identityKey(kind, oldId)): string => {
    if (Object.hasOwn(ids, key)) fail(pointer('/ids', key), 'duplicate-identity', 'An identity mapping would overwrite another owner.')
    let candidate: unknown
    try { candidate = options.id(kind, oldId) } catch { return fail('/options/id', 'id-generator', 'The identity generator failed.') }
    const identity = text(candidate, pointer('/options/id', key), true)
    if (reserved.has(identity)) fail(pointer('/options/id', key), 'identity-reuse', 'A copied identity must not reuse a source or historical identity.')
    if (generated.has(identity)) fail(pointer('/options/id', key), 'duplicate-id', 'The identity generator returned an identity already assigned to another copied owner.')
    generated.add(identity)
    ids[key] = identity
    return identity
  }
  const pool: Record<Digest, WorkbenchObject> = { ...graph.objects }
  const replacements = new Map<Digest, Set<Digest>>()
  const replacement = (before: Digest, after: Digest): void => {
    const destinations = replacements.get(before) ?? new Set<Digest>()
    destinations.add(after)
    replacements.set(before, destinations)
  }
  let generatedBytes = 0
  let generatedObjects = 0
  const publish = async (object: WorkbenchObject): Promise<Digest> => {
    const canonical = canonicalStringify(object)
    const identity = await hashed(canonical, options.hash, '/options/hash', claims)
    if (!Object.hasOwn(pool, identity)) {
      generatedBytes += encoder.encode(canonical).byteLength
      generatedObjects += 1
      if (generatedBytes > limits.maxBytes || generatedObjects > limits.maxObjects) {
        fail('/objects', 'graph-quota', 'Newly published clone content exceeds the portable limit.')
      }
      pool[identity] = freezeData(object)
    }
    return identity
  }
  const immutable = new Map<Digest, Digest>()
  if (importing || !options.preserveServerAuthority) {
    for (const [identity, object] of Object.entries(graph.objects)) {
      if (object.kind !== 'snapshot') continue
      if (!importing && object.source !== 'server-engine') continue
      // Only the capture envelope changes. Engine readings, trace, state, and evidence remain exact.
      const next = await publish({ ...object, source: 'imported' })
      immutable.set(identity, next)
      replacement(identity, next)
    }
    for (const identity of order) {
      const object = graph.objects[identity]!
      if (object.kind !== 'history') continue
      const history: HistoryObject = {
        ...object,
        parents: distinctRefs(object.parents.map((ref) => ({ ...ref, digest: immutable.get(ref.digest) ?? ref.digest }))),
        entries: object.entries.map((entry) => entry.snapshot === undefined ? entry : {
          ...entry, snapshot: { ...entry.snapshot, digest: immutable.get(entry.snapshot.digest) ?? entry.snapshot.digest },
        }),
      }
      const next = await publish(history)
      immutable.set(identity, next)
      replacement(identity, next)
    }
  }
  const canvasId = newId('canvas', graph.manifest.id)
  const instanceScenes: Record<string, { readonly currentScene: ObjectRef<'scene'>; readonly originScene: ObjectRef<'scene'> }> = Object.create(null)
  const instances: ExperimentInstance[] = []
  for (const instance of graph.manifest.instances) {
    const instanceId = newId('instance', instance.instanceId)
    const refs: { currentScene?: ObjectRef<'scene'>; originScene?: ObjectRef<'scene'> } = {}
    for (const role of ['currentScene', 'originScene'] as const) {
      const original = sceneAt(graph.objects, instance[role], `/clone/instances/${instance.instanceId}/${role}`)
      const key = pointer(pointer(pointer('scene', instance.instanceId), role === 'currentScene' ? 'current' : 'origin'), original.scene.id)
      const sceneId = newId('scene', original.scene.id, key)
      const next = await publish(ownedScene(original, instance, sceneId, options.now, limits))
      refs[role] = { kind: 'scene', digest: next }
      replacement(instance[role].digest, next)
    }
    const currentScene = refs.currentScene!
    const originScene = refs.originScene!
    instanceScenes[instance.instanceId] = { currentScene, originScene }
    instances.push({
      ...instance, instanceId, currentScene, originScene, instanceEditRevision: 0,
      source: importing ? importedSource(instance, graph.manifest, options.now) : instance.source,
    })
  }
  for (const node of graph.manifest.nodes) newId('node', node.id)
  for (const edge of graph.manifest.edges) newId('edge', edge.id)
  for (const alias of graph.manifest.snapshots) newId('snapshot-alias', alias.id)
  for (const comparison of graph.manifest.comparisons) {
    newId('comparison', comparison.id)
    for (const member of comparison.members) newId('comparison-member', member.id)
  }
  const mapped = (kind: string, identity: string): string => ids[identityKey(kind, identity)]
    ?? fail('/ids', 'missing-identity', 'A copied document association has no new identity.')
  const nodes = graph.manifest.nodes.map((node): CanvasNode => {
    const base = { ...node, id: mapped('node', node.id), ...(node.groupId === undefined ? {} : { groupId: mapped('node', node.groupId) }) }
    switch (node.kind) {
      case 'experiment': return { ...node, ...base, kind: node.kind, instanceId: mapped('instance', node.instanceId) }
      case 'result': return { ...node, ...base, kind: node.kind, snapshotAliasId: mapped('snapshot-alias', node.snapshotAliasId) }
      case 'comparison': return { ...node, ...base, kind: node.kind, comparisonId: mapped('comparison', node.comparisonId) }
      case 'note': return { ...node, ...base, kind: node.kind }
      case 'group': return { ...node, ...base, kind: node.kind }
    }
  })
  const manifest: CanvasManifest = {
    ...graph.manifest, id: canvasId, title: options.title ?? graph.manifest.title,
    createdAt: options.now, updatedAt: options.now, instances, nodes,
    edges: graph.manifest.edges.map((edge) => ({ ...edge, id: mapped('edge', edge.id), from: mapped('node', edge.from), to: mapped('node', edge.to) })),
    snapshots: graph.manifest.snapshots.map((alias) => ({
      ...alias, id: mapped('snapshot-alias', alias.id), snapshot: { ...alias.snapshot, digest: immutable.get(alias.snapshot.digest) ?? alias.snapshot.digest },
      ...(alias.instanceId === undefined ? {} : { instanceId: mapped('instance', alias.instanceId) }),
    })),
    comparisons: graph.manifest.comparisons.map((comparison) => ({
      ...comparison, id: mapped('comparison', comparison.id),
      members: comparison.members.map((member) => ({ ...member, id: mapped('comparison-member', member.id), snapshotAliasId: mapped('snapshot-alias', member.snapshotAliasId) })),
    })),
    ...(graph.manifest.history === undefined ? {} : { history: { ...graph.manifest.history, digest: immutable.get(graph.manifest.history.digest) ?? graph.manifest.history.digest } }),
  }
  const closure = takeClosure(manifest, pool, limits)
  const output = readGraph({ schemaVersion: 1, manifest, objects: closure }, limits).graph
  for (const identity of Object.keys(output.objects)) if (Object.hasOwn(graph.objects, identity)) replacement(identity, identity)
  const digests: Record<Digest, Digest> = {}
  for (const [before, candidates] of replacements) {
    const reachable = [...candidates].filter((after) => Object.hasOwn(output.objects, after))
    // A single source blob may produce several owned scenes. Never pretend this is one-to-one.
    if (reachable.length === 1) digests[before] = reachable[0]!
  }
  const result = { graph: output, ids, digests, instanceScenes }
  return freezeData(result)
}

/** Keeps immutable historical payloads and repairs shared legacy editable scenes into separately owned copies. */
export const cloneGraph = async (graph: CanvasGraph, options: CloneGraphOptions): Promise<CloneGraphResult> => {
  const settings = readCopyOptions(options)
  const source = readGraph(graph, settings.limits, true)
  return copyGraph(source, settings, false)
}

/** Imports verify all original object digests, then re-own scenes and downgrade/re-hash every snapshot and dependent history. */
export const importGraph = (input: unknown, options: CloneGraphOptions): Promise<ParseResult<CloneGraphResult>> => parsedAsync(async () => {
  const settings = readCopyOptions(options)
  const source = readGraph(input, settings.limits)
  return copyGraph(source, settings, true)
})
