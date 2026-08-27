// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArchimedesScene } from '@physicsos/physics-scene'

import { AgentDrawer } from '../src/client/AgentDrawer.tsx'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import type { SelfCheckAttemptInput } from '../src/client/QuestionWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { experimentSelfChecksOf } from '../src/client/physics/experiment-self-checks.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { createFluidWorkspaceRuntime } from '../src/client/physics/fluid-workspace-runtime.ts'
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

const derivedValue = (
  snapshot: ReturnType<ReturnType<typeof createFluidWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('fluid domain routing', () => {
  it('routes the buoyancy tank to the fluid domain', () => {
    expect(domainOfScene(createArchimedesScene())).toBe('fluid')
  })
})

describe('fluid workspace runtime', () => {
  it('solves the textbook rig: 270 g of aluminium in water reads 1.666 N when covered', () => {
    const runtime = createFluidWorkspaceRuntime(createArchimedesScene())
    const settled = runtime.seek(5)

    expect(settled.domain).toBe('fluid')
    expect(settled.status).toBe('verified')

    expect(derivedValue(settled, '物重 G')).toBe('2.646')
    expect(derivedValue(settled, '物块密度 ρ_物')).toBe('2700')
    expect(derivedValue(settled, '液体密度 ρ_液')).toBe('1000')
    /* Archimedes: the displaced water weighs exactly what the block lost. */
    expect(derivedValue(settled, '排开液体所受重力 G_排')).toBe('0.98')
    expect(derivedValue(settled, '浮力 F_浮')).toBe('0.98')
    expect(derivedValue(settled, '测力计读数 F_示')).toBe('1.666')
    expect(derivedValue(settled, '浮沉判断')).toBe('ρ_物 > ρ_液 · 下沉')

    /* Lowering is a real timeline, not a static reading. */
    expect(settled.clock.total).toBeCloseTo(5, 9)
    expect(settled.events.map(event => event.label)).toEqual([
      '底面接触液面',
      '完全浸没',
      '下放结束',
    ])
    expect(settled.events[1]?.time).toBeCloseTo(2.5, 9)

    expect(settled.charts[0]?.id).toBe('scale-reading')
    expect(settled.table.columns).toEqual(['t / s', '深度 / cm', 'V_排 / cm³', 'F_浮 / N', 'F_示 / N'])

    /* Verification is the engine's own, not a hardcoded pass. */
    expect(settled.verification.some(check => check.id === 'archimedes_principle')).toBe(true)
    expect(settled.verification.some(check => check.id === 'buoyancy_depth_independent')).toBe(true)
    expect(settled.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('drops the reading while the block enters, then holds it flat as it goes deeper', () => {
    const runtime = createFluidWorkspaceRuntime(createArchimedesScene())

    const dry = runtime.getSnapshot()
    expect(dry.view.fluidBlock?.phase).toBe('dry')
    expect(dry.view.fluidScale?.reading).toBe('2.65 N')

    /* Half in at 1.25 s: half the volume displaced, half the buoyancy. */
    const half = runtime.seek(1.25)
    expect(half.view.fluidBlock?.phase).toBe('entering')
    expect(derivedValue(half, '浮力 F_浮')).toBe('0.98')
    expect(half.view.fluidScale?.reading).toBe('2.16 N')

    const covered = runtime.seek(2.5)
    expect(covered.view.fluidBlock?.phase).toBe('submerged')
    expect(covered.view.fluidScale?.reading).toBe('1.67 N')

    /* Twice as deep, same reading — the misconception this rig exists to kill. */
    const deeper = runtime.seek(5)
    expect(deeper.view.fluidBlock?.phase).toBe('submerged')
    expect(deeper.view.fluidScale?.reading).toBe('1.67 N')
    expect(deeper.view.fluidBlock?.at.y).toBeLessThan(covered.view.fluidBlock!.at.y)
  })

  it('re-solves the rig through real scene commands: liquid swap and mass edit', () => {
    const runtime = createFluidWorkspaceRuntime(createArchimedesScene())

    /* Denser liquid, same block: more buoyancy, smaller reading. */
    const brine = runtime.setChoice('liquid', 'brine')
    expect(brine.sceneRevision).toBe(1)
    expect(derivedValue(brine, '液体密度 ρ_液')).toBe('1100')
    expect(
      brine.inspector
        .flatMap(section => section.choices ?? [])
        .find(choice => choice.id === 'liquid')?.value,
    ).toBe('brine')

    /* A light enough block floats: buoyancy carries the whole weight and the
       scale reads zero without the block ever going fully under. */
    const light = runtime.editParameter('block-mass', 60)
    expect(light.sceneRevision).toBe(2)
    expect(derivedValue(light, '浮沉判断')).toBe('ρ_物 < ρ_液 · 漂浮')
    const floating = runtime.seek(light.clock.total)
    expect(floating.view.fluidBlock?.phase).toBe('floating')
    expect(floating.view.fluidScale?.reading).toBe('0.00 N')
    expect(floating.verification.some(check => check.id === 'float_equilibrium')).toBe(true)
    expect(floating.verification.every(check => check.status === 'passed')).toBe(true)
  })
})

describe('fluid teaching layer', () => {
  it('teaches the weighing method off the engine verification checks', () => {
    const runtime = createFluidWorkspaceRuntime(createArchimedesScene())
    const script = tutorScriptOf(physicsAgentContext(runtime.seek(5)))
    expect(script?.id).toBe('fluid-buoyancy')
    expect(script?.topic).toBe('探究浮力的大小')
    expect(script?.answer.paragraphs.join('')).toContain('F_浮 = G − F_示')
    expect(script!.evidence.some(entry =>
      entry.label.includes('阿基米德原理') && entry.status === 'passed')).toBe(true)
    expect(script!.evidence.some(entry =>
      entry.label.includes('浮力与深度无关') && entry.status === 'passed')).toBe(true)
  })

  it('switches the lesson question when the block floats instead of sinking', () => {
    const runtime = createFluidWorkspaceRuntime(createArchimedesScene())
    runtime.editParameter('block-mass', 60)
    const script = tutorScriptOf(physicsAgentContext(runtime.seek(runtime.getSnapshot().clock.total)))
    expect(script?.question).toContain('浮在水面')
    expect(script?.answer.paragraphs.join('')).toContain('F_浮 = G')
  })

  it('publishes the rig primitives the tutor highlights', () => {
    const context = physicsAgentContext(
      createFluidWorkspaceRuntime(createArchimedesScene()).getSnapshot(),
    )
    expect(context.domain).toBe('fluid')
    expect(context.drawnIds).toEqual(
      expect.arrayContaining(['block-1', 'liquid-1', 'spring-scale']),
    )
  })

  it('resolves the self-check topic from the fluid frame', () => {
    const set = experimentSelfChecksOf(physicsAgentContext(
      createFluidWorkspaceRuntime(createArchimedesScene()).getSnapshot(),
    ))
    expect(set?.id).toBe('fluid-buoyancy')
    expect(set?.knowledge).toContain('fl-archimedes')
  })
})

describe('fluid self-checks in the drawer', () => {
  it('asks the buoyancy probes and records against the fluid nodes', () => {
    const runtime = createFluidWorkspaceRuntime(createArchimedesScene())
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <AgentDrawer
        snapshot={runtime.seek(5)}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t as never}
        recordAttempt={recordAttempt}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '自测' }))
    expect(screen.getAllByText('探究浮力的大小').length).toBeGreaterThan(0)
    expect(screen.getByText('物体的浮沉条件')).toBeTruthy()

    /* "Deeper means more buoyancy" is THE buoyancy mistake; the diagnosis cites
       the live depth-independence check rather than a canned explanation. */
    fireEvent.click(screen.getByRole('button', { name: '变小（浸得越深浮力越大，把物块托得越轻）' }))
    expect(screen.getByText('概念错误')).toBeTruthy()
    expect(screen.getByText(/buoyancy_depth_independent/)).toBeTruthy()

    expect(recordAttempt).toHaveBeenCalledOnce()
    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('fluid-buoyancy')
    expect(attempt.correct).toBe(false)
    expect(attempt.knowledge).toContain('fl-archimedes')
    /* The deep link 学习记录 turns into its 重做实验 button. */
    expect(attempt.experimentId).toBe('buoyancy')
  })
})

describe('fluid Lab surface', () => {
  it('mounts a verified tank with the block, liquid and scale drawn', () => {
    const { container } = mountLab('buoyancy')

    expect(container.querySelector('[data-physicsos-domain="fluid"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('铝块')
    expect(svgText).toContain('水')
    expect(svgText).toContain('弹簧测力计')
    /* The dial shows the dry weight before the block is lowered. */
    expect(svgText).toContain('2.65 N')
  })

  it('commits a 液体密度 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('buoyancy')

    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    const densityInput = screen.getByRole('textbox', { name: '液体密度' })
    if (!(densityInput instanceof HTMLInputElement)) throw new Error('Expected 液体密度 input.')
    fireEvent.change(densityInput, { target: { value: '1100' } })
    fireEvent.blur(densityInput)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    /* Denser liquid, bigger buoyant force on the same displaced volume. */
    expect(screen.getAllByText('浮力 F_浮')[0]?.parentElement?.textContent).toContain('1.078')
  })
})
