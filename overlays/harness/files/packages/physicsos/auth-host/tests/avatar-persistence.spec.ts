import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { authDomain, userKey, type UserRecord } from '../src/domain.ts'
import { newSessionToken, sessionTokenHash } from '../src/cookies.ts'
import { AVATAR_IDS, avatarUrlForId, type AvatarOwner } from '../src/avatar-catalog.ts'
import { AuthService, DEFAULT_AUTH_CONFIG } from '../src/service.ts'
import { hashPassword } from '../src/passwords.ts'
import { school } from './security-fixture.ts'

const NOW = new Date('2026-11-17T08:00:00.000Z')
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function open(root: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  let beforeWrite: ((table: string, key: string, value: unknown) => Promise<void>) | undefined
  const openUnit = backend.kv.open.bind(backend.kv)
  backend.kv.open = async (descriptor) => {
    const unit = await openUnit(descriptor)
    const putRecord = unit.putRecord.bind(unit)
    unit.putRecord = async (table, key, value) => {
      await beforeWrite?.(table, key, value)
      await putRecord(table, key, value)
    }
    return unit
  }
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.storage.mount('domain', facility)
  const domain = await facility.open(authDomain)
  const close = async () => { await domain.close(); await backend.close(); await ctx.fiber.dispose() }
  cleanups.push(close)
  const service = new AuthService(domain, DEFAULT_AUTH_CONFIG, { now: () => NOW })
  return { domain, service, close, beforeWrite: (hook: typeof beforeWrite) => { beforeWrite = hook } }
}

async function seed(fixture: Awaited<ReturnType<typeof open>>, realPassword = false) {
  const user: UserRecord = {
    id: 'u_avatar', schoolId: 'GZU', username: 'student1', displayName: '李明',
    passwordHash: realPassword ? hashPassword('bootstrap-pass') : 'test-not-a-credential',
    role: 'STUDENT', status: 'active', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  }
  await fixture.domain.table('schools').put('GZU', school('GZU', '贵州大学'))
  await fixture.domain.table('users').put(userKey(user.schoolId, user.username), user)
  const token = newSessionToken()
  const id = sessionTokenHash(token)
  await fixture.domain.table('sessions').put(id, {
    id, userId: user.id, schoolId: user.schoolId, username: user.username,
    remember: false, createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
  })
  const owner: AvatarOwner = { id: user.id, schoolId: user.schoolId, username: user.username }
  return { user, token, owner }
}

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-avatar-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('avatars over the real JSON domain and write chain', () => {
  it('survives a cold reopen and password login, using only the pre-existing v0 avatarUrl field', async () => {
    const root = await tempRoot()
    const first = await open(root)
    const { token, owner } = await seed(first, true)
    for (const avatarId of AVATAR_IDS) await first.service.setOwnAvatar(token, { avatarId }, owner)
    const saved = first.domain.table('users').get('GZU:student1')!
    expect(authDomain.version).toBe(0)
    expect(saved).not.toHaveProperty('avatarId')
    // The untouched legacy user schema must read and fully write the new URL.
    // This is a schema round-trip, not a claim to have booted the f6 binary.
    const legacyRoundTrip = authDomain.tables.users.valueSchema.parse(saved)
    expect(legacyRoundTrip).toEqual(saved)
    await first.domain.table('users').put('GZU:student1', legacyRoundTrip)
    await first.close()
    const raw = await readFile(join(root, 'physicsos_auth.json'), 'utf8')
    expect(raw).toContain(avatarUrlForId('discovery'))
    expect(raw).not.toContain('avatarId')
    const second = await open(root)
    expect(second.service.resolveSession(token)?.user).toMatchObject({ avatarId: 'discovery', avatarUrl: avatarUrlForId('discovery') })
    const login = await second.service.login({ schoolId: 'GZU', username: 'student1', password: 'bootstrap-pass' })
    expect(login).toMatchObject({ user: { id: owner.id, avatarId: 'discovery' } })
    expect(second.domain.table('users').get('GZU:student1')?.avatarUrl).toBe(avatarUrlForId('discovery'))
    expect(second.service.avatarAdoptionSnapshot()).toEqual([{ userKey: 'GZU:student1', schoolId: 'GZU', role: 'STUDENT', kind: 'catalog', avatarId: 'discovery' }])
  }, 20_000)

  it('does not let a stale completeLogin overwrite a queued avatar from another service instance', async () => {
    const root = await tempRoot()
    const fixture = await open(root)
    const { token, owner } = await seed(fixture, true)
    const entered = deferred()
    const release = deferred()
    let held = false
    fixture.beforeWrite(async (table) => {
      if (table !== 'sessions' || held) return
      held = true
      entered.resolve()
      await release.promise
    })
    const login = fixture.service.login({ schoolId: 'GZU', username: 'student1', password: 'bootstrap-pass' })
    await entered.promise
    const other = new AuthService(fixture.domain, DEFAULT_AUTH_CONFIG, { now: () => NOW })
    const avatar = other.setOwnAvatar(token, { avatarId: 'silver-moon' }, owner)
    release.resolve()
    const [result] = await Promise.all([login, avatar])
    expect(result).toMatchObject({ user: { avatarId: 'silver-moon' } })
    expect(fixture.domain.table('users').get('GZU:student1')).toMatchObject({
      avatarUrl: avatarUrlForId('silver-moon'), lastLoginAt: NOW.toISOString(),
    })
    await fixture.close()
    const restarted = await open(root)
    expect(restarted.service.resolveSession(token)?.user.avatarId).toBe('silver-moon')
  }, 20_000)

  it('serializes simultaneous avatar and account updates against the current row', async () => {
    const root = await tempRoot()
    const fixture = await open(root)
    const { token, owner } = await seed(fixture)
    const entered = deferred()
    const release = deferred()
    let held = false
    fixture.beforeWrite(async (table) => {
      if (table !== 'users' || held) return
      held = true
      entered.resolve()
      await release.promise
    })
    const first = fixture.service.setOwnAvatar(token, { avatarId: 'pendulum' }, owner)
    await entered.promise
    const account = fixture.domain.table('users').update('GZU:student1', row => ({ ...row, displayName: '新名字' }))
    const second = fixture.service.setOwnAvatar(token, { avatarId: 'green-wave' }, owner)
    release.resolve()
    await Promise.all([first, account, second])
    expect(fixture.domain.table('users').get('GZU:student1')).toMatchObject({ displayName: '新名字', avatarUrl: avatarUrlForId('green-wave') })
  })
})
