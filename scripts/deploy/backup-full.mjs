#!/usr/bin/env node
import process from 'node:process'
import console from 'node:console'
import { chmod, copyFile, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  REQUIRED_SECRETS,
  COUNTS_SQL,
  composeArgs,
  copyOffsite,
  dockerCommand,
  encryptFile,
  jsonOf,
  parseArguments,
  queryPostgres,
  runCommand,
  sessionCount,
  sha256,
  textOf,
  validateBackupKey,
  terminationSignal,
  safeFailureMessage,
} from './backup-lib.mjs'

import { acquireOperationLock } from './operation-lock.mjs'

async function validateOptions(options) {
  for (const key of ['projectDir', 'output', 'keyFile'])
    if (!options[key]) throw new Error(`Missing ${key}`)
  await validateBackupKey(options.keyFile)
  await mkdir(dirname(resolve(options.output)), { recursive: true, mode: 0o700 })
  try {
    await lstat(resolve(options.output))
    throw new Error('Backup output already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** Inventory and file validation are read-only and run before downtime. */
export async function inspectBackupSource(options, dependencies = {}) {
  const projectDir = resolve(options.projectDir)
  const docker = dependencies.docker ?? dockerCommand
  const compose = composeArgs(projectDir)
  const config = jsonOf(await docker([...compose, 'config', '--format', 'json']))
  const running = new Set(
    textOf(await docker([...compose, 'ps', '--status', 'running', '--services'])).split(/\s+/),
  )
  if (!running.has('postgres'))
    throw new Error('PostgreSQL must already be running for a consistent backup')
  const images = {}
  const volumes = {}
  const containers = {}
  for (const service of ['app', 'postgres', 'redis']) {
    const ids = textOf(await docker([...compose, 'ps', '--all', '--quiet', service]))
      .split(/\s+/)
      .filter(Boolean)
    if (ids.length !== 1) throw new Error(`Backup requires exactly one ${service} container`)
    const container = jsonOf(await docker(['inspect', ids[0]]))[0]
    containers[service] = container
    const image = jsonOf(
      await docker(['image', 'inspect', container.Image ?? config.services[service].image]),
    )[0]
    images[service] = {
      id: image.Id,
      digest: image.RepoDigests?.[0] ?? null,
      labels: image.Config?.Labels ?? {},
    }
    if (service !== 'postgres') {
      const destination = service === 'app' ? '/var/lib/physicsos' : '/data'
      const mount = container.Mounts.find((entry) => entry.Destination === destination)
      if (mount?.Type !== 'volume' || !mount.Name)
        throw new Error(`Backup requires a named ${service} data volume`)
      volumes[service] = mount.Name
    }
  }
  for (const name of REQUIRED_SECRETS)
    if (!config.secrets?.[name]?.file) throw new Error(`Required file secret missing: ${name}`)
  for (const [name, secret] of Object.entries(config.secrets ?? {})) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || !secret.file)
      throw new Error('Only named file secrets are supported')
    const info = await lstat(resolve(projectDir, secret.file))
    if (!info.isFile() || info.size === 0) throw new Error(`Invalid file secret: ${name}`)
  }
  return { config, running, images, volumes, containers }
}

/** Capture all stores without owning stop/start: the caller must keep writers quiesced. */
export async function captureQuiescedStores(options, dependencies = {}) {
  if (options.mode === 'paired') return capturePairedStores(options, dependencies)
  await validateOptions(options)
  const projectDir = resolve(options.projectDir)
  const output = resolve(options.output)
  const invokeDocker = dependencies.docker ?? dockerCommand
  const docker = (args, opts = {}) => invokeDocker(args, { ...opts, signal: options.signal })
  const compose = composeArgs(projectDir)
  const source = options.source ?? await inspectBackupSource(options, { docker })
  const { config, images, volumes } = source
  const running = new Set(textOf(await docker([...compose, 'ps', '--status', 'running', '--services'])).split(/\s+/))
  if (running.has('app') || running.has('redis') || !running.has('postgres'))
    throw new Error('Backup capture requires app and Redis quiesced with PostgreSQL running')
  let work
  try {
    work = await mkdtemp(join(projectDir, '.physicsos-backup-work-'))
    const stage = join(work, 'content')
    await mkdir(join(stage, 'secrets'), { recursive: true, mode: 0o700 })
    for (const [name, secret] of Object.entries(config.secrets)) {
      const file = resolve(projectDir, secret.file)
      const info = await lstat(file)
      if (!info.isFile() || info.size === 0) throw new Error(`Invalid file secret: ${name}`)
      await copyFile(file, join(stage, 'secrets', name))
    }
    await docker(
      [
        ...compose,
        'exec',
        '-T',
        'postgres',
        'sh',
        '-c',
        'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-acl --serializable-deferrable',
      ],
      { stdoutFile: join(stage, 'postgres.dump') },
    )
    if ((await lstat(join(stage, 'postgres.dump'))).size === 0)
      throw new Error('PostgreSQL dump was empty')
    await docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--volume',
      `${stage}:/backup:ro`,
      '--entrypoint',
      'pg_restore',
      images.postgres.id,
      '--list',
      '/backup/postgres.dump',
    ])
    const counts = await queryPostgres(docker, compose, COUNTS_SQL)
    for (const service of ['app', 'redis']) {
      await docker(
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--user',
          '0:0',
          '--volume',
          `${volumes[service]}:/source:ro`,
          '--entrypoint',
          'tar',
          images.app.id,
          '-C',
          '/source',
          '-cpf',
          '-',
          '.',
        ],
        { stdoutFile: join(stage, `${service}_data.tar`) },
      )
    }
    const validation = {
      postgresCounts: counts,
      sessions: await sessionCount(docker, images.app.id, volumes.app),
    }
    await writeFile(join(stage, 'compose.json'), JSON.stringify(config), { mode: 0o600 })
    await writeFile(join(stage, 'validation.json'), JSON.stringify(validation), { mode: 0o600 })
    await options.afterCapture?.()
    const paths = [
      'postgres.dump',
      'app_data.tar',
      'redis_data.tar',
      'compose.json',
      'validation.json',
      ...Object.keys(config.secrets)
        .sort()
        .map((name) => `secrets/${name}`),
    ]
    const files = []
    for (const path of paths)
      files.push({
        path,
        size: (await lstat(join(stage, path))).size,
        sha256: await sha256(join(stage, path)),
      })
    const manifest = {
      format: 'physicsos-full-backup/1',
      createdAt: new Date().toISOString(),
      sourceProject: config.name,
      images,
      files,
    }
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    })
    const archive = join(work, 'bundle.tar')
    await runCommand('tar', ['-C', stage, '-cf', archive, 'manifest.json', ...paths], {
      signal: options.signal,
    })
    await encryptFile(archive, output, resolve(options.keyFile), options.signal)
    const offsite = options.offsiteDir
      ? await copyOffsite(output, resolve(options.offsiteDir))
      : undefined
    return {
      artifact: output,
      sha256: await sha256(output),
      ...(offsite ? { offsite } : {}),
      counts: validation.postgresCounts,
      sessions: validation.sessions,
    }

  } finally {
    if (work) await rm(work, { recursive: true, force: true })
  }
}

