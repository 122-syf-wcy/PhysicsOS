import { describe, expect, it } from 'vitest'
import { UnimplementedError } from '@physicsos/shared'
import { asSessionId, asUserId } from '@physicsos/shared'
import { DSH_INTEGRATION_BOUNDARY } from './boundary.ts'
import { createDeepSeekHarnessAdapter } from './deepseek-harness-adapter.ts'

describe('DeepSeekHarnessAdapter boundary', () => {
  it('is the only declared Harness integration package', () => {
    expect(DSH_INTEGRATION_BOUNDARY.packageName).toBe('@physicsos/agent-dsh-adapter')
    expect(DSH_INTEGRATION_BOUNDARY.upstreamPath).toBe('vendor/deepseek-harness')
  })

  it('refuses to fabricate a successful session', async () => {
    const adapter = createDeepSeekHarnessAdapter()
    await expect(
      adapter.createSession({
        userId: asUserId('user_fixture'),
        mode: 'experiment',
      }),
    ).rejects.toBeInstanceOf(UnimplementedError)
  })

  it('refuses to fabricate a successful run', async () => {
    const adapter = createDeepSeekHarnessAdapter()
    await expect(
      adapter.send(asSessionId('session_fixture'), { text: '解释半径' }),
    ).rejects.toBeInstanceOf(UnimplementedError)
  })
})
