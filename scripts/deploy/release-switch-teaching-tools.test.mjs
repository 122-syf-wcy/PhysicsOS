import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { REQUIRED_SECRETS } from './backup-lib.mjs'
import { envWithBoundAppImage, envWithTeachingToolsMode, guardTeachingToolsCompatibility, releaseSwitch, TEACHING_ROUTES_READINESS_SCRIPT, verifyActivityCapacityProof } from './release-switch.mjs'

const LEGACY = `sha256:${'a'.repeat(64)}`
const BRIDGE = `sha256:${'b'.repeat(64)}`
const FEATURE = `sha256:${'c'.repeat(64)}`
const REVISION = '1'.repeat(40), SOURCE_DIGEST = '2'.repeat(64), CODE_DIGEST = '3'.repeat(64)
const CAPABILITY = 'teaching-tools-bridge-v1'
const MODE_ENV = 'PHYSICSOS_TEACHING_TOOLS_MODE', CAPACITY_ENV = 'PHYSICSOS_ACTIVITY_QUERY_CAPACITY_VERIFIED'
const CPU = { NanoCpus: 0, CpuPeriod: 0, CpuQuota: 0, CpusetCpus: '' }
const APP_NAME = 'physicsos-app-1'
const image = (id, capability) => ({ Id: id, Config: { Labels: capability ? { 'physicsos.teaching-tools.bridge': capability } : {} } })
const plan = (stage = 'enabled') => ({
  expectedOldImage: BRIDGE, candidateImage: FEATURE, revision: REVISION, sourceDigest: SOURCE_DIGEST, codeDigest: CODE_DIGEST,
  teachingTools: { capability: CAPABILITY, stage, rollbackImage: BRIDGE,
    ...(stage === 'enabled' ? { activityCapacity: { path: join(tmpdir(), 'fixture', 'result.json'), sha256: '4'.repeat(64) } } : {}) },
  acceptance: { expectedTeachingToolsMode: stage },
})
const capacityRecord = () => ({ revision: REVISION, sourceDigest: SOURCE_DIGEST, scope: 'capacity',
  exitCode: 0, passed: true, passedTests: 2, failedTests: 0, pendingTests: 0,
  inputs: { PHYSICSOS_ACTIVITY_RUN_CAPACITY: '1', PHYSICSOS_ACTIVITY_BASE_DAILY_USERS: '6', PHYSICSOS_ACTIVITY_EVENTS_PER_USER_DAY: '73',
    PHYSICSOS_ACTIVITY_BASE_ROSTER_USERS: '80', PHYSICSOS_ACTIVITY_BASE_SCHOOLS: '70' },
  cpuProfile: { referenceContainer: APP_NAME, reference: { ...CPU }, runner: { ...CPU } },
  elapsedSeconds: 37,
})
const productionApp = () => ({ Name: `/${APP_NAME}`, HostConfig: { ...CPU, Memory: 0 } })
const bytes = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function temporaryDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-teaching-switch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return realpath(root)
}

async function writeCapacityProof(root, proof = capacityRecord()) {
  const path = join(root, 'result.json'), content = bytes(proof)
  await writeFile(path, content, { mode: 0o600 })
  return { path, sha256: sha256(content) }
}

