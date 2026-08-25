import {
  derivedScalar,
  toCanonicalVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { fieldAt, pointChargePotential, type PointCharge } from '@physicsos/physics-electric-core'
import type {
  ElectricObservation,
  ElectricObservationRuntimeState,
  ElectricTrajectoryObservation,
} from '@physicsos/physics-observation'
import {
  fieldSamplePointOf,
  isParallelPlateScene,
  plateLengthOf,
  plateSeparationOf,
  probeParticleOf,
  sourceChargesOf,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import {
  emptyVisualModel,
  type BoundedFieldVisual,
  type EquipotentialVisual,
  type FieldStreamlineVisual,
  type PlateVisual,
  type PointChargeSourceVisual,
  type ProbeVisual,
  type ScenePoint,
  type SceneVisualModel,
  type VectorVisual,
} from './scene-visual-model.ts'
import { formatTimeAt } from './time-format.ts'

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
  /* Equipotentials are an annotation with parameters.kind 'equipotential'; the
     `annotation` type is shared with charge_sign, so the kind narrows it. */
  const equipotentialsVisible = scene.observableDefinitions.some(
    definition => definition.type === 'annotation'
      && definition.visible
      && definition.parameters?.['kind'] === 'equipotential',
  )
  return {
    electricField: visible('electric_field'),
    force: visible('force'),
    velocity: visible('velocity'),
    acceleration: visible('acceleration'),
    trajectory: visible('trajectory'),
    potential: visible('electric_potential'),
    energy: visible('energy'),
    equipotentials: equipotentialsVisible,
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
  const { scene } = input
  if (isParallelPlateScene(scene)) return electricRegionVisualAt(input)
  if (isPointChargeScene(scene)) return electricPointChargeVisualAt(input)
  return electricUniformVisualAt(input)
}

const isPointChargeScene = (scene: PhysicsScene): boolean =>
  scene.fields.some(field => field.type === 'point_charge')

/* ---------------------------------------------------- parallel-plate region -- */

/**
 * Frame a bounded-field scene at its own scale.
 *
 * `extentOf` floors the frame at 12 x 7 scene units with a 2-unit minimum pad,
 * which is right for the metre-scale unbounded scenes it was written for. A
 * parallel-plate device is centimetre-scale (a 0.12 m x 0.04 m gap), so those
 * floors would inflate the frame ~100x and render the plates as an invisible
 * speck — and `vectorBase` with them, so E and v would shoot metres off-canvas.
 * Here the padding is a fraction of the content, so the device fills the canvas
 * whatever its absolute size.
 */
const regionVisualFrame = (points: readonly ScenePoint[], fallback: ScenePoint) => {
  const key = points.length === 0 ? [fallback] : points
  const xs = key.map(point => point.x)
  const ys = key.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const contentWidth = maxX - minX
  const contentHeight = maxY - minY
  /* A degenerate span (single point, or a perfectly flat trajectory) still needs
     a frame with area, so fall back to the other axis before an absolute epsilon. */
  const span = Math.max(contentWidth, contentHeight, 1e-9)
  const pad = span * 0.18
  let width = contentWidth + pad * 2
  let height = contentHeight + pad * 2
  if (width / height > 16 / 9) height = width * 9 / 16
  else width = height * 16 / 9
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  return {
    origin: { x: center.x - width / 2, y: center.y - height / 2 },
    extent: { width, height },
    vectorBase: Math.min(width, height),
  }
}

/**
 * Parallel-plate (bounded uniform field) visual.
 *
 * The scene carries two plate boundaries, one rectangular field region and one
 * uniform field bound to that region. The bridge reads the geometry straight from
 * the scene and the vectors from the verified observations — no physics is
 * computed here.
 */
const electricRegionVisualAt = (input: ElectricVisualInput): SceneVisualModel => {
  const { scene, simulation, observations, state } = input
  const particle = scene.particles[0]
  const object = particle === undefined ? undefined : state.objects.find(candidate => candidate.id === particle.id)
  if (particle === undefined || object?.position === undefined) return emptyVisualModel('electric')

  const plateLength = plateLengthOf(scene)
  const plateSeparation = plateSeparationOf(scene)
  const region = scene.regions[0]
  const regionCenter = region === undefined
    ? { x: 0, y: 0 }
    : pointOf(toCanonicalVector(region.center).vectorSI)

  /* Field direction comes from the SCENE's field vector, not from the current
     frame's observation. Inside a bounded field the observed E is zero whenever
     the particle is outside the plates — including the opening frame — so reading
     the observation would draw the lattice sideways and mislabel the plate
     polarity for the whole approach. The scene's E is the constant physical
     statement about the capacitor; the observation is about one instant. */
  const field = observationOf(observations, 'electric_field')
  const force = observationOf(observations, 'electric_force')
  const velocity = observationOf(observations, 'electric_velocity')
  const acceleration = observationOf(observations, 'electric_acceleration')
  const trajectory = observationOf(observations, 'electric_trajectory')
  const potential = observationOf(observations, 'electric_potential')
  const energy = observationOf(observations, 'electric_energy')

  const sceneField = scene.fields.find(entry => entry.type === 'uniform_electric')
  const sceneFieldVector = sceneField === undefined
    ? undefined
    : toCanonicalVector(sceneField.fieldStrength).vectorSI
  const fieldDirection = sceneFieldVector === undefined
    ? { x: 1, y: 0 }
    : normalized(sceneFieldVector)

  /* Plates from boundaries: the scene carries two segment boundaries — the
     upper plate at y = +separation/2, the lower at y = -separation/2. Each
     segment's midpoint is the plate centre. */
  const plates: PlateVisual[] = scene.boundaries
    .filter(boundary => boundary.type === 'segment' && boundary.geometry.type === 'segment')
    .map((boundary) => {
      const geometry = boundary.geometry
      if (geometry.type !== 'segment') return null
      const start = pointOf(toCanonicalVector(geometry.start).vectorSI)
      const end = pointOf(toCanonicalVector(geometry.end).vectorSI)
      const centerY = (start.y + end.y) / 2
      const centerX = (start.x + end.x) / 2
      const length = Math.abs(end.x - start.x)
      const top = centerY > 0
      /* Infer sign from the field direction: if E points down, the top plate
         is positive; if E points up, the top plate is negative. */
      const sign: 'positive' | 'negative' | undefined = fieldDirection.y < 0
        ? (top ? 'positive' : 'negative')
        : fieldDirection.y > 0
          ? (top ? 'negative' : 'positive')
          : undefined
      return {
        id: boundary.id,
        at: { x: centerX, y: centerY },
        length,
        top,
        ...(sign === undefined ? {} : { sign }),
      } satisfies PlateVisual
    })
    .filter((entry): entry is PlateVisual => entry !== null)

  const positionVector = toCanonicalVector(object.position).vectorSI
  const position = pointOf(positionVector)
  const trajectoryPoints = trajectory === undefined
    ? simulationTrajectoryPoints(simulation, particle.id)
    : observedTrajectoryPoints(trajectory.points)

  /* Frame: cover the plates + trajectory + particle start position. The plates
     span ±plateLength/2 in x and ±plateSeparation/2 in y. The particle may
     start outside the plates, so include its trajectory points in the frame. */
  const framePoints: ScenePoint[] = [
    { x: -plateLength / 2, y: plateSeparation / 2 },
    { x: plateLength / 2, y: -plateSeparation / 2 },
    ...trajectoryPoints,
    position,
  ]
  const frame = regionVisualFrame(framePoints, position)
  const base = frame.vectorBase

  const boundedField: BoundedFieldVisual = {
    at: regionCenter,
    width: plateLength,
    height: plateSeparation,
    direction: fieldDirection,
    spacing: Math.min(plateLength, plateSeparation) / 4,
  }

  /* Vectors: E, F, v, a — same scaling strategy as the uniform-field bridge. */
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
    `t = ${formatTimeAt(state.time.value, simulation.states.at(-1)?.time.value ?? 0)}`,
    ...(field === undefined ? [] : [`|E| = ${formatNumber(field.magnitude.value)} ${field.magnitude.unit}`]),
    ...(force === undefined ? [] : [`|F| = ${formatNumber(force.magnitude.value)} ${force.magnitude.unit}`]),
    ...(velocity === undefined ? [] : [`|v| = ${formatNumber(velocity.magnitude.value)} ${velocity.magnitude.unit}`]),
    ...(acceleration === undefined ? [] : [`|a| = ${formatNumber(acceleration.magnitude.value)} ${acceleration.magnitude.unit}`]),
    ...(potential === undefined ? [] : [`Δφ = ${formatNumber(potential.change.value)} ${potential.change.unit}`]),
    ...(energy === undefined ? [] : [`K = ${formatNumber(energy.kinetic.value)} ${energy.kinetic.unit}`]),
  ]

  /* Tick step, particle radius and the scale bar all have to be derived from the
     frame rather than fixed in metres: a capacitor gap is centimetre-scale, so a
     2 m tick would draw nothing and a 0.12 m particle would cover a third of the
     canvas. `niceStep` picks the 1/2/5×10ⁿ step nearest a sixth of the width, so
     the axis stays readable from millimetres to metres. */
  const niceStep = (target: number): number => {
    if (!Number.isFinite(target) || target <= 0) return 1
    const magnitude = 10 ** Math.floor(Math.log10(target))
    const normalized = target / magnitude
    const factor = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10
    return factor * magnitude
  }
  const tickStep = niceStep(frame.extent.width / 6)
  const scaleLength = niceStep(frame.extent.width / 5)
  const scaleLabel = scaleLength >= 1
    ? `${formatNumber(scaleLength)} m`
    : scaleLength >= 0.01
      ? `${formatNumber(scaleLength * 100)} cm`
      : `${formatNumber(scaleLength * 1000)} mm`

  return emptyVisualModel('electric', {
    origin: frame.origin,
    extent: frame.extent,
    grid: { minor: frame.extent.width / 24, major: frame.extent.width / 6 },
    axes: { x: 'x / m', y: 'y / m' },
    tickStep,
    particles: [{
      id: particle.id,
      at: position,
      sign: charge < 0 ? 'negative' : 'positive',
      radius: frame.extent.width * 0.014,
      symbol: charge < 0 ? 'q⁻' : 'q⁺',
    }],
    vectors,
    trajectories: trajectoryPoints.length < 2
      ? []
      : [{ id: 'electric-trajectory', kind: 'history' as const, points: trajectoryPoints }],
    plates,
    boundedField,
    overlay: {
      readout,
      scale: { label: scaleLabel, length: scaleLength },
    },
    visible: visibilityOf(scene),
  })
}

const electricUniformVisualAt = (input: ElectricVisualInput): SceneVisualModel => {
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
    `t = ${formatTimeAt(state.time.value, simulation.states.at(-1)?.time.value ?? 0)}`,
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

/* ----------------------------------------------------- point-charge field -- */

const chargeOf = (scene: PhysicsScene, particleId: string): number => {
  const particle = scene.particles.find(candidate => candidate.id === particleId)
  return particle?.charge?.value ?? 0
}

const sourceRadiusOf = (charge: number, base: number): number => {
  /* Scale the drawn sphere with |q|, clamped so it never dwarfs the frame. */
  const magnitudeCoulombs = Math.abs(charge)
  const scaled = magnitudeCoulombs > 0
    ? base * 0.025 * Math.max(0.6, Math.log10(magnitudeCoulombs * 1e6 + 1))
    : base * 0.02
  return Math.max(base * 0.014, Math.min(base * 0.06, scaled))
}

/**
 * Trace one field streamline from a start point, integrating along the field
 * direction. Forward walks with the field; backward walks against it, so a
 * negative source's inward lines still render by tracing toward the source.
 */
const traceStreamline = (
  charges: readonly PointCharge[],
  start: { x: number; y: number; z: number },
  step: number,
  maxSteps: number,
  forward: boolean,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { points: ScenePoint[]; arrowAt: ScenePoint } => {
  const points: ScenePoint[] = [{ x: start.x, y: start.y }]
  let current = { x: start.x, y: start.y, z: start.z }
  for (let i = 0; i < maxSteps; i += 1) {
    let sample
    try {
      sample = fieldAt(charges, current)
    } catch {
      /* Singular point reached (another source on the line). Stop here. */
      break
    }
    const length = Math.hypot(sample.field.x, sample.field.y, sample.field.z)
    if (length === 0) break
    const sign = forward ? 1 : -1
    const dir = { x: sample.field.x / length, y: sample.field.y / length }
    current = { x: current.x + sign * dir.x * step, y: current.y + sign * dir.y * step, z: 0 }
    if (
      current.x < bounds.minX || current.x > bounds.maxX ||
      current.y < bounds.minY || current.y > bounds.maxY
    ) {
      points.push({ x: current.x, y: current.y })
      break
    }
    points.push({ x: current.x, y: current.y })
  }
  const arrowIndex = Math.floor(points.length / 2)
  const arrowAt = points[arrowIndex] ?? points[0] ?? { x: start.x, y: start.y }
  return { points, arrowAt }
}

/**
 * Potential at a point from the combined sources, for equipotential sampling.
 * Returns NaN near a singularity (the same convention the field lattice uses) so
 * the contour pass skips cells where the model asserts nothing.
 */
const potentialAt = (
  charges: readonly PointCharge[],
  at: { x: number; y: number; z: number },
): number => {
  try {
    return charges.reduce(
      (total, charge) => total + pointChargePotential(charge.charge, charge.position, at),
      0,
    )
  } catch {
    return Number.NaN
  }
}

/**
 * Marching squares over a potential grid for one level set.
 *
 * Walks each 2×2 cell; for the four corner potential values it builds a 4-bit case
 * index (corner above level = 1), then emits the edge crossings per the standard 16
 * cases. Saddle cases (5 and 10) use the cell-center average to disambiguate.
 * Each returned polyline is a sequence of scene points; whether it closes is
 * inferred from whether its start and end land on the grid boundary.
 */
const contourAtLevel = (
  grid: { values: Float64Array; columns: number; rows: number; origin: { x: number; y: number }; cellSize: { x: number; y: number } },
  level: number,
): { points: ScenePoint[]; closed: boolean }[] => {
  const { values, columns, rows, origin, cellSize } = grid
  const xFor = (column: number) => origin.x + cellSize.x * column
  const yFor = (row: number) => origin.y + cellSize.y * row
  /* Linear interpolation of where the level crosses an edge between two corners. */
  const lerp = (a: number, b: number, va: number, vb: number): number => {
    const denom = vb - va
    return denom === 0 ? a : a + ((level - va) / denom) * (b - a)
  }
  const segments: Array<{ a: ScenePoint; b: ScenePoint }> = []
  for (let column = 0; column < columns - 1; column += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      const i00 = row * columns + column
      const i10 = row * columns + (column + 1)
      const i11 = (row + 1) * columns + (column + 1)
      const i01 = (row + 1) * columns + column
      const v00 = values[i00] ?? Number.NaN
      const v10 = values[i10] ?? Number.NaN
      const v11 = values[i11] ?? Number.NaN
      const v01 = values[i01] ?? Number.NaN
      if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) continue
      let code = 0
      if (v00 >= level) code |= 1
      if (v10 >= level) code |= 2
      if (v11 >= level) code |= 4
      if (v01 >= level) code |= 8
      if (code === 0 || code === 15) continue
      const x0 = xFor(column), x1 = xFor(column + 1)
      const y0 = yFor(row), y1 = yFor(row + 1)
      /* Edge crossings: bottom (v00→v10), right (v10→v11), top (v01→v11), left (v00→v01). */
      const bottom = { x: lerp(x0, x1, v00, v10), y: y0 }
      const right = { x: x1, y: lerp(y0, y1, v10, v11) }
      const top = { x: lerp(x0, x1, v01, v11), y: y1 }
      const left = { x: x0, y: lerp(y0, y1, v00, v01) }
      const center = (v00 + v10 + v11 + v01) / 4
      const push = (a: ScenePoint, b: ScenePoint) => segments.push({ a, b })
      switch (code) {
        case 1: case 14: push(left, bottom); break
        case 2: case 13: push(bottom, right); break
        case 3: case 12: push(left, right); break
        case 4: case 11: push(right, top); break
        case 5: case 10: { /* saddle: disambiguate by center */
          if (center >= level) { push(left, top); push(bottom, right) }
          else { push(left, bottom); push(right, top) }
          break
        }
        case 6: case 9: push(bottom, top); break
        case 7: case 8: push(left, top); break
        default: break
      }
    }
  }
  if (segments.length === 0) return []
  /* Chain segments into polylines by matching endpoints. Marching squares segments
     are short and numerous; a greedy nearest-endpoint chain keeps the polyline order
     without needing a spatial index. */
  const used = new Array(segments.length).fill(false)
  const polylines: { points: ScenePoint[]; closed: boolean }[] = []
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue
    const seed = segments[start]
    if (seed === undefined) continue
    used[start] = true
    const points: ScenePoint[] = [seed.a, seed.b]
    /* Extend forward. */
    let extended = true
    while (extended) {
      extended = false
      const tail = points.at(-1)
      if (tail === undefined) break
      for (let k = 0; k < segments.length; k += 1) {
        if (used[k]) continue
        const seg = segments[k]
        if (seg === undefined) continue
        if (Math.abs(seg.a.x - tail.x) < 1e-9 && Math.abs(seg.a.y - tail.y) < 1e-9) {
          points.push(seg.b); used[k] = true; extended = true; break
        }
        if (Math.abs(seg.b.x - tail.x) < 1e-9 && Math.abs(seg.b.y - tail.y) < 1e-9) {
          points.push(seg.a); used[k] = true; extended = true; break
        }
      }
    }
    /* Extend backward. */
    extended = true
    while (extended) {
      extended = false
      const head = points[0]
      if (head === undefined) break
      for (let k = 0; k < segments.length; k += 1) {
        if (used[k]) continue
        const seg = segments[k]
        if (seg === undefined) continue
        if (Math.abs(seg.b.x - head.x) < 1e-9 && Math.abs(seg.b.y - head.y) < 1e-9) {
          points.unshift(seg.a); used[k] = true; extended = true; break
        }
        if (Math.abs(seg.a.x - head.x) < 1e-9 && Math.abs(seg.a.y - head.y) < 1e-9) {
          points.unshift(seg.b); used[k] = true; extended = true; break
        }
      }
    }
    const head = points[0]
    const tail = points.at(-1)
    if (head === undefined || tail === undefined) continue
    const closed = Math.abs(head.x - tail.x) < 1e-6 && Math.abs(head.y - tail.y) < 1e-6
    polylines.push({ points, closed })
  }
  return polylines
}

