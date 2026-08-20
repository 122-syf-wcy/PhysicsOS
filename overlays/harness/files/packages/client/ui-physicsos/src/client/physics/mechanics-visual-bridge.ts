import { detectMechanicsModel } from '@physicsos/engine-mechanics'
import {
  derivedVector,
  toCanonicalVector,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import type { MechanicsObservation } from '@physicsos/physics-observation'
import type { MechanicsModelId, PhysicsScene } from '@physicsos/physics-scene'

import {
  emptyVisualModel,
  type ObservableVisibility,
  type PhysicsSemanticRole,
  type ScenePoint,
  type SceneVisualModel,
  type VectorVisual,
} from './scene-visual-model.ts'

interface VectorValue {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface MechanicsVisualInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
  readonly observations: readonly unknown[]
  readonly stateIndex: number
  readonly state?: SimulationState
}

const MODEL_LABELS: Readonly<Record<MechanicsModelId, string>> = {
  uniform_linear_motion: '匀速直线运动',
  uniformly_accelerated_motion: '匀加速直线运动',
  projectile_motion: '抛体运动',
  newton_second_law: '牛顿第二定律',
  inclined_plane: '斜面运动',
}

const MECHANICS_OBSERVATION_TYPES: readonly MechanicsObservation['type'][] = [
  'position',
  'mechanics_velocity',
  'acceleration',
  'mechanics_force',
  'net_force',
  'mechanics_trajectory',
  'displacement',
  'projectile_key_point',
  'ground',
  'incline',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isMechanicsObservation = (value: unknown): value is MechanicsObservation =>
  isRecord(value) &&
  typeof value.type === 'string' &&
  MECHANICS_OBSERVATION_TYPES.some(type => type === value.type)

const findObservation = <TType extends MechanicsObservation['type']>(
  observations: readonly MechanicsObservation[],
  type: TType,
): Extract<MechanicsObservation, { type: TType }> | undefined =>
  observations.find(
    (observation): observation is Extract<MechanicsObservation, { type: TType }> =>
      observation.type === type,
  )

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

const vectorMagnitude = (value: VectorValue): number =>
  Math.hypot(value.x, value.y, value.z)

const formatNumber = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  return absolute !== 0 && (absolute < 1e-3 || absolute >= 1e4)
    ? value.toExponential(digits)
    : value.toFixed(digits)
}

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
  const padX = Math.max(rawWidth * 0.1, 0.75)
  const padY = Math.max(rawHeight * 0.14, 0.75)
  let width = rawWidth + padX * 2
  let height = rawHeight + padY * 2
  let originX = minX - padX
  let originY = minY - padY

  // A one-dimensional scene still needs a two-dimensional physical viewport.
  // Expand the shorter world axis instead of stretching SVG coordinates, so
  // equal scene lengths keep equal pixel lengths while bodies and vectors stay
  // large enough to inspect.
  if (width / height > VIEWPORT_ASPECT) {
    const nextHeight = width / VIEWPORT_ASPECT
    originY -= (nextHeight - height) / 2
    height = nextHeight
  } else {
    const nextWidth = height * VIEWPORT_ASPECT
    originX -= (nextWidth - width) / 2
    width = nextWidth
  }
  return {
    origin: { x: originX, y: originY },
    extent: { width, height },
  }
}

