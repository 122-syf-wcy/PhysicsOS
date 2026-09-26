/**
 * Ideal cyclotron scene.
 *
 * The scene stores the magnetic field, dee radius, gap voltage and gap width.
 * The electric field in the gap is not a static scene field: the cyclotron
 * engine derives its square-wave polarity from the cyclotron period. Keeping
 * that fact on a dedicated bench prevents the static `sampleFieldsAt` machinery
 * from pretending a time-varying field is constant.
 */
import { quantityVector } from '@physicsos/physics-core'
import { vec3, type Vector3 } from '@physicsos/physics-math'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type {
  CyclotronBench,
  ObservableDefinition,
  PhysicsScene,
  Region,
  UniformMagneticField,
} from '../scene.ts'

export interface CyclotronSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly particleId?: string
  readonly charge?: number
  readonly mass?: number
  readonly initialSpeed?: number
  readonly initialVelocity?: Vector3
  readonly position?: Vector3
  readonly magneticFluxDensity?: number
  readonly magneticOrientation?: 'into_page' | 'out_of_page'
  readonly gapVoltage?: number
  readonly gapWidth?: number
  readonly deeRadius?: number
  readonly duration?: number
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const DEFAULTS = {
  particleId: 'particle-1',
  charge: 1.6e-19,
  mass: 1.67e-27,
  initialSpeed: 1.0e5,
  magneticFluxDensity: 1.5,
  magneticOrientation: 'into_page' as const,
  gapVoltage: 2.0e3,
  gapWidth: 0.02,
  deeRadius: 0.5,
} as const

const observable = (
  key: string,
  type: ObservableDefinition['type'],
  targetId: string,
): ObservableDefinition => ({
  id: asObservableId(`observable-cyclotron-${key}`),
  type,
  targetId,
  visible: true,
})

export const createCyclotronScene = (input: CyclotronSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const particleId = input.particleId ?? DEFAULTS.particleId
  const deeRadius = input.deeRadius ?? DEFAULTS.deeRadius
  const gapWidth = input.gapWidth ?? DEFAULTS.gapWidth
  const magneticStrength = Math.abs(input.magneticFluxDensity ?? DEFAULTS.magneticFluxDensity)
  const orientation = input.magneticOrientation ?? DEFAULTS.magneticOrientation
  const fieldZ = orientation === 'into_page' ? -magneticStrength : magneticStrength
  const duration = input.duration ?? 2e-7

  const magnetic: UniformMagneticField = {
    id: 'cyclotron-magnetic-1',
    type: 'uniform_magnetic',
    magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
  }
  const bench: CyclotronBench = {
    id: 'cyclotron-bench-1',
    type: 'cyclotron',
    magneticFluxDensity: quantity(magneticStrength, 'T', 'magnetic_flux_density'),
    magneticOrientation: orientation,
    gapVoltage: quantity(input.gapVoltage ?? DEFAULTS.gapVoltage, 'V', 'electric_potential'),
    gapWidth: quantity(gapWidth, 'm', 'length'),
    deeRadius: quantity(deeRadius, 'm', 'length'),
  }

  const deeHeight = 2 * deeRadius
  const deeWidth = deeRadius
  const regions: Region[] = [
    {
      id: 'cyclotron-gap',
      shape: {
        type: 'rectangle',
        width: quantity(gapWidth, 'm', 'length'),
        height: quantity(deeHeight, 'm', 'length'),
      },
      center: quantityVector(vec3(0, 0, 0), 'm', 'length'),
    },
    {
      id: 'cyclotron-dee-left',
      shape: {
        type: 'rectangle',
        width: quantity(deeWidth, 'm', 'length'),
        height: quantity(deeHeight, 'm', 'length'),
      },
      center: quantityVector(vec3(-gapWidth / 2 - deeWidth / 2, 0, 0), 'm', 'length'),
    },
    {
      id: 'cyclotron-dee-right',
      shape: {
        type: 'rectangle',
        width: quantity(deeWidth, 'm', 'length'),
        height: quantity(deeHeight, 'm', 'length'),
      },
      center: quantityVector(vec3(gapWidth / 2 + deeWidth / 2, 0, 0), 'm', 'length'),
    },
  ]

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? 'lab-cyclotron'),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(duration, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
      simulationTimeStep: quantity(duration / 240, 's', 'time'),
    },
    bodies: [],
    particles: [
      {
        id: particleId,
        type: 'particle',
        mass: quantity(input.mass ?? DEFAULTS.mass, 'kg', 'mass'),
        charge: quantity(input.charge ?? DEFAULTS.charge, 'C', 'electric_charge'),
        position: quantityVector(input.position ?? vec3(0, 0, 0), 'm', 'length'),
        velocity: quantityVector(
          input.initialVelocity ?? vec3(input.initialSpeed ?? DEFAULTS.initialSpeed, 0, 0),
          'm/s',
          'velocity',
        ),
      },
    ],
    fields: [magnetic],
    forces: [],
    regions,
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    thermalBenches: [],
    leverBenches: [],
    cyclotronBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      observable('velocity', 'velocity', particleId),
      observable('magnetic-field', 'magnetic_field', magnetic.id),
      observable('gap-field', 'electric_field', bench.id),
      observable('trajectory', 'trajectory', particleId),
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '回旋加速器',
      description: input.description ?? 'Composite Engine · 时变缝隙电场与匀强磁场中的螺旋加速',
    },
  }
}

export const cyclotronBenchesOf = (scene: PhysicsScene): CyclotronBench[] =>
  scene.cyclotronBenches ?? []

export const cyclotronBenchOf = (scene: PhysicsScene): CyclotronBench | undefined =>
  cyclotronBenchesOf(scene)[0]

export const isCyclotronScene = (scene: PhysicsScene): boolean =>
  cyclotronBenchesOf(scene).length === 1 &&
  scene.particles.length === 1 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 1
