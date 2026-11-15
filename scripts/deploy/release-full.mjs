#!/usr/bin/env node
/** Build a frozen full release without adopting or modifying a production baseline. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createSourceProjection, prepareBuilder, requireDisk, validateSourceManifest, verifySourceProjection } from './release-build.mjs'
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

/** Reuse the frozen runtime stage literally; only its builder provider changes. */
export function seedRuntimeDockerfile(source) {
  const marker = /^FROM \$\{NODE_IMAGE\} AS runtime\r?$/m
  const matches = [...source.matchAll(new RegExp(marker.source, 'gm'))]
  if (matches.length !== 1) throw new Error('A single reviewed Node runtime stage is required')
  const runtimeStage = source.slice(matches[0].index)
  return { runtimeStage, dockerfile: 'ARG NODE_IMAGE\nARG BUILDER_IMAGE\nFROM ${BUILDER_IMAGE} AS builder\n\n' + runtimeStage }
}

export function validateFullSeedAudit(receipt) {
  if (receipt?.origin !== 'audited-runtime-seed' || receipt.audited !== true ||
    receipt.offlineRootLockVerified !== true || receipt.offlineHarnessLockVerified !== true ||
    !Array.isArray(receipt.offlineEvidence) || receipt.offlineEvidence.length < 2 ||
    receipt.offlineEvidence.some(step => step.exitCode !== 0 || typeof step.command !== 'string' || !step.command.includes('--offline') || !step.command.includes('--frozen-lockfile')) ||
    !['/app', '/app/vendor/deepseek-harness'].every(cwd => receipt.offlineEvidence.some(step => step.cwd === cwd)))
    throw new Error('Seed requires successful real offline frozen-lock evidence for both workspace roots')
  return receipt
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
  const runtimeTransport = options.runtimeTransport ?? 'copy'
  if (!['copy', 'verified-overlay'].includes(runtimeTransport) || runtimeTransport === 'verified-overlay' && !options.seedReceipt)
    throw new Error('Verified overlay transport requires an explicit audited seed receipt')
  const imageTag = options.imageTag ?? 'physicsos:full-release-' + revision.slice(0, 16)
  if (!/^physicsos[a-z0-9_.-]*:[A-Za-z0-9_.-]+$/.test(imageTag)) throw new Error('Owned PhysicsOS image tag required')
  const event = dependencies.progress ?? (value => process.stderr.write(JSON.stringify(value) + '\n'))
  const timings = [], started = Date.now()
  let phase = 'admission'
  const command = async (name, args, extras = {}) => run(name, args, { timeoutMs: 7_200_000, ...extras, signal: options.signal })
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
    if (existing && !options.seedReceipt) throw new Error('Requested development builder already exists')
    if (!existing && options.seedReceipt) throw new Error('Audited seed builder does not exist')
    if (Boolean(options.seedReceipt) !== Boolean(options.abi)) throw new Error('Seed receipt and verified ABI file must be supplied together')
    if (options.seedReceipt) {
      const mounts = await dockerJson(['inspect', '--format', '{{json .Mounts}}', builder])
      if (mounts.some(mount => mount.Destination === '/app' || mount.Destination.startsWith('/app/')))
        throw new Error('A committed seed snapshot cannot include application bind/volume mounts')
    }

    phase = 'source'; event({ phase, state: 'start' })
    const projection = options.projection
      ? { root: join(resolve(options.projection), 'source'), manifestPath: join(resolve(options.projection), 'source-manifest.json') }
      : await (dependencies.project ?? createSourceProjection)({ root: projectDir, revision, outputDir: join(outputDir, 'projection') })
    const source = await json(projection.manifestPath)
    validateSourceManifest(source)
    if (source.revision !== revision) throw new Error('Existing projection differs from requested revision')
    await verifySourceProjection(projection.root, source, { exact: true })
    timings.push({ phase, seconds: (Date.now() - started) / 1000 })

    phase = 'builder'; event({ phase, state: 'start' }); let step = Date.now()
    const seedReceipt = options.seedReceipt ? validateFullSeedAudit(await json(options.seedReceipt)) : undefined
    const expectedAbi = options.abi ? await json(options.abi) : undefined
    if (seedReceipt && seedReceipt.baseImage !== identity.nodeImage) throw new Error('Audited Node base differs from the requested immutable base')
    let receipt = await (dependencies.prepare ?? prepareBuilder)({ projection: dirname(projection.manifestPath), builder,
      baseImage: identity.nodeImage, cacheRoot, estimatedBytes: identity.estimatedBytes, seedReceipt, expectedAbi })
    if (seedReceipt) {
      const evidence = []
      const toolPath = '/app/vendor/deepseek-harness/node_modules/pnpm/bin/pnpm.mjs'
      // Direct pnpm plus a process-local PATH serves nested build scripts. The
      // verified locked closure is reused without package-manager downloads.
      // pnpm 11 uses pmOnFail; the earlier managePackageManagerVersions setting
      // was removed and does not disable nested package-manager bootstrapping.
      for (const [cwd, script] of [['/app/vendor/deepseek-harness', 'build:lib'], ['/app', 'build:web']]) {
        options.signal?.throwIfAborted()
        const args = ['exec', '-u', '0', '-w', cwd, '-e', 'DSH_CLIENT_TITLE=PhysicsOS',
          '-e', 'pnpm_config_pm_on_fail=ignore',
          '-e', 'PATH=/app/vendor/deepseek-harness/node_modules/.bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          builder, 'node', toolPath, 'run', script]
        const began = Date.now()
        await command('docker', args)
        evidence.push({ command: 'pnpm run ' + script, cwd, exitCode: 0, seconds: (Date.now() - began) / 1000 })
      }
      receipt = { ...receipt, builderImage: await dockerJson(['inspect', '--format', '{{json .Image}}', builder]),
        fullBuildVerified: true, buildTarget: 'audited-seed-full-build', fullBuildEvidence: evidence }
      const marker = join(outputDir, 'development-builder.json')
      await record(marker, receipt)
      await command('docker', ['cp', marker, builder + ':/app/physicsos-development-builder.json'])
    } else await record(join(outputDir, 'development-builder.json'), receipt)
    timings.push({ phase, seconds: (Date.now() - step) / 1000 })

    options.signal?.throwIfAborted()
    phase = 'runtime'; event({ phase, state: 'start' }); step = Date.now()
    await verifySourceProjection(projection.root, source, { exact: true })
    const nodeTag = 'physicsos:development-node-base-' + identity.nodeImage.slice(7, 31)
    const rawTag = 'physicsos:full-input-' + revision.slice(0, 16)
    await command('docker', ['tag', identity.nodeImage, nodeTag])
    if ((await command('docker', ['image', 'inspect', '--format', '{{.Id}}', nodeTag])).toString('utf8').trim() !== identity.nodeImage)
      throw new Error('Pinned Node build reference changed')
    const originalDockerfile = await readFile(join(projection.root, 'Dockerfile'), 'utf8')
    let builderSnapshot, runtimeStageSha256, runtimeDockerfileSha256, transportProof, image
    if (runtimeTransport === 'verified-overlay') {
      const config = lastJson(await command('python3', [join(HERE, 'release-runtime.py'), 'transport-config',
        '--source-manifest', projection.manifestPath, '--node-image', identity.nodeImage,
        '--image-tag', 'physicsos:runtime-config-' + revision.slice(0, 16), '--output-dir', join(outputDir, 'config-only')]))
      transportProof = lastJson(await command('python3', [join(HERE, 'release-runtime.py'), 'verified-transport',
        '--builder', builder, '--base-image', seedReceipt.seedImage, '--config-image', config.image,
        '--source-manifest', projection.manifestPath, '--image-tag', rawTag, '--output-dir', join(outputDir, 'transport')]))
      image = transportProof.image
      runtimeStageSha256 = transportProof.runtimeStageSha256
      runtimeDockerfileSha256 = transportProof.runtimeDockerfileSha256
    } else {
      const runtimeArgs = ['build', '--target', 'runtime', '--pull=false', '--build-arg', 'NODE_IMAGE=' + nodeTag]
      if (seedReceipt) {
        // The commit provides files only. Final runtime configuration is taken
        // verbatim from the reviewed Dockerfile, never from the test container.
        builderSnapshot = (await command('docker', ['commit', builder])).toString('utf8').trim()
        if (!/^sha256:[a-f0-9]{64}$/.test(builderSnapshot)) throw new Error('Immutable builder snapshot is required')
        const snapshotTag = 'physicsos:full-builder-snapshot-' + revision.slice(0, 16)
        await command('docker', ['tag', builderSnapshot, snapshotTag])
        const derived = seedRuntimeDockerfile(originalDockerfile)
        runtimeStageSha256 = createHash('sha256').update(derived.runtimeStage).digest('hex')
        runtimeDockerfileSha256 = createHash('sha256').update(derived.dockerfile).digest('hex')
        const file = join(outputDir, 'Dockerfile.seed-runtime')
        await writeFile(file, derived.dockerfile, { mode: 0o600 })
        runtimeArgs.push('--file', file, '--build-arg', 'BUILDER_IMAGE=' + snapshotTag)
      }
      runtimeArgs.push('--label', 'physicsos.role=full-runtime-input', '--label', 'physicsos.full-build.revision=' + revision,
        '--label', 'physicsos.full-build.source-digest=' + source.sourceDigest,
        '--label', 'physicsos.full-build.dependency-fingerprint=' + source.dependencyFingerprint,
        '--tag', rawTag, projection.root)
      await command('docker', runtimeArgs)
      await verifySourceProjection(projection.root, source, { exact: true })
      image = await dockerJson(['image', 'inspect', '--format', '{{json .Id}}', rawTag])
    }
    await verifySourceProjection(projection.root, source, { exact: true })
    const built = { schemaVersion: 1, format: 'physicsos-full-build/1', revision, sourceDigest: source.sourceDigest,
      dependencyFingerprint: source.dependencyFingerprint, nodeImage: identity.nodeImage, builder, builderImage: receipt.builderImage,
      runtimeImage: image, dockerfileSha256: createHash('sha256').update(originalDockerfile).digest('hex'),
      ...(seedReceipt ? { ...(transportProof ?? { builderSnapshot }), runtimeTransport, runtimeStageSha256, runtimeDockerfileSha256, seedReceiptOrigin: seedReceipt.origin } : {}),
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
        '--output-dir': 'outputDir', '--builder': 'builder', '--image-tag': 'imageTag', '--estimated-bytes': 'estimatedBytes',
        '--seed-receipt': 'seedReceipt', '--abi': 'abi', '--projection': 'projection', '--runtime-transport': 'runtimeTransport' }[args[i]]
      if (!key || args[i + 1] === undefined) throw new Error('Invalid full-release argument')
      options[key] = key === 'estimatedBytes' ? Number(args[i + 1]) : args[i + 1]
    }
    console.log(JSON.stringify(await buildFullRelease({ ...options, signal: cancellation.signal })))
  } finally { cancellation.dispose() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('release-full: ' + safeFailureMessage(error)); process.exitCode = 1 })
