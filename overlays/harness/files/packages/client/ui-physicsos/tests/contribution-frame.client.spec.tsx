// @vitest-environment jsdom
import { MessageChannel } from 'node:worker_threads'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { CommunityExperimentFrame } from '../src/client/experiments/CommunityExperimentFrame.tsx'
import { findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('only binds the trusted wrapper frame and revokes its commands on unmount', async () => {
  vi.stubGlobal('MessageChannel', MessageChannel)
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const session = createExperimentSession(runtime)
  const view = render(
    <CommunityExperimentFrame
      entryUrl="/physicsos/experiment-assets/embed/releases/p/abc/dist/index.html"
      session={session}
    />,
  )
  const frame = view.getByTitle('社区三维实验') as HTMLIFrameElement
  const target = frame.contentWindow!
  const token = new URL(frame.src).searchParams.get('channel')
  const transferred: MessagePort[] = []
  const send = vi.spyOn(target, 'postMessage').mockImplementation((_data, _origin, transfer) => {
    transferred.push(...(transfer as MessagePort[]))
  })
  const ready = { type: 'experiment/ready', protocolVersion: 1, channel: token }
  const emit = (source: Window, origin: string, data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { source, origin, data }))
  }
  emit(window, location.origin, ready)
  emit(target, 'null', ready)
  emit(target, location.origin, { ...ready, channel: 'unrelated-channel' })
  expect(send).not.toHaveBeenCalled()
  emit(target, location.origin, ready)
  expect(send).toHaveBeenCalledTimes(1)
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  const peer = transferred[0]!
  const snapshots: unknown[] = []
  peer.onmessage = event => snapshots.push(event.data)
  peer.start()
  peer.postMessage({ type: 'parameter/commit', id: 'objectDistanceCm', value: 15 })
  peer.postMessage({ type: 'experiment/connected', protocolVersion: 1 })
  await vi.waitFor(() => {
    expect(snapshots).toHaveLength(1)
  })
  expect(runtime.getScene().revision).toBe(0)
  peer.postMessage({ type: 'parameter/commit', id: 'objectDistanceCm', value: 15 })
  await vi.waitFor(() => {
    expect(runtime.getScene().revision).toBe(1)
  })
  view.unmount()
  peer.postMessage({ type: 'parameter/commit', id: 'objectDistanceCm', value: 20 })
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(runtime.getScene().revision).toBe(1)
  peer.close()
})

it('rejects an entry URL outside the package asset service', () => {
  const session = createExperimentSession(createOpticsWorkspaceRuntime(createConvexLensScene()))
  const view = render(<CommunityExperimentFrame entryUrl="javascript:alert(1)" session={session} />)
  expect(view.getByRole('alert').textContent).toContain('暂时无法显示')
  expect(view.getByTitle('社区三维实验').getAttribute('src')).toBeNull()
})

it('does not grant the trusted wrapper sandbox to raw package HTML', () => {
  const session = createExperimentSession(createOpticsWorkspaceRuntime(createConvexLensScene()))
  const view = render(
    <CommunityExperimentFrame
      entryUrl="/physicsos/experiment-assets/releases/p/abc/dist/index.html"
      session={session}
    />,
  )
  expect(view.getByRole('alert').textContent).toContain('暂时无法显示')
  expect(view.getByTitle('社区三维实验').getAttribute('src')).toBeNull()
})