test('first bridge keeps the legacy image rollback floor before additive writes are enabled', () => {
  const input = plan('bridge')
  input.expectedOldImage = LEGACY
  input.teachingTools.rollbackImage = LEGACY
  assert.deepEqual(guardTeachingToolsCompatibility(input, image(LEGACY), image(FEATURE, CAPABILITY)), {
    capability: CAPABILITY, stage: 'bridge', rollbackImage: LEGACY, imageOnlyRollback: true, dataRestoreAllowed: false,
  })
})
test('enabled lifecycle writes require the exact compatible bridge rollback image', () => {
  assert.equal(guardTeachingToolsCompatibility(plan(), image(BRIDGE, CAPABILITY), image(FEATURE, CAPABILITY)).rollbackImage, BRIDGE)
})
test('enabled release refuses legacy rollback even when rollbackCompatible was asserted', () => {
  const input = { ...plan(), expectedOldImage: LEGACY, rollbackCompatible: true }
  input.teachingTools.rollbackImage = LEGACY
  assert.throws(() => guardTeachingToolsCompatibility(input, image(LEGACY), image(FEATURE, CAPABILITY)), /without the teaching tools bridge/)
})
test('a labelled image cannot omit the explicit lifecycle plan in either direction', () => {
  assert.throws(() => guardTeachingToolsCompatibility({}, image(BRIDGE, CAPABILITY), image(FEATURE, CAPABILITY)), /explicit lifecycle/)
  assert.throws(() => guardTeachingToolsCompatibility({}, image(BRIDGE, CAPABILITY), image(FEATURE)), /explicit lifecycle/)
  assert.throws(() => guardTeachingToolsCompatibility({}, image(LEGACY), image(FEATURE, CAPABILITY)), /explicit lifecycle/)
})
test('unknown fields and modes cannot weaken lifecycle rollback admission', () => {
  for (const mutate of [
    input => { input.teachingTools.stage = 'off' },
    input => { input.teachingTools.restoreData = true },
    input => { input.teachingTools.activityCapacity.snapshot = '/snapshot.json' },
    input => { input.teachingTools.activityCapacity.sha256 = 'unbound' },
    input => { input.teachingTools.activityCapacity.path = 'result.json' },
    input => { input.teachingTools.activityCapacity.path = '/tmp/other.json' },
    input => { delete input.teachingTools.activityCapacity },
    input => { input.teachingTools.rollbackImage = LEGACY },
    input => { input.teachingTools.capability = 'unreviewed' },
    input => { input.candidateImage = input.expectedOldImage },
    input => { input.acceptance.expectedTeachingToolsMode = 'bridge' },
    input => { delete input.acceptance.expectedTeachingToolsMode },
  ]) {
    const input = plan(); mutate(input)
    assert.throws(() => guardTeachingToolsCompatibility(input, image(BRIDGE, CAPABILITY), image(FEATURE, CAPABILITY)))
  }
})
test('bridge plans cannot attach a capacity proof or request restoring data', () => {
  const input = plan('bridge')
  input.teachingTools.activityCapacity = plan().teachingTools.activityCapacity
  assert.throws(() => guardTeachingToolsCompatibility(input, image(BRIDGE, CAPABILITY), image(FEATURE, CAPABILITY)), /enabled-only/)
})
test('image identity and both capability labels must exactly match the bound plan', () => {
  assert.throws(() => guardTeachingToolsCompatibility(plan(), image(LEGACY, CAPABILITY), image(FEATURE, CAPABILITY)))
  assert.throws(() => guardTeachingToolsCompatibility(plan(), image(BRIDGE, CAPABILITY), image(LEGACY, CAPABILITY)))
  assert.throws(() => guardTeachingToolsCompatibility(plan(), image(BRIDGE, CAPABILITY), image(FEATURE)))
  assert.throws(() => guardTeachingToolsCompatibility(plan('bridge'), image(BRIDGE, 'unknown-v2'), image(FEATURE, CAPABILITY)), /previous teaching tools/)
})
test('app-only lifecycle releases bind one exact image without rewriting unrelated env bytes', () => {
  const prior = Buffer.from(`# retained\r\nexport PHYSICSOS_APP_IMAGE = ${BRIDGE}  \r\nOTHER_IMAGE=${BRIDGE}`)
  assert.equal(envWithBoundAppImage(prior, FEATURE, BRIDGE).toString(), prior.toString().replace(`PHYSICSOS_APP_IMAGE = ${BRIDGE}`, `PHYSICSOS_APP_IMAGE = ${FEATURE}`))
  assert.throws(() => envWithBoundAppImage(prior, FEATURE, LEGACY), /identity changed/)
  assert.throws(() => envWithBoundAppImage(Buffer.concat([prior, Buffer.from(`\r\nPHYSICSOS_APP_IMAGE=${BRIDGE}`)]), FEATURE, BRIDGE), /exactly one/)
})
test('teaching mode rewrites preserve CRLF and all unrelated env bytes', () => {
  const before = Buffer.from('# retained\r\nSECRET_FILE=/run/private\r\nexport PHYSICSOS_TEACHING_TOOLS_MODE = bridge  # staged\r\nAPP=keep\r\n')
  assert.equal(envWithTeachingToolsMode(before, 'enabled').toString(), '# retained\r\nSECRET_FILE=/run/private\r\nexport PHYSICSOS_TEACHING_TOOLS_MODE = enabled  # staged\r\nAPP=keep\r\n')
  assert.equal(envWithTeachingToolsMode(Buffer.from('APP=keep'), 'bridge').toString(), 'APP=keep\nPHYSICSOS_TEACHING_TOOLS_MODE=bridge\n')
  assert.throws(() => envWithTeachingToolsMode(Buffer.from('PHYSICSOS_TEACHING_TOOLS_MODE=bridge\nPHYSICSOS_TEACHING_TOOLS_MODE=enabled\n'), 'bridge'), /at most one/)
  assert.throws(() => envWithTeachingToolsMode(before, 'off'), /Invalid/)
})
test('unrelated legacy releases keep their existing admission path', () => {
  assert.equal(guardTeachingToolsCompatibility({}, image(LEGACY), image(FEATURE)), null)
})

