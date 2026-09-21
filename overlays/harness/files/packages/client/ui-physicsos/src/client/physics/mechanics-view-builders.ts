import type { SimulationResult, SimulationState, DerivedQuantity } from '@physicsos/physics-core'
import type { PhysicsScene, MechanicsModelId } from '@physicsos/physics-scene'
import type { MechanicsModel } from '@physicsos/engine-mechanics'
import type { MechanicsObservationRuntimeState } from '@physicsos/physics-observation'

import { mechanicsSceneVisualAt } from './mechanics-visual-bridge.ts'

import type {
  ChartSeries,
  DataTableView,
  DerivationStepView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  PlaybackClock,
  QuantityParameter,
  RuntimeStatus,
  SceneTreeNode,
  ScenePoint,
  SceneVisualModel,
  TimelineEvent,
  VerificationCheckView,
} from './scene-visual-model.ts'
import { formatSignificant } from './number-format.ts'

const fmt = formatSignificant

const scalar = (dq: readonly DerivedQuantity[], key: string): number | undefined => {
  const entry = dq.find(d => d.key === key)
  if (entry === undefined || 'vector' in entry.value) return undefined
  return entry.value.value
}

const vector = (dq: readonly DerivedQuantity[], key: string): ScenePoint | undefined => {
  const entry = dq.find(d => d.key === key)
  if (entry === undefined || !('vector' in entry.value)) return undefined
  return { x: entry.value.vector.x, y: entry.value.vector.y }
}

const bodyStateOf = (state: SimulationState, bodyId: string) =>
  state.objects.find(o => o.id === bodyId)

/* ------------------------------------------------------------------ view --- */

export interface SnapshotInput {
  scene: PhysicsScene
  modelId: MechanicsModelId
  model: MechanicsModel
  simulation: SimulationResult
  state: SimulationState
  observations: MechanicsObservationRuntimeState
  verification: ReturnType<typeof import('@physicsos/physics-verifier').verifyMechanicsSimulation>
  visibility: Partial<Record<ObservableKey, boolean>>
  clock: PlaybackClock
  status: RuntimeStatus
}

export interface BuiltSnapshot {
  scene: PhysicsScene
  sceneRevision: number
  modelId: MechanicsModelId
  status: RuntimeStatus
  view: SceneVisualModel
  tree: readonly SceneTreeNode[]
  inspector: readonly InspectorSection[]
  charts: readonly ChartSeries[]
  table: DataTableView
  derivation: readonly DerivationStepView[]
  verification: readonly VerificationCheckView[]
  events: readonly TimelineEvent[]
  clock: PlaybackClock
  trajectoryTimes: readonly number[]
}

/** Build the whole snapshot from one verified simulation + current state. */
export function buildSnapshot(input: SnapshotInput): BuiltSnapshot {
  const { scene, model, simulation, state, clock, status, modelId } = input
  /* Readings follow the playhead: a key the engine also writes per-state
     (applied_force while the pull ramps, spring_force mid-swing, friction at
     the slip instant) shows the value at THIS frame; simulation-level
     aggregates (period, slip_time) stay as fallback for keys no frame owns. */
  const frameDerived = state.derived
  const frameKeys = new Set(frameDerived.map(entry => entry.key))
  const dq = [
    ...frameDerived,
    ...simulation.derivedQuantities.filter(entry => !frameKeys.has(entry.key)),
  ]

  const trajectoryTimes = simulation.states
    .filter(s => bodyStateOf(s, model.bodyId)?.position !== undefined)
    .map(s => s.time.value)

  /* One mechanics visual path for the Lab and for Question Space: the shared
     observation-driven bridge. Building a second view here would let the two
     surfaces drift apart while both claimed to show the same physics. */
  const view = mechanicsSceneVisualAt({
    scene,
    simulation,
    observations: input.observations.observations,
    stateIndex: 0,
    state,
  })

  return {
    scene,
    sceneRevision: scene.revision,
    modelId,
    status,
    view,
    tree: treeOf(scene, modelId),
    inspector: inspectorOf(scene, modelId, dq),
    charts: chartsOf(modelId, simulation, model),
    table: tableOf(simulation, model),
    derivation: derivationOf(modelId, model),
    verification: verificationOf(input.verification, simulation),
    events: eventsOf(modelId, model),
    clock,
    trajectoryTimes,
  }
}

/* ------------------------------------------------------------------ trees --- */

