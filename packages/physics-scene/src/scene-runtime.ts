import {
  DEFAULT_TOLERANCE,
  domainError,
  quantityVector,
  toCanonicalVector,
  withinTolerance,
  type ActorRef,
  type DomainError,
  type PhysicsTolerance,
  type QuantityVector,
  type TraceContext,
} from '@physicsos/physics-core'
import {
  canonicalValue,
  quantity,
  validateQuantity,
  type PhysicalDimension,
  type Quantity,
} from '@physicsos/physics-units'
import {
  asPhysicsEventId,
  isIsoDateTime,
  PhysicsOSError,
  type CommandId,
  type IsoDateTime,
  type ObservableId,
  type PhysicsEventId,
  type SceneId,
  type TraceId,
} from '@physicsos/shared'

import { circuitLayoutPlace } from './circuit/circuit-scene.ts'
import { validateScene } from './scene-validation.ts'
import type {
  AcousticBench,
  Circuit,
  CircuitComponent,
  FluidTank,
  InductionBench,
  LeverBench,
  OpticalBench,
  PhysicsScene,
  PressureBench,
  CurrentBench,
  EnergyBench,
  LightBench,
  TransformerBench,
  ThermometerBench,
  NoiseBench,
  ThermalBench,
  UniformElectricField,
  UniformMagneticField,
  WaveBench,
} from './scene.ts'

export const SCENE_COMMAND_SCHEMA = 'scene-command/1.0' as const
export const PHYSICS_EVENT_SCHEMA = 'physics-event/1.0' as const
export const SCENE_REVISION_CONFLICT = 'SCENE_REVISION_CONFLICT' as const

export type ElectricFieldDirection = 'right' | 'left' | 'up' | 'down'

/** docs/03 §69 — command names frozen for the Magnetic + Mechanics + Electric + Circuit + Optics + Acoustics Runtime slices. */
export type SceneCommandType =
  | 'SetParticleCharge'
  | 'SetParticleMass'
  | 'SetParticleVelocity'
  | 'SetMagneticFieldStrength'
  | 'SetMagneticFieldDirection'
  | 'SetElectricFieldStrength'
  | 'SetElectricFieldDirection'
  | 'SetObservableEnabled'
  | 'SetBodyMass'
  | 'SetBodyPosition'
  | 'SetBodyVelocity'
  | 'SetGravityAcceleration'
  | 'SetInclineAngle'
  | 'SetFrictionCoefficient'
  | 'SetStaticFrictionCoefficient'
  | 'SetSpringConstant'
  | 'SetPendulumLength'
  | 'SetAppliedForce'
  | 'SetGroundLevel'
  | 'SetComponentResistance'
  | 'SetSourceVoltage'
  | 'SetSourceInternalResistance'
  | 'SetSwitchState'
  | 'SetSliderPosition'
  | 'SetComponentPlacement'
  | 'SetOpticalObjectPosition'
  | 'SetOpticalObjectHeight'
  | 'SetLensFocalLength'
  | 'SetMirrorFocalLength'
  | 'SetOpticalScreenPosition'
  | 'SetAcousticReflectorPosition'
  | 'SetAcousticSoundSpeed'
  | 'SetLiquidDensity'
  | 'SetBlockMass'
  | 'SetHeaterPower'
  | 'SetSampleMass'
  | 'SetHangerMass'
  | 'SetHangerArm'
  | 'SetInductionFieldStrength'
  | 'SetInductionLoopResistance'
  | 'SetInductionBarVelocity'
  | 'SetInductionBarLength'
  | 'SetInductionFluxRate'
  | 'SetInductionBarMasses'
  | 'SetInductionBarVelocityOne'
  | 'SetInductionExternalForce'
  | 'SetWaveAmplitude'
  | 'SetWaveFrequency'
  | 'SetWaveSpeed'
  | 'SetWavePathDifference'
  | 'SetWaveStringLength'
  | 'SetWaveHarmonic'
  | 'SetPressureForce'
  | 'SetPressureContactArea'
  | 'SetPressureComparisonArea'
  | 'SetPressureLiquidDensity'
  | 'SetPressureProbeDepth'
  | 'SetPressureComparisonDepth'
  | 'SetPressureComparisonLiquidDensity'
  | 'SetPressureAtmospheric'
  | 'SetPressureBarometerFluidDensity'
  | 'SetPressureHemisphereRadius'
  | 'SetCurrent'
  | 'SetProbeDistance'
  | 'SetComparisonProbeDistance'
  | 'SetSolenoidTurns'
  | 'SetSolenoidComparisonTurns'
  | 'SetSolenoidLength'
  | 'SetCorePermeability'
  | 'SetComparisonCorePermeability'
  | 'SetCoreArea'
  | 'SetRotorField'
  | 'SetRotorSideLength'
  | 'SetRotorCoilWidth'
  | 'SetRotorAngle'
  | 'SetEnergyMass'
  | 'SetReleaseHeight'
  | 'SetRampAngle'
  | 'SetRampFriction'
  | 'SetObjectHeight'
  | 'SetObjectDistance'
  | 'SetScreenDistance'
  | 'SetIncidentIndex'
  | 'SetRefractedIndex'
  | 'SetIncidentAngle'
  | 'SetTransformerVoltage'
  | 'SetTransformerCurrent'
  | 'SetPrimaryTurns'
  | 'SetSecondaryTurns'
  | 'SetThermometerTemperature'
  | 'SetThermometerBore'
  | 'SetFillingLiquid'
  | 'SetThermometerBulb'
  | 'SetNoiseSourceLevel'
  | 'SetListenerDistance'
  | 'SetBarrierAttenuation'

/** docs/03 §69 — each discriminant has exactly one payload shape. */
export interface SceneCommandPayloadMap {
  SetParticleCharge: {
    particleId: string
    charge: Quantity<'electric_charge'>
  }
  SetParticleMass: {
    particleId: string
    mass: Quantity<'mass'>
  }
  SetParticleVelocity: {
    particleId: string
    velocity: QuantityVector<'velocity'>
  }
  SetMagneticFieldStrength: {
    fieldId: string
    strength: Quantity<'magnetic_flux_density'>
  }
  SetMagneticFieldDirection: {
    fieldId: string
    direction: 'into_page' | 'out_of_page'
  }
  SetElectricFieldStrength: {
    fieldId: string
    strength: Quantity<'electric_field'>
  }
  SetElectricFieldDirection: {
    fieldId: string
    direction: ElectricFieldDirection
  }
  SetObservableEnabled: {
    observableId: ObservableId
    enabled: boolean
  }
  SetBodyMass: {
    bodyId: string
    mass: Quantity<'mass'>
  }
  SetBodyPosition: {
    bodyId: string
    position: QuantityVector<'length'>
  }
  SetBodyVelocity: {
    bodyId: string
    velocity: QuantityVector<'velocity'>
  }
  SetGravityAcceleration: {
    fieldId: string
    acceleration: QuantityVector<'acceleration'>
  }
  SetInclineAngle: {
    observableId: ObservableId
    /** Degrees, strictly between 0 and 90 for a physical slope. */
    angleDegrees: number
  }
  SetFrictionCoefficient: {
    bodyId: string
    /** Dimensionless μ ≥ 0. */
    coefficient: number
  }
  SetStaticFrictionCoefficient: {
    bodyId: string
    /** Dimensionless μs ≥ 0 — the static limit, stored beside μk. */
    coefficient: number
  }
  SetSpringConstant: {
    /** The spring constraint carrying `stiffness` in its parameters. */
    constraintId: string
    /** N/m, strictly positive. */
    constant: number
  }
  SetPendulumLength: {
    /** The rope constraint carrying `length` in its parameters. */
    constraintId: string
    /** Pivot-to-bob length in m, strictly positive. */
    length: number
  }
  SetAppliedForce: {
    forceId: string
    targetId: string
    vector: QuantityVector<'force'>
  }
  SetGroundLevel: {
    observableId: ObservableId
    /** Ground height in scene length units (SI metres). */
    groundY: number
  }
  SetComponentResistance: {
    circuitId: string
    componentId: string
    /** Fixed resistor: its resistance. Variable resistor: its full-scale resistance. */
    resistance: Quantity<'resistance'>
  }
  SetSourceVoltage: {
    circuitId: string
    componentId: string
    voltage: Quantity<'electric_potential'>
  }
  SetSourceInternalResistance: {
    circuitId: string
    componentId: string
    internalResistance: Quantity<'resistance'>
  }
  SetSwitchState: {
    circuitId: string
    componentId: string
    state: 'open' | 'closed'
  }
  SetSliderPosition: {
    circuitId: string
    componentId: string
    /** Rheostat slider position, 0..1 inclusive. */
    position: number
  }
  SetComponentPlacement: {
    circuitId: string
    componentId: string
    /** Schematic grid position. Presentation only — never a physical fact. */
    x: number
    y: number
    /** Optional quarter-turn rotation; omitted keeps the current rotation. */
    rotation?: 0 | 90 | 180 | 270
  }
  SetOpticalObjectPosition: {
    benchId: string
    /** Signed x position; must stay on the incoming (−x) side of every element. */
    position: Quantity<'length'>
  }
  SetOpticalObjectHeight: {
    benchId: string
    /** Object height above the axis, > 0. */
    height: Quantity<'length'>
  }
  SetLensFocalLength: {
    benchId: string
    elementId: string
    /** Focal length; non-zero, > 0 converging. */
    focalLength: Quantity<'length'>
  }
  SetMirrorFocalLength: {
    benchId: string
    elementId: string
    /** Focal length; non-zero, > 0 concave (converging), < 0 convex. */
    focalLength: Quantity<'length'>
  }
  SetOpticalScreenPosition: {
    benchId: string
    /** Signed x position of the screen plane. */
    position: Quantity<'length'>
  }
  SetAcousticReflectorPosition: {
    benchId: string
    /** Signed x position of the reflecting face; must stay ahead of the source. */
    position: Quantity<'length'>
  }
  SetAcousticSoundSpeed: {
    benchId: string
    /** Speed of sound in the propagation medium; finite and > 0. */
    soundSpeed: Quantity<'velocity'>
  }
  SetLiquidDensity: {
    tankId: string
    /** Density of the liquid in the tank; finite and > 0. */
    density: Quantity<'density'>
  }
  SetBlockMass: {
    tankId: string
    /** Mass of the hanging block; finite and > 0. */
    mass: Quantity<'mass'>
  }
  SetHeaterPower: {
    benchId: string
    /** Heat delivered per second; finite and > 0. */
    power: Quantity<'power'>
  }
  SetSampleMass: {
    benchId: string
    /** Mass of the heated sample; finite and > 0. */
    mass: Quantity<'mass'>
  }
  SetHangerMass: {
    leverId: string
    hangerId: string
    /** Mass of the hanging load; finite and > 0. */
    mass: Quantity<'mass'>
  }
  SetHangerArm: {
    leverId: string
    hangerId: string
    /** Distance from the fulcrum to the hanger; finite and > 0. */
    armLength: Quantity<'length'>
  }
  SetInductionFieldStrength: {
    benchId: string
    /** Magnetic flux density of the uniform field; finite and > 0. */
    strength: Quantity<'magnetic_flux_density'>
  }
  SetInductionLoopResistance: {
    benchId: string
    /** Loop resistance of the closed conducting loop; finite and > 0. */
    resistance: Quantity<'resistance'>
  }
  SetInductionBarVelocity: {
    benchId: string
    /** Rod velocity; finite (sign encodes cutting direction). */
    velocity: Quantity<'velocity'>
  }
  SetInductionBarLength: {
    benchId: string
    /** Rod length; finite and > 0. */
    length: Quantity<'length'>
  }
  SetInductionFluxRate: {
    benchId: string
    /** Rate of change of flux dΦ/dt; finite (sign sets the Lenz direction). */
    fluxRate: Quantity<'magnetic_flux_rate'>
  }
  SetInductionBarMasses: {
    benchId: string
    /** Bar masses, positional [bar1, bar2]; each > 0. Each element carries its
        own unit — callers may send 'g' for the edited bar and 'kg' for the
        untouched one, so they are canonicalized independently. */
    masses: [Quantity<'mass'>, Quantity<'mass'>]
  }
  SetInductionBarVelocityOne: {
    benchId: string
    /** Which bar the velocity belongs to (1 = bar1, 2 = bar2). */
    barIndex: 1 | 2
    /** Velocity of that bar; finite (sign encodes direction along the rails). */
    velocity: Quantity<'velocity'>
  }
  SetInductionExternalForce: {
    benchId: string
    /** Constant external force on bar 1; finite and ≥ 0 (0 = free pair). */
    force: Quantity<'force'>
  }
  SetWaveAmplitude: {
    benchId: string
    /** Wave amplitude; finite and > 0. */
    amplitude: Quantity<'length'>
  }
  SetWaveFrequency: {
    benchId: string
    /** Source frequency; finite and > 0. */
    frequency: Quantity<'frequency'>
  }
  SetWaveSpeed: {
    benchId: string
    /** Propagation speed set by the medium; finite and > 0. */
    speed: Quantity<'velocity'>
  }
  SetWavePathDifference: {
    benchId: string
    /** Path difference at the observation point; finite and >= 0 (interference). */
    pathDifference: Quantity<'length'>
  }
  SetWaveStringLength: {
    benchId: string
    /** Vibrating string length; finite and > 0 (standing wave). */
    stringLength: Quantity<'length'>
  }
  SetWaveHarmonic: {
    benchId: string
    /** Harmonic number n; integer and >= 1 (standing wave). */
    harmonic: number
  }
  SetPressureForce: {
    benchId: string
    /** Perpendicular force on the contact face; finite and >= 0 (solid). */
    force: Quantity<'force'>
  }
  SetPressureContactArea: {
    benchId: string
    /** Loaded contact area; finite and > 0 (solid). */
    area: Quantity<'area'>
  }
  SetPressureComparisonArea: {
    benchId: string
    /** The same force on another face; finite and > 0 (solid). */
    area: Quantity<'area'>
  }
  SetPressureLiquidDensity: {
    benchId: string
    /** Density of the probed liquid; finite and > 0 (liquid). */
    density: Quantity<'density'>
  }
  SetPressureProbeDepth: {
    benchId: string
    /** Probe depth below the surface; finite and >= 0 (liquid). */
    depth: Quantity<'length'>
  }
  SetPressureComparisonDepth: {
    benchId: string
    /** Second probe depth in the same liquid; finite and >= 0 (liquid). */
    depth: Quantity<'length'>
  }
  SetPressureComparisonLiquidDensity: {
    benchId: string
    /** A second liquid probed at the same depth; finite and > 0 (liquid). */
    density: Quantity<'density'>
  }
  SetPressureAtmospheric: {
    benchId: string
    /** Atmospheric pressure both instruments read; finite and > 0. */
    pressure: Quantity<'pressure'>
  }
  SetPressureBarometerFluidDensity: {
    benchId: string
    /** Density of the barometer filling fluid; finite and > 0 (atmospheric). */
    density: Quantity<'density'>
  }
  SetPressureHemisphereRadius: {
    benchId: string
    /** Radius of each Magdeburg hemisphere; finite and > 0 (atmospheric). */
    radius: Quantity<'length'>
  }
  SetCurrent: {
    benchId: string
    /**
     * Current through the conductor; finite and non-zero. Signed on purpose:
     * the sign is the direction, and it is what flips the field's circulation,
     * so a command that dropped it could not express 安培定则.
     */
    current: Quantity<'electric_current'>
  }
  SetProbeDistance: {
    benchId: string
    /** Distance from the conductor to the probe; finite and > 0 (straight_wire). */
    distance: Quantity<'length'>
  }
  SetComparisonProbeDistance: {
    benchId: string
    /** Second probe distance in the same field; finite and > 0 (straight_wire). */
    distance: Quantity<'length'>
  }
  SetSolenoidTurns: {
    benchId: string
    /** Turns on the former; finite and > 0 (solenoid). */
    turns: Quantity<'dimensionless'>
  }
  SetSolenoidComparisonTurns: {
    benchId: string
    /** Turns on the second winding, same former and length; finite and > 0 (solenoid). */
    turns: Quantity<'dimensionless'>
  }
  SetSolenoidLength: {
    benchId: string
    /** Coil length along the axis; finite and > 0 (solenoid). */
    length: Quantity<'length'>
  }
  SetCorePermeability: {
    benchId: string
    /**
     * Relative permeability of the core; finite and > 0 (electromagnet). 1 is
     * the air-cored coil — a real rig this one is measured against — so only
     * zero is refused.
     */
    relativePermeability: Quantity<'dimensionless'>
  }
  SetComparisonCorePermeability: {
    benchId: string
    /** Second core on the same coil; finite and > 0 (electromagnet). */
    relativePermeability: Quantity<'dimensionless'>
  }
  SetCoreArea: {
    benchId: string
    /** Area of the pole face; finite and > 0 (electromagnet). */
    area: Quantity<'area'>
  }
  SetRotorField: {
    benchId: string
    /** Stator field the rotor turns in; finite and > 0 (motor). */
    field: Quantity<'magnetic_flux_density'>
  }
  SetRotorSideLength: {
    benchId: string
    /** Length of the sides that carry the force; finite and > 0 (motor). */
    length: Quantity<'length'>
  }
  SetRotorCoilWidth: {
    benchId: string
    /** Length of the other pair of sides — the lever arm; finite and > 0 (motor). */
    width: Quantity<'length'>
  }
  SetRotorAngle: {
    benchId: string
    /**
     * Angle from the coil's plane to the field (motor). Any angle is a rig:
     * 0° lies along the field, 90° is the 平衡位置, and past it the bare coil's
     * torque has reversed — which is the state the commutator exists for.
     */
    angle: Quantity<'angle'>
  }
  SetEnergyMass: {
    benchId: string
    /** Mass of the cart that carries the energy; finite and > 0 (energy bench). */
    mass: Quantity<'mass'>
  }
  SetReleaseHeight: {
    benchId: string
    /** Height the cart is released from; finite and > 0 (energy bench). */
    height: Quantity<'length'>
  }
  SetRampAngle: {
    benchId: string
    /**
     * Incline angle of the ramp; finite and strictly between 0° and 90° (energy
     * bench). Both ends are refused because both make the ledger degenerate:
     * a level track has no height to fall and a vertical drop has no ramp.
     */
    angle: Quantity<'angle'>
  }
  SetRampFriction: {
    benchId: string
    /** Kinetic friction coefficient along the ramp; finite and ≥ 0 (energy bench). */
    coefficient: Quantity<'dimensionless'>
  }
  SetObjectHeight: {
    benchId: string
    /** Height of the object in front of the hole; finite and > 0 (light bench). */
    height: Quantity<'length'>
  }
  SetObjectDistance: {
    benchId: string
    /** Distance from the object to the hole; finite and > 0 (light bench). */
    distance: Quantity<'length'>
  }
  SetScreenDistance: {
    benchId: string
    /** Distance from the hole to the receiving screen; finite and > 0 (light bench). */
    distance: Quantity<'length'>
  }
  SetIncidentIndex: {
    benchId: string
    /** Refractive index the light comes from; finite and >= 1 (total reflection). */
    index: Quantity<'dimensionless'>
  }
  SetRefractedIndex: {
    benchId: string
    /** Refractive index the light meets; finite and > 0 (total reflection). */
    index: Quantity<'dimensionless'>
  }
  SetIncidentAngle: {
    benchId: string
    /** Angle of incidence from the normal; finite and in [0, 90) degrees. */
    angle: Quantity<'angle'>
  }
  SetTransformerVoltage: {
    benchId: string
    /** Voltage across the driven winding; finite and > 0 (transformer). */
    voltage: Quantity<'electric_potential'>
  }
  SetTransformerCurrent: {
    benchId: string
    /** Current into the driven winding; finite and >= 0 (transformer). */
    current: Quantity<'electric_current'>
  }
  SetPrimaryTurns: {
    benchId: string
    /** Turns on the driven winding; finite and > 0 (transformer). */
    turns: Quantity<'dimensionless'>
  }
  SetSecondaryTurns: {
    benchId: string
    /** Turns on the output winding; finite and > 0 (transformer). */
    turns: Quantity<'dimensionless'>
  }
  SetThermometerTemperature: {
    benchId: string
    /** Temperature the bulb sits in; finite (thermometer). */
    temperature: Quantity<'temperature'>
  }
  SetThermometerBore: {
    benchId: string
    /** Diameter of the capillary bore; finite and > 0 (thermometer). */
    diameter: Quantity<'length'>
  }
  SetFillingLiquid: {
    benchId: string
    /** Volumetric expansion coefficient of the filling liquid; finite and > 0 (thermometer). */
    coefficient: Quantity<'dimensionless'>
  }
  SetThermometerBulb: {
    benchId: string
    /** Volume of the bulb; finite and > 0 (thermometer). */
    volume: Quantity<'volume'>
  }
  SetNoiseSourceLevel: {
    benchId: string
    /** Sound power level of the source; finite (noise bench). */
    level: Quantity<'dimensionless'>
  }
  SetListenerDistance: {
    benchId: string
    /** Distance from the source to the listener; finite and > 0 (noise bench). */
    distance: Quantity<'length'>
  }
  SetBarrierAttenuation: {
    benchId: string
    /** Insertion loss of the barrier; finite and >= 0 (noise bench). */
    attenuation: Quantity<'dimensionless'>
  }
}

