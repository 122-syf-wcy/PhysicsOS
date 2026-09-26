import { describe, expect, it } from 'vitest'

import {
  createGoldenQuestionDocument,
  DeterministicInductionQuestionParser,
  GOLDEN_QUESTIONS,
  isInductionQuestionText,
  processQuestion,
} from '../src/index.ts'
import { isInductionScene } from '@physicsos/physics-scene'

const inductionQuestion = (id: string) => {
  const definition = GOLDEN_QUESTIONS.find((candidate) => candidate.id === id)
  if (definition === undefined) throw new Error(`Missing induction golden question ${id}`)
  return definition
}

describe('DeterministicInductionQuestionParser', () => {
  it('recognizes a bar-motion question and rejects pure-magnetic text', () => {
    expect(isInductionQuestionText(inductionQuestion('ind-01-bar-motion-emf').text)).toBe(true)
    /* A Lorentz-force circular-motion question must NOT be claimed by the
       induction parser — it names 磁场 but no induction keyword. */
    const magneticText = GOLDEN_QUESTIONS[0]!.text
    expect(isInductionQuestionText(magneticText)).toBe(false)
    /* A circuit question must not be claimed either. */
    const circuitText = GOLDEN_QUESTIONS.find((q) => q.id === 'circ-01-series-current')!.text
    expect(isInductionQuestionText(circuitText)).toBe(false)
    /* A composite crossed-field question is rejected by the composite signal. */
    const compositeText = GOLDEN_QUESTIONS.find((q) => q.id === 'comp-01-selector-balance')!.text
    expect(isInductionQuestionText(compositeText)).toBe(false)
  })

  it('extracts B, L, v, R and the bar-motion model from a cutting question', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-01-bar-motion-emf'))
    const candidate = DeterministicInductionQuestionParser.parse(document)

    expect(candidate.confidence).toBeGreaterThanOrEqual(0.9)
    expect(candidate.ir.domain).toBe('induction')
    expect(candidate.ir.model).toBe('bar_motion_emf')
    expect(candidate.ir.entities).toEqual(
      expect.arrayContaining(['conducting_bar', 'circuit_loop']),
    )
    expect(candidate.ir.relations).toContain('bar_cuts_field_lines')
    expect(candidate.ir.relations).toContain('faraday_law')
    expect(candidate.ir.assumptions).toContain('constant_velocity_bar')
    expect(candidate.ir.targets).toEqual(expect.arrayContaining(['induced_emf', 'induced_current']))
    expect(candidate.ir.knowns.find((k) => k.key === 'magnetic_field_strength')?.value).toBeCloseTo(
      0.5,
      12,
    )
    expect(candidate.ir.knowns.find((k) => k.key === 'bar_length')?.value).toBeCloseTo(0.2, 12)
    expect(candidate.ir.knowns.find((k) => k.key === 'bar_velocity')?.value).toBeCloseTo(2, 12)
    expect(candidate.ir.knowns.find((k) => k.key === 'resistance_1')?.value).toBeCloseTo(5, 12)
    expect(candidate.ir.inductionBarLength).toBeCloseTo(0.2, 12)
    expect(candidate.ir.inductionBarVelocity).toBeCloseTo(2, 12)
  })

  it('keeps a negative bar velocity as the Lenz cutting direction', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-02-bar-motion-lenz'))
    const candidate = DeterministicInductionQuestionParser.parse(document)
    expect(candidate.ir.knowns.find((k) => k.key === 'bar_velocity')?.value).toBeCloseTo(-4, 12)
    expect(candidate.ir.targets).toContain('induction_direction')
  })

  it('extracts the flux-change model with area and rate', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-03-flux-change-emf'))
    const candidate = DeterministicInductionQuestionParser.parse(document)

    expect(candidate.ir.model).toBe('flux_change_emf')
    expect(candidate.ir.entities).toEqual(expect.arrayContaining(['coil', 'circuit_loop']))
    expect(candidate.ir.relations).toContain('flux_changes_in_coil')
    expect(candidate.ir.relations).toContain('lenz_law')
    expect(candidate.ir.knowns.find((k) => k.key === 'coil_area')?.value).toBeCloseTo(5e-3, 12)
    expect(candidate.ir.knowns.find((k) => k.key === 'flux_rate')?.value).toBeCloseTo(0.05, 12)
    expect(candidate.ir.inductionFluxRate).toBeCloseTo(0.05, 12)
  })

  it('defaults a bare coil-flux question to flux_change (no rod named)', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-04-flux-change-lenz'))
    const candidate = DeterministicInductionQuestionParser.parse(document)
    expect(candidate.ir.model).toBe('flux_change_emf')
    expect(candidate.ir.knowns.find((k) => k.key === 'flux_rate')?.value).toBeCloseTo(-0.08, 12)
  })
})

