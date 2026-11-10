#!/usr/bin/env node
/** Repeatable build orchestration. Production switching stays explicit. */
import process from 'node:process'
import { readFile, mkdir, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createSourceProjection, computeSourceDelta, indexPackages, planBuild, syncSource, runScopedBuild, validateSourceManifest } from './release-build.mjs'
import { runCommand, safeFailureMessage, terminationSignal } from './backup-lib.mjs'
import { releaseSwitch } from './release-switch.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHA = /^[0-9a-f]{40}$/
async function json(file) { return JSON.parse(await readFile(file, 'utf8')) }
async function record(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = file + '.partial'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, file)
}
async function dockerJson(args, run) { return JSON.parse((await run('docker', args)).toString('utf8')) }
function lastJson(output) {
  const lines = output.toString('utf8').trim().split('\n')
  return JSON.parse(lines.at(-1))
}

export async function buildRelease(options, dependencies = {}) {
  const run = dependencies.run ?? runCommand
  const projectDir = resolve(options.projectDir ?? process.env.PHYSICSOS_DIR ?? process.cwd())
  const stateRoot = resolve(options.stateRoot ?? join(projectDir, '.physicsos-release'))
  const revision = options.revision ?? (await run('git', ['-C', projectDir, 'rev-parse', 'HEAD'])).toString('utf8').trim()
  if (!SHA.test(revision)) throw new Error('A full committed revision is required')
  const cache = options.builder ? { builder: options.builder } : await json(join(stateRoot, 'builder.json'))
  const builder = cache.builder
  if (!/^physicsos-[A-Za-z0-9_-]+$/.test(builder ?? '')) throw new Error('A prepared PhysicsOS development builder is required')
  const baselinePath = options.baselineManifest ?? join(stateRoot, 'published-source.json')
  const baseline = await json(baselinePath)
  const stamp = new Date().toISOString().replace(/[-:.]/g, '')
  const outputDir = resolve(options.outputDir ?? join(stateRoot, 'builds', revision.slice(0, 12) + '-' + stamp))
  const timings = [], started = Date.now()
  const event = dependencies.progress ?? (value => process.stderr.write(JSON.stringify(value) + '\n'))
  let phase = 'source'
  try {
    options.signal?.throwIfAborted()
    event({ phase, state: 'start' })
    const source = await (dependencies.project ?? createSourceProjection)({ root: projectDir, revision, outputDir: join(outputDir, 'projection') })
    const manifest = await json(source.manifestPath)
    const receipt = await dockerJson(['exec', builder, 'cat', '/app/physicsos-development-builder.json'], run)
    if (receipt.dependencyFingerprint !== manifest.dependencyFingerprint || receipt.completeDevelopmentDependencies !== true || receipt.lockedDependenciesVerified !== true)
      throw new Error('Dependencies changed; prepare the complete locked builder before synchronizing')
    const cachedSource = await dockerJson(['exec', builder, 'cat', '/app/physicsos-source-manifest.json'], run)
    const delta = computeSourceDelta(baseline, manifest)
    const packages = await (dependencies.index ?? indexPackages)(source.root, manifest)
    const plan = planBuild({ packages, ...delta, revision, sourceDigest: manifest.sourceDigest })
    if (plan.fullBuild) throw new Error('This change requires a reviewed full builder/runtime build')
    await record(join(outputDir, 'build-plan.json'), plan)
    timings.push({ phase, seconds: (Date.now() - started) / 1000 })

    options.signal?.throwIfAborted()
    phase = 'sync'; event({ phase, state: 'start' }); let step = Date.now()
    const sync = await (dependencies.sync ?? syncSource)({ builder, projection: join(outputDir, 'projection'), previousManifest: cachedSource, cacheRoot: join(stateRoot, 'cache') })
    timings.push({ phase, seconds: (Date.now() - step) / 1000, files: sync.changed.length, bytes: sync.bytes, deleted: sync.deleted.length })

    options.signal?.throwIfAborted()
    phase = 'compile'; event({ phase, state: 'start', packages: plan.packageScopes.map(pkg => pkg.name), vite: plan.vite }); step = Date.now()
    const evidence = await (dependencies.build ?? runScopedBuild)({ builder, plan, sourceManifest: manifest, cacheRoot: join(stateRoot, 'cache') })
    await record(join(outputDir, 'build-evidence.json'), evidence)
    await record(join(stateRoot, 'compiled-source.json'), manifest)
    timings.push({ phase, seconds: (Date.now() - step) / 1000 })

    options.signal?.throwIfAborted()
    phase = 'export'; event({ phase, state: 'start' }); step = Date.now()
    const production = (await dockerJson(['inspect', 'physicsos-app-1'], run))[0]
    const baseImage = production.Image
    if (!/^sha256:[a-f0-9]{64}$/.test(baseImage)) throw new Error('Cannot identify the production image')
    const runtimeDir = join(outputDir, 'runtime')
    const exporter = lastJson(await run('python3', [join(HERE, 'release-runtime.py'), 'export', '--builder', builder, '--base-image', baseImage, '--revision', revision, '--source-manifest', source.manifestPath, '--plan-file', join(outputDir, 'build-plan.json'), '--output-dir', runtimeDir], { timeoutMs: 300_000 }))
    timings.push({ phase, seconds: (Date.now() - step) / 1000, bytes: exporter.bytesExported, changedFiles: exporter.changedFiles?.length })
    if (options.discardSource === true) {
      const owned = join(outputDir, 'projection', 'source')
      if (resolve(source.root) !== owned || manifest.ownership !== 'physicsos-source-projection/1') throw new Error('Refusing to remove an unowned source projection')
      await rm(owned, { recursive: true })
    }
    if (exporter.noop) {
      const result = { noop: true, requestedRevision: revision, baseImage, sourceDigest: manifest.sourceDigest, runtimeRevision: exporter.runtimeRevision, outputDir, timings }
      await record(join(outputDir, 'release-build.json'), result)
      return result
    }
    options.signal?.throwIfAborted()
    phase = 'image'; event({ phase, state: 'start' }); step = Date.now()
    const imageTag = options.imageTag ?? `physicsos:release-${revision.slice(0, 16)}`
    const image = lastJson(await run('python3', [join(HERE, 'release-runtime.py'), 'build', '--output-dir', runtimeDir, '--image-tag', imageTag], { timeoutMs: 300_000 }))
    timings.push({ phase, seconds: (Date.now() - step) / 1000 })
    const result = { ...image, requestedRevision: revision, sourceDigest: manifest.sourceDigest, codeDigest: exporter.codeDigest, baseImage, outputDir, runtimeDir, sourceManifestFile: source.manifestPath, timings, seconds: (Date.now() - started) / 1000 }
    await record(join(outputDir, 'release-build.json'), result)
    return result
  } catch (error) {
    await record(join(outputDir, 'failure.json'), { phase, revision, error: safeFailureMessage(error), timings }).catch(() => {})
    throw error
  }
}

