/**
 * Deterministic parser for one-dimensional collisions.
 *
 * A collision question names two bodies, their masses and their velocities,
 * and asks for what carries over afterwards — the common velocity when they
 * stick, the speed one leaves with, or the mechanical energy the impact cost.
 * The collision engine already solves exactly that scene; this parser is what
 * lets the question reach it.
 *
 * The restitution is read from how the stem describes the outcome: 粘在一起 /
 * 共同运动 is perfectly inelastic (0), 弹性碰撞 / 动能守恒 is elastic (1), and
 * anything else is taken as 0 unless the stem states a coefficient.
 */

import type { QuestionDocument } from './question-document.ts'
import { normalizeStemText } from './latex-text.ts'
import type { QuestionParserProvider, QuestionParseCandidate } from './question-parser.ts'
import type {
  KnownValue, PhysicsSemanticIR, QuestionParseIssue, SemanticTarget,
} from './semantic-ir.ts'

/** Words that mark a stem as a collision question rather than general mechanics. */
export const COLLISION_SIGNAL =
  /碰撞|正碰|相碰|粘在一起|共同速度|动量守恒|弹性碰撞|完全非弹性/

interface BodyReading {
  readonly mass: number
  readonly velocity: number
}

function makeKnown(
  key: string, label: string, symbol: string, value: number, unit: string, dimension: string,
): KnownValue {
  return { key, label, symbol, value, unit, dimension, displayValue: `${String(value)} ${unit}` }
}

/**
 * Strip the LaTeX wrappers a paper stem carries.
 *
 * Drafted questions write units as `$m_1 = 2\ \mathrm{kg}$`, which is the same
 * fact as "m1 = 2 kg" in a form no plain-text pattern reads. Removing the
 * wrappers once lets every pattern below work on both shapes — a question that
 * solved correctly in a hand-written test failed on the real paper for exactly
 * this reason.
 * @param text - the raw stem.
 * @returns the stem with math delimiters and unit commands reduced to text.
 */
export function stripMath(text: string): string {
  return text
    .replace(/\\(?:mathrm|text|rm|mathit)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\\s/g, ' ')
    .replace(/\\[,;!]/g, ' ')
    .replace(/\$/g, '')
    .replace(/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
}

/**
 * Read the two bodies out of a collision stem.
 *
 * Stems name them in the order they appear — "质量 m₁ 的小球以速度 v₁ 与静止的
 * 质量 m₂ 的小球" — so the first mass and first velocity belong to body A and
 * the second of each to body B. A stem that only states one velocity is the
 * classic "moving body strikes a stationary one", which is what v₂ = 0 says.
 * @param raw - the question stem, before or after {@link stripMath}.
 * @returns both bodies, or undefined when the stem does not name two masses.
 */
export function readCollisionBodies(raw: string): { a: BodyReading; b: BodyReading } | undefined {
  const text = stripMath(raw)
  /* Stems write the symbols as m₁ / m1 / m_1 — the subscript can be a Unicode
     digit, an ASCII digit or an underscore form, so the suffix class has to
     cover all three. */
  /* The subscript may be one character (`m1`) or two (`m_1`), so the suffix is
     a short run rather than an optional single char. */
  const masses = [...text.matchAll(/(?:质量|m)\s*[_₀-₉A-Za-z0-9]{0,2}\s*=?\s*(\d+\.?\d*)\s*kg/gi)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value) && value > 0)
  if (masses.length < 2) return undefined

  /* Keep zero velocities: "v2 = 0 m/s" is a stated fact, not a missing one,
     and dropping it made the second body inherit the first body's speed. Read
     each velocity by its symbol so the pairing never depends on count. */
  const velocityOf = (suffix: string): number | undefined => {
    const pattern = new RegExp(`(?:速度|v)\\s*[_₀-₉]?\\s*${suffix}\\s*=?\\s*(\\d+\\.?\\d*)\\s*m/s`, 'i')
    const match = pattern.exec(text)
    return match?.[1] === undefined ? undefined : Number(match[1])
  }
  const velocityList = [...text.matchAll(/(?:速度|v)\s*[_₀-₉A-Za-z0-9]{0,2}\s*=?\s*(\d+\.?\d*)\s*m\/s/gi)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value))

  /* A body is at rest only when the stem says so (静止) or states a zero
     speed; otherwise a missing velocity is a missing condition and the caller
     must not invent one. */
  const atRest = /静止|速度为\s*0|v\s*[_₀-₉A-Za-z0-9]{0,2}\s*=?\s*0\s*m\/s/.test(text)
  const zeroOrUndefined = (value: number | undefined): number | undefined =>
    value ?? (atRest ? 0 : undefined)

  const velocityA = velocityOf('1') ?? velocityOf('A') ?? velocityList[0]
  const velocityB = velocityOf('2') ?? velocityOf('B')
    ?? (velocityList.length >= 2 ? velocityList[1] : undefined)

  const a: BodyReading = { mass: masses[0]!, velocity: velocityA ?? 0 }
  const bVelocity = zeroOrUndefined(velocityB)
  if (bVelocity === undefined) return undefined
  const b: BodyReading = { mass: masses[1]!, velocity: bVelocity }
  return { a, b }
}

