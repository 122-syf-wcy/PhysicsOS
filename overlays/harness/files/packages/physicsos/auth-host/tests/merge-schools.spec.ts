import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenedMergeFixture } from './merge-schools.fixture.ts'
import {
  OPERATOR_KEY,
  SOURCE_SCHOOL_ID,
  TARGET_SCHOOL_ID,
  openMergeFixture,
  seedMergeData,
} from './merge-schools.fixture.ts'
import { SchoolMergeError, mergeSchoolTenants } from '../src/merge-schools.ts'
import { classMergeDomain, learningMergeDomain } from '../src/merge-schools-domain.ts'
import { classDomain } from '../../class-host/src/domain.ts'
import { learningDomain } from '../../learning-host/src/domain.ts'
import { AuthService, DEFAULT_AUTH_CONFIG } from '../src/service.ts'
import { ModerationService } from '../src/moderation/service.ts'
import type { ModerationReview } from '../src/moderation/types.ts'

let fixture: OpenedMergeFixture | undefined

const EXPECTED_COUNTS = {
  'auth.api_resources': 1,
  'auth.device_revocations': 1,
  'auth.devices': 1,
  'auth.learning_counts': 1,
  'auth.password_reset_tokens': 1,
  'auth.reset_requests': 1,
  'auth.sessions': 1,
  'auth.users': 2,
  'class.assignments': 1,
  'class.classes': 1,
  'class.memberships': 1,
  'class.submissions': 1,
  'learning.attempts': 1,
  'learning.saved_scenes': 1,
} as const

const expectNoSourceDataRows = (opened: OpenedMergeFixture): void => {
  const domains = [
    ['auth', opened.stores.auth] as const,
    ['class', opened.stores.classroom] as const,
    ['learning', opened.stores.learning] as const,
  ]
  const dataTables: Record<string, readonly string[]> = {
    auth: [
      'users',
      'sessions',
      'reset_requests',
      'password_reset_tokens',
      'learning_counts',
      'devices',
      'device_revocations',
      'api_resources',
    ],
    class: ['classes', 'memberships', 'assignments', 'submissions'],
    learning: ['attempts', 'saved_scenes'],
  }
  for (const [domainName, rawDomain] of domains) {
    const domain = rawDomain as unknown as {
      table(name: string): {
        entries(): IterableIterator<[string, unknown]>
      }
    }
    for (const tableName of dataTables[domainName] ?? []) {
      const table = domain.table(tableName)
      for (const [key, row] of table.entries()) {
        expect(JSON.stringify({ key, row })).not.toContain(SOURCE_SCHOOL_ID)
      }
    }
  }
}

afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

const options = (apply = false) => ({
  sourceSchoolId: SOURCE_SCHOOL_ID,
  targetSchoolId: TARGET_SCHOOL_ID,
  operatorKey: OPERATOR_KEY,
  confirmTargetId: TARGET_SCHOOL_ID,
  maxRowsPerTable: 100,
  now: () => new Date('2026-09-26T12:00:00.000Z'),
  apply,
})

