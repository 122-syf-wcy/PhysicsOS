import { describe, expect, it } from 'vitest'
import type { AuthDomain, School } from '../src/domain.ts'
import { AuthService, type AuthServiceDeps } from '../src/service.ts'
import { InMemoryLimiterBackend, type LimiterPolicy } from '../src/limiter.ts'
import {
  QUEUE_PASSWORD_RESET_DELIVERY,
  type PasswordResetDelivery,
  type PasswordResetDeliveryMessage,
} from '../src/reset-delivery.ts'
import { passwordResetTokenHash } from '../src/reset.ts'

const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => { map.set(id, record) },
    entries: () => map.entries(),
    delete: async (id: string) => map.delete(id),
  }
}

const makeDomain = (): AuthDomain => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      let found = tables.get(name)
      if (found === undefined) {
        found = table()
        tables.set(name, found)
      }
      return found
    },
  } as unknown as AuthDomain
}

const seedSchool = async (domain: AuthDomain): Promise<void> => {
  const now = new Date(0).toISOString()
  const school: School = {
    id: 'GZU',
    name: '贵州大学',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await domain.table('schools').put(school.id, school)
}

const serviceFor = async (
  deps: AuthServiceDeps = {},
): Promise<{ domain: AuthDomain; service: AuthService }> => {
  const domain = makeDomain()
  await seedSchool(domain)
  return {
    domain,
    service: new AuthService(domain, {
      sessionTtlMs: 60_000,
      rememberTtlMs: 120_000,
      accountAttemptLimit: 20,
      ipAttemptLimit: 20,
      applyAttemptLimit: 20,
      registrationAttemptLimit: 20,
      learningAttemptLimit: 20,
      passwordResetAttemptLimit: 20,
      passwordResetTtlMs: 60_000,
      attemptWindowMs: 60_000,
      trustedProxies: [],
      attemptBucketLimit: 100,
    }, deps),
  }
}

const register = async (service: AuthService) => service.register({
  schoolId: 'GZU',
  username: 'reset-user',
  displayName: '重置用户',
  password: 'old-password',
}, '192.0.2.10', 'vitest')

const admin = {
  userKey: 'GZU:admin',
  schoolId: 'GZU',
  username: 'admin',
  role: 'SCHOOL_ADMIN' as const,
}

describe('password reset lifecycle', () => {
  it('queues recovery without storing a raw token, then issues a hashed one-time token', async () => {
    const { domain, service } = await serviceFor()
    await register(service)

    await service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    const queued = service.listPasswordResets(admin).requests
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({
      schoolId: 'GZU',
      username: 'reset-user',
      status: 'pending',
      delivery: 'queue',
    })
    expect(JSON.stringify(queued)).not.toContain('tokenHash')

    const issued = await service.issuePasswordReset(admin, queued[0]!.id)
    expect(issued.token.length).toBeGreaterThan(40)
    expect(issued.resetPath).toContain('reset_token=')
    const tokens = [...domain.table('password_reset_tokens').entries()]
    expect(tokens).toHaveLength(1)
    expect(tokens[0]![0]).toBe(passwordResetTokenHash(issued.token))
    expect(JSON.stringify(tokens)).not.toContain(issued.token)
  })

  it('uses a reset token once, changes the password, and revokes every live session', async () => {
    const { service } = await serviceFor()
    const session = await register(service)
    await service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    const request = service.listPasswordResets(admin).requests[0]!
    const issued = await service.issuePasswordReset(admin, request.id)

    await service.submitPasswordReset({
      token: issued.token,
      newPassword: 'new-password',
    }, '192.0.2.12')

    expect(service.resolveSession(session.token)).toBeNull()
    await expect(service.login({ username: 'reset-user', password: 'old-password' }, '192.0.2.12'))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
    await expect(service.login({ username: 'reset-user', password: 'new-password' }, '192.0.2.12'))
      .resolves.toMatchObject({ user: { username: 'reset-user' } })
    await expect(service.submitPasswordReset({
      token: issued.token,
      newPassword: 'another-password',
    }, '192.0.2.12')).rejects.toMatchObject({ status: 400, code: 'INVALID_RESET_TOKEN' })
  })

  it('expires a token and invalidates the previous token when a newer one is issued', async () => {
    let now = new Date(10_000)
    const { service } = await serviceFor({ now: () => now })
    await register(service)

    await service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    const firstRequest = service.listPasswordResets(admin).requests[0]!
    const first = await service.issuePasswordReset(admin, firstRequest.id)

    await service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    const requests = service.listPasswordResets(admin).requests
    const secondRequest = requests.find(request => request.status === 'pending')!
    const second = await service.issuePasswordReset(admin, secondRequest.id)
    await expect(service.submitPasswordReset({
      token: first.token,
      newPassword: 'first-new-password',
    }, '192.0.2.12')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' })

    now = new Date(10_000 + 60_001)
    await expect(service.submitPasswordReset({
      token: second.token,
      newPassword: 'second-new-password',
    }, '192.0.2.12')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' })
  })

  it('invalidates an outstanding reset token when an administrator rotates the password', async () => {
    const { service } = await serviceFor()
    await register(service)
    await service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    const request = service.listPasswordResets(admin).requests[0]!
    const issued = await service.issuePasswordReset(admin, request.id)

    await service.resetUserPassword(admin, 'GZU', 'reset-user', {
      newPassword: 'admin-rotated-password',
    })
    await expect(service.submitPasswordReset({
      token: issued.token,
      newPassword: 'should-not-work',
    }, '192.0.2.12')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_RESET_TOKEN',
    })
  })

  it('cancels a queued request and revokes its issued token', async () => {
    const { service } = await serviceFor()
    await register(service)
    await service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    const request = service.listPasswordResets(admin).requests[0]!
    const issued = await service.issuePasswordReset(admin, request.id)
    await expect(service.cancelPasswordReset(admin, request.id)).resolves.toMatchObject({
      status: 'cancelled',
    })
    await expect(service.submitPasswordReset({
      token: issued.token,
      newPassword: 'cancelled-password',
    }, '192.0.2.12')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' })
  })

  it('delivers directly when configured, but records a failed delivery without leaving a valid token', async () => {
    const delivered: PasswordResetDeliveryMessage[] = []
    const delivery: PasswordResetDelivery = {
      kind: 'test-email',
      mode: 'direct',
      deliver: async (message) => { delivered.push(message) },
    }
    const first = await serviceFor({ resetDelivery: delivery })
    await register(first.service)
    await first.service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.token).toBeTypeOf('string')
    expect([...first.domain.table('password_reset_tokens').entries()][0]![0])
      .toBe(passwordResetTokenHash(delivered[0]!.token))

    const failed = await serviceFor({
      resetDelivery: {
        kind: 'broken-email',
        mode: 'direct',
        deliver: async () => { throw new Error('smtp down') },
      },
    })
    await register(failed.service)
    await failed.service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.11')
    expect(failed.service.listPasswordResets(admin).requests[0]).toMatchObject({
      status: 'delivery_failed',
    })
    expect([...failed.domain.table('password_reset_tokens').entries()].every(([, token]) =>
      token.revokedAt !== undefined)).toBe(true)
  })

  it('bad-request and delivery paths fail closed with the shared limiter seam', async () => {
    expect(QUEUE_PASSWORD_RESET_DELIVERY.mode).toBe('queue')
    const calls: LimiterPolicy['name'][] = []
    const limiter = new InMemoryLimiterBackend()
    const shared = {
      kind: 'spy',
      consume: (policy: LimiterPolicy, key: string, now?: number) => {
        calls.push(policy.name)
        return limiter.consume(policy, key, now)
      },
      snapshot: (policy: LimiterPolicy, now?: number) => limiter.snapshot(policy, now),
    }
    const { service } = await serviceFor({ limiter: shared })
    await register(service)
    await service.requestPasswordReset({ username: 'reset-user' }, '192.0.2.13')
    expect(calls).toContain('passwordReset')

    const unavailable = await serviceFor({
      limiter: {
        kind: 'redis-down',
        consume: () => { throw new Error('redis unavailable') },
      },
    })
    await expect(unavailable.service.login({
      username: 'nobody',
      password: 'wrong-password',
    }, '192.0.2.14')).rejects.toMatchObject({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
    })
  })
})
