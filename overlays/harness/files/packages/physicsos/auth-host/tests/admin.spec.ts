/**
 * Admin Console spec: the anonymous school-application intake, the
 * SUPER_ADMIN / SCHOOL_ADMIN role matrix, tenant narrowing, the approval
 * pipeline (school + seeded admin + audit), user lifecycle operations, and
 * the append-only audit ledger. Runs a real http server over the same
 * Map-backed domain stub as auth.spec, dispatching both route prefixes.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthService } from '../src/service.ts'
import { adminRoutes, authRoutes } from '../src/routes.ts'
import { hashPassword } from '../src/passwords.ts'
import { userKey } from '../src/domain.ts'
import type { AuthDomain, School, SchoolRequestRecord, UserRecord } from '../src/domain.ts'

const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => { map.set(id, record) },
    entries: () => map.entries(),
    delete: async (id: string) => map.delete(id),
  }
}

const fakeDomain = {
  table: (name: string) => {
    const tables = (fakeDomain as unknown as { _tables: Map<string, ReturnType<typeof table<unknown>>> })._tables
    return (tables.get(name) ?? tables.set(name, table()).get(name)!) as never
  },
  _tables: new Map<string, ReturnType<typeof table<unknown>>>(),
} as unknown as AuthDomain

const seedSchool = (school: School): void => {
  void fakeDomain.table('schools').put(school.id, school)
}

const seedUser = (user: UserRecord): void => {
  void fakeDomain.table('users').put(userKey(user.schoolId, user.username), user)
}

const makeUser = (
  schoolId: string, username: string, role: UserRecord['role'], password = 'bootstrap-pass',
): UserRecord => {
  const now = new Date().toISOString()
  return {
    id: `u_${schoolId}_${username}`,
    schoolId,
    username,
    passwordHash: hashPassword(password),
    displayName: `${schoolId}-${username}`,
    role,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

let server: Server
let auth: string
let admin: string

beforeAll(async () => {
  const now = new Date().toISOString()
  seedSchool({ id: 'PHYSICSOS-OPEN', name: 'PhysicsOS 开放学校', status: 'active', createdAt: now, updatedAt: now })
  seedSchool({ id: 'GZU', name: '贵州大学', status: 'active', createdAt: now, updatedAt: now })
  seedSchool({ id: 'GZNU', name: '贵州师范大学', status: 'active', createdAt: now, updatedAt: now })
  seedUser(makeUser('PHYSICSOS-OPEN', 'admin', 'SUPER_ADMIN'))
  seedUser(makeUser('GZU', 'admin', 'SCHOOL_ADMIN'))
  seedUser(makeUser('GZU', 'teacher1', 'TEACHER'))
  seedUser(makeUser('GZU', 'student1', 'STUDENT'))
  seedUser(makeUser('GZNU', 'student2', 'STUDENT'))

  const service = new AuthService(fakeDomain, {
    sessionTtlMs: 60_000,
    rememberTtlMs: 30 * 24 * 60 * 60 * 1000,
    accountAttemptLimit: 5,
    ipAttemptLimit: 100,
    applyAttemptLimit: 8,
    attemptWindowMs: 60_000,
  })
  const authHandler = authRoutes(service)
  const adminHandler = adminRoutes(service)
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'
    if (url.startsWith('/physicsos/admin')) void adminHandler(req, res)
    else void authHandler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  auth = `${base}/physicsos/auth`
  admin = `${base}/physicsos/admin`
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const get = (base: string, path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers })

const cookieOf = (res: Response): string => {
  const setCookie = res.headers.get('set-cookie') ?? ''
  return /physicsos_session=([^;]*)/.exec(setCookie)?.[1] ?? ''
}

const login = async (schoolId: string, username: string, password = 'bootstrap-pass'): Promise<string> => {
  const res = await post(auth, '/login', { schoolId, username, password })
  expect(res.status).toBe(200)
  return cookieOf(res)
}

const asSuper = (path: string, body?: unknown) =>
  login('PHYSICSOS-OPEN', 'admin').then(cookie => body === undefined
    ? get(admin, path, { cookie: `physicsos_session=${cookie}` })
    : post(admin, path, body, { cookie: `physicsos_session=${cookie}` }))

describe('school application intake', () => {
  it('accepts an anonymous application', async () => {
    const res = await post(auth, '/school-requests', { schoolName: '贵阳一中', contact: '教务处 0851-1234567' })
    expect(res.status).toBe(201)
    const { request } = await res.json() as { request: SchoolRequestRecord }
    expect(request.status).toBe('pending')
    expect(request.requestedBy).toBeNull()
  })

  it('dedupes a repeated pending application for the same school name', async () => {
    const first = await post(auth, '/school-requests', { schoolName: '遵义四中', contact: 'a@example.com' })
    const second = await post(auth, '/school-requests', { schoolName: '遵义四中', contact: 'b@example.com' })
    const a = await first.json() as { request: SchoolRequestRecord }
    const b = await second.json() as { request: SchoolRequestRecord }
    expect(b.request.id).toBe(a.request.id)
  })

  it('attributes the request to a signed-in applicant', async () => {
    const cookie = await login('GZU', 'student1')
    const res = await post(auth, '/school-requests', { schoolName: '贵阳实验三中', contact: 'c@example.com' }, {
      cookie: `physicsos_session=${cookie}`,
    })
    const { request } = await res.json() as { request: SchoolRequestRecord }
    expect(request.requestedBy).toBe('GZU:student1')
  })

  it('rejects malformed input', async () => {
    const res = await post(auth, '/school-requests', { schoolName: 'x', contact: '' })
    expect(res.status).toBe(400)
  })
})

describe('admin role matrix', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await get(admin, '/schools')).status).toBe(401)
  })

  it('denies STUDENT and TEACHER', async () => {
    const student = await login('GZU', 'student1')
    const teacher = await login('GZU', 'teacher1')
    for (const cookie of [student, teacher]) {
      expect((await get(admin, '/schools', { cookie: `physicsos_session=${cookie}` })).status).toBe(403)
      expect((await get(admin, '/users', { cookie: `physicsos_session=${cookie}` })).status).toBe(403)
      expect((await get(admin, '/audit', { cookie: `physicsos_session=${cookie}` })).status).toBe(403)
    }
  })

  it('denies SCHOOL_ADMIN the super-only surfaces', async () => {
    const cookie = await login('GZU', 'admin')
    const headers = { cookie: `physicsos_session=${cookie}` }
    expect((await get(admin, '/school-requests', headers)).status).toBe(403)
    expect((await post(admin, '/schools', { id: 'X1', name: '某校' }, headers)).status).toBe(403)
    expect((await post(admin, '/schools/GZNU/status', { status: 'disabled' }, headers)).status).toBe(403)
  })

  it('lets SCHOOL_ADMIN read only its own tenant rows', async () => {
    const cookie = await login('GZU', 'admin')
    const headers = { cookie: `physicsos_session=${cookie}` }
    const schoolsRes = await get(admin, '/schools', headers)
    const { schools } = await schoolsRes.json() as { schools: School[] }
    expect(schools.map(s => s.id)).toEqual(['GZU'])

    /* Even naming another tenant on a read narrows back to the actor's own. */
    const usersRes = await get(admin, '/users?schoolId=GZNU', headers)
    const { users } = await usersRes.json() as { users: { schoolId: string }[] }
    expect(users.every(u => u.schoolId === 'GZU')).toBe(true)
  })

  it('lets SUPER_ADMIN see across tenants', async () => {
    const res = await asSuper('/schools')
    const { schools } = await res.json() as { schools: School[] }
    expect(schools.some(s => s.id === 'GZU')).toBe(true)
    expect(schools.some(s => s.id === 'GZNU')).toBe(true)
  })
})

