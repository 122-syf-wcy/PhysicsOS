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

test('seed runtime preserves the reviewed final stage without inheriting verification container configuration', async () => {
  const { seedRuntimeDockerfile } = await import('./release-full.mjs')
  const stage = 'FROM ${NODE_IMAGE} AS runtime\nENV NODE_ENV=production\nCOPY --from=builder /app/vendor /app/vendor\nUSER physicsos\nCMD ["node","server.js"]\n'
  const output = seedRuntimeDockerfile('ARG NODE_IMAGE\nFROM ${NODE_IMAGE} AS builder\nRUN build\n' + stage)
  assert.equal(output.runtimeStage, stage)
  assert.equal(output.dockerfile, 'ARG NODE_IMAGE\nARG BUILDER_IMAGE\nFROM ${BUILDER_IMAGE} AS builder\n\n' + stage)
  assert.throws(() => seedRuntimeDockerfile('FROM unreviewed AS runtime\n'))
  assert.throws(() => seedRuntimeDockerfile(stage + stage))
})

test('full seed path requires actual successful offline evidence for both workspace roots', async () => {
  const { validateFullSeedAudit } = await import('./release-full.mjs')
  const receipt = { origin: 'audited-runtime-seed', audited: true, offlineRootLockVerified: true, offlineHarnessLockVerified: true,
    offlineEvidence: ['/app', '/app/vendor/deepseek-harness'].map(cwd => ({ cwd, command: 'pnpm install --offline --frozen-lockfile --prod=false', exitCode: 0 })) }
  assert.equal(validateFullSeedAudit(receipt), receipt)
  assert.throws(() => validateFullSeedAudit({ ...receipt, offlineEvidence: [] }))
  assert.throws(() => validateFullSeedAudit({ ...receipt, offlineEvidence: receipt.offlineEvidence.map(step => ({ ...step, cwd: '/app' })) }))
  assert.throws(() => validateFullSeedAudit({ ...receipt, offlineEvidence: receipt.offlineEvidence.map(step => ({ ...step, exitCode: 1 })) }))
})
