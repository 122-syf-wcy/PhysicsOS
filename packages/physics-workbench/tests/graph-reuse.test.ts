import { describe, expect, it } from 'vitest'
import { parseGraph, validateGraph, verifyGraphDigests } from '../src/graph.ts'
import { canonicalStringify, copyJsonObject, unwrap } from '../src/json.ts'
import { graphFixture, sha256 } from './graph-fixtures.ts'

const shapeOf = (value: unknown, depth = 0): { readonly nodes: number; readonly depth: number } => {
  let nodes = 1
  let deepest = depth
  if (value !== null && typeof value === 'object') for (const child of Object.values(value)) {
    const shape = shapeOf(child, depth + 1)
    nodes += shape.nodes
    deepest = Math.max(deepest, shape.depth)
  }
  return { nodes, depth: deepest }
}
const rejected = (result: ReturnType<typeof validateGraph>): readonly string[] => {
  if (result.ok) throw new Error('The lowered graph policy must reject this complete graph.')
  return result.issues.map(issue => issue.code)
}

describe('trusted immutable graph validation reuse', () => {
  it('reuses validated immutable capture objects across changed manifests without rereading their typed payloads', () => {
    const fixture = graphFixture()
    const first = unwrap(parseGraph(copyJsonObject(fixture.graph)))
    const changed = { ...first.manifest, title: 'A layout or notebook update keeps the recorded evidence' }
    const second = unwrap(validateGraph(changed, first.objects))
    for (const [identity, object] of Object.entries(first.objects)) expect(second.objects[identity]).toBe(object)
    expect(second.manifest.title).toBe('A layout or notebook update keeps the recorded evidence')
    expect(second.manifest).not.toBe(changed)
    expect(Object.isFrozen(second.manifest)).toBe(true)
  })

  it('rechecks every aggregate byte, node and depth limit after the same immutable graph has been validated', () => {
    const graph = unwrap(parseGraph(copyJsonObject(graphFixture().graph)))
    expect(validateGraph(graph.manifest, graph.objects).ok).toBe(true)
    const bytes = Buffer.byteLength(canonicalStringify(graph))
    const shape = shapeOf(graph)
    for (const limits of [{ maxBytes: bytes - 1 }, { maxJsonNodes: shape.nodes - 1 }, { maxDepth: shape.depth - 1 }]) {
      expect(rejected(validateGraph(graph.manifest, graph.objects, limits))).toContain('graph-quota')
    }
  })

  it('counts each repeated immutable subtree occurrence instead of charging a shared object only once', () => {
    const source = graphFixture().graph
    const evidence = copyJsonObject({ readings: [1, 2, 3, 4], label: 'One immutable value, two serialized occurrences' })
    const graph = unwrap(parseGraph(copyJsonObject({ ...source, manifest: { ...source.manifest,
      metadata: { ...source.manifest.metadata, first: evidence, second: evidence } } })))
    expect(validateGraph(graph.manifest, graph.objects).ok).toBe(true)
    const shape = shapeOf(graph)
    const bytes = Buffer.byteLength(canonicalStringify(graph))
    expect(rejected(validateGraph(graph.manifest, graph.objects, { maxJsonNodes: shape.nodes - 1 }))).toContain('graph-quota')
    expect(rejected(validateGraph(graph.manifest, graph.objects, { maxBytes: bytes - 1 }))).toContain('graph-quota')
  })

  it('never treats a caller-frozen wrapper with a mutable child as trusted schema provenance', () => {
    const fixture = graphFixture()
    const origin = { ...fixture.dataset.origin }
    const callerFrozen = Object.freeze({ ...fixture.dataset, origin })
    const objects = { ...fixture.graph.objects, [fixture.datasetRef.digest]: callerFrozen }
    expect(validateGraph(fixture.graph.manifest, objects).ok).toBe(true)
    origin.sceneRevision += 1
    const result = validateGraph(fixture.graph.manifest, objects)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toContain('revision')
  })

  it('rechecks digest truth and changed graph relationships even when all objects are trusted and cached', async () => {
    const graph = unwrap(parseGraph(copyJsonObject(graphFixture().graph)))
    expect((await verifyGraphDigests(graph, sha256)).ok).toBe(true)
    const badHash = await verifyGraphDigests(graph, () => 'f'.repeat(64))
    expect(badHash.ok).toBe(false)
    const changed = { ...graph.manifest, instances: graph.manifest.instances.map(instance => ({ ...instance,
      currentScene: { kind: 'scene' as const, digest: 'a'.repeat(64) } })) }
    expect(validateGraph(changed, graph.objects).ok).toBe(false)
  })
})