describe('application approval flow', () => {
  it('approves: creates the school, seeds its admin, audits, refuses replay', async () => {
    const applyRes = await post(auth, '/school-requests', { schoolName: '凯里一中', contact: 'd@example.com' })
    const { request } = await applyRes.json() as { request: SchoolRequestRecord }

    const approve = await asSuper(`/school-requests/${request.id}/approve`, {
      schoolId: 'KLYZ',
      shortName: '凯里一中',
      adminUsername: 'klyz-admin',
      adminDisplayName: '凯里管理员',
      adminPassword: 'school-pass-1',
    })
    expect(approve.status).toBe(200)
    const { school, admin: seeded } = await approve.json() as {
      school: School
      admin: { role: string; schoolId: string; username: string }
    }
    expect(school.id).toBe('KLYZ')
    expect(school.name).toBe('凯里一中')
    expect(seeded.role).toBe('SCHOOL_ADMIN')
    expect(seeded.schoolId).toBe('KLYZ')
    expect('passwordHash' in seeded).toBe(false)

    /* The seeded admin can actually sign in and reach the admin surface. */
    const cookie = await login('KLYZ', 'klyz-admin', 'school-pass-1')
    expect((await get(admin, '/users', { cookie: `physicsos_session=${cookie}` })).status).toBe(200)

    /* Replay is refused — a decided request is not a repeatable verb. */
    const replay = await asSuper(`/school-requests/${request.id}/approve`, {
      schoolId: 'KLYZ2', adminUsername: 'x', adminDisplayName: 'x', adminPassword: 'school-pass-2',
    })
    expect(replay.status).toBe(400)

    const auditRes = await asSuper('/audit?schoolId=KLYZ')
    const { events } = await auditRes.json() as { events: { action: string; actorKey: string }[] }
    expect(events.some(e => e.action === 'school_request.approve'
      && e.actorKey === 'PHYSICSOS-OPEN:admin')).toBe(true)
  })

  it('rejects an application with a reason on the audit row', async () => {
    const applyRes = await post(auth, '/school-requests', { schoolName: '安顺二中', contact: 'e@example.com' })
    const { request } = await applyRes.json() as { request: SchoolRequestRecord }
    const reject = await asSuper(`/school-requests/${request.id}/reject`, { reason: '资料不全' })
    expect(reject.status).toBe(200)
    const { request: rejected } = await reject.json() as { request: SchoolRequestRecord }
    expect(rejected.status).toBe('rejected')
  })
})

