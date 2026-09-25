import type { QuantityVector } from '@physicsos/physics-core'
import type { Quantity } from '@physicsos/physics-units'
import type {
  IsoDateTime,
  ObservableId,
  QuestionId,
  SceneId,
  ComponentId,
} from '@physicsos/shared'
import type { ActorRef } from '@physicsos/physics-core'
import type { Vector3 } from '@physicsos/physics-math'

/** docs/03 §21 */
export type SceneDimension = '2d' | '3d'

/** docs/03 §22 */
export interface CoordinateSystem {
  type: 'cartesian'
  origin: Vector3
  axes: {
    x: Vector3
    y: Vector3
    z: Vector3
  }
  lengthUnit: string
}

/** docs/03 §23 */
export type TimelineState = 'idle' | 'running' | 'paused' | 'completed' | 'error'

/** docs/03 §24 */
export interface Timeline {
  currentTime: Quantity<'time'>
  startTime: Quantity<'time'>
  endTime?: Quantity<'time'>
  state: TimelineState
  playbackRate: number
  simulationTimeStep?: Quantity<'time'>
}

/** docs/03 §25 — provenance of a scene that was forked from another one. */
export interface SceneLineage {
  /** Where the parent scene came from. */
  origin: 'question' | 'template' | 'blank'
  /** Only an `experimental` branch may diverge from a question's stated facts. */
  branchType: 'experimental'
  /** Question the ORIGINAL scene was built from, carried through the fork. */
  originQuestionId?: QuestionId
  /** Scene id of the untouched original, so the UI can offer a way back. */
  originSceneId: SceneId
  /** Immediate parent; equal to `originSceneId` for a first-level branch. */
  parentSceneId: SceneId
  /** Parent revision at the moment of the fork. */
  parentRevision: number
  forkedAt: IsoDateTime
}

/** docs/03 §25 */
export interface SceneMetadata {
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  createdBy?: ActorRef
  title?: string
  description?: string
  curriculumTags?: string[]
  knowledgeTags?: string[]
  sourceQuestionId?: QuestionId
  engineVersion?: string
  /**
   * Present only on a forked scene.
   *
   * A question's conditions are stated FACTS, so exploring "what if h were 30 m"
   * must not mutate the scene the solution was verified against. The fork carries
   * its provenance here instead of introducing a second scene contract.
   */
  lineage?: SceneLineage
}

/** docs/03 §28 */
export interface PhysicsObjectBase {
  id: string
  name?: string
  enabled?: boolean
  tags?: string[]
  metadata?: Record<string, unknown>
}

/** docs/03 §29 — shape definitions for bodies and regions. */
export type ShapeDefinition =
  | { type: 'circle'; radius: Quantity<'length'> }
  | { type: 'rectangle'; width: Quantity<'length'>; height: Quantity<'length'> }
  | { type: 'polygon'; vertices: QuantityVector<'length'>[] }
  | { type: 'segment'; start: QuantityVector<'length'>; end: QuantityVector<'length'> }
  | { type: 'point' }

/** docs/03 §30 */
export interface MaterialDefinition {
  density?: Quantity<'density'>
  /** Kinetic coefficient μk — the friction while the body slides. */
  frictionCoefficient?: number
  /** Static limit coefficient μs ≥ μk — the pull a resting body withstands. */
  staticFrictionCoefficient?: number
  restitution?: number
  custom?: Record<string, unknown>
}

/** docs/03 §31 */
export interface Body extends PhysicsObjectBase {
  type: 'rigid_body'
  mass: Quantity<'mass'>
  position: QuantityVector<'length'>
  velocity: QuantityVector<'velocity'>
  acceleration?: QuantityVector<'acceleration'>
  shape: ShapeDefinition
  material?: MaterialDefinition
  fixed?: boolean
}

/** docs/03 §32 */
export interface Particle extends PhysicsObjectBase {
  type: 'particle'
  mass: Quantity<'mass'>
  charge?: Quantity<'electric_charge'>
  position: QuantityVector<'length'>
  velocity: QuantityVector<'velocity'>
  acceleration?: QuantityVector<'acceleration'>
  species?: string
  /**
   * Held in place by the model.
   *
   * A source point charge produces a field but does not itself accelerate in the
   * V1 electric slice, so the engine needs to know which particles are sources
   * rather than inferring it from "has a field pointing at me".
   */
  fixed?: boolean
}

/** docs/03 §34 */
export interface FieldBase extends PhysicsObjectBase {
  regionId?: string
}

/** docs/03 §35 */
export interface UniformElectricField extends FieldBase {
  type: 'uniform_electric'
  fieldStrength: QuantityVector<'electric_field'>
}

/** docs/03 §36 */
export interface UniformMagneticField extends FieldBase {
  type: 'uniform_magnetic'
  magneticFluxDensity: QuantityVector<'magnetic_flux_density'>
}

/** docs/03 §37 */
export interface GravityField extends FieldBase {
  type: 'uniform_gravity'
  acceleration: QuantityVector<'acceleration'>
}

/** docs/03 §38 */
export interface PointChargeField extends FieldBase {
  type: 'point_charge'
  sourceParticleId: string
}

/** docs/03 §39 — full union, even though only magnetic is implemented this slice. */
export type Field =
  | UniformElectricField
  | UniformMagneticField
  | GravityField
  | PointChargeField

