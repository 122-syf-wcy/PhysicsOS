import {
  derivedScalar,
  toCanonicalVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import type {
  ElectricObservation,
  ElectricObservationRuntimeState,
  ElectricTrajectoryObservation,
} from '@physicsos/physics-observation'
import type { PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel, type ScenePoint, type SceneVisualModel, type VectorVisual } from './scene-visual-model.ts'

export interface ElectricVisualInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly observations: ElectricObservationRuntimeState['observations']
  readonly state: SimulationState
}

const formatNumber = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  return absolute !== 0 && (absolute < 1e-3 || absolute >= 1e4)
    ? value.toExponential(digits)
    : value.toFixed(digits)
}

const pointOf = (vector: { readonly x: number; readonly y: number }): ScenePoint => ({
  x: vector.x,
  y: vector.y,
})

const normalized = (vector: { readonly x: number; readonly y: number; readonly z: number }): ScenePoint => {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  return length === 0 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length }
}

const vectorVisual = (
  id: string,
  role: VectorVisual['role'],
  observable: VectorVisual['observable'],
  symbol: string,
  origin: ScenePoint,
  vector: { readonly x: number; readonly y: number; readonly z: number },
  displayLength: number,
): VectorVisual => {
  const direction = normalized(vector)
  return {
    id,
    role,
    observable,
    symbol,
    from: origin,
    to: {
      x: origin.x + direction.x * displayLength,
      y: origin.y + direction.y * displayLength,
    },
  }
}

const observationOf = <TType extends ElectricObservation['type']>(
  observations: readonly ElectricObservation[],
  type: TType,
): Extract<ElectricObservation, { type: TType }> | undefined =>
  observations.find((entry): entry is Extract<ElectricObservation, { type: TType }> => entry.type === type)

const extentOf = (points: readonly ScenePoint[]) => {
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const contentWidth = Math.max(0, maxX - minX)
  const contentHeight = Math.max(0, maxY - minY)
  let width = Math.max(12, contentWidth + Math.max(2, contentWidth * 0.18))
  let height = Math.max(7, contentHeight + Math.max(2, contentHeight * 0.2))
  if (width / height > 16 / 9) height = width * 9 / 16
  else width = height * 16 / 9
  return {
    origin: { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height / 2 },
    extent: { width, height },
  }
}

const visibilityOf = (scene: PhysicsScene): SceneVisualModel['visible'] => {
  const visible = (type: PhysicsScene['observableDefinitions'][number]['type']) =>
    scene.observableDefinitions.some(definition => definition.type === type && definition.visible)
  return {
    electricField: visible('electric_field'),
    force: visible('force'),
    velocity: visible('velocity'),
    acceleration: visible('acceleration'),
    trajectory: visible('trajectory'),
    potential: visible('electric_potential'),
    energy: visible('energy'),
  }
}

const observedTrajectoryCache = new WeakMap<object, readonly ScenePoint[]>()
const simulationTrajectoryCache = new WeakMap<SimulationResult, Map<string, readonly ScenePoint[]>>()
const visualFrameCache = new WeakMap<object, {
  readonly origin: ScenePoint
  readonly extent: { readonly width: number; readonly height: number }
  readonly vectorBase: number
  readonly trajectories: SceneVisualModel['trajectories']
}>()

const observedTrajectoryPoints = (
  points: ElectricTrajectoryObservation['points'],
): readonly ScenePoint[] => {
  const cached = observedTrajectoryCache.get(points)
  if (cached !== undefined) return cached
  const projected = points.map(point => pointOf(toCanonicalVector(point.position).vectorSI))
  observedTrajectoryCache.set(points, projected)
  return projected
}

const simulationTrajectoryPoints = (
  simulation: SimulationResult,
  particleId: string,
): readonly ScenePoint[] => {
  const cachedByParticle = simulationTrajectoryCache.get(simulation)
  const cached = cachedByParticle?.get(particleId)
  if (cached !== undefined) return cached
  const projected = simulation.states.flatMap((sample) => {
    const sampleObject = sample.objects.find(candidate => candidate.id === particleId)
    return sampleObject?.position === undefined
      ? []
      : [pointOf(toCanonicalVector(sampleObject.position).vectorSI)]
  })
  const nextByParticle = cachedByParticle ?? new Map<string, readonly ScenePoint[]>()
  nextByParticle.set(particleId, projected)
  if (cachedByParticle === undefined) simulationTrajectoryCache.set(simulation, nextByParticle)
  return projected
}

const stableVisualFrame = (points: readonly ScenePoint[], fallback: ScenePoint) => {
  const key = points.length === 0 ? [fallback] : points
  const cached = visualFrameCache.get(key)
  if (cached !== undefined) return cached

  const provisional = extentOf(key)
  const vectorBase = Math.min(provisional.extent.width, provisional.extent.height)
  const padding = vectorBase * 0.22
  let width = provisional.extent.width + padding * 2
  let height = provisional.extent.height + padding * 2
  if (width / height > 16 / 9) height = width * 9 / 16
  else width = height * 16 / 9
  const center = {
    x: provisional.origin.x + provisional.extent.width / 2,
    y: provisional.origin.y + provisional.extent.height / 2,
  }
  const frame = {
    origin: { x: center.x - width / 2, y: center.y - height / 2 },
    extent: { width, height },
    vectorBase,
    trajectories: points.length < 2
      ? []
      : [{ id: 'electric-trajectory', kind: 'history' as const, points }],
  }
  visualFrameCache.set(key, frame)
  return frame
}

