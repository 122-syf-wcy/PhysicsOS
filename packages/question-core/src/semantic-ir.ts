import type { PhysicsDomain } from '@physicsos/physics-core'

export type MagneticModelId = 'charged_particle_uniform_magnetic_field'

export type ElectricModelId = 'charged_particle_uniform_electric_field'

export type MechanicsModelId =
  | 'uniform_linear_motion'
  | 'uniformly_accelerated_motion'
  | 'projectile_motion'
  | 'newton_second_law'
  | 'inclined_plane'

export type PhysicsModelId = MagneticModelId | ElectricModelId | MechanicsModelId

export type SemanticEntity =
  | 'particle'
  | 'electric_field'
  | 'magnetic_field'
  | 'body'
  | 'gravity_field'
  | 'incline'
  | 'ground'

export type SemanticTarget =
  | 'force'
  | 'radius'
  | 'period'
  | 'rotation_direction'
  | 'trajectory'
  | 'final_velocity'
  | 'displacement'
  | 'time'
  | 'acceleration'
  | 'range'
  | 'max_height'
  | 'flight_time'
  | 'normal_force'
  | 'friction_force'
  | 'net_force'
  | 'velocity'
  | 'electric_force'
  | 'electric_potential_change'
  | 'electric_potential_energy_change'
  | 'kinetic_energy'
  | 'kinetic_energy_change'
  | 'work_by_electric_field'

export type SemanticRelation =
  | 'velocity_perpendicular_B'
  | 'velocity_parallel_B'
  | 'constant_velocity'
  | 'constant_acceleration'
  | 'free_flight'
  | 'on_incline'
  | 'charged_particle_in_uniform_electric_field'
  | 'velocity_parallel_E'
  | 'velocity_perpendicular_E'

export type SemanticAssumption =
  | 'uniform_magnetic_field'
  | 'magnetic_force_only'
  | 'ignore_electric_field'
  | 'ignore_gravity'
  | 'no_air_resistance'
  | 'constant_force'
  | 'kinetic_friction'
  | 'static_friction_pending'
  | 'uniform_electric_field'
  | 'electric_force_only'
  | 'ignore_magnetic_field'

export type PlanarDirection = 'right' | 'left' | 'up' | 'down' | 'unknown'

export interface KnownValue {
  key: string
  label: string
  symbol: string
  value: number
  unit: string
  dimension: string
  displayValue?: string
}

export interface UnknownValue {
  key: string
  label: string
  symbol: string
}

export interface QuestionConstraint {
  type: string
  description: string
}

export interface PhysicsSemanticIR {
  schemaVersion: 'physics-ir/1.0'
  domain: PhysicsDomain
  model: PhysicsModelId
  entities: SemanticEntity[]
  knowns: KnownValue[]
  unknowns: UnknownValue[]
  constraints: QuestionConstraint[]
  relations: SemanticRelation[]
  targets: SemanticTarget[]
  assumptions: SemanticAssumption[]
  chargeSign: 'positive' | 'negative' | 'unknown'
  fieldDirection: 'into_page' | 'out_of_page' | 'unknown'
  velocityDirection: 'perpendicular_to_B' | 'parallel_to_B' | 'unknown'
  electricFieldDirection?: PlanarDirection
  initialVelocityDirection?: PlanarDirection
  inclineAngle?: number
  launchAngle?: number
  groundY?: number
  frictionCoefficient?: number
}

export type ValidationResultStatus =
  | 'VALID'
  | 'AMBIGUOUS'
  | 'INVALID_SEMANTICS'
  | 'UNSUPPORTED_MODEL'

export interface QuestionParseIssue {
  code: string
  message: string
  severity: 'warning' | 'error'
}

export interface QuestionAmbiguity {
  field: string
  message: string
  options: string[]
}

export interface SemanticValidationResult {
  status: ValidationResultStatus
  issues: QuestionParseIssue[]
  ambiguities: QuestionAmbiguity[]
}
