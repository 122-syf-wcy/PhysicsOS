import { canonicalValue, isKnownUnit, parseQuantity } from '@physicsos/physics-units'

import type { QuestionDocument } from './question-document.ts'
import type { QuestionParseCandidate, QuestionParserProvider } from './question-parser.ts'
import type {
  InductionModelId,
  KnownValue,
  PhysicsSemanticIR,
  QuestionParseIssue,
  SemanticAssumption,
  SemanticRelation,
  SemanticTarget,
} from './semantic-ir.ts'

/**
 * Deterministic induction-question parser (电磁感应).
 *
 * An induction question names either a conducting rod cutting field lines
 * (导体棒切割磁感线, E = BLv) or a coil whose flux changes (磁通量变化,
 * E = -dΦ/dt), plus a loop resistance R, and asks for the 感应电动势 /
 * 感应电流 / 磁通量 / 感应电流方向. The parser extracts B, L, v (or dΦ/dt),
 * R, records the sub-model, and emits a
 * `PhysicsSemanticIR { domain: 'induction', model: 'bar_motion_emf' | 'flux_change_emf' }`.
 *
 * It must NOT claim a pure-magnetic (洛伦兹力圆周运动) or pure-circuit (电源
 * 电动势) question. Those have no cutting rod and no flux-change statement, so
 * the signal requires an induction keyword (切割磁感线/磁通量/感应电动势/
 * 电磁感应) BEFORE the shared B/R keywords are even considered.
 */

/**
 * Induction signal. The discriminator is the induction keyword itself — a rod
 * cutting field lines or a flux change producing an EMF. A bare 磁场/磁感应强度
 * is a magnetic-force question (rejected), and a bare 电路/电动势 is a circuit
 * question (rejected).
 */
const INDUCTION_SIGNAL = /电磁感应|感应电动势|感应电流|切割磁感线|磁通量|感生电场|动生电动势/

/**
 * Signals that mark a question as NOT induction even when the induction signal
 * fires. A cyclotron alternates fields (unsupported by every current model);
 * the composite parser owns crossed-field worlds.
 */
const NON_INDUCTION_SIGNAL = /回旋加速器|速度选择器|质谱仪|正交.*场|复合场/

export const isInductionQuestionText = (text: string): boolean =>
  INDUCTION_SIGNAL.test(text) && !NON_INDUCTION_SIGNAL.test(text)

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
/** Length unit symbols the parser recognizes. */
const LENGTH_UNIT = String.raw`(?:cm|mm|m|dm)`
/** Area unit symbols the parser recognizes. */
const AREA_UNIT = String.raw`(?:cm²|cm2|cm\^2|mm²|mm2|m²|m2|m\^2)`
/** Field unit symbols the parser recognizes. */
const FIELD_UNIT = String.raw`(?:T|mT)`

