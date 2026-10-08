import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  formatFinding,
  isProbablyBinary,
  scanForSecrets,
  sensitiveEnvValues,
  trackedFileInputs,
} from '../src/index.ts'

const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).stdout.trim()

/** Assembled at runtime so this file never contains a key-shaped literal. */
const fakeLeak = `token = sk-test_${'x'.repeat(25)}`

const inputsFor = (file: string) =>
  trackedFileInputs(REPO_ROOT).filter((input) => input.file === file)

describe('secret-leak scanner', () => {
  describe('positive control', () => {
    it('detects a fake key-shaped value, so the gate can actually fail', () => {
      const findings = scanForSecrets({ inputs: [{ file: 'fixture.txt', content: fakeLeak }] })
      expect(findings).toHaveLength(1)
      expect(findings[0]?.rule).toBe('key-pattern')
      expect(findings[0]?.line).toBe(1)
    })

    it('reports the finding without echoing the value', () => {
      const findings = scanForSecrets({ inputs: [{ file: 'fixture.txt', content: fakeLeak }] })
      const rendered = findings.map(formatFinding).join('\n')
      expect(rendered).toContain('fixture.txt:1')
      expect(rendered).not.toContain('sk-test_')
      expect(rendered).toContain('[redacted')
    })

    it('matches at the documented boundary and not below it', () => {
      const below = `sk-${'a'.repeat(19)}`
      const at = `sk-${'a'.repeat(20)}`
      expect(scanForSecrets({ inputs: [{ file: 'b', content: below }] })).toHaveLength(0)
      expect(scanForSecrets({ inputs: [{ file: 'a', content: at }] })).toHaveLength(1)
    })

    it('flags a literal value of a sensitive env var', () => {
      const secretValue = `not-a-real-value-${'z'.repeat(12)}`
      const findings = scanForSecrets({
        inputs: [{ file: 'report.md', content: `leaked: ${secretValue}` }],
        needles: [secretValue],
      })
      expect(findings).toHaveLength(1)
      expect(findings[0]?.rule).toBe('env-value')
      expect(findings[0]?.masked).not.toContain(secretValue)
    })
  })

  describe('negative control', () => {
    it('passes on .env.example, whose values are empty', () => {
      const inputs = inputsFor('.env.example')
      expect(inputs).toHaveLength(1)
      expect(inputs[0]?.content).toContain('PHYSICSOS_IMAGE_API_KEY=')
      expect(scanForSecrets({ inputs })).toEqual([])
    })
  })

  describe('environment needles', () => {
    it('ignores unset and short values, and never returns them raw', () => {
      expect(sensitiveEnvValues({})).toEqual([])
      expect(sensitiveEnvValues({ PHYSICSOS_IMAGE_API_KEY: 'short' })).toEqual([])
      const values = sensitiveEnvValues({ PHYSICSOS_IMAGE_API_KEY: 'long-enough-value' })
      expect(values).toEqual(['long-enough-value'])
    })
  })

  it('skips binary assets', () => {
    expect(isProbablyBinary('whatever', 'logo/physicsos-mark-1024.png')).toBe(true)
    expect(isProbablyBinary('plain text', 'src/index.ts')).toBe(false)
  })
})
