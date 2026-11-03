// @vitest-environment jsdom
import { MessageChannel } from 'node:worker_threads'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { CommunityExperimentFrame } from '../src/client/experiments/CommunityExperimentFrame.tsx'

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
  const view = render(<CommunityExperimentFrame entryUrl="/physicsos/experiment-assets/releases/p/abc/dist/index.html" session={session} />)
  expect(view.getByRole('alert').textContent).toContain('暂时无法显示')
  expect(view.getByTitle('社区三维实验').getAttribute('src')).toBeNull()
})
