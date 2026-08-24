/**
 * Deterministic composite-field question parser.
 *
 * Claims the questions where more than one of {E, B, g} acts on the same charged
 * particle, so the motion follows `F = qE + qv×B + mg` and no single-field engine
 * can model it. Three apparatuses are recognized:
 *
 *  - **velocity_selector** — crossed E ⟂ B, "不偏转 / 沿直线通过 / 选择速度".
 *  - **mass_spectrometer** — a selector followed by a magnetic deflection region,
 *    asking for a radius, a charge-to-mass ratio, or an isotope separation.
 *  - **charged_particle_composite_field** — E + B (+ g) acting together, the
 *    "带电小球在复合场中" family.
 *
 * The parser produces an IR and nothing else: it never computes `v = E/B`, never
 * decides a radius, and never resolves a direction into a force. Every number a
 * student sees comes from the engine that solves the scene this IR builds. A
 * parser that answered the question would be a second physics implementation, and
 * the two would drift.
 *
 * Cyclotron text is deliberately NOT claimed as a supported model: the composite
 * engine has no time-varying field, so a cyclotron IR would route to an engine
 * that cannot model it. It is detected only to report `UNSUPPORTED_MODEL` with an
 * honest reason instead of silently solving the wrong physics.
 */

import { canonicalValue, isKnownUnit, parseQuantity } from '@physicsos/physics-units'

import type { QuestionDocument } from './question-document.ts'
import type { QuestionParseCandidate, QuestionParserProvider } from './question-parser.ts'
import type {
  KnownValue,
  PhysicsSemanticIR,
  PlanarDirection,
  QuestionParseIssue,
  SemanticAssumption,
  SemanticEntity,
  SemanticRelation,
  SemanticTarget,
} from './semantic-ir.ts'

/* ------------------------------------------------------------- text signals -- */

const SELECTOR_SIGNAL = /速度选择器|速度筛选器|velocity\s+selector/i
const SPECTROMETER_SIGNAL = /质谱仪|质谱计|mass\s+spectrometer|荷质比|比荷|同位素/i
const CYCLOTRON_SIGNAL = /回旋加速器|cyclotron/i

/** Both field kinds named in one question is the defining composite signal. */
const ELECTRIC_FIELD_SIGNAL = /匀强电场|电场强度|场强|电场方向|电场力|\bE\s*=/i
const MAGNETIC_FIELD_SIGNAL = /匀强磁场|磁感应强度|磁场方向|洛伦兹力|\bB\s*=/i
const GRAVITY_SIGNAL = /重力|重力加速度|\bg\s*=|mg\b/i

/** "既有…又有" / "同时存在" / "互相垂直的电场和磁场" phrasings. */
const COEXIST_SIGNAL =
  /同时(?:存在|受到|加上)|既有.*又有|互相垂直的?(?:电场和?磁场|磁场和?电场)|正交(?:电磁场|场)|复合场|叠加场/i

/** Explicit "neglect gravity" wording, which removes g from the model. */
const IGNORE_GRAVITY_SIGNAL = /不计重力|忽略重力|重力不计|不考虑重力/i

/** The apparatus outcome a selector question describes. */
const UNDEFLECTED_SIGNAL = /不(?:发生)?偏转|沿(?:着)?直线|直线(?:通过|飞过|穿过|运动)|恰好(?:能)?通过|匀速(?:直线)?通过/

/**
 * True when a question needs the composite engine.
 *
 * Named apparatuses win outright. Otherwise the text has to put at least two of
 * the three field kinds on the SAME particle, which is why the coexistence
 * phrasing matters: a problem that mentions a magnetic field only to say it is
 * absent is not composite.
 */
export const isCompositeQuestionText = (text: string): boolean => {
  if (SELECTOR_SIGNAL.test(text) || SPECTROMETER_SIGNAL.test(text)) return true
  const hasE = ELECTRIC_FIELD_SIGNAL.test(text)
  const hasB = MAGNETIC_FIELD_SIGNAL.test(text)
  const hasG = GRAVITY_SIGNAL.test(text) && !IGNORE_GRAVITY_SIGNAL.test(text)
  if (hasE && hasB) return true
  /* E (or B) plus gravity is only composite when the text says they act together;
     "小球在电场中下落" already implies it, but "重力" appearing in a units line does
     not. The coexistence phrasing is the discriminator. */
  return (hasE || hasB) && hasG && COEXIST_SIGNAL.test(text)
}

