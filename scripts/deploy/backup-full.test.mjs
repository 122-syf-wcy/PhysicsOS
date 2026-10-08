import { Buffer } from 'node:buffer'
import process from 'node:process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createCipheriv, hkdfSync } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  encryptFile,
  decryptFile,
  validateModelKeys,
  modelKeyTable,
  RESTORE_READINESS_SCRIPT,
} from './backup-lib.mjs'
import { backupFull } from './backup-full.mjs'
import { restoreFull } from './restore-full.mjs'

for (const [name, contentType, body, expectedCode] of [
  ['HTML', 'text/html', '<html>fixture-secret</html>', 1],
  ['not-ready JSON', 'application/json', '{"status":"starting","secret":"fixture-secret"}', 1],
  ['ready JSON', 'application/json', '{"status":"ready"}', 0],
  ['stalled JSON body', 'application/json', null, 1],
]) {
  test(`container readiness probe handles HTTP 200 ${name} without logging bodies`, async (t) => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.writeHead(200, { 'content-type': contentType })
      if (body === null) response.write('{"status":')
      else response.end(body)
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    t.after(
      () =>
        new Promise((resolve) => {
          server.close(resolve)
          server.closeAllConnections()
        }),
    )
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=commonjs',
          '-e',
          RESTORE_READINESS_SCRIPT,
          `http://127.0.0.1:${server.address().port}/readyz`,
          body === null ? '500' : '2000',
        ],
        { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const stdout = []
      const stderr = []
      child.stdout.on('data', (chunk) => stdout.push(chunk))
      child.stderr.on('data', (chunk) => stderr.push(chunk))
      child.once('error', reject)
      child.once('close', (code, signal) =>
        resolve({
          code,
          signal,
          stdout: Buffer.concat(stdout).toString(),
          stderr: Buffer.concat(stderr).toString(),
        }),
      )
    })
    assert.equal(requests, 1)
    assert.equal(result.signal, null, 'the probe must finish within its own timeout')
    assert.equal(result.code, expectedCode)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  })
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-backup-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const keyFile = join(root, 'key')
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 })
  return { root, keyFile }
}

test('stream encryption authenticates ciphertext and never publishes unauthenticated plaintext', async (t) => {
  const { root, keyFile } = await fixture(t)
  const source = join(root, 'source')
  const encrypted = join(root, 'sealed')
  const restored = join(root, 'restored')
  const payload = Buffer.concat([
    Buffer.from('stable-secret-not-in-ciphertext'),
    randomBytes(1024 * 1024),
  ])
  await writeFile(source, payload)
  await encryptFile(source, encrypted, keyFile)
  assert.equal((await readFile(encrypted)).includes(payload.subarray(0, 30)), false)
  await decryptFile(encrypted, restored, keyFile)
  assert.deepEqual(await readFile(restored), payload)
  const tampered = await readFile(encrypted)
  tampered[100] ^= 1
  await writeFile(encrypted, tampered)
  await assert.rejects(
    decryptFile(encrypted, join(root, 'tampered-output'), keyFile),
    /authentication/i,
  )
  assert.equal((await readdir(root)).includes('tampered-output'), false)
})

test('model-key drill proves the preserved master secret decrypts stored values without returning them', async () => {
  const master = 'fixture-master-secret-32-characters'
  const key = Buffer.from(
    hkdfSync('sha256', master, 'physicsos.model-pool.v1', 'aes-256-gcm/key-material', 32),
  )
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update('fixture-provider-key'), cipher.final()])
  const records = [
    {
      secret: {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      },
    },
  ]
  assert.equal(await validateModelKeys(records, master), 1)
  await assert.rejects(validateModelKeys(records, 'wrong-master-secret'), /decrypt/i)
})

