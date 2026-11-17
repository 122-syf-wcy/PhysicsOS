/** Test source only: not executed as part of this change. */
import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { experimentRunDomain, experimentRunRowSchema } from '../src/experiment-run-domain.ts'
import { ExperimentRunService } from '../src/experiment-run-service.ts'
import { EXPERIMENT_RUN_REPLAY_MS } from '../src/experiment-run-types.ts'
import type { ActivitySuccessCapsule } from '../src/activity-contract.ts'
import { experimentRunFixture, runAlice, runBob, runBody, runForeign } from './experiment-run-fixture.ts'
const signal = (): AbortSignal => new AbortController().signal
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('independent client-observed experiment run source', () => {
  it('uses its own version-0 per-record unit and fails closed in default/bridge/off/missing-catalog modes', async () => {
    const f = await experimentRunFixture({ mode: 'bridge' })
    expect(experimentRunDomain).toMatchObject({ name: 'physicsos_experiment_run_v1', version: 0, layout: 'per-record' })
    expect(f.units).toEqual(['physicsos_experiment_run_v1'])
    expect(f.service.capabilities()).toMatchObject({ mode: 'bridge', recordingEnabled: false, provenance: 'client-observed', scope: 'lab-workspace' })
    await expect(f.service.prepare(runAlice, runBody(f.service))).rejects.toMatchObject({ status: 423, code: 'RUN_RECORDING_DISABLED' })
    expect([...f.domain.table('runs').entries()]).toEqual([]); expect(f.writes).toEqual([])
    const defaultService = new ExperimentRunService(f.domain)
    await defaultService.initialize()
    expect(defaultService.capabilities()).toMatchObject({ mode: 'bridge', recordingEnabled: false })
    await defaultService.dispose()
    await f.restart({ mode: 'off' })
    await expect(f.service.prepare(runAlice, runBody(f.service))).rejects.toMatchObject({ status: 423 })
    await f.restart({ mode: 'enabled', resolveExperiment: undefined })
    expect(f.service.capabilities()).toMatchObject({ mode: 'enabled', recordingEnabled: false })
    await expect(f.service.prepare(runAlice, runBody(f.service))).rejects.toMatchObject({ status: 503, code: 'RUN_CATALOG_UNAVAILABLE' })
    expect(f.writes).toEqual([])
  })
  it('keeps a lazy app-context catalog seam unavailable until mounted, and does not disguise missing collection as an empty complete source', async () => {
    let mounted = false
    const f = await experimentRunFixture({ catalogAvailable: () => mounted })
    expect(f.service.capabilities().recordingEnabled).toBe(false)
    await expect(f.service.prepare(runAlice, runBody(f.service))).rejects.toMatchObject({ code: 'RUN_CATALOG_UNAVAILABLE' })
    await expect(f.service.activityReplaySource.read({ from: '2026-11-17T01:00:00.000Z', to: f.now, limit: 10, signal: signal() })).rejects.toMatchObject({ code: 'RUN_CATALOG_UNAVAILABLE' })
    expect(f.writes).toEqual([])
    mounted = true
    expect(f.service.capabilities().recordingEnabled).toBe(true)
    await expect(f.service.prepare(runAlice, runBody(f.service))).resolves.toMatchObject({ experimentId: 'incline' })
  })
  it('accepts only exact catalog identities and the minimal closed request shapes', async () => {
    const f = await experimentRunFixture()
    const body = runBody(f.service)
    for (const input of [
      { ...body, runId: 'not-a-uuid' }, { ...body, experimentId: 'arbitrary-valid-slug' },
      { ...body, experimentId: '__proto__' }, { ...body, owner: runBob }, { ...body, occurredAt: f.now },
      { ...body, sceneJSON: '{}' }, { ...body, question: 'not collected' }, { ...body, x: 10 },
    ]) await expect(f.service.prepare(runAlice, input)).rejects.toMatchObject({ status: 400 })
    expect(f.writes).toEqual([])
    const permit = await f.service.prepare(runAlice, body)
    await expect(f.service.record(runAlice, permit)).rejects.toMatchObject({ status: 400 }) // expiresAt never uploads
    const { expiresAt: _expiresAt, ...record } = permit
    for (const input of [{ ...record, timestamp: f.now }, { ...record, owner: runBob }, { ...record, provenance: 'server-verified' }]) {
      await expect(f.service.record(runAlice, input)).rejects.toMatchObject({ status: 400 })
    }
    await expect(f.service.record(runAlice, record)).resolves.toMatchObject({ provenance: 'client-observed', replayed: false })
  })
  it('prepares one durable hash-only reservation; ready/prepare/retry alone never creates a use capsule', async () => {
    const delivered: ActivitySuccessCapsule[] = []
    const f = await experimentRunFixture({ activitySink: { success: async capsule => { delivered.push(capsule); return { status: 'recorded' } } } })
    const body = runBody(f.service), first = await f.service.prepare(runAlice, body)
    f.setNow('2026-11-17T02:00:30.000Z')
    const retry = await f.service.prepare(runAlice, body)
    expect(retry).toEqual(first); expect(first.expiresAt).toBe('2026-11-17T02:02:00.000Z')
    const row = f.domain.table('runs').get(body.runId)!
    expect(row).toMatchObject({ state: 'prepared', owner: { schoolId: runAlice.schoolId, userKey: runAlice.userKey }, permitHash: hash(first.permit) })
    expect(row).not.toHaveProperty('recordedAt'); expect(row).not.toHaveProperty('activitySuccess')
    expect(JSON.stringify(f.writes)).not.toContain(first.permit); expect(f.writes).toHaveLength(1); expect(delivered).toEqual([])
    const replay = await f.service.activityReplaySource.read({ from: '2026-11-17T01:59:00.000Z', to: f.now, limit: 20, signal: signal() })
    expect(replay).toEqual({ capsules: [] })
  })
  it('stores original server time, owner, stable hash and capsule in the SAME successful update before delivery', async () => {
    const delivered: ActivitySuccessCapsule[] = []
    const f = await experimentRunFixture({ activitySink: { success: async capsule => {
      const stored = f.domain.table('runs').get(capsule.operationId)
      expect(stored).toMatchObject({ state: 'recorded', recordedAt: capsule.occurredAt, activitySuccess: capsule })
      delivered.push(capsule); return { status: 'recorded' }
    } } })
    const body = runBody(f.service), permit = await f.service.prepare(runAlice, body)
    f.setNow('2026-11-17T02:00:01.000Z')
    const input = { ...body, permit: permit.permit }, ack = await f.service.record(runAlice, input)
    expect(ack).toEqual({ runId: body.runId, experimentId: 'incline', recordedAt: f.now, provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', replayed: false })
    const stored = f.domain.table('runs').get(body.runId)!
    expect(stored).toMatchObject({ state: 'recorded', stableHash: expect.stringMatching(/^[a-f0-9]{64}$/), activitySuccess: {
      version: 1, source: 'experiment-run', operationId: body.runId, occurredAt: f.now, owner: { schoolId: runAlice.schoolId, userKey: runAlice.userKey },
    } })
    expect(f.writes).toHaveLength(2); expect(delivered).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain(permit.permit)
    const saved = JSON.stringify(stored), at = ack.recordedAt
    f.setNow('2026-11-17T02:00:20.000Z')
    expect(await f.service.record(runAlice, input)).toEqual({ ...ack, recordedAt: at, replayed: true })
    expect(JSON.stringify(f.domain.table('runs').get(body.runId))).toBe(saved); expect(f.writes).toHaveLength(2)
    if (stored.state !== 'recorded') throw new Error('Expected real success')
    expect(experimentRunRowSchema.safeParse({ ...stored, activitySuccess: { ...stored.activitySuccess, occurredAt: '2026-11-17T02:00:02.000Z' } }).success).toBe(false)
  })
  it('serializes duplicate prepares and records and rejects changed content, foreign owner, invalid or unprepared permits', async () => {
    const f = await experimentRunFixture(), body = runBody(f.service)
    const [first, second] = await Promise.all([f.service.prepare(runAlice, body), f.service.prepare(runAlice, body)])
    expect(second).toEqual(first)
    const input = { ...body, permit: first.permit }
    await expect(f.service.record(runBob, input)).rejects.toMatchObject({ status: 403, code: 'RUN_OWNER_MISMATCH' })
    await expect(f.service.record(runForeign, input)).rejects.toMatchObject({ status: 403 })
    await expect(f.service.prepare(runBob, body)).rejects.toMatchObject({ status: 403 })
    await expect(f.service.prepare(runAlice, { ...body, experimentId: 'uniform-linear' })).rejects.toMatchObject({ status: 409, code: 'RUN_ID_REUSED' })
    await expect(f.service.record(runAlice, { ...input, experimentId: 'uniform-linear' })).rejects.toMatchObject({ status: 409 })
    await expect(f.service.record(runAlice, { ...input, permit: 'x'.repeat(43) })).rejects.toMatchObject({ status: 403, code: 'RUN_PERMIT_INVALID' })
    await expect(f.service.record(runAlice, { ...input, runId: randomUUID() })).rejects.toMatchObject({ status: 404, code: 'RUN_NOT_PREPARED' })
    const results = await Promise.all([f.service.record(runAlice, input), f.service.record(runAlice, input)])
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]); expect(f.writes).toHaveLength(2)
  })
  it('rejects expired permits and stale capability generations without re-dating or extending the original run', async () => {
    const f = await experimentRunFixture(), body = runBody(f.service), permit = await f.service.prepare(runAlice, body)
    f.setNow(permit.expiresAt)
    await expect(f.service.record(runAlice, { ...body, permit: permit.permit })).rejects.toMatchObject({ status: 410, code: 'RUN_PERMIT_EXPIRED' })
    await expect(f.service.prepare(runAlice, body)).rejects.toMatchObject({ status: 410 })
    expect(f.writes).toHaveLength(1)
    f.setNow('2026-11-17T02:00:01.000Z')
    await f.restart()
    expect(f.service.capabilityGeneration).not.toBe(body.expectedCapabilityGeneration)
    await expect(f.service.record(runAlice, { ...body, permit: permit.permit })).rejects.toMatchObject({ status: 409, code: 'RUN_CAPABILITY_CHANGED' })
    expect(f.writes).toHaveLength(1)
  })
  it('refuses backward clocks; it never turns an unobserved old reservation into a new run', async () => {
    const f = await experimentRunFixture(), body = runBody(f.service), permit = await f.service.prepare(runAlice, body)
    f.setNow('2026-11-17T01:59:59.000Z')
    await expect(f.service.record(runAlice, { ...body, permit: permit.permit })).rejects.toMatchObject({ status: 409, code: 'RUN_CLOCK_CHANGED' })
    expect(f.domain.table('runs').get(body.runId)?.state).toBe('prepared')
  })
  it.each(['before', 'after'] as const)('freezes on %s-ACK storage failure and cold reopen replays only the durable fact', async phase => {
    const delivered = vi.fn(async () => ({ status: 'recorded' as const }))
    const f = await experimentRunFixture({ activitySink: { success: delivered } }), body = runBody(f.service), permit = await f.service.prepare(runAlice, body)
    f.faults[phase] = write => { if ((write.value as { state?: string }).state === 'recorded') throw new Error('test storage fault') }
    await expect(f.service.record(runAlice, { ...body, permit: permit.permit })).rejects.toMatchObject({ status: 503, code: 'RUN_STORAGE_UNCERTAIN' })
    expect(delivered).not.toHaveBeenCalled(); expect(f.issues).toContain('EXPERIMENT_RUN_STORAGE_UNCERTAIN')
    await expect(f.service.prepare(runAlice, runBody(f.service))).rejects.toMatchObject({ code: 'RUN_STORAGE_UNCERTAIN' })
    f.faults.before = undefined; f.faults.after = undefined
    await f.restart()
    f.setNow('2026-11-17T02:00:01.000Z')
    const replay = await f.service.activityReplaySource.read({ from: '2026-11-17T01:59:00.000Z', to: f.now, limit: 10, signal: signal() })
    expect(replay.capsules).toHaveLength(phase === 'after' ? 1 : 0)
    if (phase === 'after') expect(replay.capsules[0]).toMatchObject({ operationId: body.runId, occurredAt: '2026-11-17T02:00:00.000Z' })
  })
  it('returns durable business success despite throwing or never-settling activity sinks and throwing diagnostics', async () => {
    const f = await experimentRunFixture({ activitySink: { success: async () => { throw new Error('activity unavailable') } }, onIssue: () => { throw new Error('diagnostic unavailable') } })
    const first = runBody(f.service), firstPermit = await f.service.prepare(runAlice, first)
    await expect(f.service.record(runAlice, { ...first, permit: firstPermit.permit })).resolves.toMatchObject({ replayed: false })
    await f.restart({ limits: { activityTimeoutMs: 5, maxActivityInFlight: 1 }, activitySink: { success: () => new Promise(() => {}) } })
    for (let index = 0; index < 2; index++) {
      const body = runBody(f.service), permit = await f.service.prepare(runAlice, body)
      await expect(f.service.record(runAlice, { ...body, permit: permit.permit })).resolves.toMatchObject({ provenance: 'client-observed' })
    }
    expect(f.issues).toContain('EXPERIMENT_RUN_ACTIVITY_PENDING')
  })
  it('replays compact committed capsules by original time/id through bounded pages after a fresh DomainFacility', async () => {
    const f = await experimentRunFixture(), ids = [randomUUID(), randomUUID(), randomUUID()].sort()
    for (const runId of ids) {
      const body = runBody(f.service, 'incline', runId), permit = await f.service.prepare(runAlice, body)
      await f.service.record(runAlice, { ...body, permit: permit.permit })
    }
    await f.service.prepare(runAlice, runBody(f.service)) // ready/prepared-only is never a source fact
    await f.restart({ mode: 'bridge' })
    f.setNow('2026-11-18T02:00:00.000Z')
    const query = { from: '2026-11-17T01:00:00.000Z', to: f.now, limit: 1, signal: signal() }
    const first = await f.service.activityReplaySource.read(query)
    expect(first.capsules).toHaveLength(1); expect(first.capsules[0]?.operationId).toBe(ids[0]); expect(first.nextCursor!.length).toBeLessThanOrEqual(512)
    const second = await f.service.activityReplaySource.read({ ...query, cursor: first.nextCursor! })
    const third = await f.service.activityReplaySource.read({ ...query, cursor: second.nextCursor! })
    expect([...first.capsules, ...second.capsules, ...third.capsules].map(row => row.operationId)).toEqual(ids)
    expect(third.nextCursor).toBeUndefined()
    expect(first.capsules[0]?.occurredAt).toBe('2026-11-17T02:00:00.000Z')
    expect(Object.keys(first.capsules[0]!).sort()).toEqual(['occurredAt', 'operationId', 'owner', 'source', 'version'])
    await expect(f.service.activityReplaySource.read({ ...query, limit: 201 })).rejects.toMatchObject({ code: 'BAD_RUN_REPLAY' })
    await expect(f.service.activityReplaySource.read({ ...query, from: '2026-11-17T00:00:00.000Z', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'BAD_RUN_REPLAY_CURSOR' })
    const aborted = new AbortController(); aborted.abort()
    await expect(f.service.activityReplaySource.read({ ...query, signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' })
    f.setNow('2026-11-25T02:00:00.000Z')
    expect((await f.service.activityReplaySource.read({ from: new Date(Date.parse(f.now) - EXPERIMENT_RUN_REPLAY_MS).toISOString(), to: f.now, limit: 10, signal: signal() })).capsules).toEqual([])
    await expect(f.service.activityReplaySource.read({ from: '2026-11-17T00:00:00.000Z', to: f.now, limit: 10, signal: signal() })).rejects.toMatchObject({ code: 'BAD_RUN_REPLAY' })
  })
  it('bounds account/global rows and reserved bytes, owner/global frequency, and queued operations', async () => {
    const account = await experimentRunFixture({ limits: { maxAccountRows: 1, maxRows: 2 } })
    await account.service.prepare(runAlice, runBody(account.service))
    await expect(account.service.prepare(runAlice, runBody(account.service))).rejects.toMatchObject({ code: 'RUN_ACCOUNT_QUOTA' })
    await account.service.prepare(runBob, runBody(account.service))
    await expect(account.service.prepare(runForeign, runBody(account.service))).rejects.toMatchObject({ code: 'RUN_GLOBAL_QUOTA' })
    const bytes = await experimentRunFixture({ limits: { maxRowBytes: 4096, maxAccountBytes: 4096, maxBytes: 8192 } })
    await bytes.service.prepare(runAlice, runBody(bytes.service))
    await expect(bytes.service.prepare(runAlice, runBody(bytes.service))).rejects.toMatchObject({ code: 'RUN_ACCOUNT_QUOTA' })
    const rates = await experimentRunFixture({ limits: { maxRequestsPerAccountMinute: 1, maxRequestsGlobalMinute: 2, maxRateOwners: 2 } })
    await rates.service.prepare(runAlice, runBody(rates.service))
    await expect(rates.service.prepare(runAlice, runBody(rates.service))).rejects.toMatchObject({ code: 'RUN_RATE_LIMIT' })
    await rates.service.prepare(runBob, runBody(rates.service))
    await expect(rates.service.prepare(runForeign, runBody(rates.service))).rejects.toMatchObject({ code: 'RUN_RATE_LIMIT' })
    const queue = await experimentRunFixture({ limits: { maxQueuedOperations: 1 } })
    let release!: () => void, entered!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve }), writing = new Promise<void>(resolve => { entered = resolve })
    queue.faults.before = async () => { entered(); await barrier }
    const waiting = queue.service.prepare(runAlice, runBody(queue.service)); await writing
    await expect(queue.service.prepare(runBob, runBody(queue.service))).rejects.toMatchObject({ code: 'RUN_QUEUE_FULL' })
    release(); await waiting
  })
  it('rechecks request lifetime and cookie ownership before write, without creating a capsule on cancel', async () => {
    const f = await experimentRunFixture(), body = runBody(f.service), abort = new AbortController()
    abort.abort()
    await expect(f.service.prepare(runAlice, body, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.writes).toEqual([])
    const permit = await f.service.prepare(runAlice, body)
    await expect(f.service.record(runAlice, { ...body, permit: permit.permit }, { assertOwner: () => { throw new Error('cookie changed') } })).rejects.toThrow('cookie changed')
    expect(f.domain.table('runs').get(body.runId)?.state).toBe('prepared')
    expect(f.writes).toHaveLength(1)
  })
})
