import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { collectHarnessCliSidecar, sidecarResourceDirectory } from './sidecar-lib.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const targetDir = sidecarResourceDirectory(repoRoot)
const skipBuild = process.argv.includes('--skip-build')

if (!skipBuild) {
  const build = spawnSync('pnpm', ['-C', 'vendor/deepseek-harness', 'run', 'build:lib:host'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      pnpm_config_verify_deps_before_run: 'false',
    },
    stdio: 'inherit',
  })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const result = collectHarnessCliSidecar({ repoRoot, targetDir })
const smoke = spawnSync(process.execPath, [result.entryPath, '--version'], {
  cwd: result.runtimeDir,
  encoding: 'utf8',
})
if (smoke.error) throw smoke.error
if (smoke.status !== 0) {
  throw new Error(`sidecar smoke failed: ${smoke.stderr.trim()}`)
}
const bridgeSmoke = spawnSync(process.execPath, [result.bridgePath, '--version'], {
  cwd: result.runtimeDir,
  encoding: 'utf8',
})
if (bridgeSmoke.error) throw bridgeSmoke.error
if (bridgeSmoke.status !== 0) {
  throw new Error(`sidecar bridge smoke failed: ${bridgeSmoke.stderr.trim()}`)
}
if (!existsSync(result.manifestPath)) throw new Error('sidecar manifest was not written')

process.stdout.write(`sidecar: ${result.entryPath}\n`)
process.stdout.write(`bridge: ${result.bridgePath}\n`)
process.stdout.write(`manifest: ${result.manifestPath}\n`)
process.stdout.write(`version: ${smoke.stdout.trim()}\n`)
process.stdout.write(`bridge version: ${bridgeSmoke.stdout.trim()}\n`)
