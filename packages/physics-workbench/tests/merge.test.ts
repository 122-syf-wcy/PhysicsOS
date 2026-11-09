import { describe, expect, it } from 'vitest'

import { canonicalStringify, createManifest, parseManifest } from '../src/codec.ts'
import { mergeManifests } from '../src/merge.ts'
import type {
  CanvasLayout, CanvasManifest, CanvasNode, ComparisonConfig, ComparisonMember,
  ExperimentInstance, JsonObject, JsonValue, MergeConflict, MergeResult, ObjectRef, SnapshotAlias,
} from '../src/types.ts'

type NoteNode = Extract<CanvasNode, { readonly kind: 'note' }>
type GroupNode = Extract<CanvasNode, { readonly kind: 'group' }>
const NOW = '2026-11-08T00:00:00.000Z'
const LATER = '2026-11-08T01:00:00.000Z'
const LATEST = '2026-11-08T02:00:00.000Z'

// These are structural codec fixtures, not claimed hashes of simulated or stored payloads.
// A manifest merge neither loads nor manufactures the referenced blob contents.
const SCENE_A: ObjectRef<'scene'> = { kind: 'scene', digest: 'a'.repeat(64) }
const SCENE_B: ObjectRef<'scene'> = { kind: 'scene', digest: 'b'.repeat(64) }
const SCENE_C: ObjectRef<'scene'> = { kind: 'scene', digest: 'c'.repeat(64) }
const SNAPSHOT_A: ObjectRef<'snapshot'> = { kind: 'snapshot', digest: 'd'.repeat(64) }
const SNAPSHOT_B: ObjectRef<'snapshot'> = { kind: 'snapshot', digest: 'e'.repeat(64) }
const DATASET_A: ObjectRef<'dataset'> = { kind: 'dataset', digest: 'a'.repeat(64) }
const DATASET_B: ObjectRef<'dataset'> = { kind: 'dataset', digest: 'b'.repeat(64) }
const HISTORY_A: ObjectRef<'history'> = { kind: 'history', digest: 'e'.repeat(64) }
const HISTORY_B: ObjectRef<'history'> = { kind: 'history', digest: 'f'.repeat(64) }

const canvas = (patch: Partial<CanvasManifest> = {}): CanvasManifest => {
  const parsed = parseManifest({ ...createManifest({ id: 'canvas', title: 'Canvas', now: NOW }), ...patch })
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return parsed.value
}
const layout = (patch: Partial<CanvasLayout> = {}): CanvasLayout => ({
  x: 0, y: 0, width: 320, height: 240, zIndex: 0, ...patch,
})
const note = (id: string, patch: Partial<NoteNode> = {}): NoteNode => ({
  id, kind: 'note', body: 'Original note', format: 'plain', layout: layout(), ...patch,
})
const group = (id: string, patch: Partial<GroupNode> = {}): GroupNode => ({
  id, kind: 'group', collapsed: false, layout: layout({ width: 800, height: 600 }), ...patch,
})
const instance = (id: string, patch: Partial<ExperimentInstance> = {}): ExperimentInstance => ({
  instanceId: id, currentScene: SCENE_A, originScene: SCENE_A, domain: 'mechanics',
  source: { kind: 'free-build' }, buildMode: 'construct',
  clock: { time: 0, total: 0, running: false, rate: 1 }, instanceEditRevision: 0, ...patch,
})
const alias = (id: string, patch: Partial<SnapshotAlias> = {}): SnapshotAlias => ({
  id, title: id, snapshot: SNAPSHOT_A, ...patch,
})
const member = (id: string, snapshotAliasId: string, patch: Partial<ComparisonMember> = {}): ComparisonMember => ({
  id, snapshotAliasId, dataset: DATASET_A, metricId: 'velocity', ...patch,
})
const comparison = (id: string, members: readonly ComparisonMember[], patch: Partial<ComparisonConfig> = {}): ComparisonConfig => ({
  id, members, mode: 'overlay', alignment: 'native', ...patch,
})
const success = (result: MergeResult): CanvasManifest => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.conflicts.map((entry) => `${entry.path}: ${entry.message}`).join('; '))
  expect(result.conflicts).toEqual([])
  expect(parseManifest(result.manifest).ok).toBe(true)
  return result.manifest
}
const failure = (result: MergeResult): readonly MergeConflict[] => {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected merge conflicts, not a candidate manifest.')
  expect('manifest' in result).toBe(false)
  expect(result.conflicts.length).toBeGreaterThan(0)
  return result.conflicts
}

