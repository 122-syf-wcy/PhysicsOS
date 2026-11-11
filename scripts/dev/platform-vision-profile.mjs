import { readFile, writeFile, open, rename, unlink, lstat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

/** Prepare only public modality edits, preserving every model's existing configuration. */
export function planPlatformVisionProfile(describe) {
  const candidates = describe?.namespaces?.filter(row => row.value?.providers?.['physicsos-pool']) ?? []
  if (describe?.writable !== true || candidates.length !== 1) throw new Error('A unique writable platform model namespace is required')
  const namespace = candidates[0], route = namespace.value.providers['physicsos-pool']
  if (namespace.writable === false || !Number.isSafeInteger(namespace.revision) || namespace.revision < 0
    || !Array.isArray(route.models) || route.models.length === 0) throw new Error('Complete versioned platform model settings are required')
  const modelIds = route.models.map(model => model?.id)
  if (modelIds.some(id => typeof id !== 'string' || id.length === 0) || new Set(modelIds).size !== modelIds.length) throw new Error('Model declarations must have unique IDs')
  const modalities = value => {
    if (value === undefined || value === null) return ['text', 'image']
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid model modality declaration')
    return [...new Set(['text', ...value, 'image'])]
  }
  const ops = []
  if (!Array.isArray(route.defaultInput) || !route.defaultInput.includes('image')) ops.push({
    op: 'set', path: ['providers', 'physicsos-pool', 'defaultInput'], value: modalities(route.defaultInput),
  })
  if (route.models.some(model => !Array.isArray(model.input) || !model.input.includes('image'))) ops.push({
    op: 'set', path: ['providers', 'physicsos-pool', 'models'],
    value: route.models.map(model => ({ ...structuredClone(model), input: modalities(model.input) })),
  })
  return { ns: namespace.ns, expectedRevision: namespace.revision, modelIds, ops }
}

const sha256 = source => createHash('sha256').update(source).digest('hex')
class InertJsExpression { constructor(source) { this.source = source } }
function cloneYaml(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof InertJsExpression) return new InertJsExpression(value.source)
  if (value instanceof Date) return new Date(value.getTime())
  if (seen.has(value)) return seen.get(value)
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
  seen.set(value, copy)
  for (const [key, child] of Object.entries(value)) copy[key] = cloneYaml(child, seen)
  return copy
}
function profileYaml() {
  // The cutover runs in the existing PhysicsOS image; no new YAML dependency is installed.
  const yaml = createRequire('/app/vendor/deepseek-harness/vendor/cordis/package.json')('js-yaml')
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar', construct: source => new InertJsExpression(source), instanceOf: InertJsExpression,
    represent: value => value.source,
  })])
  return { yaml, schema }
}

