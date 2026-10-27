import { afterEach, describe, expect, it } from 'vitest'
import {
  cookieOf,
  createSecurityHarness,
  post,
  school,
  user,
  type SecurityHarness,
} from './security-fixture.ts'

const harnesses: SecurityHarness[] = []

const makeHarness = async (registrationMode: 'open' | 'invite' | 'closed') => {
  const harness = await createSecurityHarness({
    config: { registrationMode, registrationAttemptLimit: 100 },
    schools: [
      school('GZU', '贵州大学'),
      school('GZNU', '贵州师范大学'),
      school('PHYSICSOS-OPEN', 'PhysicsOS 平台'),
    ],
    users: [
      user('PHYSICSOS-OPEN', 'admin', 'SUPER_ADMIN'),
      user('GZU', 'admin', 'SCHOOL_ADMIN'),
    ],
  })
  harnesses.push(harness)
  return harness
}

const adminCookie = async (harness: SecurityHarness): Promise<string> => {
  const response = await post(harness.auth, '/login', {
    schoolId: 'PHYSICSOS-OPEN',
    username: 'admin',
    password: 'bootstrap-pass',
  })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.close()))
})

describe('invite registration modes', () => {
  // Two fixture hashes and one registration hash need contention headroom.
  it('keeps open registration working without an invite code', async () => {
    const harness = await makeHarness('open')
    const response = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'open-user',
      displayName: '开放注册',
      password: 'open-pass-123',
    })
    expect(response.status).toBe(201)
  }, 20_000)

  it('fails closed in invite mode when no code is supplied', async () => {
    const harness = await makeHarness('invite')
    const response = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'invite-user',
      displayName: '邀请注册',
      password: 'invite-pass-123',
    })
    expect(response.status).toBe(403)
    expect((await response.json() as { error: { code: string } }).error.code).toBe('INVITE_REQUIRED')
  })

  it('closes registration even when a valid-looking code is supplied', async () => {
    const harness = await makeHarness('closed')
    const response = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'closed-user',
      displayName: '关闭注册',
      password: 'closed-pass-123',
      inviteCode: 'inv_this-code-must-not-open-closed-registration',
    })
    expect(response.status).toBe(403)
    expect((await response.json() as { error: { code: string } }).error.code).toBe('REGISTRATION_CLOSED')
  })
})