const INDUCTION_PATTERNS = {
  magneticFluxDensity: [
    new RegExp(String.raw`磁感应强度(?:为|是|=)?\s*(${NUMBER})\s*(${FIELD_UNIT})?`, 'i'),
    new RegExp(String.raw`\bB\s*=\s*(${NUMBER})\s*(${FIELD_UNIT})?`, 'i'),
  ],
  /** Loop resistance: R = 5 Ω / 电阻 R 为 5Ω / 回路电阻. */
  resistance: [
    new RegExp(String.raw`(?:回路)?电阻(?:为|是|=)?\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
    new RegExp(String.raw`\bR\s*=\s*(${NUMBER})\s*(${RESISTANCE_UNIT})?\b`),
  ],
  /** Rod length: L = 20 cm / 棒长 0.2 m / 导体棒长. */
  barLength: [
    new RegExp(String.raw`(?:导体)?棒(?:长|长度)(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`\bL\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`),
    new RegExp(String.raw`棒长\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
  ],
  /** Rod velocity: v = 2 m/s / 速度为 2m/s / 以 2 m/s 的速度. */
  barVelocity: [
    new RegExp(String.raw`\bv\s*=\s*(${NUMBER})\s*(m\/s|cm\/s|km\/h)?\b`, 'i'),
    new RegExp(String.raw`速度(?:为|是|=)?\s*(${NUMBER})\s*(m\/s|cm\/s|km\/h)?`, 'i'),
    new RegExp(String.raw`以\s*(${NUMBER})\s*(m\/s|cm\/s|km\/h)?\s*的速度`, 'i'),
  ],
  /** Coil area: 面积 50 cm² / S = 0.005 m². */
  coilArea: [
    new RegExp(String.raw`面积(?:为|是|=)?\s*(${NUMBER})\s*(${AREA_UNIT})?`, 'i'),
    new RegExp(String.raw`\bS\s*=\s*(${NUMBER})\s*(${AREA_UNIT})?`, 'i'),
  ],
  /** Coil angle to the field (degrees). */
  coilAngle: [
    new RegExp(String.raw`夹角(?:为|是|=)?\s*(${NUMBER})\s*(?:°|度|deg)`, 'i'),
    new RegExp(String.raw`θ\s*=\s*(${NUMBER})\s*(?:°|度|deg)`, 'i'),
  ],
  /** Flux change rate: 磁通量变化率 0.05 Wb/s / 每秒变化 0.05 Wb / dΦ/dt. */
  fluxRate: [
    new RegExp(String.raw`磁通量(?:的)?变化率(?:为|是|=)?\s*(${NUMBER})\s*(Wb\/s|Wb\s*\*\s*s\^?-?1|韦伯\/秒)?`, 'i'),
    new RegExp(String.raw`磁通量每秒(?:变化|增加|减少)\s*(${NUMBER})\s*(Wb)?`, 'i'),
    new RegExp(String.raw`\bdΦ\/dt\s*=\s*(${NUMBER})\s*(Wb\/s)?`, 'i'),
    new RegExp(String.raw`磁通量变化\s*(${NUMBER})\s*Wb`, 'i'),
  ],
  /** The flux at a moment, for a question that states it directly. */
  flux: [
    new RegExp(String.raw`磁通量(?:为|是|=)\s*(${NUMBER})\s*(Wb|mWb)?`, 'i'),
    new RegExp(String.raw`Φ\s*=\s*(${NUMBER})\s*(Wb|mWb)?`, 'i'),
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

/**
 * Which induction sub-model the text describes. A cutting rod names 切割磁感线
 * or a rod (导体棒/金属棒/直导线); a coil whose flux changes names 磁通量变化
 * without a rod. When both signals appear the rod wins — a rod sweeping
 * through a field IS a flux change, and the bar-motion model carries the extra
 * geometry (L, v) the question surely stated.
 */
function detectSubModel(text: string): InductionModelId {
  const hasBarSignal = /切割磁感线|导体棒|金属棒|金属杆|直导线|滑轨|导轨/.test(text)
  const hasFluxSignal = /磁通量.*(?:变化|改变|增加|减少)|磁通量变化率|dΦ\/dt/.test(text)
  if (hasBarSignal) return 'bar_motion_emf'
  if (hasFluxSignal) return 'flux_change_emf'
  /* A coil in a changing field with no rod anywhere. */
  return 'flux_change_emf'
}

function detectTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  const add = (target: SemanticTarget): void => {
    if (!targets.includes(target)) targets.push(target)
  }
  if (/感应电动势|电动势.*多大|求.*电动势|感应电压/.test(text)) add('induced_emf')
  if (/感应电流|求.*电流/.test(text)) add('induced_current')
  if (/磁通量/.test(text)) add('magnetic_flux')
  if (/感应电流.*方向|电流方向|判断.*方向|楞次/.test(text)) add('induction_direction')
  return targets
}

const targetMetadata = (target: SemanticTarget): { label: string; symbol: string } => {
  const values: Partial<Record<SemanticTarget, { label: string; symbol: string }>> = {
    induced_emf: { label: '感应电动势', symbol: 'E' },
    induced_current: { label: '感应电流', symbol: 'I' },
    magnetic_flux: { label: '磁通量', symbol: 'Φ' },
    induction_direction: { label: '感应电流方向', symbol: '' },
  }
  return values[target] ?? { label: target, symbol: '' }
}

export const DeterministicInductionQuestionParser: QuestionParserProvider = {
  id: 'deterministic-induction-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    const model = detectSubModel(text)
    const isBarMotion = model === 'bar_motion_emf'

    /* Magnetic flux density and loop resistance are shared by both rigs. */
    const field = extractValueWithUnit(text, INDUCTION_PATTERNS.magneticFluxDensity, 'T')
    if (field !== null) {
      knowns.push(known('magnetic_field_strength', '磁感应强度', 'B', field.siValue, 'T', 'magnetic_flux_density'))
    }
    const resistance = extractValueWithUnit(text, INDUCTION_PATTERNS.resistance, 'Ω')
    if (resistance !== null) {
      knowns.push(known('resistance_1', '回路电阻', 'R', resistance.siValue, 'Ω', 'resistance'))
    }

    /* Sub-model specific geometry. */
    if (isBarMotion) {
      const barLength = extractValueWithUnit(text, INDUCTION_PATTERNS.barLength, 'm')
      if (barLength !== null) {
        knowns.push(known('bar_length', '棒长', 'L', barLength.siValue, 'm', 'length'))
      }
      const barVelocity = extractValueWithUnit(text, INDUCTION_PATTERNS.barVelocity, 'm/s')
      if (barVelocity !== null) {
        knowns.push(known('bar_velocity', '棒速', 'v', barVelocity.siValue, 'm/s', 'velocity'))
      }
    } else {
      const coilArea = extractValueWithUnit(text, INDUCTION_PATTERNS.coilArea, 'm^2')
      if (coilArea !== null) {
        knowns.push(known('coil_area', '线圈面积', 'S', coilArea.siValue, 'm^2', 'area'))
      }
      const coilAngle = extractValueWithUnit(text, INDUCTION_PATTERNS.coilAngle, 'deg')
      if (coilAngle !== null) {
        /* Angle is stored in radians so the scene builder can hand it to
           Φ = B·S·cosθ without a unit dance. */
        knowns.push(known('coil_angle', '夹角', 'θ', (coilAngle.siValue * Math.PI) / 180, 'rad', 'angle'))
      }
      const fluxRate = extractValueWithUnit(text, INDUCTION_PATTERNS.fluxRate, 'Wb/s')
      if (fluxRate !== null) {
        knowns.push(known('flux_rate', '磁通量变化率', 'dΦ/dt', fluxRate.siValue, 'Wb/s', 'magnetic_flux_rate'))
      }
      const flux = extractValueWithUnit(text, INDUCTION_PATTERNS.flux, 'Wb')
      if (flux !== null && fluxRate === null) {
        knowns.push(known('magnetic_flux', '磁通量', 'Φ', flux.siValue, 'Wb', 'magnetic_flux'))
      }
    }

    const targets = detectTargets(text)

    /* Entities reflect the apparatus the question describes. */
    const entities: PhysicsSemanticIR['entities'] = isBarMotion
      ? ['conducting_bar', 'magnetic_field', 'circuit_loop']
      : ['coil', 'magnetic_field', 'circuit_loop']

    const relations: SemanticRelation[] = isBarMotion
      ? ['bar_cuts_field_lines', 'faraday_law']
      : ['flux_changes_in_coil', 'faraday_law', 'lenz_law']

    const assumptions: SemanticAssumption[] = isBarMotion
      ? ['uniform_magnetic_field_perpendicular', 'constant_velocity_bar', 'ideal_conducting_loop']
      : ['uniform_magnetic_field_perpendicular', 'constant_flux_rate', 'ideal_conducting_loop']

    if (!isInductionQuestionText(text)) {
      issues.push({
        code: 'NOT_INDUCTION_QUESTION',
        message: '题目没有描述导体棒切割磁感线或磁通量变化的电磁感应装置。',
        severity: 'error',
      })
    }
    if (field === null) {
      issues.push({ code: 'MISSING_B_FIELD', message: '缺少磁感应强度。', severity: 'warning' })
    }
    if (resistance === null) {
      issues.push({ code: 'MISSING_RESISTANCE', message: '缺少回路电阻。', severity: 'warning' })
    }
    if (isBarMotion) {
      const hasBarLength = knowns.some((entry) => entry.key === 'bar_length')
      const hasBarVelocity = knowns.some((entry) => entry.key === 'bar_velocity')
      if (!hasBarLength) {
        issues.push({ code: 'MISSING_BAR_LENGTH', message: '缺少导体棒长度。', severity: 'warning' })
      }
      if (!hasBarVelocity) {
        issues.push({ code: 'MISSING_BAR_VELOCITY', message: '缺少导体棒速度。', severity: 'warning' })
      }
    } else {
      const hasFluxRate = knowns.some((entry) => entry.key === 'flux_rate')
      const hasFlux = knowns.some((entry) => entry.key === 'magnetic_flux')
      if (!hasFluxRate && !hasFlux) {
        issues.push({
          code: 'MISSING_FLUX_CHANGE',
          message: '缺少磁通量变化率或磁通量。',
          severity: 'warning',
        })
      }
    }
    if (targets.length === 0) {
      issues.push({
        code: 'MISSING_TARGET',
        message: '未识别到需要求解的物理量。',
        severity: 'error',
      })
    }

    const knownOf = (key: string): number | undefined =>
      knowns.find((entry) => entry.key === key)?.value
    /* Structured geometry fields are spread per sub-model; the exactOptionalPropertyTypes
       contract means an absent value must omit the key, not pass undefined. */
    const barLengthValue = knownOf('bar_length')
    const barVelocityValue = knownOf('bar_velocity')
    const coilAreaValue = knownOf('coil_area')
    const coilAngleValue = knownOf('coil_angle')
    const fluxRateValue = knownOf('flux_rate')
    const barGeometry =
      isBarMotion && barLengthValue !== undefined && barVelocityValue !== undefined
        ? {
            inductionBarLength: barLengthValue,
            inductionBarVelocity: barVelocityValue,
          }
        : {}
    const coilGeometry = !isBarMotion && fluxRateValue !== undefined
      ? {
            inductionFluxRate: fluxRateValue,
            ...(coilAreaValue !== undefined ? { inductionCoilArea: coilAreaValue } : {}),
            ...(coilAngleValue !== undefined ? { inductionCoilAngle: coilAngleValue } : {}),
          }
        : {}

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'induction',
      model,
      entities,
      knowns,
      unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
      constraints: [
        {
          type: model,
          description: isBarMotion
            ? '动生电动势 E = BLv（右手定则定方向），感应电流 I = E/R'
            : "法拉第电磁感应定律 E = -dΦ/dt（楞次定律定方向），感应电流 I = E/R",
        },
      ],
      relations,
      targets,
      assumptions,
      chargeSign: 'unknown',
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
      ...barGeometry,
      ...coilGeometry,
    }

    const hasCoreKnowns =
      isInductionQuestionText(text) &&
      field !== null &&
      resistance !== null &&
      targets.length > 0 &&
      (isBarMotion
        ? knowns.some((entry) => entry.key === 'bar_length') &&
          knowns.some((entry) => entry.key === 'bar_velocity')
        : knowns.some((entry) => entry.key === 'flux_rate'))
    const confidence = hasCoreKnowns ? 0.9 : 0.3
    return { ir, issues, confidence }
  },
}
