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

  it('does not let model output invent ownership of a source image', () => {
    const sourceAsset = { id: 'private-attachment', sha256: 'a'.repeat(64), mediaType: 'image/png' }
    const input = { number: 1, figure: { kind: 'image', ref: 'q1', sourceAsset } }
    const output = sanitizeQuestion(input) as { figure: { sourceAsset?: unknown } }
    expect(output.figure.sourceAsset).toBeUndefined()
    expect(input.figure.sourceAsset).toBe(sourceAsset)
  })

  it.each([
    ['  Incline / Diagram  ', 'incline-diagram'],
    [42, '42'],
  ])('keeps usable ref %j normalized', (ref, expected) => {
    expect(sanitizeQuestion({ number: 7, figure: { ref } })).toMatchObject({ figure: { ref: expected } })
  })
})
