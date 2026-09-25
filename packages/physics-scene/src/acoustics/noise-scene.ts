import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { NoiseBench, ObservableDefinition, PhysicsScene } from '../scene.ts'

/**
 * The noise rig is static apparatus: the source, the listener and the barrier do
 * not move, so the meter reads the same at every instant and there is no
 * timeline. The scene stores what the world IS — how loud the source is, how far
 * away the listener stands, what is in between — and the level follows.
 *
 * Authoring units follow the lab: decibels for both levels, metres for distance.
 */
export type NoiseObservableKey = 'level' | 'spreading'

export interface NoiseBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly benchId?: string
  /** Sound power level of the source, in dB. */
  readonly soundPowerLevel?: number
  /** Distance from the source to the listener, in metres (> 0). */
  readonly distance?: number
  /** Insertion loss of the barrier between them, in dB (≥ 0). */
  readonly barrierAttenuation?: number
  readonly observableVisibility?: Partial<Record<NoiseObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: NoiseObservableKey) => asObservableId(`observable-noise-${key}`)

/** Create a single-bench noise scene (one source, one listener, one barrier). */
export const createNoiseBenchScene = (input: NoiseBenchSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const benchId = input.benchId ?? 'noise-bench-1'
  const visibility = input.observableVisibility ?? {}

  const bench: NoiseBench = {
    id: benchId,
    type: 'noise',
    soundPowerLevel: quantity(input.soundPowerLevel ?? 100, '', 'dimensionless'),
    distance: quantity(input.distance ?? 1, 'm', 'length'),
    barrierAttenuation: quantity(input.barrierAttenuation ?? 0, '', 'dimensionless'),
  }

  const observables: ObservableDefinition[] = [
    {
      id: observableId('level'),
      type: 'measurement',
      targetId: bench.id,
      visible: visibility.level ?? true,
    },
    {
      id: observableId('spreading'),
      type: 'geometry',
      targetId: bench.id,
      visible: visibility.spreading ?? true,
    },
  ]

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'noise-runtime-scene'),
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
    lightBenches: [],
    inductionBenches: [],
    transformerBenches: [],
    thermometerBenches: [],
    noiseBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: observables,
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '噪声实验台',
      description: input.description ?? 'Noise · L = 10·lg(I/I₀) · 距离加倍降 6 dB · 屏障是减法',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Noise benches of a scene. Legacy-safe: scenes persisted before this slice have
 * no `noiseBenches` collection, so readers fall back to `[]`.
 */
export const noiseBenchesOf = (scene: PhysicsScene): NoiseBench[] => scene.noiseBenches ?? []

/** The single bench of a noise scene, if present. */
export const noiseBenchOf = (scene: PhysicsScene): NoiseBench | undefined =>
  noiseBenchesOf(scene)[0]

/** True when the scene is a pure single-bench noise scene. */
export const isNoiseScene = (scene: PhysicsScene): boolean =>
  noiseBenchesOf(scene).length === 1 &&
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
  (scene.energyBenches ?? []).length === 0 &&
  (scene.lightBenches ?? []).length === 0 &&
  (scene.transformerBenches ?? []).length === 0 &&
  (scene.thermometerBenches ?? []).length === 0
