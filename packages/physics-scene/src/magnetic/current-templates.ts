import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import {
  createCurrentBenchScene,
  type ElectromagnetSpec,
  type MotorSpec,
  type SolenoidFieldSpec,
  type StraightWireFieldSpec,
} from './current-scene.ts'

/**
 * Current-magnetic experiment templates (初中 电生磁 · 通电螺线管).
 *
 * Same shape as the pressure and buoyancy templates: each creator returns a
 * complete PhysicsScene through the bench factory with textbook-friendly
 * defaults, so the Lab, tests and the agent all start from identical worlds.
 */

export interface StraightWireFieldSceneInput {
  readonly sceneId?: string
  /** Current in the conductor, in amperes (≠ 0). */
  readonly current?: number
  /** Distance from the conductor to the probe, in centimetres (> 0). */
  readonly probeDistance?: number
  /** A second probe distance in the same field, in centimetres (> 0). */
  readonly comparisonDistance?: number
  readonly now?: IsoDateTime
}

/**
 * 通电直导线周围的磁场 — the same current probed at two distances.
 *
 * The defaults are the textbook demonstration and they are exact: μ₀I/(2πr)
 * with I = 10 A at r = 5 cm is 4×10⁻⁵ T = 40 µT, and the second probe at
 * 10 cm reads exactly 20 µT. The π in μ₀ cancels against the 2πr, so the two
 * readings are round numbers rather than a formula's leftovers — which is what
 * makes "距离加倍、磁场减半" visible on the apparatus instead of in the algebra.
 */
export const createStraightWireFieldScene = (
  input: StraightWireFieldSceneInput = {},
): PhysicsScene => {
  const bench: StraightWireFieldSpec = {
    benchId: 'current-bench-1',
    type: 'straight_wire',
    current: input.current ?? 10,
    probeDistance: input.probeDistance ?? 5,
    comparisonDistance: input.comparisonDistance ?? 10,
  }
  return createCurrentBenchScene({
    sceneId: input.sceneId ?? 'lab-straight-wire-field',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench,
    title: '通电直导线周围的磁场',
    description:
      '电生磁：10 A 的直导线在 5 cm 处产生 40 µT 的磁场，10 cm 处正好减半 —— B = μ₀I/(2πr) 与距离成反比。导线周围的磁场是一圈圈同心圆，方向由安培定则给出：右手握住导线，拇指指向电流方向，四指弯曲的方向就是磁场方向；电流反向，磁场也跟着反向。',
  })
}

export interface ElectromagnetSceneInput {
  readonly sceneId?: string
  /** Current in the winding, in amperes (≠ 0). */
  readonly current?: number
  /** Turns wound on the former (> 0). */
  readonly turns?: number
  /** Coil length along the axis, in centimetres (> 0). */
  readonly coilLength?: number
  /** Relative permeability of the core (> 0); 1 = air-cored. */
  readonly coreRelativePermeability?: number
  /** A second core on the same coil (> 0). */
  readonly comparisonCoreRelativePermeability?: number
  /** Pole-face area in cm² (> 0). */
  readonly coreArea?: number
  readonly now?: IsoDateTime
}

/**
 * 电磁铁：同一个线圈，插上不同铁芯，能吸起多重的东西。
 *
 * N = 200 匝绕在 20 cm 上、I = 1 A 时，空气芯的磁场只有 μ₀nI = 4π×10⁻⁴ T；
 * 插上 μ_r = 200 的铁芯变成 8π×10⁻² T ≈ 0.2513 T —— 磁感应强度乘 200，而吸力
 * 与 B² 成正比（F = B²A/(2μ₀)），于是乘 4 万倍：4 cm² 的极面从 0.25 mN 拉到
 * 10.05 N，能吸起 1 kg 铁。换 μ_r = 800 的芯再翻 16 倍到 160.8 N。
 *
 * 这就是初中实验室里"通电螺线管加铁芯就成了电磁铁"的定量版本：铁芯不是修饰，
 * 它把吸力抬高了四个数量级。
 */
export const createElectromagnetScene = (input: ElectromagnetSceneInput = {}): PhysicsScene => {
  const bench: ElectromagnetSpec = {
    benchId: 'current-bench-1',
    type: 'electromagnet',
    current: input.current ?? 1,
    turns: input.turns ?? 200,
    coilLength: input.coilLength ?? 20,
    coreRelativePermeability: input.coreRelativePermeability ?? 200,
    comparisonCoreRelativePermeability: input.comparisonCoreRelativePermeability ?? 800,
    coreArea: input.coreArea ?? 4,
  }
  return createCurrentBenchScene({
    sceneId: input.sceneId ?? 'lab-electromagnet',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench,
    title: '电磁铁：铁芯与吸力',
    description:
      '电磁铁的磁性强弱由电流、匝数和铁芯共同决定：N = 200 匝、L = 20 cm、I = 1 A 时管内磁场 B = μ_r·μ₀(N/L)I，空气芯只有 1.26 mT，插入 μ_r = 200 的铁芯后变成 0.251 T。吸力按 F = B²A/(2μ₀) 走，与 B 的平方成正比 —— 4 cm² 的极面因此能吸起约 1 kg 铁；换更好的铁芯（μ_r = 800）吸力再涨 16 倍。',
  })
}

