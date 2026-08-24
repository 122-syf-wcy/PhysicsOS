import {
  derivedScalar,
  derivedVector,
  quantityVector,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { magnitude, type Vector3 } from '@physicsos/physics-math'
import { PhysicsOSError } from '@physicsos/shared'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'
import type { Quantity } from '@physicsos/physics-units'

export interface PositionObservation {
  readonly type: 'position'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
  readonly position: QuantityVector<'length'>
}

export interface MechanicsVelocityObservation {
  readonly type: 'mechanics_velocity'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'velocity'>
  readonly magnitude: Quantity<'velocity'>
}

export interface AccelerationObservation {
  readonly type: 'acceleration'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'acceleration'>
  readonly magnitude: Quantity<'acceleration'>
}

export interface ForceObservation {
  readonly type: 'mechanics_force'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
  readonly label: string
}

export interface NetForceObservation {
  readonly type: 'net_force'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
}

export interface MechanicsTrajectoryObservation {
  readonly type: 'mechanics_trajectory'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly points: readonly { time: Quantity<'time'>; position: QuantityVector<'length'> }[]
}

export interface DisplacementObservation {
  readonly type: 'displacement'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
  readonly vector: QuantityVector<'length'>
  readonly magnitude: Quantity<'length'>
}

export interface ProjectileKeyPointObservation {
  readonly type: 'projectile_key_point'
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly launchPoint: QuantityVector<'length'>
  readonly apexPoint: QuantityVector<'length'>
  readonly impactPoint: QuantityVector<'length'>
  readonly flightTime: Quantity<'time'>
  readonly maxHeight: Quantity<'length'>
  readonly range: Quantity<'length'>
}

export interface GroundObservation {
  readonly type: 'ground'
  readonly observableId: ObservableDefinition['id']
  readonly groundY: number
}

export interface InclineObservation {
  readonly type: 'incline'
  readonly observableId: ObservableDefinition['id']
  readonly angle: number
}

export type MechanicsObservation =
  | PositionObservation
  | MechanicsVelocityObservation
  | AccelerationObservation
  | ForceObservation
  | NetForceObservation
  | MechanicsTrajectoryObservation
  | DisplacementObservation
  | ProjectileKeyPointObservation
  | GroundObservation
  | InclineObservation

export interface MechanicsObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly MechanicsObservation[]
}

export interface MechanicsObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

const findBodyState = (state: SimulationState, bodyId: string) =>
  state.objects.find((obj) => obj.id === bodyId)

const visible = (scene: PhysicsScene, type: string): ObservableDefinition[] =>
  scene.observableDefinitions.filter((def) => def.visible && def.type === type)

const selectState = (scene: PhysicsScene, simulation: SimulationResult): SimulationState => {
  if (simulation.states.length === 0) {
    throw new PhysicsOSError('OBSERVATION_STATE_MISSING', 'SimulationResult contains no states.')
  }
  const targetTime = scene.timeline.currentTime.value
  return simulation.states.reduce((closest, candidate) =>
    Math.abs(candidate.time.value - targetTime) < Math.abs(closest.time.value - targetTime)
      ? candidate
      : closest,
  )
}

const trajectoryPoints = (simulation: SimulationResult, bodyId: string) =>
  simulation.states.flatMap((state) => {
    const obj = findBodyState(state, bodyId)
    if (!obj?.position) return []
    return [{ time: state.time, position: obj.position }]
  })

/** Semantic label of an individual force, so the renderer can colour it. */
export type MechanicsForceLabel =
  | 'gravity'
  | 'normal'
  | 'friction'
  | 'applied'
  | 'gravity_parallel'
  | 'gravity_normal'

const scaleVector = (vector: Vector3, factor: number): Vector3 => ({
  x: vector.x * factor,
  y: vector.y * factor,
  z: vector.z * factor,
})

const forceObservation = (
  observableId: ObservableDefinition['id'],
  targetId: string,
  time: Quantity<'time'>,
  origin: QuantityVector<'length'>,
  vector: Vector3,
  label: MechanicsForceLabel,
): ForceObservation => ({
  type: 'mechanics_force',
  observableId,
  targetId,
  time,
  origin,
  vector: quantityVector(vector, 'N', 'force'),
  magnitude: { value: magnitude(vector), unit: 'N', dimension: 'force' },
  label,
})

const scalarOrUndefined = (simulation: SimulationResult, key: string): number | undefined => {
  try {
    return derivedScalar(simulation.derivedQuantities, key).value
  } catch {
    return undefined
  }
}

