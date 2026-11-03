import { describe, expect, it } from 'vitest'

import { processQuestion, type QuestionDocument } from '../src/index.ts'

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
  it('uses the round-trip time for a vertical launch from the ground', () => {
    const result = solve(
      '物体做抛体运动，以初速度 20 m/s，抛射角 90° 抛出，g = 9.8 m/s²。求落地时间和最大高度。',
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