describe('school tenant merge', () => {
  it('remaps moderation ownership and decision actors while preserving literal evidence and global settings', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    const cases = fixture.stores.auth.table('moderation_cases')
    const evidence = `${SOURCE_SCHOOL_ID}:quoted text must stay verbatim`
    const row = {
      id: 'moderation-1', sessionId: 'session-1', messageId: 'message-1',
      ownerKey: `${SOURCE_SCHOOL_ID}:alice`, schoolId: SOURCE_SCHOOL_ID, username: 'alice', userId: 'user_alice',
      text: evidence, context: SOURCE_SCHOOL_ID, textTruncated: false, contextTruncated: false,
      status: 'dismissed' as const, version: 7, createdAt: '2026-09-26', updatedAt: '2026-09-26',
      decision: { decision: 'dismiss' as const, reason: SOURCE_SCHOOL_ID, actorKey: `${SOURCE_SCHOOL_ID}:teacher`, decidedAt: '2026-09-26' },
      review: { risk: 'review' as const, category: 'other' as const, severity: 'low' as const, confidence: 0.5, reason: SOURCE_SCHOOL_ID, evidence: [evidence] },
    }
    await cases.put(row.id, row)
    await cases.put('moderation-unrelated', { ...row, id: 'moderation-unrelated', ownerKey: `${TARGET_SCHOOL_ID}:alice`, schoolId: TARGET_SCHOOL_ID, decision: { ...row.decision, actorKey: OPERATOR_KEY } })
    const settings = { version: 3, enabled: false, captureFailures: 2, updatedAt: '2026-09-26' }
    await fixture.stores.auth.table('moderation_settings').put('default', settings)
    await mergeSchoolTenants(fixture.stores, options(true))
    expect(cases.get(row.id)).toMatchObject({
      id: row.id, userId: 'user_alice', ownerKey: `${TARGET_SCHOOL_ID}:alice`, schoolId: TARGET_SCHOOL_ID, version: 8,
      text: evidence, context: SOURCE_SCHOOL_ID, review: row.review,
      decision: { ...row.decision, actorKey: `${TARGET_SCHOOL_ID}:teacher` },
    })
    expect(cases.get('moderation-unrelated')!.version).toBe(7)
    expect(fixture.stores.auth.table('moderation_settings').get('default')).toEqual(settings)
    expect((await mergeSchoolTenants(fixture.stores, options(true))).status).toBe('already-merged')
  })

  it('returns remapped in-flight moderation jobs to pending and ignores their late completion', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    let finish!: (result: ModerationReview) => void
    let first = true
    let clock = Date.now()
    const safe: ModerationReview = { risk: 'allow', category: 'none', severity: 'none', confidence: 0.99, reason: 'education', evidence: [] }
    const auth = new AuthService(fixture.stores.auth, DEFAULT_AUTH_CONFIG)
    const service = new ModerationService(fixture.stores.auth, auth, { now: () => new Date(clock), review: async () => {
      if (!first) return safe
      first = false
      return new Promise<ModerationReview>(resolve => { finish = resolve })
    } })
    const actor = { userKey: OPERATOR_KEY, schoolId: 'PHYSICSOS-OPEN', username: 'ops-admin', role: 'SUPER_ADMIN' as const }
    const id = (await service.capture({ sessionId: 'session-1', messageId: 'late', text: 'safe education' }))!
    const model = service.processNext()
    await vi.waitFor(() => expect(service.detail(actor, id).status).toBe('reviewing'))
    const version = service.detail(actor, id).version
    try {
      await mergeSchoolTenants(fixture.stores, options(true))
      expect(service.detail(actor, id)).toMatchObject({ ownerKey: `${TARGET_SCHOOL_ID}:alice`, status: 'pending', version: version + 1 })
    } finally { finish(safe); await model }
    expect(service.detail(actor, id).status).toBe('pending')
    await expect(service.decide(actor, id, { version, decision: 'dismiss', reason: 'stale' })).rejects.toMatchObject({ status: 409 })
    clock += 15_001
    expect(await service.processNext()).toBe(true)
    expect(service.detail(actor, id).status).toBe('allowed')
  })

  it('covers the real class and learning domain table sets', () => {
    expect(Object.keys(classMergeDomain.tables)).toEqual(Object.keys(classDomain.tables))
    expect(Object.keys(learningMergeDomain.tables)).toEqual(Object.keys(learningDomain.tables))
  })

  it('plans a complete merge without changing any storage unit', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    const before = await Promise.all([
      fixture.readUnit('physicsos_auth'),
      fixture.readUnit('physicsos_class'),
      fixture.readUnit('physicsos_learning'),
    ])

    const summary = await mergeSchoolTenants(fixture.stores, options())

    expect(summary).toMatchObject({
      status: 'dry-run',
      sourceSchoolId: SOURCE_SCHOOL_ID,
      targetSchoolId: TARGET_SCHOOL_ID,
      totalRows: 15,
    })
    expect(summary.counts).toEqual(EXPECTED_COUNTS)
    expect(await Promise.all([
      fixture.readUnit('physicsos_auth'),
      fixture.readUnit('physicsos_class'),
      fixture.readUnit('physicsos_learning'),
    ])).toEqual(before)
    expect(fixture.stores.auth.table('school_merges').size).toBe(0)
  })

  it('moves every affected row, removes source-prefixed identities, and audits the counts', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)

    const summary = await mergeSchoolTenants(fixture.stores, options(true))

    expect(summary.status).toBe('applied')
    expect(summary.totalRows).toBe(15)
    const users = fixture.stores.auth.table('users')
    expect(users.get(`${SOURCE_SCHOOL_ID}:alice`)).toBeUndefined()
    expect(users.get(`${TARGET_SCHOOL_ID}:alice`)).toMatchObject({
      id: 'user_alice',
      schoolId: TARGET_SCHOOL_ID,
      username: 'alice',
    })
    expect(fixture.stores.auth.table('sessions').get('session_hash')).toMatchObject({
      schoolId: TARGET_SCHOOL_ID,
      userId: 'user_alice',
    })
    expect(fixture.stores.auth.table('devices').get(
      `${TARGET_SCHOOL_ID}:alice|0123456789abcdef`,
    )).toMatchObject({
      id: `${TARGET_SCHOOL_ID}:alice|0123456789abcdef`,
      primaryUserKey: `${TARGET_SCHOOL_ID}:alice`,
      schoolId: TARGET_SCHOOL_ID,
    })
    expect(fixture.stores.auth.table('device_revocations').get(
      `${TARGET_SCHOOL_ID}|0123456789abcdef`,
    )).toMatchObject({ scope: TARGET_SCHOOL_ID, affectedSchools: [TARGET_SCHOOL_ID] })
    expect(fixture.stores.classroom.table('classes').get('class-1')).toMatchObject({
      schoolId: TARGET_SCHOOL_ID,
      ownerKey: `${TARGET_SCHOOL_ID}:teacher`,
    })
    expect(fixture.stores.classroom.table('memberships').get(
      `class-1|${TARGET_SCHOOL_ID}:alice`,
    )).toMatchObject({
      schoolId: TARGET_SCHOOL_ID,
      userKey: `${TARGET_SCHOOL_ID}:alice`,
      addedBy: `${TARGET_SCHOOL_ID}:teacher`,
    })
    expect(fixture.stores.classroom.table('submissions').get(
      `class-1|assignment-1|${TARGET_SCHOOL_ID}:alice`,
    )).toMatchObject({
      schoolId: TARGET_SCHOOL_ID,
      studentKey: `${TARGET_SCHOOL_ID}:alice`,
      review: { reviewedBy: `${TARGET_SCHOOL_ID}:teacher` },
    })
    expect(fixture.stores.learning.table('attempts').get(
      `${TARGET_SCHOOL_ID}:alice|attempt-1`,
    )).toMatchObject({
      userKey: `${TARGET_SCHOOL_ID}:alice`,
      schoolId: TARGET_SCHOOL_ID,
    })
    expect(fixture.stores.learning.table('saved_scenes').get(
      `${TARGET_SCHOOL_ID}:alice|scene-1`,
    )).toMatchObject({
      userKey: `${TARGET_SCHOOL_ID}:alice`,
      schoolId: TARGET_SCHOOL_ID,
    })
    expect(fixture.stores.auth.table('schools').get(SOURCE_SCHOOL_ID)).toMatchObject({
      status: 'disabled',
      mergedInto: TARGET_SCHOOL_ID,
      mergedAt: '2026-09-26T12:00:00.000Z',
    })
    expectNoSourceDataRows(fixture)
    const audit = [...fixture.stores.auth.table('admin_audit').entries()]
      .map(([, row]) => row)
      .find(row => row.action === 'school.merge')
    expect(audit).toMatchObject({
      actorKey: OPERATOR_KEY,
      schoolId: TARGET_SCHOOL_ID,
      target: SOURCE_SCHOOL_ID,
      detail: {
        sourceSchoolId: SOURCE_SCHOOL_ID,
        targetSchoolId: TARGET_SCHOOL_ID,
        operatorKey: OPERATOR_KEY,
        counts: EXPECTED_COUNTS,
        totalRows: 15,
      },
    })
    expect(fixture.stores.auth.table('school_merges').get(
      `${SOURCE_SCHOOL_ID}->${TARGET_SCHOOL_ID}`,
    )).toMatchObject({
      sourceSchoolId: SOURCE_SCHOOL_ID,
      targetSchoolId: TARGET_SCHOOL_ID,
      status: 'completed',
      counts: summary.counts,
      totalRows: 15,
    })
  })

  it('aborts on a destination key collision without writing any unit', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores, { targetUserCollision: true })
    const before = await Promise.all([
      fixture.readUnit('physicsos_auth'),
      fixture.readUnit('physicsos_class'),
      fixture.readUnit('physicsos_learning'),
    ])

    await expect(mergeSchoolTenants(fixture.stores, options(true))).rejects.toMatchObject({
      name: 'SchoolMergeError',
      code: 'MERGE_COLLISION',
    } satisfies Partial<SchoolMergeError>)

    expect(await Promise.all([
      fixture.readUnit('physicsos_auth'),
      fixture.readUnit('physicsos_class'),
      fixture.readUnit('physicsos_learning'),
    ])).toEqual(before)
    expect(fixture.stores.auth.table('school_merges').size).toBe(0)
  })

  it('treats a second completed run as an idempotent no-op', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    await mergeSchoolTenants(fixture.stores, options(true))
    const audits = fixture.stores.auth.table('admin_audit').size

    const second = await mergeSchoolTenants(fixture.stores, options(true))

    expect(second.status).toBe('already-merged')
    expect(second.totalRows).toBe(15)
    expect(second.counts).toEqual(EXPECTED_COUNTS)
    expect(fixture.stores.auth.table('admin_audit').size).toBe(audits)
  })

  it('detects a partially applied journal and resumes it', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    const dryRun = await mergeSchoolTenants(fixture.stores, options())
    const sourceUser = fixture.stores.auth.table('users').get(
      `${SOURCE_SCHOOL_ID}:alice`,
    )
    expect(sourceUser).toBeDefined()

    // Simulate a crash after the first row was copied and its source deleted.
    await fixture.stores.auth.table('users').put(`${TARGET_SCHOOL_ID}:alice`, {
      ...sourceUser!,
      schoolId: TARGET_SCHOOL_ID,
    })
    await fixture.stores.auth.table('users').delete(`${SOURCE_SCHOOL_ID}:alice`)
    await fixture.stores.auth.table('school_merges').put(
      `${SOURCE_SCHOOL_ID}->${TARGET_SCHOOL_ID}`,
      {
        id: `${SOURCE_SCHOOL_ID}->${TARGET_SCHOOL_ID}`,
        sourceSchoolId: SOURCE_SCHOOL_ID,
        targetSchoolId: TARGET_SCHOOL_ID,
        operatorKey: OPERATOR_KEY,
        status: 'applying',
        planHash: dryRun.planHash,
        counts: dryRun.counts,
        totalRows: dryRun.totalRows,
        startedAt: '2026-09-26T11:00:00.000Z',
        updatedAt: '2026-09-26T11:00:00.000Z',
      },
    )

    const inspection = await mergeSchoolTenants(fixture.stores, options())
    expect(inspection.status).toBe('resume-required')
    const resumed = await mergeSchoolTenants(fixture.stores, options(true))
    expect(resumed.status).toBe('resumed')
    expect(resumed.counts).toEqual(EXPECTED_COUNTS)
    expect(fixture.stores.auth.table('users').get(
      `${SOURCE_SCHOOL_ID}:teacher`,
    )).toBeUndefined()
    expect(fixture.stores.auth.table('users').get(
      `${TARGET_SCHOOL_ID}:teacher`,
    )).toBeDefined()
    expect(fixture.stores.auth.table('school_merges').get(
      `${SOURCE_SCHOOL_ID}->${TARGET_SCHOOL_ID}`,
    )).toMatchObject({ status: 'completed', counts: dryRun.counts, totalRows: 15 })
  })

  it('refuses an unknown target and a mismatched confirmation before writing', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    const before = await fixture.readUnit('physicsos_auth')

    await expect(mergeSchoolTenants(fixture.stores, {
      ...options(true),
      targetSchoolId: 'gz_missing',
      confirmTargetId: 'gz_missing',
    })).rejects.toMatchObject({ code: 'MERGE_TARGET_NOT_FOUND' })
    await expect(mergeSchoolTenants(fixture.stores, {
      ...options(true),
      confirmTargetId: SOURCE_SCHOOL_ID,
    })).rejects.toMatchObject({ code: 'MERGE_CONFIRMATION_REQUIRED' })

    expect(await fixture.readUnit('physicsos_auth')).toBe(before)
  })

  it('enforces the bounded row cap before writing', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    const before = await fixture.readUnit('physicsos_auth')

    await expect(mergeSchoolTenants(fixture.stores, {
      ...options(true),
      maxRowsPerTable: 1,
    })).rejects.toMatchObject({ code: 'MERGE_ROW_LIMIT_EXCEEDED' })

    expect(await fixture.readUnit('physicsos_auth')).toBe(before)
  })

  it('refuses a prefix mismatch before writing', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    await fixture.stores.auth.table('devices').put(
      `${SOURCE_SCHOOL_ID}:alice|mismatch`,
      {
        id: `${SOURCE_SCHOOL_ID}:alice|mismatch`,
        deviceId: 'mismatch',
        primaryUserKey: `${TARGET_SCHOOL_ID}:alice`,
        schoolId: SOURCE_SCHOOL_ID,
        username: 'alice',
        firstSeenAt: '2026-09-26T10:00:00.000Z',
        lastSeenAt: '2026-09-26T10:00:00.000Z',
        seenCount: 1,
      },
    )
    const before = await fixture.readUnit('physicsos_auth')

    await expect(mergeSchoolTenants(fixture.stores, options(true))).rejects.toMatchObject({
      code: 'MERGE_PREFIX_MISMATCH',
    })

    expect(await fixture.readUnit('physicsos_auth')).toBe(before)
  })

  it('refuses a source reference in a table it deliberately does not rewrite', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    await fixture.stores.auth.table('school_requests').put('request-1', {
      id: 'request-1',
      schoolName: '贵州测试学校',
      contact: '18500000000',
      status: 'pending',
      requestedBy: `${SOURCE_SCHOOL_ID}:alice`,
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    const before = await fixture.readUnit('physicsos_auth')

    await expect(mergeSchoolTenants(fixture.stores, options(true))).rejects.toMatchObject({
      code: 'MERGE_UNHANDLED_REFERENCE',
    })

    expect(await fixture.readUnit('physicsos_auth')).toBe(before)
  })

  it('refuses a pending registration that would activate on the retired tenant', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    await fixture.stores.auth.table('pending_registrations').put('registration-1', {
      id: 'registration-1',
      requestId: 'request-1',
      schoolId: SOURCE_SCHOOL_ID,
      schoolName: '贵州测试学校',
      username: 'bob',
      displayName: 'Bob',
      email: 'bob@example.cn',
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
      status: 'pending',
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    const before = await fixture.readUnit('physicsos_auth')

    await expect(mergeSchoolTenants(fixture.stores, options(true))).rejects.toMatchObject({
      code: 'MERGE_UNHANDLED_REFERENCE',
    })

    expect(await fixture.readUnit('physicsos_auth')).toBe(before)
  })
})
