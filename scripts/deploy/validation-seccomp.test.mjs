import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Docker resolves capability conditions before Chromium creates its own user
// namespace. A CAP_SYS_CHROOT condition would disappear under cap_drop: ALL.
test('the validation profile permits namespace-local chroot without requiring outer container capabilities', async () => {
  const profile = JSON.parse(await readFile(new URL('./validation-seccomp.json', import.meta.url), 'utf8'))
  assert.equal(profile.defaultAction, 'SCMP_ACT_ERRNO')
  const rules = profile.syscalls.filter(rule => rule.names.includes('chroot'))
  assert.equal(rules.length, 1)
  assert.deepEqual(rules[0].names, ['chroot'])
  assert.equal(rules[0].action, 'SCMP_ACT_ALLOW')
  assert.deepEqual(rules[0].args, [])
  assert.deepEqual(rules[0].includes?.caps ?? [], [])
  assert.deepEqual(rules[0].excludes?.caps ?? [], [])
})
