// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { ConvexLensPage } from '../src/client/experiments/ConvexLensPage.tsx'
import { zh } from '../src/client/locales.ts'
import { contributionApi } from '../src/client/experiments/contribution-api.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const mount = () => render(<ConvexLensPage runtime={createOpticsWorkspaceRuntime(createConvexLensScene())} t={key => zh[key]} />)

it('offers an apparatus-first page with all five engine-backed imaging conditions', () => {
  const {container} = mount()
  expect(screen.getByRole('heading',{name:'凸透镜成像规律'})).toBeTruthy()
  expect(screen.queryByRole('button',{name:'二维光路'})).toBeNull()
  expect(screen.getByRole('button',{name:'贡献实验'})).toBeTruthy()
  expect(screen.queryByRole('button',{name:'运行'})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:/投影仪.*1.5f/}))
  expect(screen.getAllByText(/倒立、放大的实像/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button',{name:/焦点.*u = f/}))
  expect(container.querySelector('[data-image-kind="none"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:/放大镜.*0.5f/}))
  expect(screen.getAllByText(/正立、放大的虚像/).length).toBeGreaterThan(0)
  expect(container.querySelector('[data-screen-lit="false"]')).toBeTruthy()
})

it('records readings, retains them after edits, and exposes report and tutor', () => {
  mount()
  fireEvent.click(screen.getByRole('button',{name:'记录本次'}))
  const input = screen.getByRole('textbox',{name:'物距'})
  fireEvent.change(input,{target:{value:'15'}})
  fireEvent.blur(input)
  fireEvent.click(screen.getByRole('button',{name:'记录本次'}))
  expect(screen.getByRole('table',{name:'实验记录'}).querySelectorAll('tbody tr')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button',{name:'实验报告'}))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getAllByText(/测量记录/).length).toBeGreaterThan(0)
})

it.each([2, 3] as const)('requests embedded chrome only for the V3 package on the dedicated lens page (V%i)', async protocolVersion => {
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null, start() {}, close() {} }
    port2 = {}
  })
  const item = {
    id: 'lens-release', experimentId: 'convex-lens', version: '2.1.0', schemaVersion: protocolVersion,
    protocolVersion, sha256: 'a'.repeat(64), status: 'approved' as const,
    author: { name: 'PhysicsOS' }, createdAt: '2026-11-07T00:00:00Z',
    entryUrl: '/physicsos/experiment-assets/embed/releases/lens/hash/dist/index.html',
  }
  vi.spyOn(contributionApi, 'catalog').mockResolvedValue({ active: item, items: [item], canReview: false })
  const view = mount()
  await waitFor(() => { expect(view.container.querySelector('iframe')?.src).toContain('/embed/releases/') })
  const frame = view.container.querySelector('iframe')!
  const send = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  act(() => { window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow, origin: location.origin,
    data: { type: 'experiment/ready', protocolVersion, channel: new URL(frame.src).searchParams.get('channel') },
  })) })
  const handshake = send.mock.calls[0]?.[0]
  expect(handshake).toBeDefined()
  if (protocolVersion === 3) expect(handshake).toMatchObject({ presentation: { mode: 'embedded' } })
  else expect(handshake).not.toHaveProperty('presentation')
})

it('offers a new lens appearance explicitly and retains the saved version until its first rendered frame', async () => {
  const prior = { id: 'prior', experimentId: 'convex-lens', version: '2.0.0', schemaVersion: 3 as const,
    protocolVersion: 3 as const, sha256: 'a'.repeat(64), status: 'approved' as const,
    author: { name: 'PhysicsOS' }, createdAt: '2026-11-07T00:00:00Z',
    entryUrl: '/physicsos/experiment-assets/embed/releases/prior/hash/dist/index.html' }
  const active = { ...prior, id: 'active', version: '2.1.0', sha256: 'b'.repeat(64), entryUrl: prior.entryUrl.replace('/prior/', '/active/') }
  vi.spyOn(contributionApi, 'catalog').mockResolvedValue({ active, items: [active, prior], canReview: false })
  const scene = createConvexLensScene()
  scene.metadata.experimentRelease = { kind: 'community', id: prior.id, experimentId: 'convex-lens', version: prior.version, sha256: prior.sha256 }
  const save = vi.fn()
  const view = render(<ConvexLensPage runtime={createOpticsWorkspaceRuntime(scene)} onSceneChange={save} t={key => zh[key]} />)
  await waitFor(() => { expect(view.getByRole('button', { name: '使用新版实验外观' })).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: '记录本次' }))
  const before = save.mock.calls.at(-1)![0]
  fireEvent.click(view.getByRole('button', { name: '使用新版实验外观' }))
  await waitFor(() => { expect(view.container.querySelector('iframe')?.src).toContain('/active/') })
  expect(save.mock.calls.at(-1)?.[0].metadata.experimentRelease.id).toBe('prior')
  const outbound: Record<string, unknown>[] = []
  const port = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: (value: Record<string, unknown>) => outbound.push(value), start() {}, close() {} }
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = {} })
  const frame = view.container.querySelector('iframe')!
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin,
      data: { type: 'experiment/ready', protocolVersion: 3, channel: new URL(frame.src).searchParams.get('channel') } }))
    port.onmessage?.({ data: { type: 'experiment/connected', protocolVersion: 3 } })
    const first = outbound[0]!
    port.onmessage?.({ data: { type: 'experiment/rendered', protocolVersion: 3, frameId: first.frameId,
      revision: (first.snapshot as { revision: number }).revision } })
  })
  const after = save.mock.calls.at(-1)![0]
  expect(after.metadata.experimentRelease).toMatchObject({ id: 'active', sha256: active.sha256 })
  expect(after).toEqual({ ...before, metadata: { ...before.metadata, experimentRelease: after.metadata.experimentRelease } })
})
