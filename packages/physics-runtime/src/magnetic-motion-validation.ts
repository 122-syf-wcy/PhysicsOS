import { MagneticEngine, MAGNETIC_MODEL_ID, createMagneticSimulationRequest } from '@physicsos/engine-magnetic'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { canonicalValue } from '@physicsos/physics-units'
import { verifyMagneticScene } from '@physicsos/physics-verifier'

/** The single registered circular-motion apparatus, never a general magnetic waiver. */
export function prepareMagneticMotionValidation(scene: PhysicsScene, experimentId: string) {
  if (experimentId !== 'magnetic-circular' || scene.dimension !== '2d'
    || [scene.bodies, scene.forces, scene.regions, scene.boundaries, scene.constraints, scene.circuits,
      scene.opticalBenches, scene.acousticBenches, scene.fluidTanks, scene.thermalBenches, scene.leverBenches,
      scene.inductionBenches, scene.waveBenches, scene.cyclotronBenches, scene.modernPhysicsBenches,
      scene.pressureBenches, scene.currentBenches, scene.energyBenches, scene.lightBenches,
      scene.transformerBenches, scene.thermometerBenches, scene.noiseBenches]
      .some(collection => (collection?.length ?? 0) > 0)) return undefined
  try {
    const engine = new MagneticEngine()
    const support = engine.canHandle(scene)
    if (engine.engineId !== 'engine-magnetic' || engine.engineVersion !== '1.0.0'
      || !support.supported || support.modelId !== MAGNETIC_MODEL_ID
      || scene.particles.length !== 1 || scene.fields.length !== 1
      || !(canonicalValue(scene.particles[0]!.mass) > 0)) return undefined
    const request = createMagneticSimulationRequest(scene, 'magnetic-motion-validation', 'magnetic-motion-validation')
    const plan = engine.prepareSimulationPlan(scene, request)
    if (plan.modelId !== MAGNETIC_MODEL_ID || plan.engineId !== engine.engineId || plan.engineVersion !== engine.engineVersion
      || plan.startTime !== 0 || !Number.isFinite(plan.endTime) || !(plan.endTime > 0)) return undefined
    const result = engine.simulate(scene, request)
    const verification = verifyMagneticScene(scene, result, { request })
    if (verification.status !== 'passed' || verification.checks.length === 0
      || !verification.checks.every(check => check.passed)) return undefined
    return { engine, request, plan, result: { ...result, verification } }
  } catch {
    return undefined
  }
}
