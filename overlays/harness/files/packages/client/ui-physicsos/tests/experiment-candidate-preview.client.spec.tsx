// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExperimentCandidatePreview } from '../src/client/experiments/ExperimentCandidatePreview.tsx'
import { isUniversalSnapshot } from '../src/client/experiments/universal-contract.ts'

const nativeScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const scrollIntoView = vi.fn()
beforeEach(() => { scrollIntoView.mockClear(); HTMLElement.prototype.scrollIntoView = scrollIntoView })
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (nativeScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', nativeScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})
function connect(view: ReturnType<typeof render>, protocolVersion = 3) {
  const frame = view.container.querySelector('iframe')!
  const outbound: Record<string, unknown>[] = []
  const port = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: (data: Record<string, unknown>) => outbound.push(data), start: () => {}, close: () => {} }
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = {} })
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const message = (data: unknown): void => { act(() => { port.onmessage?.({ data }) }) }
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin,
    data: { type: 'experiment/ready', protocolVersion, channel: new URL(frame.src).searchParams.get('channel') } })) })
  message({ type: 'experiment/connected', protocolVersion })
  return { outbound, message }
}
it('renders an uploaded non-lens package against its own matching engine and controls', () => {
  const onStatusChange = vi.fn()
  const view = render(<ExperimentCandidatePreview experimentId="incline" protocolVersion={3}
    entryUrl="/physicsos/experiment-assets/embed/preview/token/dist/index.html" onStatusChange={onStatusChange} />)
  const { outbound, message } = connect(view)
  const first = outbound[0]!
  expect(first.snapshot).toMatchObject({ experimentId: 'incline', domain: 'mechanics', revision: 0 })
  const angle = view.getByRole('slider', { name: /倾角/ })
  fireEvent.change(angle, { target: { value: '40' } })
  fireEvent.pointerUp(angle)
  const updated = outbound.at(-1)?.snapshot
  expect(isUniversalSnapshot(updated, 'incline')).toBe(true)
  if (!isUniversalSnapshot(updated, 'incline')) throw new Error('Expected a canonical incline snapshot')
  expect(updated.revision).toBe(1)
  const parameters = updated.inspector.flatMap(section => section !== null && typeof section === 'object' &&
    'parameters' in section && Array.isArray(section.parameters) ? section.parameters as readonly unknown[] : [])
  expect(parameters.find(parameter => parameter !== null && typeof parameter === 'object' &&
    'id' in parameter && parameter.id === 'angle')).toMatchObject({ id: 'angle', value: 40 })
  expect(onStatusChange).toHaveBeenLastCalledWith('loading')
  message({ type: 'experiment/rendered', protocolVersion: 3, frameId: first.frameId, revision: 0 })
  expect(onStatusChange).toHaveBeenLastCalledWith('ready')
})
it('replaces candidate state when changing experiments instead of reusing lens facts', () => {
  const view = render(<ExperimentCandidatePreview experimentId="incline" protocolVersion={3}
    entryUrl="/physicsos/experiment-assets/embed/preview/a/dist/index.html" />)
  connect(view)
  fireEvent.change(view.getByRole('slider', { name: /倾角/ }), { target: { value: '40' } })
  view.rerender(<ExperimentCandidatePreview experimentId="boiling-water" protocolVersion={3}
    entryUrl="/physicsos/experiment-assets/embed/preview/b/dist/index.html" />)
  const { outbound } = connect(view)
  expect(outbound[0]?.snapshot).toMatchObject({ experimentId: 'boiling-water', domain: 'thermal', revision: 0 })
  expect(view.queryByRole('slider', { name: /倾角/ })).toBeNull()
})
it('refuses unknown experiments before mounting their uploaded frame', () => {
  const view = render(<ExperimentCandidatePreview experimentId="unknown" protocolVersion={3}
    entryUrl="/physicsos/experiment-assets/embed/preview/a/dist/index.html" />)
  expect(view.getByRole('alert')).toBeTruthy()
  expect(view.container.querySelector('iframe')).toBeNull()
})
it.each([1, 2] as const)('V%s keeps the legacy preview frame title and brings its first draw into view', (protocolVersion) => {
  const view = render(<ExperimentCandidatePreview experimentId="convex-lens" protocolVersion={protocolVersion}
    entryUrl="/physicsos/experiment-assets/embed/preview/legacy/dist/index.html" />)
  expect(view.getByTitle('候选三维实验')).toBeTruthy()
  expect(scrollIntoView).toHaveBeenCalledTimes(1)
  expect(scrollIntoView.mock.instances[0]).toBe(view.getByRole('region', { name: '候选实验预览' }))
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
})
