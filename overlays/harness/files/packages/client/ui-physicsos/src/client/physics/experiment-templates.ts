/**
 * Experiment template registry.
 *
 * The single source of experiment templates every entry point reads — sidebar
 * "新建", the Home quick action and the Lab empty state. A template is a small
 * input for a Scene Factory plus the locale keys the chooser shows; selecting
 * one builds a REAL {@link PhysicsScene} and hands it to the Lab, so there is
 * one shared PhysicsWorkspace shell and one canvas, not a workspace per
 * experiment.
 *
 * Copy lives in {@link locales.ts}, so `title`/`hint` here are KEYS, never
 * sentences: the same template reads correctly in zh and en.
 *
 * Cyclotron is intentionally absent from the selectable templates: the composite
 * engine models static uniform regions, not a time-dependent alternating field,
 * so a cyclotron here would be a fake. It is surfaced only as "即将支持".
 */

import {
  createArchimedesScene,
  createCompositeFieldScene,
  createConcaveMirrorScene,
  createConvexLensScene,
  createConvexMirrorScene,
  createEchoRangingScene,
  createEmfMeasurementScene,
  createMassSpectrometerScene,
  createMechanicsScene,
  createMixedCircuitScene,
  createMultiRegionFieldScene,
  createMagneticScene,
  createParallelCircuitScene,
  createParallelPlateScene,
  createPlaneMirrorScene,
  createPointChargeScene,
  createRheostatCircuitScene,
  createSeriesCircuitScene,
  createVelocitySelectorScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import type { ReactElement } from 'react'

import type { PhysicsosKey } from '../locales.ts'
import type { PhysicsIconProps } from '../icons/physics-icons.tsx'
import {
  IconBuoyancy,
  IconBulb,
  IconCircuitParallel,
  IconCircuitSeries,
  IconCompositeField,
  IconConcaveMirror,
  IconConvexLens,
  IconConvexMirror,
  IconEchoRanging,
  IconEmfMeasure,
  IconInclinedPlane,
  IconKinematics,
  IconLever,
  IconMagneticCircle,
  IconMassSpectrometer,
  IconMeasurement,
  IconNewtonLaw,
  IconParallelPlate,
  IconPlaneMirror,
  IconPointCharge,
  IconProjectileHorizontal,
  IconProjectileOblique,
  IconRheostat,
  IconTime,
  IconUniformElectric,
  IconVelocity,
  IconVelocitySelector,
} from '../icons/physics-icons.tsx'

/** Domains a template belongs to, mirrored from the Lab runtime dispatch. */
export type ExperimentDomain =
  | 'mechanics'
  | 'electric'
  | 'magnetic'
  | 'circuit'
  | 'composite'
  | 'optics'
  | 'acoustics'
  | 'fluid'

/**
 * School stage a template belongs to (学段). Junior covers the 初中 curriculum
 * (速度与平均速度、串并联、欧姆定律、电功率…), senior the 高中 one (抛体、场、
 * 电动势内阻、复合场…). Every template declares its stage explicitly so the
 * library can partition honestly — no heuristic on titles or tags.
 */
export type ExperimentStage = 'junior' | 'senior'

/** A pickable experiment. */
export interface ExperimentTemplate {
  readonly id: string
  readonly domain: ExperimentDomain
  /** 学段 the experiment is taught in; drives the library's stage partition. */
  readonly stage: ExperimentStage
  /** Locale key for the experiment name. */
  readonly label: PhysicsosKey
  /** Locale key for the one-line description shown under the name. */
  readonly hint: PhysicsosKey
  readonly icon: (props: PhysicsIconProps) => ReactElement
  readonly tags: readonly string[]
  /** Build the real scene for this experiment. Stamps a fresh id per call. */
  readonly createScene: (title: string) => { sceneId: string; scene: PhysicsScene }
  /** True when the runtime cannot yet model this experiment honestly. */
  readonly comingSoon?: true
}

export interface ExperimentTemplateGroup {
  readonly id: ExperimentDomain
  /** Locale key for the group (tab) heading. */
  readonly label: PhysicsosKey
  readonly templates: readonly ExperimentTemplate[]
}

const g = 9.8

/* Each scene is stamped with a fresh id at creation time, so two students (or
   two creations by one student) never share a scene identity — the Lab keys its
   runtime on domain + scene id + revision, and a fixed id would silently keep
   the first runtime alive across recreations. The serial guards the same-
   millisecond double-create. */
let stampSerial = 0
const stampId = (base: string): string =>
  `${base}-${Date.now().toString(36)}-${(stampSerial++).toString(36)}`

/* ----------------------------------------------------------------- mechanics -- */

const mechanicsTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'uniform-linear',
    domain: 'mechanics',
    stage: 'junior',
    label: 'lab.template.uniformLinear',
    hint: 'lab.template.uniformLinear.hint',
    icon: IconVelocity,
    tags: ['运动学'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-uniform-linear'),
        model: 'uniform_linear_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 4, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'average-speed',
    domain: 'mechanics',
    stage: 'junior',
    label: 'lab.template.averageSpeed',
    hint: 'lab.template.averageSpeed.hint',
    icon: IconTime,
    tags: ['运动学', '初中', '平均速度'],
    createScene: (title) => {
      /* 初中「测平均速度」：小车从静止沿缓坡滑下，全程与前后半程分别计
         v̄ = s/t。缓加速度让数字落在停表能读的量级。 */
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-average-speed'),
        model: 'uniformly_accelerated_motion',
        mass: 0.5,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        acceleration: { x: 0.4, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'uniform-acceleration',
    domain: 'mechanics',
    stage: 'senior',
    label: 'lab.template.uniformAcceleration',
    hint: 'lab.template.uniformAcceleration.hint',
    icon: IconKinematics,
    tags: ['运动学'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-uniform-acceleration'),
        model: 'uniformly_accelerated_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 2, y: 0, z: 0 },
        acceleration: { x: 1.5, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'projectile-horizontal',
    domain: 'mechanics',
    stage: 'senior',
    label: 'lab.template.projectileHorizontal',
    hint: 'lab.template.projectileHorizontal.hint',
    icon: IconProjectileHorizontal,
    tags: ['抛体'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-projectile-horizontal'),
        model: 'projectile_motion',
        mass: 1,
        position: { x: 0, y: 20, z: 0 },
        velocity: { x: 10, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        groundY: 0,
        launchAngle: 0,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'projectile-oblique',
    domain: 'mechanics',
    stage: 'senior',
    label: 'lab.template.projectileOblique',
    hint: 'lab.template.projectileOblique.hint',
    icon: IconProjectileOblique,
    tags: ['抛体'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-projectile-oblique'),
        model: 'projectile_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 20 * Math.cos((40 * Math.PI) / 180), y: 20 * Math.sin((40 * Math.PI) / 180), z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        groundY: 0,
        launchAngle: 40,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'newton-second-law',
    domain: 'mechanics',
    stage: 'senior',
    label: 'lab.template.newton',
    hint: 'lab.template.newton.hint',
    icon: IconNewtonLaw,
    tags: ['力与运动'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-newton-second-law'),
        model: 'newton_second_law',
        mass: 2,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        appliedForce: { x: 10, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'incline',
    domain: 'mechanics',
    stage: 'senior',
    label: 'lab.template.incline',
    hint: 'lab.template.incline.hint',
    icon: IconInclinedPlane,
    tags: ['力与运动'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-incline'),
        model: 'inclined_plane',
        mass: 2,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        inclineAngle: 30,
        frictionCoefficient: 0.2,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'lever-balance',
    domain: 'mechanics',
    stage: 'junior',
    label: 'lab.template.leverBalance',
    hint: 'lab.template.leverBalance.hint',
    icon: IconLever,
    tags: ['力学', '杠杆', '初中'],
    /* 杠杆是刚体的力矩平衡；现有力学引擎解的是质点运动，硬套会算错，
       所以按回旋加速器的先例标记「即将支持」而不是造假。 */
    comingSoon: true,
    createScene: () => {
      throw new Error('lever balance needs a rigid-body statics engine')
    },
  },
]

/* ------------------------------------------------------------------ electric -- */

const electricTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'point-charge',
    domain: 'electric',
    stage: 'senior',
    label: 'lab.template.pointCharge',
    hint: 'lab.template.pointCharge.hint',
    icon: IconPointCharge,
    tags: ['电场'],
    createScene: (title) => {
      const scene = createPointChargeScene({
        sceneId: stampId('electric-point-charge'),
        charges: [{ id: 'source-1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
        samplePoint: { x: 0.2, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'multi-point-charge',
    domain: 'electric',
    stage: 'senior',
    label: 'lab.template.multiPointCharge',
    hint: 'lab.template.multiPointCharge.hint',
    icon: IconPointCharge,
    tags: ['电场', '叠加'],
    createScene: (title) => {
      const scene = createPointChargeScene({
        sceneId: stampId('electric-multi-point-charge'),
        charges: [
          { id: 'source-1', charge: 4e-6, position: { x: -0.1, y: 0, z: 0 } },
          { id: 'source-2', charge: -4e-6, position: { x: 0.1, y: 0, z: 0 } },
        ],
        samplePoint: { x: 0, y: 0.1, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'uniform-electric',
    domain: 'electric',
    stage: 'senior',
    label: 'lab.template.uniformElectric',
    hint: 'lab.template.uniformElectric.hint',
    icon: IconUniformElectric,
    tags: ['电场'],
    createScene: (title) => {
      const scene = createPointChargeScene({
        sceneId: stampId('electric-uniform-particle'),
        charges: [{ id: 'source-1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
        probe: { id: 'probe-1', charge: -1.6e-19, mass: 9.11e-31, position: { x: 0.2, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'parallel-plate',
    domain: 'electric',
    stage: 'senior',
    label: 'lab.template.parallelPlate',
    hint: 'lab.template.parallelPlate.hint',
    icon: IconParallelPlate,
    tags: ['电场', '偏转'],
    createScene: (title) => {
      const scene = createParallelPlateScene({
        sceneId: stampId('electric-parallel-plate'),
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
]

/* ------------------------------------------------------------------ magnetic -- */

const magneticTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'magnetic-circular',
    domain: 'magnetic',
    stage: 'senior',
    label: 'lab.template.magnetic',
    hint: 'lab.template.magnetic.hint',
    icon: IconMagneticCircle,
    tags: ['磁场'],
    createScene: (title) => {
      const scene = createMagneticScene({
        sceneId: stampId('magnetic-circular'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 2e6, y: 0, z: 0 },
        magneticFieldStrength: 0.5,
        magneticFieldDirection: 'into_page',
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
]

/* ------------------------------------------------------------------- circuit -- */

const circuitTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'series-circuit',
    domain: 'circuit',
    stage: 'junior',
    label: 'lab.template.seriesCircuit',
    hint: 'lab.template.seriesCircuit.hint',
    icon: IconCircuitSeries,
    tags: ['电路', '串联'],
    createScene: (title) => {
      const scene = createSeriesCircuitScene({
        sceneId: stampId('circuit-series'),
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'parallel-circuit',
    domain: 'circuit',
    stage: 'junior',
    label: 'lab.template.parallelCircuit',
    hint: 'lab.template.parallelCircuit.hint',
    icon: IconCircuitParallel,
    tags: ['电路', '并联'],
    createScene: (title) => {
      const scene = createParallelCircuitScene({
        sceneId: stampId('circuit-parallel'),
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'mixed-circuit',
    domain: 'circuit',
    stage: 'junior',
    label: 'lab.template.mixedCircuit',
    hint: 'lab.template.mixedCircuit.hint',
    icon: IconCircuitParallel,
    tags: ['电路', '混联'],
    createScene: (title) => {
      const scene = createMixedCircuitScene({
        sceneId: stampId('circuit-mixed'),
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'rheostat-circuit',
    domain: 'circuit',
    stage: 'junior',
    label: 'lab.template.rheostat',
    hint: 'lab.template.rheostat.hint',
    icon: IconRheostat,
    tags: ['电路', '动态电路'],
    createScene: (title) => {
      const scene = createRheostatCircuitScene({
        sceneId: stampId('circuit-rheostat'),
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'va-resistance',
    domain: 'circuit',
    stage: 'junior',
    label: 'lab.template.vaResistance',
    hint: 'lab.template.vaResistance.hint',
    icon: IconMeasurement,
    tags: ['电路', '欧姆定律', '初中', '伏安法'],
    createScene: (title) => {
      /* 伏安法测电阻：定值电阻扮演待测 Rx，滑动变阻器移动工作点，读出多组
         U、I 由 R = U/I 求值 —— 与教材同一套接线。 */
      const scene = createRheostatCircuitScene({
        sceneId: stampId('circuit-va-resistance'),
        voltage: 3,
        fixedResistance: 5,
        totalResistance: 20,
        sliderPosition: 0.25,
        title,
        description: '移动滑片改变工作点，读出多组 U、I，由 R = U/I 求出待测电阻。',
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'bulb-power',
    domain: 'circuit',
    stage: 'junior',
    label: 'lab.template.bulbPower',
    hint: 'lab.template.bulbPower.hint',
    icon: IconBulb,
    tags: ['电路', '电功率', '初中'],
    createScene: (title) => {
      /* 测小灯泡电功率：灯泡按额定 2.5 V / 0.3 A 的定值电阻近似（R ≈ 8.3 Ω）。
         引擎解线性电阻网络，灯丝温度非线性不在模型内 —— P = UI 的测法本身
         不受影响，读数即功率。 */
      const scene = createRheostatCircuitScene({
        sceneId: stampId('circuit-bulb-power'),
        voltage: 4.5,
        fixedResistance: 8.3,
        totalResistance: 20,
        sliderPosition: 0.3,
        title,
        description: '调节滑片让灯泡电压达到额定值，P = UI 直接读出实际电功率。',
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'emf-measurement',
    domain: 'circuit',
    stage: 'senior',
    label: 'lab.template.emfMeasurement',
    hint: 'lab.template.emfMeasurement.hint',
    icon: IconEmfMeasure,
    tags: ['电路', '电动势', '内阻'],
    createScene: (title) => {
      const scene = createEmfMeasurementScene({
        sceneId: stampId('circuit-emf'),
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
]

/* -------------------------------------------------------------------- optics -- */

const opticsTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'plane-mirror',
    domain: 'optics',
    stage: 'junior',
    label: 'lab.template.planeMirror',
    hint: 'lab.template.planeMirror.hint',
    icon: IconPlaneMirror,
    tags: ['光学', '初中', '平面镜'],
    createScene: (title) => {
      /* 探究平面镜成像特点：蜡烛在玻璃板前 10 cm，光屏一开始就摆在像的位置
         (镜后 10 cm) —— 「光屏上接不到像」从第一帧就可观察，虚像由此立住。 */
      const scene = createPlaneMirrorScene({
        sceneId: stampId('optics-plane-mirror'),
      })
      return {
        sceneId: String(scene.id),
        scene: { ...scene, metadata: { ...scene.metadata, title } },
      }
    },
  },
  {
    id: 'convex-lens',
    domain: 'optics',
    stage: 'junior',
    label: 'lab.template.convexLens',
    hint: 'lab.template.convexLens.hint',
    icon: IconConvexLens,
    tags: ['光学', '初中', '凸透镜', '成像规律'],
    createScene: (title) => {
      /* 凸透镜成像规律：f = 10 cm、u = 30 cm 起步（u > 2f，倒立缩小实像），
         光屏默认停在清晰像平面。学生把 u 扫过 2f、f 就复现整张成像规律表。 */
      const scene = createConvexLensScene({
        sceneId: stampId('optics-convex-lens'),
      })
      return {
        sceneId: String(scene.id),
        scene: { ...scene, metadata: { ...scene.metadata, title } },
      }
    },
  },
  {
    id: 'concave-mirror',
    domain: 'optics',
    stage: 'junior',
    label: 'lab.template.concaveMirror',
    hint: 'lab.template.concaveMirror.hint',
    icon: IconConcaveMirror,
    tags: ['光学', '初中', '凹面镜', '球面镜'],
    createScene: (title) => {
      /* 凹面镜成像：f = 10 cm、u = 30 cm 起步（u > 2f，倒立缩小实像成在镜
         前），光屏默认停在镜前的清晰像平面。u 扫过 2f、f 复现成像规律表；
         把 f 拖成负值即变凸面镜（永远正立缩小的虚像）。 */
      const scene = createConcaveMirrorScene({
        sceneId: stampId('optics-concave-mirror'),
      })
      return {
        sceneId: String(scene.id),
        scene: { ...scene, metadata: { ...scene.metadata, title } },
      }
    },
  },
  {
    id: 'convex-mirror',
    domain: 'optics',
    stage: 'junior',
    label: 'lab.template.convexMirror',
    hint: 'lab.template.convexMirror.hint',
    icon: IconConvexMirror,
    tags: ['光学', '初中', '凸面镜', '后视镜', '球面镜'],
    createScene: (title) => {
      /* 凸面镜后视镜：f = −10 cm、后车在 30 cm 外。发散镜没有分区可扫 ——
         无论物距多远都是正立、缩小的虚像，光屏永远接不到。学生拖物距验证
         「像变小但视野变大」，正是后视镜「物体比看起来更近」的由来。 */
      const scene = createConvexMirrorScene({
        sceneId: stampId('optics-convex-mirror'),
      })
      return {
        sceneId: String(scene.id),
        scene: { ...scene, metadata: { ...scene.metadata, title } },
      }
    },
  },
]

/* ----------------------------------------------------------------- acoustics -- */

const acousticsTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'echo-ranging',
    domain: 'acoustics',
    stage: 'junior',
    label: 'lab.template.echoRanging',
    hint: 'lab.template.echoRanging.hint',
    icon: IconEchoRanging,
    tags: ['声学', '初中', '回声', '声速'],
    createScene: (title) => {
      /* 回声测距：峭壁在 340 m 外、15 ℃ 空气声速 340 m/s —— 往返恰好 2.0 s，
         正是教材例题的数字。学生改峭壁距离或换介质，重测回声时间验证
         d = v·t/2。 */
      const scene = createEchoRangingScene({
        sceneId: stampId('acoustics-echo-ranging'),
      })
      return {
        sceneId: String(scene.id),
        scene: { ...scene, metadata: { ...scene.metadata, title } },
      }
    },
  },
]

/* --------------------------------------------------------------------- fluid -- */

const fluidTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'buoyancy',
    domain: 'fluid',
    stage: 'junior',
    label: 'lab.template.buoyancy',
    hint: 'lab.template.buoyancy.hint',
    icon: IconBuoyancy,
    tags: ['浮力', '初中', '阿基米德原理', '称重法'],
    createScene: (title) => {
      /* 探究浮力的大小：100 cm³ / 270 g 的铝块（ρ = 2.7 g/cm³）在水里缓慢下放。
         G = 2.646 N，全浸后 F_浮 = 0.98 N、读数 1.666 N —— 每个数都是整数级。
         继续往深处放读数不变，这就是「浮力与深度无关」；把质量调到 60 g 物块
         就浮起来，换盐水浮力随之变大。 */
      const scene = createArchimedesScene({
        sceneId: stampId('fluid-buoyancy'),
      })
      return {
        sceneId: String(scene.id),
        scene: { ...scene, metadata: { ...scene.metadata, title } },
      }
    },
  },
]

/* ----------------------------------------------------------------- composite -- */

const compositeTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'velocity-selector',
    domain: 'composite',
    stage: 'senior',
    label: 'lab.template.velocitySelector',
    hint: 'lab.template.velocitySelector.hint',
    icon: IconVelocitySelector,
    tags: ['复合场'],
    createScene: (title) => {
      /* Defaults are chosen so v₀ = E/B exactly (E = 2.0e4 V/m, B = 0.20 T,
         v₀ = 1.0e5 m/s) AND the two forces actually oppose: with q > 0 and v
         along +x, qE points up only cancels qv×B when B points OUT of the page.
         The student breaks the balance by editing v₀ in the Lab. */
      const scene = createVelocitySelectorScene({
        sceneId: stampId('composite-velocity-selector'),
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
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'mass-spectrometer',
    domain: 'composite',
    stage: 'senior',
    label: 'lab.template.massSpectrometer',
    hint: 'lab.template.massSpectrometer.hint',
    icon: IconMassSpectrometer,
    tags: ['复合场'],
    createScene: (title) => {
      /* Field magnitudes are chosen so the apparatus is legible as well as
         correct: v = E/B = 1.0e5 m/s selects, and the deflection radius
         r = mv/(qB) ≈ 0.52 m is comparable to the 1.2 m deflection region, so the
         arc is a visible curve inside the apparatus rather than a proton-scale
         curl a student cannot see. */
      const scene = createMassSpectrometerScene({
        sceneId: stampId('composite-mass-spectrometer'),
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
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'composite-eb',
    domain: 'composite',
    stage: 'senior',
    label: 'lab.template.compositeEB',
    hint: 'lab.template.compositeEB.hint',
    icon: IconCompositeField,
    tags: ['复合场', 'E+B'],
    createScene: (title) => {
      /* B out of the page so qE (up) and qv×B (down) oppose at q > 0, v ∥ +x —
         the crossed-field drift world, not a rigged double-deflection. */
      const scene = createCompositeFieldScene({
        sceneId: stampId('composite-eb'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'composite-ebg',
    domain: 'composite',
    stage: 'senior',
    label: 'lab.template.compositeEBG',
    hint: 'lab.template.compositeEBG.hint',
    icon: IconCompositeField,
    tags: ['复合场', 'E+B+g'],
    createScene: (title) => {
      const scene = createCompositeFieldScene({
        sceneId: stampId('composite-ebg'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        gravity: 9.8,
        /* Gravity is off by default in the factory (most composite questions
           neglect it); in the three-field experiment it is the point. */
        observableVisibility: { gravityForce: true },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'multi-region-field',
    domain: 'composite',
    stage: 'senior',
    label: 'lab.template.multiRegion',
    hint: 'lab.template.multiRegion.hint',
    icon: IconCompositeField,
    tags: ['复合场', '多场区'],
    createScene: (title) => {
      const scene = createMultiRegionFieldScene({
        sceneId: stampId('composite-multi-region'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'cyclotron',
    domain: 'composite',
    stage: 'senior',
    label: 'lab.template.cyclotron',
    hint: 'lab.template.cyclotron.hint',
    icon: IconMagneticCircle,
    tags: ['复合场'],
    /* The composite engine models static uniform regions, not a time-dependent
       alternating field. A cyclotron here would compute the wrong trajectory, so
       it is shown as "即将支持" until the engine gains time-dependent fields. */
    comingSoon: true,
    createScene: () => {
      throw new Error('cyclotron is not yet modelled by the composite engine')
    },
  },
]

/** Ordered groups, one per domain. The "全部" tab is built by flattening these. */
export const EXPERIMENT_TEMPLATE_GROUPS: readonly ExperimentTemplateGroup[] = [
  { id: 'mechanics', label: 'lab.template.group.mechanics', templates: mechanicsTemplates },
  { id: 'optics', label: 'lab.template.group.optics', templates: opticsTemplates },
  { id: 'acoustics', label: 'lab.template.group.acoustics', templates: acousticsTemplates },
  { id: 'fluid', label: 'lab.template.group.fluid', templates: fluidTemplates },
  { id: 'electric', label: 'lab.template.group.electric', templates: electricTemplates },
  { id: 'magnetic', label: 'lab.template.group.magnetic', templates: magneticTemplates },
  { id: 'circuit', label: 'lab.template.group.circuit', templates: circuitTemplates },
  { id: 'composite', label: 'lab.template.group.composite', templates: compositeTemplates },
]

/** Every selectable template, flattened across groups. */
export const EXPERIMENT_TEMPLATES: readonly ExperimentTemplate[] =
  EXPERIMENT_TEMPLATE_GROUPS.flatMap(group => group.templates)

/** Count of templates a student can actually create (excludes comingSoon). */
export const SELECTABLE_TEMPLATE_COUNT = EXPERIMENT_TEMPLATES.filter(
  template => template.comingSoon !== true,
).length

export const findExperimentTemplate = (id: string): ExperimentTemplate | undefined =>
  EXPERIMENT_TEMPLATES.find(template => template.id === id)

/**
 * Build the scene handover for a template.
 *
 * Shared by every entry point so the sidebar popover, the Home action and the
 * Lab empty state produce byte-identical scenes; the title is passed in because
 * it is UI copy and only the caller holds the translator.
 */
export const createExperimentSceneRef = (
  template: ExperimentTemplate,
  title: string,
): { sceneId: string; scene: PhysicsScene } => template.createScene(title)
