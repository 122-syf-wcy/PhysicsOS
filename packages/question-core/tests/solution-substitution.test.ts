import { describe, expect, it } from 'vitest'
import { processQuestion, substitutionFor } from '../src/index.ts'
import type { KnownValue } from '../src/semantic-ir.ts'
import type { QuestionSolutionStep } from '../src/question-solution.ts'

const known = (symbol: string, value: number, unit: string, displayValue?: string): KnownValue => ({
  key: symbol,
  label: symbol,
  symbol,
  value,
  unit,
  dimension: 'unknown',
  ...(displayValue === undefined ? {} : { displayValue }),
})

const step = (title: string): QuestionSolutionStep => ({ index: 1, title, description: '' })

describe('substitutionFor', () => {
  const kinematics = [
    known('v0', 10, 'm/s', '10 m/s'),
    known('a', 2, 'm/s^2', '2 m/s^2'),
    known('t', 5, 's', '5 s'),
  ]

  it('substitutes every symbol on the right side with its stated value', () => {
    expect(substitutionFor(step('v = v0 + at'), kinematics))
      .toBe('v = (10 m/s) + (2 m/s²) × (5 s)')
    expect(substitutionFor(step('s = v0*t + 0.5*a*t²'), kinematics))
      .toBe('s = (10 m/s) × (5 s) + 0.5 × (2 m/s²) × (5 s)²')
  })

  it('splits implicit products inside one identifier run', () => {
    const knowns = [
      known('m', 1.67e-27, 'kg', '1.67×10⁻²⁷ kg'),
      known('v', 3e6, 'm/s', '3.00×10⁶ m/s'),
      known('q', 1.6e-19, 'C', '1.60×10⁻¹⁹ C'),
      known('B', 0.4, 'T', '0.4 T'),
    ]
    expect(substitutionFor(step('F = |q|vB'), knowns))
      .toBe('F = |(1.60 × 10⁻¹⁹ C)| × (3.00 × 10⁶ m/s) × (0.4 T)')
    expect(substitutionFor(step('R = mv / |q|B'), knowns))
      .toBe('R = (1.67 × 10⁻²⁷ kg) × (3.00 × 10⁶ m/s) / |(1.60 × 10⁻¹⁹ C)| × (0.4 T)')
    expect(substitutionFor(step('T = 2πm / |q|B'), knowns))
      .toBe('T = 2 × π × (1.67 × 10⁻²⁷ kg) / |(1.60 × 10⁻¹⁹ C)| × (0.4 T)')
  })

  it('returns undefined when any right-hand symbol is not a stated known', () => {
    /* `r` is the sought radius — a partial substitution would mislead. */
    expect(substitutionFor(step('qvB = mv²/r'), [
      known('m', 1, 'kg'), known('v', 1, 'm/s'), known('q', 1, 'C'), known('B', 1, 'T'),
    ])).toBeUndefined()
  })

  it('never splits a digit-carrying identifier like v0 into v + 0', () => {
    /* Only `v` known — `v0` must fail atomically rather than become v×0×t. */
    expect(substitutionFor(step('v = v0 + at'), [
      known('v', 10, 'm/s'), known('a', 2, 'm/s^2'), known('t', 5, 's'),
    ])).toBeUndefined()
  })

  it('skips prose titles and multi-equation steps', () => {
    expect(substitutionFor(step('判断洛伦兹力方向'), kinematics)).toBeUndefined()
    expect(substitutionFor(step('Δ = nλ 加强，Δ = (n + ½)λ 减弱'), kinematics)).toBeUndefined()
  })

  it('prefers step.formula.expression over the title', () => {
    const s = step('求末速度')
    s.formula = { expression: 'v = v0 + at' }
    expect(substitutionFor(s, kinematics)).toBe('v = (10 m/s) + (2 m/s²) × (5 s)')
  })
})

describe('attachSubstitutions through processQuestion', () => {
  const doc = (text: string) => ({
    id: 'sub-test' as never,
    content: { source: 'text' as const, rawText: text, extractedText: text, status: 'EXTRACTED' as const },
    metadata: { title: 't', source: 'text' },
    createdAt: '', updatedAt: '',
  })

  it('fills the 代入 row on a mechanics solve', () => {
    const r = processQuestion(doc('一辆小车以初速度 v0 = 10 m/s 做匀加速直线运动，加速度 a = 2 m/s²，运动 t = 5 s。求末速度和位移。'))
    const velocityStep = r.solution?.steps.find(s => s.title === 'v = v0 + at')
    expect(velocityStep?.substitution).toBe('v = (10 m/s) + (2 m/s²) × (5 s)')
    const displacementStep = r.solution?.steps.find(s => s.title === 's = v0*t + 0.5*a*t²')
    expect(displacementStep?.substitution).toBe('s = (10 m/s) × (5 s) + 0.5 × (2 m/s²) × (5 s)²')
  })

  it('fills the 代入 row on a magnetic solve while leaving framing steps bare', () => {
    const r = processQuestion(doc('一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期'))
    const radiusStep = r.solution?.steps.find(s => s.title === 'R = mv / |q|B')
    expect(radiusStep?.substitution).toContain('1.67 × 10⁻²⁷ kg')
    expect(radiusStep?.substitution).toContain('0.4 T')
    const framing = r.solution?.steps.find(s => s.title === '洛伦兹力提供向心力')
    expect(framing?.substitution).toBeUndefined()
  })
})
