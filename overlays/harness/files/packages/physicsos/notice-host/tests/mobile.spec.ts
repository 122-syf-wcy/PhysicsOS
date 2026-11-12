import { describe, expect, it } from 'vitest'
import { memoryDomain, student } from '../../mobile-host/tests/fixture.ts'
import { noticeDomain } from '../src/domain.ts'
import { NoticeService } from '../src/service.ts'
import { createMobileNotice, createMobilePush } from '../src/mobile.ts'

const request = { requestId: 'erase-one', userId: student.userId, userKey: student.userKey, schoolId: student.schoolId, username: student.username }
const replacement = { ...student, userId: 'account-two' }
const teacher = { ...student, userId: 'teacher-instance', userKey: 'school:teacher', username: 'teacher', role: 'TEACHER' as const }
const term = { id: 'push-one', userId: student.userId, userKey: student.userKey, schoolId: student.schoolId,
  platform: 'android' as const, tokenHash: 'a'.repeat(64), registeredAt: '2026-11-08T10:00:00.000Z' }
function fixture() {
  const storage = memoryDomain(noticeDomain), service = new NoticeService(storage.domain)
  return { storage, service, notice: createMobileNotice(service), push: createMobilePush(service) }
}

describe('real notice account facade', () => {
  it('refuses unavailable push instead of persisting an unusable or schema-invalid terminal', async () => {
    const f = fixture()
    await expect(f.push.register(student, { token: 'not-a-provider-registration' })).rejects.toMatchObject({ status: 503, code: 'PUSH_UNAVAILABLE' })
    expect(f.storage.domain.table('push_terms').size).toBe(0)
    expect(f.storage.reopen().domain.table('push_terms').size).toBe(0)
  })

  it('reopens schema-validated feedback/ack/push and exports the exact owner without token material', async () => {
    const f = fixture()
    await f.service.submitFeedback(student, { kind: 'bug', body: 'Account-owned feedback' })
    await f.notice.acknowledgePlatformNotice(student, { version: 1 })
    await f.storage.domain.table('push_terms').put(term.id, term)
    await f.service.dispose()
    const reopened = f.storage.reopen()
    const service = new NoticeService(reopened.domain), notice = createMobileNotice(service), push = createMobilePush(service)
    const rows = await notice.exportAccount(student)
    expect(rows.map(row => row['table']).sort()).toEqual(['feedback', 'platform_notice_acks', 'push_terms'])
    expect(JSON.stringify(rows)).not.toContain('tokenHash')
    expect(notice.platformNotice(student).acknowledgedVersion).toBe(1)
    expect(notice.platformNotice(replacement).acknowledgedVersion).toBeNull()
    expect(await notice.exportAccount(replacement)).toEqual([])
    await expect(push.revoke(replacement, term.id)).rejects.toMatchObject({ status: 404 })
    await expect(push.revoke({ ...student, schoolId: 'foreign', userKey: 'foreign:student' }, term.id)).rejects.toMatchObject({ status: 404 })
    await push.revoke(student, term.id)
    expect(reopened.reopen().domain.table('push_terms').get(term.id)).toHaveProperty('revokedAt')
  })

  it('serializes in-flight private writes before erasure and rejects writes queued after its fence', async () => {
    const f = fixture()
    let release!: () => void, started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    f.storage.io.beforePut = async name => { if (name === 'feedback') { started(); await held } }
    const writing = f.service.submitFeedback(student, { kind: 'idea', body: 'in flight' })
    await entered
    const erasing = f.notice.eraseAccount(request)
    const late = expect(f.notice.acknowledgePlatformNotice(student, { version: 1 })).rejects.toMatchObject({ status: 410, code: 'ACCOUNT_ERASED' })
    release()
    await writing; await erasing; await late
    expect(f.storage.domain.table('feedback').size).toBe(0)
    expect(f.storage.domain.table('platform_notice_acks').size).toBe(0)
    const reloaded = new NoticeService(f.storage.reopen().domain)
    await expect(reloaded.submitFeedback(student, { kind: 'bug', body: 'stale account' })).rejects.toMatchObject({ status: 410 })
    await reloaded.submitFeedback(replacement, { kind: 'bug', body: 'new account' })
    await reloaded.eraseAccount(request)
    expect((await reloaded.exportAccount(replacement)).length).toBe(1)
  })

  it('cleans only the erased incarnation and does not resurrect feedback through a queued staff reply', async () => {
    const f = fixture()
    const feedback = await f.service.submitFeedback(student, { kind: 'bug', body: 'old account' })
    await f.service.submitFeedback(replacement, { kind: 'bug', body: 'replacement account' })
    await f.storage.domain.table('push_terms').put(term.id, term)
    await f.notice.acknowledgePlatformNotice(student, { version: 1 })
    const erasing = f.notice.eraseAccount(request)
    const reply = expect(f.service.replyFeedback(teacher, feedback.id, { reply: 'too late' })).rejects.toMatchObject({ status: 404 })
    await erasing; await reply
    expect(f.storage.domain.table('feedback').size).toBe(1)
    expect(f.storage.domain.table('push_terms').size).toBe(0)
    expect(f.storage.domain.table('platform_notice_acks').size).toBe(0)
    expect((await f.notice.exportAccount(replacement)).length).toBe(1)
  })

  it('keeps the fence after partial I/O failure and resumes the same erasure without reopening writes', async () => {
    const f = fixture()
    await f.service.submitFeedback(student, { kind: 'bug', body: 'retained until retry' })
    let fail = true
    f.storage.io.beforeDelete = async () => { if (fail) { fail = false; throw new Error('Injected durable delete failure') } }
    await expect(f.notice.eraseAccount(request)).rejects.toThrow('Injected durable delete failure')
    await expect(f.service.submitFeedback(student, { kind: 'bug', body: 'cannot recover account by writing' })).rejects.toMatchObject({ status: 410 })
    await f.notice.eraseAccount(request)
    expect(f.storage.domain.table('feedback').size).toBe(0)
    const fence = [...f.storage.reopen().domain.table('erased_accounts').entries()][0]![1]
    expect(fence.complete).toBe(true)
  })

  it('does not silently omit or transfer legacy unbound personal data', async () => {
    const f = fixture()
    await f.storage.domain.table('feedback').put('legacy', { id: 'legacy', schoolId: student.schoolId, authorKey: student.userKey,
      kind: 'bug', body: 'unbound legacy row', status: 'open', createdAt: '2026-11-08T10:00:00.000Z' })
    const { userId: _unrecorded, ...legacyTerm } = term
    await f.storage.domain.table('push_terms').put('legacy-push', { ...legacyTerm, id: 'legacy-push' })
    const reopened = f.storage.reopen()
    expect(reopened.domain.table('feedback').size).toBe(1)
    expect(reopened.domain.table('push_terms').get('legacy-push')?.userId).toBeUndefined()
    await expect(f.push.revoke(student, 'legacy-push')).rejects.toMatchObject({ status: 404 })
    await expect(f.notice.exportAccount(replacement)).rejects.toMatchObject({ status: 503, code: 'NOTICE_MIGRATION_REQUIRED' })
    expect(() => f.service.listFeedback(replacement)).toThrowError('旧反馈尚未完成账户实例归属迁移')
    await f.notice.eraseAccount(request)
    expect(f.storage.domain.table('push_terms').size).toBe(0)
    expect(await f.notice.exportAccount(replacement)).toEqual([])
  })
})