export const electricSceneVisualAt = (input: ElectricVisualInput): SceneVisualModel => {
  const { scene, simulation, observations, state } = input
  const particle = scene.particles[0]
  const object = particle === undefined ? undefined : state.objects.find(candidate => candidate.id === particle.id)
  if (particle === undefined || object?.position === undefined) return emptyVisualModel('electric')

  const positionVector = toCanonicalVector(object.position).vectorSI
  const position = pointOf(positionVector)
  const field = observationOf(observations, 'electric_field')
  const force = observationOf(observations, 'electric_force')
  const velocity = observationOf(observations, 'electric_velocity')
  const acceleration = observationOf(observations, 'electric_acceleration')
  const trajectory = observationOf(observations, 'electric_trajectory')
  const potential = observationOf(observations, 'electric_potential')
  const energy = observationOf(observations, 'electric_energy')
  const trajectoryPoints = trajectory === undefined
    ? simulationTrajectoryPoints(simulation, particle.id)
    : observedTrajectoryPoints(trajectory.points)
  const frame = stableVisualFrame(trajectoryPoints, position)
  const base = frame.vectorBase
  const vectors: VectorVisual[] = []
  if (field !== undefined) {
    vectors.push(vectorVisual(
      'electric-field-vector',
      'field',
      'electricField',
      'E',
      position,
      toCanonicalVector(field.vector).vectorSI,
      base * 0.18,
    ))
  }
  if (force !== undefined && force.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'electric-force-vector',
      'force',
      'force',
      'F_e',
      position,
      toCanonicalVector(force.vector).vectorSI,
      base * 0.16,
    ))
  }
  if (velocity !== undefined && velocity.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'electric-velocity-vector',
      'velocity',
      'velocity',
      'v',
      position,
      toCanonicalVector(velocity.vector).vectorSI,
      base * 0.2,
    ))
  }
  if (acceleration !== undefined && acceleration.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'electric-acceleration-vector',
      'acceleration',
      'acceleration',
      'a',
      position,
      toCanonicalVector(acceleration.vector).vectorSI,
      base * 0.14,
    ))
  }

  const charge = particle.charge?.value ?? 0
  const readout = [
    `t = ${formatNumber(state.time.value)} s`,
    ...(field === undefined ? [] : [`|E| = ${formatNumber(field.magnitude.value)} ${field.magnitude.unit}`]),
    ...(force === undefined ? [] : [`|F| = ${formatNumber(force.magnitude.value)} ${force.magnitude.unit}`]),
    ...(velocity === undefined ? [] : [`|v| = ${formatNumber(velocity.magnitude.value)} ${velocity.magnitude.unit}`]),
    ...(acceleration === undefined ? [] : [`|a| = ${formatNumber(acceleration.magnitude.value)} ${acceleration.magnitude.unit}`]),
    ...(potential === undefined ? [] : [`Δφ = ${formatNumber(potential.change.value)} ${potential.change.unit}`]),
    ...(energy === undefined ? [] : [`K = ${formatNumber(energy.kinetic.value)} ${energy.kinetic.unit}`]),
  ]
  const fieldDirection = field === undefined
    ? { x: 1, y: 0 }
    : normalized(toCanonicalVector(field.vector).vectorSI)

  return emptyVisualModel('electric', {
    origin: frame.origin,
    extent: frame.extent,
    grid: { minor: frame.extent.width / 24, major: frame.extent.width / 6 },
    axes: { x: 'x / m', y: 'y / m' },
    ...(frame.extent.width <= 20 ? { tickStep: 2 } : {}),
    particles: [{
      id: particle.id,
      at: position,
      sign: charge < 0 ? 'negative' : 'positive',
      radius: Math.max(0.12, Math.min(0.28, frame.extent.width * 0.014)),
      symbol: charge < 0 ? 'q⁻' : 'q⁺',
    }],
    vectors,
    trajectories: frame.trajectories,
    electricField: {
      direction: fieldDirection,
      spacing: frame.extent.width / 8,
    },
    overlay: {
      readout,
      scale: { label: frame.extent.width <= 20 ? '1 m' : '5 m', length: frame.extent.width <= 20 ? 1 : 5 },
    },
    visible: visibilityOf(scene),
  })
}

export const electricSampleReadout = (
  simulation: SimulationResult,
  particleId: string,
  index: number,
): readonly { label: string; value: string }[] => {
  const state = simulation.states[index]
  const object = state?.objects.find(candidate => candidate.id === particleId)
  if (state === undefined || object?.position === undefined || object.velocity === undefined) return []
  const position = toCanonicalVector(object.position).vectorSI
  const speed = derivedScalar(state.derived, 'speed')
  const force = derivedScalar(state.derived, 'electric_force_magnitude')
  return [
    { label: 't', value: `${formatNumber(state.time.value)} s` },
    { label: 'r', value: `(${formatNumber(position.x)}, ${formatNumber(position.y)}) m` },
    { label: '|v|', value: `${formatNumber(speed.value)} ${speed.unit}` },
    { label: '|F|', value: `${formatNumber(force.value)} ${force.unit}` },
  ]
}
