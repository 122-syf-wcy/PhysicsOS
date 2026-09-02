import { describe, expect, it } from 'vitest'

import {
  createGoldenQuestionDocument,
  DeterministicCircuitQuestionParser,
  GOLDEN_QUESTIONS,
  processQuestion,
} from '../src/index.ts'

const circuitQuestions = GOLDEN_QUESTIONS.filter((q) => q.expectedDomain === 'circuit')

describe('Circuit Golden Questions data structure', () => {
  it('defines at least four circuit golden questions', () => {
    expect(circuitQuestions.length).toBeGreaterThanOrEqual(4)
  })

  it('every circuit question has a circ- id and the circuit domain', () => {
    for (const question of circuitQuestions) {
      expect(question.id, question.id).toMatch(/^circ-/)
      expect(question.expectedDomain, question.id).toBe('circuit')
      expect(question.expectedChargeSign, question.id).toBe('unknown')
      expect(question.expectedFieldDirection, question.id).toBe('unknown')
      expect(question.expectedValidation, question.id).toBe('VALID')
    }
  })

  it('every circuit question carries non-empty text', () => {
    for (const question of circuitQuestions) {
      expect(question.text.length, question.id).toBeGreaterThan(20)
      expect(question.title.length, question.id).toBeGreaterThan(2)
    }
  })

  it('every circuit question names an EMF or voltage, at least one resistance, and a target', () => {
    for (const question of circuitQuestions) {
      const document = createGoldenQuestionDocument(question)
      const candidate = DeterministicCircuitQuestionParser.parse(document)
      expect(candidate.ir.domain, question.id).toBe('circuit')
      expect(candidate.ir.model, question.id).toBe('dc_steady_state_mna')
      expect(candidate.ir.targets.length, question.id).toBeGreaterThan(0)
      const hasSource =
        candidate.ir.knowns.some((k) => k.key === 'emf') ||
        candidate.ir.knowns.some((k) => k.key === 'voltage')
      const hasResistance =
        candidate.ir.knowns.some((k) => k.key.startsWith('resistance_')) ||
        candidate.ir.rheostatTotalResistance !== undefined
      expect(hasSource, question.id).toBe(true)
      expect(hasResistance, question.id).toBe(true)
    }
  })
})

describe('Circuit Golden Questions full pipeline', () => {
  it('every circuit golden question reaches READY with a passing verification', () => {
    for (const question of circuitQuestions) {
      const document = createGoldenQuestionDocument(question)
      const result = processQuestion(document)

      expect(result.workflowState, question.id).toBe('READY')
      expect(result.validation?.status, question.id).toBe('VALID')
      expect(result.simulation?.metadata.engineId, question.id).toBe('engine-circuit')
      expect(result.simulation?.verification.status, question.id).toBe('passed')
      expect(result.observations, question.id).not.toBeNull()
      expect(result.solution, question.id).not.toBeNull()
    }
  })

  it('every circuit golden question produces a circuit scene with exactly one circuit', () => {
    for (const question of circuitQuestions) {
      const document = createGoldenQuestionDocument(question)
      const result = processQuestion(document)

      expect(result.scene, question.id).not.toBeNull()
      expect(result.scene?.circuits.length, question.id).toBe(1)
      expect(result.scene?.particles.length, question.id).toBe(0)
      expect(result.scene?.fields.length, question.id).toBe(0)
    }
  })
})
