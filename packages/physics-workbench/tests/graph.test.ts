import { describe, expect, it } from 'vitest'
import { asSceneId } from '@physicsos/shared'

import { createManifest, createSceneObject, refsOf } from '../src/codec.ts'
import {
  cloneGraph, exportGraph, GRAPH_LIMITS, importGraph, parseGraph, validateGraph,
  verifyGraphDigests,
} from '../src/graph.ts'
import { canonicalStringify, pointer, unwrap, WorkbenchDataError } from '../src/json.ts'
import type {
  CanvasGraph, CanvasManifest, CloneGraphResult, DatasetObject, Digest, HistoryObject,
  ObjectRef, ParseResult, SnapshotObject, WorkbenchObject,
} from '../src/types.ts'
import {
  CAPTURED_AT, circuitGraphFixture, cloneOptions, COPIED_AT, graphFixture, historyFrom,
  publish, sceneFrom, sha256, snapshotFrom,
} from './graph-fixtures.ts'

const issuesOf = <T>(result: ParseResult<T>): readonly string[] => {
  if (result.ok) throw new Error('Expected graph rejection.')
  return result.issues.map((issue) => issue.code)
}

const assertClosure = (graph: CanvasGraph): void => {
  const visited = new Set<Digest>()
  const stack = [...refsOf(graph.manifest)]
  while (stack.length > 0) {
    const ref = stack.pop()!
    if (visited.has(ref.digest)) continue
    const object = graph.objects[ref.digest]
    expect(object?.kind).toBe(ref.kind)
    if (object === undefined) throw new Error('Missing dependency in test graph.')
    visited.add(ref.digest)
    stack.push(...refsOf(object))
  }
  expect([...visited].sort()).toEqual(Object.keys(graph.objects).sort())
}

const assertDigests = (graph: CanvasGraph): void => {
  for (const [identity, object] of Object.entries(graph.objects)) expect(sha256(canonicalStringify(object))).toBe(identity)
}

const associationKey = (kind: string, oldId: string): string => pointer(kind, oldId)
const ownedKey = (instanceId: string, role: 'current' | 'origin', oldSceneId: string): string =>
  pointer(pointer(pointer('scene', instanceId), role), oldSceneId)

const expectGraphError = async (operation: Promise<unknown>, code: string): Promise<void> => {
  try { await operation } catch (error) {
    expect(error).toBeInstanceOf(WorkbenchDataError)
    if (!(error instanceof WorkbenchDataError)) throw error
    expect(error.issues.map((issue) => issue.code)).toContain(code)
    return
  }
  throw new Error('Expected a graph operation to fail.')
}

const emptyWithObjects = (objects: CanvasGraph['objects'], history?: ObjectRef<'history'>): CanvasGraph => ({
  schemaVersion: 1,
  manifest: { ...createManifest({ id: 'canvas-history-test', title: 'Historical graph', now: CAPTURED_AT }), ...(history === undefined ? {} : { history }) },
  objects,
})

const unownedCaptureGraph = (graph: CanvasGraph): CanvasGraph => {
  const manifest: CanvasManifest = {
    ...graph.manifest, instances: [],
    nodes: graph.manifest.nodes.filter((node) => node.kind !== 'experiment'),
    edges: graph.manifest.edges.filter((edge) => edge.from !== 'node-experiment' && edge.to !== 'node-experiment'),
    snapshots: graph.manifest.snapshots.map((alias) => {
      const { instanceId, ...rest } = alias
      void instanceId
      return rest
    }),
  }
  return { ...graph, manifest }
}

