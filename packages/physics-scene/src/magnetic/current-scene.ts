import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type {
  CurrentBench,
  CurrentBenchType,
  ObservableDefinition,
  PhysicsScene,
} from '../scene.ts'

/**
 * Current-magnetic scenes are static apparatus, like the pressure rigs: the
 * current is steady, so the field is the same at every instant and there is no
 * timeline to scrub. The scene does NOT store the field any probe reads —
 * current, probe distance, turns and coil length are the editable facts, so
 * B = μ₀I/(2πr) and B = μ₀(N/L)I are derived by the engine rather than
 * persisted numbers that go stale on the next edit.
 *
 * Authoring units follow the junior lab: amperes for current, centimetres for
 * the probe distance and the coil length, and a plain count for the turns.
 */
export type CurrentObservableKey = 'field' | 'comparison'

/**
 * The two rigs are tagged rather than inferred from which fields are present:
 * they share `current`, so a spec that omitted the tag could not be told apart
 * from the other, and guessing is worse than asking.
 */
export interface StraightWireFieldSpec {
  readonly benchId?: string
  readonly type: 'straight_wire'
  /**
   * Current in the conductor, in amperes (≠ 0). The sign is the direction along
   * the axis: positive means out of the page for the 2D rig, so it is what
   * decides whether the field circulates counter-clockwise or clockwise.
   */
  readonly current: number
  /** Distance from the conductor to the probe, in centimetres (> 0). */
  readonly probeDistance: number
  /** A second probe distance in the same field, in centimetres (> 0). */
  readonly comparisonDistance?: number
}

/** Authoring input for the coil rig: a uniform field along the axis. */
export interface SolenoidFieldSpec {
  readonly benchId?: string
  readonly type: 'solenoid'
  /** Current in the winding, in amperes (≠ 0). */
  readonly current: number
  /** Turns wound on the former (> 0). */
  readonly turns: number
  /** A second winding on the same former, same length (> 0). */
  readonly comparisonTurns?: number
  /** Coil length along the axis, in centimetres (> 0). */
  readonly coilLength: number
}

/**
 * Authoring input for the electromagnet rig: the same coil with a core in it.
 *
 * `coreRelativePermeability` is a plain number rather than a material name: the
 * engine models μ_r, and which lump of metal has which μ_r is the rig's own
 * business (the Lab offers soft iron and a couple of comparisons). 1 is the
 * air-cored coil, which is the honest baseline the iron is measured against.
 */
export interface ElectromagnetSpec {
  readonly benchId?: string
  readonly type: 'electromagnet'
  /** Current in the winding, in amperes (≠ 0). */
  readonly current: number
  /** Turns wound on the former (> 0). */
  readonly turns: number
  /** Coil length along the axis, in centimetres (> 0). */
  readonly coilLength: number
  /** Relative permeability of the core (> 0); 1 = air-cored. */
  readonly coreRelativePermeability?: number
  /** A second core on the same coil (> 0). */
  readonly comparisonCoreRelativePermeability?: number
  /** Area of the pole face, in cm² (> 0). */
  readonly coreArea?: number
  /** Gravitational field strength in m/s² (> 0); used for the held mass. */
  readonly gravity?: number
}

/**
 * Authoring input for the motor rig: a coil hung in a field so the field turns it.
 *
 * `coilAngle` is measured from the coil's PLANE to the field, the way the
 * drawing shows it: 0° is the coil lying along B with the couple at full
 * strength, 90° is the 平衡位置 where the torque vanishes.
 */
export interface MotorSpec {
  readonly benchId?: string
  readonly type: 'motor'
  /** Current through the rotor winding, in amperes (≠ 0). */
  readonly current: number
  /** Turns on the rotor, > 0. */
  readonly turns: number
  /** Stator field the rotor turns in, in tesla (> 0). */
  readonly magneticFluxDensity: number
  /** Length of the sides that carry the force, in centimetres (> 0). */
  readonly sideLength: number
  /** Length of the other pair of sides — the lever arm, in centimetres (> 0). */
  readonly coilWidth: number
  /** Angle from the coil's plane to the field, in degrees. */
  readonly coilAngle?: number
}

/** Discriminated authoring input: one rig per bench. */
export type CurrentBenchSpec =
  StraightWireFieldSpec | SolenoidFieldSpec | ElectromagnetSpec | MotorSpec

export interface CurrentBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly bench: CurrentBenchSpec
  readonly observableVisibility?: Partial<Record<CurrentObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: CurrentObservableKey) => asObservableId(`observable-current-${key}`)

const benchTypeOf = (spec: CurrentBenchSpec): CurrentBenchType => spec.type

