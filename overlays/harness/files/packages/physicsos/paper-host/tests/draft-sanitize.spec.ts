import { describe, expect, it } from 'vitest'
import { sanitizeQuestion } from '../src/draft.ts'

describe('draft figure references', () => {
  it.each([
    { label: 'missing', ref: undefined },
    { label: 'null', ref: null },
    { label: 'boolean', ref: false },
    { label: 'object', ref: {} },
    { label: 'array', ref: [] },
  ])('falls back to the question number for a $label ref', ({ ref }) => {
    const question = { number: 7, figure: { ref, caption: '装置示意图' } }
    expect(sanitizeQuestion(question)).toMatchObject({
      number: 7,
      figure: { kind: 'line-diagram', ref: 'q7', caption: '装置示意图' },
    })
    expect(question.figure.ref).toBe(ref)
  })

  it.each([
    ['  Incline / Diagram  ', 'incline-diagram'],
    [42, '42'],
  ])('keeps usable ref %j normalized', (ref, expected) => {
    expect(sanitizeQuestion({ number: 7, figure: { ref } })).toMatchObject({ figure: { ref: expected } })
  })
})
