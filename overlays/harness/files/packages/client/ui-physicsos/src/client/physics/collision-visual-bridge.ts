/**
 * Collision scene → SceneVisualModel bridge.
 *
 * Renders every collision body as a ball at its live position, one history
 * trajectory per body, momentum arrows scaled against the largest momentum in
 * the frame, the reflective boundary as four guide lines, and a readout that
 * carries the model name, total momentum and total kinetic energy. Like every
 * bridge, it only projects engine facts — the canvas never computes a physical
 * value.
 */

import { detectCollisionModel, COLLISION_MODEL_LABELS } from '@physicsos/engine-collision'
import {
  toCanonicalVector,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'
import type { PhysicsScene } from '@physicsos/physics-scene'

import {
  emptyVisualModel,
  type ObservableVisibility,
  type ScenePoint,
  type SceneVisualModel,
  type VectorVisual,
} from './scene-visual-model.ts'
import { formatSignificant } from './number-format.ts'

export interface CollisionVisualInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly observations: readonly unknown[]
  readonly stateIndex: number
  readonly state?: SimulationState
}

interface VectorValue {
  readonly x: number
  readonly y: number
  readonly z: number
}

const canonicalVector = (value: QuantityVector | undefined): VectorValue | undefined => {
  if (value === undefined) return undefined
  try {
    return toCanonicalVector(value).vectorSI
  } catch {
    return undefined
  }
}

const pointOf = (value: QuantityVector | undefined): ScenePoint | undefined => {
  const vector = canonicalVector(value)
  return vector === undefined ? undefined : { x: vector.x, y: vector.y }
}

const vectorMagnitude = (value: VectorValue): number => Math.hypot(value.x, value.y, value.z)

const formatNumber = formatSignificant

const niceStep = (span: number): number => {
  const rough = Math.max(span / 6, 1e-6)
  const power = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / power
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * power
}

const VIEWPORT_ASPECT = 16 / 9

const boundsOf = (points: readonly ScenePoint[]) => {
  const source = points.length === 0 ? [{ x: 0, y: 0 }] : points
  let minX = source[0]?.x ?? 0
  let maxX = minX
  let minY = source[0]?.y ?? 0
  let maxY = minY
  for (const point of source) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  const rawWidth = Math.max(maxX - minX, 1)
  const rawHeight = Math.max(maxY - minY, 1)
  const padX = Math.max(rawWidth * 0.12, 0.75)
  const padY = Math.max(rawHeight * 0.14, 0.75)
  let width = rawWidth + padX * 2
  let height = rawHeight + padY * 2
  let originX = minX - padX
  let originY = minY - padY
  if (width / height > VIEWPORT_ASPECT) {
    const nextHeight = width / VIEWPORT_ASPECT
    originY -= (nextHeight - height) / 2
    height = nextHeight
  } else {
    const nextWidth = height * VIEWPORT_ASPECT
    originX -= (nextWidth - width) / 2
    width = nextWidth
  }
  return { origin: { x: originX, y: originY }, extent: { width, height } }
}

const displayVector = (
  id: string,
  role: VectorVisual['role'],
  observable: VectorVisual['observable'],
  from: ScenePoint,
  value: QuantityVector | undefined,
  length: number,
  symbol: string,
): VectorVisual | undefined => {
  const vector = canonicalVector(value)
  if (vector === undefined) return undefined
  const magnitude = vectorMagnitude(vector)
  if (!Number.isFinite(magnitude) || magnitude === 0) return undefined
  return {
    id,
    role,
    observable,
    from,
    to: {
      x: from.x + (vector.x / magnitude) * length,
      y: from.y + (vector.y / magnitude) * length,
    },
    symbol,
  }
}

const sceneVisibility = (scene: PhysicsScene): ObservableVisibility => ({
  velocity: scene.observableDefinitions.some(
    definition => definition.type === 'velocity' && definition.visible,
  ),
  trajectory: scene.observableDefinitions.some(
    definition => definition.type === 'trajectory' && definition.visible,
  ),
  /* Momentum arrows ride the 'netForce' visibility key — that is what
     collision's observable tree toggles for the scene's `momentum`
     definition — and energy on 'forces'. The reflective boundary is a real
     solver feature (collision-solver bounces at these walls), so its guides
     are on whenever the scene has boundaries. */
  netForce: scene.observableDefinitions.some(
    definition => definition.type === 'momentum' && definition.visible,
  ),
  forces: scene.observableDefinitions.some(
    definition => definition.type === 'energy' && definition.visible,
  ),
  guides: scene.boundaries.length > 0,
})

