import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { AcousticBench, PhysicsScene } from '../scene.ts'

/**
 * Acoustic range scenes carry a real timeline: the pulse leaves the source at
 * t = 0, reflects off the wall and returns at t = 2d/v. The scene does NOT
 * store that end time — distance and sound speed are editable facts, so the
 * duration is derived by the engine from the current configuration instead of
 * persisting a stale number. All authoring lengths are metres and speeds m/s,
 * the natural units of the junior acoustics lab (they are also canonical SI).
 */
export type AcousticsObservableKey = 'wavefronts' | 'path'

export interface AcousticSourceSpec {
  readonly id?: string
  readonly name?: string
  /** Signed x position of the source on the range axis, in metres. */
  readonly position: number
}

export interface AcousticReflectorSpec {
  readonly id?: string
  readonly name?: string
  /** Signed x position of the reflecting face, in metres; ahead of the source. */
  readonly position: number
}

export interface AcousticBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  readonly source: AcousticSourceSpec
  readonly reflector: AcousticReflectorSpec
  /** Speed of sound in the propagation medium, in m/s (> 0). */
  readonly soundSpeed: number
  readonly observableVisibility?: Partial<Record<AcousticsObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const metres = (value: number) => quantity(value, 'm', 'length')

const observableId = (key: AcousticsObservableKey) => asObservableId(`observable-acoustics-${key}`)

/** Create a single-range echo scene (one source, one reflecting wall). */
export const createAcousticBenchScene = (input: AcousticBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'acoustics-runtime-scene'
  const benchId = input.benchId ?? 'acoustic-bench-1'
  const visibility = input.observableVisibility ?? {}

  const bench: AcousticBench = {
    id: benchId,
    type: 'acoustic_bench',
    source: {
      id: input.source.id ?? 'sound-source',
      ...(input.source.name === undefined ? {} : { name: input.source.name }),
      position: metres(input.source.position),
    },
    reflector: {
      id: input.reflector.id ?? 'wall-1',
      ...(input.reflector.name === undefined ? {} : { name: input.reflector.name }),
      position: metres(input.reflector.position),
    },
    soundSpeed: quantity(input.soundSpeed, 'm/s', 'velocity'),
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
    acousticBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('wavefronts'),
        type: 'geometry',
        targetId: bench.source.id,
        visible: visibility.wavefronts ?? true,
      },
      {
        id: observableId('path'),
        type: 'geometry',
        targetId: bench.reflector.id,
        visible: visibility.path ?? true,
      },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '声学测距实验台',
      description: input.description ?? 'Acoustics Engine · 单轴回声测距',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Acoustic benches of a scene. Legacy-safe: scenes persisted before the
 * acoustics slice have no `acousticBenches` collection, so readers fall back
 * to `[]`.
 */
export const acousticBenchesOf = (scene: PhysicsScene): AcousticBench[] =>
  scene.acousticBenches ?? []

/** The single acoustic bench of an acoustics scene, if present. */
export const acousticBenchOf = (scene: PhysicsScene): AcousticBench | undefined =>
  acousticBenchesOf(scene)[0]

/** True when the scene is a pure single-range acoustics scene. */
export const isAcousticsScene = (scene: PhysicsScene): boolean =>
  acousticBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0
