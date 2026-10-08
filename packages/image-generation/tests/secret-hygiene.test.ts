import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  formatFinding,
  IMAGE_API_KEY_ENV,
  LEGACY_IMAGE_API_KEY_ENV,
  MissingImageApiKeyError,
  readImageProviderConfig,
  scanForSecrets,
  trackedFileInputs,
} from '../src/index.ts'

/**
 * `git ls-files` / `git grep` only cover the current directory by default, so
 * every scan must run from the repository root — otherwise a package-local test
 * would audit just its own (empty) subtree and pass vacuously.
 */
const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).stdout.trim()

const trackedFiles = (): string[] =>
  spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)

describe('secret hygiene', () => {
  it('no tracked file contains credential material', () => {
    const findings = scanForSecrets({ inputs: trackedFileInputs(REPO_ROOT) })
    expect(findings.map(formatFinding)).toEqual([])
  })

  it('the scanner is not silently scoped to this package', () => {
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('package.json')
    expect(files).toContain('.env.example')
    expect(files.some((file) => file.startsWith('packages/'))).toBe(true)
  })

  it('reads the key from the environment only, with no placeholder fallback', () => {
    // Canonical spelling is two `S`; the one-`S` name is a deprecation alias.
    expect(IMAGE_API_KEY_ENV).toBe('PHYSICSOS_IMAGE_API_KEY')
    expect(LEGACY_IMAGE_API_KEY_ENV).toBe('PHYSICOS_IMAGE_API_KEY')

    // An empty environment must fail loudly rather than yield a fake key.
    expect(() => readImageProviderConfig({})).toThrow(MissingImageApiKeyError)
    expect(() => readImageProviderConfig({ PHYSICSOS_IMAGE_API_KEY: '   ' })).toThrow(
      MissingImageApiKeyError,
    )
    // A value present in the environment is exactly what is used.
    expect(readImageProviderConfig({ PHYSICSOS_IMAGE_API_KEY: 'unit-test-key' }).apiKey).toBe(
      'unit-test-key',
    )
  })
})
