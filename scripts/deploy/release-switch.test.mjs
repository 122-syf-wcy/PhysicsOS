import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { RESTORE_READINESS_SCRIPT } from './backup-lib.mjs'

const OLD = `sha256:${'1'.repeat(64)}`
const NEW = `sha256:${'2'.repeat(64)}`
const REVISION = '3'.repeat(40)
const DIGEST = '4'.repeat(64)
const CODE_DIGEST = '6'.repeat(64)
const bytes = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
const releaseModule = () => import('./release-switch.mjs').catch(() => ({}))

async function fixture(t) {
  const { releaseSwitch } = await releaseModule()
  assert.equal(typeof releaseSwitch, 'function', 'guarded reusable release switching is missing')
  const root = await mkdtemp(join(tmpdir(), 'physicsos-release-switch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prior = `# retained settings\nCUSTOM_SETTING=keep\nPHYSICSOS_APP_IMAGE=${OLD}\n`
  await writeFile(join(root, '.env'), prior, { mode: 0o600 })
  await writeFile(join(root, 'compose.yml'), '# fixture compose\n')
  const secrets = {}
  for (const name of ['postgres_password', 'redis_password', 'database_url', 'redis_url', 'model_pool_secret', 'admin_password', 'deepseek_api_key', 'image_api_key']) {
    const file = join(root, `secret-${name}`)
    await writeFile(file, 'fixture-private-value', { mode: 0o600 })
    secrets[name] = { file }
  }
  const usernameFile = join(root, 'username'), passwordFile = join(root, 'password'), keyFile = join(root, 'backup-key')
  await writeFile(usernameFile, 'release-check', { mode: 0o600 })
  await writeFile(passwordFile, 'fixture-password-never-output', { mode: 0o600 })
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 })
  const state = { app: true, redis: true, postgres: true, image: OLD, mode: '', events: [], changed: false }
  const config = { name: 'physicsos', secrets, services: { app: { image: OLD, environment: { PHYSICSOS_STORAGE_SCHEMA: 'physicsos' } }, postgres: { image: 'postgres:fixture' }, redis: { image: 'redis:fixture' } } }
  const docker = async (args, options = {}) => {
    if (args.includes('stop')) {
      for (const service of args.slice(args.indexOf('--timeout') + 2)) state[service] = false
      if (state.mode === 'replacement-on-stop') state.replaced = true
      state.events.push('stop')
      if (state.mode === 'partial-stop') throw new Error('fixture stop failed after stopping services')
      return bytes('')
    }
    if (args.includes('start')) {
      for (const service of args.slice(args.indexOf('start') + 1)) state[service] = true
      state.events.push('start')
      return bytes('')
    }
    if (args.includes('up')) {
      state.image = options.env?.PHYSICSOS_APP_IMAGE ?? (await readFile(join(root, '.env'), 'utf8')).match(/^PHYSICSOS_APP_IMAGE=(.+)$/m)[1]
      state.app = true
      state.events.push(state.image === NEW ? 'candidate' : 'rollback')
      return bytes('')
    }
    if (args.includes(RESTORE_READINESS_SCRIPT)) {
      if (state.image === NEW && state.mode === 'readiness') throw new Error('fixture readiness failure')
      return bytes('')
    }
    if (args.includes('config')) return bytes(config)
    if (args.includes('ps') && args.includes('--services')) return bytes(['app', 'postgres', 'redis'].filter(name => state[name]).join('\n'))
    if (args.includes('ps') && args.includes('--quiet')) return bytes(`container-${args.at(-1)}`)
    if (args[0] === 'ps') return bytes([...['app', 'postgres', 'redis'].filter(name => state[name]).map(name => `container-${name}`), ...(!state.app && state.mode === 'late-writer' ? ['container-foreign'] : [])].join('\n'))
    if (args[0] === 'inspect') {
      const name = args[1].replace('container-', '')
      if (name === 'foreign') return bytes([{ Id: 'container-foreign', Mounts: [{ Type: 'bind', Source: '/volumes/app', RW: true }] }])
      return bytes([{ Id: name === 'app' && state.replaced ? 'container-replacement' : `container-${name}`, Image: name === 'app' ? state.image : `sha256:${name}`, State: { Running: state[name], Health: { Status: 'healthy' } }, NetworkSettings: name === 'app' ? { Networks: { private: { IPAddress: '172.20.0.5' } } } : {}, Config: { Labels: {} }, Mounts: [{ Type: 'volume', Name: `physicsos_${name}_data`, Source: `/volumes/${name}`, Destination: name === 'app' ? '/var/lib/physicsos' : name === 'redis' ? '/data' : '/var/lib/postgresql/data', RW: true }] }])
    }
    if (args[0] === 'image' && args[1] === 'inspect') return bytes([{ Id: args[2], Config: { Labels: { 'org.opencontainers.image.revision': REVISION, 'physicsos.source.digest': DIGEST, 'physicsos.code.digest': CODE_DIGEST } }, RepoDigests: [] }])
    if (args.includes('exec') && args.some(arg => arg.includes('pg_locks'))) {
      const sql = args.find(arg => arg.includes('pg_locks'))
      state.leaseSql = sql
      // PostgreSQL inet::text includes /32; host(inet) matches Docker's bare address.
      const owner = sql.includes('host(a.client_addr)') ? '172.20.0.5' : '172.20.0.5/32'
      return bytes({ count: state.app ? 1 : 0, ownerMatches: owner === '172.20.0.5' })
    }
    if (args[0] === 'tag') return bytes('')
    throw new Error(`Unhandled fixture Docker command: ${args[0]}`)
  }
  const run = async (command, args) => {
    if (command === 'git') return bytes(args[0] === 'ls-remote' ? `${REVISION}\trefs/heads/main` : REVISION)
    const operation = args.at(-2), snapshot = args.at(-1)
    state.events.push(`${operation}:${state.app ? 'live' : 'stopped'}`)
    if (operation === 'preflight' && state.mode === 'hook-preflight') throw new Error('fixture preflight refused')
    if (operation === 'apply') {
      await writeFile(snapshot, '{"original":true}', { mode: 0o600 })
      state.changed = true
      if (state.mode === 'hook-apply') throw new Error('fixture hook failed after mutation')
    }
    if (operation === 'rollback') state.changed = false
    return bytes('')
  }
  const capture = async options => {
    assert.equal(state.app, false, 'backup must not capture a running app')
    assert.equal(state.redis, false, 'backup must not capture running Redis')
    state.events.push('capture')
    if (state.mode === 'backup') throw new Error('fixture backup failure')
    if (options.mode === 'paired') {
      await mkdir(options.outputDir, { recursive: true })
      const manifest = join(options.outputDir, 'paired-manifest.json')
      await writeFile(manifest, '{"consistent":true}', { mode: 0o600 })
      return { mode: 'paired', directory: options.outputDir, manifest, sha256: '5'.repeat(64), counts: {}, sessions: 0 }
    }
    await writeFile(join(root, 'recovery.pbackup'), 'encrypted-fixture')
    return { artifact: join(root, 'recovery.pbackup'), sha256: '5'.repeat(64), counts: {}, sessions: 0 }
  }
  const server = createServer(async (req, res) => {
    const fail = state.image === NEW && state.mode === 'auth'
    if (req.url === '/readyz') {
      if (state.image === NEW && state.mode === 'html-ready') return res.end('<html>SPA fallback</html>')
      res.setHeader('content-type', 'application/json')
      return res.end('{"status":"ready"}')
    }
    if (req.url === '/') return res.end('<html>PhysicsOS</html>')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/physicsos/auth/login') {
      let body = ''
      for await (const chunk of req) body += chunk
      const login = JSON.parse(body)
      assert.equal(login.username, 'release-check')
      assert.equal(login.password, 'fixture-password-never-output')
      assert.equal(req.headers.origin, `http://127.0.0.1:${server.address().port}`)
      if (fail) { res.statusCode = 401; return res.end('{"error":{"code":"REFUSED"}}') }
      res.setHeader('set-cookie', 'physicsos_session=fixture-cookie-never-output; HttpOnly; Path=/')
      return res.end('{"user":{"username":"release-check","role":"SUPER_ADMIN","schoolId":"PHYSICSOS-OPEN"}}')
    }
    if (req.headers.cookie !== 'physicsos_session=fixture-cookie-never-output') { res.statusCode = 401; return res.end('{"error":{}}') }
    if (req.url === '/physicsos/auth/me') return res.end('{"user":{"username":"release-check","role":"SUPER_ADMIN","schoolId":"PHYSICSOS-OPEN"}}')
    if (req.url === '/physicsos/admin/protected') return res.end('{"protected":true}')
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const plan = { projectDir: root, expectedOldImage: OLD, candidateImage: NEW, revision: REVISION, sourceDigest: DIGEST, codeDigest: CODE_DIGEST, rollbackCompatible: true, minFreeBytes: 0, backup: { output: join(root, 'recovery.pbackup'), keyFile }, acceptance: { origin: `http://127.0.0.1:${server.address().port}`, usernameFile, passwordFile, expectedRole: 'SUPER_ADMIN', protectedPath: '/physicsos/admin/protected' }, timeoutMs: 80, intervalMs: 5 }
  const hookFile = join(root, 'reviewed-hook.mjs')
  await writeFile(hookFile, '// reviewed fixture\n')
  const hook = { id: 'configuration', script: hookFile, sha256: createHash('sha256').update('// reviewed fixture\n').digest('hex'), preflight: ['node', hookFile, 'preflight', '{snapshot}'], apply: ['node', hookFile, 'apply', '{snapshot}'], rollback: ['node', hookFile, 'rollback', '{snapshot}'] }
  return { root, prior, state, plan, hook, releaseSwitch, dependencies: { docker, run, capture } }
}

test('hook preflight refusal leaves the live deployment untouched', async t => {
  const f = await fixture(t)
  f.state.mode = 'hook-preflight'
  await assert.rejects(f.releaseSwitch({ ...f.plan, hooks: [f.hook] }, f.dependencies), /preflight/i)
  assert.equal(f.state.app, true)
  assert.equal(f.state.redis, true)
  assert.equal(f.state.events.includes('stop'), false)
  assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior)
})

