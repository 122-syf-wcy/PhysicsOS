import {
  isAcousticsScene,
  isCircuitScene,
  isCompositeFieldScene,
  isCurrentScene,
  isEnergyScene,
  isFluidScene,
  isInductionScene,
  isLeverScene,
  isLightScene,
  isNoiseScene,
  isOpticsScene,
  isPressureScene,
  isThermalScene,
  isThermometerScene,
  isTransformerScene,
  isWaveScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

export type SupportedSceneDomain =
  | 'magnetic'
  | 'mechanics'
  | 'electric'
  | 'circuit'
  | 'composite'
  | 'optics'
  | 'acoustics'
  | 'fluid'
  | 'thermal'
  | 'induction'
  | 'wave'
export type SceneDomain = SupportedSceneDomain | 'unsupported'

export const domainOfScene = (scene: PhysicsScene): SceneDomain => {
  /* Circuit, optics, acoustics, fluid, thermal, induction, wave and lever scenes
     carry no motion objects at all, so they must be classified before the
     body/particle branches (which would all fall through to 'unsupported' — a
     blank surface rather than an error). The accessors are mutually exclusive:
     each one requires the other apparatus collections to be empty. */
  if (isCircuitScene(scene)) return 'circuit'
  if (isOpticsScene(scene)) return 'optics'
  /* The pinhole rig shares the optics shelf but has no bench of the imaging
     kind at all, so it would fall through to 'unsupported' — a blank surface. */
  if (isLightScene(scene)) return 'optics'
  if (isAcousticsScene(scene)) return 'acoustics'
  /* The noise rig shares the acoustics shelf but has no source and reflector pair
     to echo off, so it would fall through to 'unsupported' — a blank surface. */
  if (isNoiseScene(scene)) return 'acoustics'
  /* The pressure rigs share the fluid domain — same shelf, same canvas — but
     they are a different bench: a pressure scene has no tank at all, so the
     runtime that mounts it is chosen by the bench, not by the domain. Tested
     before `isFluidScene`, which requires exactly one tank. */
  if (isPressureScene(scene)) return 'fluid'
  if (isFluidScene(scene)) return 'fluid'
  /* A current-magnetic bench has no particles and no field objects either — the
     field is what the engine derives — so it would fall through every branch
     below to 'unsupported' and show a blank surface. It shares the magnetic
     shelf with the Lorentz scene, so the domain id is still 'magnetic'. */
  if (isCurrentScene(scene)) return 'magnetic'
  if (isThermalScene(scene)) return 'thermal'
  /* The thermometer is the thermal domain's second bench: it has no sample and
     no heater, so it would fall through to 'unsupported' — a blank surface. */
  if (isThermometerScene(scene)) return 'thermal'
  if (isInductionScene(scene)) return 'induction'
  /* The transformer shares the induction shelf but has no rod and no flux rate
     to state, so it would fall through to 'unsupported' — a blank surface. */
  if (isTransformerScene(scene)) return 'induction'
  if (isWaveScene(scene)) return 'wave'
  /* A lever has no particles or bodies — classifying it after the body branch
     would fall through to 'unsupported' and show a blank Lab. It stays in the
     mechanics picker group, so the domain id is still 'mechanics'. */
  if (isLeverScene(scene)) return 'mechanics'
  /* The energy rig is the mechanics domain's third bench: no bodies and no
     particles either, so it would fall through every branch below to
     'unsupported' and show a blank Lab. */
  if (isEnergyScene(scene)) return 'mechanics'
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
