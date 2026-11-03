import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { z } from 'zod'
import { downloadableResources, manifestExample, manifestSchema } from './resources.mjs'
import { agentInstructions } from '../../overlays/harness/files/apps/web/public/physicsos/developers/standards.js'
import {
  manifestV2Example,
  manifestV2Schema,
  parametersV2Schema,
} from '../../overlays/harness/files/packages/physicsos/experiment-host/src/contract-v2.ts'

const root = new URL('../../', import.meta.url)
test('published V2 manifest and schemas are derived from canonical host contract', () => {
  assert.deepEqual(manifestExample, manifestV2Example)
  assert.deepEqual(manifestSchema, z.toJSONSchema(manifestV2Schema, { unrepresentable: 'any' }))
  assert.deepEqual(
    JSON.parse(downloadableResources().get('parameters.schema.json')),
    z.toJSONSchema(parametersV2Schema, { unrepresentable: 'any' }),
  )
})
test('template and public prompt retain identical base instructions with separate archive identity', async () => {
  const internal = await readFile(
    new URL('developer-kit/experiment-template/AGENTS.md', root),
    'utf8',
  )
  const base = agentInstructions('convex-lens', { baseOnly: true })
  assert.ok(internal.startsWith(base))
  assert.ok(downloadableResources().get('AGENTS.md').startsWith(base))
})
test('generated contract verification detects wire drift', async () => {
  const path = new URL('developer-kit/experiment-template/src/contract-wire.ts', root)
  const original = await readFile(path)
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from('\n// drift\n')]))
    const result = spawnSync(
      process.execPath,
      ['scripts/developers/generate-contract.mjs', '--check'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Stale generated contract/)
  } finally {
    await writeFile(path, original)
  }
})

test('published descriptor binds identical alias and immutable archive bytes and downloaded prompt', async () => {
  const directory = new URL(
    'overlays/harness/files/apps/web/public/physicsos/developers/downloads/',
    root,
  )
  const { createHash } = await import('node:crypto')
  const release = JSON.parse(await readFile(new URL('template-release.json', directory), 'utf8'))
  const bytes = await readFile(new URL('physicsos-experiment-template-v2.zip', directory))
  assert.equal(release.schemaVersion, 2)
  assert.equal(release.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(release.bytes, bytes.length)
  assert.deepEqual(await readFile(new URL(release.url.split('/').at(-1), directory)), bytes)
  const prompt = await readFile(new URL('AGENTS.md', directory), 'utf8')
  assert.ok(prompt.startsWith(agentInstructions('convex-lens', { baseOnly: true })))
  assert.ok(prompt.includes(release.sha256))
  assert.ok(prompt.includes('https://physics.dongsiwei.com' + release.url))
  assert.equal(
    prompt,
    agentInstructions('convex-lens', { release, origin: 'https://physics.dongsiwei.com' }),
  )
  assert.ok(
    agentInstructions('convex-lens', { release, origin: 'https://candidate.example' }).includes(
      'https://candidate.example' + release.url,
    ),
  )
})
