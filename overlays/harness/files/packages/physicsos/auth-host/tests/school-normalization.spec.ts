import { describe, expect, it } from 'vitest'
import { AuthService, DEFAULT_AUTH_CONFIG } from '../src/service.ts'
import { memoryDomain, school, user } from './security-fixture.ts'
import { authDomain, type School } from '../src/domain.ts'
import { createHash } from 'node:crypto'
import { seedSchools, SEED_SCHOOLS } from '../src/schools.ts'

const admin = { userKey: 'ops:admin', schoolId: 'ops', username: 'admin', role: 'SUPER_ADMIN' as const }
const registration = (schoolName: string) => ({ schoolName, username: 'student01', displayName: '学生', password: 'strong-password', email: 'student@example.test' })

describe('school names admitted by the actual account service', () => {
  it.each([' ', "'", '1234', '１２３４', 'student@example.com', 'https://example.com', 'www.example.com', 'example.com', '---', '\u0000'])('refuses invalid registration school %j before creating school/application/account rows', async name => {
    const domain = memoryDomain()
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    await expect(service.register(registration(name))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    for (const table of ['schools', 'school_requests', 'pending_registrations', 'users'] as const) expect([...domain.table(table).entries()]).toHaveLength(0)
  })

  it('preserves a genuine unlisted name containing a hyphen and apostrophe', async () => {
    const domain = memoryDomain()
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    await expect(service.register(registration("O'Neill-Physics School"))).resolves.toMatchObject({ pending: true, schoolName: "O'Neill-Physics School" })
    expect([...domain.table('school_requests').entries()][0]?.[1].schoolName).toBe("O'Neill-Physics School")
  })

  it('refuses direct creation of an existing normalized name under another tenant key', async () => {
    const domain = memoryDomain()
    await domain.table('schools').put('school-original', school('school-original', '贵州 实验中学'))
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    await expect(service.createSchool(admin, { id: 'school-new', name: '  贵州　实验中学  ' })).rejects.toMatchObject({ code: 'SCHOOL_NAME_TAKEN' })
    expect([...domain.table('schools').entries()]).toHaveLength(1)
  })

  it('keeps merged schools out of the normal admin roster without deleting their tenant rows', async () => {
    const domain = memoryDomain()
    await domain.table('schools').put('target', school('target', '真实中学'))
    await domain.table('schools').put('alias', { ...school('alias', '真实中学', 'disabled'), mergedInto: 'target', mergedAt: '2026-11-10T00:00:00Z' })
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    expect(service.listSchoolsAdmin(admin).map(row => row.id)).toEqual(['target'])
    expect(domain.table('schools').get('alias')?.mergedInto).toBe('target')
  })

  it('refuses a legacy approval that would activate another tenant with the same normalized name', async () => {
    const domain = memoryDomain()
    await domain.table('schools').put('original', school('original', '真实 中学'))
    await domain.table('school_requests').put('request', { id: 'request', schoolName: ' 真实　中学 ', contact: '申请人', status: 'pending', requestedBy: null, createdAt: new Date().toISOString() })
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    await expect(service.approveSchoolRequest(admin, 'request', { schoolId: 'duplicate' })).rejects.toMatchObject({ code: 'SCHOOL_NAME_TAKEN' })
    expect(domain.table('school_requests').get('request')?.status).toBe('pending')
    expect(domain.table('schools').get('duplicate')).toBeUndefined()
  })

  it('preserves an occupied compatibility tenant and its account identity while showing the canonical school name', async () => {
    const domain = memoryDomain()
    await domain.table('schools').put('target', school('target', '真实中学'))
    await domain.table('schools').put('legacy', { ...school('legacy', '1234'), canonicalName: '真实中学', rosterAliasOf: 'target' } as School)
    const account = user('legacy', 'student01', 'STUDENT')
    await domain.table('users').put('legacy:student01', account)
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    const login = await service.login({ username: 'student01', password: 'bootstrap-pass' })
    expect(login).toMatchObject({ user: { id: account.id, schoolId: 'legacy', schoolName: '真实中学' } })
    expect(service.listSchoolsAdmin(admin).map(row => row.id)).toEqual(['target'])
    expect(service.searchSchools('真实中学').map(row => row.id)).toEqual(['target'])
    expect(domain.table('users').get('legacy:student01')?.id).toBe(account.id)
  })

  it('keeps a compatibility tenant visible to its own school administrator', async () => {
    const domain = memoryDomain()
    await domain.table('schools').put('target', school('target', '真实中学'))
    await domain.table('schools').put('legacy', { ...school('legacy', '旧学校别名'), canonicalName: '真实中学', rosterAliasOf: 'target' })
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    expect(service.listSchoolsAdmin({ userKey: 'legacy:admin', schoolId: 'legacy', username: 'admin', role: 'SCHOOL_ADMIN' })).toMatchObject([{ id: 'legacy', name: '真实中学' }])
  })

  it('resolves a retained registration alias to the canonical tenant without overwriting the occupied alias', async () => {
    const domain = memoryDomain()
    const name = '贵阳一中'
    const legacyId = `s_${createHash('sha256').update(name).digest('base64url').slice(0, 12)}`
    await domain.table('schools').put('canonical', school('canonical', '贵阳市第一中学'))
    await domain.table('schools').put(legacyId, { ...school(legacyId, name), canonicalName: '贵阳市第一中学', rosterAliasOf: 'canonical' })
    await domain.table('users').put(`${legacyId}:existing`, user(legacyId, 'existing', 'STUDENT'))
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    await expect(service.register(registration(name))).resolves.toMatchObject({ user: { schoolId: 'canonical' } })
    expect(domain.table('schools').get(legacyId)).toMatchObject({ status: 'active', rosterAliasOf: 'canonical' })
    expect(domain.table('users').get(`${legacyId}:existing`)).toBeDefined()
  })

  it('refuses a generated school id already retained by a differently named tenant', async () => {
    const domain = memoryDomain()
    const name = '未收录新学校', reservedId = `s_${createHash('sha256').update(name).digest('base64url').slice(0, 12)}`
    await domain.table('schools').put(reservedId, school(reservedId, '已有账号的学校'))
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    await expect(service.register(registration(name))).rejects.toMatchObject({ code: 'SCHOOL_NOT_FOUND' })
    expect(domain.table('schools').get(reservedId)).toMatchObject({ name: '已有账号的学校', status: 'active' })
  })

  it('does not rebuild a seed retired by an explicit merge tombstone', async () => {
    const row = SEED_SCHOOLS[1]!
    const rows = new Map<string, School>([[row.id, { ...school(row.id, row.name, 'disabled'), mergedInto: 'target' }]])
    await seedSchools(id => rows.get(id), async (id, value) => { rows.set(id, value) })
    expect(rows.get(row.id)?.mergedInto).toBe('target')
  })

  it.each(['unregistered-seed', 'test-fixture'] as const)('retains a durable %s retirement across seeding and hides it from registration', async archiveReason => {
    const seed = SEED_SCHOOLS[1]!
    const retired = authDomain.tables.schools.valueSchema.parse({ ...school(seed.id, seed.name),
      archivedAt: '2026-11-10T00:00:00Z', archiveReason })
    const domain = memoryDomain()
    await domain.table('schools').put(seed.id, retired)
    await seedSchools(id => domain.table('schools').get(id), (id, value) => domain.table('schools').put(id, value))
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    expect(domain.table('schools').get(seed.id)).toMatchObject({ name: seed.name, status: 'active', archiveReason })
    expect(service.listSchoolsAdmin(admin).some(row => row.id === seed.id)).toBe(false)
    expect(service.searchSchools(seed.name).some(row => row.id === seed.id)).toBe(false)
  })

  it('counts the visible platform roster and its own compatibility tenant without losing account totals', async () => {
    const domain = memoryDomain()
    const rows: School[] = [school('target', '真实中学'), school('disabled', '停用的真实中学', 'disabled'),
      { ...school('legacy', '旧别名'), canonicalName: '真实中学', rosterAliasOf: 'target' },
      { ...school('seed', '未注册学校'), archivedAt: '2026-11-10T00:00:00Z', archiveReason: 'unregistered-seed' },
      { ...school('merged', '已迁出中学', 'disabled'), mergedInto: 'target' }]
    for (const row of rows) await domain.table('schools').put(row.id, row)
    for (const account of [user('target', 'student', 'STUDENT'), user('legacy', 'student', 'STUDENT'),
      user('legacy', 'operator', 'SCHOOL_ADMIN')]) {
      await domain.table('users').put(`${account.schoolId}:${account.username}`, account)
    }
    const service = new AuthService(domain, DEFAULT_AUTH_CONFIG)
    const platform = await service.dashboard(admin)
    expect(platform.schools).toEqual({ total: 2, active: 1, disabled: 1 })
    expect(platform.schools.total).toBe(service.listSchoolsAdmin(admin).length)
    expect(platform.users).toMatchObject({ total: 3, byRole: { STUDENT: 2, SCHOOL_ADMIN: 1 } })
    const schoolAdmin = { userKey: 'legacy:operator', schoolId: 'legacy', username: 'operator', role: 'SCHOOL_ADMIN' as const }
    const scoped = await service.dashboard(schoolAdmin)
    expect(scoped.schools).toEqual({ total: 1, active: 1, disabled: 0 })
    expect(service.listSchoolsAdmin(schoolAdmin)).toMatchObject([{ id: 'legacy', name: '真实中学' }])
    expect(scoped.users).toMatchObject({ total: 2, byRole: { STUDENT: 1, SCHOOL_ADMIN: 1 } })
    expect([...domain.table('users').entries()].map(([key]) => key).sort()).toEqual(['legacy:operator', 'legacy:student', 'target:student'])
  })
})
