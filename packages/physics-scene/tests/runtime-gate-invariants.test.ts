/**
 * The SceneRuntime boundary invariants (D and E).
 *
 * The SceneRuntime's command gate is the ONLY way a scene changes and the ONLY
 * way a PhysicsEvent is born. These tests make that falsifiable: a presentation-
 * only interaction (a UI highlight) must produce neither, and a scene read must
 * not be a back door into the store.
 */
import { describe, expect, it } from 'vitest'

import {
  createMechanicsScene,
  createSceneCommand,
  SceneRuntime,
  type SceneCommand,
} from '../src/index.ts'

const mechanicsScene = (sceneId: string) =>
  createMechanicsScene({ model: 'uniform_linear_motion', sceneId })

/* ----------------------------------------- E: a highlight is not a physics event -- */

describe('invariant E — a UI-only highlight must not create a PhysicsEvent', () => {
  it('a forged highlight command is refused with no event and no revision bump', () => {
    const scene = mechanicsScene('scene-highlight')
    const runtime = new SceneRuntime(scene)
    /* `physics.ui.highlight` is view state. If it ever became a command type, this
       forged envelope would slip through `applyCommand` and emit an event. */
    const highlight = {
      schemaVersion: 'scene-command/1.0',
      commandId: 'cmd-highlight',
      sceneId: scene.id,
      expectedRevision: scene.revision,
      type: 'physics.ui.highlight',
      payload: { targetId: 'field-line' },
      actor: { type: 'user', id: 'ui' },
      trace: { traceId: 'trace-highlight' },
      issuedAt: new Date().toISOString(),
    } as unknown as SceneCommand

    const result = runtime.execute(highlight)

    expect(result.ok).toBe(false)
    expect(runtime.getEvents()).toHaveLength(0)
    expect(runtime.getScene().revision).toBe(scene.revision)
  })

  it('control: a real command does emit exactly one PhysicsEvent (the gate is not vacuous)', () => {
    const scene = mechanicsScene('scene-control')
    const runtime = new SceneRuntime(scene)
    const before = runtime.getScene().revision
    const result = runtime.execute(
      createSceneCommand({
        commandId: 'cmd-1',
        sceneId: String(scene.id),
        expectedRevision: before,
        type: 'SetBodyMass',
        payload: { bodyId: 'body-1', mass: { value: 2, unit: 'kg', dimension: 'mass' } },
        traceId: 'trace-1',
      }),
    )

    expect(result.ok).toBe(true)
    const events = runtime.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('BodyMassChanged')
    expect(runtime.getScene().revision).toBe(before + 1)
  })
})

/* -------------------------------- D: a scene read cannot bypass the command gate -- */

describe('invariant D — scene reads are copies, not a mutation path', () => {
  it('mutating a returned scene does not change the store', () => {
    const scene = mechanicsScene('scene-copy')
    const runtime = new SceneRuntime(scene)
    const read = runtime.getScene()
    const body = read.bodies[0]
    expect(body).toBeDefined()
    body!.mass = { value: 999, unit: 'kg', dimension: 'mass' }

    const reread = runtime.getScene()
    expect(reread.bodies[0]?.mass.value).not.toBe(999)
    expect(reread.revision).toBe(scene.revision)
    expect(runtime.getEvents()).toHaveLength(0)
  })
})
