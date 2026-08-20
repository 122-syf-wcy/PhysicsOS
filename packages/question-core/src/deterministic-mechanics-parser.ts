import type { QuestionDocument } from './question-document.ts'
import type { QuestionParserProvider, QuestionParseCandidate } from './question-parser.ts'
import type {
  PhysicsSemanticIR,
  KnownValue,
  SemanticTarget,
  SemanticRelation,
  SemanticAssumption,
  QuestionParseIssue,
  MechanicsModelId,
} from './semantic-ir.ts'
import { parseQuantity, canonicalValue, isKnownUnit } from '@physicsos/physics-units'

function parseScientificNumber(text: string): { value: number; raw: string } | null {
  const patterns = [
    /([+-]?\d+\.?\d*)\s*[×x*]\s*10\^?(-?\d+)/g,
    /([+-]?\d+\.?\d*)e(-?\d+)/gi,
  ]
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m && m[1] && m[2]) {
      const mantissa = parseFloat(m[1])
      const exponent = parseInt(m[2], 10)
      return { value: mantissa * Math.pow(10, exponent), raw: m[0] }
    }
  }
  const simple = /([+-]?\d+\.?\d*)/.exec(text)
  if (simple && simple[1]) {
    return { value: parseFloat(simple[1]), raw: simple[0] }
  }
  return null
}

function extractValueWithUnit(text: string, patterns: readonly RegExp[], defaultUnit: string): { siValue: number; originalValue: number; originalUnit: string } | null {
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m && m[1]) {
      const parsed = parseScientificNumber(m[1])
      if (!parsed) continue
      const unitStr = (m[2] || defaultUnit).trim()
      if (!isKnownUnit(unitStr)) continue
      try {
        const q = parseQuantity(parsed.value, unitStr)
        const siValue = canonicalValue(q)
        return { siValue, originalValue: parsed.value, originalUnit: unitStr }
      } catch {
        continue
      }
    }
  }
  return null
}

function detectModel(text: string): MechanicsModelId {
  if (/斜面|incline/.test(text)) return 'inclined_plane'
  if (/平抛|斜抛|抛体|projectile|抛出|水平抛/.test(text)) return 'projectile_motion'
  if (/牛顿|newton|合力|net.?force/.test(text)) return 'newton_second_law'
  if (/匀速|uniform.*linear|匀速直线/.test(text)) return 'uniform_linear_motion'
  if (/匀加速|匀变速|accelerated|加速度.*=.*\d|加速度为/.test(text)) return 'uniformly_accelerated_motion'
  return 'uniformly_accelerated_motion'
}

function detectTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  if (/末速度|final.?velocity|v\s*=/.test(text)) targets.push('final_velocity')
  if (/位移|displacement|s\s*=/.test(text)) targets.push('displacement')
  if (/时间|time|t\s*=/.test(text)) targets.push('time')
  if (/加速度|acceleration|a\s*=/.test(text)) targets.push('acceleration')
  if (/射程|range/.test(text)) targets.push('range')
  if (/最大高度|max.?height|max.?h/.test(text)) targets.push('max_height')
  if (/落地时间|flight.?time/.test(text)) targets.push('flight_time')
  if (/支持力|normal.?force|N\s*=/.test(text)) targets.push('normal_force')
  if (/摩擦力|friction/.test(text)) targets.push('friction_force')
  if (/合力|net.?force/.test(text)) targets.push('net_force')
  if (/速度|velocity/.test(text)) targets.push('velocity')
  if (/力|force/.test(text) && !targets.includes('net_force')) targets.push('force')
  return targets
}

