import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  collectHarnessCliSidecar,
  PINNED_NODE_VERSION,
  sidecarResourceDirectory,
} from './sidecar-lib.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const targetDir = sidecarResourceDirectory(repoRoot)
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const allowCrossBuild = args.includes('--allow-cross-build')

function argumentValue(name, fallback) {
  const inline = args.find((argument) => argument.startsWith(`${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const platform = argumentValue('--platform', process.platform)
const architecture = argumentValue('--arch', process.arch)
const nodeVersion = argumentValue('--node-version', PINNED_NODE_VERSION)
const isHostTarget = platform === process.platform && architecture === process.arch
if (!isHostTarget && !allowCrossBuild) {
  throw new Error(
    `Refusing to package ${platform}/${architecture} on ${process.platform}/${process.arch}; ` +
      'run on the target platform or pass --allow-cross-build for syntax-only validation.',
  )
}

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

const result = await collectHarnessCliSidecar({
  repoRoot,
  targetDir,
  platform,
  architecture,
  nodeVersion,
})
if (!isHostTarget) {
  process.stdout.write(
    `sidecar: cross-packaged ${platform}/${architecture}; executable smoke skipped\n`,
  )
  process.exit(0)
}

const smoke = spawnSync(result.nodePath, [result.entryPath, '--version'], {
  cwd: result.runtimeDir,
  encoding: 'utf8',
})
if (smoke.error) throw smoke.error
if (smoke.status !== 0) throw new Error(`sidecar smoke failed: ${smoke.stderr.trim()}`)

const bridgeSmoke = spawnSync(result.nodePath, [result.bridgePath, '--version'], {
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
process.stdout.write(`node: ${result.nodePath} (${result.version})\n`)
process.stdout.write(`version: ${smoke.stdout.trim()}\n`)
process.stdout.write(`bridge version: ${bridgeSmoke.stdout.trim()}\n`)