/** docs/03 §43 — minimal shapes for this slice; full union per docs/03. */
export type RegionShape =
  | { type: 'rectangle'; width: Quantity<'length'>; height: Quantity<'length'> }
  | { type: 'circle'; radius: Quantity<'length'> }
  | { type: 'polygon'; vertices: QuantityVector<'length'>[] }
  | { type: 'half_plane'; normal: Vector3; offset: Quantity<'length'> }
  | { type: 'unbounded' }

/** docs/03 §44 */
export interface Region extends PhysicsObjectBase {
  shape: RegionShape
  center: QuantityVector<'length'>
}

/** docs/03 §65 */
export type ObservableType =
  | 'force'
  | 'velocity'
  | 'acceleration'
  | 'momentum'
  | 'trajectory'
  | 'electric_field'
  | 'electric_potential'
  | 'magnetic_field'
  | 'energy'
  | 'current'
  | 'voltage'
  | 'measurement'
  | 'graph'
  | 'geometry'
  | 'annotation'

/** docs/03 §67 — semantic style only; no renderer objects in the domain. */
export interface ObservationStyle {
  emphasis?: 'normal' | 'highlight'
  labelVisible?: boolean
  scale?: number
  token?: string
}

/** docs/03 §66 */
export interface ObservableDefinition {
  id: ObservableId
  type: ObservableType
  targetId?: string
  visible: boolean
  style?: ObservationStyle
  parameters?: Record<string, unknown>
}

/** docs/03 §40 */
export type ForceType =
  | 'gravity'
  | 'normal'
  | 'friction'
  | 'tension'
  | 'spring'
  | 'electric'
  | 'lorentz'
  | 'ampere'
  | 'drag'
  | 'custom'

/** docs/03 §41 */
export interface Force extends PhysicsObjectBase {
  type: ForceType
  targetId: string
  sourceId?: string
  vector?: QuantityVector<'force'>
  derived?: boolean
  model?: string
}

/** docs/03 §45 */
export type BoundaryType =
  | 'line'
  | 'segment'
  | 'circle'
  | 'rectangle'
  | 'polygon'

/** docs/03 §46 */
export interface Boundary extends PhysicsObjectBase {
  type: BoundaryType
  geometry: ShapeDefinition
  behavior?: BoundaryBehavior
}

/** docs/03 §47 */
export type BoundaryBehavior =
  | { type: 'pass_through' }
  | { type: 'reflect'; restitution?: number }
  | { type: 'stop' }
  | { type: 'custom'; model: string }

/** docs/03 §48 */
export type ConstraintType =
  | 'fixed'
  | 'distance'
  | 'rope'
  | 'hinge'
  | 'surface'
  | 'spring'
  | 'track'
  | 'custom'

/** docs/03 §49 */
export interface Constraint extends PhysicsObjectBase {
  type: ConstraintType
  targets: string[]
  parameters: Record<string, unknown>
}

/** docs/03 §51 */
export interface CircuitNode {
  id: string
  label?: string
}

/** docs/03 §52 */
export interface CircuitTerminal {
  id: string
  componentId: ComponentId
  terminalKey: string
}

/** docs/03 §53 */
export interface CircuitConnection {
  id: string
  from: CircuitTerminal
  to: CircuitTerminal
}

/** docs/03 §54 */
export interface CircuitComponentBase {
  id: ComponentId
  name?: string
  enabled?: boolean
}

/** docs/03 §55 */
export interface Resistor extends CircuitComponentBase {
  type: 'resistor'
  resistance: Quantity<'resistance'>
}

/** docs/03 §56 */
export interface VoltageSource extends CircuitComponentBase {
  type: 'voltage_source'
  voltage: Quantity<'electric_potential'>
  internalResistance?: Quantity<'resistance'>
}

/** docs/03 §57 */
export interface CircuitSwitch extends CircuitComponentBase {
  type: 'switch'
  state: 'open' | 'closed'
}

/** docs/03 §58 */
export interface Ammeter extends CircuitComponentBase {
  type: 'ammeter'
  internalResistance?: Quantity<'resistance'>
}

/** docs/03 §59 */
export interface Voltmeter extends CircuitComponentBase {
  type: 'voltmeter'
  internalResistance?: Quantity<'resistance'>
}

/** docs/03 §60 */
export interface VariableResistor extends CircuitComponentBase {
  type: 'variable_resistor'
  totalResistance: Quantity<'resistance'>
  sliderPosition: number
}

/** docs/03 §61 */
export interface Capacitor extends CircuitComponentBase {
  type: 'capacitor'
  capacitance: Quantity<'capacitance'>
  initialVoltage?: Quantity<'electric_potential'>
}

/** docs/03 §62 */
export interface Inductor extends CircuitComponentBase {
  type: 'inductor'
  inductance: Quantity<'inductance'>
}

/** docs/03 §63 */
export type CircuitComponent =
  | Resistor
  | VoltageSource
  | CircuitSwitch
  | Ammeter
  | Voltmeter
  | VariableResistor
  | Capacitor
  | Inductor

/** docs/03 §50 */
export interface Circuit extends PhysicsObjectBase {
  type: 'circuit'
  nodes: CircuitNode[]
  components: CircuitComponent[]
  connections: CircuitConnection[]
}

/* ------------------------------------------------------- optical bench -- */

/**
 * Luminous object standing on the principal axis (the candle of the lab).
 * Positions along the bench are signed x coordinates; light travels towards +x.
 */
export interface OpticalObject {
  id: string
  name?: string
  /** Signed x position of the object's foot on the principal axis. */
  position: Quantity<'length'>
  /** Object height above the axis; must be > 0. */
  height: Quantity<'length'>
}