// A controllable port keeps timeout and stale-instance assertions deterministic.
function bindV2(view: ReturnType<typeof render>, protocolVersion: 2 | 3 = 2) {
  const frame = view.getByTitle('社区三维实验') as HTMLIFrameElement
  const outbound: Record<string, unknown>[] = []
  let closed = false
  const port = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: (data: Record<string, unknown>) => outbound.push(data),
    start: () => {},
    close: () => {
      closed = true
    },
  }
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = port
      port2 = {}
    },
  )
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const message = (data: unknown): void => {
    act(() => {
      port.onmessage?.({ data })
    })
  }
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        origin: location.origin,
        data: {
          type: 'experiment/ready',
          protocolVersion,
          channel: new URL(frame.src).searchParams.get('channel'),
        },
      }),
    )
  })
  message({ type: 'experiment/connected', protocolVersion })
  return { outbound, message, closed: () => closed }
}
function v2Frame() {
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const session = createExperimentSession(runtime)
  const status = vi.fn()
  const view = render(
    <CommunityExperimentFrame
      entryUrl="/physicsos/experiment-assets/embed/releases/p/hash/dist/index.html"
      session={session}
      protocolVersion={2}
      onStatusChange={status}
    />,
  )
  return { runtime, session, view, status, ...bindV2(view) }
}
it('V2 connected alone times out instead of becoming ready', () => {
  vi.useFakeTimers()
  try {
    const fixture = v2Frame()
    expect(
      fixture.view.container
        .querySelector('[data-community-status]')
        ?.getAttribute('data-community-status'),
    ).toBe('loading')
    expect(fixture.outbound).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(15000)
    })
    expect(fixture.view.getByRole('alert').textContent).toContain('暂时无法显示')
    expect(fixture.closed()).toBe(true)
    expect(fixture.status).toHaveBeenLastCalledWith('failed')
  } finally {
    vi.useRealTimers()
  }
})
it('V2 pins its first frame until the exact version, token and revision are rendered', () => {
  const fixture = v2Frame()
  const first = fixture.outbound[0]!
  expect(first).toMatchObject({ type: 'experiment/snapshot', protocolVersion: 2 })
  expect(typeof first.frameId).toBe('string')
  act(() => {
    fixture.session.commitParameter('object-distance', 15)
  })
  const next = fixture.outbound[1]!
  expect(next.frameId).not.toBe(first.frameId)
  const ack = {
    type: 'experiment/rendered',
    protocolVersion: 2,
    frameId: first.frameId,
    revision: 0,
  }
  for (const wrong of [
    { ...ack, protocolVersion: 1 },
    { ...ack, frameId: next.frameId, revision: 1 },
    { ...ack, revision: 1 },
    { ...ack, frameId: 'unrelated' },
  ]) {
    fixture.message(wrong)
    expect(
      fixture.view.container
        .querySelector('[data-community-status]')
        ?.getAttribute('data-community-status'),
    ).toBe('loading')
  }
  fixture.message(ack)
  expect(
    fixture.view.container
      .querySelector('[data-community-status]')
      ?.getAttribute('data-community-status'),
  ).toBe('ready')
  expect(fixture.status).toHaveBeenLastCalledWith('ready')
  fixture.message({
    type: 'experiment/error',
    protocolVersion: 2,
    code: 'RENDER_FAILED',
    message: '<script>secret</script>',
  })
  expect(fixture.view.getByRole('alert').textContent).not.toContain('secret')
  expect(fixture.status).toHaveBeenLastCalledWith('failed')
})
it('V2 retry revokes its previous port and ignores late acknowledgements and commands', () => {
  const fixture = v2Frame()
  const first = fixture.outbound[0]!
  fixture.message({ type: 'experiment/error', protocolVersion: 2, code: 'SNAPSHOT_INVALID' })
  fireEvent.click(fixture.view.getByRole('button', { name: '重新加载实验文件' }))
  expect(fixture.closed()).toBe(true)
  fixture.message({
    type: 'experiment/rendered',
    protocolVersion: 2,
    frameId: first.frameId,
    revision: 0,
  })
  fixture.message({ type: 'parameter/commit', id: 'objectDistanceCm', value: 15 })
  expect(fixture.runtime.getScene().revision).toBe(0)
  expect(fixture.status).toHaveBeenLastCalledWith('loading')
  const next = bindV2(fixture.view)
  expect(next.outbound[0]?.frameId).not.toBe(first.frameId)
  fixture.view.unmount()
  next.message({ type: 'parameter/commit', id: 'objectDistanceCm', value: 15 })
  expect(fixture.runtime.getScene().revision).toBe(0)
})

it('V2 rejects harmless extra intent fields while accepting the exact bounded intent', () => {
  const fixture = v2Frame()
  fixture.message({ type: 'parameter/commit', id: 'objectDistanceCm', value: 15, ignored: true })
  expect(fixture.runtime.getScene().revision).toBe(0)
  fixture.message({ type: 'parameter/commit', id: 'objectDistanceCm', value: 15 })
  expect(fixture.runtime.getScene().revision).toBe(1)
})

