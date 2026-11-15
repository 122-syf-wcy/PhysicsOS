import { expect, it } from 'vitest'
import { QuestionCodeParts } from '../src/question-code-parts.ts'
it('rejects overlapping uncommitted writes instead of silently overwriting accepted segments', () => {
  const parts = new QuestionCodeParts()
  const first = parts.stage('rendererJs', 'append', 'first')
  expect(() => parts.stage('rendererJs', 'append', 'lost')).toThrow('CODE_WRITE_PENDING')
  first.commit()
  parts.write('rendererJs', 'append', 'second')
  first.commit()
  expect(parts.source().rendererJs).toBe('firstsecond')
})
it('preserves original segments, replaces explicitly, and bounds writes without partially modifying content', () => {
  const parts = new QuestionCodeParts()
  parts.write('rendererJs', 'replace', 'first\n')
  parts.write('rendererJs', 'append', 'second')
  expect(parts.source().rendererJs).toBe('first\nsecond')
  expect(() => parts.write('rendererJs', 'append', 'x'.repeat(24001))).toThrow('CODE_PART_TOO_LARGE')
  expect(parts.source().rendererJs).toBe('first\nsecond')
  parts.write('stylesheet', 'replace', 'body {}')
  for (let i = 0; i < 6; i++) parts.write('rendererJs', 'append', '\n')
  expect(() => parts.write('rendererJs', 'replace', '')).toThrow('CODE_WRITE_LIMIT')
  expect(parts.source()).toEqual({ rendererJs: 'first\nsecond' + '\n'.repeat(6), stylesheet: 'body {}' })
})
it('accepts 6000-character chunks while keeping the combined JS and CSS limits unchanged', () => {
  const parts = new QuestionCodeParts()
  for (let i = 0; i < 4; i++) parts.write('rendererJs', i === 0 ? 'replace' : 'append', 'j'.repeat(6000))
  expect(parts.source().rendererJs).toHaveLength(24000)
  expect(() => parts.write('rendererJs', 'append', 'x')).toThrow('CODE_SOURCE_TOO_LARGE')
  expect(parts.source().rendererJs).toHaveLength(24000)
  parts.write('stylesheet', 'replace', 'c'.repeat(6000))
  expect(parts.source().stylesheet).toHaveLength(6000)
  expect(() => parts.write('stylesheet', 'append', 'x')).toThrow('CODE_SOURCE_TOO_LARGE')
  expect(parts.source().stylesheet).toHaveLength(6000)
})
it('rejects 24001 characters without committing source and still spends the bounded write attempt', () => {
  const parts = new QuestionCodeParts()
  for (let i = 0; i < 10; i++) expect(() => parts.write('rendererJs', 'replace', 'x'.repeat(24001))).toThrow('CODE_PART_TOO_LARGE')
  expect(parts.source()).toEqual({ rendererJs: '', stylesheet: '' })
  expect(() => parts.write('rendererJs', 'replace', 'x')).toThrow('CODE_WRITE_LIMIT')
})
it('accepts the observed 10518-character JS response unchanged and a full 24000-character replacement', () => {
  const parts = new QuestionCodeParts()
  const observed = 'j'.repeat(10518)
  parts.write('rendererJs', 'replace', observed)
  expect(parts.source().rendererJs).toBe(observed)
  parts.write('rendererJs', 'replace', 'j'.repeat(24000))
  expect(parts.source().rendererJs).toHaveLength(24000)
  expect(() => parts.write('rendererJs', 'append', 'x')).toThrow('CODE_SOURCE_TOO_LARGE')
  const css = new QuestionCodeParts()
  css.write('stylesheet', 'replace', 'c'.repeat(6000))
  expect(() => css.write('stylesheet', 'replace', 'c'.repeat(6001))).toThrow('CODE_SOURCE_TOO_LARGE')
  expect(css.source().stylesheet).toHaveLength(6000)
})
it('reports accepted source capacity so the next completion can checkpoint without duplicating the prefix', () => {
  const parts = new QuestionCodeParts()
  expect(parts.write('rendererJs', 'replace', 'a'.repeat(6000))).toMatchObject({
    characters: 6000, remainingCharacters: 18000, remainingWrites: 9, suggestedPartCharacters: 6000,
  })
  const discarded = parts.stage('rendererJs', 'append', 'discarded')
  discarded.discard()
  expect(parts.write('rendererJs', 'append', 'b'.repeat(16000))).toMatchObject({
    characters: 22000, remainingCharacters: 2000, remainingWrites: 7, suggestedPartCharacters: 2000,
  })
  expect(parts.source().rendererJs).toBe('a'.repeat(6000) + 'b'.repeat(16000))
  expect(parts.write('rendererJs', 'append', 'c'.repeat(2000))).toMatchObject({
    characters: 24000, remainingCharacters: 0, suggestedPartCharacters: 0,
  })
})
it('fits a complete chunked source and one full repair inside the unchanged shared ten-write budget', () => {
  const parts = new QuestionCodeParts()
  for (const text of ['original', 'repaired']) {
    const chunk = text.padEnd(6000, '.')
    for (let i = 0; i < 4; i++) parts.write('rendererJs', i === 0 ? 'replace' : 'append', chunk)
    parts.write('stylesheet', 'replace', text.padEnd(6000, ' '))
    expect(parts.source()).toEqual({ rendererJs: chunk.repeat(4), stylesheet: text.padEnd(6000, ' ') })
  }
  expect(() => parts.write('rendererJs', 'append', '')).toThrow('CODE_WRITE_LIMIT')
})
