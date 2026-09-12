// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBarMotionScene,
  createDoubleBarRailScene,
  createFluxChangeScene,
} from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { experimentSelfChecksOf } from '../src/client/physics/experiment-self-checks.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { InductionRenderer } from '../src/client/physics/induction-renderer.tsx'
import type { RendererProjection } from '../src/client/physics/renderer-registry.tsx'
import { createInductionWorkspaceRuntime } from '../src/client/physics/induction-workspace-runtime.ts'
import { physicsAgentContext } from '../src/client/physics/physics-agent.ts'
import { tutorScriptOf } from '../src/client/physics/physics-tutor.ts'
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

type InductionSnapshot = ReturnType<ReturnType<typeof createInductionWorkspaceRuntime>['getSnapshot']>

const derivedValue = (snapshot: InductionSnapshot, label: string): string => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('induction domain routing', () => {
  it('classifies both induction rigs as the induction domain', () => {
    expect(domainOfScene(createBarMotionScene())).toBe('induction')
    expect(domainOfScene(createFluxChangeScene())).toBe('induction')
  })

  it('creates both templates instead of sitting as comingSoon', () => {
    for (const id of ['induction-bar-motion', 'induction-flux-change']) {
      const template = findExperimentTemplate(id)
      expect(template?.comingSoon).toBeUndefined()
      expect(template?.domain).toBe('induction')
      expect(domainOfScene(sceneOf(id).scene)).toBe('induction')
    }
  })
})

