#!/usr/bin/env node
import process from 'node:process'
import console from 'node:console'
import { copyFile, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

export async function backupFull(options, dependencies = {}) {
  for (const key of ['projectDir', 'output', 'keyFile'])
    if (!options[key]) throw new Error(`Missing ${key}`)
  await validateBackupKey(options.keyFile)
  const projectDir = resolve(options.projectDir)
  const output = resolve(options.output)
  const invokeDocker = dependencies.docker ?? dockerCommand
  const docker = (args, opts = {}) => invokeDocker(args, { ...opts, signal: options.signal })
  const compose = composeArgs(projectDir)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  try {
    await lstat(output)
    throw new Error('Backup output already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const lock = join(projectDir, '.physicsos-backup-lock')
  await mkdir(lock, { mode: 0o700 })
  let work
  try {
    work = await mkdtemp(join(projectDir, '.physicsos-backup-work-'))
    const stage = join(work, 'content')
    await mkdir(join(stage, 'secrets'), { recursive: true, mode: 0o700 })
    const config = jsonOf(await docker([...compose, 'config', '--format', 'json']))
    const running = new Set(
      textOf(await docker([...compose, 'ps', '--status', 'running', '--services'])).split(/\s+/),
    )
    if (!running.has('postgres'))
      throw new Error('PostgreSQL must already be running for a consistent backup')
    const images = {}
    const volumes = {}
    for (const service of ['app', 'postgres', 'redis']) {
      const ids = textOf(await docker([...compose, 'ps', '--all', '--quiet', service]))
        .split(/\s+/)
        .filter(Boolean)
      if (ids.length !== 1) throw new Error(`Backup requires exactly one ${service} container`)
      const container = jsonOf(await docker(['inspect', ids[0]]))[0]
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
    }
    const resume = []
    let failure
    let validation
    const restartErrors = []
    try {
      // Register compensation before stop: Docker can stop a service and still fail.
      for (const service of ['app', 'redis']) {
        if (!running.has(service)) continue
        if (service === 'redis')
          await docker([
            ...compose,
            'exec',
            '-T',
            'redis',
            'sh',
            '-c',
            'REDISCLI_AUTH="$(cat /run/secrets/redis_password)" exec redis-cli --no-auth-warning SAVE',
          ])
        resume.unshift(service)
        await docker([...compose, 'stop', '--timeout', '60', service])
      }
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
      validation = {
        postgresCounts: counts,
        sessions: await sessionCount(docker, images.app.id, volumes.app),
      }
      await writeFile(join(stage, 'compose.json'), JSON.stringify(config), { mode: 0o600 })
      await writeFile(join(stage, 'validation.json'), JSON.stringify(validation), { mode: 0o600 })
    } catch (error) {
      failure = error
    } finally {
      for (const service of resume) {
        try {
          await invokeDocker([...compose, 'start', service])
        } catch {
          restartErrors.push(service)
        }
      }
    }
    if (restartErrors.length)
      throw new Error(
        `Backup service recovery failed: ${restartErrors.join(', ')}${failure ? '; capture also failed' : ''}`,
      )
    if (failure) throw failure
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
    await rm(lock, { recursive: true, force: true })
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