const MECH_PATTERNS = {
  velocity: [
    /(\d+\.?\d*)\s*(m\/s|km\/s|km\/h)/i,
    /初速度(?:为|是|=)?\s*(\d+\.?\d*)\s*(m\/s|km\/s|km\/h)?/i,
    /[^加]速度(?:为|是|=)?\s*(\d+\.?\d*)\s*(m\/s|km\/s|km\/h)?/i,
    /v0?\s*=?\s*(\d+\.?\d*)\s*(m\/s|km\/s|km\/h)?/i,
  ],
  acceleration: [
    /加速度(?:为|是|=)?\s*(\d+\.?\d*)\s*(m\/s\^2)?/i,
    /a\s*=?\s*(\d+\.?\d*)\s*(m\/s\^2)?/i,
  ],
  time: [
    /运动\s*(\d+\.?\d*)\s*(s|ms|min)?/i,
    /时间\s*=?\s*(\d+\.?\d*)\s*(s|ms|min)?/i,
    /t\s*=?\s*(\d+\.?\d*)\s*(s|ms|min)?/i,
  ],
  height: [
    /从\s*(\d+\.?\d*)\s*(m|cm|km)\s*高/i,
    /高(?:度)?(?:为|是|=)?\s*(\d+\.?\d*)\s*(m|cm|km)?/i,
    /(\d+\.?\d*)\s*(m|cm)\s*高/i,
  ],
  mass: [
    /m\s*=?\s*(\d+\.?\d*)\s*(kg|g)?/i,
    /质量(?:为|是|=)?\s*(\d+\.?\d*)\s*(kg|g)?/i,
    /(\d+\.?\d*)\s*(kg|g)/i,
  ],
  force: [
    /力\s*=?\s*(\d+\.?\d*)\s*(N)?/i,
    /合力(?:为|是|=)?\s*(\d+\.?\d*)\s*(N)?/i,
    /作用力(?:为|是|=)?\s*(\d+\.?\d*)\s*(N)?/i,
    /F\s*=?\s*(\d+\.?\d*)\s*(N)?/i,
  ],
  angle: [
    /(\d+\.?\d*)\s*°/,
    /角度\s*=?\s*(\d+\.?\d*)/,
    /倾角\s*=?\s*(\d+\.?\d*)/,
    /θ\s*=?\s*(\d+\.?\d*)/,
  ],
  friction: [
    /摩擦系数\s*=?\s*(\d+\.?\d*)/,
    /μ\s*=?\s*(\d+\.?\d*)/,
  ],
  gravity: [
    /g\s*=?\s*(\d+\.?\d*)\s*(m\/s\^2)?/i,
    /重力加速度\s*=?\s*(\d+\.?\d*)\s*(m\/s\^2)?/i,
  ],
  horizontalSpeed: [
    /水平速度\s*=?\s*(\d+\.?\d*)\s*(m\/s|km\/s)?/i,
  ],
  launchAngle: [
    /抛射角\s*=?\s*(\d+\.?\d*)\s*°?/,
    /与.*水平.*成\s*(\d+\.?\d*)\s*°?/,
  ],
} as const

function makeKnown(key: string, label: string, symbol: string, siValue: number, unit: string, dimension: string): KnownValue {
  return { key, label, symbol, value: siValue, unit, dimension, displayValue: `${siValue} ${unit}` }
}

