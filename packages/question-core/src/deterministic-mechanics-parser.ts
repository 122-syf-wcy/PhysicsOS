import type { QuestionDocument } from './question-document.ts'
import { normalizeStemText } from './latex-text.ts'
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
  const patterns = [/([+-]?\d+\.?\d*)\s*[×x*]\s*10\^?(-?\d+)/g, /([+-]?\d+\.?\d*)e(-?\d+)/gi]
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

function extractValueWithUnit(
  text: string,
  patterns: readonly RegExp[],
  defaultUnit: string,
): { siValue: number; originalValue: number; originalUnit: string } | null {
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

/**
 * Order matters: the models below the generic kinematics ones describe a
 * distinct apparatus, and their stems also contain words like 速度 or 位移 that
 * the kinematics tests match. Detecting the apparatus first keeps a 弹簧振子
 * from being solved as uniform acceleration.
 */
function detectModel(text: string): MechanicsModelId {
  /* A satellite around a central body — GM and r, nothing else in mechanics
     poses that question. */
  if (/卫星|绕地球|绕太阳|轨道半径|宇宙速度|万有引力|circular.?orbit/.test(text)) return 'circular_orbit'
  /* A spring: an oscillator when the body is released to move, a statics rig
     when it hangs still. */
  if (/弹簧|弹力|劲度系数|劲度|k\s*=/.test(text)) {
    return /悬挂|竖直悬挂|静止|静止时|挂/.test(text) ? 'spring_statics' : 'spring_oscillator'
  }
  /* A pendulum is a rope and a swing. */
  if (/单摆|摆长|摆球|周期.*摆|pendulum/.test(text)) return 'simple_pendulum'
  /* A body dragged across a rough horizontal surface: friction and a pull, no
     incline and no free fall. */
  if (/水平面|水平地面|水平桌面/.test(text) && /摩擦因数|摩擦系数|粗糙/.test(text)
    && !/斜面|incline/.test(text)) return 'horizontal_friction'
  if (/斜面|incline/.test(text)) return 'inclined_plane'
  if (/平抛|斜抛|抛体|projectile|抛出|水平抛/.test(text)) return 'projectile_motion'
  if (/牛顿|newton|合力|net.?force/.test(text)) return 'newton_second_law'
  if (/匀速|uniform.*linear|匀速直线/.test(text)) return 'uniform_linear_motion'
  if (/匀加速|匀变速|accelerated|加速度.*=.*\d|加速度为/.test(text))
    return 'uniformly_accelerated_motion'
  return 'uniformly_accelerated_motion'
}

/**
 * Where a question states what it asks for. Everything before it is setup;
 * everything after is the asking. A bare keyword search cannot tell the two
 * apart — "加速度大小为 2 m/s²，求 3 s 末的速度" names 加速度 in the givens and
 * asks for 速度, yet the keyword rule recorded both and the engine solved for
 * whichever came first.
 */
const QUESTION_INTENT = /(?:求|计算|则|试问|问)[^。]{0,60}/

function detectTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  /* Prefer the asking clause when the stem has one; fall back to the whole
     text for stems that state the quantity without a 求/则. */
  const intentMatch = QUESTION_INTENT.exec(text)
  const asked = intentMatch?.[0] ?? text

  const has = (pattern: RegExp): boolean => pattern.test(asked)

  /* The apparatus models ask for quantities the kinematics list never named:
     a pendulum asks for 周期, a spring rig for 伸长量 or 振幅, an orbit for
     线速度 or 周期. Without these the question parsed with no target at all. */
  if (has(/周期|period/)) targets.push('period')
  if (has(/振幅|amplitude/)) targets.push('amplitude')
  if (has(/伸长量|形变量|extension/)) targets.push('spring_extension')
  if (has(/轨道半径|轨道高度/)) targets.push('orbit_radius')
  if (has(/线速度|环绕速度/)) targets.push('linear_speed')
  if (has(/向心力|centripetal/)) targets.push('centripetal_force')
  /* 加速度 contains 速度, so a stem asking for 加速度 matched the speed rule
     and the engine answered a speed question the stem never posed. Match speed
     on its own: not preceded by 加, and not part of 加速度. */
  if (has(/(?<!加)(?:速度|velocity)/)) targets.push('velocity')
  if (has(/加速度|acceleration/)) targets.push('acceleration')
  if (has(/位移|displacement/)) targets.push('displacement')
  if (has(/时间|time/)) targets.push('time')
  if (has(/射程|range/)) targets.push('range')
  if (has(/最大高度|max.?height/)) targets.push('max_height')
  if (has(/落地时间|flight.?time/)) targets.push('flight_time')
  /* 压力 is what a 拱桥 or 竖直圆轨道 question asks for and is the same
     normal-force quantity the engine reports. */
  if (has(/支持力|压力|normal.?force/)) targets.push('normal_force')
  if (has(/摩擦力|friction/)) targets.push('friction_force')
  if (has(/合力|net.?force/)) targets.push('net_force')
  if (has(/力|force/) && !targets.includes('net_force')) targets.push('force')

  /* A stem with no asking clause still needs a target the engine can act on;
     fall back to the whole text so a bare "物块的加速度是多少" is not lost. */
  if (targets.length === 0) {
    if (/加速度|acceleration/.test(text)) targets.push('acceleration')
    else if (/速度|velocity/.test(text)) targets.push('velocity')
    else if (/位移|displacement/.test(text)) targets.push('displacement')
  }
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
  friction: [/摩擦系数\s*=?\s*(\d+\.?\d*)/, /μ\s*=?\s*(\d+\.?\d*)/],
  gravity: [/g\s*=?\s*(\d+\.?\d*)\s*(m\/s\^2)?/i, /重力加速度\s*=?\s*(\d+\.?\d*)\s*(m\/s\^2)?/i],
  horizontalSpeed: [/水平速度\s*=?\s*(\d+\.?\d*)\s*(m\/s|km\/s)?/i],
  launchAngle: [/抛射角\s*=?\s*(\d+\.?\d*)\s*°?/, /与.*水平.*成\s*(\d+\.?\d*)\s*°?/],
} as const

