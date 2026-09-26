/**
 * Composite-field observation.
 *
 * Projects verified Composite Engine output into renderer-neutral observations.
 * Like every other observer, it never computes a physical quantity — every
 * vector and scalar comes from the simulation state or the derived quantities the
 * engine already published. The composite engine separates the force into its
 * electric, magnetic, gravity and net parts precisely so questions and the agent
 * can cite each independently, and this observer surfaces those parts as
 * distinct observations filtered by the scene's observable definitions.
 */
import {
  derivedVector,
  quantityVector,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { magnitude } from '@physicsos/physics-math'
import { PhysicsOSError } from '@physicsos/shared'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'
import { MAX_TRAJECTORY_RENDER_POINTS, decimateTrajectoryPoints } from '@physicsos/physics-scene'
import { type PhysicalDimension, type Quantity } from '@physicsos/physics-units'

export interface CompositeObservationBase {
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
}

export interface CompositeVelocityObservation extends CompositeObservationBase {
  readonly type: 'composite_velocity'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'velocity'>
  readonly magnitude: Quantity<'velocity'>
}

export interface CompositeElectricForceObservation extends CompositeObservationBase {
  readonly type: 'composite_electric_force'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
}

export interface CompositeMagneticForceObservation extends CompositeObservationBase {
  readonly type: 'composite_magnetic_force'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
}

export interface CompositeGravityForceObservation extends CompositeObservationBase {
  readonly type: 'composite_gravity_force'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
}

export interface CompositeNetForceObservation extends CompositeObservationBase {
  readonly type: 'composite_net_force'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
}

export interface CompositeElectricFieldObservation extends CompositeObservationBase {
  readonly type: 'composite_electric_field'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'electric_field'>
  readonly magnitude: Quantity<'electric_field'>
}

export interface CompositeMagneticFieldObservation extends CompositeObservationBase {
  readonly type: 'composite_magnetic_field'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'magnetic_flux_density'>
  readonly magnitude: Quantity<'magnetic_flux_density'>
}

export interface CompositeTrajectoryObservation extends CompositeObservationBase {
  readonly type: 'composite_trajectory'
  readonly points: readonly {
    readonly time: Quantity<'time'>
    readonly position: QuantityVector<'length'>
  }[]
}

export type CompositeObservation =
  | CompositeVelocityObservation
  | CompositeElectricForceObservation
  | CompositeMagneticForceObservation
  | CompositeGravityForceObservation
  | CompositeNetForceObservation
  | CompositeElectricFieldObservation
  | CompositeMagneticFieldObservation
  | CompositeTrajectoryObservation

export interface CompositeObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly CompositeObservation[]
}

export interface CompositeObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

const findParticleState = (state: SimulationState, particleId: string) =>
  state.objects.find((object) => object.id === particleId)

const visible = (scene: PhysicsScene, type: ObservableDefinition['type']): ObservableDefinition[] =>
  scene.observableDefinitions.filter((definition) => definition.visible && definition.type === type)

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
      { details: { key, actual: value.dimension, expected: dimension } },
    )
  }
  return quantityVector(value.vector, value.unit, dimension)
}

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

type CompositeTrajectoryPoints = CompositeTrajectoryObservation['points']

const trajectoryCache = new WeakMap<SimulationResult, Map<string, CompositeTrajectoryPoints>>()

const boundaryEventTimes = (simulation: SimulationResult): readonly number[] => {
  const times: number[] = []
  for (const event of simulation.events) {
    if (
      event.type !== 'EnterRegion' &&
      event.type !== 'ExitRegion' &&
      event.type !== 'SwitchField'
    ) {
      continue
    }
    if (event.time !== undefined) times.push(event.time)
  }
  return times
}

const trajectoryPoints = (
  simulation: SimulationResult,
  particleId: string,
): CompositeTrajectoryPoints => {
  const cachedByParticle = trajectoryCache.get(simulation)
  const cached = cachedByParticle?.get(particleId)
  if (cached !== undefined) return cached

  /* The engine stores every phase-boundary instant as a state AND emits a
     timed boundary event for it. Decimation to the render budget must keep
     those states: a region-crossing kink dropped between two evenly spaced
     picks would be drawn as a straight chord across the boundary (t8 F2). */
  const boundaryTimes = boundaryEventTimes(simulation)

  const rawPoints: { time: Quantity<'time'>; position: QuantityVector<'length'> }[] = []
  const stateIndexByPoint: number[] = []
  simulation.states.forEach((state, stateIndex) => {
    const object = findParticleState(state, particleId)
    if (object?.position === undefined) return
    stateIndexByPoint.push(stateIndex)
    rawPoints.push({ time: state.time, position: object.position })
  })

  const protect: number[] = []
  if (boundaryTimes.length > 0) {
    for (let pointIndex = 0; pointIndex < rawPoints.length; pointIndex += 1) {
      const stateIndex = stateIndexByPoint[pointIndex]
      if (stateIndex === undefined) continue
      const stateTime = simulation.states[stateIndex]?.time.value
      if (stateTime === undefined) continue
      if (boundaryTimes.some((boundaryTime) => Math.abs(stateTime - boundaryTime) < 1e-9)) {
        protect.push(pointIndex)
      }
    }
  }

  const points = decimateTrajectoryPoints(rawPoints, MAX_TRAJECTORY_RENDER_POINTS, protect)
  const nextByParticle = cachedByParticle ?? new Map<string, CompositeTrajectoryPoints>()
  nextByParticle.set(particleId, points)
  if (cachedByParticle === undefined) trajectoryCache.set(simulation, nextByParticle)
  return points
}

