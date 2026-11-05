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
  expect(() => parts.write('rendererJs', 'append', 'x'.repeat(2401))).toThrow('CODE_PART_TOO_LARGE')
  expect(parts.source().rendererJs).toBe('first\nsecond')
  parts.write('stylesheet', 'replace', 'body {}')
  for (let i = 0; i < 6; i++) parts.write('rendererJs', 'append', '\n')
  expect(() => parts.write('rendererJs', 'replace', '')).toThrow('CODE_WRITE_LIMIT')
  expect(parts.source()).toEqual({ rendererJs: 'first\nsecond' + '\n'.repeat(6), stylesheet: 'body {}' })
})
