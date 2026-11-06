// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CommunityWorkspaceCanvas } from '../src/client/experiments/CommunityWorkspaceCanvas.tsx'
import { contributionApi, type ContributionCatalog, type ExperimentPackageView } from '../src/client/experiments/contribution-api.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'
import { findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const entryUrl = '/physicsos/experiment-assets/embed/releases/p/hash/dist/index.html'
const packageOf = (id: string, experimentId = 'incline'): ExperimentPackageView => ({
  id, experimentId, version: '1.0.0', schemaVersion: 3, protocolVersion: 3, sha256: id,
  status: 'approved', author: { name: 'Contributor' }, createdAt: '2026-11-04T00:00:00Z', entryUrl,
})
function fixture(pinned?: { kind: 'official' | 'community'; id: string; experimentId: string; version: string; sha256?: string }) {
  const template = findExperimentTemplate('incline')!
  const scene = template.createScene('斜面实验').scene
  if (pinned) scene.metadata.experimentRelease = pinned
  const saves: unknown[] = []
  const session = createExperimentSession(buildWorkspaceRuntime(template.domain, scene)!, saved => saves.push(saved))
  return { session, saves }
}
function mount(catalog: ContributionCatalog, pinned?: Parameters<typeof fixture>[0]) {
  const catalogSpy = vi.spyOn(contributionApi, 'catalog').mockResolvedValue(catalog)
  const { session, saves } = fixture(pinned)
  const view = render(<CommunityWorkspaceCanvas experimentId="incline" session={session}
    fallback={<span>平台实验画布</span>} />)
  return { view, session, saves, catalogSpy }
}
function connect(view: ReturnType<typeof render>) {
  const frame = view.container.querySelector('iframe')!
  const outbound: Record<string, unknown>[] = []
  const port = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: (message: Record<string, unknown>) => outbound.push(message), start() {}, close() {} }
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = {} })
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin,
      data: { type: 'experiment/ready', protocolVersion: 3, channel: new URL(frame.src).searchParams.get('channel') } }))
    port.onmessage?.({ data: { type: 'experiment/connected', protocolVersion: 3 } })
  })
  const first = outbound[0]!
  return {
    ready: (times = 1) => act(() => {
      for (let index = 0; index < times; index++) port.onmessage?.({ data: { type: 'experiment/rendered', protocolVersion: 3,
        frameId: first.frameId, revision: (first.snapshot as { revision: number }).revision } })
    }),
    fail: () => act(() => port.onmessage?.({ data: { type: 'experiment/error', protocolVersion: 3, code: 'RENDER_FAILED' } })),
  }
}
it('automatically renders the exact approved experiment and saves its release identity', async () => {
  const item = packageOf('active')
  const { view, session, saves, catalogSpy } = mount({ active: item, items: [item], canReview: false })
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/embed/releases/') })
  expect(catalogSpy).toHaveBeenCalledWith('incline')
  expect(view.queryByText('平台实验画布')).toBeNull()
  expect(session.getScene()?.metadata.experimentRelease).toMatchObject({ kind: 'community', id: 'active', experimentId: 'incline', sha256: 'active' })
  expect(saves).toHaveLength(1)
})
it('asks the approved package to use host controls when opened in the experiment workspace', async () => {
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null, start() {}, close() {} }
    port2 = {}
  })
  const item = packageOf('active')
  const { view } = mount({ active: item, items: [item], canReview: false })
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/embed/releases/') })
  const frame = view.container.querySelector('iframe')!
  const send = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  act(() => { window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow, origin: location.origin,
    data: { type: 'experiment/ready', protocolVersion: 3, channel: new URL(frame.src).searchParams.get('channel') },
  })) })
  expect(send.mock.calls[0]?.[0]).toMatchObject({ presentation: { mode: 'embedded' } })
})
it('keeps an explicit prior community pin when a newer release is active', async () => {
  const prior = { ...packageOf('prior'), entryUrl: entryUrl.replace('/p/', '/prior/') }
  const active = packageOf('active')
  const { view, session } = mount({ active, items: [active, prior], canReview: false }, {
    kind: 'community', id: 'prior', experimentId: 'incline', version: '1.0.0', sha256: 'prior',
  })
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/prior/') })
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
})
it('keeps an explicit official pin on the platform renderer', async () => {
  const active = packageOf('active')
  const { view, session } = mount({ active, items: [active], canReview: false }, {
    kind: 'official', id: 'physicsos-incline-v1', experimentId: 'incline', version: '1.0.0',
  })
  await waitFor(() => { expect(view.getByText('平台实验画布')).toBeTruthy() })
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('physicsos-incline-v1')
})
it('does not silently replace a missing or wrong-experiment saved release', async () => {
  const wrong = packageOf('other', 'boiling-water')
  const { view, session, saves } = mount({ active: wrong, items: [wrong], canReview: false }, {
    kind: 'community', id: 'prior', experimentId: 'incline', version: '1.0.0', sha256: 'prior',
  })
  await waitFor(() => { expect(view.getByRole('alert')).toBeTruthy() })
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(view.queryByText('平台实验画布')).toBeNull()
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  expect(saves).toHaveLength(0)
})
it('uses the platform renderer with the correct experiment identity when no package is approved', async () => {
  const { view, session } = mount({ active: null, items: [], canReview: false })
  await waitFor(() => { expect(view.getByText('平台实验画布')).toBeTruthy() })
  expect(session.getScene()?.metadata.experimentRelease).toEqual({ kind: 'official', id: 'physicsos-incline-v1', experimentId: 'incline', version: '1.0.0' })
})
it('keeps an explicit official renderer usable when the optional update check is unavailable', async () => {
  const catalog = vi.spyOn(contributionApi, 'catalog').mockRejectedValue(new Error('offline'))
  const { session, saves } = fixture({
    kind: 'official', id: 'physicsos-incline-v1', experimentId: 'incline', version: '1.0.0',
  })
  const view = render(<CommunityWorkspaceCanvas experimentId="incline" session={session}
    fallback={<span>平台实验画布</span>} />)
  expect(view.getByText('平台实验画布')).toBeTruthy()
  await waitFor(() => { expect(catalog).toHaveBeenCalledWith('incline') })
  expect(view.queryByRole('alert')).toBeNull()
  expect(saves).toHaveLength(0)
})

