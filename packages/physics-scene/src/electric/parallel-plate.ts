/**
 * Parallel-plate / bounded uniform electric field scene factory.
 *
 * A parallel-plate capacitor creates a **bounded** uniform electric field: the
 * field exists only in the rectangular region between the two plates. Outside
 * that region the field is zero, so a charged particle travels in a straight
 * line until it enters the field, follows a parabola inside, then resumes a
 * straight line on exit — or strikes a plate.
 *
 * The scene only DESCRIBES the geometry (two plate boundaries, one rectangular
 * field region, one uniform field bound to that region, one particle). It never
 * evaluates the trajectory — the engine does. This keeps a scene from ever
 * disagreeing with a solver about what the field is, matching the architecture
 * rule in `docs/15-RUNTIME-ARCHITECTURE.md`.
 *
 * Coordinates: x along the plate length (the particle's initial velocity
 * direction), y along the plate separation. The field region is centred at the
 * origin with the particle entering from the left edge, matching the usual
 * "电子从极板左侧水平射入" textbook setup.
 */
import { quantityVector } from '@physicsos/physics-core'
import { vec3, type Vector3 } from '@physicsos/physics-math'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import type { ElectricFieldDirection } from '../scene-runtime.ts'
import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { Boundary, PhysicsScene, Region, UniformElectricField } from '../scene.ts'

export type ParallelPlateObservableKey =
  | 'electricField'
  | 'force'
  | 'velocity'
  | 'acceleration'
  | 'trajectory'
  | 'energy'

export interface ParallelPlateSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly particleId?: string
  readonly fieldId?: string
  readonly regionId?: string
  readonly topPlateId?: string
  readonly bottomPlateId?: string
  readonly charge?: number
  readonly mass?: number
  /** Initial position in metres. The particle starts outside (left of) the field region. */
  readonly position?: Vector3
  /** Initial velocity in m/s. x is along the plate length; y is across the gap. */
  readonly velocity?: Vector3
  readonly electricFieldStrength?: number
  readonly electricFieldDirection?: ElectricFieldDirection
  /** Distance between the two plates, in metres (the field region's height). */
  readonly plateSeparation?: number
  /** Plate length along x, in metres (the field region's width). */
  readonly plateLength?: number
  readonly duration?: number
  readonly observableVisibility?: Partial<Record<ParallelPlateObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const DEFAULTS = {
  sceneId: 'electric-parallel-plate-scene',
  revision: 0,
  particleId: 'particle-1',
  fieldId: 'parallel-plate-field-1',
  regionId: 'field-region-1',
  topPlateId: 'plate-top-1',
  bottomPlateId: 'plate-bottom-1',
  charge: -1.6e-19,
  mass: 9.11e-31,
  position: vec3(-0.08, 0, 0),
  velocity: vec3(3e7, 0, 0),
  electricFieldStrength: 2000,
  electricFieldDirection: 'down' as const,
  plateSeparation: 0.04,
  plateLength: 0.12,
  duration: 8e-9,
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

const observableId = (key: ParallelPlateObservableKey) =>
  asObservableId(`observable-parallel-plate-${key}`)

export const createParallelPlateScene = (input: ParallelPlateSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? DEFAULTS.sceneId
  const particleId = input.particleId ?? DEFAULTS.particleId
  const fieldId = input.fieldId ?? DEFAULTS.fieldId
  const regionId = input.regionId ?? DEFAULTS.regionId
  const topPlateId = input.topPlateId ?? DEFAULTS.topPlateId
  const bottomPlateId = input.bottomPlateId ?? DEFAULTS.bottomPlateId
  const duration = input.duration ?? DEFAULTS.duration
  const fieldStrength = Math.abs(input.electricFieldStrength ?? DEFAULTS.electricFieldStrength)
  const fieldDirection = input.electricFieldDirection ?? DEFAULTS.electricFieldDirection
  const plateSeparation = input.plateSeparation ?? DEFAULTS.plateSeparation
  const plateLength = input.plateLength ?? DEFAULTS.plateLength
  const visibility = input.observableVisibility ?? {}

  /* The field region is a rectangle centred at the origin: width = plate length
     along x, height = plate separation along y. The particle enters from the
     left edge. */
  const regionCenter = vec3(0, 0, 0)
  const region: Region = {
    id: regionId,
    shape: {
      type: 'rectangle',
      width: quantity(plateLength, 'm', 'length'),
      height: quantity(plateSeparation, 'm', 'length'),
    },
    center: quantityVector(regionCenter, 'm', 'length'),
  }

  /* The two plates are line boundaries at the top and bottom of the gap. A
     particle that reaches a plate stops (HitsPlate) — the usual textbook
     "打到极板" outcome. */
  const topPlate: Boundary = {
    id: topPlateId,
    type: 'segment',
    geometry: {
      type: 'segment',
      start: quantityVector(vec3(-plateLength / 2, plateSeparation / 2, 0), 'm', 'length'),
      end: quantityVector(vec3(plateLength / 2, plateSeparation / 2, 0), 'm', 'length'),
    },
    behavior: { type: 'stop' },
  }
  const bottomPlate: Boundary = {
    id: bottomPlateId,
    type: 'segment',
    geometry: {
      type: 'segment',
      start: quantityVector(vec3(-plateLength / 2, -plateSeparation / 2, 0), 'm', 'length'),
      end: quantityVector(vec3(plateLength / 2, -plateSeparation / 2, 0), 'm', 'length'),
    },
    behavior: { type: 'stop' },
  }

  const field: UniformElectricField = {
    id: fieldId,
    type: 'uniform_electric',
    fieldStrength: quantityVector(
      directionVector(fieldDirection, fieldStrength),
      'V/m',
      'electric_field',
    ),
    regionId,
  }

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
      simulationTimeStep: quantity(1 / 240, 's', 'time'),
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
    fields: [field],
    forces: [],
    regions: [region],
    boundaries: [topPlate, bottomPlate],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    measurementDefinitions: [],
    observableDefinitions: [
      { id: observableId('electricField'), type: 'electric_field', targetId: fieldId, visible: visibility.electricField ?? true },
      { id: observableId('force'), type: 'force', targetId: particleId, visible: visibility.force ?? true },
      { id: observableId('velocity'), type: 'velocity', targetId: particleId, visible: visibility.velocity ?? true },
      { id: observableId('acceleration'), type: 'acceleration', targetId: particleId, visible: visibility.acceleration ?? true },
      { id: observableId('trajectory'), type: 'trajectory', targetId: particleId, visible: visibility.trajectory ?? true },
      { id: observableId('energy'), type: 'energy', targetId: particleId, visible: visibility.energy ?? true },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '平行板电场中的带电粒子',
      description: input.description ?? 'Electric Region Engine · 平行板有界匀强电场解析运动模型',
    },
  }
}