async function capturePairedStores(options, dependencies) {
  if (!options.projectDir || !options.outputDir || !['gzip', undefined].includes(options.compression)) throw new Error('Paired capture requires a private output directory and gzip volumes')
  const projectDir = resolve(options.projectDir)
  const directory = resolve(options.outputDir)
  if (directory === projectDir) throw new Error('Paired recovery must use its own directory')
  const invokeDocker = dependencies.docker ?? dockerCommand
  const docker = (args, opts = {}) => invokeDocker(args, { ...opts, signal: options.signal })
  const compose = composeArgs(projectDir)
  const source = options.source ?? await inspectBackupSource(options, { docker })
  const running = new Set(textOf(await docker([...compose, 'ps', '--status', 'running', '--services'])).split(/\s+/))
  if (running.has('app') || running.has('redis') || !running.has('postgres')) throw new Error('Paired capture requires app and Redis quiesced with PostgreSQL running')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || (info.mode & 0o077)) throw new Error('Paired recovery directory must be private')
  const manifest = join(directory, 'paired-manifest.json')
  try { await lstat(manifest); throw new Error('Paired recovery already exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const partials = new Set()
  const capture = async (name, args, verify) => {
    const temporary = join(directory, name + '.partial')
    partials.add(temporary)
    await docker(args, { stdoutFile: temporary })
    if (!(await lstat(temporary)).size) throw new Error('Paired capture was empty')
    await verify(temporary)
    await rename(temporary, join(directory, name))
    partials.delete(temporary)
  }
  try {
    await capture('postgres.dump', [...compose, 'exec', '-T', 'postgres', 'sh', '-c',
      'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-acl --serializable-deferrable'], async () => {
      const listing = await docker(['run', '--rm', '--log-driver', 'none', '--network', 'none', '--volume', `${directory}:/backup:ro`, '--entrypoint', 'pg_restore', source.images.postgres.id, '--list', '/backup/postgres.dump.partial'])
      if (!textOf(listing)) throw new Error('PostgreSQL archive validation was empty')
    })
    for (const service of ['app', 'redis']) await capture(`${service}_data.tar.gz`, ['run', '--rm', '--log-driver', 'none', '--network', 'none', '--user', '0:0', '--volume', `${source.volumes[service]}:/source:ro`, '--entrypoint', 'tar', source.images.app.id, '-C', '/source', '-czpf', '-', '.'],
      temporary => runCommand('tar', ['-tzf', temporary], { signal: options.signal }))
    const files = {}
    for (const name of ['postgres.dump', 'app_data.tar.gz', 'redis_data.tar.gz']) files[name] = { size: (await lstat(join(directory, name))).size, sha256: await sha256(join(directory, name)) }
    const settings = {}
    for (const name of ['.env.before', 'compose.before.yml']) {
      try { const file = join(directory, name); settings[name] = { size: (await lstat(file)).size, sha256: await sha256(file) } }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const secretReferences = {}
    await mkdir(join(directory, 'secrets'), { mode: 0o700 })
    for (const [name, secret] of Object.entries(source.config.secrets)) {
      const file = resolve(projectDir, secret.file)
      const recoveryFile = `secrets/${name}`
      const preserved = join(directory, recoveryFile)
      await copyFile(file, preserved, 1)
      await chmod(preserved, 0o600)
      const checksum = await sha256(preserved)
      if (checksum !== await sha256(file)) throw new Error('A mounted secret changed during capture')
      secretReferences[name] = { file, recoveryFile, size: (await lstat(preserved)).size, sha256: checksum }
    }
    const counts = await queryPostgres(docker, compose, COUNTS_SQL)
    const sessions = await sessionCount(docker, source.images.app.id, source.volumes.app)
    const temporary = manifest + '.partial'
    partials.add(temporary)
    await writeFile(temporary, JSON.stringify({ format: 'physicsos-paired-recovery/1', createdAt: new Date().toISOString(), consistent: true, sourceProject: source.config.name, images: source.images, files, settings, secretReferences, counts, sessions }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    options.signal?.throwIfAborted()
    await rename(temporary, manifest)
    partials.delete(temporary)
    return { mode: 'paired', directory, manifest, sha256: await sha256(manifest), files, counts, sessions }
  } finally {
    for (const temporary of partials) await rm(temporary, { force: true })
  }
}

export async function backupFull(options, dependencies = {}) {
  await validateOptions(options)
  const projectDir = resolve(options.projectDir)
  const lock = await acquireOperationLock(projectDir, 'backup')
  const invokeDocker = dependencies.docker ?? dockerCommand
  const docker = (args, opts = {}) => invokeDocker(args, { ...opts, signal: options.signal })
  const compose = composeArgs(projectDir)
  const resume = []
  const resumeOriginal = async () => {
    const errors = []
    while (resume.length) {
      const service = resume.shift()
      try { await invokeDocker([...compose, 'start', service]) }
      catch { errors.push(service) }
    }
    if (errors.length) throw new Error(`Backup service recovery failed: ${errors.join(', ')}`)
  }
  let failure
  let result
  try {
    const source = await inspectBackupSource(options, { docker })
    try {
      for (const service of ['app', 'redis']) {
        if (!source.running.has(service)) continue
        if (service === 'redis') await docker([...compose, 'exec', '-T', 'redis', 'sh', '-c',
          'REDISCLI_AUTH="$(cat /run/secrets/redis_password)" exec redis-cli --no-auth-warning SAVE'])
        // Compensation is registered before Docker can partially stop a service.
        resume.unshift(service)
        await docker([...compose, 'stop', '--timeout', '60', service])
      }
      result = await captureQuiescedStores({ ...options, source, afterCapture: resumeOriginal }, { docker: invokeDocker })
    } catch (error) { failure = error }
    await resumeOriginal()
    if (failure) throw failure
    return result
  } finally {
    await lock.release()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cancellation = terminationSignal()
  try {
    const options = parseArguments(process.argv.slice(2), {
      '--project-dir': 'projectDir',
      '--output': 'output',
      '--key-file': 'keyFile',
      '--offsite-dir': 'offsiteDir',
    })
    const result = await backupFull({ ...options, signal: cancellation.signal })
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(`backup-full: ${safeFailureMessage(error)}`)
    process.exitCode = 1
  } finally {
    cancellation.dispose()
  }
}
