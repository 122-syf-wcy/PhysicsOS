/**
 * LEGACY UI INPUT ONLY.
 *
 * The formal product shell and Magnetic Runtime live in the Harness
 * `ui-physicsos` package. This transition fixture keeps only initial scene and
 * renderer inputs so the historical standalone pages remain renderable. It
 * must not publish derived Physics facts.
 */

export const magneticSceneInput = {
  particle: {
    charge: 1.6e-19,
    mass: 1.67e-27,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 2e6, y: 0, z: 0 },
  },
  field: {
    magneticFluxDensity: 0.5,
    direction: 'into_page' as const,
  },
}

export const magneticSceneMeta = {
  title: '磁场中带电粒子运动',
  subtitle: '旧版过渡 UI · 正式 Runtime 位于 Harness Product Shell',
  status: 'saved' as const,
}

export const sceneTreeFixture = [
  {
    id: 'field',
    label: '磁场区域',
    meta: '初始输入 B = 0.50 T',
    visible: true,
    locked: false,
    children: [{ id: 'uniform-b', label: '匀强磁场 B', visible: true, locked: false }],
  },
  {
    id: 'particle',
    label: '带电粒子',
    meta: '初始输入 q = +1.60e-19 C',
    visible: true,
    locked: false,
    children: [{ id: 'v0', label: '初速度 v₀', meta: '2.00×10⁶ m/s', visible: true }],
  },
  {
    id: 'observables',
    label: '可观测量',
    visible: true,
    children: [
      { id: 'lorentz', label: '洛伦兹力', visible: true },
      { id: 'traj', label: '运动轨迹', visible: true },
    ],
  },
  {
    id: 'view',
    label: '视图辅助',
    visible: true,
    children: [
      { id: 'axes', label: '坐标系', visible: true },
      { id: 'grid', label: '1 cm 网格', visible: true },
    ],
  },
]

export const layerToggles = [
  { id: 'field-dir', label: '场方向', on: true },
  { id: 'field-grid', label: '场网格', on: true },
  { id: 'force', label: '力矢量', on: true },
  { id: 'velocity', label: '速度矢量', on: true },
  { id: 'traj', label: '轨迹', on: true },
  { id: 'ref', label: '参考线', on: false },
] as const

/** Initial inputs only; the legacy page does not execute SceneCommand. */
export const particleInspector = {
  charge: '1.60e-19',
  mass: '1.67e-27',
  kind: '正电荷',
  speed: '2.00e6',
  direction: '90°',
  x: '0.00',
  y: '0.00',
  b: '0.50',
  bDir: '垂直纸面向里',
}

/** Definitions remain visible, but values are withheld outside the formal Runtime host. */
export const observables = [
  { id: 'v', name: '速度', symbol: 'v', unit: 'm/s', value: '—', checked: true },
  { id: 'F', name: '洛伦兹力', symbol: 'F', unit: 'N', value: '—', checked: true },
  { id: 'R', name: '轨道半径', symbol: 'R', unit: 'cm', value: '—', checked: true },
  { id: 'T', name: '周期', symbol: 'T', unit: 's', value: '—', checked: true },
] as const

export const liveMetrics = [
  { label: '时间', symbol: 't', value: '—', unit: 's' },
  { label: '速率', symbol: '|v|', value: '—', unit: 'm/s' },
  { label: '洛伦兹力', symbol: '|F|', value: '—', unit: 'N' },
  { label: '轨道半径', symbol: 'R', value: '—', unit: 'cm' },
] as const

export const timelineFixture = {
  currentLabel: 'Runtime unavailable',
  totalLabel: 'Harness Product Shell',
  progress: 0,
}

export const chartSeries: {
  readonly velocity: readonly number[]
  readonly force: readonly number[]
  readonly radius: readonly number[]
} = {
  velocity: [],
  force: [],
  radius: [],
}

export const dataTableRows: readonly {
  step: number
  t: string
  theta: string
  v: string
  F: string
  R: string
}[] = []

export const agentTips = {
  status: '正式 Physics Runtime 已迁移至 Harness Product Shell',
  formula: '\\text{Harness Runtime}',
  suggestions: ['请从 Harness Web Client 打开物理实验室'],
}