const toBench = (spec: CurrentBenchSpec): CurrentBench => {
  const common = {
    id: spec.benchId ?? 'current-bench-1',
    current: quantity(spec.current, 'A', 'electric_current'),
  }
  if (spec.type === 'motor') {
    return {
      ...common,
      type: 'motor',
      turns: quantity(spec.turns, '', 'dimensionless'),
      magneticFluxDensity: quantity(spec.magneticFluxDensity, 'T', 'magnetic_flux_density'),
      sideLength: quantity(spec.sideLength / 100, 'm', 'length'),
      coilWidth: quantity(spec.coilWidth / 100, 'm', 'length'),
      coilAngle: quantity(spec.coilAngle ?? 0, 'deg', 'angle'),
    }
  }
  if (spec.type === 'electromagnet') {
    return {
      ...common,
      type: 'electromagnet',
      turns: quantity(spec.turns, '', 'dimensionless'),
      coilLength: quantity(spec.coilLength / 100, 'm', 'length'),
      coreRelativePermeability: quantity(spec.coreRelativePermeability ?? 1, '', 'dimensionless'),
      coreArea: quantity((spec.coreArea ?? 4) / 1e4, 'm^2', 'area'),
      gravity: quantity(spec.gravity ?? 9.8, 'm/s^2', 'acceleration'),
      ...(spec.comparisonCoreRelativePermeability === undefined
        ? {}
        : {
            comparisonCoreRelativePermeability: quantity(
              spec.comparisonCoreRelativePermeability,
              '',
              'dimensionless',
            ),
          }),
    }
  }
  if (spec.type === 'solenoid') {
    return {
      ...common,
      type: 'solenoid',
      turns: quantity(spec.turns, '', 'dimensionless'),
      coilLength: quantity(spec.coilLength / 100, 'm', 'length'),
      ...(spec.comparisonTurns === undefined
        ? {}
        : { comparisonTurns: quantity(spec.comparisonTurns, '', 'dimensionless') }),
    }
  }
  return {
    ...common,
    type: 'straight_wire',
    probeDistance: quantity(spec.probeDistance / 100, 'm', 'length'),
    ...(spec.comparisonDistance === undefined
      ? {}
      : { comparisonDistance: quantity(spec.comparisonDistance / 100, 'm', 'length') }),
  }
}

/**
 * Observable definitions per rig. `field` is the reading the rig exists to
 * take — the probe's B on the wire rig, the axial field on the coil rig, the
 * pull of the cored coil on the electromagnet. `comparison` is the second
 * measurement that turns the reading into a law: the same field further out on
 * the wire rig, the same former wound with more turns on the coil rig, the same
 * coil with a better core on the electromagnet.
 */
const observablesOf = (
  bench: CurrentBench,
  visibility: Partial<Record<CurrentObservableKey, boolean>>,
): ObservableDefinition[] => [
  {
    id: observableId('field'),
    type: 'measurement',
    targetId: bench.id,
    visible: visibility.field ?? true,
  },
  {
    id: observableId('comparison'),
    type: 'geometry',
    targetId: bench.id,
    visible: visibility.comparison ?? true,
  },
]

const DEFAULT_TITLE: Record<CurrentBenchType, string> = {
  straight_wire: '通电直导线磁场实验台',
  solenoid: '通电螺线管磁场实验台',
  electromagnet: '电磁铁实验台',
  motor: '电动机实验台',
}

/** Create a single-bench current-magnetic scene (one rig, one current). */
export const createCurrentBenchScene = (input: CurrentBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const bench = toBench(input.bench)

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'current-runtime-scene'),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      state: 'paused',
      playbackRate: 1,
    },
    bodies: [],
    particles: [],
    fields: [],
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    thermalBenches: [],
    leverBenches: [],
    pressureBenches: [],
    currentBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: observablesOf(bench, input.observableVisibility ?? {}),
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? DEFAULT_TITLE[benchTypeOf(input.bench)],
      description: input.description ?? 'Current Engine · 电生磁 B = μ₀I/(2πr) · B = μ₀(N/L)I',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Current-magnetic benches of a scene. Legacy-safe: scenes persisted before
 * this slice have no `currentBenches` collection, so readers fall back to `[]`.
 */
export const currentBenchesOf = (scene: PhysicsScene): CurrentBench[] => scene.currentBenches ?? []

/** The single bench of a current-magnetic scene, if present. */
export const currentBenchOf = (scene: PhysicsScene): CurrentBench | undefined =>
  currentBenchesOf(scene)[0]

/** True when the scene is a pure single-bench current-magnetic scene. */
export const isCurrentScene = (scene: PhysicsScene): boolean =>
  currentBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0 &&
  (scene.fluidTanks ?? []).length === 0 &&
  (scene.thermalBenches ?? []).length === 0 &&
  (scene.leverBenches ?? []).length === 0 &&
  (scene.inductionBenches ?? []).length === 0 &&
  (scene.waveBenches ?? []).length === 0 &&
  (scene.pressureBenches ?? []).length === 0