export type SceneCommandPayload<TType extends SceneCommandType> = SceneCommandPayloadMap[TType]

export interface SceneCommandEnvelope<
  TType extends SceneCommandType,
  TPayload extends SceneCommandPayloadMap[TType],
> {
  schemaVersion: typeof SCENE_COMMAND_SCHEMA
  commandId: CommandId
  sceneId: SceneId
  expectedRevision: number
  type: TType
  payload: TPayload
  actor: ActorRef
  trace: TraceContext
  issuedAt: IsoDateTime
}

/**
 * Distributive alias: using `SceneCommand` yields a discriminated union while
 * `SceneCommand<'SetParticleMass'>` selects one precise command.
 */
export type SceneCommand<TType extends SceneCommandType = SceneCommandType> =
  TType extends SceneCommandType
    ? SceneCommandEnvelope<TType, SceneCommandPayloadMap[TType]>
    : never

/** docs/03 §72 — exact events emitted by the supported commands. */
export type PhysicsEventType =
  | 'ParticleChargeChanged'
  | 'ParticleMassChanged'
  | 'ParticleVelocityChanged'
  | 'MagneticFieldStrengthChanged'
  | 'MagneticFieldDirectionChanged'
  | 'ElectricFieldStrengthChanged'
  | 'ElectricFieldDirectionChanged'
  | 'ObservableEnabled'
  | 'ObservableDisabled'
  | 'BodyMassChanged'
  | 'BodyPositionChanged'
  | 'BodyVelocityChanged'
  | 'GravityAccelerationChanged'
  | 'InclineAngleChanged'
  | 'FrictionCoefficientChanged'
  | 'StaticFrictionCoefficientChanged'
  | 'SpringConstantChanged'
  | 'PendulumLengthChanged'
  | 'AppliedForceChanged'
  | 'GroundLevelChanged'
  | 'ComponentResistanceChanged'
  | 'SourceVoltageChanged'
  | 'SourceInternalResistanceChanged'
  | 'SwitchStateChanged'
  | 'SliderPositionChanged'
  | 'ComponentPlacementChanged'
  | 'OpticalObjectPositionChanged'
  | 'OpticalObjectHeightChanged'
  | 'LensFocalLengthChanged'
  | 'MirrorFocalLengthChanged'
  | 'OpticalScreenPositionChanged'
  | 'AcousticReflectorPositionChanged'
  | 'AcousticSoundSpeedChanged'
  | 'LiquidDensityChanged'
  | 'BlockMassChanged'
  | 'HeaterPowerChanged'
  | 'SampleMassChanged'
  | 'HangerMassChanged'
  | 'HangerArmChanged'
  | 'InductionFieldStrengthChanged'
  | 'InductionLoopResistanceChanged'
  | 'InductionBarVelocityChanged'
  | 'InductionBarLengthChanged'
  | 'InductionFluxRateChanged'
  | 'InductionBarMassesChanged'
  | 'InductionBarVelocityOneChanged'
  | 'InductionExternalForceChanged'
  | 'WaveAmplitudeChanged'
  | 'WaveFrequencyChanged'
  | 'WaveSpeedChanged'
  | 'WavePathDifferenceChanged'
  | 'WaveStringLengthChanged'
  | 'WaveHarmonicChanged'
  | 'PressureForceChanged'
  | 'PressureContactAreaChanged'
  | 'PressureComparisonAreaChanged'
  | 'PressureLiquidDensityChanged'
  | 'PressureProbeDepthChanged'
  | 'PressureComparisonDepthChanged'
  | 'PressureComparisonLiquidDensityChanged'
  | 'PressureAtmosphericChanged'
  | 'PressureBarometerFluidDensityChanged'
  | 'PressureHemisphereRadiusChanged'
  | 'CurrentFieldChanged'
  | 'ProbeDistanceChanged'
  | 'ComparisonProbeDistanceChanged'
  | 'SolenoidTurnsChanged'
  | 'SolenoidComparisonTurnsChanged'
  | 'SolenoidLengthChanged'
  | 'CorePermeabilityChanged'
  | 'ComparisonCorePermeabilityChanged'
  | 'CoreAreaChanged'
  | 'RotorFieldChanged'
  | 'RotorSideLengthChanged'
  | 'RotorCoilWidthChanged'
  | 'RotorAngleChanged'
  | 'EnergyMassChanged'
  | 'ReleaseHeightChanged'
  | 'RampAngleChanged'
  | 'RampFrictionChanged'
  | 'ObjectHeightChanged'
  | 'ObjectDistanceChanged'
  | 'ScreenDistanceChanged'
  | 'IncidentIndexChanged'
  | 'RefractedIndexChanged'
  | 'IncidentAngleChanged'
  | 'TransformerVoltageChanged'
  | 'TransformerCurrentChanged'
  | 'PrimaryTurnsChanged'
  | 'SecondaryTurnsChanged'
  | 'ThermometerTemperatureChanged'
  | 'ThermometerBoreChanged'
  | 'FillingLiquidChanged'
  | 'ThermometerBulbChanged'
  | 'NoiseSourceLevelChanged'
  | 'ListenerDistanceChanged'
  | 'BarrierAttenuationChanged'

export interface PhysicsEventPayloadMap {
  ParticleChargeChanged: SceneCommandPayloadMap['SetParticleCharge']
  ParticleMassChanged: SceneCommandPayloadMap['SetParticleMass']
  ParticleVelocityChanged: SceneCommandPayloadMap['SetParticleVelocity']
  MagneticFieldStrengthChanged: SceneCommandPayloadMap['SetMagneticFieldStrength']
  MagneticFieldDirectionChanged: SceneCommandPayloadMap['SetMagneticFieldDirection']
  ElectricFieldStrengthChanged: SceneCommandPayloadMap['SetElectricFieldStrength']
  ElectricFieldDirectionChanged: SceneCommandPayloadMap['SetElectricFieldDirection']
  ObservableEnabled: {
    observableId: ObservableId
    enabled: true
  }
  ObservableDisabled: {
    observableId: ObservableId
    enabled: false
  }
  BodyMassChanged: SceneCommandPayloadMap['SetBodyMass']
  BodyPositionChanged: SceneCommandPayloadMap['SetBodyPosition']
  BodyVelocityChanged: SceneCommandPayloadMap['SetBodyVelocity']
  GravityAccelerationChanged: SceneCommandPayloadMap['SetGravityAcceleration']
  InclineAngleChanged: SceneCommandPayloadMap['SetInclineAngle']
  FrictionCoefficientChanged: SceneCommandPayloadMap['SetFrictionCoefficient']
  StaticFrictionCoefficientChanged: SceneCommandPayloadMap['SetStaticFrictionCoefficient']
  SpringConstantChanged: SceneCommandPayloadMap['SetSpringConstant']
  PendulumLengthChanged: SceneCommandPayloadMap['SetPendulumLength']
  AppliedForceChanged: SceneCommandPayloadMap['SetAppliedForce']
  GroundLevelChanged: SceneCommandPayloadMap['SetGroundLevel']
  ComponentResistanceChanged: SceneCommandPayloadMap['SetComponentResistance']
  SourceVoltageChanged: SceneCommandPayloadMap['SetSourceVoltage']
  SourceInternalResistanceChanged: SceneCommandPayloadMap['SetSourceInternalResistance']
  SwitchStateChanged: SceneCommandPayloadMap['SetSwitchState']
  SliderPositionChanged: SceneCommandPayloadMap['SetSliderPosition']
  ComponentPlacementChanged: SceneCommandPayloadMap['SetComponentPlacement']
  OpticalObjectPositionChanged: SceneCommandPayloadMap['SetOpticalObjectPosition']
  OpticalObjectHeightChanged: SceneCommandPayloadMap['SetOpticalObjectHeight']
  LensFocalLengthChanged: SceneCommandPayloadMap['SetLensFocalLength']
  MirrorFocalLengthChanged: SceneCommandPayloadMap['SetMirrorFocalLength']
  OpticalScreenPositionChanged: SceneCommandPayloadMap['SetOpticalScreenPosition']
  AcousticReflectorPositionChanged: SceneCommandPayloadMap['SetAcousticReflectorPosition']
  AcousticSoundSpeedChanged: SceneCommandPayloadMap['SetAcousticSoundSpeed']
  LiquidDensityChanged: SceneCommandPayloadMap['SetLiquidDensity']
  BlockMassChanged: SceneCommandPayloadMap['SetBlockMass']
  HeaterPowerChanged: SceneCommandPayloadMap['SetHeaterPower']
  SampleMassChanged: SceneCommandPayloadMap['SetSampleMass']
  HangerMassChanged: SceneCommandPayloadMap['SetHangerMass']
  HangerArmChanged: SceneCommandPayloadMap['SetHangerArm']
  InductionFieldStrengthChanged: SceneCommandPayloadMap['SetInductionFieldStrength']
  InductionLoopResistanceChanged: SceneCommandPayloadMap['SetInductionLoopResistance']
  InductionBarVelocityChanged: SceneCommandPayloadMap['SetInductionBarVelocity']
  InductionBarLengthChanged: SceneCommandPayloadMap['SetInductionBarLength']
  InductionFluxRateChanged: SceneCommandPayloadMap['SetInductionFluxRate']
  InductionBarMassesChanged: SceneCommandPayloadMap['SetInductionBarMasses']
  InductionBarVelocityOneChanged: SceneCommandPayloadMap['SetInductionBarVelocityOne']
  InductionExternalForceChanged: SceneCommandPayloadMap['SetInductionExternalForce']
  WaveAmplitudeChanged: SceneCommandPayloadMap['SetWaveAmplitude']
  WaveFrequencyChanged: SceneCommandPayloadMap['SetWaveFrequency']
  WaveSpeedChanged: SceneCommandPayloadMap['SetWaveSpeed']
  WavePathDifferenceChanged: SceneCommandPayloadMap['SetWavePathDifference']
  WaveStringLengthChanged: SceneCommandPayloadMap['SetWaveStringLength']
  WaveHarmonicChanged: SceneCommandPayloadMap['SetWaveHarmonic']
  PressureForceChanged: SceneCommandPayloadMap['SetPressureForce']
  PressureContactAreaChanged: SceneCommandPayloadMap['SetPressureContactArea']
  PressureComparisonAreaChanged: SceneCommandPayloadMap['SetPressureComparisonArea']
  PressureLiquidDensityChanged: SceneCommandPayloadMap['SetPressureLiquidDensity']
  PressureProbeDepthChanged: SceneCommandPayloadMap['SetPressureProbeDepth']
  PressureComparisonDepthChanged: SceneCommandPayloadMap['SetPressureComparisonDepth']
  PressureComparisonLiquidDensityChanged: SceneCommandPayloadMap['SetPressureComparisonLiquidDensity']
  PressureAtmosphericChanged: SceneCommandPayloadMap['SetPressureAtmospheric']
  PressureBarometerFluidDensityChanged: SceneCommandPayloadMap['SetPressureBarometerFluidDensity']
  PressureHemisphereRadiusChanged: SceneCommandPayloadMap['SetPressureHemisphereRadius']
  CurrentFieldChanged: SceneCommandPayloadMap['SetCurrent']
  ProbeDistanceChanged: SceneCommandPayloadMap['SetProbeDistance']
  ComparisonProbeDistanceChanged: SceneCommandPayloadMap['SetComparisonProbeDistance']
  SolenoidTurnsChanged: SceneCommandPayloadMap['SetSolenoidTurns']
  SolenoidComparisonTurnsChanged: SceneCommandPayloadMap['SetSolenoidComparisonTurns']
  SolenoidLengthChanged: SceneCommandPayloadMap['SetSolenoidLength']
  CorePermeabilityChanged: SceneCommandPayloadMap['SetCorePermeability']
  ComparisonCorePermeabilityChanged: SceneCommandPayloadMap['SetComparisonCorePermeability']
  CoreAreaChanged: SceneCommandPayloadMap['SetCoreArea']
  RotorFieldChanged: SceneCommandPayloadMap['SetRotorField']
  RotorSideLengthChanged: SceneCommandPayloadMap['SetRotorSideLength']
  RotorCoilWidthChanged: SceneCommandPayloadMap['SetRotorCoilWidth']
  RotorAngleChanged: SceneCommandPayloadMap['SetRotorAngle']
  EnergyMassChanged: SceneCommandPayloadMap['SetEnergyMass']
  ReleaseHeightChanged: SceneCommandPayloadMap['SetReleaseHeight']
  RampAngleChanged: SceneCommandPayloadMap['SetRampAngle']
  RampFrictionChanged: SceneCommandPayloadMap['SetRampFriction']
  ObjectHeightChanged: SceneCommandPayloadMap['SetObjectHeight']
  ObjectDistanceChanged: SceneCommandPayloadMap['SetObjectDistance']
  ScreenDistanceChanged: SceneCommandPayloadMap['SetScreenDistance']
  IncidentIndexChanged: SceneCommandPayloadMap['SetIncidentIndex']
  RefractedIndexChanged: SceneCommandPayloadMap['SetRefractedIndex']
  IncidentAngleChanged: SceneCommandPayloadMap['SetIncidentAngle']
  TransformerVoltageChanged: SceneCommandPayloadMap['SetTransformerVoltage']
  TransformerCurrentChanged: SceneCommandPayloadMap['SetTransformerCurrent']
  PrimaryTurnsChanged: SceneCommandPayloadMap['SetPrimaryTurns']
  SecondaryTurnsChanged: SceneCommandPayloadMap['SetSecondaryTurns']
  ThermometerTemperatureChanged: SceneCommandPayloadMap['SetThermometerTemperature']
  ThermometerBoreChanged: SceneCommandPayloadMap['SetThermometerBore']
  FillingLiquidChanged: SceneCommandPayloadMap['SetFillingLiquid']
  ThermometerBulbChanged: SceneCommandPayloadMap['SetThermometerBulb']
  NoiseSourceLevelChanged: SceneCommandPayloadMap['SetNoiseSourceLevel']
  ListenerDistanceChanged: SceneCommandPayloadMap['SetListenerDistance']
  BarrierAttenuationChanged: SceneCommandPayloadMap['SetBarrierAttenuation']
}