export interface OpticalElementBase {
  id: string
  name?: string
  enabled?: boolean
}

/** Ideal thin lens centred on the principal axis. */
export interface ThinLens extends OpticalElementBase {
  type: 'thin_lens'
  /** Signed x position of the optical centre. */
  position: Quantity<'length'>
  /** Focal length; > 0 converging (convex), < 0 diverging (concave). */
  focalLength: Quantity<'length'>
  /** Half-aperture above the axis, used for ray clipping and rendering. */
  apertureRadius?: Quantity<'length'>
}

/** Plane mirror standing perpendicular to the principal axis. */
export interface PlaneMirror extends OpticalElementBase {
  type: 'plane_mirror'
  /** Signed x position of the mirror plane. */
  position: Quantity<'length'>
  /** Half-height above the axis, used for rendering. */
  apertureRadius?: Quantity<'length'>
}

/**
 * Spherical mirror centred on the principal axis, reflecting light back
 * towards −x (paraxial approximation, f = R/2).
 */
export interface CurvedMirror extends OpticalElementBase {
  type: 'curved_mirror'
  /** Signed x position of the mirror vertex. */
  position: Quantity<'length'>
  /** Focal length; > 0 concave (converging), < 0 convex (diverging). */
  focalLength: Quantity<'length'>
  /** Half-height above the axis, used for rendering. */
  apertureRadius?: Quantity<'length'>
}

export type OpticalElement = ThinLens | PlaneMirror | CurvedMirror

/** Movable screen that can catch a real image (and only a real image). */
export interface OpticalScreen {
  id: string
  name?: string
  /** Signed x position of the screen plane. */
  position: Quantity<'length'>
}

/**
 * Single-axis optical bench for geometric imaging (junior optics slice).
 * One luminous object faces the bench elements; light travels towards +x, so
 * the object must stay on the −x side of the imaging element.
 */
export interface OpticalBench extends PhysicsObjectBase {
  type: 'optical_bench'
  object: OpticalObject
  elements: OpticalElement[]
  screen?: OpticalScreen
}

/* ------------------------------------------------------- acoustic range -- */

/**
 * Sound source standing on the range axis (the clapper / horn of the lab).
 * Positions along the range are signed x coordinates; the pulse is emitted at
 * t = 0 and travels towards +x.
 */
export interface AcousticSource {
  id: string
  name?: string
  /** Signed x position of the source on the range axis. */
  position: Quantity<'length'>
}

/** Reflecting wall / cliff face standing perpendicular to the range axis. */
export interface AcousticReflector {
  id: string
  name?: string
  /** Signed x position of the reflecting face; must sit ahead of the source. */
  position: Quantity<'length'>
}

/**
 * Single-axis echo range (junior acoustics slice): one sound source facing a
 * reflecting wall. A pulse emitted at t = 0 travels at the medium's sound
 * speed, reflects off the wall and returns; the round-trip delay is the
 * measured echo time, and d = v·t/2 recovers the distance.
 */
export interface AcousticBench extends PhysicsObjectBase {
  type: 'acoustic_bench'
  source: AcousticSource
  reflector: AcousticReflector
  /** Speed of sound in the propagation medium; finite and > 0. */
  soundSpeed: Quantity<'velocity'>
}

/* ----------------------------------------------------------- fluid tank -- */

/**
 * The block hanging from the spring scale above the tank. Volume and height
 * are stored separately rather than a full box geometry: the experiment only
 * ever needs the horizontal cross-section, and V / h delivers it without
 * committing the contract to a particular shape.
 */
export interface SubmergedBlock {
  id: string
  name?: string
  /** Mass of the block; finite and > 0. */
  mass: Quantity<'mass'>
  /** Total volume of the block; finite and > 0. */
  volume: Quantity<'volume'>
  /** Vertical extent of the block; finite and > 0. */
  height: Quantity<'length'>
}

/** The liquid filling the tank the block is lowered into. */
export interface TankLiquid {
  id: string
  name?: string
  /** Density of the liquid; finite and > 0. */
  density: Quantity<'density'>
}

/**
 * Spring-scale buoyancy rig (junior fluid-statics slice): one block hanging
 * from a spring scale, lowered at a steady rate into a tank of liquid.
 *
 * The scene does NOT store how deep the block currently is. Immersion is a
 * function of the timeline — the block descends at `lowerRate` — so depth,
 * displaced volume and the scale reading are all derived by the engine from
 * the current time rather than persisted and left to go stale.
 */
export interface FluidTank extends PhysicsObjectBase {
  type: 'fluid_tank'
  block: SubmergedBlock
  liquid: TankLiquid
  /** Descent speed of the block once lowering starts; finite and > 0. */
  lowerRate: Quantity<'velocity'>
  /** Gravitational field strength used for both weight and buoyancy. */
  gravity: Quantity<'acceleration'>
}

/* -------------------------------------------------------- pressure bench -- */

/**
 * Which closed-form pressure sub-model the bench describes.
 *
 * - `solid`: a force pressing perpendicularly on a contact area, p = F/S. A
 *   second contact area carries the same force, so the bench shows the area
 *   dependence without the force changing — the misconception it exists for is
 *   that pressure is not the same thing as force.
 * - `liquid`: a probe held below a liquid surface, p = ρgh. The same liquid is
 *   also probed at a second depth and a second liquid at the first depth, so
 *   both dependences are visible on one rig.
 * - `atmospheric`: the atmosphere acting on a barometer and on a pair of
 *   Magdeburg hemispheres. The two instruments read the same p₀ by different
 *   routes — the column h = p₀/(ρ_Hg·g) and the separating pull F = p₀·πr².
 */