/**
 * Equipotential contours for a multi-source field. Samples the potential on a grid
 * within the frame, picks a handful of levels auto-scaled to the field's magnitude,
 * and traces each via marching squares. Single-source scenes return no contours: a
 * point charge's equipotentials are concentric circles already shown by streamlines.
 */
const equipotentialsOf = (
  sources: readonly PointCharge[],
  frame: { origin: { x: number; y: number }; extent: { width: number; height: number } },
): EquipotentialVisual[] => {
  if (sources.length < 2) return []
  const columns = 48
  const rows = 27
  const grid = {
    values: new Float64Array(columns * rows),
    columns,
    rows,
    origin: { x: frame.origin.x, y: frame.origin.y },
    cellSize: { x: frame.extent.width / columns, y: frame.extent.height / rows },
  }
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const at = {
        x: frame.origin.x + grid.cellSize.x * (column + 0.5),
        y: frame.origin.y + grid.cellSize.y * (row + 0.5),
        z: 0,
      }
      grid.values[row * columns + column] = potentialAt(sources, at)
    }
  }
  /* Auto-scale levels to the peak finite |V| in the grid so the contours sit where
     the field actually has structure, not at arbitrary absolute values. */
  let peak = 0
  for (const value of grid.values) {
    if (Number.isFinite(value) && Math.abs(value) > peak) peak = Math.abs(value)
  }
  if (peak === 0) return []
  const levelFractions = [0.2, 0.35, 0.55, 0.8]
  const contours: EquipotentialVisual[] = []
  for (const fraction of levelFractions) {
    for (const sign of [1, -1] as const) {
      const level = sign * peak * fraction
      if (level === 0) continue
      const polylines = contourAtLevel(grid, level)
      for (const [index, polyline] of polylines.entries()) {
        if (polyline.points.length < 3) continue
        contours.push({
          id: `equipotential-${fraction}-${sign > 0 ? 'pos' : 'neg'}-${index}`,
          level,
          points: polyline.points,
          closed: polyline.closed,
        })
      }
    }
  }
  return contours
}