function v3Frame() {
  const template = findExperimentTemplate('incline')!
  const runtime = buildWorkspaceRuntime(template.domain, template.createScene('斜面实验').scene)!
  const session = createExperimentSession(runtime)
  const status = vi.fn()
  const view = render(
    <CommunityExperimentFrame
      entryUrl="/physicsos/experiment-assets/embed/releases/p/hash/dist/index.html"
      session={session}
      experimentId="incline"
      protocolVersion={3}
      onStatusChange={status}
    />,
  )
  return { runtime, session, view, status, ...bindV2(view, 3) }
}
it('V3 publishes the selected non-lens engine and requires its exact first rendered frame', () => {
  const fixture = v3Frame()
  const first = fixture.outbound[0]!
  expect(first).toMatchObject({ type: 'experiment/snapshot', protocolVersion: 3,
    snapshot: { experimentId: 'incline', domain: 'mechanics', source: 'platform-engine', revision: 0 } })
  expect(fixture.status).toHaveBeenLastCalledWith('loading')
  const ack = { type: 'experiment/rendered', protocolVersion: 3, frameId: first.frameId, revision: 0 }
  fixture.message({ ...ack, protocolVersion: 2 })
  fixture.message({ ...ack, frameId: 'stale-instance' })
  fixture.message({ ...ack, revision: 1 })
  expect(fixture.status).toHaveBeenLastCalledWith('loading')
  fixture.message(ack)
  expect(fixture.status).toHaveBeenLastCalledWith('ready')
  fixture.message({ type: 'parameter/commit', protocolVersion: 3, id: 'angle', value: 30 })
  expect(fixture.runtime.getScene?.()?.revision).toBe(1)
  expect(fixture.outbound[1]).toMatchObject({ protocolVersion: 3, snapshot: { revision: 1 } })
  fixture.message({ type: 'experiment/error', protocolVersion: 3, code: 'RENDER_FAILED' })
  expect(fixture.status).toHaveBeenLastCalledWith('failed')
  expect(fixture.closed()).toBe(true)
  fixture.message({ type: 'parameter/commit', protocolVersion: 3, id: 'angle', value: 40 })
  expect(fixture.runtime.getScene?.()?.revision).toBe(1)
})
it('V3 times out on connection without rendering, and revokes commands on unmount', () => {
  vi.useFakeTimers()
  try {
    const fixture = v3Frame()
    act(() => { vi.advanceTimersByTime(15000) })
    expect(fixture.status).toHaveBeenLastCalledWith('failed')
    fixture.message({ type: 'parameter/commit', protocolVersion: 3, id: 'angle', value: 30 })
    expect(fixture.runtime.getScene?.()?.revision).toBe(0)
    fixture.view.unmount()
    fixture.message({ type: 'parameter/commit', protocolVersion: 3, id: 'angle', value: 40 })
    expect(fixture.runtime.getScene?.()?.revision).toBe(0)
  } finally { vi.useRealTimers() }
})
it('V3 rejects extra intent fields and limits the live port to 120 actions per second', () => {
  vi.spyOn(performance, 'now').mockReturnValue(100)
  const fixture = v3Frame()
  fixture.message({ type: 'parameter/commit', protocolVersion: 3, id: 'angle', value: 30, ignored: true })
  expect(fixture.runtime.getScene?.()?.revision).toBe(0)
  for (let i = 0; i < 130; i++) fixture.message({ type: 'parameter/commit', protocolVersion: 3, id: 'angle', value: 30 })
  expect(fixture.runtime.getScene?.()?.revision).toBe(119)
  vi.spyOn(performance, 'now').mockReturnValue(1101)
  fixture.message({ type: 'parameter/commit', protocolVersion: 3, id: 'angle', value: 40 })
  expect(fixture.runtime.getScene?.()?.revision).toBe(120)
})
it('V3 publishes animation frames without waiting for the throttled workspace summary', () => {
  const fixture = v3Frame()
  const summary = fixture.session.getSnapshot()
  act(() => {
    fixture.session.frames.set({ ...summary, clock: { ...summary.clock, time: 0.1 } })
  })
  expect(fixture.session.getSnapshot().clock.time).toBe(0)
  expect(fixture.outbound.at(-1)?.snapshot).toMatchObject({ clock: { time: 0.1 } })
})
