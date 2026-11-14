import assert from 'node:assert/strict'
import test from 'node:test'
import { fullReleaseIdentity } from './release-full.mjs'

test('full releases require committed source and an immutable Node base rather than a production image tag', () => {
  const identity = { revision: 'a'.repeat(40), nodeImage: 'sha256:' + 'b'.repeat(64) }
  assert.equal(fullReleaseIdentity(identity).estimatedBytes, 12 * 1024 ** 3)
  for (const patch of [{ revision: 'main' }, { nodeImage: 'node:24' }, { nodeImage: '' }, { estimatedBytes: 0 }, { estimatedBytes: Infinity }])
    assert.throws(() => fullReleaseIdentity({ ...identity, ...patch }))
  assert.equal(fullReleaseIdentity({ ...identity, estimatedBytes: 8 * 1024 ** 3 }).estimatedBytes, 8 * 1024 ** 3)
})
