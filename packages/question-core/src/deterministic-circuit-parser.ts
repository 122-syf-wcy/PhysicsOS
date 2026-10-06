import { canonicalValue, isKnownUnit, parseQuantity } from '@physicsos/physics-units'

import type { QuestionDocument } from './question-document.ts'
import type { QuestionParseCandidate, QuestionParserProvider } from './question-parser.ts'
import type {
  KnownValue,
  PhysicsSemanticIR,
  QuestionParseIssue,
  SemanticAssumption,
  SemanticRelation,
  SemanticTarget,
} from './semantic-ir.ts'

/**
 * Deterministic circuit-question parser.
 *
 * A circuit question names a DC source (battery / 电动势 / 电源), resistors,
 * and the topology (串联 / 并联 / 滑动变阻器), and asks for one of
 * {电流, 电压, 电阻, 电功率, 路端电压, 内阻}. The parser extracts the EMF,
 * internal resistance and external resistances, records the topology, and
 * emits a `PhysicsSemanticIR { domain: 'circuit', model: 'dc_steady_state_mna' }`.
 *
 * It must NOT claim an electrostatic-field question: those name 电场强度 / 点电荷 /
 * 电场力, none of which appear here, and the runtime tests both signals in
 * order (circuit first only when it carries circuit-specific keywords without
 * an electric-field keyword).
 */

/**
 * Circuit signal. The single most discriminating keywords are 电路 / 串联 / 并联 /
 * 电动势 / 内阻 / 欧姆定律 / 滑动变阻器 / 电流表 / 电压表. A bare 电流/电压/电阻
 * is NOT enough — those also appear in electrostatics (电流 through a particle,
 * 电压 = electric potential). The signal therefore requires at least one
 * circuit-architecture keyword OR (a power/emf keyword AND a resistance keyword).
 */
const CIRCUIT_ARCH_SIGNAL =
  /串联|并联|滑动变阻器|变阻器|电流表|电压表|欧姆定律|电路|电源|干路|支路|路端电压|电功率/
const CIRCUIT_VALUE_SIGNAL = /电动势|内阻|功率|电功率|瓦|千瓦|\bW\b/

const ELECTRIC_FIELD_SIGNAL =
  /匀强电场|电场强度|点电荷|电场力|电场方向|电容器|平行板|偏转|洛伦兹力|磁感应强度|匀强磁场/

export const isCircuitQuestionText = (text: string): boolean => {
  if (ELECTRIC_FIELD_SIGNAL.test(text)) return false
  if (CIRCUIT_ARCH_SIGNAL.test(text)) return true
  /* A pure value question ("求电流" with R and U) is only a circuit question
     when it has no electric-field keyword — caught above — and names a power
     or EMF quantity. */
  if (CIRCUIT_VALUE_SIGNAL.test(text) && /\b电阻|欧姆|Ω\b/.test(text)) return true
  return false
}

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

/** Resistance unit symbols the parser recognizes. */
const RESISTANCE_UNIT = String.raw`(?:Ω|ohm|kΩ|kohm|MΩ)`

