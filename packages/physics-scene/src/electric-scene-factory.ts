import { quantityVector } from '@physicsos/physics-core'
import { vec3, type Vector3 } from '@physicsos/physics-math'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import type { ElectricFieldDirection } from './scene-runtime.ts'
import { defaultCoordinateSystem } from './scene-validation.ts'
import type { PhysicsScene } from './scene.ts'

export type ElectricObservableKey =
  | 'electricField'
  | 'force'
  | 'velocity'
  | 'acceleration'
  | 'trajectory'
  | 'potential'
  | 'energy'

export interface ElectricSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly particleId?: string
  readonly fieldId?: string
  readonly charge?: number
  readonly mass?: number
  readonly position?: Vector3
  readonly velocity?: Vector3
  readonly electricFieldStrength?: number
  readonly electricFieldDirection?: ElectricFieldDirection
  readonly duration?: number
  readonly observableVisibility?: Partial<Record<ElectricObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const DEFAULTS = {
  sceneId: 'electric-runtime-scene',
  revision: 0,
  particleId: 'particle-1',
  fieldId: 'electric-field-1',
  charge: 1,
  mass: 1,
  position: vec3(1, 6.75, 0),
  velocity: vec3(2, 0, 0),
  electricFieldStrength: 0.8,
  electricFieldDirection: 'down' as const,
  duration: 5,
} as const

const directionVector = (direction: ElectricFieldDirection, strength: number): Vector3 => {
  switch (direction) {
    case 'right':
      return vec3(strength, 0, 0)
    case 'left':
      return vec3(-strength, 0, 0)
    case 'up':
      return vec3(0, strength, 0)
    case 'down':
      return vec3(0, -strength, 0)
  }
}

const observableId = (key: ElectricObservableKey) => asObservableId(`observable-electric-${key}`)

export const createElectricScene = (input: ElectricSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? DEFAULTS.sceneId
  const particleId = input.particleId ?? DEFAULTS.particleId
  const fieldId = input.fieldId ?? DEFAULTS.fieldId
  const duration = input.duration ?? DEFAULTS.duration
  const fieldStrength = Math.abs(input.electricFieldStrength ?? DEFAULTS.electricFieldStrength)
  const fieldDirection = input.electricFieldDirection ?? DEFAULTS.electricFieldDirection
  const visibility = input.observableVisibility ?? {}

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
    revision: input.revision ?? DEFAULTS.revision,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(duration, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
      simulationTimeStep: quantity(1 / 120, 's', 'time'),
    },
    bodies: [],
    particles: [
      {
        id: particleId,
        type: 'particle',
        mass: quantity(input.mass ?? DEFAULTS.mass, 'kg', 'mass'),
        charge: quantity(input.charge ?? DEFAULTS.charge, 'C', 'electric_charge'),
        position: quantityVector(input.position ?? DEFAULTS.position, 'm', 'length'),
        velocity: quantityVector(input.velocity ?? DEFAULTS.velocity, 'm/s', 'velocity'),
      },
    ],
    fields: [
      {
        id: fieldId,
        type: 'uniform_electric',
        fieldStrength: quantityVector(
          directionVector(fieldDirection, fieldStrength),
          'V/m',
          'electric_field',
        ),
      },
    ],
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    measurementDefinitions: [],
    observableDefinitions: [
      { id: observableId('electricField'), type: 'electric_field', targetId: fieldId, visible: visibility.electricField ?? true },
      { id: observableId('force'), type: 'force', targetId: particleId, visible: visibility.force ?? true },
      { id: observableId('velocity'), type: 'velocity', targetId: particleId, visible: visibility.velocity ?? true },
      { id: observableId('acceleration'), type: 'acceleration', targetId: particleId, visible: visibility.acceleration ?? false },
      { id: observableId('trajectory'), type: 'trajectory', targetId: particleId, visible: visibility.trajectory ?? true },
      { id: observableId('potential'), type: 'electric_potential', targetId: particleId, visible: visibility.potential ?? false },
      { id: observableId('energy'), type: 'energy', targetId: particleId, visible: visibility.energy ?? true },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '匀强电场中的带电粒子',
      description: input.description ?? 'Electric Engine · 匀强电场解析运动模型',
    },
  }
}
