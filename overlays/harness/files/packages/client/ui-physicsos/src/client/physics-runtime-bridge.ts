import { createMagneticSimulationRequest, MagneticEngine } from '@physicsos/engine-magnetic'
import {
  createMagneticScene,
  createSceneCommand,
  SceneRuntime,
  type MagneticObservableKey,
  type MagneticSceneInput,
  type PhysicsEvent,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandResult,
} from '@physicsos/physics-scene'
import {
  observeMagneticScene,
  type MagneticObservation,
  type ObservationRuntimeState,
} from '@physicsos/physics-observation'
import { verifyMagneticScene } from '@physicsos/physics-verifier'

import {
  MAGNETIC_OBSERVABLE_LABELS,
  MAGNETIC_SCENE_SUBTITLE,
  MAGNETIC_SCENE_TITLE,
} from './prototype/magnetic-scene.ts'
import type {
  LabCanvasViewModel,
  LabClock,
  LabFieldDirection,
  LabGuideView,
  LabObservableId,
  LabParameter,
  LabPoint,
  LabSeries,
  LabSample,
  LabTrajectoryView,
  LabTreeNode,
  LabVectorView,
} from './lab-view-model.ts'
import type { SceneVisualModel } from './physics/scene-visual-model.ts'

type MagneticSimulation = ReturnType<MagneticEngine['simulate']>
type MagneticState = ReturnType<MagneticEngine['stateAtSeconds']>
type MagneticVerification = ReturnType<typeof verifyMagneticScene>

export type MagneticRuntimeStatus = 'verified' | 'warning' | 'failed'

export interface MagneticRuntimeError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly details: Readonly<Record<string, unknown>>
}

export interface MagneticRuntimeSnapshot {
  readonly scene: PhysicsScene
  readonly sceneRevision: number
  readonly simulation: MagneticSimulation | null
  readonly verification: MagneticVerification | null
  readonly status: MagneticRuntimeStatus
  readonly observations: ObservationRuntimeState
  readonly view: LabCanvasViewModel
  readonly visual: SceneVisualModel
  readonly tree: readonly LabTreeNode[]
  readonly particleParameters: readonly LabParameter[]
  readonly fieldParameters: readonly LabParameter[]
  readonly derived: { readonly items: readonly LabDerivedView[] }
  readonly data: { readonly series: readonly LabSeries[]; readonly samples: readonly LabSample[] }
  readonly clock: LabClock
  readonly events: readonly PhysicsEvent[]
  readonly error?: MagneticRuntimeError
}

export interface LabDerivedView {
  readonly id: string
  readonly label: string
  readonly symbol: string
  readonly value: string
  readonly unit: string
}

export interface MagneticRuntimeCommandOutcome {
  readonly result: SceneCommandResult
  readonly snapshot: MagneticRuntimeSnapshot
}

const VIEWPORT = {
  width: 24,
  height: 13.5,
  minorGrid: 1,
  majorGrid: 5,
  fieldSpacing: 3,
  velocityArrow: 2.6,
  forceArrow: 1.9,
} as const

const OBSERVABLE_KEYS: readonly LabObservableId[] = [
  'velocity',
  'force',
  'trajectory',
  'center',
  'radius',
  'guides',
]

