import type { PhysicsDomain } from '@physicsos/physics-core'

export type MagneticModelId = 'charged_particle_uniform_magnetic_field'

export type ElectricModelId =
  | 'charged_particle_uniform_electric_field'
  | 'point_charge_electrostatic_field'
  | 'charged_particle_bounded_electric_field'

export type MechanicsModelId =
  | 'uniform_linear_motion'
  | 'uniformly_accelerated_motion'
  | 'projectile_motion'
  | 'newton_second_law'
  | 'inclined_plane'

/**
 * Composite-field models: a charged particle feeling more than one of
 * {electric, magnetic, gravity} at once, so the motion follows F = qE + qv×B + mg.
 * Each is a distinct apparatus, not a free parameter of one model, because each
 * poses a different question (what speed passes / what q/m ratio / what final
 * energy) and each needs its own solution narrative.
 */
export type CompositeModelId =
  | 'velocity_selector'
  | 'mass_spectrometer'
  | 'cyclotron'
  | 'charged_particle_composite_field'

export type PhysicsModelId =
  | MagneticModelId
  | ElectricModelId
  | MechanicsModelId
  | CompositeModelId

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
  | 'electric_field'
  | 'electric_field_direction'
  | 'electric_potential_change'
  | 'electric_potential_energy_change'
  | 'kinetic_energy'
  | 'kinetic_energy_change'
  | 'work_by_electric_field'
  | 'deflection'
  | 'plate_hit_time'
  | 'exit_velocity'
  /* Composite field apparatus targets. */
  | 'selected_velocity'
  | 'mass_charge_ratio'
  | 'cyclotron_frequency'
  | 'magnetic_force'
  | 'final_kinetic_energy'
  | 'acceleration_count'

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
  | 'point_charge_field'
  | 'multi_source_superposition'
  | 'charged_particle_in_bounded_electric_field'
  | 'particle_enters_field'
  | 'particle_exits_field'
  | 'particle_hits_plate'
  /* Composite field: the forces coexist rather than one being neglected. */
  | 'charged_particle_in_composite_field'
  | 'electric_magnetic_force_balance'
  | 'velocity_selection'
  | 'magnetic_deflection_after_selection'
  | 'alternating_acceleration'
  | 'particle_enters_region'
  | 'particle_exits_region'

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
  | 'static_point_charge'
  | 'vacuum_permittivity'
  | 'bounded_electric_field'
  | 'parallel_plate'
  /* Composite field: these REPLACE the mutually exclusive ignore_* assumptions.
     A composite scene must never carry `ignore_electric_field` or
     `ignore_magnetic_field` — those are what let a single-field engine claim the
     scene, which is exactly the misclassification this model exists to avoid. */
  | 'composite_field'
  | 'crossed_fields'
  | 'electric_and_magnetic_force'
  | 'gravity_included'

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
  /** Distance from a point-charge source at which E/F is sampled, in metres. */
  sourceDistance?: number
  /**
   * A directional sampling offset, present only when a point-charge question
   * describes the sample point with a direction ("距其左侧 15 cm") rather than a
   * bare distance. `distance` is the absolute value (metres); `axis`/`sign`
   * carry the direction so the scene builder places the probe off-axis. When
   * present, `sourceDistance` still holds the absolute distance for the knowns list.
   */
  sampleOffset?: { axis: 'x' | 'y'; sign: 1 | -1; distance: number }
  /**
   * Multiple source charges for a superposition question. Present only for multi-source
   * point-charge worlds; a single-source question keeps using `chargeSign`/`sourceDistance`.
   * Charges are signed (SI coulombs); `position` is an optional {x,y} in metres — when
   * omitted the scene builder places sources symmetrically along x.
   */
  sourceCharges?: ReadonlyArray<{
    charge: number
    position?: { x: number; y: number }
    /** A/q1/B label from the question text, for the knowns list. */
    label?: string
  }>
  /** Where the field is sampled in a multi-source question, in metres. Defaults to the
     midpoint when the question asks about the center between two sources. */
  samplePosition?: { x: number; y: number }
  /**
   * Parallel-plate / bounded electric field geometry (metres). Present only for
   * `charged_particle_bounded_electric_field`. `plateSeparation` is the distance
   * between the two plates (the field region's height); `plateLength` is the extent
   * of the plates along the particle's initial velocity (the field region's width).
   */
  plateSeparation?: number
  plateLength?: number
  /**
   * Where the particle enters the field region along the plate length.
   * `'edge'` (default) enters at the left/right edge of the field box — the usual
   * "电子从极板左侧垂直进入电场" setup; `'center'` enters at the midpoint.
   */
  enterPosition?: 'edge' | 'center'
  /**
   * Composite-field quantities. Magnetic flux density previously existed only as a
   * `knowns[].key === 'magnetic_field_strength'` string entry, which a composite
   * scene builder cannot read reliably — a structured field makes it a first-class
   * input alongside `electricFieldStrength`.
   */
  electricFieldStrength?: number
  magneticFluxDensity?: number
  /** Magnetic field direction out of the plane, the sign of Bz. */
  magneticFieldOrientation?: 'into_page' | 'out_of_page'
  /**
   * Cyclotron geometry: accelerating voltage across the dee gap (volts) and the
   * dee radius that caps the final energy (metres).
   */
  gapVoltage?: number
  deeRadius?: number
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
