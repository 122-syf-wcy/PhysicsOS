/** Candidate-only plumbing. No server commands, successful-response mocks, product imports or browser.close(). */
import { strict as assert } from 'node:assert'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { acceptanceConfig, AUTH_ROLES, isModelInferenceRequest } from './courseware-browser-helpers.mjs'

export const AVATAR_IDS = Object.freeze(['silver-greeting', 'indigo-reader', 'butterfly-light', 'pendulum', 'batik-star', 'mountain-sound', 'lens-maker', 'copper-drum', 'green-wave', 'red-embroidery', 'silver-moon', 'discovery'])
export const avatarPath = id => `/physicsos/avatars/guizhou-v1/${id}-192.webp`
export const idPath = id => encodeURIComponent(id)
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
export const canonical = value => JSON.stringify(sortJson(value))
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]))
  return value
}
export const operationId = () => randomUUID()
export const identityFields = ['id', 'schoolId', 'schoolName', 'username', 'role']
export const STAGES = Object.freeze(['avatar', 'recent', 'canvas', 'whiteboard', 'workspace', 'layout', 'statistics', 'roles'])
export const AUTHORIZATION_VERSION = 'teaching-tools-owned-rpc-v4-workspace-follow'
// Source-verified Connection/Gateway templates; runtime packets and server admission remain candidate evidence.
const COOKIE_SCOPED_HTTP_READS = Object.freeze({
  'session/list': { args: { _request: {} } },
  'agentPresets/list': { args: {} },
  'session/modelCatalog': { args: {} },
})
const READONLY_MUX_PATH = '/api/remote.mux'
const READONLY_STREAM_ENDPOINTS = new Set(['workspace/follow', 'session/control', '$events'])
const opaqueCorrelation = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value)
export const fileSha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const OUTPUT_LEASE = Symbol('exclusive teaching-tools output')
const READ_RPC_VERBS = new Set(['get', 'read', 'list', 'snapshot', 'getsnapshot', 'describe', 'status', 'capabilities'])
const REFERENCE_RPC_VERBS = new Set(['retain', 'release', 'addreference', 'removereference', 'subscribe', 'unsubscribe', 'pin', 'unpin'])
const RPC_KINDS = new Set(['actor', 'workspace', 'session', 'canvas', 'whiteboard', 'recent'])
function rpcVerb(operation) { return operation.split(/[.:/]/).at(-1).replace(/[-_]/g, '').toLowerCase() }
function exactKeys(value, allowed) { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) }
function closedKeys(value, keys) { return exactKeys(value, keys) && keys.every(key => Object.hasOwn(value, key)) }
const WORKSPACE_FOLLOW = 'workspace-follow-v1'
const WORKSPACE_VIEW_KEYS = ['workspaceId', 'path', 'title', 'sessionIds', 'createdAt', 'updatedAt']
const isIsoInstant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))
export const PENDULUM_SCENE = /^mechanics-simple-pendulum-[0-9a-z]+-[0-9a-z]+$/
const PENDULUM = 'simple-pendulum', RUN_API = '/physicsos/experiment-runs/v1', RUN_CAPABILITY = 'experiment-run-v1'
const RUN_REQUEST_KEYS = ['runId', 'experimentId', 'expectedCapabilityGeneration']
const isRunId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const isRunPermit = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
const runProvenance = value => value.provenance === 'client-observed' && value.boundary === 'platform-engine-first-step' && value.scope === 'lab-workspace'
const runOwnerHeader = 'x-physicsos-experiment-run-owner'
function exactPendulumPage(value, origin, sceneId) {
  try {
    const page = new URL(value), route = new URL(page.hash.slice(1), page.origin)
    return page.origin === origin && page.pathname === '/' && !page.search && route.origin === origin && route.pathname === `/experiments/${PENDULUM}` && route.searchParams.size === 1 && route.searchParams.get('scene') === sceneId && !route.hash
  } catch { return false }
}
function bindings(template, result = []) {
  if (!template || typeof template !== 'object') return result
  if (Object.hasOwn(template, '$bound')) { result.push(template); return result }
  for (const child of Object.values(template)) bindings(child, result)
  return result
}
function validateRpcContract(contract, roles) {
  assert.ok(contract?.schemaVersion === 1 && contract.protocol === 'exact-json-envelope-v1' && Array.isArray(contract.http) && Array.isArray(contract.webSocket), 'An explicit real Harness RPC envelope contract is required; unknown protocols are never guessed or forwarded')
  for (const [transport, rules] of [['http', contract.http], ['webSocket', contract.webSocket]]) for (const rule of rules) {
    assert.ok(exactKeys(rule, ['path', 'method', 'roles', 'effect', 'operation', 'operationPointer', 'resourcePointers', 'template']), 'RPC rules may not introduce hidden authorization options')
    assert.ok(typeof rule.path === 'string' && rule.path.startsWith('/api/') && !rule.path.includes('?') && !rule.path.includes('*'), 'RPC endpoint must be an exact candidate API path')
    assert.ok(Array.isArray(rule.roles) && rule.roles.length && rule.roles.every(role => roles.includes(role) || role === 'anonymous'), 'RPC role keys must be explicitly expected fixtures')
    assert.ok(transport === 'http' ? ['GET', 'HEAD', 'POST'].includes(rule.method) : rule.method === 'WS', 'Native DELETE/PUT/PATCH and unknown transports are never authorized')
    assert.ok(['read', 'reference'].includes(rule.effect), 'Native persisted-data mutations are not part of this verifier; only explicit reads and owned reference operations are allowed')
    if (transport === 'http' && rule.effect === 'reference') assert.equal(rule.method, 'POST', 'Reference changes require the exact POST RPC transport')
    const endpointWords = decodeURIComponent(rule.path).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/)
    assert.ok(!endpointWords.some(word => ['delete', 'remove', 'destroy', 'create', 'rename', 'write', 'set', 'mutate', 'exec', 'execute', 'uninstall'].includes(word)), 'A read/reference rule cannot disguise a persisted mutation endpoint')
    assert.ok(typeof rule.operation === 'string' && typeof rule.operationPointer === 'string' && rule.operationPointer.startsWith('/'), 'RPC operation needs an exact real dispatch pointer')
    assert.ok(exactKeys(rule.template, ['path', 'query', 'body']) && rule.template.path === rule.path && Object.hasOwn(rule.template, 'query') && Object.hasOwn(rule.template, 'body'), 'RPC envelope template must close path/query/body, not just inspect one method name')
    assert.equal(jsonPointer(rule.template, rule.operationPointer), rule.operation, 'The dispatch operation must be a fixed template literal, never a wildcard')
    assert.ok((rule.effect === 'read' ? READ_RPC_VERBS : REFERENCE_RPC_VERBS).has(rpcVerb(rule.operation)), 'RPC operation is not in the verifier’s fixed read/reference whitelist')
    assert.ok(rule.template.body === null || rule.template.body && typeof rule.template.body === 'object' && !Array.isArray(rule.template.body), 'Native RPC batches and opaque payloads are not authorized')
    const nestedOperations = value => {
      if (!value || typeof value !== 'object' || Object.hasOwn(value, '$bound')) return
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!['calls', 'commands', 'operations', 'requests'].includes(key) || !Array.isArray(child), 'A permitted envelope cannot carry an extra RPC batch')
        if (['method', 'operation', 'command', 'action', 'cmd', 'op'].includes(key) && typeof child === 'string') assert.ok(child === rule.operation || ['call', 'request', 'invoke'].includes(child), 'Hidden second dispatch operations are not permitted')
        nestedOperations(child)
      }
    }
    nestedOperations(rule.template.body); nestedOperations(rule.template.query)
    const dynamic = bindings(rule.template)
    for (const binding of dynamic) assert.ok(exactKeys(binding, ['$bound', 'kind']) && ['ownedId', 'ownedIds', 'actorId', 'requestId', 'timestamp'].includes(binding.$bound) && (!['ownedId', 'ownedIds'].includes(binding.$bound) || RPC_KINDS.has(binding.kind)), 'RPC wildcards may only bind typed correlation data or exact owned IDs')
    if (rule.effect === 'reference') {
      assert.ok(Array.isArray(rule.resourcePointers) && rule.resourcePointers.length > 0, 'Every reference mutation must identify the real protocol resource pointer')
      for (const resource of rule.resourcePointers) {
        assert.ok(exactKeys(resource, ['pointer', 'kind']) && typeof resource.pointer === 'string' && resource.pointer.startsWith('/') && RPC_KINDS.has(resource.kind), 'Reference resource pointers must be exact')
        const binding = jsonPointer(rule.template, resource.pointer)
        assert.ok(binding && ['ownedId', 'ownedIds'].includes(binding.$bound) && binding.kind === resource.kind, 'Each real mutation resource pointer must bind exact owned IDs')
      }
    }
    if (rule.effect === 'read') assert.ok(dynamic.some(binding => ['ownedId', 'ownedIds', 'actorId'].includes(binding.$bound)) || ['status', 'capabilities'].includes(rpcVerb(rule.operation)), 'Unbound global RPC reads are not authorized')
  }
}
async function canonicalPath(path) {
  const absolute = resolve(path)
  try { return await realpath(absolute) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const parent = dirname(absolute)
  assert.notEqual(parent, absolute, 'Artifact path must have an existing canonical ancestor')
  return join(await canonicalPath(parent), basename(absolute))
}
function inside(path, parent) { const value = relative(parent, path); return value === '' || !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value) }
export function checkpointManifest(resources) {
  assert.ok(Array.isArray(resources) && resources.length > 0 && resources.length <= 1024, 'Checkpoint must cover a nonempty bounded original resource set')
  const seen = new Set()
  return resources.map(resource => {
    assert.ok(['canvas', 'whiteboard', 'recent', 'workspace'].includes(resource.kind) && typeof resource.id === 'string' && resource.snapshot && typeof resource.snapshot === 'object', 'Checkpoint resource must include its exact kind/ID and complete authority snapshot')
    const key = `${resource.kind}:${resource.id}`; assert.ok(!seen.has(key), 'Checkpoint resource identities cannot repeat'); seen.add(key)
    return { kind: resource.kind, id: resource.id, snapshotSha256: digest(resource.snapshot) }
  }).sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))
}

