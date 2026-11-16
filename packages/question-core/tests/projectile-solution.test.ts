import { describe, expect, it } from 'vitest'

import { DeterministicMechanicsQuestionParser, processQuestion, type QuestionDocument } from '../src/index.ts'
import { buildMechanicsSceneFromIR } from '../src/mechanics-scene-builder.ts'

const documentOf = (text: string): QuestionDocument =>
  ({
    id: 'projectile-derivation',
    content: { source: 'text', rawText: text, extractedText: text, status: 'EXTRACTED' },
    metadata: { title: '抛体推导', source: 'text' },
    createdAt: '',
    updatedAt: '',
  }) as QuestionDocument

const solve = (text: string) => {
  const result = processQuestion(documentOf(text))
  expect(result.workflowState).toBe('READY')
  expect(result.ir?.model).toBe('projectile_motion')
  expect(result.scene?.metadata.sourceQuestionId).toBe('projectile-derivation')
  expect(result.simulation?.verification.status).toBe('passed')
  return result
}

describe('projectile solution derivation from the validated engine', () => {
  it.each(['', '水平射程为 0。'])('preserves an explicit upward launch without a numeric angle (%s)', suffix => {
    const result = solve(`物体从地面以 v0 = 20 m/s 竖直向上抛出，忽略空气阻力，重力加速度 g = 9.8 m/s²。求：(1) 上升的最大高度 h；(2) 从抛出到返回地面的总时间 t。${suffix}题目：UI 验收 20261116 检索与动画`)
    expect(result.ir?.initialVelocityDirection).toBe('up')
    expect(result.ir?.launchAngle).toBeUndefined()
    expect(result.ir?.knowns.find(known => known.key === 'height')?.value).toBe(0)
    expect(result.scene?.revision).toBe(0)
    expect(result.scene?.bodies?.[0]?.velocity?.vector).toEqual({ x: 0, y: 20, z: 0 })
    expect(result.solution?.results['flight_time']?.value).toBe('4.08')
    expect(result.solution?.results['max_height']?.value).toBe('20.41')
    if (suffix !== '') expect(result.solution?.results['range']?.value).toBe('0.00')
  })

  it('keeps downward launch direction and ignores an unrelated printed angle', () => {
    const down = solve('物体从 20 m 高处以 10 m/s 竖直向下抛出，g = 10 m/s²。求落地时间。')
    expect(down.scene?.bodies?.[0]?.velocity?.vector).toEqual({ x: 0, y: -10, z: 0 })
    expect(down.solution?.results['flight_time']?.value).toBe('1.24')
    const up = solve('标牌上写有 30°。物体从地面以 20 m/s 竖直向上抛出，g = 9.8 m/s²。求落地时间。')
    expect(up.ir?.launchAngle).toBeUndefined()
    expect(up.scene?.bodies?.[0]?.velocity?.vector).toEqual({ x: 0, y: 20, z: 0 })
  })

  it.each([
    ['missing direction', '物体从地面以 20 m/s 抛出，g = 9.8 m/s²。求最大高度与水平射程。'],
    ['missing height', '物体以 20 m/s 竖直向上抛出，g = 9.8 m/s²。求落地时间。'],
    ['gravity is not speed', '物体从 20 m 高处竖直向上抛出，g = 9.8 m/s²。求落地时间。'],
    ['conflicting direction', '物体从地面以 20 m/s 竖直向上抛出，抛射角 0°，g = 9.8 m/s²。求落地时间。'],
    ['conflicting component', '物体从地面以 20 m/s 竖直向上抛出，水平速度为 5 m/s，g = 9.8 m/s²。求落地时间。'],
  ])('rejects %s rather than supplying zero or horizontal defaults', (_name, text) => {
    const document = documentOf(text)
    const result = processQuestion(document)
    expect(result.workflowState).not.toBe('READY')
    expect(result.scene).toBeNull()
    expect(result.simulation).toBeNull()
    expect(result.solution).toBeNull()
    const ir = DeterministicMechanicsQuestionParser.parse(document).ir
    if (ir === null || ir === undefined) throw new Error('The mechanics parser must retain its incomplete IR')
    expect(() => buildMechanicsSceneFromIR(ir)).toThrow()
  })

  it('uses the round-trip time for a vertical launch from the ground', () => {
    const result = solve(
      '物体从地面做抛体运动，以初速度 20 m/s，抛射角 90° 抛出，g = 9.8 m/s²。求落地时间和最大高度。',
    )
    const solution = result.solution!
    const flight = solution.steps.find((step) => step.resultSymbol === 't')

    expect(solution.results['flight_time']).toMatchObject({
      label: '落地时间',
      value: '4.08',
      unit: 's',
    })
    expect(solution.results['max_height']).toMatchObject({
      label: '最大高度',
      value: '20.41',
      unit: 'm',
    })
    expect(flight?.title).toBe('t = 2*vy0/g')
    expect(flight?.substitution).toBe('t = 2 × (20 m/s) / (9.8 m/s²)')
    expect(
      solution.derivationFormulas.find((formula) => formula.id === 'f-flight')?.expression,
    ).toBe(flight?.title)
    expect(solution.steps.some((step) => step.title === 't = √(2h/g)')).toBe(false)
  })

  it('uses the positive landing root for an oblique launch above the ground', () => {
    const result = solve(
      '物体从 15 m 高处，以初速度 20 m/s，抛射角 30° 抛出，g = 10 m/s²。求落地时间、最大高度和射程。',
    )
    const solution = result.solution!
    const flight = solution.steps.find((step) => step.resultSymbol === 't')

    // vy0 = 10 m/s, discriminant = 400 m²/s², so t = (10 + 20)/10 = 3 s.
    expect(solution.results['flight_time']?.value).toBe('3.00')
    expect(solution.results['range']?.value).toBe('51.96')
    expect(solution.results['max_height']?.value).toBe('20.00')
    expect(flight?.title).toBe('t = (vy0 + √(vy0² + 2*g*h0))/g')
    expect(flight?.substitution).toBe(
      't = ((10 m/s) + √ ((10 m/s)² + 2 × (10 m/s²) × (15 m))) / (10 m/s²)',
    )
    expect(
      solution.derivationFormulas.find((formula) => formula.id === 'f-flight')?.expression,
    ).toBe(flight?.title)
  })

  it('keeps the horizontal-launch simplification and its original engine answers', () => {
    const result = solve(
      '物体从 20 m 高处，以 10 m/s 水平抛出，g = 10 m/s²。求落地时间和水平射程。',
    )
    const flight = result.solution?.steps.find((step) => step.resultSymbol === 't')

    expect(result.solution?.results['flight_time']?.value).toBe('2.00')
    expect(result.solution?.results['range']?.value).toBe('20.00')
    expect(flight?.title).toBe('t = √(2h/g)')
    expect(flight?.substitution).toBe('t = √ (2 × (20 m) / (10 m/s²))')
  })

  it('fills the landing substitution from the engine gravity when the stem omits g', () => {
    const result = solve('物体从 4.9 m 高处，以 10 m/s 水平抛出。求落地时间和水平射程。')
    const flight = result.solution?.steps.find((step) => step.resultSymbol === 't')

    expect(result.ir?.knowns.some((known) => known.key === 'gravity')).toBe(false)
    expect(result.solution?.results['flight_time']?.value).toBe('1.00')
    expect(flight?.substitution).toBe('t = √ (2 × (4.9 m) / (9.8 m/s²))')
  })
})
