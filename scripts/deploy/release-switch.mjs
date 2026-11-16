#!/usr/bin/env node
import process from 'node:process'
import console from 'node:console'
import { lstat, mkdir, open, readFile, rename, rm, statfs } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { isIP } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { acquireOperationLock } from './operation-lock.mjs'
import { captureQuiescedStores, inspectBackupSource } from './backup-full.mjs'
import { composeArgs, dockerCommand, jsonOf, queryPostgres, RESTORE_READINESS_SCRIPT, runCommand, sha256, terminationSignal, textOf, validateBackupKey } from './backup-lib.mjs'

const imageId = /^sha256:[0-9a-f]{64}$/
const digest = /^[0-9a-f]{64}$/
const commit = /^[0-9a-f]{40}$/
const containerId = /^[0-9a-f]{64}$/
const WORKER_SERVICE = 'validation-worker'
const WORKER_IMAGE_ENV = 'PHYSICSOS_VALIDATION_IMAGE'
const WORKER_OPERATION_LABEL = 'io.physicsos.release.operation'
const WORKER_CREATE_LABEL = 'io.physicsos.release.create'
const WORKER_OWNERSHIP_FORMAT = 'physicsos-validation-worker/1'
const DOCKER_SOCKET = '/var/run/docker.sock'
const aborted = signal => signal?.throwIfAborted()

function jsonDigest(value) {
  const ordered = item => Array.isArray(item) ? item.map(ordered) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => [key, ordered(entry)])) : item
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex')
}

function engineJson(method, path, body, status = 200, timeoutMs = 30_000) {
  // Never pass Config/Env through argv, a shell, a file or diagnostics.
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return new Promise((resolveResult, reject) => {
    const fail = uncertain => { const error = new Error('Docker Unix-socket operation failed'); error.createUncertain = uncertain; reject(error) }
    const request = httpRequest({ socketPath: DOCKER_SOCKET, method, path,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {} }, response => {
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > 256 * 1024) request.destroy(new Error('Docker metadata exceeded limit'))
        else chunks.push(chunk)
      })
      response.on('error', () => fail(true))
      response.on('end', () => {
        if (response.statusCode !== status) return fail(![400, 404, 409].includes(response.statusCode))
        try { resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { fail(true) }
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Docker socket timed out')))
    request.on('error', () => fail(true))
    request.end(payload)
  })
}

async function workerEngineVersion(docker) {
  if (!(await lstat(DOCKER_SOCKET)).isSocket()) throw new Error('A local Docker Unix socket is required')
  const version = await engineJson('GET', '/version'), info = await engineJson('GET', '/info')
  if (!/^1\.[0-9]+$/.test(version.ApiVersion ?? '') || typeof info.ID !== 'string' || !info.ID ||
    jsonOf(await docker(['info', '--format', '{{json .ID}}'])) !== info.ID)
    throw new Error('Worker create socket and Docker CLI must address the same daemon')
  return version.ApiVersion
}

export async function createValidationWorker({ name, body, apiVersion, timeoutMs }) {
  if (!/^1\.[0-9]+$/.test(apiVersion ?? '') || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error('Invalid fixed worker create request')
  return engineJson('POST', `/v${apiVersion}/containers/create?name=${encodeURIComponent(name)}`, body, 201, timeoutMs)
}

const workerOwnershipPath = plan => join(plan.projectDir, '.physicsos-release', 'validation-worker.json')

async function readWorkerOwnership(plan) {
  const file = workerOwnershipPath(plan)
  try { await lstat(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const record = JSON.parse(await privateText(file))
  const fields = ['format', 'containerId', 'image', 'operationNonce', 'createNonce', 'configHash', 'labelsSha256', 'requestSha256']
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== fields.length || fields.some(field => !Object.hasOwn(record, field)) ||
    record.format !== WORKER_OWNERSHIP_FORMAT || !containerId.test(record.containerId ?? '') || !imageId.test(record.image ?? '') ||
    ['operationNonce', 'createNonce', 'configHash', 'labelsSha256', 'requestSha256'].some(field => !digest.test(record[field] ?? '')))
    throw new Error('Invalid private worker ownership record')
  return record
}

function validateValidationWorker(plan) {
  if (!Object.hasOwn(plan, 'validationWorker')) return
  const worker = plan.validationWorker
  const fields = ['service', 'imageEnv', 'expectedOldImage', 'candidateImage', 'expectedOldContainerId', 'inputsSha256']
  if (!worker || typeof worker !== 'object' || Array.isArray(worker) ||
    Reflect.ownKeys(worker).length !== fields.length || fields.some(field => !Object.hasOwn(worker, field)) ||
    worker.service !== WORKER_SERVICE || worker.imageEnv !== WORKER_IMAGE_ENV ||
    ['expectedOldImage', 'candidateImage'].some(field => typeof worker[field] !== 'string' || !imageId.test(worker[field])) ||
    worker.expectedOldImage === worker.candidateImage || typeof worker.expectedOldContainerId !== 'string' || !containerId.test(worker.expectedOldContainerId) ||
    typeof worker.inputsSha256 !== 'string' || !digest.test(worker.inputsSha256) || plan.backup.mode !== 'paired')
    throw new Error('Validation worker requires the fixed service/image env, exact immutable identities and paired recovery; unknown fields are not allowed')
  plan.validationWorker = Object.freeze({ ...worker })
}

async function privateText(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.size < 1 || info.size > 8192 || (info.mode & 0o077)) throw new Error('Invalid private release input')
  const value = (await readFile(file, 'utf8')).trim()
  if (!value) throw new Error('Empty private release input')
  return value
}

function acceptanceOrigin(options) {
  const origin = new URL(options.origin)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
    !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname))))
    throw new Error('Acceptance requires HTTPS or an isolated loopback origin')
  if (!/^\/physicsos\/[A-Za-z0-9_/-]+$/.test(options.protectedPath) || options.protectedPath.startsWith('/physicsos/auth/'))
    throw new Error('Acceptance requires a protected product read path')
  if (!/^[A-Z_]+$/.test(options.expectedRole)) throw new Error('Acceptance requires the expected account role')
  return origin.origin
}

/** Authenticate through the declared origin; credentials and cookies never leave memory. */
export async function verifyAuthenticatedRead(options, dependencies = {}) {
  try {
    const origin = acceptanceOrigin(options)
    const username = await privateText(options.usernameFile)
    const password = await privateText(options.passwordFile)
    const timeoutMs = options.requestTimeoutMs ?? 10_000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('Invalid acceptance timeout')
    const fetchImpl = dependencies.fetch ?? globalThis.fetch
    const request = async (path, init = {}) => {
      aborted(options.signal)
      return fetchImpl(origin + path, { ...init, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) })
    }
    const json = async response => {
      if (!response.ok || !/application\/json/i.test(response.headers.get('content-type') ?? '')) throw new Error('Expected JSON response')
      return response.json()
    }
    const readiness = await json(await request('/readyz'))
    if (readiness.status !== 'ready') throw new Error('Readiness JSON failed')
    if (!(await request('/')).ok) throw new Error('Public application root failed')
    const guest = await request(options.protectedPath, { headers: { accept: 'application/json' } })
    if (![401, 403].includes(guest.status)) throw new Error('Product read was not protected')
    const login = await request('/physicsos/auth/login', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', origin }, body: JSON.stringify({ username, password, schoolId: options.schoolId ?? 'PHYSICSOS-OPEN' }) })
    await json(login)
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).find(value => value.startsWith('physicsos_session='))
    if (!cookie) throw new Error('Login did not establish a session')
    const headers = { accept: 'application/json', cookie }
    const me = await json(await request('/physicsos/auth/me', { headers }))
    if (me.user?.username !== username || me.user?.role !== options.expectedRole || me.user?.schoolId !== (options.schoolId ?? 'PHYSICSOS-OPEN'))
      throw new Error('Authenticated account scope differed')
    const product = await json(await request(options.protectedPath, { headers }))
    if (!product || typeof product !== 'object' || product.error) throw new Error('Protected product read failed')
    return { readyJson: true, root: true, login: true, accountScope: true, protectedRead: true }
  } catch {
    throw new Error('Release authentication/readiness acceptance failed')
  }
}