/** True when the text describes a cyclotron, which this runtime cannot model. */
export const isCyclotronQuestionText = (text: string): boolean => CYCLOTRON_SIGNAL.test(text)

/* -------------------------------------------------------------- extraction -- */

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
const CHARGE_UNIT = String.raw`(?:mC|μC|µC|uC|nC|C)`

const PATTERNS = {
  charge: [
    new RegExp(String.raw`q\s*=\s*(${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
    new RegExp(String.raw`电荷量?(?:为|是|=)?\s*(${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
    new RegExp(String.raw`带(?:正|负)?电(?:荷量?)?\s*(${NUMBER})\s*(${CHARGE_UNIT})\b`, 'i'),
  ],
  mass: [
    new RegExp(String.raw`m\s*=\s*(${NUMBER})\s*(kg|g)?`, 'i'),
    new RegExp(String.raw`质量(?:为|是|=)?\s*(${NUMBER})\s*(kg|g)?`, 'i'),
  ],
  velocity: [
    new RegExp(String.raw`v0?\s*=\s*(${NUMBER})\s*(m/s|km/s|km/h)?`, 'i'),
    new RegExp(String.raw`(?:初速度|速度|速率)(?:为|是|=|大小为)?\s*(${NUMBER})\s*(m/s|km/s|km/h)?`, 'i'),
    new RegExp(String.raw`以\s*(${NUMBER})\s*(m/s|km/s|km/h)`, 'i'),
  ],
  electricField: [
    new RegExp(String.raw`E\s*=\s*(${NUMBER})\s*(V/m|N/C|kV/m)?`, 'i'),
    new RegExp(String.raw`(?:电场强度|场强)(?:为|是|=|大小为)?\s*(${NUMBER})\s*(V/m|N/C|kV/m)?`, 'i'),
  ],
  magneticField: [
    new RegExp(String.raw`B\s*=\s*(${NUMBER})\s*(T|mT|Gs)?`, 'i'),
    new RegExp(String.raw`磁感应强度(?:为|是|=|大小为)?\s*(${NUMBER})\s*(T|mT|Gs)?`, 'i'),
  ],
  gravity: [
    new RegExp(String.raw`g\s*=\s*(${NUMBER})\s*(m/s\^?2|m/s²|N/kg)?`, 'i'),
    new RegExp(String.raw`重力加速度(?:为|是|=|取)?\s*(${NUMBER})\s*(m/s\^?2|m/s²|N/kg)?`, 'i'),
  ],
  radius: [
    new RegExp(String.raw`(?:半径|轨道半径|圆周半径)(?:为|是|=)?\s*(${NUMBER})\s*(m|cm|mm)?`, 'i'),
    new RegExp(String.raw`r\s*=\s*(${NUMBER})\s*(m|cm|mm)?`, 'i'),
  ],
  time: [
    new RegExp(String.raw`(?:经过|运动|历时|用时|经)\s*(${NUMBER})\s*(s|ms|μs|µs|us|ns)`, 'i'),
    new RegExp(String.raw`t\s*=\s*(${NUMBER})\s*(s|ms|μs|µs|us|ns)?`, 'i'),
  ],
} as const

const known = (
  key: string,
  label: string,
  symbol: string,
  value: number,
  unit: string,
  dimension: string,
): KnownValue => ({ key, label, symbol, value, unit, dimension })

/* --------------------------------------------------------------- direction -- */

/** Charge sign from explicit wording, then from a signed value. */
function chargeSign(text: string, value: number | undefined): PhysicsSemanticIR['chargeSign'] {
  if (/负电|电子|负离子|阴离子/.test(text)) return 'negative'
  if (/正电|质子|正离子|阳离子/.test(text)) return 'positive'
  if (value !== undefined && value < 0) return 'negative'
  if (value !== undefined && value > 0 && /q\s*=\s*\+/.test(text)) return 'positive'
  return 'unknown'
}

function electricFieldDirection(text: string): PlanarDirection {
  if (/电场(?:方向)?(?:竖直)?向上|场强?(?:方向)?向上|向上的匀强电场/.test(text)) return 'up'
  if (/电场(?:方向)?(?:竖直)?向下|场强?(?:方向)?向下|向下的匀强电场/.test(text)) return 'down'
  if (/电场(?:方向)?(?:水平)?向右|向右的匀强电场/.test(text)) return 'right'
  if (/电场(?:方向)?(?:水平)?向左|向左的匀强电场/.test(text)) return 'left'
  return 'unknown'
}

function magneticOrientation(text: string): PhysicsSemanticIR['magneticFieldOrientation'] {
  if (/垂直(?:于)?(?:纸面|页面)(?:方向)?向?里|垂直纸面向内|指向纸内|into\s+the\s+page/.test(text)) {
    return 'into_page'
  }
  if (/垂直(?:于)?(?:纸面|页面)(?:方向)?向?外|指向纸外|out\s+of\s+the\s+page/.test(text)) {
    return 'out_of_page'
  }
  return undefined
}

/**
 * Direction of the entry velocity.
 *
 * Every rule requires the direction word to sit IMMEDIATELY before a motion verb.
 * A looser rule that allowed any distance matched "速度选择器中电场方向竖直向上" —
 * the apparatus name contains 速度 and the sentence continues into the FIELD
 * direction, so every selector question was parsed as a beam travelling upward and
 * the particle then missed the region entirely.
 */
const VELOCITY_DIRECTION_RULES: readonly { direction: PlanarDirection; test: RegExp }[] = [
  { direction: 'right', test: /从左(?:端|侧|方|边)[^。；;]{0,8}?(?:射|进|飞|穿)入/ },
  { direction: 'left', test: /从右(?:端|侧|方|边)[^。；;]{0,8}?(?:射|进|飞|穿)入/ },
  { direction: 'right', test: /水平(?:地|向右)?(?:射入|进入|飞入|入射|通过|穿过|运动)/ },
  { direction: 'right', test: /向右(?:地)?(?:射入|进入|飞入|入射|通过|穿过|运动)/ },
  { direction: 'left', test: /向左(?:地)?(?:射入|进入|飞入|入射|通过|穿过|运动)/ },
  { direction: 'up', test: /(?:竖直)?向上(?:地)?(?:射入|进入|飞入|入射|运动)/ },
  { direction: 'down', test: /(?:竖直)?向下(?:地)?(?:射入|进入|飞入|入射|运动)/ },
]

function initialVelocityDirection(text: string): PlanarDirection {
  for (const rule of VELOCITY_DIRECTION_RULES) {
    if (rule.test.test(text)) return rule.direction
  }
  return 'unknown'
}

/* ----------------------------------------------------------------- targets -- */

const TARGET_RULES: readonly { target: SemanticTarget; test: RegExp }[] = [
  { target: 'selected_velocity', test: /选择(?:出)?的?速度|被?选(?:出|中)的?速度|通过的?粒子的?速度|速度大小.*选择|求.*选择速度|能?(?:够)?通过.*速度/ },
  { target: 'mass_charge_ratio', test: /荷质比|比荷|q\s*\/\s*m|电荷质量比/ },
  { target: 'magnetic_force', test: /洛伦兹力|磁场力|安培力大小/ },
  { target: 'electric_force', test: /电场力/ },
  { target: 'net_force', test: /合力|净力|总受力/ },
  { target: 'radius', test: /半径/ },
  { target: 'period', test: /周期/ },
  { target: 'trajectory', test: /轨迹|运动路径|画出.*运动/ },
  { target: 'final_velocity', test: /末速度|离开.*速度|出射速度/ },
  { target: 'velocity', test: /速度大小(?!.*选择)/ },
  { target: 'kinetic_energy', test: /动能(?!变化)/ },
  { target: 'kinetic_energy_change', test: /动能变化|动能增加|动能减少/ },
  { target: 'deflection', test: /偏转(?:距离|位移|量)|偏移(?:距离|量)/ },
  { target: 'time', test: /时间(?!.*轴)/ },
  { target: 'acceleration', test: /加速度/ },
]

function detectTargets(text: string): SemanticTarget[] {
  const found = TARGET_RULES.filter((rule) => rule.test.test(text)).map((rule) => rule.target)
  return [...new Set(found)]
}

/* ------------------------------------------------------------------ models -- */

type CompositeModel = 'velocity_selector' | 'mass_spectrometer' | 'charged_particle_composite_field'

/**
 * Which apparatus the text describes.
 *
 * A spectrometer contains a selector, so the spectrometer signal is tested first:
 * a question that names both is asking about the spectrometer, and classifying it
 * as a bare selector would drop the deflection region the question is about.
 */
function detectModel(text: string): CompositeModel {
  if (SPECTROMETER_SIGNAL.test(text)) return 'mass_spectrometer'
  if (SELECTOR_SIGNAL.test(text)) return 'velocity_selector'
  /* An unnamed apparatus that describes crossed fields AND an undeflected beam is
     a selector in everything but name — the physics question is the balance. */
  if (
    ELECTRIC_FIELD_SIGNAL.test(text) &&
    MAGNETIC_FIELD_SIGNAL.test(text) &&
    UNDEFLECTED_SIGNAL.test(text)
  ) {
    return 'velocity_selector'
  }
  return 'charged_particle_composite_field'
}

/* --------------------------------------------------------------- assembling -- */

const entitiesOf = (hasElectric: boolean, hasMagnetic: boolean, hasGravity: boolean): SemanticEntity[] => {
  const entities: SemanticEntity[] = ['particle']
  if (hasElectric) entities.push('electric_field')
  if (hasMagnetic) entities.push('magnetic_field')
  if (hasGravity) entities.push('gravity_field')
  return entities
}

const relationsOf = (
  model: CompositeModel,
  text: string,
): SemanticRelation[] => {
  const relations: SemanticRelation[] = ['charged_particle_in_composite_field']
  if (model === 'velocity_selector' || model === 'mass_spectrometer') {
    relations.push('velocity_selection', 'electric_magnetic_force_balance')
  }
  if (model === 'mass_spectrometer') relations.push('magnetic_deflection_after_selection')
  if (/进入|射入|飞入|穿过|通过/.test(text)) relations.push('particle_enters_region')
  if (/离开|射出|飞出|穿出/.test(text)) relations.push('particle_exits_region')
  return [...new Set(relations)]
}

const assumptionsOf = (hasGravity: boolean, crossed: boolean): SemanticAssumption[] => {
  /* Never `ignore_electric_field` / `ignore_magnetic_field`: those are exactly what
     lets a single-field engine claim a composite scene. */
  const assumptions: SemanticAssumption[] = ['composite_field', 'electric_and_magnetic_force']
  if (crossed) assumptions.push('crossed_fields')
  if (hasGravity) assumptions.push('gravity_included')
  else assumptions.push('ignore_gravity')
  return assumptions
}

const TARGET_METADATA: Record<string, { label: string; symbol: string }> = {
  selected_velocity: { label: '选择速度', symbol: 'v' },
  mass_charge_ratio: { label: '荷质比', symbol: 'q/m' },
  magnetic_force: { label: '洛伦兹力', symbol: 'F_B' },
  electric_force: { label: '电场力', symbol: 'F_E' },
  net_force: { label: '合力', symbol: 'ΣF' },
  radius: { label: '轨道半径', symbol: 'r' },
  period: { label: '回旋周期', symbol: 'T' },
  trajectory: { label: '运动轨迹', symbol: '' },
  final_velocity: { label: '末速度', symbol: 'v' },
  velocity: { label: '速度', symbol: 'v' },
  kinetic_energy: { label: '动能', symbol: 'K' },
  kinetic_energy_change: { label: '动能变化', symbol: 'ΔK' },
  deflection: { label: '偏转距离', symbol: 'y' },
  time: { label: '时间', symbol: 't' },
  acceleration: { label: '加速度', symbol: 'a' },
}

const targetMetadata = (target: SemanticTarget): { label: string; symbol: string } =>
  TARGET_METADATA[target] ?? { label: target, symbol: '' }

export const DeterministicCompositeQuestionParser: QuestionParserProvider = {
  id: 'deterministic-composite-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    const chargeValue = extractValueWithUnit(text, PATTERNS.charge, 'C')?.siValue
    if (chargeValue !== undefined) {
      knowns.push(known('charge', '电荷量', 'q', chargeValue, 'C', 'electric_charge'))
    }
    const mass = extractValueWithUnit(text, PATTERNS.mass, 'kg')
    if (mass !== null) knowns.push(known('mass', '质量', 'm', mass.siValue, 'kg', 'mass'))
    const velocity = extractValueWithUnit(text, PATTERNS.velocity, 'm/s')
    if (velocity !== null) {
      knowns.push(known('initial_velocity', '初速度', 'v0', velocity.siValue, 'm/s', 'velocity'))
    }
    const electricField = extractValueWithUnit(text, PATTERNS.electricField, 'V/m')
    if (electricField !== null) {
      knowns.push(
        known('electric_field_strength', '电场强度', 'E', electricField.siValue, 'V/m', 'electric_field'),
      )
    }
    const magneticField = extractValueWithUnit(text, PATTERNS.magneticField, 'T')
    if (magneticField !== null) {
      knowns.push(
        known(
          'magnetic_field_strength',
          '磁感应强度',
          'B',
          magneticField.siValue,
          'T',
          'magnetic_flux_density',
        ),
      )
    }
    const ignoresGravity = IGNORE_GRAVITY_SIGNAL.test(text)
    const gravity = ignoresGravity ? null : extractValueWithUnit(text, PATTERNS.gravity, 'm/s^2')
    if (gravity !== null) {
      knowns.push(known('gravity', '重力加速度', 'g', gravity.siValue, 'm/s^2', 'acceleration'))
    }
    const radius = extractValueWithUnit(text, PATTERNS.radius, 'm')
    if (radius !== null) {
      knowns.push(known('radius', '轨道半径', 'r', radius.siValue, 'm', 'length'))
    }
    const time = extractValueWithUnit(text, PATTERNS.time, 's')
    if (time !== null) knowns.push(known('time', '时间', 't', time.siValue, 's', 'time'))

    const model = detectModel(text)
    const targets = detectTargets(text)
    const hasElectric = electricField !== null || ELECTRIC_FIELD_SIGNAL.test(text)
    const hasMagnetic = magneticField !== null || MAGNETIC_FIELD_SIGNAL.test(text)
    const hasGravity = gravity !== null
    const eDirection = electricFieldDirection(text)
    const bOrientation = magneticOrientation(text)

    if (isCyclotronQuestionText(text)) {
      issues.push({
        code: 'UNSUPPORTED_APPARATUS',
        message: '回旋加速器需要随时间变化的加速电场，当前 Composite Engine 只模拟分段恒定场。',
        severity: 'error',
      })
    }
    if (!isCompositeQuestionText(text)) {
      issues.push({
        code: 'NOT_COMPOSITE_QUESTION',
        message: '题目没有形成明确的复合场模型（至少两种场同时作用于同一带电粒子）。',
        severity: 'error',
      })
    }
    if (targets.length === 0) {
      issues.push({ code: 'MISSING_TARGET', message: '未识别到需要求解的物理量。', severity: 'error' })
    }
    if (knowns.length < 3) {
      issues.push({ code: 'PARTIAL_PARSE', message: '未能提取足够的复合场题已知条件。', severity: 'warning' })
    }

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'electromagnetic',
      /* A cyclotron keeps its own model id so the validator can reject it by name
         rather than mis-solving it as a generic composite field. */
      model: isCyclotronQuestionText(text) ? 'cyclotron' : model,
      entities: entitiesOf(hasElectric, hasMagnetic, hasGravity),
      knowns,
      unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
      constraints: [
        {
          type: 'composite_field',
          description: '带电粒子同时受电场力、洛伦兹力（及重力）作用，F = qE + qv×B + mg',
        },
      ],
      relations: relationsOf(model, text),
      targets,
      assumptions: assumptionsOf(hasGravity, hasElectric && hasMagnetic),
      chargeSign: chargeSign(text, chargeValue),
      fieldDirection: bOrientation ?? 'unknown',
      velocityDirection: hasMagnetic ? 'perpendicular_to_B' : 'unknown',
      electricFieldDirection: eDirection,
      initialVelocityDirection: initialVelocityDirection(text),
      ...(electricField === null ? {} : { electricFieldStrength: electricField.siValue }),
      ...(magneticField === null ? {} : { magneticFluxDensity: magneticField.siValue }),
      ...(bOrientation === undefined ? {} : { magneticFieldOrientation: bOrientation }),
    }

    const confidence =
      isCompositeQuestionText(text) && !isCyclotronQuestionText(text) && knowns.length >= 3 && targets.length > 0
        ? 0.95
        : 0.2
    return { ir, issues, confidence }
  },
}