export function treeOf(
  scene: PhysicsScene,
  modelId: MechanicsModelId,
): readonly SceneTreeNode[] {
  const body = scene.bodies[0]
  const massLabel = body ? `${fmt(body.mass.value)} ${body.mass.unit}` : '—'

  const sceneChildren: SceneTreeNode[] = [
    { id: body?.id ?? 'body', label: '物块', secondary: massLabel, icon: 'body', kind: 'object' },
    { id: 'gravity', label: '重力场', secondary: 'g', icon: 'gravity', kind: 'object' },
  ]
  if (modelId === 'projectile_motion') {
    sceneChildren.push({ id: 'ground', label: '地面', icon: 'ground', kind: 'object' })
  }
  if (modelId === 'inclined_plane') {
    sceneChildren.push({ id: 'incline', label: '斜面', icon: 'incline', kind: 'object' })
  }
  if (modelId === 'spring_oscillator' || modelId === 'spring_statics') {
    sceneChildren.push({ id: 'spring', label: '弹簧', secondary: 'k', icon: 'force', kind: 'object' })
  }
  if (modelId === 'simple_pendulum') {
    sceneChildren.push({ id: 'rope', label: '摆线', secondary: 'L', icon: 'variable', kind: 'object' })
  }

  const observableChildren: SceneTreeNode[] =
    modelId === 'inclined_plane'
      ? [
        observableNode('obs-velocity', '速度', 'velocity', 'velocity'),
        observableNode('obs-acceleration', '加速度', 'acceleration', 'acceleration'),
        observableNode('obs-forces', '受力', 'forces', 'force'),
        observableNode('obs-decomposition', '力的分解', 'decomposition', 'force'),
      ]
      : modelId === 'projectile_motion'
        ? [
          observableNode('obs-velocity', '速度', 'velocity', 'velocity'),
          observableNode('obs-components', '速度分量', 'components', 'velocity'),
          observableNode('obs-trajectory', '轨迹', 'trajectory', 'trajectory'),
          observableNode('obs-keypoints', '关键点', 'keyPoints', 'keyPoint'),
        ]
        : [
          observableNode('obs-velocity', '速度', 'velocity', 'velocity'),
          observableNode('obs-acceleration', '加速度', 'acceleration', 'acceleration'),
          observableNode('obs-trajectory', '轨迹', 'trajectory', 'trajectory'),
        ]

  const initialChildren: SceneTreeNode[] =
    modelId === 'projectile_motion'
      ? [
        { id: 'init-height', label: '初始高度', secondary: 'h', icon: 'variable', kind: 'object' },
        { id: 'init-velocity', label: '初速度', secondary: 'v₀', icon: 'velocity', kind: 'object' },
        { id: 'init-angle', label: '抛射角', secondary: 'θ', icon: 'variable', kind: 'object' },
      ]
      : modelId === 'inclined_plane'
        ? [
          { id: 'init-angle', label: '倾角', secondary: 'θ', icon: 'variable', kind: 'object' },
          { id: 'init-friction', label: '摩擦系数', secondary: 'μ', icon: 'variable', kind: 'object' },
        ]
        : modelId === 'spring_oscillator'
          ? [
            { id: 'init-k', label: '劲度系数', secondary: 'k', icon: 'variable', kind: 'object' },
            { id: 'init-amplitude', label: '振幅', secondary: 'A', icon: 'variable', kind: 'object' },
          ]
          : modelId === 'simple_pendulum'
            ? [
              { id: 'init-length', label: '摆长', secondary: 'L', icon: 'variable', kind: 'object' },
              { id: 'init-amplitude', label: '摆角', secondary: 'θ₀', icon: 'variable', kind: 'object' },
            ]
            : modelId === 'horizontal_friction'
              ? [
                { id: 'init-force', label: '拉力', secondary: 'F', icon: 'force', kind: 'object' },
                { id: 'init-friction', label: '摩擦系数', secondary: 'μ', icon: 'variable', kind: 'object' },
              ]
              : modelId === 'spring_statics'
                ? [
                  { id: 'init-k', label: '劲度系数', secondary: 'k', icon: 'variable', kind: 'object' },
                  { id: 'init-mass', label: '悬挂质量', secondary: 'm', icon: 'variable', kind: 'object' },
                ]
                : [{ id: 'init-velocity', label: '初速度', secondary: 'v₀', icon: 'velocity', kind: 'object' }]

  return [
    { id: 'scene', label: '场景', icon: 'folder', kind: 'group', children: sceneChildren },
    { id: 'initial', label: '初始条件', icon: 'folder', kind: 'group', children: initialChildren },
    { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
  ]
}

function observableNode(
  id: string,
  label: string,
  observable: ObservableKey,
  icon: SceneTreeNode['icon'],
): SceneTreeNode {
  return { id, label, icon, kind: 'observable', observable }
}

/* ------------------------------------------------------------- inspectors --- */

export function inspectorOf(
  scene: PhysicsScene,
  modelId: MechanicsModelId,
  dq: readonly DerivedQuantity[] | undefined,
): readonly InspectorSection[] {
  const body = scene.bodies[0]
  const mass = body?.mass.value ?? 1
  const position = body?.position.vector ?? { x: 0, y: 0, z: 0 }
  const velocity = body?.velocity.vector ?? { x: 0, y: 0, z: 0 }
  const gravity = scene.fields.find(f => f.type === 'uniform_gravity')
  const g = gravity?.type === 'uniform_gravity' ? Math.abs(gravity.acceleration.vector.y) : 9.8

  if (modelId === 'projectile_motion') {
    const speed = Math.hypot(velocity.x, velocity.y)
    const angle = (Math.atan2(velocity.y, velocity.x) * 180) / Math.PI
    const initial: QuantityParameter[] = [
      { id: 'height', label: '初始高度', symbol: 'h', unit: 'm', value: position.y, min: 0, step: 1, highlights: 'launch-height' },
      { id: 'speed', label: '初速度', symbol: 'v_0', unit: 'm/s', value: speed, min: 0, step: 1, highlights: 'velocity' },
      { id: 'angle', label: '抛射角', symbol: '\\theta', unit: '°', value: angle, min: 0, max: 90, step: 1, highlights: 'launch-angle' },
      { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1, highlights: 'force-gravity' },
    ]
    return [
      { id: 'initial', title: '初始条件', parameters: initial },
      { id: 'derived', title: '派生量', derived: projectileDerived(dq) },
    ]
  }

  if (modelId === 'inclined_plane') {
    const angleObs = scene.observableDefinitions.find(o => o.parameters?.['kind'] === 'incline')
    const angle = typeof angleObs?.parameters?.['angle'] === 'number' ? angleObs.parameters['angle'] : 30
    const mu = body?.material?.frictionCoefficient ?? 0
    const initial: QuantityParameter[] = [
      { id: 'mass', label: '质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5, ...(body === undefined ? {} : { highlights: body.id }) },
      { id: 'angle', label: '倾角', symbol: '\\theta', unit: '°', value: angle, min: 1, max: 89, step: 1, highlights: 'incline-angle' },
      { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1, highlights: 'force-gravity' },
      { id: 'friction', label: '摩擦系数', symbol: '\\mu', unit: '', value: mu, min: 0, step: 0.05, highlights: 'force-friction' },
    ]
    return [
      { id: 'initial', title: '基本参数', parameters: initial },
      { id: 'derived', title: '派生量', derived: inclineDerived(dq) },
    ]
  }

  if (modelId === 'spring_oscillator') {
    const spring = scene.constraints.find(c => c.type === 'spring')
    const anchor = spring?.parameters['anchor'] as { x?: number } | undefined
    const natural = Number(spring?.parameters['naturalLength'] ?? 0)
    const stiffness = Number(spring?.parameters['stiffness'] ?? 0)
    /* Amplitude = release offset from the relaxed end along the coil axis. */
    const amplitude = Math.abs(position.x - ((anchor?.x ?? 0) + natural))
    return [
      {
        id: 'initial',
        title: '基本参数',
        parameters: [
          { id: 'mass', label: '振子质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5, ...(body === undefined ? {} : { highlights: body.id }) },
          { id: 'springConstant', label: '劲度系数', symbol: 'k', unit: 'N/m', value: stiffness, min: 0.1, step: 1, ...(spring === undefined ? {} : { highlights: spring.id }) },
          { id: 'amplitude', label: '振幅', symbol: 'A', unit: 'm', value: amplitude, min: 0, step: 0.05, ...(body === undefined ? {} : { highlights: body.id }) },
          { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1, highlights: 'force-gravity' },
        ],
      },
      { id: 'derived', title: '派生量', derived: oscillatorDerived(dq) },
    ]
  }

  if (modelId === 'simple_pendulum') {
    const rope = scene.constraints.find(c => c.type === 'rope')
    const pivot = rope?.parameters['pivot'] as { x?: number; y?: number } | undefined
    const length = Number(rope?.parameters['length'] ?? 0)
    /* Release angle from the bob's offset against the straight-down rest. */
    const dx = position.x - (pivot?.x ?? 0)
    const amplitudeDeg = Math.abs((Math.asin(Math.min(1, Math.max(-1, dx / (length || 1)))) * 180) / Math.PI)
    return [
      {
        id: 'initial',
        title: '基本参数',
        parameters: [
          { id: 'mass', label: '摆球质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5, ...(body === undefined ? {} : { highlights: body.id }) },
          { id: 'pendulumLength', label: '摆长', symbol: 'L', unit: 'm', value: length, min: 0.1, step: 0.1, ...(rope === undefined ? {} : { highlights: rope.id }) },
          { id: 'amplitude', label: '摆角', symbol: '\\theta_0', unit: '°', value: amplitudeDeg, min: 0, max: 60, step: 1, ...(body === undefined ? {} : { highlights: body.id }) },
          { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1, highlights: 'force-gravity' },
        ],
      },
      { id: 'derived', title: '派生量', derived: pendulumDerived(dq) },
    ]
  }

  if (modelId === 'horizontal_friction') {
    const applied = scene.forces.find(f => f.type === 'custom')
    const mu = body?.material?.frictionCoefficient ?? 0
    const mus = body?.material?.staticFrictionCoefficient ?? mu
    return [
      {
        id: 'initial',
        title: '基本参数',
        parameters: [
          { id: 'mass', label: '物块质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5, ...(body === undefined ? {} : { highlights: body.id }) },
          { id: 'force', label: '拉力', symbol: 'F', unit: 'N', value: applied?.vector?.vector.x ?? 0, step: 0.5, highlights: 'force-applied' },
          { id: 'staticFriction', label: '静摩擦系数', symbol: '\\mu_s', unit: '', value: mus, min: 0, step: 0.05, highlights: 'force-friction' },
          { id: 'friction', label: '动摩擦系数', symbol: '\\mu_k', unit: '', value: mu, min: 0, step: 0.05, highlights: 'force-friction' },
          { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1, highlights: 'force-gravity' },
        ],
      },
      { id: 'derived', title: '派生量', derived: frictionDerived(dq) },
    ]
  }

  if (modelId === 'spring_statics') {
    const spring = scene.constraints.find(c => c.type === 'spring')
    const stiffness = Number(spring?.parameters['stiffness'] ?? 0)
    return [
      {
        id: 'initial',
        title: '基本参数',
        parameters: [
          { id: 'mass', label: '悬挂质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5, ...(body === undefined ? {} : { highlights: body.id }) },
          { id: 'springConstant', label: '劲度系数', symbol: 'k', unit: 'N/m', value: stiffness, min: 0.1, step: 1, ...(spring === undefined ? {} : { highlights: spring.id }) },
          { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1, highlights: 'force-gravity' },
        ],
      },
      { id: 'derived', title: '派生量', derived: staticsDerived(dq) },
    ]
  }

  const initial: QuantityParameter[] = [
    { id: 'mass', label: '质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5, ...(body === undefined ? {} : { highlights: body.id }) },
    { id: 'speed', label: '初速度', symbol: 'v_0', unit: 'm/s', value: Math.hypot(velocity.x, velocity.y), min: 0, step: 1, highlights: 'velocity' },
  ]
  if (modelId === 'newton_second_law') {
    const force = scene.forces.find(f => f.type === 'custom')
    initial.push({
      id: 'force',
      label: '合外力',
      symbol: 'F',
      unit: 'N',
      value: force?.vector?.vector.x ?? 0,
      step: 1,
      highlights: 'force-applied',
    })
  }
  /* Apparent weight is physically meaningful exactly when the run has a
     vertical acceleration: N = m(g + a_y) is the support force in the
     accelerating frame, and a_y = −g reads 0 — weightlessness. Horizontal
     runs (a_y = 0) would only ever restate mg, so the row stays hidden. */
  const verticalAcceleration = vector(dq ?? [], 'acceleration')?.y ?? 0
  const apparentWeight = Math.abs(verticalAcceleration) > 0.01
    ? mass * (g + verticalAcceleration)
    : undefined
  return [
    { id: 'initial', title: '基本参数', parameters: initial },
    { id: 'derived', title: '派生量', derived: linearDerived(modelId, dq, apparentWeight) },
  ]
}

const derivedRow = (
  id: string,
  label: string,
  symbol: string,
  value: number | undefined,
  unit: string,
  scale = 1,
): DerivedQuantityView => ({
  id,
  label,
  symbol,
  value: value === undefined ? '—' : fmt(value * scale),
  unit,
})

function projectileDerived(dq: readonly DerivedQuantity[] | undefined): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  const impact = vector(dq, 'impact_velocity')
  return [
    derivedRow('flight', '飞行时间', 't', scalar(dq, 'flight_time'), 's'),
    derivedRow('range', '水平射程', 'R', scalar(dq, 'range'), 'm'),
    derivedRow('maxh', '最大高度', 'H', scalar(dq, 'max_height'), 'm'),
    {
      id: 'impact',
      label: '落地速度',
      symbol: 'v',
      value: impact === undefined ? '—' : fmt(Math.hypot(impact.x, impact.y)),
      unit: 'm/s',
    },
  ]
}

function inclineDerived(dq: readonly DerivedQuantity[] | undefined): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  return [
    derivedRow('N', '支持力', 'N', scalar(dq, 'normal_force'), 'N', 1 ),
    derivedRow('f', '摩擦力', 'f', scalar(dq, 'friction_force'), 'N'),
    derivedRow('gpar', '下滑分量', 'g\\sin\\theta', scalar(dq, 'gravity_parallel'), 'm/s²'),
    derivedRow('a', '沿斜面加速度', 'a', scalar(dq, 'incline_acceleration'), 'm/s²'),
  ]
}

function linearDerived(
  modelId: MechanicsModelId,
  dq: readonly DerivedQuantity[] | undefined,
  apparentWeight?: number,
): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  const rows: DerivedQuantityView[] = [
    derivedRow('a', '加速度', 'a', Math.hypot(vector(dq, 'acceleration')?.x ?? 0, vector(dq, 'acceleration')?.y ?? 0), 'm/s²'),
  ]
  if (apparentWeight !== undefined) {
    rows.push(derivedRow('N', '视重（支持力）', 'N', apparentWeight, 'N'))
  }
  if (modelId === 'newton_second_law') {
    rows.push(derivedRow('F', '合力', 'F', scalar(dq, 'net_force_magnitude'), 'N'))
  } else {
    rows.push(derivedRow('v', '末速度', 'v', scalar(dq, 'final_velocity'), 'm/s'))
    const disp = vector(dq, 'displacement')
    rows.push({
      id: 's',
      label: '位移',
      symbol: 's',
      value: disp === undefined ? '—' : fmt(Math.hypot(disp.x, disp.y)),
      unit: 'm',
    })
  }
  return rows
}

function oscillatorDerived(dq: readonly DerivedQuantity[] | undefined): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  const springForce = vector(dq, 'spring_force')
  return [
    derivedRow('T', '周期', 'T', scalar(dq, 'period'), 's'),
    derivedRow('omega', '角频率', '\\omega', scalar(dq, 'angular_frequency'), 'rad/s'),
    derivedRow('A', '振幅', 'A', scalar(dq, 'amplitude'), 'm'),
    /* spring_force is a vector (the observation layer needs its direction);
       the inspector reports its magnitude. */
    derivedRow('F', '回复力', 'F', springForce === undefined ? undefined : Math.hypot(springForce.x, springForce.y), 'N'),
  ]
}

function pendulumDerived(dq: readonly DerivedQuantity[] | undefined): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  return [
    derivedRow('T', '周期', 'T', scalar(dq, 'period'), 's'),
    derivedRow('theta', '摆角', '\\theta_0', scalar(dq, 'amplitude_deg'), '°'),
    derivedRow('T-force', '摆线张力', 'T', scalar(dq, 'tension'), 'N'),
  ]
}

function frictionDerived(dq: readonly DerivedQuantity[] | undefined): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  return [
    derivedRow('N', '支持力', 'N', scalar(dq, 'normal_force'), 'N'),
    derivedRow('F', '拉力', 'F', scalar(dq, 'applied_force'), 'N'),
    derivedRow('f', '摩擦力', 'f', scalar(dq, 'friction_force'), 'N'),
    derivedRow('fmax', '最大静摩擦', 'f_{max}', scalar(dq, 'static_limit'), 'N'),
    derivedRow('tslip', '滑动时刻', 't_{slip}', scalar(dq, 'slip_time'), 's'),
  ]
}

function staticsDerived(dq: readonly DerivedQuantity[] | undefined): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  const springForce = vector(dq, 'spring_force')
  return [
    derivedRow('dx', '伸长量', '\\Delta x', scalar(dq, 'spring_extension'), 'm'),
    derivedRow('F', '弹力', 'F', springForce === undefined ? undefined : Math.hypot(springForce.x, springForce.y), 'N'),
  ]
}