export type PhysicsEventPayload<TType extends PhysicsEventType> = PhysicsEventPayloadMap[TType]

export interface PhysicsEventEnvelope<
  TType extends PhysicsEventType,
  TPayload extends PhysicsEventPayloadMap[TType],
> {
  schemaVersion: typeof PHYSICS_EVENT_SCHEMA
  eventId: PhysicsEventId
  commandId: CommandId
  sceneId: SceneId
  revision: number
  type: TType
  payload: TPayload
  actor: ActorRef
  occurredAt: IsoDateTime
  trace: TraceContext
}

export type PhysicsEvent<TType extends PhysicsEventType = PhysicsEventType> =
  TType extends PhysicsEventType
    ? PhysicsEventEnvelope<TType, PhysicsEventPayloadMap[TType]>
    : never

export interface SceneCommandSuccess {
  ok: true
  sceneId: SceneId
  previousRevision: number
  newRevision: number
  eventIds: PhysicsEventId[]
  traceId: TraceId
}

export interface SceneCommandFailure {
  ok: false
  error: DomainError
  traceId: TraceId
}

/** docs/03 §70 */
export type SceneCommandResult = SceneCommandSuccess | SceneCommandFailure

export interface SceneRuntimeOptions {
  tolerance?: PhysicsTolerance
  now?: () => IsoDateTime
  eventIdFactory?: (sceneId: SceneId, revision: number, commandId: CommandId) => PhysicsEventId
}

interface EventContext {
  eventId: PhysicsEventId
  occurredAt: IsoDateTime
  revision: number
}

type ApplyCommandResult = { ok: true; event: PhysicsEvent } | { ok: false; error: DomainError }

const clone = <T>(value: T): T => structuredClone(value)

const defaultEventIdFactory = (
  sceneId: SceneId,
  revision: number,
  commandId: CommandId,
): PhysicsEventId => asPhysicsEventId(`${String(sceneId)}:event:${revision}:${String(commandId)}`)

const commandFailure = (error: DomainError, traceId: TraceId): SceneCommandFailure => ({
  ok: false,
  error,
  traceId,
})

const NOT_FOUND_CODES = {
  particle: 'PARTICLE_NOT_FOUND',
  magnetic_field: 'MAGNETIC_FIELD_NOT_FOUND',
  electric_field: 'ELECTRIC_FIELD_NOT_FOUND',
  observable: 'OBSERVABLE_NOT_FOUND',
  body: 'BODY_NOT_FOUND',
  gravity_field: 'GRAVITY_FIELD_NOT_FOUND',
  force: 'FORCE_NOT_FOUND',
  circuit: 'CIRCUIT_NOT_FOUND',
  circuit_component: 'CIRCUIT_COMPONENT_NOT_FOUND',
  optical_bench: 'OPTICAL_BENCH_NOT_FOUND',
  optical_element: 'OPTICAL_ELEMENT_NOT_FOUND',
  optical_screen: 'OPTICAL_SCREEN_NOT_FOUND',
  acoustic_bench: 'ACOUSTIC_BENCH_NOT_FOUND',
  fluid_tank: 'FLUID_TANK_NOT_FOUND',
  thermal_bench: 'THERMAL_BENCH_NOT_FOUND',
  lever_bench: 'LEVER_NOT_FOUND',
  constraint: 'CONSTRAINT_NOT_FOUND',
  lever_hanger: 'HANGER_NOT_FOUND',
  induction_bench: 'INDUCTION_BENCH_NOT_FOUND',
  wave_bench: 'WAVE_BENCH_NOT_FOUND',
  pressure_bench: 'PRESSURE_BENCH_NOT_FOUND',
  current_bench: 'CURRENT_BENCH_NOT_FOUND',
  energy_bench: 'ENERGY_BENCH_NOT_FOUND',
  light_bench: 'LIGHT_BENCH_NOT_FOUND',
  transformer_bench: 'TRANSFORMER_BENCH_NOT_FOUND',
  thermometer_bench: 'THERMOMETER_BENCH_NOT_FOUND',
  noise_bench: 'NOISE_BENCH_NOT_FOUND',
} as const

const notFound = (targetType: keyof typeof NOT_FOUND_CODES, id: string) =>
  domainError(
    NOT_FOUND_CODES[targetType],
    `${targetType} target "${id}" does not exist in the current scene.`,
    'not_found',
    { details: { targetType, targetId: id } },
  )

const invalidCommand = (code: string, message: string, details?: Record<string, unknown>) =>
  domainError(code, message, 'validation', details === undefined ? undefined : { details })

const baseEvent = (command: SceneCommand, context: EventContext) => ({
  schemaVersion: PHYSICS_EVENT_SCHEMA,
  eventId: context.eventId,
  commandId: command.commandId,
  sceneId: command.sceneId,
  revision: context.revision,
  actor: clone(command.actor),
  occurredAt: context.occurredAt,
  trace: clone(command.trace),
})

const findMagneticField = (
  scene: PhysicsScene,
  fieldId: string,
): UniformMagneticField | undefined =>
  scene.fields.find(
    (field): field is UniformMagneticField =>
      field.id === fieldId && field.type === 'uniform_magnetic',
  )

const findElectricField = (
  scene: PhysicsScene,
  fieldId: string,
): UniformElectricField | undefined =>
  scene.fields.find(
    (field): field is UniformElectricField =>
      field.id === fieldId && field.type === 'uniform_electric',
  )

type CircuitComponentLookup =
  | { ok: true; circuit: Circuit; component: CircuitComponent }
  | { ok: false; error: DomainError }

const findCircuitComponent = (
  scene: PhysicsScene,
  circuitId: string,
  componentId: string,
): CircuitComponentLookup => {
  if (typeof circuitId !== 'string' || circuitId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_CIRCUIT_ID', 'circuitId must be a non-empty string.'),
    }
  }
  if (typeof componentId !== 'string' || componentId.length === 0) {
    return {
      ok: false,
      error: invalidCommand(
        'INVALID_CIRCUIT_COMPONENT_ID',
        'componentId must be a non-empty string.',
      ),
    }
  }
  const circuit = scene.circuits.find((entry) => entry.id === circuitId)
  if (circuit === undefined) return { ok: false, error: notFound('circuit', circuitId) }
  const component = circuit.components.find((entry) => String(entry.id) === componentId)
  if (component === undefined) {
    return { ok: false, error: notFound('circuit_component', componentId) }
  }
  return { ok: true, circuit, component }
}

type OpticalBenchLookup =
  | { ok: true; bench: OpticalBench }
  | { ok: false; error: DomainError }

const findOpticalBench = (scene: PhysicsScene, benchId: string): OpticalBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_OPTICAL_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = scene.opticalBenches.find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('optical_bench', benchId) }
  return { ok: true, bench }
}

type AcousticBenchLookup =
  | { ok: true; bench: AcousticBench }
  | { ok: false; error: DomainError }

const findAcousticBench = (scene: PhysicsScene, benchId: string): AcousticBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_ACOUSTIC_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = scene.acousticBenches.find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('acoustic_bench', benchId) }
  return { ok: true, bench }
}

type FluidTankLookup =
  | { ok: true; tank: FluidTank }
  | { ok: false; error: DomainError }

const findFluidTank = (scene: PhysicsScene, tankId: string): FluidTankLookup => {
  if (typeof tankId !== 'string' || tankId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_FLUID_TANK_ID', 'tankId must be a non-empty string.'),
    }
  }
  const tank = scene.fluidTanks.find((entry) => entry.id === tankId)
  if (tank === undefined) return { ok: false, error: notFound('fluid_tank', tankId) }
  return { ok: true, tank }
}

type ThermalBenchLookup =
  | { ok: true; bench: ThermalBench }
  | { ok: false; error: DomainError }

const findThermalBench = (scene: PhysicsScene, benchId: string): ThermalBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_THERMAL_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = scene.thermalBenches.find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('thermal_bench', benchId) }
  return { ok: true, bench }
}

type LeverLookup =
  | { ok: true; bench: LeverBench }
  | { ok: false; error: DomainError }

const findLever = (scene: PhysicsScene, leverId: string): LeverLookup => {
  if (typeof leverId !== 'string' || leverId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_LEVER_ID', 'leverId must be a non-empty string.'),
    }
  }
  const bench = (scene.leverBenches ?? []).find((entry) => entry.id === leverId)
  if (bench === undefined) return { ok: false, error: notFound('lever_bench', leverId) }
  return { ok: true, bench }
}

interface InductionLookup {
  ok: true
  bench: InductionBench
}
interface InductionLookupFailure {
  ok: false
  error: DomainError
}

const findInductionBench = (
  scene: PhysicsScene,
  benchId: string,
): InductionLookup | InductionLookupFailure => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_INDUCTION_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.inductionBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('induction_bench', benchId) }
  return { ok: true, bench }
}

type WaveBenchLookup =
  | { ok: true; bench: WaveBench }
  | { ok: false; error: DomainError }

const findWaveBench = (scene: PhysicsScene, benchId: string): WaveBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_WAVE_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.waveBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('wave_bench', benchId) }
  return { ok: true, bench }
}

const waveWrongSubmodel = (bench: WaveBench, message: string): DomainError =>
  invalidCommand('WAVE_WRONG_SUBMODEL', message, { benchId: bench.id, benchType: bench.type })

type PressureBenchLookup =
  | { ok: true; bench: PressureBench }
  | { ok: false; error: DomainError }

const findPressureBench = (scene: PhysicsScene, benchId: string): PressureBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_PRESSURE_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.pressureBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('pressure_bench', benchId) }
  return { ok: true, bench }
}

const pressureWrongSubmodel = (bench: PressureBench, message: string): DomainError =>
  invalidCommand('PRESSURE_WRONG_SUBMODEL', message, { benchId: bench.id, benchType: bench.type })

/**
 * Validate a pressure quantity against the sub-model and the magnitude it
 * requires. Depth and force may be zero — a probe level with the surface and a
 * slack contact are both real rigs — while densities, areas and pressures must
 * be strictly positive. `validateQuantity` already rejects a non-finite value
 * and a mismatched dimension; this adds the physical bound.
 */
const pressureQuantityOf = <D extends PhysicalDimension>(
  bench: PressureBench,
  value: Quantity,
  dimension: D,
  code: string,
  message: string,
  allowZero: boolean,
): { ok: true; value: Quantity<D> } | { ok: false; error: DomainError } => {
  const resolved = validateQuantity(value, dimension)
  const si = canonicalValue(resolved)
  if (!Number.isFinite(si) || (allowZero ? si < 0 : si <= 0)) {
    return { ok: false, error: invalidCommand(code, message, { benchId: bench.id, value }) }
  }
  return { ok: true, value: resolved }
}

type EnergyBenchLookup =
  | { ok: true; bench: EnergyBench }
  | { ok: false; error: DomainError }

const findEnergyBench = (scene: PhysicsScene, benchId: string): EnergyBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_ENERGY_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.energyBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('energy_bench', benchId) }
  return { ok: true, bench }
}

/**
 * Validate an energy-rig quantity. Mass and height must be strictly positive,
 * friction may be zero (a smooth ramp is the idealised rig) but not negative,
 * and the angle must be strictly inside (0°, 90°).
 */
const energyQuantityOf = <D extends PhysicalDimension>(
  bench: EnergyBench,
  value: Quantity,
  dimension: D,
  code: string,
  message: string,
  rule: 'positive' | 'non-negative' | 'interior-angle',
): { ok: true; value: Quantity<D> } | { ok: false; error: DomainError } => {
  const resolved = validateQuantity(value, dimension)
  const si = canonicalValue(resolved)
  const invalid =
    !Number.isFinite(si) ||
    (rule === 'positive' && si <= 0) ||
    (rule === 'non-negative' && si < 0) ||
    (rule === 'interior-angle' && (si <= 0 || si >= Math.PI / 2))
  if (invalid) {
    return { ok: false, error: invalidCommand(code, message, { benchId: bench.id, value }) }
  }
  return { ok: true, value: resolved }
}

type NoiseBenchLookup =
  | { ok: true; bench: NoiseBench }
  | { ok: false; error: DomainError }

const findNoiseBench = (scene: PhysicsScene, benchId: string): NoiseBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_NOISE_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.noiseBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('noise_bench', benchId) }
  return { ok: true, bench }
}

/**
 * Validate a noise-rig quantity. A source may be quiet (a negative power level
 * is a sound below the reference intensity) and a barrier may be absent
 * (attenuation 0 is the control case), while the distance must be positive.
 */
const noiseQuantityOf = <D extends PhysicalDimension>(
  bench: NoiseBench,
  value: Quantity,
  dimension: D,
  code: string,
  message: string,
  rule: 'finite' | 'positive' | 'non-negative',
): { ok: true; value: Quantity<D> } | { ok: false; error: DomainError } => {
  const resolved = validateQuantity(value, dimension)
  const si = canonicalValue(resolved)
  const invalid =
    !Number.isFinite(si) ||
    (rule === 'positive' && si <= 0) ||
    (rule === 'non-negative' && si < 0)
  if (invalid) {
    return { ok: false, error: invalidCommand(code, message, { benchId: bench.id, value }) }
  }
  return { ok: true, value: resolved }
}

type ThermometerBenchLookup =
  | { ok: true; bench: ThermometerBench }
  | { ok: false; error: DomainError }

const findThermometerBench = (
  scene: PhysicsScene,
  benchId: string,
): ThermometerBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_THERMOMETER_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.thermometerBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('thermometer_bench', benchId) }
  return { ok: true, bench }
}

/**
 * Validate a thermometer quantity. The bulb, the bore, the filling's expansion
 * coefficient and the ice-point length must all be strictly positive; the
 * TEMPERATURE may be anything finite — a thermometer below zero is still a
 * thermometer, and that is exactly the reading it exists to take.
 */
const thermometerQuantityOf = <D extends PhysicalDimension>(
  bench: ThermometerBench,
  value: Quantity,
  dimension: D,
  code: string,
  message: string,
  allowNegative: boolean,
): { ok: true; value: Quantity<D> } | { ok: false; error: DomainError } => {
  const resolved = validateQuantity(value, dimension)
  const si = canonicalValue(resolved)
  if (!Number.isFinite(si) || (!allowNegative && si <= 0)) {
    return { ok: false, error: invalidCommand(code, message, { benchId: bench.id, value }) }
  }
  return { ok: true, value: resolved }
}

type TransformerBenchLookup =
  | { ok: true; bench: TransformerBench }
  | { ok: false; error: DomainError }

const findTransformerBench = (
  scene: PhysicsScene,
  benchId: string,
): TransformerBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_TRANSFORMER_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.transformerBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('transformer_bench', benchId) }
  return { ok: true, bench }
}

