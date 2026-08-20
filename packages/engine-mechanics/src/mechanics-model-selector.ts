import type { PhysicsScene } from '@physicsos/physics-scene'
import type { MechanicsModelId } from '@physicsos/physics-scene'
import type { MechanicsModel } from './models/types.ts'
import {
  resolveUniformLinearModel,
  resolveUniformlyAcceleratedModel,
  resolveProjectileModel,
  resolveNewtonSecondLawModel,
  resolveInclinedPlaneModel,
} from './models/model-resolvers.ts'

export function detectMechanicsModel(scene: PhysicsScene): MechanicsModelId | null {
  const title = scene.metadata.title ?? ''
  const desc = scene.metadata.description ?? ''
  const combined = title + ' ' + desc

  if (/uniform_linear|匀速直线/.test(combined)) return 'uniform_linear_motion'
  if (/uniformly_accelerated|匀变速|匀加速/.test(combined)) return 'uniformly_accelerated_motion'
  if (/projectile|平抛|斜抛|抛体/.test(combined)) return 'projectile_motion'
  if (/newton|牛顿/.test(combined)) return 'newton_second_law'
  if (/incline|斜面/.test(combined)) return 'inclined_plane'

  if (scene.observableDefinitions.some((o) => o.parameters?.['kind'] === 'ground')) return 'projectile_motion'
  if (scene.observableDefinitions.some((o) => o.parameters?.['kind'] === 'incline')) return 'inclined_plane'

  if (scene.forces.some((f) => f.type === 'friction')) return 'inclined_plane'
  if (scene.forces.some((f) => f.type === 'custom')) return 'newton_second_law'
  if (scene.fields.some((f) => f.type === 'uniform_gravity')) return 'projectile_motion'

  const body = scene.bodies[0]
  if (body?.acceleration) return 'uniformly_accelerated_motion'

  return 'uniform_linear_motion'
}

export function resolveMechanicsModel(scene: PhysicsScene): MechanicsModel {
  const modelId = detectMechanicsModel(scene)
  switch (modelId) {
    case 'uniform_linear_motion':
      return resolveUniformLinearModel(scene)
    case 'uniformly_accelerated_motion':
      return resolveUniformlyAcceleratedModel(scene)
    case 'projectile_motion':
      return resolveProjectileModel(scene)
    case 'newton_second_law':
      return resolveNewtonSecondLawModel(scene)
    case 'inclined_plane':
      return resolveInclinedPlaneModel(scene)
    default:
      return resolveUniformLinearModel(scene)
  }
}
