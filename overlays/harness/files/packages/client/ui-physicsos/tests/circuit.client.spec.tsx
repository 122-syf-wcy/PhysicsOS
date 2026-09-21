// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { CircuitRenderer } from '../src/client/physics/circuit-renderer.tsx'
import type {
  ComponentControlChannel,
  ComponentDragChannel,
  RendererProjection,
} from '../src/client/physics/renderer-registry.tsx'
import type { ScenePoint } from '../src/client/physics/scene-visual-model.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
import { PARTS3D, part3dUrl } from '../src/client/physics/parts3d-catalog.ts'
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
      useAuth={neverHook}
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

/**
 * Screen-space box of a part sprite, recovered from the geometry the renderer
 * actually emits: the `<image>` frame in the local a→b coordinate system, pushed
 * through the `rotate(angle cx cy)` on its containing group. jsdom does no
 * layout, so reading the attributes is the only honest way to measure a label
 * against a body.
 */
const spriteScreenBox = (sprite: Element) => {
  /* ComponentSprite wraps the image in a plain <g>; the branch rotation lives on
     the group above it. */
  let host: Element | null = sprite
  let match: RegExpExecArray | null = null
  while (host !== null && match === null) {
    match = /rotate\((-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/.exec(
      host.getAttribute('transform') ?? '',
    )
    host = match === null ? host.parentElement : host
  }
  if (match === null) throw new Error('sprite is not drawn inside a rotated group')
  const degrees = Number(match[1])
  const pivotX = Number(match[2])
  const pivotY = Number(match[3])
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const x = Number(sprite.getAttribute('x'))
  const y = Number(sprite.getAttribute('y'))
  const width = Number(sprite.getAttribute('width'))
  const height = Number(sprite.getAttribute('height'))
  const corners = ([
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ] as const).map(([px, py]) => ({
    x: pivotX + (px - pivotX) * cos - (py - pivotY) * sin,
    y: pivotY + (px - pivotX) * sin + (py - pivotY) * cos,
  }))
  return {
    left: Math.min(...corners.map(corner => corner.x)),
    right: Math.max(...corners.map(corner => corner.x)),
    top: Math.min(...corners.map(corner => corner.y)),
    bottom: Math.max(...corners.map(corner => corner.y)),
  }
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

describe('circuit charge flow and lamp glow', () => {
  const flowOf = (
    snapshot: ReturnType<ReturnType<typeof createCircuitWorkspaceRuntime>['getSnapshot']>,
    connectionId: string,
  ) => snapshot.view.chargeFlows?.find(entry => entry.id === `flow-${connectionId}`)

  it('emits a signed charge flow on every power-loop wire of the series circuit', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const snapshot = runtime.getSnapshot()
    const flows = snapshot.view.chargeFlows ?? []

    /* Loop wires conn-n1-0 … conn-n5-0 all carry the 0.2 A main current along
       their path order; the voltmeter taps (conn-n4-1, conn-n5-1) stay silent. */
    expect(flows).toHaveLength(5)
    for (const flow of flows) {
      expect(Math.abs(flow.current), `${flow.id} carries the loop current`).toBeCloseTo(0.2, 6)
      expect(flow.path.length).toBeGreaterThanOrEqual(2)
    }
    /* Discharge leaves the battery positive terminal along the wire's path
       order (+0.2); the return leg conn-n5-0 is authored bat.− → r2.b, so its
       sign is − — beads travel r2.b → bat.−, back into the source. */
    expect(flowOf(snapshot, 'conn-n1-0')?.current).toBeCloseTo(0.2, 6)
    expect(flowOf(snapshot, 'conn-n5-0')?.current).toBeCloseTo(-0.2, 6)
    expect(flowOf(snapshot, 'conn-n4-1')).toBeUndefined()
    expect(flowOf(snapshot, 'conn-n5-1')).toBeUndefined()

    /* A flow path IS the wire's routed polyline, not a rebuilt geometry. */
    const wire = snapshot.view.circuitWires?.find(entry => entry.id === 'conn-n1-0')
    expect(flowOf(snapshot, 'conn-n1-0')?.path).toEqual(wire?.points)
  })

  it('splits the main current into branch flows in the parallel circuit', () => {
    const runtime = createCircuitWorkspaceRuntime(createParallelCircuitScene())
    const snapshot = runtime.getSnapshot()

    /* Main line I = 6/10 + 6/15 = 1.0 A; the r2 end-tap carries only I₂ = 0.4 A
       and the bottom rail returns it with the opposite sign. Taps between two
       junction terminals emit no flow. */
    expect(flowOf(snapshot, 'conn-n4-0')?.current).toBeCloseTo(1, 6)
    expect(flowOf(snapshot, 'conn-n4-2')?.current).toBeCloseTo(0.4, 6)
    expect(flowOf(snapshot, 'conn-n3-0')?.current).toBeCloseTo(-1, 6)
    expect(flowOf(snapshot, 'conn-n3-2')?.current).toBeCloseTo(-0.4, 6)
    expect(flowOf(snapshot, 'conn-n4-1')).toBeUndefined()
    expect(flowOf(snapshot, 'conn-n3-1')).toBeUndefined()
  })

  it('emits neither flow nor glow on an open loop', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const open = runtime.setChoice('switch:sw', 'open')

    expect(open.view.chargeFlows ?? []).toHaveLength(0)
    for (const visual of open.view.circuitComponents ?? []) {
      expect(visual.glow, `${visual.id} must not glow`).toBeUndefined()
    }
  })

  it('lights loads ∝ their dissipation and dims the bulb over the rheostat sweep', () => {
    const runtime = createCircuitWorkspaceRuntime(
      createRheostatCircuitScene({ fixedResistance: 8.3, sliderPosition: 0.3 }),
    )
    const start = runtime.getSnapshot()

    /* Slider 0.3 → rheostat 6 Ω vs bulb 8.3 Ω in series (P = I²R): the bulb
       is the brightest load, the rheostat a 6/8.3 share. */
    expect(componentVisual(start, 'r0').glow).toBeCloseTo(1, 6)
    expect(componentVisual(start, 'rv').glow).toBeCloseTo(6 / 8.3, 3)
    /* Source, meters and the switch never glow — they are not loads. */
    expect(componentVisual(start, 'bat').glow).toBeUndefined()
    expect(componentVisual(start, 'am').glow).toBeUndefined()
    expect(componentVisual(start, 'vm').glow).toBeUndefined()
    expect(componentVisual(start, 'sw').glow).toBeUndefined()

    /* End of the sweep: the 20 Ω rheostat out-dissipates the bulb → it dims. */
    const end = runtime.seek(8)
    expect(componentVisual(end, 'r0').glow).toBeCloseTo(8.3 / 20, 3)
    expect(componentVisual(end, 'rv').glow).toBeCloseTo(1, 6)
  })
})

describe('circuit charge-flow renderer', () => {
  /* A pass-through projection: scene units become 10 screen px each with the
     y flip, so bead positions read as scene geometry. */
  const projection: RendererProjection = {
    px: point => point.x * 10,
    py: point => -point.y * 10,
    sx: x => x / 10,
    sy: y => -y / 10,
    scale: 10,
    uid: 'test',
    path: () => '',
    highlighted: () => false,
  }

  /* The current layer is one dashed path per run, so there is no per-bead
     geometry to measure any more: what carries the physics is the dash phase,
     which the renderer advances every frame. */
  const flowOffset = (container: HTMLElement, id: string): number => {
    const node = container.querySelector(`[data-charge-flow="${id}"]`)
    return Number(node?.getAttribute('stroke-dashoffset') ?? Number.NaN)
  }

  it('draws a flowing current layer on every live wire, gated by the current observable', () => {
    const view = createCircuitWorkspaceRuntime(createSeriesCircuitScene()).getSnapshot().view
    const { container, unmount } = render(
      <svg>
        <CircuitRenderer view={view} projection={projection} time={0} />
      </svg>,
    )
    const flows = [...container.querySelectorAll('[data-charge-flow]')]
    expect(flows).toHaveLength(5)
    for (const flow of flows) {
      expect(flow.tagName.toLowerCase()).toBe('path')
      expect(flow.getAttribute('stroke-dasharray')).toBeTruthy()
    }
    unmount()

    const hidden = { ...view, visible: { ...view.visible, current: false } }
    const { container: off } = render(
      <svg>
        <CircuitRenderer view={hidden} projection={projection} time={0} />
      </svg>,
    )
    expect(off.querySelectorAll('[data-charge-flow]')).toHaveLength(0)
  })

  it('advances the dash pattern with the engine clock, direction following the current sign', () => {
    const view = createCircuitWorkspaceRuntime(createSeriesCircuitScene()).getSnapshot().view
    /* conn-n1-0 runs battery + → switch along +x first; its current is +. */
    const at0 = render(
      <svg>
        <CircuitRenderer view={view} projection={projection} time={0} />
      </svg>,
    )
    const at1 = render(
      <svg>
        <CircuitRenderer view={view} projection={projection} time={0.5} />
      </svg>,
    )
    /* 0.2 A at 110 px/s per amp = 22 px/s (inside the 8..90 clamp). Decreasing
       dashoffset walks the pattern forward along the path, so a run carrying
       positive current reads negative and a reversed run reads positive. */
    expect(flowOffset(at0.container, 'flow-conn-n1-0')).toBeCloseTo(0, 6)
    expect(flowOffset(at1.container, 'flow-conn-n1-0')).toBeCloseTo(-11, 6)
    expect(flowOffset(at1.container, 'flow-conn-n5-0')).toBeCloseTo(11, 6)
    at0.unmount()
    at1.unmount()
  })

  it('lights the dissipating loads with a radial halo, never the meters', () => {
    const view = createCircuitWorkspaceRuntime(createSeriesCircuitScene()).getSnapshot().view
    const { container } = render(
      <svg>
        <CircuitRenderer view={view} projection={projection} time={0} />
      </svg>,
    )
    const r1Glow = container.querySelector('[data-testid="glow-r1"]')
    const r2Glow = container.querySelector('[data-testid="glow-r2"]')
    expect(r1Glow).toBeTruthy()
    expect(r2Glow).toBeTruthy()
    /* R₂ (20 Ω) dissipates twice R₁'s power → the stronger halo. */
    expect(Number(r2Glow?.getAttribute('opacity')))
      .toBeGreaterThan(Number(r1Glow?.getAttribute('opacity')))
    expect(Number(r2Glow?.getAttribute('r')))
      .toBeGreaterThan(Number(r1Glow?.getAttribute('r')))
    for (const id of ['bat', 'sw', 'am', 'vm']) {
      expect(container.querySelector(`[data-testid="glow-${id}"]`)).toBeNull()
    }
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

    const inspectorToggle = screen.getByRole('button', { name: '检查器' })
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

    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
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

describe('circuit part sprites', () => {
  const projection: RendererProjection = {
    px: point => point.x * 10,
    py: point => -point.y * 10,
    sx: x => x / 10,
    sy: y => -y / 10,
    scale: 10,
    uid: 'test',
    path: () => '',
    highlighted: () => false,
  }

  const renderCircuit = (view: Parameters<typeof CircuitRenderer>[0]['view']) => render(
    <svg>
      <CircuitRenderer view={view} projection={projection} time={0} />
    </svg>,
  )

  it('draws the catalogued sprite for every wired part, mapped by kind', () => {
    const view = createCircuitWorkspaceRuntime(createSeriesCircuitScene()).getSnapshot().view
    const { container } = renderCircuit(view)

    /* The series circuit wires six parts; every kind has a catalog entry. */
    const hrefs = [...container.querySelectorAll('image[data-testid^="sprite-"]')]
      .map(node => node.getAttribute('href'))
      .sort()
    expect(hrefs).toEqual([
      '/physicsos/parts3d/studio-v2/meter.png',
      '/physicsos/parts3d/studio-v2/meter.png',
      '/physicsos/parts3d/studio-v2/resistor.png',
      '/physicsos/parts3d/studio-v2/resistor.png',
      '/physicsos/parts3d/studio-v2/switch-closed.png',
      '/physicsos/parts3d/studio-v3/battery-pack.png',
    ])
    /* The vector bodies are gone — symbols only come back as the fallback. */
    expect(container.querySelector('[data-component-id="r1"] rect')).toBeNull()
  })

  it('follows the switch state onto the sprite and keeps data-closed honest', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const open = runtime.setChoice('switch:sw', 'open')
    const { container } = renderCircuit(open.view)

    expect(container.querySelector('[data-testid="switch-sw"]')?.getAttribute('data-closed')).toBe('false')
    expect(container.querySelector('[data-testid="sprite-sw"]')?.getAttribute('href'))
      .toBe('/physicsos/parts3d/studio-v2/switch-open.png')
  })

  it('places the independent rheostat knob on the measured rail at each real position', () => {
    const runtime = createCircuitWorkspaceRuntime(createRheostatCircuitScene())
    for (const [position, railX] of [[0, 0.203777], [0.5, 0.499503], [1, 0.795229]] as const) {
      runtime.commitSliderPosition?.('rv', position)
      const { container, unmount } = renderCircuit(runtime.getSnapshot().view)
      const sprite = container.querySelector('[data-testid="sprite-rv"]')
      const knob = container.querySelector('[data-testid="slider-knob-rv"]')
      expect(knob?.getAttribute('href')).toBe('/physicsos/parts3d/studio-v2/rheostat-knob.png')
      if (sprite === null || knob === null) throw new Error('rheostat sprite missing')
      const x = Number(sprite.getAttribute('x')) + railX * Number(sprite.getAttribute('width'))
      const y = Number(sprite.getAttribute('y')) + 0.205962 * Number(sprite.getAttribute('height'))
      expect(Number(knob.getAttribute('x')) + Number(knob.getAttribute('width')) / 2).toBeCloseTo(x, 5)
      expect(Number(knob.getAttribute('y')) + Number(knob.getAttribute('height')) / 2).toBeCloseTo(y, 5)
      unmount()
    }
  })

  it('maps measured binding posts onto the actual component terminals before rotation', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const view = runtime.getSnapshot().view
    const { container } = renderCircuit(view)
    for (const component of view.circuitComponents ?? []) {
      const sprite = container.querySelector(`[data-testid="sprite-${component.id}"]`)
      if (sprite === null) throw new Error('component sprite missing')
      /* Check the sprite the renderer actually drew against its own measured
         posts. A fixed table drifts behind the catalog the moment a part
         changes rating — 6 V now draws the battery pack, not the v2 cell. */
      const href = sprite.getAttribute('href')
      const entry = Object.values(PARTS3D).find(part => part3dUrl(part) === href)
      if (entry === undefined || entry.terminals === undefined) {
        throw new Error(`no measured terminals for ${String(href)}`)
      }
      const { a, b } = entry.terminals
      const x = Number(sprite.getAttribute('x'))
      const y = Number(sprite.getAttribute('y'))
      const width = Number(sprite.getAttribute('width'))
      const height = Number(sprite.getAttribute('height'))
      /* A reversed asset (its photographed positive post on the right) turns
         in-plane about its own centre; its pixels are never mirrored. */
      const reversed = entry.terminalOrder === 'reversed'
      expect(sprite.getAttribute('transform'), component.id)
        .toBe(reversed ? `rotate(180 ${x + width / 2} ${y + height / 2})` : null)
      expect(x + (reversed ? 1 - a.x : a.x) * width, component.id)
        .toBeCloseTo(component.at.x * 10 + (reversed ? 7.5 : -7.5), 5)
      expect(x + (reversed ? 1 - b.x : b.x) * width, component.id)
        .toBeCloseTo(component.at.x * 10 + (reversed ? -7.5 : 7.5), 5)
      const anchor = reversed ? b : a
      expect(y + (reversed ? 1 - anchor.y : anchor.y) * height, component.id)
        .toBeCloseTo(-component.at.y * 10, 5)
      /* Both measured posts have to land on the wire. A three-quarter view puts
         the two ends of an apparatus at different heights and tilts the part
         off its terminals; the residual has to stay under a drawn pixel. */
      expect(Math.abs((b.y - a.y) * height), component.id).toBeLessThan(1)
      expect(sprite.parentElement?.parentElement?.getAttribute('transform'))
        .toBe(`rotate(${-component.rotation} ${component.at.x * 10} ${-component.at.y * 10})`)
    }
  })

  it('keeps the switch image fixed when the real switch changes state', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const { container, rerender } = renderCircuit(runtime.getSnapshot().view)
    const geometry = () => ['x', 'y', 'width', 'height'].map(attribute =>
      container.querySelector('[data-testid="sprite-sw"]')?.getAttribute(attribute),
    )
    const closed = geometry()
    const open = runtime.setChoice('switch:sw', 'open')
    rerender(<svg><CircuitRenderer view={open.view} projection={projection} time={0} /></svg>)
    expect(geometry()).toEqual(closed)
  })

  it('shows upstream meter readings on the dial and removes hidden readings', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const { container, rerender } = renderCircuit(runtime.getSnapshot().view)
    const reading = () => container.querySelector('[data-testid="dial-reading-am"]')?.textContent
    expect(reading()).toBe('0.2 A')
    const open = runtime.setChoice('switch:sw', 'open')
    rerender(<svg><CircuitRenderer view={open.view} projection={projection} time={0} /></svg>)
    expect(reading()).toBe('0 A')
    const hidden = { ...open.view, visible: { ...open.view.visible, current: false } }
    rerender(<svg><CircuitRenderer view={hidden} projection={projection} time={0} /></svg>)
    expect(container.querySelector('[data-testid="dial-reading-am"]')).toBeNull()
  })

  it.each([0, 90, 180, 270])('keeps complete meter readings on one upright dial line at %i degrees', (rotation) => {
    const initial = createCircuitWorkspaceRuntime(createRheostatCircuitScene()).getSnapshot().view
    const view = {
      ...initial,
      ...(initial.circuitComponents === undefined ? {} : {
        circuitComponents: initial.circuitComponents.map(component => ({ ...component, rotation })),
      }),
    }
    for (const scale of [14, 26, 40]) {
      const scaledProjection = {
        ...projection,
        scale,
        px: (point: ScenePoint) => point.x * scale,
        py: (point: ScenePoint) => -point.y * scale,
      }
      const { container, unmount } = render(
        <svg><CircuitRenderer view={view} projection={scaledProjection} time={0} /></svg>,
      )
      for (const [id, reading] of [['am', '0.6 A'], ['vm', '6 V']]) {
        const sprite = container.querySelector(`[data-testid="sprite-${id}"]`)
        const texts = sprite?.parentElement?.querySelectorAll('text')
        /* A second unit letter collides with the complete reading after the
           compact dial turns vertically. The reading already carries its unit. */
        expect(texts).toHaveLength(1)
        const text = texts?.[0]
        expect(text?.textContent).toBe(reading)
        expect(text?.getAttribute('transform'))
          .toBe(`rotate(${rotation} ${text?.getAttribute('x')} ${text?.getAttribute('y')})`)
      }
      unmount()
    }
  })

  it.each([['am', 'A', '0.2 A'], ['vm', 'V', '4 V']])('centres the vector meter fallback for %s without losing its reading', (id, letter, reading) => {
    const view = createCircuitWorkspaceRuntime(createSeriesCircuitScene()).getSnapshot().view
    const { container } = renderCircuit(view)
    const sprite = container.querySelector(`[data-testid="sprite-${id}"]`)
    if (sprite === null) throw new Error('meter sprite missing')
    fireEvent.error(sprite)
    const group = container.querySelector(`[data-component-id="${id}"]`)
    const face = group?.querySelector('circle')
    const text = group?.querySelector('text')
    expect(face).toBeTruthy()
    expect(text?.textContent).toBe(letter)
    expect(text?.getAttribute('x')).toBe(face?.getAttribute('cx'))
    expect(text?.getAttribute('y')).toBe(face?.getAttribute('cy'))
    expect(group?.textContent).toContain(reading)
    expect(container.querySelector(`[data-testid="sprite-${id}"]`)).toBeNull()
  })

  it('keeps a vertical branch’s values off the parallel meter’s body', () => {
    const view = createCircuitWorkspaceRuntime(createSeriesCircuitScene()).getSnapshot().view
    const { container } = renderCircuit(view)

    /* The series circuit wires the voltmeter across R₂, so the meter's body sits
       in the corridor beside the resistor. Its screen box comes from the image's
       own frame pushed through the group rotation the renderer emits. */
    const meter = container.querySelector('[data-testid="sprite-vm"]')
    if (meter === null) throw new Error('voltmeter sprite missing')
    const body = spriteScreenBox(meter)

    const r2Text = [...container.querySelectorAll('[data-component-id="r2"] text')]
    const rows = r2Text.filter(node => /^(20 Ω|I=|U=|P=)/.test(node.textContent ?? ''))
    expect(rows).toHaveLength(4)

    /* Every value grows away from the instrument: anchored on the far side of
       the meter and running further out, never printed across its face. */
    for (const row of rows) {
      expect(row.getAttribute('text-anchor')).toBe('end')
      expect(Number(row.getAttribute('x'))).toBeLessThanOrEqual(body.left)
    }
    /* The name keeps the values company rather than crossing into the corridor
       the meter occupies, and sits on its own line above them. */
    const name = r2Text.find(node => node.textContent === 'R₂')
    expect(name?.getAttribute('text-anchor')).toBe('end')
    expect(Number(name?.getAttribute('x'))).toBeLessThanOrEqual(body.left)
    const firstRowTop = Math.min(...rows.map(row => Number(row.getAttribute('y'))))
    expect(Number(name?.getAttribute('y'))).toBeLessThan(firstRowTop)
  })

  it('drops a component back to its vector symbol when the sprite fails to load', () => {
    const view = createCircuitWorkspaceRuntime(createSeriesCircuitScene()).getSnapshot().view
    const { container } = renderCircuit(view)

    const sprite = container.querySelector('[data-testid="sprite-r1"]')
    expect(sprite).toBeTruthy()
    if (sprite === null) throw new Error('sprite missing')
    fireEvent.error(sprite)

    /* The image is gone and the GB resistor box is drawn in its place. */
    expect(container.querySelector('[data-testid="sprite-r1"]')).toBeNull()
    expect(container.querySelector('[data-component-id="r1"] rect')).toBeTruthy()
    /* Other parts keep their sprites — the failure is per part id. */
    expect(container.querySelector('[data-testid="sprite-r2"]')).toBeTruthy()
  })

  it('keeps the static catalog in parity with the shipped manifest', () => {
    /* new URL(rel, import.meta.url) is rewritten to a dev-server asset URL by
       vite, so the path derives from the module file location instead. */
    const manifestPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../apps/web/public/physicsos/parts3d/manifest.json',
    )
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      parts: {
        id: string
        file: string
        pixels: string
        solidBox: { left: number; top: number; width: number; height: number }
        axis: 'axial' | 'base'
        terminalOrder?: 'reversed'
        terminals?: { a: ScenePoint; b: ScenePoint }
        sliderRail?: { start: ScenePoint; end: ScenePoint }
        dial?: { pivot: ScenePoint; radius: number }
      }[]
    }

    /* The manifest also lists the mechanics batch (file 'mechanics/…'); the
       circuit catalog holds only wired parts — those have their own
       manifest+catalog parity in mechanics-parts3d. */
    const circuitParts = manifest.parts.filter(part => !part.file.startsWith('mechanics/'))
    expect(Object.keys(PARTS3D).sort()).toEqual(circuitParts.map(part => part.id).sort())
    for (const entry of circuitParts) {
      const catalog = PARTS3D[entry.id]
      const [w, h] = entry.pixels.split('x').map(Number)
      expect(catalog?.file, entry.id).toBe(entry.file)
      expect(catalog?.pixels, entry.id).toEqual({ w, h })
      expect(catalog?.solidBox, entry.id).toEqual(entry.solidBox)
      expect(catalog?.axis, entry.id).toBe(entry.axis)
      expect(catalog?.terminalOrder, entry.id).toBe(entry.terminalOrder)
      expect(catalog?.terminals, entry.id).toEqual(entry.terminals)
      expect(catalog?.sliderRail, entry.id).toEqual(entry.sliderRail)
      expect(catalog?.dial, entry.id).toEqual(entry.dial)
      const png = readFileSync(resolve(dirname(manifestPath), entry.file))
      expect(png.subarray(1, 4).toString(), entry.id).toBe('PNG')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], entry.id).toEqual([w, h])
    }
  })
})

