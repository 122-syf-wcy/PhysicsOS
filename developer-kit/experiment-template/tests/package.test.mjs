import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePackage } from '../tools/validate.mjs'
import { zipBytes } from '../tools/archive.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-package-'))
  try {
    await mkdir(join(root, 'dist/assets'), { recursive: true })
    for (const path of ['src', 'public', 'tools', 'tests']) await mkdir(join(root, path))
    const manifest = { schemaVersion: 1, protocolVersion: 1, packageType: 'browser-static', experimentId: 'convex-lens', version: '1.0.0', entry: 'dist/index.html', renderer: 'three', theme: 'physicsos-warm-lab-v1', parameters: 'parameters.json', teaching: 'teaching.json', referenceCases: 'cases.json', assetLicenses: 'ASSET-LICENSES.json', cover: 'dist/assets/cover.webp' }
    for (const path of ['parameters.json', 'teaching.json', 'cases.json', 'ASSET-LICENSES.json', 'package.json', 'tsconfig.json', 'tsconfig.build.json']) await writeFile(join(root, path), '{}')
    for (const path of ['README.md', 'MODEL.md', 'LICENSE', 'src/main.ts', 'dist/assets/cover.webp']) await writeFile(join(root, path), 'fixture')
    await writeFile(join(root, 'dist/index.html'), '<!doctype html>')
    await writeFile(join(root, 'experiment.json'), JSON.stringify(manifest))
    await run(root, manifest)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('packages reviewed browser entry and source, excludes private local development files', async () => {
  await fixture(async root => {
    await writeFile(join(root, '.env'), 'PRIVATE=example')
    const result = await validatePackage(root)
    assert.ok(result.files.has('dist/index.html'))
    assert.ok(result.files.has('src/main.ts'))
    assert.ok(!result.files.has('.env'))
    const zip = zipBytes(result.files)
    assert.equal(zip.readUInt32LE(0), 0x04034b50)
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50)
  })
})
test('rejects cross-directory entries, missing assets and symlink escape', async () => {
  await fixture(async (root, manifest) => {
    await writeFile(join(root, 'experiment.json'), JSON.stringify({ ...manifest, entry: '../index.html' }))
    await assert.rejects(validatePackage(root), /entry/)
    await writeFile(join(root, 'experiment.json'), JSON.stringify(manifest))
    await writeFile(join(root, 'dist/index.html'), '<script src="missing.js"></script>')
    await assert.rejects(validatePackage(root), /missing/)
    await writeFile(join(root, 'dist/index.html'), '<!doctype html>')
    await symlink('/etc/hosts', join(root, 'dist/assets/escape.txt'))
    await assert.rejects(validatePackage(root), /Symlink/)
  })
})
