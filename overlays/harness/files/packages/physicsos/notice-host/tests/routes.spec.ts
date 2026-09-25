/**
 * Route-level spec for 反馈与公告 over a real http server.
 *
 * The identity service is stubbed — the REAL resolver (cookie →
 * `AuthService.resolveSession` → actor) is proved in the composition spec, and
 * this suite is about the rules this host owns:
 *
 *   - who may submit (anyone signed in), who may reply (teacher and above),
 *     who may publish (school admin and above);
 *   - a STUDENT's feedback list is their OWN rows, not the tenant queue — a
 *     row filter the service owns, and the single easiest thing to get wrong;
 *   - a SCHOOL_ADMIN cannot reach another tenant, by list or by reply;
 *   - a refused write files nothing in the ledger.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NoticeService } from '../src/service.ts'
import { noticeRoutes } from '../src/routes.ts'
import type { noticeDomain } from '../src/domain.ts'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { IdentityActor, IdentityRole, PhysicsosIdentity } from '../src/identity.ts'

const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => { map.set(id, record) },
    entries: () => map.entries(),
    delete: async (id: string) => map.delete(id),
  }
}

const makeDomain = (): Domain<typeof noticeDomain> => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = table<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as Domain<typeof noticeDomain>
}

/** The cookie names the role and tenant directly — only the interpretation of
 *  the credential is faked, never the guard that reads it. */
const ROLES: readonly IdentityRole[] = ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']

const ledger: { action: string; target: string; actor: string }[] = []

const stubIdentity = (): PhysicsosIdentity => ({
  actorOf: (req) => {
    const header = req.headers.cookie ?? ''
    /* `[A-Z_]+` — the role names carry underscores (SCHOOL_ADMIN). */
    const match = /physicsos_session=([A-Z_]+):([^;]+)/.exec(header)
    if (match === null) return null
    const [, role, schoolId] = match
    if (!ROLES.includes(role as IdentityRole)) return null
    return {
      userKey: `${schoolId}:u-${role}`,
      schoolId: schoolId!,
      username: `u-${role}`,
      role: role as IdentityRole,
    } satisfies IdentityActor
  },
  record: async (actor, action, target) => {
    ledger.push({ action, target, actor: actor.userKey })
  },
})

let server: Server
let base: string