describe('portable graph structure', () => {
  it('validates, detaches, freezes, and round-trips the exact mechanics dependency closure', async () => {
    const fixture = graphFixture()
    const source = fixture.graph
    const before = canonicalStringify(source)
    const parsed = unwrap(parseGraph(source))
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(parsed.manifest).not.toBe(source.manifest)
    expect(parsed.objects[fixture.snapshotRef.digest]).not.toBe(source.objects[fixture.snapshotRef.digest])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.objects)).toBe(true)
    const capture = snapshotFrom(parsed, fixture.snapshotRef)
    expect(Object.isFrozen(capture.result?.states)).toBe(true)
    expect(Object.isFrozen(capture.rawState)).toBe(true)
    expect(validateGraph(source.manifest, source.objects).ok).toBe(true)
    expect((await verifyGraphDigests(parsed, sha256)).ok).toBe(true)
    assertClosure(parsed)
    assertDigests(parsed)
    expect(canonicalStringify(source)).toBe(before)

    const file = exportGraph(parsed, { exportedAt: COPIED_AT })
    expect(file.format).toBe('physicsos-canvas')
    expect(file.schemaVersion).toBe(1)
    expect(file.exportedAt).toBe(COPIED_AT)
    expect(Object.isFrozen(file.objects)).toBe(true)
    expect(unwrap(parseGraph(file))).toEqual(parsed)
    expect(unwrap(parseGraph(JSON.parse(JSON.stringify(file))))).toEqual(parsed)
  })

  it('validates a real circuit scene and exports without runtime or mutable source references', () => {
    const { graph, scene } = circuitGraphFixture()
    expect(parseGraph(graph).ok).toBe(true)
    const file = exportGraph(graph, { exportedAt: COPIED_AT })
    expect(sceneFrom(file, file.manifest.instances[0]!.currentScene).scene.circuits).toEqual(scene.scene.circuits)
    expect(file.manifest.instances[0]!.clock.total).toBe(0)
    expect(file.manifest.instances[0]).not.toBe(graph.manifest.instances[0])
    assertClosure(file)
    assertDigests(file)
  })

  it('rejects unknown fields, unsupported versions, invalid envelopes, and serialized strings', () => {
    const { graph } = graphFixture()
    expect(issuesOf(parseGraph({ ...graph, runtime: {} }))).toContain('unknown-field')
    expect(issuesOf(parseGraph({ ...graph, schemaVersion: 2 }))).toContain('schema')
    expect(issuesOf(parseGraph({ ...graph, format: 'unrelated', exportedAt: COPIED_AT }))).toContain('format')
    expect(issuesOf(parseGraph({ ...graph, format: 'physicsos-canvas' }))).toContain('string')
    expect(issuesOf(parseGraph({ ...graph, exportedAt: COPIED_AT }))).toContain('format')
    expect(issuesOf(parseGraph({ ...graph, format: 'physicsos-canvas', exportedAt: '2026-02-30T10:00:00.000Z' }))).toContain('date')
    expect(issuesOf(parseGraph(JSON.stringify(graph)))).toContain('object')
    expect(() => exportGraph(graph, { exportedAt: 'not-a-date' })).toThrow(WorkbenchDataError)
  })

  it('rejects missing blobs and wrong object kinds with protocol reference locations', () => {
    const fixture = graphFixture()
    const { [fixture.datasetRef.digest]: omitted, ...objects } = fixture.graph.objects
    void omitted
    const missing = parseGraph({ ...fixture.graph, objects })
    expect(issuesOf(missing)).toContain('missing-blob')
    if (!missing.ok) expect(missing.issues.some((issue) => issue.path.includes('/datasets/') || issue.path.includes('/members/'))).toBe(true)
    const wrongKind = { ...fixture.graph.objects, [fixture.sceneRef.digest]: fixture.dataset }
    expect(issuesOf(validateGraph(fixture.graph.manifest, wrongKind))).toContain('blob-kind')
    expect(issuesOf(parseGraph({ ...fixture.graph, objects: { ...fixture.graph.objects, invalid: fixture.scene } }))).toContain('digest')
  })

  it('rejects unreachable imported blobs instead of accepting arbitrary cache content', async () => {
    const fixture = graphFixture()
    const circuit = circuitGraphFixture()
    const graph = { ...fixture.graph, objects: { ...fixture.graph.objects, ...circuit.graph.objects } }
    expect(issuesOf(parseGraph(graph))).toContain('unreachable-object')
    expect(issuesOf(validateGraph(graph.manifest, graph.objects))).toContain('unreachable-object')
    expect(issuesOf(await importGraph(graph, cloneOptions()))).toContain('unreachable-object')
    expect(() => exportGraph(graph)).toThrow(WorkbenchDataError)
  })

  it('ignores metadata lookalike references and preserves them as plain JSON', async () => {
    const fixture = graphFixture()
    expect(refsOf(fixture.scene)).toEqual([])
    expect(refsOf(fixture.dataset)).toEqual([fixture.sceneRef])
    expect(refsOf(fixture.snapshot)).toEqual([fixture.sceneRef, fixture.datasetRef])
    const parsed = unwrap(parseGraph(fixture.graph))
    expect(parsed.manifest.metadata).toEqual(fixture.graph.manifest.metadata)
    expect(sceneFrom(parsed, fixture.sceneRef).scene.bodies[0]!.metadata).toEqual(fixture.scene.scene.bodies[0]!.metadata)
    const copied = await cloneGraph(parsed, cloneOptions())
    expect(copied.graph.manifest.metadata).toEqual(fixture.graph.manifest.metadata)
    expect(copied.graph.manifest.nodes.find((node) => node.kind === 'note')?.metadata).toEqual(fixture.graph.manifest.nodes.find((node) => node.kind === 'note')?.metadata)
    assertClosure(copied.graph)
  })

  it('rejects actual history self-cycles and long multi-object dependency cycles without recursion', () => {
    const first = sha256('cycle-address-first')
    const second = sha256('cycle-address-second')
    const self: HistoryObject = { schemaVersion: 1, kind: 'history', parents: [{ kind: 'history', digest: first }], entries: [] }
    expect(issuesOf(parseGraph(emptyWithObjects({ [first]: self }, { kind: 'history', digest: first })))).toContain('blob-cycle')
    const one: HistoryObject = { ...self, parents: [{ kind: 'history', digest: second }] }
    const two: HistoryObject = { ...self, parents: [{ kind: 'history', digest: first }] }
    expect(issuesOf(parseGraph(emptyWithObjects({ [first]: one, [second]: two }, { kind: 'history', digest: first })))).toContain('blob-cycle')
  })

  it('handles a deep content-addressed history chain iteratively', async () => {
    const objects: Record<Digest, WorkbenchObject> = {}
    let head: ObjectRef<'history'> | undefined
    for (let index = 0; index < 700; index += 1) {
      const object: HistoryObject = { schemaVersion: 1, kind: 'history', parents: head === undefined ? [] : [head], entries: [] }
      head = publish(objects, object).ref
    }
    const graph = unwrap(parseGraph(emptyWithObjects(objects, head)))
    expect(Object.keys(graph.objects)).toHaveLength(700)
    expect((await verifyGraphDigests(graph, async (canonical) => sha256(canonical))).ok).toBe(true)
    assertClosure(graph)
  })

  it('allows immutable historical instance identities without a current manifest instance', async () => {
    const fixture = graphFixture()
    const historical = unownedCaptureGraph(fixture.graph)
    expect(parseGraph(historical).ok).toBe(true)
    const copy = await cloneGraph(historical, cloneOptions())
    expect(snapshotFrom(copy.graph, copy.graph.manifest.snapshots[0]!.snapshot).instanceId).toBe(fixture.snapshot.instanceId)
    expect(copy.graph.manifest.instances).toEqual([])
    assertClosure(copy.graph)
  })

  it('rejects duplicated current physical scene identities across owned instances, but clone repairs legacy sharing', async () => {
    const fixture = circuitGraphFixture()
    const original = fixture.graph.manifest.instances[0]!
    const second = { ...original, instanceId: 'second-circuit-instance' }
    const shared: CanvasGraph = { ...fixture.graph, manifest: { ...fixture.graph.manifest, instances: [original, second] } }
    expect(issuesOf(parseGraph(shared))).toContain('owned-scene-identity')
    expect(issuesOf(validateGraph(shared.manifest, shared.objects))).toContain('owned-scene-identity')
    expect(issuesOf(await importGraph(shared, cloneOptions()))).toContain('owned-scene-identity')
    const copied = await cloneGraph(shared, cloneOptions())
    const scenes = copied.graph.manifest.instances.flatMap((instance) => [sceneFrom(copied.graph, instance.currentScene).scene, sceneFrom(copied.graph, instance.originScene).scene])
    expect(new Set(scenes.map((scene) => scene.id)).size).toBe(4)
    expect(new Set(copied.graph.manifest.instances.map((instance) => instance.instanceId)).size).toBe(2)
    for (const scene of scenes) expect(scene.revision).toBe(0)
    expect(copied.digests[fixture.sceneRef.digest]).toBeUndefined()
    expect(copied.instanceScenes?.[original.instanceId]).toEqual({ currentScene: copied.graph.manifest.instances[0]!.currentScene, originScene: copied.graph.manifest.instances[0]!.originScene })
    expect(copied.instanceScenes?.[second.instanceId]).toEqual({ currentScene: copied.graph.manifest.instances[1]!.currentScene, originScene: copied.graph.manifest.instances[1]!.originScene })
    expect(copied.ids[ownedKey(original.instanceId, 'current', fixture.scene.scene.id)]).toBe(scenes[0]!.id)
    expect(copied.ids[ownedKey(original.instanceId, 'origin', fixture.scene.scene.id)]).toBe(scenes[1]!.id)
    expect(Object.keys(copied.graph.objects)).toHaveLength(4)
    assertClosure(copied.graph)
    assertDigests(copied.graph)
  })

  it('validates origin revisions independently of current edits and permits historical presentation variants', async () => {
    const fixture = graphFixture()
    const objects = { ...fixture.graph.objects }
    const originScene = createSceneObject({ ...fixture.scene.scene, revision: 1 })
    const origin = publish(objects, originScene).ref
    const alternateScene = createSceneObject({
      ...fixture.scene.scene,
      timeline: { ...fixture.scene.scene.timeline, state: 'paused' },
      metadata: { ...fixture.scene.scene.metadata, title: 'Same physical revision, another presentation' },
    })
    const alternate = publish(objects, alternateScene).ref
    const variantDataset: DatasetObject = { ...fixture.dataset, sourceScene: alternate, metadata: { ...fixture.dataset.metadata, capture: 'alternate' } }
    const alternateDataset = publish(objects, variantDataset).ref
    const alternateSnapshot: SnapshotObject = { ...fixture.snapshot, scene: alternate, datasets: [alternateDataset], metadata: { ...fixture.snapshot.metadata, capture: 'alternate' } }
    const alternateCapture = publish(objects, alternateSnapshot).ref
    const instance = { ...fixture.graph.manifest.instances[0]!, originScene: origin }
    const graph: CanvasGraph = {
      ...fixture.graph, objects,
      manifest: { ...fixture.graph.manifest, instances: [instance], snapshots: [...fixture.graph.manifest.snapshots, { id: 'alias-alternate', title: 'Presentation variant', snapshot: alternateCapture, instanceId: instance.instanceId }] },
    }
    expect(parseGraph(graph).ok).toBe(true)
    expect((await verifyGraphDigests(graph, sha256)).ok).toBe(true)
    const copy = await cloneGraph(graph, cloneOptions())
    expect(snapshotFrom(copy.graph, copy.graph.manifest.snapshots[1]!.snapshot)).toEqual(alternateSnapshot)
    expect(copy.graph.objects[alternateDataset.digest]).toEqual(variantDataset)
    expect(sceneFrom(copy.graph, copy.graph.manifest.instances[0]!.originScene).scene.metadata.lineage?.parentRevision).toBe(1)
    assertClosure(copy.graph)
  })

  it('rejects duplicate dataset selection IDs within a single snapshot', () => {
    const fixture = graphFixture()
    const objects = { ...fixture.graph.objects }
    const variant = publish(objects, { ...fixture.dataset, metadata: { variant: 'same selection ID' } }).ref
    objects[fixture.snapshotRef.digest] = { ...fixture.snapshot, datasets: [fixture.datasetRef, variant] }
    expect(issuesOf(parseGraph({ ...fixture.graph, objects }))).toContain('duplicate-identity')
  })

  it('rejects snapshot physical IDs/revisions and dataset origin/source scene mismatches', () => {
    const fixture = graphFixture()
    const snapshotRevision: SnapshotObject = { ...fixture.snapshot, sceneRevision: 5, request: { ...fixture.snapshot.request!, sceneRevision: 5 }, result: { ...fixture.snapshot.result!, sceneRevision: 5 } }
    expect(issuesOf(parseGraph({ ...fixture.graph, objects: { ...fixture.graph.objects, [fixture.snapshotRef.digest]: snapshotRevision } }))).toContain('revision')
    const anotherScene = asSceneId('another-physical-scene')
    const snapshotIdentity: SnapshotObject = { ...fixture.snapshot, request: { ...fixture.snapshot.request!, sceneId: anotherScene }, result: { ...fixture.snapshot.result!, sceneId: anotherScene } }
    expect(issuesOf(parseGraph({ ...fixture.graph, objects: { ...fixture.graph.objects, [fixture.snapshotRef.digest]: snapshotIdentity } }))).toContain('scene-identity')
    const wrongOrigin: DatasetObject = { ...fixture.dataset, origin: { ...fixture.dataset.origin, sceneId: 'wrong-origin', sceneRevision: 99 } }
    const invalid = parseGraph({ ...fixture.graph, objects: { ...fixture.graph.objects, [fixture.datasetRef.digest]: wrongOrigin } })
    expect(issuesOf(invalid)).toContain('scene-identity')
    expect(issuesOf(invalid)).toContain('revision')
    const circuit = circuitGraphFixture()
    const wrongSource: DatasetObject = { ...fixture.dataset, sourceScene: circuit.sceneRef, origin: { ...fixture.dataset.origin, sceneId: circuit.scene.scene.id, sceneRevision: circuit.scene.scene.revision } }
    expect(issuesOf(parseGraph({ ...fixture.graph, objects: { ...fixture.graph.objects, ...circuit.graph.objects, [fixture.datasetRef.digest]: wrongSource } }))).toContain('dataset-scene')
  })

  it('checks comparison dataset membership and selected metric/axis existence', () => {
    const fixture = graphFixture()
    const objects = { ...fixture.graph.objects }
    const other: DatasetObject = { ...fixture.dataset, id: 'dataset-not-in-snapshot', metadata: { other: true } }
    const otherRef = publish(objects, other).ref
    const comparison = fixture.graph.manifest.comparisons[0]!
    const member = comparison.members[0]!
    const badDataset: CanvasManifest = { ...fixture.graph.manifest, comparisons: [{ ...comparison, members: [{ ...member, dataset: otherRef }] }] }
    expect(issuesOf(validateGraph(badDataset, objects))).toContain('comparison-dataset')
    const badMetric: CanvasManifest = { ...fixture.graph.manifest, comparisons: [{ ...comparison, members: [{ ...member, metricId: 'absent-metric', axisId: 'absent-axis' }] }] }
    const invalid = validateGraph(badMetric, fixture.graph.objects)
    expect(issuesOf(invalid)).toContain('metric-reference')
    expect(issuesOf(invalid)).toContain('axis-reference')
    const badNode: CanvasManifest = { ...fixture.graph.manifest, nodes: fixture.graph.manifest.nodes.map((node) => node.kind === 'result' ? { ...node, metricIds: ['absent-result-metric'] } : node) }
    expect(issuesOf(validateGraph(badNode, fixture.graph.objects))).toContain('metric-reference')
  })

  it('rejects duplicate input document/member identities and duplicate entries within a history envelope', () => {
    const fixture = graphFixture()
    const duplicateNode = { ...fixture.graph.manifest, nodes: [...fixture.graph.manifest.nodes, fixture.graph.manifest.nodes[0]!] }
    expect(issuesOf(validateGraph(duplicateNode, fixture.graph.objects))).toContain('duplicate-id')
    const comparison = fixture.graph.manifest.comparisons[0]!
    const duplicateMember = { ...fixture.graph.manifest, comparisons: [...fixture.graph.manifest.comparisons, { ...comparison, id: 'another-comparison' }] }
    expect(issuesOf(validateGraph(duplicateMember, fixture.graph.objects))).toContain('duplicate-id')
    const duplicateEntry: HistoryObject = { ...fixture.history, entries: [fixture.history.entries[0]!, { ...fixture.history.entries[0]!, operation: 'capture' }] }
    expect(issuesOf(parseGraph({ ...fixture.graph, objects: { ...fixture.graph.objects, [fixture.historyRef.digest]: duplicateEntry } }))).toContain('duplicate-id')
  })

  it('rejects executable/accessor/cyclic/sparse/non-finite input without invoking getters', () => {
    const fixture = graphFixture()
    let invoked = false
    const accessor = Object.defineProperty({ ...fixture.graph }, 'manifest', { enumerable: true, get: () => { invoked = true; return fixture.graph.manifest } })
    expect(issuesOf(parseGraph(accessor))).toContain('accessor')
    expect(invoked).toBe(false)
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(issuesOf(parseGraph(revoked.proxy))).toContain('unsafe-object')
    const unstable = new Proxy({}, { getPrototypeOf: () => { throw new TypeError('Unstable inspection') } })
    expect(issuesOf(parseGraph(unstable))).toContain('unsafe-object')
    expect(issuesOf(parseGraph({ ...fixture.graph, manifest: { ...fixture.graph.manifest, metadata: { callback: () => undefined } } }))).toContain('json')
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expect(issuesOf(parseGraph({ ...fixture.graph, manifest: { ...fixture.graph.manifest, metadata: cycle } }))).toContain('cycle')
    expect(issuesOf(parseGraph({ ...fixture.graph, manifest: { ...fixture.graph.manifest, metadata: { value: Number.NaN } } }))).toContain('finite')
    const sparse: unknown[] = new Array(3)
    expect(issuesOf(parseGraph({ ...fixture.graph, manifest: { ...fixture.graph.manifest, nodes: sparse } }))).toContain('array-entry')
    const unsafe = JSON.parse('{"schemaVersion":1,"__proto__":{}}')
    expect(issuesOf(parseGraph(unsafe))).toContain('unsafe-key')
  })
})