/** Merge only the exact platform entry. JS expressions remain inert tagged scalar values. */
export function planPlatformVisionDocument(source) {
  const { yaml, schema } = profileYaml(), document = yaml.load(source, { schema })
  const targets = [], seen = new Set()
  const visit = node => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (node.id === 'llm-pi-ai' && node.config?.providers?.['physicsos-pool']) {
      if (node.name !== undefined && node.name !== '@deepseek-ai/dsh-llm-pi-ai') throw new Error('Unexpected platform entry owner')
      targets.push(node)
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(document)
  if (targets.length !== 1) throw new Error('A unique exact platform model entry is required')
  const target = targets[0]
  const plan = planPlatformVisionProfile({ writable: true, namespaces: [{ ns: target.id, revision: 0, value: target.config }] })
  if (plan.ops.length) {
    const route = cloneYaml(target.config.providers['physicsos-pool'])
    target.config = { ...target.config, providers: { ...target.config.providers, 'physicsos-pool': route } }
    const modalities = value => [...new Set(['text', ...(value ?? []), 'image'])]
    route.defaultInput = modalities(route.defaultInput)
    // Retain JS tags while breaking aliases shared with unrelated providers.
    for (const model of route.models) model.input = modalities(model.input)
  }
  const text = plan.ops.length ? yaml.dump(document, { schema, lineWidth: -1, noCompatMode: true }) : source
  return { text, changed: text !== source, modelIds: plan.modelIds, beforeSha256: sha256(source), afterSha256: sha256(text) }
}

const profileChanged = () => Object.assign(new Error('Profile changed; audit again'), { code: 'PROFILE_CHANGED' })
async function guardedReplace(profile, text, expectedSha256, facts) {
  const temporary = profile + '.vision-' + randomUUID() + '.tmp'
  try {
    const handle = await open(temporary, 'wx', facts.mode & 0o777)
    try {
      await handle.writeFile(text)
      await handle.chmod(facts.mode & 0o777)
      if (process.getuid?.() !== facts.uid || process.getgid?.() !== facts.gid) await handle.chown(facts.uid, facts.gid)
      await handle.sync()
    } finally { await handle.close() }
    if (sha256(await readFile(profile)) !== expectedSha256) throw profileChanged()
    await rename(temporary, profile)
    const directory = await open(dirname(profile), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

/** Apply or roll back once with paired private originals and a content guard. */
export async function applyOfflinePlatformVision({ profile, backup, expectedSha256, rollback = false }) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !backup) throw new Error('Expected profile hash and private backup path are required')
  const facts = await lstat(profile)
  if (!facts.isFile() || facts.isSymbolicLink()) throw new Error('Profile must be a regular file')
  const lock = await open(profile + '.vision.lock', 'wx', 0o600)
  try {
    const original = await readFile(profile, 'utf8')
    if (sha256(original) !== expectedSha256) throw profileChanged()
    if (rollback) {
      const metadata = JSON.parse(await readFile(backup + '.metadata.json', 'utf8'))
      const restored = await readFile(backup, 'utf8')
      if (metadata.afterSha256 !== expectedSha256 || metadata.beforeSha256 !== sha256(restored)) throw profileChanged()
      await guardedReplace(profile, restored, expectedSha256, facts)
      return { rolledBack: true, beforeSha256: expectedSha256, afterSha256: metadata.beforeSha256 }
    }
    const plan = planPlatformVisionDocument(original)
    if (!plan.changed) return { changed: false, beforeSha256: plan.beforeSha256, afterSha256: plan.afterSha256, modelIds: plan.modelIds }
    const saved = await open(backup, 'wx', 0o600)
    try { await saved.writeFile(original); await saved.sync() } finally { await saved.close() }
    const metadata = await open(backup + '.metadata.json', 'wx', 0o600)
    try {
      await metadata.writeFile(JSON.stringify({ beforeSha256: plan.beforeSha256, afterSha256: plan.afterSha256,
        uid: facts.uid, gid: facts.gid, mode: facts.mode & 0o777 }))
      await metadata.sync()
    } finally { await metadata.close() }
    const backupDirectory = await open(dirname(backup), 'r')
    try { await backupDirectory.sync() } finally { await backupDirectory.close() }
    await guardedReplace(profile, plan.text, expectedSha256, facts)
    return { changed: true, beforeSha256: plan.beforeSha256, afterSha256: plan.afterSha256, modelIds: plan.modelIds }
  } finally { await lock.close(); await unlink(profile + '.vision.lock') }
}

/** Use the existing scoped settings API; audit by default and require the observed revision to apply. */
async function main(argv) {
  const option = name => argv[argv.indexOf(name) + 1]
  if (argv.includes('--profile-file')) {
    const profile = option('--profile-file')
    const plan = planPlatformVisionDocument(await readFile(profile, 'utf8'))
    const summary = { changed: plan.changed, modelIds: plan.modelIds, beforeSha256: plan.beforeSha256, afterSha256: plan.afterSha256 }
    if (argv.includes('--apply') || argv.includes('--rollback')) {
      if (!argv.includes('--expected-sha256') || !argv.includes('--backup-file')) throw new Error('Apply requires expected hash and private backup')
      Object.assign(summary, await applyOfflinePlatformVision({ profile, backup: option('--backup-file'),
        expectedSha256: option('--expected-sha256'), rollback: argv.includes('--rollback') }))
    }
    console.log(JSON.stringify(summary))
    return
  }
  if (!argv.includes('--base-url') || !argv.includes('--cookie-file')) throw new Error('Use --base-url and --cookie-file')
  const base = new URL(option('--base-url'))
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid origin')
  const cookie = (await readFile(option('--cookie-file'), 'utf8')).trim()
  const rpc = async (method, args) => {
    const response = await fetch(new URL('/api/' + method, base), { method: 'POST',
      headers: { 'content-type': 'application/json', origin: base.origin, cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }),
    })
    const envelope = await response.json()
    if (!response.ok || envelope.result?.ok !== true) throw Object.assign(new Error('Settings request failed'), { code: envelope.result?.error?.code ?? 'HTTP_' + response.status })
    return envelope.result.value
  }
  const plan = planPlatformVisionProfile(await rpc('settings/describe', {}))
  const summary = { namespace: plan.ns, revision: plan.expectedRevision, modelIds: plan.modelIds, changes: plan.ops.map(op => op.path) }
  if (argv.includes('--plan-file')) await writeFile(option('--plan-file'), JSON.stringify(plan), { mode: 0o600 })
  if (argv.includes('--apply')) {
    if (!argv.includes('--expected-revision') || Number(option('--expected-revision')) !== plan.expectedRevision) throw new Error('The settings revision changed; audit again')
    if (plan.ops.length) await rpc('settings/mutate', { ns: plan.ns, ops: plan.ops, expectedRevision: plan.expectedRevision })
    summary.applied = true
  }
  console.log(JSON.stringify(summary))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({ error: typeof error.code === 'string' ? error.code : 'VISION_CONFIGURATION_REFUSED' }))
    process.exitCode = 1
  })
}
