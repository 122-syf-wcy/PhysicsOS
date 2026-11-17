/** Cross-domain recovery test source only; NOT executed. Business commit -> sink loss -> original-time replay. */
import { describe, expect, it } from 'vitest'
import { activityFixture, alice, admin } from './activity-fixture.ts'
import { experimentRunFixture, runAlice, runBody } from './experiment-run-fixture.ts'

describe('experiment run durable capsule -> activity v1 recovery', () => {
  it('recovers a real committed run after the sink was unavailable, without counting prepare or old attempts/scenes', async () => {
    const run = await experimentRunFixture({ activitySink: { success: async () => ({ status: 'pending' }) } })
    const activity = await activityFixture({ replaySources: [run.service.activityReplaySource] })
    // Start both domains before the business fact; the activity start boundary must not be fabricated backwards.
    run.setNow('2026-11-16T00:00:01.000Z'); activity.setNow('2026-11-16T00:00:01.000Z')
    expect(runAlice.schoolId).toBe(alice.schoolId); expect(runAlice.userKey).toBe(alice.userKey)
    const preparedOnly = runBody(run.service)
    await run.service.prepare(runAlice, preparedOnly)
    const body = runBody(run.service), permit = await run.service.prepare(runAlice, body)
    await run.service.record(runAlice, { ...body, permit: permit.permit })
    expect(await activity.service.userDetail(admin, { schoolId: alice.schoolId, username: alice.username })).toMatchObject({ uses: 0 })
    await run.restart({ mode: 'bridge' })
    // New source object comes from the reopened business domain; it does not use the dead service's memory index.
    activity.setNow('2026-11-16T00:00:02.000Z')
    await activity.restart({ replaySources: [run.service.activityReplaySource] })
    await activity.service.recover()
    const first = await activity.service.userDetail(admin, { schoolId: alice.schoolId, username: alice.username, days: 1 })
    expect(first).toMatchObject({ uses: 1, lastUseAt: '2026-11-16T00:00:01.000Z' })
    expect(first.modules.find(module => module.module === 'lab')).toMatchObject({ uses: 1 })
    await activity.service.recover()
    expect(await activity.service.userDetail(admin, { schoolId: alice.schoolId, username: alice.username })).toMatchObject({ uses: 1 })
    expect(run.units.every(name => name === 'physicsos_experiment_run_v1')).toBe(true)
    expect(run.domain.table('runs').get(preparedOnly.runId)?.state).toBe('prepared')
  })
})
