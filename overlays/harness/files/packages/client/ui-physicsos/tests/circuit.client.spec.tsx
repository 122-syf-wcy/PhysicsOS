// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEmfMeasurementScene,
  createMixedCircuitScene,
  createParallelCircuitScene,
  createRheostatCircuitScene,
  createSeriesCircuitScene,
} from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
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

const sceneOf = (templateId: string) => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  return createExperimentSceneRef(template, t(template.label))
}

const mountLab = (templateId: string) => {
  const surface = createPhysicsSurfaceController()
  surface.open('lab', sceneOf(templateId))
  const view = render(
    <PhysicsSurface
      useLearningRecord={neverHook}
      useRecentExperiments={neverHook}
      usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
      t={t}
      useSessions={neverHook}
      useWorkspaces={neverHook}
    />,
  )
  return { surface, ...view }
}

const componentVisual = (
  snapshot: ReturnType<ReturnType<typeof createCircuitWorkspaceRuntime>['getSnapshot']>,
  id: string,
) => {
  const visual = snapshot.view.circuitComponents?.find(entry => entry.id === id)
  if (visual === undefined) throw new Error(`component visual missing: ${id}`)
  return visual
}

describe('circuit domain routing', () => {
  it('routes every circuit template scene to the circuit domain', () => {
    expect(domainOfScene(createSeriesCircuitScene())).toBe('circuit')
    expect(domainOfScene(createParallelCircuitScene())).toBe('circuit')
    expect(domainOfScene(createMixedCircuitScene())).toBe('circuit')
    expect(domainOfScene(createRheostatCircuitScene())).toBe('circuit')
    expect(domainOfScene(createEmfMeasurementScene())).toBe('circuit')
  })
})

describe('circuit workspace runtime', () => {
  it('solves the series textbook point: I = E/(R₁+R₂), voltmeter reads U₂', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('circuit')
    expect(snapshot.status).toBe('verified')
    /* No rheostat → a static reading, not an animation. */
    expect(snapshot.clock.total).toBe(0)
    expect(snapshot.charts).toEqual([])

    /* 6 V across 10 Ω + 20 Ω → 0.2 A; the voltmeter across R₂ reads 4 V. */
    expect(componentVisual(snapshot, 'am').reading).toBe('0.2 A')
    expect(componentVisual(snapshot, 'vm').reading).toBe('4 V')
    expect(componentVisual(snapshot, 'r1').voltageText).toBe('U=2 V')
    expect(componentVisual(snapshot, 'r2').powerText).toBe('P=0.8 W')

    /* The wiring itself is data the renderer can draw. */
    expect(snapshot.view.circuitWires?.length ?? 0).toBeGreaterThan(4)
    expect(snapshot.view.circuitJunctions?.length ?? 0).toBeGreaterThan(0)

    /* Verification is the engine's, not a hardcoded pass. */
    expect(snapshot.verification.some(check => check.id === 'kcl_current_conservation')).toBe(true)
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('kills the current when the switch opens, through a real scene command', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const snapshot = runtime.setChoice('switch:sw', 'open')

    expect(snapshot.sceneRevision).toBe(1)
    expect(snapshot.status).toBe('verified')
    expect(componentVisual(snapshot, 'sw').closed).toBe(false)
    /* An open loop carries no current, so no component may claim an arrow. */
    for (const visual of snapshot.view.circuitComponents ?? []) {
      expect(visual.currentText, `${visual.id} must not conduct`).toBeUndefined()
    }
  })

  it('sweeps the rheostat over the timeline and updates the operating point', () => {
    const runtime = createCircuitWorkspaceRuntime(createRheostatCircuitScene())
    const start = runtime.getSnapshot()

    expect(start.clock.total).toBe(8)
    /* Slider at 0 → the fixed 10 Ω alone limits the current. */
    expect(componentVisual(start, 'am').reading).toBe('0.6 A')
    expect(start.charts.map(series => series.id)).toEqual(['i-t', 'u-t', 'p-t'])
    for (const series of start.charts) {
      expect(series.points.length).toBeGreaterThan(100)
    }
    expect(start.trajectoryTimes.length).toBe(start.charts[0]?.points.length)

    /* End of the sweep: slider at 1 → 6 V / (10 + 20) Ω = 0.2 A, U₀ = 2 V. */
    const end = runtime.seek(8)
    expect(componentVisual(end, 'rv').sliderPosition).toBe(1)
    expect(componentVisual(end, 'am').reading).toBe('0.2 A')
    expect(componentVisual(end, 'vm').reading).toBe('2 V')

    /* advance() maps wall time 1:1 onto the sweep and stops at the end. */
    runtime.seek(0)
    runtime.setRunning(true)
    const advanced = runtime.advance(2)
    expect(advanced.clock.time).toBeCloseTo(2, 6)
    expect(advanced.clock.running).toBe(true)
    const finished = runtime.advance(100)
    expect(finished.clock.time).toBe(8)
    expect(finished.clock.running).toBe(false)
  })

  it('reads the EMF once the switch opens in the measurement circuit', () => {
    const runtime = createCircuitWorkspaceRuntime(createEmfMeasurementScene())
    const loaded = runtime.getSnapshot()
    /* Under load the terminal voltage sits below the EMF:
       U = E − I·r = 4.5 − 1.8 × 0.5 = 3.6 V. */
    expect(componentVisual(loaded, 'vm').reading).toBe('3.6 V')

    const open = runtime.setChoice('switch:sw', 'open')
    /* Only the voltmeter's 1e9 Ω leak remains → the meter reads E itself. */
    expect(componentVisual(open, 'vm').reading).toBe('4.5 V')
  })

  it('edits parameters through scene commands and re-solves', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const doubled = runtime.editParameter('emf', 12)
    expect(doubled.sceneRevision).toBe(1)
    expect(componentVisual(doubled, 'am').reading).toBe('0.4 A')

    const rebalanced = runtime.editParameter('resistance:r2', 50)
    expect(rebalanced.sceneRevision).toBe(2)
    /* 12 V across 10 + 50 Ω → 0.2 A. */
    expect(componentVisual(rebalanced, 'am').reading).toBe('0.2 A')
  })
})