const emptyVisibility = (): Record<LabObservableId, boolean> => ({
  velocity: false,
  force: false,
  trajectory: false,
  center: false,
  radius: false,
  guides: false,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPhysicsScene = (value: MagneticSceneInput | PhysicsScene): value is PhysicsScene =>
  isRecord(value) && value.schemaVersion === 'physics-scene/1.0' && Array.isArray(value.particles)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const runtimeErrorOf = (error: unknown): MagneticRuntimeError => {
  if (isRecord(error) && isRecord(error.domainError)) {
    const domainError = error.domainError
    return {
      code: typeof domainError.code === 'string' ? domainError.code : 'MAGNETIC_RUNTIME_FAILED',
      message:
        typeof domainError.message === 'string'
          ? domainError.message
          : 'Magnetic runtime failed.',
      retryable: domainError.retryable === true,
      details: isRecord(domainError.details) ? domainError.details : {},
    }
  }
  if (isRecord(error)) {
    return {
      code: typeof error.code === 'string' ? error.code : 'MAGNETIC_RUNTIME_FAILED',
      message: typeof error.message === 'string' ? error.message : 'Magnetic runtime failed.',
      retryable: error.retryable === true,
      details: isRecord(error.details) ? error.details : {},
    }
  }
  return {
    code: 'MAGNETIC_RUNTIME_FAILED',
    message: 'Magnetic runtime failed.',
    retryable: false,
    details: {},
  }
}

interface ScalarFact {
  readonly value: number
  readonly unit: string
  readonly dimension: string
}

interface VectorFact {
  readonly vector: { readonly x: number; readonly y: number; readonly z: number }
  readonly unit: string
  readonly dimension: string
}

const scalarFact = (simulation: MagneticSimulation, key: string): ScalarFact | undefined => {
  const entry = simulation.derivedQuantities.find(candidate => candidate.key === key)
  if (!entry || !isRecord(entry.value) || 'vector' in entry.value) return undefined
  const value = entry.value
  if (
    !isFiniteNumber(value.value) ||
    typeof value.unit !== 'string' ||
    typeof value.dimension !== 'string'
  )
    return undefined
  return { value: value.value, unit: value.unit, dimension: value.dimension }
}

const vectorFact = (simulation: MagneticSimulation, key: string): VectorFact | undefined => {
  const entry = simulation.derivedQuantities.find(candidate => candidate.key === key)
  if (!entry || !isRecord(entry.value) || !('vector' in entry.value)) return undefined
  const value = entry.value
  if (!isRecord(value.vector)) return undefined
  const { x, y, z } = value.vector
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined
  if (typeof value.unit !== 'string' || typeof value.dimension !== 'string') return undefined
  return { vector: { x, y, z }, unit: value.unit, dimension: value.dimension }
}

const vectorMagnitude = (vector: { x: number; y: number; z: number }): number =>
  Math.hypot(vector.x, vector.y, vector.z)

const isVectorCoordinates = (
  value: unknown,
): value is { readonly x: number; readonly y: number; readonly z: number } =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)

const normalizeVector = (vector: {
  x: number
  y: number
  z: number
}): { x: number; y: number; z: number } | undefined => {
  const magnitude = vectorMagnitude(vector)
  if (!Number.isFinite(magnitude) || magnitude === 0) return undefined
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
}

const findParticleState = (state: MagneticState, particleId: string) =>
  state.objects.find(object => object.id === particleId)

const findObservation = <TType extends MagneticObservation['type']>(
  observations: readonly MagneticObservation[],
  type: TType,
): Extract<MagneticObservation, { type: TType }> | undefined =>
  observations.find(
    (observation): observation is Extract<MagneticObservation, { type: TType }> =>
      observation.type === type,
  )

const observableKeyFor = (
  definition: PhysicsScene['observableDefinitions'][number],
): MagneticObservableKey | undefined => {
  if (definition.type === 'velocity') return 'velocity'
  if (definition.type === 'force') return 'force'
  if (definition.type === 'trajectory') return 'trajectory'
  if (definition.type !== 'geometry') return undefined
  const kind = definition.parameters?.['kind']
  if (kind === 'orbit_center') return 'center'
  if (kind === 'radius') return 'radius'
  return undefined
}

const formatNumber = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e4)) {
    return value.toExponential(digits)
  }
  return value.toFixed(digits)
}

const fieldDirectionOf = (scene: PhysicsScene): LabFieldDirection => {
  const field = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
  return field !== undefined && field.magneticFluxDensity.vector.z < 0 ? 'into-page' : 'out-of-page'
}

const fieldStrengthOf = (scene: PhysicsScene): number => {
  const field = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
  return field === undefined ? Number.NaN : vectorMagnitude(field.magneticFluxDensity.vector)
}

