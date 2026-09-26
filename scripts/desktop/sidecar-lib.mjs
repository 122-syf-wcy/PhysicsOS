import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  chmodSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const DEPLOY_PACKAGE = '@deepseek-ai/dsh'
export const PINNED_NODE_VERSION = '24.21.0'
const NODE_DISTRIBUTIONS = new Map([
  [
    'darwin-arm64',
    {
      directory: `node-v${PINNED_NODE_VERSION}-darwin-arm64`,
      archive: `node-v${PINNED_NODE_VERSION}-darwin-arm64.tar.gz`,
      sha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
      executable: 'bin/node',
    },
  ],
  [
    'darwin-x64',
    {
      directory: `node-v${PINNED_NODE_VERSION}-darwin-x64`,
      archive: `node-v${PINNED_NODE_VERSION}-darwin-x64.tar.gz`,
      sha256: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
      executable: 'bin/node',
    },
  ],
  [
    'linux-arm64',
    {
      directory: `node-v${PINNED_NODE_VERSION}-linux-arm64`,
      archive: `node-v${PINNED_NODE_VERSION}-linux-arm64.tar.gz`,
      sha256: '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5',
      executable: 'bin/node',
    },
  ],
  [
    'linux-x64',
    {
      directory: `node-v${PINNED_NODE_VERSION}-linux-x64`,
      archive: `node-v${PINNED_NODE_VERSION}-linux-x64.tar.gz`,
      sha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
      executable: 'bin/node',
    },
  ],
  [
    'win32-x64',
    {
      directory: `node-v${PINNED_NODE_VERSION}-win-x64`,
      archive: `node-v${PINNED_NODE_VERSION}-win-x64.zip`,
      sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
      executable: 'node.exe',
    },
  ],
])
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

export function nodeDistribution(platform = process.platform, architecture = process.arch) {
  const distribution = NODE_DISTRIBUTIONS.get(`${platform}-${architecture}`)
  if (distribution === undefined) {
    throw new Error(`No bundled Node runtime is available for ${platform}/${architecture}.`)
  }
  return distribution
}

export function createSidecarManifest(options = {}) {
  const platform = options.platform ?? process.platform
  return {
    version: 1,
    command: platform === 'win32' ? './runtime/node.exe' : './runtime/node',
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

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`Node runtime download failed with HTTP ${String(response.status)}: ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { mode: 0o600 }))
}

function extractArchive({ archivePath, destination, distribution }) {
  const result = spawnSync('tar', ['-xf', archivePath, '-C', destination], {
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Node runtime extraction failed with exit status ${String(result.status)}`)
  }

  const extractedRoot = join(destination, distribution.directory)
  const source = join(extractedRoot, distribution.executable)
  if (!existsSync(source)) {
    throw new Error(`Node executable was not found after extraction: ${source}`)
  }
  return { extractedRoot, source }
}

export async function installNodeRuntime({
  runtimeDir,
  platform = process.platform,
  architecture = process.arch,
  nodeVersion = PINNED_NODE_VERSION,
  cacheDir,
  downloadArchive = downloadFile,
  extractArchive: extract = extractArchive,
  verifyChecksum = true,
}) {
  if (nodeVersion !== PINNED_NODE_VERSION) {
    throw new Error(
      `Unsupported bundled Node version ${nodeVersion}; expected ${PINNED_NODE_VERSION}.`,
    )
  }
  const distribution = nodeDistribution(platform, architecture)
  const resolvedCacheDir = cacheDir ?? join(tmpdir(), 'physicsos-node-runtime-cache')
  mkdirSync(resolvedCacheDir, { recursive: true })
  const archivePath = join(resolvedCacheDir, distribution.archive)
  const expectedHash = distribution.sha256
  let archiveHash = existsSync(archivePath) ? await sha256File(archivePath) : undefined
  if (archiveHash === undefined || (verifyChecksum && archiveHash !== expectedHash)) {
    rmSync(archivePath, { force: true })
    const temporaryArchive = `${archivePath}.${String(process.pid)}.tmp`
    const mirror = (process.env.PHYSICSOS_NODE_DIST_MIRROR ?? 'https://nodejs.org/dist').replace(
      /\/$/,
      '',
    )
    const url = `${mirror}/v${nodeVersion}/${distribution.archive}`
    await downloadArchive(url, temporaryArchive)
    archiveHash = await sha256File(temporaryArchive)
    if (verifyChecksum && archiveHash !== expectedHash) {
      rmSync(temporaryArchive, { force: true })
      throw new Error(`Node runtime checksum mismatch for ${distribution.archive}: ${archiveHash}`)
    }
    renameSync(temporaryArchive, archivePath)
  }

  const extractionRoot = mkdtempSync(join(tmpdir(), 'physicsos-node-runtime-'))
  const nodeName = platform === 'win32' ? 'node.exe' : 'node'
  const nodePath = join(runtimeDir, nodeName)
  try {
    const extracted = extract({ archivePath, destination: extractionRoot, distribution })
    cpSync(extracted.source, nodePath)
    if (platform !== 'win32') chmodSync(nodePath, 0o755)
    const license = join(extracted.extractedRoot, 'LICENSE')
    if (existsSync(license)) {
      cpSync(license, join(runtimeDir, platform === 'win32' ? 'NODE-LICENSE.txt' : 'NODE-LICENSE'))
    }
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true })
  }

  const provenance = {
    version: nodeVersion,
    platform,
    architecture,
    archive: distribution.archive,
    sha256: expectedHash,
  }
  writeFileSync(join(runtimeDir, 'node-runtime.json'), `${JSON.stringify(provenance, null, 2)}\n`)
  return { ...provenance, nodePath }
}

export async function collectHarnessCliSidecar({
  repoRoot,
  targetDir,
  run = spawnSync,
  pnpmCommand = 'pnpm',
  platform = process.platform,
  architecture = process.arch,
  nodeVersion = PINNED_NODE_VERSION,
  cacheDir,
  downloadArchive,
  extractArchive,
  verifyChecksum = true,
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
  const nodeRuntime = await installNodeRuntime({
    runtimeDir,
    platform,
    architecture,
    nodeVersion,
    cacheDir: cacheDir ?? join(repoRoot, 'apps/desktop/.cache/node-runtime'),
    verifyChecksum,
    ...(downloadArchive === undefined ? {} : { downloadArchive }),
    ...(extractArchive === undefined ? {} : { extractArchive }),
  })
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
  const manifest = createSidecarManifest({ platform })
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  assertInside(targetDir, runtimeDir)
  assertInside(targetDir, manifestPath)
  assertInside(targetDir, nodeRuntime.nodePath)
  return {
    manifestPath,
    entryPath,
    bridgePath,
    nodePath: nodeRuntime.nodePath,
    runtimeDir,
    ...nodeRuntime,
    ...copied,
  }
}

export function sidecarResourceDirectory(repoRoot) {
  return resolve(repoRoot, 'apps/desktop/src-tauri/resources/agent-sidecar')
}