export type PressureBenchType = 'solid' | 'liquid' | 'atmospheric'

/**
 * Pressure bench (junior pressure slice). One bench carries one rig: a block on
 * a contact face, a probe in a tank, or the atmosphere on a pair of instruments.
 *
 * The scene does NOT store the pressure, the barometer column height or the
 * hemisphere pull. Force, area, liquid density, depth and the instrument
 * geometry are the editable facts, so every reading is derived by the engine
 * from those rather than persisted and left to go stale on the next edit.
 *
 * Which optional fields carry meaning depends on `type` — the engine's
 * `canHandle` rejects a bench whose sub-model fields are missing rather than
 * silently substituting a default.
 *
 * Authoring units follow the junior lab: newtons for force, cm² for contact
 * area, cm for depth, kg/m³ for density, Pa for atmospheric pressure.
 */
export interface PressureBench extends PhysicsObjectBase {
  type: PressureBenchType
  /* ------------------------------------------------------------ solid -- */
  /** Perpendicular force on the contact area; finite and ≥ 0 (solid only). */
  force?: Quantity<'force'>
  /** Contact area the force presses on; finite and > 0 (solid only). */
  area?: Quantity<'area'>
  /**
   * Second contact area carrying the SAME force; finite and > 0 (solid only).
   * This is the block tipped onto another face or a narrower foot.
   */
  comparisonArea?: Quantity<'area'>
  /* ----------------------------------------------------------- liquid -- */
  /** Gravitational field strength; finite and > 0 (liquid, atmospheric). */
  gravity?: Quantity<'acceleration'>
  /** Density of the probed liquid; finite and > 0 (liquid only). */
  liquidDensity?: Quantity<'density'>
  /** Depth of the probe below the surface; finite and ≥ 0 (liquid only). */
  depth?: Quantity<'length'>
  /** Second probe depth in the same liquid; finite and ≥ 0 (liquid only). */
  comparisonDepth?: Quantity<'length'>
  /** A second liquid probed at `depth`; finite and > 0 (liquid only). */
  comparisonLiquidDensity?: Quantity<'density'>
  /* ------------------------------------------------------ atmospheric -- */
  /** Atmospheric pressure the instruments are reading; finite and > 0. */
  atmosphericPressure?: Quantity<'pressure'>
  /** Density of the barometer fluid; finite and > 0 (atmospheric only). */
  barometerFluidDensity?: Quantity<'density'>
  /** Radius of each Magdeburg hemisphere; finite and > 0 (atmospheric only). */
  hemisphereRadius?: Quantity<'length'>
}

/* ------------------------------------------------------- current-magnetic -- */

/**
 * Which current-magnetic rig a bench is: a straight conductor, a coil, the coil
 * with its core, or a coil hung in a field so the field turns it.
 */
export type CurrentBenchType = 'straight_wire' | 'solenoid' | 'electromagnet' | 'motor'

/**
 * Current-magnetic bench (junior 电生磁 slice): the magnetic field a current
 * makes. The straight-wire rig probes the field at a distance from the
 * conductor; the solenoid rig reads the uniform field along its axis; the
 * electromagnet rig threads a core through the same coil and reads the pull its
 * pole face can hold.
 *
 * The scene does NOT store the field. Current, probe distance, turns, coil
 * length and the core are the editable facts, so B = μ₀I/(2πr), B = μ₀(N/L)I and
 * B = μ_r·μ₀(N/L)I are derived by the engine rather than persisted numbers that
 * go stale on the next edit.
 */
export interface CurrentBench extends PhysicsObjectBase {
  type: CurrentBenchType
  /**
   * Current in the conductor; finite and non-zero (both rigs).
   *
   * Signed on purpose: the sign is the direction along the axis (into or out of
   * the page for the wire, one way or the other for the coil), and it is what
   * flips the field's circulation — the one thing 安培定则 is about.
   */
  current?: Quantity<'electric_current'>
  /* ------------------------------------------------------- straight wire -- */
  /** Distance from the conductor to the probe; finite and > 0 (straight_wire only). */
  probeDistance?: Quantity<'length'>
  /** A second probe distance in the same field; finite and > 0 (straight_wire only). */
  comparisonDistance?: Quantity<'length'>
  /* ------------------------------------------------------------ solenoid -- */
  /** Turns wound on the former; finite and > 0 (solenoid, electromagnet). */
  turns?: Quantity<'dimensionless'>
  /** A second winding on the same former, same length; finite and > 0 (solenoid only). */
  comparisonTurns?: Quantity<'dimensionless'>
  /** Length of the coil along its axis; finite and > 0 (solenoid, electromagnet). */
  coilLength?: Quantity<'length'>
  /* ------------------------------------------------------ electromagnet -- */
  /**
   * Relative permeability of the core threaded through the coil; finite and
   * > 0 (electromagnet only). 1 IS a core — it is the air-cored coil the iron
   * one is compared against, so the value that means "no core" is a rig rather
   * than a missing one, and only zero is refused.
   */
  coreRelativePermeability?: Quantity<'dimensionless'>
  /** A second core on the same coil, same current; finite and > 0 (electromagnet only). */
  comparisonCoreRelativePermeability?: Quantity<'dimensionless'>
  /** Area of the pole face the core presents; finite and > 0 (electromagnet only). */
  coreArea?: Quantity<'area'>
  /** Gravitational field strength, for the mass the rig can hold; > 0 (electromagnet only). */
  gravity?: Quantity<'acceleration'>
  /* ---------------------------------------------------------------- motor -- */
  /** Stator field the rotor turns in; finite and > 0 (motor only). */
  magneticFluxDensity?: Quantity<'magnetic_flux_density'>
  /** Length of each side that carries the force; finite and > 0 (motor only). */
  sideLength?: Quantity<'length'>
  /** Length of the other pair of sides — the lever arm; finite and > 0 (motor only). */
  coilWidth?: Quantity<'length'>
  /**
   * Angle between the coil's PLANE and the field; finite (motor only, degrees).
   *
   * Measured from the plane rather than from the normal because that is the
   * angle the drawing shows and the one the rig is turned by: 0° is the coil
   * lying along B with the couple at full strength, 90° is the 平衡位置 where
   * the torque vanishes and a commutator earns its place.
   */
  coilAngle?: Quantity<'angle'>
}