describe('graph resource policy', () => {
  it('validates all caller quotas and does not impose portable limits over a Host override', async () => {
    const fixture = graphFixture()
    expect(Object.isFrozen(GRAPH_LIMITS)).toBe(true)
    expect(issuesOf(parseGraph(fixture.graph, { maxBytes: 1 }))).toContain('graph-quota')
    expect(issuesOf(parseGraph(fixture.graph, { maxJsonNodes: 1 }))).toContain('graph-quota')
    expect(issuesOf(parseGraph(fixture.graph, { maxDepth: 1 }))).toContain('graph-quota')
    expect(issuesOf(parseGraph(fixture.graph, { maxObjects: 0 }))).toContain('graph-quota')
    expect(issuesOf(parseGraph(fixture.graph, { maxReferences: 0 }))).toContain('graph-quota')
    expect(issuesOf(parseGraph(fixture.graph, { maxReferencesPerObject: 0 }))).toContain('graph-quota')
    expect(issuesOf(parseGraph(fixture.graph, { maxBytes: -1 }))).toContain('integer')
    expect(issuesOf(parseGraph(fixture.graph, { maxBytes: Infinity }))).toContain('finite')
    expect(issuesOf(parseGraph(fixture.graph, { maxIssues: 0 }))).toContain('integer')
    expect(issuesOf(parseGraph(fixture.graph, { maxDepth: 513 }))).toContain('depth-limit')
    const hostLimits = { maxBytes: 512 * 1024 * 1024, maxJsonNodes: 4_000_000, maxObjects: 32_000, maxReferences: 1_000_000, maxReferencesPerObject: 65_536, maxDepth: 512, maxIssues: 20 }
    expect(parseGraph(fixture.graph, hostLimits).ok).toBe(true)
    expect(validateGraph(fixture.graph.manifest, fixture.graph.objects, hostLimits).ok).toBe(true)
    expect((await verifyGraphDigests(fixture.graph, sha256, hostLimits)).ok).toBe(true)
    expect(exportGraph(fixture.graph, { limits: hostLimits, exportedAt: COPIED_AT }).exportedAt).toBe(COPIED_AT)
    expect((await importGraph(fixture.graph, cloneOptions({ limits: hostLimits }))).ok).toBe(true)
  })

  it('uses the same byte policy for generated clone/import closures and exported envelopes', async () => {
    const fixture = graphFixture()
    const originalBytes = new TextEncoder().encode(canonicalStringify(fixture.graph)).byteLength
    expect(parseGraph(fixture.graph, { maxBytes: originalBytes }).ok).toBe(true)
    expect(() => exportGraph(fixture.graph, { limits: { maxBytes: originalBytes }, exportedAt: COPIED_AT })).toThrow(WorkbenchDataError)
    let counter = 0
    const options = cloneOptions()
    const id = (kind: Parameters<typeof options.id>[0], oldId: string): string => `${'owned'.repeat(200)}-${kind}-${oldId}-${++counter}`
    await expectGraphError(cloneGraph(fixture.graph, { ...options, id, limits: { maxBytes: originalBytes } }), 'graph-quota')
    expect(issuesOf(await importGraph(fixture.graph, cloneOptions({ limits: { maxObjects: 5 } })))).toContain('graph-quota')
  })

  it('caps relationship and upstream codec diagnostics under the configured issue policy', () => {
    const fixture = graphFixture()
    const absent = parseGraph({ ...fixture.graph, objects: {} }, { maxIssues: 2 })
    expect(issuesOf(absent)).toEqual(['missing-blob', 'missing-blob'])
    const missingInstances: CanvasManifest = {
      ...createManifest({ id: 'canvas-many-missing', title: 'Missing instances', now: CAPTURED_AT }),
      nodes: [0, 1, 2].map((index) => ({ kind: 'experiment', id: `missing-node-${index}`, instanceId: `missing-instance-${index}`, layout: { x: 0, y: 0, width: 100, height: 100, zIndex: 0 } })),
    }
    const limited = validateGraph(missingInstances, {}, { maxIssues: 1 })
    expect(issuesOf(limited)).toEqual(['reference'])
  })

  it('permits safe JSON depth beyond the portable default when explicitly configured', () => {
    let nested: unknown = null
    for (let index = 0; index < 280; index += 1) nested = { nested }
    const fixture = circuitGraphFixture()
    const input = { ...fixture.graph, manifest: { ...fixture.graph.manifest, metadata: { deep: nested } } }
    expect(issuesOf(parseGraph(input))).toContain('graph-quota')
    expect(parseGraph(input, { maxDepth: 512 }).ok).toBe(true)
  })
})