async function atomicRecord(file, value) {
  const temporary = `${file}.partial-${randomBytes(6).toString('hex')}`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync() }
    finally { await handle.close() }
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

async function preallocate(file, content, mode = 0o600) {
  const handle = await open(file, 'wx', mode)
  try { await handle.writeFile(content); await handle.sync() }
  finally { await handle.close() }
}

function envWithImage(prior, image) {
  let replaced = false
  const lines = prior.toString('utf8').split('\n').filter(line => {
    if (!/^\s*(?:export\s+)?PHYSICSOS_APP_IMAGE=/.test(line)) return true
    if (replaced) return false
    replaced = true
    return true
  }).map(line => /^\s*(?:export\s+)?PHYSICSOS_APP_IMAGE=/.test(line) ? `PHYSICSOS_APP_IMAGE=${image}` : line)
  if (!replaced) lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `PHYSICSOS_APP_IMAGE=${image}`)
  return Buffer.from(lines.join('\n') + (lines.at(-1) === '' ? '' : '\n'))
}

// The opt-in plan changes exactly two existing assignments, not an arbitrary env map.
function envWithWorkerImages(prior, appImage, workerImage, expectedWorker) {
  const text = prior.toString('utf8'), counts = { PHYSICSOS_APP_IMAGE: 0, PHYSICSOS_VALIDATION_IMAGE: 0 }
  if (!Buffer.from(text).equals(prior)) throw new Error('Release env must be UTF-8')
  const content = text.replace(/^([ \t]*(?:export[ \t]+)?(PHYSICSOS_APP_IMAGE|PHYSICSOS_VALIDATION_IMAGE)[ \t]*=[ \t]*)([^\r\n]*)/gm, (_, prefix, name, value) => {
    counts[name]++
    if (name === WORKER_IMAGE_ENV && value.trim() !== expectedWorker) throw new Error('Production worker env identity changed')
    const trailing = value.match(/[ \t]*$/)[0]
    return prefix + (name === WORKER_IMAGE_ENV ? workerImage : appImage) + trailing
  })
  if (Object.values(counts).some(count => count !== 1)) throw new Error('Paired worker release requires exactly one app and worker image assignment')
  return Buffer.from(content)
}

const workerName = source => source.config.services[WORKER_SERVICE].container_name ?? `${source.config.name}-${WORKER_SERVICE}-1`

async function workerConfigHash(docker, compose, env) {
  const parts = textOf(await docker([...compose, 'config', '--hash', WORKER_SERVICE], env ? { env } : {})).split(/\s+/)
  if (parts.length !== 2 || parts[0] !== WORKER_SERVICE || !digest.test(parts[1])) throw new Error('Cannot bind the worker Compose configuration hash')
  return parts[1]
}

async function workerContainers(docker, compose, source) {
  const name = workerName(source)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error('Invalid fixed worker name')
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const scoped = textOf(await docker(['ps', '--all', '--no-trunc', '--quiet', '--filter', `label=com.docker.compose.project=${source.config.name}`, '--filter', `label=com.docker.compose.service=${WORKER_SERVICE}`]))
  const named = textOf(await docker(['ps', '--all', '--no-trunc', '--quiet', '--filter', `name=^/${escaped}$`]))
  const ids = [...new Set(`${scoped}\n${named}`.split(/\s+/).filter(Boolean))]
  if (ids.some(id => !containerId.test(id))) throw new Error('Worker inventory requires full container IDs')
  const containers = []
  for (const id of ids) {
    const container = jsonOf(await docker(['inspect', id]))[0]
    if (container?.Id !== id) throw new Error('Worker container identity changed')
    containers.push(container)
  }
  return containers
}

function guardWorkerContainer(plan, source, container, expectedImage) {
  const labels = container.Config?.Labels ?? {}, name = workerName(source)
  if (!containerId.test(container.Id ?? '') || container.Image !== expectedImage || container.Name !== `/${name}` ||
    labels['com.docker.compose.project'] !== source.config.name || labels['com.docker.compose.service'] !== WORKER_SERVICE ||
    labels['com.docker.compose.container-number'] !== '1' || labels['com.docker.compose.oneoff'] !== 'False' ||
    container.Config?.User !== 'pwuser' || container.HostConfig?.ReadonlyRootfs !== true || container.HostConfig.Privileged === true || container.HostConfig.AutoRemove === true ||
    !Array.isArray(container.Mounts) || container.Mounts.some(mount => !['bind', 'tmpfs'].includes(mount.Type) || (mount.Type === 'bind' && mount.RW !== false)))
    throw new Error('Validation worker role, image, user, read-only configuration or mounts changed')
  if (Object.hasOwn(labels, 'com.docker.compose.image') && labels['com.docker.compose.image'] !== expectedImage) throw new Error('Worker image label differs from the exact image')
  const hashes = source.validationWorker?.configHashes
  if (hashes && !(expectedImage === plan.validationWorker.candidateImage ? [hashes.new] : [hashes.old, hashes.rollback]).includes(labels['com.docker.compose.config-hash']))
    throw new Error('Validation worker Compose configuration hash changed')
  if (expectedImage === plan.validationWorker.candidateImage &&
    (labels['org.opencontainers.image.revision'] !== plan.revision || labels['io.physicsos.worker.inputs'] !== plan.validationWorker.inputsSha256))
    throw new Error('Validation worker runtime labels differ from the frozen inputs')
}

function automaticWorkerHostname(source, container) {
  return source.config.services[WORKER_SERVICE].hostname === undefined && container.Config.Hostname === container.Id.slice(0, 12)
}

function guardWorkerMacSupport(config) {
  const service = config.services?.[WORKER_SERVICE]
  if (service && (Object.hasOwn(service, 'mac_address') || Object.values(service.networks ?? {}).some(network =>
    network && typeof network === 'object' && Object.hasOwn(network, 'mac_address'))))
    throw new Error('Fixed worker MAC configuration is not supported')
}

function workerNetworking(source, container) {
  guardWorkerMacSupport(source.config)
  const endpoints = {}
  for (const [name, value] of Object.entries(container.NetworkSettings?.Networks ?? {})) {
    if (typeof value.NetworkID !== 'string' || !value.NetworkID) throw new Error('Original worker network identity is missing')
    const declared = source.config.services[WORKER_SERVICE].networks?.[name] ?? {}
    const aliases = (value.Aliases ?? []).filter(alias => ![container.Id, container.Id.slice(0, 12)].includes(alias) || declared.aliases?.includes(alias))
    const endpoint = { NetworkID: value.NetworkID, IPAMConfig: value.IPAMConfig ?? null, Links: value.Links ?? null, Aliases: aliases, DriverOpts: value.DriverOpts ?? null }
    if (Object.hasOwn(value, 'GwPriority')) endpoint.GwPriority = value.GwPriority
    endpoints[name] = endpoint
  }
  if (!Object.keys(endpoints).length) throw new Error('Worker requires its existing network configuration')
  return { EndpointsConfig: endpoints }
}

function workerRequestFromContainer(source, container) {
  const config = structuredClone(container.Config)
  if (automaticWorkerHostname(source, container)) config.Hostname = ''
  return { ...config, HostConfig: structuredClone(container.HostConfig), NetworkingConfig: workerNetworking(source, container) }
}

