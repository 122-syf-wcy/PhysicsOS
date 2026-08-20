// @physicsos/physics-verifier
export {
  MAGNETIC_VERIFIER_ASSUMPTIONS,
  MagneticPhysicsVerifier,
  verify,
  verifyMagnetic,
  verifyMagneticResult,
  verifyMagneticScene,
  verifyMagneticSimulation,
  verifySimulationResult,
  type MagneticVerifierAssumption,
  type MagneticVerifierConfiguration,
  type MagneticVerifierOptions,
} from './magnetic-verifier.ts'

export { MagneticPhysicsVerifier as MagneticVerifier } from './magnetic-verifier.ts'
export {
  MECHANICS_VERIFIER_ASSUMPTIONS,
  verifyNewtonSecondLaw,
  verifyKinematicConsistency,
  verifyProjectileHorizontalVelocity,
  verifyProjectileVerticalAcceleration,
  verifyProjectileImpact,
  verifyInclineForceDecomposition,
  verifyMechanicsScene,
  verifyMechanicsSimulation,
} from './mechanics-verifier.ts'
export {
  ELECTRIC_VERIFIER_ASSUMPTIONS,
  verifyElectricScene,
  verifyElectricSimulation,
} from './electric-verifier.ts'