describe('admin invite lifecycle', () => {
  // Two fixture hashes, one login and three registration hashes need contention headroom.
  it('generates hashed codes, lists masked rows, consumes once, disables, and audits each action', async () => {
    const harness = await makeHarness('invite')
    const cookie = await adminCookie(harness)
    const headers = { cookie: `physicsos_session=${cookie}` }
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const generated = await post(harness.admin, '/invites', {
      schoolId: 'GZU',
      count: 2,
      maxUses: 1,
      expiresAt,
    }, headers)
    expect(generated.status).toBe(201)
    const body = await generated.json() as {
      invites: { id: string; code: string; schoolId: string; maxUses: number }[]
    }
    expect(body.invites).toHaveLength(2)
    expect(body.invites.every(row => row.schoolId === 'GZU' && row.maxUses === 1)).toBe(true)

    const stored = [...harness.domain.table('invites').entries()]
    expect(stored).toHaveLength(2)
    const storedBlob = JSON.stringify(stored)
    for (const row of body.invites) expect(storedBlob).not.toContain(row.code)
    expect(stored.every(([, row]) => row.codeHash.length === 64)).toBe(true)

    const first = body.invites[0]
    if (first === undefined) throw new Error('expected invite')
    const registered = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'invite-one',
      displayName: '邀请一',
      password: 'invite-pass-123',
      inviteCode: first.code,
    })
    expect(registered.status).toBe(201)

    const reused = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'invite-two',
      displayName: '邀请二',
      password: 'invite-pass-456',
      inviteCode: first.code,
    })
    expect(reused.status).toBe(400)
    expect((await reused.json() as { error: { code: string } }).error.code).toBe('INVALID_INVITE_CODE')

    const listed = await fetch(`${harness.admin}/invites?schoolId=GZU`, { headers })
    expect(listed.status).toBe(200)
    const listBody = await listed.json() as {
      invites: { id: string; codeMasked: string; usedCount: number; disabledAt?: string }[]
    }
    expect(listBody.invites.find(row => row.id === first.id)).toMatchObject({
      usedCount: 1,
    })
    expect(listBody.invites.find(row => row.id === first.id)?.codeMasked).not.toContain(first.code)
    expect(JSON.stringify(listBody)).not.toContain(first.code)

    const disabled = await post(harness.admin, `/invites/${first.id}/disable`, {}, headers)
    expect(disabled.status).toBe(200)
    const second = body.invites[1]
    if (second === undefined) throw new Error('expected second invite')
    const afterDisable = await post(harness.admin, `/invites/${second.id}/disable`, {}, headers)
    expect(afterDisable.status).toBe(200)
    const disabledUse = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'invite-disabled',
      displayName: '已停用',
      password: 'invite-pass-789',
      inviteCode: second.code,
    })
    expect(disabledUse.status).toBe(400)

    const audit = await fetch(`${harness.admin}/audit?schoolId=GZU`, { headers })
    const { events } = await audit.json() as { events: { action: string }[] }
    expect(events.filter(event => event.action === 'invite.create')).toHaveLength(2)
    expect(events.filter(event => event.action === 'invite.use')).toHaveLength(1)
    expect(events.filter(event => event.action === 'invite.disable')).toHaveLength(2)
  }, 20_000)

  // One fixture hash, one login and four registration hashes need contention headroom.
  it('binds a code to its school, enforces expiry, and atomically consumes its final use', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z')
    const harness = await createSecurityHarness({
      config: { registrationMode: 'invite', registrationAttemptLimit: 100 },
      deps: { now: () => now },
      schools: [
        school('GZU', '贵州大学'),
        school('GZNU', '贵州师范大学'),
        school('PHYSICSOS-OPEN', 'PhysicsOS 平台'),
      ],
      users: [user('PHYSICSOS-OPEN', 'admin', 'SUPER_ADMIN')],
    })
    harnesses.push(harness)
    const cookie = await adminCookie(harness)
    const headers = { cookie: `physicsos_session=${cookie}` }

    const generated = await post(harness.admin, '/invites', {
      schoolId: 'GZU',
      count: 2,
      maxUses: 1,
      expiresAt: '2026-01-01T01:00:00.000Z',
    }, headers)
    const { invites } = await generated.json() as { invites: { code: string }[] }
    const bound = invites[0]
    const expiring = invites[1]
    if (bound === undefined || expiring === undefined) throw new Error('expected invites')

    const wrongSchool = await post(harness.auth, '/register', {
      schoolName: '贵州师范大学',
      username: 'wrong-school',
      displayName: '绑定校验',
      password: 'invite-pass-123',
      inviteCode: bound.code,
    })
    expect(wrongSchool.status).toBe(400)
    expect((await wrongSchool.json() as { error: { code: string } }).error.code).toBe('INVALID_INVITE_CODE')

    const claims = await Promise.allSettled([
      harness.service.register({
        schoolName: '贵州大学',
        username: 'concurrent-a',
        displayName: '并发甲',
        password: 'invite-pass-123',
        email: 'concurrent-a@example.com',
        inviteCode: bound.code,
      }, '192.0.2.10'),
      harness.service.register({
        schoolName: '贵州大学',
        username: 'concurrent-b',
        displayName: '并发乙',
        password: 'invite-pass-456',
        email: 'concurrent-b@example.com',
        inviteCode: bound.code,
      }, '192.0.2.11'),
    ])
    expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(claims.filter(result => result.status === 'rejected')).toHaveLength(1)

    now = new Date('2026-01-01T02:00:00.000Z')
    const expired = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'expired-invite',
      displayName: '过期邀请',
      password: 'invite-pass-789',
      inviteCode: expiring.code,
    })
    expect(expired.status).toBe(400)
    expect((await expired.json() as { error: { code: string } }).error.code).toBe('INVALID_INVITE_CODE')
  }, 20_000)

  // One fixture hash, one login and one registration hash need contention headroom.
  it('uses the optional shared one-time ledger as a cross-instance invite lock', async () => {
    const claims = new Set<string>()
    const releases: string[] = []
    const onceLedger = {
      kind: 'test-once',
      claim(key: string, ttlSeconds: number) {
        if (claims.has(key)) return { status: 'already-claimed' as const, expiresAt: Date.now() + ttlSeconds * 1_000 }
        claims.add(key)
        return { status: 'claimed' as const, expiresAt: Date.now() + ttlSeconds * 1_000 }
      },
      release(key: string) {
        releases.push(key)
        claims.delete(key)
      },
    }
    const harness = await createSecurityHarness({
      config: { registrationMode: 'invite', registrationAttemptLimit: 100 },
      deps: { onceLedger },
      schools: [
        school('GZU', '贵州大学'),
        school('PHYSICSOS-OPEN', 'PhysicsOS 平台'),
      ],
      users: [user('PHYSICSOS-OPEN', 'admin', 'SUPER_ADMIN')],
    })
    harnesses.push(harness)
    const cookie = await adminCookie(harness)
    const generated = await post(harness.admin, '/invites', {
      schoolId: 'GZU',
      count: 1,
      maxUses: 1,
    }, { cookie: `physicsos_session=${cookie}` })
    const { invites } = await generated.json() as { invites: { code: string }[] }
    const invite = invites[0]
    if (invite === undefined) throw new Error('expected invite')

    const registered = await post(harness.auth, '/register', {
      schoolName: '贵州大学',
      username: 'locked-invite',
      displayName: '共享锁',
      password: 'invite-pass-123',
      inviteCode: invite.code,
    })
    expect(registered.status).toBe(201)
    expect(releases).toHaveLength(1)
    expect(releases[0]).toMatch(/^invite-consume:[a-f0-9]{64}$/)
    expect(claims.size).toBe(0)
  }, 20_000)
})