// Runtime allocation fields are checked only after start. Labels are never
// broadly discarded: the exact original/requested map includes both nonces.
function workerSettings(source, container) {
  const config = structuredClone(container.Config)
  if (source.validationWorker?.autoHostname ?? automaticWorkerHostname(source, container)) delete config.Hostname
  const networks = Object.fromEntries(Object.entries(container.NetworkSettings?.Networks ?? {}).map(([name, value]) =>
    [name, { id: value.NetworkID, ipam: value.IPAMConfig ?? null, links: value.Links ?? null, driver: value.DriverOpts ?? null, gatewayPriority: value.GwPriority ?? 0,
      aliases: (value.Aliases ?? []).filter(alias => ![container.Id, container.Id.slice(0, 12)].includes(alias) || source.config.services[WORKER_SERVICE].networks?.[name]?.aliases?.includes(alias)).sort() }]))
  return { config, host: container.HostConfig, mounts: [...container.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)), networks, ports: container.NetworkSettings?.Ports }
}

function guardWorkerSettings(source, container, creation) {
  const expected = workerSettings(source, source.validationWorker.container), actual = workerSettings(source, container)
  if (!creation && !container.State?.Running) creation = { body: source.validationWorker.template }
  if (creation) {
    const { HostConfig, NetworkingConfig, ...config } = creation.body
    expected.config = structuredClone(config)
    if (source.validationWorker.autoHostname) {
      delete expected.config.Hostname
      if (container.Config.Hostname !== container.Id.slice(0, 12)) throw new Error('Worker automatic hostname changed')
    }
    expected.host = HostConfig
    if (!container.State?.Running) {
      if (!isDeepStrictEqual(expected.config, actual.config) || !isDeepStrictEqual(expected.host, actual.host)) throw new Error('Created worker configuration changed')
      // Created containers may have no ports, mounts or allocated NetworkID yet.
      // HostConfig is exact; any materialized mount/endpoint must be requested.
      for (const mount of actual.mounts) if (!expected.mounts.some(original => isDeepStrictEqual(original, mount))) throw new Error('Created worker has an unrequested mount')
      for (const [name, endpoint] of Object.entries(container.NetworkSettings?.Networks ?? {})) {
        const requested = NetworkingConfig.EndpointsConfig[name]
        if (!requested || endpoint.NetworkID && endpoint.NetworkID !== requested.NetworkID) throw new Error('Created worker has an unrequested network')
        for (const field of ['IPAMConfig', 'Links', 'Aliases', 'DriverOpts', 'GwPriority', 'MacAddress']) {
          const declared = source.config.services[WORKER_SERVICE].networks?.[name] ?? {}
          const value = field === 'Aliases' && Array.isArray(endpoint[field])
            ? endpoint[field].filter(alias => ![container.Id, container.Id.slice(0, 12)].includes(alias) || declared.aliases?.includes(alias)) : endpoint[field]
          if (Object.hasOwn(requested, field) && value !== undefined && !isDeepStrictEqual(value, requested[field])) throw new Error('Created worker endpoint configuration changed')
        }
      }
      return
    }
  }
  if (!isDeepStrictEqual(expected, actual)) throw new Error('Validation worker runtime configuration changed')
}

function guardOwnedWorker(plan, source, container, workerState) {
  const proof = workerState.owned.get(container.Id)
  if (!proof) throw new Error('Unknown worker container')
  guardWorkerContainer(plan, source, container, proof.image)
  if (!proof.original) {
    const labels = container.Config.Labels
    if (!proof.submitted || labels[WORKER_OPERATION_LABEL] !== workerState.operationNonce || labels[WORKER_CREATE_LABEL] !== proof.nonce)
      throw new Error('Worker create nonce does not match the recorded full ID')
  }
  guardWorkerSettings(source, container, proof.original ? undefined : proof)
}

async function guardOriginalWorkerOwnership(plan, source, container) {
  guardWorkerMacSupport(source.config)
  const labels = container.Config.Labels, record = await readWorkerOwnership(plan)
  const operation = labels[WORKER_OPERATION_LABEL], nonce = labels[WORKER_CREATE_LABEL]
  if (operation === undefined && nonce === undefined && !record) return
  if (!record || !digest.test(operation ?? '') || !digest.test(nonce ?? '') || record.containerId !== container.Id || record.image !== container.Image ||
    record.operationNonce !== operation || record.createNonce !== nonce || record.configHash !== labels['com.docker.compose.config-hash'] ||
    record.labelsSha256 !== jsonDigest(labels) || record.requestSha256 !== jsonDigest(workerRequestFromContainer(source, container)))
    throw new Error('Original worker nonce, labels or creation configuration changed')
}

async function inspectOriginalWorker(plan, source, docker, requireHealthy = true) {
  guardWorkerMacSupport(source.config)
  if (source.config.services?.[WORKER_SERVICE]?.image !== plan.validationWorker.expectedOldImage) throw new Error('Production worker Compose image changed')
  const containers = await workerContainers(docker, composeArgs(plan.projectDir), source)
  if (containers.length !== 1 || containers[0].Id !== plan.validationWorker.expectedOldContainerId) throw new Error('Production worker full container identity changed')
  const container = containers[0]
  guardWorkerContainer(plan, source, container, plan.validationWorker.expectedOldImage)
  await guardOriginalWorkerOwnership(plan, source, container)
  const compose = composeArgs(plan.projectDir), oldHash = container.Config.Labels['com.docker.compose.config-hash'], rollbackHash = await workerConfigHash(docker, compose)
  if (oldHash !== rollbackHash) {
    // A previously created tag spelling is not used for up/pull. Prove that only
    // this bound image field explains its hash while the actual full ID is old.
    const env = { ...process.env, PHYSICSOS_VALIDATION_IMAGE: container.Config.Image }
    const previous = jsonOf(await docker([...compose, 'config', '--format', 'json'], { env })), expected = structuredClone(source.config)
    delete previous.services[WORKER_SERVICE].image
    delete expected.services[WORKER_SERVICE].image
    if (typeof container.Config.Image !== 'string' || !isDeepStrictEqual(previous, expected) || oldHash !== await workerConfigHash(docker, compose, env))
      throw new Error('Production worker differs from effective Compose configuration')
  }
  source.workerConfigHashes = { old: oldHash, rollback: rollbackHash }
  if (requireHealthy && (!container.State?.Running || container.State.Health?.Status !== 'healthy')) throw new Error('Production worker is not healthy')
  return container
}