describe('user administration', () => {
  it('school admin provisions a teacher inside its own tenant', async () => {
    const cookie = await login('GZU', 'admin')
    const res = await post(admin, '/users', {
      schoolId: 'GZU', username: 'teacher2', displayName: '王老师',
      password: 'teacher-pass', role: 'TEACHER',
    }, { cookie: `physicsos_session=${cookie}` })
    expect(res.status).toBe(201)
    const { user } = await res.json() as { user: { role: string; schoolId: string } }
    expect(user.role).toBe('TEACHER')
    expect(user.schoolId).toBe('GZU')
  })

  it('school admin may omit schoolId — the account lands in its own tenant', async () => {
    const cookie = await login('GZU', 'admin')
    const res = await post(admin, '/users', {
      username: 'teacher3', displayName: '李老师',
      password: 'teacher-pass', role: 'TEACHER',
    }, { cookie: `physicsos_session=${cookie}` })
    expect(res.status).toBe(201)
    const { user } = await res.json() as { user: { schoolId: string } }
    expect(user.schoolId).toBe('GZU')
  })

  it('super admin must name the tenant — omitting schoolId is a 400', async () => {
    const res = await asSuper('/users', {
      username: 'orphan', displayName: 'x', password: 'orphan-pass-1', role: 'STUDENT',
    })
    expect(res.status).toBe(400)
  })

  it('school admin cannot mint SCHOOL_ADMIN or name another tenant', async () => {
    const cookie = await login('GZU', 'admin')
    const headers = { cookie: `physicsos_session=${cookie}` }
    const elevate = await post(admin, '/users', {
      schoolId: 'GZU', username: 'admin2', displayName: 'x', password: 'admin-pass-1', role: 'SCHOOL_ADMIN',
    }, headers)
    expect(elevate.status).toBe(403)

    const foreign = await post(admin, '/users', {
      schoolId: 'GZNU', username: 'spy', displayName: 'x', password: 'spy-pass-01', role: 'STUDENT',
    }, headers)
    expect(foreign.status).toBe(403)
  })

  it('the wire can never mint SUPER_ADMIN — it is not even a wire value', async () => {
    const res = await asSuper('/users', {
      schoolId: 'GZU', username: 'super2', displayName: 'x', password: 'super-pass-1', role: 'SUPER_ADMIN',
    })
    expect(res.status).toBe(400)
  })

  it('super admin provisions a SCHOOL_ADMIN under any tenant', async () => {
    const res = await asSuper('/users', {
      schoolId: 'GZNU', username: 'admin', displayName: '师大管理员',
      password: 'gznu-admin-pw', role: 'SCHOOL_ADMIN',
    })
    expect(res.status).toBe(201)
  })

  it('disabling a user revokes its sessions immediately', async () => {
    const cookie = await login('GZU', 'student1')
    const me = await get(auth, '/me', { cookie: `physicsos_session=${cookie}` })
    expect(me.status).toBe(200)

    const adminCookie = await login('GZU', 'admin')
    const res = await post(admin, '/users/GZU:student1/status', { status: 'disabled' }, {
      cookie: `physicsos_session=${adminCookie}`,
    })
    expect(res.status).toBe(200)

    const after = await get(auth, '/me', { cookie: `physicsos_session=${cookie}` })
    expect(after.status).toBe(401)
  })

  it('school admin cannot disable itself or a super admin', async () => {
    const cookie = await login('GZU', 'admin')
    const headers = { cookie: `physicsos_session=${cookie}` }
    expect((await post(admin, '/users/GZU:admin/status', { status: 'disabled' }, headers)).status).toBe(400)
    expect((await post(admin, '/users/PHYSICSOS-OPEN:admin/status', { status: 'disabled' }, headers)).status).toBe(403)
  })

  it('reset-password kills live sessions and admits the new password', async () => {
    const cookie = await login('GZNU', 'student2')
    const superRes = await asSuper('/users/GZNU:student2/reset-password', { newPassword: 'rotated-pass-1' })
    expect(superRes.status).toBe(200)

    expect((await get(auth, '/me', { cookie: `physicsos_session=${cookie}` })).status).toBe(401)
    const oldLogin = await post(auth, '/login', { schoolId: 'GZNU', username: 'student2', password: 'bootstrap-pass' })
    expect(oldLogin.status).toBe(401)
    const newLogin = await post(auth, '/login', { schoolId: 'GZNU', username: 'student2', password: 'rotated-pass-1' })
    expect(newLogin.status).toBe(200)
  })

  it('revoke-sessions ends the session but the account can re-login', async () => {
    const cookie = await login('GZNU', 'student2', 'rotated-pass-1')
    const res = await asSuper('/users/GZNU:student2/revoke-sessions', {})
    expect(res.status).toBe(200)
    expect((await get(auth, '/me', { cookie: `physicsos_session=${cookie}` })).status).toBe(401)
    expect((await post(auth, '/login', {
      schoolId: 'GZNU', username: 'student2', password: 'rotated-pass-1',
    })).status).toBe(200)
  })
})

