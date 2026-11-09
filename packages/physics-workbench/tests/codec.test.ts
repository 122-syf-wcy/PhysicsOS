import { describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'

import { createManifest, createSceneObject, parseManifest, parseObject, refsOf } from '../src/codec.ts'
import { canonicalStringify } from '../src/json.ts'
import type { CanvasManifest, CanvasNode, ExperimentInstance, HistoryObject } from '../src/types.ts'

const now = '2026-11-08T12:00:00.000Z'
const sceneDigest = 'a'.repeat(64)
const layout = { x: -125.5, y: 90, width: 420, height: 320, zIndex: 1 }
const instance = (instanceId = 'instance-1'): ExperimentInstance => ({
  instanceId, currentScene: { kind: 'scene', digest: sceneDigest }, originScene: { kind: 'scene', digest: sceneDigest },
  templateId: 'uniform-linear', domain: 'mechanics', source: { kind: 'template', id: 'uniform-linear' },
  buildMode: 'inspect', clock: { time: 0, total: 0, running: false, rate: 1 }, instanceEditRevision: 0,
})
const node = (id: string, groupId?: string): CanvasNode => ({
  id, kind: 'experiment', instanceId: 'instance-1', layout,
  ...(groupId === undefined ? {} : { groupId }), locked: true,
})
const manifest = (): CanvasManifest => ({
  ...createManifest({ id: 'canvas-1', title: 'Raw experiments', now }),
  nodes: [node('experiment-node')], instances: [instance()],
})

describe('workbench manifest and immutable object codec', () => {
  it('creates a real empty manifest with independent schema and ownership identity', () => {
    const empty = createManifest({ id: 'canvas-1', title: 'New canvas', now })
    expect(empty).toEqual({ schemaVersion: 1, id: 'canvas-1', title: 'New canvas', createdAt: now, updatedAt: now,
      viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], instances: [], snapshots: [], comparisons: [] })
    expect(Object.isFrozen(empty)).toBe(true)
    expect('version' in empty).toBe(false)
  })

  it('round-trips all node kinds, releases, metadata, layout, and locks', () => {
    const full: CanvasManifest = {
      ...manifest(),
      instances: [{ ...instance(), rendererRelease: { id: 'renderer-1', experimentId: 'linear', version: '1.0.0', sha256: 'b'.repeat(64) },
        templateRelease: { id: 'linear', version: '2.0.0', digest: 'c'.repeat(64) },
        source: { kind: 'question-code', questionId: 'exact-question', artifactId: 'artifact-7' } }],
      snapshots: [{ id: 'alias-1', title: 'First reading', snapshot: { kind: 'snapshot', digest: 'd'.repeat(64) }, instanceId: 'instance-1' }],
      comparisons: [{ id: 'comparison-1', mode: 'overlay', alignment: 'native', members: [
        { id: 'member-1', snapshotAliasId: 'alias-1', dataset: { kind: 'dataset', digest: 'e'.repeat(64) }, metricId: 'velocity:x', axisId: 'time' },
      ] }],
      nodes: [
        { id: 'group-1', kind: 'group', collapsed: false, layout }, node('experiment-node', 'group-1'),
        { id: 'result-node', kind: 'result', snapshotAliasId: 'alias-1', view: 'table', metricIds: ['velocity:x'], layout },
        { id: 'note-node', kind: 'note', body: 'The missing reading is not zero.', format: 'markdown', layout, locked: false },
        { id: 'comparison-node', kind: 'comparison', comparisonId: 'comparison-1', layout },
      ],
      edges: [{ id: 'edge-1', kind: 'relation', from: 'experiment-node', to: 'result-node', label: 'captured' }],
      metadata: { extensions: { retained: true } },
    }
    const parsed = parseManifest(JSON.parse(canonicalStringify(full)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value).toEqual(full)
  })

  it('does not impose a template or card-count product limit', () => {
    const many: CanvasManifest = { ...manifest(), instances: Array.from({ length: 64 }, (_, index) => instance(`instance-${index}`)),
      nodes: Array.from({ length: 64 }, (_, index) => ({ ...node(`node-${index}`), instanceId: `instance-${index}` })) }
    expect(parseManifest(many).ok).toBe(true)
  })

  it('rejects malformed wire fields, unknown runtime properties, and bad IDs', () => {
    const invalid: readonly unknown[] = [
      { ...manifest(), schemaVersion: 2 }, { ...manifest(), version: 5 },
      { ...manifest(), nodes: [{ ...node('node'), runtime: { start: true } }] },
      { ...manifest(), nodes: [{ ...node('node'), locked: 'true' }] },
      { ...manifest(), nodes: [{ ...node('node'), layout: { ...layout, width: 0 } }] },
      { ...manifest(), instances: [{ ...instance(), buildMode: 'template' }] },
      { ...manifest(), instances: [{ ...instance(), currentScene: { kind: 'scene', digest: 'A'.repeat(64) } }] },
      { ...manifest(), instances: [{ ...instance(), currentScene: { kind: 'scene', digest: `${sceneDigest}\n` } }] },
      { ...manifest(), instances: [{ ...instance(), clock: { time: 0, total: 0, running: true, rate: 1 } }] },
      { ...manifest(), createdAt: '2026-02-30T12:00:00.000Z' },
      { ...manifest(), metadata: { nonfinite: NaN } },
    ]
    for (const value of invalid) expect(parseManifest(value).ok).toBe(false)
  })

  it('rejects missing references, duplicate IDs, illegal groups and group cycles', () => {
    const invalid: readonly CanvasManifest[] = [
      { ...manifest(), instances: [] },
      { ...manifest(), nodes: [node('one'), node('one')] },
      { ...manifest(), nodes: [node('one', 'missing')] },
      { ...manifest(), nodes: [node('one', 'one')] },
      { ...manifest(), nodes: [
        { id: 'a', kind: 'group', collapsed: false, layout, groupId: 'b' },
        { id: 'b', kind: 'group', collapsed: false, layout, groupId: 'a' },
      ] },
      { ...manifest(), edges: [{ id: 'edge', kind: 'relation', from: 'experiment-node', to: 'missing' }] },
      { ...manifest(), snapshots: [{ id: 'alias', title: 'Lost association', instanceId: 'missing', snapshot: { kind: 'snapshot', digest: 'b'.repeat(64) } }] },
    ]
    for (const value of invalid) expect(parseManifest(value).ok).toBe(false)
  })

  it('detaches source scenes and preserves actual metadata and nested physical parameters', () => {
    const source = createMechanicsScene({ sceneId: 'owned-scene', model: 'spring_oscillator', now, springConstant: 27.123456789012345 })
    source.metadata.experimentRelease = { kind: 'official', id: 'official:oscillator', experimentId: 'oscillator', version: '1.0.0' }
    const object = createSceneObject(source)
    source.metadata.title = 'Changed source'
    source.constraints[0]!.parameters.stiffness = 99
    expect(object.scene.metadata.title).not.toBe('Changed source')
    expect(object.scene.constraints[0]!.parameters.stiffness).toBe(27.123456789012345)
    expect(object.scene.metadata.experimentRelease).toEqual({ kind: 'official', id: 'official:oscillator', experimentId: 'oscillator', version: '1.0.0' })
    expect(Object.isFrozen(object.scene)).toBe(true)
    expect(Object.isFrozen(object.scene.constraints[0]!.parameters)).toBe(true)
    expect(parseObject(JSON.parse(canonicalStringify(object))).ok).toBe(true)
  })

  it('enumerates only actual immutable references, not metadata lookalikes', () => {
    const document: CanvasManifest = { ...manifest(), history: { kind: 'history', digest: 'b'.repeat(64) },
      metadata: { fakeDependency: { kind: 'snapshot', digest: 'c'.repeat(64) } } }
    expect(refsOf(document)).toEqual([{ kind: 'scene', digest: sceneDigest }, { kind: 'history', digest: 'b'.repeat(64) }])
    const history: HistoryObject = { schemaVersion: 1, kind: 'history', parents: [{ kind: 'history', digest: 'd'.repeat(64) }],
      entries: [{ id: 'capture', at: now, operation: 'capture', scene: { kind: 'scene', digest: sceneDigest },
        snapshot: { kind: 'snapshot', digest: 'e'.repeat(64) }, details: { ignored: { kind: 'dataset', digest: 'f'.repeat(64) } } }] }
    expect(refsOf(history)).toEqual([{ kind: 'history', digest: 'd'.repeat(64) }, { kind: 'scene', digest: sceneDigest }, { kind: 'snapshot', digest: 'e'.repeat(64) }])
  })
})
