/**
 * Route-level wire-validation spec: every body that would land in the durable
 * domain is parsed at the HTTP boundary — malformed payloads must 400, never
 * persist. Runs a real http server over a Map-backed domain stub.
 *
 * The identity service is stubbed, not absent: the 账户体系 is another host and
 * this suite is about body parsing, so the stub resolves the session cookie to
 * the role it names. The REAL resolver — cookie → AuthService.resolveSession →
 * actor — is proved in `auth-host/tests/composition.spec.ts`, which wires both
 * hosts together and asserts the guard answers on a live session.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PaperService } from '../src/service.ts'
import { paperRoutes } from '../src/routes.ts'
import type { PaperDomain } from '../src/domain.ts'
import type { IdentityActor, IdentityRole, PhysicsosIdentity } from '../src/identity.ts'

/* Map-backed stand-in for Domain<typeof paperDomain> — the service only uses
   table().get/put/entries, so a plain Map satisfies it. */
const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => { map.set(id, record) },
    entries: () => map.entries(),
  }
}

/* One table per domain name, closed over rather than hung off the object:
   a self-referential `_tables` field forces every read through an `as`
   assertion, which is exactly the shape the lint rule (rightly) refuses. */
const makeFakeDomain = (): PaperDomain => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = table<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as PaperDomain
}

const fakeDomain = makeFakeDomain()

const ROLES: readonly IdentityRole[] = ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']

/** The cookie the stub reads; the real one carries an opaque token. */
const roleCookie = (role: IdentityRole): string => `physicsos_session=${role}`

/** Every ledger row the route layer filed, in order. */
const ledger: { action: string; target: string; actor: string }[] = []

/**
 * Stand-in for the identity service: the cookie names the role directly.
 *
 * The same shape the real one answers with, so the guard under test is the
 * guard that ships — only the credential's interpretation is faked.
 */
const stubIdentity = (): PhysicsosIdentity => ({
  actorOf: (req) => {
    const header = req.headers.cookie ?? ''
    const named = ROLES.find(role => header.includes(roleCookie(role)))
    if (named === undefined) return null
    return {
      userKey: `school:${named}`,
      schoolId: 'school',
      username: named,
      role: named,
    } satisfies IdentityActor
  },
  record: async (actor, action, target) => {
    ledger.push({ action, target, actor: actor.userKey })
  },
})

/** A configured host: identity present unless a test says otherwise. */
const identityFor = (enabled: boolean): (() => PhysicsosIdentity | undefined) =>
  enabled ? stubIdentity : () => undefined

let server: Server
let base: string

