// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LoadingState } from '../src/client/LoadingState.tsx'
import { AdminEmpty } from '../src/client/AdminPrimitives.tsx'
import { OptionalComponent } from '../src/client/OptionalComponent.tsx'
import { OptionalCanvasOverlay } from '../src/client/optional-surfaces.tsx'
import type { CanvasOverlayProps } from '../src/client/canvas/contract.ts'
import * as modules from '../src/client/optional-modules.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('shows three startup characters and removes them immediately when the feature is ready', async () => {
  let ready!: (value: { default: () => React.JSX.Element }) => void
  const load = () => new Promise<{ default: () => React.JSX.Element }>(resolve => { ready = resolve })
  render(<OptionalComponent load={load} componentProps={{}} />)
  const status = screen.getByRole('status')
  expect(status.querySelectorAll('img')).toHaveLength(3)
  expect([...status.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([
    '/physicsos/loading/boy.webp', '/physicsos/loading/girl.webp', '/physicsos/loading/cat.webp',
  ])
  await act(async () => { ready({ default: () => <p>Ready canvas</p> }) })
  expect(screen.getByText('Ready canvas')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})

it('does not put a second loading placeholder in the canvas shell overlay', async () => {
  const load = vi.spyOn(modules, 'loadCanvasModule').mockReturnValue(new Promise(() => {}))
  const props = {
    usePhysicsSurface: (select: (state: object) => unknown) => select({ surface: 'canvas' }),
    useStore: (select: (state: object) => unknown) => select({}),
  } as unknown as CanvasOverlayProps
  const { container } = render(<OptionalCanvasOverlay {...props} />)
  expect(load).toHaveBeenCalledOnce()
  expect(container.childElementCount).toBe(0)
})

it('renders the inline variant with the caller copy beside the same three characters', () => {
  render(<LoadingState inline>加载中…</LoadingState>)
  const status = screen.getByRole('status')
  expect(status.querySelectorAll('img')).toHaveLength(3)
  expect(status.textContent).toContain('加载中…')
  // Inline waits sit in cards and rows, so the full-page brand block is omitted.
  expect(status.textContent).not.toContain('PhysicsOS')
})

it('turns an admin loading sentence into the startup artwork but leaves real empty copy alone', () => {
  const { container, rerender } = render(<AdminEmpty>加载中…</AdminEmpty>)
  expect(container.querySelectorAll('img')).toHaveLength(3)
  rerender(<AdminEmpty>暂无审核记录</AdminEmpty>)
  expect(container.querySelectorAll('img')).toHaveLength(0)
  expect(container.textContent).toContain('暂无审核记录')
})
