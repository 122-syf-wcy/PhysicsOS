import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createLightBenchScene } from './light-scene.ts'

/**
 * Light-propagation experiment templates (初中 光的直线传播 · 小孔成像).
 *
 * Same shape as every other slice: each creator returns a complete PhysicsScene
 * through the bench factory with textbook-friendly defaults, so the Lab, tests
 * and the agent all start from identical worlds.
 */

export interface PinholeSceneInput {
  readonly sceneId?: string
  /** Object height in centimetres (> 0). */
  readonly objectHeight?: number
  /** Object-to-hole distance in centimetres (> 0). */
  readonly objectDistance?: number
  /** Hole-to-screen distance in centimetres (> 0). */
  readonly screenDistance?: number
  readonly now?: IsoDateTime
}

/**
 * 小孔成像 — light travels in straight lines, and that alone turns the picture
 * upside down.
 *
 * The defaults are exact and they halve: a 6 cm arrow 30 cm in front of the hole
 * throws a 3 cm image on a screen 15 cm behind it, inverted. Both numbers are
 * integer because h′ = h·v/u with v/u = 1/2, and the inversion is not a rule to
 * memorise — it is what happens when the ray from the tip and the ray from the
 * tail cross at the hole and keep going straight.
 */
export const createPinholeScene = (input: PinholeSceneInput = {}): PhysicsScene =>
  createLightBenchScene({
    sceneId: input.sceneId ?? 'lab-pinhole',
    ...(input.now === undefined ? {} : { now: input.now }),
    objectHeight: input.objectHeight ?? 6,
    objectDistance: input.objectDistance ?? 30,
    screenDistance: input.screenDistance ?? 15,
    title: '小孔成像',
    description:
      '光的直线传播：6 cm 高的箭头放在小孔前 30 cm，孔后 15 cm 的屏上得到一个 3 cm 的像 —— h′ = h·v/u，放大率只有 1/2。像一定是倒立的：从箭头顶端出发的光穿过小孔后继续直走，落到屏的下方；从底端出发的落到上方，两条光线在小孔交叉，上下就颠倒了。孔再小也不改变这一点，它只让像更清楚。',
  })

export interface TotalReflectionSceneInput {
  readonly sceneId?: string
  /** Index the light comes from (≥ 1); 1.5 is glass. */
  readonly incidentIndex?: number
  /** Index it meets (> 0); 1.0 is air. */
  readonly refractedIndex?: number
  /** Angle of incidence in degrees, in [0, 90). */
  readonly incidentAngle?: number
  readonly now?: IsoDateTime
}

/**
 * 全反射 — why a diamond sparkles and why light stays inside an optical fibre.
 *
 * The defaults are the textbook pair: light in glass (n = 1.5) striking the
 * boundary with air (n = 1.0) at 45°. The critical angle is
 * arcsin(1/1.5) = 41.8°, so 45° is past it and NOTHING refracts — the light is
 * turned back entirely. Drop the angle to 30° and a refracted ray reappears at
 * 48.6°, which is the point: 全反射 is a threshold, not a gradual dimming.
 */
export const createTotalReflectionScene = (input: TotalReflectionSceneInput = {}): PhysicsScene =>
  createLightBenchScene({
    sceneId: input.sceneId ?? 'lab-total-reflection',
    ...(input.now === undefined ? {} : { now: input.now }),
    refraction: {
      incidentIndex: input.incidentIndex ?? 1.5,
      refractedIndex: input.refractedIndex ?? 1,
      incidentAngle: input.incidentAngle ?? 45,
    },
    title: '全反射',
    description:
      '全反射：光从玻璃（n = 1.5）射向空气（n = 1），临界角 θ_c = arcsin(n₂/n₁) = 41.8°。以 45° 入射时已过临界角，折射光线不复存在 —— 光被全部反射回来，这就是光纤能把光锁在里面的原因。把入射角降到 30° 折射光线又出现了（48.6°），所以全反射是一个门槛，不是"慢慢变暗"。',
  })
