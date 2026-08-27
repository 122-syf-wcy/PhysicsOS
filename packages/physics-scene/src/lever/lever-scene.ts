import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { LeverBench, LeverHanger, LeverHangerSide, PhysicsScene } from '../scene.ts'

/**
 * Class-1 lever scenes are statics, not dynamics: the hangers sit at fixed
 * arms and the engine decides whether the beam balances. The scene does NOT
 * store the current tilt — mass and arm length are the editable facts, so the
 * moments and the tip come from the engine at the current time rather than a
 * persisted angle that goes stale on the next edit.
 *
 * Authoring units are the ones a junior lab actually reads off its equipment:
 * grams for the hook masses, centimetres for the arms.
 */
export type LeverObservableKey = 'moments' | 'arms'

export interface LeverHangerSpec {
  readonly id?: string
  readonly name?: string
  readonly side: LeverHangerSide
  /** Mass of the hanging load in grams (> 0). */
  readonly mass: number
  /** Distance from the fulcrum to the hanger in centimetres (> 0). */
  readonly armLength: number
}

export interface LeverBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  readonly left: Omit<LeverHangerSpec, 'side'>
  readonly right: Omit<LeverHangerSpec, 'side'>
  /** Total beam length in centimetres (> 0). */
  readonly beamLength?: number
  /** Gravitational field strength in m/s² (> 0). */
  readonly gravity?: number
  readonly observableVisibility?: Partial<Record<LeverObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: LeverObservableKey) => asObservableId(`observable-lever-${key}`)

const hangerOf = (
  spec: Omit<LeverHangerSpec, 'side'>,
  side: LeverHangerSide,
  fallbackId: string,
): LeverHanger => ({
  id: spec.id ?? fallbackId,
  ...(spec.name === undefined ? {} : { name: spec.name }),
  side,
  mass: quantity(spec.mass, 'g', 'mass'),
  armLength: quantity(spec.armLength, 'cm', 'length'),
})

/** Create a single class-1 lever scene (one beam, two hangers, fulcrum between). */
export const createLeverBenchScene = (input: LeverBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'lever-runtime-scene'
  const benchId = input.benchId ?? 'lever-1'
  const visibility = input.observableVisibility ?? {}

  const bench: LeverBench = {
    id: benchId,
    type: 'lever_bench',
    beamLength: quantity(input.beamLength ?? 40, 'cm', 'length'),
    gravity: quantity(input.gravity ?? 9.8, 'm/s^2', 'acceleration'),
    hangers: [
      hangerOf(input.left, 'left', 'hanger-left'),
      hangerOf(input.right, 'right', 'hanger-right'),
    ],
  }

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      state: 'idle',
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
    leverBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('moments'),
        type: 'force',
        targetId: bench.id,
        visible: visibility.moments ?? true,
      },
      {
        id: observableId('arms'),
        type: 'geometry',
        targetId: bench.id,
        visible: visibility.arms ?? true,
      },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '杠杆实验台',
      description: input.description ?? 'Lever Engine · 力矩平衡 F₁l₁ = F₂l₂',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Lever benches of a scene. Legacy-safe: scenes persisted before the lever
 * slice have no `leverBenches` collection, so readers fall back to `[]`.
 */
export const leverBenchesOf = (scene: PhysicsScene): LeverBench[] => scene.leverBenches ?? []

/** The single lever of a lever-statics scene, if present. */
export const leverBenchOf = (scene: PhysicsScene): LeverBench | undefined => leverBenchesOf(scene)[0]

/** True when the scene is a pure single-lever class-1 balance scene. */
export const isLeverScene = (scene: PhysicsScene): boolean =>
  leverBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0 &&
  (scene.fluidTanks ?? []).length === 0 &&
  (scene.thermalBenches ?? []).length === 0
