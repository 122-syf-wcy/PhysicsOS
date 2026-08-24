import { describe, expect, it } from 'vitest'

import { createMechanicsScene } from '../src/mechanics-scene-factory.ts'
import { forkExperimentalScene, isExperimentalBranch } from '../src/scene-branch.ts'
import { SceneRuntime } from '../src/scene-runtime.ts'
import { createSceneCommand } from '../src/magnetic-scene-factory.ts'
import { asQuestionId } from '@physicsos/shared'

const questionScene = () => {
  const scene = createMechanicsScene({
    sceneId: 'scene-question-001',
    model: 'projectile_motion',
    mass: 1,
    position: { x: 0, y: 20, z: 0 },
    velocity: { x: 10, y: 0, z: 0 },
    gravity: { x: 0, y: -10, z: 0 },
    groundY: 0,
    title: '平抛运动',
    now: '2026-01-01T00:00:00.000Z',
  })
  return {
    ...scene,
    revision: 4,
    metadata: { ...scene.metadata, sourceQuestionId: asQuestionId('golden-mech-02') },
  }
}

describe('forkExperimentalScene', () => {
  it('starts a new world instead of advancing the question revision', () => {
    const origin = questionScene()
    const branch = forkExperimentalScene({
      scene: origin,
      sceneId: 'scene-experiment-1',
      now: '2026-01-02T00:00:00.000Z',
    })

    expect(String(branch.id)).toBe('scene-experiment-1')
    /* A branch is a different scene, so reusing the parent's revision number
       would make two worlds claim the same version. */
    expect(branch.revision).toBe(0)
    expect(branch.metadata.lineage).toEqual({
      origin: 'question',
      branchType: 'experimental',
      originQuestionId: 'golden-mech-02',
      originSceneId: 'scene-question-001',
      parentSceneId: 'scene-question-001',
      parentRevision: 4,
      forkedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(isExperimentalBranch(branch)).toBe(true)
    expect(isExperimentalBranch(origin)).toBe(false)
  })

  it('leaves the question scene untouched when the branch is edited', () => {
    const origin = questionScene()
    const originalHeight = origin.bodies[0]?.position.vector.y
    const branch = forkExperimentalScene({ scene: origin, sceneId: 'scene-experiment-2' })

    const runtime = new SceneRuntime(branch)
    const result = runtime.execute(
      createSceneCommand({
        commandId: 'cmd-1',
        sceneId: String(branch.id),
        expectedRevision: branch.revision,
        type: 'SetBodyPosition',
        payload: {
          bodyId: branch.bodies[0]?.id ?? 'body-1',
          position: { vector: { x: 0, y: 30, z: 0 }, unit: 'm', dimension: 'length' },
        },
        traceId: 'trace-1',
      }),
    )

    expect(result.ok).toBe(true)
    const edited = runtime.getScene()
    expect(edited.bodies[0]?.position.vector.y).toBe(30)
    expect(edited.revision).toBe(1)

    /* The question's own facts must survive the experiment untouched: its solution
       was verified against 20 m and still describes 20 m. */
    expect(origin.bodies[0]?.position.vector.y).toBe(originalHeight)
    expect(origin.bodies[0]?.position.vector.y).toBe(20)
    expect(origin.revision).toBe(4)
    expect(String(edited.id)).not.toBe(String(origin.id))
    expect(String(edited.metadata.lineage?.originSceneId)).toBe('scene-question-001')
  })

  it('keeps pointing at the original when a branch is forked again', () => {
    const origin = questionScene()
    const first = forkExperimentalScene({ scene: origin, sceneId: 'branch-1' })
    const second = forkExperimentalScene({ scene: { ...first, revision: 3 }, sceneId: 'branch-2' })

    /* One hop back to the original, whatever the depth. */
    expect(String(second.metadata.lineage?.originSceneId)).toBe('scene-question-001')
    expect(String(second.metadata.lineage?.parentSceneId)).toBe('branch-1')
    expect(second.metadata.lineage?.parentRevision).toBe(3)
    expect(second.metadata.lineage?.originQuestionId).toBe('golden-mech-02')
  })

  it('records a template origin for a scene with no question behind it', () => {
    const template = createMechanicsScene({ model: 'inclined_plane', inclineAngle: 30 })
    const branch = forkExperimentalScene({ scene: template })
    expect(branch.metadata.lineage?.origin).toBe('template')
    expect(branch.metadata.lineage?.originQuestionId).toBeUndefined()
  })

  it('deep-copies scene bodies so a branch edit cannot reach the parent', () => {
    const origin = questionScene()
    const branch = forkExperimentalScene({ scene: origin })
    const body = branch.bodies[0]
    if (body === undefined) throw new Error('expected a body')
    body.position.vector.y = 999
    expect(origin.bodies[0]?.position.vector.y).toBe(20)
  })
})
