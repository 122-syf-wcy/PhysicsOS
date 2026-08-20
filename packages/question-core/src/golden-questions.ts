import { asQuestionId } from '@physicsos/shared'
import type { QuestionDocument } from './question-document.ts'

export interface GoldenQuestionDefinition {
  id: string
  title: string
  text: string
  expectedDomain?: 'magnetic' | 'mechanics' | 'electric'
  expectedChargeSign: 'positive' | 'negative' | 'unknown'
  expectedFieldDirection: 'into_page' | 'out_of_page' | 'unknown'
  expectedValidation: 'VALID' | 'AMBIGUOUS' | 'INVALID_SEMANTICS' | 'UNSUPPORTED_MODEL'
}

export const GOLDEN_QUESTIONS: readonly GoldenQuestionDefinition[] = [
  {
    id: '01-proton-basic',
    title: '质子垂直进入匀强磁场',
    text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 洛伦兹力大小 2. 轨道半径 3. 运动周期 4. 判断运动方向 5. 显示运动轨迹',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'into_page',
    expectedValidation: 'VALID',
  },
  {
    id: '02-electron-negative-charge',
    title: '电子垂直进入匀强磁场',
    text: '一个电子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 9.11×10^-31 kg，q = -1.60×10^-19 C。求：1. 洛伦兹力大小 2. 轨道半径 3. 运动周期 4. 判断运动方向',
    expectedChargeSign: 'negative',
    expectedFieldDirection: 'into_page',
    expectedValidation: 'VALID',
  },
  {
    id: '03-field-out-of-page',
    title: '磁场垂直纸面向外',
    text: '一个质子以 1.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向外的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期 3. 判断运动方向',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'out_of_page',
    expectedValidation: 'VALID',
  },
  {
    id: '04-radius-only',
    title: '仅求轨道半径',
    text: '一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.20 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：轨道半径',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'into_page',
    expectedValidation: 'VALID',
  },
  {
    id: '05-period-only',
    title: '仅求运动周期',
    text: '一个质子以 5.0×10^5 m/s 的速度，垂直进入磁感应强度为 0.30 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：运动周期',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'into_page',
    expectedValidation: 'VALID',
  },
  {
    id: '06-missing-charge-sign',
    title: '缺少电荷正负',
    text: '一个带电粒子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = 1.60×10^-19 C。求：1. 轨道半径 2. 判断运动方向',
    expectedChargeSign: 'unknown',
    expectedFieldDirection: 'into_page',
    expectedValidation: 'AMBIGUOUS',
  },
  {
    id: '07-zero-field',
    title: '磁感应强度为零',
    text: '一个质子以 2.0×10^6 m/s 的速度进入磁感应强度为 0 T 的区域。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：轨道半径',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'INVALID_SEMANTICS',
  },
  {
    id: '08-parallel-velocity',
    title: '速度与磁场平行',
    text: '一个质子以 2.0×10^6 m/s 的速度，平行于磁感应强度为 0.50 T 的匀强磁场方向运动。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：轨道半径',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'UNSUPPORTED_MODEL',
  },
  {
    id: '09-unit-conversion',
    title: '单位转换',
    text: '一个质子以 2000 km/s 的速度，垂直进入磁感应强度为 500 mT，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：轨道半径和运动周期',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'into_page',
    expectedValidation: 'VALID',
  },
  {
    id: '10-scientific-notation',
    title: '科学计数法',
    text: '一个质子以 2.0e6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67e-27 kg，q = +1.60e-19 C。求：1. 洛伦兹力大小 2. 轨道半径 3. 运动周期',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'into_page',
    expectedValidation: 'VALID',
  },
  {
    id: 'electric-01-perpendicular-deflection',
    title: '正电荷在匀强电场中偏转',
    text: '一个带正电粒子，质量 m = 4 kg，电荷量 q = +2 C，初速度为 3 m/s，沿 x 轴正方向进入匀强电场。电场强度 E = 6 N/C，电场方向沿 y 轴正方向，运动 2 s。求电场力、加速度、末速度、位移、电势变化、电势能变化、电场力做功和动能变化。',
    expectedDomain: 'electric',
    expectedChargeSign: 'positive',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
  {
    id: 'electric-02-negative-parallel',
    title: '负电荷沿电场方向减速',
    text: '一个带负电粒子，质量 m = 2 kg，电荷量 q = -1 C，初速度为 4 m/s，沿 x 轴正方向运动。空间存在匀强电场，电场强度 E = 2 V/m，电场方向沿 x 轴正方向，运动 2 s。求电场力、加速度、末速度、位移、电势变化、电势能变化和动能变化。',
    expectedDomain: 'electric',
    expectedChargeSign: 'negative',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
  {
    id: 'mech-01-uniform-acceleration',
    title: '匀加速直线运动',
    text: '汽车初速度为 10 m/s，加速度为 2 m/s²，运动 5 s。求末速度和位移。',
    expectedChargeSign: 'unknown',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
  {
    id: 'mech-02-projectile-horizontal',
    title: '平抛运动',
    text: '物体从 20 m 高处，以 10 m/s 水平抛出，g = 10 m/s²。求落地时间和水平射程。',
    expectedChargeSign: 'unknown',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
  {
    id: 'mech-03-projectile-oblique',
    title: '斜抛运动',
    text: '物体以初速度 20 m/s，抛射角 30° 抛出，g = 10 m/s²。求最大高度、飞行时间和射程。',
    expectedChargeSign: 'unknown',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
  {
    id: 'mech-04-newton-second-law',
    title: '牛顿第二定律',
    text: '质量为 2 kg 的物体受到水平合力 10 N。求加速度。',
    expectedChargeSign: 'unknown',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
  {
    id: 'mech-05-incline-no-friction',
    title: '无摩擦斜面',
    text: '质量为 2 kg 的物体在倾角 30° 的光滑斜面上，g = 10 m/s²。求沿斜面加速度和支持力。',
    expectedChargeSign: 'unknown',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
  {
    id: 'mech-06-unit-conversion',
    title: '单位转换 72km/h',
    text: '汽车以 72 km/h 的速度行驶，加速度为 2 m/s²，运动 5 s。求末速度。',
    expectedChargeSign: 'unknown',
    expectedFieldDirection: 'unknown',
    expectedValidation: 'VALID',
  },
]

export function createGoldenQuestionDocument(def: GoldenQuestionDefinition, now?: string): QuestionDocument {
  const ts = now ?? new Date().toISOString()
  const domain = def.expectedDomain ?? (def.id.startsWith('mech-') ? 'mechanics' : 'magnetic')
  return {
    id: asQuestionId('golden-' + def.id),
    content: {
      source: 'text',
      rawText: def.text,
      extractedText: def.text,
      status: 'EXTRACTED',
    },
    metadata: {
      title: def.title,
      tags: [domain, domain === 'mechanics' ? 'motion' : 'charged-particle'],
      difficulty: 'standard',
    },
    createdAt: ts,
    updatedAt: ts,
  }
}