/**
 * Validate a transformer quantity: both turn counts and the voltage must be
 * strictly positive, while the current may be zero — an open secondary draws
 * nothing, and that is a real rig rather than a missing value.
 */
const transformerQuantityOf = <D extends PhysicalDimension>(
  bench: TransformerBench,
  value: Quantity,
  dimension: D,
  code: string,
  message: string,
  allowZero: boolean,
): { ok: true; value: Quantity<D> } | { ok: false; error: DomainError } => {
  const resolved = validateQuantity(value, dimension)
  const si = canonicalValue(resolved)
  if (!Number.isFinite(si) || (allowZero ? si < 0 : si <= 0)) {
    return { ok: false, error: invalidCommand(code, message, { benchId: bench.id, value }) }
  }
  return { ok: true, value: resolved }
}

type LightBenchLookup =
  | { ok: true; bench: LightBench }
  | { ok: false; error: DomainError }

const findLightBench = (scene: PhysicsScene, benchId: string): LightBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_LIGHT_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.lightBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('light_bench', benchId) }
  return { ok: true, bench }
}

/** Every length on the light rig is simply positive: a zero would be no object. */
const lightQuantityOf = <D extends PhysicalDimension>(
  bench: LightBench,
  value: Quantity,
  dimension: D,
  code: string,
  message: string,
): { ok: true; value: Quantity<D> } | { ok: false; error: DomainError } => {
  const resolved = validateQuantity(value, dimension)
  const si = canonicalValue(resolved)
  if (!Number.isFinite(si) || si <= 0) {
    return { ok: false, error: invalidCommand(code, message, { benchId: bench.id, value }) }
  }
  return { ok: true, value: resolved }
}

type CurrentBenchLookup =
  | { ok: true; bench: CurrentBench }
  | { ok: false; error: DomainError }

const findCurrentBench = (scene: PhysicsScene, benchId: string): CurrentBenchLookup => {
  if (typeof benchId !== 'string' || benchId.length === 0) {
    return {
      ok: false,
      error: invalidCommand('INVALID_CURRENT_BENCH_ID', 'benchId must be a non-empty string.'),
    }
  }
  const bench = (scene.currentBenches ?? []).find((entry) => entry.id === benchId)
  if (bench === undefined) return { ok: false, error: notFound('current_bench', benchId) }
  return { ok: true, bench }
}

const currentWrongSubmodel = (bench: CurrentBench, message: string): DomainError =>
  invalidCommand('CURRENT_WRONG_SUBMODEL', message, { benchId: bench.id, benchType: bench.type })

/**
 * Validate a current-magnetic quantity against the rig and the magnitude it
 * requires. The current is signed — its sign is the direction, and a command
 * that rejected it could not reverse the field — while distances, turn counts
 * and coil lengths are strictly positive. Zero is refused wherever it means a
 * missing rig (a dead conductor, a coil of no turns), and the rotor's angle is
 * the one value that needs no bound at all: 0° is the strongest position it
 * has, 90° is the dead point, and past it is simply past it.
 */
const currentQuantityOf = <D extends PhysicalDimension>(
  bench: CurrentBench,
  value: Quantity,
  dimension: D,
  code: string,
  message: string,
  rule: 'signed-non-zero' | 'positive' | 'finite',
): { ok: true; value: Quantity<D> } | { ok: false; error: DomainError } => {
  const resolved = validateQuantity(value, dimension)
  const si = canonicalValue(resolved)
  const invalid =
    !Number.isFinite(si) ||
    (rule === 'positive' && si <= 0) ||
    (rule === 'signed-non-zero' && si === 0)
  if (invalid) {
    return { ok: false, error: invalidCommand(code, message, { benchId: bench.id, value }) }
  }
  return { ok: true, value: resolved }
}

/**
 * A standing wave's frequency is not a free parameter: the clamped string only
 * resonates at f_n = n·v/(2L). The bench keeps a `frequency` so every wave rig
 * exposes the same shape, so any edit to L, n or v must re-derive it or the
 * stored value would contradict the geometry it came from.
 */
const rederiveStandingFrequency = (bench: WaveBench): void => {
  if (bench.type !== 'standing') return
  if (bench.stringLength === undefined || bench.waveSpeed === undefined) return
  if (bench.harmonic === undefined) return
  const lengthSI = canonicalValue(bench.stringLength)
  const speedSI = canonicalValue(bench.waveSpeed)
  bench.frequency = quantity((bench.harmonic * speedSI) / (2 * lengthSI), 'Hz', 'frequency')
}

/**
 * On a rope or in a ripple tank the medium fixes the wave speed and the source
 * fixes the frequency; the wavelength is what follows (λ = v/f). The bench
 * stores λ and f, so an edit to either f or v re-derives λ from the speed the
 * medium had — raising the driving frequency shortens the wave, it never speeds
 * it up.
 */
const travellingSpeedOf = (bench: WaveBench): number | undefined => {
  if (bench.wavelength === undefined) return undefined
  const speed = canonicalValue(bench.wavelength) * canonicalValue(bench.frequency)
  return Number.isFinite(speed) && speed > 0 ? speed : undefined
}

const electricDirectionVector = (direction: ElectricFieldDirection) => {
  switch (direction) {
    case 'right':
      return { x: 1, y: 0, z: 0 }
    case 'left':
      return { x: -1, y: 0, z: 0 }
    case 'up':
      return { x: 0, y: 1, z: 0 }
    case 'down':
      return { x: 0, y: -1, z: 0 }
  }
}

const projectedDirectionIsSupported = (
  field: UniformMagneticField,
  tolerance: PhysicsTolerance,
): boolean => {
  const canonical = toCanonicalVector(field.magneticFluxDensity).vectorSI
  const magnitude = Math.hypot(canonical.x, canonical.y, canonical.z)
  if (withinTolerance(magnitude, 0, tolerance)) return true
  const inPlaneRatio = Math.hypot(canonical.x, canonical.y) / magnitude
  return Number.isFinite(inPlaneRatio) && inPlaneRatio <= tolerance.angular
}

