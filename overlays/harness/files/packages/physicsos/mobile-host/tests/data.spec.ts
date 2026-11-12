/** Real business facades across the mobile wire; only auth resolution and durable I/O are fixtures. */
import { describe, expect, it } from 'vitest'
import { documentHash, type PaperDocument } from '@physicsos/question-paper'
import { exportSections, LEARNING_SERVICE, CLASS_SERVICE, NOTICE_SERVICE, PERSONAL_EXPORT_SERVICE, REQUIRED_PERSONAL_EXPORTS } from '../src/index.ts'
import { PAGE_BODY_LIMIT, SCENE_BODY_LIMIT, type ExportSection } from '../src/routes.ts'
import { authFor, call, memoryDomain, routeDeps, student } from './fixture.ts'
import { learningFixture, checkpoint, sceneBody } from '../../learning-host/tests/mobile-fixture.ts'
import { createMobileClasses } from '../../class-host/src/mobile.ts'
import { dashboardFixture } from '../../class-host/tests/dashboard-fixture.ts'
import { createMobilePaper } from '../../paper-host/src/mobile.ts'
import { bankPlanFixture } from '../../paper-host/tests/bank-plan-fixture.ts'
import { noticeDomain } from '../../notice-host/src/domain.ts'
import { NoticeService } from '../../notice-host/src/service.ts'
import { createMobileNotice, createMobilePush } from '../../notice-host/src/mobile.ts'

function fixture() {
  const learning = learningFixture()
  const classes = createMobileClasses(dashboardFixture(1, 1).service)
  const notices = new NoticeService(memoryDomain(noticeDomain).domain)
  const notice = createMobileNotice(notices), push = createMobilePush(notices)
  const unused = async (): Promise<never> => { throw new Error('Other personal domains are tested by their owning provider') }
  const personal = { sections: (): ExportSection[] => REQUIRED_PERSONAL_EXPORTS.map(id => ({ id, rows: unused, idOf: row => String(row['id']) })) }
  const services = new Map<string, unknown>([[LEARNING_SERVICE, learning.facade], [CLASS_SERVICE, classes], [NOTICE_SERVICE, notice], [PERSONAL_EXPORT_SERVICE, personal]])
  const deps = routeDeps({ learning: () => learning.facade, classes: () => classes, notice: () => notice, push: () => push,
    exports: () => exportSections(name => services.get(name)) })
  return { learning, notices, services, deps }
}
const items = (value: Awaited<ReturnType<typeof call>>): Record<string, unknown>[] => value.json.data['items'] as Record<string, unknown>[]

