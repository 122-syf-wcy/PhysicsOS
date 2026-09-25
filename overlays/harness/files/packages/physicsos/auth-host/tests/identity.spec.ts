/**
 * The identity seam between the two hosts.
 *
 * `paper-host` guards the whole 出卷专区 by asking the 账户体系 who is calling,
 * and the two packages deliberately do not import each other — paper-host looks
 * the service up by NAME on the cordis context. That leaves exactly one way this
 * can break silently: the two sides disagreeing about the name. Nothing at
 * compile time connects them, so these cases do it at test time:
 *
 *   - the two constants are the same string
 *   - the REAL resolver turns a REAL session into the right actor
 *   - a forged or expired cookie resolves to nobody, so the guard fails closed
 *   - the audit door files under the actor's own school
 *
 * The guard logic itself (401 / 403 / 503) lives in `paper-host/tests/routes.spec.ts`,
 * which stubs this service. Between them the seam is covered from both sides.
 */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { AuthService } from '../src/service.ts'
import { createIdentityService, IDENTITY_SERVICE } from '../src/identity.ts'
import { hashPassword } from '../src/passwords.ts'
import { userKey } from '../src/domain.ts'
import type { AuthDomain, School, UserRecord } from '../src/domain.ts'
/* Imported by relative path on purpose: paper-host is NOT a dependency of this
   package, and a test is the only place the two names should ever meet. */
import { IDENTITY_SERVICE as PAPER_HOST_EXPECTS } from '../../paper-host/src/identity.ts'

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

const now = new Date().toISOString()
const school: School = {
  id: 'sch-identity',
  name: '身份联通测试中学',
  shortName: '身份中学',
  status: 'active',
  createdAt: now,
}

const teacher: UserRecord = {
  id: 'u_sch-identity_teacher1',
  schoolId: school.id,
  username: 'teacher1',
  passwordHash: hashPassword('correct-horse'),
  displayName: '张老师',
  role: 'TEACHER',
  status: 'active',
  createdAt: now,
}

void fakeDomain.table('schools').put(school.id, school)
void fakeDomain.table('users').put(userKey(school.id, teacher.username), teacher)

const service = new AuthService(fakeDomain)
const identity = createIdentityService(service)

/** A request carrying whatever cookie the case wants to test. */
const requestWith = (cookie: string | undefined): IncomingMessage =>
  ({ headers: cookie === undefined ? {} : { cookie } }) as IncomingMessage

const logIn = async (): Promise<string> =>
  (await service.login({ username: teacher.username, password: 'correct-horse', schoolId: school.id })).token

describe('identity service', () => {
  it('is published under the name the paper host looks up', () => {
    /* The seam, asserted where it lives: two independent constants in two
       independent packages. A rename on either side fails HERE rather than in
       production as a 出卷专区 that answers 503 to everyone. */
    expect(IDENTITY_SERVICE).toBe(PAPER_HOST_EXPECTS)
    expect(IDENTITY_SERVICE).toBe('physicsosIdentity')
  })

  it('resolves a real session into the acting account, with its server-side role', async () => {
    const token = await logIn()
    const actor = identity.actorOf(requestWith(`physicsos_session=${token}`))
    expect(actor).toEqual({
      userKey: `${school.id}:${teacher.username}`,
      schoolId: school.id,
      username: teacher.username,
      role: 'TEACHER',
    })
  })

  it('resolves nobody for no cookie, an unknown token, or a revoked session', async () => {
    expect(identity.actorOf(requestWith(undefined))).toBeNull()
    expect(identity.actorOf(requestWith('physicsos_session=not-a-real-token'))).toBeNull()
    /* A revoked session is the interesting one: the token is well-formed and
       WAS valid, so a guard that only checked the format would still let the
       write through. */
    const token = await logIn()
    await service.logout(token)
    expect(identity.actorOf(requestWith(`physicsos_session=${token}`))).toBeNull()
  })

  it('resolves nobody once the account is disabled under a live session', async () => {
    /* The sequence that matters is not "can a disabled account log in" — login
       already refuses that — but "what happens to the session it already had".
       So: sign in while active, then flip the switch, which is exactly what an
       admin does when a device goes missing. */
    const token = await logIn()
    expect(identity.actorOf(requestWith(`physicsos_session=${token}`))).not.toBeNull()

    void fakeDomain.table('users').put(userKey(school.id, teacher.username), {
      ...teacher, status: 'disabled',
    })
    expect(identity.actorOf(requestWith(`physicsos_session=${token}`))).toBeNull()
    void fakeDomain.table('users').put(userKey(school.id, teacher.username), teacher)
  })

  it('resolves nobody once the school is disabled under a live session', async () => {
    /* Same switch one level up: disabling a school has to kill every session
       under it, or the tenant control is decorative. */
    const token = await logIn()
    expect(identity.actorOf(requestWith(`physicsos_session=${token}`))).not.toBeNull()

    void fakeDomain.table('schools').put(school.id, { ...school, status: 'disabled' })
    expect(identity.actorOf(requestWith(`physicsos_session=${token}`))).toBeNull()
    void fakeDomain.table('schools').put(school.id, school)
  })

  it('files an audit row under the actor’s own school', async () => {
    const token = await logIn()
    const actor = identity.actorOf(requestWith(`physicsos_session=${token}`))
    if (actor === null) throw new Error('expected a resolved actor')

    await identity.record(actor, 'paper.post', '/sources', { method: 'POST', status: 201 })

    const admin: Parameters<AuthService['listAudit']>[0] = {
      userKey: 'PHYSICSOS-OPEN:admin',
      schoolId: school.id,
      username: 'admin',
      role: 'SUPER_ADMIN',
    }
    const rows = service.listAudit(admin, {}).filter(event => event.action === 'paper.post')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorKey: `${school.id}:${teacher.username}`,
      schoolId: school.id,
      action: 'paper.post',
      target: '/sources',
      detail: { method: 'POST', status: 201 },
    })
  })
})