/* ------------------------------------------------------------------ charts -- */

function chartsOf(
  modelId: MechanicsModelId,
  simulation: SimulationResult,
  model: MechanicsModel,
): readonly ChartSeries[] {
  const samples = simulation.states.map((s) => {
    const obj = bodyStateOf(s, model.bodyId)
    return {
      t: s.time.value,
      x: obj?.position?.vector.x ?? 0,
      y: obj?.position?.vector.y ?? 0,
      vx: obj?.velocity?.vector.x ?? 0,
      vy: obj?.velocity?.vector.y ?? 0,
    }
  })
  const series = (id: string, title: string, yLabel: string, pick: (s: (typeof samples)[number]) => number, role: ChartSeries['role']): ChartSeries => ({
    id,
    title,
    xLabel: 't / s',
    yLabel,
    role,
    points: samples.map(s => ({ t: s.t, value: pick(s) })),
  })

  if (modelId === 'projectile_motion') {
    return [
      series('x-t', 'x - t', 'x / m', s => s.x, 'trajectory'),
      series('y-t', 'y - t', 'y / m', s => s.y, 'trajectory'),
      series('vx-t', 'v_x - t', 'v_x / (m/s)', s => s.vx, 'velocity'),
      series('vy-t', 'v_y - t', 'v_y / (m/s)', s => s.vy, 'velocity'),
    ]
  }
  if (modelId === 'inclined_plane') {
    const a = Math.hypot(model.acceleration.x, model.acceleration.y)
    return [
      series('v-t', '|v| - t', 'v / (m/s)', s => Math.hypot(s.vx, s.vy), 'velocity'),
      { id: 'a-t', title: 'a - t', xLabel: 't / s', yLabel: 'a / (m/s²)', role: 'acceleration', points: samples.map(s => ({ t: s.t, value: a })) },
    ]
  }
  return [
    series('x-t', 'x - t', 'x / m', s => s.x, 'trajectory'),
    series('v-t', '|v| - t', 'v / (m/s)', s => Math.hypot(s.vx, s.vy), 'velocity'),
  ]
}

