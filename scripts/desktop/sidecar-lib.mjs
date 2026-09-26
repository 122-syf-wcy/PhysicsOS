import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const DEPLOY_PACKAGE = '@deepseek-ai/dsh'
const EXCLUDED_COPY_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'node_modules',
  'src',
  'test',
  'tests',
])

function assertInside(root, candidate) {
  const path = relative(root, candidate)
  if (path === '' || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error(`sidecar path escapes its resource directory: ${candidate}`)
  }
}

export function createSidecarManifest() {
  return {
    version: 1,
    command: 'node',
    args: ['./runtime/lib/bin.js'],
    sidecarArgs: ['./runtime/sidecar/bridge.mjs'],
    workingDirectory: './runtime',
  }
}

function packageDestination(runtimeDir, packageName) {
  return join(runtimeDir, 'node_modules', ...packageName.split('/'))
}

function copyPackage(source, runtimeDir, packageName) {
  const destination = packageDestination(runtimeDir, packageName)
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (path) => {
      const parts = path.split(/[\\/]/)
      return !parts.some((part) => EXCLUDED_COPY_DIRECTORIES.has(part))
    },
  })
}

function packageDirectories(root, depth = 0) {
  if (!existsSync(root) || depth > 6) return []
  const packages = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || EXCLUDED_COPY_DIRECTORIES.has(entry.name)) continue
    const directory = join(root, entry.name)
    if (existsSync(join(directory, 'package.json'))) {
      packages.push(directory)
      continue
    }
    packages.push(...packageDirectories(directory, depth + 1))
  }
  return packages
}

function copyPackageTree(root, runtimeDir, predicate) {
  const copied = []
  for (const source of packageDirectories(root)) {
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string' || !predicate(manifest.name)) continue
    copyPackage(source, runtimeDir, manifest.name)
    copied.push(manifest.name)
  }
  return copied
}

function copyRuntimePackages(vendorRoot, runtimeDir) {
  const copiedVendor = copyPackageTree(join(vendorRoot, 'vendor'), runtimeDir, (name) =>
    name.startsWith('@deepseek-ai/'),
  )
  const copiedWorkspace = copyPackageTree(join(vendorRoot, 'packages'), runtimeDir, (name) =>
    name.startsWith('@deepseek-ai/'),
  )
  return { copiedVendor, copiedWorkspace }
}

export function collectHarnessCliSidecar({
  repoRoot,
  targetDir,
  run = spawnSync,
  pnpmCommand = 'pnpm',
}) {
  const vendorRoot = join(repoRoot, 'vendor/deepseek-harness')
  const runtimeDir = join(targetDir, 'runtime')
  rmSync(runtimeDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })

  const result = run(
    pnpmCommand,
    [
      '-C',
      vendorRoot,
      '--filter',
      DEPLOY_PACKAGE,
      'deploy',
      '--prod',
      '--legacy',
      '--ignore-scripts',
      '--node-linker=hoisted',
      runtimeDir,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`pnpm deploy failed with exit status ${String(result.status)}`)
  }

  const copied = copyRuntimePackages(vendorRoot, runtimeDir)
  const bridgeSource = join(repoRoot, 'apps/desktop/sidecar/bridge.mjs')
  if (!existsSync(bridgeSource)) {
    throw new Error(`desktop sidecar bridge entry was not found: ${bridgeSource}`)
  }
  const bridgeDirectory = join(runtimeDir, 'sidecar')
  mkdirSync(bridgeDirectory, { recursive: true })
  cpSync(bridgeSource, join(bridgeDirectory, 'bridge.mjs'))
  const entryPath = join(runtimeDir, 'lib/bin.js')
  if (!existsSync(entryPath)) {
    throw new Error(`Harness CLI sidecar entry was not produced: ${entryPath}`)
  }
  const bridgePath = join(bridgeDirectory, 'bridge.mjs')

  const manifestPath = join(targetDir, 'sidecar.json')
  const manifest = createSidecarManifest()
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  assertInside(targetDir, runtimeDir)
  assertInside(targetDir, manifestPath)
  return { manifestPath, entryPath, bridgePath, runtimeDir, ...copied }
}

export function sidecarResourceDirectory(repoRoot) {
  return resolve(repoRoot, 'apps/desktop/src-tauri/resources/agent-sidecar')
}