/** Weight magnitude from the scene's own mass and gravity field. */
const gravityForceMagnitude = (scene: PhysicsScene, bodyId: string): number | undefined => {
  const body = scene.bodies.find((candidate) => candidate.id === bodyId)
  const field = scene.fields.find((candidate) => candidate.type === 'uniform_gravity')
  if (body === undefined || field === undefined || field.type !== 'uniform_gravity') return undefined
  const g = magnitude(field.acceleration.vector)
  return body.mass.value * g
}

export const observeMechanicsScene = (input: MechanicsObservationInput): MechanicsObservationRuntimeState => {
  const { scene, simulation } = input
  if (scene.id !== simulation.sceneId || scene.revision !== simulation.sceneRevision) {
    throw new PhysicsOSError(
      'OBSERVATION_SCENE_REVISION_MISMATCH',
      'Observation input must reference the same scene revision as the simulation.',
      { details: { sceneId: scene.id, simulationSceneId: simulation.sceneId } },
    )
  }

  const body = scene.bodies[0]
  if (!body) {
    throw new PhysicsOSError('OBSERVATION_BODY_MISSING', 'Mechanics observations require a body.')
  }

  const state = input.state ?? selectState(scene, simulation)
  const bodyState = findBodyState(state, body.id)
  if (!bodyState?.position || !bodyState.velocity) {
    throw new PhysicsOSError(
      'OBSERVATION_BODY_STATE_MISSING',
      `Simulation state does not contain body "${body.id}" position and velocity.`,
    )
  }

  const observations: MechanicsObservation[] = []

  for (const def of visible(scene, 'velocity')) {
    observations.push({
      type: 'mechanics_velocity',
      observableId: def.id,
      targetId: body.id,
      time: state.time,
      origin: bodyState.position,
      vector: bodyState.velocity,
      magnitude: {
        value: magnitude(bodyState.velocity.vector),
        unit: 'm/s',
        dimension: 'velocity',
      },
    })
  }

  if (bodyState.acceleration) {
    for (const def of visible(scene, 'acceleration')) {
      observations.push({
        type: 'acceleration',
        observableId: def.id,
        targetId: body.id,
        time: state.time,
        origin: bodyState.position,
        vector: bodyState.acceleration,
        magnitude: {
          value: magnitude(bodyState.acceleration.vector),
          unit: 'm/s^2',
          dimension: 'acceleration',
        },
      })
    }
  }

  try {
    const netForce = derivedVector(simulation.derivedQuantities, 'net_force') as QuantityVector<'force'>
    for (const def of visible(scene, 'force')) {
      observations.push({
        type: 'net_force',
        observableId: def.id,
        targetId: body.id,
        time: state.time,
        origin: bodyState.position,
        vector: netForce,
        magnitude: {
          value: magnitude(netForce.vector),
          unit: 'N',
          dimension: 'force',
        },
      })
    }
  } catch { /* net_force not available */ }

  /* Weight, for any mechanics scene that shows forces.
   *
   * Gravity is the one force whose direction needs no surface frame, so it is
   * reported for every model rather than only on an incline: a projectile's free
   * body diagram is `mg` alone, and labelling that arrow `mg` instead of `ΣF` is
   * what makes the picture a free-body diagram rather than a net-force sketch. */
  const gravityMagnitude = gravityForceMagnitude(scene, body.id)
  if (gravityMagnitude !== undefined && gravityMagnitude > 0) {
    for (const def of visible(scene, 'force')) {
      observations.push(
        forceObservation(def.id, body.id, state.time, bodyState.position, { x: 0, y: -gravityMagnitude, z: 0 }, 'gravity'),
      )
    }
  }

  /* Individual surface forces on an inclined body.
   *
   * The renderer must be able to draw N and f separately, and a free-body diagram
   * is only correct if each arrow's DIRECTION comes from the model rather than
   * from the drawing code. The magnitudes are engine facts (normal_force /
   * friction_force); the directions follow from the one geometric input the model
   * already owns, the incline angle. Nothing new is computed here — this projects
   * known magnitudes onto the known surface frame.
   */
  const inclineDef = scene.observableDefinitions.find(
    (def) => def.parameters?.['kind'] === 'incline' && typeof def.parameters['angle'] === 'number',
  )
  if (inclineDef !== undefined) {
    const angleDegrees = inclineDef.parameters?.['angle'] as number
    const radians = (angleDegrees * Math.PI) / 180
    const forceDefs = visible(scene, 'force')
    /* Surface frame: `along` points down the slope, `normal` away from it. The
       slope descends towards +x, matching the wedge the renderer draws. */
    const along = { x: Math.cos(radians), y: -Math.sin(radians), z: 0 }
    const normal = { x: Math.sin(radians), y: Math.cos(radians), z: 0 }

    for (const def of forceDefs) {
      const normalForce = scalarOrUndefined(simulation, 'normal_force')
      if (normalForce !== undefined) {
        observations.push(
          forceObservation(def.id, body.id, state.time, bodyState.position, scaleVector(normal, normalForce), 'normal'),
        )
      }
      const frictionForce = scalarOrUndefined(simulation, 'friction_force')
      if (frictionForce !== undefined && frictionForce > 0) {
        /* Kinetic friction opposes the slide, i.e. up the slope. */
        observations.push(
          forceObservation(def.id, body.id, state.time, bodyState.position, scaleVector(along, -frictionForce), 'friction'),
        )
      }
    }

    /* Gravity decomposition, published only when the scene asks for it, so the
       canvas never has to decide whether a component is physically meaningful. */
    const decompositionDef = scene.observableDefinitions.find(
      (def) => def.visible && def.parameters?.['kind'] === 'force_decomposition',
    )
    if (decompositionDef !== undefined && gravityMagnitude !== undefined) {
      observations.push(
        forceObservation(
          decompositionDef.id,
          body.id,
          state.time,
          bodyState.position,
          scaleVector(along, gravityMagnitude * Math.sin(radians)),
          'gravity_parallel',
        ),
        forceObservation(
          decompositionDef.id,
          body.id,
          state.time,
          bodyState.position,
          scaleVector(normal, -gravityMagnitude * Math.cos(radians)),
          'gravity_normal',
        ),
      )
    }
  }

  for (const def of visible(scene, 'trajectory')) {
    observations.push({
      type: 'mechanics_trajectory',
      observableId: def.id,
      targetId: body.id,
      points: trajectoryPoints(simulation, body.id),
    })
  }

  for (const def of scene.observableDefinitions) {
    if (!def.visible || def.type !== 'geometry') continue
    const kind = def.parameters?.['kind']
    if (kind === 'ground' && typeof def.parameters?.['groundY'] === 'number') {
      observations.push({
        type: 'ground',
        observableId: def.id,
        groundY: def.parameters['groundY'] as number,
      })
    }
    if (kind === 'incline' && typeof def.parameters?.['angle'] === 'number') {
      observations.push({
        type: 'incline',
        observableId: def.id,
        angle: def.parameters['angle'] as number,
      })
    }
  }

  try {
    const flightTime = derivedScalar(simulation.derivedQuantities, 'flight_time') as Quantity<'time'>
    const maxH = derivedScalar(simulation.derivedQuantities, 'max_height') as Quantity<'length'>
    const range = derivedScalar(simulation.derivedQuantities, 'range') as Quantity<'length'>
    /* Key points are gated by their own observable when the scene declares one, so
       the toggle is scene state; a scene without the definition still reports them
       for callers that predate it. */
    const keyPointDef = scene.observableDefinitions.find(
      (def) => def.parameters?.['kind'] === 'keypoints',
    )
    if (keyPointDef === undefined || keyPointDef.visible) {
      const firstState = simulation.states[0]
      const lastState = simulation.states[simulation.states.length - 1]
      if (firstState && lastState) {
        const firstObj = firstState.objects.find((o) => o.id === body.id)
        const lastObj = lastState.objects.find((o) => o.id === body.id)
        const apexObj = simulation.states
          .flatMap((sample) => {
            const object = sample.objects.find((candidate) => candidate.id === body.id)
            return object?.position === undefined ? [] : [object]
          })
          .reduce<SimulationState['objects'][number] | undefined>((highest, candidate) => {
            if (highest?.position === undefined) return candidate
            if (candidate.position === undefined) return highest
            return candidate.position.vector.y > highest.position.vector.y ? candidate : highest
          }, undefined)
        if (firstObj?.position && lastObj?.position && apexObj?.position) {
          observations.push({
            type: 'projectile_key_point',
            observableId: keyPointDef?.id ?? def_Id('obs-keypoints'),
            targetId: body.id,
            launchPoint: firstObj.position,
            apexPoint: apexObj.position,
            impactPoint: lastObj.position,
            flightTime,
            maxHeight: maxH,
            range,
          })
        }
      }
    }
  } catch { /* not projectile */ }

  return { sceneRevision: scene.revision, observations }
}

function def_Id(id: string): ObservableDefinition['id'] {
  return id as ObservableDefinition['id']
}