const initialVelocitySpeedOf = (scene: PhysicsScene): number => {
  const particle = scene.particles[0]
  return particle === undefined ? Number.NaN : vectorMagnitude(particle.velocity.vector)
}

const derivedItems = (simulation: MagneticSimulation): readonly LabDerivedView[] => {
  const radius = scalarFact(simulation, 'cyclotron_radius')
  const period = scalarFact(simulation, 'cyclotron_period')
  const angularVelocity = scalarFact(simulation, 'angular_velocity')
  const force = scalarFact(simulation, 'lorentz_force_magnitude')
  return [
    {
      id: 'R',
      label: '轨道半径',
      symbol: 'R',
      value: radius === undefined ? '—' : formatNumber(radius.value * 100, 2),
      unit: 'cm',
    },
    {
      id: 'T',
      label: '周期',
      symbol: 'T',
      value: period === undefined ? '—' : formatNumber(period.value, 2),
      unit: 's',
    },
    {
      id: 'omega',
      label: '角速度',
      symbol: 'ω',
      value: angularVelocity === undefined ? '—' : formatNumber(angularVelocity.value, 2),
      unit: 'rad/s',
    },
    {
      id: 'F',
      label: '洛伦兹力',
      symbol: 'F',
      value: force === undefined ? '—' : formatNumber(force.value, 2),
      unit: 'N',
    },
  ]
}

const parametersOf = (
  scene: PhysicsScene,
): {
  readonly particle: readonly LabParameter[]
  readonly field: readonly LabParameter[]
} => {
  const particle = scene.particles[0]
  const field = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
  return {
    particle:
      particle === undefined
        ? []
        : [
          {
            id: 'q',
            label: '粒子电荷',
            symbol: 'q',
            unit: particle.charge?.unit ?? 'C',
            value: particle.charge?.value ?? Number.NaN,
          },
          {
            id: 'm',
            label: '粒子质量',
            symbol: 'm',
            unit: particle.mass.unit,
            value: particle.mass.value,
          },
          {
            id: 'v0',
            label: '初速度',
            symbol: 'v₀',
            unit: particle.velocity.unit,
            value: vectorMagnitude(particle.velocity.vector),
          },
        ],
    field:
      field === undefined
        ? []
        : [
          {
            id: 'B',
            label: '磁感应强度',
            symbol: 'B',
            unit: field.magneticFluxDensity.unit,
            value: vectorMagnitude(field.magneticFluxDensity.vector),
          },
        ],
  }
}

const treeOf = (scene: PhysicsScene): readonly LabTreeNode[] => {
  const particle = scene.particles[0]
  const field = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
  const visibility = emptyVisibility()
  for (const definition of scene.observableDefinitions) {
    const key = observableKeyFor(definition)
    if (key !== undefined) visibility[key] = definition.visible
  }
  const labels = new Map(MAGNETIC_OBSERVABLE_LABELS.map(entry => [entry.id, entry.label]))
  return [
    {
      id: 'scene',
      label: '场景',
      icon: 'folder',
      kind: 'group',
      children: [
        {
          id: 'field-region',
          label: '磁场区域',
          icon: 'folder',
          kind: 'group',
          children: [
            {
              id: field?.id ?? 'field',
              label: '匀强磁场 B',
              secondary:
                field === undefined
                  ? '—'
                  : `${formatNumber(vectorMagnitude(field.magneticFluxDensity.vector), 2)} T`,
              icon: 'field',
              kind: 'object',
            },
          ],
        },
        {
          id: 'particles',
          label: '粒子',
          icon: 'folder',
          kind: 'group',
          children: [
            {
              id: particle?.id ?? 'particle',
              label: `${particle?.charge?.value !== undefined && particle.charge.value >= 0 ? '正' : '负'}电粒子 q`,
              secondary:
                particle?.charge === undefined
                  ? '—'
                  : `${particle.charge.value >= 0 ? '+' : ''}${particle.charge.value.toExponential(2)} C`,
              icon: 'particle',
              kind: 'object',
            },
          ],
        },
      ],
    },
    {
      id: 'initial',
      label: '初始条件',
      icon: 'folder',
      kind: 'group',
      children: [
        {
          id: 'velocity',
          label: '初速度 v₀',
          secondary: `${formatNumber(initialVelocitySpeedOf(scene), 2)} m/s`,
          icon: 'velocity',
          kind: 'object',
        },
      ],
    },
    {
      id: 'observables',
      label: '可观测量',
      icon: 'folder',
      kind: 'group',
      children: [
        ...OBSERVABLE_KEYS.filter(key => key !== 'guides').map(key => ({
          id: `obs-${key}`,
          label: labels.get(key) ?? key,
          icon: 'observable' as const,
          kind: 'observable' as const,
          observable: key,
        })),
        {
          id: 'obs-guides',
          label: '辅助线',
          icon: 'observable' as const,
          kind: 'observable' as const,
          observable: 'guides' as const,
        },
      ],
    },
  ]
}

