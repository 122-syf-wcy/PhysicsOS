import { isCircuitScene, isCompositeFieldScene, type PhysicsScene } from '@physicsos/physics-scene'

export type SupportedSceneDomain = 'magnetic' | 'mechanics' | 'electric' | 'circuit' | 'composite'
export type SceneDomain = SupportedSceneDomain | 'unsupported'

export const domainOfScene = (scene: PhysicsScene): SceneDomain => {
  /* A circuit scene carries no motion objects at all, so it must be classified
     before the body/particle branches (which would all fall through to
     'unsupported' — a blank surface rather than an error). */
  if (isCircuitScene(scene)) return 'circuit'
  const pointChargeFields = scene.fields.filter(field => field.type === 'point_charge')
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
  /* Composite must be tested before the single-field branches. Each of those
     requires the other field kinds to be absent, so a crossed-field scene would
     fall past all of them to 'unsupported' — and an unsupported domain does not
     mount a workspace at all, which is a blank surface rather than an error. */
  if (isCompositeFieldScene(scene)) return 'composite'
  /* A point-charge scene: particles with point-charge fields, no bodies, no
     other field type. Classified as electric so the Lab mounts it. */
  if (
    scene.particles.length > 0 &&
    scene.bodies.length === 0 &&
    pointChargeFields.length > 0 &&
    electricFields.length === 0 &&
    magneticFields.length === 0 &&
    gravityFields.length === 0
  ) {
    return 'electric'
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
