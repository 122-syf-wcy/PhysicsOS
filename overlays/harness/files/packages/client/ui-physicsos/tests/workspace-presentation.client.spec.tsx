// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mountLab = (templateId: string) => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  const surface = createPhysicsSurfaceController()
  surface.open('lab', createExperimentSceneRef(template, t(template.label)))
  const element = () => (
    <PhysicsSurface
      useLearningRecord={neverHook}
      useRecentExperiments={neverHook}
      usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
      t={t}
      useSessions={neverHook}
      useWorkspaces={neverHook}
      useAuth={neverHook}
    />
  )
  const view = render(element())
  return { ...view, surface, refresh: () => { view.rerender(element()) } }
}

describe('return to chat', () => {
  it('offers a back button that dismisses the cover to the transcript', () => {
    const template = findExperimentTemplate('rheostat-circuit')!
    const surface = createPhysicsSurfaceController()
    surface.open('lab', createExperimentSceneRef(template, t(template.label)))
    const openSurface = vi.fn()
    render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        openSurface={openSurface}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }))
    expect(openSurface).toHaveBeenCalledWith('home')
  })
})

describe('workspace data panel', () => {
  it('starts collapsed so the canvas owns the bench, even with charts waiting', () => {
    mountLab('rheostat-circuit')
    /* The rheostat sweep produces I-t / U-t / P-t series, but the strip stays
       a handle until asked — expanding lands on the charts tab directly. */
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
    expect(screen.getByText('I - t')).toBeTruthy()
    expect(screen.getByText('U - t')).toBeTruthy()
  })

  it('stays collapsed for a static scene but still expands manually', () => {
    mountLab('series-circuit')
    /* One-state circuit: no curves, so an empty chart strip must not greet
       the student — but the strip still opens on demand. */
    const expand = screen.getByRole('button', { name: '展开' })
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
  })
})

