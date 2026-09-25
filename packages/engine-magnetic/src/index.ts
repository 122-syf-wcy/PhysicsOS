// @physicsos/engine-magnetic
// Domain source is implemented file by file; this barrel re-exports the public surface.
//
// Two models live here, both magnetic and neither one a special case of the
// other: the Lorentz force on a moving charge in a field (a particle solver with
// a timeline), and the field a steady current makes (a static rig with no
// timeline). They are separate engine classes because a scene belongs to one or
// the other, never to both.
export {
  MAGNETIC_MODEL_ASSUMPTIONS,
  MAGNETIC_MODEL_ID,
  MagneticEngine,
  createMagneticSimulationRequest,
} from './magnetic-engine.ts'
export {
  resolveCurrentModel,
  type ResolvedCurrentModel,
  type ResolvedElectromagnet,
  type ResolvedMotor,
  type ResolvedSolenoid,
  type ResolvedStraightWire,
} from './current-model.ts'
export {
  CURRENT_RELATIVE_TOLERANCE,
  VACUUM_PERMEABILITY,
  ampereForceOnSide,
  circulationOf,
  coilAreaOf,
  coreFieldMagnitude,
  currentFieldMagnitudeOf,
  electromagnetFieldOf,
  finiteSegmentFieldMagnitude,
  motorReadingOf,
  motorTorqueAt,
  northPoleOf,
  poleFacePull,
  solenoidEndFieldMagnitude,
  solenoidFieldMagnitude,
  solenoidFieldOf,
  straightWireFieldMagnitude,
  straightWireFieldOf,
  turnDensityOf,
  type Circulation,
  type ElectromagnetReading,
  type MotorReading,
  type SolenoidFieldReading,
  type StraightWireFieldReading,
} from './current.ts'
export {
  CURRENT_ENGINE_ID,
  CURRENT_ENGINE_VERSION,
  CurrentFieldEngine,
  ELECTROMAGNET_MODEL,
  MOTOR_MODEL,
  SOLENOID_FIELD_MODEL,
  STRAIGHT_WIRE_FIELD_MODEL,
  createCurrentSimulationRequest,
  currentFieldEngine,
  resolveCurrent,
} from './current-engine.ts'