describe('clone identities and historical immutability', () => {
  it('creates new canvas/instance/scene/node/group/edge/alias/comparison/member IDs and preserves only recorded evidence', async () => {
    const fixture = graphFixture()
    const before = canonicalStringify(fixture.graph)
    const copy = await cloneGraph(fixture.graph, cloneOptions({ title: 'Copied laboratory' }))
    const { manifest } = copy.graph
    expect(manifest.id).toBe(copy.ids[associationKey('canvas', fixture.graph.manifest.id)])
    expect(manifest.id).not.toBe(fixture.graph.manifest.id)
    expect(manifest.title).toBe('Copied laboratory')
    expect(manifest.createdAt).toBe(COPIED_AT)
    expect(manifest.updatedAt).toBe(COPIED_AT)
    const instance = manifest.instances[0]!
    const current = sceneFrom(copy.graph, instance.currentScene).scene
    const origin = sceneFrom(copy.graph, instance.originScene).scene
    expect(instance.instanceId).not.toBe(fixture.snapshot.instanceId)
    expect(current.id).not.toBe(origin.id)
    expect(current.id).not.toBe(fixture.scene.scene.id)
    expect(origin.id).not.toBe(fixture.scene.scene.id)
    expect(current.revision).toBe(0)
    expect(origin.revision).toBe(0)
    expect(instance.instanceEditRevision).toBe(0)
    expect(instance.clock).toEqual(fixture.graph.manifest.instances[0]!.clock)
    expect(current.bodies).toEqual(fixture.scene.scene.bodies)
    expect(current.timeline).toEqual(fixture.scene.scene.timeline)
    expect(current.metadata.experimentRelease).toEqual(fixture.scene.scene.metadata.experimentRelease)
    expect(current.metadata.experimentNotebook).toEqual(fixture.scene.scene.metadata.experimentNotebook)
    expect(current.metadata.experimentNotebook?.entries[0]?.sceneId).toBe(fixture.scene.scene.id)
    expect(current.metadata.experimentNotebook?.entries[0]?.sceneRevision).toBe(4)
    expect(current.metadata.lineage).toMatchObject({ branchType: 'experimental', origin: 'question', originSceneId: fixture.scene.scene.id, parentSceneId: fixture.scene.scene.id, parentRevision: 4, forkedAt: COPIED_AT })
    expect(instance.source).toEqual(fixture.graph.manifest.instances[0]!.source)
    expect(instance.rendererRelease).toEqual(fixture.graph.manifest.instances[0]!.rendererRelease)
    expect(instance.templateRelease).toEqual(fixture.graph.manifest.instances[0]!.templateRelease)

    for (const node of manifest.nodes) {
      expect(node.id).toBe(copy.ids[associationKey('node', fixture.graph.manifest.nodes.find((old) => copy.ids[associationKey('node', old.id)] === node.id)!.id)])
      if (node.groupId !== undefined) expect(manifest.nodes.find((group) => group.id === node.groupId)?.kind).toBe('group')
      if (node.kind === 'experiment') expect(node.instanceId).toBe(instance.instanceId)
      if (node.kind === 'result') expect(node.snapshotAliasId).toBe(manifest.snapshots[0]!.id)
      if (node.kind === 'comparison') expect(node.comparisonId).toBe(manifest.comparisons[0]!.id)
    }
    for (const edge of manifest.edges) {
      expect(manifest.nodes.some((node) => node.id === edge.from)).toBe(true)
      expect(manifest.nodes.some((node) => node.id === edge.to)).toBe(true)
    }
    expect(manifest.snapshots[0]!.instanceId).toBe(instance.instanceId)
    expect(manifest.snapshots[0]!.snapshot).toEqual(fixture.snapshotRef)
    expect(manifest.comparisons[0]!.members[0]!.snapshotAliasId).toBe(manifest.snapshots[0]!.id)
    expect(manifest.comparisons[0]!.members[0]!.dataset).toEqual(fixture.datasetRef)
    expect(manifest.comparisons[0]!.targetBindings).toEqual(fixture.graph.manifest.comparisons[0]!.targetBindings)
    expect(manifest.history).toEqual(fixture.historyRef)

    expect(canonicalStringify(copy.graph.objects[fixture.snapshotRef.digest])).toBe(canonicalStringify(fixture.snapshot))
    expect(canonicalStringify(copy.graph.objects[fixture.datasetRef.digest])).toBe(canonicalStringify(fixture.dataset))
    expect(canonicalStringify(copy.graph.objects[fixture.parentHistoryRef.digest])).toBe(canonicalStringify(fixture.parentHistory))
    expect(canonicalStringify(copy.graph.objects[fixture.historyRef.digest])).toBe(canonicalStringify(fixture.history))
    expect(snapshotFrom(copy.graph, fixture.snapshotRef).source).toBe('server-engine')
    expect(snapshotFrom(copy.graph, fixture.snapshotRef).instanceId).toBe(fixture.snapshot.instanceId)
    expect(snapshotFrom(copy.graph, fixture.snapshotRef).result?.verification).toEqual(fixture.snapshot.result?.verification)
    expect(copy.digests[fixture.snapshotRef.digest]).toBe(fixture.snapshotRef.digest)
    expect(copy.digests[fixture.sceneRef.digest]).toBeUndefined()
    expect(copy.instanceScenes?.[fixture.snapshot.instanceId]).toEqual({ currentScene: instance.currentScene, originScene: instance.originScene })
    expect(canonicalStringify(fixture.graph)).toBe(before)
    expect(Object.isFrozen(copy.graph.objects[fixture.snapshotRef.digest])).toBe(true)
    assertClosure(copy.graph)
    assertDigests(copy.graph)
    expect((await verifyGraphDigests(copy.graph, sha256)).ok).toBe(true)
  })

  it('preserves prior lineage origins and recorded notebook identities across repeated clones', async () => {
    const fixture = graphFixture()
    const first = await cloneGraph(fixture.graph, cloneOptions())
    let counter = 0
    const second = await cloneGraph(first.graph, cloneOptions({ id: (kind, oldId) => `second-${kind}-${++counter}-${oldId}` }))
    const parent = sceneFrom(first.graph, first.graph.manifest.instances[0]!.currentScene).scene
    const scene = sceneFrom(second.graph, second.graph.manifest.instances[0]!.currentScene).scene
    expect(scene.metadata.lineage?.originSceneId).toBe(fixture.scene.scene.id)
    expect(scene.metadata.lineage?.originQuestionId).toBe(fixture.scene.scene.metadata.sourceQuestionId)
    expect(scene.metadata.lineage?.parentSceneId).toBe(parent.id)
    expect(scene.metadata.lineage?.parentRevision).toBe(0)
    expect(scene.metadata.experimentNotebook).toEqual(fixture.scene.scene.metadata.experimentNotebook)
    expect(snapshotFrom(second.graph, fixture.snapshotRef)).toEqual(fixture.snapshot)
    assertClosure(second.graph)
    assertDigests(second.graph)
  })

  it('handles slash-containing IDs without mapping overwrite or metadata substitution', async () => {
    const fixture = circuitGraphFixture()
    const instance = fixture.graph.manifest.instances[0]!
    const graph: CanvasGraph = { ...fixture.graph, manifest: { ...fixture.graph.manifest, id: 'canvas/with~path', instances: [{ ...instance, instanceId: 'owner/current~one' }], nodes: [{ ...fixture.graph.manifest.nodes[0]!, id: 'node/with~path', kind: 'experiment', instanceId: 'owner/current~one' }] } }
    const copy = await cloneGraph(graph, cloneOptions())
    expect(copy.ids[associationKey('canvas', graph.manifest.id)]).toBe(copy.graph.manifest.id)
    expect(copy.ids[associationKey('instance', 'owner/current~one')]).toBe(copy.graph.manifest.instances[0]!.instanceId)
    expect(copy.ids[ownedKey('owner/current~one', 'current', fixture.scene.scene.id)]).toBe(sceneFrom(copy.graph, copy.graph.manifest.instances[0]!.currentScene).scene.id)
    expect(copy.instanceScenes?.['owner/current~one']).toEqual({ currentScene: copy.graph.manifest.instances[0]!.currentScene, originScene: copy.graph.manifest.instances[0]!.originScene })
    assertClosure(copy.graph)
  })

  it('rejects repeated/old/empty/throwing identity generators without mutating input', async () => {
    const fixture = graphFixture()
    const before = canonicalStringify(fixture.graph)
    await expectGraphError(cloneGraph(fixture.graph, cloneOptions({ id: () => 'duplicate-owned-id' })), 'duplicate-id')
    await expectGraphError(cloneGraph(fixture.graph, cloneOptions({ id: (_kind, oldId) => oldId })), 'identity-reuse')
    await expectGraphError(cloneGraph(fixture.graph, cloneOptions({ id: () => '  ' })), 'string')
    await expectGraphError(cloneGraph(fixture.graph, cloneOptions({ id: () => { throw new Error('generator failed') } })), 'id-generator')
    const imported = await importGraph(fixture.graph, cloneOptions({ id: () => 'same-generated-id' }))
    expect(issuesOf(imported)).toContain('duplicate-id')
    expect(canonicalStringify(fixture.graph)).toBe(before)
  })
})

