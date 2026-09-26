/**
 * Modern-physics apparatus scene and the photoelectric-effect template.
 *
 * The scene stores controllable/measured quantities only: work function, photon
 * wavelength, light intensity, cathode area and quantum efficiency. The modern
 * engine derives photon energy, threshold values, stopping potential and
 * photocurrent, so no textbook result is persisted beside the facts that imply it.
 */
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { ModernPhysicsBench, ObservableDefinition, PhysicsScene } from '../scene.ts'

export const ELECTRON_VOLT_JOULES = 1.602176634e-19

export interface ModernPhysicsSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly workFunctionEv?: number
  readonly photonWavelengthNm?: number
  readonly lightIntensity?: number
  readonly cathodeArea?: number
  readonly quantumEfficiency?: number
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const DEFAULTS = {
  workFunctionEv: 2,
  photonWavelengthNm: 400,
  lightIntensity: 10,
  cathodeArea: 1e-4,
  quantumEfficiency: 1,
} as const

const observable = (key: string, type: ObservableDefinition['type']): ObservableDefinition => ({
  id: asObservableId(`observable-modern-photoelectric-${key}`),
  type,
  targetId: 'modern-photoelectric-bench',
  visible: true,
})

export const createModernPhysicsScene = (input: ModernPhysicsSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const bench: ModernPhysicsBench = {
    id: 'modern-photoelectric-bench',
    type: 'photoelectric_effect',
    workFunction: quantity(
      (input.workFunctionEv ?? DEFAULTS.workFunctionEv) * ELECTRON_VOLT_JOULES,
      'J',
      'energy',
    ),
    photonWavelength: quantity(
      (input.photonWavelengthNm ?? DEFAULTS.photonWavelengthNm) * 1e-9,
      'm',
      'length',
    ),
    lightIntensity: quantity(input.lightIntensity ?? DEFAULTS.lightIntensity, 'W/m^2', 'intensity'),
    cathodeArea: quantity(input.cathodeArea ?? DEFAULTS.cathodeArea, 'm^2', 'area'),
    quantumEfficiency: input.quantumEfficiency ?? DEFAULTS.quantumEfficiency,
  }

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'lab-modern-photoelectric'),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(1, 's', 'time'),
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
    leverBenches: [],
    modernPhysicsBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      observable('photon-energy', 'energy'),
      observable('photocurrent', 'current'),
      observable('stopping-potential', 'voltage'),
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '光电效应',
      description: input.description ?? 'Modern Physics Engine · 单光子光电效应 E = hf = W + Kmax',
    },
  }
}

export const modernPhysicsBenchesOf = (scene: PhysicsScene): ModernPhysicsBench[] =>
  scene.modernPhysicsBenches ?? []

export const modernPhysicsBenchOf = (scene: PhysicsScene): ModernPhysicsBench | undefined =>
  modernPhysicsBenchesOf(scene)[0]

export const isModernPhysicsScene = (scene: PhysicsScene): boolean =>
  modernPhysicsBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0

export const createPhotoelectricEffectScene = createModernPhysicsScene