/**
 * Map verified composite engine facts into renderer-neutral observations.
 *
 * Visibility is controlled solely by the scene's observable definitions; the
 * force kind (`parameters.kind`) distinguishes the electric / magnetic / gravity /
 * net force rows so a single `type: 'force'` definition family reports each
 * contribution independently — the engine separated them precisely so the agent
 * and the inspector can cite each on its own.
 */
export const observeCompositeScene = (
  input: CompositeObservationInput,
): CompositeObservationRuntimeState => {
  const { scene, simulation } = input
  if (scene.id !== simulation.sceneId || scene.revision !== simulation.sceneRevision) {
    throw new PhysicsOSError(
      'OBSERVATION_SCENE_REVISION_MISMATCH',
      'Observation input must reference the same scene revision as the simulation.',
      {
        details: {
          sceneId: scene.id,
          simulationSceneId: simulation.sceneId,
          sceneRevision: scene.revision,
          simulationSceneRevision: simulation.sceneRevision,
        },
      },
    )
  }

  const particle = scene.particles[0]
  if (particle === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_PARTICLE_MISSING',
      'Composite observations require a particle.',
    )
  }
  const state = input.state ?? selectState(scene, simulation)
  const particleState = findParticleState(state, particle.id)
  if (particleState?.position === undefined || particleState.velocity === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_PARTICLE_STATE_MISSING',
      `Simulation state does not contain particle "${particle.id}" position and velocity.`,
    )
  }

  const observations: CompositeObservation[] = []

  for (const definition of visible(scene, 'velocity')) {
    observations.push({
      type: 'composite_velocity',
      observableId: definition.id,
      targetId: particle.id,
      time: state.time,
      origin: particleState.position,
      vector: particleState.velocity,
      magnitude: {
        value: magnitude(particleState.velocity.vector),
        unit: 'm/s',
        dimension: 'velocity',
      },
    })
  }

  for (const definition of visible(scene, 'force')) {
    const kind = definition.parameters?.['kind']
    const key =
      kind === 'electric'
        ? 'electric_force_vector'
        : kind === 'magnetic'
          ? 'magnetic_force_vector'
          : kind === 'gravity'
            ? 'gravity_force_vector'
            : 'net_force_vector'
    const type =
      kind === 'electric'
        ? 'composite_electric_force'
        : kind === 'magnetic'
          ? 'composite_magnetic_force'
          : kind === 'gravity'
            ? 'composite_gravity_force'
            : 'composite_net_force'
    let vector: QuantityVector<'force'>
    try {
      vector = vectorOf(state.derived, key, 'force')
    } catch {
      continue
    }
    observations.push({
      type,
      observableId: definition.id,
      targetId: particle.id,
      time: state.time,
      origin: particleState.position,
      vector,
      magnitude: {
        value: magnitude(vector.vector),
        unit: 'N',
        dimension: 'force',
      },
    })
  }

  for (const definition of visible(scene, 'electric_field')) {
    /* The composite engine publishes the acting field on the state's object
       values (electricField/magneticFluxDensity), not as a derived quantity,
       because the field is an input the engine samples rather than computes.
       Outside a field region the value is zero. */
    const raw = particleState.values?.['electricField']
    if (raw === undefined || !('vector' in raw)) continue
    const vector = quantityVector(raw.vector, raw.unit, 'electric_field')
    observations.push({
      type: 'composite_electric_field',
      observableId: definition.id,
      targetId: particle.id,
      time: state.time,
      origin: particleState.position,
      vector,
      magnitude: {
        value: magnitude(vector.vector),
        unit: 'V/m',
        dimension: 'electric_field',
      },
    })
  }

  for (const definition of visible(scene, 'magnetic_field')) {
    const raw = particleState.values?.['magneticFluxDensity']
    if (raw === undefined || !('vector' in raw)) continue
    const vector = quantityVector(raw.vector, raw.unit, 'magnetic_flux_density')
    observations.push({
      type: 'composite_magnetic_field',
      observableId: definition.id,
      targetId: particle.id,
      time: state.time,
      origin: particleState.position,
      vector,
      magnitude: {
        value: magnitude(vector.vector),
        unit: 'T',
        dimension: 'magnetic_flux_density',
      },
    })
  }

  for (const definition of visible(scene, 'trajectory')) {
    observations.push({
      type: 'composite_trajectory',
      observableId: definition.id,
      targetId: particle.id,
      time: state.time,
      points: trajectoryPoints(simulation, particle.id),
    })
  }

  return { sceneRevision: scene.revision, observations }
}