function tableOf(
  simulation: SimulationResult,
  model: MechanicsModel,
): DataTableView {
  const columns = ['Step', 't / s', 'x / m', 'y / m', 'vₓ', 'v_y']
  const rows = simulation.states
    .filter((_, index) => index % 8 === 0)
    .map((s, index) => {
      const obj = bodyStateOf(s, model.bodyId)
      return {
        step: index,
        values: [
          String(index * 8),
          fmt(s.time.value),
          fmt(obj?.position?.vector.x ?? 0),
          fmt(obj?.position?.vector.y ?? 0),
          fmt(obj?.velocity?.vector.x ?? 0),
          fmt(obj?.velocity?.vector.y ?? 0),
        ],
      }
    })
  return { columns, rows }
}

/* -------------------------------------------------------------- derivation -- */

function derivationOf(
  modelId: MechanicsModelId,
  model: MechanicsModel,
): readonly DerivationStepView[] {
  if (modelId === 'projectile_motion') {
    const m = model as Extract<MechanicsModel, { modelId: 'projectile_motion' }>
    const g = Math.abs(m.gravity.y)
    return [
      {
        id: 'step-1',
        title: '竖直方向：匀加速下落',
        expression: 'h = \\tfrac{1}{2} g t^2',
        detail: '竖直方向只受重力，初始竖直速度决定下落规律。',
        result: { symbol: 't', value: fmt(m.flightTime), unit: 's' },
      },
      {
        id: 'step-2',
        title: '水平方向：匀速运动',
        expression: 'R = v_x \\, t',
        detail: '水平方向不受力，速度守恒。',
        result: { symbol: 'R', value: fmt(m.range), unit: 'm' },
      },
      {
        id: 'step-3',
        title: '最大高度',
        expression: 'H = \\tfrac{v_{y0}^2}{2 g}',
        detail: `g = ${fmt(g)} m/s²`,
        result: { symbol: 'H', value: fmt(m.maxHeight), unit: 'm' },
      },
    ]
  }
  if (modelId === 'inclined_plane') {
    const m = model as Extract<MechanicsModel, { modelId: 'inclined_plane' }>
    return [
      { id: 'step-1', title: '重力分解', expression: 'mg\\sin\\theta,\\; mg\\cos\\theta', detail: '将重力沿斜面和垂直斜面分解。', result: { symbol: 'g\\sin\\theta', value: fmt(m.gravityParallel), unit: 'm/s²' } },
      { id: 'step-2', title: '支持力', expression: 'N = mg\\cos\\theta', result: { symbol: 'N', value: fmt(m.normalForce), unit: 'N' } },
      { id: 'step-3', title: '沿斜面加速度', expression: 'a = g(\\sin\\theta - \\mu\\cos\\theta)', result: { symbol: 'a', value: fmt(Math.hypot(m.acceleration.x, m.acceleration.y)), unit: 'm/s²' } },
    ]
  }
  if (modelId === 'newton_second_law') {
    const m = model as Extract<MechanicsModel, { modelId: 'newton_second_law' }>
    return [
      { id: 'step-1', title: '牛顿第二定律', expression: '\\Sigma F = m a', detail: '合外力等于质量乘以加速度。', result: { symbol: 'a', value: fmt(Math.hypot(m.acceleration.x, m.acceleration.y)), unit: 'm/s²' } },
    ]
  }
  if (modelId === 'spring_oscillator') {
    const m = model as Extract<MechanicsModel, { modelId: 'spring_oscillator' }>
    return [
      { id: 'step-1', title: '回复力', expression: 'F = -k x', detail: '弹力始终指向平衡位置。', result: { symbol: 'k', value: fmt(m.stiffness), unit: 'N/m' } },
      { id: 'step-2', title: '角频率', expression: '\\omega = \\sqrt{k/m}', result: { symbol: '\\omega', value: fmt(m.angularFrequency), unit: 'rad/s' } },
      { id: 'step-3', title: '周期', expression: 'T = 2\\pi\\sqrt{m/k}', detail: '周期只由 m 与 k 决定，与振幅无关。', result: { symbol: 'T', value: fmt(m.period), unit: 's' } },
    ]
  }
  if (modelId === 'simple_pendulum') {
    const m = model as Extract<MechanicsModel, { modelId: 'simple_pendulum' }>
    const g = Math.abs(m.gravity.y)
    return [
      { id: 'step-1', title: '小角近似', expression: '\\sin\\theta \\approx \\theta', detail: `摆角 ${fmt((m.amplitude * 180) / Math.PI)}°，小角下摆动近似简谐。` },
      { id: 'step-2', title: '周期', expression: 'T = 2\\pi\\sqrt{L/g}', detail: `g = ${fmt(g)} m/s²`, result: { symbol: 'T', value: fmt(m.period), unit: 's' } },
    ]
  }
  if (modelId === 'horizontal_friction') {
    const m = model as Extract<MechanicsModel, { modelId: 'horizontal_friction' }>
    return [
      { id: 'step-1', title: '静摩擦阶段', expression: 'f = F \\le \\mu_s N', detail: '拉力未超最大静摩擦时物块静止。', result: { symbol: 'f_{max}', value: fmt(m.staticCoefficient * m.normalForce), unit: 'N' } },
      { id: 'step-2', title: '滑动后', expression: 'a = (F - \\mu_k N)/m', detail: '滑动后摩擦为 μkN，合力恒定。', result: { symbol: 'a', value: fmt(Math.hypot(m.acceleration.x, m.acceleration.y)), unit: 'm/s²' } },
    ]
  }
  if (modelId === 'spring_statics') {
    const m = model as Extract<MechanicsModel, { modelId: 'spring_statics' }>
    return [
      { id: 'step-1', title: '平衡条件', expression: 'k \\Delta x = m g', detail: '静止时弹力与重力相等。', result: { symbol: '\\Delta x', value: fmt(m.extension), unit: 'm' } },
      { id: 'step-2', title: '胡克定律', expression: 'F = k \\Delta x', result: { symbol: 'F', value: fmt(m.springForce), unit: 'N' } },
    ]
  }
  return [
    { id: 'step-1', title: '匀变速直线运动', expression: 'v = v_0 + a t,\\; s = v_0 t + \\tfrac{1}{2} a t^2', detail: '速度线性变化，位移二次变化。' },
  ]
}