describe('induction workspace runtime', () => {
  it('solves the textbook bar rig: B=0.5 T, L=20 cm, v=2 m/s → E=0.2 V, I=0.04 A', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('induction')
    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '感应电动势 E')).toBe('0.2')
    expect(derivedValue(snapshot, '感应电流 I')).toBe('0.04')
    expect(derivedValue(snapshot, '回路电阻 R')).toBe('5')
    expect(derivedValue(snapshot, '棒长 L（导轨间距）')).toBe('20')
    expect(derivedValue(snapshot, '棒速 v')).toBe('2')

    /* The engine's three law checks all pass. */
    const lawChecks = snapshot.verification.filter(check =>
      ['faraday_law', 'lenz_direction', 'ohm_law_loop'].includes(check.id),
    )
    expect(lawChecks.map(check => check.id).sort()).toEqual(['faraday_law', 'lenz_direction', 'ohm_law_loop'])
    expect(lawChecks.every(check => check.status === 'passed')).toBe(true)

    /* Visual model: the field box, the rod and the current arrow are drawn. */
    expect(snapshot.view.inductionField).toBeDefined()
    expect(snapshot.view.inductionBar?.id).toBe('induction-bench-1.bar')
    expect(snapshot.view.inductionCurrent?.sign).toBe(1)
    expect(snapshot.view.domain).toBe('induction')

    /* The chart is the constant E–t line; the table carries the rig numbers. */
    expect(snapshot.charts[0]?.id).toBe('induction-emf')
    expect(snapshot.table.columns).toEqual(['B / T', 'L / cm', 'v / (m/s)', 'R / Ω', 'E / V', 'I / A'])
    expect(snapshot.table.rows[0]?.values).toEqual(['0.5', '20', '2', '5', '0.2', '0.04'])
  })

  it('solves the flux rig with the Lenz sign: dΦ/dt=+0.05 Wb/s → E=−0.05 V', () => {
    const runtime = createInductionWorkspaceRuntime(createFluxChangeScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '感应电动势 E')).toBe('-0.05')
    expect(derivedValue(snapshot, '感应电流 I')).toBe('-0.025')
    expect(derivedValue(snapshot, '磁通量 Φ')).toBe('0.002')
    expect(snapshot.view.inductionCoil).toBeDefined()
    expect(snapshot.view.inductionCurrent?.sign).toBe(-1)
    expect(snapshot.table.columns).toEqual(['B / T', 'S / cm²', 'dΦ/dt / (Wb/s)', 'R / Ω', 'E / V', 'I / A'])
  })

  it('doubles the EMF through a real velocity edit and bumps the revision', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const edited = runtime.editParameter('bar-velocity', 4)
    expect(edited.sceneRevision).toBe(1)
    expect(edited.status).toBe('verified')
    expect(derivedValue(edited, '感应电动势 E')).toBe('0.4')
    expect(derivedValue(edited, '感应电流 I')).toBe('0.08')
  })

  it('reverses the Lenz direction when the velocity goes negative', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const reversed = runtime.editParameter('bar-velocity', -2)
    expect(derivedValue(reversed, '感应电动势 E')).toBe('-0.2')
    expect(reversed.view.inductionCurrent?.sign).toBe(-1)
    expect(derivedValue(reversed, '感应方向')).toContain('负')
  })

  it('follows I = E/R when the loop resistance is edited', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const edited = runtime.editParameter('loop-resistance', 10)
    expect(derivedValue(edited, '感应电动势 E')).toBe('0.2')
    expect(derivedValue(edited, '感应电流 I')).toBe('0.02')
  })

  it('gives zero EMF at v = 0 and reports no current direction', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const stopped = runtime.editParameter('bar-velocity', 0)
    expect(derivedValue(stopped, '感应电动势 E')).toBe('0')
    expect(derivedValue(stopped, '感应电流 I')).toBe('0')
    expect(derivedValue(stopped, '感应方向')).toContain('静止')
  })

  it('rejects a zero field edit instead of silently solving a zero-field world', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const rejected = runtime.editParameter('field-strength', 0)
    /* The scene command is refused (B must stay > 0), so the revision does not
       advance and the EMF keeps its last verified value — the runtime never
       renders a zero-field world the engine cannot solve. */
    expect(rejected.sceneRevision).toBe(0)
    expect(rejected.status).toBe('verified')
    expect(derivedValue(rejected, '感应电动势 E')).toBe('0.2')
  })

  it('animates the rod sweep and stops at the end of the run', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    runtime.setRunning(true)
    const mid = runtime.advance(1)
    expect(mid.clock.running).toBe(true)
    const end = runtime.advance(10)
    expect(end.clock.running).toBe(false)
    expect(end.clock.time).toBe(end.clock.total)
  })

  it('emits a closed charge-flow loop carrying the engine signed current', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const snapshot = runtime.getSnapshot()

    const flows = snapshot.view.chargeFlows ?? []
    expect(flows).toHaveLength(1)
    const flow = flows[0]!
    /* The loop closes: resistor wire → bottom rail → rod → top rail. */
    expect(flow.path.length).toBe(5)
    const first = flow.path[0]!
    const last = flow.path[flow.path.length - 1]!
    expect(last).toEqual(first)
    /* The engine's I = E/R = 0.04 A, sign matching the lenz arrow (+1). */
    expect(flow.current).toBeCloseTo(0.04, 6)
    expect(Math.sign(flow.current)).toBe(snapshot.view.inductionCurrent?.sign)
    /* The loop's right side is the rod at its engine-published position. */
    const rod = snapshot.view.inductionBar
    expect(rod).toBeDefined()
    expect(flow.path[1]).toEqual({ x: rod!.at.x, y: -rod!.length / 2 })
    expect(flow.path[2]).toEqual({ x: rod!.at.x, y: rod!.length / 2 })
  })

  it('reverses the charge-flow sign with the Lenz direction', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const reversed = runtime.editParameter('bar-velocity', -2)
    const flow = reversed.view.chargeFlows?.[0]
    expect(flow?.current).toBeCloseTo(-0.04, 6)
    expect(Math.sign(flow?.current ?? 0)).toBe(reversed.view.inductionCurrent?.sign)
  })

  it('emits no charge flow while the bar stands still', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const stopped = runtime.editParameter('bar-velocity', 0)
    expect(stopped.view.chargeFlows ?? []).toHaveLength(0)
  })

  it('wraps the flux rig coil in a closed charge-flow ring', () => {
    const runtime = createInductionWorkspaceRuntime(createFluxChangeScene())
    const snapshot = runtime.getSnapshot()

    const flow = snapshot.view.chargeFlows?.[0]
    expect(flow).toBeDefined()
    expect(flow!.path.length).toBeGreaterThan(4)
    /* A closed ring: the last point repeats the first. */
    expect(flow!.path[flow!.path.length - 1]).toEqual(flow!.path[0])
    /* I = E/R = −0.05 V / 2 Ω = −0.025 A — the engine's signed value. */
    expect(flow!.current).toBeCloseTo(-0.025, 6)
    expect(Math.sign(flow!.current)).toBe(snapshot.view.inductionCurrent?.sign)
  })

  it('flows charge around the two-bar window with the engine loop current', () => {
    const runtime = createInductionWorkspaceRuntime(createDoubleBarRailScene())
    const snapshot = runtime.getSnapshot()

    const flow = snapshot.view.chargeFlows?.[0]
    expect(flow).toBeDefined()
    expect(flow!.path.length).toBe(5)
    expect(flow!.path[flow!.path.length - 1]).toEqual(flow!.path[0])
    /* I₀ = BL(v₁−v₂)/R = 0.5·0.2·2/0.1 = 2 A. */
    expect(flow!.current).toBeCloseTo(2, 6)
    /* The loop spans the gap between the bars (bar2 at −20 cm, bar1 at +20 cm). */
    const xs = flow!.path.map(point => point.x)
    expect(Math.min(...xs)).toBeCloseTo(-20, 6)
    expect(Math.max(...xs)).toBeCloseTo(20, 6)
  })
})

