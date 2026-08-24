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

/* Numeric formatting shared with the bridge. */
const fmt = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e5)) return value.toExponential(digits)
  return value.toFixed(digits)
}

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
  const dq = simulation.derivedQuantities

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
      { id: 'height', label: '初始高度', symbol: 'h', unit: 'm', value: position.y, min: 0, step: 1, highlights: 'dim-height' },
      { id: 'speed', label: '初速度', symbol: 'v_0', unit: 'm/s', value: speed, min: 0, step: 1, highlights: 'v' },
      { id: 'angle', label: '抛射角', symbol: '\\theta', unit: '°', value: angle, min: 0, max: 90, step: 1, highlights: 'angle-launch' },
      { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1, highlights: 'g' },
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
      { id: 'mass', label: '质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5, highlights: 'mg' },
      { id: 'angle', label: '倾角', symbol: '\\theta', unit: '°', value: angle, min: 1, max: 89, step: 1, highlights: 'angle-incline' },
      { id: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', value: g, min: 0.1, step: 0.1 },
      { id: 'friction', label: '摩擦系数', symbol: '\\mu', unit: '', value: mu, min: 0, step: 0.05, highlights: 'f' },
    ]
    return [
      { id: 'initial', title: '基本参数', parameters: initial },
      { id: 'derived', title: '派生量', derived: inclineDerived(dq) },
    ]
  }

  const initial: QuantityParameter[] = [
    { id: 'mass', label: '质量', symbol: 'm', unit: 'kg', value: mass, min: 0.1, step: 0.5 },
    { id: 'speed', label: '初速度', symbol: 'v_0', unit: 'm/s', value: Math.hypot(velocity.x, velocity.y), min: 0, step: 1, highlights: 'v' },
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
    })
  }
  return [
    { id: 'initial', title: '基本参数', parameters: initial },
    { id: 'derived', title: '派生量', derived: linearDerived(modelId, dq) },
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
): readonly DerivedQuantityView[] {
  if (dq === undefined) return []
  const rows: DerivedQuantityView[] = [
    derivedRow('a', '加速度', 'a', Math.hypot(vector(dq, 'acceleration')?.x ?? 0, vector(dq, 'acceleration')?.y ?? 0), 'm/s²'),
  ]
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
    events.push({ id: 'apex', time: m.flightTime / 2, label: '最高点', kind: 'apex' })
  }
  events.push({ id: 'impact', time: m.flightTime, label: '落地', kind: 'impact' })
  return events
}

/* ------------------------------------------------------------------ utils --- */