describe('circuit component drag', () => {
  const projection: RendererProjection = {
    px: point => point.x * 10,
    py: point => -point.y * 10,
    sx: x => x / 10,
    sy: y => -y / 10,
    scale: 10,
    uid: 'test',
    path: () => '',
    highlighted: () => false,
  }
  const runtimeOf = () => createCircuitWorkspaceRuntime(createSeriesCircuitScene())

  it('previews a placement without committing a revision', () => {
    const runtime = runtimeOf()
    const before = runtime.getSnapshot()
    const at0 = componentVisual(before, 'r1').at

    const preview = runtime.previewComponentPlacement?.('r1', { x: at0.x + 2, y: at0.y + 1 })
    if (preview === undefined) throw new Error('placement channel missing')

    expect(componentVisual(preview, 'r1').at).toEqual({ x: at0.x + 2, y: at0.y + 1 })
    /* Preview is paint only — no revision, no event, physics untouched. */
    expect(preview.sceneRevision).toBe(before.sceneRevision)
  })

  it('pins the viewport while the drag is in flight', () => {
    const runtime = runtimeOf()
    const before = runtime.getSnapshot()

    /* Drag far outside the drawn frame: auto-fit would blow the canvas up. */
    const preview = runtime.previewComponentPlacement?.('r1', { x: 60, y: 60 })

    expect(preview?.view.origin).toEqual(before.view.origin)
    expect(preview?.view.extent).toEqual(before.view.extent)
  })

  it('snaps the drop to the half-grid like the rest of the schematic', () => {
    const runtime = runtimeOf()
    const at0 = componentVisual(runtime.getSnapshot(), 'r1').at
    const committed = runtime.commitComponentPlacement?.('r1', { x: at0.x + 2.31, y: at0.y + 0.87 })
    const at1 = componentVisual(committed ?? runtime.getSnapshot(), 'r1').at
    expect(at1.x).toBeCloseTo(at0.x + 2.5)
    expect(at1.y).toBeCloseTo(at0.y + 1)
  })

  it('commits the drop as a placement command and re-routes the touched wire', () => {
    const runtime = runtimeOf()
    const before = runtime.getSnapshot()
    const at0 = componentVisual(before, 'r1').at
    /* r1 sits rotated 180° — its `a` terminal is on the +x side at +HALF. */
    const wireBefore = before.view.circuitWires?.find(wire =>
      wire.points.some(
        point => Math.abs(point.x - (at0.x + 0.75)) < 1e-6 && Math.abs(point.y - at0.y) < 1e-6,
      ),
    )
    expect(wireBefore).toBeDefined()

    const committed = runtime.commitComponentPlacement?.('r1', { x: at0.x + 2, y: at0.y + 1 })
    if (committed === undefined) throw new Error('placement channel missing')

    expect(committed.sceneRevision).toBe(before.sceneRevision + 1)
    const at1 = componentVisual(committed, 'r1').at
    expect(at1).toEqual({ x: at0.x + 2, y: at0.y + 1 })
    const wireAfter = committed.view.circuitWires?.find(wire => wire.id === wireBefore?.id)
    expect(
      wireAfter?.points.some(
        point => Math.abs(point.x - (at1.x + 0.75)) < 1e-6 && Math.abs(point.y - at1.y) < 1e-6,
      ),
    ).toBe(true)
    /* A cosmetic move must not rewind the sweep or pause playback. */
    expect(committed.clock.time).toBe(before.clock.time)
  })

  it('drives a drag through pointer events on the component group', () => {
    const runtime = runtimeOf()
    let view = runtime.getSnapshot().view
    const channel: ComponentDragChannel = {
      preview: (id, at) => {
        const next = runtime.previewComponentPlacement?.(id, at)
        if (next !== undefined) view = next.view
      },
      commit: (id, at) => {
        const next = runtime.commitComponentPlacement?.(id, at)
        if (next !== undefined) view = next.view
      },
      cancel: () => {
        const next = runtime.cancelComponentPlacement?.()
        if (next !== undefined) view = next.view
      },
    }
    const { container } = render(
      <svg viewBox="0 0 800 500">
        <CircuitRenderer view={view} projection={projection} time={0} componentDrag={channel} />
      </svg>,
    )
    const svg = container.querySelector('svg')
    if (svg === null) throw new Error('svg missing')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) },
    )
    Object.defineProperty(svg, 'viewBox', {
      value: { baseVal: { x: 0, y: 0, width: 800, height: 500 } },
    })

    const group = container.querySelector('[data-component-id="r1"]')
    if (group === null) throw new Error('component group missing')
    /* The sprite ignores pointer events; the drag still lands on the group's
       transparent hit rect. */
    expect(group.querySelector('rect')).toBeTruthy()

    const at0 = view.circuitComponents?.find(entry => entry.id === 'r1')?.at
    if (at0 === undefined) throw new Error('r1 visual missing')
    fireEvent.pointerDown(group, { button: 0, pointerId: 1, clientX: at0.x * 10, clientY: -at0.y * 10 })
    fireEvent.pointerMove(group, { pointerId: 1, clientX: at0.x * 10 + 100, clientY: -at0.y * 10 })
    fireEvent.pointerUp(group, { pointerId: 1, clientX: at0.x * 10 + 100, clientY: -at0.y * 10 })

    const moved = view.circuitComponents?.find(entry => entry.id === 'r1')?.at
    expect(moved?.x).toBeCloseTo(at0.x + 10)
    expect(moved?.y).toBeCloseTo(at0.y)
    /* The drop committed a real revision. */
    expect(runtime.getSnapshot().sceneRevision).toBe(1)
  })

  it('treats a sub-threshold press as a click — no preview, no revision', () => {
    const runtime = runtimeOf()
    const revision0 = runtime.getSnapshot().sceneRevision
    const view = runtime.getSnapshot().view
    const channel: ComponentDragChannel = {
      preview: () => { throw new Error('preview fired on a click') },
      commit: () => { throw new Error('commit fired on a click') },
      cancel: () => { throw new Error('cancel fired on a click') },
    }
    const { container } = render(
      <svg viewBox="0 0 800 500">
        <CircuitRenderer view={view} projection={projection} time={0} componentDrag={channel} />
      </svg>,
    )
    const svg = container.querySelector('svg')
    if (svg === null) throw new Error('svg missing')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) },
    )
    Object.defineProperty(svg, 'viewBox', {
      value: { baseVal: { x: 0, y: 0, width: 800, height: 500 } },
    })
    const group = container.querySelector('[data-component-id="r1"]')
    if (group === null) throw new Error('component group missing')
    const at0 = view.circuitComponents?.find(entry => entry.id === 'r1')?.at
    if (at0 === undefined) throw new Error('r1 visual missing')
    fireEvent.pointerDown(group, { button: 0, pointerId: 1, clientX: at0.x * 10, clientY: -at0.y * 10 })
    /* ~0.2 scene unit = 2 px at scale 10 — under the 3 px drag threshold. */
    fireEvent.pointerMove(group, { pointerId: 1, clientX: at0.x * 10 + 2, clientY: -at0.y * 10 })
    fireEvent.pointerUp(group, { pointerId: 1, clientX: at0.x * 10 + 2, clientY: -at0.y * 10 })
    expect(runtime.getSnapshot().sceneRevision).toBe(revision0)
  })

  it('snaps back when the pointer cancels mid-drag', () => {
    const runtime = runtimeOf()
    const at0 = componentVisual(runtime.getSnapshot(), 'r1').at

    runtime.previewComponentPlacement?.('r1', { x: at0.x + 4, y: at0.y + 3 })
    expect(componentVisual(runtime.getSnapshot(), 'r1').at.x).toBeCloseTo(at0.x + 4)

    const cancelled = runtime.cancelComponentPlacement?.()
    expect(componentVisual(cancelled ?? runtime.getSnapshot(), 'r1').at).toEqual(at0)
    expect(runtime.getSnapshot().sceneRevision).toBe(0)
  })
})