for (const mode of ['partial-stop', 'backup', 'readiness', 'auth', 'html-ready']) {
  test(`${mode} failure restores compatible old image and settings`, async t => {
    const f = await fixture(t)
    f.state.mode = mode
    await assert.rejects(f.releaseSwitch(f.plan, f.dependencies), error => error.rollbackHealthy === true)
    assert.equal(f.state.image, OLD)
    assert.equal(f.state.app, true)
    assert.equal(f.state.redis, true)
    assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior)
    assert.equal(f.state.events.includes('candidate'), ['readiness', 'auth', 'html-ready'].includes(mode))
  })
}

test('release holds services stopped from the recheck through backup and hook application', async t => {
  const f = await fixture(t)
  const result = await f.releaseSwitch({ ...f.plan, hooks: [f.hook] }, f.dependencies)
  assert.equal(result.deployed, true)
  assert.equal(f.state.image, NEW)
  assert.deepEqual(f.state.events.filter(event => /preflight|stop|capture|apply|candidate/.test(event)), ['preflight:live', 'stop', 'preflight:stopped', 'capture', 'apply:stopped', 'candidate'])
  const files = await readdir(result.recovery)
  for (const name of files) if (name.endsWith('.json')) {
    const content = await readFile(join(result.recovery, name), 'utf8')
    assert.equal(/fixture-password-never-output|fixture-cookie-never-output/.test(content), false)
  }
})

