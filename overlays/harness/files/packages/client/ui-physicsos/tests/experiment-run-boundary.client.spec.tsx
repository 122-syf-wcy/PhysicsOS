// @vitest-environment jsdom
/** Component -> host engine boundary tests. Authored, NOT run. No DOM telemetry listener. */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { PhysicsWorkspace } from '../src/client/PhysicsWorkspace.tsx'
import { CommunityExperimentFrame } from '../src/client/experiments/CommunityExperimentFrame.tsx'
import { contributionApi } from '../src/client/experiments/contribution-api.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createAuthController } from '../src/client/auth-store.ts'
import { createAuthApi } from '../src/client/auth-api.ts'
import { attachExperimentRunTracking, bindExperimentRunPresentation, installExperimentRunTracking } from '../src/client/experiments/experiment-run-tracking.ts'
import { zh } from '../src/client/locales.ts'
const generation = '00000000-0000-4000-8000-000000000001'
const capability = { schemaVersion: 1, capability: 'experiment-run-v1', mode: 'enabled', recordingEnabled: true, capabilityGeneration: generation,
  provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', permitTtlMs: 120_000 }
const t: Parameters<typeof PhysicsWorkspace>[0]['t'] = key => zh[key]
const actualRuntime = () => {
  const scene = createMechanicsScene({ sceneId: 'run-component-incline', model: 'inclined_plane', title: '斜面实验', mass: 2,
    inclineAngle: 30, frictionCoefficient: 0.2, gravity: { x: 0, y: -9.8, z: 0 } })
  scene.metadata.experimentRelease = { kind: 'official', id: 'physicsos-incline-v1', experimentId: 'incline', version: '1.0.0' }
  return createMechanicsWorkspaceRuntime(scene)
}
async function installed() {
  const calls: { path: string; body?: Record<string, unknown>; signal: AbortSignal }[] = []
  const auth = createAuthController(createAuthApi(), localStorage)
  auth.store.set({ status: 'authed', user: { id: 'school-a:alice', schoolId: 'school-a', schoolName: '学校甲', username: 'alice', displayName: 'Alice', role: 'STUDENT' } })
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url), body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ path, ...(body === undefined ? {} : { body }), signal: init!.signal as AbortSignal })
    const json = path.endsWith('/capabilities') ? capability : path.endsWith('/prepare') ? { ...body, permit: 'a'.repeat(43), expiresAt: new Date(Date.now() + 120_000).toISOString() } : {
      runId: body!.runId, experimentId: 'incline', recordedAt: new Date().toISOString(), provenance: 'client-observed', boundary: 'platform-engine-first-step', scope: 'lab-workspace', replayed: false,
    }
    return { ok: true, json: async () => json } as Response
  }
  const stop = installExperimentRunTracking(auth.store, { fetch: fetcher })
  onTestFinished(stop)
  // Flush the actual resolved fetch/json/capability promise chain, not a guessed timeout or ready polling event.
  await act(async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve() })
  return { calls, auth }
}
beforeEach(() => {
  vi.spyOn(contributionApi, 'catalog').mockResolvedValue({ active: null, items: [], canReview: false })
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it('only records the workspace toolbar/keyboard play after its real animation clock produces a valid first step', async () => {
  const { calls } = await installed(), runtime = actualRuntime()
  let nextRaf: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { nextRaf = callback; return 1 })
  const view = render(<PhysicsWorkspace runtime={runtime} experimentId="incline" t={t} />)
  expect(calls.filter(call => call.path.endsWith('/prepare') || call.path.endsWith('/record'))).toEqual([])
  fireEvent.click(view.getByRole('button', { name: zh['lab.playPause'] }))
  expect(runtime.getSnapshot().clock.running).toBe(true)
  expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(1)
  expect(calls.filter(call => call.path.endsWith('/record'))).toHaveLength(0)
  act(() => { nextRaf?.(100) }) // RAF baseline only: not a physics step
  expect(calls.filter(call => call.path.endsWith('/record'))).toHaveLength(0)
  act(() => { nextRaf?.(116) })
  await vi.waitFor(() => { expect(calls.filter(call => call.path.endsWith('/record'))).toHaveLength(1) })
  expect(runtime.getSnapshot().clock.time).toBeGreaterThan(0)
  const cover = view.container.querySelector('[data-physicsos-surface="lab"]')!
  fireEvent.keyDown(cover, { key: ' ' }); fireEvent.keyDown(cover, { key: ' ' })
  expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(2)
  act(() => { nextRaf?.(200); nextRaf?.(216) })
  await vi.waitFor(() => { expect(calls.filter(call => call.path.endsWith('/record'))).toHaveLength(2) })
  expect(new Set(calls.filter(call => call.path.endsWith('/prepare')).map(call => call.body!.runId)).size).toBe(2)
})

it('treats trusted-wrapper ready/rendered only as a display gate and counts only host first-step after a bounded MessagePort play', async () => {
  const { calls, auth } = await installed(), runtime = actualRuntime(), session = createExperimentSession(runtime)
  const release = attachExperimentRunTracking(session, 'incline')
  onTestFinished(release)
  const view = render(<CommunityExperimentFrame entryUrl="/physicsos/experiment-assets/embed/releases/p/hash/dist/index.html" session={session} experimentId="incline" protocolVersion={3} />)
  const frame = view.getByTitle('社区三维实验') as HTMLIFrameElement
  const outbound: Record<string, unknown>[] = []
  const port = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined, postMessage: (data: Record<string, unknown>) => { outbound.push(data) }, start() {}, close: vi.fn() }
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = {} })
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const message = (data: unknown): void => { act(() => { port.onmessage?.({ data }) }) }
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin,
    data: { type: 'experiment/ready', protocolVersion: 3, channel: new URL(frame.src).searchParams.get('channel') } })) })
  message({ type: 'experiment/connected', protocolVersion: 3 })
  expect(calls.filter(call => !call.path.endsWith('/capabilities'))).toEqual([])
  message({ type: 'playback/running', protocolVersion: 3, running: true })
  session.advance(0.05) // engine can run, but loading renderer never obtains a recording permit
  expect(calls.filter(call => !call.path.endsWith('/capabilities'))).toEqual([])
  const first = outbound[0]!
  message({ type: 'experiment/rendered', protocolVersion: 3, frameId: first.frameId, revision: 0 })
  message({ type: 'experiment/run-success', protocolVersion: 3, source: 'platform-engine' })
  session.advance(0.05)
  expect(calls.filter(call => !call.path.endsWith('/capabilities'))).toEqual([])
  message({ type: 'playback/running', protocolVersion: 3, running: false })
  message({ type: 'playback/running', protocolVersion: 3, running: true })
  expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(1)
  expect(calls.filter(call => call.path.endsWith('/record'))).toHaveLength(0)
  act(() => { session.advance(0.05) })
  await vi.waitFor(() => { expect(calls.filter(call => call.path.endsWith('/record'))).toHaveLength(1) })
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  // The old authenticated port cannot claim a newly logged-in user even after a different display becomes ready.
  const oldUser = auth.store.getSnapshot().user!
  act(() => { auth.store.set({ status: 'authed', user: { ...oldUser, id: 'school-b:bob', schoolId: 'school-b', username: 'bob' } }) })
  await act(async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve() })
  const freshDisplay = bindExperimentRunPresentation(session); freshDisplay.setReady(true)
  onTestFinished(freshDisplay.dispose)
  message({ type: 'playback/running', protocolVersion: 3, running: false })
  message({ type: 'playback/running', protocolVersion: 3, running: true })
  session.advance(0.05)
  expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(1)
  message({ type: 'experiment/error', protocolVersion: 3, code: 'RENDER_FAILED' })
  message({ type: 'playback/running', protocolVersion: 3, running: false })
  message({ type: 'playback/running', protocolVersion: 3, running: true })
  session.advance(0.05)
  expect(calls.filter(call => call.path.endsWith('/prepare'))).toHaveLength(1)
  expect(port.close).toHaveBeenCalled()
})
