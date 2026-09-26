import { derivedScalar, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import { PhysicsOSError } from '@physicsos/shared'
import {
  inductionBenchOf,
  type ObservableDefinition,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { validateQuantity, type PhysicalDimension, type Quantity } from '@physicsos/physics-units'

/**
 * Induction observation runtime: turns an Induction simulation's bench facts
 * (EMF, current, flux, Lenz direction) into renderer-neutral observations.
 * Like the other domain observations it never computes a new EMF or current;
 * every value comes from the engine's SimulationState or the SimulationResult
 * derived set. Visibility is controlled solely by the scene's observable
 * definitions.
 */

export interface InductionObservationBase {
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
}

/** Induced EMF (volts), read from the derived `induced_emf`. */
export interface InductionEmfObservation extends InductionObservationBase {
  readonly type: 'induction_emf'
  readonly emf: Quantity<'electric_potential'>
}

/** Induced current (amperes), read from the derived `induced_current`. */
export interface InductionCurrentObservation extends InductionObservationBase {
  readonly type: 'induction_current'
  readonly current: Quantity<'electric_current'>
}

/** Magnetic flux through the coil (webers), read from the derived `magnetic_flux`. */
export interface InductionFluxObservation extends InductionObservationBase {
  readonly type: 'induction_flux'
  readonly flux: Quantity<'magnetic_flux'>
}

/**
 * Lenz direction readout: the sign of the induced EMF encodes the current
 * direction that opposes the flux change, published by the engine as the
 * dimensionless derived `lenz_direction` (+1 / -1 / 0).
 */
export interface InductionDirectionObservation extends InductionObservationBase {
  readonly type: 'induction_direction'
  readonly direction: 'positive' | 'negative' | 'none'
}

export type InductionObservation =
  | InductionEmfObservation
  | InductionCurrentObservation
  | InductionFluxObservation
  | InductionDirectionObservation

export interface InductionObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly InductionObservation[]
}

export interface InductionObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

const scalarOf = <D extends PhysicalDimension>(
  derived: SimulationState['derived'] | SimulationResult['derivedQuantities'],
  key: string,
  dimension: D,
): Quantity<D> => validateQuantity(derivedScalar(derived, key), dimension)

const scalarOrUndefined = (
  derived: SimulationState['derived'] | SimulationResult['derivedQuantities'],
  key: string,
): number | undefined => {
  try {
    return derivedScalar(derived, key).value
  } catch {
    return undefined
  }
}

const selectState = (scene: PhysicsScene, simulation: SimulationResult): SimulationState => {
  const first = simulation.states[0]
  if (first === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_STATE_MISSING',
      'Induction SimulationResult contains no states.',
    )
  }
  const targetTime = scene.timeline.currentTime.value
  return simulation.states.reduce((closest, candidate) =>
    Math.abs(candidate.time.value - targetTime) < Math.abs(closest.time.value - targetTime)
      ? candidate
      : closest,
  )
}

/**
 * Map verified engine facts into renderer-neutral induction observations. It
 * never re-derives Faraday's law; the EMF, current and flux come only from the
 * SimulationState's bench values and the SimulationResult's derived set.
 * Visibility is controlled solely by scene definitions.
 */
export const observeInductionScene = (
  input: InductionObservationInput,
): InductionObservationRuntimeState => {
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
      'Induction observations require a simulation that passed verification.',
    )
  }

  const bench = inductionBenchOf(scene)
  if (bench === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_INDUCTION_BENCH_MISSING',
      'Induction observations require a scene with exactly one induction bench.',
    )
  }

  const state = input.state ?? selectState(scene, simulation)
  const observations: InductionObservation[] = []

  /* EMF and current are the bench's core readouts; they are always published. */
  const emf = scalarOrUndefined(state.derived, 'induced_emf')
  if (emf !== undefined) {
    observations.push({
      type: 'induction_emf',
      observableId:
        'observable-induction-emf' as unknown as InductionObservationBase['observableId'],
      targetId: bench.id,
      time: state.time,
      emf: { value: emf, unit: 'V', dimension: 'electric_potential' },
    })
  }
  const current = scalarOrUndefined(state.derived, 'induced_current')
  if (current !== undefined) {
    observations.push({
      type: 'induction_current',
      observableId:
        'observable-induction-current' as unknown as InductionObservationBase['observableId'],
      targetId: bench.id,
      time: state.time,
      current: { value: current, unit: 'A', dimension: 'electric_current' },
    })
  }

  /* The flux readout exists only on the flux-change rig (the bar-motion rig
     publishes the swept rate, not a coil flux). */
  const flux = scalarOrUndefined(state.derived, 'magnetic_flux')
  if (flux !== undefined) {
    observations.push({
      type: 'induction_flux',
      observableId:
        'observable-induction-flux' as unknown as InductionObservationBase['observableId'],
      targetId: bench.id,
      time: state.time,
      flux: { value: flux, unit: 'Wb', dimension: 'magnetic_flux' },
    })
  }

  /* Lenz direction: the engine publishes sign(E) so a renderer can draw the
     current arrow without re-deriving the right-hand rule. */
  const lenz = scalarOrUndefined(simulation.derivedQuantities, 'lenz_direction')
  if (lenz !== undefined) {
    observations.push({
      type: 'induction_direction',
      observableId:
        'observable-induction-direction' as unknown as InductionObservationBase['observableId'],
      targetId: bench.id,
      time: state.time,
      direction: lenz > 0 ? 'positive' : lenz < 0 ? 'negative' : 'none',
    })
  }

  return { sceneRevision: scene.revision, observations }
}

/** Re-export for type narrowing in tests and renderers. */
export const isInductionEmfObservation = (
  obs: InductionObservation,
): obs is InductionEmfObservation => obs.type === 'induction_emf'

export const isInductionCurrentObservation = (
  obs: InductionObservation,
): obs is InductionCurrentObservation => obs.type === 'induction_current'

/** Read a scalar from the derived set with dimension validation. */
export const inductionDerivedScalar = scalarOf
