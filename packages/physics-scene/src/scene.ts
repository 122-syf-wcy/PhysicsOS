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
  measurementDefinitions: MeasurementDefinition[]
  observableDefinitions: ObservableDefinition[]
  annotations: SceneAnnotation[]
  metadata: SceneMetadata
}
