import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type {
  ObservableDefinition,
  ObservableType,
  PhysicsScene,
  PressureBench,
  PressureBenchType,
} from '../scene.ts'

/**
 * Pressure scenes are static apparatus: nothing moves, so there is no timeline
 * to scrub and the bench is the same at every instant. The scene does NOT store
 * the pressure any instrument reads — force, contact area, liquid density, depth
 * and the barometer geometry are the editable facts, so p = F/S, p = ρgh,
 * h = p₀/(ρ_Hg·g) and F = p₀·πr² are derived by the engine rather than
 * persisted numbers that go stale on the next edit.
 *
 * Authoring units follow the junior lab: newtons for force, cm² for contact
 * area, cm for depth and radius, kg/m³ for density, Pa for atmospheric pressure.
 */
export type PressureObservableKey = 'reading' | 'comparison'

/**
 * The three sub-model inputs are tagged rather than inferred from which fields
 * are present: `solid` and `liquid` share no field names, but a spec that
 * simply omitted the tag would be ambiguous between them, and guessing is worse
 * than asking.
 */
export interface SolidPressureSpec {
  readonly benchId?: string
  readonly type: 'solid'
  /** Perpendicular force on the contact area in newtons (≥ 0). */
  readonly force: number
  /** Contact area the force presses on in cm² (> 0). */
  readonly area: number
  /** Second contact face carrying the same force, in cm² (> 0). */
  readonly comparisonArea?: number
}

/** Authoring input for the liquid-pressure rig: a probe below a surface. */
export interface LiquidPressureSpec {
  readonly benchId?: string
  readonly type: 'liquid'
  /** Density of the probed liquid in kg/m³ (> 0); 1000 is fresh water. */
  readonly liquidDensity: number
  /** Depth of the probe below the surface in cm (≥ 0). */
  readonly depth: number
  /** Second probe depth in the same liquid, in cm (≥ 0). */
  readonly comparisonDepth?: number
  /** A second liquid probed at `depth`, in kg/m³ (> 0). */
  readonly comparisonLiquidDensity?: number
}

/** Authoring input for the atmospheric rig: barometer and hemispheres. */
export interface AtmosphericPressureSpec {
  readonly benchId?: string
  readonly type: 'atmospheric'
  /** Atmospheric pressure both instruments read, in pascals (> 0). */
  readonly atmosphericPressure?: number
  /** Density of the barometer fluid in kg/m³ (> 0); 13600 is mercury. */
  readonly barometerFluidDensity?: number
  /** Radius of each Magdeburg hemisphere in cm (> 0). */
  readonly hemisphereRadius?: number
}

/** Discriminated authoring input: one sub-model per bench. */
export type PressureBenchSpec = SolidPressureSpec | LiquidPressureSpec | AtmosphericPressureSpec

export interface PressureBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly bench: PressureBenchSpec
  /** Gravitational field strength in m/s² (> 0); used by the liquid and atmospheric models. */
  readonly gravity?: number
  readonly observableVisibility?: Partial<Record<PressureObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: PressureObservableKey) => asObservableId(`observable-pressure-${key}`)

const benchTypeOf = (spec: PressureBenchSpec): PressureBenchType => spec.type

const toBench = (spec: PressureBenchSpec, gravity: number): PressureBench => {
  const common = {
    id: spec.benchId ?? 'pressure-bench-1',
    gravity: quantity(gravity, 'm/s^2', 'acceleration'),
  }
  if (spec.type === 'liquid') {
    return {
      ...common,
      type: 'liquid',
      liquidDensity: quantity(spec.liquidDensity, 'kg/m^3', 'density'),
      depth: quantity(spec.depth / 100, 'm', 'length'),
      ...(spec.comparisonDepth === undefined
        ? {}
        : { comparisonDepth: quantity(spec.comparisonDepth / 100, 'm', 'length') }),
      ...(spec.comparisonLiquidDensity === undefined
        ? {}
        : {
            comparisonLiquidDensity: quantity(spec.comparisonLiquidDensity, 'kg/m^3', 'density'),
          }),
    }
  }
  if (spec.type === 'atmospheric') {
    return {
      ...common,
      type: 'atmospheric',
      atmosphericPressure: quantity(spec.atmosphericPressure ?? 101_300, 'Pa', 'pressure'),
      barometerFluidDensity: quantity(spec.barometerFluidDensity ?? 13_600, 'kg/m^3', 'density'),
      hemisphereRadius: quantity((spec.hemisphereRadius ?? 5) / 100, 'm', 'length'),
    }
  }
  return {
    ...common,
    type: 'solid',
    force: quantity(spec.force, 'N', 'force'),
    area: quantity(spec.area, 'cm^2', 'area'),
    ...(spec.comparisonArea === undefined
      ? {}
      : { comparisonArea: quantity(spec.comparisonArea, 'cm^2', 'area') }),
  }
}

/**
 * Observable definitions per sub-model. The two keys mean different apparatus
 * in each one — on the solid rig `reading` is the loaded contact face and
 * `comparison` the tipped one; in a tank `reading` is the probe itself and
 * `comparison` the second depth or the second liquid; on the atmospheric rig
 * `reading` is the barometer and `comparison` the hemispheres.
 */
const observablesOf = (
  bench: PressureBench,
  visibility: Partial<Record<PressureObservableKey, boolean>>,
): ObservableDefinition[] => {
  /* The solid rig's primary reading IS a force diagram; the other two are
     instrument readings. */
  const readingType: ObservableType = bench.type === 'solid' ? 'force' : 'measurement'
  return [
    {
      id: observableId('reading'),
      type: readingType,
      targetId: bench.id,
      visible: visibility.reading ?? true,
    },
    {
      id: observableId('comparison'),
      type: 'geometry',
      targetId: bench.id,
      visible: visibility.comparison ?? true,
    },
  ]
}

const DEFAULT_TITLE: Record<PressureBenchType, string> = {
  solid: '固体压强实验台',
  liquid: '液体压强实验台',
  atmospheric: '大气压实验台',
}

/** Create a single-bench pressure scene (one rig, one sub-model). */
export const createPressureBenchScene = (input: PressureBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const bench = toBench(input.bench, input.gravity ?? 9.8)
  const type = benchTypeOf(input.bench)

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'pressure-runtime-scene'),
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
    pressureBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: observablesOf(bench, input.observableVisibility ?? {}),
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? DEFAULT_TITLE[type],
      description: input.description ?? 'Fluid Engine · 压强 p = F/S · p = ρgh · p₀',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Pressure benches of a scene. Legacy-safe: scenes persisted before the
 * pressure slice have no `pressureBenches` collection, so readers fall back to
 * `[]`.
 */
export const pressureBenchesOf = (scene: PhysicsScene): PressureBench[] =>
  scene.pressureBenches ?? []

/** The single bench of a pressure scene, if present. */
export const pressureBenchOf = (scene: PhysicsScene): PressureBench | undefined =>
  pressureBenchesOf(scene)[0]

/** True when the scene is a pure single-bench pressure scene. */
export const isPressureScene = (scene: PhysicsScene): boolean =>
  pressureBenchesOf(scene).length === 1 &&
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
  (scene.waveBenches ?? []).length === 0
