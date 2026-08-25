import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as PhysicsosInvariant from '@deepseek-ai/dsh-client-ui-physicsos/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PhysicsosInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@deepseek-ai/dsh-client-ui-physicsos')
    expect(() => { apply() }).not.toThrow()
  })
})
