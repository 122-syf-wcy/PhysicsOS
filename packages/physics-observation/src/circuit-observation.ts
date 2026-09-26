import { derivedScalar, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import { PhysicsOSError, asObservableId } from '@physicsos/shared'
import {
  circuitOf,
  type CircuitComponent,
  type ObservableDefinition,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { validateQuantity, type PhysicalDimension, type Quantity } from '@physicsos/physics-units'

/**
 * Circuit observation runtime: turns a Circuit simulation's per-component
 * operating points (current / voltage / power) into renderer-neutral
 * observations. Like the other domain observations it never computes a new
 * current or voltage; every value comes from the engine's SimulationState or
 * SimulationResult derived set. Visibility is controlled solely by the
 * scene's observable definitions.
 */

export interface CircuitObservationBase {
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
}

/** Per-component current (amperes), read from the state's `current` value. */
export interface CircuitCurrentObservation extends CircuitObservationBase {
  readonly type: 'circuit_current'
  readonly current: Quantity<'electric_current'>
}

/** Per-component voltage (volts), read from the state's `voltage` value. */
export interface CircuitVoltageObservation extends CircuitObservationBase {
  readonly type: 'circuit_voltage'
  readonly voltage: Quantity<'electric_potential'>
}

/** Per-component power (watts), read from the state's `power` value. */
export interface CircuitPowerObservation extends CircuitObservationBase {
  readonly type: 'circuit_power'
  readonly power: Quantity<'power'>
}

/**
 * Source-summary operating point (EMF, main current, terminal voltage) read
 * from the simulation's derived quantities. Emitted once for the primary
 * voltage source so the canvas can show the U–I relation without re-solving.
 */
export interface CircuitSourceSummaryObservation extends CircuitObservationBase {
  readonly type: 'circuit_source_summary'
  readonly emf: Quantity<'electric_potential'>
  readonly mainCurrent: Quantity<'electric_current'>
  readonly terminalVoltage: Quantity<'electric_potential'>
}

export type CircuitObservation =
  | CircuitCurrentObservation
  | CircuitVoltageObservation
  | CircuitPowerObservation
  | CircuitSourceSummaryObservation

export interface CircuitObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly CircuitObservation[]
}

export interface CircuitObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

const scalarOf = <D extends PhysicalDimension>(
  derived: SimulationState['derived'] | SimulationResult['derivedQuantities'],
  key: string,
  dimension: D,
): Quantity<D> => validateQuantity(derivedScalar(derived, key), dimension)

const selectState = (scene: PhysicsScene, simulation: SimulationResult): SimulationState => {
  const first = simulation.states[0]
  if (first === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_STATE_MISSING',
      'Circuit SimulationResult contains no states.',
    )
  }
  const targetTime = scene.timeline.currentTime.value
  return simulation.states.reduce((closest, candidate) =>
    Math.abs(candidate.time.value - targetTime) < Math.abs(closest.time.value - targetTime)
      ? candidate
      : closest,
  )
}

const componentValue = (
  state: SimulationState,
  componentId: string,
  key: string,
): number | undefined => {
  const entry = state.objects.find((object) => object.id === componentId)
  if (entry === undefined || entry.values === undefined) return undefined
  const value = entry.values[key]
  if (value === undefined) return undefined
  if ('vector' in value) return undefined
  return (value as Quantity<PhysicalDimension>).value
}

const visible = (scene: PhysicsScene, type: ObservableDefinition['type']): ObservableDefinition[] =>
  scene.observableDefinitions.filter((definition) => definition.visible && definition.type === type)

/**
 * Map verified engine facts into renderer-neutral circuit observations. It
 * never re-solves the circuit; currents, voltages and powers come only from
 * the SimulationState's per-component `values` and the SimulationResult's
 * derived set. Visibility is controlled solely by scene definitions.
 */
export const observeCircuitScene = (
  input: CircuitObservationInput,
): CircuitObservationRuntimeState => {
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
      'Circuit observations require a simulation that passed verification.',
    )
  }

  const circuit = circuitOf(scene)
  if (circuit === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_CIRCUIT_MISSING',
      'Circuit observations require a scene with exactly one circuit.',
    )
  }

  const state = input.state ?? selectState(scene, simulation)
  const observations: CircuitObservation[] = []

  /* Current observations: one per component, keyed by the `current` observable
     definition. The observable's targetId selects which component to read. */
  for (const definition of visible(scene, 'current')) {
    const targetId = definition.targetId ?? ''
    const current = componentValue(state, targetId, 'current')
    if (current === undefined) continue
    observations.push({
      type: 'circuit_current',
      observableId: definition.id,
      targetId,
      time: state.time,
      current: { value: current, unit: 'A', dimension: 'electric_current' },
    })
  }

  for (const definition of visible(scene, 'voltage')) {
    const targetId = definition.targetId ?? ''
    const voltage = componentValue(state, targetId, 'voltage')
    if (voltage === undefined) continue
    observations.push({
      type: 'circuit_voltage',
      observableId: definition.id,
      targetId,
      time: state.time,
      voltage: { value: voltage, unit: 'V', dimension: 'electric_potential' },
    })
  }

  for (const definition of visible(scene, 'energy')) {
    const targetId = definition.targetId ?? ''
    const power = componentValue(state, targetId, 'power')
    if (power === undefined) continue
    observations.push({
      type: 'circuit_power',
      observableId: definition.id,
      targetId,
      time: state.time,
      power: { value: power, unit: 'W', dimension: 'power' },
    })
  }

  /* Source summary: the engine publishes emf / main_current / terminal_voltage
     as derived quantities. Emit a single observation so the UI can render the
     U–I relation directly. */
  const sourceId = circuit.components.find(
    (component: CircuitComponent) => component.type === 'voltage_source',
  )?.id
  if (sourceId !== undefined) {
    const emf = scalarOf(simulation.derivedQuantities, 'emf', 'electric_potential')
    const mainCurrent = scalarOf(simulation.derivedQuantities, 'main_current', 'electric_current')
    const terminalVoltage = scalarOf(
      simulation.derivedQuantities,
      'terminal_voltage',
      'electric_potential',
    )
    observations.push({
      type: 'circuit_source_summary',
      observableId: asObservableId('observable-circuit-power'),
      targetId: sourceId,
      time: state.time,
      emf,
      mainCurrent,
      terminalVoltage,
    })
  }

  return { sceneRevision: scene.revision, observations }
}
