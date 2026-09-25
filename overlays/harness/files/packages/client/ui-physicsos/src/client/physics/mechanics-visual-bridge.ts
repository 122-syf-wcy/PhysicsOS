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
  type ApparatusSpriteVisual,
  type ObservableVisibility,
  type PhysicsSemanticRole,
  type ScenePoint,
  type SceneVisualModel,
  type VectorVisual,
} from './scene-visual-model.ts'
import { splitTrajectoryAtTime } from './bridge-helpers.ts'
import { formatSignificant } from './number-format.ts'

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
  spring_oscillator: '弹簧振子（简谐运动）',
  simple_pendulum: '单摆',
  horizontal_friction: '静摩擦与滑动摩擦',
  spring_statics: '胡克定律',
  circular_orbit: '万有引力与向心力',
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

/**
 * How each observed force is drawn. The Observation layer names the force; this
 * table only assigns the semantic colour role, the label and whether it reads as
 * subordinate — a decomposition component is a study aid, so it never competes
 * with the resultant it came from.
 */
const FORCE_STYLES: Record<
  string,
  {
    role: PhysicsSemanticRole
    observable: VectorVisual['observable']
    symbol: string
    subordinate?: boolean
  }
> = {
  gravity: { role: 'gravity', observable: 'forces', symbol: 'mg' },
  normal: { role: 'normal', observable: 'forces', symbol: 'N' },
  friction: { role: 'friction', observable: 'forces', symbol: 'f' },
  applied: { role: 'force', observable: 'forces', symbol: 'F' },
  gravity_parallel: {
    role: 'gravity',
    observable: 'decomposition',
    symbol: 'mg\\sin\\theta',
    subordinate: true,
  },
  gravity_normal: {
    role: 'gravity',
    observable: 'decomposition',
    symbol: 'mg\\cos\\theta',
    subordinate: true,
  },
  spring: { role: 'spring', observable: 'forces', symbol: 'F_{弹}' },
  tension: { role: 'tension', observable: 'forces', symbol: 'T' },
}

/** Component arrow from a plain scene-space delta, already display-scaled. */
const componentVector = (
  id: string,
  from: ScenePoint,
  delta: { x: number; y: number },
  length: number,
  symbol: string,
): VectorVisual | undefined => {
  const magnitude = Math.hypot(delta.x, delta.y)
  if (!Number.isFinite(magnitude) || magnitude === 0 || length <= 0) return undefined
  return {
    id,
    role: 'velocity-component',
    observable: 'components',
    from,
    to: { x: from.x + (delta.x / magnitude) * length, y: from.y + (delta.y / magnitude) * length },
    symbol,
    subordinate: true,
  }
}