describe('mobile real-facade data routes', () => {
  it('accepts a valid history above 2 MiB through the HTTP adapter, but caps the whole wire at 12 MiB', async () => {
    const f = fixture()
    const body = sceneBody('history', checkpoint('history', 100, 'x'.repeat(16_000)))
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(2 * 1024 * 1024)
    const saved = await call(f.deps, 'PUT', '/learning/scenes/history', { body, headers: { 'idempotency-key': 'history-save' } })
    expect(saved.status).toBe(200)
    expect((await call(f.deps, 'GET', '/learning/scenes/history')).json.data['item']).toMatchObject({ checkpoint: body.checkpoint })
    const tooLarge = await call(f.deps, 'PUT', '/learning/scenes/history', { body: { ...body, extra: 'x'.repeat(SCENE_BODY_LIMIT) }, headers: { 'idempotency-key': 'too-large-save' } })
    expect(tooLarge.status).toBe(413)
    expect(f.learning.files.saves).toBe(1)
  })

  it('exports every real scene and complete history exactly once across advancing cursors', async () => {
    const f = fixture()
    for (let index = 0; index < 3; index++) await f.learning.facade.saveScene(student, `scene-${index}`, sceneBody(`scene-${index}`), `mutation-${index}`)
    const seen: string[] = [], cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const response = await call(f.deps, 'GET', `/account/export?section=learning.scenes&limit=1${cursor === undefined ? '' : `&cursor=${cursor}`}`)
      expect(response.status).toBe(200)
      for (const row of items(response)) {
        seen.push(String(row['sceneId']))
        expect(row['checkpoint']).toEqual(checkpoint(String(row['sceneId'])))
      }
      cursor = response.json.data['nextCursor'] as string | undefined
      if (cursor !== undefined) { expect(cursors.has(cursor)).toBe(false); cursors.add(cursor) }
    } while (cursor !== undefined)
    expect(seen.sort()).toEqual(['scene-0', 'scene-1', 'scene-2'])
  })

  it('byte-bounds asynchronous content export pages without dropping or truncating a checkpoint', async () => {
    const f = fixture()
    for (let index = 0; index < 3; index++) {
      const id = `large-${index}`
      await f.learning.facade.saveScene(student, id, sceneBody(id, checkpoint(id, 120, 'x'.repeat(24_000))), `large-mutation-${index}`)
    }
    const first = await call(f.deps, 'GET', '/account/export?section=learning.scenes&limit=100')
    expect(first.status).toBe(200)
    expect(Buffer.byteLength(first.body)).toBeLessThanOrEqual(PAGE_BODY_LIMIT)
    expect(items(first)).toHaveLength(2)
    const second = await call(f.deps, 'GET', `/account/export?section=learning.scenes&limit=100&cursor=${String(first.json.data['nextCursor'])}`)
    expect(second.status).toBe(200)
    expect(items(second)).toHaveLength(1)
    expect(second.json.data['nextCursor']).toBeUndefined()
    for (const row of [...items(first), ...items(second)]) expect(row['checkpoint']).toEqual(checkpoint(String(row['sceneId']), 120, 'x'.repeat(24_000)))
    f.learning.files.unavailable = true
    const missing = await call(f.deps, 'GET', '/account/export?section=learning.scenes')
    expect(missing.status).toBe(503)
    expect(missing.json.data).toBeUndefined()
  })

  it('refuses absent or incomplete personal providers instead of returning a successful partial manifest', async () => {
    for (const name of [LEARNING_SERVICE, CLASS_SERVICE, NOTICE_SERVICE, PERSONAL_EXPORT_SERVICE]) {
      const f = fixture(); f.services.delete(name)
      expect((await call(f.deps, 'GET', '/account/export')).json.error.code).toBe('EXPORT_UNAVAILABLE')
    }
    const f = fixture()
    f.services.set(PERSONAL_EXPORT_SERVICE, { sections: () => [] })
    expect((await call(f.deps, 'GET', '/account/export')).status).toBe(503)
    const ready = await call(fixture().deps, 'GET', '/account/export')
    expect(ready.status).toBe(200)
    expect((ready.json.data['sections'] as { id: string }[]).map(row => row.id)).toEqual(expect.arrayContaining([
      'learning.scenes', 'learning.canvas.metadata', 'learning.canvas.objects', 'notices.account', ...REQUIRED_PERSONAL_EXPORTS,
    ]))
  })

  it('passes real notice data and honest push unavailability through the mobile envelope', async () => {
    const f = fixture()
    await f.notices.submitFeedback(student, { kind: 'bug', body: 'Real facade feedback' })
    expect((await call(f.deps, 'POST', '/notices/platform/ack', { body: { version: 1 } })).json.data).toEqual({ acknowledgedVersion: 1 })
    const exported = await call(f.deps, 'GET', '/account/export?section=notices.account')
    expect(items(exported).map(row => row['table']).sort()).toEqual(['feedback', 'platform_notice_acks'])
    expect((await call(f.deps, 'POST', '/devices/push', { body: { token: 'unconfigured-provider-token' } })).json.error.code).toBe('PUSH_UNAVAILABLE')
  })

  it('filters real verified questions and sources before pagination and retains tenant isolation', async () => {
    const bank = bankPlanFixture(60)
    for (let index = 0; index < 60; index++) {
      const id = bank.itemId(index), current = bank.service.getBankItem(id), matches = index === 59
      await bank.domain.table('bank_items').put(id, { ...current, stem: matches ? 'unique needle' : 'unrelated',
        level: matches ? 'zhongkao' : 'gaokao', subject: matches ? 'physics' : 'chemistry' })
      await bank.domain.table('source_papers').put(`source-${index}`, { id: `source-${index}`, level: matches ? 'zhongkao' : 'gaokao',
        subject: matches ? 'physics' : 'chemistry', year: 2024, examName: matches ? 'unique needle' : 'unrelated', evidenceTier: 'original-scan',
        sourceRef: 'https://example.invalid/source.pdf', enteredBy: 'teacher', enteredAt: '2026-11-01T00:00:00Z', status: 'verified' })
    }
    await bank.domain.table('bank_items').put('foreign', { ...bank.service.getBankItem(bank.itemId(59)), id: 'foreign', schoolId: 'another-school' })
    const paper = createMobilePaper(bank.service, () => undefined, 'unused-figure-root')
    const deps = routeDeps({ paper: () => paper })
    for (const kind of ['questions', 'sources']) {
      const page = await call(deps, 'GET', `/library/${kind}?limit=50&q=needle&level=zhongkao&subject=physics`)
      expect(page.status).toBe(200)
      expect(items(page)).toHaveLength(1)
      expect(page.json.data['nextCursor']).toBeUndefined()
      expect(items(page)[0]!['id']).not.toBe('foreign')
    }
    expect(items(await call(deps, 'GET', '/library/sources?q=2024&level=zhongkao&subject=physics'))).toHaveLength(1)
  })

  it('serves the real approved paper target with its authorized figure URL and unreleased answers omitted', async () => {
    const classroom = dashboardFixture(1, 1), bank = bankPlanFixture(1)
    const actor = { ...student, schoolId: 'GZU', userKey: classroom.studentKey(0), username: 'student-000' }
    const classes = createMobileClasses(classroom.service)
    const paper = createMobilePaper(bank.service, () => classes, 'unused-figure-root')
    const item = bank.service.getBankItem(bank.itemId(0))
    const document: PaperDocument = {
      id: 'approved-document', title: 'Approved physics paper', level: 'zhongkao', kind: 'mock', specTable: bank.spec,
      header: { examName: 'Physics', grade: 'Junior', subjectLine: 'Physics', totalScore: 3, minutes: 60, candidateFields: [] },
      sections: [{ title: 'Questions', items: [{ number: 1, subject: item.subject, kind: item.kind, score: item.score!,
        stem: item.stem, options: item.options!, answer: item.answer!, knowledge: item.knowledge, ability: item.ability,
        difficulty: item.difficulty, status: 'approved', figure: { kind: 'line-diagram', ref: 'f1', caption: 'Circuit' } }] }],
    }
    const at = '2026-11-01T08:00:00.000Z', hash = documentHash(document)
    const job = { ...bank.job('paper-fixture', 'GZU', 'approved', at), document,
      versions: [{ version: 1, hash, at, summary: 'Reviewed fixture' }], checkedVersionHash: hash,
      approval: { versionHash: hash, reviewer: 'GZU:teacher', at } }
    await bank.domain.table('jobs').put(job.id, job)
    const deps = routeDeps({ auth: () => authFor(actor), classes: () => classes, paper: () => paper })
    const path = `/classes/${classroom.classId}/assignments/${classroom.assignmentId(0)}/target`
    const response = await call(deps, 'GET', path)
    expect(response.status).toBe(200)
    expect(response.json.data['answerPolicy']).toEqual({ mode: 'never', released: false })
    const target = response.json.data['paper'] as { sections: { items: Record<string, unknown>[] }[] }
    expect(target.sections[0]!.items[0]!['figure']).toEqual({ kind: 'line-diagram', ref: 'f1', caption: 'Circuit', url: `/physicsos/mobile/v1${path}/figures/f1` })
    expect(target.sections[0]!.items[0]).not.toHaveProperty('answer')
    const outsider = routeDeps({ ...deps, auth: () => authFor({ ...actor, userKey: 'GZU:outsider', userId: 'outsider' }) })
    expect((await call(outsider, 'GET', path)).status).toBe(403)
    await bank.domain.table('jobs').put(job.id, { ...job, status: 'review' })
    expect((await call(deps, 'GET', path)).status).toBe(409)
  })

  it('uses real class membership and submission rules, including CAS and cross-tenant refusals', async () => {
    const f = dashboardFixture(1, 1)
    const actor = { ...student, schoolId: 'GZU', userKey: f.studentKey(0), username: 'student-000' }
    const classes = createMobileClasses(f.service)
    const deps = routeDeps({ auth: () => authFor(actor), classes: () => classes })
    expect(items(await call(deps, 'GET', '/classes')).map(row => row['id'])).toEqual([f.classId])
    const path = `/classes/${f.classId}/assignments/${f.assignmentId(0)}/submission`
    const saved = await call(deps, 'PUT', path, { body: { content: 'Actual student submission', baseRevision: 0 }, headers: { 'idempotency-key': 'submission-one' } })
    expect(saved.status).toBe(200)
    expect(saved.json.data).toMatchObject({ appliedRevision: 1, receipt: { revision: 1, classId: f.classId } })
    expect((await call(deps, 'GET', path)).json.data).toMatchObject({ item: { content: 'Actual student submission' } })
    expect((await call(deps, 'PUT', path, { body: { content: 'Stale update', baseRevision: 0 }, headers: { 'idempotency-key': 'submission-two' } })).status).toBe(409)
    const outsider = routeDeps({ ...deps, auth: () => authFor({ ...actor, userKey: 'GZU:outsider', userId: 'outsider' }) })
    expect((await call(outsider, 'GET', path)).status).toBe(403)
    const otherSchool = routeDeps({ ...deps, auth: () => authFor({ ...actor, schoolId: 'foreign', userKey: 'foreign:student' }) })
    expect((await call(otherSchool, 'GET', path)).status).toBe(403)
  })
})
