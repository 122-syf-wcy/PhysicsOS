/**
 * Composite → SceneVisualModel bridge.
 *
 * Reads verified Composite Engine output (simulation states, observations) and
 * the scene geometry, and projects it into the shared {@link SceneVisualModel}
 * the `CompositeRenderer` consumes. It never computes a physical fact — every
 * vector and position comes from the simulation state or the observations.
 *
 * The composite apparatus is multi-region: a selector region carrying E and B,
 * a field-free gap, a deflection region carrying B only. Each region is drawn as
 * its own rectangle with the field lattice clipped to it, so "the field is zero
 * outside the selector" is a visual fact, not just a label. Field directions are
 * read from the SCENE's field vectors, never from the current frame's
 * observation — a frame with the particle outside the field region reports a
 * zero field, which would draw the lattice sideways.
 */
import { toCanonicalVector, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import type {
  CompositeObservation,
  CompositeObservationRuntimeState,
} from '@physicsos/physics-observation'
import { isCompositeFieldScene, type PhysicsScene, type Region } from '@physicsos/physics-scene'

import {
  emptyVisualModel,
  type CompositeRegionVisual,
  type ElectricFieldVisual,
  type FieldVisual,
  type ScenePoint,
  type SceneVisualModel,
  type VectorVisual,
} from './scene-visual-model.ts'
import { formatTimeAt } from './time-format.ts'

export interface CompositeVisualInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly observations: CompositeObservationRuntimeState['observations']
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

const observationOf = <TType extends CompositeObservation['type']>(
  observations: readonly CompositeObservation[],
  type: TType,
): Extract<CompositeObservation, { type: TType }> | undefined =>
  observations.find(
    (entry): entry is Extract<CompositeObservation, { type: TType }> => entry.type === type,
  )

/* Field visuals for a region: read the field vector from the SCENE (the constant
   physical statement about the apparatus), not the current frame's observation. */
const electricFieldVisualOf = (
  scene: PhysicsScene,
  region: Region,
): ElectricFieldVisual | undefined => {
  const field = scene.fields.find(
    candidate => candidate.type === 'uniform_electric' && candidate.regionId === region.id,
  )
  if (field?.type !== 'uniform_electric') return undefined
  const vector = toCanonicalVector(field.fieldStrength).vectorSI
  const magnitude = Math.hypot(vector.x, vector.y)
  if (magnitude === 0) return undefined
  return {
    direction: { x: vector.x / magnitude, y: vector.y / magnitude },
    spacing: regionWidthOf(region) / 4,
  }
}

const magneticFieldVisualOf = (
  scene: PhysicsScene,
  region: Region,
): FieldVisual | undefined => {
  const field = scene.fields.find(
    candidate => candidate.type === 'uniform_magnetic' && candidate.regionId === region.id,
  )
  if (field?.type !== 'uniform_magnetic') return undefined
  const bz = toCanonicalVector(field.magneticFluxDensity).vectorSI.z
  return {
    direction: bz < 0 ? 'into-page' : 'out-of-page',
    spacing: Math.min(regionWidthOf(region), regionHeightOf(region)) / 3,
  }
}

/* Global (regionless) uniform fields: the plain E+B and E+B+g templates state
   their fields for all space rather than binding them to an apparatus region,
   so there is no rectangle to clip a lattice to. They surface on the model's
   top-level `electricField` / `field` slots and paint the whole canvas — the
   same textures the single-domain electric and magnetic views draw — so the
   fields are a visible fact rather than a bare checkbox label. */
const globalElectricVisualOf = (
  scene: PhysicsScene,
  frameWidth: number,
): ElectricFieldVisual | undefined => {
  const field = scene.fields.find(
    candidate => candidate.type === 'uniform_electric' && candidate.regionId === undefined,
  )
  if (field?.type !== 'uniform_electric') return undefined
  const vector = toCanonicalVector(field.fieldStrength).vectorSI
  const magnitude = Math.hypot(vector.x, vector.y)
  if (magnitude === 0) return undefined
  return {
    direction: { x: vector.x / magnitude, y: vector.y / magnitude },
    /* Same lattice density the uniform electric view uses for its canvas. */
    spacing: frameWidth / 8,
  }
}

const globalMagneticVisualOf = (
  scene: PhysicsScene,
  extent: { readonly width: number; readonly height: number },
): FieldVisual | undefined => {
  const field = scene.fields.find(
    candidate => candidate.type === 'uniform_magnetic' && candidate.regionId === undefined,
  )
  if (field?.type !== 'uniform_magnetic') return undefined
  const bz = toCanonicalVector(field.magneticFluxDensity).vectorSI.z
  if (bz === 0) return undefined
  return {
    direction: bz < 0 ? 'into-page' : 'out-of-page',
    spacing: Math.min(extent.width, extent.height) / 6,
  }
}

const regionWidthOf = (region: Region): number =>
  region.shape.type === 'rectangle' ? region.shape.width.value : 1

const regionHeightOf = (region: Region): number =>
  region.shape.type === 'rectangle' ? region.shape.height.value : 1

const regionKindOf = (region: Region, scene: PhysicsScene): CompositeRegionVisual['kind'] => {
  const fields = scene.fields.filter(field => field.regionId === region.id)
  const hasE = fields.some(field => field.type === 'uniform_electric')
  const hasB = fields.some(field => field.type === 'uniform_magnetic')
  if (hasE && hasB) return 'selector'
  if (hasB && !hasE) return 'deflection'
  if (!hasE && !hasB) return 'transition'
  return 'generic'
}

const regionLabelOf = (kind: CompositeRegionVisual['kind']): string => {
  switch (kind) {
    case 'selector':
      return '选择器区 E+B'
    case 'transition':
      return '无场过渡区'
    case 'deflection':
      return '磁偏转区 B'
    case 'generic':
      return '场区'
  }
}

const compositeRegionsOf = (scene: PhysicsScene): readonly CompositeRegionVisual[] =>
  scene.regions.map((region) => {
    const kind = regionKindOf(region, scene)
    const center = toCanonicalVector(region.center).vectorSI
    const electricField = electricFieldVisualOf(scene, region)
    const magneticField = magneticFieldVisualOf(scene, region)
    /* Build with a base then add optional visuals only when present: TS under
       exactOptionalPropertyTypes keeps a conditional spread as `T | undefined`,
       which would widen the property. Assigning onto a typed local first, then
       returning it, lets the optional keys stay genuinely optional. */
    const visual: CompositeRegionVisual = {
      id: region.id,
      at: pointOf(center),
      width: regionWidthOf(region),
      height: regionHeightOf(region),
      kind,
      label: regionLabelOf(kind),
    }
    if (electricField !== undefined) visual.electricField = electricField
    if (magneticField !== undefined) visual.magneticField = magneticField
    return visual
  })

/**
 * Frame the composite scene at its own scale.
 *
 * Composite apparatuses are centimetre-scale like parallel-plate devices, so the
 * frame must pad by a fraction of the content rather than a metre floor — a
 * metre floor would inflate a 4 cm selector region ~100× and render it an
 * invisible speck, with the vectors shot off-canvas by the same factor.
 */
const compositeFrame = (
  points: readonly ScenePoint[],
  fallback: ScenePoint,
): { origin: ScenePoint; extent: { width: number; height: number }; vectorBase: number } => {
  const key = points.length === 0 ? [fallback] : points
  const xs = key.map(point => point.x)
  const ys = key.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const contentWidth = maxX - minX
  const contentHeight = maxY - minY
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

const niceStep = (target: number): number => {
  if (!Number.isFinite(target) || target <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const normalized = target / magnitude
  const factor = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10
  return factor * magnitude
}

/**
 * Project one verified composite frame into the shared visual model.
 *
 * Vector scaling is a fraction of the frame's smaller dimension, the same rule
 * the electric region bridge uses, so arrows stay in proportion to the
 * apparatus whatever its absolute size. Force vectors are only drawn when the
 * engine reported a non-zero magnitude — outside a field region every
 * contribution is zero, and drawing zero-length arrows would clutter the
 * field-free approach.
 */
export const compositeSceneVisualAt = (input: CompositeVisualInput): SceneVisualModel => {
  const { scene, simulation, observations, state } = input
  const particle = scene.particles[0]
  const object = particle === undefined ? undefined : state.objects.find(candidate => candidate.id === particle.id)
  if (particle === undefined || object?.position === undefined) return emptyVisualModel('composite')

  const position = pointOf(toCanonicalVector(object.position).vectorSI)
  const regions = compositeRegionsOf(scene)

  /* Trajectory from the simulation state stream — every sampled position, in
     order. The observation carries it too, but the simulation stream is the
     source of truth for hover/seek because it is parallel to trajectoryTimes. */
  const trajectoryPoints: ScenePoint[] = simulation.states.flatMap((sample) => {
    const sampleObject = sample.objects.find(candidate => candidate.id === particle.id)
    return sampleObject?.position === undefined
      ? []
      : [pointOf(toCanonicalVector(sampleObject.position).vectorSI)]
  })

  /* Frame: cover every region rectangle + the trajectory + the particle start. */
  const framePoints: ScenePoint[] = [
    ...regions.flatMap(region => [
      { x: region.at.x - region.width / 2, y: region.at.y + region.height / 2 },
      { x: region.at.x + region.width / 2, y: region.at.y - region.height / 2 },
    ]),
    ...trajectoryPoints,
    position,
  ]
  const frame = compositeFrame(framePoints, position)
  const base = frame.vectorBase

  const electricForce = observationOf(observations, 'composite_electric_force')
  const magneticForce = observationOf(observations, 'composite_magnetic_force')
  const gravityForce = observationOf(observations, 'composite_gravity_force')
  const netForce = observationOf(observations, 'composite_net_force')
  const velocity = observationOf(observations, 'composite_velocity')
  const electricField = observationOf(observations, 'composite_electric_field')
  const magneticField = observationOf(observations, 'composite_magnetic_field')

  const vectors: VectorVisual[] = []
  if (electricField !== undefined && electricField.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'electric-field-vector', 'field', 'electricField', 'E',
      position, toCanonicalVector(electricField.vector).vectorSI, base * 0.18,
    ))
  }
  if (electricForce !== undefined && electricForce.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'electric-force-vector', 'electric-force', 'electricForce', 'F_E',
      position, toCanonicalVector(electricForce.vector).vectorSI, base * 0.16,
    ))
  }
  if (magneticForce !== undefined && magneticForce.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'magnetic-force-vector', 'magnetic-force', 'magneticForce', 'F_B',
      position, toCanonicalVector(magneticForce.vector).vectorSI, base * 0.16,
    ))
  }
  if (gravityForce !== undefined && gravityForce.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'gravity-force-vector', 'gravity', 'gravityForce', 'mg',
      position, toCanonicalVector(gravityForce.vector).vectorSI, base * 0.14,
    ))
  }
  if (netForce !== undefined && netForce.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'net-force-vector', 'net-force', 'netForce', 'F_net',
      position, toCanonicalVector(netForce.vector).vectorSI, base * 0.18,
    ))
  }
  if (velocity !== undefined && velocity.magnitude.value > 0) {
    vectors.push(vectorVisual(
      'velocity-vector', 'velocity', 'velocity', 'v',
      position, toCanonicalVector(velocity.vector).vectorSI, base * 0.2,
    ))
  }

  const charge = particle.charge?.value ?? 0
  const runWindow = simulation.states.at(-1)?.time.value ?? 0
  const readout = [
    `t = ${formatTimeAt(state.time.value, runWindow)}`,
    ...(velocity === undefined ? [] : [`|v| = ${formatNumber(velocity.magnitude.value)} ${velocity.magnitude.unit}`]),
    ...(electricField === undefined ? [] : [`|E| = ${formatNumber(electricField.magnitude.value)} ${electricField.magnitude.unit}`]),
    ...(magneticField === undefined ? [] : [`|B| = ${formatNumber(magneticField.magnitude.value)} ${magneticField.magnitude.unit}`]),
    ...(electricForce === undefined ? [] : [`|F_E| = ${formatNumber(electricForce.magnitude.value)} ${electricForce.magnitude.unit}`]),
    ...(magneticForce === undefined ? [] : [`|F_B| = ${formatNumber(magneticForce.magnitude.value)} ${magneticForce.magnitude.unit}`]),
    ...(netForce === undefined ? [] : [`|F_net| = ${formatNumber(netForce.magnitude.value)} ${netForce.magnitude.unit}`]),
  ]

  const tickStep = niceStep(frame.extent.width / 6)
  const scaleLength = niceStep(frame.extent.width / 5)
  const scaleLabel = scaleLength >= 1
    ? `${formatNumber(scaleLength)} m`
    : scaleLength >= 0.01
      ? `${formatNumber(scaleLength * 100)} cm`
      : `${formatNumber(scaleLength * 1000)} mm`

  const globalElectric = globalElectricVisualOf(scene, frame.extent.width)
  const globalMagnetic = globalMagneticVisualOf(scene, frame.extent)

  return emptyVisualModel('composite', {
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
      : [{ id: 'composite-trajectory', kind: 'history' as const, points: trajectoryPoints }],
    compositeRegions: regions,
    ...(globalElectric === undefined ? {} : { electricField: globalElectric }),
    ...(globalMagnetic === undefined ? {} : { field: globalMagnetic }),
    overlay: {
      readout,
      scale: { label: scaleLabel, length: scaleLength },
    },
    visible: visibilityOf(scene),
  })
}

