// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { createExperimentSceneRef, findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

const openLabOnTemplate = (
  surface: ReturnType<typeof createPhysicsSurfaceController>,
  templateId: string,
): void => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown experiment template: ${templateId}`)
  surface.open('lab', createExperimentSceneRef(template, t(template.label)))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('#123 renderer/React decoupling', () => {
  it('updates the canvas per frame while the React tree stays on the throttled summary', () => {
    /* A controllable wall clock, so the summary throttle is deterministic. */
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrameId += 1
      frames.set(nextFrameId, callback)
      return nextFrameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })

    const surface = createPhysicsSurfaceController()
    openLabOnTemplate(surface, 'projectile-horizontal')
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    /* First RAF call baselines the clock; the second advances 16.67 ms. */
    act(() => { frames.get(1)?.(100) })
    act(() => { frames.get(2)?.(116.67) })

    /* The renderer channel delivered the advanced frame to the canvas alone:
       the readout now carries t = 0.01667 s. */
    expect(screen.getByText('t = 0.01667 s')).toBeTruthy()
    /* The timeline's current-time label is deliberately live — it shares the
       canvas's frame source so the two clocks can never disagree while a run
       plays. The REST of the React tree still rides the throttled summary:
       the scrubber's aria-valuetext keeps the initial 0.00 s. */
    const scrubber = container.querySelector('input[type="range"]')
    expect(scrubber?.getAttribute('aria-valuetext')).toContain('0.00 s')
    expect(screen.getByText('0.02 s')).toBeTruthy()

    /* Once the summary interval elapses, the React tree catches up. */
    now = 300
    act(() => { frames.get(3)?.(216.67) })
    expect(scrubber?.getAttribute('aria-valuetext')).not.toContain('0.00 s /')
  })

  it('keeps discrete interactions immediate (run → pause via the toolbar)', () => {
    const surface = createPhysicsSurfaceController()
    openLabOnTemplate(surface, 'projectile-horizontal')
    render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(screen.getByRole('button', { name: '运行' })).toBeTruthy()
  })
})
