import type { PhysicsDomain } from '@physicsos/physics-core'

export type MagneticModelId = 'charged_particle_uniform_magnetic_field'

export type OpticsModelId = 'thin_lens_imaging' | 'plane_mirror_imaging' | 'curved_mirror_imaging'
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
  'velocity_selector' | 'mass_spectrometer' | 'cyclotron' | 'charged_particle_composite_field'

/**
 * Not a physics model: the parser recognised a question SHAPE the pipeline
 * cannot honestly answer (e.g. one document comparing two cases). Validation
 * maps it to UNSUPPORTED_MODEL so the reason reaches the student instead of a
 * silently single-solved pseudo-result.
 */
export type UnsupportedModelId =
  'multi_case_comparison' | 'atomic_energy_level' | 'radioactive_decay' | 'nuclear_reaction'

export type PhysicsModelId =
  | MagneticModelId
  | OpticsModelId
  | ElectricModelId
  | MechanicsModelId
  | CompositeModelId
  | CircuitModelId
  | InductionModelId
  | WaveModelId
  | ModernPhysicsModelId
  | UnsupportedModelId

/**
 * Mechanical-wave models, matching the engine's `TRAVELLING_WAVE_MODEL` /
 * `WAVE_INTERFERENCE_MODEL` / `STANDING_WAVE_MODEL`. A travelling question
 * relates v, λ and f on one rope; an interference question judges a point by
 * its path difference to two coherent sources; a standing question reads the
 * harmonic of a string clamped at both ends.
 */
export type WaveModelId =
  | 'travelling_wave'
  | 'wave_interference'
  | 'standing_wave'
  | 'longitudinal_wave'
  | 'reflection_refraction'
  | 'wave_diffraction'
  | 'wave_doppler'

/** Modern-physics models. Only the photoelectric slice is implemented. */
export type ModernPhysicsModelId = 'photoelectric_effect'

/**
 * DC steady-state circuit model. The circuit engine solves a single-source
 * circuit by modified nodal analysis (MNA); a variable resistor turns the
 * timeline into a quasi-static slider sweep. Matches the engine's
 * `DC_CIRCUIT_MODEL = 'dc_steady_state_mna'`.
 */
export type CircuitModelId = 'dc_steady_state_mna'

/**
 * Induction models, matching the engine's `BAR_MOTION_EMF_MODEL` /
 * `FLUX_CHANGE_EMF_MODEL`. A bar-motion question names a conducting rod cutting
 * field lines (E = BLv); a flux-change question names a coil whose flux changes
 * at a stated rate (E = -dΦ/dt, Lenz sign). Both carry a loop resistance R so
 * the induced current is I = E / R.
 */
export type InductionModelId = 'bar_motion_emf' | 'flux_change_emf'

