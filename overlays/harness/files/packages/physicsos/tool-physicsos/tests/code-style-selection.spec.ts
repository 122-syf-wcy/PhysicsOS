import { describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { codeStyleFor } from '../src/code-style-selection.ts'
import type { PhysicsSceneSnapshot } from '../src/types.ts'

/** These are the production projectile factory's real QuantityVector values. */
function projectile(speed: number, angle: 0 | 90 | -90, semanticModel = true): PhysicsSceneSnapshot {
  const scene = createMechanicsScene({ sceneId: `question-projectile-${angle}`, model: 'projectile_motion', mass: 1, launchAngle: angle,
    velocity: angle === 0 ? { x: speed, y: 0, z: 0 } : { x: 0, y: angle === 90 ? speed : -speed, z: 0 },
    position: { x: 0, y: 20, z: 0 }, now: '2026-11-04T00:00:00Z', title: '本题抛体运动',
  })
  return { sceneId: String(scene.id), revision: scene.revision, domain: 'mechanics', engineId: 'engine-mechanics', title: '本题抛体运动', cause: 'solved',
    ...(semanticModel ? { model: 'projectile_motion' } : {}), scene: scene as unknown as JsonValue }
}
describe('question projectile style selection', () => {
  it.each([[90, 'projectile-oblique'], [0, 'projectile-horizontal'], [-90, 'projectile-oblique']] as const)(
    'uses the factory velocity vector for a 20 m/s launch at %s degrees', (angle, expected) => {
      const snapshot = projectile(20, angle)
      const before = JSON.stringify(snapshot.scene)
      expect(codeStyleFor(snapshot)).toBe(expected)
      expect(JSON.stringify(snapshot.scene)).toBe(before)
    },
  )
  it('recovers an old vertical-throw scene without a stored semantic model', () => {
    expect(codeStyleFor(projectile(20, 90, false))).toBe('projectile-oblique')
  })
})
