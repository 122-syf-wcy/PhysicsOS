// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLeverBalanceScene } from '@physicsos/physics-scene'

import { AgentDrawer } from '../src/client/AgentDrawer.tsx'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import type { SelfCheckAttemptInput } from '../src/client/learning-record-store.ts'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { experimentSelfChecksOf } from '../src/client/physics/experiment-self-checks.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { createLeverWorkspaceRuntime } from '../src/client/physics/lever-workspace-runtime.ts'
import { physicsAgentContext } from '../src/client/physics/physics-agent.ts'
import { tutorScriptOf } from '../src/client/physics/physics-tutor.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never
const emptyRecent: PhysicsSurfaceProps['useRecentExperiments'] = selector =>
  selector({ items: [] })
const emptyRecord: PhysicsSurfaceProps['useLearningRecord'] = selector =>
  selector({ attempts: [] })

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

const derivedValue = (
  snapshot: ReturnType<ReturnType<typeof createLeverWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('lever domain routing', () => {
  it('keeps the class-1 lever inside the mechanics domain', () => {
    expect(domainOfScene(createLeverBalanceScene())).toBe('mechanics')
  })

  it('creates from the picker instead of sitting as comingSoon', () => {
    const template = findExperimentTemplate('lever-balance')
    expect(template?.comingSoon).toBeUndefined()
    expect(template?.domain).toBe('mechanics')
    const ref = sceneOf('lever-balance')
    expect(domainOfScene(ref.scene)).toBe('mechanics')
  })
})

describe('lever workspace runtime', () => {
  it('solves the textbook pair: 200 g at 15 cm balances 300 g at 10 cm', () => {
    const runtime = createLeverWorkspaceRuntime(createLeverBalanceScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('mechanics')
    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '左端重力 G₁')).toBe('1.96')
    expect(derivedValue(snapshot, '右端重力 G₂')).toBe('2.94')
    expect(derivedValue(snapshot, '左端力矩 M₁')).toBe('29.4')
    expect(derivedValue(snapshot, '右端力矩 M₂')).toBe('29.4')
    expect(derivedValue(snapshot, '力矩比 M₁/M₂')).toBe('1')
    expect(derivedValue(snapshot, '平衡判断')).toContain('杠杆平衡')

    expect(snapshot.view.leverBeam).toBeDefined()
    expect(snapshot.view.leverHangers?.map(hanger => hanger.id)).toEqual([
      'hanger-left',
      'hanger-right',
    ])
    expect(snapshot.view.leverBeam?.tilt).toBe(0)
    expect(snapshot.events.map(event => event.label)).toEqual(['杠杆平衡'])
    expect(snapshot.charts[0]?.id).toBe('lever-tilt')
    expect(snapshot.table.columns).toEqual(['钩码', 'm / g', 'l / cm', 'G / N', 'M / N·cm'])
    expect(snapshot.verification.some(check => check.id === 'moment_balance')).toBe(true)
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('tips left when the left mass is doubled, and restores by halving the left arm', () => {
    const runtime = createLeverWorkspaceRuntime(createLeverBalanceScene())
    const doubled = runtime.editParameter('left-mass', 400)
    expect(doubled.sceneRevision).toBe(1)
    expect(derivedValue(doubled, '平衡判断')).toContain('左端')
    expect(doubled.status).toBe('verified')
    expect(doubled.verification.every(check => check.status === 'passed')).toBe(true)

    runtime.setRunning(true)
    const tipped = runtime.advance(doubled.clock.total)
    expect(tipped.clock.running).toBe(false)
    expect(tipped.view.leverBeam?.tilt).toBeGreaterThan(0)
    expect(tipped.events.map(event => event.label)).toEqual(['开始倾斜', '倾斜到位'])
    expect(tipped.status).toBe('verified')
    expect(tipped.verification.every(check => check.status === 'passed')).toBe(true)
    const balance = tipped.verification.find(check => check.id === 'moment_balance')
    expect(balance?.detail).toContain('力矩不平衡')

    const restored = runtime.editParameter('left-arm', 7.5)
    expect(derivedValue(restored, '力矩比 M₁/M₂')).toBe('1')
    expect(derivedValue(restored, '平衡判断')).toContain('杠杆平衡')
    expect(runtime.seek(restored.clock.total).view.leverBeam?.tilt).toBe(0)
  })
})

describe('lever teaching layer', () => {
  it('teaches F₁l₁ = F₂l₂ off the engine verification checks', () => {
    const runtime = createLeverWorkspaceRuntime(createLeverBalanceScene())
    const script = tutorScriptOf(physicsAgentContext(runtime.getSnapshot()))
    expect(script?.id).toBe('mechanics-lever')
    expect(script?.topic).toBe('探究杠杆的平衡条件')
    expect(script?.question).toContain('为什么')
    expect(script?.answer.paragraphs.join('')).toContain('力矩相同')
    expect(script!.evidence.some(entry =>
      entry.label.includes('G = mg') && entry.status === 'passed')).toBe(true)
    expect(script!.evidence.some(entry =>
      entry.label.includes('F₁l₁ = F₂l₂') && entry.status === 'passed')).toBe(true)
  })

  it('switches the lesson question when the beam is unbalanced', () => {
    const runtime = createLeverWorkspaceRuntime(createLeverBalanceScene())
    const view = render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t as never}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '引导' }))
    expect(screen.getByText('为什么 200 g 挂在 15 cm 处，能和 300 g 挂在 10 cm 处平衡？')).toBeTruthy()

    runtime.editParameter('left-mass', 400)
    view.rerender(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText('杠杆向一边倾斜。怎样改力臂或质量，才能重新平衡？')).toBeTruthy()
    expect(screen.queryByText('为什么 200 g 挂在 15 cm 处，能和 300 g 挂在 10 cm 处平衡？')).toBeNull()
  })

  it('publishes the lever primitives the tutor highlights', () => {
    const context = physicsAgentContext(
      createLeverWorkspaceRuntime(createLeverBalanceScene()).getSnapshot(),
    )
    expect(context.domain).toBe('mechanics')
    expect(context.drawnIds).toEqual(
      expect.arrayContaining(['lever-1', 'fulcrum', 'hanger-left', 'hanger-right']),
    )
  })

  it('resolves the self-check topic from the hangers being drawn', () => {
    const set = experimentSelfChecksOf(physicsAgentContext(
      createLeverWorkspaceRuntime(createLeverBalanceScene()).getSnapshot(),
    ))
    expect(set?.id).toBe('mechanics-lever')
    expect(set?.knowledge).toEqual(['dyn-lever-balance', 'dyn-moment'])
  })
})

