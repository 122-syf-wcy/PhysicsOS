// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLeverBalanceScene } from '@physicsos/physics-scene'

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
import { createLeverWorkspaceRuntime } from '../src/client/physics/lever-workspace-runtime.ts'
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
    const tipped = runtime.seek(doubled.clock.total)
    expect(tipped.view.leverBeam?.tilt).toBeGreaterThan(0)
    expect(tipped.events.map(event => event.label)).toEqual(['开始倾斜', '倾斜到位'])

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
    runtime.editParameter('left-mass', 400)
    const script = tutorScriptOf(physicsAgentContext(runtime.getSnapshot()))
    expect(script?.question).toContain('重新平衡')
    expect(script?.answer.paragraphs.join('')).toContain('F₁l₁ = F₂l₂')
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

    expect(recordAttempt).toHaveBeenCalledOnce()
    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('mechanics-lever')
    expect(attempt.correct).toBe(false)
    expect(attempt.knowledge).toContain('dyn-lever-balance')
    expect(attempt.experimentId).toBe('lever-balance')
  })
})

describe('lever Lab surface', () => {
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
