import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createFluidTankScene } from './fluid-scene.ts'

/**
 * Fluid-statics experiment templates (初中浮力).
 *
 * Same shape as the optics and acoustics templates: each creator returns a
 * complete PhysicsScene through the tank factory with textbook-friendly
 * defaults, so the Lab, tests and the agent all start from identical worlds.
 */

export interface ArchimedesSceneInput {
  readonly sceneId?: string
  /** Block mass in grams (> 0). */
  readonly blockMass?: number
  /** Block volume in cubic centimetres (> 0). */
  readonly blockVolume?: number
  /** Liquid density in kg/m³ (> 0). */
  readonly liquidDensity?: number
  readonly now?: IsoDateTime
}

/**
 * 探究浮力的大小 — an aluminium block on a spring scale, lowered into water.
 *
 * Defaults are chosen so every number a 初中 student writes down is clean:
 * 100 cm³ of aluminium massing 270 g weighs 2.646 N, and water displaced at
 * full immersion is exactly 100 g, so the buoyant force is 0.98 N and the
 * scale settles on 1.666 N. Density comes out at 2.7 g/cm³ — denser than
 * water, so the block sinks and the whole reading curve is visible.
 */
export const createArchimedesScene = (input: ArchimedesSceneInput = {}): PhysicsScene => {
  return createFluidTankScene({
    sceneId: input.sceneId ?? 'lab-archimedes',
    ...(input.now === undefined ? {} : { now: input.now }),
    block: {
      id: 'block-1',
      name: '铝块',
      mass: input.blockMass ?? 270,
      volume: input.blockVolume ?? 100,
      height: 5,
    },
    liquid: { id: 'liquid-1', name: '水', density: input.liquidDensity ?? 1000 },
    title: '探究浮力的大小',
    description:
      '弹簧测力计称重法测浮力：F_浮 = G − F_示。缓慢下放物块，读数随排开液体体积增大而变小；完全浸没后读数不再变化 —— 浮力只跟液体密度和排开体积有关，与深度无关。',
  })
}