describe('invite write failure recovery', () => {
  // Two fixture hashes and two registration hashes need contention headroom.
  it('restores the exact hashed invite row before admitting a concurrent registration', async () => {
    const harness = await makeHarness('invite')
    const actor = { userKey: 'PHYSICSOS-OPEN:admin', schoolId: 'PHYSICSOS-OPEN', username: 'admin', role: 'SUPER_ADMIN' as const }
    const { invites } = await harness.service.createInvites(actor, { schoolId: 'GZU', count: 1, maxUses: 1 })
    const invite = invites[0]!
    const originalEntries = [...harness.domain.table('invites').entries()]
    const users = harness.domain.table('users')
    const originalPut = users.put.bind(users)
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    users.put = async (key, row) => {
      if (row.username === 'failing-user') { entered(); await blocked; throw new Error('durable user write failed') }
      await originalPut(key, row)
    }
    const body = {
      schoolId: 'GZU', username: 'failing-user', displayName: '用户', password: 'test-password',
      email: 'failing-user@example.com', inviteCode: invite.code,
    }
    const first = harness.service.register(body)
    const firstResult = first.catch((error: unknown) => error)
    await started
    const second = harness.service.register({ ...body, username: 'next-user' })
    const secondResult = second.catch((error: unknown) => error)
    release()
    expect(await firstResult).toMatchObject({ message: 'durable user write failed' })
    expect(await secondResult).toMatchObject({ user: { username: 'next-user' } })
    const entries = [...harness.domain.table('invites').entries()]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual([originalEntries[0]![0], { ...originalEntries[0]![1], usedCount: 1 }])
    expect(harness.domain.table('users').get('GZU:failing-user')).toBeUndefined()
  }, 20_000)
})


// Two fixture hashes and one registration hash need contention headroom.
it('keeps an administrator disable when an overlapping registration is rolled back', async () => {
  const harness = await makeHarness('invite')
  const actor = { userKey: 'PHYSICSOS-OPEN:admin', schoolId: 'PHYSICSOS-OPEN', username: 'admin', role: 'SUPER_ADMIN' as const }
  const { invites } = await harness.service.createInvites(actor, { schoolId: 'GZU', count: 1, maxUses: 1 })
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  const blocked = new Promise<void>((resolve) => { release = resolve })
  harness.domain.table('users').put = async () => { started(); await blocked; throw new Error('failed') }
  const registration = harness.service.register({ schoolId: 'GZU', username: 'failed-user', displayName: '用户', password: 'test-password', email: 'failed-user@example.com', inviteCode: invites[0]!.code }).catch((error: unknown) => error)
  await entered
  const disabling = harness.service.disableInvite(actor, invites[0]!.id)
  release()
  await registration
  await disabling
  const rows = [...harness.domain.table('invites').entries()]
  expect(rows).toHaveLength(1)
  expect(rows[0]![1]).toMatchObject({ usedCount: 0, disabledBy: actor.userKey })
  expect(typeof rows[0]![1].disabledAt).toBe('string')
}, 20_000)
