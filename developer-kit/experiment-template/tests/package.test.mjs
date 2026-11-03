import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePackage } from '../tools/validate.mjs'
import { zipBytes } from '../tools/archive.mjs'
import { manifestV2Example, parametersV2Document, teachingV2Example, casesV2Document, assetLicensesV2Example, validatePackageMetadata, evaluateCaseWithOptics } from '../tools/contract-v2.ts'
import { thinLensOutcome } from '../tools/platform-optics.mjs'

export async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-package-'))
  try {
    await mkdir(join(root, 'dist/assets'), { recursive: true })
    await mkdir(join(root, 'dist/vendor'), { recursive: true })
    for (const path of ['src', 'public', 'tools', 'tests']) await mkdir(join(root, path))
    const docs = { 'experiment.json': manifestV2Example, 'parameters.json': parametersV2Document, 'teaching.json': teachingV2Example, 'cases.json': casesV2Document, 'ASSET-LICENSES.json': assetLicensesV2Example, 'package.json': {}, 'tsconfig.json': {}, 'tsconfig.build.json': {} }
    for (const [path, value] of Object.entries(docs)) await writeFile(join(root, path), JSON.stringify(value))
    for (const path of ['README.md', 'MODEL.md', 'LICENSE', 'dist/vendor/THREE-LICENSE.txt', 'dist/assets/cover.svg']) await writeFile(join(root, path), 'fixture')
    const wire = await readFile(new URL('../tools/contract-wire.ts', import.meta.url))
    await writeFile(join(root, 'src/contract-wire.ts'), wire)
    await writeFile(join(root, 'tools/contract-wire.ts'), wire)
    await writeFile(join(root, 'src/main.ts'), 'export {}')
    await writeFile(join(root, 'dist/index.html'), '<!doctype html>')
    await run(root, docs)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('packages valid V2 browser entry and rebuildable source while excluding local secrets', async () => {
  await fixture(async root => {
    await writeFile(join(root, '.env'), 'PRIVATE=example')
    const result = await validatePackage(root)
    assert.equal(result.manifest.schemaVersion, 2)
    assert.ok(result.files.has('dist/index.html'))
    assert.ok(result.files.has('src/main.ts'))
    assert.ok(!result.files.has('.env'))
    const zip = zipBytes(result.files)
    assert.equal(zip.readUInt32LE(0), 0x04034b50)
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50)
  })
})
test('rejects unsafe paths and symlink escape', async () => {
  await fixture(async (root, docs) => {
    await writeFile(join(root, 'experiment.json'), JSON.stringify({ ...docs['experiment.json'], entry: '../index.html' }))
    await assert.rejects(validatePackage(root))
    await writeFile(join(root, 'experiment.json'), JSON.stringify(docs['experiment.json']))
    await symlink('/etc/hosts', join(root, 'dist/assets/escape.txt'))
    await assert.rejects(validatePackage(root), /resource|Symlink/i)
  })
})
test('CSS and JavaScript missing resources cannot pass standalone validation', async () => {
  await fixture(async root => {
    for (const [path, text] of [['dist/assets/main.css', 'body {background:url(missing.png)}'], ['dist/runtime.mjs', "import './missing.js'"]]) {
      await writeFile(join(root, path), text)
      await assert.rejects(validatePackage(root), /resource/i)
      await rm(join(root, path))
    }
  })
})
test('canonical metadata diagnostics match standalone malformed units, cases, teaching, licenses and JSON', async () => {
  await fixture(async (root, docs) => {
    const mutations = [
      ['parameters.json', value => { value.parameters[0].unit = 'm' }],
      ['cases.json', value => { value.cases[0].expected.imageDistanceCm = 999 }],
      ['teaching.json', value => { value.title = '   ' }],
      ['ASSET-LICENSES.json', value => { value[0].notice = 'missing.txt' }],
    ]
    for (const [path, mutate] of mutations) {
      const value = structuredClone(docs[path])
      mutate(value)
      await writeFile(join(root, path), JSON.stringify(value))
      const files = new Map(Object.entries(docs).map(([name, document]) => [name, Buffer.from(JSON.stringify(document))]))
      files.set(path, Buffer.from(JSON.stringify(value)))
      for (const asset of ['LICENSE', 'dist/assets/cover.svg', 'dist/vendor/THREE-LICENSE.txt']) files.set(asset, Buffer.from('fixture'))
      const issues = validatePackageMetadata(files, input => evaluateCaseWithOptics(input, thinLensOutcome))
      assert.ok(issues.some(issue => issue.file === path))
      await assert.rejects(validatePackage(root), error => { assert.deepEqual(error.issues, issues); return true })
      await writeFile(join(root, path), JSON.stringify(docs[path]))
    }
    await writeFile(join(root, 'teaching.json'), '{')
    await assert.rejects(validatePackage(root), error => { assert.equal(error.issues[0].file, 'teaching.json'); return true })
  })
})
test('generated SDK and tooling wire copies cannot diverge', async () => {
  await fixture(async root => {
    await writeFile(join(root, 'src/contract-wire.ts'), 'export const PROTOCOL_VERSION = 99')
    await assert.rejects(validatePackage(root), /generated|wire/i)
  })
})