async function inspectValidationWorker(plan, source, docker) {
  const container = await inspectOriginalWorker(plan, source, docker)
  const oldImage = jsonOf(await docker(['image', 'inspect', plan.validationWorker.expectedOldImage]))[0]
  const candidate = jsonOf(await docker(['image', 'inspect', plan.validationWorker.candidateImage]))[0]
  const labels = candidate?.Config?.Labels ?? {}, oldConfig = structuredClone(oldImage?.Config), newConfig = structuredClone(candidate?.Config)
  if (!oldConfig || !newConfig) throw new Error('Worker image configuration is missing')
  const oldLabels = structuredClone(oldConfig.Labels ?? {}), newLabels = structuredClone(newConfig.Labels ?? {})
  for (const field of ['org.opencontainers.image.revision', 'io.physicsos.worker.inputs']) { delete oldLabels[field]; delete newLabels[field] }
  if (!isDeepStrictEqual(oldLabels, newLabels) || [WORKER_OPERATION_LABEL, WORKER_CREATE_LABEL].some(field => Object.hasOwn(labels, field)))
    throw new Error('Worker image contains unreviewed or runtime-only label changes')
  delete oldConfig.Labels
  delete newConfig.Labels
  const layers = oldImage.RootFS?.Layers, nextLayers = candidate.RootFS?.Layers
  if (oldImage.Id !== plan.validationWorker.expectedOldImage || candidate.Id !== plan.validationWorker.candidateImage || oldConfig.User !== 'pwuser' ||
    labels['org.opencontainers.image.revision'] !== plan.revision || labels['io.physicsos.worker.inputs'] !== plan.validationWorker.inputsSha256 ||
    !isDeepStrictEqual(oldConfig, newConfig) || ['Os', 'Architecture', 'Variant'].some(field => oldImage[field] !== candidate[field]) ||
    oldImage.RootFS?.Type !== 'layers' || candidate.RootFS?.Type !== 'layers' || !Array.isArray(layers) || !layers.length || !Array.isArray(nextLayers) ||
    nextLayers.length !== layers.length + 1 || nextLayers.some(layer => typeof layer !== 'string' || !imageId.test(layer)) || layers.some((layer, index) => layer !== nextLayers[index]))
    throw new Error('Worker candidate must inherit the old image configuration and layers plus one frozen-input layer')
  const envPath = join(plan.projectDir, '.env'), info = await lstat(envPath), prior = await readFile(envPath)
  const mode = info.mode & 0o7777
  if (!info.isFile() || ![0o400, 0o600].includes(mode)) throw new Error('Worker release env must be a private regular file')
  const env = { prior, mode, next: envWithWorkerImages(prior, plan.candidateImage, candidate.Id, oldImage.Id), rollback: envWithWorkerImages(prior, plan.expectedOldImage, oldImage.Id, oldImage.Id) }
  const paths = new Set([join(plan.projectDir, 'compose.yml'), ...Object.values(source.config.secrets).map(secret => resolve(plan.projectDir, secret.file)),
    ...container.Mounts.filter(mount => mount.Type === 'bind').map(mount => mount.Source)])
  for (const option of source.config.services[WORKER_SERVICE].security_opt ?? []) {
    if (option.startsWith('seccomp=') && option !== 'seccomp=unconfined') paths.add(resolve(plan.projectDir, option.slice('seccomp='.length)))
  }
  const files = []
  for (const file of paths) {
    const stat = await lstat(file)
    if (!stat.isFile()) throw new Error('Worker release requires regular configuration/secret mount files')
    files.push({ file, mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid, sha256: await sha256(file) })
  }
  source.images[WORKER_SERVICE] = { id: oldImage.Id, digest: oldImage.RepoDigests?.[0] ?? null, labels: oldImage.Config.Labels ?? {} }
  return { container, env, files, configHashes: source.workerConfigHashes, autoHostname: automaticWorkerHostname(source, container),
    networking: workerNetworking(source, container), template: workerRequestFromContainer(source, container) }
}

async function guardWorkerFiles(plan, source, switched, envRestored = false) {
  const worker = source.validationWorker, file = join(plan.projectDir, '.env'), info = await lstat(file), current = await readFile(file)
  const allowed = envRestored ? [worker.env.rollback] : switched ? [worker.env.prior, worker.env.next] : [worker.env.prior]
  if (!info.isFile() || (info.mode & 0o7777) !== worker.env.mode || !allowed.some(value => value.equals(current))) throw new Error('Release env changed outside the paired image assignments')
  for (const expected of worker.files) {
    const stat = await lstat(expected.file)
    if (!stat.isFile() || (stat.mode & 0o7777) !== expected.mode || stat.uid !== expected.uid || stat.gid !== expected.gid || await sha256(expected.file) !== expected.sha256) throw new Error('Release configuration or secret input changed')
  }
}

function guardWorkerConfiguration(plan, source, current) {
  guardWorkerMacSupport(source.config)
  guardWorkerMacSupport(current)
  const expected = structuredClone(source.config), actual = structuredClone(current)
  if (![plan.validationWorker.expectedOldImage, plan.validationWorker.candidateImage].includes(actual.services?.[WORKER_SERVICE]?.image) ||
    ![source.config.services.app.image, plan.expectedOldImage, plan.candidateImage].includes(actual.services?.app?.image))
    throw new Error('Recovery configuration contains an unbound image')
  delete expected.services.app.image
  delete actual.services.app.image
  delete expected.services[WORKER_SERVICE].image
  delete actual.services[WORKER_SERVICE].image
  if (!isDeepStrictEqual(expected, actual)) throw new Error('Recovery configuration changed outside the paired image fields')
}

async function validateHook(hook) {
  if (!/^[A-Za-z0-9_-]+$/.test(hook.id) || !digest.test(hook.sha256) || !hook.script) throw new Error('Invalid reviewed release hook')
  const script = resolve(hook.script)
  if (!(await lstat(script)).isFile() || await sha256(script) !== hook.sha256) throw new Error('Reviewed hook source changed')
  for (const operation of ['preflight', 'apply', 'rollback'])
    if (!Array.isArray(hook[operation]) || !hook[operation].length || !hook[operation].every(part => typeof part === 'string') || !hook[operation].includes(hook.script))
      throw new Error('Hooks require reviewed preflight/apply/rollback argument arrays')
}

function hookArgs(hook, operation, projectDir, recovery) {
  const substitutions = { root: projectDir, recovery, backup: recovery, snapshot: hook.snapshot }
  return hook[operation].map(part => {
    for (const [key, value] of Object.entries(substitutions)) part = part.replaceAll(`{${key}}`, value)
    return part
  })
}

async function guardIdentity(plan, source, docker, run) {
  const app = source.containers.app
  if (app.Image !== plan.expectedOldImage || !source.running.has('app') || !source.running.has('redis') ||
    ['app', 'postgres', 'redis'].some(service => source.containers[service].State?.Health?.Status !== 'healthy'))
    throw new Error('Production image or dependency health changed')
  const candidate = jsonOf(await docker(['image', 'inspect', plan.candidateImage]))[0]
  const labels = candidate.Config?.Labels ?? {}
  if (candidate.Id !== plan.candidateImage || labels['org.opencontainers.image.revision'] !== plan.revision ||
    labels['physicsos.source.digest'] !== plan.sourceDigest || labels['physicsos.code.digest'] !== plan.codeDigest)
    throw new Error('Candidate identity differs from verified source')
  const checkout = plan.checkoutRevision ?? plan.revision
  if (textOf(await run('git', ['rev-parse', 'HEAD'])) !== checkout || textOf(await run('git', ['rev-parse', 'origin/main'])) !== checkout ||
    textOf(await run('git', ['ls-remote', '--heads', 'origin', 'refs/heads/main'])).split(/\s+/)[0] !== checkout)
    throw new Error('Server checkout or remote main changed')
  await guardDataWriters(source, docker)
}

async function guardDataWriters(source, docker) {
  const mounts = ['app', 'redis'].map(service => source.containers[service].Mounts.find(mount => mount.Name === source.volumes[service]))
  for (const id of textOf(await docker(['ps', '--no-trunc', '-q'])).split(/\s+/).filter(Boolean)) {
    if ([source.containers.app.Id, source.containers.redis.Id].includes(id)) continue
    const container = jsonOf(await docker(['inspect', id]))[0]
    if (container.Mounts?.some(mount => mount.RW && mounts.some(original => {
      if (mount.Name && mount.Name === original.Name) return true
      if (!mount.Source || !original.Source) return false
      const left = resolve(mount.Source), right = resolve(original.Source)
      return left === right || left.startsWith(right + '/') || right.startsWith(left + '/')
    }))) throw new Error('Another container writes production data')
  }
}

function guardCapturedSource(original, current) {
  if (JSON.stringify(original.config) !== JSON.stringify(current.config) ||
    ['app', 'postgres', 'redis'].some(service => current.containers[service].Id !== original.containers[service].Id || current.containers[service].Image !== original.containers[service].Image) ||
    current.volumes.app !== original.volumes.app || current.volumes.redis !== original.volumes.redis)
    throw new Error('Production configuration or container identity changed during stop')
  if (original.validationWorker) {
    if (current.validationWorker?.container.Id !== original.validationWorker.container.Id || current.validationWorker.container.Image !== original.validationWorker.container.Image)
      throw new Error('Production worker identity changed during stop')
    guardWorkerSettings(original, current.validationWorker.container)
  }
}

