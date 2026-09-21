/**
 * Model-facing SceneCommand reference and payload normalization.
 *
 * A model writes `{ "value": 0.5, "unit": "T" }` for a quantity and
 * `{ "x": 2, "y": 0, "unit": "m/s" }` for a vector; the scene contract wants the
 * physical dimension spelled out on every quantity. This table is the single
 * place that knows which dimension each command field carries, so the tool can
 * complete the payload before handing it to the SceneRuntime — which then does
 * the real validation (unit registry, sign rules, sub-model guards) and either
 * commits a revision or refuses with a domain error. Nothing here evaluates
 * physics; it only reshapes JSON.
 */

import type { PhysicalDimension } from '@physicsos/physics-units'
import type { SceneCommandType } from '@physicsos/physics-scene'
import { asObservableId } from '@physicsos/shared'

export type CommandFieldSpec =
  | { readonly kind: 'string'; readonly description: string }
  | { readonly kind: 'observable_id'; readonly description: string }
  | { readonly kind: 'number'; readonly description: string }
  | { readonly kind: 'boolean'; readonly description: string }
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly description: string }
  | { readonly kind: 'quantity'; readonly dimension: PhysicalDimension; readonly description: string }
  | { readonly kind: 'vector'; readonly dimension: PhysicalDimension; readonly description: string }

export interface CommandSpec {
  readonly domain: string
  readonly summary: string
  readonly fields: Readonly<Record<string, CommandFieldSpec>>
}

const id = (description: string): CommandFieldSpec => ({ kind: 'string', description })
const quantity = (dimension: PhysicalDimension, description: string): CommandFieldSpec => ({
  kind: 'quantity',
  dimension,
  description,
})
const vector = (dimension: PhysicalDimension, description: string): CommandFieldSpec => ({
  kind: 'vector',
  dimension,
  description,
})
const number = (description: string): CommandFieldSpec => ({ kind: 'number', description })
const choice = (values: readonly string[], description: string): CommandFieldSpec => ({
  kind: 'enum',
  values,
  description,
})

