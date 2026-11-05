/** Publish reviewed independent archives through the same authenticated intake/review APIs. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const args = process.argv.slice(2)
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1] }
const base = option('--base', 'https://physics.dongsiwei.com')
const directory = option('--directory', '/tmp/physicsos-lab-collection-20261105')
const passwordFile = option('--password-file', process.env.PHYSICSOS_ADMIN_PASSWORD_FILE)
const username = option('--username', process.env.PHYSICSOS_ADMIN_USERNAME ?? 'admin')
const publish = args.includes('--publish')
const evidenceFile = option('--evidence')
const output = option('--output', join(directory, new URL(base).hostname === 'physics.dongsiwei.com' ? 'production-publication.json' : 'candidate-publication.json'))
const index = JSON.parse(await readFile(join(directory, 'index.json')))
assert.equal(index.count, 76)
let evidence
if (publish) {
  assert.ok(evidenceFile, 'Publication requires exact-archive acceptance evidence')
  evidence = JSON.parse(await readFile(evidenceFile))
  const registry = JSON.parse(await readFile(new URL('../../overlays/harness/files/packages/physicsos/experiment-host/src/experiment-registry.json', import.meta.url)))
  assert.equal(evidence.count, 76); assert.equal(evidence.errors.length, 0); assert.equal(evidence.external.length, 0); assert.equal(evidence.failures.length, 0)
  for (const item of index.packages) {
    const row = evidence.results.find(row => row.id === item.experimentId && row.sha256 === item.sha256)
    assert.ok(row, `No accepted archive for ${item.experimentId}`)
    const noDrawableLayer = row.visibilityAssessmentVersion === 1 && row.visibilityApplicable === false
      && Array.isArray(row.visibilityDrawableLayers) && row.visibilityDrawableLayers.length === 0
      && row.visibilityNotApplicableReason === 'No enabled nonempty drawable layer in the tested runtime snapshot'
    assert.ok(row.visibilityChanged === true || noDrawableLayer, `No verified visibility change for ${item.experimentId}`)
    const profile = registry.find(profile => profile.id === item.experimentId)
    assert.ok(profile, `No registered parameter contract for ${item.experimentId}`)
    // The modern target exposes no editable parameters. Other targets must
    // prove the round-trip even when an edit legitimately leaves geometry unchanged.
    if (profile.parameters.length > 0) assert.equal(row.parameterChecked, true, `No verified parameter round-trip for ${item.experimentId}`)
    else {
      assert.equal(row.parameterApplicable, false, `Missing no-parameter evidence for ${item.experimentId}`)
      assert.equal(row.parameterCount, 0, `Unexpected editable parameters for ${item.experimentId}`)
    }
    if (item.experimentId === 'buoyancy') assert.equal(row.buoyancyDisplacementChecked, true, 'No independent buoyancy displacement-label check')
  }
}
// Reject incomplete evidence before reading credentials or opening a session.
assert.ok(passwordFile, 'Use an existing private credential file')
const info = await stat(passwordFile); assert.ok(info.isFile() && (info.mode & 0o077) === 0, 'Credential file must be private')
const password = (await readFile(passwordFile, 'utf8')).trim()
const login = await fetch(base + '/physicsos/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(base).origin }, body: JSON.stringify({ username, password, schoolId: 'PHYSICSOS-OPEN' }) })
assert.equal(login.status, 200, 'Authenticated login failed')
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
assert.ok(cookie, 'No authenticated session')
const api = async (path, body) => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json', origin: new URL(base).origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json()
  if (!response.ok) throw new Error(`API ${response.status} ${path}: ${data.error?.code ?? 'failed'}`)
  return data
}
const before = [], results = []
for (const item of index.packages) {
  const catalog = await api(`/physicsos/experiments/${item.experimentId}`)
  assert.equal(catalog.canReview, true, 'Platform administrator permission required')
  before.push({ id: item.experimentId, active: catalog.active ? { id: catalog.active.id, sha256: catalog.active.sha256, version: catalog.active.version } : null })
}
await mkdir(join(output, '..'), { recursive: true })
const restorePath = output + '.before.json'
try { await writeFile(restorePath, JSON.stringify({ base, targets: before }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) }
catch (error) { if (error.code !== 'EEXIST') throw error }
if (!publish) {
  console.log(JSON.stringify({ base, targets: before.length, published: before.filter(item => item.active).length, versions: [...new Set(before.map(item => item.active?.version).filter(Boolean))] }))
} else {
  for (const item of index.packages) {
    const id = item.experimentId, path = `/physicsos/experiments/${id}`
    const bytes = await readFile(join(directory, item.filename))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
    const catalog = await api(path)
    let uploaded = catalog.items.find(row => row.sha256 === item.sha256 && row.status !== 'rejected')
    if (!uploaded) uploaded = (await api(path + '/packages', { zipBase64: bytes.toString('base64'), author: { name: 'PhysicsOS', bio: '物理实验三维可视化 · 平台物理引擎驱动' }, note: '全新三维装置、清爽界面与移动端布局；按独立模板发布，已完成物理与交互验收。' })).item
    assert.equal(uploaded.sha256, item.sha256)
    if (uploaded.status === 'pending') await api(`/physicsos/experiments/packages/${uploaded.id}/review`, { action: 'approve', expectedSha256: item.sha256 })
    else if (catalog.active?.id !== uploaded.id) await api(path + '/rollback', { packageId: uploaded.id, expectedActiveId: catalog.active?.id ?? null })
    const verified = await api(path)
    assert.equal(verified.active?.id, uploaded.id); assert.equal(verified.active?.sha256, item.sha256)
    results.push({ experimentId: id, packageId: uploaded.id, version: item.version, sha256: item.sha256, status: 'approved' })
    await writeFile(output, JSON.stringify({ base, expected: 76, completed: results.length, packages: results }, null, 2) + '\n', { mode: 0o600 })
    console.log(`Published ${results.length}/76 ${id} ${uploaded.id} ${item.sha256.slice(0, 12)}`)
  }
  console.log('Verified all 76 active release pointers and exact archive hashes')
}
