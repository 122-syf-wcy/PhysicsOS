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
import { defaultCoordinateSystem } from './scene-validation.ts'
import type {
  PhysicsScene,
  Body,
  Constraint,
  Force,
  GravityField,
  ShapeDefinition,
  ObservableDefinition,
} from './scene.ts'

export type MechanicsModelId =
  | 'uniform_linear_motion'
  | 'uniformly_accelerated_motion'
  | 'projectile_motion'
  | 'newton_second_law'
  | 'inclined_plane'
  | 'spring_oscillator'
  | 'simple_pendulum'
  | 'horizontal_friction'
  | 'spring_statics'
  | 'circular_orbit'

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
  /**
   * Central body's gravitational parameter GM (m³/s²) and the orbit radius (m).
   *
   * A circular orbit is fixed by these two and nothing else: the speed follows
   * as √(GM/r), so a scene that stated the speed as well would be stating the
   * same fact twice and could state it inconsistently.
   */
  readonly gravitationalParameter?: number
  readonly orbitRadius?: number
  /**
   * Additional applied forces beyond {@link appliedForce} — a force-
   * composition experiment declares F₂ (and F₃) here so every pull is a
   * declared scene force the solver and the observation layer both see, not a
   * renderer invention.
   */
  readonly appliedForces?: readonly Vector3[]
  /**
   * Spring stiffness in N/m for `spring_oscillator` (horizontal) and
   * `spring_statics` (vertical, Hooke's law) scenes. Carried on the spring
   * constraint's parameters.
   */
  readonly springConstant?: number
  /** Spring's relaxed length in m. */
  readonly springNaturalLength?: number
  /**
   * Where the spring's fixed end sits, in scene coordinates. A horizontal
   * spring anchors on the wall to the left of the body; a vertical spring
   * hangs from a support above it.
   */
  readonly springAnchor?: Vector3
  /** String length in m for `simple_pendulum` (pivot to bob centre). */
  readonly pendulumLength?: number
  /** Pendulum pivot point in scene coordinates; defaults to above the bob. */
  readonly pendulumPivot?: Vector3
  /**
   * Static friction limit coefficient μs for `horizontal_friction` scenes.
   * Stored on the body's material next to the kinetic `frictionCoefficient`.
   */
  readonly staticFrictionCoefficient?: number
  /**
   * How fast the applied pull grows, in N/s, for `horizontal_friction`
   * scenes — the classic "increase the pull until it slips" protocol.
   * A zero ramp models a constant pull.
   */
  readonly appliedForceRamp?: number
  /** Cap on the applied pull in N for `horizontal_friction` scenes. */
  readonly maxAppliedForce?: number
  /**
   * How long the motion runs, in seconds. A question that states "运动 5 s"
   * pins this; engines fall back to their own default duration when unset.
   */
  readonly endTime?: number
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
  staticFrictionCoefficient?: number,
): Body {
  const shape: ShapeDefinition = { type: 'circle', radius: quantity(0.5, 'm', 'length') }
  const material =
    frictionCoefficient === undefined && staticFrictionCoefficient === undefined
      ? undefined
      : {
          ...(frictionCoefficient === undefined ? {} : { frictionCoefficient }),
          ...(staticFrictionCoefficient === undefined ? {} : { staticFrictionCoefficient }),
        }
  return {
    id,
    type: 'rigid_body',
    mass: quantity(mass, 'kg', 'mass'),
    position: quantityVector(position, 'm', 'length'),
    velocity: quantityVector(velocity, 'm/s', 'velocity'),
    ...(acceleration !== undefined
      ? { acceleration: quantityVector(acceleration, 'm/s^2', 'acceleration') }
      : {}),
    /* μ lives on the body's material because that is where the model resolver
       reads it: declaring a friction FORCE without it would let a scene claim
       friction while the solver silently used μ = 0. */
    ...(material === undefined ? {} : { material }),
    shape,
  }
}