/**
 * Restitution from the stem's description of what happened.
 *
 * Returns `undefined` when the stem does not say. Defaulting an unstated
 * collision to perfectly inelastic is inventing a condition: "两球发生碰撞"
 * says nothing about whether they stick, and the answer for e = 0 and e = 1
 * differ in both the speeds and the energy loss. A caller that receives
 * undefined must refuse rather than pick one.
 *
 * 完全非弹性 contains 弹性碰撞's characters as a prefix, so the inelastic test
 * runs first — the earlier order read 完全非弹性碰撞 as elastic.
 * @param text - the question stem, before or after {@link stripMath}.
 * @returns the coefficient, or undefined when the stem states none.
 */
export function readRestitution(text: string): number | undefined {
  if (/粘在一起|共同运动|不再分开|完全非弹性/.test(text)) return 0
  /* A stated coefficient wins over the wording. */
  const stated = /(?:恢复系数|e)\s*=?\s*(0?\.\d+|1(?:\.0+)?|0)/.exec(text)
  if (stated?.[1] !== undefined) {
    const value = Number(stated[1])
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value
  }
  if (/弹性碰撞|动能守恒|机械能守恒/.test(text)) return 1
  return undefined
}

function readTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  /* Look in the asking clause first, like the mechanics parser: the givens
     mention 速度 constantly and only the ask says which one matters. */
  const intentMatch = /(?:求|则|下列说法|问)[^。]{0,80}/.exec(text)
  const asked = intentMatch?.[0] ?? text
  if (/共同速度|一起运动的速度|碰后.*速度/.test(asked)) targets.push('common_velocity')
  if (/损失|动能损失|机械能损失/.test(asked)) targets.push('energy_loss')
  if (/碰后.*速度|速度.*多少/.test(asked)) targets.push('final_velocity')
  if (/动量/.test(asked)) targets.push('momentum')
  if (targets.length === 0) targets.push('final_velocity')
  return targets
}

export const DeterministicCollisionQuestionParser: QuestionParserProvider = {
  id: 'deterministic-collision-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    /* Normalised once here: drafted stems carry LaTeX, and every pattern in
       this file is written against plain text. */
    const text = normalizeStemText(document.content.extractedText || document.content.rawText || '')
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    if (!COLLISION_SIGNAL.test(text)) {
      issues.push({
        code: 'PARTIAL_PARSE',
        message: '题面未提及碰撞情景',
        severity: 'warning',
      })
    }

    const bodies = readCollisionBodies(text)
    if (bodies === undefined) {
      /* The provider contract has no null-IR arm: a stem this parser was
         routed to must either produce a scene or fail loudly, so the caller
         sees a parse failure rather than a silently empty question. */
      throw new Error('collision: 未能识别出碰撞的两个物体质量')
    }

    const restitution = readRestitution(text)
    const targets = readTargets(text)

    /* An unstated restitution is a missing condition, not a default. Say so
       here so the reviewer reads a reason instead of an answer computed for a
       collision the stem never described. */
    if (restitution === undefined) {
      issues.push({
        code: 'AMBIGUOUS_COLLISION_TYPE',
        message: '未说明碰撞性质（弹性/完全非弹性/恢复系数），无法确定唯一的碰后速度与能量损失',
        severity: 'error',
      })
    }

    knowns.push(makeKnown('mass_a', 'A 的质量', 'm₁', bodies.a.mass, 'kg', 'mass'))
    knowns.push(makeKnown('mass_b', 'B 的质量', 'm₂', bodies.b.mass, 'kg', 'mass'))
    knowns.push(makeKnown('velocity_a', 'A 的初速度', 'v₁', bodies.a.velocity, 'm/s', 'velocity'))
    knowns.push(makeKnown('velocity_b', 'B 的初速度', 'v₂', bodies.b.velocity, 'm/s', 'velocity'))

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'mechanics',
      model: 'one_dimensional_collision',
      entities: ['body', 'ground', 'gravity_field'],
      knowns,
      unknowns: targets.map(target => ({ key: target, label: target, symbol: '' })),
      constraints: [{ type: 'one_dimensional_collision', description: '一维碰撞约束' }],
      relations: ['momentum_conserved'],
      targets,
      assumptions: ['frictionless_surface'],
      chargeSign: 'unknown',
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
      collisionBodies: [bodies.a, bodies.b],
      ...(restitution === undefined ? {} : { collisionRestitution: restitution }),
    }

    return { ir, issues, confidence: 0.9 }
  },
}
