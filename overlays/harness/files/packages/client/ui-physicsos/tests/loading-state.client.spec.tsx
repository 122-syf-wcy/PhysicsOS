// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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