/** Restart the handler with the identity service present or absent. */
const bootWith = async (identity: () => PhysicsosIdentity | undefined): Promise<void> => {
  if (server !== undefined) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  const service = new PaperService(fakeDomain)
  const handler = paperRoutes({
    service,
    exportDir: '/tmp/paper-host-spec',
    runDraft: async () => {},
    runChecks: async () => {},
    runExport: async () => ({ files: {} }),
    identity,
  } as never)
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/physicsos/paper`
}

beforeAll(async () => {
  await bootWith(identityFor(true))
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

const as = (role: IdentityRole | null) =>
  role === null ? {} : { cookie: roleCookie(role) }

/* Default = a teacher: the wire-validation suite below is about bodies, and a
   teacher is who may post them. */
const post = (path: string, body: unknown, role: IdentityRole | null = 'TEACHER') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...as(role) },
    body: JSON.stringify(body),
  })

const get = (path: string, role: IdentityRole | null = 'TEACHER') =>
  fetch(`${base}${path}`, { headers: as(role) })

const validSource = {
  id: 'gz-zk-2024-lz',
  level: 'zhongkao',
  subject: 'combined',
  year: 2024,
  examName: '2024 年贵州省初中学业水平考试·理科综合',
  evidenceTier: 'original-scan',
  sourceRef: '教研组存档/2024-gz-zk.pdf',
  enteredBy: 'tester',
}

describe('paper routes — wire validation', () => {
  it('rejects a source with the wrong level enum', async () => {
    const res = await post('/sources', { ...validSource, level: 'junior' })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BAD_BODY')
  })

  it('rejects a source missing examName/sourceRef (old field names)', async () => {
    const res = await post('/sources', {
      id: 'legacy-1', level: 'zhongkao', subject: 'physics', year: 2024,
      title: '旧字段', evidenceTier: 'original-scan',
    })
    expect(res.status).toBe(400)
  })

  it('accepts a well-formed source and lists it', async () => {
    const res = await post('/sources', validSource)
    expect(res.status).toBe(201)
    const list = await (await get('/sources')).json() as { id: string }[]
    expect(list.some(s => s.id === validSource.id)).toBe(true)
  })

  it('rejects an annotation with an unknown question kind', async () => {
    const res = await post(`/sources/${validSource.id}/annotations`, {
      id: 'a-1', questionNo: '1', subject: 'physics', kind: 'essay',
      score: 3, knowledgePrimary: '浮力', knowledgeSecondary: [],
      ability: '应用', answerSource: 'manual-transcript', reviewer: 'tester',
    })
    expect(res.status).toBe(400)
  })

  it('rejects a CSV row with an illegal kind instead of persisting it', async () => {
    const res = await post('/import/csv', {
      sourcePaperId: validSource.id,
      csv: '9,物理,not-a-kind,3,浮力,,应用,2',
      reviewer: 'tester',
    })
    expect(res.status).toBe(400)
    /* And nothing leaked into the annotations table. */
    const list = await (await get('/annotations')).json() as unknown[]
    expect(list.length).toBe(0)
  })

  it('rejects a multi-row CSV atomically — a bad row persists nothing', async () => {
    const res = await post('/import/csv', {
      sourcePaperId: validSource.id,
      csv: '5,物理,blank,2,密度,,识记,1\n6,物理,bogus,3,压强,,应用,2',
      reviewer: 'tester',
    })
    expect(res.status).toBe(400)
    const list = await (await get(`/annotations?source=${validSource.id}`)).json() as { questionNo: string }[]
    expect(list.some(a => a.questionNo === '5')).toBe(false)
  })

  it('imports a well-formed CSV row', async () => {
    const res = await post('/import/csv', {
      sourcePaperId: validSource.id,
      csv: '1,物理,choice-single,3,参照物,运动描述,理解,1',
      reviewer: 'tester',
    })
    expect(res.status).toBe(201)
    expect((await res.json() as { created: number }).created).toBe(1)
  })

  it('rejects a job create body without blueprintId', async () => {
    const res = await post('/jobs', { request: {} })
    expect(res.status).toBe(400)
  })

  it('batch-reviews many bank items in one request and reports unknown ids', async () => {
    /* The bulk-import path lands hundreds of `pending` rows while the assembler
       reads only `verified` ones, so a batch verdict is the difference between
       imported data being usable and being inert. Unknown ids must be reported,
       never silently dropped. */
    const item = {
      id: 'batch-a', level: 'zhongkao', subject: 'physics', kind: 'choice-single',
      knowledge: ['声现象'], ability: '理解', difficulty: 'basic', score: 3,
      stem: '批量核验用题干（声音的传播需要介质）', options: ['A. 甲', 'B. 乙'],
      answer: { result: 'A. 甲', steps: [], gradingPoints: [] },
      answerTier: 'web-public', anomalies: [], reuseModes: ['adapt'], enteredBy: 'spec',
    }
    expect((await post('/bank/items', item)).status).toBe(201)
    expect((await post('/bank/items', { ...item, id: 'batch-b', stem: '批量核验用题干二（回声测距）' })).status).toBe(201)

    const res = await post('/bank/items/review-batch', {
      ids: ['batch-a', 'batch-b', 'does-not-exist'], status: 'verified', reviewer: '教研组',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { updated: number; missing: string[] }
    expect(body.updated).toBe(2)
    expect(body.missing).toEqual(['does-not-exist'])

    const listed = await (await get('/bank/items?status=verified')).json() as { id: string }[]
    expect(listed.map(i => i.id)).toEqual(expect.arrayContaining(['batch-a', 'batch-b']))
  })

  it('rejects an empty batch and one over the per-request cap', async () => {
    expect((await post('/bank/items/review-batch', { ids: [], status: 'verified' })).status).toBe(400)
    const tooMany = Array.from({ length: 501 }, (_, i) => `bulk-${i}`)
    const res = await post('/bank/items/review-batch', { ids: tooMany, status: 'verified' })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BATCH_TOO_LARGE')
  })

  it('returns NO_ROUTE for unknown paths', async () => {
    const res = await post('/sources/x/review', {})
    expect(res.status).toBe(404)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('NO_ROUTE')
  })
})

/**
 * The gate in front of every route above.
 *
 * Until this existed the whole 出卷专区 served to anyone who could reach the
 * port — 392 questions, every paper built from them, and a write path into the
 * bank. These cases pin the three answers that matter: who may read, who may
 * write, and what happens when the 账户体系 is not there at all.
 */
describe('paper routes — identity gate', () => {
  /* `finish` fires after the response is on the wire, so the ledger write it
     triggers is one tick behind the fetch that caused it. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 30))

  it('refuses an anonymous read', async () => {
    const res = await get('/sources', null)
    expect(res.status).toBe(401)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED')
  })

  it('refuses an anonymous write', async () => {
    const res = await post('/bank/items', { id: 'anon-write' }, null)
    expect(res.status).toBe(401)
  })

  it('lets a student read', async () => {
    /* Reading the bank is not a privilege; it is what the shelf is. */
    const res = await get('/bank/items', 'STUDENT')
    expect(res.status).toBe(200)
  })

  it('refuses a student write', async () => {
    const res = await post('/bank/items', { id: 'student-write' }, 'STUDENT')
    expect(res.status).toBe(403)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
  })

  it('lets every teaching role write', async () => {
    for (const role of ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'] as const) {
      const res = await post('/sources', { ...validSource, id: `gate-${role}` }, role)
      expect(res.status, role).toBe(201)
    }
  })

  it('files every successful write in the ledger, under the acting account', async () => {
    ledger.length = 0
    expect((await post('/sources', { ...validSource, id: 'audited-1' })).status).toBe(201)
    await settle()
    expect(ledger).toEqual([
      { action: 'paper.post', target: '/sources', actor: 'school:TEACHER' },
    ])
  })

  it('files nothing for a write that was refused', async () => {
    /* The trail records what HAPPENED. A 400 is not an event, and a ledger that
       logged attempts would make "who changed the bank" unreadable. */
    ledger.length = 0
    expect((await post('/sources', { ...validSource, level: 'junior' })).status).toBe(400)
    expect((await post('/bank/items', { id: 'x' }, 'STUDENT')).status).toBe(403)
    await settle()
    expect(ledger).toEqual([])
  })

  it('refuses everything with a reason when the 账户体系 is not mounted', async () => {
    /* 503, not 401: the request is not the problem, the deployment is — and the
       message has to say so, because the alternative is an operator staring at
       a login form that cannot possibly work. */
    await bootWith(identityFor(false))
    try {
      const res = await get('/sources')
      expect(res.status).toBe(503)
      expect((await res.json() as { error: { code: string } }).error.code)
        .toBe('IDENTITY_UNAVAILABLE')
      /* And the write path is closed too, not just the read. */
      expect((await post('/sources', { ...validSource, id: 'no-identity' })).status).toBe(503)
    } finally {
      await bootWith(identityFor(true))
    }
  })
})
