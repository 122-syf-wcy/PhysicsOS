#!/usr/bin/env node
/** Build a frozen full release without adopting or modifying a production baseline. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createSourceProjection, prepareBuilder, requireDisk, verifySourceProjection } from './release-build.mjs'
import { runCommand, safeFailureMessage, terminationSignal } from './backup-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GiB = 1024 ** 3
const json = async file => JSON.parse(await readFile(file, 'utf8'))
async function record(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file + '.partial', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(file + '.partial', file)
}
const lastJson = value => JSON.parse(value.toString('utf8').trim().split('\n').at(-1))

export function fullReleaseIdentity({ revision, nodeImage, estimatedBytes = 12 * GiB }) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '') || !/^sha256:[a-f0-9]{64}$/.test(nodeImage ?? ''))
    throw new Error('A committed revision and immutable locally available Node image are required')
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 512 * 1024 ** 2)
    throw new Error('A measured full-build disk budget of at least 512 MiB is required')
  return { revision, nodeImage, estimatedBytes }
}

export async function buildFullRelease(options, dependencies = {}) {
  const run = dependencies.run ?? runCommand
  const projectDir = resolve(options.projectDir ?? process.env.PHYSICSOS_DIR ?? process.cwd())
  const revision = options.revision ?? (await run('git', ['-C', projectDir, 'rev-parse', 'HEAD'])).toString('utf8').trim()
  const identity = fullReleaseIdentity({ ...options, revision })
  const stateRoot = resolve(options.stateRoot ?? join(projectDir, '.physicsos-release'))
  const outputDir = resolve(options.outputDir ?? join(stateRoot, 'full-builds', revision.slice(0, 12) + '-' + Date.now()))
  const cacheRoot = join(stateRoot, 'cache')
  const builder = options.builder ?? 'physicsos-full-builder-' + revision.slice(0, 12)
  if (!/^physicsos-[A-Za-z0-9_-]+$/.test(builder) || builder === 'physicsos-app-1') throw new Error('Dedicated full builder name required')
  const imageTag = options.imageTag ?? 'physicsos:full-release-' + revision.slice(0, 16)
  if (!/^physicsos[a-z0-9_.-]*:[A-Za-z0-9_.-]+$/.test(imageTag)) throw new Error('Owned PhysicsOS image tag required')
  const event = dependencies.progress ?? (value => process.stderr.write(JSON.stringify(value) + '\n'))
  const timings = [], started = Date.now()
  let phase = 'admission'
  const command = async (name, args) => run(name, args, { timeoutMs: 7_200_000, signal: options.signal })
  const dockerJson = async args => JSON.parse((await command('docker', args)).toString('utf8'))
  try {
    options.signal?.throwIfAborted()
    event({ phase, state: 'start' })
    // Cover projection, development dependency layer, compiled output, runtime
    // COPY/unpack and the metadata layer together. Never reclaim unknown data.
    await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
    await requireDisk({ path: stateRoot, bytes: identity.estimatedBytes })
    if ((await command('docker', ['image', 'inspect', '--format', '{{.Id}}', identity.nodeImage])).toString('utf8').trim() !== identity.nodeImage)
      throw new Error('Pinned Node image is not available locally')
    const existing = (await command('docker', ['ps', '-aq', '--filter', 'name=^/' + builder + '$'])).toString('utf8').trim()
    if (existing) throw new Error('Requested development builder already exists')

    phase = 'source'; event({ phase, state: 'start' })
    const projection = await (dependencies.project ?? createSourceProjection)({ root: projectDir, revision, outputDir: join(outputDir, 'projection') })
    const source = await json(projection.manifestPath)
    timings.push({ phase, seconds: (Date.now() - started) / 1000 })

    phase = 'builder'; event({ phase, state: 'start' }); let step = Date.now()
    const receipt = await (dependencies.prepare ?? prepareBuilder)({ projection: join(outputDir, 'projection'), builder, baseImage: identity.nodeImage, cacheRoot, estimatedBytes: identity.estimatedBytes })
    await record(join(outputDir, 'development-builder.json'), receipt)
    timings.push({ phase, seconds: (Date.now() - step) / 1000 })

    options.signal?.throwIfAborted()
    phase = 'runtime'; event({ phase, state: 'start' }); step = Date.now()
    await verifySourceProjection(projection.root, source, { exact: true })
    const nodeTag = 'physicsos:development-node-base-' + identity.nodeImage.slice(7, 31)
    const rawTag = 'physicsos:full-input-' + revision.slice(0, 16)
    if ((await command('docker', ['image', 'inspect', '--format', '{{.Id}}', nodeTag])).toString('utf8').trim() !== identity.nodeImage)
      throw new Error('Pinned Node build reference changed')
    await command('docker', ['build', '--target', 'runtime', '--pull=false', '--build-arg', 'NODE_IMAGE=' + nodeTag,
      '--label', 'physicsos.role=full-runtime-input', '--label', 'physicsos.full-build.revision=' + revision,
      '--label', 'physicsos.full-build.source-digest=' + source.sourceDigest,
      '--label', 'physicsos.full-build.dependency-fingerprint=' + source.dependencyFingerprint,
      '--tag', rawTag, projection.root])
    await verifySourceProjection(projection.root, source, { exact: true })
    const image = await dockerJson(['image', 'inspect', '--format', '{{json .Id}}', rawTag])
    const built = { schemaVersion: 1, format: 'physicsos-full-build/1', revision, sourceDigest: source.sourceDigest,
      dependencyFingerprint: source.dependencyFingerprint, nodeImage: identity.nodeImage, builder, builderImage: receipt.builderImage,
      runtimeImage: image, dockerfileSha256: createHash('sha256').update(await readFile(join(projection.root, 'Dockerfile'))).digest('hex'),
      successfulStages: ['builder', 'runtime'], sourceProjectionVerified: true, estimatedBytes: identity.estimatedBytes }
    await record(join(outputDir, 'full-build-record.json'), built)
    timings.push({ phase, seconds: (Date.now() - step) / 1000 })

    options.signal?.throwIfAborted()
    phase = 'provenance'; event({ phase, state: 'start' }); step = Date.now()
    const runtimeDir = join(outputDir, 'runtime')
    await command('python3', [join(HERE, 'release-runtime.py'), 'full-export', '--builder', builder, '--image', image,
      '--source-manifest', projection.manifestPath, '--record-file', join(outputDir, 'full-build-record.json'), '--output-dir', runtimeDir])
    const result = lastJson(await command('python3', [join(HERE, 'release-runtime.py'), 'full-build', '--output-dir', runtimeDir, '--image-tag', imageTag]))
    timings.push({ phase, seconds: (Date.now() - step) / 1000 })
    const published = { ...result, requestedRevision: revision, sourceManifestFile: projection.manifestPath,
      outputDir, runtimeDir, fullBuild: true, builder, timings, seconds: (Date.now() - started) / 1000 }
    await record(join(outputDir, 'release-build.json'), published)
    return published
  } catch (error) {
    await record(join(outputDir, 'failure.json'), { phase, revision, error: safeFailureMessage(error), timings }).catch(() => {})
    throw error
  }
}

async function main() {
  const cancellation = terminationSignal()
  try {
    const [action, ...args] = process.argv.slice(2)
    if (action !== 'build') throw new Error('Use build with --revision and --node-image')
    const options = {}
    for (let i = 0; i < args.length; i += 2) {
      const key = { '--revision': 'revision', '--node-image': 'nodeImage', '--project-dir': 'projectDir', '--state-root': 'stateRoot',
        '--output-dir': 'outputDir', '--builder': 'builder', '--image-tag': 'imageTag', '--estimated-bytes': 'estimatedBytes' }[args[i]]
      if (!key || args[i + 1] === undefined) throw new Error('Invalid full-release argument')
      options[key] = key === 'estimatedBytes' ? Number(args[i + 1]) : args[i + 1]
    }
    console.log(JSON.stringify(await buildFullRelease({ ...options, signal: cancellation.signal })))
  } finally { cancellation.dispose() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('release-full: ' + safeFailureMessage(error)); process.exitCode = 1 })
