import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSecretValue } from '../src/dependencies.ts'

describe('secret wiring', () => {
  it('prefers direct environment values and reads a bounded file fallback', () => {
    expect(readSecretValue({ DATABASE_URL: 'postgres://direct' }, 'DATABASE_URL', 'DATABASE_URL_FILE'))
      .toBe('postgres://direct')
    const root = mkdtempSync(path.join(tmpdir(), 'physicsos-ops-'))
    const file = path.join(root, 'url')
    writeFileSync(file, 'redis://from-file\n')
    expect(readSecretValue({ REDIS_URL_FILE: file }, 'REDIS_URL', 'REDIS_URL_FILE'))
      .toBe('redis://from-file')
  })
})
