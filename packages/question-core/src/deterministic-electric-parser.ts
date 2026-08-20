import { canonicalValue, isKnownUnit, parseQuantity } from '@physicsos/physics-units'

import type { QuestionDocument } from './question-document.ts'
import type { QuestionParseCandidate, QuestionParserProvider } from './question-parser.ts'
import type {
  KnownValue,
  PhysicsSemanticIR,
  PlanarDirection,
  QuestionParseIssue,
  SemanticAssumption,
  SemanticRelation,
  SemanticTarget,
} from './semantic-ir.ts'

const ELECTRIC_SIGNAL = /匀强电场|电场强度|场强|电场方向|electric\s+field|\bE\s*=/i
const MAGNETIC_SIGNAL = /匀强磁场|磁感应强度|磁场方向|洛伦兹力|\bB\s*=/i

export const isElectricQuestionText = (text: string): boolean =>
  ELECTRIC_SIGNAL.test(text) && !MAGNETIC_SIGNAL.test(text)

function parseScientificNumber(text: string): number | null {
  const normalized = text.replace(/\s+/g, '')
  const scientific = /^([+-]?\d+(?:\.\d+)?)\s*[×x*]\s*10\^?([+-]?\d+)$/i.exec(normalized)
  if (scientific?.[1] !== undefined && scientific[2] !== undefined) {
    return Number(scientific[1]) * 10 ** Number(scientific[2])
  }
  const exponent = /^([+-]?\d+(?:\.\d+)?)e([+-]?\d+)$/i.exec(normalized)
  if (exponent?.[1] !== undefined && exponent[2] !== undefined) {
    return Number(exponent[1]) * 10 ** Number(exponent[2])
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

interface ExtractedValue {
  readonly siValue: number
  readonly originalUnit: string
}

function extractValueWithUnit(
  text: string,
  patterns: readonly RegExp[],
  defaultUnit: string,
): ExtractedValue | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1] === undefined) continue
    const value = parseScientificNumber(match[1])
    const unit = (match[2] ?? defaultUnit).trim()
    if (value === null || !isKnownUnit(unit)) continue
    try {
      return { siValue: canonicalValue(parseQuantity(value, unit)), originalUnit: unit }
    } catch {
      continue
    }
  }
  return null
}

