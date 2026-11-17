import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, chmod, lstat } from 'node:fs/promises'
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
const WORKER_OLD = `sha256:${'7'.repeat(64)}`
const WORKER_NEW = `sha256:${'8'.repeat(64)}`
const WORKER_INPUTS = '9'.repeat(64)
const WORKER_NAME = 'physicsos-validation-worker-1'
const OPERATION_LABEL = 'io.physicsos.release.operation'
const CREATE_LABEL = 'io.physicsos.release.create'
const jsonHash = value => {
  const order = item => Array.isArray(item) ? item.map(order) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, order(entry)])) : item
  return createHash('sha256').update(JSON.stringify(order(value))).digest('hex')
}
const CONTAINERS = { app: 'a'.repeat(64), postgres: 'b'.repeat(64), redis: 'c'.repeat(64), foreign: 'd'.repeat(64), replacement: 'e'.repeat(64),
  worker: 'f'.repeat(64), workerNew: '0'.repeat(64), workerRollback: '1'.repeat(64), workerForeign: '2'.repeat(64) }
const containerIdLike = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const bytes = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
const releaseModule = () => import('./release-switch.mjs').catch(() => ({}))

async function fixture(t, { withWorker = false, envText, envMode = 0o600 } = {}) {
  const { releaseSwitch } = await releaseModule()
  assert.equal(typeof releaseSwitch, 'function', 'guarded reusable release switching is missing')
  const root = await mkdtemp(join(tmpdir(), 'physicsos-release-switch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prior = envText ?? `# retained settings\nCUSTOM_SETTING=keep\nPHYSICSOS_APP_IMAGE=${OLD}\n${withWorker ? `PHYSICSOS_VALIDATION_IMAGE=${WORKER_OLD}\n` : ''}`
  await writeFile(join(root, '.env'), prior, { mode: envMode })
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
  const state = { app: true, redis: true, postgres: true, image: OLD, mode: '', events: [], changed: false, calls: [], tags: [], activeUp: 0, maxActiveUp: 0,
    activeMutation: 0, maxActiveMutation: 0, creates: [], removedWorkerIds: [], nativeWorkerStarts: [], extraWorkers: [],
    worker: withWorker, workerStatus: withWorker ? 'running' : undefined, workerImage: WORKER_OLD, workerId: withWorker ? CONTAINERS.worker : null,
    workerHealthy: true, workerCreated: '2026-01-01T00:00:00.000Z', businessData: 'original-business-data' }
  const config = { name: 'physicsos', secrets, services: { app: { image: OLD, environment: { PHYSICSOS_STORAGE_SCHEMA: 'physicsos' } }, postgres: { image: 'postgres:fixture' }, redis: { image: 'redis:fixture' } } }
  const workerToken = join(root, 'worker-token'), seccompFile = join(root, 'worker-seccomp.json')
  const oldWorkerImage = { Id: WORKER_OLD, Os: 'linux', Architecture: 'amd64', Config: { User: 'pwuser', WorkingDir: '/app', Entrypoint: ['node'], Cmd: ['worker.mjs'], Env: ['PATH=/usr/bin'], Labels: {} }, RootFS: { Type: 'layers', Layers: [`sha256:${'a'.repeat(64)}`] }, RepoDigests: [] }
  const newWorkerImage = structuredClone(oldWorkerImage)
  newWorkerImage.Id = WORKER_NEW
  newWorkerImage.Config.Labels = { 'org.opencontainers.image.revision': REVISION, 'io.physicsos.worker.inputs': WORKER_INPUTS }
  newWorkerImage.RootFS.Layers.push(`sha256:${'b'.repeat(64)}`)
  const workerHostConfig = { ReadonlyRootfs: true, Privileged: false, AutoRemove: false, OomKillDisable: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true', 'seccomp=fixture-profile'],
    Binds: [`${workerToken}:/run/secrets/ui_validation_token:ro`], PortBindings: {}, Tmpfs: { '/tmp': 'size=256m,mode=1777' },
    RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }, Memory: 1024 ** 3, NanoCpus: 1_000_000_000, NetworkMode: 'physicsos_default' }
  const workerMounts = [{ Type: 'bind', Source: workerToken, Destination: '/run/secrets/ui_validation_token', Mode: 'ro', RW: false, Propagation: 'rprivate' },
    { Type: 'tmpfs', Source: '', Destination: '/tmp', Mode: '', RW: true, Propagation: '' }]
  if (withWorker) {
    await writeFile(workerToken, 'fixture-worker-token-never-output', { mode: 0o400 })
    await writeFile(seccompFile, '{"defaultAction":"SCMP_ACT_ERRNO"}\n')
    secrets.ui_validation_token = { file: workerToken }
    config.services['validation-worker'] = { image: WORKER_OLD, environment: { PHYSICSOS_VALIDATION_PORT: '8099', PHYSICSOS_VALIDATION_TOKEN_FILE: '/run/secrets/ui_validation_token' },
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true', `seccomp=${seccompFile}`],
      volumes: [{ type: 'bind', source: workerToken, target: '/run/secrets/ui_validation_token', read_only: true }], tmpfs: ['/tmp:size=256m,mode=1777'] }
  }
  const workerHash = image => createHash('sha256').update(JSON.stringify({ ...config.services['validation-worker'], image })).digest('hex')
  if (withWorker) state.workerConfigHash = workerHash(WORKER_OLD)
  const envImage = async name => (await readFile(join(root, '.env'), 'utf8')).match(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*([^\\r\\n]+)`, 'm'))?.[1].trim()
  const inspectWorker = async () => {
    const image = state.workerImage === WORKER_NEW ? newWorkerImage : oldWorkerImage
    const body = state.workerCreateBody
    let workerConfig
    if (body) {
      const { HostConfig, NetworkingConfig, ...config } = body
      workerConfig = structuredClone(config)
      workerConfig.Hostname ||= state.workerId.slice(0, 12)
      if (state.workerId === state.daemonCreatedId) {
        const journal = JSON.parse(await readFile(join(root, 'paired-worker-release', 'paired-recovery.json'), 'utf8'))
        assert.ok(journal.validationWorker.creates.some(create => create.containerId === state.workerId), 'daemon CID must be privately recorded before inspect')
        const owner = JSON.parse(await readFile(join(root, '.physicsos-release', 'validation-worker.json'), 'utf8'))
        assert.equal(owner.containerId, state.workerId, 'current ownership must be private before inspect/start')
      }
    } else {
      workerConfig = { ...image.Config, Hostname: state.workerId.slice(0, 12), Image: state.workerRuntimeImageRef ?? state.workerImage,
        Env: [...image.Config.Env, 'PHYSICSOS_VALIDATION_PORT=8099', 'PHYSICSOS_VALIDATION_TOKEN_FILE=/run/secrets/ui_validation_token'],
        Healthcheck: { Test: ['CMD', 'node', 'health.mjs'], Interval: 30_000_000_000, Timeout: 5_000_000_000, Retries: 3 },
        Labels: { ...image.Config.Labels, 'com.docker.compose.project': 'physicsos', 'com.docker.compose.service': 'validation-worker',
          'com.docker.compose.container-number': '1', 'com.docker.compose.oneoff': 'False', 'com.docker.compose.config-hash': state.workerConfigHash,
          'com.docker.compose.image': state.workerImage } }
    }
    workerConfig = { ...workerConfig, ...state.workerConfigOverride, Labels: { ...workerConfig.Labels, ...state.workerLabels } }
    const endpoint = body?.NetworkingConfig.EndpointsConfig.physicsos_default ?? { NetworkID: 'fixture-network', IPAMConfig: null, Links: null,
      DriverOpts: null, Aliases: [WORKER_NAME, 'validation-worker', state.workerId.slice(0, 12)] }
    const marker = state.workerLastUp && `worker-${state.workerLastUp}-healthy`
    if (marker && state.worker && state.workerHealthy && !state.events.includes(marker)) state.events.push(marker)
    return { Id: state.workerId, Image: state.workerImage, Created: state.workerCreated, Name: state.workerName ?? `/${WORKER_NAME}`,
      State: { Status: state.workerStatus, Running: state.worker, ...(state.worker ? { Health: { Status: state.workerHealthy ? 'healthy' : 'unhealthy' } } : {}) },
      Config: workerConfig, HostConfig: { ...(body?.HostConfig ?? workerHostConfig), ...state.workerHostOverride },
      Mounts: state.workerMounts ?? (state.worker ? workerMounts : []),
      NetworkSettings: { Ports: state.workerPorts ?? (state.worker ? { '8099/tcp': null } : {}), Networks: { physicsos_default: { ...endpoint,
        NetworkID: state.worker ? 'fixture-network' : '', EndpointID: state.worker ? 'fixture-endpoint' : '', IPAddress: state.worker ? '172.20.0.10' : '' } } } }
  }
  const foreignWorker = body => {
    const labels = { ...body.Labels }
    delete labels[OPERATION_LABEL]
    delete labels[CREATE_LABEL]
    const { HostConfig, NetworkingConfig, ...config } = body
    return { Id: CONTAINERS.workerForeign, Image: body.Image, Created: new Date().toISOString(), Name: `/${WORKER_NAME}`,
      State: { Status: 'created', Running: false }, Config: { ...config, Hostname: CONTAINERS.workerForeign.slice(0, 12), Labels: labels },
      HostConfig, Mounts: [], NetworkSettings: { Ports: {}, Networks: { physicsos_default: { ...NetworkingConfig.EndpointsConfig.physicsos_default, NetworkID: '', IPAddress: '' } } } }
  }
  const docker = async (args, options = {}) => {
    state.calls.push({ args: [...args], imageEnv: options.env ? { app: options.env.PHYSICSOS_APP_IMAGE, worker: options.env.PHYSICSOS_VALIDATION_IMAGE } : null })
    if (['stop', 'rm', 'start'].includes(args[0]) && containerIdLike(args.at(-1))) {
      const id = args.at(-1)
      const extra = state.extraWorkers.find(worker => worker.Id === id)
      assert.ok(id === state.workerId || extra, 'native worker mutation requires an exact existing full CID')
      if (args[0] === 'stop') {
        if (extra) extra.State.Running = false
        else { state.worker = false; if (state.workerStatus !== 'created') state.workerStatus = 'exited' }
        state.events.push(`worker-stop:${id}`)
        return bytes('')
      }
      if (args[0] === 'rm') {
        assert.equal(extra ? extra.State.Running : state.worker, false)
        state.removedWorkerIds.push(id)
        if (extra) state.extraWorkers = state.extraWorkers.filter(worker => worker.Id !== id)
        else { state.workerId = null; state.worker = false; state.workerCreateBody = undefined }
        state.events.push(`worker-rm:${id}`)
        return bytes('')
      }
      assert.equal(state.activeMutation, 0, 'API create/start and app up must be serial')
      const owner = JSON.parse(await readFile(join(root, '.physicsos-release', 'validation-worker.json'), 'utf8'))
      assert.equal(owner.containerId, id)
      assert.equal(owner.operationNonce, state.workerCreateBody.Labels[OPERATION_LABEL])
      assert.equal(owner.createNonce, state.workerCreateBody.Labels[CREATE_LABEL])
      state.nativeWorkerStarts.push(id)
      state.activeMutation++
      state.maxActiveMutation = Math.max(state.maxActiveMutation, state.activeMutation)
      try {
        await Promise.resolve()
        if (state.workerImage === WORKER_NEW && state.mode === 'worker-start-failure') throw new Error('fixture start failed with a legitimately created container')
        state.worker = true
        state.workerStatus = 'running'
        state.events.push(state.workerImage === WORKER_NEW ? 'worker-candidate-start' : 'worker-rollback-start')
        return bytes('')
      } finally { state.activeMutation-- }
    }
    if (args.includes('stop')) {
      for (const service of args.slice(args.indexOf('--timeout') + 2)) state[service] = false
      if (state.mode === 'replacement-on-stop') state.replaced = true
      state.events.push('stop')
      if (state.mode === 'partial-stop') throw new Error('fixture stop failed after stopping services')
      return bytes('')
    }
    if (args.includes('start')) {
      for (const service of args.slice(args.indexOf('start') + 1)) {
        if (withWorker) { assert.equal(state.workerHealthy, true, 'worker health must precede service startup'); state.events.push(`start:${service}`) }
        state[service] = true
      }
      state.events.push('start')
      return bytes('')
    }
    if (args.includes('up')) {
      assert.equal(state.activeUp, 0, 'Compose up operations must be serial')
      state.activeUp++
      state.maxActiveUp = Math.max(state.maxActiveUp, state.activeUp)
      try {
        assert.notEqual(args.at(-1), 'validation-worker', 'worker must never use native Compose up/recreate')
        assert.equal(state.activeMutation, 0, 'API create/start and app up must be serial')
        state.activeMutation++
        state.maxActiveMutation = Math.max(state.maxActiveMutation, state.activeMutation)
        state.image = options.env?.PHYSICSOS_APP_IMAGE ?? await envImage('PHYSICSOS_APP_IMAGE')
        if (withWorker) {
          assert.equal(state.workerImage, state.workerLastUp ? options.env?.PHYSICSOS_VALIDATION_IMAGE : WORKER_OLD)
          assert.equal(state.workerHealthy, true)
          assert.equal(Boolean(state.workerPartial), false)
          if (state.image === NEW) state.businessData = 'post-cutover-business-data'
        }
        state.app = true
        state.events.push(state.image === NEW ? 'candidate' : 'rollback')
        if (state.image === NEW && state.onCandidate) await state.onCandidate()
        if (state.image === OLD && state.onRollback) await state.onRollback()
        return bytes('')
      } finally { state.activeUp--; if (args.at(-1) !== 'validation-worker') state.activeMutation-- }
    }
    if (args.includes(RESTORE_READINESS_SCRIPT)) {
      if (state.image === NEW && state.mode === 'readiness') throw new Error('fixture readiness failure')
      return bytes('')
    }
    if (args.includes('config')) {
      const current = structuredClone(config)
      if (withWorker) {
        current.services.app.image = options.env?.PHYSICSOS_APP_IMAGE ?? await envImage('PHYSICSOS_APP_IMAGE')
        current.services['validation-worker'].image = state.fixedWorkerImage ?? options.env?.PHYSICSOS_VALIDATION_IMAGE ?? await envImage('PHYSICSOS_VALIDATION_IMAGE')
        if (state.projectedDrift && options.env?.PHYSICSOS_VALIDATION_IMAGE === WORKER_NEW) current.services['validation-worker'].ports = [{ target: 8099, published: '18099' }]
      }
      if (args.includes('--hash')) return bytes(`validation-worker ${workerHash(current.services['validation-worker'].image)}\n`)
      return bytes(current)
    }
    if (args[0] === 'compose' && args.includes('ps') && args.includes('--services')) return bytes([...['app', 'postgres', 'redis'].filter(name => state[name]), ...(state.worker || state.extraWorkers.some(worker => worker.State.Running) ? ['validation-worker'] : [])].join('\n'))
    if (args[0] === 'compose' && args.includes('ps') && args.includes('--quiet')) return bytes(args.at(-1) === 'validation-worker' ? state.workerId ?? '' : CONTAINERS[args.at(-1)])
    if (args[0] === 'ps') {
      const filters = args.flatMap((arg, index) => arg === '--filter' ? [args[index + 1]] : [])
      if (filters.length) {
        // Enumeration exposes created containers before their ports/networks exist.
        // It does not require an ownership journal until a subsequent inspect.
        const candidates = [...(state.workerId ? [{ Id: state.workerId, Name: state.workerName ?? `/${WORKER_NAME}`,
          Config: { Labels: { ...(state.workerCreateBody?.Labels ?? { 'com.docker.compose.project': 'physicsos', 'com.docker.compose.service': 'validation-worker' }), ...state.workerLabels } } }] : []), ...state.extraWorkers]
        const matches = worker => filters.every(filter => {
          if (filter.startsWith('name=')) return new RegExp(filter.slice(5)).test(worker.Name)
          const [key, ...rest] = filter.slice('label='.length).split('=')
          return worker.Config.Labels[key] === rest.join('=')
        })
        return bytes(candidates.filter(matches).map(worker => worker.Id).join('\n'))
      }
      const names = [...['app', 'postgres', 'redis'].filter(name => state[name]), ...(state.mode === 'early-writer' || (!state.app && state.mode === 'late-writer') ? ['foreign'] : [])]
      const ids = [...names.map(name => CONTAINERS[name]), ...(state.worker && state.workerId ? [state.workerId] : []), ...state.extraWorkers.filter(worker => worker.State.Running).map(worker => worker.Id)]
      return bytes(ids.map(id => args.includes('--no-trunc') ? id : id.slice(0, 12)).join('\n'))
    }
    if (args[0] === 'inspect') {
      const extra = state.extraWorkers.find(worker => worker.Id === args[1])
      if (extra) return bytes([extra])
      if (state.workerId && state.workerId.startsWith(args[1])) return bytes([await inspectWorker()])
      const name = Object.keys(CONTAINERS).find(name => CONTAINERS[name].startsWith(args[1]))
      if (!name) throw new Error('Unhandled fixture container ID')
      if (name === 'foreign') return bytes([{ Id: CONTAINERS.foreign, Mounts: [{ Type: 'bind', Source: '/volumes/app', RW: true }] }])
      return bytes([{ Id: name === 'app' && state.replaced ? CONTAINERS.replacement : CONTAINERS[name], Image: name === 'app' ? state.image : `sha256:${name}`, State: { Running: state[name], Health: { Status: 'healthy' } }, NetworkSettings: name === 'app' ? { Networks: { private: { IPAddress: '172.20.0.5' } } } : {}, Config: { Labels: {} }, Mounts: [{ Type: 'volume', Name: `physicsos_${name}_data`, Source: `/volumes/${name}`, Destination: name === 'app' ? '/var/lib/physicsos' : name === 'redis' ? '/data' : '/var/lib/postgresql/data', RW: true }] }])
    }
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (args[2] === WORKER_OLD) return bytes([oldWorkerImage])
      if (args[2] === WORKER_NEW) return bytes([newWorkerImage])
      return bytes([{ Id: args[2], Config: { Labels: { 'org.opencontainers.image.revision': REVISION, 'physicsos.source.digest': DIGEST, 'physicsos.code.digest': CODE_DIGEST } }, RepoDigests: [] }])
    }
    if (args.includes('exec') && args.some(arg => arg.includes('pg_locks'))) {
      const sql = args.find(arg => arg.includes('pg_locks'))
      state.leaseSql = sql
      // PostgreSQL inet::text includes /32; host(inet) matches Docker's bare address.
      const owner = sql.includes('host(a.client_addr)') ? '172.20.0.5' : '172.20.0.5/32'
      return bytes({ count: state.app ? 1 : 0, ownerMatches: owner === '172.20.0.5' })
    }
    if (args[0] === 'tag') { state.tags.push(args.slice(1)); return bytes('') }
    throw new Error(`Unhandled fixture Docker command: ${args[0]}`)
  }
  const createWorker = async options => {
    assert.equal(withWorker, true)
    assert.equal(state.app, false)
    assert.equal(state.redis, false)
    assert.equal(state.workerId, null, 'the old worker must be removed by exact CID before create')
    assert.ok(state.events.includes('capture'), 'Engine create must happen after the one paired capture')
    assert.equal(options.name, WORKER_NAME)
    assert.match(options.body.Image, /^sha256:[0-9a-f]{64}$/)
    assert.equal(await envImage('PHYSICSOS_VALIDATION_IMAGE'), options.body.Image)
    assert.match(options.body.Labels[OPERATION_LABEL], /^[0-9a-f]{64}$/)
    assert.match(options.body.Labels[CREATE_LABEL], /^[0-9a-f]{64}$/)
    assert.equal(state.activeMutation, 0)
    state.activeMutation++
    state.maxActiveMutation = Math.max(state.maxActiveMutation, state.activeMutation)
    state.creates.push(structuredClone(options))
    const candidate = options.body.Image === WORKER_NEW
    state.events.push(candidate ? 'worker-candidate' : 'worker-rollback')
    try {
      await Promise.resolve()
      if (candidate && state.mode === 'worker-unresolved-create') {
        const error = new Error('fixture socket lost with no attributable daemon object')
        error.createUncertain = true
        throw error
      }
      if (candidate && ['worker-create-rejected', 'worker-foreign-same-window'].includes(state.mode)) {
        if (state.mode === 'worker-foreign-same-window') state.extraWorkers.push(foreignWorker(options.body))
        const error = new Error('fixture daemon rejected create without returning an ID')
        error.createUncertain = false
        throw error
      }
      state.workerImage = options.body.Image
      state.workerId = candidate ? CONTAINERS.workerNew : CONTAINERS.workerRollback
      state.daemonCreatedId = state.workerId
      state.worker = false
      state.workerStatus = 'created'
      state.workerCreated = new Date().toISOString()
      state.workerCreateBody = structuredClone(options.body)
      state.workerLabels = undefined
      state.workerConfigHash = options.body.Labels['com.docker.compose.config-hash']
      state.workerHealthy = candidate ? !['worker-health', 'worker-rollback-health'].includes(state.mode) : state.mode !== 'worker-rollback-health'
      state.workerLastUp = candidate ? 'candidate' : 'rollback'
      if (state.onCreate) await state.onCreate(options)
      if (candidate && state.mode === 'worker-create-timeout') {
        const error = new Error('fixture socket timeout after a daemon-accepted create')
        error.createUncertain = true
        throw error
      }
      return { Id: state.workerId, Warnings: [] }
    } finally { state.activeMutation-- }
  }
  const writeWorkerOwnership = async () => {
    const worker = await inspectWorker(), config = structuredClone(worker.Config)
    config.Hostname = ''
    const endpoint = worker.NetworkSettings.Networks.physicsos_default
    const body = { ...config, HostConfig: { ...worker.HostConfig, OomKillDisable: false }, NetworkingConfig: { EndpointsConfig: { physicsos_default: {
      NetworkID: 'fixture-network', IPAMConfig: null, Links: null, DriverOpts: null,
      Aliases: endpoint.Aliases.filter(alias => ![worker.Id, worker.Id.slice(0, 12)].includes(alias)) } } } }
    const file = join(root, '.physicsos-release', 'validation-worker.json')
    await mkdir(join(root, '.physicsos-release'), { mode: 0o700 })
    await writeFile(file, JSON.stringify({ format: 'physicsos-validation-worker/1', containerId: worker.Id, image: worker.Image,
      operationNonce: worker.Config.Labels[OPERATION_LABEL], createNonce: worker.Config.Labels[CREATE_LABEL],
      configHash: worker.Config.Labels['com.docker.compose.config-hash'], labelsSha256: jsonHash(worker.Config.Labels), requestSha256: jsonHash(body) }), { mode: 0o600 })
    return file
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
    state.capturedImages = structuredClone(options.source.images)
    if (withWorker) {
      assert.equal(state.workerImage, WORKER_OLD, 'capture must still see the old worker')
      assert.equal(state.workerId, CONTAINERS.worker)
      assert.equal(await envImage('PHYSICSOS_VALIDATION_IMAGE'), WORKER_OLD, 'preflight must not advance production worker env')
    }
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
  const workerPlan = { ...plan, recoveryDir: join(root, 'paired-worker-release'), backup: { mode: 'paired', outputDir: join(root, 'paired-worker-release') },
    validationWorker: { service: 'validation-worker', imageEnv: 'PHYSICSOS_VALIDATION_IMAGE', expectedOldImage: WORKER_OLD, candidateImage: WORKER_NEW,
      expectedOldContainerId: CONTAINERS.worker, inputsSha256: WORKER_INPUTS } }
  return { root, prior, state, config, plan, workerPlan, workerToken, seccompFile, workerHash, oldWorkerImage, newWorkerImage, workerHostConfig, workerMounts,
    inspectWorker, foreignWorker, writeWorkerOwnership, hook, releaseSwitch, dependencies: { docker, run, capture, ...(withWorker ? { createWorker } : {}) } }
}

test('release excludes its own app and Redis when Docker inspect returns canonical container IDs', async t => {
  const f = await fixture(t)
  const result = await f.releaseSwitch(f.plan, f.dependencies)
  assert.equal(result.deployed, true)
  assert.equal(f.state.image, NEW)
  assert.equal(f.state.events.filter(event => event === 'capture').length, 1)
})

test('a foreign container sharing the app data path is rejected before stopping production', async t => {
  const f = await fixture(t)
  f.state.mode = 'early-writer'
  await assert.rejects(f.releaseSwitch(f.plan, f.dependencies), error => error.phase === 'preflight-identity')
  assert.equal(f.state.events.includes('stop'), false)
  assert.equal(f.state.app, true)
  assert.equal(f.state.redis, true)
})

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

test('without a worker plan the existing worker and app-only release receipts remain untouched', async t => {
  const f = await fixture(t, { withWorker: true })
  const result = await f.releaseSwitch(f.plan, f.dependencies)
  assert.equal(result.deployed, true)
  assert.equal(Object.hasOwn(result, 'validationWorker'), false)
  assert.equal(f.state.workerId, CONTAINERS.worker)
  assert.equal(f.state.workerImage, WORKER_OLD)
  assert.equal(f.state.calls.some(call => call.args.includes('up') && call.args.at(-1) === 'validation-worker'), false)
  assert.equal(f.state.tags.length, 1)
  assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior.replace(OLD, NEW))
  const receipt = JSON.parse(await readFile(join(result.recovery, 'success.json'), 'utf8'))
  assert.equal(Object.hasOwn(receipt, 'validationWorker'), false)
})

for (const [name, change] of [
  ['another service', worker => { worker.service = 'redis' }],
  ['another env name', worker => { worker.imageEnv = 'PHYSICSOS_APP_IMAGE' }],
  ['companions', worker => { worker.companions = ['searxng'] }],
  ['environment overrides', worker => { worker.environment = { CUSTOM_SETTING: 'changed' } }],
  ['extra env field', worker => { worker.env = 'PHYSICSOS_SEARXNG_IMAGE' }],
  ['extra mount field', worker => { worker.tokenMount = '/unexpected' }],
  ['missing full container ID', worker => { delete worker.expectedOldContainerId }],
  ['truncated container ID', worker => { worker.expectedOldContainerId = CONTAINERS.worker.slice(0, 12) }],
  ['tag instead of candidate ID', worker => { worker.candidateImage = 'physicsos-validation:latest' }],
  ['truncated old image', worker => { worker.expectedOldImage = WORKER_OLD.slice(0, 19) }],
  ['prefixed inputs digest', worker => { worker.inputsSha256 = `sha256:${WORKER_INPUTS}` }],
  ['identical worker images', worker => { worker.candidateImage = WORKER_OLD }],
]) {
  test(`worker schema rejects ${name} before any Docker command or stop`, async t => {
    const f = await fixture(t, { withWorker: true })
    change(f.workerPlan.validationWorker)
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.phase === 'preflight')
    assert.equal(f.state.calls.length, 0)
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior)
  })
}

for (const invalid of [null, undefined, []]) {
  test(`an explicitly invalid worker plan (${String(invalid)}) is not treated as the default path`, async t => {
    const f = await fixture(t, { withWorker: true })
    await assert.rejects(f.releaseSwitch({ ...f.workerPlan, validationWorker: invalid }, f.dependencies), error => error.phase === 'preflight')
    assert.equal(f.state.calls.length, 0)
  })
}

test('worker plan requires one paired recovery rather than a full-backup policy', async t => {
  const f = await fixture(t, { withWorker: true })
  await assert.rejects(f.releaseSwitch({ ...f.workerPlan, backup: f.plan.backup }, f.dependencies), error => error.phase === 'preflight')
  assert.equal(f.state.events.includes('stop'), false)
})

for (const [name, change] of [
  ['unexpected full ID', f => { f.state.workerId = CONTAINERS.workerForeign }],
  ['missing container', f => { f.state.workerId = null; f.state.worker = false }],
  ['wrong image', f => { f.state.workerImage = NEW }],
  ['wrong name', f => { f.state.workerName = '/unrelated-validation-worker' }],
  ['wrong Compose project', f => { f.state.workerLabels = { 'com.docker.compose.project': 'other' } }],
  ['wrong Compose service', f => { f.state.workerLabels = { 'com.docker.compose.service': 'app' } }],
  ['one-off container', f => { f.state.workerLabels = { 'com.docker.compose.oneoff': 'True' } }],
  ['unhealthy worker', f => { f.state.workerHealthy = false }],
  ['read-write rootfs', f => { f.state.workerHostOverride = { ReadonlyRootfs: false } }],
  ['app data bind', f => { f.state.workerMounts = [...f.workerMounts, { Type: 'bind', Source: '/volumes/app', Destination: '/business', RW: true }] }],
  ['PostgreSQL data bind', f => { f.state.workerMounts = [...f.workerMounts, { Type: 'bind', Source: '/volumes/postgres', Destination: '/business', RW: true }] }],
  ['business data volume', f => { f.state.workerMounts = [...f.workerMounts, { Type: 'volume', Name: 'physicsos_app_data', Source: '/volumes/app', Destination: '/business', RW: false }] }],
  ['writable token mount', f => { f.state.workerMounts = f.workerMounts.map(mount => mount.Type === 'bind' ? { ...mount, RW: true } : mount) }],
  ['effective Compose hash drift', f => { f.config.services['validation-worker'].ports = [{ target: 8099, published: '18099' }] }],
  ['candidate Compose changes another field', f => { f.state.projectedDrift = true }],
]) {
  test(`worker preflight rejects ${name} without stopping app or Redis`, async t => {
    const f = await fixture(t, { withWorker: true })
    change(f)
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.phase.startsWith('preflight'))
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.app, true)
    assert.equal(f.state.redis, true)
    assert.equal(f.state.events.includes('capture'), false)
  })
}

for (const [name, value] of [['unset', undefined], ['null', null], ['false', false]]) {
  test(`worker OomKillDisable ${name} becomes explicit daemon false without changing other fields`, async t => {
    const f = await fixture(t, { withWorker: true })
    if (value === undefined) delete f.workerHostConfig.OomKillDisable
    else f.workerHostConfig.OomKillDisable = value
    const result = await f.releaseSwitch(f.workerPlan, f.dependencies)
    assert.equal(result.deployed, true)
    assert.equal(f.state.creates[0].body.HostConfig.OomKillDisable, false)
    assert.deepEqual(f.state.creates[0].body.HostConfig, { ...f.workerHostConfig, OomKillDisable: false })
    const running = await f.inspectWorker()
    assert.equal(running.HostConfig.OomKillDisable, false)
    const owner = JSON.parse(await readFile(join(f.root, '.physicsos-release', 'validation-worker.json'), 'utf8'))
    assert.equal(owner.requestSha256, jsonHash(f.state.creates[0].body))
  })
}

for (const [name, value] of [['true', true], ['zero', 0], ['string', 'false'], ['array', []], ['object', {}]]) {
  test(`worker preflight rejects OomKillDisable ${name} before any stop/create`, async t => {
    const f = await fixture(t, { withWorker: true })
    f.workerHostConfig.OomKillDisable = value
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.phase === 'preflight-validation-worker')
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.removedWorkerIds.length, 0)
    assert.equal(f.state.creates.length, 0)
  })
}

test('OomKillDisable normalization does not hide other HostConfig drift', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.mode = 'auth'
  f.state.onCandidate = () => { f.state.workerHostOverride = { OomKillDisable: undefined, Memory: 2 * 1024 ** 3 } }
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === false)
  assert.equal(f.state.events.includes('worker-rollback'), false)
  assert.deepEqual(f.state.removedWorkerIds, [CONTAINERS.worker])
  assert.equal(f.state.app, false)
  assert.equal(f.state.redis, false)
})

for (const [name, configure] of [
  ['service-level MAC', service => { service.mac_address = '02:42:ac:14:00:09' }],
  ['logical default MAC on physical physicsos_default', service => { service.networks = { default: { mac_address: '02:42:ac:14:00:09' } } }],
]) {
  test(`unsupported worker ${name} fails closed before stop/remove/create`, async t => {
    const f = await fixture(t, { withWorker: true }), docker = f.dependencies.docker
    configure(f.config.services['validation-worker'])
    // Keep Compose hash valid so a hash-drift failure cannot mask the MAC guard.
    f.state.workerConfigHash = f.workerHash(WORKER_OLD)
    f.dependencies.docker = async (args, options) => {
      const result = await docker(args, options)
      if (args[0] === 'inspect' && args[1] === CONTAINERS.worker) {
        const containers = JSON.parse(result.toString('utf8'))
        containers[0].NetworkSettings.Networks.physicsos_default.MacAddress = '02:42:ac:14:00:09'
        return bytes(containers)
      }
      return result
    }
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.phase === 'preflight-validation-worker')
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.events.includes('capture'), false)
    assert.equal(f.state.app, true)
    assert.equal(f.state.redis, true)
    assert.equal(f.state.removedWorkerIds.length, 0)
    assert.equal(f.state.creates.length, 0)
  })
}

for (const [name, change] of [
  ['image identity', image => { image.Id = NEW }],
  ['OCI revision', image => { image.Config.Labels['org.opencontainers.image.revision'] = 'a'.repeat(40) }],
  ['inputs digest', image => { image.Config.Labels['io.physicsos.worker.inputs'] = 'a'.repeat(64) }],
  ['inherited user', image => { image.Config.User = 'root' }],
  ['inherited environment', image => { image.Config.Env.push('EXTRA_ENV=unexpected') }],
  ['inherited command', image => { image.Config.Cmd = ['different-worker.mjs'] }],
  ['platform', image => { image.Architecture = 'arm64' }],
  ['RootFS prefix', image => { image.RootFS.Layers[0] = `sha256:${'c'.repeat(64)}` }],
  ['more than one new layer', image => { image.RootFS.Layers.push(`sha256:${'c'.repeat(64)}`) }],
]) {
  test(`worker candidate rejects changed ${name} before downtime`, async t => {
    const f = await fixture(t, { withWorker: true })
    change(f.newWorkerImage)
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.phase === 'preflight-validation-worker')
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.workerId, CONTAINERS.worker)
  })
}

test('paired release captures once, Engine-creates worker with nonce proof, then starts Redis and app', async t => {
  const f = await fixture(t, { withWorker: true })
  const result = await f.releaseSwitch(f.workerPlan, f.dependencies)
  assert.equal(result.deployed, true)
  assert.deepEqual(result.validationWorker, { image: WORKER_NEW, containerId: CONTAINERS.workerNew })
  const relevant = new Set(['stop', 'capture', 'worker-candidate', 'worker-candidate-healthy', 'start:redis', 'candidate'])
  assert.deepEqual(f.state.events.filter(event => relevant.has(event)), ['stop', 'capture', 'worker-candidate', 'worker-candidate-healthy', 'start:redis', 'candidate'])
  assert.equal(f.state.maxActiveUp, 1)
  assert.equal(f.state.events.filter(event => event === 'capture').length, 1)
  assert.equal(f.state.capturedImages['validation-worker'].id, WORKER_OLD)
  const ups = f.state.calls.filter(call => call.args.includes('up'))
  assert.deepEqual(ups.map(call => call.args.at(-1)), ['app'])
  assert.equal(f.state.maxActiveMutation, 1)
  assert.deepEqual(f.state.removedWorkerIds, [CONTAINERS.worker])
  assert.deepEqual(f.state.nativeWorkerStarts, [CONTAINERS.workerNew])
  assert.equal(f.state.creates.length, 1)
  const create = f.state.creates[0]
  assert.equal(create.name, WORKER_NAME)
  assert.equal(create.body.Image, WORKER_NEW)
  assert.equal(create.body.Hostname, '')
  assert.equal(create.body.User, 'pwuser')
  assert.deepEqual(create.body.HostConfig, { ...f.workerHostConfig, OomKillDisable: false })
  assert.deepEqual(create.body.Env, [...f.oldWorkerImage.Config.Env, 'PHYSICSOS_VALIDATION_PORT=8099', 'PHYSICSOS_VALIDATION_TOKEN_FILE=/run/secrets/ui_validation_token'])
  assert.deepEqual(create.body.NetworkingConfig.EndpointsConfig.physicsos_default, { NetworkID: 'fixture-network', IPAMConfig: null, Links: null,
    DriverOpts: null, Aliases: [WORKER_NAME, 'validation-worker'] })
  for (const call of ups) {
    assert.deepEqual(call.args.slice(call.args.indexOf('up')), ['up', '-d', '--no-build', '--no-deps', '--pull', 'never', '--force-recreate', call.args.at(-1)])
    assert.deepEqual(call.imageEnv, { app: NEW, worker: WORKER_NEW })
  }
  assert.equal(f.state.calls.some(call => ['build', 'pull'].includes(call.args[0])), false)
  assert.deepEqual(f.state.tags.map(([image]) => image), [OLD, WORKER_OLD])
  const receipt = JSON.parse(await readFile(join(result.recovery, 'paired-recovery.json'), 'utf8'))
  assert.equal(receipt.validationWorker.oldContainerId, CONTAINERS.worker)
  assert.equal(receipt.validationWorker.newContainerId, CONTAINERS.workerNew)
  assert.equal(receipt.validationWorker.newHealthy, true)
  assert.equal(receipt.validationWorker.inputsSha256, WORKER_INPUTS)
  assert.match(receipt.validationWorker.operationNonce, /^[0-9a-f]{64}$/)
  assert.equal(receipt.validationWorker.operationNonce, create.body.Labels[OPERATION_LABEL])
  assert.equal(receipt.validationWorker.creates[0].nonce, create.body.Labels[CREATE_LABEL])
  assert.equal(receipt.validationWorker.creates[0].containerId, CONTAINERS.workerNew)
  assert.equal(receipt.validationWorker.creates[0].requestSha256, jsonHash(create.body))
  const owner = JSON.parse(await readFile(join(f.root, '.physicsos-release', 'validation-worker.json'), 'utf8'))
  assert.equal(owner.containerId, CONTAINERS.workerNew)
  assert.equal(owner.labelsSha256, jsonHash(create.body.Labels))
  assert.equal(owner.requestSha256, jsonHash(create.body))
  assert.match(receipt.validationWorker.rollbackTag, /^physicsos-validation:rollback-/)
  assert.equal(receipt.backup.mode, 'paired')
  for (const name of await readdir(result.recovery)) if (name.endsWith('.json')) {
    assert.equal(/fixture-worker-token-never-output|fixture-password-never-output|fixture-cookie-never-output/.test(await readFile(join(result.recovery, name), 'utf8')), false)
  }
})

test('an old container tag spelling is proven image-only while up and rollback still use full IDs', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.workerRuntimeImageRef = 'physicsos-validation:previous'
  f.state.workerConfigHash = f.workerHash(f.state.workerRuntimeImageRef)
  f.state.mode = 'auth'
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === true)
  assert.equal(f.state.workerImage, WORKER_OLD)
  assert.equal(f.state.image, OLD)
  assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior)
  for (const call of f.state.calls.filter(call => call.args.includes('up'))) {
    assert.match(call.imageEnv.worker, /^sha256:[a-f0-9]{64}$/)
    assert.match(call.imageEnv.app, /^sha256:[a-f0-9]{64}$/)
  }
})

for (const mode of ['worker-health', 'worker-create-timeout', 'worker-start-failure', 'worker-create-rejected']) {
  test(`${mode} failure restores an owned healthy old worker before the old app`, async t => {
    const f = await fixture(t, { withWorker: true })
    f.state.mode = mode
    let failure
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => { failure = error; return error.rollbackHealthy === true })
    assert.equal(failure.phase, 'validation-worker-cutover')
    assert.equal(f.state.workerImage, WORKER_OLD)
    assert.equal(f.state.workerId, CONTAINERS.workerRollback)
    assert.equal(f.state.workerHealthy, true)
    assert.equal(f.state.image, OLD)
    assert.equal(f.state.app, true)
    assert.equal(f.state.redis, true)
    assert.equal(f.state.events.includes('candidate'), false)
    assert.ok(f.state.events.indexOf('worker-rollback-healthy') < f.state.events.indexOf('rollback'))
    assert.equal(f.state.events.filter(event => event === 'capture').length, 1)
    assert.equal(f.state.businessData, 'original-business-data')
    assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior)
    const receipt = JSON.parse(await readFile(join(failure.recovery, 'rollback.json'), 'utf8'))
    assert.equal(receipt.validationWorker.restoredContainerId, CONTAINERS.workerRollback)
    assert.equal(receipt.validationWorker.restoredHealthy, true)
    assert.equal(receipt.validationWorker.newContainerId, mode === 'worker-create-rejected' ? undefined : CONTAINERS.workerNew)
    assert.equal(f.state.creates.length, 2)
    assert.notEqual(f.state.creates[0].body.Labels[CREATE_LABEL], f.state.creates[1].body.Labels[CREATE_LABEL])
    assert.equal(f.state.creates[0].body.Labels[OPERATION_LABEL], f.state.creates[1].body.Labels[OPERATION_LABEL])
    assert.deepEqual(f.state.removedWorkerIds, mode === 'worker-create-rejected' ? [CONTAINERS.worker] : [CONTAINERS.worker, CONTAINERS.workerNew])
  })
}

for (const mode of ['readiness', 'auth', 'html-ready']) {
  test(`paired app ${mode} failure restores both images without restoring live business data`, async t => {
    const f = await fixture(t, { withWorker: true })
    f.state.mode = mode
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === true)
    assert.equal(f.state.image, OLD)
    assert.equal(f.state.workerImage, WORKER_OLD)
    assert.equal(f.state.workerId, CONTAINERS.workerRollback)
    assert.equal(f.state.app, true)
    assert.equal(f.state.redis, true)
    assert.ok(f.state.events.indexOf('worker-rollback-healthy') < f.state.events.indexOf('rollback'))
    assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior)
    assert.equal(f.state.businessData, 'post-cutover-business-data', 'rollback must not overwrite writes received after app cutover')
    assert.equal(f.state.events.filter(event => event === 'capture').length, 1)
    assert.deepEqual(f.state.calls.filter(call => call.args.includes('up')).map(call => call.args.at(-1)), ['app', 'app'])
    assert.deepEqual(f.state.creates.map(create => create.body.Image), [WORKER_NEW, WORKER_OLD])
    assert.deepEqual(f.state.removedWorkerIds, [CONTAINERS.worker, CONTAINERS.workerNew])
    for (const call of f.state.calls.filter(call => call.args.includes('up')).slice(1)) assert.deepEqual(call.imageEnv, { app: OLD, worker: WORKER_OLD })
  })
}

test('paired rollback selects the old worker explicitly even if the app image IDs are identical', async t => {
  const f = await fixture(t, { withWorker: true }), docker = f.dependencies.docker
  let failAppOnce = true
  f.dependencies.docker = async (args, options) => {
    const result = await docker(args, options)
    if (args.includes('up') && args.at(-1) === 'app' && failAppOnce) { failAppOnce = false; throw new Error('fixture app CLI failed after recreate') }
    return result
  }
  await assert.rejects(f.releaseSwitch({ ...f.workerPlan, candidateImage: OLD }, f.dependencies), error => error.rollbackHealthy === true)
  assert.equal(f.state.image, OLD)
  assert.equal(f.state.workerImage, WORKER_OLD)
  assert.equal(f.state.app, true)
  assert.equal(f.state.redis, true)
})

test('a worker that fails after old-app startup causes failed recovery to stop writers again', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.mode = 'worker-health'
  f.state.onRollback = () => { f.state.workerHealthy = false }
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === false)
  assert.equal(f.state.image, OLD)
  assert.equal(f.state.workerImage, WORKER_OLD)
  assert.equal(f.state.app, false)
  assert.equal(f.state.redis, false)
  assert.equal(f.state.events.at(-1), 'stop')
})

test('a same-time same-config foreign worker without this create nonce is never adopted or deleted', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.mode = 'worker-foreign-same-window'
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === false)
  assert.equal(f.state.events.includes('worker-rollback'), false)
  assert.equal(f.state.app, false)
  assert.equal(f.state.redis, false)
  assert.equal(f.state.extraWorkers[0].Id, CONTAINERS.workerForeign)
  assert.equal(f.state.extraWorkers[0].Image, WORKER_NEW)
  assert.equal(f.state.extraWorkers[0].Config.Labels['com.docker.compose.config-hash'], f.workerHash(WORKER_NEW))
  assert.deepEqual(f.state.removedWorkerIds, [CONTAINERS.worker])
  assert.equal(f.state.creates.length, 1)
  assert.equal(f.state.calls.some(call => call.args.includes('up') && call.args.at(-1) === 'validation-worker'), false)
  assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior.replace(OLD, NEW).replace(WORKER_OLD, WORKER_NEW))
})

test('an unresolved timed-out create never races a second create or claims a zero inventory', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.mode = 'worker-unresolved-create'
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === false)
  assert.equal(f.state.creates.length, 1)
  assert.equal(f.state.events.includes('worker-rollback'), false)
  assert.deepEqual(f.state.removedWorkerIds, [CONTAINERS.worker])
  assert.equal(f.state.app, false)
  assert.equal(f.state.redis, false)
})

test('a recorded CID with a changed create nonce stays operator-only', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.onCreate = () => { f.state.workerCreateBody.Labels[CREATE_LABEL] = 'c'.repeat(64) }
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === false)
  assert.deepEqual(f.state.removedWorkerIds, [CONTAINERS.worker])
  assert.equal(f.state.nativeWorkerStarts.length, 0)
  assert.equal(f.state.app, false)
  assert.equal(f.state.redis, false)
})

test('a genuine created-state worker with unallocated NetworkID and ports can be rolled back safely', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.mode = 'worker-start-failure'
  let sawCold = false
  f.state.onCreate = ({ body }) => {
    if (body.Image === WORKER_NEW) {
      assert.equal(f.state.workerStatus, 'created')
      assert.equal(f.state.worker, false)
      sawCold = true
    }
  }
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === true)
  assert.equal(sawCold, true)
  assert.deepEqual(f.state.removedWorkerIds, [CONTAINERS.worker, CONTAINERS.workerNew])
  assert.equal(f.state.workerImage, WORKER_OLD)
  assert.equal(f.state.app, true)
  assert.equal(f.state.redis, true)
})

for (const [name, change] of [
  ['operation nonce', f => { f.state.workerLabels[OPERATION_LABEL] = 'c'.repeat(64) }],
  ['create nonce', f => { f.state.workerLabels[CREATE_LABEL] = 'd'.repeat(64) }],
  ['missing nonce pair', f => { delete f.state.workerLabels[OPERATION_LABEL]; delete f.state.workerLabels[CREATE_LABEL] }],
  ['another label', f => { f.state.workerLabels['io.physicsos.unexpected'] = 'changed' }],
  ['HostConfig memory', f => { f.state.workerHostOverride = { Memory: 2 * 1024 ** 3 } }],
  ['OOM killer disabled', f => { f.state.workerHostOverride = { OomKillDisable: true } }],
  ['logical-network fixed MAC', f => { f.config.services['validation-worker'].networks = { default: { mac_address: '02:42:ac:14:00:09' } } }],
  ['service fixed MAC', f => { f.config.services['validation-worker'].mac_address = '02:42:ac:14:00:09' }],
]) {
  test(`future old-worker preflight rejects managed ${name} drift before downtime`, async t => {
    const f = await fixture(t, { withWorker: true })
    f.state.workerLabels = { [OPERATION_LABEL]: 'a'.repeat(64), [CREATE_LABEL]: 'b'.repeat(64) }
    await f.writeWorkerOwnership()
    change(f)
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.phase === 'preflight-validation-worker')
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.removedWorkerIds.length, 0)
    assert.equal(f.state.creates.length, 0)
  })
}

test('managed old-worker ownership remains usable when its nonce and complete creation settings match', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.workerLabels = { [OPERATION_LABEL]: 'a'.repeat(64), [CREATE_LABEL]: 'b'.repeat(64) }
  await f.writeWorkerOwnership()
  const result = await f.releaseSwitch(f.workerPlan, f.dependencies)
  assert.equal(result.deployed, true)
  assert.equal(f.state.workerImage, WORKER_NEW)
})

test('a later unknown worker with the candidate image cannot bypass the owned-ID recovery guard', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.mode = 'auth'
  f.state.onCandidate = () => { f.state.workerId = CONTAINERS.workerForeign; f.state.workerCreated = new Date().toISOString() }
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === false)
  assert.equal(f.state.events.includes('worker-rollback'), false)
  assert.equal(f.state.app, false)
  assert.equal(f.state.redis, false)
  assert.equal(f.state.businessData, 'post-cutover-business-data')
})

test('failed old-worker health keeps app and Redis quiesced and records failed recovery', async t => {
  const f = await fixture(t, { withWorker: true })
  f.state.mode = 'worker-rollback-health'
  let failure
  await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => { failure = error; return error.rollbackHealthy === false })
  assert.equal(f.state.events.includes('candidate'), false)
  assert.equal(f.state.events.includes('rollback'), false)
  assert.equal(f.state.app, false)
  assert.equal(f.state.redis, false)
  const receipt = JSON.parse(await readFile(join(failure.recovery, 'rollback.json'), 'utf8'))
  assert.equal(receipt.rollbackHealthy, false)
  assert.notEqual(receipt.validationWorker.restoredHealthy, true)
})

for (const [name, change] of [
  ['worker ports', f => { f.config.services['validation-worker'].ports = [{ target: 8099, published: '18099' }] }],
  ['token environment', f => { f.config.services['validation-worker'].environment.PHYSICSOS_VALIDATION_TOKEN = 'fixture-unexpected-token' }],
  ['read-only option', f => { f.config.services['validation-worker'].read_only = false }],
  ['capabilities', f => { f.config.services['validation-worker'].cap_drop = [] }],
  ['seccomp option', f => { f.config.services['validation-worker'].security_opt = ['seccomp=unconfined'] }],
  ['token mount', f => { f.config.services['validation-worker'].volumes[0].read_only = false }],
  ['another service', f => { f.config.services.searxng = { image: 'unexpected:latest' } }],
  ['PostgreSQL configuration', f => { f.config.services.postgres.image = 'postgres:unexpected' }],
  ['unrelated env value', async f => { await writeFile(join(f.root, '.env'), (await readFile(join(f.root, '.env'), 'utf8')).replace('CUSTOM_SETTING=keep', 'CUSTOM_SETTING=changed')) }],
  ['runtime worker ports', f => { f.state.workerHostOverride = { PortBindings: { '8099/tcp': [{ HostIp: '0.0.0.0', HostPort: '18099' }] } } }],
  ['runtime OOM killer disabled', f => { f.state.workerHostOverride = { OomKillDisable: true } }],
]) {
  test(`paired recovery does not exempt changed ${name}`, async t => {
    const f = await fixture(t, { withWorker: true })
    f.state.mode = 'auth'
    f.state.onCandidate = () => change(f)
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === false)
    assert.equal(f.state.events.includes('worker-rollback'), false)
    assert.equal(f.state.app, false)
    assert.equal(f.state.redis, false)
    assert.equal(f.state.businessData, 'post-cutover-business-data')
    assert.match(await readFile(join(f.root, '.env'), 'utf8'), new RegExp(`PHYSICSOS_VALIDATION_IMAGE=${WORKER_NEW}`))
  })
}

for (const [name, change] of [
  ['worker settings', f => { f.config.services['validation-worker'].ports = [{ target: 8099, published: '18099' }] }],
  ['worker token file', async f => { await chmod(f.workerToken, 0o600); await writeFile(f.workerToken, 'changed-private-token') }],
  ['seccomp file', f => writeFile(f.seccompFile, '{"defaultAction":"SCMP_ACT_ALLOW"}')],
]) {
  test(`late preflight ${name} drift is rejected before the first stop`, async t => {
    const f = await fixture(t, { withWorker: true }), run = f.dependencies.run
    f.dependencies.run = async (command, args, options) => {
      const result = await run(command, args, options)
      if (command !== 'git' && args.at(-2) === 'preflight' && f.state.app) await change(f)
      return result
    }
    await assert.rejects(f.releaseSwitch({ ...f.workerPlan, hooks: [f.hook] }, f.dependencies), error => error.phase.startsWith('preflight'))
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.app, true)
    assert.equal(f.state.redis, true)
  })
}

for (const mode of [0o400, 0o600]) {
  for (const failure of [false, true]) {
    test(`paired env keeps all other bytes, CRLF, final-newline policy and ${mode.toString(8)} permissions on ${failure ? 'rollback' : 'success'}`, async t => {
      const prior = `# retained comment\r\nexport PHYSICSOS_APP_IMAGE = ${OLD}  \r\nPHYSICSOS_VALIDATION_IMAGE=${WORKER_OLD}\r\nKEEP_IMAGE=${WORKER_OLD}\r\nCUSTOM_SETTING=keep`
      const f = await fixture(t, { withWorker: true, envText: prior, envMode: mode })
      if (failure) {
        f.state.mode = 'auth'
        await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.rollbackHealthy === true)
      } else await f.releaseSwitch(f.workerPlan, f.dependencies)
      const expected = failure ? prior : prior.replace(`PHYSICSOS_APP_IMAGE = ${OLD}`, `PHYSICSOS_APP_IMAGE = ${NEW}`).replace(`PHYSICSOS_VALIDATION_IMAGE=${WORKER_OLD}`, `PHYSICSOS_VALIDATION_IMAGE=${WORKER_NEW}`)
      assert.equal(await readFile(join(f.root, '.env'), 'utf8'), expected)
      assert.equal((await lstat(join(f.root, '.env'))).mode & 0o777, mode)
    })
  }
}

