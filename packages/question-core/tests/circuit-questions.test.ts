import { describe, expect, it } from 'vitest'

import {
  createGoldenQuestionDocument,
  DeterministicCircuitQuestionParser,
  GOLDEN_QUESTIONS,
  isCircuitQuestionText,
  processQuestion,
} from '../src/index.ts'
import { isCircuitScene } from '@physicsos/physics-scene'

const circuitQuestion = (id: string) => {
  const definition = GOLDEN_QUESTIONS.find((candidate) => candidate.id === id)
  if (definition === undefined) throw new Error(`Missing circuit golden question ${id}`)
  return definition
}

describe('DeterministicCircuitQuestionParser', () => {
  it('recognizes a series circuit question and rejects electric-field text', () => {
    expect(isCircuitQuestionText(circuitQuestion('circ-01-series-current').text)).toBe(true)
    /* An electric-field question must NOT be claimed by the circuit parser. */
    const electricText = GOLDEN_QUESTIONS.find((q) => q.id === 'electric-01-perpendicular-deflection')!.text
    expect(isCircuitQuestionText(electricText)).toBe(false)
    /* A magnetic question must not be claimed either. */
    const magneticText = GOLDEN_QUESTIONS[0]!.text
    expect(isCircuitQuestionText(magneticText)).toBe(false)
  })

  it('extracts EMF, resistances, topology and targets from a series question', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-01-series-current'))
    const candidate = DeterministicCircuitQuestionParser.parse(document)

    expect(candidate.confidence).toBeGreaterThan(0.9)
    expect(candidate.ir.domain).toBe('circuit')
    expect(candidate.ir.model).toBe('dc_steady_state_mna')
    expect(candidate.ir.entities).toEqual(expect.arrayContaining(['circuit_loop', 'battery', 'resistor']))
    expect(candidate.ir.circuitTopology).toBe('series')
    expect(candidate.ir.relations).toContain('series_circuit')
    expect(candidate.ir.relations).toContain('ohms_law')
    expect(candidate.ir.assumptions).toContain('ideal_meters')
    expect(candidate.ir.targets).toContain('current')
    expect(candidate.ir.knowns.find((k) => k.key === 'emf')?.value).toBe(6)
    expect(candidate.ir.knowns.find((k) => k.key === 'resistance_1')?.value).toBe(10)
    expect(candidate.ir.knowns.find((k) => k.key === 'resistance_2')?.value).toBe(20)
  })

  it('detects parallel topology from a parallel question', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-02-parallel-total-resistance'))
    const candidate = DeterministicCircuitQuestionParser.parse(document)

    expect(candidate.ir.circuitTopology).toBe('parallel')
    expect(candidate.ir.relations).toContain('parallel_circuit')
    expect(candidate.ir.knowns.find((k) => k.key === 'resistance_1')?.value).toBe(10)
    expect(candidate.ir.knowns.find((k) => k.key === 'resistance_2')?.value).toBe(15)
  })

  it('detects a rheostat and its total resistance', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-04-rheostat'))
    const candidate = DeterministicCircuitQuestionParser.parse(document)

    expect(candidate.ir.circuitTopology).toBe('rheostat')
    expect(candidate.ir.relations).toContain('rheostat_sweep')
    expect(candidate.ir.rheostatTotalResistance).toBe(20)
  })

  it('detects an EMF-and-internal-resistance measurement question', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-03-emf-internal'))
    const candidate = DeterministicCircuitQuestionParser.parse(document)

    expect(candidate.ir.knowns.find((k) => k.key === 'emf')?.value).toBeCloseTo(4.5)
    expect(candidate.ir.knowns.find((k) => k.key === 'internal_resistance')?.value).toBeCloseTo(0.5)
    expect(candidate.ir.knowns.find((k) => k.key === 'voltage')).toBeUndefined()
    expect(candidate.ir.targets).toEqual(expect.arrayContaining(['current', 'voltage']))
  })

  it('detects power and terminal-voltage targets', () => {
    const powerDoc = createGoldenQuestionDocument(circuitQuestion('circ-05-power'))
    const powerCandidate = DeterministicCircuitQuestionParser.parse(powerDoc)
    expect(powerCandidate.ir.targets).toContain('power')

    const tvDoc = createGoldenQuestionDocument(circuitQuestion('circ-06-terminal-voltage'))
    const tvCandidate = DeterministicCircuitQuestionParser.parse(tvDoc)
    expect(tvCandidate.ir.targets).toEqual(expect.arrayContaining(['current', 'terminal_voltage']))
    expect(tvCandidate.ir.knowns.find((k) => k.key === 'internal_resistance')?.value).toBe(1)
    expect(tvCandidate.ir.knowns.find((k) => k.key === 'emf')?.value).toBe(9)
  })

  it('does not claim a composite-field question', () => {
    const compositeText = GOLDEN_QUESTIONS.find((q) => q.id === 'comp-01-selector-balance')!.text
    expect(isCircuitQuestionText(compositeText)).toBe(false)
    const document = createGoldenQuestionDocument({ ...circuitQuestion('comp-01-selector-balance') })
    const result = processQuestion(document)
    /* A composite-field question is routed on its model, not its domain tag. */
    expect(result.workflowState).toBe('READY')
    expect(result.ir?.model).toBe('velocity_selector')
  })
})

