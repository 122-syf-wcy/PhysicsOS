import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createLeverBenchScene } from './lever-scene.ts'

/**
 * Lever experiment templates (初中力学).
 *
 * Same shape as the fluid and thermal templates: each creator returns a
 * complete PhysicsScene through the bench factory with textbook-friendly
 * defaults, so the Lab, tests and the agent all start from identical worlds.
 */

export interface LeverBalanceSceneInput {
  readonly sceneId?: string
  /** Left hanger mass in grams (> 0). */
  readonly leftMass?: number
  /** Left arm length in centimetres (> 0). */
  readonly leftArm?: number
  /** Right hanger mass in grams (> 0). */
  readonly rightMass?: number
  /** Right arm length in centimetres (> 0). */
  readonly rightArm?: number
  readonly now?: IsoDateTime
  readonly title?: string
}

/**
 * 探究杠杆的平衡条件 — 200 g at 15 cm against 300 g at 10 cm, g = 9.8.
 *
 * Both moments are 0.294 N·m, so the beam sits level: F₁l₁ = F₂l₂ is visible
 * as a fact on the apparatus rather than a slogan. Sliding a hanger or
 * changing a mass is what unbalances it.
 */
export const createLeverBalanceScene = (input: LeverBalanceSceneInput = {}): PhysicsScene =>
  createLeverBenchScene({
    sceneId: input.sceneId ?? 'lab-lever-balance',
    ...(input.now === undefined ? {} : { now: input.now }),
    title: input.title ?? '探究杠杆的平衡条件',
    description: 'Lever Engine · 力矩平衡 F₁l₁ = F₂l₂',
    left: {
      id: 'hanger-left',
      name: '左钩码',
      mass: input.leftMass ?? 200,
      armLength: input.leftArm ?? 15,
    },
    right: {
      id: 'hanger-right',
      name: '右钩码',
      mass: input.rightMass ?? 300,
      armLength: input.rightArm ?? 10,
    },
  })
