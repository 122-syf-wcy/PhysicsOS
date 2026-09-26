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
const roleCookie = (role: IdentityRole, schoolId = 'school'): string => `physicsos_session=${role}:${schoolId}`

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
    const match = /physicsos_session=([A-Z_]+):([^;]+)/.exec(header)
    if (match === null) return null
    const [, named, schoolId] = match
    if (!ROLES.includes(named as IdentityRole)) return null
    return {
      userKey: `${schoolId}:${named}`,
      schoolId: schoolId!,
      username: named as string,
      role: named as IdentityRole,
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
    runImageIngest: async (input: { images: readonly unknown[] }) => ({
      created: [], duplicates: [], transcription: `stub:${input.images.length}`,
    }),
    planTriage: (input: { ids?: readonly string[]; limit?: number }, schoolId?: string | null) => service.planBankTriage(input, schoolId),
    runTriage: async () => {},
    triageBusy: () => false,
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

const as = (role: IdentityRole | null, schoolId = 'school') =>
  role === null ? {} : { cookie: roleCookie(role, schoolId) }

/* Default = a teacher: the wire-validation suite below is about bodies, and a
   teacher is who may post them. */
const post = (path: string, body: unknown, role: IdentityRole | null = 'TEACHER', schoolId = 'school') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...as(role, schoolId) },
    body: JSON.stringify(body),
  })