async function dockerFixture(t, running = ['app', 'postgres', 'redis']) {
  const state = await fixture(t)
  const projectDir = join(state.root, 'project')
  await mkdir(projectDir)
  const secrets = {}
  for (const name of [
    'postgres_password',
    'redis_password',
    'database_url',
    'redis_url',
    'model_pool_secret',
    'admin_password',
    'deepseek_api_key',
    'image_api_key',
  ]) {
    const file = join(projectDir, `secret-${name}`)
    await writeFile(
      file,
      name === 'model_pool_secret'
        ? 'fixture-master-secret-32-characters'
        : name === 'redis_url'
          ? 'redis://:fixture-redis_password@redis:6379/2'
          : `fixture-${name}`,
      { mode: 0o600 },
    )
    secrets[name] = { file }
  }
  const config = {
    name: 'physicsos',
    secrets,
    services: {
      app: { image: 'fixture-app', environment: { PHYSICSOS_STORAGE_SCHEMA: 'physicsos' } },
      postgres: {
        image: 'fixture-postgres',
        environment: { POSTGRES_USER: 'physicsos', POSTGRES_DB: 'physicsos' },
      },
      redis: { image: 'fixture-redis' },
    },
  }
  await writeFile(join(projectDir, 'compose.yml'), '# fixture')
  const volume = join(state.root, 'volume')
  await mkdir(join(volume, 'sessions'), { recursive: true })
  await writeFile(join(volume, 'sessions', 's1.json'), '{"id":"s1"}')
  const tar = spawnSync('tar', ['-C', volume, '-cf', '-', '.'])
  assert.equal(tar.status, 0)
  const calls = []
  const docker = async (args, options = {}) => {
    calls.push(args)
    const command = args.join(' ')
    if (state.fail && command.includes(state.fail)) throw new Error('fixture Docker failure')
    if (args.includes(RESTORE_READINESS_SCRIPT)) {
      assert.equal(args[args.indexOf(RESTORE_READINESS_SCRIPT) - 1], '-e')
      assert.equal(args.at(-2), 'http://127.0.0.1:3080/readyz')
      assert.ok(Number(args.at(-1)) >= 1 && Number(args.at(-1)) <= 2000)
      assert.ok(options.timeoutMs >= 1 && options.timeoutMs <= 5000)
    }
    let output = ''
    if (command.includes('config --format json')) output = JSON.stringify(config)
    else if (command.includes('ps --status running --services')) output = running.join('\n')
    else if (args[0] === 'compose' && command.includes('ps --all --quiet'))
      output = `container-${args.at(-1)}`
    else if (args[0] === 'inspect')
      output = JSON.stringify([
        {
          Mounts: [
            {
              Type: 'volume',
              Name: `physicsos_${args[1].slice(10)}_data`,
              Destination: args[1].endsWith('app') ? '/var/lib/physicsos' : '/data',
            },
          ],
        },
      ])
    else if (command.startsWith('image inspect'))
      output = JSON.stringify([
        {
          Id: `sha256:${args.at(-1)}`,
          RepoDigests: [],
          Config: { Labels: { 'org.opencontainers.image.revision': 'fixture-revision' } },
        },
      ])
    else if (command.includes('pg_dump')) output = Buffer.from('PGDMP fixture binary archive')
    else if (command.includes('pg_restore --list')) output = 'fixture toc'
    else if (command.includes('backup_counts'))
      output = JSON.stringify({
        'physicsos.accounts': 2,
        'physicsos.sessions': 1,
        ...(state.modelRecords
          ? { [modelKeyTable('physicsos').name]: state.modelRecords.length }
          : {}),
      })
    else if (command.includes('json_agg(value::json)'))
      output = JSON.stringify(state.modelRecords ?? [])
    else if (command.includes('DBSIZE')) output = '1'
    else if (command.includes('find /source/sessions')) output = '1'
    else if (command.includes('tar') && command.includes('-cpf')) output = tar.stdout
    if (options.stdoutFile) await writeFile(options.stdoutFile, output, { mode: 0o600 })
    return Buffer.from(output)
  }
  return { ...state, state, projectDir, docker, calls, config }
}

