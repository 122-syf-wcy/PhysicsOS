import { describe, expect, it, vi } from 'vitest'
import { activityDomain, activityClientWire } from '../src/activity-domain.ts'
import { usageDomain, usageEventWire } from '../src/usage-domain.ts'
import { ACTIVITY_AVATARS, activityDayOf } from '../src/activity-service.ts'
import type { ActivityRoster } from '../src/activity-types.ts'
import { activityFixture, admin, alice, bob, capsule, clientEvent, other, root, rosterFixture } from './activity-fixture.ts'

const target = (actor = alice) => ({ schoolId: actor.schoolId, username: actor.username })
const storedTotals = (f: Awaited<ReturnType<typeof activityFixture>>) => [...f.domain.table('buckets').entries()].reduce((sum, [, row]) => ({ visits: sum.visits + row.visits, opens: sum.opens + row.opens, uses: sum.uses + row.uses, ids: sum.ids + Object.keys(row.dedup).length }), { visits: 0, opens: 0, uses: 0, ids: 0 })
describe('activity v1 on real persistent KV', () => {
  it('keeps the strict legacy usage v0 completely separate', () => {
    expect(usageDomain.name).toBe('physicsos_usage'); expect(usageDomain.version).toBe(0)
    expect(activityDomain.name).toBe('physicsos_activity_v1'); expect(activityDomain.version).toBe(0)
    expect(usageEventWire.safeParse({ id: 'old', kind: 'use', surface: 'lab', action: 'view' }).success).toBe(true)
    expect(usageEventWire.safeParse({ id: 'new', kind: 'open', surface: 'lab' }).success).toBe(false)
  })
  it('increments counters and hashes in one update, deduplicates overlap, and survives a restart', async () => {
    const f = await activityFixture(), event = clientEvent('visit', f.now), writes: unknown[] = []
    f.faults.before = write => { if (write.table === 'buckets') writes.push(write.value) }
    const results = await Promise.all([f.service.recordClientEvent(alice, event), f.service.recordClientEvent(alice, event)])
    expect(results.map(value => value.status)).toEqual(['recorded', 'duplicate'])
    expect(storedTotals(f)).toEqual({ visits: 1, opens: 0, uses: 0, ids: 1 })
    expect(writes).toHaveLength(2) // empty bucket put, then ONE count+dedup update
    expect(writes[0]).toMatchObject({ visits: 0, dedup: {} })
    expect(writes[1]).toMatchObject({ visits: 1 })
    await f.restart()
    expect(await f.service.recordClientEvent(alice, event)).toMatchObject({ status: 'duplicate' })
    expect(await f.service.userDetail(admin, target())).toMatchObject({ visits: 1, opens: 0, uses: 0, timezone: 'Asia/Shanghai' })
  })
  it('rejects changed hashes and forged authority/time/use fields', async () => {
    const f = await activityFixture(), event = clientEvent('open', f.now)
    await f.service.recordClientEvent(alice, event)
    await expect(f.service.recordClientEvent(alice, { ...event, module: 'canvas' })).rejects.toMatchObject({ code: 'ACTIVITY_ID_CONFLICT' })
    for (const field of [{ kind: 'use' }, { userKey: other.userKey }, { schoolId: other.schoolId }, { occurredAt: f.now }, { prompt: 'not telemetry' }, { x: 1 }]) {
      await expect(f.service.recordClientEvent(alice, { ...event, ...field })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    }
    expect(activityClientWire.safeParse({ ...event, body: 'forbidden' }).success).toBe(false)
    expect(storedTotals(f)).toMatchObject({ opens: 1, uses: 0 })
  })
  it('counts server success once, refuses an operation id with a changed original time, never promotes opens to use', async () => {
    const f = await activityFixture(), value = capsule('editing-session-1', f.now)
    expect(await f.service.success(value)).toEqual({ status: 'recorded' })
    expect(await f.service.success(value)).toEqual({ status: 'duplicate' })
    f.setNow('2026-11-16T00:00:01.000Z')
    expect(await f.service.success({ ...value, occurredAt: f.now })).toMatchObject({ status: 'rejected', code: 'ACTIVITY_ID_CONFLICT' })
    await f.service.recordClientEvent(alice, clientEvent('open', f.now))
    expect(storedTotals(f)).toMatchObject({ uses: 1, opens: 1 })
    expect(await f.service.userDetail(admin, target())).toMatchObject({ modules: expect.arrayContaining([expect.objectContaining({ module: 'canvas', uses: 1 })]) })
  })
  it('keeps original Shanghai dates across midnight and rejects old retries instead of counting them today', async () => {
    const f = await activityFixture()
    f.setNow('2026-11-16T15:59:59.000Z')
    const value = capsule('before-midnight', f.now), visit = clientEvent('visit', f.now)
    await f.service.success(value); await f.service.recordClientEvent(alice, visit)
    f.setNow('2026-11-16T16:00:01.000Z'); await f.restart()
    expect(await f.service.success(value)).toMatchObject({ status: 'duplicate' })
    expect(await f.service.recordClientEvent(alice, visit)).toMatchObject({ status: 'duplicate' })
    expect(await f.service.userDetail(admin, target(), { days: 1 })).toMatchObject({ from: '2026-11-17', uses: 0, visits: 0 })
    expect(await f.service.userDetail(admin, target(), { days: 1, to: '2026-11-16' })).toMatchObject({ uses: 1, visits: 1 })
    f.setNow('2026-11-24T16:00:01.000Z')
    expect(await f.service.success(value)).toMatchObject({ status: 'rejected', code: 'ACTIVITY_REPLAY_EXPIRED' })
    await expect(f.service.recordClientEvent(alice, visit)).rejects.toMatchObject({ code: 'ACTIVITY_REPLAY_EXPIRED' })
    expect(await f.service.userDetail(admin, target(), { days: 1 })).toMatchObject({ uses: 0, visits: 0 })
    expect(activityDayOf(new Date('2026-11-16T16:00:00Z'))).toBe('2026-11-17')
  })
  it('does not backfill pre-collection events or invent history outside the 90-day window', async () => {
    const f = await activityFixture()
    expect(await f.service.success(capsule('before-collection', '2026-11-15T23:59:59.000Z'))).toMatchObject({ status: 'rejected', code: 'ACTIVITY_BEFORE_COLLECTION' })
    await expect(f.service.schoolRanking(root, { days: 90, to: '2026-11-15' })).rejects.toMatchObject({ code: 'ACTIVITY_DATE_RANGE' })
    await expect(f.service.schoolRanking(root, { to: '2026-02-30' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await f.service.userDetail(admin, target())).collectionStartedAt).toBe('2026-11-16T00:00:00.000Z')
  })
  it('leaves counts AND hashes untouched on backend failure, retaining a durable replay receipt', async () => {
    const f = await activityFixture(), value = capsule('failed-count-update', f.now)
    let failed = false
    f.faults.before = write => {
      if (!failed && write.table === 'buckets' && (write.value as { uses: number }).uses === 1) { failed = true; throw new Error('injected medium failure') }
    }
    expect(await f.service.success(value)).toMatchObject({ status: 'pending', code: 'ACTIVITY_STORAGE_WRITE' })
    expect(storedTotals(f)).toMatchObject({ uses: 0, ids: 0 })
    expect([...f.domain.table('receipts').entries()].map(([, row]) => row.state)).toEqual(['pending'])
    f.faults.before = undefined
    await f.restart(); await f.service.recover()
    expect(storedTotals(f)).toMatchObject({ uses: 1, ids: 1 })
    expect([...f.domain.table('receipts').entries()].map(([, row]) => row.state)).toEqual(['applied'])
    expect(f.alerts).toContain('ACTIVITY_STORAGE_WRITE')
    expect((await f.service.userDetail(admin, target())).integrity.codes).toContain('ACTIVITY_RECOVERY_REPLAY')
  })
  it('recovers an acknowledgement lost AFTER durable bucket publication without counting twice', async () => {
    const f = await activityFixture(), value = capsule('lost-ack', f.now)
    let lost = false
    f.faults.after = write => { if (!lost && write.table === 'buckets' && (write.value as { uses: number }).uses === 1) { lost = true; throw new Error('lost durable response') } }
    expect(await f.service.success(value)).toMatchObject({ status: 'pending' })
    f.faults.after = undefined
    expect(await f.service.success(capsule('must-wait-for-reopen', f.now))).toMatchObject({ status: 'pending', code: 'ACTIVITY_STORAGE_UNCERTAIN' })
    await f.restart(); await f.service.recover()
    expect(storedTotals(f)).toMatchObject({ uses: 1, ids: 1 })
    expect(await f.service.success(value)).toMatchObject({ status: 'duplicate' })
  })
  it('recovers the business-commit-before-hook gap from an actual separate durable capsule store, bounded by cursor', async () => {
    const f = await activityFixture({ limits: { maxReplayBatch: 1 } })
    await f.persistBusiness(capsule('committed-a', f.now)); await f.persistBusiness(capsule('committed-b', f.now))
    const source = f.businessSource('canvas-edit')
    await f.restart({ replaySources: [source] }) // no activity.success call ever happened before this restart
    await f.service.recover()
    expect(storedTotals(f).uses).toBe(1)
    await f.service.recover(); expect(storedTotals(f).uses).toBe(2)
    await f.restart({ replaySources: [source] }); await f.service.recover(); await f.service.recover()
    expect(storedTotals(f).uses).toBe(2)
  })
  it('does not fail a committed business fact when even the activity journal is unavailable', async () => {
    const f = await activityFixture(), value = capsule('journal-down', f.now)
    await f.persistBusiness(value)
    f.faults.before = write => { if (write.table === 'receipts') throw new Error('journal unavailable') }
    expect(await f.service.success(value)).toMatchObject({ status: 'pending' })
    expect(storedTotals(f).uses).toBe(0)
    f.faults.before = undefined
    await f.restart({ replaySources: [f.businessSource('canvas-edit')] }); await f.service.recover()
    expect(storedTotals(f).uses).toBe(1)
  })
  it('bounds synchronous success-hook latency while the durable business fact stays replayable', async () => {
    const f = await activityFixture({ limits: { successTimeoutMs: 10 } }), value = capsule('slow-medium', f.now)
    await f.persistBusiness(value)
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    f.faults.before = async write => { if (write.table === 'buckets') await barrier }
    try {
      expect(await f.service.success(value)).toMatchObject({ status: 'pending', code: 'ACTIVITY_SINK_DELAYED' })
    } finally { release(); f.faults.before = undefined }
    await f.service.recover()
    expect(storedTotals(f)).toMatchObject({ uses: 1, ids: 1 })
  })
  it('deduplicates active accounts across days and scopes targets/ranking by server authority', async () => {
    const f = await activityFixture()
    await f.service.success(capsule('day-1', f.now)); await f.service.success(capsule('other-school', f.now, other))
    f.setNow('2026-11-17T00:00:00.000Z'); await f.service.success(capsule('day-2', f.now))
    const own = await f.service.schoolRanking(admin)
    expect(own).toMatchObject({ scope: 'school', total: 1, rows: [{ schoolId: 'school-a', uses: 2, activeUsers: 1 }] })
    expect(await f.service.schoolRanking(root)).toMatchObject({ scope: 'platform', total: 2, overview: { uses: 3, activeUsers: 2 } })
    await expect(f.service.userDetail(admin, target(other))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(f.service.schoolRanking(admin, { schoolId: 'school-b' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    for (const actor of [alice, bob]) { await expect(f.service.userDetail(actor, target())).rejects.toMatchObject({ code: 'FORBIDDEN' }); await expect(f.service.schoolRanking(actor)).rejects.toMatchObject({ code: 'FORBIDDEN' }) }
    expect(await f.service.userDetail(root, target(other))).toMatchObject({ schoolId: 'school-b', uses: 1 })
  })
  it('sorts tied school usage stably before search/pagination and never sums daily active users', async () => {
    const f = await activityFixture()
    await f.service.success(capsule('a', f.now)); await f.service.success(capsule('b', f.now, other))
    const one = await f.service.schoolRanking(root, { pageSize: 1 }), two = await f.service.schoolRanking(root, { pageSize: 1, page: 2 })
    expect(one.rows[0]).toMatchObject({ rank: 1, schoolId: 'school-a' }); expect(two.rows[0]).toMatchObject({ rank: 1, schoolId: 'school-b' })
    expect((await f.service.schoolRanking(root, { q: '学校乙' })).rows.map(row => row.schoolId)).toEqual(['school-b'])
    expect((await f.service.schoolRanking(root, { sort: 'visits', order: 'desc' })).rows.map(row => row.schoolId)).toEqual(['school-a', 'school-b'])
  })
  it('uses a current exact-catalog avatar snapshot and excludes disabled/alias/archived/ops accounts from ranks', async () => {
    const f = await activityFixture(), before = rosterFixture()
    const excludedSchools = ['disabled', 'alias', 'merged', 'archived', 'pending']
    const schools: ActivityRoster['schools'] = [...before.schools, ...excludedSchools.map(id => ({ id, name: `学校-${id}`, status: id === 'disabled' ? 'disabled' as const : 'active' as const, ...(id === 'alias' ? { rosterAliasOf: 'school-a' } : {}), ...(id === 'merged' ? { mergedInto: 'school-a' } : {}), ...(id === 'archived' ? { archivedAt: f.now } : {}), ...(id === 'pending' ? { reviewState: 'pending' } : {}) }))]
    f.setRoster({ version: 'avatars-v2', schools, users: [...before.users.map(user => user.userKey === alice.userKey ? { ...user, avatarUrl: ACTIVITY_AVATARS[0]!.path } : user.userKey === bob.userKey ? { ...user, avatarUrl: `${ACTIVITY_AVATARS[0]!.path}?tracking=1` } : user), ...excludedSchools.map(id => ({ schoolId: id, userKey: `${id}:student`, username: 'student', role: 'STUDENT' as const, status: 'active' as const, avatarUrl: ACTIVITY_AVATARS[0]!.path })), { schoolId: 'school-a', userKey: 'school-a:disabled', username: 'disabled', status: 'disabled', role: 'STUDENT', avatarUrl: ACTIVITY_AVATARS[0]!.path }] })
    await f.service.success(capsule('real-use', f.now))
    const ranking = await f.service.schoolRanking(root, { days: 1 })
    expect(ranking.total).toBe(2)
    const snapshot = ranking.rows.find(row => row.schoolId === 'school-a')!.avatars
    expect(snapshot).toMatchObject({ eligibleUsers: 3, adoptedUsers: 2, otherUsers: 1 })
    expect(snapshot.distribution).toHaveLength(12)
    expect(snapshot.distribution.reduce((sum, row) => sum + row.users, 0) + snapshot.otherUsers).toBe(snapshot.eligibleUsers)
    const changed = f.roster.users.map(user => user.userKey === alice.userKey ? { ...user, avatarUrl: ACTIVITY_AVATARS[11]!.path } : user)
    f.setRoster({ ...f.roster, version: 'avatars-v3', users: changed })
    expect((await f.service.schoolRanking(root, { days: 7 })).rows.find(row => row.schoolId === 'school-a')!.avatars.distribution[11]!.users).toBe(1)
  })
  it('groups once, caches by permission/time/data+roster version, and respects finite cache/global row/byte budgets', async () => {
    const roster = vi.fn(rosterFixture), f = await activityFixture({ roster, limits: { maxCacheEntries: 2 } })
    await f.service.success(capsule('one', f.now))
    const before = f.service.diagnostics()
    await f.service.schoolRanking(root, { pageSize: 1 }); await f.service.schoolRanking(root, { pageSize: 2, sort: 'visits' })
    expect(f.service.diagnostics().bucketScans - before.bucketScans).toBe(1)
    expect(f.service.diagnostics().receiptScans - before.receiptScans).toBe(1)
    expect(roster).toHaveBeenCalledTimes(2) // permission/roster-version is refreshed even when aggregate cache hits
    await f.service.schoolRanking(admin); await f.service.schoolRanking(root, { days: 30 })
    expect(f.service.diagnostics().cacheEntries).toBeLessThanOrEqual(2)
    expect(f.service.diagnostics().cacheBytes).toBeLessThanOrEqual(f.service.limits.maxCacheBytes)
    expect(f.service.diagnostics().storedBytes).toBeLessThanOrEqual(f.service.limits.maxStoredBytes)
    expect(f.service.diagnostics().rows).toBeLessThanOrEqual(f.service.limits.maxRows)
  })
  it('refuses rate, fixed-shard event, global row/byte and roster budgets with visible incomplete status', async () => {
    const rate = await activityFixture({ limits: { maxClientEventsPerMinute: 1 } }), visit = clientEvent('visit', '2026-11-16T00:00:00.000Z')
    await rate.service.recordClientEvent(alice, visit); await rate.service.recordClientEvent(alice, visit)
    await expect(rate.service.recordClientEvent(alice, clientEvent('open', rate.now))).rejects.toMatchObject({ code: 'ACTIVITY_RATE_LIMIT' })
    const shards = await activityFixture({ limits: { maxEventsPerBucket: 1 } })
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => shards.service.recordClientEvent(alice, clientEvent('open', shards.now))))
    expect(outcomes.filter(value => value.status === 'rejected').length).toBeGreaterThanOrEqual(1)
    expect(shards.domain.table('buckets').size).toBeLessThanOrEqual(4)
    const rows = await activityFixture({ limits: { maxRows: 3 } })
    await rows.service.success(capsule('first', rows.now))
    expect(await rows.service.success(capsule('second', rows.now))).toMatchObject({ status: 'pending', code: 'ACTIVITY_CAPACITY' })
    const byteLimit = await activityFixture({ limits: { maxStoredBytes: 450 } })
    expect(await byteLimit.service.success(capsule('too-large', byteLimit.now))).toMatchObject({ status: 'pending', code: 'ACTIVITY_CAPACITY' })
    const rosterLimit = await activityFixture({ limits: { maxRosterUsers: 1 } })
    await expect(rosterLimit.service.schoolRanking(root)).rejects.toMatchObject({ code: 'ACTIVITY_ROSTER_BUDGET' })
    expect((await rate.service.schoolRanking(admin)).integrity).toMatchObject({ state: 'incomplete', codes: expect.arrayContaining(['ACTIVITY_RATE_LIMIT']) })
  })
  it('keeps real open-school users in rank by default, exposes exact exclusions, and preserves excluded personal history', async () => {
    const f = await activityFixture(), opened = { ...alice, schoolId: 'PHYSICSOS-OPEN', userKey: 'PHYSICSOS-OPEN:real-student' }
    const roster = { ...f.roster, version: 'open-school', schools: [...f.roster.schools, { id: 'PHYSICSOS-OPEN', name: '开放学校', status: 'active' as const }], users: [...f.roster.users, { schoolId: opened.schoolId, userKey: opened.userKey, username: opened.username, status: 'active' as const, role: 'STUDENT' as const, avatarUrl: ACTIVITY_AVATARS[0]!.path }] }
    f.setRoster(roster); await f.service.success(capsule('real-open-run', f.now, opened))
    expect((await f.service.schoolRanking(root)).rows.find(row => row.schoolId === opened.schoolId)).toMatchObject({ uses: 1, activeUsers: 1 })
    await f.restart({ excludedAccountKeys: [{ schoolId: opened.schoolId, userKey: opened.userKey }] })
    expect((await f.service.schoolRanking(root)).rankingExclusions.accounts).toEqual([{ schoolId: opened.schoolId, username: opened.username }])
    expect((await f.service.schoolRanking(root)).rows.find(row => row.schoolId === opened.schoolId)).toMatchObject({ uses: 0, activeUsers: 0 })
    expect(await f.service.userDetail(root, target(opened))).toMatchObject({ uses: 1 })
  })
  it('expires unreplayed durable receipts at the original day and reports a restart gap beyond seven days', async () => {
    const f = await activityFixture(), value = capsule('pending-then-expired', f.now)
    f.faults.before = write => { if (write.table === 'buckets') throw new Error('bucket unavailable') }
    expect(await f.service.success(value)).toMatchObject({ status: 'pending' })
    f.faults.before = undefined; f.setNow('2026-11-24T00:00:00.000Z')
    await f.restart({ replaySources: [f.businessSource('canvas-edit')] }); await f.service.recover()
    expect([...f.domain.table('receipts').entries()].map(([, row]) => row.state)).toEqual(['expired'])
    expect(await f.service.userDetail(admin, target(), { days: 1 })).toMatchObject({ uses: 0 })
    expect((await f.service.schoolRanking(root, { days: 30 })).integrity.codes).toEqual(expect.arrayContaining(['ACTIVITY_REPLAY_EXPIRED', 'ACTIVITY_REPLAY_GAP']))
  })
  it('refuses a cold reopen above the global scan budget rather than pretending UI pagination is an index', async () => {
    const f = await activityFixture(); await f.service.success(capsule('durable', f.now))
    await expect(f.restart({ limits: { maxScanRows: 1 } })).rejects.toMatchObject({ code: 'ACTIVITY_COLD_START_BUDGET' })
  })
  it('keeps bridge read-only and defaults the real-query capacity gate closed', async () => {
    const f = await activityFixture(); await f.service.success(capsule('before-bridge', f.now))
    await f.restart({ mode: 'bridge' })
    expect(await f.service.success(capsule('bridge-new', f.now))).toMatchObject({ status: 'rejected', code: 'ACTIVITY_COLLECTION_DISABLED' })
    await expect(f.service.recordClientEvent(alice, clientEvent('visit', f.now))).rejects.toMatchObject({ code: 'ACTIVITY_COLLECTION_DISABLED' })
    expect(await f.service.schoolRanking(root)).toMatchObject({ overview: { uses: 1 } })
    await f.restart({ queryCapacityVerified: false })
    await expect(f.service.schoolRanking(root)).rejects.toMatchObject({ code: 'ACTIVITY_CAPACITY_UNVERIFIED' })
  })
})