const get = (path: string, role: IdentityRole | null = 'TEACHER', schoolId = 'school') =>
  fetch(`${base}${path}`, { headers: as(role, schoolId) })

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
    const list = await (await get('/sources')).json() as { id: string; enteredBy: string }[]
    expect(list.some(s => s.id === validSource.id && s.enteredBy === 'school:TEACHER')).toBe(true)
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
    const created = await post('/bank/items', item)
    expect(created.status).toBe(201)
    expect((await created.json() as { enteredBy: string }).enteredBy).toBe('school:TEACHER')
    expect((await post('/bank/items', { ...item, id: 'batch-b', stem: '批量核验用题干二（回声测距）' })).status).toBe(201)

    const res = await post('/bank/items/review-batch', {
      ids: ['batch-a', 'batch-b', 'does-not-exist'], status: 'verified', reviewer: '教研组',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { updated: number; missing: string[] }
    expect(body.updated).toBe(2)
    expect(body.missing).toEqual(['does-not-exist'])

    const listed = await (await get('/bank/items?status=verified')).json() as { id: string; verifiedBy?: string }[]
    expect(listed.map(i => i.id)).toEqual(expect.arrayContaining(['batch-a', 'batch-b']))
    expect(listed.find(item => item.id === 'batch-a')?.verifiedBy).toBe('school:TEACHER')
  })

  it('rejects unknown review states instead of silently mapping them to pending', async () => {
    const res = await post('/bank/items/review-batch', { ids: ['batch-a'], status: 'approved' })
    expect(res.status).toBe(400)
  })

  it('rejects an empty batch and one over the per-request cap', async () => {
    expect((await post('/bank/items/review-batch', { ids: [], status: 'verified' })).status).toBe(400)
    const tooMany = Array.from({ length: 501 }, (_, i) => `bulk-${i}`)
    const res = await post('/bank/items/review-batch', { ids: tooMany, status: 'verified' })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BATCH_TOO_LARGE')
  })

  it('accepts image ingest and returns the transcription with the created rows', async () => {
    /* The vision path decodes base64 at the wire boundary — malformed image
       bodies must 400 before any model spend. */
    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const res = await post('/bank/ingest-image', {
      images: [{ data: onePixelPng, mediaType: 'image/png', name: 'page-1.png' }],
      level: 'zhongkao', subject: 'physics', enteredBy: 'spec',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { transcription: string; created: unknown[] }
    expect(body.transcription).toBe('stub:1')
    expect(body.created).toEqual([])
  })

  it('refuses image ingest with no images, a bad media type, or an oversized batch', async () => {
    expect((await post('/bank/ingest-image', { images: [] })).status).toBe(400)
    expect((await post('/bank/ingest-image', {
      images: [{ data: 'AAAA', mediaType: 'application/pdf' }],
    })).status).toBe(400)
    const nine = Array.from({ length: 9 }, () => ({ data: 'AAAA', mediaType: 'image/png' }))
    const res = await post('/bank/ingest-image', { images: nine })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('TOO_MANY_IMAGES')
  })

  it('triage plans pending rows and reports ids that are not pending', async () => {
    /* The engine pass annotates `anomalies` only — status stays a human
       verdict — so the plan must pick pending rows, skip reviewed ones, and
       say which requested ids do not exist at all. */
    const item = {
      level: 'zhongkao', subject: 'physics', kind: 'choice-single',
      knowledge: ['压强'], ability: '理解', difficulty: 'basic', score: 3,
      stem: '初筛用题干（液体压强随深度增加）', options: ['A. 甲', 'B. 乙'],
      answer: { result: 'A', steps: [], gradingPoints: [] },
      answerTier: 'web-public', anomalies: [], reuseModes: ['adapt'], enteredBy: 'spec',
    }
    expect((await post('/bank/items', { ...item, id: 'triage-pending' })).status).toBe(201)
    expect((await post('/bank/items', { ...item, id: 'triage-reviewed', stem: '初筛用题干二（沸点与气压）' })).status).toBe(201)
    await post('/bank/items/triage-reviewed/review', { status: 'verified', reviewer: '教研组' })

    const res = await post('/bank/items/triage', {
      ids: ['triage-pending', 'triage-reviewed', 'gone'],
    })
    expect(res.status).toBe(202)
    const body = await res.json() as { accepted: number; missing: string[]; skipped: string[] }
    expect(body.accepted).toBe(1)
    expect(body.missing).toEqual(['gone'])
    expect(body.skipped).toEqual(['triage-reviewed'])
  })

  it('refuses triage when nothing is pending', async () => {
    /* Pending stock is drained by the case above only in theory — statuses
       move per test, so request an explicit empty pool instead of relying on
       suite order. */
    const res = await post('/bank/items/triage', { ids: ['triage-reviewed'] })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('NOTHING_PENDING')
  })

  it('admits only one triage request while an earlier request is reading its body', async () => {
    const service = new PaperService(fakeDomain)
    await service.addBankItem({
      id: 'triage-concurrency', level: 'zhongkao', subject: 'physics', kind: 'choice-single',
      knowledge: ['声现象'], ability: '理解', difficulty: 'basic', score: 3,
      stem: '并发初筛题（声波传播需要介质）', options: ['A. 甲', 'B. 乙'],
      answer: { result: 'A. 甲', steps: [], gradingPoints: [] },
      answerTier: 'web-public', anomalies: [], reuseModes: ['adapt'], enteredBy: 'spec', schoolId: 'school',
    })
    let running = false
    let release: (() => void) | undefined
    let startedResolve: (() => void) | undefined
    const started = new Promise<void>((resolve) => { startedResolve = resolve })
    const handler = paperRoutes({
      service,
      exportDir: '/tmp/paper-host-spec',
      runDraft: async () => {},
      runChecks: async () => {},
      runRepair: async () => {},
      runReplace: async () => {},
      planReplace: () => ({}),
      runExport: async () => ({ files: {} }),
      runIngest: async () => ({ created: [], duplicates: [] }),
      runImageIngest: async () => ({ created: [], duplicates: [], transcription: '' }),
      planTriage: (input: { ids?: readonly string[]; limit?: number }, schoolId?: string | null) =>
        service.planBankTriage(input, schoolId),
      runTriage: async () => {
        running = true
        startedResolve?.()
        await new Promise<void>((resolve) => { release = resolve })
        running = false
      },
      triageBusy: () => running,
      bankPolicy: {},
      identity: () => stubIdentity(),
    } as never)
    const localServer = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => localServer.listen(0, '127.0.0.1', resolve))
    const localBase = `http://127.0.0.1:${(localServer.address() as AddressInfo).port}/physicsos/paper`
    try {
      const first = await fetch(`${localBase}/bank/items/triage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: roleCookie('TEACHER') },
        body: JSON.stringify({ ids: ['triage-concurrency'] }),
      })
      expect(first.status).toBe(202)
      await started
      const second = await fetch(`${localBase}/bank/items/triage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: roleCookie('TEACHER') },
        body: JSON.stringify({ ids: ['triage-concurrency'] }),
      })
      expect(second.status).toBe(409)
    } finally {
      release?.()
      await new Promise<void>(resolve => localServer.close(() => { resolve() }))
    }
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

  it('lets students read verified bank items with answers, but never unreviewed rows', async () => {
    const item = {
      level: 'zhongkao', subject: 'physics', kind: 'choice-single',
      knowledge: ['声现象'], ability: '理解', difficulty: 'basic', score: 3,
      stem: '学生可见核验题（声音传播需要介质）', options: ['A. 甲', 'B. 乙'],
      answer: { result: 'A. 甲', steps: [], gradingPoints: [] },
      answerTier: 'web-public', anomalies: [], reuseModes: ['adapt'], enteredBy: 'untrusted',
    }
    expect((await post('/bank/items', { ...item, id: 'student-visible' })).status).toBe(201)
    expect((await post('/bank/items', { ...item, id: 'student-hidden', stem: '待核验题' })).status).toBe(201)
    expect((await post('/bank/items/student-visible/review', {
      status: 'verified', reviewer: 'forged-reviewer',
    })).status).toBe(200)

    const res = await get('/bank/items?status=pending', 'STUDENT')
    expect(res.status).toBe(200)
    const rows = await res.json() as { id: string; status: string; answer: unknown }[]
    expect(rows.every(row => row.status === 'verified')).toBe(true)
    expect(rows.map(row => row.id)).toContain('student-visible')
    expect(rows.map(row => row.id)).not.toContain('student-hidden')
    expect(rows.find(row => row.id === 'student-visible')).toMatchObject({
      status: 'verified', answer: item.answer,
    })
  })

  it('serves only verified library records to students and redacts staff attribution', async () => {
    const visibleSource = { ...validSource, id: 'student-source-visible', sourceRef: '/private/archive.pdf' }
    const hiddenSource = { ...validSource, id: 'student-source-hidden' }
    expect((await post('/sources', visibleSource)).status).toBe(201)
    expect((await post('/sources', hiddenSource)).status).toBe(201)
    expect((await post('/sources/student-source-visible/verify', { reviewer: 'forged' })).status).toBe(200)

    const annotation = {
      questionNo: '1', subject: 'physics', kind: 'choice-single', score: 3,
      knowledgePrimary: '声音', knowledgeSecondary: [], ability: '理解',
      answerSource: 'web-public', reviewer: 'forged',
    }
    expect((await post('/sources/student-source-visible/annotations', {
      ...annotation, id: 'student-note-visible',
    })).status).toBe(201)
    const staffRows = await (await get('/annotations?source=student-source-visible', 'TEACHER')).json() as
      { id: string; reviewer: string }[]
    expect(staffRows.find(row => row.id === 'student-note-visible')?.reviewer).toBe('school:TEACHER')
    expect((await post('/sources/student-source-hidden/annotations', {
      ...annotation, id: 'student-note-hidden',
    })).status).toBe(201)
    expect((await post('/annotations/student-note-visible/review', { status: 'verified' })).status).toBe(200)

    const sources = await (await get('/sources', 'STUDENT')).json() as {
      id: string
      status: string
      sourceRef: string
      enteredBy: string
    }[]
    expect(sources.map(row => row.id)).toContain('student-source-visible')
    expect(sources.map(row => row.id)).not.toContain('student-source-hidden')
    expect(sources.find(row => row.id === 'student-source-visible')).toMatchObject({
      status: 'verified', sourceRef: '', enteredBy: '',
    })

    const annotations = await (await get('/annotations', 'STUDENT')).json() as {
      id: string
      status: string
      reviewer: string
    }[]
    expect(annotations.map(row => row.id)).toContain('student-note-visible')
    expect(annotations.map(row => row.id)).not.toContain('student-note-hidden')
    expect(annotations.find(row => row.id === 'student-note-visible')).toMatchObject({
      status: 'verified', reviewer: '',
    })
    expect((await get('/jobs', 'STUDENT')).status).toBe(403)
    expect((await get('/blueprints', 'STUDENT')).status).toBe(403)
  })

  it('isolates new source, annotation, bank, blueprint, and job rows by school', async () => {
    const sourceA = { ...validSource, id: 'tenant-source-a', sourceRef: '/private/a.pdf' }
    const sourceB = { ...validSource, id: 'tenant-source-b', sourceRef: '/private/b.pdf' }
    expect((await post('/sources', sourceA, 'TEACHER', 'SCHOOL-A')).status).toBe(201)
    expect((await post('/sources', sourceB, 'TEACHER', 'SCHOOL-B')).status).toBe(201)
    await post('/sources/tenant-source-a/verify', {}, 'TEACHER', 'SCHOOL-A')
    await post('/sources/tenant-source-b/verify', {}, 'TEACHER', 'SCHOOL-B')

    const annotation = {
      questionNo: '1', subject: 'physics', kind: 'choice-single', score: 3,
      knowledgePrimary: '声现象', knowledgeSecondary: [], ability: '理解',
      answerSource: 'web-public', reviewer: 'forged',
    }
    for (const [schoolId, sourceId] of [['SCHOOL-A', 'tenant-source-a'], ['SCHOOL-B', 'tenant-source-b']]) {
      const created = await post(`/sources/${sourceId}/annotations`, {
        ...annotation, id: `tenant-note-${schoolId}`,
      }, 'TEACHER', schoolId)
      expect(created.status).toBe(201)
      await post(`/annotations/tenant-note-${schoolId}/review`, { status: 'verified' }, 'TEACHER', schoolId)
    }

    const bankItem = {
      level: 'zhongkao', subject: 'physics', kind: 'choice-single', knowledge: ['声现象'],
      ability: '理解', difficulty: 'basic', score: 3, stem: 'SCHOOL-A 专属题干（声波传播需要介质）',
      options: ['A. 甲', 'B. 乙'], answer: { result: 'A', steps: [], gradingPoints: [] },
      answerTier: 'web-public', anomalies: [], reuseModes: ['adapt'], enteredBy: 'forged',
      sourcePaperId: 'tenant-source-a',
    }
    expect((await post('/bank/items', { ...bankItem, id: 'tenant-bank-a' }, 'TEACHER', 'SCHOOL-A')).status).toBe(201)
    await post('/bank/items/tenant-bank-a/review', { status: 'verified' }, 'TEACHER', 'SCHOOL-A')
    const schoolAItems = await (await get('/bank/items', 'STUDENT', 'SCHOOL-A')).json() as { id: string }[]
    const schoolBItems = await (await get('/bank/items', 'STUDENT', 'SCHOOL-B')).json() as { id: string }[]
    expect(schoolAItems.map(row => row.id)).toContain('tenant-bank-a')
    expect(schoolBItems.map(row => row.id)).not.toContain('tenant-bank-a')
    expect((await post('/bank/items/tenant-bank-a/review', {
      status: 'rejected', reviewer: 'forged',
    }, 'TEACHER', 'SCHOOL-B')).status).toBe(404)

    const blueprint = {
      id: 'tenant-blueprint-a', level: 'zhongkao', subject: 'physics', title: 'A 校训练卷',
      totalScore: 90, minutes: 120, sections: [], basedOn: [],
    }
    expect((await post('/blueprints', blueprint, 'TEACHER', 'SCHOOL-A')).status).toBe(201)
    expect((await post('/blueprints/tenant-blueprint-a/verify', {}, 'TEACHER', 'SCHOOL-A')).status).toBe(200)
    const request = {
      level: 'zhongkao', subjects: ['physics'], kind: 'mock', totalScore: 90, minutes: 120,
      chapters: [], exclude: [], difficulty: { basic: 1, medium: 0, hard: 0 },
      targetYear: 2026, textbook: '人教版',
    }
    const createdJob = await post('/jobs', {
      blueprintId: 'tenant-blueprint-a', request,
    }, 'TEACHER', 'SCHOOL-A')
    expect(createdJob.status).toBe(201)
    const job = await createdJob.json() as { id: string }
    const schoolBJobs = await (await get('/jobs', 'TEACHER', 'SCHOOL-B')).json() as { id: string }[]
    expect(schoolBJobs.map(row => row.id)).not.toContain(job.id)
    expect((await get(`/jobs/${job.id}`, 'TEACHER', 'SCHOOL-B')).status).toBe(404)

    const sourceAList = await (await get('/sources', 'TEACHER', 'SCHOOL-A')).json() as { id: string }[]
    const sourceBList = await (await get('/sources', 'TEACHER', 'SCHOOL-B')).json() as { id: string }[]
    expect(sourceAList.map(row => row.id)).toContain('tenant-source-a')
    expect(sourceAList.map(row => row.id)).not.toContain('tenant-source-b')
    expect(sourceBList.map(row => row.id)).toContain('tenant-source-b')
    expect(sourceBList.map(row => row.id)).not.toContain('tenant-source-a')
  })

  it('rejects a cross-origin JSON write even when the caller has a session', async () => {
    const res = await fetch(`${base}/physicsos/paper/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', ...as('TEACHER') },
      body: JSON.stringify(validSource),
    })
    expect(res.status).toBe(403)
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
