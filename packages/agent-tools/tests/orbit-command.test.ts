import { describe, expect, it } from 'vitest'
import { createMechanicsScene, createSceneCommand, SceneRuntime, type SceneCommandPayloadMap } from '@physicsos/physics-scene'
import { resolveMechanicsModel } from '@physicsos/engine-mechanics'
import { COMMAND_TYPES, commandReferenceText, normalizeCommandPayload } from '../src/scene-commands.ts'

describe('model-facing circular orbit command', () => {
  it('advertises and normalizes an SI radius command that the real scene runtime applies', () => {
    expect(COMMAND_TYPES).toContain('SetOrbitRadius')
    expect(commandReferenceText()).toContain('SetOrbitRadius')
    const payload = normalizeCommandPayload('SetOrbitRadius', { observableId: 'obs-orbit', radius: 8 })
    expect(payload).toEqual({ observableId: 'obs-orbit', radius: 8 })
    const scene = createMechanicsScene({ model: 'circular_orbit', gravitationalParameter: 32, orbitRadius: 2 })
    const runtime = new SceneRuntime(scene)
    const result = runtime.execute(createSceneCommand({ commandId: 'orbit-command', sceneId: String(scene.id),
      expectedRevision: scene.revision, type: 'SetOrbitRadius', payload: payload as SceneCommandPayloadMap['SetOrbitRadius'], traceId: 'orbit-command-trace' }))
    expect(result.ok).toBe(true)
    const model = resolveMechanicsModel(runtime.getScene())
    if (model.modelId !== 'circular_orbit') throw new Error('Expected circular model')
    expect(model.radius).toBe(8)
    expect(model.speed).toBe(2)
    expect(model.gravitationalParameter).toBe(32)
  })

  it('rejects malformed radius payloads before committing a command', () => {
    for (const radius of ['8', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => normalizeCommandPayload('SetOrbitRadius', { observableId: 'obs-orbit', radius })).toThrow(/radius/)
    }
  })
})
