/**
 * The 数据看板 payload: what the server knows, and what it refuses to claim.
 *
 * Two of these cases exist because the obvious implementation is wrong:
 *
 *   - "live sessions" must mean RESOLVABLE sessions. Counting rows would
 *     report logins whose next request answers 401 (revoked, expired, or the
 *     account has since been disabled) — and the operator reading the number
 *     would have no way to tell.
 *   - the counts are tenant-scoped for a school admin, like every other admin
 *     read. Platform-wide totals shown to a tenant would be a leak.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthService } from '../src/service.ts'
import { adminRoutes, authRoutes } from '../src/routes.ts'
import { hashPassword } from '../src/passwords.ts'
import { userKey } from '../src/domain.ts'
import type { AuthDomain, School, UserRecord } from '../src/domain.ts'

const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => { map.set(id, record) },
    entries: () => map.entries(),
    delete: async (id: string) => map.delete(id),
  }
}

/* One table per domain name, closed over — no self-referential field, so every
   read is typed instead of forced through an `as`. */
const makeDomain = (): AuthDomain => {
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

const domain = makeDomain()

const putSchool = async (id: string, name: string): Promise<void> => {
  const now = new Date().toISOString()
  const school: School = { id, name, status: 'active', createdAt: now, updatedAt: now }
  await domain.table('schools').put(id, school)
}

const putUser = async (
  schoolId: string, username: string, role: UserRecord['role'],
  over: Partial<UserRecord> = {},
): Promise<void> => {
  const now = new Date().toISOString()
  const user: UserRecord = {
    id: `u_${schoolId}_${username}`,
    schoolId,
    username,
    passwordHash: hashPassword('bootstrap-pass'),
    displayName: `${schoolId}-${username}`,
    role,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...over,
  }
  await domain.table('users').put(userKey(schoolId, username), user)
}

let server: Server
let base: string

beforeAll(async () => {
  await putSchool('PHYSICSOS-OPEN', 'PhysicsOS 开放学校')
  await putSchool('GZU', '贵州大学')
  await putSchool('GZNU', '贵州师范大学')

  await putUser('PHYSICSOS-OPEN', 'admin', 'SUPER_ADMIN')
  await putUser('GZU', 'gzadmin', 'SCHOOL_ADMIN')
  await putUser('GZU', 'teacher1', 'TEACHER')
  await putUser('GZU', 'student1', 'STUDENT')
  await putUser('GZU', 'student2', 'STUDENT', { status: 'disabled' })
  await putUser('GZNU', 'student3', 'STUDENT')

  const service = new AuthService(domain, {
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
    if ((req.url ?? '').startsWith('/physicsos/admin')) void adminHandler(req, res)
    else void authHandler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

const login = async (username: string): Promise<string> => {
  const res = await fetch(`${base}/physicsos/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'bootstrap-pass' }),
  })
  expect(res.status).toBe(200)
  return (/physicsos_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '') ?? [])[1] ?? ''
}

type Dashboard = {
  schools: { total: number; active: number; disabled: number }
  users: { total: number; byRole: Record<string, number>; disabled: number }
  sessions: { live: number; distinctUsers: number }
  activity: { date: string; logins: number; created: number }[]
}

const dashboard = async (cookie: string): Promise<Dashboard> =>
  await (await fetch(`${base}/physicsos/admin/dashboard`, {
    headers: { cookie: `physicsos_session=${cookie}` },
  })).json() as Dashboard

describe('数据看板', () => {
  it('answers only for an admin', async () => {
    expect((await fetch(`${base}/physicsos/admin/dashboard`)).status).toBe(401)

    const student = await login('student1')
    const refused = await fetch(`${base}/physicsos/admin/dashboard`, {
      headers: { cookie: `physicsos_session=${student}` },
    })
    expect(refused.status).toBe(403)
  })

  it('counts the platform for a super admin', async () => {
    const body = await dashboard(await login('admin'))
    expect(body.schools).toEqual({ total: 3, active: 3, disabled: 0 })
    /* 6 accounts: the super admin, GZU's admin/teacher/two students, GZNU's. */
    expect(body.users.total).toBe(6)
    expect(body.users.byRole.STUDENT).toBe(3)
    expect(body.users.byRole.TEACHER).toBe(1)
    expect(body.users.disabled).toBe(1)
    expect(body.activity).toHaveLength(14)
  })

  it('narrows to the tenant for a school admin', async () => {
    /* GZU holds 4 of the 6 accounts and 1 of the 3 schools. A school admin
       seeing the platform's totals would be a tenant leak. */
    const body = await dashboard(await login('gzadmin'))
    expect(body.schools.total).toBe(1)
    expect(body.users.total).toBe(4)
    expect(body.users.disabled).toBe(1)
    expect(body.users.byRole.STUDENT).toBe(2)
  })

  it('counts only RESOLVABLE sessions as live', async () => {
    /* The subject is an account that has signed in EXACTLY ONCE in this file,
       so the arithmetic is about revocation and not about how many sessions
       earlier cases happened to leave behind: `revoke-sessions` kills every
       session the account holds, not just the last one. */
    const kept = await login('teacher1')
    const revoked = await login('student3')
    const adminCookie = await login('admin')

    const before = await dashboard(adminCookie)
    expect(before.sessions.live).toBeGreaterThanOrEqual(3)

    const revoke = await fetch(
      `${base}/physicsos/admin/users/${encodeURIComponent('GZNU:student3')}/revoke-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `physicsos_session=${adminCookie}` },
        body: '{}',
      })
    expect(revoke.status).toBe(200)

    const after = await dashboard(adminCookie)
    expect(after.sessions.live).toBe(before.sessions.live - 1)

    /* The two views agree: the dropped session really answers 401... */
    expect((await fetch(`${base}/physicsos/auth/me`, {
      headers: { cookie: `physicsos_session=${revoked}` },
    })).status).toBe(401)

    /* ...and the untouched one still resolves, so the drop was the revocation
       rather than a blanket refusal. */
    expect((await fetch(`${base}/physicsos/auth/me`, {
      headers: { cookie: `physicsos_session=${kept}` },
    })).status).toBe(200)
  })
})
