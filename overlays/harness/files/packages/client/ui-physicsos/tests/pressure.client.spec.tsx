// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAtmosphericPressureScene,
  createLiquidPressureScene,
  createSolidPressureScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { createPressureWorkspaceRuntime } from '../src/client/physics/pressure-workspace-runtime.ts'
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

/** An atmospheric rig that came from a question, at a non-zero revision. */
const questionRig = (): PhysicsScene => {
  const scene = createAtmosphericPressureScene({ sceneId: 'scene-pressure-question-001' })
  return {
    ...scene,
    revision: 3,
    /* `@physicsos/shared` is only a transitive dependency here, so the branded id
       is cast rather than imported. */
    metadata: {
      ...scene.metadata,
      sourceQuestionId: 'golden-fluid-01' as NonNullable<
        PhysicsScene['metadata']['sourceQuestionId']
      >,
    },
  }
}

const derivedValue = (
  snapshot: ReturnType<ReturnType<typeof createPressureWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

const checkStatusOf = (
  snapshot: ReturnType<ReturnType<typeof createPressureWorkspaceRuntime>['getSnapshot']>,
  id: string,
) => snapshot.verification.find(check => check.id === id)?.status

describe('pressure domain routing', () => {
  it('keeps the three pressure rigs on the fluid domain’s shelf', () => {
    /* Same domain as the buoyancy tank — same shelf, same canvas — which is why
       the shelf filter must not be the thing that tells the two benches apart. */
    expect(domainOfScene(createSolidPressureScene())).toBe('fluid')
    expect(domainOfScene(createLiquidPressureScene())).toBe('fluid')
    expect(domainOfScene(createAtmosphericPressureScene())).toBe('fluid')
  })

  it('draws a pressure rig with no buoyancy tank on it', () => {
    const solid = createPressureWorkspaceRuntime(createSolidPressureScene()).getSnapshot()
    expect(solid.domain).toBe('fluid')
    expect(solid.view.pressureRig).toBe('solid')
    expect(solid.view.pressureSolid).toBeTruthy()
    /* The domain is shared; the apparatus is not. A pressure frame carries no
       block, no vessel and no spring scale — those belong to the other bench. */
    expect(solid.view.fluidBlock).toBeUndefined()
    expect(solid.view.fluidLiquid).toBeUndefined()
    expect(solid.view.fluidScale).toBeUndefined()
    expect(solid.view.pressureLiquid).toBeUndefined()
    expect(solid.view.pressureBarometer).toBeUndefined()
  })
})

describe('solid pressure rig', () => {
  it('reads the textbook rig: the same 20 N on 200 cm² and on 50 cm²', () => {
    const runtime = createPressureWorkspaceRuntime(createSolidPressureScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '压力 F')).toBe('20')
    /* The area is the engine’s own, in square metres: 200 cm². */
    expect(derivedValue(snapshot, '受力面积 S')).toBe('0.02')
    expect(derivedValue(snapshot, '压强 p')).toBe('1000')
    expect(derivedValue(snapshot, '对比面受力面积 S₂')).toBe('0.005')
    /* Four times the pressure on the fourth of the area — and nothing about the
       force changed, which is the point of separating 压力 from 压强. */
    expect(derivedValue(snapshot, '对比面压强 p₂')).toBe('4000')
    expect(derivedValue(snapshot, '仪器读数')).toBe('p = 1000 Pa · p₂ = 4000 Pa')

    expect(snapshot.table.columns).toEqual(['受力面', 'F / N', 'S / cm²', 'p / Pa'])
    expect(snapshot.table.rows[0]?.values).toEqual(['受力面', '20', '200', '1000'])
    expect(snapshot.table.rows[1]?.values).toEqual(['对比面', '20', '50', '4000'])

    expect(checkStatusOf(snapshot, 'contact_force_invariant')).toBe('passed')
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('pulls both faces with arrows of the same length — the force is one force', () => {
    const view = createPressureWorkspaceRuntime(createSolidPressureScene()).getSnapshot().view
    const faces = view.pressureSolid?.faces ?? []
    expect(faces.map(face => face.pressureText)).toEqual(['1000 Pa', '4000 Pa'])

    const vectors = view.vectors ?? []
    expect(vectors.map(vector => vector.id).sort()).toEqual(['force-comparison', 'force-loaded'])
    const lengths = vectors.map(vector => vector.to.y - vector.from.y)
    expect(lengths[0]).toBeCloseTo(lengths[1] ?? NaN, 9)

    /* The comparison face answers to its own layer, so it can be switched off
       without touching the loaded face. */
    const bare = createPressureWorkspaceRuntime(createSolidPressureScene())
    bare.setObservable('pressureComparison', false)
    const gated = bare.getSnapshot().view
    expect((gated.vectors ?? []).map(vector => vector.id)).toEqual(['force-loaded'])
    expect(gated.pressureSolid?.faces.map(face => face.id)).toEqual(['loaded'])
  })

  it('re-solves from the inspector: a smaller face reads a larger pressure', () => {
    const runtime = createPressureWorkspaceRuntime(createSolidPressureScene())

    /* 20 N over 100 cm² instead of 200 cm². */
    const halved = runtime.editParameter('contact-area', 100)
    expect(halved.sceneRevision).toBe(1)
    expect(derivedValue(halved, '压强 p')).toBe('2000')
    /* The comparison face is untouched: it is a different area, not a copy. */
    expect(derivedValue(halved, '对比面压强 p₂')).toBe('4000')
    expect(
      halved.inspector
        .flatMap(section => section.parameters ?? [])
        .find(parameter => parameter.id === 'contact-area')?.value,
    ).toBe(100)

    /* Half the force, same face: back to 1000 Pa. */
    const lighter = runtime.editParameter('pressure-force', 10)
    expect(lighter.sceneRevision).toBe(2)
    expect(derivedValue(lighter, '压强 p')).toBe('1000')
    expect(derivedValue(lighter, '对比面压强 p₂')).toBe('2000')
  })
})

describe('liquid pressure rig', () => {
  it('reads the textbook rig: water at 20 cm and 40 cm, then brine at 20 cm', () => {
    const runtime = createPressureWorkspaceRuntime(createLiquidPressureScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '液体密度 ρ')).toBe('1000')
    expect(derivedValue(snapshot, '探头深度 h')).toBe('0.2')
    expect(derivedValue(snapshot, '探头处压强 p')).toBe('1960')
    /* Twice the depth, twice the pressure. */
    expect(derivedValue(snapshot, '深处压强 p₂')).toBe('3920')
    /* The same depth in a denser liquid: 1100/1000 of the pressure. */
    expect(derivedValue(snapshot, '另一种液体的压强 p₃')).toBe('2156')
    expect(derivedValue(snapshot, '仪器读数')).toBe('p = 1960 Pa')

    expect(snapshot.verification.some(check => check.id === 'hydrostatic_gradient_integral')).toBe(true)
    expect(snapshot.verification.some(check => check.id === 'pressure_proportional_to_depth')).toBe(true)
    expect(snapshot.verification.some(check => check.id === 'pressure_proportional_to_density')).toBe(true)
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('draws one probe per reading, each labelled with the pressure it senses', () => {
    const view = createPressureWorkspaceRuntime(createLiquidPressureScene()).getSnapshot().view
    const probes = view.pressureProbes ?? []
    expect(probes.map(probe => probe.readingText)).toEqual(['1960 Pa', '3920 Pa', '2156 Pa'])
    expect(probes.filter(probe => probe.primary).length).toBe(1)
    /* Depth is drawn from the same surface line every probe measures from. */
    expect(new Set(probes.map(probe => probe.surface))).toEqual(new Set([0]))
    expect(view.pressureLiquid?.densityText).toBe('1000 kg/m³')
    expect(view.pressureComparisonLiquid?.densityText).toBe('1100 kg/m³')
  })

  it('re-solves from the inspector: deeper, and a one-tap liquid swap', () => {
    const runtime = createPressureWorkspaceRuntime(createLiquidPressureScene())

    const deeper = runtime.editParameter('probe-depth', 30)
    expect(deeper.sceneRevision).toBe(1)
    expect(derivedValue(deeper, '探头处压强 p')).toBe('2940')

    /* The preset is a real scene command, not a display state. */
    const brine = runtime.setChoice('liquid-density', 'brine')
    expect(brine.sceneRevision).toBe(2)
    expect(derivedValue(brine, '液体密度 ρ')).toBe('1100')
    expect(derivedValue(brine, '探头处压强 p')).toBe('3234')
    expect(
      brine.inspector
        .flatMap(section => section.choices ?? [])
        .find(choice => choice.id === 'liquid-density')?.value,
    ).toBe('brine')

    /* An alcohol swap lightens both the probe and the comparison reading. */
    const alcohol = runtime.setChoice('liquid-density', 'alcohol')
    expect(alcohol.sceneRevision).toBe(3)
    expect(derivedValue(alcohol, '探头处压强 p')).toBe('2352')
  })
})

describe('atmospheric pressure rig', () => {
  it('reads 760.05 mm of mercury and a 795.61 N pull, both derived from one p₀', () => {
    const runtime = createPressureWorkspaceRuntime(createAtmosphericPressureScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '大气压 p₀')).toBe('101300')
    /* Neither number is entered anywhere in the scene: the column is p₀/(ρ_液·g)
       and the pull is p₀·πr², both consequences of the one pressure. */
    expect(derivedValue(snapshot, '汞柱高度 h')).toBe('0.76005')
    expect(derivedValue(snapshot, '拉开半球所需的力 F')).toBe('795.61')
    expect(derivedValue(snapshot, '仪器读数')).toBe('h = 760.05 mm · F = 795.61 N')

    expect(snapshot.view.pressureBarometer?.columnText).toBe('h = 760.05 mm')
    expect(snapshot.view.pressureBarometer?.pressureText).toBe('101300 Pa')
    expect(snapshot.view.pressureHemispheres?.forceText).toBe('795.61 N')

    expect(checkStatusOf(snapshot, 'hemisphere_projected_force')).toBe('passed')
    expect(checkStatusOf(snapshot, 'barometer_column_balance')).toBe('passed')
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('lowers the column when the air thins — a barometer is an altimeter', () => {
    const runtime = createPressureWorkspaceRuntime(createAtmosphericPressureScene())

    const plateau = runtime.setChoice('atmospheric-pressure', 'plateau')
    expect(plateau.sceneRevision).toBe(1)
    expect(derivedValue(plateau, '大气压 p₀')).toBe('70000')
    expect(plateau.view.pressureBarometer?.columnText).toBe('h = 525.21 mm')
    /* The hemispheres are the same pair; the air holding them shut is thinner. */
    expect(derivedValue(plateau, '拉开半球所需的力 F')).toBe('549.78')

    const highland = runtime.setChoice('atmospheric-pressure', 'highland')
    expect(highland.sceneRevision).toBe(2)
    expect(highland.view.pressureBarometer?.columnText).toBe('h = 450.18 mm')

    /* A denser filling fluid holds the same p₀ in a shorter column. */
    const heavy = runtime.editParameter('barometer-fluid-density', 27_200)
    expect(heavy.sceneRevision).toBe(3)
    expect(heavy.view.pressureBarometer?.columnText).toBe('h = 225.09 mm')
    expect(derivedValue(heavy, '大气压 p₀')).toBe('60000')
  })

  it('scales the hemisphere pull with r², not with r', () => {
    const runtime = createPressureWorkspaceRuntime(createAtmosphericPressureScene())
    /* Double the radius, πr² quadruples: 795.61 N → 3182.4 N. */
    const wide = runtime.editParameter('hemisphere-radius', 10)
    expect(derivedValue(wide, '拉开半球所需的力 F')).toBe('3182.4')
    expect(wide.view.pressureHemispheres?.radius).toBeCloseTo(
      2 * (createPressureWorkspaceRuntime(createAtmosphericPressureScene())
        .getSnapshot().view.pressureHemispheres?.radius ?? 0),
      9,
    )
  })

  it('forks a question-sourced rig when the filling fluid or the pair changes', () => {
    const origin = questionRig()
    const runtime = createPressureWorkspaceRuntime(origin)
    expect(runtime.getSnapshot().branch).toBeUndefined()
    expect(runtime.getSnapshot().sceneRevision).toBe(3)

    /* The filling decides the column the question's answer quotes, so editing it
       forks the question instead of quietly re-labelling it. */
    const heavy = runtime.editParameter('barometer-fluid-density', 27_200)
    expect(heavy.branch?.canRestore).toBe(true)
    expect(heavy.sceneRevision).toBe(1)
    /* Twice the density holds the same p₀ in half the column. */
    expect(heavy.view.pressureBarometer?.columnText).toBe('h = 380.03 mm')
    expect(derivedValue(heavy, '拉开半球所需的力 F')).toBe('795.61')

    const wide = runtime.editParameter('hemisphere-radius', 10)
    expect(wide.sceneRevision).toBe(2)
    expect(derivedValue(wide, '拉开半球所需的力 F')).toBe('3182.4')

    /* Restoring returns the rig the question stated, at its own revision. */
    const restored = runtime.restoreOrigin()
    expect(restored.branch).toBeUndefined()
    expect(restored.sceneRevision).toBe(3)
    expect(restored.view.pressureBarometer?.columnText).toBe('h = 760.05 mm')
    expect(derivedValue(restored, '拉开半球所需的力 F')).toBe('795.61')
    expect(origin.revision).toBe(3)
  })
})

describe('pressure rigs have no timeline', () => {
  it('reports a zero-length clock rather than an invented one', () => {
    for (const scene of [
      createSolidPressureScene(),
      createLiquidPressureScene(),
      createAtmosphericPressureScene(),
    ]) {
      const snapshot = createPressureWorkspaceRuntime(scene).getSnapshot()
      /* The reading is the same at every instant, so there is no moment to mark
         and the transport must stay disabled — `clock.total > 0` is its gate. */
      expect(snapshot.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
      expect(snapshot.events).toEqual([])
      expect(snapshot.charts).toEqual([])
      expect(snapshot.trajectoryTimes).toEqual([])
    }
  })

  it('hands back the same frame when asked for one at 5 s', () => {
    const runtime = createPressureWorkspaceRuntime(createLiquidPressureScene())
    const now = runtime.getSnapshot()
    const later = runtime.seek(5)
    expect(later.clock.time).toBe(0)
    expect(derivedValue(later, '探头处压强 p')).toBe(derivedValue(now, '探头处压强 p'))
    expect(later.sceneRevision).toBe(now.sceneRevision)
  })
})

describe('pressure Lab surface', () => {
  it('mounts the solid rig verified, with both faces under equal arrows', () => {
    const { container } = mountLab('solid-pressure')

    expect(container.querySelector('[data-physicsos-domain="fluid"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('1000 Pa')
    expect(svgText).toContain('4000 Pa')
    expect(svgText).toContain('S = 200 cm²')
    expect(svgText).toContain('S = 50 cm²')
  })

  it('mounts the liquid rig with both vessels and their probes', () => {
    const { container } = mountLab('liquid-pressure')
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('1960 Pa')
    expect(svgText).toContain('3920 Pa')
    expect(svgText).toContain('2156 Pa')
    /* Both vessels carry their own density under the floor: the comparison IS
       the density, so the label names the reading rather than the apparatus. */
    expect(svgText).toContain('1000 kg/m³')
    expect(svgText).toContain('1100 kg/m³')
  })

  it('mounts the atmospheric rig with the tube, the dish and the hemispheres', () => {
    const { container } = mountLab('atmospheric-pressure')
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('h = 760.05 mm')
    expect(svgText).toContain('795.61 N')
  })

  it('commits a 受力面积 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('solid-pressure')

    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    const area = screen.getByRole('textbox', { name: '受力面积' })
    if (!(area instanceof HTMLInputElement)) throw new Error('Expected 受力面积 input.')
    fireEvent.change(area, { target: { value: '100' } })
    fireEvent.blur(area)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '读数' }))
    expect(screen.getAllByText('压强 p')[0]?.parentElement?.textContent).toContain('2000')
  })

  it('draws the rig as an SVG that the canvas accepts', () => {
    const runtime = createPressureWorkspaceRuntime(createAtmosphericPressureScene())
    const { container } = render(
      <PhysicsCanvas view={runtime.getSnapshot().view} ariaLabel="大气压" />,
    )
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
  })
})
