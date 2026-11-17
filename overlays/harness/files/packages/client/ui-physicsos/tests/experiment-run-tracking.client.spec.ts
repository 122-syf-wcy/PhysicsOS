// @vitest-environment jsdom
/** Real engine/controller test source only; NOT run. */
import { createMechanicsScene, createConvexLensScene } from '@physicsos/physics-scene'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createAuthController } from '../src/client/auth-store.ts'
import { createAuthApi } from '../src/client/auth-api.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { applyUniversalContributionIntent } from '../src/client/experiments/contribution-protocol.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createExperimentRunTracker, attachExperimentRunTracking, bindExperimentRunPresentation, installExperimentRunTracking } from '../src/client/experiments/experiment-run-tracking.ts'
import { createExperimentRunApi, ExperimentRunApiError, type ExperimentRunApi, type ExperimentRunCapabilities,
  type ExperimentRunPermit, type ExperimentRunPrepare } from '../src/client/experiments/experiment-run-api.ts'
const generation = '00000000-0000-4000-8000-000000000001', presentation = '00000000-0000-4000-8000-000000000002'
const owner = { schoolId: 'school-a', username: 'alice' }
const caps = (overrides: Partial<ExperimentRunCapabilities> = {}): ExperimentRunCapabilities => ({ schemaVersion: 1, capability: 'experiment-run-v1', mode: 'enabled', recordingEnabled: true,
  capabilityGeneration: generation, provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', permitTtlMs: 120_000, ...overrides })
const permitOf = (body: ExperimentRunPrepare): ExperimentRunPermit => ({ ...body, permit: 'a'.repeat(43), expiresAt: new Date(Date.now() + 120_000).toISOString() })
const user = (username = 'alice', schoolId = 'school-a') => ({ id: `${schoolId}:${username}`, schoolId, schoolName: schoolId, username, displayName: username, role: 'STUDENT' as const })
const actualEngine = () => {
  const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ sceneId: 'run-controller-real-incline', model: 'inclined_plane', mass: 2,
    inclineAngle: 30, frictionCoefficient: 0.2, gravity: { x: 0, y: -9.8, z: 0 } }))
  return { runtime, session: createExperimentSession(runtime) }
}
const apiFixture = () => {
  const prepare = vi.fn(async (body: ExperimentRunPrepare, _signal: AbortSignal) => permitOf(body))
  const record = vi.fn(async (body: ExperimentRunPermit, _signal: AbortSignal) => ({ runId: body.runId, experimentId: body.experimentId, recordedAt: new Date().toISOString(),
    provenance: 'client-observed' as const, boundary: 'platform-engine-first-step' as const, scope: 'lab-workspace' as const, replayed: false }))
  const api: ExperimentRunApi = { capabilities: async () => caps(), prepare, record }
  return { api, prepare, record }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear() })

