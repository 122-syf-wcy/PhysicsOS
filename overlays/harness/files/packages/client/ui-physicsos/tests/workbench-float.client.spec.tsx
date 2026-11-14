// @vitest-environment jsdom
import { useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchFloatPanel, fitWorkbenchFloat } from '../src/client/WorkbenchFloatPanel.tsx'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { ResponsiveInspector, useResponsiveInspector } from '../src/client/ResponsiveInspector.tsx'
import { Chart } from '../src/client/workspace-parts.tsx'

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1360)
  vi.stubGlobal('innerHeight', 900)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const pointer = (target: Element | Window | Document | Node, type: string, x: number, y: number): void => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 3 })
  fireEvent(target, event)
}

describe('workbench floating controls', () => {
  it('fits a moved or resized panel within the owning bench, including a small viewport', () => {
    expect(fitWorkbenchFloat({ x: -40, y: 900, width: 600, height: 500 }, { x: 80, y: 66, width: 320, height: 240 }))
      .toEqual({ x: 80, y: 66, width: 320, height: 240 })
    expect(fitWorkbenchFloat({ x: 110, y: 90, width: 240, height: 160 }, { x: 80, y: 66, width: 900, height: 600 }))
      .toEqual({ x: 110, y: 90, width: 240, height: 160 })
  })

  it('preserves an in-progress field while Dockkit moves and resizes its floating panel', () => {
    render(<WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded width={310} height={240}>
      <label>Mass<input aria-label="Mass" defaultValue="1" /></label>
    </WorkbenchFloatPanel>)
    const input = screen.getByRole('textbox', { name: 'Mass' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2.5' } })
    const panel = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    const grip = panel.querySelector<HTMLElement>('[data-dockkit-float-grip]')!
    const left = Number.parseFloat(panel.style.left)
    const top = Number.parseFloat(panel.style.top)
    pointer(grip, 'pointerdown', left + 10, top + 10)
    pointer(window, 'pointermove', -500, -500)
    pointer(window, 'pointerup', -500, -500)
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(12)
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(66)
    const resize = panel.querySelector<HTMLElement>('[data-dockkit-float-resize]')!
    pointer(resize, 'pointerdown', 100, 100)
    pointer(window, 'pointerup', 5000, 5000)
    expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(1348)
    expect(Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.height)).toBeLessThanOrEqual(814)
    expect(screen.getByRole('textbox', { name: 'Mass' })).toBe(input)
    expect(input.value).toBe('2.5')
  })

  it('raises the panel receiving pointer or keyboard focus within its own workbench', () => {
    render(<>
      <div data-physicsos-surface="lab">
        <WorkbenchFloatPanel title="Charts" closeLabel="Close charts" onClose={() => {}} expanded><input aria-label="Chart input" /></WorkbenchFloatPanel>
        <WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded><input aria-label="Parameter input" /></WorkbenchFloatPanel>
      </div>
      <div data-physicsos-surface="lab">
        <WorkbenchFloatPanel title="Another bench" closeLabel="Close another bench" onClose={() => {}} expanded><input aria-label="Other input" /></WorkbenchFloatPanel>
      </div>
    </>)
    const charts = screen.getByRole('region', { name: 'Charts' })
    const parameters = screen.getByRole('region', { name: 'Parameters' })
    const other = screen.getByRole('region', { name: 'Another bench' })
    const otherLayer = other.style.zIndex
    pointer(screen.getByRole('textbox', { name: 'Chart input' }), 'pointerdown', 100, 100)
    expect(Number(charts.style.zIndex)).toBeGreaterThan(Number(parameters.style.zIndex))
    screen.getByRole('textbox', { name: 'Parameter input' }).focus()
    expect(Number(parameters.style.zIndex)).toBeGreaterThan(Number(charts.style.zIndex))
    expect(other.style.zIndex).toBe(otherLayer)
  })

  it('keeps a user-resized detail panel after the viewport is measured again', () => {
    const view = render(<WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded width={310} height={210}>
      <input aria-label="Mass" defaultValue="1" />
    </WorkbenchFloatPanel>)
    view.rerender(<WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded width={310} height={380}>
      <input aria-label="Mass" defaultValue="1" />
    </WorkbenchFloatPanel>)
    const panel = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    const resize = panel.querySelector<HTMLElement>('[data-dockkit-float-resize]')!
    pointer(resize, 'pointerdown', 100, 100)
    pointer(window, 'pointerup', 150, 120)
    const settled = { width: panel.style.width, height: panel.style.height }
    expect(settled).toEqual({ width: '360px', height: '400px' })
    fireEvent(window, new Event('resize'))
    expect({ width: panel.style.width, height: panel.style.height }).toEqual(settled)
  })

  it('leaves IME and modal Escape with their owner while closing the focused inspector normally', () => {
    vi.stubGlobal('innerWidth', 390)
    function Fixture() {
      const controller = useResponsiveInspector()
      const [helpOpen, setHelpOpen] = useState(false)
      return <>
        <button ref={controller.triggerRef} type="button" onClick={controller.reveal}>Open inspector</button>
        <ResponsiveInspector controller={controller} label="Parameters" closeLabel="Close parameters">
          <input aria-label="Mass" />
          <button type="button" onClick={() => { setHelpOpen(true) }}>Open help</button>
        </ResponsiveInspector>
        <Modal open={helpOpen} onClose={() => { setHelpOpen(false) }} title="Help" closeLabel="Close help"><input aria-label="Help input" /></Modal>
      </>
    }
    render(<Fixture />)
    fireEvent.click(screen.getByRole('button', { name: 'Open inspector' }))
    const mass = screen.getByRole('textbox', { name: 'Mass' })
    fireEvent.keyDown(mass, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(mass, { key: 'Escape', keyCode: 229 })
    expect(screen.getByRole('complementary', { name: 'Parameters' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('complementary', { name: 'Parameters' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open help' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Help input' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Parameters' })).toBeTruthy()
    fireEvent.keyDown(mass, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Parameters' })).toBeNull()
  })

  it('opens only on request on a narrow bench and returns focus after Escape', () => {
    vi.stubGlobal('innerWidth', 390)
    function Fixture() {
      const [open, setOpen] = useState(false)
      return <><button type="button" onClick={() => { setOpen(true) }}>Open parameters</button>
        <WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => { setOpen(false) }} expanded={open}>
          <input aria-label="Mass" defaultValue="1" />
        </WorkbenchFloatPanel></>
    }
    render(<Fixture />)
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull()
    const opener = screen.getByRole('button', { name: 'Open parameters' })
    opener.focus()
    fireEvent.click(opener)
    const region = screen.getByRole('region', { name: 'Parameters' })
    const close = within(region).getByRole('button', { name: 'Close parameters' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

it('supports a zero-based usage trend while retaining hover inspection and its own axis scale', () => {
  const series = { id: 'usage', title: 'Requests', xLabel: 'day', yLabel: 'requests', role: 'trajectory' as const,
    points: [{ t: 0, value: 2 }, { t: 1, value: 4 }, { t: 2, value: 3 }] }
  const hover = vi.fn()
  render(<Chart series={series} time={0} total={2} width={720} height={180} zeroBased onHoverTime={hover} />)
  const chart = screen.getByRole('img')
  expect(chart.getAttribute('viewBox')).toBe('0 0 720 180')
  expect(screen.getByText('0.0')).toBeTruthy()
  Object.defineProperty(chart, 'getBoundingClientRect', { value: () => ({ left: 0, width: 720 }) })
  fireEvent.mouseMove(chart, { clientX: 372 })
  expect(hover).toHaveBeenCalledWith(expect.any(Number))
  expect(screen.getByText('4 · requests')).toBeTruthy()
  fireEvent.mouseLeave(chart)
  expect(hover).toHaveBeenLastCalledWith(null)
})

it('keeps floating editors inside the existing focused experiment modal', () => {
  render(<Modal open title="Focused experiment" closeLabel="Close experiment" onClose={() => {}}>
    <div data-physicsos-surface="lab"><WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded>
      <input aria-label="Mass" defaultValue="1" />
    </WorkbenchFloatPanel></div>
  </Modal>)
  const modal = screen.getByRole('dialog', { name: 'Focused experiment' })
  expect(modal.contains(screen.getByRole('textbox', { name: 'Mass' }))).toBe(true)
})
