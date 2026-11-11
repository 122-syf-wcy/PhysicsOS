#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { app, cache, catalogs, bundleNode, buildLab, require } from './build-support.mjs'

const execute = (args, description) => new Promise((resolve, reject) => {
  console.log(`\n${description}`)
  const child = spawn(process.execPath, args, { cwd: app, stdio: 'inherit' })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${description} failed (${code}).`)))
})
try {
  const options = new Set(process.argv.slice(2))
  if ([...options].some(option => !['--e2e', '--unit'].includes(option))) throw new Error('Usage: node apps/mobile-lab/scripts/test.mjs [--e2e|--unit]')
  await execute([require.resolve('typescript/bin/tsc'), '--noEmit', '-p', path.join(app, '.cache/shared-tsconfig.json')], 'Typecheck standalone module + readonly shared interfaces')
  const { catalog } = await catalogs()
  // Build tests without importing them here: node --test controls discovery and honest exit codes.
  const outfile = path.join(cache, 'runtime-tests.mjs')
  const { esbuild, sourcePlugin } = await import('./build-support.mjs')
  await esbuild.build({ entryPoints: [path.join(app, 'tests/runtime.test.ts')], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node24',
    plugins: [sourcePlugin({ catalog })], define: { __LAB_TEST__: 'true' }, logLevel: 'warning' })
  await execute(['--test', '--test-reporter=spec', outfile], 'Run every template against shared engine and recovery/protocol/transport tests')
  if (!options.has('--unit')) {
    const result = await buildLab({ test: true, outdir: path.join(app, '.cache/browser/lab') })
    const { browserRegression } = await import('./browser-regression.mjs')
    await browserRegression(result)
  }
  console.log('\nMobile lab tests passed. Browser timings are diagnostics, not Android device performance acceptance.')
} catch (error) { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1 }