describe('school lifecycle + audit', () => {
  it('disabling a school fails its members’ sessions closed', async () => {
    const cookie = await login('KLYZ', 'klyz-admin', 'school-pass-1')
    const res = await asSuper('/schools/KLYZ/status', { status: 'disabled' })
    expect(res.status).toBe(200)
    expect((await get(auth, '/me', { cookie: `physicsos_session=${cookie}` })).status).toBe(401)
    /* Re-enable so later reads stay honest. */
    expect((await asSuper('/schools/KLYZ/status', { status: 'active' })).status).toBe(200)
  })

  it('audit rows are append-only, actor-scoped, and carry no secrets', async () => {
    const res = await asSuper('/audit')
    const { events } = await res.json() as {
      events: { action: string; actorKey: string; detail?: Record<string, unknown> }[]
    }
    expect(events.length).toBeGreaterThan(0)
    expect(events.every(e => typeof e.actorKey === 'string' && e.actorKey.includes(':'))).toBe(true)
    const blob = JSON.stringify(events)
    expect(blob).not.toContain('school-pass-1')
    expect(blob).not.toContain('rotated-pass-1')
    expect(blob).not.toContain('passwordHash')
  })

  it('school admin reads only its own tenant’s audit rows', async () => {
    const cookie = await login('GZU', 'admin')
    const res = await get(admin, '/audit?schoolId=GZNU', { cookie: `physicsos_session=${cookie}` })
    const { events } = await res.json() as { events: { schoolId: string }[] }
    expect(events.every(e => e.schoolId === 'GZU')).toBe(true)
  })
})

/* Runs last: the anonymous form has a dedicated apply bucket (applyAttemptLimit
   8, minus the earlier submissions); pushing past it must not starve logins,
   so this is the suite's only consumer of the whole allowance. */
describe('anonymous form rate limit', () => {
  it('rate-limits the apply bucket independently of the login bucket', async () => {
    let last = 0
    for (let i = 0; i < 10; i++) {
      last = (await post(auth, '/school-requests', { schoolName: `刷量学校${i}`, contact: 'x@x.com' })).status
    }
    expect(last).toBe(429)
    /* The login bucket is untouched — a legit sign-in still succeeds. */
    expect((await post(auth, '/login', {
      schoolId: 'GZU', username: 'teacher1', password: 'bootstrap-pass',
    })).status).toBe(200)
  })
})
