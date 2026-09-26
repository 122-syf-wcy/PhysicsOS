import { vec3, type Vector3 } from '@physicsos/physics-math'
import { quantityVector } from '@physicsos/physics-core'
import {
  asSceneId,
  asObservableId,
  asQuestionId,
  asSimulationId,
  asTraceId,
  type IsoDateTime,
} from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'
import type { SimulationRequest } from '@physicsos/physics-core'
import { defaultCoordinateSystem } from '../scene-validation.ts'
import type {
  PhysicsScene,
  Body,
  GravityField,
  ShapeDefinition,
  ObservableDefinition,
  Boundary,
} from '../scene.ts'

/**
 * A body of a collision experiment.
 *
 * Position and velocity are 2D vectors in scene metres / m·s⁻¹. `restitution`
 * is the body's coefficient of restitution (0..1): 1 keeps elastic collisions
 * with this body, 0 makes them perfectly inelastic, any value in between is a
 * partially elastic (energy-dissipating) collision.
 */
export interface CollisionBodySpec {
  id: string
  mass: number
  position: [number, number]
  velocity: [number, number]
  /** Circle radius in metres; defaults to 0.5. */
  radius?: number
  /** Coefficient of restitution 0..1; defaults to 1 (elastic). */
  restitution?: number
}

/** Input for {@link createCollisionScene}. */
export interface CollisionSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly bodies: readonly CollisionBodySpec[]
  /**
   * Uniform gravity acceleration, e.g. [0, -9.8]. Omitted (or [0,0]) for the
   * frictionless horizontal bench where momentum is exactly conserved.
   */
  readonly gravity?: [number, number]
  /**
   * Optional rectangular reflective wall, centred on the origin with the given
   * total width and height. When absent the bodies move unbounded.
   */
  readonly boundary?: { width: number; height: number }
  /** Restitution of the boundary walls; defaults to 1. */
  readonly boundaryRestitution?: number
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
  /**
   * Question this scene was built from. Load-bearing beyond provenance: the Lab
   * forks an experimental branch instead of mutating a question's stated facts,
   * and this is how it knows the scene is a question in the first place.
   */
  readonly sourceQuestionId?: string
}

const makeBody = (spec: CollisionBodySpec): Body => {
  const radius = spec.radius ?? 0.5
  const shape: ShapeDefinition = { type: 'circle', radius: quantity(radius, 'm', 'length') }
  return {
    id: spec.id,
    type: 'rigid_body',
    mass: quantity(spec.mass, 'kg', 'mass'),
    position: quantityVector(vec3(spec.position[0], spec.position[1], 0), 'm', 'length'),
    velocity: quantityVector(vec3(spec.velocity[0], spec.velocity[1], 0), 'm/s', 'velocity'),
    /* The engine's model detection reads restitution off the material, exactly
       like the mechanics engine reads friction off the material: the material is
       where the body's contact behaviour lives, so a scene cannot claim a
       restitution the solver would silently ignore. */
    ...(spec.restitution === undefined ? {} : { material: { restitution: spec.restitution } }),
    shape,
  }
}

/**
 * Builds a PhysicsScene for a multi-body collision experiment (docs/05 §67).
 *
 * The scene stores the bodies' editable facts — mass, position, velocity, radius
 * and restitution — plus the optional gravity and reflective boundary. The
 * engine derives positions/velocities over time and the momentum / energy
 * verification from these facts; nothing here is a simulation result.
 */
export const createCollisionScene = (input: CollisionSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'collision-scene'
  const bodies = input.bodies.map(makeBody)
  const gravity: Vector3 =
    input.gravity === undefined ? vec3(0, 0, 0) : vec3(input.gravity[0], input.gravity[1], 0)

  const fields: GravityField[] =
    gravity.x !== 0 || gravity.y !== 0
      ? [
          {
            id: 'gravity-1',
            type: 'uniform_gravity',
            acceleration: quantityVector(gravity, 'm/s^2', 'acceleration'),
          },
        ]
      : []

  const boundaries: Boundary[] =
    input.boundary === undefined
      ? []
      : [
          {
            id: 'boundary-1',
            type: 'rectangle',
            geometry: {
              type: 'rectangle',
              width: quantity(input.boundary.width, 'm', 'length'),
              height: quantity(input.boundary.height, 'm', 'length'),
            },
            behavior: { type: 'reflect', restitution: input.boundaryRestitution ?? 1 },
          },
        ]

  const observableDefs: ObservableDefinition[] = [
    {
      id: asObservableId('obs-position'),
      type: 'geometry' as const,
      visible: false,
      parameters: { kind: 'position' },
    },
    { id: asObservableId('obs-velocity'), type: 'velocity' as const, visible: true },
    { id: asObservableId('obs-trajectory'), type: 'trajectory' as const, visible: true },
    { id: asObservableId('obs-momentum'), type: 'momentum' as const, visible: true },
    { id: asObservableId('obs-energy'), type: 'energy' as const, visible: true },
  ]

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
    bodies,
    particles: [],
    fields,
    forces: [],
    regions: [],
    boundaries,
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    thermalBenches: [],
    leverBenches: [],
    measurementDefinitions: [],
    observableDefinitions: observableDefs,
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      ...(input.sourceQuestionId === undefined
        ? {}
        : { sourceQuestionId: asQuestionId(input.sourceQuestionId) }),
      title: input.title ?? 'Collision Scene',
      description: input.description ?? 'Generated by PhysicsOS Collision Scene Factory',
    },
  }
}

export const createCollisionSimulationRequest = (
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