function makeKnown(
  key: string,
  label: string,
  symbol: string,
  siValue: number,
  unit: string,
  dimension: string,
): KnownValue {
  return { key, label, symbol, value: siValue, unit, dimension, displayValue: `${siValue} ${unit}` }
}

export const DeterministicMechanicsQuestionParser: QuestionParserProvider = {
  id: 'deterministic-mechanics-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    /* Normalised once here: drafted stems carry LaTeX, and every pattern in
       this file is written against plain text. */
    const text = normalizeStemText(document.content.extractedText || document.content.rawText || '')
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []
    const model = detectModel(text)

    /* "g = 10 m/s²" contains the same "10 m/s" substring as a real speed, so
       the bare unit pattern read gravity as an initial velocity and every
       mechanics question arrived carrying a phantom v₀. Blank the gravity
       clauses before the velocity scan; the gravity pattern runs on the
       original text. */
    const GRAVITY_CLAUSE = /(?:重力加速度|g)\s*=?\s*\d+\.?\d*\s*m\/s(?:\^?2|²)/gi
    const withoutGravity = text.replace(GRAVITY_CLAUSE, ' ')
    const velResult = extractValueWithUnit(withoutGravity, MECH_PATTERNS.velocity, 'm/s')
    if (velResult)
      knowns.push(
        makeKnown('initial_velocity', '初速度', 'v0', velResult.siValue, 'm/s', 'velocity'),
      )

    const accResult = extractValueWithUnit(text, MECH_PATTERNS.acceleration, 'm/s^2')
    if (accResult)
      knowns.push(
        makeKnown('acceleration', '加速度', 'a', accResult.siValue, 'm/s^2', 'acceleration'),
      )

    const timeResult = extractValueWithUnit(text, MECH_PATTERNS.time, 's')
    if (timeResult) knowns.push(makeKnown('time', '时间', 't', timeResult.siValue, 's', 'time'))

    const heightResult = extractValueWithUnit(text, MECH_PATTERNS.height, 'm')
    if (heightResult)
      knowns.push(makeKnown('height', '高度', 'h', heightResult.siValue, 'm', 'length'))

    const massResult = extractValueWithUnit(text, MECH_PATTERNS.mass, 'kg')
    if (massResult) knowns.push(makeKnown('mass', '质量', 'm', massResult.siValue, 'kg', 'mass'))

    const forceResult = extractValueWithUnit(text, MECH_PATTERNS.force, 'N')
    if (forceResult)
      knowns.push(makeKnown('applied_force', '作用力', 'F', forceResult.siValue, 'N', 'force'))

    const gravResult = extractValueWithUnit(text, MECH_PATTERNS.gravity, 'm/s^2')
    if (gravResult)
      knowns.push(
        makeKnown('gravity', '重力加速度', 'g', gravResult.siValue, 'm/s^2', 'acceleration'),
      )

    const hSpeedResult = extractValueWithUnit(text, MECH_PATTERNS.horizontalSpeed, 'm/s')
    if (hSpeedResult)
      knowns.push(
        makeKnown('horizontal_speed', '水平速度', 'vx', hSpeedResult.siValue, 'm/s', 'velocity'),
      )

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
      knowns.push(
        makeKnown(
          'friction_coefficient',
          '摩擦系数',
          'μ',
          frictionCoefficient,
          '',
          'dimensionless',
        ),
      )
    }

    /* Apparatus-specific inputs. Each is only read for its own model, so a
       stem that happens to mention 摆 in another context cannot inject one. */
    const stiffnessMatch = /(?:劲度系数|劲度|弹簧常数|k)\s*=?\s*(\d+\.?\d*)\s*(?:N\/m)?/.exec(text)
    const springStiffness = stiffnessMatch?.[1] === undefined ? undefined : parseFloat(stiffnessMatch[1])
    if (springStiffness !== undefined && (model === 'spring_oscillator' || model === 'spring_statics')) {
      knowns.push(makeKnown('spring_stiffness', '劲度系数', 'k', springStiffness, 'N/m', 'spring_constant'))
    }

    const pendulumMatch = /(?:摆长|绳长|线长|L)\s*=?\s*(\d+\.?\d*)\s*(?:m|cm)?/.exec(text)
    const pendulumLength = pendulumMatch?.[1] === undefined ? undefined : parseFloat(pendulumMatch[1])
    if (pendulumLength !== undefined && model === 'simple_pendulum') {
      knowns.push(makeKnown('pendulum_length', '摆长', 'L', pendulumLength, 'm', 'length'))
    }

    /* Orbit radii are written in scientific notation — 轨道半径 r = 6.8×10^6 m —
       which a plain decimal pattern reads as 6.8. The optional symbol covers
       the "r =" a stem always writes between the label and the number. */
    const orbitScientific =
      /(?:轨道半径|圆周轨道半径|半径)\s*[a-z]?\s*=?\s*(\d+\.?\d*)\s*[×x*]\s*10\^?(-?\d+)/i.exec(text)
    const orbitPlain = /(?:轨道半径|圆周轨道半径|半径)\s*[a-z]?\s*=?\s*(\d+\.?\d*)\s*(?:km|m)\b/i.exec(text)
    const orbitRadius = orbitScientific?.[1] !== undefined && orbitScientific[2] !== undefined
      ? Number(orbitScientific[1]) * 10 ** Number(orbitScientific[2])
      : orbitPlain?.[1] === undefined ? undefined : parseFloat(orbitPlain[1])
    if (orbitRadius !== undefined && model === 'circular_orbit') {
      knowns.push(makeKnown('orbit_radius', '轨道半径', 'r', orbitRadius, 'm', 'length'))
    }
    /* A satellite question states the central body, not GM. Earth's standard
       parameter is the one a 高考 stem means by 绕地球; a stem that names a
       different body is left without one so the engine refuses instead of
       silently orbiting the wrong world. */
    const gravitationalParameter = model === 'circular_orbit' && /地球|绕地/.test(text)
      ? 3.986e14
      : undefined

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
    } else if (model === 'spring_oscillator' || model === 'spring_statics') {
      relations.push('hooke_law')
      assumptions.push('ideal_spring', 'no_air_resistance')
      entities = ['body', 'gravity_field']
    } else if (model === 'simple_pendulum') {
      relations.push('small_angle_oscillation')
      assumptions.push('ideal_rope', 'small_angle', 'no_air_resistance')
      entities = ['body', 'gravity_field']
    } else if (model === 'horizontal_friction') {
      relations.push('constant_acceleration')
      assumptions.push('constant_force', 'kinetic_friction')
      entities = ['body', 'gravity_field', 'ground']
    } else if (model === 'circular_orbit') {
      relations.push('uniform_circular_motion')
      assumptions.push('circular_orbit')
      entities = ['body', 'gravity_field']
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
      ...(springStiffness !== undefined && (model === 'spring_oscillator' || model === 'spring_statics')
        ? { springStiffness } : {}),
      ...(pendulumLength !== undefined && model === 'simple_pendulum' ? { pendulumLength } : {}),
      ...(orbitRadius !== undefined && model === 'circular_orbit' ? { orbitRadius } : {}),
      ...(gravitationalParameter !== undefined ? { gravitationalParameter } : {}),
    }

    if (knowns.length < 2) {
      issues.push({ code: 'PARTIAL_PARSE', message: '未能提取足够已知条件', severity: 'warning' })
    }

    return { ir, issues, confidence: knowns.length >= 2 ? 0.9 : 0.5 }
  },
}
