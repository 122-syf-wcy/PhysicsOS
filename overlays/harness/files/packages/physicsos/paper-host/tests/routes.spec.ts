/**
 * Route-level wire-validation spec: every body that would land in the durable
 * domain is parsed at the HTTP boundary — malformed payloads must 400, never
 * persist. Runs a real http server over a Map-backed domain stub.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PaperService } from '../src/service.ts'
import { paperRoutes } from '../src/routes.ts'
import type { PaperDomain } from '../src/domain.ts'

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

const fakeDomain = {
  table: (name: string) => {
    const tables = (fakeDomain as unknown as { _tables: Map<string, ReturnType<typeof table<unknown>>> })._tables
    return (tables.get(name) ?? tables.set(name, table()).get(name)!) as never
  },
  _tables: new Map<string, ReturnType<typeof table<unknown>>>(),
} as unknown as PaperDomain

let server: Server
let base: string

beforeAll(async () => {
  const service = new PaperService(fakeDomain)
  const handler = paperRoutes({
    service,
    exportDir: '/tmp/paper-host-spec',
    runDraft: async () => {},
    runChecks: async () => {},
    runExport: async () => ({ files: {} }),
  })
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/physicsos/paper`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

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
    const list = await (await fetch(`${base}/sources`)).json() as { id: string }[]
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
    const list = await (await fetch(`${base}/annotations`)).json() as unknown[]
    expect(list.length).toBe(0)
  })

  it('rejects a multi-row CSV atomically — a bad row persists nothing', async () => {
    const res = await post('/import/csv', {
      sourcePaperId: validSource.id,
      csv: '5,物理,blank,2,密度,,识记,1\n6,物理,bogus,3,压强,,应用,2',
      reviewer: 'tester',
    })
    expect(res.status).toBe(400)
    const list = await (await fetch(`${base}/annotations?source=${validSource.id}`)).json() as { questionNo: string }[]
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

    const listed = await (await fetch(`${base}/bank/items?status=verified`)).json() as { id: string }[]
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
