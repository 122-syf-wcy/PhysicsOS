import assert from 'node:assert/strict'
import { test } from 'node:test'
import { envWithBoundAppImage, envWithTeachingToolsMode, guardTeachingToolsCompatibility } from './release-switch.mjs'

const LEGACY = `sha256:${'a'.repeat(64)}`
const BRIDGE = `sha256:${'b'.repeat(64)}`
const FEATURE = `sha256:${'c'.repeat(64)}`
const CAPABILITY = 'teaching-tools-bridge-v1'
const image = (id, capability) => ({ Id: id, Config: { Labels: capability ? { 'physicsos.teaching-tools.bridge': capability } : {} } })
const plan = (stage = 'enabled') => ({
  expectedOldImage: BRIDGE, candidateImage: FEATURE,
  teachingTools: { capability: CAPABILITY, stage, rollbackImage: BRIDGE },
  acceptance: { expectedTeachingToolsMode: stage },
})

test('first bridge keeps the legacy image rollback floor before additive writes are enabled', () => {
  const input = plan('bridge')
  input.expectedOldImage = LEGACY
  input.teachingTools.rollbackImage = LEGACY
  assert.deepEqual(guardTeachingToolsCompatibility(input, image(LEGACY), image(FEATURE, CAPABILITY)), {
    capability: CAPABILITY, stage: 'bridge', rollbackImage: LEGACY, imageOnlyRollback: true, dataRestoreAllowed: false,
  })
})
test('enabled lifecycle writes require the exact compatible bridge rollback image', () => {
  assert.equal(guardTeachingToolsCompatibility(plan(), image(BRIDGE, CAPABILITY), image(FEATURE, CAPABILITY)).rollbackImage, BRIDGE)
})
test('enabled release refuses legacy rollback even when rollbackCompatible was asserted', () => {
  const input = { ...plan(), expectedOldImage: LEGACY, rollbackCompatible: true }
  input.teachingTools.rollbackImage = LEGACY
  assert.throws(() => guardTeachingToolsCompatibility(input, image(LEGACY), image(FEATURE, CAPABILITY)), /without the teaching tools bridge/)
})
test('a labelled image cannot omit the explicit lifecycle plan in either direction', () => {
  assert.throws(() => guardTeachingToolsCompatibility({}, image(BRIDGE, CAPABILITY), image(FEATURE, CAPABILITY)), /explicit lifecycle/)
  assert.throws(() => guardTeachingToolsCompatibility({}, image(BRIDGE, CAPABILITY), image(FEATURE)), /explicit lifecycle/)
  assert.throws(() => guardTeachingToolsCompatibility({}, image(LEGACY), image(FEATURE, CAPABILITY)), /explicit lifecycle/)
})
test('unknown fields and modes cannot weaken lifecycle rollback admission', () => {
  for (const mutate of [
    input => { input.teachingTools.stage = 'off' },
    input => { input.teachingTools.restoreData = true },
    input => { input.teachingTools.rollbackImage = LEGACY },
    input => { input.teachingTools.capability = 'unreviewed' },
    input => { input.candidateImage = input.expectedOldImage },
    input => { input.acceptance.expectedTeachingToolsMode = 'bridge' },
    input => { delete input.acceptance.expectedTeachingToolsMode },
  ]) {
    const input = plan(); mutate(input)
    assert.throws(() => guardTeachingToolsCompatibility(input, image(BRIDGE, CAPABILITY), image(FEATURE, CAPABILITY)))
  }
})
test('image identity and both capability labels must exactly match the bound plan', () => {
  assert.throws(() => guardTeachingToolsCompatibility(plan(), image(LEGACY, CAPABILITY), image(FEATURE, CAPABILITY)))
  assert.throws(() => guardTeachingToolsCompatibility(plan(), image(BRIDGE, CAPABILITY), image(LEGACY, CAPABILITY)))
  assert.throws(() => guardTeachingToolsCompatibility(plan(), image(BRIDGE, CAPABILITY), image(FEATURE)))
  assert.throws(() => guardTeachingToolsCompatibility(plan('bridge'), image(BRIDGE, 'unknown-v2'), image(FEATURE, CAPABILITY)), /previous teaching tools/)
})
test('app-only lifecycle releases bind one exact image without rewriting unrelated env bytes', () => {
  const prior = Buffer.from(`# retained\r\nexport PHYSICSOS_APP_IMAGE = ${BRIDGE}  \r\nOTHER_IMAGE=${BRIDGE}`)
  assert.equal(envWithBoundAppImage(prior, FEATURE, BRIDGE).toString(), prior.toString().replace(`PHYSICSOS_APP_IMAGE = ${BRIDGE}`, `PHYSICSOS_APP_IMAGE = ${FEATURE}`))
  assert.throws(() => envWithBoundAppImage(prior, FEATURE, LEGACY), /identity changed/)
  assert.throws(() => envWithBoundAppImage(Buffer.concat([prior, Buffer.from(`\r\nPHYSICSOS_APP_IMAGE=${BRIDGE}`)]), FEATURE, BRIDGE), /exactly one/)
})
test('teaching mode rewrites preserve CRLF and all unrelated env bytes', () => {
  const before = Buffer.from('# retained\r\nSECRET_FILE=/run/private\r\nexport PHYSICSOS_TEACHING_TOOLS_MODE = bridge  \r\nAPP=keep\r\n')
  assert.equal(envWithTeachingToolsMode(before, 'enabled').toString(), '# retained\r\nSECRET_FILE=/run/private\r\nexport PHYSICSOS_TEACHING_TOOLS_MODE = enabled  \r\nAPP=keep\r\n')
  assert.equal(envWithTeachingToolsMode(Buffer.from('APP=keep'), 'bridge').toString(), 'APP=keep\nPHYSICSOS_TEACHING_TOOLS_MODE=bridge\n')
  assert.throws(() => envWithTeachingToolsMode(Buffer.from('PHYSICSOS_TEACHING_TOOLS_MODE=bridge\nPHYSICSOS_TEACHING_TOOLS_MODE=enabled\n'), 'bridge'), /at most one/)
  assert.throws(() => envWithTeachingToolsMode(before, 'off'), /Invalid/)
})
test('unrelated legacy releases keep their existing admission path', () => {
  assert.equal(guardTeachingToolsCompatibility({}, image(LEGACY), image(FEATURE)), null)
})
