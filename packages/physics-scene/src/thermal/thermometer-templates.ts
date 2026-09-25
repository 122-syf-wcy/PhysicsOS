import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createThermometerBenchScene } from './thermometer-scene.ts'

export interface ThermometerCalibrationSceneInput {
  readonly sceneId?: string
  /** Bulb volume in cm³ (> 0). */
  readonly bulbVolume?: number
  /** Bore diameter in millimetres (> 0). */
  readonly boreDiameter?: number
  /** Volumetric expansion coefficient in 1/K (> 0). */
  readonly expansionCoefficient?: number
  /** Temperature the bulb sits in, in °C. */
  readonly temperature?: number
  readonly now?: IsoDateTime
}

/**
 * 温度计的刻度是怎么来的 — the two fixed points, and why the scale is even.
 *
 * A 0.1 cm³ bulb of a liquid expanding by 2×10⁻⁴ per kelvin climbs a bore
 * 0.16 mm across: **0.9947 mm per degree**. That single number is the whole
 * instrument. It is also why the glass can be ruled evenly — the rise is
 * linear in temperature, so equal steps of temperature are equal distances —
 * and it is what makes 冰水混合物 (0 °C) and 沸水 (100 °C) *fixed points*
 * rather than two more readings: they are what the scale is defined against,
 * and the span between them is what gets divided into a hundred degrees.
 */
export const createThermometerCalibrationScene = (
  input: ThermometerCalibrationSceneInput = {},
): PhysicsScene =>
  createThermometerBenchScene({
    sceneId: input.sceneId ?? 'lab-thermometer-calibration',
    ...(input.now === undefined ? {} : { now: input.now }),
    bulbVolume: input.bulbVolume ?? 0.1,
    boreDiameter: input.boreDiameter ?? 0.16,
    expansionCoefficient: input.expansionCoefficient ?? 2e-4,
    temperature: input.temperature ?? 25,
    icePointLength: 2,
    title: '温度计的刻度',
    description:
      '温度计的刻度：0.1 cm³ 的玻璃泡里装着膨胀系数 2×10⁻⁴ 的液体，液柱走在 0.16 mm 的细管里 —— 每升高 1 °C 液柱上升 0.9947 mm。正因为膨胀是线性的，刻度才能均匀地画出来；而冰水混合物（0 °C）与沸水（100 °C）这两个固定点，就是这把尺子的零点与满刻度，它们之间的距离被分成 100 等份，每一份就是 1 °C。',
  })
