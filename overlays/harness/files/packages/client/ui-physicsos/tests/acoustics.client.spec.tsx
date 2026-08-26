// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEchoRangingScene } from '@physicsos/physics-scene'

import { AgentDrawer } from '../src/client/AgentDrawer.tsx'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import type { SelfCheckAttemptInput } from '../src/client/QuestionWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { createAcousticsWorkspaceRuntime } from '../src/client/physics/acoustics-workspace-runtime.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { experimentSelfChecksOf } from '../src/client/physics/experiment-self-checks.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
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
  snapshot: ReturnType<ReturnType<typeof createAcousticsWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('acoustics domain routing', () => {
  it('routes the echo range to the acoustics domain', () => {
    expect(domainOfScene(createEchoRangingScene())).toBe('acoustics')
  })
})

describe('acoustics workspace runtime', () => {
  it('solves the textbook range: d = 340 m at 340 m/s → t₁ = 1 s, echo at 2 s', () => {
    const runtime = createAcousticsWorkspaceRuntime(createEchoRangingScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('acoustics')
    expect(snapshot.status).toBe('verified')

    expect(derivedValue(snapshot, '峭壁距离 d')).toBe('340')
    expect(derivedValue(snapshot, '声速 v')).toBe('340')
    expect(derivedValue(snapshot, '单程时间 t₁')).toBe('1')
    expect(derivedValue(snapshot, '回声时间 t')).toBe('2')
    /* The measurement the lab exists for agrees with the geometry it was set up with. */
    expect(derivedValue(snapshot, '测得距离 d = v·t/2')).toBe('340')

    /* Unlike geometric imaging, echo ranging has a real timeline. */
    expect(snapshot.clock.total).toBeCloseTo(2, 9)
    expect(snapshot.events.map(event => event.label)).toEqual([
      '发出声脉冲',
      '到达峭壁并反射',
      '回声返回声源',
    ])
    expect(snapshot.events[1]?.time).toBeCloseTo(1, 9)

    expect(snapshot.charts[0]?.id).toBe('pulse-position')
    expect(snapshot.table.columns).toEqual(['t / s', 'x / m', '路程 / m', '阶段'])
    expect(snapshot.table.rows[0]?.values).toEqual(['0.000', '0', '0', '去程'])

    /* Verification is the engine's own, not a hardcoded pass. */
    expect(snapshot.verification.some(check => check.id === 'echo_distance_formula')).toBe(true)
    expect(snapshot.verification.some(check => check.id === 'reflection_symmetry')).toBe(true)
    expect(snapshot.verification.some(check => check.id === 'pulse_speed_constant')).toBe(true)
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('walks the pulse out, back and into the source across the clock', () => {
    const runtime = createAcousticsWorkspaceRuntime(createEchoRangingScene())

    const outbound = runtime.seek(0.5)
    expect(outbound.view.acousticPulse?.phase).toBe('outbound')
    expect(outbound.view.acousticPulse?.at.x).toBeCloseTo(170, 9)
    expect(derivedValue(outbound, '脉冲状态')).toBe('去程（向峭壁传播）')
    /* Trailing arcs exist only while something is travelling. */
    expect(outbound.view.acousticWavefronts?.length).toBe(3)

    /* Half a second past the wall the pulse is back at the midpoint — same x,
       other leg. That fold IS why the echo time is double the one-way time. */
    const back = runtime.seek(1.5)
    expect(back.view.acousticPulse?.phase).toBe('return')
    expect(back.view.acousticPulse?.at.x).toBeCloseTo(170, 9)
    expect(derivedValue(back, '脉冲状态')).toBe('回程（反射后返回）')

    const received = runtime.seek(2)
    expect(received.view.acousticPulse?.phase).toBe('received')
    expect(received.view.acousticPulse?.at.x).toBeCloseTo(0, 9)
    expect(received.view.acousticWavefronts).toEqual([])
    /* 2d, not d: the total path is what the stopwatch actually timed. */
    expect(received.view.overlay?.readout).toContain('已传播 s = 680 m')
  })

  it('re-times the trip through real scene commands: distance and medium', () => {
    const runtime = createAcousticsWorkspaceRuntime(createEchoRangingScene())

    const farther = runtime.editParameter('wall-distance', 680)
    expect(farther.sceneRevision).toBe(1)
    expect(derivedValue(farther, '峭壁距离 d')).toBe('680')
    expect(derivedValue(farther, '回声时间 t')).toBe('4')
    expect(farther.clock.total).toBeCloseTo(4, 9)

    /* v belongs to the medium: the same range echoes back far sooner in water,
       so t = 2 × 680 / 1500 s. */
    const water = runtime.setChoice('medium', 'water')
    expect(water.sceneRevision).toBe(2)
    expect(derivedValue(water, '声速 v')).toBe('1500')
    expect(derivedValue(water, '回声时间 t')).toBe('0.9067')
    expect(
      water.inspector
        .flatMap(section => section.choices ?? [])
        .find(choice => choice.id === 'medium')?.value,
    ).toBe('water')
    /* The distance is unchanged — only the medium was switched. */
    expect(derivedValue(water, '峭壁距离 d')).toBe('680')
  })
})

describe('acoustics teaching layer', () => {
  it('teaches the halving step off the engine timing checks', () => {
    const script = tutorScriptOf(physicsAgentContext(
      createAcousticsWorkspaceRuntime(createEchoRangingScene()).getSnapshot(),
    ))
    expect(script?.id).toBe('acoustics-echo-ranging')
    expect(script?.topic).toBe('回声测距')
    expect(script?.answer.paragraphs.join('')).toContain('d = v·t/2')
    expect(script!.observation.join('\n')).toMatch(/去程/)
    expect(script!.evidence.some(entry =>
      entry.label.includes('回声测距公式') && entry.status === 'passed')).toBe(true)
    expect(script!.evidence.some(entry =>
      entry.label.includes('往返对称') && entry.status === 'passed')).toBe(true)
  })

  it('publishes the range primitives the tutor highlights', () => {
    const context = physicsAgentContext(
      createAcousticsWorkspaceRuntime(createEchoRangingScene()).getSnapshot(),
    )
    expect(context.domain).toBe('acoustics')
    expect(context.drawnIds).toEqual(
      expect.arrayContaining(['sound-source', 'wall-1', 'sound-pulse']),
    )
  })

  it('resolves the self-check topic from the acoustics frame', () => {
    const set = experimentSelfChecksOf(physicsAgentContext(
      createAcousticsWorkspaceRuntime(createEchoRangingScene()).getSnapshot(),
    ))
    expect(set?.id).toBe('acoustics-echo')
    expect(set?.knowledge).toContain('ac-echo-ranging')
  })
})

describe('acoustics self-checks in the drawer', () => {
  it('asks the echo probes and records against the acoustics nodes', () => {
    const runtime = createAcousticsWorkspaceRuntime(createEchoRangingScene())
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
    expect(screen.getAllByText('回声测距').length).toBeGreaterThan(0)
    expect(screen.getByText('回声与反射')).toBeTruthy()

    /* Forgetting the return leg is THE echo mistake; the diagnosis cites the
       live formula check rather than a canned explanation. */
    fireEvent.click(screen.getByRole('button', { name: '680 m（距离 = 速度 × 时间）' }))
    expect(screen.getByText('概念错误')).toBeTruthy()
    expect(screen.getByText(/echo_distance_formula/)).toBeTruthy()

    expect(recordAttempt).toHaveBeenCalledOnce()
    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('acoustics-echo')
    expect(attempt.correct).toBe(false)
    expect(attempt.knowledge).toContain('ac-echo-ranging')
    /* The deep link 学习记录 turns into its 重做实验 button. */
    expect(attempt.experimentId).toBe('echo-ranging')
  })
})

describe('acoustics Lab surface', () => {
  it('mounts a verified range with the speaker, cliff and both legs drawn', () => {
    const { container } = mountLab('echo-ranging')

    expect(container.querySelector('[data-physicsos-domain="acoustics"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('声源（喇叭）')
    expect(svgText).toContain('峭壁')
    expect(svgText).toContain('去程 t₁ = d/v')
    expect(svgText).toContain('回程 t₂ = d/v')
  })

  it('commits a 峭壁距离 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('echo-ranging')

    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    const distanceInput = screen.getByRole('textbox', { name: '峭壁距离' })
    if (!(distanceInput instanceof HTMLInputElement)) throw new Error('Expected 峭壁距离 input.')
    fireEvent.change(distanceInput, { target: { value: '680' } })
    fireEvent.blur(distanceInput)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    /* The echo delay doubles with the range — the reading the lesson turns on. */
    expect(screen.getAllByText('回声时间 t')[0]?.parentElement?.textContent).toContain('4 s')
  })
})
