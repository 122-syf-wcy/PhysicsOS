#!/usr/bin/env node
/**
 * CI entry point for the secret-leak gate.
 *
 *   node packages/image-generation/src/scan-cli.ts            # scan the repo
 *   node packages/image-generation/src/scan-cli.ts --self-test # prove the gate works
 *
 * Exit 0 = clean, 1 = a finding (or a broken control). The scan never needs a
 * credential: env-value needles are added only for vars that happen to be set,
 * and every reported fragment is redacted to a length.
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

import {
  formatFinding,
  scanForSecrets,
  sensitiveEnvValues,
  trackedFileInputs,
} from './secret-scan.ts'

/** A key-shaped string assembled at runtime, so this file holds no literal. */
const fakeLeak = `key = sk-test_${'x'.repeat(25)}`

const selfTest = (repoRoot: string): number => {
  const positive = scanForSecrets({ inputs: [{ file: 'fixture', content: fakeLeak }] })
  const negative = scanForSecrets({
    inputs: trackedFileInputs(repoRoot).filter((input) => input.file === '.env.example'),
  })

  const positiveOk = positive.length > 0
  const negativeOk = negative.length === 0
  process.stdout.write(
    `  positive control (must FAIL): ${positiveOk ? 'detected' : 'MISSED'}\n` +
      `  negative control (.env.example must PASS): ${negativeOk ? 'clean' : 'FALSE POSITIVE'}\n`,
  )
  return positiveOk && negativeOk ? 0 : 1
}

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

if (process.argv.includes('--self-test')) {
  process.stdout.write('secret-leak gate self-test:\n')
  process.exit(selfTest(repoRoot))
}

const findings = scanForSecrets({
  inputs: trackedFileInputs(repoRoot),
  needles: sensitiveEnvValues(process.env),
})

if (findings.length > 0) {
  process.stderr.write(`secret-leak gate FAILED — ${findings.length} finding(s):\n`)
  for (const finding of findings) process.stderr.write(`  ${formatFinding(finding)}\n`)
  process.exit(1)
}

process.stdout.write('secret-leak gate passed: no credential material in tracked files.\n')