for (const [name, change] of [
  ['advanced worker image', prior => prior.replace(WORKER_OLD, WORKER_NEW)],
  ['duplicate worker assignment', prior => prior + `PHYSICSOS_VALIDATION_IMAGE=${WORKER_OLD}\n`],
  ['duplicate app assignment', prior => prior + `PHYSICSOS_APP_IMAGE=${OLD}\n`],
  ['missing app assignment', prior => prior.replace(`PHYSICSOS_APP_IMAGE=${OLD}\n`, '')],
]) {
  test(`paired worker plan rejects ${name} in production env before downtime`, async t => {
    const f = await fixture(t, { withWorker: true })
    await writeFile(join(f.root, '.env'), change(f.prior))
    await assert.rejects(f.releaseSwitch(f.workerPlan, f.dependencies), error => error.phase.startsWith('preflight'))
    assert.equal(f.state.events.includes('stop'), false)
    assert.equal(f.state.events.includes('worker-candidate'), false)
  })
}

test('paired cancellation immediately after capture does not switch either image', async t => {
  const f = await fixture(t, { withWorker: true }), controller = new AbortController(), capture = f.dependencies.capture
  f.dependencies.capture = async (...args) => { const result = await capture(...args); controller.abort(); return result }
  await assert.rejects(f.releaseSwitch({ ...f.workerPlan, signal: controller.signal }, f.dependencies), error => error.rollbackHealthy === true)
  assert.equal(f.state.workerId, CONTAINERS.worker)
  assert.equal(f.state.workerImage, WORKER_OLD)
  assert.equal(f.state.image, OLD)
  assert.equal(f.state.app, true)
  assert.equal(f.state.redis, true)
  assert.equal(f.state.events.includes('worker-candidate'), false)
  assert.equal(await readFile(join(f.root, '.env'), 'utf8'), f.prior)
})
