import {
  derivedScalar,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { PhysicsOSError } from '@physicsos/shared'
import { waveBenchOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicalDimension, Quantity } from '@physicsos/physics-units'

/**
 * Wave observation runtime: turns a Wave simulation's bench facts (profile
 * samples, v = λf readouts, the interference verdict, node positions) into
 * renderer-neutral observations. Like the other domain observations it never
 * evaluates y(x, t) itself — every point comes from the engine's SimulationState
 * objects and every scalar from the derived set. Visibility is controlled
 * solely by the scene's observable definitions.
 */

export interface WaveObservationBase {
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly time: Quantity<'time'>
}

/** A point of the sampled rope / string profile, in metres. */
export interface WaveProfilePoint {
  readonly x: number
  readonly y: number
}

/**
 * The rope or string profile at the current time — the engine's sampled
 * `<bench>.profile.<i>` objects in order — plus the marked particle when the
 * rig has one (travelling wave only).
 */
export interface WaveformObservation extends WaveObservationBase {
  readonly type: 'waveform'
  readonly points: readonly WaveProfilePoint[]
  readonly marker?: {
    readonly position: WaveProfilePoint
    /** Transverse velocity ∂y/∂t (m/s); the marker never gains an x velocity. */
    readonly transverseVelocity: Quantity<'velocity'>
  }
}

/** The v = λf readout: speed, wavelength, frequency and period from the derived set. */
export interface WaveSpeedObservation extends WaveObservationBase {
  readonly type: 'wave_speed'
  readonly speed: Quantity<'velocity'>
  readonly wavelength: Quantity<'length'>
  readonly frequency: Quantity<'frequency'>
  readonly period: Quantity<'time'>
}

export type WaveInterferenceVerdict = 'constructive' | 'destructive' | 'partial'

/**
 * Two-source superposition at the observation point: the path difference, its
 * ratio to λ, the engine's verdict (from the dimensionless `interference_type`
 * +1 / −1 / 0) and the resultant amplitude, plus the instantaneous summed
 * displacement and the three rig positions for drawing.
 */
export interface WaveSuperpositionObservation extends WaveObservationBase {
  readonly type: 'wave_superposition'
  readonly pathDifference: Quantity<'length'>
  readonly pathDifferenceRatio: number
  readonly verdict: WaveInterferenceVerdict
  readonly resultantAmplitude: Quantity<'length'>
  readonly displacement: Quantity<'length'>
  readonly sources: readonly [WaveProfilePoint, WaveProfilePoint]
  readonly point: WaveProfilePoint
}

/** Node and antinode positions along a standing-wave string (metres). */
export interface WaveNodesObservation extends WaveObservationBase {
  readonly type: 'wave_nodes'
  readonly nodes: readonly number[]
  readonly antinodes: readonly WaveProfilePoint[]
}

export type WaveObservation =
  | WaveformObservation
  | WaveSpeedObservation
  | WaveSuperpositionObservation
  | WaveNodesObservation

export interface WaveObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly WaveObservation[]
}

export interface WaveObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly state?: SimulationState
}

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
    throw new PhysicsOSError('OBSERVATION_STATE_MISSING', 'Wave SimulationResult contains no states.')
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

const pointOf = (state: SimulationState, id: string): WaveProfilePoint | undefined => {
  const vector = state.objects.find((object) => object.id === id)?.position?.vector
  return vector === undefined ? undefined : { x: vector.x, y: vector.y }
}

const objectValue = (state: SimulationState, id: string, key: string): number | undefined => {
  const entry = state.objects.find((object) => object.id === id)
  const value = entry?.values?.[key]
  if (value === undefined || 'vector' in value) return undefined
  return (value as Quantity<PhysicalDimension>).value
}

/**
 * The engine's profile objects are `<bench>.profile.<i>`; read them in index
 * order so the polyline is drawn along the rope rather than in object order.
 */
const profilePointsOf = (state: SimulationState, benchId: string): WaveProfilePoint[] => {
  const prefix = `${benchId}.profile.`
  return state.objects
    .filter((object) => object.id.startsWith(prefix) && object.position !== undefined)
    .map((object) => ({
      index: Number(object.id.slice(prefix.length)),
      point: { x: object.position!.vector.x, y: object.position!.vector.y },
    }))
    .filter((entry) => Number.isFinite(entry.index))
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.point)
}

const indexedPointsOf = (
  state: SimulationState,
  benchId: string,
  kind: 'node' | 'antinode',
): WaveProfilePoint[] => {
  const prefix = `${benchId}.${kind}.`
  return state.objects
    .filter((object) => object.id.startsWith(prefix) && object.position !== undefined)
    .map((object) => ({
      index: Number(object.id.slice(prefix.length)),
      point: { x: object.position!.vector.x, y: object.position!.vector.y },
    }))
    .filter((entry) => Number.isFinite(entry.index))
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.point)
}

const verdictOf = (sign: number): WaveInterferenceVerdict =>
  sign > 0 ? 'constructive' : sign < 0 ? 'destructive' : 'partial'

/**
 * Map verified engine facts into renderer-neutral wave observations. It never
 * evaluates the wave equation; profile points, node positions and the
 * displacement at P come from the SimulationState, the v = λf readouts and the
 * interference verdict from the derived set. Visibility is controlled solely
 * by scene definitions.
 */