test('a capacity proof must be a bounded private regular file with the exact byte digest', async t => {
  const root = await temporaryDirectory(t), input = plan(), app = productionApp()
  const reference = input.teachingTools.activityCapacity = await writeCapacityProof(root)
  assert.equal(await verifyActivityCapacityProof(input, app), true)
  await chmod(reference.path, 0o400)
  assert.equal(await verifyActivityCapacityProof(input, app), true)
  await chmod(reference.path, 0o640)
  await assert.rejects(verifyActivityCapacityProof(input, app), /private/)
  await chmod(reference.path, 0o600)
  await writeFile(reference.path, Buffer.concat([bytes(capacityRecord()), Buffer.from('\n')]))
  await assert.rejects(verifyActivityCapacityProof(input, app), /SHA-256/)
  for (const badFile of ['', '{malformed', ' '.repeat(1024 * 1024 + 1)]) {
    input.teachingTools.activityCapacity = await writeCapacityProof(root, badFile)
    await assert.rejects(verifyActivityCapacityProof(input, app), /private/)
  }
  input.teachingTools.activityCapacity = await writeCapacityProof(root)
  const alias = join(root, 'alias')
  await symlink(root, alias)
  await assert.rejects(verifyActivityCapacityProof({ ...input, teachingTools: { ...input.teachingTools,
    activityCapacity: { ...input.teachingTools.activityCapacity, path: join(alias, 'result.json') } } }, app), /private/)
  const real = join(root, 'real')
  await writeFile(real, await readFile(reference.path), { mode: 0o600 })
  await rm(reference.path)
  await symlink(real, reference.path)
  await assert.rejects(verifyActivityCapacityProof(input, app), /private/)
  await rm(reference.path)
  await mkdir(reference.path, { mode: 0o700 })
  await assert.rejects(verifyActivityCapacityProof(input, app), /private/)
})