const displayVector = (
  id: string,
  role: PhysicsSemanticRole,
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

const derivedVectorOf = (
  state: SimulationState,
  key: string,
): QuantityVector | undefined => {
  try {
    return derivedVector(state.derived, key)
  } catch {
    return undefined
  }
}

const sceneVisibility = (
  scene: PhysicsScene,
  hasKeyPoints: boolean,
  hasNetForce: boolean,
): ObservableVisibility => ({
  velocity: scene.observableDefinitions.some(
    definition => definition.type === 'velocity' && definition.visible,
  ),
  acceleration: scene.observableDefinitions.some(
    definition => definition.type === 'acceleration' && definition.visible,
  ),
  trajectory: scene.observableDefinitions.some(
    definition => definition.type === 'trajectory' && definition.visible,
  ),
  keyPoints: hasKeyPoints,
  forces: hasNetForce,
  netForce: hasNetForce,
  components: false,
  decomposition: false,
})

export const mechanicsSceneVisualAt = ({
  scene,
  simulation,
  observations,
  stateIndex,
  state: exactState,
}: MechanicsVisualInput): SceneVisualModel => {
  const model = detectMechanicsModel(scene)
  const state = exactState ?? simulation.states[
    Math.min(Math.max(0, stateIndex), simulation.states.length - 1)
  ]
  const body = scene.bodies[0]
  const bodyState = body === undefined || state === undefined
    ? undefined
    : state.objects.find(object => object.id === body.id)
  const position = pointOf(bodyState?.position)
  if (
    model === null ||
    body === undefined ||
    state === undefined ||
    bodyState === undefined ||
    position === undefined
  ) {
    return emptyVisualModel('mechanics', {
      overlay: {
        readout: ['力学 Runtime 没有可显示的状态'],
        scale: { label: '1 m', length: 1 },
      },
    })
  }

  const mechanicsObservations = observations.filter(isMechanicsObservation)
  const trajectoryObservation = findObservation(mechanicsObservations, 'mechanics_trajectory')
  const keyPointObservation = findObservation(mechanicsObservations, 'projectile_key_point')
  const groundObservation = findObservation(mechanicsObservations, 'ground')
  const inclineObservation = findObservation(mechanicsObservations, 'incline')
  const trajectoryPoints = trajectoryObservation?.points.flatMap((point) => {
    const at = pointOf(point.position)
    return at === undefined ? [] : [at]
  }) ?? []
  const launchPoint = pointOf(keyPointObservation?.launchPoint)
  const apexPoint = pointOf(keyPointObservation?.apexPoint)
  const impactPoint = pointOf(keyPointObservation?.impactPoint)
  const initialPosition = pointOf(
    simulation.states[0]?.objects.find(object => object.id === body.id)?.position,
  ) ?? position

  const geometryPoints: ScenePoint[] = [position, initialPosition, ...trajectoryPoints]
  for (const point of [launchPoint, apexPoint, impactPoint]) {
    if (point !== undefined) geometryPoints.push(point)
  }

  const preliminary = boundsOf(geometryPoints)
  const inclineBase = Math.max(preliminary.extent.width, 6)
  const inclineAngle = inclineObservation?.angle ?? 30
  const inclineRise = inclineBase * Math.tan((inclineAngle * Math.PI) / 180)
  const inclineOrigin = {
    x: initialPosition.x,
    y: initialPosition.y - inclineRise,
  }
  if (model === 'inclined_plane') {
    geometryPoints.push(
      inclineOrigin,
      { x: inclineOrigin.x + inclineBase, y: inclineOrigin.y },
      initialPosition,
    )
  }
  if (groundObservation !== undefined) {
    geometryPoints.push(
      { x: preliminary.origin.x, y: groundObservation.groundY },
      {
        x: preliminary.origin.x + preliminary.extent.width,
        y: groundObservation.groundY,
      },
    )
  }

  const bounds = boundsOf(geometryPoints)
  const majorGrid = niceStep(Math.max(bounds.extent.width, bounds.extent.height))
  const arrowLength = Math.max(Math.min(bounds.extent.width, bounds.extent.height) * 0.16, 0.5)
  const netForce = derivedVectorOf(state, 'net_force')
  const vectors = [
    displayVector('velocity', 'velocity', 'velocity', position, bodyState.velocity, arrowLength, 'v'),
    displayVector(
      'acceleration',
      'acceleration',
      'acceleration',
      position,
      bodyState.acceleration,
      arrowLength * 0.9,
      'a',
    ),
    displayVector('net-force', 'net-force', 'netForce', position, netForce, arrowLength, 'F_net'),
  ].filter((vector): vector is VectorVisual => vector !== undefined)

  const keyPoints = [
    launchPoint === undefined
      ? undefined
      : { id: 'launch', kind: 'launch' as const, at: launchPoint, label: 'A' },
    apexPoint === undefined
      ? undefined
      : { id: 'apex', kind: 'apex' as const, at: apexPoint, label: 'H' },
    impactPoint === undefined
      ? undefined
      : { id: 'impact', kind: 'impact' as const, at: impactPoint, label: 'B' },
  ].filter((point): point is NonNullable<typeof point> => point !== undefined)

  const dimensions = []
  if (launchPoint !== undefined && groundObservation !== undefined) {
    dimensions.push({
      id: 'launch-height',
      from: { x: launchPoint.x, y: groundObservation.groundY },
      to: launchPoint,
      label: 'h',
      side: 'right' as const,
    })
  }
  if (launchPoint !== undefined && impactPoint !== undefined && groundObservation !== undefined) {
    dimensions.push({
      id: 'range',
      from: { x: launchPoint.x, y: groundObservation.groundY },
      to: { x: impactPoint.x, y: groundObservation.groundY },
      label: 'R',
      side: 'left' as const,
    })
  }

  const initialVelocity = canonicalVector(
    simulation.states[0]?.objects.find(object => object.id === body.id)?.velocity,
  )
  const launchAngle = initialVelocity === undefined
    ? 0
    : (Math.atan2(initialVelocity.y, initialVelocity.x) * 180) / Math.PI
  const angles = []
  if (model === 'projectile_motion' && launchPoint !== undefined && Math.abs(launchAngle) > 0.5) {
    angles.push({
      id: 'launch-angle',
      at: launchPoint,
      radius: Math.max(arrowLength * 0.55, 0.35),
      startAngle: 0,
      endAngle: launchAngle,
      symbol: '\\theta',
      value: `${formatNumber(launchAngle, 0)}°`,
    })
  }
  if (model === 'inclined_plane') {
    angles.push({
      id: 'incline-angle',
      at: { x: inclineOrigin.x + inclineBase, y: inclineOrigin.y },
      radius: Math.max(arrowLength * 0.55, 0.35),
      startAngle: 180 - inclineAngle,
      endAngle: 180,
      symbol: '\\theta',
      value: `${formatNumber(inclineAngle, 0)}°`,
    })
  }

  const velocity = canonicalVector(bodyState.velocity)
  const acceleration = canonicalVector(bodyState.acceleration)
  const bodySize = Math.max(Math.min(bounds.extent.width, bounds.extent.height) * 0.025, 0.16)

  return {
    domain: 'mechanics',
    extent: bounds.extent,
    origin: bounds.origin,
    grid: { minor: majorGrid / 5, major: majorGrid },
    axes: { x: 'x / m', y: 'y / m' },
    tickStep: majorGrid,
    bodies: [
      {
        id: body.id,
        kind: model === 'projectile_motion' ? 'ball' : 'block',
        at: position,
        size: bodySize,
        live: true,
        label: 'm',
        ...(model === 'inclined_plane' ? { rotation: inclineAngle } : {}),
      },
    ],
    particles: [],
    vectors,
    trajectories: trajectoryPoints.length === 0
      ? []
      : [{ id: 'trajectory', kind: 'history', points: trajectoryPoints }],
    keyPoints,
    angles,
    dimensions,
    labels: [],
    guides: [],
    ...(groundObservation === undefined
      ? {}
      : {
        ground: {
          y: groundObservation.groundY,
          from: bounds.origin.x,
          to: bounds.origin.x + bounds.extent.width,
          label: 'ground',
        },
      }),
    ...(model === 'inclined_plane'
      ? { incline: { origin: inclineOrigin, base: inclineBase, angle: inclineAngle } }
      : {}),
    ...(model === 'projectile_motion' && launchPoint !== undefined && groundObservation !== undefined
      ? {
        platform: {
          at: launchPoint,
          width: Math.max(bounds.extent.width * 0.1, 0.8),
          height: Math.max(launchPoint.y - groundObservation.groundY, 0.1),
        },
      }
      : {}),
    coordinate: {
      at: initialPosition,
      length: Math.max(arrowLength * 0.7, 0.45),
      xLabel: 'x',
      yLabel: 'y',
      ...(model === 'inclined_plane' ? { rotation: -inclineAngle } : {}),
    },
    overlay: {
      readout: [
        MODEL_LABELS[model],
        `t = ${formatNumber(state.time.value)} s`,
        `v = ${velocity === undefined ? '—' : formatNumber(vectorMagnitude(velocity))} m/s`,
        `a = ${acceleration === undefined ? '—' : formatNumber(vectorMagnitude(acceleration))} m/s²`,
      ],
      scale: { label: `${formatNumber(majorGrid)} m`, length: majorGrid },
    },
    visible: sceneVisibility(scene, keyPoints.length > 0, netForce !== undefined),
  }
}

export const mechanicsSampleReadout = (
  simulation: SimulationResult,
  bodyId: string,
  index: number,
): readonly { label: string; value: string }[] => {
  const state = simulation.states[index]
  const body = state?.objects.find(object => object.id === bodyId)
  const position = canonicalVector(body?.position)
  const velocity = canonicalVector(body?.velocity)
  if (state === undefined) return []
  return [
    { label: 't', value: `${formatNumber(state.time.value)} s` },
    {
      label: 'x, y',
      value: position === undefined
        ? '—'
        : `${formatNumber(position.x)}, ${formatNumber(position.y)} m`,
    },
    {
      label: 'v',
      value: velocity === undefined ? '—' : `${formatNumber(vectorMagnitude(velocity))} m/s`,
    },
  ]
}