const derivedVectorOf = (state: SimulationState, key: string, targetId?: string): QuantityVector | undefined => {
  const entry = state.derived.find(
    item => item.key === key && (targetId === undefined || item.targetId === targetId),
  )
  if (entry === undefined) return undefined
  return 'vector' in entry.value ? entry.value : undefined
}

const derivedScalarOf = (state: SimulationState, key: string): number | undefined => {
  const entry = state.derived.find(item => item.key === key)
  if (entry === undefined) return undefined
  if ('value' in entry.value && typeof entry.value.value === 'number') return entry.value.value
  return undefined
}

/**
 * The decimated state-index list every collision trail is sampled at. The
 * runtime builds `trajectoryTimes` from the SAME list, so the canvas's
 * hover / seek / strobe pairing (trajectoryTimes.length === points.length)
 * holds instead of silently disabling itself.
 */
export const collisionSampleIndices = (count: number): readonly number[] => {
  if (count <= 0) return []
  if (count <= 1) return [0]
  const renderPoints = Math.max(24, Math.min(120, count))
  const stride = Math.max(1, Math.floor(count / renderPoints))
  const indices: number[] = []
  for (let i = 0; i < count; i += stride) indices.push(i)
  if (indices[indices.length - 1] !== count - 1) indices.push(count - 1)
  return indices
}