/* ------------------------------------------------------------ verification -- */

/** Named physical checks a student can read. */
const VERIFICATION_LABELS: Record<string, string> = {
  horizontal_velocity_constant: '水平速度守恒',
  vertical_acceleration: '竖直加速度 = g',
  impact_y: '落地点约束',
  newton_second_law: 'ΣF = ma 一致',
  velocity_change: '速度变化 = at',
  gravity_parallel: '重力分量 mg·sinθ',
  gravity_normal: '重力分量 mg·cosθ',
  normal_force: '支持力 N = mg·cosθ',
  zero_acceleration: '匀速：加速度为零',
  velocity_conservation: '速度守恒',
  kinematic_consistency: '运动学一致性',
  mechanics_model_supported: '模型前提满足',
  energy_conservation: '机械能守恒',
  period_consistency: '周期 T 一致',
  restoring_force: '回复力 F = −kx',
  rope_length: '摆长不变（在圆弧上）',
  static_friction_balance: '静摩擦平衡 f = F',
  kinetic_friction: '滑动摩擦 a = (F−μkN)/m',
  static_limit: 'μs ≥ μk',
  hooke_equilibrium: '胡克平衡 kΔx = mg',
  equilibrium_position: '悬点位置正确',
}

/**
 * Structural plumbing: schema versions, id uniqueness, unit/dimension and
 * finiteness checks. They must all hold, but naming them individually turns the
 * panel into a dump of engine internals, so they collapse into one row.
 */