/* ---------------------------------------------------------- energy bench -- */

/**
 * Mechanical-energy bench (junior 机械能 slice): a cart released from a height
 * on a ramp, with the ledger of what the energy becomes.
 *
 * The scene does NOT store the energies. Mass, release height, ramp angle and
 * the friction along it are the editable facts, so Ep = mgh, Ek = ½mv² and the
 * work friction takes out are derived by the engine rather than persisted
 * numbers that go stale on the next edit — and the ledger is checked by adding
 * it back up, not by asserting the formula twice.
 */
export interface EnergyBench extends PhysicsObjectBase {
  type: 'energy_bench'
  /** Mass of the cart that carries the energy; finite and > 0. */
  mass: Quantity<'mass'>
  /** Gravitational field strength; finite and > 0. */
  gravity: Quantity<'acceleration'>
  /** Height above the bottom of the ramp the cart is released from; finite and > 0. */
  releaseHeight: Quantity<'length'>
  /**
   * Incline angle of the ramp; finite and strictly between 0° and 90°.
   *
   * Zero would be a level track with no height to fall, and ninety a vertical
   * drop with no ramp — the work friction does is μ·m·g·cosθ·L, so both ends
   * make the ledger degenerate rather than merely extreme.
   */
  inclineAngle: Quantity<'angle'>
  /** Kinetic friction coefficient along the ramp; finite and ≥ 0. */
  frictionCoefficient: Quantity<'dimensionless'>
}

/* ---------------------------------------------------------- noise bench -- */

/**
 * Noise bench (junior 噪声 slice): a source, a listener at a distance, and
 * whatever stands between them.
 *
 * The scene does NOT store the level at the listener. The source's sound POWER
 * level, the distance and the barrier's stated attenuation are the editable
 * facts, so L = Lw − 20·lg r − 10·lg(4π) − A is derived by the engine rather
 * than persisted — and the three terms stay separate, because "quieter because
 * it is farther" and "quieter because of the wall" are different things.
 */
export interface NoiseBench extends PhysicsObjectBase {
  type: 'noise'
  /** Sound power level of the source (dB); finite. */
  soundPowerLevel: Quantity<'dimensionless'>
  /** Distance from the source to the listener (m); finite and > 0. */
  distance: Quantity<'length'>
  /**
   * Insertion loss of whatever stands between them (dB); finite and ≥ 0.
   *
   * A MEASURED property of the barrier rather than something this model
   * derives: how much a wall actually takes out depends on its mass, its
   * frequency response and the geometry, none of which a level calculation can
   * conjure. Zero is no barrier at all, which is the control case.
   */
  barrierAttenuation: Quantity<'dimensionless'>
}

/* ----------------------------------------------------- thermometer bench -- */

/**
 * Liquid-in-glass thermometer bench (junior 温度计 slice): the instrument
 * itself, not the thing being measured.
 *
 * The scene does NOT store where the column stands. The bulb's volume, the
 * bore's diameter, the filling liquid's expansion coefficient and the
 * temperature the bulb sits in are the editable facts, so the column length —
 * and the fixed points that turn it into a scale — are derived by the engine.
 */
export interface ThermometerBench extends PhysicsObjectBase {
  type: 'liquid_in_glass'
  /** Volume of the bulb at the lower fixed point (m³); finite and > 0. */
  bulbVolume: Quantity<'volume'>
  /** Diameter of the capillary bore (m); finite and > 0. */
  boreDiameter: Quantity<'length'>
  /**
   * Volumetric expansion coefficient of the filling liquid (1/K); finite and > 0.
   *
   * Dimensionless in the schema the way a relative permeability is: the unit is
   * 1/K, which the engine's reading multiplies by a temperature difference.
   */
  expansionCoefficient: Quantity<'dimensionless'>
  /** Temperature the bulb is sitting in (K); finite. */
  temperature: Quantity<'temperature'>
  /** Column length at the lower fixed point (m); finite and > 0. */
  icePointLength: Quantity<'length'>
}

/* ----------------------------------------------------- transformer bench -- */

/**
 * Ideal-transformer bench (senior 变压器 slice): two coils on one core.
 *
 * The scene does NOT store the secondary voltage or current. The primary
 * voltage, the primary current and the two turn counts are the editable facts,
 * so U₂ = U₁·N₂/N₁ and I₂ = I₁·N₁/N₂ are derived — and the power balance that
 * makes the machine ideal is what the engine checks.
 */