const sceneVisibility = (
  scene: PhysicsScene,
  hasKeyPoints: boolean,
  hasForces: boolean,
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
  forces: hasForces,
  netForce: hasForces,
  components: scene.observableDefinitions.some(
    definition => definition.visible && definition.parameters?.['kind'] === 'velocity_components',
  ),
  decomposition: scene.observableDefinitions.some(
    definition => definition.visible && definition.parameters?.['kind'] === 'force_decomposition',
  ),
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
  /* The engine stamps each trail sample with its own time; the playhead split
     cuts against those times, not an invented fraction. */
  const trajectoryTimes = trajectoryObservation?.points
    .flatMap(point => (pointOf(point.position) === undefined ? [] : [point.time.value])) ?? []
  const launchPoint = pointOf(keyPointObservation?.launchPoint)
  const apexPoint = pointOf(keyPointObservation?.apexPoint)
  const impactPoint = pointOf(keyPointObservation?.impactPoint)
  const initialPosition = pointOf(
    simulation.states[0]?.objects.find(object => object.id === body.id)?.position,
  ) ?? position

  /* An inclined body slides for as long as the simulation window allows, so
     framing on its whole path would draw a hundred-metre wedge with a speck on it.
     The physically interesting object here is the SURFACE and the free-body
     diagram at the current instant, so the incline frames on those and lets the
     motion run through the frame instead. */
  const framesOnTrajectory = model !== 'inclined_plane'
  /* The camera frames the FULL simulation window for every non-incline model,
     taken from the engine states directly — not from the trajectory observable.
     The trail layer is a view toggle, and a student who turns it off must still
     never watch the body slide out of frame. */
  const pathPoints: ScenePoint[] = framesOnTrajectory
    ? simulation.states.flatMap((sampled) => {
      const at = pointOf(sampled.objects.find(object => object.id === body.id)?.position)
      return at === undefined ? [] : [at]
    })
    : []
  const geometryPoints: ScenePoint[] = framesOnTrajectory
    ? [position, initialPosition, ...pathPoints]
    : [position, initialPosition]
  if (framesOnTrajectory) {
    for (const point of [launchPoint, apexPoint, impactPoint]) {
      if (point !== undefined) geometryPoints.push(point)
    }
  }

  const preliminary = boundsOf(geometryPoints)
  /* A fixed wedge in scene metres: big enough to read the angle, small enough that
     the block stays a recognisable object. */
  const inclineBase = model === 'inclined_plane' ? 6 : Math.max(preliminary.extent.width, 6)
  const inclineAngle = inclineObservation?.angle ?? 30
  const inclineRise = inclineBase * Math.tan((inclineAngle * Math.PI) / 180)
  /* Place the WEDGE so the body lands part-way down the slope rather than exactly
     on the apex corner. The body keeps its scene position — only the drawn surface
     moves — so the free-body arrows still start at the real object. */
  const bodySlopeFraction = 0.42
  const inclineOrigin = {
    x: initialPosition.x - inclineBase * bodySlopeFraction,
    y: initialPosition.y - inclineRise * (1 - bodySlopeFraction),
  }
  if (model === 'inclined_plane') {
    /* The apex must be in bounds too, or the top of the wedge is cropped. */
    geometryPoints.push(
      inclineOrigin,
      { x: inclineOrigin.x + inclineBase, y: inclineOrigin.y },
      { x: inclineOrigin.x, y: inclineOrigin.y + inclineRise },
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

  /* Connector rigs: the spring's drawn length follows the body (stretch IS
     the physics), and the pendulum string runs pivot → bob each frame. The
     rest position (straight below the pivot) joins the framing so the arc
     never reads against an implied centre. */
  const springConstraint = scene.constraints.find(c => c.type === 'spring')
  const springAnchorParam = springConstraint?.parameters['anchor'] as
    | { x?: number; y?: number }
    | undefined
  const springAxis = springConstraint?.parameters['axis'] === 'vertical' ? 'vertical' : 'horizontal'
  const springNatural = Number(springConstraint?.parameters['naturalLength'] ?? 0)
  if (springConstraint !== undefined && springAnchorParam !== undefined) {
    geometryPoints.push({ x: springAnchorParam.x ?? 0, y: springAnchorParam.y ?? 0 })
  }
  const ropeConstraint = scene.constraints.find(c => c.type === 'rope')
  const pendulumPivotParam = ropeConstraint?.parameters['pivot'] as
    | { x?: number; y?: number }
    | undefined
  const pendulumLength = Number(ropeConstraint?.parameters['length'] ?? 0)
  if (ropeConstraint !== undefined && pendulumPivotParam !== undefined) {
    geometryPoints.push({
      x: pendulumPivotParam.x ?? 0,
      y: (pendulumPivotParam.y ?? 0) - (Number.isFinite(pendulumLength) ? pendulumLength : 0),
    })
  }

  const bounds = boundsOf(geometryPoints)
  const majorGrid = niceStep(Math.max(bounds.extent.width, bounds.extent.height))
  const arrowLength = Math.max(Math.min(bounds.extent.width, bounds.extent.height) * 0.19, 0.6)
  const netForce = derivedVectorOf(state, 'net_force')

  /* Individual forces come from the Observation layer, which owns each arrow's
     direction; the bridge only chooses the on-screen length. Scaling every force
     by the largest one keeps their relative sizes physically readable instead of
     normalising each to the same length. */
  const forceObservations = mechanicsObservations.filter(
    (observation): observation is Extract<MechanicsObservation, { type: 'mechanics_force' }> =>
      observation.type === 'mechanics_force',
  )
  const largestForce = forceObservations.reduce(
    (largest, observation) => Math.max(largest, observation.magnitude.value),
    0,
  )
  /* Two applied pulls both carry the label `applied`, so id and symbol are
     indexed: a composition experiment needs to tell F₁ from F₂, and duplicate
     element ids would also collide in the DOM. A single applied force keeps
     the plain F. */
  const appliedTotal = forceObservations.filter(o => o.label === 'applied').length
  let appliedIndex = 0
  const forceVectors = forceObservations.flatMap((observation) => {
    const style = FORCE_STYLES[observation.label]
    if (style === undefined) return []
    const isIndexedApplied = observation.label === 'applied' && appliedTotal > 1
    const idSuffix = isIndexedApplied ? `-${appliedIndex}` : ''
    const symbol = isIndexedApplied ? `F_${appliedIndex + 1}` : style.symbol
    if (observation.label === 'applied') appliedIndex += 1
    const share = largestForce === 0 ? 1 : observation.magnitude.value / largestForce
    const vector = displayVector(
      `force-${observation.label}${idSuffix}`,
      style.role,
      style.observable,
      position,
      observation.vector,
      arrowLength * (0.45 + 0.55 * share),
      symbol,
    )
    if (vector === undefined) return []
    return [style.subordinate === true ? { ...vector, subordinate: true } : vector]
  })

  /* Velocity components, drawn only when the scene asks for them. Each is scaled
     by its own share of the speed so vₓ and v_y visibly compose into v. */
  const componentsVisible = scene.observableDefinitions.some(
    definition => definition.visible && definition.parameters?.['kind'] === 'velocity_components',
  )
  const velocityValue = canonicalVector(bodyState.velocity)
  const speed = velocityValue === undefined ? 0 : vectorMagnitude(velocityValue)
  const componentVectors =
    !componentsVisible || velocityValue === undefined || speed === 0
      ? []
      : [
        componentVector('velocity-x', position, { x: velocityValue.x, y: 0 }, arrowLength * (Math.abs(velocityValue.x) / speed), 'v_x'),
        componentVector('velocity-y', position, { x: 0, y: velocityValue.y }, arrowLength * (Math.abs(velocityValue.y) / speed), 'v_y'),
      ].filter((vector): vector is VectorVisual => vector !== undefined)

  /* ΣF earns its own arrow only when it says something the individual forces do
     not. On a projectile the single force IS the resultant, so drawing both would
     stack two identical arrows and imply two separate physical facts. */
  const netForceValue = canonicalVector(netForce)
  const soleForce = forceObservations.length === 1
    ? canonicalVector(forceObservations[0]?.vector)
    : undefined
  const netForceIsRedundant =
    netForceValue !== undefined &&
    soleForce !== undefined &&
    Math.hypot(netForceValue.x - soleForce.x, netForceValue.y - soleForce.y) <
      Math.max(vectorMagnitude(netForceValue), 1e-9) * 0.02

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
    ...(netForceIsRedundant
      ? []
      : [displayVector('net-force', 'net-force', 'netForce', position, netForce, arrowLength, 'F_net')]),
  ]
    .filter((vector): vector is VectorVisual => vector !== undefined)
    .concat(forceVectors, componentVectors)

  /* An apex that coincides with the launch point is the horizontal-throw case:
     the highest point IS the start, so a second marker would only add clutter. */
  const apexDistinct =
    apexPoint !== undefined &&
    launchPoint !== undefined &&
    Math.hypot(apexPoint.x - launchPoint.x, apexPoint.y - launchPoint.y) >
      Math.max(bounds.extent.width, bounds.extent.height) * 0.02

  const keyPointReadout = (at: ScenePoint, time: number | undefined) => {
    const rows: { label: string; value: string }[] = []
    if (time !== undefined) rows.push({ label: 't', value: `${formatNumber(time)} s` })
    rows.push({ label: 'x', value: `${formatNumber(at.x)} m` })
    rows.push({ label: 'y', value: `${formatNumber(at.y)} m` })
    return rows
  }

  const keyPoints = [
    launchPoint === undefined
      ? undefined
      : {
        id: 'launch',
        kind: 'launch' as const,
        at: launchPoint,
        label: '起点',
        readout: keyPointReadout(launchPoint, 0),
      },
    /* `apexDistinct` already proves apexPoint defined; TS narrows through it. */
    !apexDistinct
      ? undefined
      : {
        id: 'apex',
        kind: 'apex' as const,
        at: apexPoint,
        label: '最高点',
        readout: [
          ...keyPointReadout(apexPoint, undefined),
          ...(keyPointObservation === undefined
            ? []
            : [{ label: 'H', value: `${formatNumber(keyPointObservation.maxHeight.value)} m` }]),
        ],
      },
    impactPoint === undefined
      ? undefined
      : {
        id: 'impact',
        kind: 'impact' as const,
        at: impactPoint,
        label: '落地点',
        readout: [
          ...keyPointReadout(impactPoint, keyPointObservation?.flightTime.value),
          ...(keyPointObservation === undefined
            ? []
            : [{ label: 'R', value: `${formatNumber(keyPointObservation.range.value)} m` }]),
        ],
      },
  ].filter((point): point is NonNullable<typeof point> => point !== undefined)

  const dimensions = []
  /* A rule shorter than the platform threshold has nothing to measure — a
     ground launch skips the h dimension instead of drawing a zero-length stub. */
  if (
    launchPoint !== undefined &&
    groundObservation !== undefined &&
    launchPoint.y - groundObservation.groundY > bounds.extent.height * 0.04
  ) {
    /* Offset the height rule into the left gutter so it never overlaps the launch
       platform or the first stretch of the trajectory. */
    const gutterX = bounds.origin.x + bounds.extent.width * 0.06
    dimensions.push({
      id: 'launch-height',
      from: { x: gutterX, y: groundObservation.groundY },
      to: { x: gutterX, y: launchPoint.y },
      label: `h = ${formatNumber(launchPoint.y - groundObservation.groundY)} m`,
      side: 'right' as const,
    })
  }
  if (launchPoint !== undefined && impactPoint !== undefined && groundObservation !== undefined) {
    dimensions.push({
      id: 'range',
      from: { x: launchPoint.x, y: groundObservation.groundY - bounds.extent.height * 0.06 },
      to: { x: impactPoint.x, y: groundObservation.groundY - bounds.extent.height * 0.06 },
      label: `R = ${formatNumber(impactPoint.x - launchPoint.x)} m`,
      side: 'left' as const,
    })
  }

  const initialVelocity = canonicalVector(
    simulation.states[0]?.objects.find(object => object.id === body.id)?.velocity,
  )
  const initialAcceleration = canonicalVector(
    simulation.states[0]?.objects.find(object => object.id === body.id)?.acceleration,
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
  /* The body keeps a visible presence: at a 0.025 factor a block on a 1-D run
     of 40 m rendered ~14 px in a 960 px canvas — the scene read as an empty
     grid with a dot. The floor covers short-window scenes (incline wedges). */
  const bodySize = Math.max(Math.min(bounds.extent.width, bounds.extent.height) * 0.045, 0.28)

  /* A horizontal 1-D run happens on a surface even when the scene never
     declared one: the cart's wheels have to sit on something, and the
     observation layer already balances mg with N there. The track top sits one
     wheel-diameter below the body's centre of mass. Vertical motion (an
     elevator) and diagonal motion (a free body under combined forces) get no
     track — drawing rails under either would put them in mid-air — and the
     body renders as a block rather than a wheeled cart. */
  const isHorizontalLinear =
    (model === 'uniform_linear_motion' ||
      model === 'uniformly_accelerated_motion' ||
      model === 'newton_second_law' ||
      model === 'horizontal_friction' ||
      model === 'spring_oscillator') &&
    Math.abs(initialVelocity?.y ?? 0) < 1e-9 &&
    Math.abs(initialAcceleration?.y ?? 0) < 1e-9
  /* A friction-surface scene declares its level surface explicitly; other
     horizontal 1-D runs get the implied track under the body's wheels. */
  const frictionSurface = scene.observableDefinitions.find(
    definition => definition.parameters?.['kind'] === 'friction_surface',
  )
  const frictionSurfaceY =
    frictionSurface !== undefined && typeof frictionSurface.parameters?.['surfaceY'] === 'number'
      ? frictionSurface.parameters['surfaceY']
      : undefined
  const trackGround =
    isHorizontalLinear && groundObservation === undefined
      ? {
        y: frictionSurfaceY ?? initialPosition.y - bodySize * 1.0,
        from: bounds.origin.x,
        to: bounds.origin.x + bounds.extent.width,
        label: model === 'horizontal_friction' ? '水平面' : '水平轨道',
      }
      : undefined

  /* Ticker-tape marks: sample the simulated states at equal time intervals so
     mark spacing itself shows the physics — equal spacing is constant velocity,
     growing spacing is acceleration. ~9 marks read clearly without clutter. */
  const sampledStates = simulation.states
  const markCount = Math.min(9, sampledStates.length)
  const motionMarks = markCount === 0
    ? []
    : Array.from({ length: markCount }, (_, index) => {
      const sample = sampledStates[Math.round((index * (sampledStates.length - 1)) / (markCount - 1))]
      const at = sample === undefined
        ? undefined
        : pointOf(sample.objects.find(object => object.id === body.id)?.position)
      if (at === undefined || sample === undefined) return undefined
      /* The first and last marks sit inside the launch/impact clusters, whose
         keypoint readouts already state those times — labelling the marks
         again would just add ink on top of ink. */
      return index !== 0 && index !== markCount - 1 && index % 2 === 0
        ? { id: `mark-${index}`, at, label: `t=${formatNumber(sample.time.value)}` }
        : { id: `mark-${index}`, at }
    }).filter((mark): mark is NonNullable<typeof mark> => mark !== undefined)

  /* Photographed rig apparatus: the clamp a coil/string hangs from and the
     spring scale that pulls a friction block. Sprites anchor by their
     catalogued point and track it every frame. */
  const apparatus: ApparatusSpriteVisual[] = []
  if (springConstraint !== undefined && springAnchorParam !== undefined && springAxis === 'vertical') {
    apparatus.push({
      id: `${springConstraint.id}-mount`,
      part: 'support-clamp',
      at: { x: springAnchorParam.x ?? 0, y: springAnchorParam.y ?? 0 },
      size: 0.55,
    })
  }
  if (ropeConstraint !== undefined && pendulumPivotParam !== undefined) {
    apparatus.push({
      id: `${ropeConstraint.id}-mount`,
      part: 'support-clamp',
      at: { x: pendulumPivotParam.x ?? 0, y: pendulumPivotParam.y ?? 0 },
      size: 0.55,
    })
    /* The protractor hangs directly behind the pivot — the release angle is
       read off its arc, exactly as on the bench rig. */
    apparatus.push({
      id: 'pivot-protractor',
      part: 'protractor',
      at: { x: pendulumPivotParam.x ?? 0, y: pendulumPivotParam.y ?? 0 },
      size: 0.95,
    })
  }
  if (model === 'spring_statics' && springAnchorParam !== undefined) {
    /* The extension ruler mounts beside the spring at anchor height — the
       Δx protocol reads the coil's lower end against it. */
    apparatus.push({
      id: 'extension-ruler',
      part: 'ruler-vertical',
      at: { x: (springAnchorParam.x ?? 0) + 0.85, y: springAnchorParam.y ?? 0 },
      size: 2.6,
    })
  }
  if (trackGround !== undefined) {
    /* Every horizontal 1-D run gets a real rail under the body: the sprite's
       top edge is the surface line, stretched across the tracked span. */
    apparatus.push({
      id: 'track-rail',
      part: 'track-rail',
      at: { x: (trackGround.from + trackGround.to) / 2, y: trackGround.y },
      size: 0.32,
      width: trackGround.to - trackGround.from,
    })
  }
  if (model === 'horizontal_friction') {
    /* The dynamometer sits ahead of the block on the pull side, its hook
       pinned to the block face — the pull direction is +x for every friction
       template, so the sprite flips to put the hook on the block side. */
    apparatus.push({
      id: 'puller-scale',
      part: 'spring-scale',
      at: { x: position.x + bodySize, y: position.y },
      size: 0.45,
      flip: true,
    })
  }

  return {
    domain: 'mechanics',
    extent: bounds.extent,
    origin: bounds.origin,
    grid: { minor: majorGrid / 5, major: majorGrid },
    axes: { x: 'x / m', y: 'y / m' },
    tickStep: majorGrid,
    /* A launch on or near the y-axis puts the 起点 label in the tick-label
       column — blank the ticks on that row instead of shoving the label away
       from its point. Tick marks stay; only the numbers drop. */
    ...(launchPoint !== undefined && Math.abs(launchPoint.x) < majorGrid * 0.45
      ? {
        tickLabelAvoid: {
          y: [launchPoint.y - majorGrid * 0.2, launchPoint.y + majorGrid * 0.6],
        },
      }
      : {}),
    bodies: [
      {
        id: body.id,
        kind:
          model === 'projectile_motion' || model === 'simple_pendulum'
            ? 'ball'
            : model === 'spring_statics'
              /* The textbook rig hangs a hooked weight from the spring. */
              ? 'weight-hook'
              : model === 'horizontal_friction'
                ? 'block'
                : isHorizontalLinear
                  ? 'cart'
                  : 'block',
        at: position,
        size: bodySize,
        live: true,
        label: 'm',
        ...(model === 'inclined_plane' ? { rotation: inclineAngle } : {}),
      },
    ],
    particles: [],
    vectors,
    trajectories: splitTrajectoryAtTime(
      'trajectory',
      trajectoryPoints,
      trajectoryTimes,
      state.time.value,
    ),
    keyPoints,
    angles,
    dimensions,
    labels: [],
    guides: [],
    motionMarks,
    ...(groundObservation === undefined
      ? trackGround === undefined
        ? {}
        : { ground: trackGround }
      : {
        ground: {
          y: groundObservation.groundY,
          from: bounds.origin.x,
          to: bounds.origin.x + bounds.extent.width,
          label: '地面',
        },
      }),
    ...(model === 'inclined_plane'
      ? { incline: { origin: inclineOrigin, base: inclineBase, angle: inclineAngle } }
      : {}),
    ...(springConstraint === undefined || springAnchorParam === undefined
      ? {}
      : {
        spring: {
          id: springConstraint.id,
          anchor: { x: springAnchorParam.x ?? 0, y: springAnchorParam.y ?? 0 },
          /* The coil ends at the body's near face, so the drawn length tracks
             the true extension every frame. */
          end:
            springAxis === 'vertical'
              ? { x: position.x, y: position.y + bodySize }
              : { x: position.x - Math.sign(position.x - (springAnchorParam.x ?? 0)) * bodySize, y: position.y },
          naturalLength: Number.isFinite(springNatural) ? springNatural : 0,
          axis: springAxis,
          /* The relaxed-end position: where the coil tip rests with zero
             stretch, so a stretched/compressed coil has a reference. */
          equilibrium:
            springAxis === 'vertical'
              ? (springAnchorParam.y ?? 0) - (Number.isFinite(springNatural) ? springNatural : 0)
              : (springAnchorParam.x ?? 0) + (Number.isFinite(springNatural) ? springNatural : 0),
        },
      }),
    ...(ropeConstraint === undefined || pendulumPivotParam === undefined
      ? {}
      : {
        pendulum: {
          id: ropeConstraint.id,
          pivot: { x: pendulumPivotParam.x ?? 0, y: pendulumPivotParam.y ?? 0 },
          bob: position,
          length: Number.isFinite(pendulumLength) ? pendulumLength : 0,
        },
      }),
    ...(apparatus.length === 0 ? {} : { apparatus }),
    /* A launch platform is a short slab at launch height, not a column down to the
       ground: the drop is already stated by the `h` dimension, and a full-height
       block would cut the scene in half. */
    ...(model === 'projectile_motion' &&
      launchPoint !== undefined &&
      groundObservation !== undefined &&
      launchPoint.y - groundObservation.groundY > bounds.extent.height * 0.04
      ? {
        platform: {
          at: launchPoint,
          width: Math.max(bounds.extent.width * 0.08, 0.6),
          height: Math.max(bounds.extent.height * 0.035, 0.25),
        },
      }
      : {}),
    /* The rotated basis explains which way "along the slope" points, so it earns
       its space on an incline; on a projectile the global axes already say it. */
    ...(model === 'inclined_plane'
      ? {
        coordinate: {
          at: {
            x: position.x + Math.max(arrowLength, 0.6) * 1.6,
            y: position.y + Math.max(arrowLength, 0.6) * 1.6,
          },
          length: Math.max(arrowLength * 0.7, 0.45),
          xLabel: 'x',
          yLabel: 'y',
          rotation: -inclineAngle,
        },
      }
      : {}),
    overlay: {
      readout: [
        MODEL_LABELS[model],
        `t = ${formatNumber(state.time.value)} s`,
        `v = ${velocity === undefined ? '—' : formatNumber(vectorMagnitude(velocity))} m/s`,
        `a = ${acceleration === undefined ? '—' : formatNumber(vectorMagnitude(acceleration))} m/s²`,
      ],
      scale: { label: `${formatNumber(majorGrid)} m`, length: majorGrid },
    },
    visible: sceneVisibility(
      scene,
      keyPoints.length > 0,
      forceVectors.length > 0 || netForce !== undefined,
    ),
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
