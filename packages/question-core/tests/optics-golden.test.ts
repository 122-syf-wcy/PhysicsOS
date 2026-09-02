import { describe, expect, it } from 'vitest'

import { GOLDEN_QUESTIONS } from '../src/index.ts'

/**
 * Optics golden-question data-structure tests.
 *
 * These tests only assert the GOLDEN_QUESTIONS entries themselves — the id,
 * the expectedDomain and the expectedValidation — never the question-runtime
 * (parser / scene / observation), which a separate agent owns. The optics
 * parser may not even be wired into this worktree yet, so we deliberately avoid
 * processQuestion here.
 */

const OPTICS_IDS = [
  'opt-01-plane-mirror',
  'opt-02-convex-lens-beyond-2f',
  'opt-03-convex-lens-between-f-and-2f',
  'opt-04-convex-lens-within-f',
  'opt-05-concave-mirror-beyond-2f',
  'opt-06-convex-mirror',
] as const

describe('optics golden questions', () => {
  const opticsQuestions = GOLDEN_QUESTIONS.filter(
    (question) => question.expectedDomain === 'optics',
  )

  it('ships six optics questions', () => {
    expect(opticsQuestions.length).toBe(6)
  })

  it('every expected optics id is present in GOLDEN_QUESTIONS', () => {
    const presentIds = new Set(opticsQuestions.map((question) => question.id))
    for (const id of OPTICS_IDS) {
      expect(presentIds.has(id), `missing optics golden question ${id}`).toBe(true)
    }
  })

  for (const id of OPTICS_IDS) {
    describe(id, () => {
      const question = GOLDEN_QUESTIONS.find((candidate) => candidate.id === id)

      it('exists in GOLDEN_QUESTIONS', () => {
        expect(question, `missing optics golden question ${id}`).toBeDefined()
      })

      it('declares expectedDomain as optics', () => {
        expect(question?.expectedDomain).toBe('optics')
      })

      it('declares expectedValidation as VALID', () => {
        expect(question?.expectedValidation).toBe('VALID')
      })

      it('declares unknown charge sign and field direction', () => {
        expect(question?.expectedChargeSign).toBe('unknown')
        expect(question?.expectedFieldDirection).toBe('unknown')
      })
    })
  }

  it('uses no charge/field expectations inherited from magnetic defaults', () => {
    for (const question of opticsQuestions) {
      expect(question.expectedChargeSign).toBe('unknown')
      expect(question.expectedFieldDirection).toBe('unknown')
    }
  })
})