export const observeWaveScene = (input: WaveObservationInput): WaveObservationRuntimeState => {
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
      'Wave observations require a simulation that passed verification.',
    )
  }

  const bench = waveBenchOf(scene)
  if (bench === undefined) {
    throw new PhysicsOSError(
      'OBSERVATION_WAVE_BENCH_MISSING',
      'Wave observations require a scene with exactly one wave bench.',
    )
  }

  const state = input.state ?? selectState(scene, simulation)
  const observations: WaveObservation[] = []

  /* Waveform: the `geometry` observable bound to the bench carries the sampled
     profile; on the standing rig a second `geometry` observable carries the
     nodes, told apart by which objects the engine actually published. */
  const profile = profilePointsOf(state, bench.id)
  const nodes = indexedPointsOf(state, bench.id, 'node')
  const antinodes = indexedPointsOf(state, bench.id, 'antinode')
  const geometryDefinitions = visible(scene, 'geometry').filter(
    (definition) => definition.targetId === bench.id,
  )
  const waveformDefinition = geometryDefinitions.find((definition) =>
    String(definition.id).endsWith('waveform'),
  )
  const nodesDefinition = geometryDefinitions.find((definition) =>
    String(definition.id).endsWith('nodes'),
  )

  if (waveformDefinition !== undefined && profile.length > 0) {
    const markerPosition = pointOf(state, `${bench.id}.marker`)
    const markerVelocity = state.objects.find((object) => object.id === `${bench.id}.marker`)
      ?.velocity?.vector
    observations.push({
      type: 'waveform',
      observableId: waveformDefinition.id,
      targetId: bench.id,
      time: state.time,
      points: profile,
      ...(markerPosition === undefined || markerVelocity === undefined
        ? {}
        : {
            marker: {
              position: markerPosition,
              transverseVelocity: { value: markerVelocity.y, unit: 'm/s', dimension: 'velocity' },
            },
          }),
    })
  }

  /* v = λf readout from the derived set. */
  for (const definition of visible(scene, 'velocity')) {
    if (definition.targetId !== bench.id) continue
    const speed = scalarOrUndefined(state.derived, 'wave_speed')
    const wavelength = scalarOrUndefined(state.derived, 'wavelength')
    const frequency = scalarOrUndefined(state.derived, 'frequency')
    const period = scalarOrUndefined(state.derived, 'period')
    if (
      speed === undefined ||
      wavelength === undefined ||
      frequency === undefined ||
      period === undefined
    ) {
      continue
    }
    observations.push({
      type: 'wave_speed',
      observableId: definition.id,
      targetId: bench.id,
      time: state.time,
      speed: { value: speed, unit: 'm/s', dimension: 'velocity' },
      wavelength: { value: wavelength, unit: 'm', dimension: 'length' },
      frequency: { value: frequency, unit: 'Hz', dimension: 'frequency' },
      period: { value: period, unit: 's', dimension: 'time' },
    })
  }

  /* Superposition verdict at P: only the interference rig publishes the
     `interference_type` derived and the `.point` object. */
  for (const definition of visible(scene, 'annotation')) {
    if (definition.targetId !== bench.id) continue
    const pointId = `${bench.id}.point`
    const sign = scalarOrUndefined(state.derived, 'interference_type')
    const pathDifference = scalarOrUndefined(state.derived, 'path_difference')
    const ratio = scalarOrUndefined(state.derived, 'path_difference_ratio')
    const resultant = scalarOrUndefined(state.derived, 'resultant_amplitude')
    const displacement = objectValue(state, pointId, 'displacement')
    const sourceOne = pointOf(state, `${bench.id}.source-1`)
    const sourceTwo = pointOf(state, `${bench.id}.source-2`)
    const point = pointOf(state, pointId)
    if (
      sign === undefined ||
      pathDifference === undefined ||
      ratio === undefined ||
      resultant === undefined ||
      displacement === undefined ||
      sourceOne === undefined ||
      sourceTwo === undefined ||
      point === undefined
    ) {
      continue
    }
    observations.push({
      type: 'wave_superposition',
      observableId: definition.id,
      targetId: pointId,
      time: state.time,
      pathDifference: { value: pathDifference, unit: 'm', dimension: 'length' },
      pathDifferenceRatio: ratio,
      verdict: verdictOf(sign),
      resultantAmplitude: { value: resultant, unit: 'm', dimension: 'length' },
      displacement: { value: displacement, unit: 'm', dimension: 'length' },
      sources: [sourceOne, sourceTwo],
      point,
    })
  }

  if (nodesDefinition !== undefined && nodes.length > 0) {
    observations.push({
      type: 'wave_nodes',
      observableId: nodesDefinition.id,
      targetId: bench.id,
      time: state.time,
      nodes: nodes.map((node) => node.x),
      antinodes,
    })
  }

  return { sceneRevision: scene.revision, observations }
}

export const isWaveformObservation = (obs: WaveObservation): obs is WaveformObservation =>
  obs.type === 'waveform'

export const isWaveSpeedObservation = (obs: WaveObservation): obs is WaveSpeedObservation =>
  obs.type === 'wave_speed'

export const isWaveSuperpositionObservation = (
  obs: WaveObservation,
): obs is WaveSuperpositionObservation => obs.type === 'wave_superposition'

export const isWaveNodesObservation = (obs: WaveObservation): obs is WaveNodesObservation =>
  obs.type === 'wave_nodes'
