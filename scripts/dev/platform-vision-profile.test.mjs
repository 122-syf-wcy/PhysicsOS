import test from 'node:test'
import assert from 'node:assert/strict'
import { planPlatformVisionProfile, planPlatformVisionDocument, applyOfflinePlatformVision } from './platform-vision-profile.mjs'
import { mkdtemp, readFile, writeFile, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const describe = () => ({ writable: true, namespaces: [{ ns: 'llm-pi-ai', revision: 17, value: { providers: {
  'physicsos-pool': { api: 'openai-completions', baseURL: 'http://127.0.0.1:38972/v1', apiKeyEnv: 'EXISTING_KEY_REFERENCE',
    models: [{ id: 'visual-a', contextWindow: 1000000, maxTokens: 32768, reasoningEfforts: { off: null, high: 'high' } },
      { id: 'visual-b', input: ['text'], compat: { supportsUsageInStreaming: true } }] },
  'other-route': { models: [{ id: 'text-only', input: ['text'] }] },
} } }] })

test('declares images for every configured platform model and preserves unrelated fields and providers', () => {
  const input = describe(), before = structuredClone(input)
  const plan = planPlatformVisionProfile(input)
  assert.equal(plan.ns, 'llm-pi-ai')
  assert.equal(plan.expectedRevision, 17)
  assert.deepEqual(plan.modelIds, ['visual-a', 'visual-b'])
  assert.deepEqual(plan.ops, [
    { op: 'set', path: ['providers', 'physicsos-pool', 'defaultInput'], value: ['text', 'image'] },
    { op: 'set', path: ['providers', 'physicsos-pool', 'models'], value: [
      { ...before.namespaces[0].value.providers['physicsos-pool'].models[0], input: ['text', 'image'] },
      { ...before.namespaces[0].value.providers['physicsos-pool'].models[1], input: ['text', 'image'] },
    ] },
  ])
  assert.deepEqual(input, before)
})

test('does not request a write when the entire platform declaration already includes vision', () => {
  const input = describe(), route = input.namespaces[0].value.providers['physicsos-pool']
  route.defaultInput = ['text', 'image']
  for (const model of route.models) model.input = ['text', 'image']
  assert.deepEqual(planPlatformVisionProfile(input).ops, [])
})

test('refuses incomplete, read-only or unversioned settings instead of replacing a partial model list', () => {
  const bad = [describe(), describe(), describe(), describe()]
  bad[0].writable = false
  delete bad[1].namespaces[0].revision
  bad[2].namespaces[0].value.providers['physicsos-pool'].models = []
  delete bad[3].namespaces[0].value.providers['physicsos-pool']
  for (const input of bad) assert.throws(() => planPlatformVisionProfile(input))
})

const document = `- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      physicsos-pool:
        api: openai-completions
        baseURL: !!js process.env.DEEPSEEK_BASE_URL
        apiKeyEnv: DEEPSEEK_API_KEY
        models:
          - id: visual-a
            maxTokens: 32768
            input: [text]
            reasoningEfforts: { off: null, high: high }
          - id: visual-b
            contextWindow: 1000000
      unrelated:
        models: [{id: text-only, input: [text]}]
- id: unrelated-service
  config:
    enabled: !!js globalThis.mustNotExecute()
`

test('offline profile merge adds modalities without executing or dropping JS-tagged values', () => {
  const plan = planPlatformVisionDocument(document)
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.modelIds, ['visual-a', 'visual-b'])
  assert.match(plan.text, /!!js.*process\.env\.DEEPSEEK_BASE_URL/)
  assert.match(plan.text, /!!js.*globalThis\.mustNotExecute/)
  assert.match(plan.text, /apiKeyEnv: DEEPSEEK_API_KEY/)
  assert.match(plan.text, /maxTokens: 32768/)
  assert.match(plan.text, /contextWindow: 1000000/)
  assert.match(plan.text, /defaultInput:/)
  const repeated = planPlatformVisionDocument(plan.text)
  assert.equal(repeated.changed, false)
  assert.equal(repeated.text, plan.text)
})

test('offline profile merge refuses absent or ambiguous exact platform entries', () => {
  assert.throws(() => planPlatformVisionDocument('- id: other\n'))
  assert.throws(() => planPlatformVisionDocument(document + document))
})

test('offline profile merge does not change a text-only provider sharing a model YAML alias', () => {
  const aliased = `- id: llm-pi-ai
  config:
    providers:
      physicsos-pool:
        models:
          - &shared
            id: visual-a
            input: [text]
      unrelated:
        models: [*shared]
`
  const plan = planPlatformVisionDocument(aliased)
  const yaml = createRequire('/app/vendor/deepseek-harness/vendor/cordis/package.json')('js-yaml')
  const parsed = yaml.load(plan.text)
  assert.deepEqual(parsed[0].config.providers['physicsos-pool'].models[0].input, ['text', 'image'])
  assert.deepEqual(parsed[0].config.providers.unrelated.models[0].input, ['text'])
})

test('offline apply keeps a private exact original and refuses stale rollback before restoring bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-vision-profile-'))
  try {
    const profile = join(root, 'cordis.patch.yml'), backup = join(root, 'original.yml')
    await writeFile(profile, document, { mode: 0o600 })
    const plan = planPlatformVisionDocument(document)
    const applied = await applyOfflinePlatformVision({ profile, backup, expectedSha256: plan.beforeSha256 })
    assert.equal(applied.afterSha256, plan.afterSha256)
    assert.equal(await readFile(backup, 'utf8'), document)
    assert.equal((await lstat(backup)).mode & 0o077, 0)
    assert.equal(await readFile(profile, 'utf8'), plan.text)
    await assert.rejects(applyOfflinePlatformVision({ profile, backup, expectedSha256: plan.beforeSha256 }), { code: 'PROFILE_CHANGED' })
    await writeFile(profile, plan.text + '# edited after release\n')
    await assert.rejects(applyOfflinePlatformVision({ profile, backup, expectedSha256: plan.afterSha256, rollback: true }), { code: 'PROFILE_CHANGED' })
    await writeFile(profile, plan.text)
    await applyOfflinePlatformVision({ profile, backup, expectedSha256: plan.afterSha256, rollback: true })
    assert.equal(await readFile(profile, 'utf8'), document)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('shipped Web platform model defaults already declare vision with the verified effort and token semantics', async () => {
  const source = await readFile(new URL('../../vendor/deepseek-harness/packages/bundle/web-app/cordis.patch.yml', import.meta.url), 'utf8')
  const plan = planPlatformVisionDocument(source)
  assert.equal(plan.changed, false)
  assert.deepEqual(plan.modelIds, ['deepseek-v4.1-flash'])
  assert.match(source, /apiKeyEnv: PHYSICSOS_MODEL_POOL_PORT/)
  assert.match(source, /maxTokens: 32768/)
  assert.match(source, /off: none/)
  assert.match(source, /maxTokensField: max_tokens/)
})