test('capacity receipts bind both successful checks, realistic opt-in inputs and the production CPU profile', async t => {
  const root = await temporaryDirectory(t), input = plan(), app = productionApp()
  for (const [key, value] of Object.entries({ scope: 'postgres', revision: '5'.repeat(40), sourceDigest: '6'.repeat(64),
    exitCode: '0', passed: 1, passedTests: 1, failedTests: 1, pendingTests: 1 })) {
    input.teachingTools.activityCapacity = await writeCapacityProof(root, { ...capacityRecord(), [key]: value })
    await assert.rejects(verifyActivityCapacityProof(input, app), /both tests/)
  }
  for (const [key, value] of Object.entries({ PHYSICSOS_ACTIVITY_RUN_CAPACITY: 1, PHYSICSOS_ACTIVITY_BASE_DAILY_USERS: '6\n',
    PHYSICSOS_ACTIVITY_EVENTS_PER_USER_DAY: '7.3', PHYSICSOS_ACTIVITY_BASE_ROSTER_USERS: '5', PHYSICSOS_ACTIVITY_BASE_SCHOOLS: '100001', UNKNOWN: '1' })) {
    const proof = capacityRecord()
    proof.inputs[key] = value
    input.teachingTools.activityCapacity = await writeCapacityProof(root, proof)
    await assert.rejects(verifyActivityCapacityProof(input, app), /baselines/)
  }
  for (const change of [
    profile => { profile.referenceContainer = 'different-app' },
    profile => { profile.runner.NanoCpus = 1_000_000_000 },
    profile => { profile.runner.CpuPeriod = '0' },
    profile => { profile.runner.CpuQuota = profile.reference.CpuQuota = 50_000 },
    profile => { delete profile.runner.CpusetCpus },
  ]) {
    const proof = capacityRecord()
    change(proof.cpuProfile)
    input.teachingTools.activityCapacity = await writeCapacityProof(root, proof)
    await assert.rejects(verifyActivityCapacityProof(input, app), /CPU profile/)
  }
})