beforeAll(async () => {
  const domain = makeDomain()
  const service = new NoticeService(domain)
  const identity = stubIdentity()
  const handler = noticeRoutes({ service, identity: () => identity })
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

/**
 * One request helper. Headers are ASSEMBLED rather than spread: `RequestInit.headers`
 * is `HeadersInit` (it may be an array of pairs), and spreading that into an
 * object silently produces index keys instead of headers.
 */
const call = (path: string, role: IdentityRole | null, init: RequestInit = {}, schoolId = 'GZU') => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (role !== null) headers.set('cookie', `physicsos_session=${role}:${schoolId}`)
  return fetch(`${base}/physicsos/notice${path}`, { ...init, headers })
}

const json = (role: IdentityRole | null, path: string, body: unknown, schoolId = 'GZU') =>
  call(path, role, { method: 'POST', body: JSON.stringify(body) }, schoolId)

const settle = () => new Promise(resolve => setTimeout(resolve, 30))

describe('反馈与公告 — the gate', () => {
  it('refuses an anonymous read', async () => {
    const res = await call('/announcements', null)
    expect(res.status).toBe(401)
  })

  it('refuses an anonymous report', async () => {
    const res = await json(null, '/feedback', { kind: 'bug', body: 'x' })
    expect(res.status).toBe(401)
  })

  it('lets a student file a report — that is who has them', async () => {
    const res = await json('STUDENT', '/feedback', {
      kind: 'bug', body: '实验中心的滑轮没画出来', context: '/lab',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { item: { authorKey: string; status: string } }
    expect(body.item.authorKey).toBe('GZU:u-STUDENT')
    expect(body.item.status).toBe('open')
  })

  it('refuses a student publishing an announcement', async () => {
    const res = await json('STUDENT', '/announcements', { title: 'x', body: 'y' })
    expect(res.status).toBe(403)
  })

  it('lets a school admin publish to their own tenant', async () => {
    const res = await json('SCHOOL_ADMIN', '/announcements', { title: '开学通知', body: '本周一起' })
    expect(res.status).toBe(201)
    const body = await res.json() as { item: { schoolId: string | null } }
    expect(body.item.schoolId).toBe('GZU')
  })
})

describe('反馈 — who sees which rows', () => {
  it('gives a student their OWN reports, not the tenant queue', async () => {
    /* A second account files a report in the same tenant. The student's list
       must be theirs alone: this is the filter that would leak one student's
       report to another if it were written as "same school". */
    await json('TEACHER', '/feedback', { kind: 'content', body: '教师的报告' })

    const res = await call('/feedback', 'STUDENT')
    expect(res.status).toBe(200)
    const body = await res.json() as { items: { authorKey: string }[] }
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every(row => row.authorKey === 'GZU:u-STUDENT')).toBe(true)
  })

  it('gives a teacher the whole tenant', async () => {
    const res = await call('/feedback', 'TEACHER')
    const body = await res.json() as { items: { authorKey: string }[] }
    expect(body.items.some(row => row.authorKey.startsWith('GZU:u-STUDENT'))).toBe(true)
    expect(body.items.some(row => row.authorKey.startsWith('GZU:u-TEACHER'))).toBe(true)
  })

  it('does not show one tenant another tenant\'s reports', async () => {
    await json('STUDENT', '/feedback', { kind: 'idea', body: 'GZNU 的想法' }, 'GZNU')
    const res = await call('/feedback', 'TEACHER', {}, 'GZU')
    const body = await res.json() as { items: { schoolId: string }[] }
    expect(body.items.every(row => row.schoolId === 'GZU')).toBe(true)
  })

  it('lets a teacher reply, and a student cannot', async () => {
    const listed = await (await call('/feedback', 'TEACHER')).json() as { items: { id: string }[] }
    const target = listed.items[0]!.id

    expect((await json('STUDENT', `/feedback/${target}/reply`, { reply: 'nope' })).status).toBe(403)

    const replied = await json('TEACHER', `/feedback/${target}/reply`, { reply: '已修复,谢谢反馈' })
    expect(replied.status).toBe(200)
    const body = await replied.json() as { item: { status: string; reply: string; repliedBy: string } }
    expect(body.item.status).toBe('answered')
    expect(body.item.reply).toBe('已修复,谢谢反馈')
    expect(body.item.repliedBy).toBe('GZU:u-TEACHER')
  })

  it('refuses a cross-tenant reply', async () => {
    const other = await call('/feedback', 'TEACHER', {}, 'GZNU')
    const body = await other.json() as { items: { id: string }[] }
    const foreign = body.items[0]!.id
    /* A GZU teacher naming a GZNU row: 403, not 404 — the row exists and the
       caller is not entitled to know more than that. */
    expect((await json('TEACHER', `/feedback/${foreign}/reply`, { reply: 'x' })).status).toBe(403)
  })
})

describe('公告 — scope', () => {
  it('serves a tenant notice only to that tenant, and the platform one to all', async () => {
    await json('SUPER_ADMIN', '/announcements', { title: '平台公告', body: '全站', schoolId: null })

    const gzu = await (await call('/announcements', 'STUDENT', {}, 'GZU')).json() as
      { items: { title: string; schoolId: string | null }[] }
    expect(gzu.items.some(row => row.title === '开学通知')).toBe(true)
    expect(gzu.items.some(row => row.title === '平台公告')).toBe(true)

    const gznu = await (await call('/announcements', 'STUDENT', {}, 'GZNU')).json() as
      { items: { title: string }[] }
    expect(gznu.items.some(row => row.title === '开学通知')).toBe(false)
    expect(gznu.items.some(row => row.title === '平台公告')).toBe(true)
  })

  it('ignores a school admin naming another tenant', async () => {
    /* Resolved rather than validated: there is no value a school admin could
       send that would address someone else's school. */
    const res = await json('SCHOOL_ADMIN', '/announcements', {
      title: '越权尝试', body: 'x', schoolId: 'GZNU',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { item: { schoolId: string | null } }
    expect(body.item.schoolId).toBe('GZU')
  })

  it('stops serving a retired notice', async () => {
    const listed = await (await call('/announcements', 'SCHOOL_ADMIN')).json() as
      { items: { id: string; title: string }[] }
    const own = listed.items.find(row => row.title === '开学通知')!
    expect((await json('SCHOOL_ADMIN', `/announcements/${own.id}/retire`, {})).status).toBe(200)

    const after = await (await call('/announcements', 'STUDENT')).json() as { items: { title: string }[] }
    expect(after.items.some(row => row.title === '开学通知')).toBe(false)
  })
})

describe('the ledger', () => {
  it('files a successful write under the acting account', async () => {
    ledger.length = 0
    expect((await json('TEACHER', '/feedback', { kind: 'other', body: '记账测试' })).status).toBe(201)
    await settle()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.action).toBe('notice.post')
    expect(ledger[0]!.actor).toBe('GZU:u-TEACHER')
  })

  it('files nothing for a refused write', async () => {
    ledger.length = 0
    expect((await json('STUDENT', '/announcements', { title: 'x', body: 'y' })).status).toBe(403)
    expect((await json(null, '/feedback', { kind: 'bug', body: 'x' })).status).toBe(401)
    await settle()
    expect(ledger).toEqual([])
  })
})

describe('the payload shape', () => {
  it('rejects a report with no body', async () => {
    const res = await json('STUDENT', '/feedback', { kind: 'bug' })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown kind rather than defaulting it', async () => {
    const res = await json('STUDENT', '/feedback', { kind: 'praise', body: 'x' })
    expect(res.status).toBe(400)
  })

  it('answers 404 for an unknown path', async () => {
    expect((await call('/nope', 'STUDENT')).status).toBe(404)
  })
})