describe('circuit Lab surface', () => {
  it('mounts a verified series circuit with symbols, meters and readings drawn', () => {
    const { container } = mountLab('series-circuit')

    expect(container.querySelector('[data-physicsos-domain="circuit"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')

    /* The schematic is VISIBLE: meter faces carry their letters, the readings
       are canvas text, and the wires have real path data. */
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('A')
    expect(svgText).toContain('V')
    expect(svgText).toContain('0.2 A')
    expect(svgText).toContain('4 V')
    expect(svgText.some(text => text.includes('R₁'))).toBe(true)

    const wirePaths = [...container.querySelectorAll('svg path')]
      .map(node => node.getAttribute('d') ?? '')
      .filter(d => d.length > 0)
    expect(wirePaths.length).toBeGreaterThan(4)
  })

  it('commits an EMF edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('series-circuit')

    const inspectorToggle = screen.getByRole('button', { name: '属性' })
    fireEvent.click(inspectorToggle)
    const emfInput = screen.getByRole('textbox', { name: '电动势' })
    if (!(emfInput instanceof HTMLInputElement)) throw new Error('Expected EMF input.')
    fireEvent.change(emfInput, { target: { value: '12' } })
    fireEvent.blur(emfInput)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('0.4 A')
  })

  it('toggles the switch from the inspector and the schematic reacts', () => {
    const { container } = mountLab('series-circuit')

    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    const switchSelect = screen.getByRole('combobox', { name: 'S' })
    fireEvent.change(switchSelect, { target: { value: 'open' } })

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    expect(
      container.querySelector('[data-testid="switch-sw"]')?.getAttribute('data-closed'),
    ).toBe('false')
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('0 A')
  })

  it('mounts the rheostat lab with a live timeline and three charts', () => {
    const { container } = mountLab('rheostat-circuit')

    expect(container.querySelector('[data-physicsos-domain="circuit"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    /* The sweep gives the shared timeline a real extent. */
    const slider = screen.getByRole('slider', { name: '时间轴' })
    if (!(slider instanceof HTMLInputElement)) throw new Error('Expected timeline range input.')
    expect(Number.parseFloat(slider.max)).toBe(8)
    expect(container.querySelector('[data-testid="slider-rv"]')).toBeTruthy()
  })
})