const isStructuralCheck = (id: string): boolean =>
  id.startsWith('scene_') ||
  id.startsWith('observable_') ||
  id.startsWith('body_') ||
  id.startsWith('field_') ||
  id.startsWith('particle_') ||
  id.startsWith('mechanics_scene_') ||
  id.startsWith('mechanics_result_') ||
  id.startsWith('coordinate_axes') ||
  id.startsWith('timeline_') ||
  id === 'scene_valid'

function verificationOf(
  verification: SnapshotInput['verification'],
  simulation: SimulationResult,
): readonly VerificationCheckView[] {
  const seen = new Set<string>()
  const physical: VerificationCheckView[] = []
  let structuralTotal = 0
  let structuralPassed = 0

  for (const check of [...simulation.verification.checks, ...verification.checks]) {
    if (seen.has(check.id)) continue
    seen.add(check.id)
    if (isStructuralCheck(check.id)) {
      structuralTotal += 1
      if (check.passed) structuralPassed += 1
      continue
    }
    physical.push({
      id: check.id,
      label: VERIFICATION_LABELS[check.id] ?? check.id,
      status: check.passed ? 'passed' : 'failed',
      ...(check.message === undefined ? {} : { detail: check.message }),
    })
  }

  if (structuralTotal > 0) {
    physical.push({
      id: 'scene-structure',
      label: '场景结构有效',
      status: structuralPassed === structuralTotal ? 'passed' : 'failed',
      detail: `${structuralPassed}/${structuralTotal}`,
    })
  }
  return physical
}

/* ------------------------------------------------------------------ events -- */

function eventsOf(
  modelId: MechanicsModelId,
  model: MechanicsModel,
): readonly TimelineEvent[] {
  if (modelId !== 'projectile_motion') return []
  const m = model as Extract<MechanicsModel, { modelId: 'projectile_motion' }>
  const events: TimelineEvent[] = [{ id: 'launch', time: 0, label: '发射', kind: 'launch' }]
  if (m.launchAngle > 0.01) {
    /* Apex is where vy = 0: t = vy0/g, not flightTime/2 — the two only agree
       when launch and ground are at the same height. The engine's flight time
       covers the extra fall from launch height, so half of it lands the pulse
       after the ball has already passed its top. */
    const gravity = Math.hypot(m.gravity.x, m.gravity.y) || 9.8
    const vy0 = m.initialVelocity.y
    const apexTime = vy0 > 0 ? vy0 / gravity : m.flightTime / 2
    events.push({ id: 'apex', time: apexTime, label: '最高点', kind: 'apex' })
  }
  events.push({ id: 'impact', time: m.flightTime, label: '落地', kind: 'impact' })
  return events
}

/* ------------------------------------------------------------------ utils --- */
