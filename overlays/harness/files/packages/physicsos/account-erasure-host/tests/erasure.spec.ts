/**
 * Composite erasure contract.
 *
 * Two properties matter more than the happy path: the provider must refuse to
 * be available while a data-owning domain is missing (a partial success would
 * strand an unreachable account's rows), and it must fan one request across
 * every mounted domain exactly once.
 */
import { describe, expect, it } from 'vitest'
import { createAccountErasure, type AccountErasureRequest } from '../src/index.ts'

const request: AccountErasureRequest = {
  requestId: 'del_1',
  userKey: 'PHYSICSOS-OPEN:student',
  userId: 'u_1',
  schoolId: 'PHYSICSOS-OPEN',
  username: 'student',
}

function lookup(mounted: Record<string, unknown>) {
  return (service: string) => mounted[service]
}

function domain(log: string[], name: string) {
  return {
    erased: 0,
    async eraseAccount(seen: AccountErasureRequest) {
      expect(seen).toEqual(request)
      this.erased += 1
      log.push(name)
    },
  }
}

describe('composite account erasure', () => {
  it('refuses availability while a data-owning domain is not mounted', () => {
    const provider = createAccountErasure(lookup({
      physicsosMobileLearning: domain([], 'learning'),
    }))
    expect(() => provider.assertAvailable()).toThrow('class domain not mounted')
  })

  it('becomes available once learning and class are both mounted', () => {
    const provider = createAccountErasure(lookup({
      physicsosMobileLearning: domain([], 'learning'),
      physicsosMobileClasses: domain([], 'class'),
    }))
    expect(() => provider.assertAvailable()).not.toThrow()
  })

  it('fans one request across every mounted domain, in order', async () => {
    const log: string[] = []
    const learning = domain(log, 'learning')
    const classes = domain(log, 'class')
    const provider = createAccountErasure(lookup({
      physicsosMobileLearning: learning,
      physicsosMobileClasses: classes,
    }))
    await provider.eraseAccount(request)
    expect(log).toEqual(['learning', 'class'])
    expect(learning.erased).toBe(1)
    expect(classes.erased).toBe(1)
  })

  it('does not report success when a domain throws', async () => {
    const provider = createAccountErasure(lookup({
      physicsosMobileLearning: { async eraseAccount() { throw new Error('storage offline') } },
      physicsosMobileClasses: domain([], 'class'),
    }))
    await expect(provider.eraseAccount(request)).rejects.toThrow('storage offline')
  })
})