describe('workspace panel folding', () => {
  it('folds a scene-tree group on click and expands it again', () => {
    mountLab('rheostat-circuit')
    const group = screen.getAllByRole('button').find(
      button => button.getAttribute('aria-expanded') === 'true',
    )!
    const item = group.closest('li')!
    expect(item.querySelector('ul')).toBeTruthy()

    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('false')
    expect(item.querySelector('ul')).toBeNull()

    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('true')
    expect(item.querySelector('ul')).toBeTruthy()
  })

  it('folds a side panel track via its chevron and restores via the toolbar toggle', () => {
    mountLab('rheostat-circuit')
    const cover = document.querySelector('[data-physicsos-surface="lab"]')!

    fireEvent.click(screen.getByRole('button', { name: '收起场景面板' }))
    expect(cover.getAttribute('data-scene-collapsed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '图层' }))
    expect(cover.getAttribute('data-scene-collapsed')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '收起检查器' }))
    expect(cover.getAttribute('data-inspector-collapsed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    expect(cover.getAttribute('data-inspector-collapsed')).toBeNull()
  })
})

describe('workspace focus mode', () => {
  it('keeps keyboard focus on the focus toggle after entering and exiting', async () => {
    mountLab('rheostat-circuit')
    const toggle = screen.getByRole('button', { name: '专注实验' })
    toggle.focus()

    fireEvent.click(toggle)
    await Promise.resolve()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '退出专注' }))

    fireEvent.click(toggle)
    await Promise.resolve()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '专注实验' }))
  })

  it('hides the side panels reversibly while keeping the tools', () => {
    mountLab('rheostat-circuit')
    expect(screen.getByRole('region', { name: '场景与对象' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '检查器' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '专注实验' }))
    expect(screen.getByRole('button', { name: '退出专注' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '场景与对象' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: '检查器' })).toBeNull()
    /* Tools stay reachable on the bench: playback, report, agent dock. */
    expect(screen.getByRole('button', { name: '运行' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '报告' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'AI 助教' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    expect(screen.getByRole('button', { name: '运行' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(screen.getByRole('button', { name: '运行' }).getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: '报告' }))
    const report = screen.getByRole('dialog', { name: '实验报告' })
    fireEvent.click(within(report).getByRole('button', { name: '收起' }))
    expect(screen.queryByRole('dialog', { name: '实验报告' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'AI 助教' }))
    const assistant = screen.getByRole('complementary', { name: 'AI 助教' })
    fireEvent.click(within(assistant).getByRole('button', { name: '收起' }))
    expect(screen.getByRole('button', { name: 'AI 助教' })).toBeTruthy()

    /* Re-open for the free-form composer: a typed question lands in the local
       thread as a structured card — the same lane the suggestions use. */
    fireEvent.click(screen.getByRole('button', { name: 'AI 助教' }))
    const drawer = screen.getByRole('complementary', { name: 'AI 助教' })
    const input = within(drawer).getByRole('textbox', { name: '例如：水平速度在哪里？' })
    fireEvent.change(input, { target: { value: '最高点的高度是多少' } })
    fireEvent.click(within(drawer).getByRole('button', { name: '发送' }))
    expect(within(drawer).getByText('最高点的高度是多少')).toBeTruthy()
    expect(within(drawer).getByText('分析')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: '收起' }))

    fireEvent.click(screen.getByRole('button', { name: '退出专注' }))
    expect(screen.getByRole('button', { name: '专注实验' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '场景与对象' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '检查器' })).toBeTruthy()
  })

  it('reinitializes focus and data visibility when the active scene changes', () => {
    const { surface, refresh } = mountLab('rheostat-circuit')
    fireEvent.click(screen.getByRole('button', { name: '专注实验' }))

    const staticTemplate = findExperimentTemplate('series-circuit')!
    surface.open('lab', createExperimentSceneRef(staticTemplate, t(staticTemplate.label)))
    refresh()
    expect(screen.getByRole('button', { name: '专注实验' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '场景与对象' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开' })).toBeTruthy()

    const chartTemplate = findExperimentTemplate('rheostat-circuit')!
    surface.open('lab', createExperimentSceneRef(chartTemplate, t(chartTemplate.label)))
    refresh()
    /* A chart-capable scene still starts collapsed — the strip expands onto
       the charts tab directly. */
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
    expect(screen.getByText('I - t')).toBeTruthy()
  })

  it('hands the side surfaces over between the agent and the drawers', () => {
    mountLab('magnetic-circular')

    /* The agent owns the rail while it is open: asking for the scene drawer
       releases the rail and the agent steps away. */
    fireEvent.click(screen.getByRole('button', { name: 'AI 助教' }))
    expect(screen.getByRole('complementary', { name: 'AI 助教' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '图层' }))
    expect(screen.queryByRole('complementary', { name: 'AI 助教' })).toBeNull()
    expect(screen.getByRole('region', { name: '场景与对象' })).toBeTruthy()

    /* And back: the dock dismisses a live drawer before it takes the rail. */
    fireEvent.click(screen.getByRole('button', { name: 'AI 助教' }))
    expect(screen.getByRole('complementary', { name: 'AI 助教' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '图层' }).getAttribute('aria-expanded'),
    ).toBe('false')
  })
})

describe.each([
  { toggleLabel: '图层', panelRole: 'region', panelLabel: '场景与对象', closeLabel: '关闭图层' },
  { toggleLabel: '检查器', panelRole: 'complementary', panelLabel: '检查器', closeLabel: '关闭检查器' },
])('responsive $toggleLabel drawer', ({ toggleLabel, panelRole, panelLabel, closeLabel }) => {
  it('only moves opening focus when the drawer controls are visible', () => {
    mountLab('magnetic-circular')
    const toggle = screen.getByRole('button', { name: toggleLabel })
    const close = screen.getByRole('button', { name: closeLabel })

    /* jsdom has no container layout; supply the resolved desktop display. */
    close.style.display = 'none'
    toggle.focus()
    fireEvent.click(toggle)
    expect(document.activeElement).toBe(toggle)

    fireEvent.click(toggle)
    close.style.display = 'inline-flex'
    fireEvent.click(toggle)
    expect(document.activeElement).toBe(close)
  })

  it('releases Tab navigation after the drawer becomes a desktop panel', () => {
    mountLab('magnetic-circular')
    const toggle = screen.getByRole('button', { name: toggleLabel })
    const panel = screen.getByRole(panelRole, { name: panelLabel })
    const close = within(panel).getByRole('button', { name: closeLabel })
    close.style.display = 'inline-flex'
    fireEvent.click(toggle)
    expect(document.activeElement).toBe(close)

    const controls = [...panel.querySelectorAll<HTMLElement>('button, input, select')]
    const firstDesktopControl = controls[1]!
    const lastControl = controls.at(-1)!
    /* A wider container hides the close control without changing open state. */
    close.style.display = 'none'
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    lastControl.focus()
    expect(fireEvent.keyDown(lastControl, { key: 'Tab' })).toBe(true)
    firstDesktopControl.focus()
    expect(fireEvent.keyDown(firstDesktopControl, { key: 'Tab', shiftKey: true })).toBe(true)
  })

  it.each(['display', 'visibility', 'ancestor'])('excludes %s-hidden controls from the drawer focus loop', (hiddenBy) => {
    mountLab('magnetic-circular')
    const panel = screen.getByRole(panelRole, { name: panelLabel })
    const close = within(panel).getByRole('button', { name: closeLabel })
    close.style.display = 'inline-flex'
    fireEvent.click(screen.getByRole('button', { name: toggleLabel }))
    const controls = [...panel.querySelectorAll<HTMLElement>('button, input, select')]
    const hiddenControl = controls.at(-1)!
    let lastVisibleControl = controls.at(-2)!
    if (hiddenBy === 'ancestor') {
      const hiddenParent = hiddenControl.parentElement!
      hiddenParent.style.display = 'none'
      lastVisibleControl = controls.filter(control => !hiddenParent.contains(control)).at(-1)!
    } else if (hiddenBy === 'visibility') {
      hiddenControl.style.visibility = 'hidden'
    } else {
      hiddenControl.style.display = 'none'
    }

    lastVisibleControl.focus()
    expect(fireEvent.keyDown(lastVisibleControl, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(close)
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(lastVisibleControl)
  })
})

describe('workspace layers drawer', () => {
  it('keeps only the last opened drawer active and focused', async () => {
    mountLab('magnetic-circular')
    const layers = screen.getByRole('button', { name: '图层' })
    const inspector = screen.getByRole('button', { name: '检查器' })

    fireEvent.click(layers)
    expect(layers.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(inspector)
    expect(layers.getAttribute('aria-expanded')).toBe('false')
    expect(inspector.getAttribute('aria-expanded')).toBe('true')
    await Promise.resolve()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭检查器' }))

    fireEvent.click(layers)
    expect(inspector.getAttribute('aria-expanded')).toBe('false')
    expect(layers.getAttribute('aria-expanded')).toBe('true')
    await Promise.resolve()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭图层' }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(layers.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => { expect(document.activeElement).toBe(layers) })
  })

  it('opens usable scene controls and returns keyboard focus after Escape', async () => {
    const { container } = mountLab('magnetic-circular')
    const toggle = screen.getByRole('button', { name: '图层' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const scene = screen.getByRole('region', { name: '场景与对象' })
    expect(scene.id).toBe(toggle.getAttribute('aria-controls'))
    const close = within(scene).getByRole('button', { name: '关闭图层' })
    expect(document.activeElement).toBe(close)

    const velocityLabels = () =>
      [...container.querySelectorAll('svg text')].filter(node => node.textContent === 'v')
    expect(velocityLabels()).toHaveLength(1)
    fireEvent.click(within(scene).getByRole('button', { name: '速度' }))
    expect(velocityLabels()).toHaveLength(0)

    const lastControl = within(scene).getAllByRole('button').at(-1)!
    lastControl.focus()
    fireEvent.keyDown(lastControl, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => { expect(document.activeElement).toBe(toggle) })
    expect(velocityLabels()).toHaveLength(0)
  })
})

describe('playback keyboard and replay affordance', () => {
  it('steps to the end with ArrowRight, offers 重播, and Space replays from t = 0', () => {
    mountLab('uniform-acceleration')
    const cover = document.querySelector<HTMLElement>('[data-physicsos-surface="lab"]')!
    expect(cover.dataset['physicsosRunning']).toBe('false')

    /* Ten ArrowRight steps of a tenth each walk the paused clock to the end. */
    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    }
    expect(screen.getAllByRole('button', { name: '重播' }).length).toBeGreaterThan(0)

    /* Space replays: the clock rewinds and the run starts again. */
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(cover.dataset['physicsosRunning']).toBe('true')
    expect(screen.queryByRole('button', { name: '重播' })).toBeNull()

    /* ArrowLeft seeks back (and pauses), Home rewinds to t = 0. */
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(cover.dataset['physicsosRunning']).toBe('false')
    fireEvent.keyDown(document.body, { key: 'Home' })
    expect(screen.queryByRole('button', { name: '重播' })).toBeNull()
  })

  it('yields the keys to focused controls instead of hijacking them', () => {
    mountLab('uniform-acceleration')
    const cover = document.querySelector<HTMLElement>('[data-physicsos-surface="lab"]')!
    const run = screen.getByRole('button', { name: '运行' })
    run.focus()
    /* A focused button owns Space natively; the document listener must not
       toggle a second time on top of the button's own activation. */
    expect(fireEvent.keyDown(run, { key: ' ' })).toBe(true)
    expect(cover.dataset['physicsosRunning']).toBe('false')
  })
})

describe('readout card', () => {
  /* The card is draggable chrome: pointer gestures on it reposition it inside
     the canvas and must never leak into trajectory hover/seek. jsdom reports
     a zero rect for layout, so the svg gets a viewBox-sized rect to make
     client and viewBox coordinates coincide. */
  const mountCanvasProbe = () => {
    mountLab('projectile-horizontal')
    const svg = document.querySelector<SVGSVGElement>('svg[role="img"]')!
    const [, , vbW, vbH] = svg.getAttribute('viewBox')!.split(' ').map(Number)
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: vbW, height: vbH, right: vbW, bottom: vbH, x: 0, y: 0, toJSON: () => ({}) }),
    })
    const panel = () => document.querySelector<SVGRectElement>('rect[class*="readoutPanel"]')!
    return { svg, panel, vbW, vbH }
  }

  it('repositions on drag and stays inside the canvas', () => {
    const { panel, vbW, vbH } = mountCanvasProbe()
    const x0 = Number(panel().getAttribute('x'))
    const y0 = Number(panel().getAttribute('y'))
    const w = Number(panel().getAttribute('width'))
    const h = Number(panel().getAttribute('height'))
    const grab = { x: x0 + w / 2, y: y0 + h / 2 }

    /* Below the drag threshold the card holds still. */
    fireEvent.pointerDown(panel(), { pointerId: 7, clientX: grab.x, clientY: grab.y })
    fireEvent.pointerMove(panel(), { pointerId: 7, clientX: grab.x + 1, clientY: grab.y })
    expect(Number(panel().getAttribute('x'))).toBe(x0)

    fireEvent.pointerMove(panel(), { pointerId: 7, clientX: grab.x + 150, clientY: grab.y + 90 })
    expect(Number(panel().getAttribute('x'))).toBeCloseTo(x0 + 150, 5)
    expect(Number(panel().getAttribute('y'))).toBeCloseTo(y0 + 90, 5)
    fireEvent.pointerUp(panel(), { pointerId: 7, clientX: grab.x + 150, clientY: grab.y + 90 })

    /* A drag past the far corner clamps inside the canvas bounds. */
    fireEvent.pointerDown(panel(), { pointerId: 7, clientX: x0 + 150 + w / 2, clientY: y0 + 90 + h / 2 })
    fireEvent.pointerMove(panel(), { pointerId: 7, clientX: vbW + 5000, clientY: vbH + 5000 })
    expect(Number(panel().getAttribute('x'))).toBeCloseTo(vbW - w - 4, 5)
    expect(Number(panel().getAttribute('y'))).toBeCloseTo(vbH - h - 4, 5)
    fireEvent.pointerUp(panel(), { pointerId: 7 })
  })

  it('swallows the release click so a card drag never seeks the trajectory', () => {
    const { panel } = mountCanvasProbe()
    const scrubber = () => document.querySelector('input[type="range"]')!
    const before = scrubber().getAttribute('aria-valuetext')
    const x0 = Number(panel().getAttribute('x'))
    const y0 = Number(panel().getAttribute('y'))

    fireEvent.pointerDown(panel(), { pointerId: 3, clientX: x0 + 5, clientY: y0 + 5 })
    fireEvent.pointerMove(panel(), { pointerId: 3, clientX: x0 + 85, clientY: y0 + 60 })
    fireEvent.pointerUp(panel(), { pointerId: 3, clientX: x0 + 85, clientY: y0 + 60 })
    fireEvent.click(panel())

    expect(scrubber().getAttribute('aria-valuetext')).toBe(before)
  })

  it('ignores foreign pointers, survives cancel, and no-ops without layout', () => {
    mountLab('projectile-horizontal')
    const panel = () => document.querySelector<SVGRectElement>('rect[class*="readoutPanel"]')!
    const x0 = Number(panel().getAttribute('x'))

    /* No layout rect: the gesture cannot be measured, so nothing moves. */
    fireEvent.pointerDown(panel(), { pointerId: 5, clientX: x0, clientY: 0 })
    fireEvent.pointerMove(panel(), { pointerId: 5, clientX: x0 + 100, clientY: 100 })
    expect(Number(panel().getAttribute('x'))).toBe(x0)

    /* Pointer moves without an active drag, or from another pointer, pass. */
    const svg = document.querySelector<SVGSVGElement>('svg[role="img"]')!
    const [, , vbW, vbH] = svg.getAttribute('viewBox')!.split(' ').map(Number)
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: vbW, height: vbH, right: vbW, bottom: vbH, x: 0, y: 0, toJSON: () => ({}) }),
    })
    fireEvent.pointerMove(panel(), { pointerId: 9, clientX: 200, clientY: 200 })
    fireEvent.pointerDown(panel(), { pointerId: 5, clientX: x0 + 2, clientY: 20 })
    fireEvent.pointerMove(panel(), { pointerId: 9, clientX: 400, clientY: 300 })
    expect(Number(panel().getAttribute('x'))).toBe(x0)
    fireEvent.pointerCancel(panel(), { pointerId: 9 })
    fireEvent.pointerCancel(panel(), { pointerId: 5 })
    fireEvent.pointerMove(panel(), { pointerId: 5, clientX: 400, clientY: 300 })
    expect(Number(panel().getAttribute('x'))).toBe(x0)
  })
})