describe('Induction Question full pipeline', () => {
  it('runs a bar-motion question through Scene, Engine, Verifier and Observation', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-01-bar-motion-emf'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.domain).toBe('induction')
    expect(result.scene).not.toBeNull()
    expect(isInductionScene(result.scene!)).toBe(true)
    /* E = BLv = 0.5 × 0.20 × 2 = 0.20 V; I = E/R = 0.040 A. */
    expect(result.simulation?.verification.status).toBe('passed')
    expect(result.solution?.results['induced_emf']?.value).toBe('0.2000')
    expect(result.solution?.results['induced_emf']?.unit).toBe('V')
    expect(result.solution?.results['induced_current']?.value).toBe('0.0400')
    expect(result.solution?.results['induced_current']?.unit).toBe('A')
    /* Observations carry the EMF and current readouts. */
    const observations = result.observations?.observations ?? []
    expect(observations.some((o) => o.type === 'induction_emf')).toBe(true)
    expect(observations.some((o) => o.type === 'induction_current')).toBe(true)
  })

  it('runs a flux-change question with the Lenz sign through the full pipeline', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-03-flux-change-emf'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.model).toBe('flux_change_emf')
    /* E = -dΦ/dt = -0.05 V (Lenz sign); I = E/R = -0.025 A. */
    expect(result.solution?.results['induced_emf']?.value).toBe('-0.0500')
    expect(result.solution?.results['induced_current']?.value).toBe('-0.0250')
    expect(result.solution?.results['magnetic_flux']?.unit).toBe('Wb')
  })

  it('answers a direction question from the Lenz readout, not by re-deriving', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-04-flux-change-lenz'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    const direction = result.solution?.results['induction_direction']?.value ?? ''
    /* Flux DEcreasing at -0.08 Wb/s → E = +0.08 V → the narrative must say
       the flux decreased, never that it increased. */
    expect(direction).toContain('减少')
    expect(direction).not.toContain('增加')
  })

  it('gives zero EMF when the rod is at rest', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-05-bar-zero-velocity'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.solution?.results['induced_emf']?.value).toBe('0.0000')
    expect(result.solution?.results['induced_current']?.value).toBe('0.0000')
  })

  it('rejects a question without a loop resistance as INVALID_SEMANTICS', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('ind-06-missing-resistance'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues.some((issue) => issue.code === 'MISSING_RESISTANCE')).toBe(
      true,
    )
  })

  it('still solves the magnetic golden questions after the induction dispatch (no regression)', () => {
    const document = createGoldenQuestionDocument(inductionQuestion('01-proton-basic'))
    const result = processQuestion(document)
    expect(result.workflowState).toBe('READY')
    expect(result.ir?.domain).toBe('magnetic')
  })
})

describe('Induction semantic validation', () => {
  it('returns INVALID_SEMANTICS when B is missing', () => {
    const text =
      '一根长 L = 20 cm 的导体棒以 v = 2 m/s 的速度垂直切割磁感线，回路电阻 R = 5 Ω。求感应电动势。'
    const document: import('../src/index.ts').QuestionDocument = {
      id: 'test-no-b',
      content: { source: 'text', rawText: text, extractedText: text, status: 'EXTRACTED' },
      metadata: {
        domain: 'induction',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    } as unknown as import('../src/index.ts').QuestionDocument
    const result = processQuestion(document)
    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues.some((issue) => issue.code === 'MISSING_B_FIELD')).toBe(true)
  })

  it('returns INVALID_SEMANTICS when a flux-change question states no rate', () => {
    const text =
      '线圈放在磁感应强度 B = 0.4 T 的磁场中，线圈面积 S = 50 cm²，回路电阻 R = 2 Ω。求感应电动势。'
    const document: import('../src/index.ts').QuestionDocument = {
      id: 'test-no-rate',
      content: { source: 'text', rawText: text, extractedText: text, status: 'EXTRACTED' },
      metadata: {
        domain: 'induction',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    } as unknown as import('../src/index.ts').QuestionDocument
    const result = processQuestion(document)
    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues.some((issue) => issue.code === 'MISSING_FLUX_RATE')).toBe(true)
  })
})