/** Every frozen SceneCommand, keyed by its discriminant. */
export const COMMAND_SPECS: Readonly<Record<SceneCommandType, CommandSpec>> = {
  SetParticleCharge: {
    domain: 'magnetic / electric / composite',
    summary: '改带电粒子的电荷量（可为负）',
    fields: { particleId: id('粒子 id'), charge: quantity('electric_charge', '电荷，如 {value:1.6e-19, unit:"C"}') },
  },
  SetParticleMass: {
    domain: 'magnetic / electric / composite',
    summary: '改带电粒子的质量（> 0）',
    fields: { particleId: id('粒子 id'), mass: quantity('mass', '质量，如 {value:1.67e-27, unit:"kg"}') },
  },
  SetParticleVelocity: {
    domain: 'magnetic / electric / composite',
    summary: '改带电粒子的初速度矢量',
    fields: { particleId: id('粒子 id'), velocity: vector('velocity', '速度矢量，如 {x:2e6, y:0, unit:"m/s"}') },
  },
  SetMagneticFieldStrength: {
    domain: 'magnetic / composite',
    summary: '改匀强磁场的磁感应强度（> 0）',
    fields: { fieldId: id('磁场 id'), strength: quantity('magnetic_flux_density', '如 {value:0.5, unit:"T"}') },
  },
  SetMagneticFieldDirection: {
    domain: 'magnetic / composite',
    summary: '改磁场方向（垂直纸面向里 / 向外）',
    fields: { fieldId: id('磁场 id'), direction: choice(['into_page', 'out_of_page'], '磁场方向') },
  },
  SetElectricFieldStrength: {
    domain: 'electric / composite',
    summary: '改匀强电场的场强（> 0）',
    fields: { fieldId: id('电场 id'), strength: quantity('electric_field', '如 {value:2e4, unit:"V/m"}') },
  },
  SetElectricFieldDirection: {
    domain: 'electric / composite',
    summary: '改匀强电场的方向',
    fields: { fieldId: id('电场 id'), direction: choice(['right', 'left', 'up', 'down'], '电场方向') },
  },
  SetObservableEnabled: {
    domain: '所有领域',
    summary: '开关一个可观察量图层（不改物理事实，不触发实验分支）',
    fields: {
      observableId: { kind: 'observable_id', description: '可观察量 id（场景 observables 列表里的 id）' },
      enabled: { kind: 'boolean', description: '是否显示' },
    },
  },
  SetBodyMass: {
    domain: 'mechanics',
    summary: '改物体质量（> 0）',
    fields: { bodyId: id('物体 id'), mass: quantity('mass', '如 {value:2, unit:"kg"}') },
  },
  SetBodyPosition: {
    domain: 'mechanics',
    summary: '改物体初位置',
    fields: { bodyId: id('物体 id'), position: vector('length', '如 {x:0, y:20, unit:"m"}') },
  },
  SetBodyVelocity: {
    domain: 'mechanics',
    summary: '改物体初速度',
    fields: { bodyId: id('物体 id'), velocity: vector('velocity', '如 {x:10, y:0, unit:"m/s"}') },
  },
  SetGravityAcceleration: {
    domain: 'mechanics',
    summary: '改重力加速度矢量',
    fields: { fieldId: id('重力场 id'), acceleration: vector('acceleration', '如 {x:0, y:-9.8, unit:"m/s^2"}') },
  },
  SetInclineAngle: {
    domain: 'mechanics（斜面）',
    summary: '改斜面倾角（0° 到 90° 之间）',
    fields: {
      observableId: { kind: 'observable_id', description: '斜面几何可观察量 id' },
      angleDegrees: number('倾角，单位度'),
    },
  },
  SetFrictionCoefficient: {
    domain: 'mechanics',
    summary: '改动摩擦因数 μ（≥ 0）',
    fields: { bodyId: id('物体 id'), coefficient: number('μ，无量纲') },
  },
  SetStaticFrictionCoefficient: {
    domain: 'mechanics（摩擦台）',
    summary: '改静摩擦因数 μs（≥ 0）——最大静摩擦的阈值系数',
    fields: { bodyId: id('物体 id'), coefficient: number('μs，无量纲') },
  },
  SetSpringConstant: {
    domain: 'mechanics（弹簧）',
    summary: '改弹簧劲度系数 k（> 0）',
    fields: {
      constraintId: id('弹簧约束 id（携带 stiffness 参数）'),
      constant: number('劲度系数 k，单位 N/m'),
    },
  },
  SetPendulumLength: {
    domain: 'mechanics（单摆）',
    summary: '改摆长 L（> 0）',
    fields: {
      constraintId: id('摆绳约束 id（携带 length 参数）'),
      length: number('摆长，单位 m'),
    },
  },
  SetAppliedForce: {
    domain: 'mechanics（牛顿第二定律）',
    summary: '改外力矢量',
    fields: { forceId: id('力 id'), targetId: id('受力物体 id'), vector: vector('force', '如 {x:10, y:0, unit:"N"}') },
  },
  SetGroundLevel: {
    domain: 'mechanics（抛体）',
    summary: '改地面高度',
    fields: {
      observableId: { kind: 'observable_id', description: '地面几何可观察量 id' },
      groundY: number('地面高度，单位 m'),
    },
  },
  SetComponentResistance: {
    domain: 'circuit',
    summary: '改定值电阻 / 滑动变阻器的电阻',
    fields: { circuitId: id('电路 id'), componentId: id('元件 id'), resistance: quantity('resistance', '如 {value:10, unit:"Ω"}') },
  },
  SetSourceVoltage: {
    domain: 'circuit',
    summary: '改电源电动势',
    fields: { circuitId: id('电路 id'), componentId: id('电源 id'), voltage: quantity('electric_potential', '如 {value:6, unit:"V"}') },
  },
  SetSourceInternalResistance: {
    domain: 'circuit',
    summary: '改电源内阻',
    fields: { circuitId: id('电路 id'), componentId: id('电源 id'), internalResistance: quantity('resistance', '如 {value:0.5, unit:"Ω"}') },
  },
  SetSwitchState: {
    domain: 'circuit',
    summary: '闭合 / 断开开关',
    fields: { circuitId: id('电路 id'), componentId: id('开关 id'), state: choice(['open', 'closed'], '开关状态') },
  },
  SetSliderPosition: {
    domain: 'circuit',
    summary: '改滑动变阻器滑片位置（0..1）',
    fields: { circuitId: id('电路 id'), componentId: id('滑动变阻器 id'), position: number('0 到 1') },
  },
  SetComponentPlacement: {
    domain: 'circuit',
    summary: '移动元件在原理图上的摆放位置（纯展示，不改物理事实，不触发实验分支）',
    fields: {
      circuitId: id('电路 id'),
      componentId: id('元件 id'),
      x: number('原理图栅格 x'),
      y: number('原理图栅格 y'),
    },
  },
  SetOpticalObjectPosition: {
    domain: 'optics',
    summary: '改物的位置（在元件入射侧，负 x）',
    fields: { benchId: id('光具座 id'), position: quantity('length', '如 {value:-30, unit:"cm"}') },
  },
  SetOpticalObjectHeight: {
    domain: 'optics',
    summary: '改物高（> 0）',
    fields: { benchId: id('光具座 id'), height: quantity('length', '如 {value:6, unit:"cm"}') },
  },
  SetLensFocalLength: {
    domain: 'optics（透镜）',
    summary: '改薄透镜焦距（非零，> 0 会聚）',
    fields: { benchId: id('光具座 id'), elementId: id('透镜 id'), focalLength: quantity('length', '如 {value:10, unit:"cm"}') },
  },
  SetMirrorFocalLength: {
    domain: 'optics（球面镜）',
    summary: '改球面镜焦距（> 0 凹面镜，< 0 凸面镜）',
    fields: { benchId: id('光具座 id'), elementId: id('镜 id'), focalLength: quantity('length', '如 {value:-10, unit:"cm"}') },
  },
  SetOpticalScreenPosition: {
    domain: 'optics',
    summary: '改光屏位置',
    fields: { benchId: id('光具座 id'), position: quantity('length', '如 {value:15, unit:"cm"}') },
  },
  SetAcousticReflectorPosition: {
    domain: 'acoustics',
    summary: '改反射面（峭壁）位置',
    fields: { benchId: id('声学台 id'), position: quantity('length', '如 {value:340, unit:"m"}') },
  },
  SetAcousticSoundSpeed: {
    domain: 'acoustics',
    summary: '改介质中的声速（> 0）',
    fields: { benchId: id('声学台 id'), soundSpeed: quantity('velocity', '如 {value:1500, unit:"m/s"}') },
  },
  SetLiquidDensity: {
    domain: 'fluid',
    summary: '改液体密度（> 0）',
    fields: { tankId: id('水槽 id'), density: quantity('density', '如 {value:1030, unit:"kg/m^3"}') },
  },
  SetBlockMass: {
    domain: 'fluid',
    summary: '改物块质量（> 0）',
    fields: { tankId: id('水槽 id'), mass: quantity('mass', '如 {value:0.27, unit:"kg"}') },
  },
  SetHeaterPower: {
    domain: 'thermal',
    summary: '改加热功率（> 0）',
    fields: { benchId: id('热学台 id'), power: quantity('power', '如 {value:50, unit:"W"}') },
  },
  SetSampleMass: {
    domain: 'thermal',
    summary: '改样品质量（> 0）',
    fields: { benchId: id('热学台 id'), mass: quantity('mass', '如 {value:0.1, unit:"kg"}') },
  },
  SetHangerMass: {
    domain: 'mechanics（杠杆）',
    summary: '改某个钩码的质量（> 0）',
    fields: { leverId: id('杠杆 id'), hangerId: id('钩码 id'), mass: quantity('mass', '如 {value:0.2, unit:"kg"}') },
  },
  SetHangerArm: {
    domain: 'mechanics（杠杆）',
    summary: '改某个钩码到支点的力臂（> 0）',
    fields: { leverId: id('杠杆 id'), hangerId: id('钩码 id'), armLength: quantity('length', '如 {value:15, unit:"cm"}') },
  },
  SetInductionFieldStrength: {
    domain: 'induction',
    summary: '改感应台磁感应强度（> 0）',
    fields: { benchId: id('感应台 id'), strength: quantity('magnetic_flux_density', '如 {value:0.5, unit:"T"}') },
  },
  SetInductionLoopResistance: {
    domain: 'induction',
    summary: '改回路电阻（> 0）',
    fields: { benchId: id('感应台 id'), resistance: quantity('resistance', '如 {value:5, unit:"Ω"}') },
  },
  SetInductionBarVelocity: {
    domain: 'induction（导体棒）',
    summary: '改棒速（正负 = 切割方向）',
    fields: { benchId: id('感应台 id'), velocity: quantity('velocity', '如 {value:2, unit:"m/s"}') },
  },
  SetInductionBarLength: {
    domain: 'induction（导体棒）',
    summary: '改棒长（> 0）',
    fields: { benchId: id('感应台 id'), length: quantity('length', '如 {value:20, unit:"cm"}') },
  },
  SetInductionFluxRate: {
    domain: 'induction（磁通量变化）',
    summary: '改磁通量变化率 dΦ/dt（正负 = 增加 / 减少）',
    fields: { benchId: id('感应台 id'), fluxRate: quantity('magnetic_flux_rate', '如 {value:0.05, unit:"Wb/s"}') },
  },
  SetInductionBarMasses: {
    domain: 'induction（双棒）',
    summary: '改两根导体棒的质量（各自 > 0，按 [棒1, 棒2] 位置）',
    fields: {
      benchId: id('感应台 id'),
      masses: quantity('mass', '如 [{value:100, unit:"g"}, {value:0.1, unit:"kg"}]，各元素单位独立'),
    },
  },
  SetInductionBarVelocityOne: {
    domain: 'induction（双棒）',
    summary: '改某一根棒的初速度（正负 = 沿导轨方向；barIndex 1 = 棒1，2 = 棒2）',
    fields: { benchId: id('感应台 id'), barIndex: choice(['1', '2'], '1 = 棒1，2 = 棒2'), velocity: quantity('velocity', '如 {value:2, unit:"m/s"}') },
  },
  SetInductionExternalForce: {
    domain: 'induction（双棒）',
    summary: '改作用在棒 1 上的恒定外力（≥ 0；0 = 自由双棒，动量守恒）',
    fields: { benchId: id('感应台 id'), force: quantity('force', '如 {value:0.01, unit:"N"}') },
  },
  SetWaveAmplitude: {
    domain: 'wave',
    summary: '改振幅（> 0）',
    fields: { benchId: id('波动台 id'), amplitude: quantity('length', '如 {value:5, unit:"cm"}') },
  },
  SetWaveFrequency: {
    domain: 'wave（绳波 / 干涉）',
    summary: '改波源频率；介质定波速，λ = v/f 自动重推（驻波台拒绝）',
    fields: { benchId: id('波动台 id'), frequency: quantity('frequency', '如 {value:5, unit:"Hz"}') },
  },
  SetWaveSpeed: {
    domain: 'wave',
    summary: '改介质波速；绳波 / 干涉重推 λ = v/f，驻波重推 f_n = n·v/2L',
    fields: { benchId: id('波动台 id'), speed: quantity('velocity', '如 {value:2, unit:"m/s"}') },
  },
  SetWavePathDifference: {
    domain: 'wave（干涉）',
    summary: '改观察点的路程差 Δ（0 ≤ Δ ≤ 波源间距）',
    fields: { benchId: id('波动台 id'), pathDifference: quantity('length', '如 {value:0.1, unit:"m"}') },
  },
  SetWaveStringLength: {
    domain: 'wave（驻波）',
    summary: '改弦长（> 0），f_n 随之重推',
    fields: { benchId: id('波动台 id'), stringLength: quantity('length', '如 {value:1, unit:"m"}') },
  },
  SetWaveHarmonic: {
    domain: 'wave（驻波）',
    summary: '改谐波次数 n（正整数）',
    fields: { benchId: id('波动台 id'), harmonic: number('正整数') },
  },
}