export const createMechanicsScene = (input: MechanicsSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const bodyId = input.bodyId ?? 'body-1'
  const fieldId = input.fieldId ?? 'gravity-1'
  const mass = input.mass ?? 1
  /* A circular orbit places its own body: at (r, 0) with the speed √(GM/r) that
     keeps it there. That is the scene stating its geometry in the units the rest
     of the scene uses — the engine derives both again from GM and r, so it is
     not a second source of truth for the physics. */
  const orbitGm = input.gravitationalParameter ?? 3.986004418e14
  const orbitRadius = input.orbitRadius ?? 6.8e6
  const position =
    input.position ?? (input.model === 'circular_orbit' ? vec3(orbitRadius, 0, 0) : vec3(0, 0, 0))
  const velocity =
    input.velocity ??
    (input.model === 'circular_orbit'
      ? vec3(0, Math.sqrt(orbitGm / orbitRadius), 0)
      : vec3(0, 0, 0))
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
  input.appliedForces?.forEach((vector, index) => {
    forces.push({
      id: `force-applied-${index + 2}`,
      type: 'custom',
      targetId: bodyId,
      vector: quantityVector(vector, 'N', 'force'),
      model: 'applied',
    })
  })

  const observableDefs: ObservableDefinition[] = [
    {
      id: asObservableId('obs-position'),
      type: 'geometry' as const,
      targetId: bodyId,
      visible: false,
      parameters: { kind: 'position' },
    },
    {
      id: asObservableId('obs-velocity'),
      type: 'velocity' as const,
      targetId: bodyId,
      visible: true,
    },
    {
      id: asObservableId('obs-acceleration'),
      type: 'acceleration' as const,
      targetId: bodyId,
      visible: true,
    },
    {
      id: asObservableId('obs-trajectory'),
      type: 'trajectory' as const,
      targetId: bodyId,
      visible: true,
    },
    /* Forces are a first-class observable so the free-body arrows are gated by
       scene state and toggled through a command, not hidden with CSS. */
    { id: asObservableId('obs-forces'), type: 'force' as const, targetId: bodyId, visible: true },
  ]

  if (model === 'projectile_motion') {
    observableDefs.push(
      {
        id: asObservableId('obs-ground'),
        type: 'geometry' as const,
        visible: true,
        parameters: { kind: 'ground', groundY },
      },
      {
        id: asObservableId('obs-impact'),
        type: 'geometry' as const,
        targetId: bodyId,
        visible: false,
        parameters: { kind: 'impact_point' },
      },
      {
        id: asObservableId('obs-keypoints'),
        type: 'geometry' as const,
        targetId: bodyId,
        visible: true,
        parameters: { kind: 'keypoints' },
      },
      /* Components start hidden: the resultant is the physical statement, the
         projection onto axes is a study aid the student opts into. */
      {
        id: asObservableId('obs-components'),
        type: 'geometry' as const,
        targetId: bodyId,
        visible: false,
        parameters: { kind: 'velocity_components' },
      },
    )
  }

  if (model === 'inclined_plane') {
    observableDefs.push(
      {
        id: asObservableId('obs-incline'),
        type: 'geometry' as const,
        visible: true,
        parameters: { kind: 'incline', angle: input.inclineAngle ?? 30 },
      },
      {
        id: asObservableId('obs-decomposition'),
        type: 'geometry' as const,
        targetId: bodyId,
        visible: false,
        parameters: { kind: 'force_decomposition' },
      },
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

  const constraints: Constraint[] = []

  /* Spring rigs carry their physical parameters on a `spring` constraint —
     the schema's designated place for connectors — so the engine resolves
     k / natural length / anchor from scene truth rather than a title hint. */
  if (model === 'spring_oscillator' || model === 'spring_statics') {
    const axis = model === 'spring_statics' ? 'vertical' : 'horizontal'
    const anchor = input.springAnchor ?? (axis === 'vertical' ? vec3(0, 3, 0) : vec3(-3, 0, 0))
    constraints.push({
      id: 'spring-1',
      type: 'spring',
      targets: [bodyId],
      parameters: {
        stiffness: input.springConstant ?? 50,
        naturalLength: input.springNaturalLength ?? 2,
        anchor: { x: anchor.x, y: anchor.y },
        axis,
      },
    })
  }

  /* A pendulum's string is a `rope` constraint: pivot + length are the whole
     physical declaration; the engine derives the small-angle motion. */
  if (model === 'simple_pendulum') {
    const pivot = input.pendulumPivot ?? vec3(0, 0, 0)
    constraints.push({
      id: 'rope-1',
      type: 'rope',
      targets: [bodyId],
      parameters: {
        pivot: { x: pivot.x, y: pivot.y },
        length: input.pendulumLength ?? 1,
      },
    })
  }

  /* Horizontal friction: the pull ramps linearly (the classic force-sensor
     protocol) and the surface declares μs alongside the body's μk. Ramp and
     cap ride on a geometry observable — the established place for model
     parameters the inspector can name. */
  if (model === 'circular_orbit') {
    /* The orbit is declared as one observable carrying GM and r: the solver
       reads it, the canvas draws the circle from it, and the inspector edits it.
       No force is declared, because gravity IS the central force here — adding a
       `gravity` force object would be a second statement of the same thing. */
    observableDefs.push({
      id: asObservableId('obs-orbit'),
      type: 'geometry' as const,
      visible: true,
      parameters: {
        kind: 'orbit',
        gravitationalParameter: input.gravitationalParameter ?? 3.986004418e14,
        radius: input.orbitRadius ?? 6.8e6,
      },
    })
  }

  if (model === 'horizontal_friction') {
    observableDefs.push({
      id: asObservableId('obs-friction-surface'),
      type: 'geometry' as const,
      visible: true,
      parameters: {
        kind: 'friction_surface',
        surfaceY: position.y,
        rampRate: input.appliedForceRamp ?? 2,
        maxForce: input.maxAppliedForce ?? 30,
      },
    })
    forces.push({
      id: 'force-friction',
      type: 'friction',
      targetId: bodyId,
      model: 'static_then_kinetic',
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
      ...(input.endTime === undefined ? {} : { endTime: quantity(input.endTime, 's', 'time') }),
      state: 'idle',
      playbackRate: 1,
    },
    bodies: [
      makeBody(
        bodyId,
        mass,
        position,
        velocity,
        acceleration,
        input.frictionCoefficient,
        input.staticFrictionCoefficient,
      ),
    ],
    particles: [],
    fields,
    forces,
    regions: [],
    boundaries: [],
    constraints,
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
      title: input.title ?? `Mechanics Scene: ${model}`,
      description:
        input.description ?? `Generated by PhysicsOS Mechanics Scene Factory for model ${model}`,
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
    /* The scene's declared end time is the run window the question states —
       the engine honours options.endTime and falls back to its model default. */
    options: scene.timeline.endTime === undefined ? {} : { endTime: scene.timeline.endTime },
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}