async function switchFixture(t, stage = 'enabled', { oldLabel = CAPABILITY, oldFlag = 'false' } = {}) {
  const root = await temporaryDirectory(t), envPath = join(root, '.env')
  const modeLine = `export ${MODE_ENV} = bridge  `, capacityLine = `export ${CAPACITY_ENV} = ${oldFlag}  `
  const envText = ['# keep spacing', `PHYSICSOS_APP_IMAGE=${BRIDGE}`, 'CUSTOM_SETTING=kept', modeLine,
    ...(oldFlag === null ? [] : [capacityLine]), ''].join('\r\n')
  await writeFile(envPath, envText, { mode: 0o400 })
  await writeFile(join(root, 'compose.yml'), '# fixture compose\n')
  const secrets = {}
  for (const name of REQUIRED_SECRETS) {
    const path = join(root, name)
    await writeFile(path, 'fixture', { mode: 0o400 })
    secrets[name] = { file: path }
  }
  const usernameFile = join(root, 'username'), passwordFile = join(root, 'password'), outputDir = join(root, 'recovery')
  await writeFile(usernameFile, 'fixture-reviewer', { mode: 0o600 })
  await writeFile(passwordFile, 'fixture-password', { mode: 0o600 })
  const input = { ...plan(stage), projectDir: root, rollbackCompatible: true, minFreeBytes: 0,
    backup: { mode: 'paired', outputDir } }
  Object.assign(input.acceptance, { origin: 'http://127.0.0.1:3080', usernameFile, passwordFile,
    expectedRole: 'SUPER_ADMIN', protectedPath: '/physicsos/admin/protected' })
  if (stage === 'enabled') input.teachingTools.activityCapacity = await writeCapacityProof(root)
  const ids = { app: 'a'.repeat(64), postgres: 'b'.repeat(64), redis: 'c'.repeat(64) }
  const state = { image: BRIDGE, runtimeMode: 'bridge', runtimeFlag: oldFlag ?? 'false', app: true, postgres: true, redis: true,
    calls: [], requests: [], launches: [], captures: 0, teachingProbes: 0 }
  const labels = id => image(id, id === FEATURE ? CAPABILITY : oldLabel).Config
  const docker = async (args, options = {}) => {
    state.calls.push(args)
    const composeEnv = options.env ?? {}
    if (args.includes('config')) {
      const envIndex = args.indexOf('--env-file')
      const env = await readFile(envIndex === -1 ? envPath : args[envIndex + 1], 'utf8')
      const setting = key => composeEnv[key] ?? env.match(new RegExp(`^(?:export )?${key} *= *([^\\r\\n]+)`, 'm'))?.[1].trim()
      return bytes({ name: 'physicsos', secrets, services: { app: { image: setting('PHYSICSOS_APP_IMAGE'), environment: {
        [MODE_ENV]: setting(MODE_ENV), [CAPACITY_ENV]: state.ignoreCapacity ? 'false' : (setting(CAPACITY_ENV) ?? 'false'),
        CUSTOM_SETTING: (state.unrelatedProjectionDrift && envIndex !== -1) || (state.unrelatedRecoveryDrift && state.image === FEATURE) ? 'drift' : setting('CUSTOM_SETTING'),
      } }, postgres: { image: 'postgres:fixture' }, redis: { image: 'redis:fixture' } } })
    }
    if (args[0] === 'compose' && args.includes('ps'))
      return bytes(args.includes('--services') ? Object.keys(ids).filter(key => state[key]).join('\n') : ids[args.at(-1)])
    if (args[0] === 'ps') return bytes(Object.keys(ids).filter(key => state[key]).map(key => ids[key]).join('\n'))
    if (args[0] === 'inspect') {
      const service = Object.keys(ids).find(key => ids[key] === args[1])
      assert.ok(service)
      return bytes([{ Id: ids[service], Image: service === 'app' ? state.image : `${service}:fixture`,
        State: { Running: state[service], Health: { Status: 'healthy' } },
        Config: service === 'app' ? labels(state.image) : {}, ...(service === 'app' ? productionApp() : {}),
        Mounts: [{ Type: 'volume', Name: `${service}_data`, Source: `/volumes/${service}`,
          Destination: service === 'app' ? '/var/lib/physicsos' : '/data', RW: true }],
      }])
    }
    if (args[0] === 'image' && args[1] === 'inspect') return bytes([{ Id: args[2], Config: { Labels: { ...labels(args[2]).Labels,
      'org.opencontainers.image.revision': REVISION, 'physicsos.source.digest': SOURCE_DIGEST, 'physicsos.code.digest': CODE_DIGEST } } }])
    if (args[0] === 'tag') return bytes('')
    if (args.includes('stop')) { state.app = state.redis = false; return bytes('') }
    if (args.includes('start')) { state[args.at(-1)] = true; return bytes('') }
    if (args.includes('up')) {
      const { PHYSICSOS_APP_IMAGE: app, [MODE_ENV]: mode, [CAPACITY_ENV]: flag } = composeEnv
      state.launches.push({ app, mode, flag })
      Object.assign(state, { app: true, image: app, runtimeMode: mode, runtimeFlag: flag })
      return bytes('')
    }
    if (args.includes('exec') && args.some(arg => arg.includes('pg_locks'))) return bytes({ count: state.app ? 1 : 0, ownerMatches: true })
    if (args.includes(TEACHING_ROUTES_READINESS_SCRIPT)) {
      assert.equal(args[1], ids.app)
      assert.equal(state.image, FEATURE)
      if (++state.teachingProbes <= (state.delayedTeachingProbes ?? 0)) throw new Error('Teaching routes are not mounted')
      return bytes('')
    }
    if (args.includes('exec') && args.includes('app')) return bytes('')
    throw new Error('Unexpected fixture Docker command')
  }
  const account = { user: { username: 'fixture-reviewer', role: 'SUPER_ADMIN', schoolId: 'PHYSICSOS-OPEN' } }
  const response = (body, status = 200, headers = {}) => Response.json(body, { status, headers })
  const fetch = async (url, init) => {
    const pathname = new URL(url).pathname
    state.requests.push({ pathname, app: state.image, cookie: init.headers?.cookie })
    if (pathname === '/readyz') return response({ status: 'ready' })
    if (pathname === '/') return new Response('PhysicsOS')
    if (pathname === '/physicsos/auth/login') return response(account, 200, { 'set-cookie': 'physicsos_session=fixture; HttpOnly; Path=/' })
    if (init.headers?.cookie !== 'physicsos_session=fixture') return response({}, 401)
    if (pathname === '/physicsos/auth/me') return response(account)
    if (pathname === input.acceptance.protectedPath) {
      if (state.image === BRIDGE) await state.onOldProtectedRead?.()
      return response({ ok: true })
    }
    if (pathname === '/physicsos/learning/capabilities' && (state.image === FEATURE || oldLabel === CAPABILITY))
      return response({ schemaVersion: 1, lifecycleBridge: true, teachingToolsMode: state.runtimeMode,
        lifecycleWritesEnabled: state.runtimeMode === 'enabled', productStateEnabled: state.runtimeMode === 'enabled' })
    if (pathname === '/physicsos/activity/v1/capabilities' && state.image === FEATURE)
      return response({ schemaVersion: 1, mode: state.activityMode ?? state.runtimeMode, collectionEnabled: state.runtimeMode === 'enabled',
        queryCapacityVerified: state.activityFlag ?? (state.runtimeFlag === 'true') })
    return response({}, 404)
  }
  const capture = async options => {
    assert.equal(options.mode, 'paired')
    assert.equal(state.app || state.redis, false)
    state.captures++
    return { mode: 'paired' }
  }
  const run = async (command, args) => {
    assert.equal(command, 'git')
    return bytes(args[0] === 'ls-remote' ? `${REVISION}\trefs/heads/main` : REVISION)
  }
  const envAfter = (app, mode, flag) => {
    const env = envText.replace(BRIDGE, app).replace(modeLine, modeLine.replace('bridge', mode))
    return oldFlag === null ? `${env}${CAPACITY_ENV}=${flag}\r\n` : env.replace(capacityLine, capacityLine.replace(oldFlag, flag))
  }
  return { switchRelease: () => releaseSwitch(input, { docker, run, capture, fetch }), input, state, envPath, envText, envAfter }
}