it('upgrades an old appearance only after its new frame renders, preserving parameters and notebook', async () => {
  const prior = { ...packageOf('prior'), version: '2.0.0', entryUrl: entryUrl.replace('/p/', '/prior/') }
  const active = { ...packageOf('active'), version: '2.1.0', entryUrl: entryUrl.replace('/p/', '/active/') }
  const { view, session, saves } = mount({ active, items: [active, prior], canReview: false }, {
    kind: 'community', id: prior.id, experimentId: 'incline', version: prior.version, sha256: prior.sha256,
  })
  await waitFor(() => { expect(view.getByRole('button', { name: '使用新版实验外观' })).toBeTruthy() })
  act(() => { session.commitParameter('angle', 40); session.recordObservation() })
  const before = session.getScene()!, notebook = session.getNotebook(), saveCount = saves.length
  fireEvent.click(view.getByRole('button', { name: '使用新版实验外观' }))
  await waitFor(() => { expect(view.container.querySelector('iframe')?.src).toContain('/active/') })
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  const child = connect(view)
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  child.ready(2)
  expect(session.getScene()?.metadata.experimentRelease).toEqual({
    kind: 'community', id: 'active', experimentId: 'incline', version: '2.1.0', sha256: active.sha256,
  })
  expect(session.getScene()).toEqual({ ...before, metadata: { ...before.metadata, experimentRelease: session.getScene()?.metadata.experimentRelease } })
  expect(session.getNotebook()).toEqual(notebook)
  expect(saves).toHaveLength(saveCount + 1)
  expect(view.queryByRole('button', { name: '使用新版实验外观' })).toBeNull()
})

