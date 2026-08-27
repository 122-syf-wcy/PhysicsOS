import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createThermalBenchScene } from './thermal-scene.ts'

/**
 * Thermal experiment templates (初中热学).
 *
 * Same shape as the optics, acoustics and fluid templates: each creator returns
 * a complete PhysicsScene through the bench factory with textbook-friendly
 * defaults, so the Lab, tests and the agent all start from identical worlds.
 */

export interface CrystalMeltingSceneInput {
  readonly sceneId?: string
  /** Sample mass in grams (> 0). */
  readonly sampleMass?: number
  /** Heater power in watts (> 0). */
  readonly heaterPower?: number
  /** Latent heat of fusion in J/kg (≥ 0); pass 0 for an amorphous sample. */
  readonly latentHeat?: number
  readonly now?: IsoDateTime
}

/**
 * 探究晶体的熔化过程 — 100 g of crushed ice in a beaker over a steady 50 W
 * heater, thermometer in the ice.
 *
 * The numbers are the ones the textbook uses: ice at −20 °C warms at
 * 2100 J/(kg·K), holds at 0 °C for the whole 3.34×10⁵ J/kg of melting, then
 * the meltwater warms at 4200 J/(kg·K). With m = 100 g and P = 50 W that is a
 * 84 s climb, a 668 s plateau and a shallower climb after — the plateau
 * dominates the graph, which is exactly the point: 熔化过程吸热但温度不变.
 */
export const createCrystalMeltingScene = (
  input: CrystalMeltingSceneInput = {},
): PhysicsScene => {
  const latentHeat = input.latentHeat ?? 3.34e5
  const amorphous = latentHeat === 0
  return createThermalBenchScene({
    sceneId: input.sceneId ?? 'lab-crystal-melting',
    ...(input.now === undefined ? {} : { now: input.now }),
    sample: {
      id: 'sample-1',
      name: amorphous ? '松香' : '冰',
      mass: input.sampleMass ?? 100,
      solidSpecificHeat: 2100,
      liquidSpecificHeat: 4200,
      latentHeat,
      meltingPoint: 0,
      initialTemperature: -20,
    },
    heaterPower: input.heaterPower ?? 50,
    title: '探究晶体的熔化过程',
    description:
      '恒功率加热冰块并记录温度：晶体有固定熔点，熔化时持续吸热但温度停在 0 ℃ 不变，图像上是一段水平线；熔化完毕后温度继续上升。',
  })
}
