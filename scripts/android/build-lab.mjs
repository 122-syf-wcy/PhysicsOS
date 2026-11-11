#!/usr/bin/env node
import { buildLab } from '../../apps/mobile-lab/scripts/build-support.mjs'

try {
  if (process.argv.slice(2).some(argument => argument !== '--test')) throw new Error('Usage: node scripts/android/build-lab.mjs [--test]')
  const result = await buildLab({ test: process.argv.includes('--test') })
  console.log(`Built offline lab: ${result.catalog.experiments.length} shared experiments, ${result.library.questions.length} questions; ${result.files.length} files in ${result.outdir}`)
  if (process.argv.includes('--test')) console.warn('TEST build: localhost origin and browser test hooks are enabled. Do not package this output in an APK; rebuild without --test.')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