export const collisionSceneVisualAt = ({
  scene,
  simulation,
  observations: _observations,
  stateIndex,
  state: exactState,
}: CollisionVisualInput): SceneVisualModel => {
  const model = detectCollisionModel(scene)
  const state = exactState ?? simulation.states[
    Math.min(Math.max(0, stateIndex), simulation.states.length - 1)
  ]
  if (model === null || state === undefined) {
    return emptyVisualModel('mechanics', {
      overlay: {
        readout: ['碰撞 Runtime 没有可显示的状态'],
        scale: { label: '1 m', length: 1 },
      },
    })
  }

  /* Every body's live position. */
  const bodyStates = scene.bodies.map(body => ({
    body,
    at: pointOf(state.objects.find(object => object.id === body.id)?.position),
  })).filter((entry): entry is { body: (typeof scene.bodies)[number]; at: ScenePoint } =>
    entry.at !== undefined)

  /* History trajectories, decimated to the render budget. Equal-time samples
     (the states stream is equally spaced), at the shared index list. */
  const sampleIndices = collisionSampleIndices(simulation.states.length)
  const trajectories = scene.bodies.flatMap((body) => {
    const points: ScenePoint[] = []
    for (const i of sampleIndices) {
      const at = pointOf(
        simulation.states[i]?.objects.find(object => object.id === body.id)?.position,
      )
      if (at !== undefined) points.push(at)
    }
    return points.length < 2 ? [] : [{ id: `trajectory-${body.id}`, kind: 'history' as const, points }]
  })

  /* Momentum arrows: each body's p scaled against the largest |p| in the frame. */
  const momenta = scene.bodies.map(body => ({
    body,
    value: derivedVectorOf(state, 'momentum', body.id),
  }))
  const largestP = momenta.reduce(
    (largest, entry) => Math.max(largest, vectorMagnitude(canonicalVector(entry.value) ?? { x: 0, y: 0, z: 0 })),
    0,
  )
  const geometryPoints: ScenePoint[] = bodyStates.map(entry => entry.at)
  const span = geometryPoints.length === 0
    ? 3
    : Math.max(
      Math.max(...geometryPoints.map(p => Math.abs(p.x)), 1),
      Math.max(...geometryPoints.map(p => Math.abs(p.y)), 1),
    )
  const arrowLength = Math.max(span * 0.16, 0.5)

  const vectors: VectorVisual[] = []
  for (const { body, value } of momenta) {
    const at = bodyStates.find(entry => entry.body.id === body.id)?.at
    if (at === undefined || value === undefined || largestP === 0) continue
    const share = vectorMagnitude(canonicalVector(value) ?? { x: 0, y: 0, z: 0 }) / largestP
    const vector = displayVector(
      `momentum-${body.id}`,
      'net-force',
      'netForce',
      at,
      value,
      arrowLength * (0.5 + 0.5 * share),
      'p',
    )
    if (vector !== undefined) vectors.push(vector)
  }

  /* The reflective boundary, if present, becomes four guide lines. */
  const guides = scene.boundaries.flatMap((boundary) => {
    if (boundary.type !== 'rectangle' || boundary.geometry.type !== 'rectangle') return []
    const width = canonicalValue(boundary.geometry.width)
    const height = canonicalValue(boundary.geometry.height)
    const halfW = width / 2
    const halfH = height / 2
    return [
      { id: `${boundary.id}-top`, observable: 'guides' as const, from: { x: -halfW, y: halfH }, to: { x: halfW, y: halfH } },
      { id: `${boundary.id}-bottom`, observable: 'guides' as const, from: { x: -halfW, y: -halfH }, to: { x: halfW, y: -halfH } },
      { id: `${boundary.id}-left`, observable: 'guides' as const, from: { x: -halfW, y: -halfH }, to: { x: -halfW, y: halfH } },
      { id: `${boundary.id}-right`, observable: 'guides' as const, from: { x: halfW, y: -halfH }, to: { x: halfW, y: halfH } },
    ]
  })

  const bounds = boundsOf([...geometryPoints, ...guides.map(g => g.from), ...guides.map(g => g.to)])
  const majorGrid = niceStep(Math.max(bounds.extent.width, bounds.extent.height))
  const bodySize = Math.max(Math.min(bounds.extent.width, bounds.extent.height) * 0.028, 0.2)

  /* The collision bench is an air track: the balls ride on a surface at their
     lowest point, so the scene stops floating on the x-axis. The boundary
     walls stay as guides — they are the end stops the solver bounces on. */
  const trackY = bodyStates.reduce((lowest, entry) => {
    const radius = entry.body.shape.type === 'circle' ? canonicalValue(entry.body.shape.radius) : 0.5
    return Math.min(lowest, entry.at.y - Math.max(radius, bodySize))
  }, 0)
  const ground = bodyStates.length === 0
    ? undefined
    : { y: trackY, from: bounds.origin.x, to: bounds.origin.x + bounds.extent.width, label: '气垫导轨' }

  const totalMomentum = derivedVectorOf(state, 'total_momentum')
  const totalEnergy = derivedScalarOf(state, 'total_kinetic_energy')
  const velocityVectors = bodyStates.flatMap(({ body, at }) => {
    const bodyState = state.objects.find(object => object.id === body.id)
    /* v arrows carry the velocity role and layer, so the tree's 速度 toggle —
       which maps to this same observable — actually shows and hides them. */
    return [displayVector(`velocity-${body.id}`, 'velocity', 'velocity', at, bodyState?.velocity, arrowLength * 0.8, 'v')]
      .filter((vector): vector is VectorVisual => vector !== undefined)
  })

  return {
    domain: 'mechanics',
    extent: bounds.extent,
    origin: bounds.origin,
    grid: { minor: majorGrid / 5, major: majorGrid },
    axes: { x: 'x / m', y: 'y / m' },
    tickStep: majorGrid,
    bodies: bodyStates.map(({ body }, index) => ({
      id: body.id,
      kind: 'ball',
      at: bodyStates.find(entry => entry.body.id === body.id)?.at ?? { x: 0, y: 0 },
      /* The world radius, so contact rings fire exactly where the solver says
         the spheres touch (collision-solver judges |AB| = rA + rB). The old
         scaled-down draw made every impact look like it happened at a gap.
         The floor only covers bodies with a degenerate radius. */
      size: Math.max(
        bodySize,
        body.shape.type === 'circle' ? canonicalValue(body.shape.radius) : 0.5,
      ),
      live: true,
      label: `m${index + 1}`,
    })),
    particles: [],
    vectors: [...velocityVectors, ...vectors],
    trajectories,
    keyPoints: [],
    angles: [],
    dimensions: [],
    labels: [],
    guides,
    ...(ground === undefined ? {} : { ground }),
    overlay: {
      readout: [
        COLLISION_MODEL_LABELS[model],
        `t = ${formatNumber(state.time.value)} s`,
        `Σp = ${totalMomentum === undefined ? '—' : `${formatNumber(vectorMagnitude(canonicalVector(totalMomentum) ?? { x: 0, y: 0, z: 0 }))} kg·m/s`}`,
        `ΣK = ${totalEnergy === undefined ? '—' : `${formatNumber(totalEnergy)} J`}`,
      ],
      scale: { label: `${formatNumber(majorGrid)} m`, length: majorGrid },
    },
    visible: sceneVisibility(scene),
  }
}
