import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import type { AuthDomain, UserRecord } from '../src/domain.ts'
import { AuthService, DEFAULT_AUTH_CONFIG, type AuthServiceDeps } from '../src/service.ts'
import { createMobileAuthHost } from '../src/mobile-service.ts'
import { createIdentityService } from '../src/identity.ts'
import { createAccountErasureAuth, type AccountErasure, type AccountErasureRequest } from '../src/account-erasure.ts'
import { createApiPolicy, type ApiPolicyActor } from '../src/api-policy.ts'
import { ModerationService } from '../src/moderation/service.ts'
import { AccountRuns, ModerationRuntime } from '../src/moderation/runtime.ts'
import { totpCode, generateTotpSecret } from '../src/totp.ts'

// Only host infrastructure is replaced. Auth, wire schemas, hashing, grants,
// policy, erasure and moderation code below execute against isolated snapshots.
vi.mock('@deepseek-ai/dsh-storage-domain', () => ({ defineDomain: (value: unknown) => value, domainTable: (value: unknown) => value }))
vi.mock('@physicsos/model-usage-outbox', () => ({ isModelUsageOutboxRecord: () => true }))
vi.mock('@deepseek-ai/dsh-session', () => ({ SessionId: (value: string) => value }))
vi.mock('@deepseek-ai/dsh-llm', () => ({
  BlockAssembler: class {}, ReasoningEffortId: (value: string) => value,
  createUserMessage: () => { throw new Error('No model adapter may run in these tests') },
}))