const applyCommand = (
  scene: PhysicsScene,
  command: SceneCommand,
  context: EventContext,
  tolerance: PhysicsTolerance,
): ApplyCommandResult => {
  const eventMetadata = baseEvent(command, context)

  switch (command.type) {
    case 'SetParticleCharge': {
      if (
        typeof command.payload.particleId !== 'string' ||
        command.payload.particleId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand('INVALID_PARTICLE_ID', 'particleId must be a non-empty string.'),
        }
      }
      const particle = scene.particles.find((entry) => entry.id === command.payload.particleId)
      if (particle === undefined) {
        return { ok: false, error: notFound('particle', command.payload.particleId) }
      }
      const charge = validateQuantity(command.payload.charge, 'electric_charge')
      particle.charge = charge
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ParticleChargeChanged',
          payload: { particleId: command.payload.particleId, charge: clone(charge) },
        },
      }
    }

    case 'SetParticleMass': {
      if (
        typeof command.payload.particleId !== 'string' ||
        command.payload.particleId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand('INVALID_PARTICLE_ID', 'particleId must be a non-empty string.'),
        }
      }
      const particle = scene.particles.find((entry) => entry.id === command.payload.particleId)
      if (particle === undefined) {
        return { ok: false, error: notFound('particle', command.payload.particleId) }
      }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_PARTICLE_MASS',
            'Particle mass must be greater than zero.',
            { particleId: command.payload.particleId, mass: command.payload.mass },
          ),
        }
      }
      particle.mass = mass
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ParticleMassChanged',
          payload: { particleId: command.payload.particleId, mass: clone(mass) },
        },
      }
    }

    case 'SetParticleVelocity': {
      if (
        typeof command.payload.particleId !== 'string' ||
        command.payload.particleId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand('INVALID_PARTICLE_ID', 'particleId must be a non-empty string.'),
        }
      }
      const particle = scene.particles.find((entry) => entry.id === command.payload.particleId)
      if (particle === undefined) {
        return { ok: false, error: notFound('particle', command.payload.particleId) }
      }
      const velocity = quantityVector(
        clone(command.payload.velocity.vector),
        command.payload.velocity.unit,
        'velocity',
      )
      particle.velocity = velocity
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ParticleVelocityChanged',
          payload: { particleId: command.payload.particleId, velocity: clone(velocity) },
        },
      }
    }

    case 'SetMagneticFieldStrength': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      const field = findMagneticField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('magnetic_field', command.payload.fieldId) }
      }
      if (!projectedDirectionIsSupported(field, tolerance)) {
        return {
          ok: false,
          error: invalidCommand(
            'UNSUPPORTED_MAGNETIC_FIELD_DIRECTION',
            'The Magnetic Runtime only supports fields perpendicular to the xy plane.',
            { fieldId: command.payload.fieldId },
          ),
        }
      }
      const strength = validateQuantity(command.payload.strength, 'magnetic_flux_density')
      if (canonicalValue(strength) < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_MAGNETIC_FIELD_STRENGTH',
            'Magnetic field strength must be non-negative.',
            { fieldId: command.payload.fieldId, strength: command.payload.strength },
          ),
        }
      }
      const currentZ = toCanonicalVector(field.magneticFluxDensity).vectorSI.z
      const sign = currentZ < 0 ? -1 : 1
      field.magneticFluxDensity = quantityVector(
        { x: 0, y: 0, z: sign * Math.abs(strength.value) },
        strength.unit,
        'magnetic_flux_density',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'MagneticFieldStrengthChanged',
          payload: { fieldId: command.payload.fieldId, strength: clone(strength) },
        },
      }
    }

    case 'SetMagneticFieldDirection': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      if (
        command.payload.direction !== 'into_page' &&
        command.payload.direction !== 'out_of_page'
      ) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_MAGNETIC_FIELD_DIRECTION',
            'direction must be "into_page" or "out_of_page".',
          ),
        }
      }
      const field = findMagneticField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('magnetic_field', command.payload.fieldId) }
      }
      if (!projectedDirectionIsSupported(field, tolerance)) {
        return {
          ok: false,
          error: invalidCommand(
            'UNSUPPORTED_MAGNETIC_FIELD_DIRECTION',
            'The Magnetic Runtime only supports fields perpendicular to the xy plane.',
            { fieldId: command.payload.fieldId },
          ),
        }
      }
      const current = field.magneticFluxDensity
      const magnitude = Math.hypot(current.vector.x, current.vector.y, current.vector.z)
      const sign = command.payload.direction === 'into_page' ? -1 : 1
      field.magneticFluxDensity = quantityVector(
        { x: 0, y: 0, z: sign * magnitude },
        current.unit,
        'magnetic_flux_density',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'MagneticFieldDirectionChanged',
          payload: clone(command.payload),
        },
      }
    }

    case 'SetElectricFieldStrength': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      const field = findElectricField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('electric_field', command.payload.fieldId) }
      }
      const strength = validateQuantity(command.payload.strength, 'electric_field')
      if (canonicalValue(strength) < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ELECTRIC_FIELD_STRENGTH',
            'Electric field strength must be non-negative.',
            { fieldId: command.payload.fieldId, strength: command.payload.strength },
          ),
        }
      }
      const current = field.fieldStrength.vector
      const currentMagnitude = Math.hypot(current.x, current.y, current.z)
      const direction =
        currentMagnitude === 0
          ? electricDirectionVector('right')
          : {
              x: current.x / currentMagnitude,
              y: current.y / currentMagnitude,
              z: current.z / currentMagnitude,
            }
      field.fieldStrength = quantityVector(
        {
          x: direction.x * strength.value,
          y: direction.y * strength.value,
          z: direction.z * strength.value,
        },
        strength.unit,
        'electric_field',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ElectricFieldStrengthChanged',
          payload: { fieldId: command.payload.fieldId, strength: clone(strength) },
        },
      }
    }

    case 'SetElectricFieldDirection': {
      if (typeof command.payload.fieldId !== 'string' || command.payload.fieldId.length === 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_FIELD_ID', 'fieldId must be a non-empty string.'),
        }
      }
      const directions: readonly ElectricFieldDirection[] = ['right', 'left', 'up', 'down']
      if (!directions.includes(command.payload.direction)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ELECTRIC_FIELD_DIRECTION',
            'direction must be right, left, up or down.',
          ),
        }
      }
      const field = findElectricField(scene, command.payload.fieldId)
      if (field === undefined) {
        return { ok: false, error: notFound('electric_field', command.payload.fieldId) }
      }
      const current = field.fieldStrength
      const fieldMagnitude = Math.hypot(current.vector.x, current.vector.y, current.vector.z)
      const direction = electricDirectionVector(command.payload.direction)
      field.fieldStrength = quantityVector(
        {
          x: direction.x * fieldMagnitude,
          y: direction.y * fieldMagnitude,
          z: 0,
        },
        current.unit,
        'electric_field',
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ElectricFieldDirectionChanged',
          payload: clone(command.payload),
        },
      }
    }

    case 'SetObservableEnabled': {
      if (
        typeof command.payload.observableId !== 'string' ||
        command.payload.observableId.length === 0
      ) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OBSERVABLE_ID',
            'observableId must be a non-empty string.',
          ),
        }
      }
      if (typeof command.payload.enabled !== 'boolean') {
        return {
          ok: false,
          error: invalidCommand('INVALID_OBSERVABLE_ENABLED', 'enabled must be a boolean.'),
        }
      }
      const observable = scene.observableDefinitions.find(
        (entry) => entry.id === command.payload.observableId,
      )
      if (observable === undefined) {
        return { ok: false, error: notFound('observable', String(command.payload.observableId)) }
      }
      observable.visible = command.payload.enabled
      return command.payload.enabled
        ? {
            ok: true,
            event: {
              ...eventMetadata,
              type: 'ObservableEnabled',
              payload: { observableId: command.payload.observableId, enabled: true },
            },
          }
        : {
            ok: true,
            event: {
              ...eventMetadata,
              type: 'ObservableDisabled',
              payload: { observableId: command.payload.observableId, enabled: false },
            },
          }
    }

    /* ---------------------------------------------------------- mechanics -- */

    case 'SetBodyMass': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand('INVALID_BODY_MASS', 'Body mass must be greater than zero.', {
            bodyId: command.payload.bodyId,
            mass: command.payload.mass,
          }),
        }
      }
      body.mass = mass
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BodyMassChanged',
          payload: { bodyId: command.payload.bodyId, mass: clone(mass) },
        },
      }
    }

    case 'SetBodyPosition': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      const position = quantityVector(
        clone(command.payload.position.vector),
        command.payload.position.unit,
        'length',
      )
      body.position = position
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BodyPositionChanged',
          payload: { bodyId: command.payload.bodyId, position: clone(position) },
        },
      }
    }

    case 'SetBodyVelocity': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      const velocity = quantityVector(
        clone(command.payload.velocity.vector),
        command.payload.velocity.unit,
        'velocity',
      )
      body.velocity = velocity
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BodyVelocityChanged',
          payload: { bodyId: command.payload.bodyId, velocity: clone(velocity) },
        },
      }
    }

    case 'SetGravityAcceleration': {
      const field = scene.fields.find(
        (entry) => entry.id === command.payload.fieldId && entry.type === 'uniform_gravity',
      )
      if (field === undefined || field.type !== 'uniform_gravity') {
        return { ok: false, error: notFound('gravity_field', command.payload.fieldId) }
      }
      const acceleration = quantityVector(
        clone(command.payload.acceleration.vector),
        command.payload.acceleration.unit,
        'acceleration',
      )
      field.acceleration = acceleration
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'GravityAccelerationChanged',
          payload: { fieldId: command.payload.fieldId, acceleration: clone(acceleration) },
        },
      }
    }

    case 'SetInclineAngle': {
      /* A slope at 0° is a floor and at 90° a wall: neither is the inclined-plane
         model, so the gate rejects them instead of letting the solver work on a
         degenerate geometry. */
      const angle = command.payload.angleDegrees
      if (!Number.isFinite(angle) || angle <= 0 || angle >= 90) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INCLINE_ANGLE',
            'Incline angle must be strictly between 0 and 90 degrees.',
            { angleDegrees: angle },
          ),
        }
      }
      const observable = scene.observableDefinitions.find(
        (entry) => entry.id === command.payload.observableId,
      )
      if (observable === undefined) {
        return { ok: false, error: notFound('observable', String(command.payload.observableId)) }
      }
      observable.parameters = { ...observable.parameters, kind: 'incline', angle }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InclineAngleChanged',
          payload: { observableId: command.payload.observableId, angleDegrees: angle },
        },
      }
    }

    case 'SetFrictionCoefficient': {
      const coefficient = command.payload.coefficient
      if (!Number.isFinite(coefficient) || coefficient < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_FRICTION_COEFFICIENT',
            'Friction coefficient must be a non-negative finite number.',
            { coefficient },
          ),
        }
      }
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      body.material = { ...body.material, frictionCoefficient: coefficient }
      /* μ > 0 must be backed by a friction force in the scene, or the resolver
         would read a coefficient the model never actually applies. */
      const hasFriction = scene.forces.some(
        (entry) => entry.type === 'friction' && entry.targetId === body.id,
      )
      if (coefficient > 0 && !hasFriction) {
        scene.forces.push({
          id: `force-friction-${body.id}`,
          type: 'friction',
          targetId: body.id,
          model: 'kinetic_friction',
        })
      }
      if (coefficient === 0 && hasFriction) {
        scene.forces = scene.forces.filter(
          (entry) => !(entry.type === 'friction' && entry.targetId === body.id),
        )
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'FrictionCoefficientChanged',
          payload: { bodyId: command.payload.bodyId, coefficient },
        },
      }
    }

    case 'SetStaticFrictionCoefficient': {
      const coefficient = command.payload.coefficient
      if (!Number.isFinite(coefficient) || coefficient < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_FRICTION_COEFFICIENT',
            'Static friction coefficient must be a non-negative finite number.',
            { coefficient },
          ),
        }
      }
      const body = scene.bodies.find((entry) => entry.id === command.payload.bodyId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.bodyId) }
      }
      body.material = { ...body.material, staticFrictionCoefficient: coefficient }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'StaticFrictionCoefficientChanged',
          payload: { bodyId: command.payload.bodyId, coefficient },
        },
      }
    }

    case 'SetSpringConstant': {
      const constant = command.payload.constant
      if (!Number.isFinite(constant) || constant <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SPRING_CONSTANT',
            'Spring constant must be a positive finite number.',
            { constant },
          ),
        }
      }
      const spring = scene.constraints.find(
        (entry) => entry.id === command.payload.constraintId && entry.type === 'spring',
      )
      if (spring === undefined) {
        return { ok: false, error: notFound('constraint', command.payload.constraintId) }
      }
      spring.parameters = { ...spring.parameters, stiffness: constant }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SpringConstantChanged',
          payload: { constraintId: command.payload.constraintId, constant },
        },
      }
    }

    case 'SetPendulumLength': {
      const length = command.payload.length
      if (!Number.isFinite(length) || length <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_PENDULUM_LENGTH',
            'Pendulum length must be a positive finite number.',
            { length },
          ),
        }
      }
      const rope = scene.constraints.find(
        (entry) => entry.id === command.payload.constraintId && entry.type === 'rope',
      )
      if (rope === undefined) {
        return { ok: false, error: notFound('constraint', command.payload.constraintId) }
      }
      rope.parameters = { ...rope.parameters, length }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PendulumLengthChanged',
          payload: { constraintId: command.payload.constraintId, length },
        },
      }
    }

    case 'SetAppliedForce': {
      const body = scene.bodies.find((entry) => entry.id === command.payload.targetId)
      if (body === undefined) {
        return { ok: false, error: notFound('body', command.payload.targetId) }
      }
      const vector = quantityVector(
        clone(command.payload.vector.vector),
        command.payload.vector.unit,
        'force',
      )
      const existing = scene.forces.find((entry) => entry.id === command.payload.forceId)
      if (existing === undefined) {
        scene.forces.push({
          id: command.payload.forceId,
          type: 'custom',
          targetId: command.payload.targetId,
          vector,
          model: 'applied',
        })
      } else {
        existing.vector = vector
        existing.targetId = command.payload.targetId
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'AppliedForceChanged',
          payload: {
            forceId: command.payload.forceId,
            targetId: command.payload.targetId,
            vector: clone(vector),
          },
        },
      }
    }

    case 'SetGroundLevel': {
      const groundY = command.payload.groundY
      if (!Number.isFinite(groundY)) {
        return {
          ok: false,
          error: invalidCommand('INVALID_GROUND_LEVEL', 'Ground level must be finite.', { groundY }),
        }
      }
      const observable = scene.observableDefinitions.find(
        (entry) => entry.id === command.payload.observableId,
      )
      if (observable === undefined) {
        return { ok: false, error: notFound('observable', String(command.payload.observableId)) }
      }
      observable.parameters = { ...observable.parameters, kind: 'ground', groundY }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'GroundLevelChanged',
          payload: { observableId: command.payload.observableId, groundY },
        },
      }
    }

    /* ------------------------------------------------------------ circuit -- */

    case 'SetComponentResistance': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const resistance = validateQuantity(command.payload.resistance, 'resistance')
      if (!Number.isFinite(canonicalValue(resistance)) || canonicalValue(resistance) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_COMPONENT_RESISTANCE',
            'Resistance must be a positive finite quantity.',
            { componentId: command.payload.componentId, resistance: command.payload.resistance },
          ),
        }
      }
      const component = lookup.component
      if (component.type === 'resistor') {
        component.resistance = clone(resistance)
      } else if (component.type === 'variable_resistor') {
        component.totalResistance = clone(resistance)
      } else {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_RESISTIVE',
            'SetComponentResistance targets a resistor or a variable resistor.',
            { componentId: command.payload.componentId, componentType: component.type },
          ),
        }
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ComponentResistanceChanged',
          payload: {
            circuitId: command.payload.circuitId,
            componentId: command.payload.componentId,
            resistance: clone(resistance),
          },
        },
      }
    }

    case 'SetSourceVoltage': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'voltage_source') {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_VOLTAGE_SOURCE',
            'SetSourceVoltage targets a voltage source.',
            { componentId: command.payload.componentId, componentType: lookup.component.type },
          ),
        }
      }
      const voltage = validateQuantity(command.payload.voltage, 'electric_potential')
      if (!Number.isFinite(canonicalValue(voltage)) || canonicalValue(voltage) < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SOURCE_VOLTAGE',
            'Source voltage must be a non-negative finite quantity.',
            { componentId: command.payload.componentId, voltage: command.payload.voltage },
          ),
        }
      }
      lookup.component.voltage = clone(voltage)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SourceVoltageChanged',
          payload: {
            circuitId: command.payload.circuitId,
            componentId: command.payload.componentId,
            voltage: clone(voltage),
          },
        },
      }
    }

    case 'SetSourceInternalResistance': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'voltage_source') {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_VOLTAGE_SOURCE',
            'SetSourceInternalResistance targets a voltage source.',
            { componentId: command.payload.componentId, componentType: lookup.component.type },
          ),
        }
      }
      const internalResistance = validateQuantity(
        command.payload.internalResistance,
        'resistance',
      )
      if (
        !Number.isFinite(canonicalValue(internalResistance)) ||
        canonicalValue(internalResistance) < 0
      ) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SOURCE_INTERNAL_RESISTANCE',
            'Source internal resistance must be a non-negative finite quantity.',
            {
              componentId: command.payload.componentId,
              internalResistance: command.payload.internalResistance,
            },
          ),
        }
      }
      lookup.component.internalResistance = clone(internalResistance)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SourceInternalResistanceChanged',
          payload: {
            circuitId: command.payload.circuitId,
            componentId: command.payload.componentId,
            internalResistance: clone(internalResistance),
          },
        },
      }
    }

    case 'SetSwitchState': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'switch') {
        return {
          ok: false,
          error: invalidCommand('COMPONENT_NOT_SWITCH', 'SetSwitchState targets a switch.', {
            componentId: command.payload.componentId,
            componentType: lookup.component.type,
          }),
        }
      }
      if (command.payload.state !== 'open' && command.payload.state !== 'closed') {
        return {
          ok: false,
          error: invalidCommand('INVALID_SWITCH_STATE', 'state must be "open" or "closed".'),
        }
      }
      lookup.component.state = command.payload.state
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SwitchStateChanged',
          payload: clone(command.payload),
        },
      }
    }

    case 'SetSliderPosition': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.component.type !== 'variable_resistor') {
        return {
          ok: false,
          error: invalidCommand(
            'COMPONENT_NOT_VARIABLE_RESISTOR',
            'SetSliderPosition targets a variable resistor.',
            { componentId: command.payload.componentId, componentType: lookup.component.type },
          ),
        }
      }
      const position = command.payload.position
      if (!Number.isFinite(position) || position < 0 || position > 1) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SLIDER_POSITION',
            'Slider position must be a finite number between 0 and 1.',
            { position },
          ),
        }
      }
      lookup.component.sliderPosition = position
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SliderPositionChanged',
          payload: clone(command.payload),
        },
      }
    }

    case 'SetComponentPlacement': {
      const lookup = findCircuitComponent(
        scene,
        command.payload.circuitId,
        command.payload.componentId,
      )
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const { x, y, rotation } = command.payload
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_COMPONENT_PLACEMENT',
            'Component placement x and y must be finite numbers.',
            { x: command.payload.x, y: command.payload.y },
          ),
        }
      }
      if (
        rotation !== undefined &&
        rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270
      ) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_COMPONENT_ROTATION',
            'Component placement rotation must be a quarter turn: 0, 90, 180 or 270.',
            { rotation },
          ),
        }
      }
      /* Schematic dressing: the solver reads the netlist, not the layout — but
         the move still commits a revision so the arrangement persists and
         replays like any authored state. */
      circuitLayoutPlace(
        lookup.circuit,
        command.payload.componentId,
        rotation === undefined ? { x, y } : { x, y, rotation },
      )
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ComponentPlacementChanged',
          payload: clone(command.payload),
        },
      }
    }

    /* ------------------------------------------------------------- optics -- */

    case 'SetOpticalObjectPosition': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const position = validateQuantity(command.payload.position, 'length')
      const positionSI = canonicalValue(position)
      if (!Number.isFinite(positionSI)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_OBJECT_POSITION',
            'Optical object position must be a finite length.',
            { benchId: command.payload.benchId, position: command.payload.position },
          ),
        }
      }
      /* Light travels towards +x: an object at or past the imaging element has
         left the model, so the gate rejects it instead of letting the engine
         report a broken scene later. */
      const blockingElement = lookup.bench.elements.find(
        (element) => element.enabled !== false && positionSI >= canonicalValue(element.position),
      )
      if (blockingElement !== undefined) {
        return {
          ok: false,
          error: invalidCommand(
            'OPTICAL_OBJECT_BEHIND_ELEMENT',
            'The object must stay on the incoming side of the imaging element.',
            { benchId: command.payload.benchId, elementId: blockingElement.id },
          ),
        }
      }
      lookup.bench.object.position = clone(position)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'OpticalObjectPositionChanged',
          payload: { benchId: command.payload.benchId, position: clone(position) },
        },
      }
    }

    case 'SetOpticalObjectHeight': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const height = validateQuantity(command.payload.height, 'length')
      if (!Number.isFinite(canonicalValue(height)) || canonicalValue(height) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_OBJECT_HEIGHT',
            'Optical object height must be a positive finite length.',
            { benchId: command.payload.benchId, height: command.payload.height },
          ),
        }
      }
      lookup.bench.object.height = clone(height)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'OpticalObjectHeightChanged',
          payload: { benchId: command.payload.benchId, height: clone(height) },
        },
      }
    }

    case 'SetLensFocalLength': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (typeof command.payload.elementId !== 'string' || command.payload.elementId.length === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_ELEMENT_ID',
            'elementId must be a non-empty string.',
          ),
        }
      }
      const element = lookup.bench.elements.find(
        (entry) => entry.id === command.payload.elementId,
      )
      if (element === undefined) {
        return { ok: false, error: notFound('optical_element', command.payload.elementId) }
      }
      if (element.type !== 'thin_lens') {
        return {
          ok: false,
          error: invalidCommand(
            'ELEMENT_NOT_THIN_LENS',
            'SetLensFocalLength targets a thin lens.',
            { elementId: command.payload.elementId, elementType: element.type },
          ),
        }
      }
      const focalLength = validateQuantity(command.payload.focalLength, 'length')
      if (!Number.isFinite(canonicalValue(focalLength)) || canonicalValue(focalLength) === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_LENS_FOCAL_LENGTH',
            'Focal length must be a non-zero finite length.',
            { elementId: command.payload.elementId, focalLength: command.payload.focalLength },
          ),
        }
      }
      element.focalLength = clone(focalLength)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'LensFocalLengthChanged',
          payload: {
            benchId: command.payload.benchId,
            elementId: command.payload.elementId,
            focalLength: clone(focalLength),
          },
        },
      }
    }

    case 'SetMirrorFocalLength': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (typeof command.payload.elementId !== 'string' || command.payload.elementId.length === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_ELEMENT_ID',
            'elementId must be a non-empty string.',
          ),
        }
      }
      const element = lookup.bench.elements.find(
        (entry) => entry.id === command.payload.elementId,
      )
      if (element === undefined) {
        return { ok: false, error: notFound('optical_element', command.payload.elementId) }
      }
      if (element.type !== 'curved_mirror') {
        return {
          ok: false,
          error: invalidCommand(
            'ELEMENT_NOT_CURVED_MIRROR',
            'SetMirrorFocalLength targets a curved mirror.',
            { elementId: command.payload.elementId, elementType: element.type },
          ),
        }
      }
      const focalLength = validateQuantity(command.payload.focalLength, 'length')
      if (!Number.isFinite(canonicalValue(focalLength)) || canonicalValue(focalLength) === 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_MIRROR_FOCAL_LENGTH',
            'Focal length must be a non-zero finite length.',
            { elementId: command.payload.elementId, focalLength: command.payload.focalLength },
          ),
        }
      }
      element.focalLength = clone(focalLength)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'MirrorFocalLengthChanged',
          payload: {
            benchId: command.payload.benchId,
            elementId: command.payload.elementId,
            focalLength: clone(focalLength),
          },
        },
      }
    }

    case 'SetOpticalScreenPosition': {
      const lookup = findOpticalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.screen === undefined) {
        return {
          ok: false,
          error: notFound('optical_screen', command.payload.benchId),
        }
      }
      const position = validateQuantity(command.payload.position, 'length')
      if (!Number.isFinite(canonicalValue(position))) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_OPTICAL_SCREEN_POSITION',
            'Optical screen position must be a finite length.',
            { benchId: command.payload.benchId, position: command.payload.position },
          ),
        }
      }
      lookup.bench.screen.position = clone(position)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'OpticalScreenPositionChanged',
          payload: { benchId: command.payload.benchId, position: clone(position) },
        },
      }
    }

    /* ---------------------------------------------------------- acoustics -- */

    case 'SetAcousticReflectorPosition': {
      const lookup = findAcousticBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const position = validateQuantity(command.payload.position, 'length')
      const positionSI = canonicalValue(position)
      /* The pulse travels towards +x: a reflector at or behind the source has
         no echo path, so the gate rejects it here rather than letting the
         engine report a broken scene later. */
      if (!Number.isFinite(positionSI) || positionSI <= canonicalValue(lookup.bench.source.position)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ACOUSTIC_REFLECTOR_POSITION',
            'Reflector must sit a finite distance ahead of the sound source.',
            { benchId: command.payload.benchId, position: command.payload.position },
          ),
        }
      }
      lookup.bench.reflector.position = clone(position)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'AcousticReflectorPositionChanged',
          payload: { benchId: command.payload.benchId, position: clone(position) },
        },
      }
    }

    case 'SetAcousticSoundSpeed': {
      const lookup = findAcousticBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const soundSpeed = validateQuantity(command.payload.soundSpeed, 'velocity')
      if (!Number.isFinite(canonicalValue(soundSpeed)) || canonicalValue(soundSpeed) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_ACOUSTIC_SOUND_SPEED',
            'Sound speed must be a positive finite velocity.',
            { benchId: command.payload.benchId, soundSpeed: command.payload.soundSpeed },
          ),
        }
      }
      lookup.bench.soundSpeed = clone(soundSpeed)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'AcousticSoundSpeedChanged',
          payload: { benchId: command.payload.benchId, soundSpeed: clone(soundSpeed) },
        },
      }
    }

    /* -------------------------------------------------------- fluid statics -- */

    case 'SetLiquidDensity': {
      const lookup = findFluidTank(scene, command.payload.tankId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const density = validateQuantity(command.payload.density, 'density')
      if (!Number.isFinite(canonicalValue(density)) || canonicalValue(density) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_LIQUID_DENSITY',
            'Liquid density must be a positive finite density.',
            { tankId: command.payload.tankId, density: command.payload.density },
          ),
        }
      }
      lookup.tank.liquid.density = clone(density)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'LiquidDensityChanged',
          payload: { tankId: command.payload.tankId, density: clone(density) },
        },
      }
    }

    case 'SetBlockMass': {
      const lookup = findFluidTank(scene, command.payload.tankId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (!Number.isFinite(canonicalValue(mass)) || canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_BLOCK_MASS',
            'Block mass must be a positive finite mass.',
            { tankId: command.payload.tankId, mass: command.payload.mass },
          ),
        }
      }
      lookup.tank.block.mass = clone(mass)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BlockMassChanged',
          payload: { tankId: command.payload.tankId, mass: clone(mass) },
        },
      }
    }

    /* ------------------------------------------------------------- thermal -- */

    case 'SetHeaterPower': {
      const lookup = findThermalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const power = validateQuantity(command.payload.power, 'power')
      if (!Number.isFinite(canonicalValue(power)) || canonicalValue(power) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_HEATER_POWER',
            'Heater power must be a positive finite power.',
            { benchId: command.payload.benchId, power: command.payload.power },
          ),
        }
      }
      lookup.bench.heaterPower = clone(power)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'HeaterPowerChanged',
          payload: { benchId: command.payload.benchId, power: clone(power) },
        },
      }
    }

    case 'SetSampleMass': {
      const lookup = findThermalBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (!Number.isFinite(canonicalValue(mass)) || canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_SAMPLE_MASS',
            'Sample mass must be a positive finite mass.',
            { benchId: command.payload.benchId, mass: command.payload.mass },
          ),
        }
      }
      lookup.bench.sample.mass = clone(mass)
      if (lookup.bench.comparisonSample !== undefined) {
        lookup.bench.comparisonSample.mass = clone(mass)
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SampleMassChanged',
          payload: { benchId: command.payload.benchId, mass: clone(mass) },
        },
      }
    }

    /* --------------------------------------------------------------- lever -- */

    case 'SetHangerMass': {
      const lookup = findLever(scene, command.payload.leverId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const hanger = lookup.bench.hangers.find((entry) => entry.id === command.payload.hangerId)
      if (hanger === undefined) {
        return { ok: false, error: notFound('lever_hanger', command.payload.hangerId) }
      }
      const mass = validateQuantity(command.payload.mass, 'mass')
      if (!Number.isFinite(canonicalValue(mass)) || canonicalValue(mass) <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_HANGER_MASS',
            'Hanger mass must be a positive finite mass.',
            {
              leverId: command.payload.leverId,
              hangerId: command.payload.hangerId,
              mass: command.payload.mass,
            },
          ),
        }
      }
      hanger.mass = clone(mass)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'HangerMassChanged',
          payload: {
            leverId: command.payload.leverId,
            hangerId: command.payload.hangerId,
            mass: clone(mass),
          },
        },
      }
    }

    case 'SetHangerArm': {
      const lookup = findLever(scene, command.payload.leverId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const hanger = lookup.bench.hangers.find((entry) => entry.id === command.payload.hangerId)
      if (hanger === undefined) {
        return { ok: false, error: notFound('lever_hanger', command.payload.hangerId) }
      }
      const armLength = validateQuantity(command.payload.armLength, 'length')
      const armSI = canonicalValue(armLength)
      const halfBeam = canonicalValue(lookup.bench.beamLength) / 2
      if (!Number.isFinite(armSI) || armSI <= 0 || armSI > halfBeam) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_HANGER_ARM',
            'Hanger arm must be a positive finite length no longer than half the beam.',
            {
              leverId: command.payload.leverId,
              hangerId: command.payload.hangerId,
              armLength: command.payload.armLength,
            },
          ),
        }
      }
      hanger.armLength = clone(armLength)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'HangerArmChanged',
          payload: {
            leverId: command.payload.leverId,
            hangerId: command.payload.hangerId,
            armLength: clone(armLength),
          },
        },
      }
    }

    case 'SetInductionFieldStrength': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const strength = validateQuantity(command.payload.strength, 'magnetic_flux_density')
      const strengthSI = canonicalValue(strength)
      if (!Number.isFinite(strengthSI) || strengthSI <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_FIELD',
            'Magnetic flux density must be a positive finite value.',
            { benchId: command.payload.benchId, strength: command.payload.strength },
          ),
        }
      }
      lookup.bench.magneticFluxDensity = clone(strength)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionFieldStrengthChanged',
          payload: { benchId: command.payload.benchId, strength: clone(strength) },
        },
      }
    }

    case 'SetInductionLoopResistance': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const resistance = validateQuantity(command.payload.resistance, 'resistance')
      const resistanceSI = canonicalValue(resistance)
      if (!Number.isFinite(resistanceSI) || resistanceSI <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_RESISTANCE',
            'Loop resistance must be a positive finite value.',
            { benchId: command.payload.benchId, resistance: command.payload.resistance },
          ),
        }
      }
      lookup.bench.resistance = clone(resistance)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionLoopResistanceChanged',
          payload: { benchId: command.payload.benchId, resistance: clone(resistance) },
        },
      }
    }

    case 'SetInductionBarVelocity': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'bar_motion') {
        return {
          ok: false,
          error: invalidCommand(
            'INDUCTION_WRONG_SUBMODEL',
            'Bar velocity can only be set on a bar_motion bench.',
            { benchId: command.payload.benchId, benchType: lookup.bench.type },
          ),
        }
      }
      const velocity = validateQuantity(command.payload.velocity, 'velocity')
      const velocitySI = canonicalValue(velocity)
      if (!Number.isFinite(velocitySI)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_BAR_VELOCITY',
            'Rod velocity must be finite.',
            { benchId: command.payload.benchId, velocity: command.payload.velocity },
          ),
        }
      }
      if (lookup.bench.barVelocity !== undefined) {
        lookup.bench.barVelocity = clone(velocity)
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionBarVelocityChanged',
          payload: { benchId: command.payload.benchId, velocity: clone(velocity) },
        },
      }
    }

    case 'SetInductionBarLength': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'bar_motion' && lookup.bench.type !== 'double_bar_rail') {
        return {
          ok: false,
          error: invalidCommand(
            'INDUCTION_WRONG_SUBMODEL',
            'Bar length can only be set on a bar_motion or double_bar_rail bench.',
            { benchId: command.payload.benchId, benchType: lookup.bench.type },
          ),
        }
      }
      const length = validateQuantity(command.payload.length, 'length')
      const lengthSI = canonicalValue(length)
      if (!Number.isFinite(lengthSI) || lengthSI <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_BAR_LENGTH',
            'Rod length must be a positive finite length.',
            { benchId: command.payload.benchId, length: command.payload.length },
          ),
        }
      }
      if (lookup.bench.barLength !== undefined) {
        lookup.bench.barLength = clone(length)
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionBarLengthChanged',
          payload: { benchId: command.payload.benchId, length: clone(length) },
        },
      }
    }

    case 'SetInductionFluxRate': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'flux_change') {
        return {
          ok: false,
          error: invalidCommand(
            'INDUCTION_WRONG_SUBMODEL',
            'Flux rate can only be set on a flux_change bench.',
            { benchId: command.payload.benchId, benchType: lookup.bench.type },
          ),
        }
      }
      const fluxRate = validateQuantity(command.payload.fluxRate, 'magnetic_flux_rate')
      const fluxRateSI = canonicalValue(fluxRate)
      if (!Number.isFinite(fluxRateSI)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_FLUX_RATE',
            'Flux rate dΦ/dt must be finite.',
            { benchId: command.payload.benchId, fluxRate: command.payload.fluxRate },
          ),
        }
      }
      if (lookup.bench.fluxRate !== undefined) {
        lookup.bench.fluxRate = clone(fluxRate)
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionFluxRateChanged',
          payload: { benchId: command.payload.benchId, fluxRate: clone(fluxRate) },
        },
      }
    }

    case 'SetInductionBarMasses': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'double_bar_rail') {
        return {
          ok: false,
          error: invalidCommand(
            'INDUCTION_WRONG_SUBMODEL',
            'Bar masses can only be set on a double_bar_rail bench.',
            { benchId: command.payload.benchId, benchType: lookup.bench.type },
          ),
        }
      }
      const masses = [
        validateQuantity(command.payload.masses[0], 'mass'),
        validateQuantity(command.payload.masses[1], 'mass'),
      ] as [Quantity<'mass'>, Quantity<'mass'>]
      const massesSI = masses.map((mass) => canonicalValue(mass))
      if (!Number.isFinite(massesSI[0]) || !Number.isFinite(massesSI[1]) || massesSI[0]! <= 0 || massesSI[1]! <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_BAR_MASSES',
            'Each bar mass must be a positive finite mass.',
            { benchId: command.payload.benchId, masses: command.payload.masses },
          ),
        }
      }
      lookup.bench.barMasses = [clone(masses[0]), clone(masses[1])]
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionBarMassesChanged',
          payload: { benchId: command.payload.benchId, masses },
        },
      }
    }

    case 'SetInductionBarVelocityOne': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'double_bar_rail') {
        return {
          ok: false,
          error: invalidCommand(
            'INDUCTION_WRONG_SUBMODEL',
            'Per-bar velocity can only be set on a double_bar_rail bench.',
            { benchId: command.payload.benchId, benchType: lookup.bench.type },
          ),
        }
      }
      const velocity = validateQuantity(command.payload.velocity, 'velocity')
      const velocitySI = canonicalValue(velocity)
      if (!Number.isFinite(velocitySI)) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_BAR_VELOCITY_ONE',
            'Bar velocity must be finite.',
            { benchId: command.payload.benchId, barIndex: command.payload.barIndex, velocity: command.payload.velocity },
          ),
        }
      }
      const index = command.payload.barIndex === 1 ? 0 : 1
      const current = lookup.bench.barVelocities ?? [
        quantity(0, 'm/s', 'velocity'),
        quantity(0, 'm/s', 'velocity'),
      ]
      lookup.bench.barVelocities = [
        clone(index === 0 ? velocity : current[0]),
        clone(index === 1 ? velocity : current[1]),
      ]
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionBarVelocityOneChanged',
          payload: { benchId: command.payload.benchId, barIndex: command.payload.barIndex, velocity: clone(velocity) },
        },
      }
    }

    case 'SetInductionExternalForce': {
      const lookup = findInductionBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'double_bar_rail') {
        return {
          ok: false,
          error: invalidCommand(
            'INDUCTION_WRONG_SUBMODEL',
            'The external force can only be set on a double_bar_rail bench.',
            { benchId: command.payload.benchId, benchType: lookup.bench.type },
          ),
        }
      }
      const force = validateQuantity(command.payload.force, 'force')
      const forceSI = canonicalValue(force)
      if (!Number.isFinite(forceSI) || forceSI < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INDUCTION_EXTERNAL_FORCE',
            'The external force must be a finite value ≥ 0.',
            { benchId: command.payload.benchId, force: command.payload.force },
          ),
        }
      }
      lookup.bench.externalForce = clone(force)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'InductionExternalForceChanged',
          payload: { benchId: command.payload.benchId, force: clone(force) },
        },
      }
    }

    case 'SetWaveAmplitude': {
      const lookup = findWaveBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const amplitude = validateQuantity(command.payload.amplitude, 'length')
      const amplitudeSI = canonicalValue(amplitude)
      if (!Number.isFinite(amplitudeSI) || amplitudeSI <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_WAVE_AMPLITUDE',
            'Wave amplitude must be a positive finite length.',
            { benchId: command.payload.benchId, amplitude: command.payload.amplitude },
          ),
        }
      }
      lookup.bench.amplitude = clone(amplitude)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'WaveAmplitudeChanged',
          payload: { benchId: command.payload.benchId, amplitude: clone(amplitude) },
        },
      }
    }

    case 'SetWaveFrequency': {
      const lookup = findWaveBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type === 'standing') {
        return {
          ok: false,
          error: waveWrongSubmodel(
            lookup.bench,
            'A standing wave resonates at f_n = n·v/(2L); edit the string length, harmonic or wave speed instead of the frequency.',
          ),
        }
      }
      const frequency = validateQuantity(command.payload.frequency, 'frequency')
      const frequencySI = canonicalValue(frequency)
      if (!Number.isFinite(frequencySI) || frequencySI <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_WAVE_FREQUENCY',
            'Wave frequency must be a positive finite value.',
            { benchId: command.payload.benchId, frequency: command.payload.frequency },
          ),
        }
      }
      const mediumSpeed = travellingSpeedOf(lookup.bench)
      if (mediumSpeed !== undefined) {
        lookup.bench.wavelength = quantity(mediumSpeed / frequencySI, 'm', 'length')
      }
      lookup.bench.frequency = clone(frequency)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'WaveFrequencyChanged',
          payload: { benchId: command.payload.benchId, frequency: clone(frequency) },
        },
      }
    }

    case 'SetWaveSpeed': {
      const lookup = findWaveBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const speed = validateQuantity(command.payload.speed, 'velocity')
      const speedSI = canonicalValue(speed)
      if (!Number.isFinite(speedSI) || speedSI <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_WAVE_SPEED',
            'Wave speed must be a positive finite value.',
            { benchId: command.payload.benchId, speed: command.payload.speed },
          ),
        }
      }
      if (lookup.bench.type === 'standing') {
        /* The string keeps its geometry; a stiffer medium raises every harmonic. */
        lookup.bench.waveSpeed = clone(speed)
        rederiveStandingFrequency(lookup.bench)
      } else {
        /* A new medium at the same driving frequency: λ = v/f. */
        const frequencySI = canonicalValue(lookup.bench.frequency)
        if (!Number.isFinite(frequencySI) || frequencySI <= 0) {
          return {
            ok: false,
            error: invalidCommand(
              'INVALID_WAVE_FREQUENCY',
              'The bench frequency must be positive before the wave speed can set λ = v/f.',
              { benchId: command.payload.benchId, frequency: lookup.bench.frequency },
            ),
          }
        }
        lookup.bench.wavelength = quantity(speedSI / frequencySI, 'm', 'length')
      }
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'WaveSpeedChanged',
          payload: { benchId: command.payload.benchId, speed: clone(speed) },
        },
      }
    }

    case 'SetWavePathDifference': {
      const lookup = findWaveBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'interference' || lookup.bench.pathOne === undefined) {
        return {
          ok: false,
          error: waveWrongSubmodel(
            lookup.bench,
            'Path difference can only be set on an interference bench.',
          ),
        }
      }
      const pathDifference = validateQuantity(command.payload.pathDifference, 'length')
      const pathDifferenceSI = canonicalValue(pathDifference)
      if (!Number.isFinite(pathDifferenceSI) || pathDifferenceSI < 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_WAVE_PATH_DIFFERENCE',
            'Path difference must be a finite length ≥ 0.',
            {
              benchId: command.payload.benchId,
              pathDifference: command.payload.pathDifference,
            },
          ),
        }
      }
      /* No point in the plane is farther from one source than from the other by
         more than the source separation (triangle inequality), so such a Δ is
         refused here rather than handed to the engine as an unreachable rig. */
      const separationSI =
        lookup.bench.sourceSeparation === undefined
          ? Number.POSITIVE_INFINITY
          : canonicalValue(lookup.bench.sourceSeparation)
      if (pathDifferenceSI > separationSI * (1 + 1e-9)) {
        return {
          ok: false,
          error: invalidCommand(
            'WAVE_PATH_DIFFERENCE_UNREACHABLE',
            'Path difference cannot exceed the source separation: |r₂ − r₁| ≤ d.',
            {
              benchId: command.payload.benchId,
              pathDifference: command.payload.pathDifference,
              sourceSeparation: lookup.bench.sourceSeparation,
            },
          ),
        }
      }
      /* The bench stores the two path lengths, not Δ. Keep source 1 where it is
         and move the observation point along path 2 so Δ = r₂ − r₁ exactly. */
      const pathOneSI = canonicalValue(lookup.bench.pathOne)
      lookup.bench.pathTwo = quantity(pathOneSI + pathDifferenceSI, 'm', 'length')
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'WavePathDifferenceChanged',
          payload: {
            benchId: command.payload.benchId,
            pathDifference: clone(pathDifference),
          },
        },
      }
    }

    case 'SetWaveStringLength': {
      const lookup = findWaveBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'standing') {
        return {
          ok: false,
          error: waveWrongSubmodel(
            lookup.bench,
            'String length can only be set on a standing bench.',
          ),
        }
      }
      const stringLength = validateQuantity(command.payload.stringLength, 'length')
      const stringLengthSI = canonicalValue(stringLength)
      if (!Number.isFinite(stringLengthSI) || stringLengthSI <= 0) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_WAVE_STRING_LENGTH',
            'String length must be a positive finite length.',
            { benchId: command.payload.benchId, stringLength: command.payload.stringLength },
          ),
        }
      }
      lookup.bench.stringLength = clone(stringLength)
      rederiveStandingFrequency(lookup.bench)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'WaveStringLengthChanged',
          payload: { benchId: command.payload.benchId, stringLength: clone(stringLength) },
        },
      }
    }

    case 'SetWaveHarmonic': {
      const lookup = findWaveBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'standing') {
        return {
          ok: false,
          error: waveWrongSubmodel(
            lookup.bench,
            'Harmonic number can only be set on a standing bench.',
          ),
        }
      }
      const harmonic = command.payload.harmonic
      if (typeof harmonic !== 'number' || !Number.isInteger(harmonic) || harmonic < 1) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_WAVE_HARMONIC',
            'Harmonic number must be an integer ≥ 1.',
            { benchId: command.payload.benchId, harmonic },
          ),
        }
      }
      lookup.bench.harmonic = harmonic
      rederiveStandingFrequency(lookup.bench)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'WaveHarmonicChanged',
          payload: { benchId: command.payload.benchId, harmonic },
        },
      }
    }

    case 'SetPressureForce': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'solid') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A contact force can only be set on a solid pressure bench.',
          ),
        }
      }
      const force = pressureQuantityOf(
        lookup.bench,
        command.payload.force,
        'force',
        'INVALID_PRESSURE_FORCE',
        'Contact force must be a finite force ≥ 0.',
        true,
      )
      if (!force.ok) return { ok: false, error: force.error }
      lookup.bench.force = clone(force.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureForceChanged',
          payload: { benchId: command.payload.benchId, force: clone(force.value) },
        },
      }
    }

    case 'SetPressureContactArea': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'solid') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A contact area can only be set on a solid pressure bench.',
          ),
        }
      }
      const area = pressureQuantityOf(
        lookup.bench,
        command.payload.area,
        'area',
        'INVALID_PRESSURE_AREA',
        'Contact area must be a finite area > 0.',
        false,
      )
      if (!area.ok) return { ok: false, error: area.error }
      lookup.bench.area = clone(area.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureContactAreaChanged',
          payload: { benchId: command.payload.benchId, area: clone(area.value) },
        },
      }
    }

    case 'SetPressureComparisonArea': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'solid') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A comparison contact area can only be set on a solid pressure bench.',
          ),
        }
      }
      const area = pressureQuantityOf(
        lookup.bench,
        command.payload.area,
        'area',
        'INVALID_PRESSURE_COMPARISON_AREA',
        'Comparison contact area must be a finite area > 0.',
        false,
      )
      if (!area.ok) return { ok: false, error: area.error }
      lookup.bench.comparisonArea = clone(area.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureComparisonAreaChanged',
          payload: { benchId: command.payload.benchId, area: clone(area.value) },
        },
      }
    }

    case 'SetPressureLiquidDensity': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'liquid') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A liquid density can only be set on a liquid pressure bench.',
          ),
        }
      }
      const density = pressureQuantityOf(
        lookup.bench,
        command.payload.density,
        'density',
        'INVALID_PRESSURE_LIQUID_DENSITY',
        'Liquid density must be a finite density > 0.',
        false,
      )
      if (!density.ok) return { ok: false, error: density.error }
      lookup.bench.liquidDensity = clone(density.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureLiquidDensityChanged',
          payload: { benchId: command.payload.benchId, density: clone(density.value) },
        },
      }
    }

    case 'SetPressureProbeDepth': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'liquid') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A probe depth can only be set on a liquid pressure bench.',
          ),
        }
      }
      const depth = pressureQuantityOf(
        lookup.bench,
        command.payload.depth,
        'length',
        'INVALID_PRESSURE_DEPTH',
        'Probe depth must be a finite length ≥ 0.',
        true,
      )
      if (!depth.ok) return { ok: false, error: depth.error }
      lookup.bench.depth = clone(depth.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureProbeDepthChanged',
          payload: { benchId: command.payload.benchId, depth: clone(depth.value) },
        },
      }
    }

    case 'SetPressureComparisonDepth': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'liquid') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A comparison depth can only be set on a liquid pressure bench.',
          ),
        }
      }
      const depth = pressureQuantityOf(
        lookup.bench,
        command.payload.depth,
        'length',
        'INVALID_PRESSURE_COMPARISON_DEPTH',
        'Comparison depth must be a finite length ≥ 0.',
        true,
      )
      if (!depth.ok) return { ok: false, error: depth.error }
      lookup.bench.comparisonDepth = clone(depth.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureComparisonDepthChanged',
          payload: { benchId: command.payload.benchId, depth: clone(depth.value) },
        },
      }
    }

    case 'SetPressureComparisonLiquidDensity': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'liquid') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A comparison liquid density can only be set on a liquid pressure bench.',
          ),
        }
      }
      const density = pressureQuantityOf(
        lookup.bench,
        command.payload.density,
        'density',
        'INVALID_PRESSURE_COMPARISON_LIQUID_DENSITY',
        'Comparison liquid density must be a finite density > 0.',
        false,
      )
      if (!density.ok) return { ok: false, error: density.error }
      lookup.bench.comparisonLiquidDensity = clone(density.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureComparisonLiquidDensityChanged',
          payload: { benchId: command.payload.benchId, density: clone(density.value) },
        },
      }
    }

    case 'SetPressureAtmospheric': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'atmospheric') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'An atmospheric pressure can only be set on an atmospheric pressure bench.',
          ),
        }
      }
      const pressure = pressureQuantityOf(
        lookup.bench,
        command.payload.pressure,
        'pressure',
        'INVALID_PRESSURE_ATMOSPHERIC',
        'Atmospheric pressure must be a finite pressure > 0.',
        false,
      )
      if (!pressure.ok) return { ok: false, error: pressure.error }
      lookup.bench.atmosphericPressure = clone(pressure.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureAtmosphericChanged',
          payload: { benchId: command.payload.benchId, pressure: clone(pressure.value) },
        },
      }
    }

    case 'SetPressureBarometerFluidDensity': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'atmospheric') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A barometer filling can only be set on an atmospheric pressure bench.',
          ),
        }
      }
      const density = pressureQuantityOf(
        lookup.bench,
        command.payload.density,
        'density',
        'INVALID_PRESSURE_BAROMETER_FLUID_DENSITY',
        'Barometer fluid density must be a finite density > 0.',
        false,
      )
      if (!density.ok) return { ok: false, error: density.error }
      lookup.bench.barometerFluidDensity = clone(density.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureBarometerFluidDensityChanged',
          payload: { benchId: command.payload.benchId, density: clone(density.value) },
        },
      }
    }

    case 'SetPressureHemisphereRadius': {
      const lookup = findPressureBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'atmospheric') {
        return {
          ok: false,
          error: pressureWrongSubmodel(
            lookup.bench,
            'A hemisphere radius can only be set on an atmospheric pressure bench.',
          ),
        }
      }
      const radius = pressureQuantityOf(
        lookup.bench,
        command.payload.radius,
        'length',
        'INVALID_PRESSURE_HEMISPHERE_RADIUS',
        'Hemisphere radius must be a finite length > 0.',
        false,
      )
      if (!radius.ok) return { ok: false, error: radius.error }
      lookup.bench.hemisphereRadius = clone(radius.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PressureHemisphereRadiusChanged',
          payload: { benchId: command.payload.benchId, radius: clone(radius.value) },
        },
      }
    }

    /* ------------------------------------------------ current-magnetic -- */

    case 'SetCurrent': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const current = currentQuantityOf(
        lookup.bench,
        command.payload.current,
        'electric_current',
        'INVALID_CURRENT_VALUE',
        'Current must be a finite current that is not zero.',
        'signed-non-zero',
      )
      if (!current.ok) return { ok: false, error: current.error }
      lookup.bench.current = clone(current.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'CurrentFieldChanged',
          payload: { benchId: command.payload.benchId, current: clone(current.value) },
        },
      }
    }

    case 'SetProbeDistance': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'straight_wire') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'A probe distance can only be set on a straight-wire bench.',
          ),
        }
      }
      const distance = currentQuantityOf(
        lookup.bench,
        command.payload.distance,
        'length',
        'INVALID_PROBE_DISTANCE',
        'Probe distance must be a finite length > 0.',
        'positive',
      )
      if (!distance.ok) return { ok: false, error: distance.error }
      lookup.bench.probeDistance = clone(distance.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ProbeDistanceChanged',
          payload: { benchId: command.payload.benchId, distance: clone(distance.value) },
        },
      }
    }

    case 'SetComparisonProbeDistance': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'straight_wire') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'A comparison probe distance can only be set on a straight-wire bench.',
          ),
        }
      }
      const distance = currentQuantityOf(
        lookup.bench,
        command.payload.distance,
        'length',
        'INVALID_COMPARISON_PROBE_DISTANCE',
        'Comparison probe distance must be a finite length > 0.',
        'positive',
      )
      if (!distance.ok) return { ok: false, error: distance.error }
      lookup.bench.comparisonDistance = clone(distance.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ComparisonProbeDistanceChanged',
          payload: { benchId: command.payload.benchId, distance: clone(distance.value) },
        },
      }
    }

    case 'SetSolenoidTurns': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type === 'straight_wire') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            /* An electromagnet IS a solenoid with a core, so a turn count is one
               of its facts too — only the bare conductor has no winding. */
            'A turn count can only be set on a bench with a winding (solenoid or electromagnet).',
          ),
        }
      }
      const turns = currentQuantityOf(
        lookup.bench,
        command.payload.turns,
        'dimensionless',
        'INVALID_SOLENOID_TURNS',
        'Turn count must be a finite number of turns > 0.',
        'positive',
      )
      if (!turns.ok) return { ok: false, error: turns.error }
      lookup.bench.turns = clone(turns.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SolenoidTurnsChanged',
          payload: { benchId: command.payload.benchId, turns: clone(turns.value) },
        },
      }
    }

    case 'SetSolenoidComparisonTurns': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type === 'straight_wire') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'A comparison turn count can only be set on a bench with a winding (solenoid or electromagnet).',
          ),
        }
      }
      const turns = currentQuantityOf(
        lookup.bench,
        command.payload.turns,
        'dimensionless',
        'INVALID_SOLENOID_COMPARISON_TURNS',
        'Comparison turn count must be a finite number of turns > 0.',
        'positive',
      )
      if (!turns.ok) return { ok: false, error: turns.error }
      lookup.bench.comparisonTurns = clone(turns.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SolenoidComparisonTurnsChanged',
          payload: { benchId: command.payload.benchId, turns: clone(turns.value) },
        },
      }
    }

    case 'SetSolenoidLength': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type === 'straight_wire') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'A coil length can only be set on a bench with a winding (solenoid or electromagnet).',
          ),
        }
      }
      const length = currentQuantityOf(
        lookup.bench,
        command.payload.length,
        'length',
        'INVALID_SOLENOID_LENGTH',
        'Coil length must be a finite length > 0.',
        'positive',
      )
      if (!length.ok) return { ok: false, error: length.error }
      lookup.bench.coilLength = clone(length.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SolenoidLengthChanged',
          payload: { benchId: command.payload.benchId, length: clone(length.value) },
        },
      }
    }

    case 'SetCorePermeability': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'electromagnet') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'Only an electromagnet bench has a core to set.',
          ),
        }
      }
      const permeability = currentQuantityOf(
        lookup.bench,
        command.payload.relativePermeability,
        'dimensionless',
        'INVALID_CORE_PERMEABILITY',
        'Core permeability must be a finite number > 0 (1 is the air-cored coil).',
        'positive',
      )
      if (!permeability.ok) return { ok: false, error: permeability.error }
      lookup.bench.coreRelativePermeability = clone(permeability.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'CorePermeabilityChanged',
          payload: {
            benchId: command.payload.benchId,
            relativePermeability: clone(permeability.value),
          },
        },
      }
    }

    case 'SetComparisonCorePermeability': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'electromagnet') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'Only an electromagnet bench has a second core to set.',
          ),
        }
      }
      const permeability = currentQuantityOf(
        lookup.bench,
        command.payload.relativePermeability,
        'dimensionless',
        'INVALID_COMPARISON_CORE_PERMEABILITY',
        'Comparison core permeability must be a finite number > 0.',
        'positive',
      )
      if (!permeability.ok) return { ok: false, error: permeability.error }
      lookup.bench.comparisonCoreRelativePermeability = clone(permeability.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ComparisonCorePermeabilityChanged',
          payload: {
            benchId: command.payload.benchId,
            relativePermeability: clone(permeability.value),
          },
        },
      }
    }

    case 'SetCoreArea': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'electromagnet') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'Only an electromagnet bench has a pole face to measure.',
          ),
        }
      }
      const area = currentQuantityOf(
        lookup.bench,
        command.payload.area,
        'area',
        'INVALID_CORE_AREA',
        'Pole-face area must be a finite area > 0.',
        'positive',
      )
      if (!area.ok) return { ok: false, error: area.error }
      lookup.bench.coreArea = clone(area.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'CoreAreaChanged',
          payload: { benchId: command.payload.benchId, area: clone(area.value) },
        },
      }
    }

    /* ------------------------------------------------------------- motor -- */

    case 'SetRotorField': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'motor') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'Only a motor bench has a stator field to set.',
          ),
        }
      }
      const field = currentQuantityOf(
        lookup.bench,
        command.payload.field,
        'magnetic_flux_density',
        'INVALID_ROTOR_FIELD',
        'Stator field must be a finite flux density > 0.',
        'positive',
      )
      if (!field.ok) return { ok: false, error: field.error }
      lookup.bench.magneticFluxDensity = clone(field.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'RotorFieldChanged',
          payload: { benchId: command.payload.benchId, field: clone(field.value) },
        },
      }
    }

    case 'SetRotorSideLength': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'motor') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'Only a motor bench has rotor sides to measure.',
          ),
        }
      }
      const length = currentQuantityOf(
        lookup.bench,
        command.payload.length,
        'length',
        'INVALID_ROTOR_SIDE',
        'Rotor side length must be a finite length > 0.',
        'positive',
      )
      if (!length.ok) return { ok: false, error: length.error }
      lookup.bench.sideLength = clone(length.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'RotorSideLengthChanged',
          payload: { benchId: command.payload.benchId, length: clone(length.value) },
        },
      }
    }

    case 'SetRotorCoilWidth': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'motor') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'Only a motor bench has a rotor width to measure.',
          ),
        }
      }
      const width = currentQuantityOf(
        lookup.bench,
        command.payload.width,
        'length',
        'INVALID_ROTOR_WIDTH',
        'Rotor width must be a finite length > 0.',
        'positive',
      )
      if (!width.ok) return { ok: false, error: width.error }
      lookup.bench.coilWidth = clone(width.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'RotorCoilWidthChanged',
          payload: { benchId: command.payload.benchId, width: clone(width.value) },
        },
      }
    }

    case 'SetRotorAngle': {
      const lookup = findCurrentBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'motor') {
        return {
          ok: false,
          error: currentWrongSubmodel(
            lookup.bench,
            'Only a motor bench has a rotor angle to set.',
          ),
        }
      }
      /* `signed-non-zero` would be wrong here: 0° is the coil lying along the
         field, which is the strongest position the rig has. */
      const angle = currentQuantityOf(
        lookup.bench,
        command.payload.angle,
        'angle',
        'INVALID_ROTOR_ANGLE',
        'Rotor angle must be a finite angle.',
        'finite',
      )
      if (!angle.ok) return { ok: false, error: angle.error }
      lookup.bench.coilAngle = clone(angle.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'RotorAngleChanged',
          payload: { benchId: command.payload.benchId, angle: clone(angle.value) },
        },
      }
    }

    /* ------------------------------------------------- mechanical energy -- */

    case 'SetEnergyMass': {
      const lookup = findEnergyBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const mass = energyQuantityOf(
        lookup.bench,
        command.payload.mass,
        'mass',
        'INVALID_ENERGY_MASS',
        'Cart mass must be a finite mass > 0.',
        'positive',
      )
      if (!mass.ok) return { ok: false, error: mass.error }
      lookup.bench.mass = clone(mass.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'EnergyMassChanged',
          payload: { benchId: command.payload.benchId, mass: clone(mass.value) },
        },
      }
    }

    case 'SetReleaseHeight': {
      const lookup = findEnergyBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const height = energyQuantityOf(
        lookup.bench,
        command.payload.height,
        'length',
        'INVALID_RELEASE_HEIGHT',
        'Release height must be a finite length > 0.',
        'positive',
      )
      if (!height.ok) return { ok: false, error: height.error }
      lookup.bench.releaseHeight = clone(height.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ReleaseHeightChanged',
          payload: { benchId: command.payload.benchId, height: clone(height.value) },
        },
      }
    }

    case 'SetRampAngle': {
      const lookup = findEnergyBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const angle = energyQuantityOf(
        lookup.bench,
        command.payload.angle,
        'angle',
        'INVALID_RAMP_ANGLE',
        'Ramp angle must be strictly between 0° and 90°.',
        'interior-angle',
      )
      if (!angle.ok) return { ok: false, error: angle.error }
      lookup.bench.inclineAngle = clone(angle.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'RampAngleChanged',
          payload: { benchId: command.payload.benchId, angle: clone(angle.value) },
        },
      }
    }

    case 'SetRampFriction': {
      const lookup = findEnergyBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      /* Zero is the idealised ramp — the rig 机械能守恒 is stated about — so it is
         accepted; a negative coefficient is not a surface. */
      const coefficient = energyQuantityOf(
        lookup.bench,
        command.payload.coefficient,
        'dimensionless',
        'INVALID_RAMP_FRICTION',
        'Friction coefficient must be a finite number ≥ 0.',
        'non-negative',
      )
      if (!coefficient.ok) return { ok: false, error: coefficient.error }
      lookup.bench.frictionCoefficient = clone(coefficient.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'RampFrictionChanged',
          payload: { benchId: command.payload.benchId, coefficient: clone(coefficient.value) },
        },
      }
    }

    /* ---------------------------------------------------- light on a hole -- */

    case 'SetObjectHeight': {
      const lookup = findLightBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const height = lightQuantityOf(
        lookup.bench,
        command.payload.height,
        'length',
        'INVALID_OBJECT_HEIGHT',
        'Object height must be a finite length > 0.',
      )
      if (!height.ok) return { ok: false, error: height.error }
      lookup.bench.objectHeight = clone(height.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ObjectHeightChanged',
          payload: { benchId: command.payload.benchId, height: clone(height.value) },
        },
      }
    }

    case 'SetObjectDistance': {
      const lookup = findLightBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const distance = lightQuantityOf(
        lookup.bench,
        command.payload.distance,
        'length',
        'INVALID_OBJECT_DISTANCE',
        'Object distance must be a finite length > 0.',
      )
      if (!distance.ok) return { ok: false, error: distance.error }
      lookup.bench.objectDistance = clone(distance.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ObjectDistanceChanged',
          payload: { benchId: command.payload.benchId, distance: clone(distance.value) },
        },
      }
    }

    case 'SetScreenDistance': {
      const lookup = findLightBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const distance = lightQuantityOf(
        lookup.bench,
        command.payload.distance,
        'length',
        'INVALID_SCREEN_DISTANCE',
        'Screen distance must be a finite length > 0.',
      )
      if (!distance.ok) return { ok: false, error: distance.error }
      lookup.bench.screenDistance = clone(distance.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ScreenDistanceChanged',
          payload: { benchId: command.payload.benchId, distance: clone(distance.value) },
        },
      }
    }

    /* ---------------------------------------------------------- refraction -- */

    case 'SetIncidentIndex': {
      const lookup = findLightBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'total_reflection') {
        return {
          ok: false,
          error: invalidCommand(
            'LIGHT_WRONG_SUBMODEL',
            'Only a refraction bench has a pair of refractive indices.',
            { benchId: lookup.bench.id, benchType: lookup.bench.type },
          ),
        }
      }
      const index = lightQuantityOf(
        lookup.bench,
        command.payload.index,
        'dimensionless',
        'INVALID_INCIDENT_INDEX',
        'Incident refractive index must be finite and >= 1.',
      )
      if (!index.ok) return { ok: false, error: index.error }
      lookup.bench.incidentIndex = clone(index.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'IncidentIndexChanged',
          payload: { benchId: command.payload.benchId, index: clone(index.value) },
        },
      }
    }

    case 'SetRefractedIndex': {
      const lookup = findLightBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'total_reflection') {
        return {
          ok: false,
          error: invalidCommand(
            'LIGHT_WRONG_SUBMODEL',
            'Only a refraction bench has a pair of refractive indices.',
            { benchId: lookup.bench.id, benchType: lookup.bench.type },
          ),
        }
      }
      const index = lightQuantityOf(
        lookup.bench,
        command.payload.index,
        'dimensionless',
        'INVALID_REFRACTED_INDEX',
        'Refracted refractive index must be finite and > 0.',
      )
      if (!index.ok) return { ok: false, error: index.error }
      lookup.bench.refractedIndex = clone(index.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'RefractedIndexChanged',
          payload: { benchId: command.payload.benchId, index: clone(index.value) },
        },
      }
    }

    case 'SetIncidentAngle': {
      const lookup = findLightBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      if (lookup.bench.type !== 'total_reflection') {
        return {
          ok: false,
          error: invalidCommand(
            'LIGHT_WRONG_SUBMODEL',
            'Only a refraction bench has an angle of incidence.',
            { benchId: lookup.bench.id, benchType: lookup.bench.type },
          ),
        }
      }
      /* 90° is refused: grazing incidence has no refracted branch to speak of,
         and the model's own domain is [0, 90). */
      const angle = lightQuantityOf(
        lookup.bench,
        command.payload.angle,
        'angle',
        'INVALID_INCIDENT_ANGLE',
        'Angle of incidence must be a finite angle in [0, 90) degrees.',
      )
      if (!angle.ok) return { ok: false, error: angle.error }
      if (canonicalValue(angle.value) >= Math.PI / 2) {
        return {
          ok: false,
          error: invalidCommand(
            'INVALID_INCIDENT_ANGLE',
            'Angle of incidence must be strictly below 90 degrees.',
            { benchId: lookup.bench.id, value: command.payload.angle },
          ),
        }
      }
      lookup.bench.incidentAngle = clone(angle.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'IncidentAngleChanged',
          payload: { benchId: command.payload.benchId, angle: clone(angle.value) },
        },
      }
    }

    /* ------------------------------------------------------- transformer -- */

    case 'SetTransformerVoltage': {
      const lookup = findTransformerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const voltage = transformerQuantityOf(
        lookup.bench,
        command.payload.voltage,
        'electric_potential',
        'INVALID_TRANSFORMER_VOLTAGE',
        'Primary voltage must be a finite voltage > 0.',
        false,
      )
      if (!voltage.ok) return { ok: false, error: voltage.error }
      lookup.bench.primaryVoltage = clone(voltage.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'TransformerVoltageChanged',
          payload: { benchId: command.payload.benchId, voltage: clone(voltage.value) },
        },
      }
    }

    case 'SetTransformerCurrent': {
      const lookup = findTransformerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      /* Zero is the open secondary: a real rig with nothing plugged in. */
      const current = transformerQuantityOf(
        lookup.bench,
        command.payload.current,
        'electric_current',
        'INVALID_TRANSFORMER_CURRENT',
        'Primary current must be a finite current >= 0.',
        true,
      )
      if (!current.ok) return { ok: false, error: current.error }
      lookup.bench.primaryCurrent = clone(current.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'TransformerCurrentChanged',
          payload: { benchId: command.payload.benchId, current: clone(current.value) },
        },
      }
    }

    case 'SetPrimaryTurns': {
      const lookup = findTransformerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const turns = transformerQuantityOf(
        lookup.bench,
        command.payload.turns,
        'dimensionless',
        'INVALID_PRIMARY_TURNS',
        'Primary turns must be a finite count > 0.',
        false,
      )
      if (!turns.ok) return { ok: false, error: turns.error }
      lookup.bench.primaryTurns = clone(turns.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'PrimaryTurnsChanged',
          payload: { benchId: command.payload.benchId, turns: clone(turns.value) },
        },
      }
    }

    case 'SetSecondaryTurns': {
      const lookup = findTransformerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const turns = transformerQuantityOf(
        lookup.bench,
        command.payload.turns,
        'dimensionless',
        'INVALID_SECONDARY_TURNS',
        'Secondary turns must be a finite count > 0.',
        false,
      )
      if (!turns.ok) return { ok: false, error: turns.error }
      lookup.bench.secondaryTurns = clone(turns.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'SecondaryTurnsChanged',
          payload: { benchId: command.payload.benchId, turns: clone(turns.value) },
        },
      }
    }

    /* ------------------------------------------------------- thermometer -- */

    case 'SetThermometerTemperature': {
      const lookup = findThermometerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      /* Negative is fine: below zero is a temperature, not a missing value. */
      const temperature = thermometerQuantityOf(
        lookup.bench,
        command.payload.temperature,
        'temperature',
        'INVALID_THERMOMETER_TEMPERATURE',
        'Temperature must be a finite temperature.',
        true,
      )
      if (!temperature.ok) return { ok: false, error: temperature.error }
      lookup.bench.temperature = clone(temperature.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ThermometerTemperatureChanged',
          payload: { benchId: command.payload.benchId, temperature: clone(temperature.value) },
        },
      }
    }

    case 'SetThermometerBore': {
      const lookup = findThermometerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const diameter = thermometerQuantityOf(
        lookup.bench,
        command.payload.diameter,
        'length',
        'INVALID_THERMOMETER_BORE',
        'Bore diameter must be a finite length > 0.',
        false,
      )
      if (!diameter.ok) return { ok: false, error: diameter.error }
      lookup.bench.boreDiameter = clone(diameter.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ThermometerBoreChanged',
          payload: { benchId: command.payload.benchId, diameter: clone(diameter.value) },
        },
      }
    }

    case 'SetFillingLiquid': {
      const lookup = findThermometerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const coefficient = thermometerQuantityOf(
        lookup.bench,
        command.payload.coefficient,
        'dimensionless',
        'INVALID_FILLING_LIQUID',
        'Expansion coefficient must be finite and > 0 (units: 1/K).',
        false,
      )
      if (!coefficient.ok) return { ok: false, error: coefficient.error }
      lookup.bench.expansionCoefficient = clone(coefficient.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'FillingLiquidChanged',
          payload: { benchId: command.payload.benchId, coefficient: clone(coefficient.value) },
        },
      }
    }

    case 'SetThermometerBulb': {
      const lookup = findThermometerBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const volume = thermometerQuantityOf(
        lookup.bench,
        command.payload.volume,
        'volume',
        'INVALID_THERMOMETER_BULB',
        'Bulb volume must be a finite volume > 0.',
        false,
      )
      if (!volume.ok) return { ok: false, error: volume.error }
      lookup.bench.bulbVolume = clone(volume.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ThermometerBulbChanged',
          payload: { benchId: command.payload.benchId, volume: clone(volume.value) },
        },
      }
    }

    /* -------------------------------------------------------------- noise -- */

    case 'SetNoiseSourceLevel': {
      const lookup = findNoiseBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const level = noiseQuantityOf(
        lookup.bench,
        command.payload.level,
        'dimensionless',
        'INVALID_NOISE_SOURCE_LEVEL',
        'Sound power level must be a finite number of decibels.',
        'finite',
      )
      if (!level.ok) return { ok: false, error: level.error }
      lookup.bench.soundPowerLevel = clone(level.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'NoiseSourceLevelChanged',
          payload: { benchId: command.payload.benchId, level: clone(level.value) },
        },
      }
    }

    case 'SetListenerDistance': {
      const lookup = findNoiseBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      const distance = noiseQuantityOf(
        lookup.bench,
        command.payload.distance,
        'length',
        'INVALID_LISTENER_DISTANCE',
        'Listener distance must be a finite length > 0.',
        'positive',
      )
      if (!distance.ok) return { ok: false, error: distance.error }
      lookup.bench.distance = clone(distance.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'ListenerDistanceChanged',
          payload: { benchId: command.payload.benchId, distance: clone(distance.value) },
        },
      }
    }

    case 'SetBarrierAttenuation': {
      const lookup = findNoiseBench(scene, command.payload.benchId)
      if (!lookup.ok) return { ok: false, error: lookup.error }
      /* Zero is no barrier at all — the control the barrier is measured against. */
      const attenuation = noiseQuantityOf(
        lookup.bench,
        command.payload.attenuation,
        'dimensionless',
        'INVALID_BARRIER_ATTENUATION',
        'Barrier attenuation must be a finite number of decibels >= 0.',
        'non-negative',
      )
      if (!attenuation.ok) return { ok: false, error: attenuation.error }
      lookup.bench.barrierAttenuation = clone(attenuation.value)
      return {
        ok: true,
        event: {
          ...eventMetadata,
          type: 'BarrierAttenuationChanged',
          payload: { benchId: command.payload.benchId, attenuation: clone(attenuation.value) },
        },
      }
    }
  }
}