export async function publishRelease(plan, dependencies = {}) {
  const source = await json(plan.sourceManifestFile)
  validateSourceManifest(source)
  if (source.revision !== plan.revision || source.sourceDigest !== plan.sourceDigest) throw new Error('Publication source differs from verified image')
  const result = await (dependencies.switch ?? releaseSwitch)(plan)
  if (result.deployed !== true) throw new Error('Release did not publish')
  await record(join(resolve(plan.projectDir), '.physicsos-release', 'published-source.json'), source)
  return result
}

async function main() {
  const cancellation = terminationSignal()
  try {
  const [action, ...args] = process.argv.slice(2)
  if (action === 'publish') {
    if (args.length !== 2 || args[0] !== '--plan-file') throw new Error('publish requires --plan-file')
    const info = await lstat(args[1])
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Publication plan must be a private regular file')
    const plan = await json(args[1])
    console.log(JSON.stringify(await publishRelease({ ...plan, signal: cancellation.signal })))
    return
  }
  if (action !== 'build') throw new Error('Use build or publish --plan-file')
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--project-dir': 'projectDir', '--state-root': 'stateRoot', '--revision': 'revision', '--builder': 'builder', '--baseline-manifest': 'baselineManifest', '--output-dir': 'outputDir', '--image-tag': 'imageTag', '--discard-source': 'discardSource' }[args[i]]
    if (!key || args[i + 1] === undefined) throw new Error('Invalid release build argument')
    options[key] = key === 'discardSource' ? args[i + 1] === 'true' : args[i + 1]
  }
  console.log(JSON.stringify(await buildRelease({ ...options, signal: cancellation.signal })))
  } finally { cancellation.dispose() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('release: ' + safeFailureMessage(error)); process.exitCode = 1 })