const mapPoint = (
  point: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
): LabPoint => ({
  x: VIEWPORT.width / 2 + (point.x - center.x) * 100,
  y: VIEWPORT.height / 2 + (point.y - center.y) * 100,
})

const makeArrow = (
  id: string,
  observable: Extract<LabObservableId, 'velocity' | 'force'>,
  from: LabPoint,
  vector: { x: number; y: number; z: number },
  length: number,
  symbol: string,
): LabVectorView | undefined => {
  const direction = normalizeVector(vector)
  if (direction === undefined) return undefined
  return {
    id,
    observable,
    from,
    to: { x: from.x + direction.x * length, y: from.y + direction.y * length },
    symbol,
  }
}

const emptyView = (scene: PhysicsScene): LabCanvasViewModel => ({
  extent: { width: VIEWPORT.width, height: VIEWPORT.height },
  grid: { minor: VIEWPORT.minorGrid, major: VIEWPORT.majorGrid },
  axes: { x: 'x / cm', y: 'y / cm' },
  field: { direction: fieldDirectionOf(scene), spacing: VIEWPORT.fieldSpacing },
  particles: [],
  vectors: [],
  trajectories: [],
  guides: [],
  overlay: {
    field: [`B = ${formatNumber(fieldStrengthOf(scene), 2)} T`],
    scale: { label: `${VIEWPORT.minorGrid} cm`, length: VIEWPORT.minorGrid },
  },
  visible: emptyVisibility(),
})