describe('experiment run trusted runtime boundary', () => {
  it('prepares exactly one stable run intent, then records only after the actual MechanicsEngine advances', async () => {
    const { runtime, session } = actualEngine(), f = apiFixture(), boundaries: string[] = []
    const unsubscribe = session.subscribeRun(event => { boundaries.push(event.kind) })
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(() => { tracker.dispose(); unsubscribe() })
    session.getSnapshot(); runtime.getSnapshot(); session.advance(0.1); session.cancelPreview()
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled()
    session.setRunning(true)
    expect(f.prepare).toHaveBeenCalledOnce(); expect(f.record).not.toHaveBeenCalled()
    await Promise.resolve(); session.advance(0)
    expect(f.record).not.toHaveBeenCalled()
    const before = runtime.getSnapshot().clock.time
    session.advance(0.05)
    expect(runtime.getSnapshot().clock.time).toBeGreaterThan(before)
    await vi.waitFor(() => { expect(f.record).toHaveBeenCalledOnce() })
    expect(boundaries).toEqual(['started', 'first-step'])
    const prepared = f.prepare.mock.calls[0]![0], recorded = f.record.mock.calls[0]![0]
    expect(recorded.runId).toBe(prepared.runId); expect(recorded.experimentId).toBe('incline')
    expect(Object.keys(prepared).sort()).toEqual(['expectedCapabilityGeneration', 'experimentId', 'runId'])
    for (let index = 0; index < 30; index++) { session.advance(0.02); runtime.getSnapshot(); session.getSnapshot() }
    expect(f.prepare).toHaveBeenCalledOnce(); expect(f.record).toHaveBeenCalledOnce()
  })
  it('accepts the existing bounded V3 play intent but ignores third-party run-success messages and generic running snapshots', async () => {
    const { runtime, session } = actualEngine(), f = apiFixture()
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(tracker.dispose)
    expect(applyUniversalContributionIntent(session, { type: 'experiment/run-success', protocolVersion: 3, source: 'platform-engine' })).toBe(false)
    expect(applyUniversalContributionIntent(session, { type: 'playback/running', protocolVersion: 3, running: true, success: true })).toBe(false)
    session.commit(runtime.setRunning(true)) // not an explicit host play boundary; cannot forge a started intent by polling a frame
    session.advance(0.05)
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled()
    session.setRunning(false)
    expect(applyUniversalContributionIntent(session, { type: 'playback/running', protocolVersion: 3, running: true }, { observeRun: false })).toBe(true)
    session.advance(0.05)
    expect(f.prepare).not.toHaveBeenCalled()
    session.setRunning(false)
    expect(applyUniversalContributionIntent(session, { type: 'playback/running', protocolVersion: 3, running: true })).toBe(true)
    expect(f.prepare).toHaveBeenCalledOnce()
    session.advance(0.05)
    await vi.waitFor(() => { expect(f.record).toHaveBeenCalledOnce() })
  })
  it('aborts a paused/cancelled pre-step run and refuses its late permit; the next real play gets a fresh UUID', async () => {
    const { session } = actualEngine(), f = apiFixture()
    let resolve!: (value: ExperimentRunPermit) => void
    f.prepare.mockImplementationOnce(() => new Promise<ExperimentRunPermit>(done => { resolve = done }))
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(tracker.dispose)
    session.setRunning(true)
    const first = f.prepare.mock.calls[0]![0], firstSignal = f.prepare.mock.calls[0]![1]
    session.setRunning(false)
    expect(firstSignal.aborted).toBe(true)
    resolve(permitOf(first)); await Promise.resolve(); session.advance(0.05)
    expect(f.record).not.toHaveBeenCalled()
    session.setRunning(true); session.advance(0.05)
    await vi.waitFor(() => { expect(f.record).toHaveBeenCalledOnce() })
    expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.prepare.mock.calls[1]![0].runId).not.toBe(first.runId)
  })
  it('waits for the permit when the real first step happens during prepare; polling never sends an extra record', async () => {
    const { session } = actualEngine(), f = apiFixture()
    let resolve!: (value: ExperimentRunPermit) => void
    f.prepare.mockImplementationOnce(() => new Promise<ExperimentRunPermit>(done => { resolve = done }))
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(tracker.dispose)
    session.setRunning(true); session.advance(0.05)
    expect(f.record).not.toHaveBeenCalled()
    const prepared = f.prepare.mock.calls[0]![0]
    resolve(permitOf(prepared))
    await vi.waitFor(() => { expect(f.record).toHaveBeenCalledOnce() })
    expect(f.record.mock.calls[0]![0].runId).toBe(prepared.runId)
  })
  it('retries transport loss with exactly the same UUID/permit/hash inputs and never turns prepare failure into use', async () => {
    const { session } = actualEngine(), f = apiFixture()
    f.prepare.mockRejectedValueOnce(new Error('lost prepare response'))
    f.record.mockRejectedValueOnce(new Error('lost record response'))
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(tracker.dispose)
    session.setRunning(true); session.advance(0.05)
    await vi.waitFor(() => { expect(f.record).toHaveBeenCalledTimes(2) })
    expect(f.prepare.mock.calls[0]![0]).toEqual(f.prepare.mock.calls[1]![0]); expect(f.record.mock.calls[0]![0]).toEqual(f.record.mock.calls[1]![0])
    tracker.dispose()
    const next = actualEngine(), failed = apiFixture()
    failed.prepare.mockRejectedValue(new ExperimentRunApiError('RUN_RECORDING_DISABLED', false))
    const noPermit = createExperimentRunTracker({ session: next.session, experimentId: 'incline', owner, api: failed.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(noPermit.dispose)
    next.session.setRunning(true); next.session.advance(0.05); await Promise.resolve(); await Promise.resolve()
    expect(failed.prepare).toHaveBeenCalledOnce(); expect(failed.record).not.toHaveBeenCalled()
  })
  it.each(['failed', 'nonfinite', 'verification', 'unchanged'] as const)('does not record an invalid first advance (%s)', async mode => {
    const { runtime, session } = actualEngine(), f = apiFixture()
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(tracker.dispose)
    session.setRunning(true)
    const before = runtime.getSnapshot()
    vi.spyOn(runtime, 'advance').mockReturnValue({ ...before,
      status: mode === 'failed' ? 'failed' : before.status,
      clock: { ...before.clock, time: mode === 'nonfinite' ? NaN : mode === 'unchanged' ? before.clock.time : before.clock.time + 0.05 },
      verification: mode === 'verification' ? [{ id: 'failed-physical-condition', label: '失败条件', status: 'failed' }] : before.verification,
    })
    session.advance(0.05); await Promise.resolve(); await Promise.resolve()
    expect(f.record).not.toHaveBeenCalled()
  })
  it('never counts static optics, resumed-running mount, seek, or a manual step as a fresh run', async () => {
    const staticRuntime = createOpticsWorkspaceRuntime(createConvexLensScene()), staticSession = createExperimentSession(staticRuntime), f = apiFixture()
    const tracker = createExperimentRunTracker({ session: staticSession, experimentId: 'convex-lens', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(tracker.dispose)
    staticSession.setRunning(true); staticSession.advance(0.05)
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled()
    const { runtime, session } = actualEngine()
    session.setRunning(true)
    const resumed = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(resumed.dispose)
    session.advance(0.05); session.commit(runtime.seek(1)); session.commit(runtime.step(0.1))
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled()
  })
  it.each(['bridge', 'off'] as const)('makes %s capabilities a true no-op', mode => {
    const { session } = actualEngine(), f = apiFixture()
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps({ mode, recordingEnabled: false }), presentationGeneration: presentation, isCurrent: () => true })
    onTestFinished(tracker.dispose)
    session.setRunning(true); session.advance(0.1)
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled()
  })
  it('aborts experiment/presentation changes and never uses a late callback for a new display', async () => {
    const { session } = actualEngine(), f = apiFixture()
    let current = true, resolve!: (value: ExperimentRunPermit) => void
    f.prepare.mockImplementationOnce(() => new Promise<ExperimentRunPermit>(done => { resolve = done }))
    const tracker = createExperimentRunTracker({ session, experimentId: 'incline', owner, api: f.api, capabilities: caps(), presentationGeneration: presentation, isCurrent: () => current })
    session.setRunning(true); session.advance(0.05)
    current = false; tracker.dispose()
    expect(f.prepare.mock.calls[0]![1].aborted).toBe(true)
    resolve(permitOf(f.prepare.mock.calls[0]![0])); await Promise.resolve(); await Promise.resolve()
    expect(f.record).not.toHaveBeenCalled()
  })
})

describe('account and presentation installation gates', () => {
  it('does not prepare while capabilities load/fail or the renderer is loading/error; ready itself is not a run', async () => {
    const auth = createAuthController(createAuthApi(), localStorage); auth.store.set({ status: 'authed', user: user() })
    let resolveCaps!: (response: Response) => void
    const sent: string[] = [], fetcher: typeof fetch = async url => { sent.push(String(url)); return new Promise<Response>(done => { resolveCaps = done }) }
    const stop = installExperimentRunTracking(auth.store, { fetch: fetcher }), { session } = actualEngine()
    const display = bindExperimentRunPresentation(session), release = attachExperimentRunTracking(session, 'incline')
    onTestFinished(() => { release(); display.dispose(); stop() })
    session.setRunning(true); session.advance(0.05)
    expect(sent).toEqual(['/physicsos/experiment-runs/v1/capabilities'])
    resolveCaps({ ok: true, json: async () => caps() } as Response)
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    session.setRunning(false); session.setRunning(true); session.advance(0.05)
    expect(sent).toHaveLength(1)
    display.setReady(true); expect(sent).toHaveLength(1) // a running session does not retroactively turn ready into a use
    session.advance(0.05); expect(sent).toHaveLength(1)
  })
  it('uses one tracker per host session, only in the explicitly attached Lab scope, not Canvas or candidates', async () => {
    const auth = createAuthController(createAuthApi(), localStorage); auth.store.set({ status: 'authed', user: user() })
    const sent: { path: string; body?: ExperimentRunPrepare }[] = []
    const fetcher: typeof fetch = async (url, init) => {
      const path = String(url), body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as ExperimentRunPrepare
      sent.push({ path, ...(body === undefined ? {} : { body }) })
      return { ok: true, json: async () => path.endsWith('capabilities') ? caps() : path.endsWith('prepare') ? permitOf(body!) : {
        runId: body!.runId, experimentId: 'incline', recordedAt: new Date().toISOString(), provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', replayed: false,
      } } as Response
    }
    const stop = installExperimentRunTracking(auth.store, { fetch: fetcher }), { session } = actualEngine()
    const display = bindExperimentRunPresentation(session)
    display.setReady(true)
    onTestFinished(() => { display.dispose(); stop() })
    await vi.waitFor(() => { expect(sent).toHaveLength(1) })
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    session.setRunning(true); session.advance(0.05)
    expect(sent).toHaveLength(1) // same engine without an explicit Lab attachment is out of scope
    const releaseA = attachExperimentRunTracking(session, 'incline'), releaseB = attachExperimentRunTracking(session, 'incline')
    onTestFinished(() => { releaseA(); releaseB() })
    session.setRunning(false); session.setRunning(true); session.advance(0.05)
    await vi.waitFor(() => { expect(sent.filter(call => call.path.endsWith('/record'))).toHaveLength(1) })
    expect(sent.filter(call => call.path.endsWith('/prepare'))).toHaveLength(1)
  })
  it('pins account and generation, aborts pending old-owner work synchronously and discards its late permit', async () => {
    const auth = createAuthController(createAuthApi(), localStorage); auth.store.set({ status: 'authed', user: user() })
    const calls: { path: string; headers: Headers; signal: AbortSignal; body?: ExperimentRunPrepare }[] = []
    let resolveOld!: (value: Response) => void
    const fetcher: typeof fetch = async (url, init) => {
      const path = String(url), headers = new Headers(init?.headers), signal = init!.signal as AbortSignal
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as ExperimentRunPrepare
      calls.push({ path, headers, signal, ...(body === undefined ? {} : { body }) })
      if (path.endsWith('/capabilities')) return { ok: true, json: async () => caps() } as Response
      return new Promise<Response>(resolve => { resolveOld = resolve })
    }
    const stop = installExperimentRunTracking(auth.store, { fetch: fetcher }), { session } = actualEngine()
    const display = bindExperimentRunPresentation(session); display.setReady(true)
    const release = attachExperimentRunTracking(session, 'incline')
    onTestFinished(() => { release(); display.dispose(); stop() })
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    session.setRunning(true); session.advance(0.05)
    const old = calls.find(call => call.path.endsWith('/prepare'))!
    expect(old).toBeDefined()
    auth.store.set({ status: 'authed', user: user('bob', 'school-b') })
    expect(old.signal.aborted).toBe(true)
    resolveOld({ ok: true, json: async () => permitOf(old.body!) } as Response)
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    expect(calls.filter(call => call.path.endsWith('/record'))).toEqual([])
    expect(JSON.parse(decodeURIComponent(old.headers.get('x-physicsos-experiment-run-owner')!))).toEqual(owner)
    const latest = calls.at(-1)!
    expect(JSON.parse(decodeURIComponent(latest.headers.get('x-physicsos-experiment-run-owner')!))).toEqual({ schoolId: 'school-b', username: 'bob' })
    session.advance(0.05) // no transfer of an existing running intent to the new account
    expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(1)
    // Even a delayed old-port play arriving after the new account's capabilities cannot claim that new account.
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    session.setRunning(false); session.setRunning(true); session.advance(0.05)
    display.setReady(true) // duplicate late ready ACK belongs to the old presentation epoch as well
    expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(1)
    const newDisplay = bindExperimentRunPresentation(session); newDisplay.setReady(true)
    onTestFinished(newDisplay.dispose)
    session.setRunning(false); session.setRunning(true)
    expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(2)
    const fresh = calls.filter(call => call.path.endsWith('/prepare')).at(-1)!
    expect(JSON.parse(decodeURIComponent(fresh.headers.get('x-physicsos-experiment-run-owner')!))).toEqual({ schoolId: 'school-b', username: 'bob' })
  })
  it('keeps the minimal API wire, immutable expected owner, cookie credentials, caller abort, and no-store semantics', async () => {
    const captured: { path: string; init: RequestInit }[] = [], mutableOwner = { ...owner }
    const fetcher: typeof fetch = async (url, init = {}) => {
      captured.push({ path: String(url), init })
      const body = init.body === undefined ? undefined : JSON.parse(String(init.body)) as ExperimentRunPrepare
      return { ok: true, json: async () => String(url).endsWith('/capabilities') ? caps() : String(url).endsWith('/prepare') ? permitOf(body!) : {
        runId: body!.runId, experimentId: body!.experimentId, recordedAt: new Date().toISOString(), provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', replayed: false,
      } } as Response
    }
    const api = createExperimentRunApi({ owner: mutableOwner, fetch: fetcher }), abort = new AbortController()
    mutableOwner.username = 'not-the-bound-owner'
    await api.capabilities(abort.signal)
    const prepared = await api.prepare({ runId: '00000000-0000-4000-8000-000000000003', experimentId: 'incline', expectedCapabilityGeneration: generation }, abort.signal)
    await api.record(prepared, abort.signal)
    expect(captured.every(call => call.init.credentials === 'same-origin' && call.init.cache === 'no-store')).toBe(true)
    expect(JSON.parse(decodeURIComponent(new Headers(captured[0]!.init.headers).get('x-physicsos-experiment-run-owner')!))).toEqual(owner)
    expect(Object.keys(JSON.parse(String(captured[2]!.init.body))).sort()).toEqual(['expectedCapabilityGeneration', 'experimentId', 'permit', 'runId'])
    abort.abort(); expect(captured.every(call => call.init.signal!.aborted)).toBe(true)
    expect(localStorage.length).toBe(0) // no plaintext permit persisted in local/session durable state
  })
})