export type SemanticEntity =
  | 'particle'
  | 'electric_field'
  | 'magnetic_field'
  | 'body'
  | 'gravity_field'
  | 'incline'
  | 'ground'
  | 'lens'
  | 'mirror'
  | 'optical_object'
  | 'screen'
  | 'resistor'
  | 'battery'
  | 'switch'
  | 'ammeter'
  | 'voltmeter'
  | 'rheostat'
  | 'circuit_loop'
  | 'conducting_bar'
  | 'coil'
  | 'rope'
  | 'wave_source'
  | 'observation_point'
  | 'string'
  | 'metal_cathode'
  | 'photon'
  | 'photoelectron'
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
  /* Optics imaging targets. */
  | 'image_distance'
  | 'image_height'
  | 'magnification'
  | 'image_nature'
  | 'image_orientation'
  | 'focal_length'
  | 'object_distance'
  | 'object_height'
  | 'current'
  | 'voltage'
  | 'resistance'
  | 'power'
  | 'emf'
  | 'internal_resistance'
  | 'terminal_voltage'
  /* Induction targets: the induced EMF / current of a cutting rod or a
     flux-changing coil, the flux through it and the Lenz direction. */
  | 'induced_emf'
  | 'induced_current'
  | 'magnetic_flux'
  | 'induction_direction'
  /* Wave targets: the v = λf triple and period of a rope wave, the verdict and
     resultant amplitude at a two-source observation point, the frequency /
     wavelength / node count of a clamped-string harmonic. */
  | 'wave_speed'
  | 'wavelength'
  | 'wave_frequency'
  | 'wave_period'
  | 'path_difference'
  | 'interference_type'
  | 'resultant_amplitude'
  | 'node_count'
  | 'reflection_angle'
  | 'refracted_angle'
  | 'critical_angle'
  | 'central_maximum_width'
  | 'diffraction_angle'
  | 'observed_frequency'
  | 'frequency_shift'
  | 'photon_energy'
  | 'threshold_frequency'
  | 'threshold_wavelength'
  | 'max_kinetic_energy'
  | 'stopping_potential'
  | 'photocurrent'
  | 'emits_photoelectrons'
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
  /* Optics imaging relations. */
  | 'thin_lens_imaging'
  | 'plane_mirror_imaging'
  | 'curved_mirror_imaging'
  | 'series_circuit'
  | 'parallel_circuit'
  | 'ohms_law'
  | 'rheostat_sweep'
  /* Induction relations. */
  | 'bar_cuts_field_lines'
  | 'flux_changes_in_coil'
  | 'faraday_law'
  | 'lenz_law'
  /* Wave relations. */
  | 'wave_speed_relation'
  | 'path_difference_superposition'
  | 'standing_wave_resonance'
  | 'longitudinal_wave_motion'
  | 'wave_reflection'
  | 'wave_refraction'
  | 'single_slit_diffraction'
  | 'doppler_effect'
  | 'photoelectric_effect'
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
  /* Optics imaging assumptions. */
  | 'thin_lens_imaging'
  | 'plane_mirror_imaging'
  | 'curved_mirror_imaging'
  | 'paraxial_approximation'
  | 'geometric_optics'
  | 'ideal_source'
  | 'ideal_meters'
  /* Induction assumptions. */
  | 'uniform_magnetic_field_perpendicular'
  | 'constant_velocity_bar'
  | 'constant_flux_rate'
  | 'ideal_conducting_loop'
  /* Wave assumptions. */
  | 'ideal_medium_no_damping'
  | 'coherent_in_phase_sources'
  | 'string_clamped_both_ends'
  | 'plane_wave_normal_incidence'
  | 'far_field_diffraction'
  | 'subsonic_source'
  | 'monochromatic_light'
  | 'one_photon_photoemission'
  | 'all_photoelectrons_collected'
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

  /**
   * Circuit topology. Present only for `domain === 'circuit'`. When the text
   * names 串联/并联 the parser records it so the scene builder lays out the
   * matching netlist; a rheostat question is treated as a series circuit with
   * one variable resistor.
   */
  circuitTopology?: 'series' | 'parallel' | 'mixed' | 'rheostat'
  /**
   * External resistances of a circuit question, in ohms. The first entry is the
   * primary load; a parallel question carries two. Series and rheostat questions
   * carry them in order.
   */
  circuitResistances?: readonly number[]
  /** Whether the circuit question places a voltmeter across the source / a load. */
  hasVoltmeter?: boolean
  /** Whether the circuit question places an ammeter in the main loop. */
  hasAmmeter?: boolean
  /** Total resistance of the variable resistor in a rheostat question (ohms). */
  rheostatTotalResistance?: number
  /** Slider position (0..1) at which a rheostat question starts. */
  rheostatSliderPosition?: number

  /**
   * Induction rig geometry, present only for `domain === 'induction'`. Which
   * fields are meaningful depends on the model: `bar_motion_emf` reads
   * barLength (metres) / barVelocity (m/s); `flux_change_emf` reads coilArea
   * (square metres) / coilAngle (radians) / fluxRate (Wb/s). Both read
   * magneticFluxDensity (tesla) and loopResistance (ohms) from the knowns
   * table as well — these structured fields exist so the scene builder never
   * re-parses knowns strings.
   */
  inductionBarLength?: number
  inductionBarVelocity?: number
  inductionCoilArea?: number
  inductionCoilAngle?: number
  inductionFluxRate?: number

  /**
   * Wave rig facts (SI), present only for `domain === 'wave'`. A travelling or
   * interference question states the frequency plus either the wavelength or
   * the medium's wave speed; an interference question adds the source
   * separation and either both path lengths or the path difference; a standing
   * question states the string length and harmonic plus the wave speed or the
   * harmonic's frequency. Amplitude is display-grade and defaults when absent.
   */
  waveAmplitude?: number
  waveWavelength?: number
  waveFrequency?: number
  waveSpeed?: number
  waveSourceSeparation?: number
  wavePathOne?: number
  wavePathTwo?: number
  wavePathDifference?: number
  waveStringLength?: number
  waveHarmonic?: number
  waveMediumLength?: number
  waveIncidentSpeed?: number
  waveTransmittedSpeed?: number
  /** Angle of incidence in radians. */
  waveIncidentAngle?: number
  waveSlitWidth?: number
  waveScreenDistance?: number
  waveDiffractionOrder?: number
  waveSourceSpeed?: number
  waveObserverSpeed?: number
  waveSourceDirection?: 'approaching' | 'receding'
  waveObserverDirection?: 'approaching' | 'receding' | 'stationary'

  /* Modern-physics facts (SI). */
  workFunction?: number
  photonWavelength?: number
  lightIntensity?: number
  cathodeArea?: number
  quantumEfficiency?: number
}

export type ValidationResultStatus =
  'VALID' | 'AMBIGUOUS' | 'INVALID_SEMANTICS' | 'UNSUPPORTED_MODEL'

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