export const COMMAND_TYPES: readonly SceneCommandType[] = Object.keys(COMMAND_SPECS) as SceneCommandType[]

/** Compact, model-readable reference of every command and its payload. */
export const commandReferenceText = (): string =>
  COMMAND_TYPES.map((type) => {
    const spec = COMMAND_SPECS[type]
    const fields = Object.entries(spec.fields)
      .map(([name, field]) => {
        switch (field.kind) {
          case 'quantity':
            return `${name}: {value, unit}`
          case 'vector':
            return `${name}: {x, y, z?, unit}`
          case 'enum':
            return `${name}: ${field.values.map((value) => `"${value}"`).join(' | ')}`
          case 'number':
            return `${name}: number`
          case 'boolean':
            return `${name}: boolean`
          default:
            return `${name}: string`
        }
      })
      .join(', ')
    return `- ${type} [${spec.domain}] ${spec.summary}. payload: { ${fields} }`
  }).join('\n')

export class CommandPayloadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'CommandPayloadError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finiteNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CommandPayloadError('INVALID_PAYLOAD', `字段 ${field} 必须是有限数字。`)
  }
  return value
}

const nonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CommandPayloadError('INVALID_PAYLOAD', `字段 ${field} 必须是非空字符串。`)
  }
  return value
}

/**
 * Complete a model-supplied payload into the shape the SceneRuntime validates:
 * quantities gain their dimension, vectors gain a z of 0, observable ids are
 * branded. Missing or mistyped fields fail here with a readable message; unit
 * validity and physical rules are the runtime's verdict, not this function's.
 */