describe('circuit direct controls', () => {
  const projection: RendererProjection = {
    px: point => point.x * 10,
    py: point => -point.y * 10,
    sx: x => x / 10,
    sy: y => -y / 10,
    scale: 10,
    uid: 'test',
    path: () => '',
    highlighted: () => false,
  }
  const seriesRuntime = () => createCircuitWorkspaceRuntime(createSeriesCircuitScene())
  const rheostatRuntime = () => createCircuitWorkspaceRuntime(createRheostatCircuitScene())

  it('toggles the switch through the control channel — open loop reads zero', () => {
    const runtime = seriesRuntime()
    expect(componentVisual(runtime.getSnapshot(), 'am').reading).toBe('0.2 A')

    const opened = runtime.setSwitchState?.('sw', 'open')
    if (opened === undefined) throw new Error('control channel missing')
    expect(componentVisual(opened, 'sw').closed).toBe(false)
    expect(componentVisual(opened, 'am').reading).toBe('0 A')

    const reclosed = runtime.setSwitchState?.('sw', 'closed')
    expect(componentVisual(reclosed ?? runtime.getSnapshot(), 'am').reading).toBe('0.2 A')
  })

  it('previews the rheostat slider live and commits the real position', () => {
    const runtime = rheostatRuntime()
    const before = runtime.getSnapshot()
    /* Position 0 → the rheostat is a wire: 6 V / 10 Ω = 0.6 A. */
    expect(componentVisual(before, 'am').reading).toBe('0.6 A')

    const preview = runtime.previewSliderPosition?.('rv', 1)
    if (preview === undefined) throw new Error('slider channel missing')
    /* Paint only — no revision — but the readouts already follow the preview. */
    expect(preview.sceneRevision).toBe(before.sceneRevision)
    expect(componentVisual(preview, 'rv').sliderPosition).toBe(1)
    expect(componentVisual(preview, 'am').reading).toBe('0.2 A')

    const committed = runtime.commitSliderPosition?.('rv', 0.5)
    if (committed === undefined) throw new Error('slider channel missing')
    expect(committed.sceneRevision).toBe(before.sceneRevision + 1)
    expect(componentVisual(committed, 'rv').sliderPosition).toBe(0.5)
    expect(componentVisual(committed, 'am').reading).toBe('0.3 A')
  })

  it('clamps the slider preview and commit to 0..1', () => {
    const runtime = rheostatRuntime()
    const over = runtime.previewSliderPosition?.('rv', 1.6)
    expect(componentVisual(over ?? runtime.getSnapshot(), 'rv').sliderPosition).toBe(1)
    const committed = runtime.commitSliderPosition?.('rv', -0.4)
    expect(componentVisual(committed ?? runtime.getSnapshot(), 'rv').sliderPosition).toBe(0)
  })

  it('a cancelled slider gesture restores the committed position', () => {
    const runtime = rheostatRuntime()
    runtime.previewSliderPosition?.('rv', 1)
    const cancelled = runtime.cancelSliderPosition?.()
    expect(componentVisual(cancelled ?? runtime.getSnapshot(), 'rv').sliderPosition).toBe(0)
    expect(runtime.getSnapshot().sceneRevision).toBe(0)
  })

  /* The DOM gesture half: channels bound to a real runtime so the pointer path
     lands on real engine state. */
  const wireControl = (runtime: ReturnType<typeof seriesRuntime>) => {
    let view = runtime.getSnapshot().view
    const control: ComponentControlChannel = {
      setSwitch: (id, state) => {
        const next = runtime.setSwitchState?.(id, state)
        if (next !== undefined) view = next.view
      },
      previewSlider: (id, position) => {
        const next = runtime.previewSliderPosition?.(id, position)
        if (next !== undefined) view = next.view
      },
      commitSlider: (id, position) => {
        const next = runtime.commitSliderPosition?.(id, position)
        if (next !== undefined) view = next.view
      },
      cancelSlider: () => {
        const next = runtime.cancelSliderPosition?.()
        if (next !== undefined) view = next.view
      },
    }
    const drag: ComponentDragChannel = {
      preview: (id, at) => {
        const next = runtime.previewComponentPlacement?.(id, at)
        if (next !== undefined) view = next.view
      },
      commit: (id, at) => {
        const next = runtime.commitComponentPlacement?.(id, at)
        if (next !== undefined) view = next.view
      },
      cancel: () => {
        const next = runtime.cancelComponentPlacement?.()
        if (next !== undefined) view = next.view
      },
    }
    return { control, drag, getView: () => view }
  }

  const mountCircuit = (
    runtime: ReturnType<typeof seriesRuntime>,
    channels: { control: ComponentControlChannel; drag: ComponentDragChannel },
  ) => {
    const { container } = render(
      <svg viewBox="0 0 800 500">
        <CircuitRenderer
          view={runtime.getSnapshot().view}
          projection={projection}
          time={0}
          componentDrag={channels.drag}
          componentControl={channels.control}
        />
      </svg>,
    )
    const svg = container.querySelector('svg')
    if (svg === null) throw new Error('svg missing')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) },
    )
    Object.defineProperty(svg, 'viewBox', {
      value: { baseVal: { x: 0, y: 0, width: 800, height: 500 } },
    })
    return container
  }

  const clientPointOf = (component: { at: ScenePoint; rotation: number }, localX: number, localY = 0) => {
    const rad = (component.rotation * Math.PI) / 180
    const x = component.at.x + localX * Math.cos(rad) - localY * Math.sin(rad)
    const y = component.at.y + localX * Math.sin(rad) + localY * Math.cos(rad)
    return { clientX: x * 10, clientY: -y * 10 }
  }

  const measuredKnobPoint = (component: { at: ScenePoint; rotation: number }, position: number) => {
    const x = -0.75 + 1.5 * (0.203777 + position * 0.591452 - 0.094433) / 0.81014
    const y = 1.5 * (210 / 574) * (0.506775 - 0.205962) / 0.81014
    return clientPointOf(component, x, y)
  }

  it('a click on the switch flips it; a drag does not', () => {
    const runtime = seriesRuntime()
    const channels = wireControl(runtime)
    const container = mountCircuit(runtime, channels)
    const group = container.querySelector('[data-component-id="sw"]')
    if (group === null) throw new Error('switch group missing')
    const sw = componentVisual(runtime.getSnapshot(), 'sw')

    /* Press and release in place: a bench click on the knife switch. */
    const here = clientPointOf(sw, 0)
    fireEvent.pointerDown(group, { button: 0, pointerId: 1, ...here })
    fireEvent.pointerUp(group, { pointerId: 1, ...here })
    expect(componentVisual(runtime.getSnapshot(), 'sw').closed).toBe(false)
    expect(componentVisual(runtime.getSnapshot(), 'am').reading).toBe('0 A')

    /* Now grab and haul it 10 scene units: the part moves, state untouched. */
    fireEvent.pointerDown(group, { button: 0, pointerId: 2, ...here })
    fireEvent.pointerMove(group, { pointerId: 2, clientX: here.clientX + 100, clientY: here.clientY })
    fireEvent.pointerUp(group, { pointerId: 2, clientX: here.clientX + 100, clientY: here.clientY })
    expect(componentVisual(runtime.getSnapshot(), 'sw').closed).toBe(false)
    expect(componentVisual(runtime.getSnapshot(), 'sw').at.x).not.toBeCloseTo(sw.at.x)
  })

  it('drives the rheostat knob through pointer events on the canvas', () => {
    const runtime = rheostatRuntime()
    const channels = wireControl(runtime)
    const container = mountCircuit(runtime, channels)
    const group = container.querySelector('[data-component-id="rv"]')
    if (group === null) throw new Error('rheostat group missing')
    const rv = componentVisual(runtime.getSnapshot(), 'rv')
    const knob = measuredKnobPoint(rv, rv.sliderPosition ?? 0)

    fireEvent.pointerDown(group, { button: 0, pointerId: 1, ...knob })
    const midpoint = measuredKnobPoint(rv, 0.5)
    fireEvent.pointerMove(group, { pointerId: 1, ...midpoint })
    expect(channels.getView().circuitComponents?.find(entry => entry.id === 'rv')?.sliderPosition)
      .toBeCloseTo(0.5)
    const toEnd = measuredKnobPoint(rv, 1.1)
    fireEvent.pointerMove(group, { pointerId: 1, ...toEnd })
    /* Preview already solves the previewed position — live bench feedback. */
    const previewed = channels.getView().circuitComponents?.find(entry => entry.id === 'rv')
    const previewedMeter = channels.getView().circuitComponents?.find(entry => entry.id === 'am')
    if (previewed === undefined || previewedMeter === undefined) throw new Error('preview visual missing')
    expect(previewed.sliderPosition).toBe(1)
    expect(previewedMeter.reading).toBe('0.2 A')
    fireEvent.pointerUp(group, { pointerId: 1, ...toEnd })

    const committed = runtime.getSnapshot()
    expect(componentVisual(committed, 'rv').sliderPosition).toBe(1)
    expect(componentVisual(committed, 'am').reading).toBe('0.2 A')
  })

  it('keeps the measured slider operable when only its independent knob image fails', () => {
    const runtime = rheostatRuntime()
    const channels = wireControl(runtime)
    const container = mountCircuit(runtime, channels)
    const group = container.querySelector('[data-component-id="rv"]')
    const knob = container.querySelector('[data-testid="slider-knob-rv"]')
    expect(knob).toBeTruthy()
    if (group === null || knob === null) throw new Error('knob missing')
    fireEvent.error(knob)
    expect(container.querySelector('[data-testid="sprite-rv"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="slider-knob-rv"]')).toBeNull()
    expect(container.querySelector('[data-testid="slider-rv"] path')).toBeTruthy()
    expect(screen.getByRole('slider')).toBeTruthy()
    const rv = componentVisual(runtime.getSnapshot(), 'rv')
    fireEvent.pointerDown(group, { button: 0, pointerId: 1, ...measuredKnobPoint(rv, 0) })
    fireEvent.pointerMove(group, { pointerId: 1, ...measuredKnobPoint(rv, 1.1) })
    fireEvent.pointerUp(group, { pointerId: 1, ...measuredKnobPoint(rv, 1.1) })
    expect(componentVisual(runtime.getSnapshot(), 'rv').sliderPosition).toBe(1)
    expect(componentVisual(runtime.getSnapshot(), 'rv').at).toEqual(rv.at)
    expect(componentVisual(runtime.getSnapshot(), 'am').reading).toBe('0.2 A')
  })

  it('drags the rheostat body below the knob without changing the slider', () => {
    const runtime = rheostatRuntime()
    const channels = wireControl(runtime)
    const container = mountCircuit(runtime, channels)
    const group = container.querySelector('[data-component-id="rv"]')
    if (group === null) throw new Error('rheostat missing')
    const rv = componentVisual(runtime.getSnapshot(), 'rv')
    const railX = -0.75 + 1.5 * (0.203777 - 0.094433) / 0.81014
    const body = clientPointOf(rv, railX, -0.25)
    fireEvent.pointerDown(group, { button: 0, pointerId: 1, ...body })
    fireEvent.pointerMove(group, { pointerId: 1, clientX: body.clientX + 40, clientY: body.clientY + 40 })
    fireEvent.pointerUp(group, { pointerId: 1, clientX: body.clientX + 40, clientY: body.clientY + 40 })
    expect(componentVisual(runtime.getSnapshot(), 'rv').at).not.toEqual(rv.at)
    expect(componentVisual(runtime.getSnapshot(), 'rv').sliderPosition).toBe(0)
  })

  it('a press on the rheostat body away from the knob still drags the part', () => {
    const runtime = rheostatRuntime()
    const channels = wireControl(runtime)
    const container = mountCircuit(runtime, channels)
    const group = container.querySelector('[data-component-id="rv"]')
    if (group === null) throw new Error('rheostat group missing')
    const rv = componentVisual(runtime.getSnapshot(), 'rv')
    /* Far from the knob column: this is a body grab, not a slider grab. */
    const edge = clientPointOf(rv, 0.75)
    fireEvent.pointerDown(group, { button: 0, pointerId: 1, ...edge })
    fireEvent.pointerMove(group, { pointerId: 1, clientX: edge.clientX + 40, clientY: edge.clientY + 40 })
    fireEvent.pointerUp(group, { pointerId: 1, clientX: edge.clientX + 40, clientY: edge.clientY + 40 })
    const after = runtime.getSnapshot()
    expect(componentVisual(after, 'rv').at.y).not.toBeCloseTo(rv.at.y)
    /* The slider itself was not re-committed. */
    expect(componentVisual(after, 'rv').sliderPosition).toBe(rv.sliderPosition)
  })

  it('operates the controls from the keyboard', () => {
    const runtime = rheostatRuntime()
    const channels = wireControl(runtime)
    const container = mountCircuit(runtime, channels)

    const switchHandle = container.querySelector('[data-control="switch-sw"]')
    if (switchHandle === null) throw new Error('switch handle missing')
    fireEvent.keyDown(switchHandle, { key: 'Enter' })
    expect(componentVisual(runtime.getSnapshot(), 'sw').closed).toBe(false)

    const sliderHandle = container.querySelector('[data-control="slider-rv"]')
    if (sliderHandle === null) throw new Error('slider handle missing')
    fireEvent.keyDown(sliderHandle, { key: 'ArrowRight' })
    expect(componentVisual(runtime.getSnapshot(), 'rv').sliderPosition).toBeCloseTo(0.05)
    fireEvent.keyDown(sliderHandle, { key: 'ArrowLeft' })
    expect(componentVisual(runtime.getSnapshot(), 'rv').sliderPosition).toBeCloseTo(0)
    fireEvent.keyDown(sliderHandle, { key: 'End' })
    expect(componentVisual(runtime.getSnapshot(), 'rv').sliderPosition).toBe(1)
  })
})