const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?(?:\s*[×x*]\s*10\^?[+-]?\d+|e[+-]?\d+)?`

const ELECTRIC_PATTERNS = {
  charge: [
    new RegExp(String.raw`q\s*=\s*(${NUMBER})\s*(C)?`, 'i'),
    new RegExp(String.raw`电荷量?(?:为|是|=)?\s*(${NUMBER})\s*(C)?`, 'i'),
    new RegExp(String.raw`带(?:正|负)?电(?:荷量?)?\s*(${NUMBER})\s*(C)`, 'i'),
  ],
  mass: [
    new RegExp(String.raw`m\s*=\s*(${NUMBER})\s*(kg|g)?`, 'i'),
    new RegExp(String.raw`质量(?:为|是|=)?\s*(${NUMBER})\s*(kg|g)?`, 'i'),
  ],
  initialVelocity: [
    new RegExp(String.raw`(?:初速度|速度|速率)(?:为|是|=)?\s*(${NUMBER})\s*(m/s|km/s|km/h)?`, 'i'),
    new RegExp(String.raw`v0?\s*=\s*(${NUMBER})\s*(m/s|km/s|km/h)?`, 'i'),
    new RegExp(String.raw`以\s*(${NUMBER})\s*(m/s|km/s|km/h)`, 'i'),
  ],
  electricField: [
    new RegExp(String.raw`(?:电场强度|场强)(?:大小)?(?:为|是|=)?\s*(${NUMBER})\s*(V/m|N/C)?`, 'i'),
    new RegExp(String.raw`\bE\s*=\s*(${NUMBER})\s*(V/m|N/C)?`, 'i'),
  ],
  time: [
    new RegExp(String.raw`(?:运动|经过|历时)\s*(${NUMBER})\s*(s|ms|min)`, 'i'),
    new RegExp(String.raw`时间(?:为|是|=)?\s*(${NUMBER})\s*(s|ms|min)?`, 'i'),
    new RegExp(String.raw`\bt\s*=\s*(${NUMBER})\s*(s|ms|min)?`, 'i'),
  ],
} as const

function known(
  key: string,
  label: string,
  symbol: string,
  value: number,
  unit: string,
  dimension: string,
): KnownValue {
  return {
    key,
    label,
    symbol,
    value,
    unit,
    dimension,
    displayValue: `${value} ${unit}`,
  }
}

function directionIn(fragment: string): PlanarDirection {
  if (/向右|水平向右|x\s*轴正方向|positive\s+x/i.test(fragment)) return 'right'
  if (/向左|水平向左|x\s*轴负方向|negative\s+x/i.test(fragment)) return 'left'
  if (/向上|竖直向上|y\s*轴正方向|positive\s+y/i.test(fragment)) return 'up'
  if (/向下|竖直向下|y\s*轴负方向|negative\s+y/i.test(fragment)) return 'down'
  return 'unknown'
}

function detectElectricFieldDirection(text: string): PlanarDirection {
  const explicit = /(?:电场|场强|E)[^。；;]{0,40}?(?:方向(?:为|是)?|沿)\s*([^，,。；;]+)/i.exec(text)
  if (explicit?.[1] !== undefined) return directionIn(explicit[1])
  const beforeField = /((?:水平|竖直)?向[上下左右]|[xy]\s*轴[正负]方向)[^。；;]{0,12}(?:的)?匀强电场/i.exec(text)
  return beforeField?.[1] === undefined ? 'unknown' : directionIn(beforeField[1])
}

function detectInitialVelocityDirection(text: string): PlanarDirection {
  const explicit = /(?:初速度|速度|以)[^。；;]{0,40}?(?:方向(?:为|是)?|沿)\s*([^，,。；;]+)/i.exec(text)
  if (explicit?.[1] !== undefined) return directionIn(explicit[1])
  const afterSpeed = /(?:m\/s|km\/s|km\/h)\s*(?:，|,)?\s*(?:速度)?(?:方向(?:为|是)?|沿)?\s*((?:水平|竖直)?向[上下左右]|[xy]\s*轴[正负]方向)/i.exec(text)
  return afterSpeed?.[1] === undefined ? 'unknown' : directionIn(afterSpeed[1])
}

function chargeSign(text: string, value: number | undefined): PhysicsSemanticIR['chargeSign'] {
  if (/电子|负电荷|带负电/.test(text) || (value !== undefined && value < 0)) return 'negative'
  if (/质子|正电荷|带正电/.test(text) || (value !== undefined && value > 0)) return 'positive'
  return 'unknown'
}

function detectTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  const add = (target: SemanticTarget): void => {
    if (!targets.includes(target)) targets.push(target)
  }
  if (/电场力|库仑力|electric\s+force/i.test(text)) add('electric_force')
  if (/加速度|acceleration/i.test(text)) add('acceleration')
  if (/末速度|最终速度|final\s+velocity/i.test(text)) add('final_velocity')
  if (/位移|偏转(?:量|距离)?|displacement|deflection/i.test(text)) add('displacement')
  if (/运动轨迹|轨迹|trajectory/i.test(text)) add('trajectory')
  if (/电势(?:的)?变化|电势差|Δ\s*[φϕ]|delta\s*(?:phi|potential)/i.test(text)) add('electric_potential_change')
  if (/电势能(?:的)?变化|Δ\s*U|delta\s*U/i.test(text)) add('electric_potential_energy_change')
  if (/动能(?:的)?变化|Δ\s*K|delta\s*K/i.test(text)) add('kinetic_energy_change')
  if (/电场力(?:所)?做功|电场做功|electric\s+work/i.test(text)) add('work_by_electric_field')
  if (/动能(?!.*变化)|kinetic\s+energy(?!\s+change)/i.test(text)) add('kinetic_energy')
  return targets
}

const targetMetadata = (target: SemanticTarget): { label: string; symbol: string } => {
  const values: Partial<Record<SemanticTarget, { label: string; symbol: string }>> = {
    electric_force: { label: '电场力', symbol: 'F' },
    acceleration: { label: '加速度', symbol: 'a' },
    final_velocity: { label: '末速度', symbol: 'v' },
    displacement: { label: '位移', symbol: 'Δr' },
    trajectory: { label: '运动轨迹', symbol: '' },
    electric_potential_change: { label: '电势变化', symbol: 'Δφ' },
    electric_potential_energy_change: { label: '电势能变化', symbol: 'ΔU' },
    kinetic_energy: { label: '动能', symbol: 'K' },
    kinetic_energy_change: { label: '动能变化', symbol: 'ΔK' },
    work_by_electric_field: { label: '电场力做功', symbol: 'W' },
  }
  return values[target] ?? { label: target, symbol: '' }
}

export const DeterministicElectricQuestionParser: QuestionParserProvider = {
  id: 'deterministic-electric-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    const chargeValue = extractValueWithUnit(text, ELECTRIC_PATTERNS.charge, 'C')?.siValue
    if (chargeValue !== undefined) {
      knowns.push(known('charge', '电荷量', 'q', chargeValue, 'C', 'electric_charge'))
    }
    const mass = extractValueWithUnit(text, ELECTRIC_PATTERNS.mass, 'kg')
    if (mass !== null) knowns.push(known('mass', '质量', 'm', mass.siValue, 'kg', 'mass'))
    const velocity = extractValueWithUnit(text, ELECTRIC_PATTERNS.initialVelocity, 'm/s')
    if (velocity !== null) {
      knowns.push(known('initial_velocity', '初速度', 'v0', velocity.siValue, 'm/s', 'velocity'))
    }
    const electricField = extractValueWithUnit(text, ELECTRIC_PATTERNS.electricField, 'V/m')
    if (electricField !== null) {
      knowns.push(known('electric_field_strength', '电场强度', 'E', electricField.siValue, 'V/m', 'electric_field'))
    }
    const time = extractValueWithUnit(text, ELECTRIC_PATTERNS.time, 's')
    if (time !== null) knowns.push(known('time', '时间', 't', time.siValue, 's', 'time'))

    const electricFieldDirection = detectElectricFieldDirection(text)
    const initialVelocityDirection = detectInitialVelocityDirection(text)
    const targets = detectTargets(text)
    const relations: SemanticRelation[] = ['charged_particle_in_uniform_electric_field']
    if (electricFieldDirection !== 'unknown' && initialVelocityDirection !== 'unknown') {
      const parallel =
        electricFieldDirection === initialVelocityDirection ||
        (electricFieldDirection === 'right' && initialVelocityDirection === 'left') ||
        (electricFieldDirection === 'left' && initialVelocityDirection === 'right') ||
        (electricFieldDirection === 'up' && initialVelocityDirection === 'down') ||
        (electricFieldDirection === 'down' && initialVelocityDirection === 'up')
      relations.push(parallel ? 'velocity_parallel_E' : 'velocity_perpendicular_E')
    }
    const assumptions: SemanticAssumption[] = [
      'uniform_electric_field',
      'electric_force_only',
      'ignore_magnetic_field',
      'ignore_gravity',
    ]

    if (!isElectricQuestionText(text)) {
      issues.push({
        code: 'NOT_ELECTRIC_QUESTION',
        message: '题目没有形成明确的电场模型，或同时出现了磁场条件。',
        severity: 'error',
      })
    }
    if (knowns.length < 3) {
      issues.push({ code: 'PARTIAL_PARSE', message: '未能提取足够的电场题已知条件。', severity: 'warning' })
    }
    if (targets.length === 0) {
      issues.push({ code: 'MISSING_TARGET', message: '未识别到需要求解的物理量。', severity: 'error' })
    }

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'electric',
      model: 'charged_particle_uniform_electric_field',
      entities: ['particle', 'electric_field'],
      knowns,
      unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
      constraints: [
        { type: 'uniform_electric_field', description: '带电粒子只受恒定电场力作用' },
      ],
      relations,
      targets,
      assumptions,
      chargeSign: chargeSign(text, chargeValue),
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
      electricFieldDirection,
      initialVelocityDirection,
    }

    const confidence = isElectricQuestionText(text) && knowns.length >= 3 && targets.length > 0 ? 0.95 : 0.2
    return { ir, issues, confidence }
  },
}