export const normalizeCommandPayload = (
  type: SceneCommandType,
  raw: unknown,
): Record<string, unknown> => {
  const spec = COMMAND_SPECS[type]
  if (spec === undefined) {
    throw new CommandPayloadError('UNKNOWN_COMMAND', `未知的命令类型 ${String(type)}。`)
  }
  if (!isRecord(raw)) {
    throw new CommandPayloadError('INVALID_PAYLOAD', 'payload 必须是一个对象。')
  }
  const payload: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(spec.fields)) {
    const value = raw[name]
    if (value === undefined) {
      throw new CommandPayloadError('INVALID_PAYLOAD', `命令 ${type} 缺少字段 ${name}。`)
    }
    switch (field.kind) {
      case 'string':
        payload[name] = nonEmptyString(value, name)
        break
      case 'observable_id':
        payload[name] = asObservableId(nonEmptyString(value, name))
        break
      case 'number':
        payload[name] = finiteNumber(value, name)
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new CommandPayloadError('INVALID_PAYLOAD', `字段 ${name} 必须是布尔值。`)
        }
        payload[name] = value
        break
      case 'enum':
        if (typeof value !== 'string' || !field.values.includes(value)) {
          throw new CommandPayloadError(
            'INVALID_PAYLOAD',
            `字段 ${name} 只能是 ${field.values.join(' / ')} 之一。`,
          )
        }
        payload[name] = value
        break
      case 'quantity': {
        if (!isRecord(value)) {
          throw new CommandPayloadError('INVALID_PAYLOAD', `字段 ${name} 必须是 {value, unit}。`)
        }
        payload[name] = {
          value: finiteNumber(value['value'], `${name}.value`),
          unit: nonEmptyString(value['unit'], `${name}.unit`),
          dimension: field.dimension,
        }
        break
      }
      case 'vector': {
        if (!isRecord(value)) {
          throw new CommandPayloadError('INVALID_PAYLOAD', `字段 ${name} 必须是 {x, y, z?, unit}。`)
        }
        payload[name] = {
          vector: {
            x: finiteNumber(value['x'], `${name}.x`),
            y: finiteNumber(value['y'], `${name}.y`),
            z: value['z'] === undefined ? 0 : finiteNumber(value['z'], `${name}.z`),
          },
          unit: nonEmptyString(value['unit'], `${name}.unit`),
          dimension: field.dimension,
        }
        break
      }
    }
  }
  return payload
}
