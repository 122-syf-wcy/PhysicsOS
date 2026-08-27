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
  frictionCoefficient?: number
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
  measurementDefinitions: MeasurementDefinition[]
  observableDefinitions: ObservableDefinition[]
  annotations: SceneAnnotation[]
  metadata: SceneMetadata
}