const PASSWORD = 'Fixture-only-pass-123'
const SCHOOL = 'FIXTURE-SCHOOL'
type Snapshot = [string, [string, unknown][]][]
function storage(snapshot: Snapshot = []) {
  const tables = new Map(snapshot.map(([name, rows]) => [name, new Map(structuredClone(rows))]))
  let fail: ((table: string, operation: string, value: unknown) => boolean) | undefined
  const table = (name: string) => {
    let rows = tables.get(name)
    if (!rows) { rows = new Map(); tables.set(name, rows) }
    const check = (operation: string, value: unknown) => {
      if (fail?.(name, operation, value)) { fail = undefined; throw new Error('fixture storage failure: private evidence must not be logged') }
    }
    return {
      get: (key: string) => rows.get(key), entries: () => rows.entries(),
      put: async (key: string, row: unknown) => { check('put', row); rows.set(key, structuredClone(row)) },
      delete: async (key: string) => { check('delete', key); rows.delete(key) },
      update: async (key: string, update: (value: unknown) => unknown) => { const next = update(structuredClone(rows.get(key))); check('put', next); rows.set(key, structuredClone(next)) },
    }
  }
  return {
    domain: { table } as unknown as AuthDomain,
    snapshot: (): Snapshot => structuredClone([...tables].map(([name, rows]) => [name, [...rows]])),
    failOnce: (predicate: NonNullable<typeof fail>) => { fail = predicate },
  }
}
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function fixture(options: { snapshot?: Snapshot; deps?: AuthServiceDeps; provider?: AccountErasure } = {}) {
  const store = storage(options.snapshot)
  let clock = Date.parse('2026-11-12T00:00:00Z')
  const provider = options.provider ?? { assertAvailable: vi.fn(async () => undefined), eraseAccount: vi.fn(async (_request: AccountErasureRequest) => undefined) }
  const stop = vi.fn(async () => undefined)
  const drain = vi.fn(async () => undefined)
  const eraseModeration = vi.fn(async () => undefined)
  const deps: AuthServiceDeps = { accountErasure: () => provider, onUserDisabled: stop, drainAccountRequests: drain,
    eraseModerationAccount: eraseModeration, now: () => new Date(clock), ...options.deps }
  const service = new AuthService(store.domain, { ...DEFAULT_AUTH_CONFIG, accountAttemptLimit: 100, ipAttemptLimit: 100,
    mobileAccountAttemptLimit: 100, registrationAttemptLimit: 100, accountErasureRetryMs: 25,
    trustedProxies: ['10.0.0.1', '10.0.0.2'] }, deps)
  if (!store.domain.table('schools').get(SCHOOL)) await store.domain.table('schools').put(SCHOOL, {
    id: SCHOOL, name: '贵阳市实验中学', status: 'active', createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString(),
  })
  return { ...store, service, facade: createMobileAuthHost(service), provider, stop, drain, eraseModeration,
    now: () => clock, advance: () => { clock += 100 }, deps }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function register(f: Fixture, username = 'student') {
  const result = await f.service.registerMobile({ schoolId: SCHOOL, username, displayName: 'Fixture student',
    password: PASSWORD, email: `${username}@example.test`, deviceId: 'a'.repeat(32) }, '192.0.2.1')
  if (result.status !== 'authenticated') throw new Error('Fixture registration failed')
  return result
}
const request = (access?: string, extra: Record<string, string> = {}, peer = '192.0.2.1'): IncomingMessage => ({
  headers: { ...(access ? { authorization: `Bearer ${access}` } : {}), ...extra }, socket: { remoteAddress: peer },
} as IncomingMessage)
const proof = { password: PASSWORD, confirmation: 'DELETE' }
const jobs = (f: Fixture) => [...f.domain.table('account_deletions').entries()].map(([, row]) => row)
afterEach(() => vi.useRealTimers())

describe('mobile auth facade', () => {
  it('does not expose erasure finalization or accept cookies, PATs, refreshes or identity overrides', async () => {
    const f = await fixture()
    const login = await register(f)
    expect('completeErasure' in f.facade).toBe(false)
    const web = await f.service.login({ username: 'student', password: PASSWORD, schoolId: SCHOOL })
    if (!('token' in web)) throw new Error('Unexpected challenge')
    const actor = f.facade.resolve(request(login.tokens.accessToken))!.actor
    const pat = await f.service.createApiToken(actor, { name: 'fixture', scope: 'write' })
    for (const req of [request(undefined, { cookie: `physicsos_session=${web.token}` }), request(pat.secret),
      request(login.tokens.refreshToken), request('invalid', { cookie: `physicsos_session=${web.token}` })]) {
      expect(f.facade.resolve(req)).toBeNull()
      await expect(f.facade.deleteAccount(req, proof)).rejects.toMatchObject({ status: 401 })
    }
    await expect(f.facade.deleteAccount(request(login.tokens.accessToken), { ...proof, userId: 'other' })).rejects.toMatchObject({ status: 400 })
    expect(jobs(f)).toEqual([])
  })

  it('keeps server-only exports instance-bound and never expands administrator ownership', async () => {
    const f = await fixture()
    const login = await register(f)
    const other = await register(f, 'another')
    for (const [id, user] of [['own', login.user], ['other', other.user]] as const) {
      await f.domain.table('api_resources').put(`workspace:${id}`, { id: `workspace:${id}`, kind: 'workspace', resourceId: id, ownerKey: user.userKey, schoolId: SCHOOL, createdAt: new Date(f.now()).toISOString() })
    }
    const cap = createAccountErasureAuth(f.service, '/fixture-workspaces')
    const actor = f.facade.resolve(request(login.tokens.accessToken))!.actor
    expect(cap.accountProfile(actor)).toEqual(login.user)
    expect(cap.accountResources(actor)).toEqual([{ kind: 'workspace', resourceId: 'own' }])
    expect(cap.workspaceRoot).toBe('/fixture-workspaces')
    expect(Object.getOwnPropertyDescriptor(cap, 'workspaceRoot')?.set).toBeUndefined()
    expect(() => cap.accountProfile({ ...actor, userId: 'stale-instance' })).toThrow()
    expect(() => cap.accountResources({ ...actor, role: 'SUPER_ADMIN' })).toThrow()
    const record = f.domain.table('users').get(actor.userKey)!
    // Isolated authority fixture only; no administrator is deleted by this test.
    await f.domain.table('users').put(actor.userKey, { ...record, role: 'SUPER_ADMIN' })
    expect(cap.accountResources({ ...actor, role: 'SUPER_ADMIN' })).toEqual([{ kind: 'workspace', resourceId: 'own' }])
  })

  it('publishes immutable Web identity and does not reuse an erased incarnation', async () => {
    const f = await fixture()
    const login = await register(f)
    const web = await f.service.login({ schoolId: SCHOOL, username: 'student', password: PASSWORD })
    if (!('token' in web)) throw new Error('Unexpected fixture challenge')
    const identity = createIdentityService(f.service)
    const old = request(undefined, { cookie: `physicsos_session=${web.token}` })
    expect(identity.actorOf(old)?.userId).toBe(login.user.userId)
    expect((await f.facade.deleteAccount(request(login.tokens.accessToken), proof)).status).toBe('deleted')
    const replacement = await register(f)
    const renewed = await f.service.login({ schoolId: SCHOOL, username: 'student', password: PASSWORD })
    if (!('token' in renewed)) throw new Error('Unexpected fixture challenge')
    expect(identity.actorOf(old)).toBeNull()
    expect(identity.actorOf(request(undefined, { cookie: `physicsos_session=${renewed.token}` }))?.userId).toBe(replacement.user.userId)
    expect(replacement.user.userId).not.toBe(login.user.userId)
  })

  it('uses the configured trusted proxy chain rather than the first forwarded hop', async () => {
    const f = await fixture()
    expect(f.facade.clientAddress(request(undefined, { 'x-forwarded-for': '203.0.113.9' }))).toBe('192.0.2.1')
    expect(f.facade.clientAddress(request(undefined, { 'x-forwarded-for': '198.51.100.99, 203.0.113.7, 10.0.0.1' }, '10.0.0.2'))).toBe('203.0.113.7')
    expect(f.facade.clientAddress(request(undefined, { 'x-forwarded-for': 'not-an-ip' }, '10.0.0.2'))).toBe('10.0.0.2')
  })

  it('returns explicit credential-only reauthentication receipts', async () => {
    const f = await fixture()
    const first = await register(f)
    const other = await f.service.loginMobile({ username: 'student', password: PASSWORD, schoolId: SCHOOL, deviceId: 'b'.repeat(32) })
    if (other.status !== 'authenticated') throw new Error('Fixture login failed')
    const secondId = f.facade.resolve(request(other.tokens.accessToken))!.grantId
    expect(await f.facade.revokeDevice(request(first.tokens.accessToken), secondId)).toEqual({ ok: true, reauthenticate: false })
    expect(await f.facade.changePassword(request(first.tokens.accessToken), { currentPassword: PASSWORD, newPassword: 'Replacement-fixture-pass' })).toEqual({ ok: true, reauthenticate: true })
    expect(f.facade.resolve(request(first.tokens.accessToken))).toBeNull()
    const next = await f.service.loginMobile({ username: 'student', password: 'Replacement-fixture-pass', schoolId: SCHOOL, deviceId: 'c'.repeat(32) })
    if (next.status !== 'authenticated') throw new Error('Fixture password failed')
    expect(await f.facade.revokeDevice(request(next.tokens.accessToken), f.facade.resolve(request(next.tokens.accessToken))!.grantId)).toEqual({ ok: true, reauthenticate: true })
  })

  it('delegates reset requests with uniform receipts and keeps token validation on the auth service', async () => {
    const f = await fixture()
    await register(f)
    expect(await f.facade.requestPasswordReset({ username: 'student', schoolId: SCHOOL }, '192.0.2.1')).toEqual({ ok: true })
    expect(await f.facade.requestPasswordReset({ username: 'absent', schoolId: SCHOOL }, '192.0.2.1')).toEqual({ ok: true })
    await expect(f.facade.submitPasswordReset({ token: 'x'.repeat(43), newPassword: 'Another-fixture-pass' }, '192.0.2.1')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' })
    const admin = { userKey: `${SCHOOL}:fixture-admin`, schoolId: SCHOOL, username: 'fixture-admin', role: 'SCHOOL_ADMIN' as const }
    const queued = f.service.listPasswordResets(admin).requests[0]!
    const issued = await f.service.issuePasswordReset(admin, queued.id)
    const body = { token: issued.token, newPassword: 'Another-fixture-pass' }
    expect(await f.facade.submitPasswordReset(body, '192.0.2.1')).toEqual({ ok: true })
    await expect(f.facade.submitPasswordReset(body, '192.0.2.1')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' })
    await expect(f.service.loginMobile({ username: 'student', schoolId: SCHOOL, password: body.newPassword, deviceId: 'b'.repeat(32) })).resolves.toMatchObject({ status: 'authenticated' })
  })
})

describe('durable account erasure', () => {
  it.each(['missing', 'incomplete', 'rejecting', 'missing-drain'] as const)('refuses %s dependencies without a job or credential mutation', async kind => {
    const f = await fixture({ deps: kind === 'missing' ? { accountErasure: () => undefined }
      : kind === 'incomplete' ? { accountErasure: () => ({ assertAvailable() {} } as AccountErasure) }
        : kind === 'missing-drain' ? {}
          : { accountErasure: () => ({ assertAvailable: async () => { throw new Error('private dependency detail') }, eraseAccount: async () => undefined }) } })
    if (kind === 'missing-drain') delete f.deps.drainAccountRequests
    const login = await register(f)
    const before = f.snapshot()
    await expect(f.facade.deleteAccount(request(login.tokens.accessToken), proof)).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' })
    expect(f.snapshot()).toEqual(before)
    expect(f.facade.resolve(request(login.tokens.accessToken))?.user.userId).toBe(login.user.userId)
  })

  it('checks password, literal confirmation and enabled TOTP before accepting a job', async () => {
    const f = await fixture()
    const login = await register(f)
    await expect(f.facade.deleteAccount(request(login.tokens.accessToken), { ...proof, password: 'wrong-fixture-password' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(f.facade.deleteAccount(request(login.tokens.accessToken), { ...proof, confirmation: 'delete' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const user = f.domain.table('users').get(login.user.userKey)!
    await f.domain.table('users').put(login.user.userKey, { ...user, totp: { secret: generateTotpSecret(), enabledAt: new Date(f.now()).toISOString() } })
    await expect(f.facade.deleteAccount(request(login.tokens.accessToken), proof)).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' })
    expect(jobs(f)).toEqual([])
    expect(f.facade.resolve(request(login.tokens.accessToken))).not.toBeNull()
  })

  it('erases private auth state only after domains succeed and preserves another account', async () => {
    const f = await fixture()
    const login = await register(f)
    const other = await register(f, 'another')
    const owner = login.user.userKey
    const user = f.domain.table('users').get(owner)!
    const secret = generateTotpSecret()
    await f.domain.table('users').put(owner, { ...user, totp: { secret, enabledAt: new Date(f.now()).toISOString() } })
    await f.domain.table('api_resources').put('session:own', { id: 'session:own', kind: 'session', resourceId: 'own', ownerKey: owner, schoolId: SCHOOL, createdAt: new Date(f.now()).toISOString() })
    const cap = createAccountErasureAuth(f.service, '/fixture-workspaces')
    const erase = vi.spyOn(f.provider, 'eraseAccount').mockImplementation(async operation => {
      expect(f.domain.table('users').get(owner)?.passwordHash).toBeTruthy()
      expect(f.stop).toHaveBeenCalledWith(owner)
      expect(f.drain).toHaveBeenCalledWith(owner)
      expect(cap.resources(operation)).toEqual([{ kind: 'session', resourceId: 'own' }])
      await cap.quiesce(operation)
    })
    const result = await f.facade.deleteAccount(request(login.tokens.accessToken), { ...proof, code: totpCode(secret, f.now()) })
    expect(result.status).toBe('deleted')
    expect(erase).toHaveBeenCalledTimes(1)
    expect(f.domain.table('users').get(owner)).toBeUndefined()
    expect(jobs(f)[0]).toMatchObject({ id: result.requestId, status: 'completed' })
    expect(jobs(f)[0]?.subject).toBeUndefined()
    expect(JSON.stringify(f.snapshot())).not.toContain(secret)
    expect([...f.domain.table('mobile_grants').entries()].every(([, row]) => row.userId !== login.user.userId)).toBe(true)
    expect(f.facade.resolve(request(other.tokens.accessToken))?.user.userId).toBe(other.user.userId)
    expect(() => cap.resources({ requestId: result.requestId, ...login.user })).toThrow()
  })

  it('removes owned admission secrets and redacts linked contact/audit without deleting shared rows', async () => {
    const f = await fixture()
    const login = await register(f)
    const other = await register(f, 'another')
    const at = new Date(f.now()).toISOString()
    for (const user of [login.user, other.user]) {
      const record = f.domain.table('users').get(user.userKey)!
      await f.domain.table('pending_registrations').put(`pr:${user.username}`, { id: `pr:${user.username}`, requestId: `sr:${user.username}`,
        schoolId: SCHOOL, schoolName: '贵阳市实验中学', username: user.username, displayName: user.displayName, email: record.email!,
        passwordHash: record.passwordHash, status: 'approved', createdAt: at })
      await f.domain.table('school_requests').put(`sr:${user.username}`, { id: `sr:${user.username}`, schoolId: SCHOOL,
        schoolName: '贵阳市实验中学', contact: record.email!, email: record.email!, requestedBy: null, status: 'approved', createdAt: at })
      await f.domain.table('admin_audit').put(`audit:${user.username}`, { id: `audit:${user.username}`, schoolId: SCHOOL,
        actorKey: user.userKey, target: user.userKey, action: 'fixture', detail: { privateText: user.username }, createdAt: at })
    }
    const otherAdmission = f.domain.table('pending_registrations').get('pr:another')
    const otherApplication = f.domain.table('school_requests').get('sr:another')
    const otherAudit = f.domain.table('admin_audit').get('audit:another')
    expect((await f.facade.deleteAccount(request(login.tokens.accessToken), proof)).status).toBe('deleted')
    expect(f.domain.table('pending_registrations').get('pr:student')).toBeUndefined()
    expect(f.domain.table('school_requests').get('sr:student')).toMatchObject({ contact: '已注销', status: 'approved' })
    expect(f.domain.table('school_requests').get('sr:student')?.email).toBeUndefined()
    expect(f.domain.table('admin_audit').get('audit:student')?.detail).toBeUndefined()
    expect(f.domain.table('admin_audit').get('audit:student')?.actorKey).toMatch(/^erased:/)
    expect(f.domain.table('pending_registrations').get('pr:another')).toEqual(otherAdmission)
    expect(f.domain.table('school_requests').get('sr:another')).toEqual(otherApplication)
    expect(f.domain.table('admin_audit').get('audit:another')).toEqual(otherAudit)
  })

  it('recovers provider failure from a new snapshot with the same accepted request', async () => {
    const f = await fixture()
    const login = await register(f)
    vi.spyOn(f.provider, 'eraseAccount').mockRejectedValue(new Error('private token or evidence must not persist'))
    const accepted = await f.facade.deleteAccount(request(login.tokens.accessToken), proof)
    expect(accepted.status).toBe('deletion_pending')
    expect(f.facade.resolve(request(login.tokens.accessToken))).toBeNull()
    await expect(f.service.refreshMobile({ refreshToken: login.tokens.refreshToken })).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' })
    expect(JSON.stringify(jobs(f))).not.toContain('private token')
    const restarted = await fixture({ snapshot: f.snapshot() })
    restarted.advance()
    restarted.service.startAccountErasureRecovery()
    try {
      await vi.waitFor(() => expect(jobs(restarted)[0]?.status).toBe('completed'))
      expect(restarted.provider.eraseAccount).toHaveBeenCalledWith({ requestId: accepted.requestId,
        userId: login.user.userId, userKey: login.user.userKey, schoolId: SCHOOL, username: 'student' })
    } finally { await restarted.service.stopAccountErasureRecovery() }
  })

  it('recovers a failure immediately after job persistence and initiates shutdown anyway', async () => {
    const f = await fixture()
    const login = await register(f)
    f.failOnce((name, op, row) => name === 'users' && op === 'put' && (row as UserRecord).status === 'disabled')
    expect((await f.facade.deleteAccount(request(login.tokens.accessToken), proof)).status).toBe('deletion_pending')
    expect(f.stop).toHaveBeenCalledWith(login.user.userKey)
    expect(f.facade.resolve(request(login.tokens.accessToken))).toBeNull()
    const restarted = await fixture({ snapshot: f.snapshot() })
    restarted.advance()
    await restarted.service.retryAccountErasures()
    expect(jobs(restarted)[0]?.status).toBe('completed')
  })

  it('retains the grant cross-reference until every token index can be deleted', async () => {
    const f = await fixture()
    const login = await register(f)
    f.failOnce((name, operation) => name === 'mobile_token_index' && operation === 'delete')
    const accepted = await f.facade.deleteAccount(request(login.tokens.accessToken), proof)
    expect(accepted.status).toBe('deletion_pending')
    expect([...f.domain.table('mobile_grants').entries()]).not.toHaveLength(0)
    const restarted = await fixture({ snapshot: f.snapshot() })
    restarted.advance()
    await restarted.service.retryAccountErasures()
    expect([...restarted.domain.table('mobile_grants').entries()]).toEqual([])
    expect([...restarted.domain.table('mobile_token_index').entries()]).toEqual([])
    expect(jobs(restarted)[0]).toMatchObject({ id: accepted.requestId, status: 'completed' })
  })

  it('keeps the owner reserved after private removal until the completion write succeeds', async () => {
    const f = await fixture()
    const login = await register(f)
    f.failOnce((name, op, row) => name === 'account_deletions' && op === 'put' && (row as { status: string }).status === 'completed')
    const accepted = await f.facade.deleteAccount(request(login.tokens.accessToken), proof)
    expect(accepted.status).toBe('deletion_pending')
    expect(f.domain.table('users').get(login.user.userKey)).toBeUndefined()
    await expect(register(f)).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
    f.advance()
    await f.service.retryAccountErasures()
    expect(jobs(f)[0]?.status).toBe('completed')
    const replacement = await register(f)
    expect(replacement.user.userId).not.toBe(login.user.userId)
    expect(() => createAccountErasureAuth(f.service, '/fixture-workspaces').resources({ requestId: accepted.requestId, ...login.user })).toThrow()
    expect(f.facade.resolve(request(replacement.tokens.accessToken))).not.toBeNull()
  })

  it('never lets a stale job disable or erase a replacement incarnation', async () => {
    const f = await fixture()
    const login = await register(f)
    const erase = vi.spyOn(f.provider, 'eraseAccount').mockRejectedValue(new Error('fixture outage'))
    const accepted = await f.facade.deleteAccount(request(login.tokens.accessToken), proof)
    const replacement = { ...f.domain.table('users').get(login.user.userKey)!, id: 'replacement-instance', status: 'active' as const }
    await f.domain.table('users').put(login.user.userKey, replacement)
    f.advance()
    await f.service.retryAccountErasures()
    expect(erase).toHaveBeenCalledTimes(1)
    expect(f.domain.table('users').get(login.user.userKey)).toEqual(replacement)
    expect(jobs(f)[0]?.status).toBe('pending')
    expect(() => createAccountErasureAuth(f.service, '/fixture-workspaces').resources({ requestId: accepted.requestId, ...login.user })).toThrow()
  })

  it('returns pending on timeout but never erases before a real admitted writer finishes', async () => {
    vi.useFakeTimers()
    const writer = deferred()
    const entered = deferred()
    const f = await fixture({ deps: { drainAccountRequests: async () => { entered.resolve(); await writer.promise } } })
    const login = await register(f)
    const other = await register(f, 'another')
    const deletion = f.facade.deleteAccount(request(login.tokens.accessToken), proof)
    await entered.promise
    await vi.advanceTimersByTimeAsync(1_001)
    expect((await deletion).status).toBe('deletion_pending')
    expect(f.provider.eraseAccount).not.toHaveBeenCalled()
    expect(f.facade.resolve(request(other.tokens.accessToken))).not.toBeNull()
    writer.resolve()
    await vi.waitFor(() => expect(jobs(f)[0]?.status).toBe('completed'))
  })
})

function policy(actor: ApiPolicyActor | null) {
  let current = actor
  const value = createApiPolicy({ actorFromCookie: () => current, actorFromRequest: () => current,
    store: { owns: (who, _kind, id) => who.userKey === 'school:student' && id === 'owned', ownedIds: () => new Set(['owned']),
      claim: async () => undefined, release: async () => undefined },
    ensureWorkspace: async () => ({ id: 'owned', path: '/fixture', title: 'fixture' }) })
  return { value, withdraw: () => { current = null } }
}
const mobileActor: ApiPolicyActor = { userKey: 'school:student', schoolId: 'school', username: 'student', role: 'STUDENT',
  credential: { kind: 'mobile', grantId: 'fixture-grant', scope: 'read' } }
describe('native mobile API policy', () => {
  it('enforces bearer read scope without relabeling a mobile grant as a PAT', async () => {
    const p = policy(mobileActor)
    const next = vi.fn(async () => Response.json({}))
    const response = await p.value.wrapFetch(next)(new Request('http://fixture/api/session/inbox/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-rpc', method: 'session.inbox.append', payload: { sessionId: 'owned' } }),
    }))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).toContain('TOKEN_SCOPE_REQUIRED')
    expect(next).not.toHaveBeenCalled()
  })
  it('drains admitted handlers while preserving ownership and credential checks', async () => {
    const p = policy(mobileActor)
    const gate = deferred()
    const entered = deferred()
    const active = p.value.wrapFetch(async () => { entered.resolve(); await gate.promise; return Response.json({}) })(new Request('http://fixture/api/session/export?sessionId=owned'))
    await entered.promise
    p.withdraw()
    let drained = false
    const draining = p.value.drainAccountRequests(mobileActor.userKey).then(() => { drained = true })
    await p.value.drainAccountRequests('school:other')
    expect(drained).toBe(false)
    gate.resolve()
    expect((await active).status).toBe(401)
    await draining
    expect(drained).toBe(true)
    const foreignHandler = vi.fn(async () => Response.json({}))
    const denied = await policy(mobileActor).value.wrapFetch(foreignHandler)(new Request('http://fixture/api/session/export?sessionId=foreign'))
    expect(await denied.json()).toMatchObject({ result: { ok: false, error: { code: 'session-not-found' } } })
    expect(foreignHandler).not.toHaveBeenCalled()
  })
})

// All runtime registries below are fixtures. No live agent/model or server is used.
describe('erasure runtime drains', () => {
  it('waits beyond the old cancellation timeout for owned agents, not unrelated agents', async () => {
    const f = await fixture()
    const login = await register(f)
    await f.domain.table('api_resources').put('session:owned', { id: 'session:owned', kind: 'session', resourceId: 'owned', ownerKey: login.user.userKey, schoolId: SCHOOL, createdAt: new Date(f.now()).toISOString() })
    const idle = deferred()
    const owned = { id: 'owned', cancel: vi.fn(), whenIdle: () => idle.promise }
    const foreign = { id: 'foreign', cancel: vi.fn(), whenIdle: () => new Promise<void>(() => {}) }
    const registry = { list: () => [owned, foreign], get: (id: string) => id === 'owned' ? owned : foreign, isOwnedBy: () => false }
    const ctx = { on: () => () => {}, get: () => registry }
    const runs = new AccountRuns(ctx as never, f.domain, f.service)
    let done = false
    const pending = runs.drain(login.user.userKey).then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    expect(owned.cancel).toHaveBeenCalled()
    expect(foreign.cancel).not.toHaveBeenCalled()
    idle.resolve()
    await pending
    expect(done).toBe(true)
    runs.dispose()
  })

  it('cleans real moderation runtime cursors without deleting another owner or activation watermark', async () => {
    const f = await fixture()
    const login = await register(f)
    const ctx = { on: () => () => {}, get: () => undefined, logger: { warn: vi.fn() } }
    const runtime = await ModerationRuntime.create(ctx as never, f.domain, f.service, async () => { throw new Error('Reviewer must not run') }, () => false)
    const accepted: AccountErasureRequest = { requestId: 'runtime-fixture-delete', userId: login.user.userId, userKey: login.user.userKey, schoolId: SCHOOL, username: 'student' }
    try {
      for (const [id, ownerKey] of [['claim:own', login.user.userKey], ['claim:other', `${SCHOOL}:another`]] as const) {
        await f.domain.table('moderation_cursors').put(id, { id, ownerKey, sessionId: id, kind: 'claim', seq: 0, index: 0, done: false })
      }
      await f.domain.table('account_deletions').put(accepted.userId, { id: accepted.requestId, subject: accepted, status: 'pending', attempts: 0, requestedAt: new Date(f.now()).toISOString() })
      await f.domain.table('users').put(accepted.userKey, { ...f.domain.table('users').get(accepted.userKey)!, status: 'disabled' })
      await runtime.eraseAccount(accepted)
      expect(f.domain.table('moderation_cursors').get('claim:own')).toBeUndefined()
      expect(f.domain.table('moderation_cursors').get('claim:other')).toBeDefined()
      expect(f.domain.table('moderation_cursors').get('activation')).toBeDefined()
    } finally { await runtime.dispose() }
  })

  it('fences moderation intake and drains an abort-ignoring reviewer before erasing evidence', async () => {
    const f = await fixture()
    const login = await register(f)
    const other = await register(f, 'another')
    for (const [id, user] of [['owned', login.user], ['foreign', other.user]] as const) {
      await f.domain.table('api_resources').put(`session:${id}`, { id: `session:${id}`, kind: 'session', resourceId: id, ownerKey: user.userKey, schoolId: SCHOOL, createdAt: new Date(f.now()).toISOString() })
    }
    const reviewing = deferred()
    const finished = deferred<never>()
    const moderator = new ModerationService(f.domain, f.service, { review: async () => { reviewing.resolve(); return finished.promise } })
    const ownCase = await moderator.capture({ sessionId: 'owned', messageId: 'one', text: 'fixture evidence' })
    const processing = moderator.processNext()
    await reviewing.promise
    const foreignCase = await moderator.capture({ sessionId: 'foreign', messageId: 'two', text: 'unrelated evidence' })
    const request: AccountErasureRequest = { requestId: 'fixture-erasure', userId: login.user.userId, userKey: login.user.userKey, schoolId: SCHOOL, username: 'student' }
    await f.domain.table('account_deletions').put(request.userId, { id: request.requestId, subject: request, status: 'pending', attempts: 0, requestedAt: new Date(f.now()).toISOString() })
    await f.domain.table('users').put(request.userKey, { ...f.domain.table('users').get(request.userKey)!, status: 'disabled' })
    let erased = false
    const erasing = moderator.eraseAccount(request).then(() => { erased = true })
    expect(await moderator.capture({ sessionId: 'owned', messageId: 'late', text: 'must not persist' })).toBeUndefined()
    expect(erased).toBe(false)
    finished.reject(new Error('fixture cancelled reviewer'))
    await processing
    await erasing
    expect(f.domain.table('moderation_cases').get(ownCase!)).toBeUndefined()
    expect(f.domain.table('moderation_cases').get(foreignCase!)).toBeDefined()
  })
})