describe('digest integrity and import authority boundary', () => {
  it('distinguishes structural validation from actual SHA256 verification', async () => {
    const fixture = graphFixture()
    const changed: SnapshotObject = { ...fixture.snapshot, metadata: { tampered: true } }
    const tampered: CanvasGraph = { ...fixture.graph, objects: { ...fixture.graph.objects, [fixture.snapshotRef.digest]: changed } }
    expect(parseGraph(tampered).ok).toBe(true)
    expect(issuesOf(await verifyGraphDigests(tampered, sha256))).toContain('digest-mismatch')
    expect(issuesOf(await importGraph(tampered, cloneOptions()))).toContain('digest-mismatch')
    await expectGraphError(cloneGraph(tampered, cloneOptions()), 'digest-mismatch')
  })

  it('rejects malformed hashes and thrown callbacks instead of trusting caller labels', async () => {
    const fixture = graphFixture()
    expect(issuesOf(await verifyGraphDigests(fixture.graph, () => 'not-sha256'))).toContain('digest')
    expect(issuesOf(await importGraph(fixture.graph, cloneOptions({ hash: () => 'not-sha256' })))).toContain('digest')
    expect(issuesOf(await verifyGraphDigests(fixture.graph, () => { throw new Error('hash provider unavailable') }))).toContain('hash-failed')
    await expectGraphError(cloneGraph(fixture.graph, cloneOptions({ hash: (canonical) => sha256(canonical).toUpperCase() })), 'digest')
  })

  it('detects input and output collisions using canonical content, including cross-kind collisions', async () => {
    const fixture = graphFixture()
    const firstIdentity = Object.keys(fixture.graph.objects).sort()[0]!
    const secondIdentity = Object.keys(fixture.graph.objects).sort()[1]!
    const inputCollision = (canonical: string): string => sha256(canonical) === secondIdentity ? firstIdentity : sha256(canonical)
    expect(issuesOf(await verifyGraphDigests(fixture.graph, inputCollision))).toContain('hash-collision')

    const circuit = circuitGraphFixture()
    const sceneCollision = (canonical: string): string => {
      const object: unknown = JSON.parse(canonical)
      if (object !== null && typeof object === 'object' && 'kind' in object && object.kind === 'scene' && 'scene' in object) {
        const scene: unknown = object.scene
        if (scene !== null && typeof scene === 'object' && 'revision' in scene && scene.revision === 0) return circuit.sceneRef.digest
      }
      return sha256(canonical)
    }
    await expectGraphError(cloneGraph(circuit.graph, cloneOptions({ hash: sceneCollision })), 'hash-collision')
    const crossKindCollision = (canonical: string): string => {
      const object: unknown = JSON.parse(canonical)
      return object !== null && typeof object === 'object' && 'kind' in object && object.kind === 'snapshot' && 'source' in object && object.source === 'imported'
        ? fixture.sceneRef.digest : sha256(canonical)
    }
    expect(issuesOf(await importGraph(fixture.graph, cloneOptions({ hash: crossKindCollision })))).toContain('hash-collision')
  })

  it('rejects identical immutable objects incorrectly assigned two digest identities', () => {
    const fixture = graphFixture()
    const secondIdentity = sha256('another-address-for-the-same-history')
    const objects = { ...fixture.graph.objects, [secondIdentity]: fixture.parentHistory }
    delete objects[fixture.historyRef.digest]
    const history: HistoryObject = { ...fixture.history, parents: [fixture.parentHistoryRef, { kind: 'history', digest: secondIdentity }] }
    const head = publish(objects, history).ref
    const graph = { ...fixture.graph, manifest: { ...fixture.graph.manifest, history: head }, objects }
    // Only the duplicate address is false; the rewritten head is published with its real SHA256.
    expect(parseGraph(graph).ok).toBe(true)
    for (const [identity, object] of Object.entries(objects)) if (identity !== secondIdentity) expect(sha256(canonicalStringify(object))).toBe(identity)
    return verifyGraphDigests(graph, sha256).then((result) => {
      expect(issuesOf(result)).toContain('digest-mismatch')
      if (!result.ok) expect(result.issues[0]!.path).toBe(pointer('/objects', secondIdentity))
    })
  })

  it('verifies every input object before allocating clone identities', async () => {
    const fixture = graphFixture()
    const hashed: string[] = []
    let firstAllocation = -1
    const copied = await importGraph(exportGraph(fixture.graph, { exportedAt: COPIED_AT }), cloneOptions({
      hash: async (canonical) => { hashed.push(canonical); return sha256(canonical) },
      id: (() => { let next = 0; return (kind, oldId) => { if (firstAllocation === -1) firstAllocation = hashed.length; return `ordered-${kind}-${++next}-${oldId}` } })(),
    }))
    expect(copied.ok).toBe(true)
    expect(firstAllocation).toBeGreaterThanOrEqual(Object.keys(fixture.graph.objects).length)
    const inputCanonical = Object.keys(fixture.graph.objects).sort().map((identity) => canonicalStringify(fixture.graph.objects[identity]))
    expect(hashed.slice(0, inputCanonical.length)).toEqual(inputCanonical)
  })

  it('downgrades every imported capture envelope and rehashes dependent history without touching raw evidence', async () => {
    const fixture = graphFixture()
    const before = canonicalStringify(fixture.graph)
    const result = unwrap(await importGraph(exportGraph(fixture.graph, { exportedAt: COPIED_AT }), cloneOptions()))
    const graph = result.graph
    const alias = graph.manifest.snapshots[0]!
    const imported = snapshotFrom(graph, alias.snapshot)
    expect(alias.snapshot.digest).not.toBe(fixture.snapshotRef.digest)
    expect(imported.source).toBe('imported')
    expect(imported).toEqual({ ...fixture.snapshot, source: 'imported' })
    expect(imported.instanceId).toBe(fixture.snapshot.instanceId)
    expect(imported.sceneRevision).toBe(fixture.snapshot.sceneRevision)
    expect(imported.scene).toEqual(fixture.sceneRef)
    expect(canonicalStringify(imported.result)).toBe(canonicalStringify(fixture.snapshot.result))
    expect(canonicalStringify(imported.request)).toBe(canonicalStringify(fixture.snapshot.request))
    expect(canonicalStringify(imported.capturedState)).toBe(canonicalStringify(fixture.snapshot.capturedState))
    expect(canonicalStringify(imported.rawState)).toBe(canonicalStringify(fixture.snapshot.rawState))
    expect(imported.result?.verification).toEqual(fixture.snapshot.result?.verification)
    expect(imported.engine).toEqual(fixture.snapshot.engine)
    expect(imported.diagnostics).toEqual(fixture.snapshot.diagnostics)
    expect(imported.metadata).toEqual(fixture.snapshot.metadata)
    expect(graph.objects[fixture.datasetRef.digest]).toEqual(fixture.dataset)
    expect(graph.objects[fixture.sceneRef.digest]).toEqual(fixture.scene)
    expect(graph.objects[fixture.snapshotRef.digest]).toBeUndefined()
    expect(result.digests[fixture.snapshotRef.digest]).toBe(alias.snapshot.digest)

    const headRef = graph.manifest.history!
    expect(headRef.digest).not.toBe(fixture.historyRef.digest)
    const head = historyFrom(graph, headRef)
    const parentRef = head.parents[0]!
    expect(parentRef.digest).not.toBe(fixture.parentHistoryRef.digest)
    const parent = historyFrom(graph, parentRef)
    expect(parent.entries[0]!.snapshot).toEqual(alias.snapshot)
    expect(parent.entries[0]!.scene).toEqual(fixture.sceneRef)
    expect(parent.entries[0]!.instanceId).toBe(fixture.parentHistory.entries[0]!.instanceId)
    expect(parent.entries[0]!.id).toBe(fixture.parentHistory.entries[0]!.id)
    expect(parent.entries[0]!.details).toEqual(fixture.parentHistory.entries[0]!.details)
    expect(head.entries).toEqual(fixture.history.entries)
    expect(result.digests[fixture.parentHistoryRef.digest]).toBe(parentRef.digest)
    expect(result.digests[fixture.historyRef.digest]).toBe(headRef.digest)
    expect(graph.objects[fixture.parentHistoryRef.digest]).toBeUndefined()
    expect(graph.objects[fixture.historyRef.digest]).toBeUndefined()

    const instance = graph.manifest.instances[0]!
    const oldInstance = fixture.graph.manifest.instances[0]!
    expect(instance.source.kind).toBe('import')
    expect(instance.source.id).toBe(oldInstance.source.id)
    expect(instance.source.release).toEqual(oldInstance.source.release)
    expect(instance.source.metadata?.preserved).toBe('source')
    expect(instance.source.metadata?.physicsosImport).toEqual({ preexisting: true })
    const { metadata: originalSourceMetadata, ...originalSourceIdentity } = oldInstance.source
    void originalSourceMetadata
    expect(instance.source.metadata?.physicsosImport1).toMatchObject({ operation: 'import', canvasId: fixture.graph.manifest.id, instanceId: oldInstance.instanceId, source: originalSourceIdentity })
    expect(instance.metadata).toEqual(oldInstance.metadata)
    expect(instance.rendererRelease).toEqual(oldInstance.rendererRelease)
    expect(sceneFrom(graph, instance.currentScene).scene.metadata.experimentNotebook).toEqual(fixture.scene.scene.metadata.experimentNotebook)
    expect(canonicalStringify(fixture.graph)).toBe(before)
    expect(Object.isFrozen(imported.result?.measurements[0]?.metadata)).toBe(true)
    assertClosure(graph)
    assertDigests(graph)
    expect((await verifyGraphDigests(graph, sha256)).ok).toBe(true)
  })

  it('downgrades captures reachable only through history, retaining original source-scene provenance', async () => {
    const fixture = graphFixture()
    const graph = unownedCaptureGraph(fixture.graph)
    const historyOnly: CanvasGraph = { ...graph, manifest: { ...graph.manifest, snapshots: [], comparisons: [], nodes: graph.manifest.nodes.filter((node) => node.kind === 'group' || node.kind === 'note'), edges: [] } }
    const imported: CloneGraphResult = unwrap(await importGraph(historyOnly, cloneOptions()))
    const captures = Object.values(imported.graph.objects).filter((object): object is SnapshotObject => object.kind === 'snapshot')
    expect(captures).toHaveLength(1)
    expect(captures[0]!.source).toBe('imported')
    expect(captures[0]!.scene).toEqual(fixture.sceneRef)
    expect(captures[0]!.datasets).toEqual([fixture.datasetRef])
    assertClosure(imported.graph)
    assertDigests(imported.graph)
  })

  it('normalizes unsafe import input into a structured parse failure', async () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(issuesOf(await importGraph(revoked.proxy, cloneOptions()))).toContain('unsafe-object')
  })

  it('supports merging original and imported history without rewriting recorded entry IDs', async () => {
    const fixture = graphFixture()
    const imported = unwrap(await importGraph(fixture.graph, cloneOptions()))
    const objects = { ...fixture.graph.objects, ...imported.graph.objects }
    for (const instance of imported.graph.manifest.instances) {
      delete objects[instance.currentScene.digest]
      delete objects[instance.originScene.digest]
    }
    const mergedHead = publish(objects, {
      schemaVersion: 1, kind: 'history', parents: [fixture.historyRef, imported.graph.manifest.history!], entries: [],
    }).ref
    const graph = emptyWithObjects(objects, mergedHead)
    expect(parseGraph(graph).ok).toBe(true)
    expect((await verifyGraphDigests(graph, sha256)).ok).toBe(true)
    const again = unwrap(await importGraph(graph, cloneOptions()))
    const head = historyFrom(again.graph, again.graph.manifest.history!)
    expect(head.parents).toHaveLength(1)
    const capture = historyFrom(again.graph, historyFrom(again.graph, head.parents[0]!).parents[0]!).entries[0]!
    expect(capture.id).toBe(fixture.parentHistory.entries[0]!.id)
    expect(capture.instanceId).toBe(fixture.parentHistory.entries[0]!.instanceId)
    expect(capture.snapshot).toBeDefined()
    if (capture.snapshot === undefined) throw new Error('Expected retained historical snapshot reference.')
    expect(snapshotFrom(again.graph, capture.snapshot).source).toBe('imported')
    assertClosure(again.graph)
    assertDigests(again.graph)
  })

  it('keeps repeated import provenance flat while preserving original source metadata', async () => {
    const fixture = circuitGraphFixture()
    let graph = fixture.graph
    const sizes: number[] = []
    for (let iteration = 0; iteration < 8; iteration += 1) {
      let next = 0
      graph = unwrap(await importGraph(graph, cloneOptions({ id: (kind, oldId) => `round-${iteration}-${kind}-${++next}-${sha256(oldId).slice(0, 16)}` }))).graph
      const metadata = graph.manifest.instances[0]!.source.metadata!
      expect(metadata.preserved).toBe('source')
      expect(metadata.physicsosImport).toEqual({ preexisting: true })
      const records = Object.entries(metadata).filter(([key]) => /^physicsosImport\d+$/.test(key))
      expect(records).toHaveLength(iteration + 1)
      for (const [, record] of records) {
        if (record === null || typeof record !== 'object' || Array.isArray(record) || !('source' in record)) throw new Error('Expected flat source provenance.')
        const source = record.source
        expect(source !== null && typeof source === 'object' && !Array.isArray(source) && !('metadata' in source)).toBe(true)
      }
      sizes.push(new TextEncoder().encode(canonicalStringify(metadata)).byteLength)
      assertClosure(graph)
      assertDigests(graph)
    }
    expect(sizes[7]! - sizes[6]!).toBeLessThan(sizes[1]! - sizes[0]! + 512)
    expect(sizes[7]!).toBeLessThan(sizes[0]! * 12)
  })

  it('does not upgrade already-imported captures on subsequent imports', async () => {
    const fixture = graphFixture()
    const first = unwrap(await importGraph(fixture.graph, cloneOptions()))
    const originalSnapshotRef = first.graph.manifest.snapshots[0]!.snapshot
    let counter = 0
    const second = unwrap(await importGraph(first.graph, cloneOptions({ id: (kind, oldId) => `import-again-${kind}-${++counter}-${oldId}` })))
    expect(second.graph.manifest.snapshots[0]!.snapshot).toEqual(originalSnapshotRef)
    expect(snapshotFrom(second.graph, originalSnapshotRef).source).toBe('imported')
    expect(snapshotFrom(second.graph, originalSnapshotRef).result).toEqual(fixture.snapshot.result)
    assertClosure(second.graph)
    assertDigests(second.graph)
  })
})
