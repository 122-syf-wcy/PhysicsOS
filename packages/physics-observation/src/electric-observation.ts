import {
  derivedScalar,
  derivedVector,
  quantityVector,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { PhysicsOSError } from '@physicsos/shared'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'
import { validateQuantity, type PhysicalDimension, type Quantity } from '@physicsos/physics-units'

export interface ElectricObservationBase {
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
}

export interface ElectricFieldObservation extends ElectricObservationBase {
  readonly type: 'electric_field'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'electric_field'>
  readonly magnitude: Quantity<'electric_field'>
}

export interface ElectricForceObservation extends ElectricObservationBase {
  readonly type: 'electric_force'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
}

export interface ElectricVelocityObservation extends ElectricObservationBase {
  readonly type: 'electric_velocity'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'velocity'>
  readonly magnitude: Quantity<'velocity'>
}

export interface ElectricAccelerationObservation extends ElectricObservationBase {
  readonly type: 'electric_acceleration'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'acceleration'>
  readonly magnitude: Quantity<'acceleration'>
}

export interface ElectricTrajectoryObservation extends ElectricObservationBase {
  readonly type: 'electric_trajectory'
  readonly points: readonly {
    readonly time: Quantity<'time'>
    readonly position: QuantityVector<'length'>
  }[]
}

export interface ElectricPotentialObservation extends ElectricObservationBase {
  readonly type: 'electric_potential'
  readonly change: Quantity<'electric_potential'>
}

export interface ElectricEnergyObservation extends ElectricObservationBase {
  readonly type: 'electric_energy'
  readonly kinetic: Quantity<'energy'>
  readonly potentialChange: Quantity<'energy'>
  readonly work: Quantity<'energy'>
}

export type ElectricObservation =
  | ElectricFieldObservation
  | ElectricForceObservation
  | ElectricVelocityObservation
  | ElectricAccelerationObservation
  | ElectricTrajectoryObservation
  | ElectricPotentialObservation
  | ElectricEnergyObservation

export interface ElectricObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly ElectricObservation[]
}

export interface ElectricObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

const scalarOf = <D extends PhysicalDimension>(
  derived: SimulationState['derived'] | SimulationResult['derivedQuantities'],
  key: string,
  dimension: D,
): Quantity<D> => validateQuantity(derivedScalar(derived, key), dimension)

const vectorOf = <D extends PhysicalDimension>(
  derived: SimulationState['derived'] | SimulationResult['derivedQuantities'],
  key: string,
  dimension: D,
): QuantityVector<D> => {
  const value = derivedVector(derived, key)
  if (value.dimension !== dimension) {
    throw new PhysicsOSError(
      'OBSERVATION_DIMENSION_MISMATCH',
      `Derived vector "${key}" declares dimension "${value.dimension}", expected "${dimension}".`,
    )
  }
  return quantityVector(value.vector, value.unit, dimension)
}

const selectState = (scene: PhysicsScene, simulation: SimulationResult): SimulationState => {
  const first = simulation.states[0]
  if (first === undefined) {
    throw new PhysicsOSError('OBSERVATION_STATE_MISSING', 'SimulationResult contains no states.')
  }
  const targetTime = scene.timeline.currentTime.value
  return simulation.states.reduce((closest, candidate) =>
    Math.abs(candidate.time.value - targetTime) < Math.abs(closest.time.value - targetTime)
      ? candidate
      : closest,
  )
}

const visible = (scene: PhysicsScene, type: ObservableDefinition['type']): ObservableDefinition[] =>
  scene.observableDefinitions.filter((definition) => definition.visible && definition.type === type)

type ElectricTrajectoryPoints = ElectricTrajectoryObservation['points']

const trajectoryCache = new WeakMap<SimulationResult, Map<string, ElectricTrajectoryPoints>>()

const trajectoryPointsOf = (
  simulation: SimulationResult,
  particleId: string,
): ElectricTrajectoryPoints => {
  const cachedByParticle = trajectoryCache.get(simulation)
  const cached = cachedByParticle?.get(particleId)
  if (cached !== undefined) return cached

  const points = simulation.states.flatMap((sample) => {
    const object = sample.objects.find(candidate => candidate.id === particleId)
    return object?.position === undefined ? [] : [{ time: sample.time, position: object.position }]
  })
  const nextByParticle = cachedByParticle ?? new Map<string, ElectricTrajectoryPoints>()
  nextByParticle.set(particleId, points)
  if (cachedByParticle === undefined) trajectoryCache.set(simulation, nextByParticle)
  return points
}

