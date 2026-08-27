import { vec3, type Vector3 } from '@physicsos/physics-math'
import { quantityVector } from '@physicsos/physics-core'
import {
  asCommandId,
  asObservableId,
  asSceneId,
  asTraceId,
  type IsoDateTime,
} from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import type {
  SceneCommandEnvelope,
  SceneCommandPayloadMap,
  SceneCommandType,
} from './scene-runtime.ts'
import { defaultCoordinateSystem } from './scene-validation.ts'
import type { PhysicsScene } from './scene.ts'

export type MagneticObservableKey = 'velocity' | 'force' | 'trajectory' | 'center' | 'radius'

export interface MagneticSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly particleId?: string
  readonly fieldId?: string
  readonly charge?: number
  readonly mass?: number
  readonly position?: Vector3
  readonly velocity?: Vector3
  /** Strength is a non-negative magnitude; direction controls the z sign. */
  readonly magneticFieldStrength?: number
  readonly magneticFieldDirection?: 'into_page' | 'out_of_page'
  readonly observableVisibility?: Partial<Record<MagneticObservableKey, boolean>>
  readonly now?: IsoDateTime
  /** Student-facing scene name; reaches the Lab toolbar and the canvas label. */
  readonly title?: string
  readonly description?: string
}

const DEFAULTS = {
  sceneId: 'magnetic-runtime-scene',
  revision: 0,
  particleId: 'particle-1',
  fieldId: 'field-1',
  charge: 1.6e-19,
  mass: 1.67e-27,
  position: vec3(0, 0, 0),
  velocity: vec3(2e6, 0, 0),
  magneticFieldStrength: 0.5,
  magneticFieldDirection: 'into_page' as const,
} as const

const observableId = (key: MagneticObservableKey) => asObservableId(`observable-${key}`)

/**
 * Creates the smallest valid scene accepted by the frozen magnetic engine.
 * This factory owns units, IDs and scene defaults so renderers and host
 * adapters only handle a PhysicsScene contract, never raw physics literals.
 */
export const createMagneticScene = (input: MagneticSceneInput = {}): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? DEFAULTS.sceneId
  const particleId = input.particleId ?? DEFAULTS.particleId
  const fieldId = input.fieldId ?? DEFAULTS.fieldId
  const charge = input.charge ?? DEFAULTS.charge
  const mass = input.mass ?? DEFAULTS.mass
  const position = input.position ?? DEFAULTS.position
  const velocity = input.velocity ?? DEFAULTS.velocity
  const strength = Math.abs(input.magneticFieldStrength ?? DEFAULTS.magneticFieldStrength)
  const direction = input.magneticFieldDirection ?? DEFAULTS.magneticFieldDirection
  const fieldZ = direction === 'into_page' ? -strength : strength
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
      state: 'idle',
      playbackRate: 1,
    },
    bodies: [],
    particles: [
      {
        id: particleId,
        type: 'particle',
        mass: quantity(mass, 'kg', 'mass'),
        charge: quantity(charge, 'C', 'electric_charge'),
        position: quantityVector(position, 'm', 'length'),
        velocity: quantityVector(velocity, 'm/s', 'velocity'),
      },
    ],
    fields: [
      {
        id: fieldId,
        type: 'uniform_magnetic',
        magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
      },
    ],
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
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('velocity'),
        type: 'velocity',
        targetId: particleId,
        visible: visibility.velocity ?? true,
      },
      {
        id: observableId('force'),
        type: 'force',
        targetId: particleId,
        visible: visibility.force ?? true,
      },
      {
        id: observableId('trajectory'),
        type: 'trajectory',
        targetId: particleId,
        visible: visibility.trajectory ?? true,
      },
      {
        id: observableId('center'),
        type: 'geometry',
        targetId: particleId,
        visible: visibility.center ?? false,
        parameters: { kind: 'orbit_center' },
      },
      {
        id: observableId('radius'),
        type: 'geometry',
        targetId: particleId,
        visible: visibility.radius ?? false,
        parameters: { kind: 'radius' },
      },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? 'Magnetic Runtime Scene',
      description: input.description ?? 'Frozen uniform magnetic field circular-motion model.',
    },
  }
}

export interface SceneCommandInput<TType extends SceneCommandType> {
  readonly commandId: string
  readonly sceneId: string
  readonly expectedRevision: number
  readonly type: TType
  readonly payload: SceneCommandPayloadMap[TType]
  readonly actor?: SceneCommandEnvelope<TType, SceneCommandPayloadMap[TType]>['actor']
  readonly traceId: string
  readonly issuedAt?: IsoDateTime
}

/** Creates a contract-valid command from transport-safe string IDs. */
export const createSceneCommand = <TType extends SceneCommandType>(
  input: SceneCommandInput<TType>,
): SceneCommandEnvelope<TType, SceneCommandPayloadMap[TType]> => {
  const issuedAt = input.issuedAt ?? new Date().toISOString()
  return {
    schemaVersion: 'scene-command/1.0',
    commandId: asCommandId(input.commandId),
    sceneId: asSceneId(input.sceneId),
    expectedRevision: input.expectedRevision,
    type: input.type,
    payload: input.payload,
    actor: input.actor ?? { type: 'user', id: 'physicsos-ui' },
    trace: {
      traceId: asTraceId(input.traceId),
      sceneId: asSceneId(input.sceneId),
      sceneRevision: input.expectedRevision,
    },
    issuedAt,
  }
}

/** Stable helper for callers that need a fresh vector without shared aliases. */
export const cloneVector = (value: Vector3): Vector3 => vec3(value.x, value.y, value.z)