describe('mergeManifests', () => {
  it('returns a detached valid no-op document', () => {
    const base = canvas({ nodes: [note('note-a')], metadata: { extension: { values: [1, null, true] } } })
    const merged = success(mergeManifests(base, base, base))
    expect(merged).toEqual(base)
    expect(merged).not.toBe(base)
    expect(merged.nodes).not.toBe(base.nodes)
    expect(merged.nodes[0]).not.toBe(base.nodes[0])
    expect(merged.metadata).not.toBe(base.metadata)
    expect(Object.isFrozen(merged)).toBe(true)
    expect(Object.isFrozen(merged.nodes)).toBe(true)
  })

  it('accepts either changed side when the other equals base', () => {
    const base = canvas({ nodes: [note('note-a')] })
    const changed = canvas({ title: 'Renamed', viewport: { x: 20, y: 30, zoom: 2 }, nodes: [note('note-a', { body: 'Changed' })] })
    expect(success(mergeManifests(base, base, changed))).toEqual(changed)
    expect(success(mergeManifests(base, changed, base))).toEqual(changed)
  })

  it('accepts exact matching edits without using object property order as content', () => {
    const base = canvas({ nodes: [note('note-a')], metadata: { extension: { a: 0, b: 0 } } })
    const local = canvas({ nodes: [note('note-a', { body: 'Agreed' })], metadata: { extension: { a: 1, b: 2 } } })
    const remote = canvas({ nodes: [note('note-a', { body: 'Agreed' })], metadata: { extension: { b: 2, a: 1 } } })
    expect(success(mergeManifests(base, local, remote))).toEqual(local)
  })

  it('merges disjoint node, layout, group and note edits', () => {
    const a = group('group-a')
    const b = group('group-b')
    const n = note('note-a', { title: 'Original', groupId: a.id })
    const base = canvas({ nodes: [a, n, b] })
    const local = canvas({ nodes: [a, { ...n, title: 'Local title', layout: { ...n.layout, x: 90 } }, b] })
    const remote = canvas({ nodes: [a, { ...n, body: 'Remote text', groupId: b.id, layout: { ...n.layout, y: 70 } }, { ...b, collapsed: true }] })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.nodes.map((node) => node.id)).toEqual([a.id, n.id, b.id])
    expect(merged.nodes[1]).toEqual({
      ...n, title: 'Local title', body: 'Remote text', groupId: b.id, layout: { ...n.layout, x: 90, y: 70 },
    })
    expect(merged.nodes[2]).toEqual({ ...b, collapsed: true })
  })

  it('preserves note text verbatim while merging an independent format change', () => {
    const n = note('note-a')
    const body = '  **Velocity**\n\nΔv = 3 m/s  \n`raw <text>`\n'
    const base = canvas({ nodes: [n] })
    const local = canvas({ nodes: [{ ...n, body }] })
    const remote = canvas({ nodes: [{ ...n, format: 'markdown' }] })
    expect(success(mergeManifests(base, local, remote)).nodes[0]).toEqual({ ...n, body, format: 'markdown' })
  })

  it('returns an explicit value conflict instead of using timestamps to pick note text', () => {
    const n = note('note/a~b')
    const base = canvas({ nodes: [n] })
    const local = canvas({ nodes: [{ ...n, body: 'Local text' }], updatedAt: LATEST })
    const remote = canvas({ nodes: [{ ...n, body: 'Remote text' }], updatedAt: LATER })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/nodes/note~1a~0b/body', kind: 'value', base: n.body, local: 'Local text', remote: 'Remote text',
      message: 'Concurrent edits changed the same value differently.',
    }])
  })

  it('merges unrelated IDs and additions in all contract-owned collections deterministically', () => {
    const first = note('z-base')
    const second = note('a-base')
    const localInstance = instance('instance-local')
    const remoteInstance = instance('instance-remote', { currentScene: SCENE_B, originScene: SCENE_B })
    const localAlias = alias('alias-local', { instanceId: localInstance.instanceId })
    const remoteAlias = alias('alias-remote', { instanceId: remoteInstance.instanceId, snapshot: SNAPSHOT_B })
    const localComparison = comparison('comparison-local', [member('member-local', localAlias.id)])
    const remoteComparison = comparison('comparison-remote', [member('member-remote', remoteAlias.id, { dataset: DATASET_B })])
    const base = canvas({ nodes: [first, second] })
    const local = canvas({
      nodes: [{ ...first, title: 'Local rename' }, second, note('z-local'), note('m-local')],
      edges: [{ id: 'edge-local', kind: 'relation', from: 'z-local', to: first.id }],
      instances: [localInstance], snapshots: [localAlias], comparisons: [localComparison],
    })
    const remote = canvas({
      nodes: [first, { ...second, body: 'Remote text' }, note('z-remote'), note('b-remote')],
      edges: [{ id: 'edge-remote', kind: 'sequence', from: 'z-remote', to: second.id }],
      instances: [remoteInstance], snapshots: [remoteAlias], comparisons: [remoteComparison],
    })
    const source = canonicalStringify([base, local, remote])
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.nodes.map((node) => node.id)).toEqual(['z-base', 'a-base', 'b-remote', 'm-local', 'z-local', 'z-remote'])
    expect(merged.nodes[0]?.title).toBe('Local rename')
    expect(merged.nodes[1]).toEqual({ ...second, body: 'Remote text' })
    expect(merged.edges.map((edge) => edge.id)).toEqual(['edge-local', 'edge-remote'])
    expect(merged.instances.map((entry) => entry.instanceId)).toEqual(['instance-local', 'instance-remote'])
    expect(merged.snapshots.map((entry) => entry.id)).toEqual(['alias-local', 'alias-remote'])
    expect(merged.comparisons.map((entry) => entry.id)).toEqual(['comparison-local', 'comparison-remote'])
    expect(canonicalStringify(success(mergeManifests(base, remote, local)))).toBe(canonicalStringify(merged))
    expect(canonicalStringify([base, local, remote])).toBe(source)
  })

  it('merges independent edge fields and snapshot alias labels without changing captures', () => {
    const a = note('a')
    const b = note('b')
    const c = note('c')
    const edge = { id: 'edge-a', kind: 'relation', from: a.id, to: b.id, label: 'Original' } as const
    const snapshot = alias('alias-a', { metadata: { annotations: { left: false, right: false } } })
    const base = canvas({ nodes: [a, b, c], edges: [edge], snapshots: [snapshot] })
    const local = canvas({
      nodes: [a, b, c], edges: [{ ...edge, label: 'Local label' }],
      snapshots: [{ ...snapshot, title: 'Local alias title', metadata: { annotations: { left: true, right: false } } }],
    })
    const remote = canvas({
      nodes: [a, b, c], edges: [{ ...edge, to: c.id }],
      snapshots: [{ ...snapshot, metadata: { annotations: { left: false, right: true } } }],
    })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.edges[0]).toEqual({ ...edge, label: 'Local label', to: c.id })
    expect(merged.snapshots[0]).toEqual({ ...snapshot, title: 'Local alias title', metadata: { annotations: { left: true, right: true } } })
    expect(merged.snapshots[0]?.snapshot).toEqual(SNAPSHOT_A)
  })

  it('safely deletes an unchanged graph across all entity collections', () => {
    const i = instance('instance-a')
    const snapshot = alias('alias-a', { instanceId: i.instanceId })
    const config = comparison('comparison-a', [member('member-a', snapshot.id)])
    const nodes: readonly CanvasNode[] = [
      { id: 'experiment-a', kind: 'experiment', instanceId: i.instanceId, layout: layout() },
      { id: 'result-a', kind: 'result', snapshotAliasId: snapshot.id, layout: layout() },
      { id: 'comparison-node-a', kind: 'comparison', comparisonId: config.id, layout: layout() },
    ]
    const base = canvas({
      nodes, edges: [{ id: 'edge-a', kind: 'comparison', from: 'experiment-a', to: 'result-a' }],
      instances: [i], snapshots: [snapshot], comparisons: [config],
    })
    const deleted = canvas()
    expect(success(mergeManifests(base, deleted, base))).toEqual(deleted)
    expect(success(mergeManifests(base, base, deleted))).toEqual(deleted)
    expect(success(mergeManifests(base, deleted, deleted))).toEqual(deleted)
  })

  it('reports delete-modify with the absent side omitted rather than represented as null', () => {
    const n = note('note-a')
    const modified = { ...n, body: 'Edited instead of deleted' }
    const base = canvas({ nodes: [n] })
    const deleted = canvas()
    const changed = canvas({ nodes: [modified] })
    expect(failure(mergeManifests(base, deleted, changed))).toEqual([{
      path: '/nodes/note-a', kind: 'delete-modify', base: n, remote: modified,
      message: 'One side deleted this entity while the other modified it.',
    }])
    expect(failure(mergeManifests(base, changed, deleted))).toEqual([{
      path: '/nodes/note-a', kind: 'delete-modify', base: n, local: modified,
      message: 'One side deleted this entity while the other modified it.',
    }])
  })

  it('distinguishes optional metadata deletion from a concurrent modification', () => {
    const n = note('note-a', { metadata: { extension: { text: 'Original' } } })
    const base = canvas({ nodes: [n] })
    const local = canvas({ nodes: [note(n.id)] })
    const remote = canvas({ nodes: [{ ...n, metadata: { extension: { text: 'Changed' } } }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/nodes/note-a/metadata', kind: 'delete-modify', base: n.metadata,
      remote: { extension: { text: 'Changed' } },
      message: 'One side removed this value while the other modified it.',
    }])
  })

  it('rejects differing same-ID additions instead of combining two new entities', () => {
    const base = canvas()
    const localNode = note('shared', { title: 'Local addition' })
    const remoteNode = note('shared', { body: 'Remote addition' })
    const local = canvas({ nodes: [localNode] })
    const remote = canvas({ nodes: [remoteNode] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/nodes/shared', kind: 'concurrent-add', local: localNode, remote: remoteNode,
      message: 'Both sides added different entities with the same identity.',
    }])
  })

  it('accepts matching same-ID additions, including new instance origins', () => {
    const base = canvas()
    const n = note('shared')
    const i = instance('shared-instance', { currentScene: SCENE_B, originScene: SCENE_B })
    const local = canvas({ nodes: [n], instances: [i] })
    const remote = canvas({ nodes: [{ ...n }], instances: [{ ...i }] })
    expect(success(mergeManifests(base, local, remote))).toEqual(local)
  })

  it('reports concurrent instance additions as whole-entity conflicts', () => {
    const base = canvas()
    const localInstance = instance('shared')
    const remoteInstance = instance('shared', { source: { kind: 'import', id: 'imported-source' } })
    const conflicts = failure(mergeManifests(base, canvas({ instances: [localInstance] }), canvas({ instances: [remoteInstance] })))
    expect(conflicts).toEqual([{
      path: '/instances/shared', kind: 'concurrent-add', local: localInstance, remote: remoteInstance,
      message: 'Both sides added different entities with the same identity.',
    }])
  })

  it('merges comparison members by ID and independent member additions in base order', () => {
    const aliases = [alias('alias-a'), alias('alias-b')]
    const a = member('z-member', 'alias-a')
    const b = member('a-member', 'alias-b')
    const config = comparison('comparison-a', [a, b])
    const base = canvas({ snapshots: aliases, comparisons: [config] })
    const local = canvas({ snapshots: aliases, comparisons: [{
      ...config, title: 'Local title', members: [{ ...a, label: 'Local label' }, b, member('member-local', 'alias-a')],
    }] })
    const remote = canvas({ snapshots: aliases, comparisons: [{
      ...config, metadata: { extension: true }, members: [a, { ...b, label: 'Remote label' }, member('member-remote', 'alias-b')],
    }] })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.comparisons[0]).toEqual({
      ...config, title: 'Local title', metadata: { extension: true }, members: [
        { ...a, label: 'Local label' }, { ...b, label: 'Remote label' },
        member('member-local', 'alias-a'), member('member-remote', 'alias-b'),
      ],
    })
    expect(canonicalStringify(success(mergeManifests(base, remote, local)))).toBe(canonicalStringify(merged))
  })

  it('merges a member label with an unopposed dataset binding change', () => {
    const snapshots = [alias('alias-a')]
    const m = member('member-a', 'alias-a')
    const c = comparison('comparison-a', [m])
    const base = canvas({ snapshots, comparisons: [c] })
    const local = canvas({ snapshots, comparisons: [{ ...c, members: [{ ...m, label: 'Label only' }] }] })
    const remote = canvas({ snapshots, comparisons: [{ ...c, members: [{ ...m, dataset: DATASET_B }] }] })
    expect(success(mergeManifests(base, local, remote)).comparisons[0]?.members[0]).toEqual({ ...m, label: 'Label only', dataset: DATASET_B })
  })

  it('does not splice a dataset change into a concurrent metric binding change', () => {
    const snapshots = [alias('alias-a')]
    const m = member('member/a~b', 'alias-a')
    const c = comparison('comparison/a~b', [m])
    const base = canvas({ snapshots, comparisons: [c] })
    const local = canvas({ snapshots, comparisons: [{ ...c, members: [{ ...m, dataset: DATASET_B }] }] })
    const remote = canvas({ snapshots, comparisons: [{ ...c, members: [{ ...m, metricId: 'acceleration' }] }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/comparisons/comparison~1a~0b/members/member~1a~0b', kind: 'value',
      base: { snapshotAliasId: 'alias-a', dataset: DATASET_A, metricId: 'velocity' },
      local: { snapshotAliasId: 'alias-a', dataset: DATASET_B, metricId: 'velocity' },
      remote: { snapshotAliasId: 'alias-a', dataset: DATASET_A, metricId: 'acceleration' },
      message: 'Concurrent member edits cannot split the snapshot alias, dataset, metric and axis binding.',
    }])
  })

  it('rejects differing same-ID comparison member additions', () => {
    const snapshots = [alias('alias-a')]
    const c = comparison('comparison-a', [])
    const base = canvas({ snapshots, comparisons: [c] })
    const left = member('shared-member', 'alias-a', { label: 'Local label' })
    const right = member('shared-member', 'alias-a', { dataset: DATASET_B })
    const local = canvas({ snapshots, comparisons: [{ ...c, members: [left] }] })
    const remote = canvas({ snapshots, comparisons: [{ ...c, members: [right] }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/comparisons/comparison-a/members/shared-member', kind: 'concurrent-add', local: left, remote: right,
      message: 'Both sides added different entities with the same identity.',
    }])
  })

  it('keeps an unopposed intentional reorder while merging remote content', () => {
    const a = note('a')
    const b = note('b')
    const c = note('c')
    const base = canvas({ nodes: [a, b, c] })
    const local = canvas({ nodes: [c, a, b] })
    const remote = canvas({ nodes: [a, { ...b, body: 'Remote edit' }, c] })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.nodes.map((node) => node.id)).toEqual(['c', 'a', 'b'])
    expect(merged.nodes[2]).toEqual({ ...b, body: 'Remote edit' })
  })

  it('preserves one-sided insertion placement instead of always appending', () => {
    const a = note('a')
    const b = note('b')
    const added = note('new')
    const base = canvas({ nodes: [a, b] })
    const local = canvas({ nodes: [added, a, b] })
    const remote = canvas({ nodes: [a, { ...b, title: 'Remote edit' }] })
    expect(success(mergeManifests(base, local, remote)).nodes.map((node) => node.id)).toEqual(['new', 'a', 'b'])
  })

  it('accepts the same reorder on both sides while merging disjoint values', () => {
    const a = note('a')
    const b = note('b')
    const c = note('c')
    const base = canvas({ nodes: [a, b, c] })
    const local = canvas({ nodes: [b, { ...a, title: 'Local' }, c] })
    const remote = canvas({ nodes: [{ ...b, body: 'Remote' }, a, c] })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.nodes.map((node) => node.id)).toEqual(['b', 'a', 'c'])
    expect(merged.nodes[0]).toEqual({ ...b, body: 'Remote' })
    expect(merged.nodes[1]).toEqual({ ...a, title: 'Local' })
  })

  it('conflicts on two differing intentional reorders of surviving IDs', () => {
    const a = note('a')
    const b = note('b')
    const c = note('c')
    const base = canvas({ nodes: [a, b, c] })
    const local = canvas({ nodes: [b, a, c] })
    const remote = canvas({ nodes: [a, c, b] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/nodes', kind: 'value', base: ['a', 'b', 'c'], local: ['b', 'a', 'c'], remote: ['a', 'c', 'b'],
      message: 'Both sides intentionally reordered the surviving entities differently.',
    }])
  })

  it('does not mistake deletion for a reorder', () => {
    const a = note('a')
    const b = note('b')
    const c = note('c')
    const base = canvas({ nodes: [a, b, c] })
    const local = canvas({ nodes: [a, c] })
    const remote = canvas({ nodes: [c, a, b] })
    expect(success(mergeManifests(base, local, remote)).nodes.map((node) => node.id)).toEqual(['c', 'a'])
  })

  it('conflicts when both sides add the same entity at incompatible placements', () => {
    const a = note('a')
    const b = note('b')
    const shared = note('new')
    const base = canvas({ nodes: [a, b] })
    const local = canvas({ nodes: [shared, a, b] })
    const remote = canvas({ nodes: [a, b, shared] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/nodes', kind: 'value', base: ['a', 'b'], local: ['new', 'a', 'b'], remote: ['a', 'b', 'new'],
      message: 'Concurrent orders disagree on the placement of entities added by both sides.',
    }])
  })

  it('preserves the agreed placement of a shared addition when unrelated additions also merge', () => {
    const a = note('a')
    const b = note('b')
    const shared = note('shared')
    const base = canvas({ nodes: [a, b] })
    const local = canvas({ nodes: [shared, a, b, note('local-only')] })
    const remote = canvas({ nodes: [shared, a, b, note('remote-only')] })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.nodes.map((node) => node.id)).toEqual(['shared', 'a', 'b', 'local-only', 'remote-only'])
    expect(success(mergeManifests(base, remote, local))).toEqual(merged)
  })

  it('withholds a candidate when deleting a group interacts with a remote move and addition', () => {
    const g = group('group/a~b')
    const n = note('existing-note')
    const base = canvas({ nodes: [g, n] })
    const local = canvas({ nodes: [n] })
    const added = note('new-note', { groupId: g.id })
    const remote = canvas({ nodes: [g, { ...n, groupId: g.id }, added] })
    const conflicts = failure(mergeManifests(base, local, remote))
    expect(conflicts).toHaveLength(2)
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/nodes/existing-note/groupId', kind: 'invalid-reference', remote: g.id }),
      expect.objectContaining({ path: '/nodes/new-note/groupId', kind: 'invalid-reference', remote: g.id }),
    ]))
    expect(conflicts.every((entry) => !('base' in entry) && !('local' in entry))).toBe(true)
    expect(conflicts.every((entry) => entry.message.includes('Group parent must reference a group node.'))).toBe(true)
  })

  it('detects a group cycle created by independent valid group moves', () => {
    const a = group('group-a')
    const b = group('group-b')
    const base = canvas({ nodes: [a, b] })
    const local = canvas({ nodes: [{ ...a, groupId: b.id }, b] })
    const remote = canvas({ nodes: [a, { ...b, groupId: a.id }] })
    const conflicts = failure(mergeManifests(base, local, remote))
    expect(conflicts).toEqual([{
      path: '/nodes/group-a/groupId', kind: 'invalid-reference', local: b.id,
      message: 'Merged manifest is invalid (reference): Group membership contains a cycle.',
    }])
  })

  it('detects a deleted node referenced by an independently added edge', () => {
    const removed = note('removed')
    const kept = note('kept')
    const base = canvas({ nodes: [removed, kept] })
    const local = canvas({ nodes: [kept] })
    const remote = canvas({ nodes: [removed, kept], edges: [{ id: 'edge/a~b', kind: 'relation', from: removed.id, to: kept.id }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/edges/edge~1a~0b/from', kind: 'invalid-reference', remote: removed.id,
      message: 'Merged manifest is invalid (reference): Edge source node is missing.',
    }])
  })

  it('detects a deleted instance referenced by an independently added experiment node', () => {
    const i = instance('instance-a')
    const base = canvas({ instances: [i] })
    const local = canvas()
    const remote = canvas({ instances: [i], nodes: [{ id: 'experiment-a', kind: 'experiment', instanceId: i.instanceId, layout: layout() }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/nodes/experiment-a/instanceId', kind: 'invalid-reference', remote: i.instanceId,
      message: 'Merged manifest is invalid (reference): Experiment node references a missing instance.',
    }])
  })

  it('detects a deleted instance used by a new snapshot association', () => {
    const i = instance('instance-a')
    const snapshot = alias('alias-a')
    const base = canvas({ instances: [i], snapshots: [snapshot] })
    const local = canvas({ snapshots: [snapshot] })
    const remote = canvas({ instances: [i], snapshots: [{ ...snapshot, instanceId: i.instanceId }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/snapshots/alias-a/instanceId', kind: 'invalid-reference', remote: i.instanceId,
      message: 'Merged manifest is invalid (reference): Snapshot alias association references a missing current instance.',
    }])
  })

  it('detects deleted snapshot aliases used by new result nodes and comparison members', () => {
    const snapshot = alias('alias-a')
    const config = comparison('comparison/a~b', [member('member/a~b', snapshot.id)])
    const base = canvas({ snapshots: [snapshot] })
    const local = canvas()
    const remote = canvas({
      snapshots: [snapshot], comparisons: [config],
      nodes: [{ id: 'result-a', kind: 'result', snapshotAliasId: snapshot.id, layout: layout() }],
    })
    const conflicts = failure(mergeManifests(base, local, remote))
    expect(conflicts).toHaveLength(2)
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/nodes/result-a/snapshotAliasId', kind: 'invalid-reference', remote: snapshot.id }),
      expect.objectContaining({ path: '/comparisons/comparison~1a~0b/members/member~1a~0b/snapshotAliasId', kind: 'invalid-reference', remote: snapshot.id }),
    ]))
  })

  it('detects a deleted comparison referenced by a new comparison node', () => {
    const config = comparison('comparison-a', [])
    const base = canvas({ comparisons: [config] })
    const local = canvas()
    const remote = canvas({
      comparisons: [config], nodes: [{ id: 'comparison-node', kind: 'comparison', comparisonId: config.id, layout: layout() }],
    })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/nodes/comparison-node/comparisonId', kind: 'invalid-reference', remote: config.id,
      message: 'Merged manifest is invalid (reference): Comparison node references a missing comparison.',
    }])
  })

  it('does not invent legal alignment when independent valid comparison edits become invalid together', () => {
    const c = comparison('comparison-a', [], { alignment: 'exact-coordinate' })
    const base = canvas({ comparisons: [c] })
    const local = canvas({ comparisons: [{ ...c, mode: 'difference' }] })
    const remote = canvas({ comparisons: [{ ...c, alignment: 'native' }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/comparisons/comparison-a/alignment', kind: 'invalid-reference',
      base: 'exact-coordinate', local: 'exact-coordinate', remote: 'native',
      message: 'Merged manifest is invalid (alignment): Differences require exact-coordinate alignment; interpolation is not supported.',
    }])
  })

  it('validates every input and reports codec issues without throwing or returning a candidate', () => {
    const valid = canvas()
    const base: CanvasManifest = { ...valid, nodes: [note('duplicate'), note('duplicate')] }
    const local: CanvasManifest = { ...valid, updatedAt: 'not-an-ISO-date' }
    const remote: CanvasManifest = { ...valid, instances: [instance('instance-a', { currentScene: { kind: 'scene', digest: 'not-a-digest' } })] }
    expect(parseManifest(base).ok).toBe(false)
    expect(parseManifest(local).ok).toBe(false)
    expect(parseManifest(remote).ok).toBe(false)
    const conflicts = failure(mergeManifests(base, local, remote))
    expect(conflicts).toHaveLength(3)
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/base/nodes/1', kind: 'invalid-reference' }),
      expect.objectContaining({ path: '/local/updatedAt', kind: 'invalid-reference', local: 'not-an-ISO-date' }),
      expect.objectContaining({ path: '/remote/instances/0/currentScene/digest', kind: 'invalid-reference', remote: 'not-a-digest' }),
    ]))
    expect(conflicts.every((entry) => entry.message.startsWith('Invalid '))).toBe(true)
  })

  it('rejects invalid input references before an otherwise matching merge can bypass validation', () => {
    const valid = canvas()
    const invalid: CanvasManifest = { ...valid, nodes: [note('note-a', { groupId: 'missing-group' })] }
    const conflicts = failure(mergeManifests(invalid, invalid, invalid))
    expect(conflicts.map((entry) => entry.path)).toEqual(['/base/nodes/0/groupId', '/local/nodes/0/groupId', '/remote/nodes/0/groupId'])
    expect(conflicts.every((entry) => entry.kind === 'invalid-reference')).toBe(true)
  })

  it('rejects non-JSON metadata without executing accessors', () => {
    let reads = 0
    const metadata: JsonObject = { get payload(): string { reads += 1; return 'Accessor value' } }
    const base = canvas()
    const local: CanvasManifest = { ...base, metadata }
    const conflicts = failure(mergeManifests(base, local, base))
    expect(reads).toBe(0)
    expect(conflicts).toEqual([{
      path: '/local/metadata/payload', kind: 'invalid-reference',
      message: 'Invalid local manifest (accessor): Accessor properties are not JSON data.',
    }])
  })

  it('returns conflicts for cyclic metadata rather than throwing', () => {
    const metadata: Record<string, JsonValue> = {}
    metadata.self = metadata
    const base = canvas()
    const local: CanvasManifest = { ...base, metadata }
    expect(failure(mergeManifests(base, local, base))).toEqual([{
      path: '/local/metadata/self', kind: 'invalid-reference',
      message: 'Invalid local manifest (cycle): Cyclic data cannot be serialized.',
    }])
  })

  it('requires all three canvas identities to match, even when both sides agree on a new ID', () => {
    const base = canvas()
    const other = canvas({ id: 'different-canvas' })
    expect(failure(mergeManifests(base, other, base))).toEqual([{
      path: '/id', kind: 'identity', base: base.id, local: other.id, remote: base.id,
      message: 'All three manifests must have the same canvas identity.',
    }])
    expect(failure(mergeManifests(base, other, other))).toEqual([{
      path: '/id', kind: 'identity', base: base.id, local: other.id, remote: other.id,
      message: 'All three manifests must have the same canvas identity.',
    }])
  })

  it('preserves immutable createdAt even for matching side changes', () => {
    const base = canvas()
    const changed = canvas({ createdAt: LATER, updatedAt: LATER })
    expect(failure(mergeManifests(base, changed, base))).toEqual([{
      path: '/createdAt', kind: 'identity', base: NOW, local: LATER, remote: NOW,
      message: 'Canvas createdAt is immutable across merge inputs.',
    }])
    expect(failure(mergeManifests(base, changed, changed))).toEqual([{
      path: '/createdAt', kind: 'identity', base: NOW, local: LATER, remote: LATER,
      message: 'Canvas createdAt is immutable across merge inputs.',
    }])
  })

  it('keeps originScene immutable for unilateral, identical and differing concurrent changes', () => {
    const i = instance('instance-a')
    const base = canvas({ instances: [i] })
    const changed = canvas({ instances: [{ ...i, originScene: SCENE_B }] })
    const differentlyChanged = canvas({ instances: [{ ...i, originScene: SCENE_C }] })
    for (const remote of [base, changed, differentlyChanged]) {
      const conflicts = failure(mergeManifests(base, changed, remote))
      expect(conflicts).toEqual([{
        path: '/instances/instance-a/originScene', kind: 'identity', base: SCENE_A, local: SCENE_B,
        remote: remote.instances[0]?.originScene,
        message: 'An existing instance cannot change its immutable origin scene; a different origin needs a new instance identity.',
      }])
    }
  })

  it('does not pair a new scene with a concurrent clock, build mode or edit revision', () => {
    const i = instance('instance-a', { clock: { time: 0, total: 10, running: false, rate: 1 } })
    const base = canvas({ instances: [i] })
    const local = canvas({ instances: [{ ...i, currentScene: SCENE_B, instanceEditRevision: 1 }] })
    const remote = canvas({ instances: [{ ...i, clock: { ...i.clock, time: 3 }, buildMode: 'inspect', instanceEditRevision: 1 }] })
    const conflicts = failure(mergeManifests(base, local, remote))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      path: '/instances/instance-a', kind: 'value',
      base: { currentScene: SCENE_A, clock: i.clock, instanceEditRevision: 0, buildMode: 'construct' },
      local: { currentScene: SCENE_B, clock: i.clock, instanceEditRevision: 1, buildMode: 'construct' },
      remote: { currentScene: SCENE_A, clock: { ...i.clock, time: 3 }, instanceEditRevision: 1, buildMode: 'inspect' },
    })
    expect(conflicts[0]?.message).toContain('cannot split currentScene')
  })

  it('keeps clock edits atomic even when different clock fields changed', () => {
    const i = instance('instance-a', { clock: { time: 0, total: 10, running: false, rate: 1 } })
    const base = canvas({ instances: [i] })
    const local = canvas({ instances: [{ ...i, clock: { ...i.clock, time: 2 } }] })
    const remote = canvas({ instances: [{ ...i, clock: { ...i.clock, rate: 2 } }] })
    expect(failure(mergeManifests(base, local, remote))).toEqual([expect.objectContaining({ path: '/instances/instance-a', kind: 'value' })])
  })

  it('keeps source/domain and release identity attached to the instance edit bundle', () => {
    const i = instance('instance-a')
    const base = canvas({ instances: [i] })
    const local = canvas({ instances: [{ ...i, currentScene: SCENE_B, instanceEditRevision: 1 }] })
    const remote = canvas({ instances: [{
      ...i, domain: 'electric', source: { kind: 'template', id: 'electric-template' },
      templateId: 'electric-template', templateRelease: { id: 'electric-template', version: '1.0.0' },
    }] })
    const conflicts = failure(mergeManifests(base, local, remote))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      path: '/instances/instance-a', kind: 'identity',
      local: { currentScene: SCENE_B, domain: 'mechanics', source: { kind: 'free-build' } },
      remote: { currentScene: SCENE_A, domain: 'electric', source: { kind: 'template', id: 'electric-template' } },
    })
  })

  it('accepts an unopposed complete instance edit with independent metadata edits', () => {
    const i = instance('instance-a', { metadata: { left: false, right: false } })
    const base = canvas({ instances: [i] })
    const edited = {
      ...i, currentScene: SCENE_B, buildMode: 'inspect', instanceEditRevision: 1,
      clock: { time: 2, total: 10, running: false, rate: 1 },
      source: { kind: 'import', id: 'source-a' },
    } satisfies ExperimentInstance
    const local = canvas({ instances: [{ ...edited, metadata: { left: true, right: false } }] })
    const remote = canvas({ instances: [{ ...i, metadata: { left: false, right: true } }] })
    expect(success(mergeManifests(base, local, remote)).instances[0]).toEqual({ ...edited, metadata: { left: true, right: true } })
  })

  it('accepts matching concurrent instance edit bundles and merges disjoint metadata', () => {
    const i = instance('instance-a', { metadata: { left: false, right: false } })
    const base = canvas({ instances: [i] })
    const edited = { ...i, currentScene: SCENE_B, instanceEditRevision: 1, clock: { time: 2, total: 10, running: false, rate: 1 } }
    const local = canvas({ instances: [{ ...edited, metadata: { left: true, right: false } }] })
    const remote = canvas({ instances: [{ ...edited, metadata: { left: false, right: true } }] })
    expect(success(mergeManifests(base, local, remote)).instances[0]).toEqual({ ...edited, metadata: { left: true, right: true } })
  })

  it('merges optional JSON metadata by key without interpreting arbitrary refs or IDs', () => {
    const refs: JsonObject = {
      kind: 'scene', digest: 'not-a-protocol-digest', groupId: 'missing-group', instanceId: 'missing-instance',
      snapshotAliasId: 'missing-alias', dataset: { kind: 'dataset', digest: 'also-not-a-digest' },
    }
    const base = canvas({ metadata: { extension: { untouched: refs, left: 0, right: 0 }, 'a/b~c': null } })
    const local = canvas({ metadata: { extension: { untouched: refs, left: 1, right: 0 }, 'a/b~c': null, localOnly: [null, false, { id: 'raw' }] } })
    const remote = canvas({ metadata: { extension: { untouched: refs, left: 0, right: 2 }, 'a/b~c': null, remoteOnly: { nested: true } } })
    expect(success(mergeManifests(base, local, remote)).metadata).toEqual({
      extension: { untouched: refs, left: 1, right: 2 }, 'a/b~c': null,
      localOnly: [null, false, { id: 'raw' }], remoteOnly: { nested: true },
    })
  })

  it('merges concurrent additions of optional metadata objects at disjoint keys', () => {
    const base = canvas()
    const local = canvas({ metadata: { extension: { local: 1 } } })
    const remote = canvas({ metadata: { extension: { remote: 2 } } })
    expect(success(mergeManifests(base, local, remote)).metadata).toEqual({ extension: { local: 1, remote: 2 } })
  })

  it('treats arrays inside metadata atomically even when their entries have IDs', () => {
    const baseValues = [{ id: 'a', text: 'Original A' }, { id: 'b', text: 'Original B' }]
    const localValues = [{ id: 'a', text: 'Local A' }, { id: 'b', text: 'Original B' }]
    const remoteValues = [{ id: 'a', text: 'Original A' }, { id: 'b', text: 'Remote B' }]
    const base = canvas({ metadata: { 'a/b~c': baseValues } })
    const local = canvas({ metadata: { 'a/b~c': localValues } })
    const remote = canvas({ metadata: { 'a/b~c': remoteValues } })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/metadata/a~1b~0c', kind: 'value', base: baseValues, local: localValues, remote: remoteValues,
      message: 'Concurrent array changes require a choice; arrays are atomic outside contract-owned entity collections.',
    }])
  })

  it('distinguishes JSON null from absence when merging metadata deletions', () => {
    const base = canvas({ metadata: { removed: null, kept: true } })
    const local = canvas({ metadata: { kept: true } })
    const remote = canvas({ metadata: { removed: null, kept: true, added: false } })
    expect(success(mergeManifests(base, local, remote)).metadata).toEqual({ kept: true, added: false })
  })

  it('does not merge conflicting content-addressed history references', () => {
    const base = canvas()
    const local = canvas({ history: HISTORY_A })
    const remote = canvas({ history: HISTORY_B })
    expect(failure(mergeManifests(base, local, remote))).toEqual([{
      path: '/history', kind: 'value', local: HISTORY_A, remote: HISTORY_B,
      message: 'Concurrent edits changed the same value differently.',
    }])
  })

  it('chooses the latest valid updatedAt without treating it as content authority', () => {
    const base = canvas({ updatedAt: LATER })
    const local = canvas({ updatedAt: LATEST })
    const remote = canvas({ title: 'Remote title', updatedAt: NOW })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.title).toBe('Remote title')
    expect(merged.updatedAt).toBe(LATEST)
    expect(merged.createdAt).toBe(NOW)
  })

  it('does not regress updatedAt on an otherwise no-op merge', () => {
    const base = canvas({ updatedAt: LATEST })
    const local = canvas({ updatedAt: NOW })
    const remote = canvas({ updatedAt: LATER })
    expect(success(mergeManifests(base, local, remote))).toEqual(base)
  })

  it('uses deterministic existing timestamp spelling for equivalent latest instants', () => {
    const base = canvas()
    const local = canvas({ updatedAt: '2026-11-08T01:00:00Z' })
    const remote = canvas({ updatedAt: LATER })
    const merged = success(mergeManifests(base, local, remote))
    expect(merged.updatedAt).toBe(LATER)
    expect(success(mergeManifests(base, remote, local))).toEqual(merged)
  })

  it('does not mutate or freeze caller-owned inputs and detaches nested output data', () => {
    const n = note('note-a')
    const base = canvas({ nodes: [n] })
    const sourceLayout = { ...n.layout, x: 12 }
    const sourceMetadata = { extension: { values: [1, 2] } }
    const sourceNode: NoteNode = { ...n, layout: sourceLayout, metadata: sourceMetadata }
    const local: CanvasManifest = { ...base, nodes: [sourceNode], metadata: sourceMetadata }
    const remote: CanvasManifest = { ...base, nodes: [{ ...n, body: 'Remote text' }] }
    const before = canonicalStringify([base, local, remote])
    const merged = success(mergeManifests(base, local, remote))
    expect(canonicalStringify([base, local, remote])).toBe(before)
    expect(Object.isFrozen(local)).toBe(false)
    expect(Object.isFrozen(sourceNode)).toBe(false)
    expect(Object.isFrozen(sourceLayout)).toBe(false)
    expect(Object.isFrozen(sourceMetadata.extension.values)).toBe(false)
    expect(merged.nodes[0]).not.toBe(sourceNode)
    expect(merged.nodes[0]?.layout).not.toBe(sourceLayout)
    expect(merged.nodes[0]?.metadata).not.toBe(sourceMetadata)
    sourceLayout.x = 999
    sourceMetadata.extension.values.push(3)
    expect(merged.nodes[0]?.layout.x).toBe(12)
    expect(merged.metadata).toEqual({ extension: { values: [1, 2] } })
    expect(merged.nodes[0]?.metadata).toEqual({ extension: { values: [1, 2] } })
  })

  it('also detaches conflict payloads without freezing their source entities', () => {
    const base = canvas()
    const localNode = note('shared', { metadata: { values: [1] } })
    const remoteNode = note('shared', { body: 'Remote addition' })
    const local: CanvasManifest = { ...base, nodes: [localNode] }
    const remote: CanvasManifest = { ...base, nodes: [remoteNode] }
    const before = canonicalStringify([local, remote])
    const conflicts = failure(mergeManifests(base, local, remote))
    expect(canonicalStringify([local, remote])).toBe(before)
    expect(conflicts[0]?.local).toEqual(localNode)
    expect(conflicts[0]?.local).not.toBe(localNode)
    expect(Object.isFrozen(conflicts)).toBe(true)
    expect(Object.isFrozen(conflicts[0]?.local)).toBe(true)
    expect(Object.isFrozen(localNode)).toBe(false)
    expect(Object.isFrozen(remoteNode)).toBe(false)
  })
})
