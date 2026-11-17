import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AVATAR_EDITION, AVATAR_IDS, AVATAR_OWNER_HEADER, avatarIdFromUrl,
  avatarUrlForId, setAvatarWire, type AvatarOwner,
} from '../src/avatar-catalog.ts'
import * as clientCatalog from '../../../client/ui-physicsos/src/client/avatar-catalog.ts'
import { authDomain, userKey, type SessionRecord, type UserRecord } from '../src/domain.ts'
import { newSessionToken, sessionTokenHash } from '../src/cookies.ts'
import { createIdentityService } from '../src/identity.ts'
import { AuthService, DEFAULT_AUTH_CONFIG, type AdminActor } from '../src/service.ts'
import { hashPassword } from '../src/passwords.ts'
import { totpCode } from '../src/totp.ts'
import { createSecurityHarness, get, post, school, memoryDomain, type SecurityHarness } from './security-fixture.ts'

const NOW = new Date('2026-11-17T08:00:00.000Z')
const record = (schoolId = 'GZU', username = 'student1', patch: Partial<UserRecord> = {}): UserRecord => ({
  id: `u_${schoolId}_${username}`, schoolId, username, passwordHash: 'test-not-a-credential',
  displayName: '李明', role: 'STUDENT', status: 'active',
  createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...patch,
})
const ownerOf = (row: UserRecord): AvatarOwner => ({ id: row.id, schoolId: row.schoolId, username: row.username })
const encodedOwner = (owner: AvatarOwner) => encodeURIComponent(JSON.stringify(owner))
const SELF = record()
const OTHER = record('GZU', 'student2')
const FOREIGN = record('GZNU', 'student1')
const ROOT = record('PHYSICSOS-OPEN', 'admin', { role: 'SUPER_ADMIN' })
const rootActor: AdminActor = { userKey: userKey(ROOT.schoolId, ROOT.username), schoolId: ROOT.schoolId, username: ROOT.username, role: ROOT.role }
const harnesses: SecurityHarness[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(harnesses.splice(0).map(harness => harness.close()))
})

async function makeHarness() {
  const harness = await createSecurityHarness({
    deps: { now: () => NOW },
    schools: [school('GZU', '贵州大学'), school('GZNU', '贵州师范大学'), school('PHYSICSOS-OPEN', '运维学校')],
    users: [SELF, OTHER, FOREIGN, ROOT],
  })
  harnesses.push(harness)
  return harness
}
async function session(h: Pick<SecurityHarness, 'domain'>, user: UserRecord = SELF, patch: Partial<SessionRecord> = {}) {
  const token = newSessionToken()
  const id = sessionTokenHash(token)
  await h.domain.table('sessions').put(id, {
    id, userId: user.id, schoolId: user.schoolId, username: user.username,
    remember: false, createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    ...patch,
  })
  return { token, headers: { cookie: `physicsos_session=${token}`, [AVATAR_OWNER_HEADER]: encodedOwner(ownerOf(user)) } }
}
const errorCode = async (response: Response) => (await response.json() as { error: { code: string } }).error.code

// The mirrored catalog is pure data; importing it here must not bring React or host code into the other deployable.
describe('versioned closed avatar catalog', () => {
  it('pins the twelve IDs and keeps host/client paths identical', () => {
    expect(AVATAR_EDITION).toBe('guizhou-v1')
    expect(AVATAR_IDS).toEqual([
      'silver-greeting', 'indigo-reader', 'butterfly-light', 'pendulum',
      'batik-star', 'mountain-sound', 'lens-maker', 'copper-drum',
      'green-wave', 'red-embroidery', 'silver-moon', 'discovery',
    ])
    expect(new Set(AVATAR_IDS).size).toBe(12)
    expect(clientCatalog.AVATAR_IDS).toEqual(AVATAR_IDS)
    expect(clientCatalog.AVATAR_CATALOG.map(item => item.id)).toEqual(AVATAR_IDS)
    expect(clientCatalog.AVATAR_OWNER_HEADER).toBe(AVATAR_OWNER_HEADER)
    for (const id of AVATAR_IDS) {
      expect(setAvatarWire.parse({ avatarId: id })).toEqual({ avatarId: id })
      const path = `/physicsos/avatars/guizhou-v1/${id}-192.webp`
      expect(avatarUrlForId(id)).toBe(path)
      expect(clientCatalog.avatarUrlForId(id)).toBe(path)
      expect(avatarIdFromUrl(path)).toBe(id)
      expect(clientCatalog.avatarIdFromUrl(path)).toBe(id)
    }
  })

  it.each([
    undefined, null, 1, {}, '', 'discovery ', 'Discovery', '__proto__', 'constructor',
    'https://example.com/physicsos/avatars/guizhou-v1/discovery-192.webp',
    '//example.com/physicsos/avatars/guizhou-v1/discovery-192.webp',
    '/physicsos/avatars/guizhou-v1/discovery-192.webp?x=1',
    '/physicsos/avatars/guizhou-v1/discovery-192.webp#fragment',
    '/physicsos/avatars/guizhou-v1/%64iscovery-192.webp',
    '/physicsos/avatars/guizhou-v1/../guizhou-v1/discovery-192.webp',
    '/physicsos/avatars/guizhou-v2/discovery-192.webp',
    '/physicsos/avatars/guizhou-v1/discovery-384.webp',
  ])('does not infer adoption from aliases, URLs or unknown data: %j', (value) => {
    expect(avatarIdFromUrl(value)).toBeUndefined()
    expect(clientCatalog.avatarIdFromUrl(value)).toBeUndefined()
  })
})