test('full backup captures all stores and secrets, resumes original services, copies encrypted offsite artifact', async (t) => {
  const f = await dockerFixture(t)
  const output = join(f.root, 'full.pbackup')
  const offsiteDir = join(f.root, 'offsite')
  const result = await backupFull(
    { projectDir: f.projectDir, output, keyFile: f.keyFile, offsiteDir },
    { docker: f.docker },
  )
  assert.equal(result.artifact, output)
  assert.deepEqual(await readFile(output), await readFile(join(offsiteDir, 'full.pbackup')))
  const stops = f.calls.filter((a) => a.includes('stop')).map((a) => a.at(-1))
  assert.deepEqual(stops, ['app', 'redis'])
  assert.deepEqual(
    f.calls.filter((a) => a.includes('start')).map((a) => a.at(-1)),
    ['redis', 'app'],
  )
  assert.equal(
    (await readdir(f.projectDir)).some(
      (name) => name.includes('backup-work') || name.includes('backup-lock'),
    ),
    false,
  )
})

test('failed capture resumes only services that were running and removes plaintext staging', async (t) => {
  const f = await dockerFixture(t, ['postgres', 'redis'])
  f.state.fail = 'pg_dump'
  await assert.rejects(
    backupFull(
      { projectDir: f.projectDir, output: join(f.root, 'bad.pbackup'), keyFile: f.keyFile },
      { docker: f.docker },
    ),
  )
  assert.deepEqual(
    f.calls.filter((a) => a.includes('start')).map((a) => a.at(-1)),
    ['redis'],
  )
  assert.equal(
    (await readdir(f.projectDir)).some(
      (name) => name.includes('backup-work') || name.includes('backup-lock'),
    ),
    false,
  )
  assert.equal((await readdir(f.root)).includes('bad.pbackup'), false)
})

test('restore refuses production project names and occupied target before Docker writes', async (t) => {
  const f = await dockerFixture(t)
  const options = {
    artifact: join(f.root, 'does-not-exist'),
    keyFile: f.keyFile,
    targetDir: join(f.root, 'restore'),
    project: 'physicsos',
  }
  await assert.rejects(restoreFull(options, { docker: f.docker }), /physicsos-restore-/)
  await mkdir(options.targetDir)
  await writeFile(join(options.targetDir, 'existing'), 'keep')
  await assert.rejects(
    restoreFull({ ...options, project: 'physicsos-restore-test' }, { docker: f.docker }),
    /empty/i,
  )
  assert.equal(f.calls.length, 0)
})

test('isolated restore validates counts, sessions and readiness with isolated volumes and loopback port', async (t) => {
  const f = await dockerFixture(t)
  const artifact = join(f.root, 'full.pbackup')
  await backupFull(
    { projectDir: f.projectDir, output: artifact, keyFile: f.keyFile },
    { docker: f.docker },
  )
  f.calls.length = 0
  const targetDir = join(f.root, 'restore')
  const result = await restoreFull(
    { artifact, keyFile: f.keyFile, targetDir, project: 'physicsos-restore-test', port: 13081 },
    { docker: f.docker },
  )
  assert.equal(result.ready, true)
  assert.equal(result.sessions, 1)
  const config = JSON.parse(await readFile(join(targetDir, 'compose.restore.json'), 'utf8'))
  assert.deepEqual(config.services.app.ports, ['127.0.0.1:13081:3080'])
  assert.equal(config.networks.default.internal, true)
  assert.deepEqual(
    Object.values(config.volumes)
      .map((v) => v.name)
      .sort(),
    [
      'physicsos-restore-test_app_data',
      'physicsos-restore-test_postgres_data',
      'physicsos-restore-test_redis_data',
    ],
  )
  assert.equal(config.services.postgres.ports, undefined)
  assert.ok(f.calls.some((a) => a.join(' ').includes('pg_restore')))
  assert.ok(f.calls.some((a) => a.includes(RESTORE_READINESS_SCRIPT)))
})