export async function privateJson(path, label) {
  assert.ok(typeof path === 'string' && isAbsolute(path), `${label} requires a private absolute JSON path`)
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { throw new Error(`${label} is missing or is not valid JSON`) }
}
function text(value, label, max = 256) {
  assert.ok(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value), `${label} is required`)
  return value
}
function originOf(value) {
  const url = new URL(text(value, 'candidate origin', 2048))
  assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Candidate origin must be HTTP(S) without URL credentials')
  assert.ok(!['physics.dongsiwei.com', '38.76.190.3'].includes(url.hostname.toLowerCase().replace(/\.$/, '')), 'Production and retired hosts are forbidden, including alternate ports')
  assert.ok(url.pathname === '/' && !url.search && !url.hash, 'Use a clean candidate origin, not a launch-token URL')
  return url.origin
}
function sameIdentity(actual, expected, label) {
  assert.ok(actual && typeof actual.displayName === 'string' && AUTH_ROLES.includes(actual.role), `${label} must return a real AuthUser wire principal`)
  for (const key of identityFields) assert.equal(actual[key], expected[key], `${label} ${key} must match the exact isolated fixture`)
}
function validateState(state, origin, label) {
  const host = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  assert.ok(state && Array.isArray(state.cookies) && Array.isArray(state.origins) && Object.keys(state).every(key => ['cookies', 'origins'].includes(key)), `${label} must be cookies/localStorage only`)
  for (const cookie of state.cookies) assert.equal(String(cookie.domain).toLowerCase().replace(/^\./, '').replace(/^\[|\]$/g, ''), host, `${label} cookie must belong to the exact candidate host`)
  for (const entry of state.origins) {
    assert.equal(entry.origin, origin, `${label} localStorage must belong to this candidate`)
    assert.ok(Array.isArray(entry.localStorage) && Object.keys(entry).every(key => ['origin', 'localStorage'].includes(key)), `${label} must not restore IndexedDB or stale document caches`)
  }
}
function validateNativeProbe(probe, kind) {
  if (probe === undefined) return
  assert.ok(exactKeys(probe, ['stream', 'path', 'recordPointer', 'idPointer']), 'Native probes must be explicit JSON objects')
  if (Object.hasOwn(probe, 'stream')) {
    assert.ok(kind === 'workspace' && closedKeys(probe, ['stream']) && probe.stream === WORKSPACE_FOLLOW, 'The only native stream probe is the closed workspace-follow-v1 contract on a teacher workspace')
    return
  }
  assert.ok(typeof probe.path === 'string' && /^\/(?:api\/(?:workspaces?|sessions?)(?:[./?]|$)|physicsos\/learning\/)/.test(probe.path) && !/[\r\n]/.test(probe.path), 'Native probes must be explicit read-only workspace/session/learning API paths')
  assert.ok(typeof probe.recordPointer === 'string' && (probe.recordPointer === '' || probe.recordPointer.startsWith('/')), 'Native probe must identify the complete record, not a synthetic subset')
  assert.ok(typeof probe.idPointer === 'string' && probe.idPointer.startsWith('/'), 'Native probe must identify the exact record ID')
}
function jsonPointer(value, pointer) {
  if (pointer === '') return value
  let current = value
  for (const token of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, token)) return undefined
    current = current[token]
  }
  return current
}
function fixtureFingerprint(expected, states, origin) {
  return digest({ origin, identities: Object.fromEntries(Object.keys(states).sort().map(key => [key, Object.fromEntries(identityFields.map(field => [field, expected[key][field]]))])) })
}
function cidSet(value, expected, label) {
  assert.ok(Array.isArray(value) && value.length > 0 && value.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)), `${label} requires complete canonical CIDs`)
  assert.equal(canonical([...new Set(value)].sort()), canonical([...new Set(expected)].sort()), `${label} must be the exact before/after CID set`)
  assert.equal(new Set(value).size, value.length, `${label} cannot repeat CIDs`)
}
async function bindCheckpointInput(config, env) {
  if (!['after-restart', 'bridge'].includes(config.phase)) return undefined
  assert.ok(typeof env.TEACHING_TOOLS_CHECKPOINT === 'string' && isAbsolute(env.TEACHING_TOOLS_CHECKPOINT), 'Checkpoint input is required before any output/report write')
  const file = await realpath(env.TEACHING_TOOLS_CHECKPOINT), bytes = await readFile(file)
  const checkpoint = JSON.parse(bytes.toString('utf8'))
  assert.ok(checkpoint.schemaVersion === 1 && checkpoint.kind === 'teaching-tools-before-restart', 'Only a real teaching-tools before checkpoint can be used')
  for (const field of identityFields) assert.equal(checkpoint.teacher?.[field], config.expected.teacher[field], `Checkpoint teacher ${field} is exact`)
  const restored = config.phase === 'bridge' && config.expected.restoredFromOrigin === checkpoint.candidateOrigin
  assert.ok(checkpoint.candidateOrigin === config.origin || restored, 'Checkpoint origin must be exact or an explicit isolated restored copy')
  originOf(checkpoint.candidateOrigin)
  assert.equal(checkpoint.fixtureKey, fixtureFingerprint(config.expected, config.states, checkpoint.candidateOrigin), 'Checkpoint binds the complete expected fixture roster')
  assert.ok(typeof checkpoint.beforeResultFile === 'string' && isAbsolute(checkpoint.beforeResultFile), 'Original before-result is an absolute private input')
  const beforeFile = await realpath(checkpoint.beforeResultFile), beforeBytes = await readFile(beforeFile), before = JSON.parse(beforeBytes.toString('utf8'))
  assert.ok(before.phase === 'before-restart' && before.coreAcceptance === true && before.fullAcceptance === false && before.fixtureKey === checkpoint.fixtureKey, 'Before result must prove successful selected stages for this exact fixture')
  assert.equal(before.evidence?.authorizationVersion, AUTHORIZATION_VERSION, 'Unsafe/older verifier reports cannot authorize restart or bridge probes')
  const hash = fileSha256(bytes)
  assert.equal(before.restart?.checkpointSha256, hash, 'Checkpoint bytes must match the original SHA saved by the successful before report')
  assert.equal(await realpath(before.restart.checkpoint), file, 'Original report names this exact checkpoint file')
  const manifest = checkpointManifest(checkpoint.resources)
  assert.equal(canonical(manifest), canonical(before.restart.resourceManifest), 'Checkpoint covers the original nonempty resource/complete-snapshot manifest')
  assert.equal(canonical(manifest), canonical(checkpoint.resourceManifest), 'Checkpoint resource manifest is not a weakened loop input')
  const identities = new Set(manifest.map(value => `${value.kind}:${value.id}`))
  const original = (before.resources ?? []).filter(value => ['recent', 'workspace'].includes(value.kind) || ['canvas', 'whiteboard'].includes(value.kind) && value.createdByThisRun)
  assert.ok(original.length > 0, 'Successful before evidence must contain a nonempty original resource journal')
  for (const resource of original) assert.ok(identities.has(`${resource.kind}:${resource.id}`), 'Checkpoint cannot omit original before-run resources')
  for (const value of config.footprint.recentScenes ?? []) assert.ok(identities.has(`recent:${value.sceneId}`), 'Checkpoint cannot omit footprint recent resources')
  for (const workspace of config.footprint.workspaces ?? []) {
    const retained = checkpoint.resources.find(value => value.kind === 'workspace' && value.id === workspace.workspaceId)
    assert.ok(retained && workspace.nativeProbe && canonical(retained.nativeProbe) === canonical(workspace.nativeProbe), 'Checkpoint must retain the original declared native workspace probe')
    const materialDescriptors = materials => materials.map(({ kind, id, title, nativeProbe }) => ({ kind, id, title, nativeProbe }))
    assert.ok(Array.isArray(retained.snapshot.materials) && canonical(materialDescriptors(retained.snapshot.materials)) === canonical(materialDescriptors(workspace.materials)), 'Checkpoint must cover the entire original material set and probe contracts')
  }
  assert.equal(checkpoint.expectedAppContainerId, before.candidate?.externallyAttestedAppContainerId, 'Before application CID is bound to the original report')
  assert.equal(checkpoint.expectedDatabaseContainerId, before.candidate?.externallyAttestedDatabaseContainerId, 'Before database pin is bound to the original report')
  let receiptFile, receiptBytes, receipt, databasePinsComplete = false
  if (config.phase === 'after-restart') {
    assert.ok(typeof env.TEACHING_TOOLS_RESTART_RECEIPT === 'string' && isAbsolute(env.TEACHING_TOOLS_RESTART_RECEIPT), 'External restart receipt is required before any output write')
    receiptFile = await realpath(env.TEACHING_TOOLS_RESTART_RECEIPT); receiptBytes = await readFile(receiptFile); receipt = JSON.parse(receiptBytes.toString('utf8'))
    assert.ok(receipt.schemaVersion === 1 && receipt.candidateOrigin === config.origin && receipt.fixtureKey === checkpoint.fixtureKey && receipt.checkpointSha256 === hash, 'External receipt binds exact origin, fixture and original checkpoint bytes')
    assert.ok(receipt.appRestarted === true && typeof receipt.databaseRestarted === 'boolean' && Number.isFinite(Date.parse(receipt.completedAt)) && Date.parse(receipt.completedAt) > Date.parse(checkpoint.completedAt), 'Receipt must attest a later actual application restart')
    cidSet(receipt.appContainerIds, [checkpoint.expectedAppContainerId, config.footprint.appContainerId], 'Application restart')
    assert.equal(checkpoint.revision, config.footprint.revision, 'Restart must use the same expected source revision')
    if (receipt.databaseRestarted) {
      assert.ok(Array.isArray(receipt.databaseContainerIds) && receipt.databaseContainerIds.length > 0 && receipt.databaseContainerIds.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)), 'Any declared database receipt must use complete canonical CIDs')
      databasePinsComplete = /^[a-f0-9]{64}$/.test(checkpoint.expectedDatabaseContainerId ?? '') && /^[a-f0-9]{64}$/.test(config.footprint.databaseContainerId ?? '')
      if (databasePinsComplete) cidSet(receipt.databaseContainerIds, [checkpoint.expectedDatabaseContainerId, config.footprint.databaseContainerId], 'Database restart')
    }
  }
  return { file, bytesSha256: hash, beforeFile, beforeSha256: fileSha256(beforeBytes), receiptFile, receiptSha256: receiptBytes ? fileSha256(receiptBytes) : undefined, checkpoint, before, receipt, databasePinsComplete, resourceManifest: manifest }
}
async function exclusiveOutput(config, env, inputFiles) {
  if (env.TEACHING_TOOLS_OUTPUT !== undefined) assert.ok(isAbsolute(env.TEACHING_TOOLS_OUTPUT), 'Output must be an explicit absolute private directory')
  const output = await canonicalPath(config.output)
  try { await lstat(output); throw new Error('Output directory must be new and exclusive; existing reports or aliases are never reused') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const protectedFiles = [...inputFiles, config.checkpointProof?.file, config.checkpointProof?.beforeFile, config.checkpointProof?.receiptFile].filter(Boolean)
  for (const input of protectedFiles) {
    const path = await canonicalPath(input)
    assert.ok(!inside(path, output), 'Output cannot contain or overwrite any existing fixture/checkpoint/receipt input')
  }
  for (const input of [config.checkpointProof?.file, config.checkpointProof?.beforeFile, config.checkpointProof?.receiptFile].filter(Boolean)) {
    const directory = dirname(await realpath(input))
    assert.ok(!inside(output, directory) && !inside(directory, output), 'Output and before/checkpoint/receipt evidence directories must be isolated before the first report write')
  }
  let checkpointFile = config.checkpointProof?.file
  if (config.phase === 'before-restart') {
    checkpointFile = await canonicalPath(env.TEACHING_TOOLS_CHECKPOINT ?? join(output, 'checkpoint.json'))
    assert.ok(dirname(checkpointFile) === output && !['report.json', 'report.json.pending'].includes(basename(checkpointFile)), 'New checkpoint must be a distinct file inside this exclusive output directory')
  }
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await mkdir(output, { mode: 0o700 }) // No recursive reuse: an existing directory/symlink is a hard failure.
  assert.equal(await realpath(output), output, 'Exclusive output must not resolve to an alias')
  return { output, checkpointFile, lease: Object.freeze({ output }) }
}
export async function teachingConfig(root, env) {
  const common = await acceptanceConfig(root, {
    ...env,
    COURSEWARE_BASE: env.TEACHING_TOOLS_BASE ?? env.COURSEWARE_BASE,
    COURSEWARE_EXPECTED_FIXTURE: env.TEACHING_TOOLS_EXPECTED_FIXTURE ?? env.COURSEWARE_EXPECTED_FIXTURE,
    COURSEWARE_STORAGE_STATE: env.TEACHING_TOOLS_STORAGE_STATE ?? env.COURSEWARE_STORAGE_STATE,
    COURSEWARE_STUDENT_STATE: env.TEACHING_TOOLS_STUDENT_STATE ?? env.COURSEWARE_STUDENT_STATE,
    COURSEWARE_FOREIGN_STATE: env.TEACHING_TOOLS_FOREIGN_STATE ?? env.COURSEWARE_FOREIGN_STATE,
    COURSEWARE_PHASE: 'core',
    COURSEWARE_OUTPUT: env.TEACHING_TOOLS_OUTPUT ?? resolve(tmpdir(), `physicsos-teaching-tools-${Date.now()}-${randomUUID()}`),
  })
  const origin = originOf(common.base)
  assert.equal(originOf(common.expected.candidateOrigin), origin)
  const footprint = await privateJson(env.TEACHING_TOOLS_FOOTPRINT, 'TEACHING_TOOLS_FOOTPRINT')
  assert.ok(footprint.schemaVersion === 1 && footprint.isolatedTestData === true, 'Teaching-tools footprint must explicitly acknowledge isolated data')
  assert.equal(originOf(footprint.candidateOrigin), origin, 'The teaching-tools footprint must name this exact candidate')
  for (const key of ['id', 'schoolId', 'username']) assert.equal(footprint.teacher?.[key], common.expected.teacher[key], `Footprint teacher ${key} must match the expected fixture`)
  assert.ok(/^[a-f0-9]{64}$/i.test(footprint.appContainerId ?? ''), 'Footprint must contain the coordinator-attested complete 64-hex candidate application CID')
  assert.ok(/^[a-f0-9]{40}$/i.test(footprint.revision ?? ''), 'Footprint must contain the full expected candidate source revision')
  const cdp = new URL(text(env.TEACHING_TOOLS_CDP, 'TEACHING_TOOLS_CDP', 2048))
  assert.ok(['http:', 'https:', 'ws:', 'wss:'].includes(cdp.protocol) && !cdp.username && !cdp.password && !cdp.search && !cdp.hash, 'An explicit CDP endpoint without URL credentials or token query is required')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(cdp.hostname.toLowerCase()), 'CDP must be exposed through an explicit loopback endpoint')
  const expected = { ...common.expected }, states = { ...common.states }
  for (const [key, state] of Object.entries(states)) validateState(state, origin, `${key} state`)
  for (const extra of footprint.extraFixtures ?? []) {
    assert.ok(['superAdmin', 'schoolAdmin', 'foreignAdmin'].includes(extra.key) && !(extra.key in states), 'Extra fixture key must be distinct and role-specific')
    assert.ok(extra.identity?.testAccount === true && identityFields.every(key => typeof extra.identity[key] === 'string') && AUTH_ROLES.includes(extra.identity.role), 'Extra fixture must use an exact test-only AuthUser identity')
    assert.equal(extra.identity.role, extra.key === 'superAdmin' ? 'SUPER_ADMIN' : 'SCHOOL_ADMIN', 'Extra fixture role is not an alias')
    if (extra.key === 'schoolAdmin') assert.equal(extra.identity.schoolId, expected.teacher.schoolId, 'School administrator must belong to the teacher fixture school')
    if (extra.key === 'foreignAdmin') assert.notEqual(extra.identity.schoolId, expected.teacher.schoolId, 'Foreign administrator must belong to another fixture school')
    expected[extra.key] = extra.identity
    states[extra.key] = await privateJson(extra.storageStateFile, `${extra.key} state`)
    validateState(states[extra.key], origin, `${extra.key} state`)
  }
  const recentScenes = footprint.recentScenes ?? [], workspaces = footprint.workspaces ?? []
  assert.ok(Array.isArray(recentScenes) && Array.isArray(workspaces), 'Existing-resource footprint must be explicit arrays')
  for (const scene of recentScenes) {
    text(scene.sceneId, 'Allowed recent scene ID'); text(scene.title, 'Allowed recent scene title')
    assert.equal(scene.kind, 'experiment', 'Use existing physical experiments, not question/code/AI fixtures')
    if (scene.recordExperimentRun !== undefined) {
      assert.ok(typeof scene.recordExperimentRun === 'boolean' && PENDULUM_SCENE.test(scene.sceneId) && ['单摆', 'Simple pendulum'].includes(scene.title), 'Run recording opt-in is only for an exact declared simple-pendulum fixture')
    }
  }
  assert.ok(recentScenes.filter(scene => scene.recordExperimentRun === true).length <= 1, 'A run may authorize only one declared simple-pendulum fixture')
  const workspaceIds = new Set()
  for (const workspace of workspaces) {
    text(workspace.workspaceId, 'Allowed native workspace ID'); text(workspace.title, 'Allowed native workspace title')
    assert.ok(!workspaceIds.has(workspace.workspaceId), 'Workspace probe IDs cannot repeat'); workspaceIds.add(workspace.workspaceId)
    validateNativeProbe(workspace.nativeProbe, 'workspace')
    assert.ok(Array.isArray(workspace.materials), 'Workspace footprint must enumerate every original material to preserve')
    const materialIds = new Set()
    for (const material of workspace.materials) {
      assert.ok(['canvas', 'session'].includes(material.kind), 'Preserved materials must be real canvas/session IDs')
      text(material.id, 'Original material ID'); text(material.title, 'Original material title'); validateNativeProbe(material.nativeProbe, material.kind)
      const key = `${material.kind}:${material.id}`
      assert.ok(!materialIds.has(key), 'Workspace material IDs cannot repeat within a kind'); materialIds.add(key)
    }
  }
  const phase = env.TEACHING_TOOLS_PHASE ?? 'core'
  assert.ok(['core', 'before-restart', 'after-restart', 'bridge'].includes(phase), 'Unknown teaching-tools phase')
  if (phase === 'bridge') assert.equal(expected.mode, 'bridge', 'Bridge checks require a separately declared bridge candidate fixture')
  else assert.equal(expected.mode, 'enabled', 'Enabled checks cannot silently run in a read-only bridge lane')
  const selectedStages = (env.TEACHING_TOOLS_STAGES ?? 'avatar,recent,canvas,whiteboard,workspace,layout').split(',').map(value => value.trim()).filter(Boolean)
  assert.ok(selectedStages.length && new Set(selectedStages).size === selectedStages.length && selectedStages.every(value => STAGES.includes(value)), 'Requested stages must be explicit known, non-duplicated names')
  let credentials
  if (footprint.loginCredentialsFile) {
    credentials = await privateJson(footprint.loginCredentialsFile, 'teacher relogin credentials')
    assert.equal(credentials.username, expected.teacher.username, 'Relogin credential identity must match the exact teacher')
    text(credentials.password, 'teacher relogin password', 2048)
  }
  const rpc = footprint.harnessRpc ?? { schemaVersion: 1, protocol: 'exact-json-envelope-v1', http: [], webSocket: [] }
  validateRpcContract(rpc, Object.keys(states))
  assert.equal(rpc.webSocket.length, 0, 'Only the fixed source-verified readonly mux policy is supported; custom WS dispatch rules cannot widen it')
  const nativeOwned = footprint.nativeOwned ?? {}
  assert.ok(exactKeys(nativeOwned, Object.keys(states)), 'Native ownership must name only expected fixture role keys')
  for (const [role, resources] of Object.entries(nativeOwned)) {
    assert.ok(exactKeys(resources, ['workspace', 'session', 'canvas', 'whiteboard', 'recent']), `${role} native ownership uses exact resource kinds`)
    for (const ids of Object.values(resources)) { assert.ok(Array.isArray(ids), 'Native owned IDs must be explicit arrays'); for (const id of ids) text(id, 'Exact native owned ID') }
  }
  if (footprint.databaseContainerId !== undefined) assert.ok(/^[a-f0-9]{64}$/.test(footprint.databaseContainerId), 'The expected database CID must be complete and canonical')
  const fixtureKey = fixtureFingerprint(expected, states, origin)
  const config = { ...common, base: origin, origin, root, expected, states, footprint, phase, selectedStages, cdp: cdp.href, credentials, fixtureKey, rpc, nativeOwned,
    checkpointFile: env.TEACHING_TOOLS_CHECKPOINT, restartReceiptFile: env.TEACHING_TOOLS_RESTART_RECEIPT,
    runId: `tt-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}` }
  config.checkpointProof = await bindCheckpointInput(config, env)
  const inputs = [env.TEACHING_TOOLS_EXPECTED_FIXTURE ?? env.COURSEWARE_EXPECTED_FIXTURE, env.TEACHING_TOOLS_FOOTPRINT,
    env.TEACHING_TOOLS_STORAGE_STATE ?? env.COURSEWARE_STORAGE_STATE, env.TEACHING_TOOLS_STUDENT_STATE ?? env.COURSEWARE_STUDENT_STATE,
    env.TEACHING_TOOLS_FOREIGN_STATE ?? env.COURSEWARE_FOREIGN_STATE, footprint.loginCredentialsFile, ...(footprint.extraFixtures ?? []).map(value => value.storageStateFile)]
  const lease = await exclusiveOutput(config, env, inputs)
  config.output = lease.output; config.checkpointFile = lease.checkpointFile; config.restartReceiptFile = config.checkpointProof?.receiptFile ?? env.TEACHING_TOOLS_RESTART_RECEIPT
  config[OUTPUT_LEASE] = lease.lease
  return config
}