export interface MotorSceneInput {
  readonly sceneId?: string
  /** Current through the rotor, in amperes (≠ 0). */
  readonly current?: number
  /** Turns on the rotor (> 0). */
  readonly turns?: number
  /** Stator field in tesla (> 0). */
  readonly magneticFluxDensity?: number
  /** Length of the sides that carry the force, in centimetres (> 0). */
  readonly sideLength?: number
  /** Length of the other pair of sides, in centimetres (> 0). */
  readonly coilWidth?: number
  /** Angle from the coil's plane to the field, in degrees. */
  readonly coilAngle?: number
  readonly now?: IsoDateTime
}

/**
 * 电动机：通电线圈在磁场里受力转动。
 *
 * B = 0.5 T、n = 100 匝、I = 2 A，线圈 6 cm × 4 cm —— 两条边各受
 * F = BIL = 0.06 N，方向相反、相距 4 cm，于是力矩 τ = n·B·I·A·cosθ 在
 * θ = 0（线圈平面顺着 B）时最大 0.24 N·m，转过 90° 恰好归零：那就是平衡位置，
 * 裸线圈会停在那里，而换向器正是在这里把电流反向一次，把力矩扳回原来的方向。
 *
 * 与电磁铁放在一起看很有意思：那边吸力按 B² 涨（μ_r 一乘就是平方倍），这边力矩
 * 与 B 成正比 —— 同一片磁场，两种装置，两种"更强"的含义。
 */
export const createMotorScene = (input: MotorSceneInput = {}): PhysicsScene => {
  const bench: MotorSpec = {
    benchId: 'current-bench-1',
    type: 'motor',
    current: input.current ?? 2,
    turns: input.turns ?? 100,
    magneticFluxDensity: input.magneticFluxDensity ?? 0.5,
    sideLength: input.sideLength ?? 6,
    coilWidth: input.coilWidth ?? 4,
    coilAngle: input.coilAngle ?? 0,
  }
  return createCurrentBenchScene({
    sceneId: input.sceneId ?? 'lab-motor',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench,
    title: '电动机：安培力与力矩',
    description:
      '电动机原理：B = 0.5 T 的磁场里放一个 100 匝、6 cm × 4 cm 的线圈，通 2 A 电流，两条边各受 F = BIL = 0.06 N 的安培力，方向相反相距 4 cm，力矩 τ = n·B·I·A·cosθ 最大 0.24 N·m。转过 90° 力矩为零（平衡位置），换向器在这里把电流反向，力矩方向不变，线圈就一直朝一个方向转下去。',
  })
}

export interface SolenoidFieldSceneInput {
  readonly sceneId?: string
  /** Current in the winding, in amperes (≠ 0). */
  readonly current?: number
  /** Turns wound on the former (> 0). */
  readonly turns?: number
  /** A second winding on the same former, same length (> 0). */
  readonly comparisonTurns?: number
  /** Coil length along the axis, in centimetres (> 0). */
  readonly coilLength?: number
  readonly now?: IsoDateTime
}

/**
 * 通电螺线管内部的磁场 — the same former wound with two different turn counts.
 *
 * n = N/L = 400/0.20 m = 2000 匝/米 and I = 5 A give B = μ₀nI = 4π×10⁻³ T,
 * which is the form a textbook writes it in; as a decimal it is ≈ 12.57 mT.
 * The second winding doubles N on the same length, so its field is exactly
 * double — the turn count, not the current, is what changed.
 */
export const createSolenoidFieldScene = (
  input: SolenoidFieldSceneInput = {},
): PhysicsScene => {
  const bench: SolenoidFieldSpec = {
    benchId: 'current-bench-1',
    type: 'solenoid',
    current: input.current ?? 5,
    turns: input.turns ?? 400,
    comparisonTurns: input.comparisonTurns ?? 800,
    coilLength: input.coilLength ?? 20,
  }
  return createCurrentBenchScene({
    sceneId: input.sceneId ?? 'lab-solenoid-field',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench,
    title: '通电螺线管内部的磁场',
    description:
      '通电螺线管内部是匀强磁场：n = N/L = 2000 匝/米、I = 5 A 时 B = μ₀nI = 4π×10⁻³ T ≈ 12.57 mT，匝数翻到 800 匝磁场也正好翻倍。磁场方向同样由安培定则给出：右手握住螺线管，四指顺着电流环绕的方向，拇指指向的那一端就是 N 极。',
  })
}