describe('POST /physicsos/auth/me/avatar', () => {
  it('writes only the live cookie account avatarUrl and derives avatarId in all DTOs', async () => {
    const h = await makeHarness()
    const { headers } = await session(h)
    const before = h.domain.table('users').get('GZU:student1')!
    const response = await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, headers)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { user } = await response.json() as { user: Record<string, unknown> }
    expect(user).toMatchObject({ ...ownerOf(SELF), avatarId: 'discovery', avatarUrl: avatarUrlForId('discovery'), role: 'STUDENT' })
    expect(user).not.toHaveProperty('passwordHash')
    const saved = h.domain.table('users').get('GZU:student1')!
    expect(saved).toEqual({ ...before, avatarUrl: avatarUrlForId('discovery'), updatedAt: NOW.toISOString() })
    expect(saved).not.toHaveProperty('avatarId')
    expect(authDomain.version).toBe(0)
    expect(authDomain.tables.users.valueSchema.parse(saved)).toEqual(saved)
    expect(h.domain.table('users').get('GZU:student2')).toEqual(OTHER)
    expect(h.domain.table('users').get('GZNU:student1')).toEqual(FOREIGN)
    expect((await (await get(h.auth, '/me', headers)).json() as { user: unknown }).user).toEqual(user)
    expect(h.service.listUsers(rootActor, {}).find(row => row.id === SELF.id)).toMatchObject({ avatarId: 'discovery' })
    // A repeated choice has no independent counter/secondary profile write.
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, headers)).status).toBe(200)
    expect(h.service.avatarAdoptionSnapshot().filter(row => row.kind === 'catalog')).toHaveLength(1)
  })

  it('preserves legacy avatar URLs on read, without pretending they belong to the catalog', async () => {
    const h = await makeHarness()
    const { headers } = await session(h)
    const legacyUrl = 'https://legacy.example.test/original.jpg'
    await h.domain.table('users').update('GZU:student1', row => ({ ...row, avatarUrl: legacyUrl }))
    const { user } = await (await get(h.auth, '/me', headers)).json() as { user: { avatarUrl: string; avatarId?: string } }
    expect(user.avatarUrl).toBe(legacyUrl)
    expect(user).not.toHaveProperty('avatarId')
    expect((await post(h.auth, '/me/avatar', { avatarId: 'silver-moon' }, headers)).status).toBe(200)
    expect(h.domain.table('users').get('GZU:student1')?.avatarUrl).toBe(avatarUrlForId('silver-moon'))
  })

  it.each([
    null, [], {}, { avatarId: null }, { avatarId: 1 }, { avatarId: '' }, { avatarId: 'unknown' },
    { avatarId: '__proto__' }, { avatarId: 'DISCOVERY' }, { avatarId: 'discovery ' },
    { avatarId: '../discovery' }, { avatarId: 'https://example.test/avatar.webp' },
    { avatarUrl: avatarUrlForId('discovery') },
    { avatarId: 'discovery', avatarUrl: 'https://evil.test/x' },
    { avatarId: 'discovery', owner: 'GZNU:student1' },
    { avatarId: 'discovery', userKey: 'GZU:student2' },
    { avatarId: 'discovery', userId: FOREIGN.id },
    { avatarId: 'discovery', schoolId: 'GZNU' },
    { avatarId: 'discovery', username: 'student2' },
    { avatarId: 'discovery', role: 'SUPER_ADMIN' },
  ])('rejects the entire invalid/extra-field body without writing: %j', async (body) => {
    const h = await makeHarness()
    const { headers } = await session(h)
    const before = [...h.domain.table('users').entries()]
    const response = await post(h.auth, '/me/avatar', body, headers)
    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe('BAD_REQUEST')
    expect([...h.domain.table('users').entries()]).toEqual(before)
  })

  it('rejects anonymous, unknown, expired, revoked, disabled-account and disabled-school sessions', async () => {
    const h = await makeHarness()
    const ownerHeader = { [AVATAR_OWNER_HEADER]: encodedOwner(ownerOf(SELF)) }
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, ownerHeader)).status).toBe(401)
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, { ...ownerHeader, cookie: 'physicsos_session=unknown' })).status).toBe(401)
    for (const patch of [{ expiresAt: NOW.toISOString() }, { revokedAt: NOW.toISOString() }]) {
      const { headers } = await session(h, SELF, patch)
      expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, headers)).status).toBe(401)
    }
    const { headers } = await session(h)
    await h.domain.table('users').update('GZU:student1', row => ({ ...row, status: 'disabled' }))
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, headers)).status).toBe(401)
    await h.domain.table('users').update('GZU:student1', row => ({ ...row, status: 'active' }))
    await h.domain.table('schools').update('GZU', row => ({ ...row, status: 'disabled' }))
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, headers)).status).toBe(401)
    expect(h.domain.table('users').get('GZU:student1')).not.toHaveProperty('avatarUrl')
  })

  it('refuses both API-token scopes, forged Bearer, and Cookie+Authorization rather than dropping scope', async () => {
    const h = await makeHarness()
    const { headers } = await session(h)
    for (const scope of ['read', 'write'] as const) {
      const created = await h.service.createApiToken({ userKey: 'GZU:student1', schoolId: 'GZU', username: SELF.username, role: SELF.role }, { name: 'test', scope })
      for (const withCookie of [false, true]) {
        const response = await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, {
          ...(withCookie ? headers : { [AVATAR_OWNER_HEADER]: headers[AVATAR_OWNER_HEADER] }),
          authorization: `Bearer ${created.secret}`,
        })
        expect(response.status).toBe(401)
        expect(await errorCode(response)).toBe('UNAUTHENTICATED')
      }
    }
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, { ...headers, authorization: 'Bearer forged' })).status).toBe(401)
    expect(h.domain.table('users').get('GZU:student1')).not.toHaveProperty('avatarUrl')
  })

  it('uses expected owner only to reject stale tabs, including same username / a different tenant or user id', async () => {
    const h = await makeHarness()
    const ownSession = await session(h)
    for (const expected of [OTHER, FOREIGN, { ...SELF, id: 'u_replaced' }]) {
      const response = await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, {
        ...ownSession.headers, [AVATAR_OWNER_HEADER]: encodedOwner(ownerOf(expected)),
      })
      expect(response.status).toBe(409)
      expect(await errorCode(response)).toBe('OWNER_CHANGED')
    }
    const root = await session(h, ROOT)
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, {
      ...root.headers, [AVATAR_OWNER_HEADER]: encodedOwner(ownerOf(SELF)),
    })).status).toBe(409)
    expect((await post(h.auth, '/me/avatar?owner=GZU%3Astudent2', { avatarId: 'discovery' }, ownSession.headers)).status).toBe(400)
    expect([...h.domain.table('users').entries()].every(([, row]) => row.avatarUrl === undefined)).toBe(true)
  })

  it('requires one valid closed expected-owner header', async () => {
    const h = await makeHarness()
    const { headers } = await session(h)
    for (const header of ['', '%', 'null', '{}', encodedOwner({ ...ownerOf(SELF), target: 'other' } as AvatarOwner), 'x'.repeat(4097)]) {
      expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, { ...headers, [AVATAR_OWNER_HEADER]: header })).status).toBe(400)
    }
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, { cookie: headers.cookie })).status).toBe(400)
    const repeated = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${h.auth}/me/avatar`, { method: 'POST', headers: {
        'content-type': 'application/json', cookie: headers.cookie,
        [AVATAR_OWNER_HEADER]: [headers[AVATAR_OWNER_HEADER], headers[AVATAR_OWNER_HEADER]],
      } }, (res) => { res.resume(); res.on('end', () => { resolve(res.statusCode ?? 0) }) })
      req.on('error', reject)
      req.end(JSON.stringify({ avatarId: 'discovery' }))
    })
    expect(repeated).toBe(400)
  })

  it('keeps the JSON/Origin/fetch-site CSRF gate and capped body boundary', async () => {
    const h = await makeHarness()
    const { headers } = await session(h)
    for (const extra of [
      { origin: 'https://evil.example.test' }, { origin: `${h.base}:1234` }, { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' },
    ]) {
      const response = await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, { ...headers, ...extra })
      expect([400, 403]).toContain(response.status)
    }
    const malformed = await fetch(`${h.auth}/me/avatar`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{' })
    expect(malformed.status).toBe(400)
    expect((await post(h.auth, '/me/avatar', { avatarId: 'x'.repeat(17_000) }, headers)).status).toBe(400)
    const allowed = await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, { ...headers, origin: h.base, 'sec-fetch-site': 'same-origin' })
    expect(allowed.status).toBe(200)
  })

  it('exposes a safe retryable error on failed durability and does not publish a fake avatar', async () => {
    const h = await makeHarness()
    const { headers } = await session(h)
    vi.spyOn(h.domain.table('users'), 'update').mockRejectedValueOnce(new Error('private storage path and secret'))
    const failed = await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, headers)
    expect(failed.status).toBe(503)
    const body = await failed.json()
    expect(body).toMatchObject({ error: { code: 'DEPENDENCY_UNAVAILABLE' } })
    expect(JSON.stringify(body)).not.toContain('private storage')
    expect(h.domain.table('users').get('GZU:student1')).not.toHaveProperty('avatarUrl')
    expect((await post(h.auth, '/me/avatar', { avatarId: 'discovery' }, headers)).status).toBe(200)
  })
})

describe('avatar service authority at the atomic write slot', () => {
  it('does not accept an actor-shaped argument instead of a real session token', async () => {
    const h = await makeHarness()
    await expect(h.service.setOwnAvatar(null, { avatarId: 'discovery' }, ownerOf(SELF))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(h.service.setOwnAvatar('GZU:student1', { avatarId: 'discovery' }, ownerOf(SELF))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it.each(['logout', 'expire', 'disable-user', 'disable-school', 'replace-user', 'revoke-device'] as const)('rechecks %s after waiting to update', async (change) => {
    const h = await makeHarness()
    const deviceId = 'a'.repeat(64)
    const { token } = await session(h, SELF, { deviceId })
    const users = h.domain.table('users')
    const update = users.update.bind(users)
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { started = resolve })
    vi.spyOn(users, 'update').mockImplementationOnce(async (key, transform) => {
      started(); await waiting; return update(key, transform)
    })
    const result = h.service.setOwnAvatar(token, { avatarId: 'discovery' }, ownerOf(SELF)).catch((error: unknown) => error)
    await entered
    if (change === 'logout') await h.service.logout(token)
    if (change === 'expire') await h.domain.table('sessions').update(sessionTokenHash(token), row => ({ ...row, expiresAt: NOW.toISOString() }))
    if (change === 'disable-user') await update('GZU:student1', row => ({ ...row, status: 'disabled' }))
    if (change === 'disable-school') await h.domain.table('schools').update('GZU', row => ({ ...row, status: 'disabled' }))
    if (change === 'replace-user') await h.domain.table('users').put('GZU:student1', { ...SELF, id: 'u_replacement' })
    if (change === 'revoke-device') await h.domain.table('device_revocations').put(`GZU|${deviceId}`, { id: `GZU|${deviceId}`, scope: 'GZU', deviceId, revokedBy: rootActor.userKey, revokedAt: NOW.toISOString(), affectedSchools: ['GZU'] })
    release()
    expect(await result).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(users.get('GZU:student1')).not.toHaveProperty('avatarUrl')
  })
})

describe('concurrent existing-user mutations preserve the selected avatar', () => {
  let passwordHash: string | undefined
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

  it.each(['login', 'totp-setup', 'totp-enable', 'totp-disable', 'admin-status', 'admin-password', 'password-reset'] as const)(
    '%s patches the current user rather than putting a stale full row', async (operation) => {
      passwordHash ??= hashPassword('bootstrap-pass')
      const domain = memoryDomain()
      await domain.table('schools').put('GZU', school('GZU', '贵州大学'))
      const row = record('GZU', 'student1', {
        role: 'TEACHER', passwordHash,
        ...(operation === 'totp-enable' ? { totpPendingSecret: secret } : {}),
        ...(operation === 'totp-disable' ? { totp: { secret, enabledAt: NOW.toISOString() } } : {}),
      })
      await domain.table('users').put('GZU:student1', row)
      const auth = new AuthService(domain, DEFAULT_AUTH_CONFIG, { now: () => NOW })
      // Independent instances share the same durable users table.
      const avatars = new AuthService(domain, DEFAULT_AUTH_CONFIG, { now: () => NOW })
      const { token } = await session({ domain }, row)
      const actor = { userKey: 'GZU:student1', schoolId: 'GZU', username: 'student1', role: row.role }
      let resetToken: string | undefined
      if (operation === 'password-reset') {
        await auth.requestPasswordReset({ username: row.username, schoolId: row.schoolId })
        const request = auth.listPasswordResets(rootActor).requests[0]!
        resetToken = (await auth.issuePasswordReset(rootActor, request.id)).token
      }
      const users = domain.table('users')
      const original = users.get('GZU:student1')!
      const update = users.update.bind(users)
      const put = vi.spyOn(users, 'put')
      let release!: () => void
      let started!: () => void
      const waiting = new Promise<void>((resolve) => { release = resolve })
      const entered = new Promise<void>((resolve) => { started = resolve })
      vi.spyOn(users, 'update').mockImplementationOnce(async (key, transform) => {
        started(); await waiting; return update(key, transform)
      })
      const mutate = () => {
        switch (operation) {
          case 'login': return auth.login({ schoolId: row.schoolId, username: row.username, password: 'bootstrap-pass' })
          case 'totp-setup': return auth.startTotpSetup(actor)
          case 'totp-enable': return auth.enableTotp(actor, { code: totpCode(secret, NOW.getTime()) })
          case 'totp-disable': return auth.disableTotp(actor, { password: 'bootstrap-pass', code: totpCode(secret, NOW.getTime()) })
          case 'admin-status': return auth.setUserStatus(rootActor, row.schoolId, row.username, { status: 'disabled' })
          case 'admin-password': return auth.resetUserPassword(rootActor, row.schoolId, row.username, { newPassword: 'rotated-password' })
          case 'password-reset': return auth.submitPasswordReset({ token: resetToken, newPassword: 'rotated-password' })
        }
      }
      const pending = mutate()
      await entered
      await avatars.setOwnAvatar(token, { avatarId: 'lens-maker' }, ownerOf(row))
      release()
      const result = await pending
      const saved = users.get('GZU:student1')!
      expect(saved.avatarUrl).toBe(avatarUrlForId('lens-maker'))
      expect(saved).not.toHaveProperty('avatarId')
      expect(original).not.toHaveProperty('avatarUrl')
      expect(put).not.toHaveBeenCalled()
      if (operation === 'login') expect(result).toMatchObject({ user: { avatarId: 'lens-maker', avatarUrl: avatarUrlForId('lens-maker') } })
      if (operation === 'admin-status') expect(saved.status).toBe('disabled')
      if (operation === 'totp-setup') expect(saved.totpPendingSecret).toBeTypeOf('string')
      if (operation === 'totp-enable') {
        expect(saved.totp?.secret).toBe(secret)
        expect(saved).not.toHaveProperty('totpPendingSecret')
        expect(original.totpPendingSecret).toBe(secret) // Stored objects are immutable; no delete on the old row.
      }
      if (operation === 'totp-disable') expect(saved).not.toHaveProperty('totp')
      if (operation === 'admin-password' || operation === 'password-reset') expect(saved.passwordHash).not.toBe(passwordHash)
    }, 20_000,
  )

  it('returns the live avatar when the selection lands during a late login audit write', async () => {
    passwordHash ??= hashPassword('bootstrap-pass')
    const h = await makeHarness()
    await h.domain.table('users').update('GZU:student1', row => ({ ...row, passwordHash: passwordHash! }))
    const { token } = await session(h)
    const audits = h.domain.table('admin_audit')
    const put = audits.put.bind(audits)
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { started = resolve })
    vi.spyOn(audits, 'put').mockImplementationOnce(async (key, row) => {
      started(); await waiting; return put(key, row)
    })
    const login = h.service.login({ schoolId: 'GZU', username: 'student1', password: 'bootstrap-pass' })
    await entered
    await h.service.setOwnAvatar(token, { avatarId: 'butterfly-light' }, ownerOf(SELF))
    release()
    expect(await login).toMatchObject({ user: { avatarId: 'butterfly-light', avatarUrl: avatarUrlForId('butterfly-light') } })
  }, 20_000)

  it('does not patch a replacement account from an old security-settings request', async () => {
    const h = await makeHarness()
    await h.domain.table('users').update('GZU:student1', row => ({ ...row, role: 'TEACHER' }))
    const users = h.domain.table('users')
    const update = users.update.bind(users)
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { started = resolve })
    vi.spyOn(users, 'update').mockImplementationOnce(async (key, transform) => {
      started(); await waiting; return update(key, transform)
    })
    const pending = h.service.startTotpSetup({ userKey: 'GZU:student1', schoolId: 'GZU', username: 'student1', role: 'TEACHER' }).catch((error: unknown) => error)
    await entered
    const replacement = { ...SELF, id: 'u_replacement', avatarUrl: avatarUrlForId('silver-moon') }
    await users.put('GZU:student1', replacement)
    release()
    expect(await pending).toMatchObject({ code: 'OWNER_CHANGED' })
    expect(users.get('GZU:student1')).toEqual(replacement)
  })
})

describe('read-only safe adoption and activity roster', () => {
  it('derives one current fact per account, separates legacy/unselected, and does not leak secrets', async () => {
    const h = await makeHarness()
    const identity = createIdentityService(h.service)
    await h.domain.table('users').update('GZU:student1', row => ({ ...row, avatarUrl: avatarUrlForId('pendulum') }))
    await h.domain.table('users').update('GZU:student2', row => ({ ...row, avatarUrl: 'https://old.example.test/avatar.png' }))
    const facts = identity.avatarAdoptionSnapshot()
    expect(facts.find(row => row.userKey === 'GZU:student1')).toMatchObject({ kind: 'catalog', avatarId: 'pendulum' })
    expect(facts.find(row => row.userKey === 'GZU:student2')).toMatchObject({ kind: 'legacy' })
    expect(facts.find(row => row.userKey === 'GZNU:student1')).toMatchObject({ kind: 'unselected' })
    expect(JSON.stringify(facts)).not.toMatch(/passwordHash|avatarUrl|test-not-a-credential/)
    const first = identity.activityRoster(rootActor)
    expect(first.users).toHaveLength(4)
    expect(Object.keys(first.users.find(row => row.userKey === 'PHYSICSOS-OPEN:admin')!).sort()).toEqual(['role', 'schoolId', 'status', 'userKey', 'username'])
    expect(JSON.stringify(first)).not.toMatch(/passwordHash|email|totp|test-not-a-credential/)
    const schoolActor: AdminActor = { userKey: 'GZU:admin', schoolId: 'GZU', username: 'admin', role: 'SCHOOL_ADMIN' }
    const scoped = identity.activityRoster(schoolActor)
    expect(scoped.schools.map(row => row.id)).toEqual(['GZU'])
    expect(scoped.users.map(row => row.userKey)).toEqual(['GZU:student1', 'GZU:student2'])
    expect(() => identity.activityRoster({ ...schoolActor, role: 'STUDENT' })).toThrow('需要管理员权限')
    expect(() => identity.activityRoster({ ...schoolActor, role: 'TEACHER' })).toThrow('需要管理员权限')
    ;(scoped.schools[0] as { name: string }).name = 'local-only mutation'
    expect(identity.activityRoster(schoolActor).schools[0]?.name).toBe('贵州大学')
    expect(identity.activityRoster(rootActor).version).toBe(first.version)
    await h.domain.table('users').update('GZU:student1', row => ({ ...row, lastLoginAt: NOW.toISOString() }))
    expect(identity.activityRoster(rootActor).version).toBe(first.version)
    for (const patch of [{ avatarUrl: avatarUrlForId('discovery') }, { role: 'TEACHER' as const }, { status: 'disabled' as const }]) {
      const previous = identity.activityRoster(rootActor).version
      await h.domain.table('users').update('GZU:student1', row => ({ ...row, ...patch }))
      expect(identity.activityRoster(rootActor).version).not.toBe(previous)
    }
    const previous = identity.activityRoster(rootActor).version
    await h.domain.table('schools').update('GZU', row => ({ ...row, canonicalName: '学校新名称', archivedAt: NOW.toISOString() }))
    expect(identity.activityRoster(rootActor).version).not.toBe(previous)
    expect(identity.avatarAdoptionSnapshot().some(row => row.schoolId === 'GZU')).toBe(false)
  })
})