for (const [stage, flag] of [['bridge', false], ['enabled', true]]) {
  test(`${stage} release binds the file and launch flag and verifies activity only after authenticating to the candidate`, async t => {
    const fixture = await switchFixture(t, stage, stage === 'bridge' ? { oldLabel: '', oldFlag: 'true' } : { oldFlag: null })
    const result = await fixture.switchRelease()
    assert.equal(result.checks.activityQueryCapacityVerified, flag)
    assert.deepEqual(fixture.state.launches, [{ app: FEATURE, mode: stage, flag: String(flag) }])
    assert.deepEqual(fixture.state.requests.filter(request => request.pathname === '/physicsos/activity/v1/capabilities'), [
      { pathname: '/physicsos/activity/v1/capabilities', app: FEATURE, cookie: 'physicsos_session=fixture' },
    ])
    assert.equal(fixture.state.captures, 1)
    assert.equal(await readFile(fixture.envPath, 'utf8'), fixture.envAfter(FEATURE, stage, String(flag)))
    assert.equal((await lstat(fixture.envPath)).mode & 0o777, 0o400)
  })
}

test('waits for both protected routes on the exact candidate before public acceptance', async t => {
  const f = await switchFixture(t, 'bridge', { oldLabel: '' })
  f.input.intervalMs = 5
  f.state.delayedTeachingProbes = 2
  const result = await f.switchRelease()
  assert.equal(result.deployed, true)
  assert.equal(f.state.teachingProbes, 3)
  assert.equal(f.state.requests.filter(request => request.app === FEATURE && request.pathname === '/physicsos/auth/login').length, 1)
})

test('a missing learning route times out and restores the old app without attempting its gate', async t => {
  const f = await switchFixture(t, 'bridge', { oldLabel: '' })
  f.input.intervalMs = 5
  f.input.timeoutMs = 30
  f.state.delayedTeachingProbes = Infinity
  await assert.rejects(f.switchRelease(), error => error.rollbackHealthy === true)
  assert.ok(f.state.teachingProbes >= 1)
  assert.equal(f.state.image, BRIDGE)
  assert.equal(f.state.requests.some(request => request.app === FEATURE), false)
})