test('failed configuration application reverts its snapshot before restarting the old app', async t => {
  const f = await fixture(t)
  f.state.mode = 'hook-apply'
  await assert.rejects(f.releaseSwitch({ ...f.plan, hooks: [f.hook] }, f.dependencies), error => error.rollbackHealthy === true)
  assert.equal(f.state.changed, false)
  assert.ok(f.state.events.indexOf('rollback:stopped') < f.state.events.indexOf('start'))
  assert.equal(f.state.image, OLD)
})

test('cancellation after capture uses an uncancelled service recovery path', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const capture = f.dependencies.capture
  f.dependencies.capture = async (...args) => { const result = await capture(...args); controller.abort(); return result }
  await assert.rejects(f.releaseSwitch({ ...f.plan, signal: controller.signal }, f.dependencies), error => error.rollbackHealthy === true)
  assert.equal(f.state.app, true)
  assert.equal(f.state.image, OLD)
  assert.equal(f.state.events.includes('candidate'), false)
})

test('paired release policy accepts the existing private backup directory without an encryption key', async t => {
  const f = await fixture(t)
  const recovery = join(f.root, 'paired-release')
  const result = await f.releaseSwitch({ ...f.plan, recoveryDir: recovery, backup: { mode: 'paired', outputDir: recovery } }, f.dependencies)
  assert.equal(result.deployed, true)
  assert.equal(result.backup.mode, 'paired')
  assert.equal(result.backup.directory, recovery)
  assert.equal(f.state.image, NEW)
})

test('a foreign data writer appearing during stop prevents capture and unsafe app recovery', async t => {
  const f = await fixture(t)
  f.state.mode = 'late-writer'
  await assert.rejects(f.releaseSwitch(f.plan, f.dependencies), error => error.rollbackHealthy === false)
  assert.equal(f.state.events.includes('capture'), false)
  assert.equal(f.state.events.includes('candidate'), false)
  assert.equal(f.state.app, false)
})

test('a replaced app container during stop is left stopped for operator inspection', async t => {
  const f = await fixture(t)
  f.state.mode = 'replacement-on-stop'
  await assert.rejects(f.releaseSwitch(f.plan, f.dependencies), error => error.rollbackHealthy === false)
  assert.equal(f.state.events.includes('capture'), false)
  assert.equal(f.state.app, false)
})

for (const [name, value] of [['missing', undefined], ['mismatched', '7'.repeat(64)]]) {
  test(`${name} runtime code digest refuses release before stopping production`, async t => {
    const f = await fixture(t)
    await assert.rejects(f.releaseSwitch({ ...f.plan, codeDigest: value }, f.dependencies))
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.image, OLD)
  })
}

test('writer lease ownership compares the bare PostgreSQL host address with the running Docker app', async t => {
  const f = await fixture(t)
  const result = await f.releaseSwitch(f.plan, f.dependencies)
  assert.equal(result.deployed, true)
  assert.match(f.state.leaseSql, /host\(a\.client_addr\) IN \('172\.20\.0\.5'\)/)
})