export interface TransformerBench extends PhysicsObjectBase {
  type: 'transformer'
  /** Voltage across the primary winding (V); finite and > 0. */
  primaryVoltage: Quantity<'electric_potential'>
  /** Current drawn by the primary (A); finite and ≥ 0. */
  primaryCurrent: Quantity<'electric_current'>
  /** Turns on the driven winding; finite and > 0. */
  primaryTurns: Quantity<'dimensionless'>
  /** Turns on the output winding; finite and > 0. */
  secondaryTurns: Quantity<'dimensionless'>
}

/* ----------------------------------------------------------- light bench -- */

/**
 * Rectilinear-propagation bench (junior 光的直线传播 slice): a small hole in an
 * opaque screen, with an object in front of it and a receiving screen behind.
 *
 * The scene does NOT store the image. The object's height, its distance to the
 * hole and the hole's distance to the screen are the editable facts, so
 * h' = h·v/u is derived by the engine rather than persisted — and the image is
 * INVERTED, which is not a stored flag either: it is the sign the ray geometry
 * gives, and the check re-derives it from the triangles.
 */
/** Which light rig a bench is: a hole in a card, or a boundary light strikes. */
export type LightBenchType = 'pinhole' | 'total_reflection'

export interface LightBench extends PhysicsObjectBase {
  type: LightBenchType
  /* ------------------------------------------------------------- pinhole -- */
  /** Height of the object (the arrow standing in front of the hole); finite and > 0. */
  objectHeight?: Quantity<'length'>
  /** Distance from the object to the hole; finite and > 0. */
  objectDistance?: Quantity<'length'>
  /** Distance from the hole to the receiving screen; finite and > 0. */
  screenDistance?: Quantity<'length'>
  /* ---------------------------------------------------- total reflection -- */
  /** Refractive index the light comes FROM; finite and ≥ 1. */
  incidentIndex?: Quantity<'dimensionless'>
  /** Refractive index the light meets; finite and > 0. */
  refractedIndex?: Quantity<'dimensionless'>
  /** Angle of incidence from the normal; finite and in [0°, 90°) (total reflection). */
  incidentAngle?: Quantity<'angle'>
}

/* --------------------------------------------------------- thermal bench -- */

/**
 * The substance being heated. Solid and liquid specific heats are separate
 * because the two segments of the heating curve have different slopes — that
 * difference is one of the things the graph is read for.
 */
export interface ThermalSample {
  id: string
  name?: string
  /** Mass of the sample; finite and > 0. */
  mass: Quantity<'mass'>
  /** Specific heat below the melting point; finite and > 0. */
  solidSpecificHeat: Quantity<'specific_heat'>
  /** Specific heat above the melting point; finite and > 0. */
  liquidSpecificHeat: Quantity<'specific_heat'>
  /**
   * Latent heat of fusion. Zero marks an amorphous substance (松香 / 玻璃):
   * no fixed melting point and therefore no plateau on the curve.
   */
  latentHeat: Quantity<'specific_latent_heat'>
  /** Melting point; only meaningful when `latentHeat` is > 0. */
  meltingPoint: Quantity<'temperature'>
  /**
   * Boiling point, and the latent heat of vaporization that goes with it.
   *
   * A SECOND plateau, not a variant of the first: water melts at 0 °C and boils
   * at 100 °C, and the experiment the curriculum asks for is the flat part at
   * the second one. Both are optional so a melting bench is unchanged — a rig
   * that never boils is not missing a value, it is a different rig.
   */
  boilingPoint?: Quantity<'temperature'>
  /** Specific latent heat of vaporization; finite and > 0 when `boilingPoint` is set. */
  vaporizationHeat?: Quantity<'specific_latent_heat'>
  /**
   * Temperature at t = 0. A sample starting at or above its melting point is
   * already molten — the run is then a single warming segment, which is what a
   * liquid-versus-liquid comparison needs.
   */
  initialTemperature: Quantity<'temperature'>
}

/**
 * Constant-power heating bench (junior thermal slice): one sample in a beaker
 * over a steady heat source, with a thermometer in it.
 *
 * The scene does NOT store the current temperature. Mass, power and the
 * material constants are all editable facts, so the temperature at any instant
 * is derived by the engine from the timeline rather than persisted and left to
 * go stale.
 */
export interface ThermalBench extends PhysicsObjectBase {
  type: 'thermal_bench'
  sample: ThermalSample
  /**
   * A second sample heated alongside the first by an identical heater. Present
   * only for the comparison rig (同时加热水和油), where the point is that the
   * same heat produces different temperature rises.
   */
  comparisonSample?: ThermalSample
  /** Heat delivered per second to EACH sample; assumed fully absorbed. > 0. */
  heaterPower: Quantity<'power'>
  /**
   * How long the heater is left on. Omitted for a melting run, whose natural
   * length the engine derives from the plateau; required when nothing changes
   * phase and there is no such landmark to stop at.
   */
  runDuration?: Quantity<'time'>
}

/* ----------------------------------------------------------- lever bench -- */

/** Which side of a class-1 fulcrum a hanger sits on. */
export type LeverHangerSide = 'left' | 'right'

/**
 * A hanging mass on one arm of the lever. Force and moment are NOT stored:
 * mass, arm length and gravity are the editable facts, and F = mg, M = F·l
 * are derived by the engine so they cannot go stale after an edit.
 */
export interface LeverHanger {
  id: string
  name?: string
  side: LeverHangerSide
  /** Mass of the hanging load; finite and > 0. */
  mass: Quantity<'mass'>
  /** Horizontal distance from the fulcrum to the hanger; finite and > 0. */
  armLength: Quantity<'length'>
}