const CIRCUIT_PATTERNS = {
  emf: [
    new RegExp(String.raw`电动势(?:为|是|=)?\s*(${NUMBER})\s*(V|mV|kV)?`, 'i'),
    new RegExp(String.raw`\bE\s*=\s*(${NUMBER})\s*(V|mV|kV)?`, 'i'),
    new RegExp(String.raw`电源(?:电压|电动势)(?:为|是|=)?\s*(${NUMBER})\s*(V|mV|kV)?`, 'i'),
  ],
  internalResistance: [
    new RegExp(String.raw`内阻(?:为|是|=)?\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?`, 'i'),
    new RegExp(String.raw`\br\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?`, 'i'),
  ],
  /** Single named resistor: R1 = 10 Ω / R0 = 10 Ω / 电阻 R1 为 20 Ω / 电阻 R = 15Ω.
      Case-sensitive on the Latin R so that a lower-case "r = 0.5 Ω" (the
      internal-resistance symbol) is NOT claimed as an external resistor. */
  resistance: [
    new RegExp(String.raw`R\s*1\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
    new RegExp(String.raw`R\s*2\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
    new RegExp(String.raw`R\s*0\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
    new RegExp(String.raw`R\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
    new RegExp(
      String.raw`电阻(?:器)?\s*R\s*[0-9]?(?:为|是|=)?\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`,
    ),
    new RegExp(String.raw`电阻(?:为|是|=)?\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
  ],
  /** Named resistors stated together: R1 = 10 Ω，R2 = 20 Ω. Case-sensitive (see above). */
  resistanceList: [
    new RegExp(String.raw`R\s*1\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
    new RegExp(String.raw`R\s*2\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
    new RegExp(String.raw`R\s*0\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
  ],
  /** Voltage (terminal voltage / across a resistor): U = 6 V / 电压 4.5 V. */
  voltage: [
    new RegExp(String.raw`(?:路端)?电压(?:为|是|=)?\s*(${NUMBER})\s*(V|mV|kV)?`, 'i'),
    new RegExp(String.raw`\bU\s*=\s*(${NUMBER})\s*(V|mV|kV)?`, 'i'),
  ],
  /** Current: I = 0.5 A / 电流 0.3 A / 电流表读数为 0.4 A. The ammeter phrasing
      comes first: the generic 电流 pattern cannot see past 表读数, and a stated
      reading is exactly what the runtime's stated-vs-computed cross-check needs
      in the IR — dropping it would let a contradictory reading pass as though
      the stem never made the claim. */
  current: [
    new RegExp(
      String.raw`电流表(?:的)?(?:读数|示数)(?:为|是|=|达到)?\s*(${NUMBER})\s*(A|mA|μA|µA|uA)?`,
      'i',
    ),
    new RegExp(String.raw`电流(?:为|是|=)?\s*(${NUMBER})\s*(A|mA|μA|µA|uA)?`, 'i'),
    new RegExp(String.raw`\bI\s*=\s*(${NUMBER})\s*(A|mA|μA|µA|uA)?`, 'i'),
  ],
  /** Power: P = 6 W / 电功率 12 W. */
  power: [
    new RegExp(String.raw`(?:电)?功率(?:为|是|=)?\s*(${NUMBER})\s*(W|mW|kW|MW)?`, 'i'),
    new RegExp(String.raw`\bP\s*=\s*(${NUMBER})\s*(W|mW|kW|MW)?`, 'i'),
  ],
  /** Rheostat total resistance: 变阻器最大阻值 / 滑动变阻器最大电阻. */
  rheostatTotal: [
    new RegExp(
      String.raw`(?:滑动)?变阻器最大(?:阻值|电阻)(?:为|是|=)?\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?`,
      'i',
    ),
    new RegExp(
      String.raw`变阻器(?:总|最大)阻值(?:为|是|=)?\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?`,
      'i',
    ),
  ],
} as const

const SERIES_SIGNAL = /串联|串接/
const PARALLEL_SIGNAL = /并联|并接/
const RHEOSTAT_SIGNAL = /滑动变阻器|变阻器|滑片|滑键/

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

function detectTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  const add = (target: SemanticTarget): void => {
    if (!targets.includes(target)) targets.push(target)
  }
  if (/求.*电流|电流(?:为|是|多少)|电流大小|干路电流|主路电流/i.test(text)) add('current')
  if (/求.*电压|电压(?:为|是|多少)|路端电压|端电压|两端电压/i.test(text)) add('voltage')
  if (/求.*电阻|总电阻|等效电阻|电阻(?:为|是|多少)/i.test(text)) add('resistance')
  if (/求.*功率|功率(?:为|是|多少)|总功率|电源功率|输出功率/i.test(text)) add('power')
  if (/求.*电动势|电动势(?:为|是|多少)/i.test(text)) add('emf')
  if (/求.*内阻|内阻(?:为|是|多少)/i.test(text)) add('internal_resistance')
  if (/求.*路端电压|端电压/i.test(text)) add('terminal_voltage')
  return targets
}

const targetMetadata = (target: SemanticTarget): { label: string; symbol: string } => {
  const values: Partial<Record<SemanticTarget, { label: string; symbol: string }>> = {
    current: { label: '电流', symbol: 'I' },
    voltage: { label: '电压', symbol: 'U' },
    resistance: { label: '电阻', symbol: 'R' },
    power: { label: '电功率', symbol: 'P' },
    emf: { label: '电动势', symbol: 'E' },
    internal_resistance: { label: '内阻', symbol: 'r' },
    terminal_voltage: { label: '路端电压', symbol: 'U' },
  }
  return values[target] ?? { label: target, symbol: '' }
}

function detectTopology(text: string): 'series' | 'parallel' | 'mixed' | 'rheostat' {
  if (RHEOSTAT_SIGNAL.test(text)) return 'rheostat'
  if (SERIES_SIGNAL.test(text) && PARALLEL_SIGNAL.test(text)) return 'mixed'
  if (PARALLEL_SIGNAL.test(text)) return 'parallel'
  if (SERIES_SIGNAL.test(text)) return 'series'
  return 'series'
}

export const DeterministicCircuitQuestionParser: QuestionParserProvider = {
  id: 'deterministic-circuit-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    const topology = detectTopology(text)

    const emf = extractValueWithUnit(text, CIRCUIT_PATTERNS.emf, 'V')
    if (emf !== null) {
      knowns.push(known('emf', '电动势', 'E', emf.siValue, 'V', 'electric_potential'))
    }
    const internal = extractValueWithUnit(text, CIRCUIT_PATTERNS.internalResistance, 'Ω')
    if (internal !== null) {
      knowns.push(known('internal_resistance', '内阻', 'r', internal.siValue, 'Ω', 'resistance'))
    }
    const voltage = extractValueWithUnit(text, CIRCUIT_PATTERNS.voltage, 'V')
    if (voltage !== null) {
      knowns.push(known('voltage', '电压', 'U', voltage.siValue, 'V', 'electric_potential'))
    }
    const current = extractValueWithUnit(text, CIRCUIT_PATTERNS.current, 'A')
    if (current !== null) {
      knowns.push(known('current', '电流', 'I', current.siValue, 'A', 'electric_current'))
    }
    const power = extractValueWithUnit(text, CIRCUIT_PATTERNS.power, 'W')
    if (power !== null) {
      knowns.push(known('power', '电功率', 'P', power.siValue, 'W', 'power'))
    }

    /* Resistances: prefer the R1/R2/R0 list when a question names named
       resistors; fall back to a single R or 电阻. Collect every distinct
       match across all list patterns, in pattern order. */
    const resistances: number[] = []
    const seenSi = new Set<number>()
    for (const pattern of CIRCUIT_PATTERNS.resistanceList) {
      const match = pattern.exec(text)
      if (match?.[1] === undefined) continue
      const v = parseScientificNumber(match[1])
      const u = (match[2] ?? 'Ω').trim()
      if (v === null || !isKnownUnit(u)) continue
      try {
        const si = canonicalValue(parseQuantity(v, u))
        if (!seenSi.has(si)) {
          seenSi.add(si)
          resistances.push(si)
        }
      } catch {
        /* skip unknown unit */
      }
    }
    if (resistances.length === 0) {
      /* Fall back to a single named resistor. Try the R= and 电阻= patterns,
         skipping the R1/R2/R0 list patterns already tried above. */
      const single = extractValueWithUnit(
        text,
        [
          CIRCUIT_PATTERNS.resistance[3],
          CIRCUIT_PATTERNS.resistance[4],
          CIRCUIT_PATTERNS.resistance[5],
        ],
        'Ω',
      )
      if (single !== null) resistances.push(single.siValue)
    }
    for (const [index, r] of resistances.entries()) {
      const label = resistances.length > 1 ? `电阻 R${index + 1}` : '电阻'
      knowns.push(known(`resistance_${index + 1}`, label, `R${index + 1}`, r, 'Ω', 'resistance'))
    }

    const rheostatTotal = extractValueWithUnit(text, CIRCUIT_PATTERNS.rheostatTotal, 'Ω')

    const hasVoltmeter = /电压表|伏特表/.test(text)
    const hasAmmeter = /电流表|安培表/.test(text)

    const targets = detectTargets(text)

    /* Entities reflect the components the question describes. */
    const entities: PhysicsSemanticIR['entities'] = ['circuit_loop', 'battery']
    if (resistances.length > 0 || rheostatTotal !== null) entities.push('resistor')
    if (hasAmmeter) entities.push('ammeter')
    if (hasVoltmeter) entities.push('voltmeter')
    if (topology === 'rheostat') entities.push('rheostat')

    const relations: SemanticRelation[] = ['ohms_law']
    if (topology === 'series') relations.push('series_circuit')
    else if (topology === 'parallel') relations.push('parallel_circuit')
    else if (topology === 'rheostat') relations.push('series_circuit', 'rheostat_sweep')

    const assumptions: SemanticAssumption[] = ['ideal_source', 'ideal_meters']

    if (!isCircuitQuestionText(text)) {
      issues.push({
        code: 'NOT_CIRCUIT_QUESTION',
        message: '题目没有形成明确的直流电路模型，或同时出现了电场/磁场条件。',
        severity: 'error',
      })
    }
    if (emf === null && voltage === null && current === null) {
      issues.push({
        code: 'MISSING_SOURCE',
        message: '缺少电动势、电压或电流作为电路的已知条件。',
        severity: 'warning',
      })
    }
    if (resistances.length === 0 && rheostatTotal === null && internal === null) {
      issues.push({
        code: 'MISSING_RESISTANCE',
        message: '未能提取任何电阻值。',
        severity: 'warning',
      })
    }
    if (targets.length === 0) {
      issues.push({
        code: 'MISSING_TARGET',
        message: '未识别到需要求解的物理量。',
        severity: 'error',
      })
    }

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'circuit',
      model: 'dc_steady_state_mna',
      entities,
      knowns,
      unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
      constraints: [
        { type: 'dc_circuit', description: '直流稳态电路，电源、电阻与电表构成单回路' },
      ],
      relations,
      targets,
      assumptions,
      chargeSign: 'unknown',
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
      circuitTopology: topology,
      ...(resistances.length > 0 ? { circuitResistances: resistances } : {}),
      hasVoltmeter,
      hasAmmeter,
      ...(rheostatTotal !== null
        ? { rheostatTotalResistance: rheostatTotal.siValue, rheostatSliderPosition: 0.5 }
        : {}),
    }

    const confidence =
      isCircuitQuestionText(text) &&
      (emf !== null || voltage !== null || current !== null) &&
      targets.length > 0
        ? 0.92
        : 0.2
    return { ir, issues, confidence }
  },
}