async function guardRecoverySource(plan, source, docker, compose, switched, workerState) {
  if (!switched) {
    const current = await inspectBackupSource(plan, { docker })
    if (source.validationWorker) {
      await guardWorkerFiles(plan, source, false)
      current.validationWorker = { container: await inspectOriginalWorker(plan, current, docker, false) }
    }
    guardCapturedSource(source, current)
    return
  }
  // A failed recreate can legitimately leave zero or one candidate app container.
  // Worker exceptions are limited to the explicitly bound plan and owned IDs.
  const current = jsonOf(await docker([...compose, 'config', '--format', 'json']))
  if (source.validationWorker) {
    await guardWorkerFiles(plan, source, true, workerState.envRestored)
    guardWorkerConfiguration(plan, source, current)
    if (workerState.creates.some(create => create.submitted && !create.containerId && !create.resolvedEmpty)) throw new Error('Recovery has an unresolved worker create')
    const workers = await workerContainers(docker, compose, source)
    if (workers.length > 2 || (!workers.length && !workerState.removalAttempted)) throw new Error('Recovery worker inventory changed')
    for (const worker of workers) guardOwnedWorker(plan, source, worker, workerState)
  } else {
    const expectedConfig = structuredClone(source.config), currentConfig = structuredClone(current)
    delete expectedConfig.services.app.image
    delete currentConfig.services.app.image
    if (JSON.stringify(expectedConfig) !== JSON.stringify(currentConfig)) throw new Error('Recovery configuration changed')
  }
  for (const service of ['postgres', 'redis']) {
    const item = jsonOf(await docker(['inspect', source.containers[service].Id]))[0]
    if (item.Id !== source.containers[service].Id || item.Image !== source.containers[service].Image) throw new Error('Recovery dependency changed')
  }
  const ids = textOf(await docker([...compose, 'ps', '--all', '--quiet', 'app'])).split(/\s+/).filter(Boolean)
  if (ids.length > 1) throw new Error('Multiple recovery app containers')
  if (ids.length) {
    const app = jsonOf(await docker(['inspect', ids[0]]))[0]
    const mount = app.Mounts?.find(item => item.Destination === '/var/lib/physicsos')
    if (![plan.expectedOldImage, plan.candidateImage].includes(app.Image) || mount?.Type !== 'volume' || mount.Name !== source.volumes.app) throw new Error('Recovery app volume or image changed')
  }
}

async function writerLease(source, docker, compose, expected, container = source.containers.app) {
  const schema = source.config.services.app.environment?.PHYSICSOS_STORAGE_SCHEMA ?? 'physicsos'
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid storage schema')
  const addresses = Object.values(container.NetworkSettings?.Networks ?? {}).map(network => network.IPAddress).filter(address => isIP(address))
  const owner = addresses.length ? `coalesce(bool_and(host(a.client_addr) IN (${addresses.map(address => `'${address}'`).join(',')})),false)` : 'true'
  const result = await queryPostgres(docker, compose, `WITH writer_key AS (SELECT hashtextextended('physicsos:single-writer:${schema}',0) AS value)
    SELECT json_build_object('count',count(*),'ownerMatches',${owner}) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid, writer_key k
    WHERE l.locktype='advisory' AND l.granted AND l.objsubid=1 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND l.classid=((k.value >> 32) & 4294967295)::oid AND l.objid=(k.value & 4294967295)::oid;`)
  if (Number(result.count) !== expected || (expected === 1 && result.ownerMatches !== true)) throw new Error('PostgreSQL writer lease differs from the expected app owner')
}

async function checkSpace(plan, source, docker, compose) {
  let required = plan.minFreeBytes
  if (required === undefined) {
    let total = Number(plan.backup.estimatedBytes)
    if (plan.backup.estimatedBytes === undefined) {
      if (plan.backup.mode === 'paired') {
        // Estimate the actual compressed streams before downtime, without retaining a second backup.
        total = Number(textOf(await docker([...compose, 'exec', '-T', 'postgres', 'bash', '-o', 'pipefail', '-c',
          'PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-acl | wc -c'], { timeoutMs: 120_000 })))
        for (const name of ['app', 'redis']) total += Number(textOf(await docker(['run', '--rm', '--log-driver', 'none', '--network', 'none', '--user', '0:0', '--volume', `${source.volumes[name]}:/source:ro`, '--entrypoint', 'bash', source.images.app.id, '-o', 'pipefail', '-c', 'tar -C /source -czpf - . | wc -c'], { timeoutMs: 120_000 })))
      } else {
        const database = await queryPostgres(docker, compose, "SELECT json_build_object('bytes',pg_database_size(current_database()))")
        total = Number(database.bytes)
        for (const name of ['app', 'redis']) total += Number(textOf(await docker(['run', '--rm', '--log-driver', 'none', '--network', 'none', '--user', '0:0', '--volume', `${source.volumes[name]}:/source:ro`, '--entrypoint', 'du', source.images.app.id, '-sb', '/source'])).split(/\s+/)[0])
      }
    }
    if (!Number.isSafeInteger(total) || total < 1) throw new Error('Cannot estimate paired backup space')
    required = Math.ceil(total * (plan.backup.mode === 'paired' ? 1.3 : 3)) + 64 * 1024 * 1024
  }
  if (!Number.isSafeInteger(required) || required < 0) throw new Error('Invalid release disk reserve')
  for (const path of [plan.projectDir, dirname(resolve(plan.backup.mode === 'paired' ? plan.backup.outputDir : plan.backup.output))]) {
    const space = await statfs(path, { bigint: true })
    if (space.bavail * space.bsize < BigInt(required) || (space.files > 0n && space.ffree < 32n)) throw new Error('Insufficient release/rollback disk space')
  }
}