const errorFromUnknown = (error: unknown): DomainError => {
  if (error instanceof PhysicsOSError) {
    return domainError(error.code, error.message, 'validation', { details: error.details })
  }
  if (error instanceof Error) {
    return domainError('SCENE_COMMAND_EXECUTION_FAILED', error.message, 'internal')
  }
  return domainError(
    'SCENE_COMMAND_EXECUTION_FAILED',
    'Scene command execution failed with an unknown error.',
    'internal',
  )
}

/**
 * Minimal in-memory store for the current scene and its successful mutation
 * events. Public reads are cloned so callers cannot bypass the command gate.
 */
export class SceneStore {
  private currentScene: PhysicsScene
  private readonly events: PhysicsEvent[] = []
  private readonly tolerance: PhysicsTolerance
  private readonly now: () => IsoDateTime
  private readonly eventIdFactory: NonNullable<SceneRuntimeOptions['eventIdFactory']>

  constructor(initialScene: PhysicsScene, options: SceneRuntimeOptions = {}) {
    this.currentScene = clone(initialScene)
    this.tolerance = options.tolerance ?? DEFAULT_TOLERANCE
    this.now = options.now ?? (() => new Date().toISOString())
    this.eventIdFactory = options.eventIdFactory ?? defaultEventIdFactory
  }

