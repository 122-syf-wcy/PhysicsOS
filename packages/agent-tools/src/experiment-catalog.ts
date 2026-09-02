/**
 * Server-side experiment catalog.
 *
 * The agent creates experiments by id, so the model never has to author a
 * PhysicsScene JSON. Every entry calls the same Scene Factory the Lab's
 * template registry calls, with the same textbook defaults, so an experiment
 * the agent opens for a student is byte-for-byte the one the picker would have
 * built — the two lists are kept in step by the ids they share. Copy is plain
 * data; nothing here computes physics.
 */

import {
  createArchimedesScene,
  createBarMotionScene,
  createCompositeFieldScene,
  createConcaveMirrorScene,
  createConvexLensScene,
  createConvexMirrorScene,
  createCrystalMeltingScene,
  createEchoRangingScene,
  createEmfMeasurementScene,
  createFluxChangeScene,
  createHeatCapacityComparisonScene,
  createLeverBalanceScene,
  createMagneticScene,
  createMassSpectrometerScene,
  createMechanicsScene,
  createMixedCircuitScene,
  createMultiRegionFieldScene,
  createParallelCircuitScene,
  createParallelPlateScene,
  createPlaneMirrorScene,
  createPointChargeScene,
  createRheostatCircuitScene,
  createSeriesCircuitScene,
  createStandingWaveScene,
  createTravellingWaveScene,
  createVelocitySelectorScene,
  createWaveInterferenceScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

export type ExperimentDomain =
  | 'mechanics'
  | 'electric'
  | 'magnetic'
  | 'circuit'
  | 'composite'
  | 'optics'
  | 'acoustics'
  | 'fluid'
  | 'thermal'
  | 'induction'
  | 'wave'

export type ExperimentStage = 'junior' | 'senior'

export interface ExperimentCatalogEntry {
  readonly id: string
  readonly domain: ExperimentDomain
  readonly stage: ExperimentStage
  readonly title: string
  /** One-line description a model can quote to a student. */
  readonly description: string
  readonly build: (sceneId: string, title: string) => PhysicsScene
}

const g = 9.8

/** Retitle a factory scene without touching any physical fact. */
const titled = (scene: PhysicsScene, title: string): PhysicsScene => ({
  ...scene,
  metadata: { ...scene.metadata, title },
})

export const EXPERIMENT_CATALOG: readonly ExperimentCatalogEntry[] = [
  /* ---------------------------------------------------------------- mechanics -- */
  {
    id: 'uniform-linear',
    domain: 'mechanics',
    stage: 'junior',
    title: '匀速直线运动',
    description: '恒定速度 4 m/s，a = 0；观察 x–t 与 v–t 图像。',
    build: (sceneId, title) =>
      createMechanicsScene({
        sceneId,
        model: 'uniform_linear_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 4, y: 0, z: 0 },
        title,
      }),
  },
  {
    id: 'uniform-acceleration',
    domain: 'mechanics',
    stage: 'senior',
    title: '匀变速直线运动',
    description: '初速度 2 m/s、加速度 1.5 m/s²；v = v₀ + at 与 x = v₀t + ½at²。',
    build: (sceneId, title) =>
      createMechanicsScene({
        sceneId,
        model: 'uniformly_accelerated_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 2, y: 0, z: 0 },
        acceleration: { x: 1.5, y: 0, z: 0 },
        title,
      }),
  },
  {
    id: 'projectile-horizontal',
    domain: 'mechanics',
    stage: 'senior',
    title: '平抛运动',
    description: '从 20 m 高以 10 m/s 水平抛出；水平匀速、竖直自由落体。',
    build: (sceneId, title) =>
      createMechanicsScene({
        sceneId,
        model: 'projectile_motion',
        mass: 1,
        position: { x: 0, y: 20, z: 0 },
        velocity: { x: 10, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        groundY: 0,
        launchAngle: 0,
        title,
      }),
  },
  {
    id: 'projectile-oblique',
    domain: 'mechanics',
    stage: 'senior',
    title: '斜抛运动',
    description: '20 m/s、抛射角 40°；射程、最大高度与飞行时间。',
    build: (sceneId, title) =>
      createMechanicsScene({
        sceneId,
        model: 'projectile_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: {
          x: 20 * Math.cos((40 * Math.PI) / 180),
          y: 20 * Math.sin((40 * Math.PI) / 180),
          z: 0,
        },
        gravity: { x: 0, y: -g, z: 0 },
        groundY: 0,
        launchAngle: 40,
        title,
      }),
  },
  {
    id: 'newton-second-law',
    domain: 'mechanics',
    stage: 'senior',
    title: '牛顿第二定律',
    description: '2 kg 物块受 10 N 水平力；F = ma。',
    build: (sceneId, title) =>
      createMechanicsScene({
        sceneId,
        model: 'newton_second_law',
        mass: 2,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        appliedForce: { x: 10, y: 0, z: 0 },
        title,
      }),
  },
  {
    id: 'incline',
    domain: 'mechanics',
    stage: 'senior',
    title: '斜面运动',
    description: '30° 斜面、μ = 0.2 的 2 kg 物块；受力分解与加速度。',
    build: (sceneId, title) =>
      createMechanicsScene({
        sceneId,
        model: 'inclined_plane',
        mass: 2,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        inclineAngle: 30,
        frictionCoefficient: 0.2,
        title,
      }),
  },
  {
    id: 'lever-balance',
    domain: 'mechanics',
    stage: 'junior',
    title: '探究杠杆的平衡条件',
    description: '支点在中间的第一类杠杆，两侧钩码；F₁l₁ = F₂l₂。',
    build: (sceneId, title) => createLeverBalanceScene({ sceneId, title }),
  },

  /* ----------------------------------------------------------------- electric -- */
  {
    id: 'point-charge',
    domain: 'electric',
    stage: 'senior',
    title: '点电荷的电场',
    description: '5 μC 点电荷，20 cm 处的场强与电场力；E = kq/r²。',
    build: (sceneId, title) =>
      createPointChargeScene({
        sceneId,
        charges: [{ id: 'source-1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
        samplePoint: { x: 0.2, y: 0, z: 0 },
        title,
      }),
  },
  {
    id: 'multi-point-charge',
    domain: 'electric',
    stage: 'senior',
    title: '两个点电荷的叠加场',
    description: '±4 μC 等量异种电荷相距 20 cm；中垂线上的合场与等势线。',
    build: (sceneId, title) =>
      createPointChargeScene({
        sceneId,
        charges: [
          { id: 'source-1', charge: 4e-6, position: { x: -0.1, y: 0, z: 0 } },
          { id: 'source-2', charge: -4e-6, position: { x: 0.1, y: 0, z: 0 } },
        ],
        samplePoint: { x: 0, y: 0.1, z: 0 },
        title,
      }),
  },
  {
    id: 'parallel-plate',
    domain: 'electric',
    stage: 'senior',
    title: '平行板电场偏转',
    description: '带电粒子垂直进入平行板间的匀强电场，类平抛偏转。',
    build: (sceneId, title) => createParallelPlateScene({ sceneId, title }),
  },

  /* ----------------------------------------------------------------- magnetic -- */
  {
    id: 'magnetic-circular',
    domain: 'magnetic',
    stage: 'senior',
    title: '磁场中的带电粒子运动',
    description: '质子以 2×10⁶ m/s 垂直进入 0.5 T 匀强磁场；r = mv/(qB)、T = 2πm/(qB)。',
    build: (sceneId, title) =>
      createMagneticScene({
        sceneId,
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 2e6, y: 0, z: 0 },
        magneticFieldStrength: 0.5,
        magneticFieldDirection: 'into_page',
        title,
      }),
  },

  /* ------------------------------------------------------------------ circuit -- */
  {
    id: 'series-circuit',
    domain: 'circuit',
    stage: 'junior',
    title: '串联电路',
    description: '6 V 电源串联 10 Ω 与 20 Ω；电流处处相等、电压分配。',
    build: (sceneId, title) => createSeriesCircuitScene({ sceneId, title }),
  },
  {
    id: 'parallel-circuit',
    domain: 'circuit',
    stage: 'junior',
    title: '并联电路',
    description: '并联支路电压相等、干路电流等于支路电流之和。',
    build: (sceneId, title) => createParallelCircuitScene({ sceneId, title }),
  },
  {
    id: 'mixed-circuit',
    domain: 'circuit',
    stage: 'junior',
    title: '混联电路',
    description: '串并联混合网络的等效电阻与各支路电流。',
    build: (sceneId, title) => createMixedCircuitScene({ sceneId, title }),
  },
  {
    id: 'rheostat-circuit',
    domain: 'circuit',
    stage: 'junior',
    title: '滑动变阻器调节电流',
    description: '滑片 8 秒准静态扫描，电流表与电压表读数随之联动。',
    build: (sceneId, title) => createRheostatCircuitScene({ sceneId, title }),
  },
  {
    id: 'emf-measurement',
    domain: 'circuit',
    stage: 'senior',
    title: '测电源电动势与内阻',
    description: 'U = E − I·r 伏安法经典实验；断开开关时电压表直读电动势。',
    build: (sceneId, title) => createEmfMeasurementScene({ sceneId, title }),
  },

  /* ------------------------------------------------------------------- optics -- */
  {
    id: 'plane-mirror',
    domain: 'optics',
    stage: 'junior',
    title: '平面镜成像',
    description: '像与物等大、到镜面距离相等的虚像；光屏接不到像。',
    build: (sceneId, title) => titled(createPlaneMirrorScene({ sceneId }), title),
  },
  {
    id: 'convex-lens',
    domain: 'optics',
    stage: 'junior',
    title: '凸透镜成像规律',
    description: 'f = 10 cm、u = 30 cm 起步；物距扫过 2f 与 f 复现成像规律表。',
    build: (sceneId, title) => titled(createConvexLensScene({ sceneId }), title),
  },
  {
    id: 'concave-mirror',
    domain: 'optics',
    stage: 'junior',
    title: '凹面镜成像',
    description: '反射会聚，实像成在镜前；f 取负即变凸面镜。',
    build: (sceneId, title) => titled(createConcaveMirrorScene({ sceneId }), title),
  },
  {
    id: 'convex-mirror',
    domain: 'optics',
    stage: 'junior',
    title: '凸面镜后视镜',
    description: 'f = −10 cm，任何物距都成正立缩小的虚像。',
    build: (sceneId, title) => titled(createConvexMirrorScene({ sceneId }), title),
  },

  /* ---------------------------------------------------------------- acoustics -- */
  {
    id: 'echo-ranging',
    domain: 'acoustics',
    stage: 'junior',
    title: '回声测距',
    description: '峭壁 340 m 外、声速 340 m/s，往返 2 s；d = v·t/2。',
    build: (sceneId, title) => titled(createEchoRangingScene({ sceneId }), title),
  },

  /* -------------------------------------------------------------------- fluid -- */
  {
    id: 'buoyancy',
    domain: 'fluid',
    stage: 'junior',
    title: '探究浮力的大小',
    description: '称重法 F_浮 = G − F_示；铝块缓慢浸入水中，浸没后与深度无关。',
    build: (sceneId, title) => titled(createArchimedesScene({ sceneId }), title),
  },

  /* ------------------------------------------------------------------ thermal -- */
  {
    id: 'crystal-melting',
    domain: 'thermal',
    stage: 'junior',
    title: '探究晶体的熔化过程',
    description: '100 g 冰以 50 W 加热；熔化阶段吸热而温度不变。',
    build: (sceneId, title) => titled(createCrystalMeltingScene({ sceneId }), title),
  },
  {
    id: 'heat-capacity-comparison',
    domain: 'thermal',
    stage: 'junior',
    title: '比较不同物质的吸热能力',
    description: '等质量的水与煤油同功率加热；温升与比热容成反比。',
    build: (sceneId, title) => titled(createHeatCapacityComparisonScene({ sceneId }), title),
  },

  /* ---------------------------------------------------------------- composite -- */
  {
    id: 'velocity-selector',
    domain: 'composite',
    stage: 'senior',
    title: '速度选择器',
    description: 'E ⟂ B 筛选 v = E/B 的粒子；改 v₀ 观察偏转。',
    build: (sceneId, title) =>
      createVelocitySelectorScene({
        sceneId,
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        regionWidth: 0.4,
        regionHeight: 0.2,
        title,
      }),
  },
  {
    id: 'mass-spectrometer',
    domain: 'composite',
    stage: 'senior',
    title: '质谱仪基础模型',
    description: '选择器 → 无场过渡 → 磁偏转；r = mv/(qB) 由 q/m 决定。',
    build: (sceneId, title) =>
      createMassSpectrometerScene({
        sceneId,
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 200,
        electricFieldDirection: 'up',
        magneticFieldStrength: 2.0e-3,
        magneticFieldOrientation: 'out_of_page',
        deflectionWidth: 1.2,
        deflectionHeight: 1.2,
        duration: 2.4e-5,
        title,
      }),
  },
  {
    id: 'composite-eb',
    domain: 'composite',
    stage: 'senior',
    title: '电场 + 磁场复合运动',
    description: 'F = qE + qv×B 的正交场运动。',
    build: (sceneId, title) =>
      createCompositeFieldScene({
        sceneId,
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        title,
      }),
  },
  {
    id: 'multi-region-field',
    domain: 'composite',
    stage: 'senior',
    title: '多场区带电粒子运动',
    description: '电场区 → 磁场区 → 复合场区依次穿越。',
    build: (sceneId, title) =>
      createMultiRegionFieldScene({
        sceneId,
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        title,
      }),
  },

  /* ---------------------------------------------------------------- induction -- */
  {
    id: 'induction-bar-motion',
    domain: 'induction',
    stage: 'senior',
    title: '导体棒切割磁感线',
    description: 'E = BLv，棒匀速滑动，感应电流恒定。',
    build: (sceneId, title) => createBarMotionScene({ sceneId, title }),
  },
  {
    id: 'induction-flux-change',
    domain: 'induction',
    stage: 'senior',
    title: '磁通量变化产生感应电动势',
    description: 'E = −dΦ/dt，楞次定律定方向。',
    build: (sceneId, title) => createFluxChangeScene({ sceneId, title }),
  },

  /* --------------------------------------------------------------------- wave -- */
  {
    id: 'wave-travelling',
    domain: 'wave',
    stage: 'junior',
    title: '绳上的简谐横波',
    description: 'v = λf，波形平移而质点只振动不迁移。',
    build: (sceneId, title) => createTravellingWaveScene({ sceneId, title }),
  },
  {
    id: 'wave-interference',
    domain: 'wave',
    stage: 'senior',
    title: '双源干涉与波的叠加',
    description: '路程差 Δ = nλ 加强、(n+½)λ 减弱，合振幅 |2A·cos(πΔ/λ)|。',
    build: (sceneId, title) => createWaveInterferenceScene({ sceneId, title }),
  },
  {
    id: 'wave-standing',
    domain: 'wave',
    stage: 'senior',
    title: '两端固定的弦驻波',
    description: 'L = nλ/2、f_n = n·v/2L；波节静止、波腹最大。',
    build: (sceneId, title) => createStandingWaveScene({ sceneId, title }),
  },
]

export const findExperiment = (id: string): ExperimentCatalogEntry | undefined =>
  EXPERIMENT_CATALOG.find((entry) => entry.id === id)
