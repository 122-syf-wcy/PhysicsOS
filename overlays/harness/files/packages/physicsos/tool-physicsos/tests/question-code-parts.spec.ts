import { expect, it } from 'vitest'
import { QuestionCodeParts } from '../src/question-code-parts.ts'
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
it('explains rejected part length, unchanged source and remaining attempts so the child can split it', () => {
  const parts = new QuestionCodeParts()
  parts.write('rendererJs', 'replace', 'const kept = true;')
  expect(() => parts.write('rendererJs', 'append', 'x'.repeat(2432))).toThrow('2432')
  expect(() => parts.write('rendererJs', 'append', 'x'.repeat(2755))).toThrow('2400')
  expect(() => parts.write('rendererJs', 'append', 'x'.repeat(2600))).toThrow('剩余6次')
  expect(parts.source().rendererJs).toBe('const kept = true;')
})
