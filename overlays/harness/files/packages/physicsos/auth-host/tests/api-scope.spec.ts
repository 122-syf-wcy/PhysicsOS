import { describe, expect, it } from 'vitest'
import type { AuthDomain } from '../src/domain.ts'
import type { IdentityActor } from '../src/identity.ts'
import { AuthService } from '../src/service.ts'

const table = <T>() => {
  const rows = new Map<string, T>()
  return {
    get: (id: string) => rows.get(id),
    put: async (id: string, value: T) => { rows.set(id, value) },
    delete: async (id: string) => rows.delete(id),
    entries: () => rows.entries(),
  }
}

const domain = (): AuthDomain => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = table<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as AuthDomain
}

const actor = (
  userKey: string,
  schoolId: string,
  role: IdentityActor['role'] = 'STUDENT',
): IdentityActor => ({
  userKey,
  schoolId,
  username: userKey.slice(userKey.indexOf(':') + 1),
  role,
})

describe('shared API resource ownership', () => {
  it('persists ownership, refuses cross-account claims, and supports release', async () => {
    const service = new AuthService(domain())
    const owner = actor('school:one', 'school')
    const other = actor('other:two', 'other')

    await service.claimApiResource(owner, 'session', 'session-1')
    await service.claimApiResource(owner, 'workspace', 'workspace-1')

    expect(service.ownsApiResource(owner, 'session', 'session-1')).toBe(true)
    expect(service.ownsApiResource(other, 'session', 'session-1')).toBe(false)
    expect([...service.ownedApiResources(owner, 'workspace')]).toEqual(['workspace-1'])
    await expect(service.claimApiResource(other, 'session', 'session-1'))
      .rejects.toMatchObject({ status: 403, code: 'NOT_FOUND' })

    await service.releaseApiResource(owner, 'session', 'session-1')
    expect(service.ownsApiResource(owner, 'session', 'session-1')).toBe(false)
  })
})
