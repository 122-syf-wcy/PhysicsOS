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

const ELECTRIC_SIGNAL = /匀强电场|电场强度|场强|电场方向|电场力|点电荷|electric\s+field|\bE\s*=/i
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

/** Charge unit symbols the parser recognizes (both micro-sign and greek-mu). */
const CHARGE_UNIT = String.raw`(?:mC|μC|µC|uC|nC|C)`

const ELECTRIC_PATTERNS = {
  charge: [
    new RegExp(String.raw`q\s*=\s*(${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
    new RegExp(String.raw`电荷量?(?:为|是|=)?\s*(${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
    new RegExp(String.raw`带(?:正|负)?电(?:荷量?)?\s*(${NUMBER})\s*(${CHARGE_UNIT})\b`, 'i'),
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
  /** Distance from a point-charge source. */
  distance: [
    new RegExp(String.raw`距(?:离)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`\br\s*=\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  /**
   * A directional distance: "距其左侧 15 cm" / "在正电荷右边 10 cm 处".
   * Group 1 is the direction word, group 2 the value, group 3 the unit. The
   * bare-distance `distance` patterns above do not carry a direction, so this
   * is matched first when a direction word is present.
   */
  directionalDistance: [
    new RegExp(
      String.raw`(?:距(?:其|离)?|在)[^。；;，,]{0,6}?(左侧|右侧|左边|右边|上方|下方|正方向|负方向)[^。；;，,\d]{0,4}?(${NUMBER})\s*(cm|mm|m)\b`,
      'i',
    ),
  ],
  /** A probe/test charge that FEELS the field, distinct from the source. */
  probeCharge: [
    new RegExp(String.raw`(?:试探电荷|检验电荷)(?:的)?(?:电荷量)?(?:为|是|=)?\s*(${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
    new RegExp(String.raw`q['’]\s*=\s*(${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
  ],
  /** Multiple named source charges, e.g. q1 = +2 μC, q2 = −2 μC, or 电荷A = 3 μC. */
  chargeList: [
    new RegExp(String.raw`q\s*1\s*=\s*([+-]?${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
    new RegExp(String.raw`q\s*2\s*=\s*([+-]?${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
    new RegExp(String.raw`电荷\s*([AB])[^\d]{0,8}?([+-]?${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'i'),
  ],
  /** Separation between two sources, e.g. 相距 20 cm / 间距 0.3 m. */
  separation: [
    new RegExp(String.raw`相距\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`间距(?:为|是)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  /** Parallel-plate separation: 板间距 / 板间距离 / 两板相距 / 极板间距. */
  plateSeparation: [
    new RegExp(String.raw`板间(?:距|距离)(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`两板相距\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`极板间(?:距|距离)(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`板间距(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`\bd\s*=\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  /** Parallel-plate length: 板长 / 极板长度 / 板宽. */
  plateLength: [
    new RegExp(String.raw`板长(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`极板长(?:度)?(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`板宽(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`\bL\s*=\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  /** Deflection distance: 偏转距离 / 偏转量 / 侧移. */
  deflection: [
    new RegExp(String.raw`偏转距离(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`偏转量(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`侧移(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
} as const

/** A point-charge question names a source charge and a distance, not a uniform field. */
const POINT_CHARGE_SIGNAL = /点电荷|试探电荷|检验电荷/i
const UNIFORM_FIELD_SIGNAL = /匀强电场/

/** A multi-source superposition question names two or more point charges. */
const MULTI_SOURCE_SIGNAL = /两个点电荷|两电荷|等量同种|等量异种|电偶极子|q\s*1|q\s*2/i

/** Whether a text describes a point-charge world rather than a uniform field. */
export const isPointChargeQuestionText = (text: string): boolean =>
  POINT_CHARGE_SIGNAL.test(text) && !UNIFORM_FIELD_SIGNAL.test(text)

/** Whether a text describes a multi-source superposition of point charges. */
export const isMultiSourceQuestionText = (text: string): boolean =>
  MULTI_SOURCE_SIGNAL.test(text) && !UNIFORM_FIELD_SIGNAL.test(text)

/** Whether a text describes a parallel-plate / bounded electric field question.
    Takes priority over the generic uniform-field parser because a parallel-plate
    setup is a bounded uniform field, not an unbounded one. */
const PARALLEL_PLATE_SIGNAL = /平行板|极板|板间|电容器|偏转|电子.*射入|垂直进入.*电场|射入.*电场/i
export const isParallelPlateQuestionText = (text: string): boolean =>
  PARALLEL_PLATE_SIGNAL.test(text)

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
  if (/电场强度|场强(?!.*方向)|求\s*E|\bE\s*=|电场的大小/i.test(text)) add('electric_field')
  if (/电场.{0,4}方向|场强.{0,4}方向|指向|向外|向内|判断.*方向/i.test(text)) add('electric_field_direction')
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
    electric_field: { label: '电场强度', symbol: 'E' },
    electric_field_direction: { label: '电场方向', symbol: '' },
    acceleration: { label: '加速度', symbol: 'a' },
    final_velocity: { label: '末速度', symbol: 'v' },
    displacement: { label: '位移', symbol: 'Δr' },
    trajectory: { label: '运动轨迹', symbol: '' },
    electric_potential_change: { label: '电势变化', symbol: 'Δφ' },
    electric_potential_energy_change: { label: '电势能变化', symbol: 'ΔU' },
    kinetic_energy: { label: '动能', symbol: 'K' },
    kinetic_energy_change: { label: '动能变化', symbol: 'ΔK' },
    work_by_electric_field: { label: '电场力做功', symbol: 'W' },
    deflection: { label: '偏转距离', symbol: 'y' },
    plate_hit_time: { label: '打板时间', symbol: 't' },
    exit_velocity: { label: '离开速度', symbol: 'v' },
  }
  return values[target] ?? { label: target, symbol: '' }
}

/**
 * Build the IR for a point-charge question.
 *
 * A point-charge world has a source charge at the origin and a sampling distance r.
 * A probe/test charge is optional: "求 E at r" has none, "求 F = qE" has one. The
 * source charge sign is the physics that decides the field direction.
 */
const parsePointCharge = (
  text: string,
  sourceCharge: number | undefined,
  targets: SemanticTarget[],
  issues: QuestionParseIssue[],
): QuestionParseCandidate => {
  const pointChargeKnowns: KnownValue[] = []

  if (sourceCharge !== undefined) {
    pointChargeKnowns.push(known('charge', '源电荷量', 'q', sourceCharge, 'C', 'electric_charge'))
  } else {
    issues.push({ code: 'MISSING_CHARGE', message: '缺少源电荷量。', severity: 'error' })
  }

  /* A directional distance ("距其左侧 15 cm") takes priority over a bare
     distance: it carries the same magnitude plus a direction that places the
     probe off-axis. `extractValueWithUnit` assumes the value is group 1, but the
     directional pattern's group 1 is the direction word (group 2 the value,
     group 3 the unit), so the conversion is done inline here. */
  const directionalMatch = ELECTRIC_PATTERNS.directionalDistance[0].exec(text)
  let distance: ExtractedValue | null = null
  let sampleOffset: PhysicsSemanticIR['sampleOffset'] | undefined
  if (directionalMatch?.[1] !== undefined && directionalMatch[2] !== undefined) {
    const rawValue = parseScientificNumber(directionalMatch[2])
    const unit = (directionalMatch[3] ?? 'm').trim()
    if (rawValue !== null && isKnownUnit(unit)) {
      try {
        const si = canonicalValue(parseQuantity(rawValue, unit))
        distance = { siValue: si, originalUnit: unit }
        const directionWord = directionalMatch[1]
        if (/左侧|左边|负方向/i.test(directionWord)) sampleOffset = { axis: 'x', sign: -1, distance: si }
        else if (/右侧|右边|正方向/i.test(directionWord)) sampleOffset = { axis: 'x', sign: 1, distance: si }
        else if (/上方/i.test(directionWord)) sampleOffset = { axis: 'y', sign: 1, distance: si }
        else if (/下方/i.test(directionWord)) sampleOffset = { axis: 'y', sign: -1, distance: si }
      } catch {
        /* unknown unit — fall through to bare distance */
      }
    }
  }
  if (distance === null) {
    distance = extractValueWithUnit(text, ELECTRIC_PATTERNS.distance, 'm')
  }
  if (distance !== null) {
    pointChargeKnowns.push(known('distance', '距离', 'r', distance.siValue, 'm', 'length'))
  } else {
    issues.push({ code: 'MISSING_DISTANCE', message: '缺少到源电荷的距离。', severity: 'error' })
  }

  const probe = extractValueWithUnit(text, ELECTRIC_PATTERNS.probeCharge, 'C')
  if (probe !== null) {
    pointChargeKnowns.push(known('probe_charge', '试探电荷量', "q'", probe.siValue, 'C', 'electric_charge'))
  }

  if (targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '未识别到需要求解的物理量。', severity: 'error' })
  }

  const ir: PhysicsSemanticIR = {
    schemaVersion: 'physics-ir/1.0',
    domain: 'electric',
    model: 'point_charge_electrostatic_field',
    entities: ['particle', 'electric_field'],
    knowns: pointChargeKnowns,
    unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
    constraints: [{ type: 'point_charge_field', description: '静止点电荷产生的库仑电场' }],
    relations: ['point_charge_field'],
    targets,
    assumptions: [
      'static_point_charge',
      'electric_force_only',
      'vacuum_permittivity',
      'ignore_magnetic_field',
      'ignore_gravity',
    ],
    chargeSign: chargeSign(text, sourceCharge),
    fieldDirection: 'unknown',
    velocityDirection: 'unknown',
    ...(distance === null ? {} : { sourceDistance: distance.siValue }),
    ...(sampleOffset === undefined ? {} : { sampleOffset }),
  }

  const confidence =
    isPointChargeQuestionText(text) && sourceCharge !== undefined && distance !== null && targets.length > 0
      ? 0.95
      : 0.2
  return { ir, issues, confidence }
}

/**
 * Build the IR for a multi-source superposition question.
 *
 * Two (or more) named source charges sit at known positions; the question asks about
 * the combined field at a sampling point — typically the midpoint, or a point on the
 * axis. Sources are placed symmetrically along x when the text gives only a separation,
 * so the midpoint is the origin. The model stays `point_charge_electrostatic_field`:
 * the engine already superposes any number of sources; only the scene grows.
 */
const parseMultiSource = (
  sourceCharges: ReadonlyArray<{ charge: number; label?: string }>,
  separation: number | undefined,
  targets: SemanticTarget[],
  issues: QuestionParseIssue[],
): QuestionParseCandidate => {
  const multiKnowns: KnownValue[] = []
  sourceCharges.forEach((source, index) => {
    const label = source.label ?? `q${index + 1}`
    multiKnowns.push(known(`source_charge_${index + 1}`, `源电荷 ${label}`, label, source.charge, 'C', 'electric_charge'))
  })
  if (separation !== undefined) {
    multiKnowns.push(known('separation', '两电荷间距', 'd', separation, 'm', 'length'))
  }

  /* Place sources symmetrically along x at ±separation/2 so the midpoint is the origin.
     The default sample position is that midpoint — the canonical "等量同种/异种中点" case. */
  const half = separation !== undefined ? separation / 2 : 0.1
  const placed = sourceCharges.map((source, index) => ({
    charge: source.charge,
    position: { x: index === 0 ? -half : half, y: 0 },
    label: source.label ?? `q${index + 1}`,
  }))

  const samplePosition = { x: 0, y: 0 }
  multiKnowns.push(known('sample_position', '待求场点', 'P', 0, 'm', 'length'))

  if (targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '未识别到需要求解的物理量。', severity: 'error' })
  }

  const ir: PhysicsSemanticIR = {
    schemaVersion: 'physics-ir/1.0',
    domain: 'electric',
    model: 'point_charge_electrostatic_field',
    entities: ['particle', 'electric_field'],
    knowns: multiKnowns,
    unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
    constraints: [
      { type: 'multi_source_superposition', description: '多个点电荷电场的矢量叠加' },
      { type: 'point_charge_field', description: '每个源电荷按库仑定律产生电场' },
    ],
    relations: ['multi_source_superposition', 'point_charge_field'],
    targets,
    assumptions: [
      'static_point_charge',
      'electric_force_only',
      'vacuum_permittivity',
      'ignore_magnetic_field',
      'ignore_gravity',
    ],
    chargeSign: 'unknown',
    fieldDirection: 'unknown',
    velocityDirection: 'unknown',
    sourceCharges: placed,
    samplePosition,
  }

  const confidence =
    sourceCharges.length >= 2 && separation !== undefined && targets.length > 0
      ? 0.9
      : 0.2
  return { ir, issues, confidence }
}

/**
 * Extract all named source charges from a multi-source question text.
 *
 * Matches `q1 = +2 μC`, `q2 = −2 μC`, and `电荷A = 3 μC` / `电荷B = −3 μC`. Each
 * match yields a signed SI charge and a label (q1/q2 or A/B). The sign comes from
 * the optional leading `+`/`−` in the text; when absent the charge is taken as
 * positive (a question that omits the sign on a negative charge is caught by the
 * validator's direction ambiguity gate).
 */
const extractSourceCharges = (
  text: string,
): ReadonlyArray<{ charge: number; label?: string }> => {
  const sources: { charge: number; label?: string }[] = []
  const push = (raw: string, unit: string, label: string | undefined) => {
    const value = parseScientificNumber(raw)
    if (value === null) return
    try {
      const si = canonicalValue(parseQuantity(value, unit))
      if (!sources.some((existing) => existing.charge === si && existing.label === label)) {
        sources.push(label === undefined ? { charge: si } : { charge: si, label })
      }
    } catch {
      /* unknown unit — skip this match */
    }
  }
  /* q1 = ... / q2 = ... patterns: capture group 1 is value, group 2 is unit. */
  const qPattern = new RegExp(String.raw`q\s*([12])\s*=\s*([+-]?${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'gi')
  for (const match of text.matchAll(qPattern)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      push(match[2], (match[3] ?? 'C').trim(), `q${match[1]}`)
    }
  }
  /* 电荷A = ... / 电荷B = ...: group 1 is A/B, group 2 is value, group 3 is unit. */
  const abPattern = new RegExp(String.raw`电荷\s*([AB])[^\d+-]{0,8}?([+-]?${NUMBER})\s*(${CHARGE_UNIT})?\b`, 'gi')
  for (const match of text.matchAll(abPattern)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      push(match[2], (match[3] ?? 'C').trim(), match[1])
    }
  }
  return sources
}

/**
 * Detect the electric-field direction for a parallel-plate question.
 *
 * "上板带正电" → field points down (from + to −); "下板带正电" → field points up.
 * Falls back to `detectElectricFieldDirection` when an explicit direction is stated,
 * and ultimately to 'down' (the common textbook default for the default input).
 */
function detectPlateFieldDirection(text: string): PlanarDirection {
  if (/上板.*正电|下板.*负电/.test(text)) return 'down'
  if (/下板.*正电|上板.*负电/.test(text)) return 'up'
  const explicit = detectElectricFieldDirection(text)
  return explicit === 'unknown' ? 'down' : explicit
}

/**
 * Build the IR for a parallel-plate / bounded electric field question.
 *
 * A parallel-plate capacitor creates a bounded uniform field between two plates.
 * A charged particle enters from the side (typically the left edge), follows a
 * parabolic trajectory inside the field, and either exits or strikes a plate.
 * The parser extracts the knowns (q, m, v0, E, d, L) and infers the targets from
 * the question text. The field direction is inferred from the plate charge
 * configuration when stated, or defaults to 'down'.
 */
const parseParallelPlate = (
  text: string,
  chargeValue: number | undefined,
  targets: SemanticTarget[],
  knowns: KnownValue[],
  issues: QuestionParseIssue[],
): QuestionParseCandidate => {
  const plateKnowns: KnownValue[] = []

  /* Reuse the already-extracted knowns from the main parse, then add plate geometry. */
  for (const item of knowns) {
    plateKnowns.push(item)
  }

  if (chargeValue === undefined) {
    if (!plateKnowns.some((k) => k.key === 'charge')) {
      issues.push({ code: 'MISSING_CHARGE', message: '缺少电荷量。', severity: 'error' })
    }
  }

  const plateSeparation = extractValueWithUnit(text, ELECTRIC_PATTERNS.plateSeparation, 'm')
  if (plateSeparation !== null) {
    plateKnowns.push(known('plate_separation', '板间距', 'd', plateSeparation.siValue, 'm', 'length'))
  } else {
    issues.push({ code: 'MISSING_PLATE_SEPARATION', message: '缺少平行板间距。', severity: 'warning' })
  }

  const plateLength = extractValueWithUnit(text, ELECTRIC_PATTERNS.plateLength, 'm')
  if (plateLength !== null) {
    plateKnowns.push(known('plate_length', '板长', 'L', plateLength.siValue, 'm', 'length'))
  } else {
    issues.push({ code: 'MISSING_PLATE_LENGTH', message: '缺少平行板长度。', severity: 'warning' })
  }

  /* Infer targets specific to parallel-plate questions. */
  const ppTargets: SemanticTarget[] = [...targets]
  const addTarget = (target: SemanticTarget): void => {
    if (!ppTargets.includes(target)) ppTargets.push(target)
  }
  if (/偏转距离|偏转量|侧移|deflection/i.test(text)) addTarget('deflection')
  if (/打到.*板|击中.*板|碰.*板|hit.*plate/i.test(text)) addTarget('plate_hit_time')
  if (/离开.*速度|出.*速度|exit.*velocity|离开电场.*速度/i.test(text)) addTarget('exit_velocity')
  if (/偏转方向|向.*偏转|direction.*deflect/i.test(text)) addTarget('electric_field_direction')
  if (/动能|能量|做功/i.test(text)) {
    addTarget('kinetic_energy_change')
    addTarget('work_by_electric_field')
  }
  /* Displacement is always relevant for parallel-plate trajectory questions. */
  if (ppTargets.length === 0) {
    addTarget('deflection')
    addTarget('displacement')
  }

  if (ppTargets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '未识别到需要求解的物理量。', severity: 'error' })
  }

  const fieldDirection = detectPlateFieldDirection(text)
  const velocityDir = detectInitialVelocityDirection(text)
  /* "水平射入" → right; default for parallel-plate is horizontal entry from left. */
  const resolvedVelocityDir: PlanarDirection =
    velocityDir !== 'unknown' ? velocityDir :
    /水平/.test(text) ? 'right' : 'right'

  const ir: PhysicsSemanticIR = {
    schemaVersion: 'physics-ir/1.0',
    domain: 'electric',
    model: 'charged_particle_bounded_electric_field',
    entities: ['particle', 'electric_field'],
    knowns: plateKnowns,
    unknowns: ppTargets.map((target) => ({ key: target, ...targetMetadata(target) })),
    constraints: [
      { type: 'parallel_plate_field', description: '平行板电容器产生有界匀强电场' },
    ],
    relations: ['charged_particle_in_bounded_electric_field', 'particle_enters_field'],
    targets: ppTargets,
    assumptions: [
      'bounded_electric_field',
      'parallel_plate',
      'uniform_electric_field',
      'electric_force_only',
      'ignore_magnetic_field',
      'ignore_gravity',
    ],
    chargeSign: chargeSign(text, chargeValue),
    fieldDirection: 'unknown',
    velocityDirection: 'unknown',
    electricFieldDirection: fieldDirection,
    initialVelocityDirection: resolvedVelocityDir,
    ...(plateSeparation === null ? {} : { plateSeparation: plateSeparation.siValue }),
    ...(plateLength === null ? {} : { plateLength: plateLength.siValue }),
    enterPosition: 'edge',
  }

  const hasCoreKnowns =
    chargeValue !== undefined &&
    plateSeparation !== null &&
    plateLength !== null &&
    plateKnowns.some((k) => k.key === 'electric_field_strength') &&
    ppTargets.length > 0
  const confidence = hasCoreKnowns ? 0.9 : 0.3
  return { ir, issues, confidence }
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

    /* Parallel-plate / bounded field takes priority over multi-source, point-charge
       and generic uniform-field parsing: a text that names 平行板/极板/板间 describes a
       bounded uniform field, not an unbounded one or a point-charge world. */
    if (isParallelPlateQuestionText(text)) {
      return parseParallelPlate(text, chargeValue, targets, knowns, issues)
    }

    /* Multi-source superposition takes priority over single-source: a text that
       names q1/q2 (or 电荷A/B) and a separation describes a combined field, not one
       source. Fall through to the single-source path only if fewer than two named
       sources are recovered. */
    if (isMultiSourceQuestionText(text)) {
      const sourceList = extractSourceCharges(text)
      const separation = extractValueWithUnit(text, ELECTRIC_PATTERNS.separation, 'm')?.siValue
      if (sourceList.length >= 2) {
        return parseMultiSource(sourceList, separation, targets, issues)
      }
      issues.push({
        code: 'PARTIAL_PARSE',
        message: '识别到多源信号但未能提取两个源电荷量。',
        severity: 'warning',
      })
    }

    const isPointCharge = isPointChargeQuestionText(text)

    if (isPointCharge) {
      return parsePointCharge(text, chargeValue, targets, issues)
    }

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
