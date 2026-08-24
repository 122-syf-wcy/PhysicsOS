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
  verifyPointChargeScene,
  verifyPointChargeSimulation,
} from './electric-verifier.ts'
export {
  COMPOSITE_BALANCE_TOLERANCE,
  COMPOSITE_VERIFIER_ASSUMPTIONS,
  isCompositeVerifiableScene,
  reportCompositeSelection,
  verifyCompositeApparatus,
  type CompositeSelectionReport,
} from './composite-verifier.ts'