const electricPointChargeVisualAt = (input: ElectricVisualInput): SceneVisualModel => {
  const { scene, simulation, observations, state } = input
  const sourceParticles = sourceChargesOf(scene.particles, scene.fields)
  const probeParticle = probeParticleOf(scene.particles, scene.fields)
  if (sourceParticles.length === 0) return emptyVisualModel('electric')

  /* Charge signs come from the verified `charge_sign` observations — a physics
     fact the scene carries, never one the renderer decides from the sign of the
     charge value (which would re-derive what the observation layer already
     authoritatively published). Fall back to the scalar only if no sign
     observation is present (e.g. a scene built without the charge_sign observable). */
  const signObservations = observations.filter(entry => entry.type === 'charge_sign')
  const signOf = (sourceId: string): 'positive' | 'negative' => {
    const observed = signObservations.find(entry => 'targetId' in entry && entry.targetId === sourceId)
    /* Precedence trap: `value ?? 0 < 0` parses as `value ?? (0 < 0)`, which read
       any non-zero charge as negative. The parenthesised form compares the value. */
    return observed !== undefined && 'sign' in observed
      ? observed.sign === 'neutral' ? 'positive' : observed.sign
      : (sourceParticles.find(p => p.id === sourceId)?.charge?.value ?? 0) < 0
        ? 'negative'
        : 'positive'
  }

  const sources: PointCharge[] = sourceParticles.map(particle => ({
    id: particle.id,
    charge: chargeOf(scene, particle.id),
    position: toCanonicalVector(particle.position).vectorSI,
    fixed: true,
  }))

  const probePoint = probeParticle === undefined
    ? undefined
    : pointOf(toCanonicalVector(probeParticle.position).vectorSI)
  const samplePoint = probeParticle === undefined ? fieldSamplePointOf(scene) : undefined
  const originPoint = probePoint ?? (samplePoint ? { x: samplePoint.x, y: samplePoint.y } : { x: 0, y: 0 })

  /* Frame from all charge + probe positions so the whole scene fits. */
  const framePoints: ScenePoint[] = [
    ...sources.map(source => ({ x: source.position.x, y: source.position.y })),
    ...(probePoint === undefined ? [] : [probePoint]),
  ]
  const frame = stableVisualFrame(framePoints, originPoint)
  const base = frame.vectorBase

  const pointChargeSources: PointChargeSourceVisual[] = sources.map(source => ({
    id: source.id,
    at: { x: source.position.x, y: source.position.y },
    sign: signOf(source.id),
    radius: sourceRadiusOf(source.charge, base),
    chargeValue: source.charge,
  }))

  const probeVisual: ProbeVisual | undefined = probePoint === undefined
    ? undefined
    : { id: probeParticle?.id ?? 'probe', at: probePoint }

  /* Streamlines: for each source, radiate N lines from just outside the sphere,
     integrating along the combined field so multi-source worlds bend.

     A positive source's field points outward, so tracing WITH the field yields the
     outward lines (arrow pointing away). A negative source's field points inward,
     so tracing AGAINST the field yields the outward-going geometry — but the
     physical line direction is inward, so the point order is reversed so the arrow
     lands pointing toward the charge. Only one sense is traced per source (the one
     that escapes the sphere), eliminating the degenerate oscillating stubs the
     double-trace produced. */
  const bounds = {
    minX: frame.origin.x - frame.extent.width * 0.05,
    maxX: frame.origin.x + frame.extent.width * 1.05,
    minY: frame.origin.y - frame.extent.height * 0.05,
    maxY: frame.origin.y + frame.extent.height * 1.05,
  }
  const radialCount = sources.length === 1 ? 12 : 8
  const step = base * 0.06
  const maxSteps = 60
  const minRadius = base * 0.05
  const fieldStreamlines: FieldStreamlineVisual[] = []
  for (const source of sources) {
    /* Positive → trace with the field (outward); negative → against (outward
       geometry), then reverse so the arrow points inward. */
    const forward = source.charge >= 0
    for (let i = 0; i < radialCount; i += 1) {
      const angle = (i / radialCount) * Math.PI * 2
      const start = {
        x: source.position.x + Math.cos(angle) * minRadius,
        y: source.position.y + Math.sin(angle) * minRadius,
        z: 0,
      }
      const trace = traceStreamline(sources, start, step, maxSteps, forward, bounds)
      /* Skip degenerate traces that never escaped the source sphere (the old
         double-trace produced 61-point oscillating stubs here). */
      if (trace.points.length < 2) continue
      const first = trace.points[0]
      const last = trace.points.at(-1)
      if (first === undefined || last === undefined) continue
      const span = Math.hypot(last.x - first.x, last.y - first.y)
      if (span < minRadius) continue
      const points = forward ? trace.points : [...trace.points].reverse()
      const arrow = points[Math.floor(points.length / 2)] ?? points[0]
      if (arrow === undefined) continue
      fieldStreamlines.push({
        id: `stream-${source.id}-${i}`,
        points,
        arrowAt: arrow,
        sourceId: source.id,
      })
    }
  }

  /* Probe vectors: E, F, v from the verified observations, same display rules
     as the uniform field path. */
  const field = observationOf(observations, 'electric_field')
  const force = observationOf(observations, 'electric_force')
  const velocity = observationOf(observations, 'electric_velocity')
  const acceleration = observationOf(observations, 'electric_acceleration')
  const vectors: VectorVisual[] = []
  if (probePoint !== undefined) {
    if (field !== undefined) {
      vectors.push(vectorVisual(
        'electric-field-vector',
        'field',
        'electricField',
        'E',
        probePoint,
        toCanonicalVector(field.vector).vectorSI,
        base * 0.2,
      ))
    }
    if (force !== undefined && force.magnitude.value > 0) {
      vectors.push(vectorVisual(
        'electric-force-vector',
        'force',
        'force',
        'F_e',
        probePoint,
        toCanonicalVector(force.vector).vectorSI,
        base * 0.18,
      ))
    }
    if (velocity !== undefined && velocity.magnitude.value > 0) {
      vectors.push(vectorVisual(
        'electric-velocity-vector',
        'velocity',
        'velocity',
        'v',
        probePoint,
        toCanonicalVector(velocity.vector).vectorSI,
        base * 0.22,
      ))
    }
    if (acceleration !== undefined && acceleration.magnitude.value > 0) {
      vectors.push(vectorVisual(
        'electric-acceleration-vector',
        'acceleration',
        'acceleration',
        'a',
        probePoint,
        toCanonicalVector(acceleration.vector).vectorSI,
        base * 0.16,
      ))
    }
  }

  const readout = [
    `t = ${formatTimeAt(state.time.value, simulation.states.at(-1)?.time.value ?? 0)}`,
    ...(field === undefined ? [] : [`|E| = ${formatNumber(field.magnitude.value)} ${field.magnitude.unit}`]),
    ...(probePoint === undefined
      ? []
      : [
        ...(force === undefined ? [] : [`|F| = ${formatNumber(force.magnitude.value)} ${force.magnitude.unit}`]),
        ...(velocity === undefined ? [] : [`|v| = ${formatNumber(velocity.magnitude.value)} ${velocity.magnitude.unit}`]),
        ...(acceleration === undefined ? [] : [`|a| = ${formatNumber(acceleration.magnitude.value)} ${acceleration.magnitude.unit}`]),
      ]),
  ]

  /* Equipotentials: topology of the combined field, multi-source only. Computed from
     the same source charges the streamlines use; not a verified assertion (the
     precise V at a point is the derived `potential`). Hidden unless the scene's
     equipotential observable is visible. */
  const visible = visibilityOf(scene)
  const equipotentials = visible.equipotentials
    ? equipotentialsOf(sources, frame)
    : []

  return emptyVisualModel('electric', {
    origin: frame.origin,
    extent: frame.extent,
    grid: { minor: frame.extent.width / 24, major: frame.extent.width / 6 },
    axes: { x: 'x / m', y: 'y / m' },
    ...(frame.extent.width <= 20 ? { tickStep: 2 } : {}),
    pointChargeSources,
    ...(probeVisual === undefined ? {} : { probe: probeVisual }),
    vectors,
    fieldStreamlines,
    ...(equipotentials.length === 0 ? {} : { equipotentials }),
    overlay: {
      readout,
      scale: { label: frame.extent.width <= 20 ? '1 m' : '5 m', length: frame.extent.width <= 20 ? 1 : 5 },
    },
    visible,
  })
}