/** Image-only rollback is allowed only for an explicitly compatible release. Never restores live data. */
export async function releaseSwitch(input, dependencies = {}) {
  const suppliedBackup = input.backup ?? {}
  const plan = { ...input, projectDir: resolve(input.projectDir ?? '/opt/physicsos'), backup: { ...suppliedBackup, mode: suppliedBackup.mode ?? (suppliedBackup.keyFile ? 'full' : 'paired') } }
  let phase = 'preflight', lock, recovery, nextEnv, rollbackEnv, reserve, source
  let stopAttempted = false, switched = false
  const workerState = { attempted: false, removalAttempted: false, owned: new Map(), creates: [], operationNonce: randomBytes(32).toString('hex'), envRestored: false }
  const createWorker = dependencies.createWorker ?? createValidationWorker
  const attempted = []
  const docker = dependencies.docker ?? dockerCommand
  const invoke = dependencies.run ?? runCommand
  const run = (command, args, options = {}) => invoke(command, args, { cwd: plan.projectDir, ...options })
  const compose = composeArgs(plan.projectDir)
  const receipt = { oldImage: plan.expectedOldImage, newImage: plan.candidateImage, revision: plan.revision, checkoutRevision: plan.checkoutRevision ?? plan.revision, sourceDigest: plan.sourceDigest, ...(plan.codeDigest ? { codeDigest: plan.codeDigest } : {}) }
  const runHook = async (hook, operation) => {
    await validateHook(hook)
    const args = hookArgs(hook, operation, plan.projectDir, recovery)
    // Finish a submitted mutation before handling cancellation; its snapshot then defines recovery.
    await run(args[0], args.slice(1))
  }
  const releaseEnv = (appImage, workerImage) => ({ ...process.env, PHYSICSOS_APP_IMAGE: appImage, ...(source?.validationWorker ? { PHYSICSOS_VALIDATION_IMAGE: workerImage } : {}) })
  const saveWorkerJournal = async () => {
    receipt.validationWorker.ownedContainerIds = [...workerState.owned.keys()]
    receipt.validationWorker.removalAttempted = workerState.removalAttempted
    receipt.validationWorker.creates = workerState.creates.map(create => ({ nonce: create.nonce, image: create.image, configHash: create.configHash,
      requestSha256: create.requestSha256, submitted: create.submitted, containerId: create.containerId ?? null, uncertain: create.uncertain, resolvedEmpty: create.resolvedEmpty ?? false }))
    await atomicRecord(join(recovery, 'paired-recovery.json'), { ...receipt, consistent: true })
  }
  const recordWorkerId = async (creation, id) => {
    if (!containerId.test(id ?? '') || creation.containerId && creation.containerId !== id || workerState.owned.has(id) && workerState.owned.get(id) !== creation)
      throw new Error('Worker create returned an unexpected full container ID')
    creation.containerId = id
    workerState.owned.set(id, creation)
    if (creation.image === plan.validationWorker.candidateImage) receipt.validationWorker.newContainerId = id
    // Persist daemon CID / submitted nonce proof before even inspecting or starting.
    await saveWorkerJournal()
    await atomicRecord(workerOwnershipPath(plan), { format: WORKER_OWNERSHIP_FORMAT, containerId: id, image: creation.image,
      operationNonce: workerState.operationNonce, createNonce: creation.nonce, configHash: creation.configHash,
      labelsSha256: jsonDigest(creation.body.Labels), requestSha256: creation.requestSha256 })
  }
  const reconcileWorkerCreates = async () => {
    for (const creation of workerState.creates.filter(create => create.submitted && !create.containerId && !create.resolvedEmpty)) {
      const deadline = Date.now() + (creation.uncertain ? plan.timeoutMs ?? 150_000 : 0)
      do {
        const ids = textOf(await docker(['ps', '--all', '--no-trunc', '--quiet', '--filter', `label=${WORKER_OPERATION_LABEL}=${workerState.operationNonce}`,
          '--filter', `label=${WORKER_CREATE_LABEL}=${creation.nonce}`])).split(/\s+/).filter(Boolean)
        if (ids.length > 1 || ids.some(id => !containerId.test(id))) throw new Error('Submitted worker create has ambiguous nonce attribution')
        if (ids.length) {
          await recordWorkerId(creation, ids[0])
          const worker = jsonOf(await docker(['inspect', ids[0]]))[0]
          guardOwnedWorker(plan, source, worker, workerState)
          creation.uncertain = false
          await saveWorkerJournal()
          break
        }
        if (Date.now() >= deadline) {
          if (creation.uncertain) throw new Error('Submitted worker create is unresolved; operator inspection is required')
          creation.resolvedEmpty = true
          await saveWorkerJournal()
          break
        }
        await delay(plan.intervalMs ?? 1000)
      } while (!creation.containerId)
    }
  }
  const recreateWorker = async expected => {
    await reconcileWorkerCreates()
    const workers = await workerContainers(docker, compose, source)
    if (workers.length > 2 || !workers.length && !workerState.removalAttempted) throw new Error('Worker replacement inventory changed')
    for (const worker of workers) guardOwnedWorker(plan, source, worker, workerState)
    workerState.attempted = true
    receipt.validationWorker.recreateAttempted = true
    for (const worker of workers) {
      try { await docker(['stop', '--time', '60', worker.Id]) } catch { /* Inspect a daemon-accepted stop by the recorded CID. */ }
      const stopped = jsonOf(await docker(['inspect', worker.Id]))[0]
      guardOwnedWorker(plan, source, stopped, workerState)
      if (stopped.State?.Running) throw new Error('Owned worker did not stop')
      workerState.removalAttempted = true
      await saveWorkerJournal()
      try { await docker(['rm', worker.Id]) } catch { /* Settle the exact removal before submitting any create. */ }
      const remaining = await workerContainers(docker, compose, source)
      if (remaining.some(item => item.Id === worker.Id)) throw new Error('Owned worker removal did not settle')
      for (const item of remaining) guardOwnedWorker(plan, source, item, workerState)
    }
    if ((await workerContainers(docker, compose, source)).length) throw new Error('Worker name/service is not empty after owned removal')
    await guardWorkerFiles(plan, source, switched, workerState.envRestored)
    const nonce = randomBytes(32).toString('hex'), body = structuredClone(source.validationWorker.template)
    body.Image = expected
    body.Labels['com.docker.compose.image'] = expected
    body.Labels['com.docker.compose.config-hash'] = expected === plan.validationWorker.candidateImage ? source.validationWorker.configHashes.new : source.validationWorker.configHashes.rollback
    if (expected === plan.validationWorker.candidateImage) {
      body.Labels['org.opencontainers.image.revision'] = plan.revision
      body.Labels['io.physicsos.worker.inputs'] = plan.validationWorker.inputsSha256
    }
    body.Labels[WORKER_OPERATION_LABEL] = workerState.operationNonce
    body.Labels[WORKER_CREATE_LABEL] = nonce
    const creation = { nonce, image: expected, body, configHash: body.Labels['com.docker.compose.config-hash'], requestSha256: jsonDigest(body), submitted: true, uncertain: false }
    workerState.creates.push(creation)
    await saveWorkerJournal()
    let response
    try { response = await createWorker({ name: workerName(source), body, apiVersion: source.validationWorker.apiVersion, timeoutMs: plan.timeoutMs ?? 150_000 }) }
    catch (error) {
      creation.uncertain = error?.createUncertain !== false
      await saveWorkerJournal()
      await reconcileWorkerCreates()
      throw new Error('Worker Engine create failed; its submitted nonce is recorded')
    }
    if (!containerId.test(response?.Id ?? '')) {
      creation.uncertain = true
      await saveWorkerJournal()
      await reconcileWorkerCreates()
      throw new Error('Worker Engine create did not return a full daemon ID')
    }
    await recordWorkerId(creation, response.Id)
    const created = jsonOf(await docker(['inspect', response.Id]))[0]
    guardOwnedWorker(plan, source, created, workerState)
    if (response.Warnings != null && (!Array.isArray(response.Warnings) || response.Warnings.length)) throw new Error('Worker Engine create reported configuration warnings')
    await docker(['start', response.Id])
  }
  const verifiedWorker = async expected => {
    const workers = await workerContainers(docker, compose, source)
    if (workers.length !== 1 || !workerState.owned.has(workers[0].Id) || workers[0].Image !== expected) throw new Error('Expected exactly one owned validation worker')
    const worker = workers[0]
    guardOwnedWorker(plan, source, worker, workerState)
    if (!worker.State?.Running || worker.State.Health?.Status !== 'healthy') throw new Error('Validation worker is not healthy')
    await guardOriginalWorkerOwnership(plan, source, worker)
    await guardWorkerFiles(plan, source, switched, workerState.envRestored)
    const current = jsonOf(await docker([...compose, 'config', '--format', 'json']))
    guardWorkerConfiguration(plan, source, current)
    if (current.services[WORKER_SERVICE].image !== expected) throw new Error('Validation worker Compose image differs from the running image')
    return worker.Id
  }
  const waitForWorker = async (expected, signal) => {
    const deadline = Date.now() + (plan.timeoutMs ?? 150_000)
    do {
      aborted(signal)
      try { return await verifiedWorker(expected) } catch {
        if (Date.now() >= deadline) break
        await delay(plan.intervalMs ?? 1000)
      }
    } while (Date.now() < deadline)
    throw new Error('Exact validation worker did not become healthy')
  }
  const waitForImage = async (expected, signal, expectedWorker) => {
    const deadline = Date.now() + (plan.timeoutMs ?? 150_000)
    do {
      aborted(signal)
      try {
        const ids = textOf(await docker([...compose, 'ps', '--all', '--quiet', 'app'])).split(/\s+/).filter(Boolean)
        if (ids.length !== 1) throw new Error('Expected exactly one app container')
        const app = jsonOf(await docker(['inspect', ids[0]]))[0]
        if (app.Image !== expected) throw new Error('Running image differs')
        if (!app.State?.Running || app.State.Health?.Status !== 'healthy') throw new Error('App is not healthy')
        for (const service of ['redis', 'postgres']) {
          const dependency = jsonOf(await docker(['inspect', source.containers[service].Id]))[0]
          if (!dependency.State?.Running || dependency.State.Health?.Status !== 'healthy' || dependency.Image !== source.containers[service].Image) throw new Error('Dependency identity/health changed')
        }
        await docker([...compose, 'exec', '-T', 'app', 'node', '-e', RESTORE_READINESS_SCRIPT, 'http://127.0.0.1:3080/readyz', '2000'], { timeoutMs: 5000 })
        await writerLease(source, docker, compose, 1, app)
        if (source.validationWorker) await verifiedWorker(expectedWorker)
        return
      } catch {
        if (Date.now() >= deadline) break
        await delay(plan.intervalMs ?? 1000)
      }
    } while (Date.now() < deadline)
    throw new Error('Verified running image did not become ready')
  }
  const recover = async () => {
    if (!stopAttempted) return null
    // Release the preallocated reserve before recovery writes, including ENOSPC handling.
    if (reserve) await rm(reserve, { force: true }).catch(() => {})
    // Settle partial/daemon-accepted stops before restarting the original container.
    try { await docker([...compose, 'stop', '--timeout', '60', 'app', 'redis']) } catch { /* Verify before any metadata rollback. */ }
    const running = new Set(textOf(await docker([...compose, 'ps', '--status', 'running', '--services'])).split(/\s+/))
    if (running.has('app') || running.has('redis')) return false
    try {
      if (source.validationWorker) await reconcileWorkerCreates()
      await guardRecoverySource(plan, source, docker, compose, switched, workerState)
      await guardDataWriters(source, docker)
      await writerLease(source, docker, compose, 0)
    } catch { return false }
    for (const hook of [...attempted].reverse()) {
      try {
        if (!(await lstat(hook.snapshot)).isFile()) return false
        await runHook(hook, 'rollback')
      } catch { return false }
    }
    if (source.validationWorker) {
      try {
        await guardRecoverySource(plan, source, docker, compose, switched, workerState)
        await guardDataWriters(source, docker)
        await writerLease(source, docker, compose, 0)
      } catch { return false }
    }
    if (switched) {
      try { await rename(rollbackEnv, join(plan.projectDir, '.env')); workerState.envRestored = true } catch { return false }
    }
    if (source.validationWorker) {
      if (workerState.attempted) {
        try { await recreateWorker(plan.validationWorker.expectedOldImage, plan.expectedOldImage) } catch { /* Verify the daemon result, including a partial old-worker recreate. */ }
      }
      try {
        receipt.validationWorker.restoredContainerId = await waitForWorker(plan.validationWorker.expectedOldImage)
        receipt.validationWorker.restoredHealthy = true
        await guardRecoverySource(plan, source, docker, compose, switched, workerState)
        await guardDataWriters(source, docker)
        await writerLease(source, docker, compose, 0)
      } catch { return false }
    }
    try { await docker([...compose, 'start', 'redis']) } catch { /* Always attempt app recovery too. */ }
    try {
      if (switched) await docker([...compose, 'up', '-d', '--no-build', '--no-deps', '--pull', 'never', '--force-recreate', 'app'], { env: releaseEnv(plan.expectedOldImage, plan.validationWorker?.expectedOldImage) })
      else await docker([...compose, 'start', 'app'])
    } catch { /* Inspect the daemon result even when the CLI returned failure. */ }
    try {
      await waitForImage(plan.expectedOldImage, undefined, plan.validationWorker?.expectedOldImage)
      await verifyAuthenticatedRead(plan.acceptance, dependencies)
      if (source.validationWorker) await verifiedWorker(plan.validationWorker.expectedOldImage)
      return true
    } catch {
      if (source.validationWorker) {
        try { await docker([...compose, 'stop', '--timeout', '60', 'app', 'redis']) } catch { /* Failed recovery must not deliberately leave writers running. */ }
      }
      return false
    }
  }
  try {
    validateValidationWorker(plan)
    if (!imageId.test(plan.expectedOldImage) || !imageId.test(plan.candidateImage) || !commit.test(plan.revision) || !commit.test(plan.checkoutRevision ?? plan.revision) || !digest.test(plan.sourceDigest) || !digest.test(plan.codeDigest) || plan.rollbackCompatible !== true)
      throw new Error('Release requires immutable identities and explicit rollback compatibility')
    if (!['paired', 'full'].includes(plan.backup.mode) || (plan.backup.mode === 'full' && (!plan.backup.output || !plan.backup.keyFile)) || !plan.acceptance) throw new Error('Release requires paired recovery and authenticated acceptance')
    acceptanceOrigin(plan.acceptance)
    if (!Number.isInteger(plan.timeoutMs ?? 150_000) || (plan.timeoutMs ?? 150_000) < 1 || (plan.timeoutMs ?? 150_000) > 300_000 || !Number.isInteger(plan.intervalMs ?? 1000) || (plan.intervalMs ?? 1000) < 1) throw new Error('Invalid release timeout')
    aborted(plan.signal)
    lock = await acquireOperationLock(plan.projectDir, 'release')
    const stamp = new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomBytes(4).toString('hex')
    const targetRecovery = resolve(plan.recoveryDir ?? plan.backup.outputDir ?? join(plan.projectDir, 'backups', 'releases', stamp))
    if (plan.backup.mode === 'paired') plan.backup.outputDir = targetRecovery
    else await validateBackupKey(plan.backup.keyFile)
    const output = plan.backup.mode === 'paired' ? plan.backup.outputDir : plan.backup.output
    await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 })
    try { await lstat(output); throw new Error('Backup output already exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
    phase = 'preflight-files'
    source = await inspectBackupSource(plan, { docker })
    phase = 'preflight-identity'
    await guardIdentity(plan, source, docker, run)
    if (plan.validationWorker) {
      phase = 'preflight-validation-worker'
      source.validationWorker = await inspectValidationWorker(plan, source, docker)
      source.validationWorker.apiVersion = dependencies.createWorker ? undefined : await workerEngineVersion(docker)
      const ownershipDir = dirname(workerOwnershipPath(plan))
      await mkdir(ownershipDir, { recursive: true, mode: 0o700 })
      const directory = await lstat(ownershipDir)
      if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error('Worker ownership directory must be private')
      workerState.owned.set(source.validationWorker.container.Id, { original: true, image: plan.validationWorker.expectedOldImage })
      receipt.validationWorker = { service: WORKER_SERVICE, imageEnv: WORKER_IMAGE_ENV, oldImage: plan.validationWorker.expectedOldImage,
        newImage: plan.validationWorker.candidateImage, oldContainerId: source.validationWorker.container.Id,
        revision: plan.revision, inputsSha256: plan.validationWorker.inputsSha256, operationNonce: workerState.operationNonce, ownedContainerIds: [...workerState.owned.keys()] }
      // Preview only: production .env and the live worker remain untouched.
      const projected = jsonOf(await docker([...compose, 'config', '--format', 'json'], { env: releaseEnv(plan.candidateImage, plan.validationWorker.candidateImage) }))
      guardWorkerConfiguration(plan, source, projected)
      if (projected.services.app.image !== plan.candidateImage || projected.services[WORKER_SERVICE].image !== plan.validationWorker.candidateImage)
        throw new Error('Paired image env assignments do not bind the intended services')
      source.validationWorker.configHashes.new = await workerConfigHash(docker, compose, releaseEnv(plan.candidateImage, plan.validationWorker.candidateImage))
      receipt.validationWorker.configHashes = { ...source.validationWorker.configHashes }
    }
    phase = 'preflight-writer-lease'
    await writerLease(source, docker, compose, 1)
    phase = 'preflight-disk-space'
    await checkSpace(plan, source, docker, compose)
    recovery = targetRecovery
    await mkdir(recovery, { recursive: false, mode: 0o700 }).catch(async error => {
      if (error.code !== 'ENOENT') throw error
      await mkdir(dirname(recovery), { recursive: true, mode: 0o700 })
      await mkdir(recovery, { mode: 0o700 })
    })
    if (source.validationWorker) await guardWorkerFiles(plan, source, false)
    const prior = await readFile(join(plan.projectDir, '.env'))
    await preallocate(join(recovery, '.env.before'), prior)
    await preallocate(join(recovery, 'compose.before.yml'), await readFile(join(plan.projectDir, 'compose.yml')))
    nextEnv = join(plan.projectDir, `.physicsos-release-next-${stamp}`)
    rollbackEnv = join(plan.projectDir, `.physicsos-release-rollback-${stamp}`)
    await preallocate(nextEnv, source.validationWorker?.env.next ?? envWithImage(prior, plan.candidateImage), source.validationWorker?.env.mode)
    await preallocate(rollbackEnv, source.validationWorker?.env.rollback ?? envWithImage(prior, plan.expectedOldImage), source.validationWorker?.env.mode)
    reserve = join(recovery, '.rollback-space')
    await preallocate(reserve, Buffer.alloc(8 * 1024 * 1024))
    receipt.rollbackTag = `physicsos:rollback-${stamp}`
    await docker(['tag', plan.expectedOldImage, receipt.rollbackTag])
    if (source.validationWorker) {
      receipt.validationWorker.rollbackTag = `physicsos-validation:rollback-${stamp}`
      await docker(['tag', plan.validationWorker.expectedOldImage, receipt.validationWorker.rollbackTag])
    }
    const hooks = (plan.hooks ?? []).map(hook => ({ ...hook, snapshot: join(recovery, hook.snapshotName ?? `${hook.id}-snapshot.json`) }))
    const names = new Set()
    phase = 'preflight-hooks'
    for (const hook of hooks) {
      if (names.has(hook.id) || !/^[A-Za-z0-9_.-]+$/.test(hook.snapshotName ?? `${hook.id}-snapshot.json`) || ['.', '..'].includes(hook.snapshotName)) throw new Error('Unsafe or duplicate hook snapshot')
      names.add(hook.id)
      await runHook(hook, 'preflight')
    }
    phase = 'preflight-authentication'
    await verifyAuthenticatedRead({ ...plan.acceptance, signal: plan.signal }, dependencies)
    await atomicRecord(join(recovery, 'release.json'), { ...receipt, phase, hooks: hooks.map(hook => ({ id: hook.id, sha256: hook.sha256 })), startedAt: new Date().toISOString() })
    aborted(plan.signal)
    // Recheck immutable guards immediately before the first stop; preflight can take time.
    const checkedSource = await inspectBackupSource(plan, { docker })
    await guardIdentity(plan, checkedSource, docker, run)
    if (source.validationWorker) {
      await guardWorkerFiles(plan, source, false)
      checkedSource.validationWorker = { container: await inspectOriginalWorker(plan, checkedSource, docker) }
      guardCapturedSource(source, checkedSource)
    }
    phase = 'capture'
    stopAttempted = true
    await docker([...compose, 'stop', '--timeout', '60', 'app', 'redis'])
    aborted(plan.signal)
    const stoppedSource = await inspectBackupSource(plan, { docker })
    if (source.validationWorker) stoppedSource.validationWorker = { container: await inspectOriginalWorker(plan, stoppedSource, docker) }
    guardCapturedSource(source, stoppedSource)
    await guardDataWriters(stoppedSource, docker)
    await writerLease(source, docker, compose, 0)
    for (const hook of hooks) await runHook(hook, 'preflight')
    if (source.validationWorker) await guardRecoverySource(plan, source, docker, compose, false, workerState)
    const backup = await (dependencies.capture ?? captureQuiescedStores)({ ...plan.backup, projectDir: plan.projectDir, source, signal: plan.signal }, { docker })
    aborted(plan.signal)
    receipt.backup = backup
    await atomicRecord(join(recovery, 'paired-recovery.json'), { ...receipt, consistent: true })
    phase = 'configuration'
    for (const hook of hooks) {
      attempted.push(hook)
      await runHook(hook, 'apply')
      const snapshot = await lstat(hook.snapshot)
      if (!snapshot.isFile() || !snapshot.size || (snapshot.mode & 0o077)) throw new Error('Hook did not retain a private pre-write snapshot')
      aborted(plan.signal)
    }
    phase = 'cutover'
    if (source.validationWorker) {
      await guardRecoverySource(plan, source, docker, compose, false, workerState)
      await guardDataWriters(source, docker)
      await writerLease(source, docker, compose, 0)
    }
    switched = true
    await rename(nextEnv, join(plan.projectDir, '.env'))
    if (source.validationWorker) {
      phase = 'validation-worker-cutover'
      await guardRecoverySource(plan, source, docker, compose, true, workerState)
      aborted(plan.signal)
      await recreateWorker(plan.validationWorker.candidateImage, plan.candidateImage)
      receipt.validationWorker.newContainerId = await waitForWorker(plan.validationWorker.candidateImage, plan.signal)
      receipt.validationWorker.newHealthy = true
      await atomicRecord(join(recovery, 'paired-recovery.json'), { ...receipt, consistent: true })
      await guardRecoverySource(plan, source, docker, compose, true, workerState)
      await guardDataWriters(source, docker)
      await writerLease(source, docker, compose, 0)
      phase = 'cutover'
    }
    await docker([...compose, 'start', 'redis'])
    aborted(plan.signal)
    await docker([...compose, 'up', '-d', '--no-build', '--no-deps', '--pull', 'never', '--force-recreate', 'app'], { env: releaseEnv(plan.candidateImage, plan.validationWorker?.candidateImage) })
    await waitForImage(plan.candidateImage, plan.signal, plan.validationWorker?.candidateImage)
    phase = 'acceptance'
    const checks = await verifyAuthenticatedRead({ ...plan.acceptance, signal: plan.signal }, dependencies)
    if (source.validationWorker) await verifiedWorker(plan.validationWorker.candidateImage)
    await atomicRecord(join(recovery, 'success.json'), { ...receipt, checks, completedAt: new Date().toISOString() })
    return { deployed: true, image: plan.candidateImage, revision: plan.revision, recovery, backup, checks,
      ...(source.validationWorker ? { validationWorker: { image: plan.validationWorker.candidateImage, containerId: receipt.validationWorker.newContainerId } } : {}) }
  } catch {
    let rollbackHealthy = false
    try { rollbackHealthy = await recover() } catch { rollbackHealthy = false }
    if (recovery) await atomicRecord(join(recovery, 'rollback.json'), { ...receipt, phase, switched, rollbackHealthy, untouched: !stopAttempted }).catch(() => {})
    const error = new Error(`Release ${phase} failed; ${stopAttempted ? 'recovery status is recorded' : 'production was not stopped'}`)
    error.phase = phase
    error.rollbackHealthy = rollbackHealthy
    error.recovery = recovery
    throw error
  } finally {
    for (const file of [nextEnv, rollbackEnv, reserve].filter(Boolean)) await rm(file, { force: true }).catch(() => {})
    if (lock) await lock.release()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cancellation = terminationSignal()
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--plan-file') throw new Error('Use --plan-file with a private reviewed release plan')
    const plan = JSON.parse(await privateText(process.argv[3]))
    console.log(JSON.stringify(await releaseSwitch({ ...plan, signal: cancellation.signal })))
  } catch (error) {
    console.error(JSON.stringify({ deployed: false, phase: error.phase ?? 'preflight', rollbackHealthy: error.rollbackHealthy ?? null, recovery: error.recovery ?? null }))
    process.exitCode = 1
  } finally { cancellation.dispose() }
}
