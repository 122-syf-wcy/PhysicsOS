/**
 * Route + service spec for the PhysicsOS 账户体系: school-scoped registration
 * with a free-text schoolName, tenant-resolved login (same username across
 * schools is legal and only surfaces through SCHOOL_REQUIRED), cookie
 * sessions, uniform credential errors, attempt buckets, the CSRF gate, and
 * session revocation. Runs a real http server over a Map-backed domain stub.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthService, DEFAULT_AUTH_CONFIG } from '../src/service.ts'
import { authRoutes } from '../src/routes.ts'
import {
  ARGON2_AVAILABLE,
  ARGON2_UNAVAILABLE_REASON,
  hashPassword,
  verifyPassword,
} from '../src/passwords.ts'
import type { AuthDomain, School } from '../src/domain.ts'

/* Map-backed stand-in for Domain<typeof authDomain> — the service only uses
   table().get/put/entries/delete, so plain Maps satisfy it. */
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

let server: Server
let base: string

beforeAll(async () => {
  const now = new Date().toISOString()
  seedSchool({ id: 'GZU', name: '贵州大学', city: '贵阳市', county: '花溪区', status: 'active', createdAt: now, updatedAt: now })
  seedSchool({ id: 'GZNU', name: '贵州师范大学', city: '贵阳市', status: 'active', createdAt: now, updatedAt: now })
  seedSchool({ id: 'CLOSED', name: '已关闭学校', status: 'disabled', createdAt: now, updatedAt: now })

  const service = new AuthService(fakeDomain, {
    sessionTtlMs: 60_000,
    rememberTtlMs: 30 * 24 * 60 * 60 * 1000,
    accountAttemptLimit: 5,
    ipAttemptLimit: 50,
    applyAttemptLimit: 50,
    attemptWindowMs: 60_000,
  })
  server = createServer((req, res) => { void authRoutes(service)(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/physicsos/auth`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const cookieOf = (res: Response): string => {
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = /physicsos_session=([^;]*)/.exec(setCookie)
  return match?.[1] ?? ''
}

describe('auth routes — register/login lifecycle', () => {
  const account = { schoolName: '贵州大学', username: '2023123456', displayName: '李明', password: 'hunter2pass' }

  it('registers with a free-text schoolName, issues a session cookie, and /me resolves it', async () => {
    const res = await post('/register', account)
    expect(res.status).toBe(201)
    const cookie = cookieOf(res)
    expect(cookie.length).toBeGreaterThan(0)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    const me = await fetch(`${base}/me`, { headers: { cookie: `physicsos_session=${cookie}` } })
    expect(me.status).toBe(200)
    const { user } = await me.json() as { user: { username: string; schoolName: string; role: string } }
    expect(user.username).toBe('2023123456')
    expect(user.schoolName).toBe('贵州大学')
    expect(user.role).toBe('STUDENT')
    expect('passwordHash' in user).toBe(false)
  })

  it('rejects a duplicate (school, username) with 409', async () => {
    const res = await post('/register', { ...account, schoolId: 'GZU' })
    expect(res.status).toBe(409)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('USERNAME_TAKEN')
  })

  it('allows the same username under a different school tenant', async () => {
    const res = await post('/register', {
      schoolName: '贵州师范大学', username: account.username, displayName: '李明', password: 'other-pass99',
    })
    expect(res.status).toBe(201)
  })

  it('ignores a client-supplied role — the wire cannot self-assign TEACHER', async () => {
    const res = await post('/register', {
      schoolName: '贵州师范大学', username: 'evil001', displayName: 'x', password: 'hunter2pass', role: 'TEACHER',
    })
    expect(res.status).toBe(201)
    const { user } = await res.json() as { user: { role: string } }
    expect(user.role).toBe('STUDENT')
  })

  it('answers SCHOOL_NOT_FOUND for an unlisted schoolName — the tenant list is fixed', async () => {
    const res = await post('/register', { ...account, schoolName: '不存在的学校', username: 'nobody01' })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('SCHOOL_NOT_FOUND')
  })

  it('answers SCHOOL_NOT_FOUND when the name only matches a disabled school', async () => {
    const res = await post('/register', { ...account, schoolName: '已关闭学校', username: 'nobody02' })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('SCHOOL_NOT_FOUND')
  })

  it('answers an ambiguous schoolName with region-labeled candidates', async () => {
    const res = await post('/register', { ...account, schoolName: '贵州', username: 'nobody03' })
    expect(res.status).toBe(409)
    const body = await res.json() as {
      error: { code: string; candidates: { id: string; city?: string; county?: string }[] }
    }
    expect(body.error.code).toBe('SCHOOL_AMBIGUOUS')
    expect(body.error.candidates.map(c => c.id).sort()).toEqual(['GZNU', 'GZU'])
    /* Region labels ride the wire so the picker can tell same-name schools apart. */
    expect(body.error.candidates.find(c => c.id === 'GZU')).toMatchObject({ city: '贵阳市', county: '花溪区' })
    expect(body.error.candidates.find(c => c.id === 'GZNU')).toMatchObject({ city: '贵阳市' })
  })

  it('resolves a unique substring schoolName', async () => {
    const res = await post('/register', {
      schoolName: '贵州师范', username: 'sub001', displayName: 'x', password: 'hunter2pass',
    })
    expect(res.status).toBe(201)
    const { user } = await res.json() as { user: { schoolId: string } }
    expect(user.schoolId).toBe('GZNU')
  })

  it('rejects a missing school entirely', async () => {
    const res = await post('/register', { username: 'noschool', displayName: 'x', password: 'hunter2pass' })
    expect(res.status).toBe(400)
  })

  it('rejects a weak password at the wire boundary', async () => {
    const res = await post('/register', { schoolName: '贵州大学', username: 'weak1', displayName: 'x', password: 'short' })
    expect(res.status).toBe(400)
  })

  it('rejects a wrong password with the uniform INVALID_CREDENTIALS', async () => {
    const res = await post('/login', { username: account.username, password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a nonexistent account with the same INVALID_CREDENTIALS', async () => {
    const res = await post('/login', { username: 'ghost000', password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS')
  })

  it('logs in with account + password only — no school on the wire', async () => {
    const res = await post('/login', { username: account.username, password: account.password, rememberDevice: true })
    expect(res.status).toBe(200)
    const { user } = await res.json() as { user: { schoolId: string } }
    expect(user.schoolId).toBe('GZU')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/Max-Age=\d{7,}/)
  })

  it('logs in without rememberDevice and emits a browser-session cookie', async () => {
    const res = await post('/login', { username: account.username, password: account.password })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).not.toContain('Max-Age')
  })

  it('does not trust a spoofed forwarded proto when setting Secure', async () => {
    const res = await post('/login', {
      username: account.username, password: account.password,
    }, { 'x-forwarded-proto': 'https' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).not.toContain('Secure')
  })

  it('honors forwarded HTTPS only from an explicitly trusted proxy', async () => {
    const service = new AuthService(fakeDomain, {
      ...DEFAULT_AUTH_CONFIG,
      trustedProxies: ['127.0.0.1'],
    })
    const handler = authRoutes(service)
    const trustedServer = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => trustedServer.listen(0, '127.0.0.1', resolve))
    const origin = `https://127.0.0.1:${(trustedServer.address() as AddressInfo).port}`
    try {
      const res = await fetch(`${origin.replace(/^https:/, 'http:')}/physicsos/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', origin },
        body: JSON.stringify({ username: account.username, password: account.password }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toContain('Secure')
    } finally {
      await new Promise<void>(resolve => trustedServer.close(() => { resolve() }))
    }
  })

  it('logout rejects cross-origin requests and revokes the session on same-origin POST', async () => {
    const login = await post('/login', { username: account.username, password: account.password })
    const cookie = cookieOf(login)
    const headers = { cookie: `physicsos_session=${cookie}` }
    const crossSite = await post('/logout', {}, { ...headers, origin: 'https://evil.example' })
    expect(crossSite.status).toBe(403)
    expect((await fetch(`${base}/me`, { headers })).status).toBe(200)

    const out = await post('/logout', {}, headers)
    expect(out.status).toBe(200)
    expect((await fetch(`${base}/me`, { headers })).status).toBe(401)
  })
})

describe('auth routes — tenant disambiguation', () => {
  /* `shared01` holds the SAME password in two schools — the only shape that
     forces SCHOOL_REQUIRED; a differing password resolves silently. */
  beforeAll(async () => {
    for (const schoolName of ['贵州大学', '贵州师范大学']) {
      const res = await post('/register', {
        schoolName, username: 'shared01', displayName: '同名', password: 'sharedpass1',
      })
      expect(res.status).toBe(201)
    }
  })

  it('same username + same password across schools answers SCHOOL_REQUIRED with candidates', async () => {
    const res = await post('/login', { username: 'shared01', password: 'sharedpass1' })
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string; candidates: { id: string; name: string }[] } }
    expect(body.error.code).toBe('SCHOOL_REQUIRED')
    expect(body.error.candidates.map(c => c.id).sort()).toEqual(['GZNU', 'GZU'])
  })

  it('retrying with the candidate schoolId lands the right tenant', async () => {
    const res = await post('/login', { username: 'shared01', password: 'sharedpass1', schoolId: 'GZNU' })
    expect(res.status).toBe(200)
    const { user } = await res.json() as { user: { schoolId: string } }
    expect(user.schoolId).toBe('GZNU')
  })

  it('same username + different passwords resolves to the matching school silently', async () => {
    const res = await post('/login', { username: '2023123456', password: 'other-pass99' })
    expect(res.status).toBe(200)
    const { user } = await res.json() as { user: { schoolId: string } }
    expect(user.schoolId).toBe('GZNU')
  })
})

describe('auth routes — guards', () => {
  it('POST without application/json content-type is refused', async () => {
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=x&password=y',
    })
    expect(res.status).toBe(400)
  })

  it('a cross-site Origin is refused on state-changing verbs', async () => {
    const res = await post('/login', { username: 'x', password: 'y' }, {
      origin: 'https://evil.example',
    })
    expect(res.status).toBe(403)
  })

  it('does not accept a scheme mismatch based on an untrusted forwarded header', async () => {
    const origin = new URL(base).origin.replace(/^http:/, 'https:')
    const res = await post('/login', { username: 'x', password: 'y' }, {
      origin, 'x-forwarded-proto': 'https',
    })
    expect(res.status).toBe(403)
  })

  it('/me without a cookie answers 401 UNAUTHENTICATED', async () => {
    const res = await fetch(`${base}/me`)
    expect(res.status).toBe(401)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED')
  })

  it('account attempt bucket locks out after the configured limit', async () => {
    const attempt = () => post('/login', { username: 'ratelimit-me', password: 'bad-password' })
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(429)
  })

  it('password/forgot answers a uniform receipt regardless of account existence', async () => {
    const exists = await post('/password/forgot', { username: '2023123456' })
    const ghost = await post('/password/forgot', { username: 'ghost-xyz' })
    expect(exists.status).toBe(200)
    expect(ghost.status).toBe(200)
    expect(await exists.json()).toEqual(await ghost.json())
  })
})

describe('auth service abuse budgets', () => {
  it('rate-limits open registration per resolved source IP', async () => {
    const service = new AuthService(fakeDomain, {
      ...DEFAULT_AUTH_CONFIG,
      registrationAttemptLimit: 2,
      attemptWindowMs: 60_000,
    })
    const sourceIp = '192.0.2.25'
    for (const username of ['reglimit-a', 'reglimit-b']) {
      await expect(service.register({
        schoolName: '贵州大学', username, displayName: '注册测试', password: 'strong-pass-123',
      }, sourceIp)).resolves.toMatchObject({ user: { role: 'STUDENT' } })
    }
    await expect(service.register({
      schoolName: '贵州大学', username: 'reglimit-c', displayName: '注册测试', password: 'strong-pass-123',
    }, sourceIp)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
  })

  it('rate-limits learning reports per account without storing the account in aggregates', async () => {
    const service = new AuthService(fakeDomain, {
      ...DEFAULT_AUTH_CONFIG,
      learningAttemptLimit: 2,
      attemptWindowMs: 60_000,
    })
    const actor = {
      userKey: 'GZU:learning-limit', schoolId: 'GZU', username: 'learning-limit', role: 'STUDENT' as const,
    }
    await service.reportLearning(actor, { knowledgeId: 'opt-lens-imaging', correct: true })
    await service.reportLearning(actor, { knowledgeId: 'opt-lens-imaging', correct: false })
    await expect(service.reportLearning(actor, { knowledgeId: 'opt-lens-imaging', correct: true }))
      .rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
    const rows = [...fakeDomain.table('learning_counts').entries()]
    expect(rows.every(([, row]) => !('userKey' in row))).toBe(true)
  })

  it('bounds bucket cardinality and reclaims expired windows', async () => {
    const service = new AuthService(fakeDomain, {
      ...DEFAULT_AUTH_CONFIG,
      accountAttemptLimit: 100,
      ipAttemptLimit: 100,
      attemptBucketLimit: 2,
      attemptWindowMs: 1_000,
    })
    for (const username of ['bucket-a', 'bucket-b']) {
      await expect(service.login({ username, password: 'wrong-password' }, '192.0.2.8'))
        .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
    }
    await expect(service.login({ username: 'bucket-c', password: 'wrong-password' }, '192.0.2.8'))
      .rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
    await new Promise(resolve => setTimeout(resolve, 1_050))
    await expect(service.login({ username: 'bucket-d', password: 'wrong-password' }, '192.0.2.8'))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
  })
})

/* Regression guard for a false-positive capability gate: `typeof
   crypto.argon2Sync === 'function'` is true on builds whose OpenSSL lacks
   argon2id, so the plugin used to activate and then die with a cryptic
   ERR_CRYPTO_ARGON2_NOT_SUPPORTED stack from inside bootstrap seeding. The
   invariant is one-directional and therefore holds on every machine: claiming
   availability must imply hashing actually works. */
describe('argon2 capability gate', () => {
  it('never reports available when hashing would fail', () => {
    if (!ARGON2_AVAILABLE) {
      // Environment genuinely cannot argon2id — the reason must say why.
      expect(ARGON2_UNAVAILABLE_REASON).toBeTypeOf('string')
      expect(ARGON2_UNAVAILABLE_REASON).not.toBe('')
      return
    }
    expect(ARGON2_UNAVAILABLE_REASON).toBeUndefined()
    const stored = hashPassword('gate-probe-password')
    expect(stored.startsWith('argon2id$v=19$')).toBe(true)
    expect(verifyPassword('gate-probe-password', stored)).toBe(true)
    expect(verifyPassword('wrong-password', stored)).toBe(false)
  })
})
