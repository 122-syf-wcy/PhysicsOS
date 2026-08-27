import { vec3, type Vector3 } from '@physicsos/physics-math'
import { quantityVector } from '@physicsos/physics-core'
import { asSceneId, asObservableId, asQuestionId, asSimulationId, asTraceId, type IsoDateTime } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'
import type { SimulationRequest } from '@physicsos/physics-core'
import { defaultCoordinateSystem } from './scene-validation.ts'
import type { PhysicsScene, Body, Force, GravityField, ShapeDefinition, ObservableDefinition } from './scene.ts'

export type MechanicsModelId =
  | 'uniform_linear_motion'
  | 'uniformly_accelerated_motion'
  | 'projectile_motion'
  | 'newton_second_law'
  | 'inclined_plane'

export interface MechanicsSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly bodyId?: string
  readonly fieldId?: string
  readonly model: MechanicsModelId
  readonly mass?: number
  readonly position?: Vector3
  readonly velocity?: Vector3
  readonly acceleration?: Vector3
  readonly gravity?: Vector3
  readonly groundY?: number
  readonly launchAngle?: number
  readonly inclineAngle?: number
  readonly frictionCoefficient?: number
  readonly appliedForce?: Vector3
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
  /**
   * Question this scene was built from.
   *
   * Load-bearing beyond provenance: the Lab forks an experimental branch instead
   * of mutating a question's stated facts, and this is how it knows the scene is a
   * question in the first place.
   */
  readonly sourceQuestionId?: string
}

const DEFAULT_GRAVITY = vec3(0, -9.8, 0)

function makeBody(
  id: string,
  mass: number,
  position: Vector3,
  velocity: Vector3,
  acceleration?: Vector3,
  frictionCoefficient?: number,
): Body {
  const shape: ShapeDefinition = { type: 'circle', radius: quantity(0.5, 'm', 'length') }
  return {
    id,
    type: 'rigid_body',
    mass: quantity(mass, 'kg', 'mass'),
    position: quantityVector(position, 'm', 'length'),
    velocity: quantityVector(velocity, 'm/s', 'velocity'),
    ...(acceleration !== undefined ? { acceleration: quantityVector(acceleration, 'm/s^2', 'acceleration') } : {}),
    /* μ lives on the body's material because that is where the model resolver
       reads it: declaring a friction FORCE without it would let a scene claim
       friction while the solver silently used μ = 0. */
    ...(frictionCoefficient !== undefined ? { material: { frictionCoefficient } } : {}),
    shape,
  }
}

export const createMechanicsScene = (input: MechanicsSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const bodyId = input.bodyId ?? 'body-1'
  const fieldId = input.fieldId ?? 'gravity-1'
  const mass = input.mass ?? 1
  const position = input.position ?? vec3(0, 0, 0)
  const velocity = input.velocity ?? vec3(0, 0, 0)
  const acceleration = input.acceleration
  const gravity = input.gravity ?? DEFAULT_GRAVITY
  const groundY = input.groundY ?? 0
  const model = input.model

  const forces: Force[] = []
  const fields: GravityField[] = [
    {
      id: fieldId,
      type: 'uniform_gravity',
      acceleration: quantityVector(gravity, 'm/s^2', 'acceleration'),
    },
  ]

  if (input.appliedForce !== undefined) {
    forces.push({
      id: 'force-applied',
      type: 'custom',
      targetId: bodyId,
      vector: quantityVector(input.appliedForce, 'N', 'force'),
      model: 'applied',
    })
  }

  const observableDefs: ObservableDefinition[] = [
    { id: asObservableId('obs-position'), type: 'geometry' as const, targetId: bodyId, visible: false, parameters: { kind: 'position' } },
    { id: asObservableId('obs-velocity'), type: 'velocity' as const, targetId: bodyId, visible: true },
    { id: asObservableId('obs-acceleration'), type: 'acceleration' as const, targetId: bodyId, visible: true },
    { id: asObservableId('obs-trajectory'), type: 'trajectory' as const, targetId: bodyId, visible: true },
    /* Forces are a first-class observable so the free-body arrows are gated by
       scene state and toggled through a command, not hidden with CSS. */
    { id: asObservableId('obs-forces'), type: 'force' as const, targetId: bodyId, visible: true },
  ]

  if (model === 'projectile_motion') {
    observableDefs.push(
      { id: asObservableId('obs-ground'), type: 'geometry' as const, visible: true, parameters: { kind: 'ground', groundY } },
      { id: asObservableId('obs-impact'), type: 'geometry' as const, targetId: bodyId, visible: false, parameters: { kind: 'impact_point' } },
      { id: asObservableId('obs-keypoints'), type: 'geometry' as const, targetId: bodyId, visible: true, parameters: { kind: 'keypoints' } },
      /* Components start hidden: the resultant is the physical statement, the
         projection onto axes is a study aid the student opts into. */
      { id: asObservableId('obs-components'), type: 'geometry' as const, targetId: bodyId, visible: false, parameters: { kind: 'velocity_components' } },
    )
  }

  if (model === 'inclined_plane') {
    observableDefs.push(
      { id: asObservableId('obs-incline'), type: 'geometry' as const, visible: true, parameters: { kind: 'incline', angle: input.inclineAngle ?? 30 } },
      { id: asObservableId('obs-decomposition'), type: 'geometry' as const, targetId: bodyId, visible: false, parameters: { kind: 'force_decomposition' } },
    )
    if (input.frictionCoefficient !== undefined && input.frictionCoefficient > 0) {
      forces.push({
        id: 'force-friction',
        type: 'friction',
        targetId: bodyId,
        model: 'kinetic_friction',
      })
    }
    forces.push({
      id: 'force-normal',
      type: 'normal',
      targetId: bodyId,
      model: 'surface_normal',
    })
  }

  if (model === 'newton_second_law' && input.appliedForce !== undefined) {
    forces.push({
      id: 'force-gravity',
      type: 'gravity',
      targetId: bodyId,
      model: 'uniform_gravity',
    })
    forces.push({
      id: 'force-normal',
      type: 'normal',
      targetId: bodyId,
      model: 'surface_normal',
    })
  }

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(input.sceneId ?? `mechanics-${model}-scene`),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
    },
    bodies: [makeBody(bodyId, mass, position, velocity, acceleration, input.frictionCoefficient)],
    particles: [],
    fields,
    forces,
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    measurementDefinitions: [],
    observableDefinitions: observableDefs,
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      ...(input.sourceQuestionId === undefined
        ? {}
        : { sourceQuestionId: asQuestionId(input.sourceQuestionId) }),
      title: input.title ?? `Mechanics Scene: ${model}`,
      description: input.description ?? `Generated by PhysicsOS Mechanics Scene Factory for model ${model}`,
    },
  }
}

export const createMechanicsSimulationRequest = (
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest => {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'mechanics',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}