function modelOperation(path, method, payload) {
  if (method !== 'GET' && /\/(?:v1\/)?(?:chat\/completions|responses|messages)(?:\/|$)/i.test(path)) return 'provider-inference'
  if (method === 'POST' && (/\/whiteboards\/[^/]+\/generations\/?$/.test(path) || /\/canvases\/[^/]+\/assistant\/jobs\/?$/.test(path))) return 'teaching-model-generation'
  if (method !== 'GET' && /\/(?:question-code|question-visual|research|agent)(?:\/|$)|\/(?:generate|generation|inference|completion)(?:\/|$)/i.test(path)) return 'generative-endpoint'
  const operations = method === 'GET' ? [] : [path]
  const visit = (value, depth = 0) => {
    if (depth > 8 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) { const names = value.filter(entry => typeof entry === 'string'); if (names.length) operations.push(names.join('.')); for (const entry of value.slice(0, 64)) visit(entry, depth + 1); return }
    for (const [key, entry] of Object.entries(value)) {
      if (/^(?:method|command|operation|endpoint|event|type|name|path)$/.test(key) && typeof entry === 'string') operations.push(entry)
      else if (entry && typeof entry === 'object') visit(entry, depth + 1)
    }
  }
  visit(payload)
  return operations.some(value => /(?:sessions?|chat)[.:/_-].*(?:send|submit|prompt|generate|turn)|(?:agents?|llm)[.:/_-].*(?:run|invoke|delegate|spawn|complete|generate)|chat[.:/_-]completions/i.test(value)) ? 'harness-inference-command' : undefined
}
function safeUrl(value, candidateOrigin) {
  try {
    const url = new URL(value)
    const path = url.origin === candidateOrigin ? url.pathname.replace(/\/(?:embed|content|token|tokens|key|secret)\/[^/]+/gi, '/[redacted]') : '/[external-or-cdp-path-redacted]'
    return `${url.origin}${path}`
  } catch { return '[unparseable URL]' }
}
export function makeHarness(config, browser) {
  assert.ok(config[OUTPUT_LEASE]?.output === config.output, 'Output/checkpoint isolation must be validated before creating any report writer')
  const publicUrl = value => safeUrl(value, config.origin)
  const secrets = new Set(Object.values(config.states).flatMap(state => state.cookies.map(cookie => cookie.value)).filter(value => typeof value === 'string' && value.length > 7))
  if (config.credentials) secrets.add(config.credentials.password)
  const safeError = error => {
    let result = String(error instanceof Error ? error.message : error)
    for (const secret of secrets) for (const value of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) result = result.split(value).join('[redacted]')
    return result.replace(/(?:https?|wss?):\/\/[^\s)"']+/g, publicUrl).slice(0, 1200)
  }
  const report = { schemaVersion: 1, scope: 'teaching-tools-selected-core-stages', fullAcceptance: false, coreAcceptance: false,
    fixtureKey: config.fixtureKey, phase: config.phase, candidate: { origin: config.origin, expectedRevision: config.footprint.revision, externallyAttestedAppContainerId: config.footprint.appContainerId, externallyAttestedDatabaseContainerId: config.footprint.databaseContainerId, containerInspectionPerformed: false },
    startedAt: new Date().toISOString(), requestedStages: config.selectedStages, stages: [], checks: [], unverified: [], errors: [],
    modelRequests: [], externalRequests: [], forbiddenMutations: [], activityAcks: [], experimentRunAcks: [], networkFailures: [], httpErrors: [], expectedDenials: [], resources: [],
    cleanup: { policy: 'retain fixtures and failure state; close owned contexts only', ownedContexts: [], resourcesRemoved: false },
    evidence: { successfulBodiesMocked: false, serverCommandsExecuted: false, browserClosed: false, existingContextsTouched: false, authorizationVersion: AUTHORIZATION_VERSION, outputIsolatedBeforeFirstWrite: true, nativeRpcRules: config.rpc.http.length + Object.keys(COOKIE_SCOPED_HTTP_READS).length + READONLY_STREAM_ENDPOINTS.size, startupReadonlySourceVerified: true, startupReadonlyPacketVerified: false, cookieScopedHttpReads: Object.keys(COOKIE_SCOPED_HTTP_READS), readonlyStreamEndpoints: [...READONLY_STREAM_ENDPOINTS], nativeWorkspaceWritesSupported: false, modelGuardScope: 'browser HTTP inference triggers and exact authorized outbound Harness WebSocket envelopes; not server-to-provider packet capture' } }
  const contexts = new Map(), canvases = new Set(), boards = new Set(), allowedRecent = new Set(config.footprint.recentScenes?.map(value => value.sceneId) ?? []), allowedWorkspaces = new Set(config.footprint.workspaces?.map(value => value.workspaceId) ?? [])
  const nativeProbePaths = new Set((config.footprint.workspaces ?? []).flatMap(workspace => [workspace.nativeProbe, ...workspace.materials.map(material => material.nativeProbe)]).map(probe => probe?.path).filter(path => typeof path === 'string'))
  let currentStage = 'preflight', writeQueue = Promise.resolve()
  const reportFile = join(config.output, 'report.json')
  const flush = () => {
    const snapshot = JSON.stringify(report, null, 2) + '\n'
    writeQueue = writeQueue.then(async () => { assert.equal(await realpath(config.output), config[OUTPUT_LEASE].output, 'Report output cannot be redirected to a before/input alias'); const pending = `${reportFile}.pending`; await writeFile(pending, snapshot, { mode: 0o600, flag: 'wx' }); await rename(pending, reportFile) })
    return writeQueue
  }
  const check = (label, condition, evidence = {}) => {
    report.checks.push({ stage: currentStage, label, passed: Boolean(condition), ...evidence })
    assert.ok(condition, label)
  }
  const unverified = (label, reason) => { report.unverified.push({ stage: currentStage, label, reason }); return undefined }
  const resources = (kind, id, title, detail = {}) => {
    if (kind === 'canvas' && detail.createdByThisRun !== false) canvases.add(id)
    if (kind === 'whiteboard' && detail.createdByThisRun !== false) boards.add(id)
    const previous = report.resources.find(value => value.kind === kind && value.id === id)
    if (previous) Object.assign(previous, detail)
    else report.resources.push({ kind, id, title, createdByThisRun: ['canvas', 'whiteboard'].includes(kind), cleanup: 'retained', ...detail })
  }
  const ownedIds = (ui, kind) => {
    if (!ui.verified || ui.transportOnly) return new Set()
    if (kind === 'actor') return new Set([config.expected[ui.role].id])
    const ids = new Set(config.nativeOwned[ui.role]?.[kind] ?? [])
    if (ui.role === 'teacher') {
      if (kind === 'workspace') for (const id of allowedWorkspaces) ids.add(id)
      if (kind === 'recent') for (const id of allowedRecent) ids.add(id)
      if (kind === 'canvas') for (const id of canvases) ids.add(id)
      if (kind === 'whiteboard') for (const id of boards) ids.add(id)
      for (const workspace of config.footprint.workspaces ?? []) for (const material of workspace.materials) if (material.kind === kind) ids.add(material.id)
    }
    return ids
  }
  const templateMatches = (ui, value, template) => {
    if (template && typeof template === 'object' && Object.hasOwn(template, '$bound')) {
      if (template.$bound === 'actorId') return ui.verified && !ui.transportOnly && value === config.expected[ui.role].id
      if (template.$bound === 'ownedId') return typeof value === 'string' && ownedIds(ui, template.kind).has(value)
      if (template.$bound === 'ownedIds') return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(id => typeof id === 'string' && ownedIds(ui, template.kind).has(id))
      if (template.$bound === 'requestId') return Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^[A-Za-z0-9_.:$-]{1,128}$/.test(value)
      if (template.$bound === 'timestamp') return Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
      return false
    }
    if (Array.isArray(template)) return Array.isArray(value) && value.length === template.length && template.every((item, index) => templateMatches(ui, value[index], item))
    if (template && typeof template === 'object') return !!value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical(Object.keys(template).sort()) && Object.keys(template).every(key => templateMatches(ui, value[key], template[key]))
    return value === template
  }
  const rpcAllowed = (ui, url, method, payload, transport) => {
    const role = ui.verified && !ui.transportOnly ? ui.role : ui.guestVerified ? 'anonymous' : undefined
    if (!role || url.origin !== config.origin) return false
    if (new Set([...url.searchParams.keys()]).size !== [...url.searchParams.keys()].length) return false
    const envelope = { path: url.pathname, query: Object.fromEntries(url.searchParams), body: payload ?? null }
    return config.rpc[transport].some(rule => rule.path === url.pathname && rule.method === method && rule.roles.includes(role) && jsonPointer(envelope, rule.operationPointer) === rule.operation && templateMatches(ui, envelope, rule.template))
  }
  const fixtureVerified = ui => ui.verified && !ui.transportOnly && ui.actor && identityFields.every(field => ui.actor[field] === config.expected[ui.role][field])
  const cookieScopedRead = (ui, url, method, payload) => {
    if (!fixtureVerified(ui) || method !== 'POST' || url.origin !== config.origin || url.search) return false
    const endpoint = url.pathname.startsWith('/api/') ? url.pathname.slice(5) : undefined
    return endpoint && Object.hasOwn(COOKIE_SCOPED_HTTP_READS, endpoint) && exactKeys(payload, ['type', 'rpcId', 'method', 'payload']) && payload.type === 'client-request' && payload.method === endpoint && opaqueCorrelation(payload.rpcId) && canonical(payload.payload) === canonical(COOKIE_SCOPED_HTTP_READS[endpoint])
  }
  const bridgeOwned = (kind, id) => config.phase === 'bridge' && config.checkpointProof?.resourceManifest.some(value => value.kind === kind && value.id === id)
  const experimentRunAllowed = async (ui, request, url, payload) => {
    const run = ui.experimentRun
    const live = () => ui.experimentRun === run && fixtureVerified(ui) && exactPendulumPage(ui.page.url(), config.origin, run.sceneId)
    const record = url.pathname === `${RUN_API}/record`
    if (!run || ui.role !== 'teacher' || !live() || url.origin !== config.origin || url.search || request.method() !== 'POST' || request.redirectedFrom()) return false
    try { if (request.frame() !== ui.page.mainFrame()) return false } catch { return false }
    if (!closedKeys(payload, record ? [...RUN_REQUEST_KEYS, 'permit'] : RUN_REQUEST_KEYS) || !isRunId(payload.runId) || payload.experimentId !== PENDULUM || payload.expectedCapabilityGeneration !== run.generation) return false
    const [owner, capability, origin, authorization, contentType] = await Promise.all([runOwnerHeader, 'x-physicsos-experiment-run-capability', 'origin', 'authorization', 'content-type'].map(name => request.headerValue(name)))
    try {
      const actor = ui.actor
      if (canonical(JSON.parse(decodeURIComponent(owner))) !== canonical({ schoolId: actor.schoolId, username: actor.username })) return false
    } catch { return false }
    if (!live() || capability !== RUN_CAPABILITY || origin !== config.origin || authorization !== null || contentType?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return false
    if (!record) {
      if (run.prepareRequest) return false
      run.prepareRequest = request; run.id = payload.runId
      return true
    }
    if (!run.prepareRequest || run.recordRequest || payload.runId !== run.id || !isRunPermit(payload.permit)) return false
    const prepared = await run.prepared.catch(() => undefined)
    if (!prepared || !live() || run.recordRequest || Date.now() >= prepared.expiresAt || digest(payload.permit) !== prepared.permitSha256) return false
    run.recordRequest = request
    return true
  }
  const allowedMutation = (ui, request, payload) => {
    const url = new URL(request.url()), path = url.pathname, method = request.method()
    if (path.startsWith('/api/')) {
      // Native writes remain unsupported, even when a footprint requests an opt-in; use pre-created owned fixtures.
      if (['/api/workspace/create', '/api/workspace/rename', '/api/workspace/initializeDefault', '/api/workspace/delete', '/api/session/create', '/api/$events/result'].includes(path)) return false
      if (cookieScopedRead(ui, url, method, payload)) return true
      if (method === 'GET' && fixtureVerified(ui) && ui.role === 'teacher' && nativeProbePaths.has(path + url.search)) return true
      return rpcAllowed(ui, url, method, payload, 'http')
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true
    if (path === `${RUN_API}/prepare` || path === `${RUN_API}/record`) return experimentRunAllowed(ui, request, url, payload)
    if (path === '/physicsos/auth/login') return method === 'POST' && ui.transportOnly && ui.guestVerified && !!config.credentials && exactKeys(payload, ['username', 'password', 'rememberDevice']) && payload.username === config.expected.teacher.username && payload.password === config.credentials.password
    if (!ui.verified || ui.transportOnly) return false
    if (path === '/physicsos/auth/me/avatar') return method === 'POST' && ui.role === 'teacher' && config.footprint.avatarSave === true && exactKeys(payload, ['avatarId']) && AVATAR_IDS.includes(payload.avatarId)
    if (path === '/physicsos/notice/platform-notice/ack') return method === 'POST' && exactKeys(payload, ['version']) && Number.isInteger(payload.version) && payload.version > 0
    if (path === '/physicsos/activity/v1/events') return method === 'POST' && exactKeys(payload, ['kind', 'id', 'pageInstanceId', 'module']) && ['visit', 'open'].includes(payload.kind) && ['id', 'pageInstanceId', 'module'].every(key => typeof payload[key] === 'string' && payload[key].length > 0 && payload[key].length <= 256)
    if (path === '/physicsos/usage/events') return method === 'POST' && exactKeys(payload, ['id', 'kind', 'surface', 'action']) && typeof payload.id === 'string' && typeof payload.surface === 'string' && (payload.kind === 'visit' || payload.kind === 'use' && payload.action === 'view')
    if (ui.role !== 'teacher') return false
    const fence = (keys, version, min = 1) => exactKeys(payload, keys) && Number.isInteger(payload[version]) && payload[version] >= min && Number.isInteger(payload.expectedGeneration) && payload.expectedGeneration >= min && typeof (payload.mutationId ?? payload.operationId) === 'string' && (payload.mutationId ?? payload.operationId).length > 0
    let match = path.match(/^\/physicsos\/learning\/product-state\/(recent-scenes|projects)\/([^/]+)$/)
    if (match) {
      const kind = match[1] === 'recent-scenes' ? 'recent' : 'workspace', id = decodeURIComponent(match[2]), owned = kind === 'recent' ? allowedRecent.has(id) : allowedWorkspaces.has(id)
      // A newly claimed native project has a real 0/0 lifecycle head before its first organization write.
      const firstWorkspaceDelete = kind === 'workspace' && payload?.action === 'delete' && payload.expectedVersion === 0 && payload.expectedGeneration === 0 && config.footprint.workspaces?.some(workspace => workspace.workspaceId === id && workspace.nativeProbe?.stream === WORKSPACE_FOLLOW)
      return method === 'POST' && !url.search && fence(['action', 'expectedVersion', 'expectedGeneration', 'operationId'], 'expectedVersion', firstWorkspaceDelete ? 0 : 1) && (owned && config.footprint.existingWrites === true && ['delete', 'restore', 'archive', 'unarchive', 'reopen'].includes(payload.action) || bridgeOwned(kind, id) && payload.action === 'archive')
    }
    if (path === '/physicsos/learning/canvases') return method === 'POST' && config.footprint.createCanvas === true && ui.creation?.kind === 'canvas' && exactKeys(payload, ['id', 'title', 'manifestDigest', 'mutationId']) && payload.title === ui.creation.title && typeof payload.id === 'string' && typeof payload.mutationId === 'string'
    if (path === '/physicsos/whiteboards') return method === 'POST' && config.footprint.createWhiteboard === true && ui.creation?.kind === 'whiteboard' && exactKeys(payload, ['title', 'operationId']) && payload.title === ui.creation.title && typeof payload.operationId === 'string'
    match = path.match(/^\/physicsos\/learning\/canvases\/([^/]+)(?:\/(.*))?$/)
    if (match) {
      const id = decodeURIComponent(match[1]), operation = match[2] ?? '', owned = canvases.has(id)
      if (operation === 'archive' && bridgeOwned('canvas', id)) return method === 'POST' && fence(['expectedVersion', 'expectedGeneration', 'mutationId'], 'expectedVersion')
      if (!owned) return false
      if (/^objects\/[a-f0-9]{64}$/.test(operation)) return method === 'PUT' && payload?.schemaVersion === 1
      if (operation === 'commit') return method === 'POST' && fence(['editingSessionId', 'expectedVersion', 'expectedGeneration', 'mutationId', 'manifestDigest'], 'expectedVersion') && /^[a-f0-9]{64}$/.test(payload.manifestDigest ?? '')
      if (['archive', 'unarchive', 'restore'].includes(operation)) return method === 'POST' && fence(['expectedVersion', 'expectedGeneration', 'mutationId'], 'expectedVersion')
      if (operation === '') return method === 'DELETE' && fence(['expectedVersion', 'expectedGeneration', 'mutationId'], 'expectedVersion')
      return false
    }
    match = path.match(/^\/physicsos\/whiteboards\/([^/]+)(?:\/(.*))?$/)
    if (match) {
      const id = decodeURIComponent(match[1]), operation = match[2] ?? '', owned = boards.has(id)
      if (operation === 'archive' && bridgeOwned('whiteboard', id)) return method === 'POST' && fence(['expectedRevision', 'expectedGeneration', 'operationId'], 'expectedRevision')
      if (!owned) return false
      if (operation === '' && method === 'PUT') return fence(['document', 'editingSessionId', 'expectedRevision', 'expectedGeneration', 'operationId'], 'expectedRevision') && payload.document?.id === id
      if (operation === '') return method === 'DELETE' && fence(['expectedRevision', 'expectedGeneration', 'operationId'], 'expectedRevision')
      return ['archive', 'unarchive', 'restore'].includes(operation) && method === 'POST' && fence(['expectedRevision', 'expectedGeneration', 'operationId'], 'expectedRevision')
    }
    match = path.match(/^\/physicsos\/learning\/scenes\/([^/]+)$/)
    if (match) { const id = decodeURIComponent(match[1]), fixture = config.footprint.recentScenes?.find(value => value.sceneId === id); return method === 'PUT' && !!fixture && payload?.sceneId === id && payload.title === fixture.title && payload.kind === 'experiment' }
    return false
  }
  const installGuards = async ui => {
    const context = ui.context
    context.on('page', page => page.on('pageerror', error => report.errors.push({ stage: currentStage, role: ui.role, message: safeError(error) })))
    context.on('request', request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && new URL(request.url()).origin === config.origin) ui.pendingWrites.add(request)
    })
    context.on('requestfinished', request => { ui.pendingWrites.delete(request) })
    context.on('requestfailed', request => {
      ui.pendingWrites.delete(request)
      const reason = request.failure()?.errorText ?? ''
      if (!reason.includes('ERR_ABORTED') && !reason.includes('ERR_BLOCKED_BY_CLIENT')) report.networkFailures.push({ stage: currentStage, role: ui.role, method: request.method(), url: publicUrl(request.url()), reason: reason.slice(0, 120) })
    })
    context.on('response', async response => {
      const request = response.request(), path = new URL(response.url()).pathname
      if (response.status() >= 400) {
        const deliberate = ui.expectedDenials.has(`${request.method()} ${path}`)
        const guest = ui.transportOnly && [401, 403].includes(response.status()) && (path === '/physicsos/auth/me' || path.startsWith('/api/'))
        const evidence = { stage: currentStage, role: ui.role, method: request.method(), url: publicUrl(response.url()), status: response.status() }
        if (deliberate || guest) report.expectedDenials.push(evidence)
        else report.httpErrors.push(evidence)
      }
      if (path === '/physicsos/activity/v1/events' && request.method() === 'POST' && response.ok()) {
        try { const event = request.postDataJSON(), ack = await response.json(); report.activityAcks.push({ stage: currentStage, role: ui.role, kind: event.kind, module: event.module, status: ack.status, occurredAt: ack.occurredAt }) } catch { report.errors.push({ stage: currentStage, role: ui.role, message: 'Activity ACK was not valid JSON' }) }
      }
    })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      let payload
      try { payload = request.postDataJSON() } catch {}
      const model = isModelInferenceRequest(request) ? 'shared-inference-predicate' : modelOperation(url.pathname, request.method(), payload)
      if (model) { report.modelRequests.push({ stage: currentStage, role: ui.role, transport: 'http', method: request.method(), url: publicUrl(url.href), kind: model }); await route.abort('blockedbyclient'); return }
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== config.origin) { report.externalRequests.push({ stage: currentStage, role: ui.role, url: publicUrl(url.href) }); await route.abort('blockedbyclient'); return }
      if (!await allowedMutation(ui, request, payload)) { report.forbiddenMutations.push({ stage: currentStage, role: ui.role, method: request.method(), url: publicUrl(url.href) }); await route.abort('blockedbyclient'); return }
      await route.continue()
    })
    assert.equal(typeof context.routeWebSocket, 'function', 'The runner must support real WebSocket interception')
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url()), normalized = new URL(url.href.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'))
      if (normalized.origin !== config.origin) { report.externalRequests.push({ stage: currentStage, role: ui.role, transport: 'websocket', url: publicUrl(url.href) }); socket.close({ code: 1008, reason: 'candidate-only verification' }); return }
      const reject = reason => {
        report.forbiddenMutations.push({ stage: currentStage, role: ui.role, transport: 'websocket', method: 'WS', url: publicUrl(url.href), reason })
        socket.close({ code: 1008, reason: 'only authenticated, associated readonly streams are permitted' })
      }
      if (!fixtureVerified(ui) || normalized.pathname !== READONLY_MUX_PATH || normalized.search) { reject('unverified-identity-or-unknown-ws-endpoint'); return }
      // Per physical socket inside this owned context: correlation IDs are never treated as resource/actor IDs.
      const streams = new Map()
      const server = socket.connectToServer() // Actual candidate only; no response body or success message is fabricated.
      server.onMessage(message => {
        let frame
        try { frame = JSON.parse(typeof message === 'string' ? message : message.toString('utf8')) } catch {}
        const known = frame && streams.get(frame.streamId)
        const shape = frame?.type === 'item' ? exactKeys(frame, ['type', 'streamId', 'value']) : frame?.type === 'error' ? exactKeys(frame, ['type', 'streamId', 'error']) : frame?.type === 'end' && exactKeys(frame, ['type', 'streamId'])
        if (!known || !shape) { reject('unexpected-server-stream-shape-or-unapproved-stream-id'); return }
        if (known.endpoint === '$events' && frame.type === 'item' && frame.value?.type === 'waterfall') { reject('host-waterfall-is-not-readonly-startup'); return }
        if (frame.type === 'end' || frame.type === 'error') known.finished = true
        socket.send(message) // Forward the real server frame unchanged.
      })
      socket.onMessage(message => {
        let frame
        try { frame = JSON.parse(typeof message === 'string' ? message : message.toString('utf8')) } catch {}
        const model = modelOperation(url.pathname, 'POST', frame)
        if (model) { report.modelRequests.push({ stage: currentStage, role: ui.role, transport: 'websocket', url: publicUrl(url.href), kind: model }); socket.close({ code: 1008, reason: 'model calls forbidden during verification' }); return }
        if (!fixtureVerified(ui) || !frame) { reject('unverified-identity-or-opaque-client-frame'); return }
        if (frame.type === 'open') {
          const valid = exactKeys(frame, ['type', 'streamId', 'endpoint', 'payload']) && opaqueCorrelation(frame.streamId) && READONLY_STREAM_ENDPOINTS.has(frame.endpoint) && canonical(frame.payload) === canonical({ args: {} }) && !streams.has(frame.streamId) && streams.size < 1024
          if (!valid) { reject('unknown-batch-or-nonempty-readonly-open'); return }
          streams.set(frame.streamId, { endpoint: frame.endpoint, endSent: false, cancelSent: false, finished: false })
        } else if (frame.type === 'cancel' || frame.type === 'end') {
          const known = streams.get(frame.streamId)
          if (!exactKeys(frame, ['type', 'streamId']) || !opaqueCorrelation(frame.streamId) || !known || known.cancelSent || frame.type === 'end' && known.endSent) { reject('unassociated-or-duplicate-readonly-stream-close'); return }
          if (frame.type === 'cancel') known.cancelSent = true
          else known.endSent = true
        } else { reject('client-item-and-unknown-dispatch-are-forbidden'); return }
        server.send(message)
      })
    })
  }
  const api = async (ui, path, { method = 'GET', data, expectDenied = false } = {}) => {
    assert.ok(path.startsWith('/') && new URL(path, config.origin).origin === config.origin, 'API reads/writes must remain candidate-relative')
    assert.ok(/^\/(?:physicsos\/(?:auth|learning|whiteboards|activity|admin\/activity)|healthz|readyz)(?:\/|\?|$)/.test(path) || method === 'GET' && (nativeProbePaths.has(path) || path === `${RUN_API}/capabilities`), 'No arbitrary server API or model endpoint is exposed by this helper')
    assert.ok(!(path === '/physicsos/activity/v1/events' && method !== 'GET'), 'A verifier must never manufacture visit/open/use business events')
    const actor = config.expected[ui.role], owner = { schoolId: actor.schoolId, username: actor.username }, headers = {}
    if (path.startsWith('/physicsos/learning/canvases') || path.startsWith('/physicsos/whiteboards')) headers['x-physicsos-canvas-owner'] = encodeURIComponent(JSON.stringify(owner))
    else if (path.startsWith('/physicsos/learning')) headers['x-physicsos-learning-owner'] = encodeURIComponent(JSON.stringify(owner))
    else if (path.startsWith('/physicsos/admin/activity')) headers['x-physicsos-activity-owner'] = encodeURIComponent(JSON.stringify(owner))
    else if (path === `${RUN_API}/capabilities`) headers[runOwnerHeader] = encodeURIComponent(JSON.stringify(owner))
    if (path === '/physicsos/auth/me/avatar') headers['x-physicsos-expected-owner'] = encodeURIComponent(JSON.stringify({ id: actor.id, ...owner }))
    const denialKey = `${method} ${new URL(path, config.origin).pathname}`
    if (expectDenied) ui.expectedDenials.add(denialKey)
    try {
      return await ui.page.evaluate(async ({ path, method, data, headers }) => {
        if (data !== undefined) headers['content-type'] = 'application/json'
        const response = await fetch(path, { method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
        const raw = await response.text()
        let body
        try { body = raw ? JSON.parse(raw) : undefined } catch { throw new Error(`Candidate response is not JSON (HTTP ${response.status})`) }
        return { status: response.status, ok: response.ok, body }
      }, { path, method, data, headers })
    } finally { if (expectDenied) ui.expectedDenials.delete(denialKey) }
  }
  const read = async (ui, path) => { const result = await api(ui, path); check(`real GET ${path.split('?')[0]}`, result.ok, { status: result.status }); return result.body }
  const recordPendulumRun = async (ui, fixture, playback) => {
    if (!fixture.recordExperimentRun) return playback()
    check('Run recording is armed only for one declared owned pendulum presentation in the enabled recent stage', currentStage === 'recent' && ['core', 'before-restart'].includes(config.phase) && config.footprint.existingWrites === true
      && ui.role === 'teacher' && fixtureVerified(ui) && config.footprint.recentScenes.includes(fixture) && !ui.experimentRun && !report.experimentRunAcks.length && exactPendulumPage(ui.page.url(), config.origin, fixture.sceneId))
    const caps = await read(ui, `${RUN_API}/capabilities`)
    check('Experiment recording capabilities match the closed real wire contract', closedKeys(caps, ['schemaVersion', 'capability', 'mode', 'recordingEnabled', 'capabilityGeneration', 'provenance', 'boundary', 'scope', 'permitTtlMs'])
      && caps.schemaVersion === 1 && caps.capability === RUN_CAPABILITY && ['enabled', 'bridge', 'off'].includes(caps.mode) && typeof caps.recordingEnabled === 'boolean'
      && (caps.mode === 'enabled' || !caps.recordingEnabled) && isRunId(caps.capabilityGeneration) && runProvenance(caps) && Number.isSafeInteger(caps.permitTtlMs) && caps.permitTtlMs > 0 && caps.permitTtlMs <= 300000)
    if (!caps.recordingEnabled) {
      unverified('experiment-run-durable-ack', 'Actual run recording is disabled; native playback is not counted as a durable lab use')
      return playback()
    }
    const run = { sceneId: fixture.sceneId, generation: caps.capabilityGeneration }
    ui.experimentRun = run
    const responseFor = key => ui.page.waitForResponse(response => response.request() === run[key], { timeout: 15000 })
    const runJson = async response => {
      try { return await response.json() } catch { throw new Error('Experiment-run ACK was not valid JSON') }
    }
    try {
      run.prepared = responseFor('prepareRequest').then(async response => {
        const value = await runJson(response)
        check('Real prepare ACK binds the declared experiment, fresh capability and outbound run ID', response.status() === 200 && closedKeys(value, [...RUN_REQUEST_KEYS, 'permit', 'expiresAt'])
          && value.runId === run.id && value.experimentId === PENDULUM && value.expectedCapabilityGeneration === run.generation && isRunPermit(value.permit) && isIsoInstant(value.expiresAt))
        return { permitSha256: digest(value.permit), expiresAt: Date.parse(value.expiresAt) } // Permit is never journaled or replayed.
      })
      const recorded = responseFor('recordRequest')
      void run.prepared.catch(() => {}); void recorded.catch(() => {})
      await playback()
      const response = await recorded, receipt = await runJson(response)
      check('Real non-replayed experiment-run ACK matches the authorized prepare/record pair and first engine step', response.status() === 200
        && closedKeys(receipt, ['runId', 'experimentId', 'recordedAt', 'provenance', 'boundary', 'scope', 'replayed']) && receipt.runId === run.id
        && receipt.experimentId === PENDULUM && isIsoInstant(receipt.recordedAt) && runProvenance(receipt) && receipt.replayed === false)
      report.experimentRunAcks.push({ stage: currentStage, role: ui.role, sceneId: fixture.sceneId, ...receipt })
    } finally { ui.experimentRun = undefined }
  }
  const noCredentials = value => {
    if (typeof value === 'string') return ![...secrets].some(secret => [secret, encodeURIComponent(secret)].some(form => value.includes(form)))
      && !/(?:^|\s)Bearer\s+\S|:\/\/[^/\s]*@|[?&#](?:password|token|api[_-]?key|secret|code)=/i.test(value)
    return !value || typeof value !== 'object' || Object.entries(value).every(([key, child]) => !/^(?:password|cookies?|authorization|secret|permit|(?:api|access|refresh|session)[_-]?(?:key|token)|token)$/i.test(key) && noCredentials(child))
  }
  const followWorkspace = async (ui, fixture) => {
    // An inert page in the verified teacher's guarded context: normal browser cookies, no app cache or SDK state.
    const page = await ui.context.newPage()
    let record
    try {
      const health = await page.goto(`${config.origin}/healthz`, { waitUntil: 'domcontentloaded', timeout: 10000 })
      check('Native probe starts from the exact candidate inert page', health?.ok() && page.url() === `${config.origin}/healthz`)
      record = await page.evaluate(({ origin, streamId, workspaceId }) => new Promise((resolve, reject) => {
        if (location.origin !== origin) { reject(new Error('Native probe candidate origin mismatch')); return }
        const url = new URL('/api/remote.mux', origin)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        const socket = new WebSocket(url)
        let opened = false, settled = false
        const finish = (error, row) => {
          if (settled) return
          settled = true
          clearTimeout(deadline)
          try { if (opened && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel', streamId })) } catch { error ??= 'Native workspace stream cancellation failed' }
          socket.close()
          if (error) reject(new Error(error))
          else resolve(row)
        }
        const deadline = setTimeout(() => finish('Native workspace baseline timed out'), 10000)
        socket.onopen = () => {
          opened = true
          socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'workspace/follow', payload: { args: {} } }))
        }
        socket.onerror = socket.onclose = () => finish('Native workspace stream closed before its baseline')
        const closed = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
        socket.onmessage = event => {
          if (settled) return
          if (typeof event.data !== 'string' || event.data.length > 1024 * 1024) { finish('Native workspace baseline exceeded its text/size budget'); return }
          let frame
          try { frame = JSON.parse(event.data) } catch { finish('Native workspace baseline is not JSON'); return }
          if (!closed(frame, ['type', 'streamId', 'value']) || frame.type !== 'item' || frame.streamId !== streamId || !closed(frame.value, ['type', 'value']) || frame.value.type !== 'baseline') {
            finish('Native workspace stream did not return its correlated opening baseline'); return
          }
          const baseline = frame.value.value
          if (!closed(baseline, ['items', 'archivedSessionIds', 'pinnedSessionIds']) || ![baseline.items, baseline.archivedSessionIds, baseline.pinnedSessionIds].every(value => Array.isArray(value) && value.length <= 1024)) {
            finish('Native workspace baseline has an invalid or unbounded shape'); return
          }
          const rows = baseline.items.filter(item => item?.workspaceId === workspaceId)
          if (rows.length !== 1) { finish('Native workspace baseline must contain the exact owned workspace once'); return }
          finish(undefined, rows[0]) // Do not export the rest of the teacher's roster or frames.
        }
      }), { origin: config.origin, streamId: randomUUID(), workspaceId: fixture.workspaceId })
    } finally { await page.close() }
    const expectedSessions = fixture.materials.filter(material => material.kind === 'session').map(material => material.id).sort()
    check('Native workspace/follow returns the complete exact declared WorkspaceView', closedKeys(record, WORKSPACE_VIEW_KEYS) && record.workspaceId === fixture.workspaceId && record.title === fixture.title
      && typeof record.path === 'string' && (isAbsolute(record.path) || /^[A-Za-z]:[\\/]/.test(record.path)) && record.path.length <= 4096 && !/[\x00-\x1f\x7f]/.test(record.path)
      && Array.isArray(record.sessionIds) && record.sessionIds.every(opaqueCorrelation) && canonical([...record.sessionIds].sort()) === canonical(expectedSessions)
      && isIsoInstant(record.createdAt) && isIsoInstant(record.updatedAt) && Date.parse(record.updatedAt) >= Date.parse(record.createdAt))
    check('Native fixture snapshots contain no credential material', noCredentials(record))
    return record
  }
  const nativeProbe = async (ui, probe, expectedId) => {
    assert.ok(ui.role === 'teacher' && fixtureVerified(ui), 'Native reads require the exact authenticated teacher fixture')
    if (probe?.stream === WORKSPACE_FOLLOW) {
      const fixture = config.footprint.workspaces?.find(value => value.workspaceId === expectedId)
      assert.ok(closedKeys(probe, ['stream']) && fixture?.nativeProbe?.stream === WORKSPACE_FOLLOW, 'No undeclared workspace stream probe can be used')
      return followWorkspace(ui, fixture)
    }
    assert.ok(probe && nativeProbePaths.has(probe.path), 'No undeclared native read probe can be used')
    const record = jsonPointer(await read(ui, probe.path), probe.recordPointer)
    check('Real native API returns the exact complete declared workspace/material record', !!record && typeof record === 'object' && jsonPointer(record, probe.idPointer) === expectedId)
    check('Native fixture snapshots contain no credential material', noCredentials(record))
    return record
  }
  const assertActor = async ui => { const result = await api(ui, '/physicsos/auth/me'); check(`${ui.role} real me HTTP 200`, result.status === 200); sameIdentity(result.body?.user, config.expected[ui.role], ui.role); ui.actor = result.body.user; ui.verified = true; return ui.actor }
  const createUi = async (role = 'teacher', options = {}) => {
    assert.ok(config.states[role] && config.expected[role], 'Only an explicitly expected fixture can create a context')
    const original = config.states[role]
    const state = options.transportOnly ? { cookies: original.cookies.filter(cookie => cookie.name.startsWith('dsh-auth-')), origins: [] } : original
    if (options.transportOnly) assert.ok(state.cookies.length, 'Relogin requires an existing candidate transport cookie, not a copied product session')
    const context = await browser.newContext({ storageState: state, viewport: options.viewport ?? { width: 1400, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true, reducedMotion: 'reduce', colorScheme: options.theme ?? 'light', locale: 'zh-CN' })
    const ui = { context, role, transportOnly: options.transportOnly === true, verified: false, contextId: randomUUID(), expectedDenials: new Set(), pendingWrites: new Set() }
    contexts.set(context, ui)
    report.cleanup.ownedContexts.push({ role, id: ui.contextId, state: 'open' })
    await installGuards(ui)
    ui.page = await context.newPage()
    try {
      // Authenticate the real cookie on an inert same-origin page before loading any Harness RPC/UI code.
      await ui.page.goto(`${config.origin}/healthz`, { waitUntil: 'domcontentloaded' })
      if (ui.transportOnly) {
        const guest = await api(ui, '/physicsos/auth/me', { expectDenied: true })
        check('Transport-only context has no copied product identity', guest.status === 401 && !guest.body?.user)
        ui.guestVerified = true
        return ui
      }
      await assertActor(ui)
      await ui.page.goto(config.origin, { waitUntil: 'domcontentloaded' })
      await ui.page.locator('[data-physicsos-auth-gate]').waitFor({ state: 'hidden' })
      await ui.page.locator('[data-physicsos-navigation]').waitFor({ state: 'visible' })
      const notice = ui.page.locator('[data-physicsos-platform-notice]')
      if (await notice.isVisible().catch(() => false)) {
        await click(notice.getByRole('button', { name: /^(继续|Continue)$/ }))
        await notice.waitFor({ state: 'hidden' })
      }
      return ui
    } catch (error) { await closeUi(ui); throw error }
  }
  const closeUi = async ui => {
    if (!contexts.has(ui.context)) return
    const tracked = contexts.get(ui.context), deadline = Date.now() + 15000
    while (tracked.pendingWrites.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    const pendingWrites = [...tracked.pendingWrites].map(request => ({ method: request.method(), url: publicUrl(request.url()) }))
    if (pendingWrites.length) { report.cleanup.unconfirmedWrites ??= []; report.cleanup.unconfirmedWrites.push({ role: tracked.role, id: tracked.contextId, requests: pendingWrites }) }
    try { await ui.context.close(); contexts.delete(ui.context); const record = report.cleanup.ownedContexts.find(value => value.id === tracked.contextId); if (record) { record.state = 'closed'; record.pendingWriteCount = pendingWrites.length } }
    catch (error) { report.cleanup.ownedContexts.push({ role: tracked.role, id: tracked.contextId, state: 'close-failed', message: safeError(error) }) }
  }
  const closeOwned = async () => { for (const ui of [...contexts.values()]) await closeUi(ui); report.cleanup.openContextCount = contexts.size }
  const poll = async (label, fetchValue, valid, timeout = 30000) => {
    const deadline = Date.now() + timeout
    let value
    do {
      value = await fetchValue()
      if (valid(value)) return value
      // Bounded polling of actual authority, never a delay used as proof of a save.
      await new Promise(resolve => setTimeout(resolve, 150))
    } while (Date.now() < deadline)
    check(label, false)
  }
  const hit = async locator => {
    await locator.waitFor({ state: 'visible' }); await locator.scrollIntoViewIfNeeded()
    const box = await locator.evaluate(element => {
      const r = element.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, target = document.elementFromPoint(x, y)
      return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight, hit: !!target && (target === element || element.contains(target)), disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true' }
    })
    check('actual scroll-adjusted pointer hit target', box.hit && box.width > 0 && box.height > 0 && !box.disabled, { box })
    return box
  }
  const click = async locator => { await hit(locator); await locator.click() }
  const ack = async (ui, path, method, action) => {
    const pending = ui.page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method)
    const actionPromise = Promise.resolve().then(action)
    // Attach rejection observers to both sides before the action can fail or the waiter can time out.
    const [waiterResult, actionResult] = await Promise.allSettled([pending, actionPromise])
    if (actionResult.status === 'rejected' || waiterResult.status === 'rejected') {
      report.waiterFailures ??= []
      report.waiterFailures.push({ stage: currentStage, path, method, action: actionResult.status, response: waiterResult.status })
      throw actionResult.status === 'rejected' ? actionResult.reason : waiterResult.reason
    }
    const response = waiterResult.value
    let body, requestData
    try { body = await response.json() } catch { throw new Error('Candidate mutation ACK must be real JSON') }
    try { requestData = response.request().postDataJSON() } catch {}
    check(`real ${method} ${path} ACK`, response.ok(), { status: response.status() })
    await flush()
    return { body, requestData, status: response.status() }
  }
  const capture = async (ui, name) => {
    await assertActor(ui) // No screenshots of expired/mismatched principals or credential forms.
    await mkdir(config.output, { recursive: true, mode: 0o700 })
    const path = join(config.output, `${name.replace(/[^a-z0-9_.-]/gi, '_')}.png`)
    await ui.page.screenshot({ path, mask: [ui.page.locator('input[type="password"]'), ui.page.locator('[data-physicsos-auth-gate]'), ui.page.locator('[data-secret], [data-api-key]')] })
    return path
  }
  const stage = async (id, job) => {
    currentStage = id
    const initial = report.unverified.length, checkStart = report.checks.length, before = report.modelRequests.length + report.externalRequests.length + report.forbiddenMutations.length
    const entry = { id, status: 'running', startedAt: new Date().toISOString() }; report.stages.push(entry); await flush()
    try {
      await job()
      check(`${id}: no model/external/unauthorized mutation attempt`, report.modelRequests.length + report.externalRequests.length + report.forbiddenMutations.length === before)
      entry.status = report.unverified.length > initial ? 'unverified' : 'passed'
    } catch (error) { entry.status = 'failed'; entry.message = safeError(error); report.errors.push({ stage: id, message: entry.message }) }
    entry.finishedAt = new Date().toISOString(); entry.checkCount = report.checks.length - checkStart; await flush()
    return entry.status
  }
  return { config, report, reportFile, safeError, check, unverified, resources, api, read, nativeProbe, recordPendulumRun, assertActor, createUi, closeUi, closeOwned, poll, hit, click, ack, capture, stage, flush,
    finish: async () => { report.finishedAt = new Date().toISOString(); report.coreAcceptance = report.stages.length > 0 && report.stages.every(value => value.status === 'passed') && !report.errors.length && !report.modelRequests.length && !report.externalRequests.length && !report.forbiddenMutations.length && !report.networkFailures.length && !report.httpErrors.length && !report.cleanup.unconfirmedWrites?.length && contexts.size === 0; await flush(); return report.coreAcceptance ? 0 : report.stages.some(value => value.status === 'failed') || report.errors.length || report.networkFailures.length || report.httpErrors.length ? 1 : 2 } }
}

export async function listPages(h, ui, path) {
  const items = [], seen = new Set()
  let cursor
  for (let index = 0; index < 1000; index++) {
    const query = new URL(path, h.config.origin)
    query.searchParams.set('limit', '100')
    if (cursor) query.searchParams.set('cursor', cursor)
    const page = await h.read(ui, query.pathname + query.search)
    h.check('Authority list is explicitly paginated', Array.isArray(page.items))
    items.push(...page.items)
    if (!page.nextCursor) return items
    h.check('Authority cursor does not repeat', !seen.has(page.nextCursor)); seen.add(page.nextCursor); cursor = page.nextCursor
  }
  h.check('Authority pagination stays within its safety budget', false)
}
export async function home(h, ui) {
  await h.click(ui.page.locator('[data-physicsos-navigation]').getByRole('button', { name: /^(首页|Home)$/ }))
  await ui.page.locator('[data-physicsos-surface="home"], [data-recent-scene], [aria-label="最近记录状态"]').first().waitFor({ state: 'visible' })
}
export async function catalog(h, ui, kind) {
  const nav = ui.page.locator('[data-physicsos-navigation]')
  if (kind === 'whiteboard') { await h.click(nav.getByRole('button', { name: /更多|More/ })); await h.click(ui.page.getByRole('menuitem', { name: /^(教学画板|Classroom whiteboard)$/ })) }
  else await h.click(nav.getByRole('button', { name: /^(实验自由画布|Experiment Canvas)$/ }))
  await ui.page.locator(`[data-physicsos-${kind}-catalog]`).waitFor({ state: 'visible' })
}
export async function lifecycleUi(h, ui, kind, id, action) {
  await catalog(h, ui, kind)
  const root = ui.page.locator(`[data-physicsos-${kind}-catalog]`)
  const state = action === 'restore' ? 'deleted' : action === 'unarchive' ? 'archived' : 'active'
  await root.getByRole('combobox', { name: kind === 'canvas' ? '工作台状态' : '画板状态' }).selectOption(state)
  // IDs are data, not CSS fragments; quote them explicitly in the scoped XPath.
  const card = root.locator(`xpath=.//*[@data-${kind}-id=${xpathLiteral(id)}]`)
  await card.waitFor({ state: 'visible' })
  await h.click(card.getByRole('button', { name: '更多操作', exact: true }))
  const labels = kind === 'canvas' ? { archive: /^(归档工作台|Archive workbench)$/, unarchive: /^(取消归档|Unarchive)$/, delete: /^(删除工作台|Delete workbench)$/, restore: /^(恢复工作台|Restore workbench)$/ }
    : { archive: /^(归档画板|Archive whiteboard)$/, unarchive: /^(取消归档|Unarchive)$/, delete: /^(删除整个画板|Delete entire whiteboard)$/, restore: /^(恢复画板|Restore whiteboard)$/ }
  await h.click(ui.page.getByRole('menuitem', { name: labels[action] }))
  const path = kind === 'canvas' ? `/physicsos/learning/canvases/${idPath(id)}${action === 'delete' ? '' : `/${action}`}` : `/physicsos/whiteboards/${idPath(id)}${action === 'delete' ? '' : `/${action}`}`
  return h.ack(ui, path, action === 'delete' ? 'DELETE' : 'POST', () => h.click(ui.page.getByRole('dialog').getByRole('button', { name: /^(确认|Confirm)$/ })))
}
export function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  return `concat(${value.split("'").map(part => `'${part}'`).join(',"\'",')})`
}
