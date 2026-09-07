import { describe, expect, it } from 'vitest'
import { createMagneticScene, createMechanicsScene } from '@physicsos/physics-scene'

import {
  createAgentSceneSync,
  readAgentScenesProjection,
  type AgentSceneRef,
} from '../src/client/physics/agent-scene-sync.ts'

/**
 * The agent → Lab mirror over the `physicsScenes` projection: baselines adopt
 * silently, live revisions open the Lab, re-deliveries are no-ops, and nothing
 * malformed ever reaches the surface store.
 */

const snapshotOf = (sceneId: string, revision: number, scene = createMagneticScene({ sceneId, revision })) =>
  JSON.parse(JSON.stringify({
    sceneId,
    revision,
    domain: 'magnetic',
    engineId: 'engine-magnetic',
    title: scene.metadata.title,
    cause: revision === 0 ? 'created' : 'command',
    scene,
  })) as unknown

const projection = (latest: string | null, ...snapshots: unknown[]) => ({
  latest,
  scenes: Object.fromEntries(snapshots.map(entry => [(entry as { sceneId: string }).sceneId, entry])),
})

function harness() {
  const adopted: AgentSceneRef[] = []
  const shown: AgentSceneRef[] = []
  const sync = createAgentSceneSync({
    adoptScene: (ref) => { adopted.push(ref) },
    showScene: (ref) => { shown.push(ref) },
  })
  return { sync, adopted, shown }
}

describe('readAgentScenesProjection', () => {
  it('accepts the host fold and rejects headers that disagree with the embedded scene', () => {
    const good = readAgentScenesProjection(projection('s1', snapshotOf('s1', 0)))
    expect(good?.latest).toBe('s1')
    expect(good?.scenes['s1']?.scene.revision).toBe(0)

    expect(readAgentScenesProjection(undefined)).toBeUndefined()
    expect(readAgentScenesProjection({ latest: 's1' })).toBeUndefined()
    const mismatched = snapshotOf('s1', 0) as { revision: number }
    mismatched.revision = 3
    expect(readAgentScenesProjection(projection('s1', mismatched))).toBeUndefined()
    const wrongSchema = snapshotOf('s1', 0) as { scene: { schemaVersion: string } }
    wrongSchema.scene.schemaVersion = 'physics-scene/0.9'
    expect(readAgentScenesProjection(projection('s1', wrongSchema))).toBeUndefined()
  })
})

describe('createAgentSceneSync', () => {
  it('adopts the first value of a session silently and shows later revisions in the Lab', () => {
    const { sync, adopted, shown } = harness()
    expect(sync.apply('session-a', projection('s1', snapshotOf('s1', 0)))).toBe('adopted')
    expect(adopted.map(ref => ref.sceneId)).toEqual(['s1'])
    expect(shown).toHaveLength(0)

    expect(sync.apply('session-a', projection('s1', snapshotOf('s1', 1)))).toBe('shown')
    expect(shown.map(ref => `${ref.sceneId}@${ref.scene.revision}`)).toEqual(['s1@1'])

    /* A second scene the agent opened becomes the one the Lab shows. */
    expect(sync.apply('session-a', projection('s2', snapshotOf('s1', 1), snapshotOf('s2', 0)))).toBe('shown')
    expect(shown.at(-1)?.sceneId).toBe('s2')
  })

  it('treats re-deliveries and unrelated rebuilds as no-ops', () => {
    const { sync, adopted, shown } = harness()
    const value = projection('s1', snapshotOf('s1', 0))
    sync.apply('session-a', value)
    expect(sync.apply('session-a', value)).toBe('unchanged')
    expect(sync.apply('session-a', JSON.parse(JSON.stringify(value)))).toBe('unchanged')
    expect(adopted).toHaveLength(1)
    expect(shown).toHaveLength(0)
  })

  it('keeps one baseline per session, so switching sessions adopts rather than shows', () => {
    const { sync, adopted, shown } = harness()
    sync.apply('session-a', projection('s1', snapshotOf('s1', 0)))
    expect(sync.apply('session-b', projection('s9', snapshotOf('s9', 0)))).toBe('adopted')
    expect(sync.apply('session-a', projection('s1', snapshotOf('s1', 0)))).toBe('unchanged')
    expect(adopted.map(ref => ref.sceneId)).toEqual(['s1', 's9'])
    expect(shown).toHaveLength(0)
  })

  it('reports absence while no session is current or the capability is absent', () => {
    const { sync, adopted, shown } = harness()
    const noSession: string | undefined = undefined
    expect(sync.apply(noSession, projection('s1', snapshotOf('s1', 0)))).toBe('absent')
    expect(sync.apply('session-a', undefined)).toBe('absent')
    expect(sync.apply('session-a', { latest: null, scenes: {} })).toBe('absent')
    expect(adopted).toHaveLength(0)
    expect(shown).toHaveLength(0)
  })

  it('never mounts a scene the validator rejects, and does not retry it until the projection moves', () => {
    const { sync, adopted, shown } = harness()
    const broken = snapshotOf('s1', 0) as { scene: { particles: { mass: { value: number } }[] } }
    broken.scene.particles[0]!.mass.value = -1
    const value = projection('s1', broken)
    expect(sync.apply('session-a', value)).toBe('invalid')
    expect(sync.apply('session-a', value)).toBe('unchanged')
    expect(adopted).toHaveLength(0)
    expect(shown).toHaveLength(0)

    const mechanics = createMechanicsScene({ sceneId: 's1', revision: 1, model: 'projectile_motion', position: { x: 0, y: 20, z: 0 }, velocity: { x: 10, y: 0, z: 0 } })
    expect(sync.apply('session-a', projection('s1', snapshotOf('s1', 1, mechanics)))).toBe('shown')
    expect(shown[0]?.scene.bodies).toHaveLength(1)
  })
})