test('tampered backup fails authentication before creating any Docker resource', async (t) => {
  const f = await dockerFixture(t)
  const artifact = join(f.root, 'full.pbackup')
  await backupFull(
    { projectDir: f.projectDir, output: artifact, keyFile: f.keyFile },
    { docker: f.docker },
  )
  const bytes = await readFile(artifact)
  bytes[30] ^= 1
  await writeFile(artifact, bytes)
  f.calls.length = 0
  await assert.rejects(
    restoreFull(
      {
        artifact,
        keyFile: f.keyFile,
        targetDir: join(f.root, 'restore'),
        project: 'physicsos-restore-tamper',
      },
      { docker: f.docker },
    ),
    /authentication/i,
  )
  assert.equal(f.calls.length, 0)
})

test('authenticated archive with a mismatched manifest checksum is rejected before Docker writes', async (t) => {
  const f = await dockerFixture(t)
  const artifact = join(f.root, 'full.pbackup')
  await backupFull(
    { projectDir: f.projectDir, output: artifact, keyFile: f.keyFile },
    { docker: f.docker },
  )
  const unpacked = join(f.root, 'unpacked')
  const archive = join(f.root, 'plain.tar')
  await mkdir(unpacked)
  await decryptFile(artifact, archive, f.keyFile)
  assert.equal(spawnSync('tar', ['-C', unpacked, '-xf', archive]).status, 0)
  await writeFile(join(unpacked, 'postgres.dump'), 'corrupt dump with valid encryption')
  const manifest = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'))
  assert.equal(
    spawnSync('tar', [
      '-C',
      unpacked,
      '-cf',
      archive,
      'manifest.json',
      ...manifest.files.map((file) => file.path),
    ]).status,
    0,
  )
  const inconsistent = join(f.root, 'inconsistent.pbackup')
  await encryptFile(archive, inconsistent, f.keyFile)
  f.calls.length = 0
  await assert.rejects(
    restoreFull(
      {
        artifact: inconsistent,
        keyFile: f.keyFile,
        targetDir: join(f.root, 'restore'),
        project: 'physicsos-restore-checksum',
      },
      { docker: f.docker },
    ),
    /checksum/,
  )
  assert.equal(f.calls.length, 0)
})

for (const [failure, marker] of [
  ['archive import', '-xpf'],
  ['readiness probe', RESTORE_READINESS_SCRIPT],
]) {
  test(`restore failure at ${failure} tears down only its newly created isolated project`, async (t) => {
    const f = await dockerFixture(t)
    const artifact = join(f.root, 'full.pbackup')
    await backupFull(
      { projectDir: f.projectDir, output: artifact, keyFile: f.keyFile },
      { docker: f.docker },
    )
    f.calls.length = 0
    f.state.fail = marker
    const targetDir = join(f.root, 'restore')
    await assert.rejects(
      restoreFull(
        {
          artifact,
          keyFile: f.keyFile,
          targetDir,
          project: 'physicsos-restore-failure',
          readinessTimeoutMs: 1,
        },
        { docker: f.docker },
      ),
    )
    const cleanup = f.calls.filter((args) => args.includes('down'))
    assert.equal(cleanup.length, 1)
    assert.equal(cleanup[0].includes('physicsos-restore-failure'), true)
    assert.equal(cleanup[0].includes('--volumes'), true)
    assert.equal(
      (await readdir(targetDir)).some((name) => name.startsWith('.restore-work')),
      false,
    )
    assert.equal((await readdir(targetDir)).includes('restore-report.json'), false)
  })
}

test('an atomic project reservation failure never tears down another restore', async (t) => {
  const f = await dockerFixture(t)
  const artifact = join(f.root, 'full.pbackup')
  await backupFull(
    { projectDir: f.projectDir, output: artifact, keyFile: f.keyFile },
    { docker: f.docker },
  )
  f.calls.length = 0
  const docker = (args, options) => {
    if (args[0] === 'create')
      throw new Error('Container name already reserved by concurrent restore')
    return f.docker(args, options)
  }
  await assert.rejects(
    restoreFull(
      {
        artifact,
        keyFile: f.keyFile,
        targetDir: join(f.root, 'restore'),
        project: 'physicsos-restore-concurrent',
      },
      { docker },
    ),
    /reserved/,
  )
  assert.equal(
    f.calls.some((args) => args.includes('down') || (args[0] === 'volume' && args[1] === 'create')),
    false,
  )
})

