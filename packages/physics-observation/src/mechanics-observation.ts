import {
  derivedScalar,
  derivedVector,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { magnitude } from '@physicsos/physics-math'
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
          observableId: def_Id('obs-keypoints'),
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
  } catch { /* not projectile */ }

  return { sceneRevision: scene.revision, observations }
}

function def_Id(id: string): ObservableDefinition['id'] {
  return id as ObservableDefinition['id']
}
