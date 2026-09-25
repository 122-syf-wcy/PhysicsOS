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

export interface HeatCapacityComparisonSceneInput {
  readonly sceneId?: string
  /** Mass of EACH sample in grams (> 0); the comparison only works if equal. */
  readonly sampleMass?: number
  /** Heater power in watts delivered to each sample (> 0). */
  readonly heaterPower?: number
  /** How long both heaters are left on, in seconds (> 0). */
  readonly runDuration?: number
  readonly now?: IsoDateTime
}

/**
 * 比较不同物质的吸热能力 — equal masses of water and kerosene in two identical
 * beakers, each over its own identical heater, both started at room
 * temperature.
 *
 * The controls are the whole point: same mass, same heater, same time, so the
 * two samples absorb exactly the same heat. Water's specific heat is twice
 * kerosene's, so it warms half as fast. With 100 g each at 50 W for 420 s that
 * is 21000 J apiece — water climbs 50 ℃ and the kerosene 100 ℃, a ratio of
 * exactly 2 that the student can read straight off the two thermometers.
 *
 * Neither liquid changes phase during the run, so both start above their
 * melting points and the curve is a single straight climb each.
 */
export const createHeatCapacityComparisonScene = (
  input: HeatCapacityComparisonSceneInput = {},
): PhysicsScene => {
  const mass = input.sampleMass ?? 100
  return createThermalBenchScene({
    sceneId: input.sceneId ?? 'lab-heat-capacity',
    ...(input.now === undefined ? {} : { now: input.now }),
    sample: {
      id: 'sample-1',
      name: '水',
      mass,
      solidSpecificHeat: 2100,
      liquidSpecificHeat: 4200,
      latentHeat: 3.34e5,
      meltingPoint: 0,
      initialTemperature: 20,
    },
    comparisonSample: {
      id: 'sample-2',
      name: '煤油',
      mass,
      solidSpecificHeat: 2100,
      liquidSpecificHeat: 2100,
      latentHeat: 0,
      meltingPoint: -30,
      initialTemperature: 20,
    },
    heaterPower: input.heaterPower ?? 50,
    runDuration: input.runDuration ?? 420,
    title: '比较不同物质的吸热能力',
    description:
      '控制变量：等质量的水和煤油、相同的加热器、相同的加热时间，吸收的热量完全相同。水的比热容是煤油的两倍，升温就只有煤油的一半 —— 比热容正是「吸热能力」的量度。',
  })
}

export interface BoilingWaterSceneInput {
  readonly sceneId?: string
  /** Water mass in grams (> 0). */
  readonly mass?: number
  /** Heater power in watts (> 0). */
  readonly heaterPower?: number
  /** Starting temperature in °C. */
  readonly initialTemperature?: number
  readonly now?: IsoDateTime
}

/**
 * 水的沸腾 — the flat part at 100 °C, watched while the heater keeps running.
 *
 * 500 g of water from 20 °C at 500 W: c = 4200 J/(kg·K) takes it to the boiling
 * point in 336 s, and then the thermometer STOPS — for the next 2260 s the
 * heater is still delivering 500 W and every joule of it goes into turning
 * water into steam. That plateau is the experiment: the temperature rise stops
 * while the heat does not, which is what "沸腾要吸热" means when you watch it
 * rather than say it.
 */
export const createBoilingWaterScene = (input: BoilingWaterSceneInput = {}): PhysicsScene =>
  createThermalBenchScene({
    sceneId: input.sceneId ?? 'lab-boiling-water',
    ...(input.now === undefined ? {} : { now: input.now }),
    sample: {
      id: 'water',
      name: '水',
      mass: input.mass ?? 500,
      solidSpecificHeat: 2100,
      liquidSpecificHeat: 4200,
      /* Ice's latent heat, kept so the same sample could also be frozen; the
         water starts at 20 °C, so the melting plateau never appears on this run. */
      latentHeat: 334_000,
      meltingPoint: 0,
      boilingPoint: 100,
      vaporizationHeat: 2_260_000,
      initialTemperature: input.initialTemperature ?? 20,
    },
    heaterPower: input.heaterPower ?? 500,
    title: '水的沸腾',
    description:
      '探究水沸腾时温度变化的特点：500 g 水从 20 °C 起被 500 W 的电热器加热，336 s 后到 100 °C，之后温度计**停住不动**，而加热器仍在供 500 W —— 接下来的 2260 s 里，每一焦耳都进了汽化（水的汽化热 2.26×10⁶ J/kg）。温度不变而持续吸热，这就是「沸腾要吸热」的读法。',
  })
