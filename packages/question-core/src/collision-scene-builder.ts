/**
 * Builds the collision bench a `one_dimensional_collision` question describes.
 *
 * Two bodies on a level frictionless track, travelling toward each other (or
 * one at rest). Restitution travels on each body's material, which is where
 * the collision engine reads it — a scene cannot claim a restitution the
 * solver would ignore.
 */

import { createCollisionScene } from '@physicsos/physics-scene'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsSemanticIR } from './semantic-ir.ts'

export interface CollisionSceneOptions {
  readonly sceneId: string
  readonly questionId?: string
}

/**
 * Turn a collision IR into a scene the collision engine accepts.
 * @param ir - the parsed collision question.
 * @param options - scene identity.
 * @returns the built scene.
 */
export function buildCollisionSceneFromIR(
  ir: PhysicsSemanticIR,
  options: CollisionSceneOptions,
): { scene: PhysicsScene } {
  const bodies = ir.collisionBodies ?? []
  if (bodies.length < 2) {
    throw new Error('collision scene needs two bodies')
  }
  /* No default: the parser records an unstated collision type as an error,
     and building a bench at e = 0 would answer a question the stem never
     asked. Reaching here without a value means the pipeline skipped that
     check, so refuse loudly. */
  const restitution = ir.collisionRestitution
  if (restitution === undefined) {
    throw new Error('collision scene needs a stated restitution')
  }

  /* Body A starts behind B so B can meet it: a bench where B is at rest has A
     approaching from the left, which is the arrangement every stem describes.
     +6 m separation leaves room for the approach at any realistic speed. */
  const scene = createCollisionScene({
    sceneId: options.sceneId,
    ...(options.questionId === undefined ? {} : { sourceQuestionId: options.questionId }),
    title: '一维碰撞',
    description: '光滑水平面上的两体碰撞',
    gravity: [0, 0],
    bodies: [
      { id: 'body_a', mass: bodies[0]!.mass, position: [-3, 0], velocity: [bodies[0]!.velocity, 0], restitution },
      { id: 'body_b', mass: bodies[1]!.mass, position: [3, 0], velocity: [bodies[1]!.velocity, 0], restitution },
    ],
  })
  return { scene }
}
