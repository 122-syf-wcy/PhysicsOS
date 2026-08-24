import {
  derivedScalar,
  derivedVector,
  quantityVector,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { magnitude } from '@physicsos/physics-math'
import { PhysicsOSError } from '@physicsos/shared'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'
import { validateQuantity, type PhysicalDimension, type Quantity } from '@physicsos/physics-units'

export interface ObservationBase {
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
}

export interface VelocityObservation extends ObservationBase {
  readonly type: 'velocity'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'velocity'>
  readonly magnitude: Quantity<'velocity'>
}

export interface LorentzForceObservation extends ObservationBase {
  readonly type: 'lorentz_force'
  readonly origin: QuantityVector<'length'>
  readonly vector: QuantityVector<'force'>
  readonly magnitude: Quantity<'force'>
}

export interface TrajectoryPoint {
  readonly time: Quantity<'time'>
  readonly position: QuantityVector<'length'>
}

export interface TrajectoryObservation extends ObservationBase {
  readonly type: 'trajectory'
  readonly points: readonly TrajectoryPoint[]
  readonly direction: 'clockwise' | 'counterclockwise'
}

export interface OrbitCenterObservation extends ObservationBase {
  readonly type: 'orbit_center'
  readonly center: QuantityVector<'length'>
  readonly radius: Quantity<'length'>
}

export interface RadiusObservation extends ObservationBase {
  readonly type: 'radius'
  readonly center: QuantityVector<'length'>
  readonly edge: QuantityVector<'length'>
  readonly value: Quantity<'length'>
}

export type MagneticObservation =
  | VelocityObservation
  | LorentzForceObservation
  | TrajectoryObservation
  | OrbitCenterObservation
  | RadiusObservation

export interface ObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly MagneticObservation[]
}

export interface MagneticObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

export {
  observeElectricScene,
  type ChargeSignObservation,
  type ElectricAccelerationObservation,
  type ElectricEnergyObservation,
  type ElectricFieldObservation,
  type ElectricForceObservation,
  type ElectricObservation,
  type ElectricObservationBase,
  type ElectricObservationInput,
  type ElectricObservationRuntimeState,
  type ElectricPotentialObservation,
  type ElectricTrajectoryObservation,
  type ElectricVelocityObservation,
} from './electric-observation.ts'

const findParticleState = (state: SimulationState, particleId: string) =>
  state.objects.find((object) => object.id === particleId)

const visible = (scene: PhysicsScene, type: ObservableDefinition['type']): ObservableDefinition[] =>
  scene.observableDefinitions.filter((definition) => definition.visible && definition.type === type)

const geometryKind = (definition: ObservableDefinition): unknown => definition.parameters?.['kind']

/**
 * Derived values are intentionally stored behind the dimension-agnostic
 * contract used by SimulationResult.  The observation boundary is where a
 * consumer declares the dimension it can render, so validate it here and
 * return the corresponding precise type.  This keeps bad engine output
 * visible instead of hiding it behind a type assertion.
 */
const derivedScalarOf = <D extends PhysicalDimension>(
  derived: SimulationState['derived'] | SimulationResult['derivedQuantities'],
  key: string,
  dimension: D,
): Quantity<D> => validateQuantity(derivedScalar(derived, key), dimension)

const derivedVectorOf = <D extends PhysicalDimension>(
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

const trajectoryPoints = (simulation: SimulationResult, particleId: string): TrajectoryPoint[] =>
  simulation.states.flatMap((state) => {
    const object = findParticleState(state, particleId)
    if (object?.position === undefined) return []
    return [{ time: state.time, position: object.position }]
  })

const directionFromSimulation = (simulation: SimulationResult): 'clockwise' | 'counterclockwise' =>
  derivedScalarOf(simulation.derivedQuantities, 'rotation_direction', 'dimensionless').value >= 0
    ? 'counterclockwise'
    : 'clockwise'

/**
 * Maps verified engine facts into renderer-neutral observations. It never
 * calculates a new trajectory or force; all vectors come from SimulationState
 * or SimulationResult. Visibility is controlled solely by scene definitions.
 */
export const observeMagneticScene = (input: MagneticObservationInput): ObservationRuntimeState => {
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
      'Magnetic observations require a particle.',
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

  const observations: MagneticObservation[] = []
  const force = derivedVectorOf(state.derived, 'lorentz_force_vector', 'force')
  const radius = derivedScalarOf(simulation.derivedQuantities, 'cyclotron_radius', 'length')
  const center = derivedVectorOf(simulation.derivedQuantities, 'orbit_center', 'length')
  const direction = directionFromSimulation(simulation)

  for (const definition of visible(scene, 'velocity')) {
    observations.push({
      type: 'velocity',
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
    observations.push({
      type: 'lorentz_force',
      observableId: definition.id,
      targetId: particle.id,
      time: state.time,
      origin: particleState.position,
      vector: force,
      magnitude: {
        value: magnitude(force.vector),
        unit: 'N',
        dimension: 'force',
      },
    })
  }

  for (const definition of visible(scene, 'trajectory')) {
    observations.push({
      type: 'trajectory',
      observableId: definition.id,
      targetId: particle.id,
      time: state.time,
      points: trajectoryPoints(simulation, particle.id),
      direction,
    })
  }

  for (const definition of scene.observableDefinitions) {
    if (!definition.visible || definition.type !== 'geometry') continue
    const kind = geometryKind(definition)
    if (kind === 'orbit_center') {
      observations.push({
        type: 'orbit_center',
        observableId: definition.id,
        targetId: particle.id,
        time: state.time,
        center,
        radius,
      })
    }
    if (kind === 'radius') {
      observations.push({
        type: 'radius',
        observableId: definition.id,
        targetId: particle.id,
        time: state.time,
        center,
        edge: particleState.position,
        value: radius,
      })
    }
  }

  return { sceneRevision: scene.revision, observations }
}

export { findParticleState, selectState, trajectoryPoints }
export {
  observeCompositeScene,
  type CompositeElectricFieldObservation,
  type CompositeElectricForceObservation,
  type CompositeGravityForceObservation,
  type CompositeMagneticFieldObservation,
  type CompositeMagneticForceObservation,
  type CompositeNetForceObservation,
  type CompositeObservation,
  type CompositeObservationInput,
  type CompositeObservationRuntimeState,
  type CompositeTrajectoryObservation,
  type CompositeVelocityObservation,
} from './composite-observation.ts'
export {
  observeMechanicsScene,
  type MechanicsObservation,
  type MechanicsObservationRuntimeState,
  type MechanicsObservationInput,
  type PositionObservation,
  type MechanicsVelocityObservation,
  type AccelerationObservation,
  type ForceObservation,
  type NetForceObservation,
  type MechanicsTrajectoryObservation,
  type DisplacementObservation,
  type ProjectileKeyPointObservation,
  type GroundObservation,
  type InclineObservation,
} from './mechanics-observation.ts'