/** Read the plate separation (gap height) from a parallel-plate scene's region. */
export const plateSeparationOf = (scene: PhysicsScene): number => {
  const region = scene.regions[0]
  if (region === undefined || region.shape.type !== 'rectangle') return 0
  return region.shape.height.value
}

/** Read the plate length (field region width) from a parallel-plate scene's region. */
export const plateLengthOf = (scene: PhysicsScene): number => {
  const region = scene.regions[0]
  if (region === undefined || region.shape.type !== 'rectangle') return 0
  return region.shape.width.value
}

/**
 * Whether a scene is a bounded (parallel-plate) electric field scene.
 *
 * The magnetic/gravity exclusion is load-bearing, not defensive. A velocity
 * selector is *also* "a region-bound uniform E field plus regions" — it just adds
 * a B field so the electric and magnetic forces can cancel. Without this guard it
 * would be classified as a parallel plate and routed to the bounded-electric
 * engine, which models no magnetic force at all and would silently solve the
 * wrong physics. Six call sites read this predicate (engine canHandle, visual
 * bridge, workspace runtime, question preview, and two scene helpers), so the
 * exclusion belongs here at the source rather than at each of them.
 */
export const isParallelPlateScene = (scene: PhysicsScene): boolean => {
  if (scene.fields.length === 0) return false
  const hasUniformElectric = scene.fields.some((f) => f.type === 'uniform_electric')
  const hasRegionBinding = scene.fields.some(
    (f) => f.type === 'uniform_electric' && f.regionId !== undefined,
  )
  const hasOtherField = scene.fields.some(
    (f) => f.type === 'uniform_magnetic' || f.type === 'uniform_gravity',
  )
  return hasUniformElectric && hasRegionBinding && !hasOtherField && scene.regions.length > 0
}