test('service recovery attempts app even when restarting Redis fails', async (t) => {
  const f = await dockerFixture(t)
  const docker = (args, options) => {
    if (args.includes('start') && args.at(-1) === 'redis') {
      f.calls.push(args)
      throw new Error('Cannot restart Redis')
    }
    return f.docker(args, options)
  }
  await assert.rejects(
    backupFull(
      { projectDir: f.projectDir, output: join(f.root, 'bad.pbackup'), keyFile: f.keyFile },
      { docker },
    ),
    /recovery failed: redis/,
  )
  assert.deepEqual(
    f.calls.filter((args) => args.includes('start')).map((args) => args.at(-1)),
    ['redis', 'app'],
  )
})

test('invalid encryption key is rejected before stopping any live service', async (t) => {
  const f = await dockerFixture(t)
  await writeFile(f.keyFile, 'invalid')
  await assert.rejects(
    backupFull(
      { projectDir: f.projectDir, output: join(f.root, 'bad.pbackup'), keyFile: f.keyFile },
      { docker: f.docker },
    ),
    /32 random bytes/,
  )
  assert.equal(
    f.calls.some((args) => args.includes('stop')),
    false,
  )
})

test('cancelled capture still resumes stopped services with an uncancelled cleanup path', async (t) => {
  const f = await dockerFixture(t)
  const controller = new AbortController()
  const docker = async (args, options) => {
    if (args.join(' ').includes('pg_dump')) {
      controller.abort()
      if (options?.signal?.aborted) throw new Error('Capture cancelled')
    }
    if (args.includes('start')) assert.equal(options?.signal?.aborted ?? false, false)
    return f.docker(args, options)
  }
  await assert.rejects(
    backupFull(
      {
        projectDir: f.projectDir,
        output: join(f.root, 'cancelled.pbackup'),
        keyFile: f.keyFile,
        signal: controller.signal,
      },
      { docker },
    ),
    /cancelled/,
  )
  assert.deepEqual(
    f.calls.filter((args) => args.includes('start')).map((args) => args.at(-1)),
    ['redis', 'app'],
  )
})

test('restored nonempty model-key table is locally decrypted and a changed master fails closed', async (t) => {
  const f = await dockerFixture(t)
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      'fixture-master-secret-32-characters',
      'physicsos.model-pool.v1',
      'aes-256-gcm/key-material',
      32,
    ),
  )
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update('fixture-provider-key'), cipher.final()])
  f.state.modelRecords = [
    {
      secret: {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      },
    },
  ]
  const artifact = join(f.root, 'with-model.pbackup')
  await backupFull(
    { projectDir: f.projectDir, output: artifact, keyFile: f.keyFile },
    { docker: f.docker },
  )
  const restored = await restoreFull(
    {
      artifact,
      keyFile: f.keyFile,
      targetDir: join(f.root, 'restore-model'),
      project: 'physicsos-restore-model',
    },
    { docker: f.docker },
  )
  assert.equal(restored.modelKeysDecrypted, 1)
  await writeFile(f.config.secrets.model_pool_secret.file, 'fixture-wrong-master-secret')
  const wrong = join(f.root, 'wrong-master.pbackup')
  await backupFull(
    { projectDir: f.projectDir, output: wrong, keyFile: f.keyFile },
    { docker: f.docker },
  )
  await assert.rejects(
    restoreFull(
      {
        artifact: wrong,
        keyFile: f.keyFile,
        targetDir: join(f.root, 'restore-wrong-master'),
        project: 'physicsos-restore-wrong-master',
      },
      { docker: f.docker },
    ),
    /decryption/,
  )
})
