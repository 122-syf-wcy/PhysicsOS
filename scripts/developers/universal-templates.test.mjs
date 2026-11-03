import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const host = new URL('../../vendor/deepseek-harness/packages/physicsos/experiment-host/src/', import.meta.url)

test('every selectable experiment has an uploadable deterministic V3 developer package', async () => {
  const registry = JSON.parse(await readFile(new URL('experiment-registry.json', host)))
  assert.equal(registry.length, 76)
  assert.equal(new Set(registry.map(profile => profile.id)).size, 76)
  const { buildExperimentTemplate, experimentDeveloperPrompt } = await import(new URL('template-download.ts', host))
  for (const profile of registry) {
    const archive = buildExperimentTemplate(profile.id)
    assert.deepEqual(buildExperimentTemplate(profile.id).bytes, archive.bytes)
    assert.equal(archive.sha256, createHash('sha256').update(archive.bytes).digest('hex'))
    assert.equal(archive.filename, `physicsos-${profile.id}-template-v3.zip`)
    assert.ok(experimentDeveloperPrompt(profile.id).includes(archive.sha256))
  }
  assert.throws(() => buildExperimentTemplate('../convex-lens'))
  assert.throws(() => experimentDeveloperPrompt('missing'))
  // Host archive errors use TS constructor properties. Use Node's transform mode
  // in this child so the tooling test command also works without a prior host build.
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    import {buildExperimentTemplate} from ${JSON.stringify(new URL('template-download.ts', host).href)};
    import {validateArchive} from ${JSON.stringify(new URL('archive.ts', host).href)};
    const registry=JSON.parse(await readFile(new URL(${JSON.stringify(new URL('experiment-registry.json', host).href)})));
    for(const profile of registry){const {manifest}=await validateArchive(buildExperimentTemplate(profile.id).bytes);assert.equal(manifest.experimentId,profile.id);assert.equal(manifest.protocolVersion,3);assert.equal(manifest.engine.id,profile.domain);}
  `], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('all generated snapshots remain JSON-only and use every registered renderer domain', async () => {
  const data = JSON.parse(await readFile(new URL('universal-template-data.json', host)))
  assert.equal(Object.keys(data.targets).length, 76)
  const domains = new Set()
  for (const [id, target] of Object.entries(data.targets)) {
    const snapshot = JSON.parse(Buffer.from(target['public/fixture.json'], 'base64'))
    assert.equal(snapshot.experimentId, id)
    assert.equal(snapshot.source, 'platform-engine')
    assert.equal(snapshot.revision, 0)
    assert.ok(snapshot.view.extent.width > 0)
    assert.ok(Array.isArray(snapshot.inspector))
    domains.add(snapshot.domain)
  }
  assert.equal(domains.size, 12)
  const runtime = Buffer.from(data.base['public/vendor/platform-renderer.js'], 'base64').toString()
  assert.ok(runtime.includes('mountPhysicsOSChrome') || runtime.includes('data-physicsos-chrome'))
  assert.ok(!runtime.includes('/physicsos/parts3d'))
})

test('generated resources remain confined to dist and the package identity', async () => {
  const { validateReferences } = await import(new URL('package-resources.ts', host))
  const data = JSON.parse(await readFile(new URL('universal-template-data.json', host)))
  const assets = new Map(Object.entries({...data.base,...data.targets.pinhole}).filter(([name])=>name.startsWith('public/')).map(([name,body])=>['dist/'+name.slice(7),Buffer.from(body,'base64')]))
  for(const [name,body] of Object.entries({...data.base,...data.targets.pinhole})) if(name.startsWith('src/')) assets.set('dist/runtime/'+name.slice(4),Buffer.from(body,'base64'))
  assets.set('dist/runtime/renderer.js', Buffer.from("import 'https://cdn.example/engine.js'"))
  await assert.rejects(validateReferences(assets), /Invalid package resources/)
  assets.set('dist/runtime/renderer.js', Buffer.from("import '../../../private.js'"))
  await assert.rejects(validateReferences(assets), /Invalid package resources/)
})

test('native CRC ZIP encoder preserves the reviewed deterministic archive bytes', async () => {
  const { buildExperimentTemplate } = await import(new URL('template-download.ts', host))
  const { zipBytes } = await import('../../developer-kit/experiment-template/tools/archive.mjs')
  const data = JSON.parse(await readFile(new URL('universal-template-data.json', host)))
  const files = new Map(Object.entries({...data.base,...data.targets.pinhole}).map(([name,body])=>[name,Buffer.from(body,'base64')]))
  for(const [name,body] of [...files]) {
    if(name.startsWith('public/')) files.set('dist/'+name.slice(7),body)
    if(name.startsWith('src/')) files.set('dist/runtime/'+name.slice(4),body)
  }
  assert.deepEqual(buildExperimentTemplate('pinhole').bytes, zipBytes(new Map([...files].sort(([a],[b])=>a<b?-1:a>b?1:0))))
})

test('downloaded SDK validation rejects canonical defaults outside declared bounds', async () => {
  const data = JSON.parse(await readFile(new URL('universal-template-data.json', host)))
  const sdk = new URL('../../developer-kit/universal-experiment-template/tools/', import.meta.url)
  const { experimentCatalog, manifestV3Schema, validatePackageMetadataV3 } = await import(new URL('contract-v3.ts', sdk))
  const files = new Map(Object.entries({...data.base,...data.targets['wave-doppler']}).map(([name,body])=>[name,Buffer.from(body,'base64')]))
  for(const [name,body] of [...files]) {
    if(name.startsWith('public/')) files.set('dist/'+name.slice(7),body)
    if(name.startsWith('src/')) files.set('dist/runtime/'+name.slice(4),body)
  }
  const manifest = manifestV3Schema.parse(JSON.parse(files.get('experiment.json')))
  assert.deepEqual(validatePackageMetadataV3(files, manifest), [])
  const profile = experimentCatalog.find(item=>item.id==='wave-doppler')
  const frequency = profile.parameters.find(item=>item.id==='frequency')
  const original = frequency.value
  try {
    // Even malformed trusted metadata must never turn a range violation into an exception.
    frequency.value = frequency.min / 2
    const parameters = JSON.parse(files.get('parameters.json'))
    parameters.parameters.find(item=>item.id==='frequency').value = frequency.value
    files.set('parameters.json', Buffer.from(JSON.stringify(parameters)))
    const cases = JSON.parse(files.get('cases.json'))
    cases.cases[0].input.parameters.frequency = frequency.value
    files.set('cases.json', Buffer.from(JSON.stringify(cases)))
    assert.ok(validatePackageMetadataV3(files, manifest).length > 0)
  } finally { frequency.value = original }
  for(const name of ['contract-v3.ts','contract-v2.ts','contract-wire.ts','package-resources.ts','package-limits.ts','html.ts']) {
    const canonical = await readFile(new URL(name, host))
    assert.deepEqual(await readFile(new URL(name, sdk)), canonical)
    assert.deepEqual(Buffer.from(data.base['tools/'+name],'base64'), canonical)
  }
})
