// @vitest-environment jsdom
import { Profiler, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchFloatPanel, fitWorkbenchFloat } from '../src/client/WorkbenchFloatPanel.tsx'
import { layoutWorkbenchPanels } from '../src/client/workbench-geometry.ts'
import { ResponsiveInspector, useResponsiveInspector } from '../src/client/ResponsiveInspector.tsx'
import { Chart } from '../src/client/workspace-parts.tsx'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import { createMagneticRuntime } from '../src/client/physics-runtime-bridge.ts'
import { MAGNETIC_SCENE_INPUT } from '../src/client/prototype/magnetic-scene.ts'

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1360)
  vi.stubGlobal('innerHeight', 900)
  sessionStorage.clear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(12)
    const resize = panel.querySelector<HTMLElement>('[data-dockkit-float-resize]')!
    pointer(resize, 'pointerdown', 100, 100)
    pointer(window, 'pointerup', 5000, 5000)
    expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(1348)
    expect(Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.height)).toBeLessThanOrEqual(888)
    expect(screen.getByRole('textbox', { name: 'Mass' })).toBe(input)
    expect(input.value).toBe('2.5')
  })

  it('keeps floating controls below a measurable toolbar, including after the toolbar wraps', () => {
    let toolbarHeight = 64
    const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
    })
    const boxes = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('[data-physicsos-surface="lab"]')) return rect(80, 58, 1200, 710)
      if (this.matches('[data-workbench-toolbar]')) return rect(98, 64, 1164, toolbarHeight)
      return rect(0, 0, 0, 0)
    })
    const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []
    class Observer {
      readonly targets = new Set<Element>()
      constructor(readonly callback: ResizeObserverCallback) { observers.push(this) }
      observe(target: Element): void { this.targets.add(target) }
      unobserve(target: Element): void { this.targets.delete(target) }
      disconnect(): void { this.targets.clear() }
    }
    vi.stubGlobal('ResizeObserver', Observer)
    try {
      render(<div data-physicsos-surface="lab"><header data-workbench-toolbar>Playback and reports</header>
        <WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded placement="top-right">
          <input aria-label="Mass" />
        </WorkbenchFloatPanel>
      </div>)
      const panel = document.querySelector<HTMLElement>('[data-dockkit-float]')!
      expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(64 + toolbarHeight + 12)
      const header = screen.getByText('Playback and reports')
      const observer = observers.find(item => item.targets.has(header))
      expect(observer).toBeDefined()
      toolbarHeight = 110
      act(() => { observer!.callback([], observer as unknown as ResizeObserver) })
      expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(64 + toolbarHeight + 12)
    } finally { boxes.mockRestore() }
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

  it('changes only the requested axis of deliberately resized geometry', () => {
    const props = { title: 'Parameters', closeLabel: 'Close parameters', onClose: () => {}, expanded: true, width: 310, height: 210 }
    const view = render(<WorkbenchFloatPanel {...props}><input aria-label="Mass" /></WorkbenchFloatPanel>)
    const panel = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    const resize = panel.querySelector<HTMLElement>('[data-dockkit-float-resize]')!
    pointer(resize, 'pointerdown', 100, 100)
    pointer(window, 'pointerup', 190, 150)
    const resizedWidth = panel.style.width
    view.rerender(<WorkbenchFloatPanel {...props} height={380}><input aria-label="Mass" /></WorkbenchFloatPanel>)
    expect(panel.style.width).toBe(resizedWidth)
    expect(panel.style.height).toBe('380px')
    view.rerender(<WorkbenchFloatPanel {...props} width={340} height={380}><input aria-label="Mass" /></WorkbenchFloatPanel>)
    expect(panel.style.width).toBe('340px')
    expect(panel.style.height).toBe('380px')
  })

  it('switches compact panels without discarding an unfinished field and restores stacking when space returns', () => {
    function Fixture({ height }: { height: number }) {
      const [active, setActive] = useState('chart')
      const layout = layoutWorkbenchPanels({ x: 82, y: 128, width: 1200, height }, [
        { id: 'chart', placement: 'top-right', width: 400, height: 310 },
        { id: 'params', placement: 'bottom-right', width: 310, height: 210 },
      ], active)
      return <div data-physicsos-surface="lab">
        <button onClick={() => { setActive('chart') }}>Show charts</button><button onClick={() => { setActive('params') }}>Show parameters</button>
        <WorkbenchFloatPanel title="Charts" closeLabel="Close charts" onClose={() => {}} expanded layout={layout.panels.chart}><p>Speed chart</p></WorkbenchFloatPanel>
        <WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded layout={layout.panels.params}><input aria-label="Mass draft" defaultValue="1" /></WorkbenchFloatPanel>
      </div>
    }
    const view = render(<Fixture height={510} />)
    expect(screen.getByRole('region', { name: 'Charts' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show parameters' }))
    const field = screen.getByRole('textbox', { name: 'Mass draft' }) as HTMLInputElement
    fireEvent.change(field, { target: { value: '2.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show charts' }))
    expect(screen.queryByRole('textbox', { name: 'Mass draft' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show parameters' }))
    expect(screen.getByRole('textbox', { name: 'Mass draft' })).toBe(field)
    expect(field.value).toBe('2.')
    view.rerender(<Fixture height={600} />)
    const chart = screen.getByRole('region', { name: 'Charts' }).querySelector<HTMLElement>('[data-dockkit-float]')!
    const params = screen.getByRole('region', { name: 'Parameters' }).querySelector<HTMLElement>('[data-dockkit-float]')!
    expect(Number.parseFloat(chart.style.top) + Number.parseFloat(chart.style.height)).toBeLessThan(Number.parseFloat(params.style.top))
  })

  it('restores deliberate geometry into the new safe rectangle and retains a drag across remounts', () => {
    sessionStorage.setItem('physicsos:float:restore-spec', JSON.stringify({ x: 1200, y: 700, width: 500, height: 500 }))
    const bounds = { x: 12, y: 100, width: 296, height: 340 }
    const props = { title: 'Restored', closeLabel: 'Close restored', onClose: () => {}, expanded: true,
      storageKey: 'restore-spec', layout: { bounds, rect: bounds, visible: true } }
    const view = render(<WorkbenchFloatPanel {...props}><input aria-label="Restored field" /></WorkbenchFloatPanel>)
    const panel = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    expect([panel.style.left, panel.style.top, panel.style.width, panel.style.height]).toEqual(['12px', '100px', '296px', '340px'])
    view.unmount()
    const wideBounds = { x: 12, y: 100, width: 1200, height: 600 }
    const wideProps = { ...props, layout: { bounds: wideBounds, rect: { ...wideBounds, width: 300, height: 240 }, visible: true } }
    const next = render(<WorkbenchFloatPanel {...wideProps}><input aria-label="Restored field" /></WorkbenchFloatPanel>)
    const float = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    const grip = float.querySelector<HTMLElement>('[data-dockkit-float-grip]')!
    pointer(grip, 'pointerdown', 1100, 500)
    pointer(window, 'pointerup', 900, 350)
    const settled = { left: float.style.left, top: float.style.top }
    next.unmount()
    render(<WorkbenchFloatPanel {...wideProps}><input aria-label="Restored field" /></WorkbenchFloatPanel>)
    const restored = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    expect({ left: restored.style.left, top: restored.style.top }).toEqual(settled)
  })

  it('bounds a panel by the measured scene viewport rather than an assumed playback height', () => {
    const box = (x: number, y: number, width: number, height: number): DOMRect => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-workbench-viewport')) return box(82, 180, 1278, 380)
      if (this.hasAttribute('data-physicsos-surface')) return box(82, 58, 1278, 710)
      return box(0, 0, 0, 0)
    })
    render(<div data-physicsos-surface="lab"><header>Wrapped toolbar</header><div data-workbench-viewport />
      <WorkbenchFloatPanel title="Measured" closeLabel="Close measured" onClose={() => {}} expanded height={500}><input aria-label="Measured field" /></WorkbenchFloatPanel>
    </div>)
    const panel = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    expect(Number.parseFloat(panel.style.top)).toBe(192)
    expect(Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.height)).toBe(548)
  })

  it('preserves component drafts and the focused input through fullscreen reparenting', () => {
    function Editor() {
      const [draft, setDraft] = useState('1')
      return <input aria-label="Fullscreen draft" value={draft} onChange={event => { setDraft(event.target.value) }} />
    }
    const view = render(<div data-physicsos-surface="lab"><WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded><Editor /></WorkbenchFloatPanel></div>)
    const owner = view.container.querySelector<HTMLElement>('[data-physicsos-surface]')!
    const field = screen.getByRole('textbox', { name: 'Fullscreen draft' }) as HTMLInputElement
    field.focus()
    fireEvent.change(field, { target: { value: '2.' } })
    let fullscreen: Element | null = null
    const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    // jsdom does not implement fullscreen; model its read-only browser property for this fixture only.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    try {
      fullscreen = owner
      fireEvent(document, new Event('fullscreenchange'))
      expect(screen.getByRole('textbox', { name: 'Fullscreen draft' })).toBe(field)
      expect(owner.contains(field)).toBe(true)
      expect(field.value).toBe('2.')
      expect(document.activeElement).toBe(field)
      fullscreen = null
      fireEvent(document, new Event('fullscreenchange'))
      expect(screen.getByRole('textbox', { name: 'Fullscreen draft' })).toBe(field)
      expect(owner.contains(field)).toBe(false)
      expect(field.value).toBe('2.')
      expect(document.activeElement).toBe(field)
    } finally {
      if (original === undefined) Reflect.deleteProperty(document, 'fullscreenElement')
      else Object.defineProperty(document, 'fullscreenElement', original)
    }
  })

  it('keeps the close control and a scrollable content track in a very short safe rectangle', () => {
    const bounds = { x: 12, y: 130, width: 296, height: 20 }
    render(<WorkbenchFloatPanel title="Short panel" closeLabel="Close short panel" onClose={() => {}} expanded layout={{ bounds, rect: bounds, visible: true }}>
      <input aria-label="Short field" />
    </WorkbenchFloatPanel>)
    const layer = screen.getByRole('region', { name: 'Short panel' })
    expect(layer.hasAttribute('data-workbench-short')).toBe(true)
    expect(layer.querySelector<HTMLElement>('[data-dockkit-float]')?.style.height).toBe('20px')
    expect(within(layer).getByRole('button', { name: 'Close short panel' })).toBeTruthy()
    expect(within(layer).getByRole('textbox', { name: 'Short field' })).toBeTruthy()
  })

  it('hides a zero-area retained panel until measurable space returns', () => {
    const bounds = { x: 12, y: 130, width: 296, height: 0 }
    const props = { title: 'Measured panel', closeLabel: 'Close measured panel', onClose: () => {}, expanded: true }
    const view = render(<WorkbenchFloatPanel {...props} layout={{ bounds, rect: bounds, visible: true }}><input aria-label="Retained field" defaultValue="draft" /></WorkbenchFloatPanel>)
    expect(screen.queryByRole('region', { name: 'Measured panel' })).toBeNull()
    const field = document.querySelector<HTMLInputElement>('[aria-label="Retained field"]')!
    const next = { ...bounds, height: 200 }
    view.rerender(<WorkbenchFloatPanel {...props} layout={{ bounds: next, rect: next, visible: true }}><input aria-label="Retained field" defaultValue="draft" /></WorkbenchFloatPanel>)
    expect(screen.getByRole('textbox', { name: 'Retained field' })).toBe(field)
    expect(field.value).toBe('draft')
  })

  it('does not rerender content when scroll reports the same workbench rectangle', () => {
    const rendered = vi.fn()
    render(<Profiler id="stable-float" onRender={rendered}>
      <WorkbenchFloatPanel title="Stable" closeLabel="Close stable" onClose={() => {}} expanded><input aria-label="Stable geometry" /></WorkbenchFloatPanel>
    </Profiler>)
    const baseline = rendered.mock.calls.length
    const field = screen.getByRole('textbox', { name: 'Stable geometry' })
    const panel = document.querySelector<HTMLElement>('[data-dockkit-float]')!
    const left = Number.parseFloat(panel.style.left)
    fireEvent.scroll(field)
    expect(rendered).toHaveBeenCalledTimes(baseline)
    fireEvent.scroll(window)
    expect(rendered).toHaveBeenCalledTimes(baseline)
    // Real viewport changes must still publish a new rectangle; no-op protection cannot suppress all measurements.
    vi.stubGlobal('innerWidth', 1200)
    fireEvent(window, new Event('resize'))
    expect(Number.parseFloat(panel.style.left)).toBe(left - 160)
    expect(rendered.mock.calls.length).toBeGreaterThan(baseline)
    expect(screen.getByRole('textbox', { name: 'Stable geometry' })).toBe(field)
    const resizedBaseline = rendered.mock.calls.length
    fireEvent.scroll(field)
    expect(rendered).toHaveBeenCalledTimes(resizedBaseline)
    fireEvent.scroll(window)
    expect(rendered).toHaveBeenCalledTimes(resizedBaseline)
    // Deliberate geometry must update the same comparison snapshot as automatic measurements.
    const grip = panel.querySelector<HTMLElement>('[data-dockkit-float-grip]')!
    pointer(grip, 'pointerdown', 100, 100)
    pointer(window, 'pointerup', 60, 130)
    expect(Number.parseFloat(panel.style.left)).toBe(left - 200)
    const movedBaseline = rendered.mock.calls.length
    fireEvent.scroll(field)
    expect(rendered).toHaveBeenCalledTimes(movedBaseline)
    fireEvent.scroll(window)
    expect(rendered).toHaveBeenCalledTimes(movedBaseline)
  })

  it('retains the focused editor when widening and does not reclaim focus from another control', () => {
    vi.stubGlobal('innerWidth', 390)
    function Fixture({ open }: { open: boolean }) {
      return <><button>External opener</button><button>Other control</button>
        <WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded={open} desktopDefault={false}><input aria-label="Mass" /></WorkbenchFloatPanel></>
    }
    const view = render(<Fixture open={false} />)
    const opener = screen.getByRole('button', { name: 'External opener' })
    opener.focus()
    view.rerender(<Fixture open />)
    const field = screen.getByRole('textbox', { name: 'Mass' })
    field.focus()
    vi.stubGlobal('innerWidth', 1360)
    fireEvent(window, new Event('resize'))
    expect(document.activeElement).toBe(field)
    const other = screen.getByRole('button', { name: 'Other control' })
    other.focus()
    view.rerender(<Fixture open={false} />)
    expect(document.activeElement).toBe(other)
  })

  it('does not return focus out of a newer modal when the floating owner closes', () => {
    vi.stubGlobal('innerWidth', 390)
    function Fixture({ open }: { open: boolean }) {
      const [help, setHelp] = useState(false)
      return <><button>External opener</button>
        {open ? <WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={() => {}} expanded><button onClick={() => { setHelp(true) }}>Open newer help</button></WorkbenchFloatPanel> : null}
        <Modal open={help} title="Newer help" closeLabel="Close newer help" onClose={() => { setHelp(false) }}><input data-modal-autofocus aria-label="Help search" /></Modal></>
    }
    const view = render(<Fixture open={false} />)
    screen.getByRole('button', { name: 'External opener' }).focus()
    view.rerender(<Fixture open />)
    fireEvent.click(screen.getByRole('button', { name: 'Open newer help' }))
    const search = screen.getByRole('textbox', { name: 'Help search' })
    expect(document.activeElement).toBe(search)
    view.rerender(<Fixture open={false} />)
    expect(document.activeElement).toBe(search)
  })

  it('honors composition lifetime, modified Escape and repeated keys', () => {
    const close = vi.fn()
    render(<WorkbenchFloatPanel title="Parameters" closeLabel="Close parameters" onClose={close} expanded><input aria-label="Mass" /></WorkbenchFloatPanel>)
    const field = screen.getByRole('textbox', { name: 'Mass' })
    fireEvent.compositionStart(field)
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.compositionEnd(field)
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.keyUp(field, { key: 'Escape' })
    fireEvent.keyDown(field, { key: 'Escape', shiftKey: true })
    fireEvent.keyDown(field, { key: 'Escape', repeat: true })
    expect(close).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
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

it.each([2e6, 2e-13])('shows a nearly constant quantity at %s without amplifying numerical roundoff', (value) => {
  const series = { id: 'speed', title: 'Speed', xLabel: 'time', yLabel: 'speed', role: 'trajectory' as const,
    points: [{ t: 0, value }, { t: 1, value: value * (1 + 1e-14) }, { t: 2, value }] }
  render(<Chart series={series} time={0} total={2} />)
  const chart = screen.getByRole('img')
  const path = chart.querySelector('path')!.getAttribute('d')!
  const heights = [...path.matchAll(/[ML][\d.-]+\s([\d.-]+)/g)].map(match => match[1])
  expect(heights).toHaveLength(3)
  expect(new Set(heights).size).toBe(1)
  const ticks = [...chart.querySelectorAll('text')].slice(0, 2).map(tick => tick.textContent)
  expect(ticks[0]).not.toBe(ticks[1])
})

it('parks the real canvas readout below its toolbar and follows a wrapped toolbar', () => {
  let toolbarHeight = 64
  const rect = (top: number, width: number, height: number): DOMRect => ({
    x: 0, y: top, left: 0, top, width, height, right: width, bottom: top + height, toJSON: () => ({}),
  })
  const boxes = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'HEADER' ? rect(64, 1200, toolbarHeight) : rect(58, 1200, 710)
  })
  const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []
  class Observer {
    readonly targets = new Set<Element>()
    constructor(readonly callback: ResizeObserverCallback) { observers.push(this) }
    observe(target: Element): void { this.targets.add(target) }
    unobserve(target: Element): void { this.targets.delete(target) }
    disconnect(): void { this.targets.clear() }
  }
  vi.stubGlobal('ResizeObserver', Observer)
  try {
    const runtime = createMagneticRuntime(MAGNETIC_SCENE_INPUT)
    const revision = runtime.getSnapshot().sceneRevision
    const view = render(<div data-physicsos-surface="lab"><header>Playback and reports</header>
      <PhysicsCanvas view={runtime.getSnapshot().visual} ariaLabel="Magnetic field" />
    </div>)
    const readout = view.container.querySelector('[data-physics-readout="overlay"] rect')!
    expect(Number(readout.getAttribute('y'))).toBeGreaterThanOrEqual(64 + toolbarHeight - 58 + 12)
    const header = screen.getByText('Playback and reports')
    const observer = observers.find(item => item.targets.has(header))
    expect(observer).toBeDefined()
    toolbarHeight = 110
    act(() => { observer!.callback([], observer as unknown as ResizeObserver) })
    expect(Number(readout.getAttribute('y'))).toBeGreaterThanOrEqual(64 + toolbarHeight - 58 + 12)
    expect(runtime.getSnapshot().sceneRevision).toBe(revision)
  } finally { boxes.mockRestore() }
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