test('route readiness rejects fallback pages, unprotected routes and generic authentication errors', async () => {
  const paths = ['/physicsos/learning/capabilities', '/physicsos/activity/v1/capabilities']
  const good = [{ error: '学习能力状态暂不可读取。' }, { error: { code: 'UNAUTHENTICATED' } }]
  for (const variant of ['mounted', 'missing', 'unprotected', 'generic', 'html']) {
    const process = {}, seen = []
    await runInNewContext(TEACHING_ROUTES_READINESS_SCRIPT, { AbortSignal, process, fetch: async (url, init) => {
      const path = new URL(url)
      assert.equal(path.origin, 'http://127.0.0.1:3080')
      assert.equal(init.redirect, 'error')
      const index = paths.indexOf(path.pathname)
      assert.notEqual(index, -1)
      seen.push(path.pathname)
      if (index === 1 && variant !== 'mounted') {
        if (variant === 'missing') return new Response('404', { status: 404 })
        if (variant === 'unprotected') return Response.json(good[index])
        if (variant === 'html') return new Response('<html>login</html>', { status: 401 })
        return Response.json({ error: 'sign in' }, { status: 401 })
      }
      return Response.json(good[index], { status: 401 })
    } })
    assert.deepEqual(seen, paths)
    assert.equal(process.exitCode, variant === 'mounted' ? undefined : 1)
  }
})

test('a proof changed during old-app authentication fails the immutable recheck before any stop', async t => {
  const fixture = await switchFixture(t)
  fixture.state.onOldProtectedRead = async () => { await writeCapacityProof(fixture.input.projectDir, { ...capacityRecord(), elapsedSeconds: 38 }) }
  await assert.rejects(fixture.switchRelease(), error => error.phase === 'preflight-activity-capacity' && !error.rollbackHealthy)
  assert.equal(fixture.state.calls.some(args => args.includes('stop')), false)
  assert.equal(fixture.state.captures, 0)
  assert.equal(await readFile(fixture.envPath, 'utf8'), fixture.envText)
})

test('the capacity exception never masks unrelated env drift or an unbound Compose capacity flag', async t => {
  for (const fault of ['unrelatedProjectionDrift', 'ignoreCapacity']) {
    const fixture = await switchFixture(t)
    fixture.state[fault] = true
    await assert.rejects(fixture.switchRelease(), error => error.phase === 'preflight-teaching-env')
    assert.equal(fixture.state.calls.some(args => args.includes('stop')), false)
    assert.equal(await readFile(fixture.envPath, 'utf8'), fixture.envText)
  }
})

test('activity acceptance mismatch recreates only the previous image in bridge mode with the capacity flag false', async t => {
  for (const change of [state => { state.activityFlag = false }, state => { state.activityMode = 'bridge' }]) {
    const fixture = await switchFixture(t, 'enabled', { oldFlag: 'true' })
    change(fixture.state)
    await assert.rejects(fixture.switchRelease(), error => error.phase === 'acceptance' && error.rollbackHealthy)
    assert.deepEqual(fixture.state.launches, [{ app: FEATURE, mode: 'enabled', flag: 'true' }, { app: BRIDGE, mode: 'bridge', flag: 'false' }])
    assert.equal(fixture.state.captures, 1)
    assert.equal(fixture.state.requests.some(request => request.app === BRIDGE && request.pathname === '/physicsos/activity/v1/capabilities'), false)
    assert.equal(await readFile(fixture.envPath, 'utf8'), fixture.envAfter(BRIDGE, 'bridge', 'false'))
    assert.equal((await lstat(fixture.envPath)).mode & 0o777, 0o400)
  }
})

test('recovery refuses an unrelated Compose env difference instead of treating it as a teaching override', async t => {
  const fixture = await switchFixture(t)
  fixture.state.activityFlag = false
  fixture.state.unrelatedRecoveryDrift = true
  await assert.rejects(fixture.switchRelease(), error => error.phase === 'acceptance' && !error.rollbackHealthy)
  assert.deepEqual(fixture.state.launches, [{ app: FEATURE, mode: 'enabled', flag: 'true' }])
  assert.equal(fixture.state.app || fixture.state.redis, false)
})
