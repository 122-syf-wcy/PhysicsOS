import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createEnergyBenchScene } from './energy-scene.ts'

/**
 * Mechanical-energy experiment templates (初中 机械能 · 动能与势能的转化).
 *
 * Same shape as every other slice: each creator returns a complete PhysicsScene
 * through the bench factory with textbook-friendly defaults, so the Lab, tests
 * and the agent all start from identical worlds.
 */

export interface MechanicalEnergySceneInput {
  readonly sceneId?: string
  /** Mass of the cart in kilograms (> 0). */
  readonly mass?: number
  /** Release height in centimetres (> 0). */
  readonly releaseHeight?: number
  /** Incline angle in degrees, strictly between 0 and 90. */
  readonly inclineAngle?: number
  /** Friction coefficient along the ramp (≥ 0); 0 is the idealised ramp. */
  readonly frictionCoefficient?: number
  readonly now?: IsoDateTime
}

/**
 * 动能与势能的转化 — the same cart, on a smooth ramp and on a rough one.
 *
 * The defaults are exact: m = 2 kg released from h = 90 cm has Ep = mgh = 17.64 J,
 * and on a frictionless ramp ALL of it is kinetic at the bottom — ½mv² = 17.64 J
 * gives v = √(2gh) = 4.2 m/s, both numbers landing on the nose because 2gh is a
 * perfect square. The same cart on a rough ramp keeps 17.64 − μ·m·g·h, and that
 * subtraction is the whole point: 动能没有消失，它变成了摩擦生的热.
 */
export const createMechanicalEnergyScene = (
  input: MechanicalEnergySceneInput = {},
): PhysicsScene => {
  const scene = createEnergyBenchScene({
    sceneId: input.sceneId ?? 'lab-mechanical-energy',
    ...(input.now === undefined ? {} : { now: input.now }),
    mass: input.mass ?? 2,
    releaseHeight: input.releaseHeight ?? 90,
    inclineAngle: input.inclineAngle ?? 45,
    frictionCoefficient: input.frictionCoefficient ?? 0,
    title: '动能与势能的转化',
    description:
      '机械能：2 kg 的小车从 90 cm 高处沿光滑斜面滑下，重力势能 Ep = mgh = 17.64 J 全部变成动能 Ek = ½mv²，到底端时速度 v = √(2gh) = 4.2 m/s。把斜面换成粗糙的（μ = 0.2、45°），到底端的动能少掉 μmg·h·cotθ = 3.53 J —— 机械能没有消失，它变成了摩擦生的热，把三项加起来仍然等于出发时的那 17.64 J。',
  })
  return scene
}

export interface RampFrictionSceneInput {
  readonly sceneId?: string
  readonly mass?: number
  readonly releaseHeight?: number
  readonly inclineAngle?: number
  readonly frictionCoefficient?: number
  readonly now?: IsoDateTime
}

/**
 * 机械能的转化与损失 — the same rig on a rough ramp.
 *
 * Kept as its own template rather than a preset so the two sit side by side on
 * the shelf: the smooth ramp is 机械能守恒, the rough one is where it goes.
 */
export const createRampFrictionScene = (input: RampFrictionSceneInput = {}): PhysicsScene =>
  createEnergyBenchScene({
    sceneId: input.sceneId ?? 'lab-ramp-friction',
    ...(input.now === undefined ? {} : { now: input.now }),
    mass: input.mass ?? 2,
    releaseHeight: input.releaseHeight ?? 90,
    inclineAngle: input.inclineAngle ?? 45,
    frictionCoefficient: input.frictionCoefficient ?? 0.2,
    title: '机械能的损失去哪儿了',
    description:
      '粗糙斜面：同样的 2 kg 小车从 90 cm 处滑下，到底端的动能比出发时的重力势能少了 3.53 J（45° 时 W_摩擦 = μmg·cosθ·L 正好等于 μmg·h）。这 3.53 J 没有消失 —— 它变成摩擦生的热。把倾角调缓一些，摩擦反而拿走更多：路程按 cotθ 变长，而正压力只按 cosθ 变小。',
  })
