import type { PhysicsScene } from '@physicsos/physics-scene'

export type CollisionModelId =
  | 'elastic_collision'
  | 'inelastic_collision'
  | 'perfectly_inelastic_collision'

/**
 * The collision model a scene's bodies collectively define.
 *
 * The coefficient of restitution of a collision pair is the minimum of the two
 * bodies' restitution values (the more lossy body dominates, exactly as a soft
 * body meeting a hard one loses energy). When every pair is fully elastic the
 * model is `elastic_collision`; when every pair is fully lossy it is
 * `perfectly_inelastic_collision`; a mixture is `inelastic_collision`.
 */
export const collisionModelOf = (scene: PhysicsScene): CollisionModelId | null => {
  if (scene.bodies.length < 2) return null
  let allElastic = true
  let allInelastic = true
  for (const body of scene.bodies) {
    const restitution = body.material?.restitution === undefined ? 1 : body.material.restitution
    if (restitution !== 1) allElastic = false
    if (restitution !== 0) allInelastic = false
  }
  if (allElastic) return 'elastic_collision'
  if (allInelastic) return 'perfectly_inelastic_collision'
  return 'inelastic_collision'
}

export const detectCollisionModel = (scene: PhysicsScene): CollisionModelId | null =>
  collisionModelOf(scene)

export const COLLISION_MODEL_LABELS: Readonly<Record<CollisionModelId, string>> = {
  elastic_collision: '弹性碰撞',
  inelastic_collision: '非弹性碰撞',
  perfectly_inelastic_collision: '完全非弹性碰撞',
}