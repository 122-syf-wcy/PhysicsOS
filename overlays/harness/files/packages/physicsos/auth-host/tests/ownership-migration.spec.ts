import { describe, expect, it } from 'vitest'
import type { AuthDomain, School } from '../src/domain.ts'
import { migrateLegacyOwnership, parseOwnershipManifest } from '../src/ownership.ts'

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

const seed = async (domain: AuthDomain): Promise<void> => {
  const at = new Date(0).toISOString()
  const school: School = {
    id: 'GZU',
    name: '贵州大学',
    status: 'active',
    createdAt: at,
    updatedAt: at,
  }
  await domain.table('schools').put(school.id, school)
  await domain.table('users').put('GZU:alice', {
    id: 'u_alice',
    schoolId: 'GZU',
    username: 'alice',
    passwordHash: 'x',
    displayName: 'Alice',
    role: 'STUDENT',
    status: 'active',
    createdAt: at,
    updatedAt: at,
  })
}

describe('legacy ownership migration', () => {
  it('assigns missing sessions/workspaces and leaves an already-correct owner alone', async () => {
    const domain = makeDomain()
    await seed(domain)
    const first = await migrateLegacyOwnership(domain, [
      { kind: 'session', resourceId: 's1', schoolId: 'GZU', username: 'alice' },
      { kind: 'workspace', resourceId: 'w1', schoolId: 'GZU', username: 'alice' },
    ])
    expect(first).toMatchObject({ migrated: 2, alreadyOwned: 0, conflicts: [] })
    expect(domain.table('api_resources').get('session:s1')).toMatchObject({
      ownerKey: 'GZU:alice',
      resourceId: 's1',
    })

    const second = await migrateLegacyOwnership(domain, [
      { kind: 'session', resourceId: 's1', schoolId: 'GZU', username: 'alice' },
    ])
    expect(second).toMatchObject({ migrated: 0, alreadyOwned: 1, conflicts: [] })
  })

  it('refuses to rewrite an existing owner and supports dry runs', async () => {
    const domain = makeDomain()
    await seed(domain)
    await migrateLegacyOwnership(domain, [
      { kind: 'session', resourceId: 's1', schoolId: 'GZU', username: 'alice' },
    ])

    const conflict = await migrateLegacyOwnership(domain, [
      { kind: 'session', resourceId: 's1', schoolId: 'GZU', username: 'alice' },
      { kind: 'workspace', resourceId: 'w1', schoolId: 'GZU', username: 'alice' },
    ], { apply: false })
    expect(conflict.migrated).toBe(1)
    expect(conflict.alreadyOwned).toBe(1)
    expect(domain.table('api_resources').get('workspace:w1')).toBeUndefined()
  })

  it('rejects malformed and unknown-owner manifests before writing anything', async () => {
    const domain = makeDomain()
    await seed(domain)
    expect(() => parseOwnershipManifest({
      ownership: [
        { kind: 'session', resourceId: '', schoolId: 'GZU', username: 'alice' },
      ],
    })).toThrow()
    await expect(migrateLegacyOwnership(domain, [
      { kind: 'session', resourceId: 's1', schoolId: 'GZU', username: 'ghost' },
    ])).rejects.toThrow('unknown owner')
    expect([...domain.table('api_resources').entries()]).toHaveLength(0)
  })
})