const viewOf = (
  scene: PhysicsScene,
  simulation: MagneticSimulation,
  observations: ObservationRuntimeState,
  state: MagneticState,
  guidesVisible: boolean,
): LabCanvasViewModel => {
  const particle = scene.particles[0]
  const particleState = particle === undefined ? undefined : findParticleState(state, particle.id)
  const centerFact = vectorFact(simulation, 'orbit_center')
  const center = centerFact?.vector ?? particleState?.position?.vector ?? { x: 0, y: 0, z: 0 }
  const position = particleState?.position?.vector ?? center
  const particlePoint = mapPoint(position, center)
  const centerPoint = mapPoint(center, center)
  const velocityObservation = findObservation(observations.observations, 'velocity')
  const forceObservation = findObservation(observations.observations, 'lorentz_force')
  const trajectoryObservation = findObservation(observations.observations, 'trajectory')
  const centerObservation = findObservation(observations.observations, 'orbit_center')
  const radiusObservation = findObservation(observations.observations, 'radius')

  const vectors: LabVectorView[] = []
  if (velocityObservation !== undefined) {
    const arrow = makeArrow(
      'v',
      'velocity',
      particlePoint,
      velocityObservation.vector.vector,
      VIEWPORT.velocityArrow,
      'v',
    )
    if (arrow !== undefined) vectors.push(arrow)
  }
  if (forceObservation !== undefined) {
    const arrow = makeArrow(
      'F',
      'force',
      particlePoint,
      forceObservation.vector.vector,
      VIEWPORT.forceArrow,
      'F',
    )
    if (arrow !== undefined) vectors.push(arrow)
  }

  const trajectories: LabTrajectoryView[] =
    trajectoryObservation === undefined
      ? []
      : [
        {
          id: 'trajectory',
          kind: 'history',
          direction: trajectoryObservation.direction,
          points: trajectoryObservation.points.map(point =>
            mapPoint(point.position.vector, center),
          ),
        },
      ]
  const guides: LabGuideView[] =
    radiusObservation === undefined
      ? []
      : [
        {
          id: 'radius',
          observable: 'radius',
          from: centerPoint,
          to: particlePoint,
          label: 'R',
        },
      ]
  const visible = emptyVisibility()
  for (const definition of scene.observableDefinitions) {
    const key = observableKeyFor(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  visible.guides = guidesVisible

  return {
    extent: { width: VIEWPORT.width, height: VIEWPORT.height },
    grid: { minor: VIEWPORT.minorGrid, major: VIEWPORT.majorGrid },
    axes: { x: 'x / cm', y: 'y / cm' },
    field: { direction: fieldDirectionOf(scene), spacing: VIEWPORT.fieldSpacing },
    particles:
      particle === undefined
        ? []
        : [
          {
            id: particle.id,
            at: particlePoint,
            sign:
                particle.charge?.value !== undefined && particle.charge.value < 0
                  ? 'negative'
                  : 'positive',
            radius: 0.32,
            symbol: 'q',
          },
        ],
    vectors,
    trajectories,
    guides,
    ...(centerObservation === undefined ? {} : { center: centerPoint }),
    overlay: {
      field: [
        `B = ${formatNumber(fieldStrengthOf(scene), 2)} T`,
        `方向：${fieldDirectionOf(scene) === 'into-page' ? '垂直纸面向里' : '垂直纸面向外'}`,
      ],
      scale: { label: `${VIEWPORT.minorGrid} cm`, length: VIEWPORT.minorGrid },
    },
    visible,
  }
}

/** Adapt the magnetic Runtime view into the renderer-neutral canvas contract. */
const sceneVisualOf = (view: LabCanvasViewModel): SceneVisualModel => ({
  domain: 'magnetic',
  extent: view.extent,
  origin: { x: 0, y: 0 },
  grid: view.grid,
  axes: view.axes,
  tickStep: view.grid.major,
  bodies: [],
  particles: view.particles,
  vectors: view.vectors.map(vector => ({
    ...vector,
    role: vector.observable === 'velocity' ? 'velocity' : 'force',
  })),
  trajectories: view.trajectories,
  keyPoints: [],
  angles: [],
  dimensions: [],
  labels: [],
  guides: view.guides,
  field: view.field,
  ...(view.center === undefined ? {} : { center: view.center }),
  overlay: {
    readout: view.overlay.field,
    scale: view.overlay.scale,
  },
  visible: view.visible,
})

const dataOf = (
  simulation: MagneticSimulation,
  period: number,
  particleId: string | undefined,
): { readonly series: readonly LabSeries[]; readonly samples: readonly LabSample[] } => {
  const radius = scalarFact(simulation, 'cyclotron_radius')?.value
  const force = scalarFact(simulation, 'lorentz_force_magnitude')?.value
  const points = simulation.states.map((state) => {
    const object =
      particleId === undefined
        ? state.objects[0]
        : state.objects.find(candidate => candidate.id === particleId)
    const speed =
      object?.velocity === undefined ? Number.NaN : vectorMagnitude(object.velocity.vector)
    const stateForce = object?.values?.['lorentz_force']
    const forceValue =
      isRecord(stateForce) && 'vector' in stateForce && isVectorCoordinates(stateForce.vector)
        ? vectorMagnitude(stateForce.vector)
        : (force ?? Number.NaN)
    return { t: state.time.value, speed, force: forceValue }
  })
  const samples = points.map((point, index) => ({
    step: index,
    t: formatNumber(point.t, 2),
    theta: period > 0 ? formatNumber(((point.t / period) * 360) % 360, 0) : '0',
    speed: formatNumber(point.speed, 2),
    force: formatNumber(point.force, 2),
    radius: radius === undefined ? '—' : formatNumber(radius * 100, 2),
  }))
  return {
    series: [
      {
        id: 'speed',
        title: '|v| - t',
        points: points.map(point => ({ t: point.t, value: point.speed })),
      },
      {
        id: 'force',
        title: '|F| - t',
        points: points.map(point => ({ t: point.t, value: point.force })),
      },
      {
        id: 'radius',
        title: 'R - t',
        points: points.map(point => ({
          t: point.t,
          value: radius === undefined ? Number.NaN : radius * 100,
        })),
      },
    ],
    samples,
  }
}

/**
 * The sole domain entry point for the Harness Physics Lab. UI components only
 * receive this plain snapshot and callbacks; they never import an engine or
 * calculate a physical fact themselves.
 */
export class MagneticRuntimeBridge {
  private readonly sceneRuntime: SceneRuntime
  private readonly engine = new MagneticEngine()
  private currentTime = 0
  private playbackRate = 1
  private running = false
  private guidesVisible = false
  private commandSequence = 0
  private traceSequence = 0
  private snapshot!: MagneticRuntimeSnapshot

  constructor(input: MagneticSceneInput | PhysicsScene = {}) {
    this.sceneRuntime = new SceneRuntime(isPhysicsScene(input) ? input : createMagneticScene(input))
    this.snapshot = this.recompute()
  }

  getSnapshot(): MagneticRuntimeSnapshot {
    return this.snapshot
  }

  getEvents(): readonly PhysicsEvent[] {
    return this.sceneRuntime.getEvents()
  }

  execute(command: SceneCommand): SceneCommandResult {
    const result = this.sceneRuntime.execute(command)
    if (result.ok) this.recompute()
    return result
  }

  dispatch(command: SceneCommand): MagneticRuntimeCommandOutcome {
    const result = this.execute(command)
    return { result, snapshot: this.snapshot }
  }

  setParticleCharge(value: number): MagneticRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const particle = scene.particles[0]
    return this.dispatch(
      createSceneCommand({
        commandId: this.nextCommandId(),
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type: 'SetParticleCharge',
        payload: {
          particleId: particle?.id ?? 'particle-1',
          charge: { value, unit: 'C', dimension: 'electric_charge' },
        },
        traceId: this.nextTraceId(),
      }),
    )
  }

  setParticleMass(value: number): MagneticRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const particle = scene.particles[0]
    return this.dispatch(
      createSceneCommand({
        commandId: this.nextCommandId(),
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type: 'SetParticleMass',
        payload: {
          particleId: particle?.id ?? 'particle-1',
          mass: { value, unit: 'kg', dimension: 'mass' },
        },
        traceId: this.nextTraceId(),
      }),
    )
  }

  setParticleSpeed(value: number): MagneticRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const particle = scene.particles[0]
    const vector = particle?.velocity.vector ?? { x: 1, y: 0, z: 0 }
    const magnitude = vectorMagnitude(vector)
    const direction =
      magnitude === 0
        ? { x: 1, y: 0, z: 0 }
        : { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
    return this.dispatch(
      createSceneCommand({
        commandId: this.nextCommandId(),
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type: 'SetParticleVelocity',
        payload: {
          particleId: particle?.id ?? 'particle-1',
          velocity: {
            vector: { x: direction.x * value, y: direction.y * value, z: direction.z * value },
            unit: 'm/s',
            dimension: 'velocity',
          },
        },
        traceId: this.nextTraceId(),
      }),
    )
  }

  setMagneticFieldStrength(value: number): MagneticRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const field = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
    return this.dispatch(
      createSceneCommand({
        commandId: this.nextCommandId(),
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type: 'SetMagneticFieldStrength',
        payload: {
          fieldId: field?.id ?? 'field-1',
          strength: { value, unit: 'T', dimension: 'magnetic_flux_density' },
        },
        traceId: this.nextTraceId(),
      }),
    )
  }

  setMagneticFieldDirection(direction: LabFieldDirection): MagneticRuntimeCommandOutcome {
    const scene = this.sceneRuntime.getScene()
    const field = scene.fields.find(candidate => candidate.type === 'uniform_magnetic')
    return this.dispatch(
      createSceneCommand({
        commandId: this.nextCommandId(),
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type: 'SetMagneticFieldDirection',
        payload: {
          fieldId: field?.id ?? 'field-1',
          direction: direction === 'into-page' ? 'into_page' : 'out_of_page',
        },
        traceId: this.nextTraceId(),
      }),
    )
  }

  setObservableEnabled(key: LabObservableId, enabled: boolean): MagneticRuntimeSnapshot {
    if (key === 'guides') {
      this.guidesVisible = enabled
      return this.renderCurrentFrame()
    }
    const scene = this.sceneRuntime.getScene()
    const definition = scene.observableDefinitions.find(
      candidate => observableKeyFor(candidate) === key,
    )
    if (definition === undefined) return this.snapshot
    const outcome = this.dispatch(
      createSceneCommand({
        commandId: this.nextCommandId(),
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type: 'SetObservableEnabled',
        payload: {
          observableId: definition.id,
          enabled,
        },
        traceId: this.nextTraceId(),
      }),
    )
    return outcome.snapshot
  }

  setRunning(running: boolean): MagneticRuntimeSnapshot {
    this.running = running
    return this.renderCurrentFrame()
  }

  setPlaybackRate(rate: number): MagneticRuntimeSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.playbackRate = rate
    return this.renderCurrentFrame()
  }

  seek(seconds: number): MagneticRuntimeSnapshot {
    const total = this.totalPeriod()
    this.currentTime = Number.isFinite(seconds) ? Math.min(total, Math.max(0, seconds)) : 0
    this.running = false
    return this.renderCurrentFrame()
  }

  step(deltaSeconds: number): MagneticRuntimeSnapshot {
    return this.seek(this.currentTime + deltaSeconds)
  }

  advance(wallClockSeconds: number): MagneticRuntimeSnapshot {
    const total = this.totalPeriod()
    if (this.running && Number.isFinite(wallClockSeconds) && total > 0) {
      this.currentTime = (this.currentTime + wallClockSeconds * this.playbackRate) % total
    }
    return this.renderCurrentFrame()
  }

  recompute(): MagneticRuntimeSnapshot {
    const scene = this.sceneRuntime.getScene()
    try {
      const simulation = this.engine.simulate(
        scene,
        createMagneticSimulationRequest(
          scene,
          `simulation-${scene.revision}`,
          `physicsos-runtime-${scene.revision}-${this.traceSequence}`,
        ),
      )
      const verification = verifyMagneticScene(scene, simulation)
      const status: MagneticRuntimeStatus =
        verification.status === 'failed'
          ? 'failed'
          : verification.status === 'passed_with_warnings'
            ? 'warning'
            : 'verified'
      const verifiedSimulation = { ...simulation, verification }
      const trusted = status !== 'failed'
      const period = trusted ? (scalarFact(simulation, 'cyclotron_period')?.value ?? 0) : 0
      if (period > 0 && this.currentTime > period) this.currentTime %= period
      if (!trusted) {
        this.currentTime = 0
        this.running = false
      }
      const state = trusted ? this.engine.stateAtSeconds(scene, this.currentTime) : undefined
      const observations =
        !trusted || state === undefined
          ? { sceneRevision: scene.revision, observations: [] as readonly MagneticObservation[] }
          : observeMagneticScene({ scene, simulation: verifiedSimulation, state })
      const params = parametersOf(scene)
      const view =
        !trusted || state === undefined
          ? emptyView(scene)
          : viewOf(scene, verifiedSimulation, observations, state, this.guidesVisible)
      const snapshot: MagneticRuntimeSnapshot = {
        scene,
        sceneRevision: scene.revision,
        simulation: verifiedSimulation,
        verification,
        status,
        observations,
        view,
        visual: sceneVisualOf(view),
        tree: treeOf(scene),
        particleParameters: params.particle,
        fieldParameters: params.field,
        derived: { items: trusted ? derivedItems(verifiedSimulation) : [] },
        data: trusted
          ? dataOf(verifiedSimulation, period, scene.particles[0]?.id)
          : { series: [], samples: [] },
        clock: {
          time: this.currentTime,
          total: period,
          running: this.running,
          rate: this.playbackRate,
        },
        events: this.sceneRuntime.getEvents(),
        ...(trusted
          ? {}
          : {
            error: {
              code: 'PHYSICS_VERIFICATION_FAILED',
              message: 'Magnetic simulation failed Physics verification.',
              retryable: false,
              details: { issueCodes: verification.errors.map(issue => issue.code) },
            },
          }),
      }
      this.snapshot = snapshot
      return snapshot
    } catch (error: unknown) {
      this.currentTime = 0
      this.running = false
      const params = parametersOf(scene)
      const view = emptyView(scene)
      const snapshot: MagneticRuntimeSnapshot = {
        scene,
        sceneRevision: scene.revision,
        simulation: null,
        verification: null,
        status: 'failed',
        observations: { sceneRevision: scene.revision, observations: [] },
        view,
        visual: sceneVisualOf(view),
        tree: treeOf(scene),
        particleParameters: params.particle,
        fieldParameters: params.field,
        derived: { items: [] },
        data: { series: [], samples: [] },
        clock: {
          time: 0,
          total: 0,
          running: false,
          rate: this.playbackRate,
        },
        events: this.sceneRuntime.getEvents(),
        error: runtimeErrorOf(error),
      }
      this.snapshot = snapshot
      return snapshot
    }
  }

  /** Re-project one analytical state without re-running simulation or verification. */
  private renderCurrentFrame(): MagneticRuntimeSnapshot {
    const scene = this.sceneRuntime.getScene()
    const simulation = this.snapshot.simulation
    const trusted = this.snapshot.status !== 'failed' && simulation !== null
    if (!trusted) {
      this.currentTime = 0
      this.running = false
      this.snapshot = {
        ...this.snapshot,
        clock: {
          time: 0,
          total: 0,
          running: false,
          rate: this.playbackRate,
        },
      }
      return this.snapshot
    }

    try {
      const period = scalarFact(simulation, 'cyclotron_period')?.value ?? 0
      if (period > 0 && this.currentTime > period) this.currentTime %= period
      const state = this.engine.stateAtSeconds(scene, this.currentTime)
      const observations = observeMagneticScene({ scene, simulation, state })
      const view = viewOf(scene, simulation, observations, state, this.guidesVisible)
      this.snapshot = {
        ...this.snapshot,
        observations,
        view,
        visual: sceneVisualOf(view),
        clock: {
          time: this.currentTime,
          total: period,
          running: this.running,
          rate: this.playbackRate,
        },
      }
      return this.snapshot
    } catch {
      return this.recompute()
    }
  }

  private totalPeriod(): number {
    return this.snapshot.simulation === null
      ? 0
      : (scalarFact(this.snapshot.simulation, 'cyclotron_period')?.value ?? 0)
  }

  private nextCommandId(): string {
    this.commandSequence += 1
    return `physicsos-command-${this.commandSequence}`
  }

  private nextTraceId(): string {
    this.traceSequence += 1
    return `physicsos-trace-${this.traceSequence}`
  }
}

export const createMagneticRuntime = (input: MagneticSceneInput | PhysicsScene = {}): MagneticRuntimeBridge =>
  new MagneticRuntimeBridge(input)

export { MAGNETIC_SCENE_SUBTITLE, MAGNETIC_SCENE_TITLE }
