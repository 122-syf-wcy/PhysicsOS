import type { PhysicsScene } from '@physicsos/physics-scene'
import type { MechanicsModelId } from '@physicsos/physics-scene'
import type { MechanicsModel } from './models/types.ts'
import {
  resolveUniformLinearModel,
  resolveUniformlyAcceleratedModel,
  resolveProjectileModel,
  resolveNewtonSecondLawModel,
  resolveInclinedPlaneModel,
  resolveSpringOscillatorModel,
  resolveSimplePendulumModel,
  resolveHorizontalFrictionModel,
  resolveSpringStaticsModel,
} from './models/model-resolvers.ts'

export function detectMechanicsModel(scene: PhysicsScene): MechanicsModelId | null {
  const title = scene.metadata.title ?? ''
  const desc = scene.metadata.description ?? ''
  const combined = title + ' ' + desc

  // Physical-configuration signals first. These are unambiguous and do not
  // depend on whoever authored the scene title happening to name the model.
  //
  // The observable `kind` is set by the scene factory per model:
  //   - projectile_motion  → a `ground` geometry observable
  //   - inclined_plane     → an `incline` geometry observable
  // and the force list carries:
  //   - inclined_plane     → a `friction` force (only when μ > 0)
  //   - newton_second_law  → a `custom` applied force
  // while only uniformly_accelerated_motion is built with `body.acceleration`.
  //
  // Note: a `uniform_gravity` field is NOT a projectile discriminator here.
  // The mechanics scene factory attaches one to *every* mechanics scene, so
  // routing on it alone would classify every scene as projectile. The ground
  // observable is the real projectile signal; gravity merely confirms it.
  /* Connector constraints are unambiguous: a spring constraint means a spring
     rig (vertical springs are the statics Hooke bench, horizontal ones the
     oscillator), a rope constraint means a pendulum. */
  const spring = scene.constraints.find((c) => c.type === 'spring')
  if (spring !== undefined) {
    return spring.parameters['axis'] === 'vertical' ? 'spring_statics' : 'spring_oscillator'
  }
  if (scene.constraints.some((c) => c.type === 'rope')) return 'simple_pendulum'
  if (scene.observableDefinitions.some((o) => o.parameters?.['kind'] === 'friction_surface'))
    return 'horizontal_friction'

  if (scene.observableDefinitions.some((o) => o.parameters?.['kind'] === 'ground')) return 'projectile_motion'
  if (scene.observableDefinitions.some((o) => o.parameters?.['kind'] === 'incline')) return 'inclined_plane'
  if (scene.forces.some((f) => f.type === 'friction')) return 'inclined_plane'
  if (scene.forces.some((f) => f.type === 'custom')) return 'newton_second_law'

  const body = scene.bodies[0]
  if (body?.acceleration) return 'uniformly_accelerated_motion'

  // Title/description regex is the auxiliary disambiguator: it covers scenes
  // that carry no strong physical signal (e.g. a bare uniform_linear scene
  // whose factory set no acceleration, forces, or ground/incline observables)
  // and is the only way to tell uniform_linear apart from uniformly_accelerated
  // when neither has a strong signal.
  if (/uniform_linear|匀速直线/.test(combined)) return 'uniform_linear_motion'
  if (/uniformly_accelerated|匀变速|匀加速/.test(combined)) return 'uniformly_accelerated_motion'
  if (/projectile|平抛|斜抛|抛体/.test(combined)) return 'projectile_motion'
  if (/newton|牛顿/.test(combined)) return 'newton_second_law'
  if (/incline|斜面/.test(combined)) return 'inclined_plane'

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
    case 'spring_oscillator':
      return resolveSpringOscillatorModel(scene)
    case 'simple_pendulum':
      return resolveSimplePendulumModel(scene)
    case 'horizontal_friction':
      return resolveHorizontalFrictionModel(scene)
    case 'spring_statics':
      return resolveSpringStaticsModel(scene)
    default:
      return resolveUniformLinearModel(scene)
  }
}
