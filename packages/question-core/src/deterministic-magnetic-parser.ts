import type { QuestionDocument } from './question-document.ts'
import type { QuestionParserProvider, QuestionParseCandidate } from './question-parser.ts'
import type {
  PhysicsSemanticIR,
  KnownValue,
  SemanticTarget,
  SemanticRelation,
  SemanticAssumption,
  QuestionParseIssue,
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

function extractValueWithUnit(text: string, patterns: readonly RegExp[], canonicalUnit: string): { siValue: number; originalValue: number; originalUnit: string } | null {
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m && m[1]) {
      const raw = m[1].trim()
      const parsed = parseScientificNumber(raw)
      if (!parsed) continue
      const unitStr = m[2] || canonicalUnit
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

function detectChargeSign(text: string): 'positive' | 'negative' | 'unknown' {
  if (/质子|正电|正电荷|\+\s*1/i.test(text)) return 'positive'
  if (/电子|负电|负电荷/i.test(text)) return 'negative'
  return 'unknown'
}

function detectFieldDirection(text: string): 'into_page' | 'out_of_page' | 'unknown' {
  if (/垂直纸面向里|向里|into[_ ]?page/i.test(text)) return 'into_page'
  if (/垂直纸面向外|向外|out[_ ]?of[_ ]?page/i.test(text)) return 'out_of_page'
  return 'unknown'
}

function detectVelocityDirection(text: string): 'perpendicular_to_B' | 'parallel_to_B' | 'unknown' {
  if (/垂直|perpendicular|垂直径?入|垂?直?进入/i.test(text)) return 'perpendicular_to_B'
  if (/平行|parallel/i.test(text)) return 'parallel_to_B'
  return 'unknown'
}

function detectTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  if (/洛伦兹力|lorentz|力/i.test(text)) targets.push('force')
  if (/半径|radius|轨道.*半径|r\s*=|R\s*=/i.test(text)) targets.push('radius')
  if (/周期|period|T\s*=/i.test(text)) targets.push('period')
  if (/方向|direction|运动.*方向|判断.*方向/i.test(text)) targets.push('rotation_direction')
  if (/轨迹|trajectory|运动.*轨迹/i.test(text)) targets.push('trajectory')
  return targets
}

function formatScientific(value: number, unit: string): string {
  if (Math.abs(value) >= 1e4 || (Math.abs(value) < 1e-2 && value !== 0)) {
    const exp = Math.floor(Math.log10(Math.abs(value)))
    const mantissa = value / Math.pow(10, exp)
    const supExp = exp.toString().replace(/-/g, '⁻').replace(/0/g, '⁰').replace(/1/g, '¹').replace(/2/g, '²').replace(/3/g, '³').replace(/4/g, '⁴').replace(/5/g, '⁵').replace(/6/g, '⁶').replace(/7/g, '⁷').replace(/8/g, '⁸').replace(/9/g, '⁹')
    return mantissa.toFixed(2) + '×10' + supExp + ' ' + unit
  }
  return value.toString() + ' ' + unit
}

const KNOWN_PATTERNS = {
  charge: [
    /q\s*=\s*([+-]?\d+\.?\d*\s*[×x*]?\s*10\^?-?\d+)\s*(C)?/i,
    /([+-]?\d+\.?\d*\s*[×x*]\s*10\^?-?\d+)\s*C/i,
    /([+-]?\d+\.?\d*e-?\d+)\s*C/i,
  ],
  mass: [
    /m\s*=\s*([+-]?\d+\.?\d*\s*[×x*]?\s*10\^?-?\d+)\s*(kg|g)?/i,
    /([+-]?\d+\.?\d*\s*[×x*]\s*10\^?-?\d+)\s*(kg|g)/i,
    /([+-]?\d+\.?\d*e-?\d+)\s*(kg|g)/i,
  ],
  velocity: [
    /v\s*=\s*([+-]?\d+\.?\d*\s*[×x*]?\s*10\^?-?\d+)\s*(m\/s|km\/s|km\/h)?/i,
    /([+-]?\d+\.?\d*\s*[×x*]\s*10\^?-?\d+)\s*(m\/s|km\/s|km\/h)/i,
    /([+-]?\d+\.?\d*e-?\d+)\s*(m\/s|km\/s|km\/h)/i,
    /([+-]?\d+\.?\d*)\s*(m\/s|km\/s|km\/h)/i,
  ],
  bField: [
    /B\s*=\s*([+-]?\d+\.?\d*)\s*(T|mT)?/i,
    /([+-]?\d+\.?\d*)\s*(T|mT)(?:\s|[,，。$])/i,
  ],
} as const

function extractKnown(text: string, key: string, patterns: readonly RegExp[], canonicalUnit: string, dimension: string, label: string, symbol: string): KnownValue | null {
  const result = extractValueWithUnit(text, patterns, canonicalUnit)
  if (result) {
    return {
      key,
      label,
      symbol,
      value: result.siValue,
      unit: canonicalUnit,
      dimension,
      displayValue: formatScientific(result.siValue, canonicalUnit),
    }
  }
  return null
}

export const DeterministicMagneticQuestionParser: QuestionParserProvider = {
  id: 'deterministic-magnetic-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    const charge = extractKnown(text, 'charge', KNOWN_PATTERNS.charge, 'C', 'electric_charge', '电荷量', 'q')
    if (charge) knowns.push(charge)

    const mass = extractKnown(text, 'mass', KNOWN_PATTERNS.mass, 'kg', 'mass', '质量', 'm')
    if (mass) knowns.push(mass)

    const velocity = extractKnown(text, 'velocity', KNOWN_PATTERNS.velocity, 'm/s', 'velocity', '速度', 'v')
    if (velocity) knowns.push(velocity)

    const bField = extractKnown(text, 'magnetic_field_strength', KNOWN_PATTERNS.bField, 'T', 'magnetic_flux_density', '磁感应强度', 'B')
    if (bField) knowns.push(bField)

    const chargeSign = detectChargeSign(text)
    const fieldDirection = detectFieldDirection(text)
    const velocityDirection = detectVelocityDirection(text)
    const targets = detectTargets(text)
    const relations: SemanticRelation[] = velocityDirection === 'perpendicular_to_B' ? ['velocity_perpendicular_B'] : []
    const assumptions: SemanticAssumption[] = ['uniform_magnetic_field', 'magnetic_force_only', 'ignore_electric_field', 'ignore_gravity']

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'magnetic',
      model: 'charged_particle_uniform_magnetic_field',
      entities: ['particle', 'magnetic_field'],
      knowns,
      unknowns: targets.map((t) => ({ key: t, label: targetLabel(t), symbol: targetSymbol(t) })),
      constraints: [{ type: 'velocity_perpendicular_B', description: '速度方向垂直于磁场方向' }],
      relations,
      targets,
      assumptions,
      chargeSign,
      fieldDirection,
      velocityDirection,
    }

    if (knowns.length < 4) {
      issues.push({ code: 'PARTIAL_PARSE', message: '未能提取全部已知条件', severity: 'warning' })
    }

    return { ir, issues, confidence: knowns.length >= 4 && chargeSign !== 'unknown' ? 0.95 : 0.7 }
  },
}

function targetLabel(t: SemanticTarget): string {
  const map: Partial<Record<SemanticTarget, string>> = {
    force: '洛伦兹力',
    radius: '轨道半径',
    period: '运动周期',
    rotation_direction: '运动方向',
    trajectory: '运动轨迹',
  }
  return map[t] ?? t
}

function targetSymbol(t: SemanticTarget): string {
  const map: Partial<Record<SemanticTarget, string>> = {
    force: 'F',
    radius: 'R',
    period: 'T',
    rotation_direction: '',
    trajectory: '',
  }
  return map[t] ?? ''
}