export const DeterministicMechanicsQuestionParser: QuestionParserProvider = {
  id: 'deterministic-mechanics-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []
    const model = detectModel(text)

    const velResult = extractValueWithUnit(text, MECH_PATTERNS.velocity, 'm/s')
    if (velResult) knowns.push(makeKnown('initial_velocity', '初速度', 'v0', velResult.siValue, 'm/s', 'velocity'))

    const accResult = extractValueWithUnit(text, MECH_PATTERNS.acceleration, 'm/s^2')
    if (accResult) knowns.push(makeKnown('acceleration', '加速度', 'a', accResult.siValue, 'm/s^2', 'acceleration'))

    const timeResult = extractValueWithUnit(text, MECH_PATTERNS.time, 's')
    if (timeResult) knowns.push(makeKnown('time', '时间', 't', timeResult.siValue, 's', 'time'))

    const heightResult = extractValueWithUnit(text, MECH_PATTERNS.height, 'm')
    if (heightResult) knowns.push(makeKnown('height', '高度', 'h', heightResult.siValue, 'm', 'length'))

    const massResult = extractValueWithUnit(text, MECH_PATTERNS.mass, 'kg')
    if (massResult) knowns.push(makeKnown('mass', '质量', 'm', massResult.siValue, 'kg', 'mass'))

    const forceResult = extractValueWithUnit(text, MECH_PATTERNS.force, 'N')
    if (forceResult) knowns.push(makeKnown('applied_force', '作用力', 'F', forceResult.siValue, 'N', 'force'))

    const gravResult = extractValueWithUnit(text, MECH_PATTERNS.gravity, 'm/s^2')
    if (gravResult) knowns.push(makeKnown('gravity', '重力加速度', 'g', gravResult.siValue, 'm/s^2', 'acceleration'))

    const hSpeedResult = extractValueWithUnit(text, MECH_PATTERNS.horizontalSpeed, 'm/s')
    if (hSpeedResult) knowns.push(makeKnown('horizontal_speed', '水平速度', 'vx', hSpeedResult.siValue, 'm/s', 'velocity'))

    const angleMatch = text.match(/(\d+\.?\d*)\s*°/)
    let inclineAngle: number | undefined
    let launchAngle: number | undefined
    if (angleMatch && angleMatch[1]) {
      const angle = parseFloat(angleMatch[1])
      if (model === 'inclined_plane') inclineAngle = angle
      else if (model === 'projectile_motion') launchAngle = angle
    }

    const frictionMatch = text.match(/(?:摩擦系数|μ)\s*=?\s*(\d+\.?\d*)/)
    let frictionCoefficient: number | undefined
    if (frictionMatch && frictionMatch[1]) {
      frictionCoefficient = parseFloat(frictionMatch[1])
      knowns.push(makeKnown('friction_coefficient', '摩擦系数', 'μ', frictionCoefficient, '', 'dimensionless'))
    }

    const targets = detectTargets(text)

    const relations: SemanticRelation[] = []
    const assumptions: SemanticAssumption[] = []
    let entities: PhysicsSemanticIR['entities'] = ['body']

    if (model === 'uniform_linear_motion') {
      relations.push('constant_velocity')
      assumptions.push('no_air_resistance')
    } else if (model === 'uniformly_accelerated_motion') {
      relations.push('constant_acceleration')
      assumptions.push('no_air_resistance', 'constant_force')
    } else if (model === 'projectile_motion') {
      relations.push('free_flight')
      assumptions.push('no_air_resistance')
      entities = ['body', 'gravity_field', 'ground']
    } else if (model === 'newton_second_law') {
      assumptions.push('constant_force')
    } else if (model === 'inclined_plane') {
      relations.push('on_incline')
      assumptions.push('kinetic_friction')
      if (frictionCoefficient === undefined || frictionCoefficient === 0) {
        assumptions.push('kinetic_friction')
      }
      entities = ['body', 'gravity_field', 'incline']
    }

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'mechanics',
      model,
      entities,
      knowns,
      unknowns: targets.map((t) => ({ key: t, label: t, symbol: '' })),
      constraints: [{ type: model, description: 'Mechanics model constraint' }],
      relations,
      targets,
      assumptions,
      chargeSign: 'unknown',
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
      ...(inclineAngle !== undefined ? { inclineAngle } : {}),
      ...(launchAngle !== undefined ? { launchAngle } : {}),
      ...(frictionCoefficient !== undefined ? { frictionCoefficient } : {}),
    }

    if (knowns.length < 2) {
      issues.push({ code: 'PARTIAL_PARSE', message: '未能提取足够已知条件', severity: 'warning' })
    }

    return { ir, issues, confidence: knowns.length >= 2 ? 0.9 : 0.5 }
  },
}
