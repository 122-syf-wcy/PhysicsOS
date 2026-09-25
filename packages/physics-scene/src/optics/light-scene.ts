import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { LightBench, ObservableDefinition, PhysicsScene } from '../scene.ts'

/**
 * Light-propagation scenes are static apparatus, like the pressure rigs: the
 * object, the hole and the screen do not move, so the image is the same at
 * every instant and there is no timeline. The scene does NOT store the image —
 * the three lengths are the editable facts, so h' = h·v/u and the inversion
 * come from the engine rather than from a persisted size.
 *
 * Authoring units follow the junior lab: centimetres for everything, because a
 * pinhole rig is a ruler, a card and a candle.
 */
export type LightObservableKey = 'rays' | 'image'

export interface LightBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  /** Height of the object in centimetres (> 0). */
  readonly objectHeight?: number
  /** Object-to-hole distance in centimetres (> 0). */
  readonly objectDistance?: number
  /** Hole-to-screen distance in centimetres (> 0). */
  readonly screenDistance?: number
  /**
   * The refraction rig, when this bench is one. Tagged on purpose: the two
   * rigs share a bench type and would otherwise be told apart by which fields
   * happen to be present — and guessing is worse than asking.
   */
  readonly refraction?: {
    /** Index the light comes from (≥ 1). */
    readonly incidentIndex: number
    /** Index it meets (> 0). */
    readonly refractedIndex: number
    /** Angle of incidence in degrees, in [0, 90). */
    readonly incidentAngle: number
  }
  readonly observableVisibility?: Partial<Record<LightObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: LightObservableKey) => asObservableId(`observable-light-${key}`)

/** Create a single-bench light-propagation scene (one hole, one screen). */
export const createLightBenchScene = (input: LightBenchSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const benchId = input.benchId ?? 'light-bench-1'
  const visibility = input.observableVisibility ?? {}

  const bench: LightBench =
    input.refraction === undefined
      ? {
        id: benchId,
        type: 'pinhole',
        objectHeight: quantity(input.objectHeight ?? 6, 'cm', 'length'),
        objectDistance: quantity(input.objectDistance ?? 30, 'cm', 'length'),
        screenDistance: quantity(input.screenDistance ?? 15, 'cm', 'length'),
      }
      : {
        id: benchId,
        type: 'total_reflection',
        incidentIndex: quantity(input.refraction.incidentIndex, '', 'dimensionless'),
        refractedIndex: quantity(input.refraction.refractedIndex, '', 'dimensionless'),
        incidentAngle: quantity(input.refraction.incidentAngle, 'deg', 'angle'),
      }

  const observables: ObservableDefinition[] = [
    {
      id: observableId('rays'),
      type: 'geometry',
      targetId: bench.id,
      visible: visibility.rays ?? true,
    },
    {
      id: observableId('image'),
      type: 'measurement',
      targetId: bench.id,
      visible: visibility.image ?? true,
    },
  ]

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'light-runtime-scene'),
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
    currentBenches: [],
    energyBenches: [],
    lightBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: observables,
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '光的直线传播实验台',
      description:
        input.description ?? 'Light Propagation · 小孔成像 h′ = h·v/u',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Light benches of a scene. Legacy-safe: scenes persisted before this slice
 * have no `lightBenches` collection, so readers fall back to `[]`.
 */
export const lightBenchesOf = (scene: PhysicsScene): LightBench[] => scene.lightBenches ?? []

/** The single bench of a light-propagation scene, if present. */
export const lightBenchOf = (scene: PhysicsScene): LightBench | undefined =>
  lightBenchesOf(scene)[0]

/** True when the scene is a pure single-bench light-propagation scene. */
export const isLightScene = (scene: PhysicsScene): boolean =>
  lightBenchesOf(scene).length === 1 &&
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
  (scene.pressureBenches ?? []).length === 0 &&
  (scene.currentBenches ?? []).length === 0 &&
  (scene.energyBenches ?? []).length === 0