  getScene(): PhysicsScene {
    return clone(this.currentScene)
  }

  getEvents(): readonly PhysicsEvent[] {
    return clone(this.events)
  }

  execute(command: SceneCommand): SceneCommandResult {
    const traceId = command.trace.traceId

    if (command.schemaVersion !== SCENE_COMMAND_SCHEMA) {
      return commandFailure(
        invalidCommand(
          'INVALID_SCENE_COMMAND_SCHEMA',
          `Expected command schema "${SCENE_COMMAND_SCHEMA}".`,
          { received: command.schemaVersion },
        ),
        traceId,
      )
    }
    if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) {
      return commandFailure(
        invalidCommand(
          'INVALID_EXPECTED_REVISION',
          'expectedRevision must be a non-negative integer.',
          { expectedRevision: command.expectedRevision },
        ),
        traceId,
      )
    }
    if (!isIsoDateTime(command.issuedAt)) {
      return commandFailure(
        invalidCommand('INVALID_COMMAND_TIMESTAMP', 'issuedAt must be a valid ISO date-time.'),
        traceId,
      )
    }
    if (command.sceneId !== this.currentScene.id) {
      return commandFailure(
        invalidCommand('SCENE_ID_MISMATCH', 'Command sceneId does not match the current scene.', {
          commandSceneId: command.sceneId,
          currentSceneId: this.currentScene.id,
        }),
        traceId,
      )
    }
    if (command.expectedRevision !== this.currentScene.revision) {
      return commandFailure(
        domainError(
          SCENE_REVISION_CONFLICT,
          `Expected scene revision ${command.expectedRevision}, current revision is ${this.currentScene.revision}.`,
          'conflict',
          {
            retryable: true,
            details: {
              expectedRevision: command.expectedRevision,
              currentRevision: this.currentScene.revision,
            },
          },
        ),
        traceId,
      )
    }