it('keeps the old pin on update failures and allows a safe retry', async () => {
  const prior = { ...packageOf('prior'), version: '2.0.0', entryUrl: entryUrl.replace('/p/', '/prior/') }
  const active = { ...packageOf('active'), version: '2.1.0', entryUrl: entryUrl.replace('/p/', '/active/') }
  const { view, session, saves, catalogSpy } = mount({ active, items: [active, prior], canReview: false }, {
    kind: 'community', id: prior.id, experimentId: 'incline', version: prior.version, sha256: prior.sha256,
  })
  await waitFor(() => { expect(view.getByRole('button', { name: '使用新版实验外观' })).toBeTruthy() })
  catalogSpy.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(view.getByRole('button', { name: '使用新版实验外观' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('重试') })
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  expect(view.container.querySelector('iframe')?.src).toContain('/prior/')
  fireEvent.click(view.getByRole('button', { name: '使用新版实验外观' }))
  await waitFor(() => { expect(view.container.querySelector('iframe')?.src).toContain('/active/') })
  connect(view).fail()
  await waitFor(() => { expect(view.container.querySelector('iframe')?.src).toContain('/prior/') })
  expect(view.getByRole('alert').textContent).toContain('重试')
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  expect(saves).toHaveLength(0)
})

it.each(['2.0.0', '1.9.9'])('does not offer the same or an older active appearance (%s)', async version => {
  const prior = { ...packageOf('prior'), version: '2.0.0' }, active = { ...packageOf('active'), version }
  const { view } = mount({ active, items: [active, prior], canReview: false }, {
    kind: 'community', id: prior.id, experimentId: 'incline', version: prior.version, sha256: prior.sha256,
  })
  await waitFor(() => { expect(view.container.querySelector('iframe')?.src).toContain('/embed/releases/') })
  expect(view.queryByRole('button', { name: '使用新版实验外观' })).toBeNull()
})

it('requires another explicit click when the published appearance changes during an update', async () => {
  const prior = { ...packageOf('prior'), version: '2.0.0', entryUrl: entryUrl.replace('/p/', '/prior/') }
  const active = { ...packageOf('active'), version: '2.1.0' }
  const replacement = { ...packageOf('replacement'), version: '2.2.0', entryUrl: entryUrl.replace('/p/', '/replacement/') }
  const { view, session, catalogSpy } = mount({ active, items: [active, prior], canReview: false }, {
    kind: 'community', id: prior.id, experimentId: 'incline', version: prior.version, sha256: prior.sha256,
  })
  await waitFor(() => { expect(view.getByRole('button', { name: '使用新版实验外观' })).toBeTruthy() })
  catalogSpy.mockResolvedValue({ active: replacement, items: [replacement, prior], canReview: false })
  fireEvent.click(view.getByRole('button', { name: '使用新版实验外观' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('重试') })
  expect(view.container.querySelector('iframe')?.src).toContain('/prior/')
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  fireEvent.click(view.getByRole('button', { name: '使用新版实验外观' }))
  await waitFor(() => { expect(view.container.querySelector('iframe')?.src).toContain('/replacement/') })
  connect(view).ready()
  expect(session.getScene()?.metadata.experimentRelease).toMatchObject({ id: 'replacement', sha256: replacement.sha256 })
})

it('discards a delayed update response after the workspace unmounts', async () => {
  const prior = { ...packageOf('prior'), version: '2.0.0' }, active = { ...packageOf('active'), version: '2.1.0' }
  const catalog = { active, items: [active, prior], canReview: false }
  const { view, session, saves, catalogSpy } = mount(catalog, {
    kind: 'community', id: prior.id, experimentId: 'incline', version: prior.version, sha256: prior.sha256,
  })
  await waitFor(() => { expect(view.getByRole('button', { name: '使用新版实验外观' })).toBeTruthy() })
  let resolve: ((value: ContributionCatalog) => void) | undefined
  catalogSpy.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  fireEvent.click(view.getByRole('button', { name: '使用新版实验外观' }))
  view.unmount()
  await act(async () => { resolve?.(catalog); await Promise.resolve() })
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  expect(saves).toHaveLength(0)
})