/**
 * Class-1 lever (junior statics slice): a rigid beam with the fulcrum between
 * two hanging loads. The scene does NOT store the current tilt — masses and
 * arm lengths are the editable facts, so whether the beam balances and which
 * way it tips come from the engine rather than a persisted angle that goes
 * stale on the next edit.
 *
 * This is moment statics, not rigid-body dynamics: no moment of inertia, no
 * angular acceleration. An unbalanced beam tips to a small display angle so
 * the student can see which side went down.
 */
export interface LeverBench extends PhysicsObjectBase {
  type: 'lever_bench'
  /** Total length of the beam; each arm must stay inside half of this. */
  beamLength: Quantity<'length'>
  /** Gravitational field strength used for every hanging weight. */
  gravity: Quantity<'acceleration'>
  hangers: LeverHanger[]
}

/* ------------------------------------------------------- induction bench -- */

/**
 * Which closed-form induction sub-model the bench describes.
 *
 * - `bar_motion`: a conducting rod of length L sweeps at velocity v through a
 *   uniform field B; the motional EMF is E = BLv.
 * - `flux_change`: a coil of area S sits in a field B whose flux changes at a
 *   constant rate dΦ/dt; Faraday's law gives E = -dΦ/dt.
 * - `double_bar_rail`: two conducting bars slide on parallel rails in a uniform
 *   field; the loop EMF is E = BL(v₁−v₂), the magnetic coupling exchanges
 *   momentum between the bars (τ = R·m₁m₂/(B²L²(m₁+m₂)) decay) and a constant
 *   external force on bar 1 drives a terminal relative velocity
 *   u∞ = F·R·m₂/(B²L²(m₁+m₂)).
 */
export type InductionBenchType = 'bar_motion' | 'flux_change' | 'double_bar_rail'

/**
 * Electromagnetic induction bench (junior induction slice). One bench carries
 * either a motional-EMF rod or a flux-change coil, plus the closed loop
 * resistance R. The scene does NOT store the induced EMF or current — B, L, v,
 * R (or dΦ/dt) are the editable facts, so E and I = E/R are derived by the
 * engine at the current time rather than a persisted value that goes stale on
 * the next edit.
 *
 * Authoring units follow the junior lab: tesla for B, centimetres for L, m/s
 * for v, ohms for R.
 */
export interface InductionBench extends PhysicsObjectBase {
  type: InductionBenchType
  /** Magnetic flux density of the uniform field; finite and > 0. */
  magneticFluxDensity: Quantity<'magnetic_flux_density'>
  /** Loop resistance of the closed conducting loop; finite and > 0. */
  resistance: Quantity<'resistance'>
  /* ------------------------------------------------------ bar_motion fields -- */
  /** Length of the conducting rod; finite and > 0 (bar_motion only). */
  barLength?: Quantity<'length'>
  /** Velocity of the rod; finite (bar_motion only). Sign encodes direction. */
  barVelocity?: Quantity<'velocity'>
  /* ---------------------------------------------------- flux_change fields -- */
  /** Area of the coil; finite and > 0 (flux_change only). */
  coilArea?: Quantity<'area'>
  /** Angle between B and the coil normal (rad); Φ = B·S·cosθ (flux_change only). */
  coilAngle?: Quantity<'angle'>
  /** Constant rate of change of flux dΦ/dt; finite (flux_change only). */
  fluxRate?: Quantity<'magnetic_flux_rate'>
  /* ------------------------------------------------- double_bar_rail fields -- */
  /** Masses of the two bars, positional [bar1, bar2]; each finite and > 0. */
  barMasses?: readonly [Quantity<'mass'>, Quantity<'mass'>]
  /** Velocities of the two bars along the rails; each finite, sign = direction. */
  barVelocities?: readonly [Quantity<'velocity'>, Quantity<'velocity'>]
  /** Initial x positions of the two bars; each finite, sign = side of the origin. */
  barPositions?: readonly [Quantity<'length'>, Quantity<'length'>]
  /** Constant external force on bar 1 along +x; finite and ≥ 0 (0 = free pair). */
  externalForce?: Quantity<'force'>
}

/* ------------------------------------------------------------ wave bench -- */

/**
 * Which closed-form wave sub-model the bench describes.
 *
 * - `travelling`: one sinusoidal wave running along a rope. v = λf, and the
 *   snapshot y(x, t) = A·sin(2π(x/λ − ft)) is what the student watches move.
 * - `interference`: two identical sources a fixed distance apart. The path
 *   difference at the observation point decides constructive (Δ = nλ) or
 *   destructive (Δ = (n + ½)λ) superposition.
 * - `standing`: a string clamped at both ends driven into its n-th harmonic.
 *   L = n·λ/2 fixes the wavelength, so f_n = n·v/(2L) and the node/antinode
 *   positions follow.
 */
export type WaveBenchType = 'travelling' | 'interference' | 'standing'

/**
 * Wave bench (junior/senior wave slice). One bench carries a single wave rig:
 * a travelling rope wave, a two-source interference pair, or a clamped string
 * in a standing-wave harmonic.
 *
 * The scene does NOT store the wave speed, the period, or the displacement at
 * any point. Amplitude, wavelength, frequency and geometry are the editable
 * facts; v = λf, T = 1/f, the phase at a point and the interference verdict are
 * all derived by the engine at the current time rather than persisted values
 * that go stale on the next edit.
 *
 * Which optional fields carry meaning depends on `type` — the engine's
 * `canHandle` rejects a bench whose sub-model fields are missing rather than
 * silently substituting a default.
 *
 * Authoring units follow the lab: metres for lengths, hertz for frequency,
 * centimetres for the amplitude of a rope wave.
 */