const visibilityOf = (scene: PhysicsScene): SceneVisualModel['visible'] => {
  const isForceVisible = (kind: string) =>
    scene.observableDefinitions.some(
      definition =>
        definition.type === 'force' &&
        definition.visible &&
        definition.parameters?.['kind'] === kind,
    )
  return {
    velocity: scene.observableDefinitions.some(d => d.type === 'velocity' && d.visible),
    electricForce: isForceVisible('electric'),
    magneticForce: isForceVisible('magnetic'),
    gravityForce: isForceVisible('gravity'),
    netForce: isForceVisible('net'),
    electricField: scene.observableDefinitions.some(d => d.type === 'electric_field' && d.visible),
    magneticField: scene.observableDefinitions.some(d => d.type === 'magnetic_field' && d.visible),
    trajectory: scene.observableDefinitions.some(d => d.type === 'trajectory' && d.visible),
    regions: true,
  }
}

export const compositeSampleReadout = (
  simulation: SimulationResult,
  particleId: string,
  index: number,
): readonly { label: string; value: string }[] => {
  const state = simulation.states[index]
  const object = state?.objects.find(candidate => candidate.id === particleId)
  if (state === undefined || object?.position === undefined || object.velocity === undefined) return []
  const position = toCanonicalVector(object.position).vectorSI
  const speed = Math.hypot(
    object.velocity.vector.x,
    object.velocity.vector.y,
    object.velocity.vector.z,
  )
  return [
    { label: 't', value: formatTimeAt(state.time.value, simulation.states.at(-1)?.time.value ?? 0) },
    { label: 'r', value: `(${formatNumber(position.x)}, ${formatNumber(position.y)}) m` },
    { label: '|v|', value: `${formatNumber(speed)} m/s` },
  ]
}

/* Re-exported for the workspace runtime's domain check. */
export { isCompositeFieldScene }