describe('lever self-checks in the drawer', () => {
  it('asks the moment-balance probes and records against the lever nodes', () => {
    const runtime = createLeverWorkspaceRuntime(createLeverBalanceScene())
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t as never}
        recordAttempt={recordAttempt}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '自测' }))
    expect(screen.getAllByText('探究杠杆的平衡条件').length).toBeGreaterThan(0)
    expect(screen.getByText('力臂与力矩')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '加倍（质量大了就要挂得更远）' }))
    expect(screen.getByText('概念错误')).toBeTruthy()
    expect(screen.getByText(/moment_from_force/)).toBeTruthy()
    expect(screen.getByText(/F 变大时要保持/)).toBeTruthy()
    expect(screen.getByText('力矩 M = F·l')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '钩码变重了，所以把杠杆压下去' }))
    expect(screen.getByText(/weight_from_mass/)).toBeTruthy()
    expect(screen.getByText(/重力 G = mg 也就没变/)).toBeTruthy()
    expect(screen.getByText('G = mg 只由质量和 g 决定')).toBeTruthy()

    expect(recordAttempt).toHaveBeenCalledTimes(2)
    const [massAttempt, slideAttempt] = recordAttempt.mock.calls.map(call => call[0])
    expect(massAttempt?.questionId).toBe('mechanics-lever')
    expect(massAttempt?.correct).toBe(false)
    expect(massAttempt?.selfCheckId).toBe('lever-double-mass')
    expect(massAttempt?.knowledge).toContain('dyn-lever-balance')
    expect(massAttempt?.experimentId).toBe('lever-balance')
    expect(slideAttempt?.selfCheckId).toBe('lever-slide-out')
    expect(slideAttempt?.correct).toBe(false)
    expect(slideAttempt?.experimentId).toBe('lever-balance')
  })
})

describe('lever Lab surface', () => {
  it('picks 探究杠杆的平衡条件 from the library and draws the beam plus hangers', () => {
    const surface = createPhysicsSurfaceController()
    surface.openExperimentPicker()
    const picker = render(
      <PhysicsSurface
        useLearningRecord={emptyRecord}
        useRecentExperiments={emptyRecent}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        openSurface={(id, sceneRef) => {
          if (id === 'lab' && sceneRef === undefined) surface.openExperimentPicker()
          else surface.open(id, sceneRef)
        }}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useAuth={neverHook}
      />,
    )
    expect(picker.container.querySelector('[data-physicsos-state="picker"]')).toBeTruthy()
    const cards = screen.getAllByRole('button', { name: /探究杠杆的平衡条件/ })
    const card = cards[0]
    if (card === undefined) throw new Error('lever card missing from picker')
    expect(card.getAttribute('disabled')).toBeNull()
    expect(card.textContent).not.toContain('即将支持')
    expect(card.textContent).toContain('支点在中间')
    fireEvent.click(card)
    picker.unmount()

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
    expect(container.querySelector('[data-physicsos-domain="mechanics"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText.join(' ')).toContain('200')
    expect(svgText.join(' ')).toContain('300')
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(2)
  })

  it('mounts a verified class-1 lever with both hangers drawn', () => {
    const { container } = mountLab('lever-balance')

    expect(container.querySelector('[data-physicsos-domain="mechanics"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText.join(' ')).toContain('200')
    expect(svgText.join(' ')).toContain('300')
  })
})