export interface WaveBench extends PhysicsObjectBase {
  type: WaveBenchType
  /** Peak displacement of the wave; finite and > 0. */
  amplitude: Quantity<'length'>
  /** Driving frequency; finite and > 0. */
  frequency: Quantity<'frequency'>
  /* ------------------------------------------- travelling / interference -- */
  /**
   * Wavelength of the wave; finite and > 0. Required for `travelling` and
   * `interference`. For `standing` it is derived from L and n instead, so a
   * bench that supplied both could contradict itself.
   */
  wavelength?: Quantity<'length'>
  /** Length of rope drawn for a travelling wave; finite and > 0. */
  ropeLength?: Quantity<'length'>
  /* ------------------------------------------------------- interference -- */
  /** Separation between the two coherent sources; finite and > 0. */
  sourceSeparation?: Quantity<'length'>
  /** Distance from source 1 to the observation point; finite and > 0. */
  pathOne?: Quantity<'length'>
  /** Distance from source 2 to the observation point; finite and > 0. */
  pathTwo?: Quantity<'length'>
  /* ----------------------------------------------------------- standing -- */
  /** Length of the clamped string; finite and > 0. */
  stringLength?: Quantity<'length'>
  /** Harmonic number n ≥ 1; integral. L = n·λ/2. */
  harmonic?: number
  /** Wave speed on the string; finite and > 0 (standing only). */
  waveSpeed?: Quantity<'velocity'>
}

/** docs/03 §64 */
export interface MeasurementDefinition {
  id: string
  type:
    | 'position'
    | 'velocity'
    | 'acceleration'
    | 'force'
    | 'energy'
    | 'current'
    | 'voltage'
    | 'electric_field'
    | 'magnetic_field'
    | 'custom'
  targetId?: string
  componentId?: ComponentId
  enabled: boolean
}

/** docs/03 §68 */
export interface SceneAnnotation {
  id: string
  type: 'label' | 'formula' | 'marker' | 'guide' | 'teacher_note'
  targetId?: string
  content: string
  visible: boolean
}

export const PHYSICS_SCENE_SCHEMA = 'physics-scene/1.0' as const

/** docs/03 §26 — all collections are required; empty arrays are used when a domain is not yet implemented. */
export interface PhysicsScene {
  schemaVersion: 'physics-scene/1.0'
  id: SceneId
  revision: number
  dimension: SceneDimension
  coordinateSystem: CoordinateSystem
  timeline: Timeline
  bodies: Body[]
  particles: Particle[]
  fields: Field[]
  forces: Force[]
  regions: Region[]
  boundaries: Boundary[]
  constraints: Constraint[]
  circuits: Circuit[]
  opticalBenches: OpticalBench[]
  acousticBenches: AcousticBench[]
  fluidTanks: FluidTank[]
  thermalBenches: ThermalBench[]
  leverBenches: LeverBench[]
  /**
   * Induction benches. Optional so scenes persisted before the induction slice
   * (and scenes authored by domains that never use induction) do not need to
   * populate an empty array — accessors fall back to `[]`.
   */
  inductionBenches?: InductionBench[]
  /**
   * Wave benches. Optional for the same reason as `inductionBenches`: scenes
   * persisted before the wave slice must stay readable, so accessors fall back
   * to `[]` rather than the schema demanding an empty array everywhere.
   */
  waveBenches?: WaveBench[]
  /**
   * Pressure benches. Optional for the same reason as `inductionBenches`:
   * scenes persisted before the pressure slice must stay readable, so accessors
   * fall back to `[]` rather than the schema demanding an empty array everywhere.
   */
  pressureBenches?: PressureBench[]
  /**
   * Current-magnetic benches. Optional for the same reason as the benches above:
   * scenes persisted before this slice must stay readable, so accessors fall
   * back to `[]` rather than the schema demanding an empty array everywhere.
   */
  currentBenches?: CurrentBench[]
  /**
   * Mechanical-energy benches. Optional for the same reason as the benches
   * above: scenes persisted before this slice must stay readable, so accessors
   * fall back to `[]` rather than the schema demanding an empty array.
   */
  energyBenches?: EnergyBench[]
  /**
   * Rectilinear-propagation benches. Optional for the same reason as the
   * benches above: scenes persisted before this slice must stay readable, so
   * accessors fall back to `[]` rather than the schema demanding an empty array.
   */
  lightBenches?: LightBench[]
  /**
   * Transformer benches. Optional for the same reason as the benches above:
   * scenes persisted before this slice must stay readable, so accessors fall
   * back to `[]` rather than the schema demanding an empty array.
   */
  transformerBenches?: TransformerBench[]
  /**
   * Thermometer benches. Optional for the same reason as the benches above:
   * scenes persisted before this slice must stay readable, so accessors fall
   * back to `[]` rather than the schema demanding an empty array.
   */
  thermometerBenches?: ThermometerBench[]
  /**
   * Noise benches. Optional for the same reason as the benches above: scenes
   * persisted before this slice must stay readable, so accessors fall back to
   * `[]` rather than the schema demanding an empty array.
   */
  noiseBenches?: NoiseBench[]
  measurementDefinitions: MeasurementDefinition[]
  observableDefinitions: ObservableDefinition[]
  annotations: SceneAnnotation[]
  metadata: SceneMetadata
}
