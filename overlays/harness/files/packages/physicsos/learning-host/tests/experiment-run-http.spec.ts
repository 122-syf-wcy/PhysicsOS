/** Real HTTP boundary tests, authored but NOT run. */
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { createMechanicsWorkspaceRuntime } from '../../../client/ui-physicsos/src/client/physics/mechanics-workspace-runtime.ts'
import { createExperimentSession } from '../../../client/ui-physicsos/src/client/experiments/experiment-session.ts'
import { createExperimentRunTracker } from '../../../client/ui-physicsos/src/client/experiments/experiment-run-tracking.ts'
import { createExperimentRunApi } from '../../../client/ui-physicsos/src/client/experiments/experiment-run-api.ts'
import { experimentRunRoutes, EXPERIMENT_RUN_OWNER_HEADER, EXPERIMENT_RUN_PREFIX } from '../src/experiment-run-routes.ts'
import type { IdentityActor, PhysicsosIdentity } from '../src/identity.ts'
import { experimentRunFixture, runAlice, runBob, runBody, runForeign } from './experiment-run-fixture.ts'
async function runHttpFixture(mode: 'off' | 'bridge' | 'enabled' = 'enabled') {
  const fixture = await experimentRunFixture({ mode })
  let current: IdentityActor | undefined = runAlice
  const identity: PhysicsosIdentity = {
    actorOf: req => req.headers.cookie === 'run-session=alice' ? current ?? null : req.headers.cookie === 'run-session=bob' ? runBob : req.headers.cookie === 'run-session=foreign' ? runForeign : null,
    record: async () => {},
  }
  let missingIdentity = false
  const handler = experimentRunRoutes({ service: fixture.service, identity: () => missingIdentity ? undefined : identity })
  const server = createServer((req, res) => { void handler(req, res) }); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No isolated test HTTP listener')
  const base = `http://127.0.0.1:${address.port}`
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) }) })
  const owner = encodeURIComponent(JSON.stringify({ schoolId: runAlice.schoolId, username: runAlice.username }))
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${EXPERIMENT_RUN_PREFIX}${path}`, {
    method, headers: { cookie: 'run-session=alice', [EXPERIMENT_RUN_OWNER_HEADER]: owner, origin: base, 'sec-fetch-site': 'same-origin',
      'x-physicsos-experiment-run-capability': 'experiment-run-v1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { fixture, base, call, owner, setActor: (actor: IdentityActor | undefined) => { current = actor }, setIdentityMissing: () => { missingIdentity = true } }
}
describe('experiment run HTTP cookie/same-origin/owner/generation boundary', () => {
  it('requires real cookie identity and mandatory expected-owner on both capability and mutations', async () => {
    const f = await runHttpFixture(), body = runBody(f.fixture.service)
    expect((await f.call('GET', '/capabilities', undefined, { cookie: '' })).status).toBe(401)
    expect((await f.call('GET', '/capabilities', undefined, { cookie: 'run-session=invalid' })).status).toBe(401)
    expect((await f.call('POST', '/prepare', body, { cookie: '', authorization: 'Bearer not-accepted' })).status).toBe(403)
    expect((await f.call('POST', '/prepare', body, { authorization: 'Bearer not-accepted' })).status).toBe(403)
    expect((await f.call('GET', '/capabilities', undefined, { authorization: 'Basic not-accepted' })).status).toBe(403)
    expect((await f.call('GET', '/capabilities', undefined, { [EXPERIMENT_RUN_OWNER_HEADER]: '' })).status).toBe(400)
    const noExpected = await fetch(`${f.base}${EXPERIMENT_RUN_PREFIX}/capabilities`, { headers: { cookie: 'run-session=alice', origin: f.base } })
    expect(noExpected.status).toBe(428)
    const other = encodeURIComponent(JSON.stringify({ schoolId: runBob.schoolId, username: runBob.username }))
    expect((await f.call('POST', '/prepare', body, { [EXPERIMENT_RUN_OWNER_HEADER]: other })).status).toBe(401)
    const caps = await f.call('GET', '/capabilities')
    expect(caps.status).toBe(200); expect(caps.headers.get('cache-control')).toBe('private, no-store')
    expect(await caps.json()).toMatchObject({ mode: 'enabled', recordingEnabled: true, provenance: 'client-observed', scope: 'lab-workspace' })
    f.setIdentityMissing()
    expect((await f.call('POST', '/prepare', body)).status).toBe(503)
    expect(f.fixture.writes).toEqual([])
  })
  it('rejects missing/mismatched Origin, same-site without same-origin, non-JSON, old clients, body owner/time and arbitrary IDs', async () => {
    const f = await runHttpFixture(), body = runBody(f.fixture.service)
    expect((await f.call('POST', '/prepare', body, { origin: 'https://outside.invalid' })).status).toBe(403)
    expect((await f.call('POST', '/prepare', body, { origin: `${f.base}/` })).status).toBe(403)
    expect((await f.call('POST', '/prepare', body, { origin: 'https://outside.invalid', 'x-forwarded-proto': 'https' })).status).toBe(403)
    expect((await f.call('POST', '/prepare', body, { 'sec-fetch-site': 'same-site' })).status).toBe(403)
    expect((await f.call('POST', '/prepare', body, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    const missingOrigin = await fetch(`${f.base}${EXPERIMENT_RUN_PREFIX}/prepare`, { method: 'POST', headers: { cookie: 'run-session=alice', [EXPERIMENT_RUN_OWNER_HEADER]: f.owner, 'content-type': 'application/json', 'x-physicsos-experiment-run-capability': 'experiment-run-v1' }, body: JSON.stringify(body) })
    expect(missingOrigin.status).toBe(403)
    expect((await f.call('POST', '/prepare', body, { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await f.call('POST', '/prepare', body, { 'x-physicsos-experiment-run-capability': '' })).status).toBe(426)
    for (const input of [{ ...body, owner: runBob }, { ...body, recordedAt: '2026-11-16T00:00:00Z' }, { ...body, sceneJSON: '{}' }, { ...body, experimentId: 'made-up-id' }]) {
      expect((await f.call('POST', '/prepare', input)).status).toBe(400)
    }
    expect((await f.call('POST', '/prepare', { ...body, expectedCapabilityGeneration: randomUUID() })).status).toBe(409)
    expect(f.fixture.writes).toEqual([])
  })
  it('preserves the existing exact trusted reverse-Host origin boundary without trusting forwarded-proto, including candidate loopback', async () => {
    const f = await runHttpFixture()
    expect((await f.call('POST', '/prepare', runBody(f.fixture.service), { origin: f.base.replace('http:', 'https:'), 'x-forwarded-proto': 'untrusted-value' })).status).toBe(200)
    expect((await f.call('POST', '/prepare', runBody(f.fixture.service), { origin: f.base })).status).toBe(200)
    expect((await f.call('POST', '/prepare', runBody(f.fixture.service), { origin: 'https://outside.invalid', 'x-forwarded-proto': 'https' })).status).toBe(403)
  })
  it('requires a matching prepare and permit before an atomic record, returns stable idempotent ACK, and never accepts a direct use event', async () => {
    const f = await runHttpFixture(), body = runBody(f.fixture.service)
    expect((await f.call('POST', '/record', { ...body, permit: 'x'.repeat(43) })).status).toBe(404)
    const prepared = await f.call('POST', '/prepare', body)
    expect(prepared.status).toBe(200)
    const permit = await prepared.json()
    expect(f.fixture.domain.table('runs').get(body.runId)).not.toHaveProperty('activitySuccess')
    expect((await f.call('POST', '/record', { ...body, permit: 'x'.repeat(43) })).status).toBe(403)
    const recorded = await f.call('POST', '/record', { ...body, permit: permit.permit })
    expect(recorded.status).toBe(200); const ack = await recorded.json()
    expect(ack).toMatchObject({ runId: body.runId, recordedAt: f.fixture.now, provenance: 'client-observed', replayed: false })
    expect(ack).not.toHaveProperty('permit'); expect(ack).not.toHaveProperty('owner')
    const replay = await f.call('POST', '/record', { ...body, permit: permit.permit })
    expect(await replay.json()).toEqual({ ...ack, replayed: true })
    expect((await f.call('POST', '/record', { ...body, experimentId: 'uniform-linear', permit: permit.permit })).status).toBe(409)
    expect((await f.call('POST', '/success', { source: 'experiment-run', operationId: body.runId })).status).toBe(404)
    const otherOwner = encodeURIComponent(JSON.stringify({ schoolId: runBob.schoolId, username: runBob.username }))
    expect((await f.call('POST', '/record', { ...body, permit: permit.permit }, { cookie: 'run-session=bob', [EXPERIMENT_RUN_OWNER_HEADER]: otherOwner })).status).toBe(403)
  })
  it('uses full byte admission and exact routes without query/path/header ambiguity', async () => {
    const f = await runHttpFixture(), body = runBody(f.fixture.service)
    expect((await f.call('POST', '/prepare', { ...body, padding: 'x'.repeat(2000) })).status).toBe(413)
    for (const path of ['/prepare?x=1', '/prepare?x=1&x=2', '/prepare/', '//prepare', '/record/extra']) {
      expect((await f.call('POST', path, body)).status).toBe(path.includes('?') ? 400 : 404)
    }
    const duplicate = await new Promise<number>((resolve, reject) => {
      const url = new URL(`${f.base}${EXPERIMENT_RUN_PREFIX}/prepare`), encoded = JSON.stringify(body)
      const req = httpRequest(url, { method: 'POST', headers: [
        'host', url.host, 'cookie', 'run-session=alice', 'origin', f.base, 'content-type', 'application/json',
        'x-physicsos-experiment-run-capability', 'experiment-run-v1', 'content-length', String(Buffer.byteLength(encoded)),
        EXPERIMENT_RUN_OWNER_HEADER, f.owner, EXPERIMENT_RUN_OWNER_HEADER, f.owner,
      ] }, res => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject); req.end(encoded)
    })
    expect(duplicate).toBe(400); expect(f.fixture.writes).toEqual([])
  })
  it('rechecks a queued request before durable mutation when its cookie actor changes', async () => {
    const f = await runHttpFixture()
    let release!: () => void, entered!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve }), writing = new Promise<void>(resolve => { entered = resolve })
    f.fixture.faults.before = async () => { entered(); await barrier }
    const first = f.call('POST', '/prepare', runBody(f.fixture.service)); await writing
    const second = f.call('POST', '/prepare', runBody(f.fixture.service))
    f.setActor(runBob); release()
    expect((await first).status).toBe(401); expect((await second).status).toBe(401)
    expect(f.fixture.writes).toHaveLength(1)
    expect((f.fixture.writes[0]!.value as { state: string }).state).toBe('prepared')
  })
  it('traces prepare -> actual MechanicsEngine first advance -> record -> durable capsule across the real HTTP handlers', async () => {
    const f = await runHttpFixture(), sent: { path: string; body: unknown }[] = []
    const fetcher: typeof fetch = async (url, init = {}) => {
      const headers = new Headers(init.headers)
      headers.set('cookie', 'run-session=alice'); headers.set('origin', f.base); headers.set('sec-fetch-site', 'same-origin')
      sent.push({ path: String(url), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) })
      return fetch(new URL(String(url), f.base), { ...init, headers })
    }
    const api = createExperimentRunApi({ owner: { schoolId: runAlice.schoolId, username: runAlice.username }, fetch: fetcher })
    const capabilities = await api.capabilities(new AbortController().signal)
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ sceneId: 'real-http-engine-chain', model: 'inclined_plane', mass: 2,
      inclineAngle: 30, frictionCoefficient: 0.2, gravity: { x: 0, y: -9.8, z: 0 } }))
    const session = createExperimentSession(runtime)
    const tracking = createExperimentRunTracker({ session, experimentId: 'incline', api, capabilities,
      owner: { schoolId: runAlice.schoolId, username: runAlice.username }, presentationGeneration: randomUUID(), isCurrent: () => true,
      now: () => Date.parse(f.fixture.now) })
    onTestFinished(tracking.dispose)
    runtime.getSnapshot(); session.advance(0.1)
    expect(sent.filter(request => request.path.endsWith('/prepare') || request.path.endsWith('/record'))).toEqual([])
    session.setRunning(true)
    await vi.waitFor(() => { expect(f.fixture.writes).toHaveLength(1) })
    expect(f.fixture.writes[0]!.value).toMatchObject({ state: 'prepared' })
    expect(sent.filter(request => request.path.endsWith('/record'))).toEqual([])
    const before = runtime.getSnapshot().clock.time
    session.advance(0.1)
    expect(runtime.getSnapshot().clock.time).toBeGreaterThan(before)
    await vi.waitFor(() => { expect(f.fixture.writes).toHaveLength(2) })
    expect(f.fixture.writes[1]!.value).toMatchObject({ state: 'recorded', provenance: 'client-observed', activitySuccess: { source: 'experiment-run' } })
    const prepare = sent.find(request => request.path.endsWith('/prepare'))!.body as { runId: string }
    const record = sent.find(request => request.path.endsWith('/record'))!.body as { runId: string; permit: string }
    expect(record.runId).toBe(prepare.runId)
    expect(JSON.stringify(f.fixture.writes)).not.toContain(record.permit)
    for (let index = 0; index < 10; index++) { session.advance(0.1); runtime.getSnapshot() }
    expect(sent.filter(request => request.path.endsWith('/record'))).toHaveLength(1)
  })
  it('allows bridge capabilities but no prepare/record and retains no invented empty row', async () => {
    const f = await runHttpFixture('bridge')
    expect(await (await f.call('GET', '/capabilities')).json()).toMatchObject({ mode: 'bridge', recordingEnabled: false })
    expect((await f.call('POST', '/prepare', runBody(f.fixture.service))).status).toBe(423)
    expect((await f.call('POST', '/record', { ...runBody(f.fixture.service), permit: 'x'.repeat(43) })).status).toBe(423)
    expect(f.fixture.writes).toEqual([])
  })
})