export const observeElectricScene = (
  input: ElectricObservationInput,
): ElectricObservationRuntimeState => {
  const { scene, simulation } = input
  if (scene.id !== simulation.sceneId || scene.revision !== simulation.sceneRevision) {
    throw new PhysicsOSError(
      'OBSERVATION_SCENE_REVISION_MISMATCH',
      'Observation input must reference the same scene revision as the simulation.',
    )
  }
  if (simulation.verification.status === 'failed') {
    throw new PhysicsOSError(
      'OBSERVATION_UNVERIFIED_SIMULATION',
      'Electric observations require a simulation that passed verification.',
    )
  }

  const particle = scene.particles[0]
  const field = scene.fields.find((candidate) => candidate.type === 'uniform_electric')
  if (particle === undefined || field === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_ELECTRIC_MODEL_MISSING',
      'Electric observations require one particle and one uniform electric field.',
    )
  }
  const state = input.state ?? selectState(scene, simulation)
  const particleState = state.objects.find((object) => object.id === particle.id)
  if (particleState?.position === undefined || particleState.velocity === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_PARTICLE_STATE_MISSING',
      'Electric state does not contain the particle position and velocity.',
    )
  }
  const origin = particleState.position
  const observations: ElectricObservation[] = []

  for (const definition of visible(scene, 'electric_field')) {
    observations.push({
      type: 'electric_field',
      observableId: definition.id,
      targetId: definition.targetId ?? field.id,
      time: state.time,
      origin,
      vector: vectorOf(state.derived, 'electric_field_vector', 'electric_field'),
      magnitude: scalarOf(state.derived, 'electric_field_magnitude', 'electric_field'),
    })
  }
  for (const definition of visible(scene, 'force')) {
    observations.push({
      type: 'electric_force',
      observableId: definition.id,
      targetId: definition.targetId ?? particle.id,
      time: state.time,
      origin,
      vector: vectorOf(state.derived, 'electric_force_vector', 'force'),
      magnitude: scalarOf(state.derived, 'electric_force_magnitude', 'force'),
    })
  }
  for (const definition of visible(scene, 'velocity')) {
    observations.push({
      type: 'electric_velocity',
      observableId: definition.id,
      targetId: definition.targetId ?? particle.id,
      time: state.time,
      origin,
      vector: particleState.velocity,
      magnitude: scalarOf(state.derived, 'speed', 'velocity'),
    })
  }
  for (const definition of visible(scene, 'acceleration')) {
    observations.push({
      type: 'electric_acceleration',
      observableId: definition.id,
      targetId: definition.targetId ?? particle.id,
      time: state.time,
      origin,
      vector: vectorOf(state.derived, 'acceleration_vector', 'acceleration'),
      magnitude: scalarOf(state.derived, 'acceleration_magnitude', 'acceleration'),
    })
  }
  for (const definition of visible(scene, 'trajectory')) {
    observations.push({
      type: 'electric_trajectory',
      observableId: definition.id,
      targetId: definition.targetId ?? particle.id,
      time: state.time,
      points: trajectoryPointsOf(simulation, particle.id),
    })
  }
  for (const definition of visible(scene, 'electric_potential')) {
    observations.push({
      type: 'electric_potential',
      observableId: definition.id,
      targetId: definition.targetId ?? particle.id,
      time: state.time,
      change: scalarOf(state.derived, 'electric_potential_change', 'electric_potential'),
    })
  }
  for (const definition of visible(scene, 'energy')) {
    observations.push({
      type: 'electric_energy',
      observableId: definition.id,
      targetId: definition.targetId ?? particle.id,
      time: state.time,
      kinetic: scalarOf(state.derived, 'kinetic_energy', 'energy'),
      potentialChange: scalarOf(state.derived, 'electric_potential_energy_change', 'energy'),
      work: scalarOf(state.derived, 'work_by_electric_field', 'energy'),
    })
  }

  return { sceneRevision: scene.revision, observations }
}