    try {
      const previousRevision = this.currentScene.revision
      const newRevision = previousRevision + 1
      const nextScene = clone(this.currentScene)
      const occurredAt = this.now()
      if (!isIsoDateTime(occurredAt)) {
        return commandFailure(
          domainError(
            'INVALID_EVENT_TIMESTAMP',
            'Scene Runtime clock returned an invalid ISO date-time.',
            'internal',
          ),
          traceId,
        )
      }
      const eventId = this.eventIdFactory(command.sceneId, newRevision, command.commandId)
      const applied = applyCommand(
        nextScene,
        command,
        { eventId, occurredAt, revision: newRevision },
        this.tolerance,
      )
      if (!applied.ok) return commandFailure(applied.error, traceId)

      nextScene.revision = newRevision
      nextScene.metadata.updatedAt = occurredAt
      const verification = validateScene(nextScene)
      if (verification.status === 'failed') {
        return commandFailure(
          domainError(
            'SCENE_VALIDATION_FAILED',
            'Command would produce an invalid PhysicsScene.',
            'validation',
            { details: { errors: verification.errors } },
          ),
          traceId,
        )
      }

      this.currentScene = nextScene
      this.events.push(applied.event)

      return {
        ok: true,
        sceneId: this.currentScene.id,
        previousRevision,
        newRevision,
        eventIds: [applied.event.eventId],
        traceId,
      }
    } catch (error: unknown) {
      return commandFailure(errorFromUnknown(error), traceId)
    }
  }
}

/** Runtime name retained for orchestration consumers; storage semantics live in the base class. */
export class SceneRuntime extends SceneStore {}
