#!/usr/bin/env node
import process from 'node:process'
import console from 'node:console'
import { setTimeout } from 'node:timers'
import assert from 'node:assert/strict'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL, URL } from 'node:url'
import {
  COUNTS_SQL,
  RESTORE_READINESS_SCRIPT,
  composeArgs,
  decryptFile,
  dockerCommand,
  modelKeyTable,
  parseArguments,
  queryPostgres,
  runCommand,
  sessionCount,
  textOf,
  validateModelKeys,
  verifyManifest,
  terminationSignal,
  safeFailureMessage,
} from './backup-lib.mjs'

const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))
const ENVIRONMENT_KEYS = [
  'PHYSICSOS_STORAGE_SCHEMA',
  'PHYSICSOS_PANDOC',
  'PHYSICSOS_SOFFICE',
  'PHYSICSOS_MODEL_POOL_PORT',
]

export function isolatedCompose(config, manifest, targetDir, project, port) {
  const postgresEnvironment = config.services?.postgres?.environment ?? {}
  const user = postgresEnvironment.POSTGRES_USER ?? 'physicsos'
  const database = postgresEnvironment.POSTGRES_DB ?? 'physicsos'
  if (![user, database].every((name) => /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)))
    throw new Error('Unsupported PostgreSQL user/database name')
  const images = {}
  for (const name of ['app', 'postgres', 'redis']) {
    const entry = manifest.images?.[name]
    if (typeof entry?.id !== 'string' || !entry.id.startsWith('sha256:'))
      throw new Error('Missing pinned backup image identity')
    images[name] = entry.digest || entry.id
  }
  const secrets = Object.fromEntries(
    Object.keys(config.secrets).map((name) => [name, { file: join(targetDir, 'secrets', name) }]),
  )
  const secretMount = (name) => ({
    source: name,
    target: name,
    uid: '999',
    gid: '999',
    mode: 0o400,
  })
  const appEnvironment = Object.fromEntries(
    ENVIRONMENT_KEYS.filter((key) => config.services.app.environment?.[key] !== undefined).map(
      (key) => [key, config.services.app.environment[key]],
    ),
  )
  Object.assign(appEnvironment, {
    NODE_ENV: 'production',
    DSH_HOME: '/var/lib/physicsos',
    PHYSICSOS_SESSIONS_ROOT: '/var/lib/physicsos/sessions',
    PHYSICSOS_STORAGE_BACKEND: 'postgres',
    PHYSICSOS_SHARED_STATE_BACKEND: 'redis',
    PHYSICSOS_DATABASE_SSL: 'false',
    DATABASE_URL_FILE: '/run/secrets/database_url',
    REDIS_URL_FILE: '/run/secrets/redis_url',
    PHYSICSOS_MODEL_POOL_SECRET_FILE: '/run/secrets/model_pool_secret',
    PHYSICSOS_ADMIN_PASSWORD_FILE: '/run/secrets/admin_password',
    DEEPSEEK_API_KEY_FILE: '/run/secrets/deepseek_api_key',
    PHYSICSOS_MODEL_FALLBACK_API_KEY_FILE: '/run/secrets/deepseek_api_key',
    PHYSICOS_IMAGE_API_KEY_FILE: '/run/secrets/image_api_key',
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${appEnvironment.PHYSICSOS_MODEL_POOL_PORT ?? '38972'}/v1`,
    PHYSICSOS_MODEL_FALLBACK_BASE_URL: 'http://127.0.0.1:9',
    PHYSICOS_TRUSTED_HOSTS: `127.0.0.1:${port}`,
    PHYSICOS_TRUSTED_PROXIES: '',
    PHYSICSOS_REGISTRATION_MODE: 'closed',
  })
  return {
    name: project,
    services: {
      app: {
        image: images.app,
        restart: 'no',
        init: true,
        environment: appEnvironment,
        secrets: Object.keys(secrets)
          .filter((name) => !['postgres_password', 'redis_password'].includes(name))
          .map(secretMount),
        volumes: ['app_data:/var/lib/physicsos'],
        ports: [`127.0.0.1:${port}:3080`],
        command: [
          'node',
          'scripts/docker-entrypoint.mjs',
          'node',
          'vendor/deepseek-harness/apps/cli/lib/bin.js',
          'web',
          '--patch',
          '/app/overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml',
          '--port',
          '3080',
          '--trusted-host',
          `127.0.0.1:${port}`,
        ],
        security_opt: ['no-new-privileges:true'],
      },
      postgres: {
        image: images.postgres,
        restart: 'no',
        environment: {
          POSTGRES_USER: user,
          POSTGRES_DB: database,
          POSTGRES_PASSWORD_FILE: '/run/secrets/postgres_password',
        },
        secrets: [secretMount('postgres_password')],
        volumes: ['postgres_data:/var/lib/postgresql/data'],
        healthcheck: {
          test: ['CMD-SHELL', 'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"'],
          interval: '2s',
          timeout: '5s',
          retries: 30,
        },
      },
      redis: {
        image: images.redis,
        restart: 'no',
        command: [
          '/bin/sh',
          '-c',
          'exec redis-server --appendonly yes --requirepass "$$(cat /run/secrets/redis_password)"',
        ],
        secrets: [secretMount('redis_password')],
        volumes: ['redis_data:/data'],
        healthcheck: {
          test: [
            'CMD-SHELL',
            'REDISCLI_AUTH="$$(cat /run/secrets/redis_password)" redis-cli --no-auth-warning ping | grep -q PONG',
          ],
          interval: '2s',
          timeout: '5s',
          retries: 30,
        },
      },
    },
    volumes: Object.fromEntries(
      ['app_data', 'postgres_data', 'redis_data'].map((name) => [
        name,
        { name: `${project}_${name}` },
      ]),
    ),
    networks: { default: { name: `${project}_isolated`, internal: true } },
    secrets,
  }
}

export async function restoreFull(options, dependencies = {}) {
  if (!/^physicsos-restore-[a-z0-9][a-z0-9-]{0,39}$/.test(options.project ?? ''))
    throw new Error('Restore requires a NEW project named physicsos-restore-*')
  for (const key of ['artifact', 'keyFile', 'targetDir'])
    if (!options[key]) throw new Error(`Missing ${key}`)
  const port = Number(options.port ?? 13080)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3080)
    throw new Error('Restore requires an isolated port from 1024..65535, excluding 3080')
  const timeout = Number(options.readinessTimeoutMs ?? 120_000)
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600_000)
    throw new Error('Invalid readiness timeout')
  const targetDir = resolve(options.targetDir)
  try {
    const info = await lstat(targetDir)
    if (!info.isDirectory() || (await readdir(targetDir)).length)
      throw new Error('Restore target must be a new empty directory')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  await chmod(targetDir, 0o700)
  const work = await mkdtemp(join(targetDir, '.restore-work-'))
  const stage = join(work, 'content')
  const composeFile = join(targetDir, 'compose.restore.json')
  const compose = composeArgs(targetDir, options.project, composeFile)
  const invokeDocker = dependencies.docker ?? dockerCommand
  const docker = (args, opts = {}) => invokeDocker(args, { ...opts, signal: options.signal })
  const reservation = `${options.project}-restore-reservation`
  let reserved = false
  let resourcesCreated = false
  let completed = false
  try {
    options.signal?.throwIfAborted()
    // Authenticate before reading the archive or consulting/mutating Docker.
    const archive = join(work, 'bundle.tar')
    await decryptFile(resolve(options.artifact), archive, resolve(options.keyFile))
    const members = textOf(await runCommand('tar', ['-tf', archive])).split('\n')
    if (
      members.some(
        (name) =>
          !/^(manifest\.json|postgres\.dump|app_data\.tar|redis_data\.tar|compose\.json|validation\.json|secrets\/[a-zA-Z0-9_-]+)$/.test(
            name,
          ),
      )
    )
      throw new Error('Unsafe backup archive path')
    if (new Set(members).size !== members.length) throw new Error('Duplicate backup archive path')
    await mkdir(stage, { mode: 0o700 })
    await runCommand('tar', ['-C', stage, '-xf', archive])
    const manifest = await verifyManifest(stage)
    const source = JSON.parse(await readFile(join(stage, 'compose.json'), 'utf8'))
    const expected = JSON.parse(await readFile(join(stage, 'validation.json'), 'utf8'))
    for (const resource of ['container', 'volume', 'network']) {
      const args =
        resource === 'container'
          ? [
              'ps',
              '--all',
              '--quiet',
              '--filter',
              `label=com.docker.compose.project=${options.project}`,
            ]
          : [
              resource,
              'ls',
              '--quiet',
              '--filter',
              `label=com.docker.compose.project=${options.project}`,
            ]
      if (textOf(await docker(args)))
        throw new Error('Restore project already has Docker resources')
    }
    // Also reject same-name unlabelled volumes/networks (Compose must not adopt them).
    const names = ['app_data', 'postgres_data', 'redis_data'].map(
      (name) => `${options.project}_${name}`,
    )
    const allVolumes = textOf(await docker(['volume', 'ls', '--quiet'])).split('\n')
    const allNetworks = textOf(await docker(['network', 'ls', '--format', '{{.Name}}'])).split('\n')
    if (
      names.some((name) => allVolumes.includes(name)) ||
      allNetworks.includes(`${options.project}_isolated`)
    )
      throw new Error('Restore resource name is already occupied')
    const config = isolatedCompose(source, manifest, targetDir, options.project, port)
    const secretsDir = join(targetDir, 'secrets')
    await mkdir(secretsDir, { mode: 0o700 })
    for (const name of Object.keys(source.secrets)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid secret name')
      await copyFile(join(stage, 'secrets', name), join(secretsDir, name))
      await chmod(join(secretsDir, name), 0o600)
    }
    const postgresPassword = (
      await readFile(join(stage, 'secrets', 'postgres_password'), 'utf8')
    ).trim()
    const redisPassword = (await readFile(join(stage, 'secrets', 'redis_password'), 'utf8')).trim()
    const env = config.services.postgres.environment
    await writeFile(
      join(secretsDir, 'database_url'),
      `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(postgresPassword)}@postgres:5432/${encodeURIComponent(env.POSTGRES_DB)}`,
      { mode: 0o400 },
    )
    const redisDatabase =
      new URL(await readFile(join(stage, 'secrets', 'redis_url'), 'utf8')).pathname || '/0'
    if (!/^\/\d+$/.test(redisDatabase)) throw new Error('Invalid Redis database path')
    await writeFile(
      join(secretsDir, 'redis_url'),
      `redis://:${encodeURIComponent(redisPassword)}@redis:6379${redisDatabase}`,
      { mode: 0o400 },
    )
    for (const name of Object.keys(source.secrets)) await chmod(join(secretsDir, name), 0o400)
    await writeFile(composeFile, JSON.stringify(config, null, 2), { mode: 0o600 })
    // Named volumes are new and explicitly scoped; no original volume is mounted writable.
    await docker([
      'create',
      '--name',
      reservation,
      '--network',
      'none',
      '--entrypoint',
      '/bin/true',
      config.services.app.image,
    ])
    reserved = true
    resourcesCreated = true
    for (const [name, volume] of Object.entries(config.volumes))
      await docker([
        'volume',
        'create',
        '--label',
        `com.docker.compose.project=${options.project}`,
        '--label',
        `com.docker.compose.volume=${name}`,
        volume.name,
      ])
    for (const name of ['app_data', 'redis_data']) {
      await docker([
        'run',
        '--rm',
        '--network',
        'none',
        '--user',
        '0:0',
        '--volume',
        `${stage}:/backup:ro`,
        '--volume',
        `${config.volumes[name].name}:/target`,
        '--entrypoint',
        'tar',
        config.services.app.image,
        '-C',
        '/target',
        '-xpf',
        `/backup/${name}.tar`,
      ])
    }
    await docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      '0:0',
      '--volume',
      `${secretsDir}:/secrets`,
      '--entrypoint',
      'chown',
      config.services.app.image,
      '-R',
      '999:999',
      '/secrets',
    ])
    await docker([...compose, 'up', '--detach', '--wait', '--wait-timeout', '120', 'postgres'])
    await docker(
      [
        ...compose,
        'exec',
        '-T',
        'postgres',
        'sh',
        '-c',
        'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"',
      ],
      { stdinFile: join(stage, 'postgres.dump') },
    )
    const counts = await queryPostgres(docker, compose, COUNTS_SQL)
    try {
      assert.deepEqual(counts, expected.postgresCounts)
    } catch {
      throw new Error('Restored PostgreSQL row counts do not match the backup')
    }
    const sessions = await sessionCount(
      docker,
      config.services.app.image,
      config.volumes.app_data.name,
    )
    if (sessions !== expected.sessions)
      throw new Error('Restored session-file count does not match the backup')
    const modelTable = modelKeyTable(
      config.services.app.environment.PHYSICSOS_STORAGE_SCHEMA ?? 'physicsos',
    )
    const records = Object.hasOwn(counts, modelTable.name)
      ? await queryPostgres(
          docker,
          compose,
          `SELECT coalesce(json_agg(value::json), '[]'::json)::text FROM ${modelTable.quoted};`,
        )
      : []
    const modelKeys = await validateModelKeys(
      records,
      await readFile(join(stage, 'secrets', 'model_pool_secret'), 'utf8'),
    )
    await docker([...compose, 'up', '--detach', '--wait', '--wait-timeout', '120', 'redis'])
    await docker([
      ...compose,
      'exec',
      '-T',
      'redis',
      'sh',
      '-c',
      'REDISCLI_AUTH="$(cat /run/secrets/redis_password)" exec redis-cli --no-auth-warning ping',
    ])
    await docker([...compose, 'up', '--detach', '--no-deps', 'app'])
    const deadline = Date.now() + timeout
    let ready = false
    do {
      try {
        const remainingMs = Math.max(1, deadline - Date.now())
        await docker(
          [
            ...compose,
            'exec',
            '-T',
            'app',
            'node',
            '--input-type=commonjs',
            '-e',
            RESTORE_READINESS_SCRIPT,
            'http://127.0.0.1:3080/readyz',
            String(Math.min(2000, remainingMs)),
          ],
          { timeoutMs: Math.min(5000, remainingMs) },
        )
        ready = true
        break
      } catch {
        options.signal?.throwIfAborted()
        if (Date.now() >= deadline) break
        await (dependencies.sleep ?? delay)(Math.min(1000, deadline - Date.now()))
      }
    } while (Date.now() < deadline)
    if (!ready) throw new Error('Restored application readiness deadline exceeded')
    const report = {
      ready: true,
      project: options.project,
      endpoint: `http://127.0.0.1:${port}`,
      counts,
      sessions,
      modelKeysDecrypted: modelKeys,
      image: config.services.app.image,
    }
    await writeFile(join(targetDir, 'restore-report.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    })
    completed = true
    return report
  } finally {
    try {
      if (resourcesCreated && !completed)
        await invokeDocker([...compose, 'down', '--volumes', '--remove-orphans'])
    } finally {
      try {
        if (reserved) await invokeDocker(['rm', reservation])
      } finally {
        await rm(work, { recursive: true, force: true })
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cancellation = terminationSignal()
  try {
    const options = parseArguments(process.argv.slice(2), {
      '--artifact': 'artifact',
      '--key-file': 'keyFile',
      '--target-dir': 'targetDir',
      '--project': 'project',
      '--port': 'port',
      '--readiness-timeout-ms': 'readinessTimeoutMs',
    })
    console.log(JSON.stringify(await restoreFull({ ...options, signal: cancellation.signal })))
  } catch (error) {
    console.error(`restore-full: ${safeFailureMessage(error)}`)
    process.exitCode = 1
  } finally {
    cancellation.dispose()
  }
}