describe('induction tutor and self-checks', () => {
  it('teaches the cutting rig from the rod being drawn', () => {
    const context = physicsAgentContext(
      createInductionWorkspaceRuntime(createBarMotionScene()).getSnapshot(),
    )
    expect(context.domain).toBe('induction')
    const script = tutorScriptOf(context)
    expect(script?.id).toBe('induction-bar-motion')
    expect(script?.topic).toBe('导体棒切割磁感线')
    expect(script?.question).toContain('发电')
  })

  it('teaches the flux rig when no rod is drawn', () => {
    const context = physicsAgentContext(
      createInductionWorkspaceRuntime(createFluxChangeScene()).getSnapshot(),
    )
    const script = tutorScriptOf(context)
    expect(script?.id).toBe('induction-flux-change')
    expect(script?.topic).toBe('磁通量变化产生感应电动势')
    expect(script?.question).toContain('电流表')
  })

  it('resolves the self-check topic from what the canvas draws', () => {
    const barSet = experimentSelfChecksOf(physicsAgentContext(
      createInductionWorkspaceRuntime(createBarMotionScene()).getSnapshot(),
    ))
    expect(barSet?.id).toBe('induction-bar-motion')
    expect(barSet?.knowledge).toEqual(['em-motional-emf', 'em-induction'])

    const coilSet = experimentSelfChecksOf(physicsAgentContext(
      createInductionWorkspaceRuntime(createFluxChangeScene()).getSnapshot(),
    ))
    expect(coilSet?.id).toBe('induction-flux-change')
    expect(coilSet?.knowledge).toEqual(['em-faraday-law', 'em-lenz-law'])
  })
})

describe('induction Lab surface', () => {
  it('mounts a verified induction workspace with the rod rig drawn', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('lab', sceneOf('induction-bar-motion'))
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(container.querySelector('[data-physicsos-domain="induction"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    /* The readout overlay carries the engine's verified numbers. */
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText.join(' ')).toContain('E = BLv')
    expect(svgText.join(' ')).toContain('0.2')
  })
})

describe('induction charge-flow renderer', () => {
  /* A pass-through projection: scene units become screen px unchanged except
     for the y flip, so dot positions read as scene geometry. */
  const projection: RendererProjection = {
    px: point => point.x,
    py: point => -point.y,
    scale: 1,
    uid: 'test',
    path: () => '',
    highlighted: () => false,
  }
  const beadPositions = (container: HTMLElement): readonly { x: number; y: number }[] =>
    [...container.querySelectorAll('[data-charge-flow] circle')].map(circle => ({
      x: Number(circle.getAttribute('cx')),
      y: Number(circle.getAttribute('cy')),
    }))

  it('draws drifting charge beads on the loop while the current is live', () => {
    const view = createInductionWorkspaceRuntime(createBarMotionScene()).getSnapshot().view
    const { container } = render(
      <svg>
        <InductionRenderer view={view} projection={projection} time={0} />
      </svg>,
    )
    const beads = beadPositions(container)
    expect(beads.length).toBeGreaterThan(2)
    /* Bead 0 sits at the loop's first point (resistor foot on the bottom rail). */
    const flow = view.chargeFlows?.[0]
    expect(beads[0]?.x).toBeCloseTo(flow!.path[0]!.x, 6)
    expect(beads[0]?.y).toBeCloseTo(-(flow!.path[0]!.y), 6)
  })

  it('advances the beads with the engine clock, direction following the current sign', () => {
    const view = createInductionWorkspaceRuntime(createBarMotionScene()).getSnapshot().view
    const at0 = render(
      <svg>
        <InductionRenderer view={view} projection={projection} time={0} />
      </svg>,
    )
    const at1 = render(
      <svg>
        <InductionRenderer view={view} projection={projection} time={0.1} />
      </svg>,
    )
    const before = beadPositions(at0.container)
    const after = beadPositions(at1.container)
    expect(after.length).toBe(before.length)
    /* Positive current: bead 0 leaves the resistor foot along the bottom rail,
       left→right — the direction the current arrow draws for lenz > 0. */
    expect(after[0]!.x).toBeGreaterThan(before[0]!.x)
    expect(after[0]!.y).toBeCloseTo(before[0]!.y, 6)
    /* Every bead moved (none parked). */
    expect(after.some((dot, index) => dot.x !== before[index]!.x || dot.y !== before[index]!.y)).toBe(true)
    at0.unmount()
    at1.unmount()
  })

  it('parks the beads when the bridge reports no current', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    const stopped = runtime.editParameter('bar-velocity', 0)
    const { container } = render(
      <svg>
        <InductionRenderer view={stopped.view} projection={projection} time={1} />
      </svg>,
    )
    expect(container.querySelectorAll('[data-charge-flow] circle')).toHaveLength(0)
  })
})