describe('Circuit Question full pipeline', () => {
  it('runs a series circuit through Scene, Engine, Verifier and Observation', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-01-series-current'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.ir?.domain).toBe('circuit')
    expect(result.ir?.model).toBe('dc_steady_state_mna')

    /* The scene is a pure single-circuit scene. */
    expect(result.scene).toBeDefined()
    expect(isCircuitScene(result.scene!)).toBe(true)
    expect(result.scene?.circuits.length).toBe(1)
    expect(result.scene?.circuits[0]?.components.length).toBeGreaterThan(0)

    /* The circuit engine runs and verification passes (KCL, power balance). */
    expect(result.simulation?.metadata.engineId).toBe('engine-circuit')
    expect(result.simulation?.verification.status).toBe('passed')
    expect(result.simulation?.sceneId).toBe(result.scene?.id)
    expect(result.simulation?.sceneRevision).toBe(result.scene?.revision)

    /* The engine publishes the operating point. I = E / (R1 + R2) = 6 / 30 = 0.2 A. */
    const dq = result.simulation!.derivedQuantities
    const mainCurrent = dq.find((d) => d.key === 'main_current')
    expect(mainCurrent).toBeDefined()
    const current = (mainCurrent!.value as { value: number }).value
    expect(current).toBeCloseTo(0.2, 2)
    const emf = dq.find((d) => d.key === 'emf')
    expect((emf!.value as { value: number }).value).toBeCloseTo(6, 6)

    /* Verification carries the built-in engine checks. */
    const kclCheck = result.simulation?.verification.checks.find((c) => c.id === 'kcl_current_conservation')
    expect(kclCheck?.passed).toBe(true)
    const powerCheck = result.simulation?.verification.checks.find((c) => c.id === 'power_balance')
    expect(powerCheck?.passed).toBe(true)

    /* Observations are produced from the engine's component operating points. */
    expect(result.observations).not.toBeNull()
    const types = result.observations!.observations.map((o) => o.type)
    expect(types).toEqual(expect.arrayContaining([
      'circuit_current',
      'circuit_voltage',
      'circuit_power',
      'circuit_source_summary',
    ]))

    /* The solution surfaces the engine result, not a recomputation. */
    expect(result.solution?.results['current']).toBeDefined()
    expect(result.solution?.results['current']?.value).toBeDefined()
  })

  it('runs a parallel circuit through the full pipeline', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-02-parallel-total-resistance'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.ir?.circuitTopology).toBe('parallel')
    expect(isCircuitScene(result.scene!)).toBe(true)
    expect(result.simulation?.metadata.engineId).toBe('engine-circuit')
    expect(result.simulation?.verification.status).toBe('passed')

    /* Parallel: R = (10 × 15) / (10 + 15) = 6 Ω. I = E / R = 6 / 6 = 1 A. */
    const dq = result.simulation!.derivedQuantities
    const mainCurrent = dq.find((d) => d.key === 'main_current')
    expect(mainCurrent).toBeDefined()
    expect((mainCurrent!.value as { value: number }).value).toBeCloseTo(1, 1)
    const externalR = dq.find((d) => d.key === 'external_resistance')
    expect(externalR).toBeDefined()
    expect((externalR!.value as { value: number }).value).toBeCloseTo(6, 1)

    expect(result.solution?.results['resistance']).toBeDefined()
    expect(result.solution?.results['current']).toBeDefined()
  })

  it('runs an EMF-and-internal-resistance measurement through the full pipeline', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-03-emf-internal'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.simulation?.metadata.engineId).toBe('engine-circuit')
    expect(result.simulation?.verification.status).toBe('passed')

    /* E = 4.5 V, r = 0.5 Ω, rheostat total = 20 Ω. The engine reports the
       operating point at the sweep end (slider = 1.0), so R_var = 20 Ω.
       I = E / (R + r) = 4.5 / 20.5 ≈ 0.2195 A
       U = E − I·r = 4.5 − 0.2195 × 0.5 ≈ 4.390 V */
    const dq = result.simulation!.derivedQuantities
    const mainCurrent = (dq.find((d) => d.key === 'main_current')!.value as { value: number }).value
    expect(mainCurrent).toBeCloseTo(4.5 / 20.5, 3)
    const terminalV = (dq.find((d) => d.key === 'terminal_voltage')!.value as { value: number }).value
    expect(terminalV).toBeCloseTo(4.5 - (4.5 / 20.5) * 0.5, 3)

    /* The terminal-voltage verifier check must pass. */
    const tvCheck = result.simulation?.verification.checks.find((c) => c.id.startsWith('terminal_voltage_law'))
    expect(tvCheck?.passed).toBe(true)

    expect(result.solution?.results['current']).toBeDefined()
    expect(result.solution?.results['voltage']).toBeDefined()
  })

  it('runs a rheostat circuit with a variable-resistor sweep timeline', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-04-rheostat'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.ir?.circuitTopology).toBe('rheostat')
    expect(isCircuitScene(result.scene!)).toBe(true)
    expect(result.simulation?.metadata.engineId).toBe('engine-circuit')
    expect(result.simulation?.verification.status).toBe('passed')

    /* A variable resistor produces a non-zero sweep timeline. */
    expect(result.scene?.timeline.endTime?.value).toBeGreaterThan(0)
    expect(result.simulation?.states.length).toBeGreaterThan(1)

    /* The engine reports the operating point at the sweep end (slider = 1.0),
       so R_var = 20 Ω, R_total = 10 + 20 = 30 Ω. I = 6 / 30 = 0.2 A. */
    const dq = result.simulation!.derivedQuantities
    const mainCurrent = (dq.find((d) => d.key === 'main_current')!.value as { value: number }).value
    expect(mainCurrent).toBeCloseTo(0.2, 1)

    expect(result.solution?.results['current']).toBeDefined()
  })

  it('runs a power question and surfaces power results', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-05-power'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.simulation?.verification.status).toBe('passed')

    /* P = E·I = 6 × 0.2 = 1.2 W. */
    const dq = result.simulation!.derivedQuantities
    const totalPower = (dq.find((d) => d.key === 'total_power')!.value as { value: number }).value
    expect(totalPower).toBeCloseTo(1.2, 1)
    expect(result.solution?.results['power']).toBeDefined()
  })

  it('runs a terminal-voltage question with internal resistance', () => {
    const document = createGoldenQuestionDocument(circuitQuestion('circ-06-terminal-voltage'))
    const result = processQuestion(document)

    expect(result.workflowState).toBe('READY')
    expect(result.simulation?.verification.status).toBe('passed')

    /* E = 9 V, r = 1 Ω, R = 5 Ω. I = 9 / 6 = 1.5 A. U = 9 − 1.5 × 1 = 7.5 V. */
    const dq = result.simulation!.derivedQuantities
    const mainCurrent = (dq.find((d) => d.key === 'main_current')!.value as { value: number }).value
    expect(mainCurrent).toBeCloseTo(1.5, 1)
    const terminalV = (dq.find((d) => d.key === 'terminal_voltage')!.value as { value: number }).value
    expect(terminalV).toBeCloseTo(7.5, 1)

    expect(result.solution?.results['current']).toBeDefined()
    expect(result.solution?.results['terminal_voltage']).toBeDefined()
  })
})

describe('Circuit semantic validation', () => {
  it('returns INVALID_SEMANTICS when no source is given', () => {
    const document = createGoldenQuestionDocument({
      id: 'circ-no-source',
      title: '缺少电源',
      text: '一个串联电路中电阻 R1 = 10 Ω，R2 = 20 Ω，串联连接。求电路中的电流。',
      expectedDomain: 'circuit',
      expectedChargeSign: 'unknown',
      expectedFieldDirection: 'unknown',
      expectedValidation: 'INVALID_SEMANTICS',
    })
    const result = processQuestion(document)

    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_SOURCE' }))
    expect(result.scene).toBeNull()
  })

  it('returns INVALID_SEMANTICS when no resistance is given', () => {
    const document = createGoldenQuestionDocument({
      id: 'circ-no-resistance',
      title: '缺少电阻',
      text: '一个电路由电源和电流表组成，电动势 E = 6 V。求电路中的电流。',
      expectedDomain: 'circuit',
      expectedChargeSign: 'unknown',
      expectedFieldDirection: 'unknown',
      expectedValidation: 'INVALID_SEMANTICS',
    })
    const result = processQuestion(document)

    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_RESISTANCE' }))
  })
})
