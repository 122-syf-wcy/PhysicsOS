import type { PhysicsScene } from '@physicsos/physics-scene'

export type SupportedSceneDomain = 'magnetic' | 'mechanics' | 'electric'
export type SceneDomain = SupportedSceneDomain | 'unsupported'

export const domainOfScene = (scene: PhysicsScene): SceneDomain => {
  const electricFields = scene.fields.filter(field => field.type === 'uniform_electric')
  const magneticFields = scene.fields.filter(field => field.type === 'uniform_magnetic')
  const gravityFields = scene.fields.filter(field => field.type === 'uniform_gravity')

  if (
    scene.bodies.length > 0 &&
    scene.particles.length === 0 &&
    electricFields.length === 0 &&
    magneticFields.length === 0
  ) {
    return 'mechanics'
  }
  if (
    scene.particles.length > 0 &&
    scene.bodies.length === 0 &&
    electricFields.length > 0 &&
    magneticFields.length === 0 &&
    gravityFields.length === 0
  ) {
    return 'electric'
  }
  if (
    scene.particles.length > 0 &&
    scene.bodies.length === 0 &&
    magneticFields.length > 0 &&
    electricFields.length === 0 &&
    gravityFields.length === 0
  ) {
    return 'magnetic'
  }
  return 'unsupported'
}
